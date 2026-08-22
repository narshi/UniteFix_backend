/**
 * PHASE 8: Client Feature Routes
 * 
 * New endpoints:
 * - Rating system (submit, view provider ratings, average)
 * - Profile picture upload
 * - Account deletion (soft delete)
 * - Wallet V2 APIs (balance, history, withdrawal)
 * - Invoice download
 * - User support tickets
 */

import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { uploadImageBuffer } from "../services/cloudinary.service";
import { db } from "../db";
import { eq, and, desc, sql, avg, count, isNull, isNotNull } from "drizzle-orm";
import {
    ratings, serviceRequests, employees, users, customers,
    partnerWallets, walletTransactionsV2, invoices,
    supportTickets, ticketMessages, withdrawalRequests,
} from "@shared/schema";
import { authenticateToken, authenticatePartner, authenticateAny } from "../middleware/auth.middleware";
import { SupportTicketService } from "../services/support.service";
import { InvoiceGenerator } from "../services/invoice-generator";
import { PaymentService } from "../services/payment.service";
import logger from "../lib/logger";
import { getUserProductOrders, getProductOrder } from "../repositories/order.repository";
import { storage } from "../storage";
import { getPendingOnboardingSteps } from "../lib/onboarding";
// Use the shared singleton. A local `new ConfigService()` here carried its own
// 5-minute cache, so /api/config/public and BillingEngine could disagree about
// the booking fee after an admin edit — the app quoting one price and billing
// freezing another.
import { configService } from "../services/config.service";

// Auth middleware aliases — import from canonical auth.middleware.ts
// authenticateToken protects customer routes
// authenticatePartner (aliased as authenticateServiceman) protects partner routes
const authenticateServiceman = authenticatePartner;

// Request type with user info from auth middleware
interface AuthenticatedRequest extends Request {
    user?: { userId: number; role: string };
}

export function registerClientFeatureRoutes(app: Express) {

    // ==================== SERVICE CATALOG ====================
    
    /**
     * GET /api/services/home
     * Returns active services that should be displayed on the home page
     */
    app.get('/api/services/home', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const services = await storage.getHomeVisibleServices();
            res.json({ success: true, data: services });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/services/categories
     * Returns all active categories with their active services
     */
    app.get('/api/services/categories', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const categories = await storage.getAllServiceCategoriesWithServices();
            res.json({ success: true, data: categories });
        } catch (error) {
            next(error);
        }
    });

    // ==================== CONFIG ====================

    /**
     * GET /api/config/public
     * Returns public configuration values needed by the mobile app (e.g., booking fee)
     * Includes platform fee % for transparent billing display
     */
    app.get('/api/config/public', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingFee = await configService.get('BUSINESS_CONFIG.BASE_SERVICE_FEE', 99);
            const gstRate = await configService.get('BUSINESS_CONFIG.GST_PERCENTAGE', 18);
            const cancelFee = await configService.get('BUSINESS_CONFIG.CANCELLATION_FEE', 150);
            const platformFeePercent = await configService.get('BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT', 15);
            // Exposed so the app can show a struck-through list price rather than
            // silently charging less than the catalog says.
            const discountPercent = await configService.get('BUSINESS_CONFIG.DISCOUNT_PERCENT', 0);
            const discountLabel = await configService.get('BUSINESS_CONFIG.DISCOUNT_LABEL', '');
            const supportWindowHours = await configService.get('BUSINESS_CONFIG.SUPPORT_WINDOW_HOURS', 48);
            const minWalletRedemption = await configService.get('BUSINESS_CONFIG.MIN_WALLET_REDEMPTION', 500);
            const whatsappNumber = process.env.WHATSAPP_BUSINESS_NUMBER || '919448850679';
            const companyUpiId = await configService.get('BUSINESS_CONFIG.COMPANY_UPI_ID', 'yourmerchant@upi');

            res.json({
                success: true,
                data: {
                    bookingFee: Number(bookingFee),
                    gstRate: Number(gstRate),
                    discountPercent: Number(discountPercent) || 0,
                    discountLabel: String(discountLabel || '').slice(0, 40),
                    cancelFee: Number(cancelFee),
                    platformFeePercent: Number(platformFeePercent),
                    supportWindowHours: Number(supportWindowHours),
                    minWalletRedemption: Number(minWalletRedemption),
                    whatsappNumber: whatsappNumber,
                    companyUpiId: String(companyUpiId),
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== MY ORDERS ====================

    /**
     * GET /api/orders/mine
     * Returns authenticated user's product orders
     */
    app.get('/api/orders/mine', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const authReq = req as AuthenticatedRequest;
            const userId = authReq.user!.userId;
            const orders = await getUserProductOrders(userId);
            res.json({ success: true, data: orders });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/orders/:id
     * Returns a single order detail
     */
    app.get('/api/orders/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const authReq = req as AuthenticatedRequest;
            const order = await getProductOrder(parseInt(req.params.id));
            if (!order || order.userId !== authReq.user!.userId) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }
            res.json({ success: true, data: order });
        } catch (error) {
            next(error);
        }
    });

    // ==================== RATING SYSTEM ====================

    /**
     * POST /api/ratings/service/:serviceId
     * Submit a rating for a completed service
     * Auth: Customer only
     */
    app.post("/api/ratings/service/:serviceId", authenticateToken, async (req: Request, res, next) => {
        try {
            const serviceRequestId = parseInt(req.params.serviceId);
            const userId = (req as any).user!.userId;
            const { rating: ratingValue, review } = req.body;

            // Validate rating value
            if (!ratingValue || ratingValue < 1 || ratingValue > 5) {
                return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
            }

            // Get the service request
            const [service] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, serviceRequestId)).limit(1);

            if (!service) {
                return res.status(404).json({ success: false, message: "Service not found" });
            }

            // Only the customer who booked can rate
            if (service.userId !== userId) {
                return res.status(403).json({ success: false, message: "You can only rate services you booked" });
            }

            // Can only rate completed services
            if (service.status !== 'completed') {
                return res.status(400).json({ success: false, message: "You can only rate completed services" });
            }

            // Must have a provider assigned
            if (!service.providerId) {
                return res.status(400).json({ success: false, message: "No provider assigned to this service" });
            }

            // Check if already rated (unique constraint handles this too)
            const [existing] = await db.select().from(ratings)
                .where(eq(ratings.serviceRequestId, serviceRequestId)).limit(1);

            if (existing) {
                return res.status(400).json({ success: false, message: "You have already rated this service" });
            }

            // Create rating
            const [newRating] = await db.insert(ratings).values({
                serviceRequestId,
                fromUserId: userId,
                toProviderId: service.providerId,
                rating: ratingValue,
                review: review || null,
            }).returning();

            res.status(201).json({
                success: true,
                message: "Rating submitted successfully",
                data: newRating,
            });
        } catch (error: any) {
            if (error.code === '23505') { // Unique constraint violation
                return res.status(400).json({ success: false, message: "You have already rated this service" });
            }
            next(error);
        }
    });

    /**
     * GET /api/ratings/provider/:providerId
     * Get all ratings for a service provider
     */
    app.get("/api/ratings/provider/:providerId", async (req, res, next) => {
        try {
            const providerId = parseInt(req.params.providerId);
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = (page - 1) * limit;

            // Verify provider exists
            const [provider] = await db.select().from(employees)
                .where(eq(employees.id, providerId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            // Get ratings with user info
            const providerRatings = await db
                .select({
                    id: ratings.id,
                    rating: ratings.rating,
                    review: ratings.review,
                    createdAt: ratings.createdAt,
                    customerName: users.username,
                })
                .from(ratings)
                .leftJoin(users, eq(ratings.fromUserId, users.id))
                .where(and(
                    eq(ratings.toProviderId, providerId),
                    eq(ratings.isVisible, true)
                ))
                .orderBy(desc(ratings.createdAt))
                .limit(limit)
                .offset(offset);

            // Get total count
            const [countResult] = await db
                .select({ count: count() })
                .from(ratings)
                .where(and(
                    eq(ratings.toProviderId, providerId),
                    eq(ratings.isVisible, true)
                ));

            const total = Number(countResult?.count || 0);

            res.json({
                success: true,
                data: providerRatings,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/ratings/provider/:providerId/average
     * Get average rating and count for a provider
     */
    app.get("/api/ratings/provider/:providerId/average", async (req, res, next) => {
        try {
            const providerId = parseInt(req.params.providerId);

            const [result] = await db
                .select({
                    averageRating: avg(ratings.rating),
                    totalRatings: count(),
                })
                .from(ratings)
                .where(and(
                    eq(ratings.toProviderId, providerId),
                    eq(ratings.isVisible, true)
                ));

            // Get rating distribution (how many 1-star, 2-star, etc.)
            const distribution = await db
                .select({
                    rating: ratings.rating,
                    count: count(),
                })
                .from(ratings)
                .where(and(
                    eq(ratings.toProviderId, providerId),
                    eq(ratings.isVisible, true)
                ))
                .groupBy(ratings.rating)
                .orderBy(ratings.rating);

            const distMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            distribution.forEach(d => { distMap[d.rating] = Number(d.count); });

            res.json({
                success: true,
                data: {
                    averageRating: result?.averageRating ? parseFloat(String(result.averageRating)).toFixed(1) : "0.0",
                    totalRatings: Number(result?.totalRatings || 0),
                    distribution: distMap,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== PROFILE MANAGEMENT ====================

    /**
     * GET /api/client/profile
     * Get authenticated user's profile
     */
    app.get("/api/client/profile", authenticateAny, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

            // Fetch customer profile to get savedAddresses
            const [customer] = await db.select().from(customers).where(eq(customers.userId, userId)).limit(1);

            if (!user || user.deletedAt) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            // Technicians additionally need at least one declared skill, so the
            // employee row is required to answer "is this account onboarded?".
            let employeeRecord = null;
            if (user.role === 'serviceman') {
                const [emp] = await db.select().from(employees)
                    .where(eq(employees.userId, userId)).limit(1);
                employeeRecord = emp || null;
            }

            const pendingOnboarding = getPendingOnboardingSteps(user, employeeRecord);

            res.json({
                success: true,
                data: {
                    ...user,
                    password: undefined,
                    savedAddresses: customer?.savedAddresses || [],
                    onboardingCompleted: pendingOnboarding.length === 0,
                    pendingOnboardingSteps: pendingOnboarding,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // Alias for backward compatibility with mobile app
    app.get("/api/client/auth/profile", authenticateToken, (req, res) => {
        res.redirect(301, "/api/client/profile");
    });
    app.patch("/api/client/auth/profile", authenticateToken, (req, res) => {
        res.redirect(307, "/api/client/profile");
    });

    /**
     * PATCH /api/client/profile
     * Update user profile (name, email, address, pinCode)
     */
    app.patch("/api/client/profile", authenticateAny, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { username, email, homeAddress, pinCode, savedAddresses } = req.body;

            const updates: any = { updatedAt: new Date() };
            if (username !== undefined) updates.username = username;
            if (email !== undefined) {
                if (email.trim() !== '') {
                    const [existingUser] = await db.select().from(users).where(eq(users.email, email.trim())).limit(1);
                    if (existingUser && existingUser.id !== userId) {
                        return res.status(400).json({ success: false, message: "Email is already registered to another user" });
                    }
                    updates.email = email.trim();
                } else {
                    updates.email = null;
                }
            }
            if (homeAddress !== undefined) updates.homeAddress = homeAddress;
            if (pinCode !== undefined) updates.pinCode = pinCode;

            let updatedUser = null;
            if (Object.keys(updates).length > 1) { // More than just updatedAt
                const [updated] = await db.update(users)
                    .set(updates)
                    .where(eq(users.id, userId))
                    .returning();
                updatedUser = updated;
            } else {
                const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
                updatedUser = user;
            }

            if (savedAddresses !== undefined) {
                // Ensure customer record exists
                const [customer] = await db.select().from(customers).where(eq(customers.userId, userId)).limit(1);
                if (customer) {
                    await db.update(customers).set({ savedAddresses }).where(eq(customers.userId, userId));
                } else {
                    await db.insert(customers).values({ userId, savedAddresses });
                }
            }

            // Sync with employees table if the user is a serviceman
            if (updatedUser?.role === 'serviceman') {
                const employeeUpdates: any = { updatedAt: new Date() };
                if (username !== undefined) employeeUpdates.fullName = username;
                // If they update homeAddress or pinCode, we could update location too, 
                // but at minimum we must keep fullName in sync
                if (Object.keys(employeeUpdates).length > 1) {
                    await db.update(employees)
                        .set(employeeUpdates)
                        .where(eq(employees.userId, userId));
                }
            }

            // Fetch final customer profile for response
            const [finalCustomer] = await db.select().from(customers).where(eq(customers.userId, userId)).limit(1);

            res.json({
                success: true,
                message: "Profile updated",
                data: { 
                    ...updatedUser, 
                    password: undefined,
                    savedAddresses: finalCustomer?.savedAddresses || []
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/client/profile/picture
     * Upload profile picture via multipart/form-data OR JSON { imageUrl }
     * Uploads to Cloudinary and stores the CDN URL.
     */
    const profileUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 5 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
            if (file.mimetype.startsWith('image/')) cb(null, true);
            else cb(new Error('Only image files are allowed'));
        },
    });

    app.post("/api/client/profile/picture", authenticateAny, profileUpload.single('image'), async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            let profilePictureUrl: string;

            if (req.file) {
                // File upload via multipart/form-data
                const result = await uploadImageBuffer(req.file.buffer, 'profile_pictures', {
                    maxWidth: 500,
                    maxHeight: 500,
                });
                profilePictureUrl = result.url;
            } else if (req.body.imageUrl) {
                // Backward-compatible: accept a direct URL
                profilePictureUrl = req.body.imageUrl;
            } else {
                return res.status(400).json({ success: false, message: "Image file or URL is required" });
            }

            const [updated] = await db.update(users)
                .set({ profilePicture: profilePictureUrl, updatedAt: new Date() })
                .where(eq(users.id, userId))
                .returning();

            res.json({
                success: true,
                message: "Profile picture updated",
                data: { profilePicture: updated?.profilePicture },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /api/client/profile/picture
     * Remove profile picture
     */
    app.delete("/api/client/profile/picture", authenticateAny, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;

            await db.update(users)
                .set({ profilePicture: null, updatedAt: new Date() })
                .where(eq(users.id, userId));

            res.json({ success: true, message: "Profile picture removed" });
        } catch (error) {
            next(error);
        }
    });

    // ==================== ACCOUNT DELETION ====================

    /**
     * DELETE /api/client/account
     * Soft delete account (30-day recovery window)
     *
     * - Password users: must send { password: "..." } in body
     * - Truecaller-only users: must send { confirmDelete: true } (phone already verified via TC)
     */
    app.delete("/api/client/account", authenticateAny, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { password, confirmDelete } = req.body;

            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            if (user.password) {
                // Password-based account: require password confirmation
                if (!password) {
                    return res.status(400).json({ success: false, message: "Password required to delete account" });
                }
                const bcrypt = await import('bcrypt');
                const valid = await bcrypt.compare(password, user.password);
                if (!valid) {
                    return res.status(401).json({ success: false, message: "Incorrect password" });
                }
            } else {
                // Truecaller-only account: require explicit confirmation flag
                // (Phone identity was verified by Truecaller at login — no password exists)
                if (!confirmDelete) {
                    return res.status(400).json({
                        success: false,
                        message: "Please confirm deletion by sending { confirmDelete: true }",
                    });
                }
            }

            // Soft delete — set deletedAt, deactivate
            await db.update(users)
                .set({
                    isActive: false,
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(users.id, userId));

            res.json({
                success: true,
                message: "Account scheduled for deletion. You have 30 days to recover it by logging in.",
            });
        } catch (error) {
            next(error);
        }
    });


    // ==================== WALLET V2 APIs (Partner) ====================

    /**
     * GET /api/partner/wallet/balance
     * Get partner's wallet balance (hold + available)
     */
    app.get("/api/partner/wallet/balance", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;

            // Find the provider record
            const [provider] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            // Get or create wallet
            let [wallet] = await db.select().from(partnerWallets)
                .where(eq(partnerWallets.partnerId, provider.id)).limit(1);

            if (!wallet) {
                // Auto-create wallet
                [wallet] = await db.insert(partnerWallets).values({
                    partnerId: provider.id,
                }).returning();
            }

            res.json({
                success: true,
                data: {
                    partnerId: provider.partnerId,
                    partnerName: provider.fullName,
                    balanceHold: wallet.balanceHold,
                    balanceAvailable: wallet.balanceAvailable,
                    totalEarned: wallet.totalEarned,
                    completedJobs: provider.totalServicesCompleted,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/partner/wallet/transactions
     * Get partner's transaction history
     */
    app.get("/api/partner/wallet/transactions", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = (page - 1) * limit;
            const type = req.query.type as string; // Optional filter

            const [provider] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            const conditions: any[] = [eq(walletTransactionsV2.partnerId, provider.id)];
            if (type) conditions.push(eq(walletTransactionsV2.transactionType, type as any));

            const transactions = await db
                .select()
                .from(walletTransactionsV2)
                .where(and(...conditions))
                .orderBy(desc(walletTransactionsV2.createdAt))
                .limit(limit)
                .offset(offset);

            const [countResult] = await db
                .select({ count: count() })
                .from(walletTransactionsV2)
                .where(and(...conditions));

            const total = Number(countResult?.count || 0);

            res.json({
                success: true,
                data: transactions,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/partner/wallet/withdraw
     * Request withdrawal from available balance
     */
    app.post("/api/partner/wallet/withdraw", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { amount, method } = req.body; // method: 'bank' or 'upi'

            if (!amount || amount <= 0) {
                return res.status(400).json({ success: false, message: "Valid amount required" });
            }

            if (!method || !['bank', 'upi'].includes(method)) {
                return res.status(400).json({ success: false, message: "Method must be 'bank' or 'upi'" });
            }

            const [provider] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            if (!provider.upiId || !provider.razorpayFundAccountId) {
                return res.status(400).json({ 
                    success: false, 
                    message: "UPI ID not found. Please update your Payout Details in your Profile before withdrawing." 
                });
            }

            // Get wallet
            const [wallet] = await db.select().from(partnerWallets)
                .where(eq(partnerWallets.partnerId, provider.id)).limit(1);

            if (!wallet) {
                return res.status(400).json({ success: false, message: "Wallet not found" });
            }

            const available = parseFloat(wallet.balanceAvailable);
            // Admin-configurable via BUSINESS_CONFIG.MIN_WALLET_REDEMPTION (Settings page).
            // Falls back to 500 only if the config row is missing.
            const minRedemption = Number(
                await configService.get('BUSINESS_CONFIG.MIN_WALLET_REDEMPTION', 500)
            );

            if (amount > available) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient balance. Available: ₹${available}`,
                });
            }

            if (amount < minRedemption) {
                return res.status(400).json({
                    success: false,
                    message: `Minimum withdrawal is ₹${minRedemption}`,
                });
            }

            const transactionType = method === 'bank' ? 'withdraw_bank' : 'withdraw_upi';
            const newAvailable = available - amount;

            // All three writes in one transaction. Previously they ran separately,
            // so a failure between them could debit the wallet with no withdrawal
            // request recorded (partner loses the money with nothing to approve),
            // or create a request against an undebited balance (partner can spend
            // the same funds twice).
            //
            // The balance is re-checked inside the transaction against the live row
            // so two concurrent requests cannot both pass the earlier check and
            // overdraw the wallet.
            const transaction = await db.transaction(async (tx) => {
                const [currentWallet] = await tx.select().from(partnerWallets)
                    .where(eq(partnerWallets.partnerId, provider.id)).limit(1);

                const liveAvailable = parseFloat(currentWallet?.balanceAvailable ?? '0');
                if (amount > liveAvailable) {
                    throw new Error(`Insufficient balance. Available: ₹${liveAvailable}`);
                }
                const liveNewAvailable = liveAvailable - amount;

                const [txn] = await tx.insert(walletTransactionsV2).values({
                    transactionId: `WDRW-${provider.id}-${Date.now()}`,
                    partnerId: provider.id,
                    transactionType: transactionType as any,
                    amount: amount.toFixed(2),
                    balanceAvailableBefore: currentWallet.balanceAvailable,
                    balanceAvailableAfter: liveNewAvailable.toFixed(2),
                    balanceHoldBefore: currentWallet.balanceHold,
                    balanceHoldAfter: currentWallet.balanceHold,
                    description: `Withdrawal Request via ${method.toUpperCase()}`,
                    metadata: { method, requestedAt: new Date().toISOString() },
                }).returning();

                await tx.insert(withdrawalRequests).values({
                    partnerId: provider.id,
                    amount: amount.toFixed(2),
                    method,
                    status: 'pending',
                    walletTransactionId: txn.id,
                });

                await tx.update(partnerWallets)
                    .set({
                        balanceAvailable: liveNewAvailable.toFixed(2),
                        updatedAt: new Date(),
                    })
                    .where(eq(partnerWallets.partnerId, provider.id));

                return txn;
            });

            res.json({
                success: true,
                message: `Withdrawal request of ₹${amount} submitted for approval.`,
                data: transaction,
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== INVOICE APIs ====================

    /**
     * GET /api/client/invoices
     * Get all invoices for the authenticated user
     */
    app.get("/api/client/invoices", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;

            // Safety net: an invoice should be created the moment a booking completes,
            // but if a completion path missed it — or the booking completed before
            // invoicing was wired up — the app's "Download Invoice" would say "not
            // ready" forever. Backfill any completed, billed booking of this user that
            // has no invoice yet. generateInvoice is idempotent and each call is
            // guarded, so a single failure can't break the listing.
            const missing = await db.select({
                    id: serviceRequests.id,
                    providerId: serviceRequests.providerId,
                })
                .from(serviceRequests)
                .leftJoin(invoices, eq(invoices.serviceRequestId, serviceRequests.id))
                .where(and(
                    eq(serviceRequests.userId, userId),
                    eq(serviceRequests.status, 'completed'),
                    isNotNull(serviceRequests.totalAmount),
                    isNull(invoices.id),
                ));

            for (const sr of missing) {
                try {
                    await PaymentService.generateInvoice(sr.id, userId, sr.providerId as number);
                    logger.info(`[INVOICE] Backfilled missing invoice for completed booking ${sr.id}`);
                } catch (e: any) {
                    logger.warn(`[INVOICE] Backfill skipped for booking ${sr.id}: ${e.message}`);
                }
            }

            const userInvoices = await db.select()
                .from(invoices)
                .where(eq(invoices.userId, userId))
                .orderBy(desc(invoices.createdAt));

            res.json({ success: true, data: userInvoices });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/client/invoices/:invoiceId
     * Get specific invoice details
     */
    app.get("/api/client/invoices/:invoiceId", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const invoiceIdStr = req.params.invoiceId;

            const [invoice] = await db.select()
                .from(invoices)
                .where(and(
                    eq(invoices.invoiceId, invoiceIdStr),
                    eq(invoices.userId, userId)
                ))
                .limit(1);

            if (!invoice) {
                return res.status(404).json({ success: false, message: "Invoice not found" });
            }

            res.json({ success: true, data: invoice });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/client/invoices/:invoiceId/download
     * Download invoice as PDF
     */
    /**
     * POST /api/client/invoices/:invoiceId/download-link
     *
     * Returns a short-lived URL for the invoice PDF.
     *
     * The mobile app opens the PDF with the OS handler via Linking, and a browser
     * cannot send the Authorization header. Rather than pulling expo-file-system
     * and expo-sharing in as native dependencies (a prebuild for a once-per-job
     * action), issue a 5-minute token scoped to this single invoice and this
     * single user. Same pattern as the existing password-reset token.
     */
    app.post("/api/client/invoices/:invoiceId/download-link", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const invoiceIdStr = req.params.invoiceId;

            const [invoice] = await db.select()
                .from(invoices)
                .where(and(
                    eq(invoices.invoiceId, invoiceIdStr),
                    eq(invoices.userId, userId),
                ))
                .limit(1);

            if (!invoice) {
                return res.status(404).json({ success: false, message: "Invoice not found" });
            }

            const token = jwt.sign(
                { invoiceId: invoiceIdStr, userId, purpose: 'invoice_download' },
                process.env.JWT_SECRET as string,
                { expiresIn: '5m' },
            );

            const base = process.env.PUBLIC_BASE_URL
                || `${req.protocol}://${req.get('host')}`;

            res.json({
                success: true,
                data: {
                    url: `${base}/api/client/invoices/${encodeURIComponent(invoiceIdStr)}/download?token=${token}`,
                    expiresInSeconds: 300,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    app.get("/api/client/invoices/:invoiceId/download", async (req: Request, res, next) => {
        try {
            const invoiceIdStr = req.params.invoiceId;

            // Accept either a normal Bearer session or a short-lived download
            // token, so the same URL works from the app and from a browser.
            let userId: number | null = null;

            const queryToken = req.query.token as string | undefined;
            if (queryToken) {
                try {
                    const decoded: any = jwt.verify(queryToken, process.env.JWT_SECRET as string);
                    if (decoded.purpose !== 'invoice_download' || decoded.invoiceId !== invoiceIdStr) {
                        return res.status(403).json({ success: false, message: "Invalid download token" });
                    }
                    userId = decoded.userId;
                } catch {
                    return res.status(403).json({ success: false, message: "Download link has expired. Please try again." });
                }
            } else {
                const authHeader = req.headers['authorization'];
                const bearer = authHeader && authHeader.split(' ')[1];
                if (!bearer) {
                    return res.status(401).json({ success: false, message: "Access token required" });
                }
                try {
                    const decoded: any = jwt.verify(bearer, process.env.JWT_SECRET as string);
                    userId = decoded.userId;
                } catch {
                    return res.status(403).json({ success: false, message: "Invalid or expired token" });
                }
            }

            if (!userId) {
                return res.status(401).json({ success: false, message: "Access token required" });
            }

            const [invoice] = await db.select()
                .from(invoices)
                .where(and(
                    eq(invoices.invoiceId, invoiceIdStr),
                    eq(invoices.userId, userId)
                ))
                .limit(1);

            if (!invoice) {
                return res.status(404).json({ success: false, message: "Invoice not found" });
            }

            const pdfBuffer = await InvoiceGenerator.generatePDF(invoice.id);

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=${invoiceIdStr}.pdf`);
            res.send(pdfBuffer);
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/partner/services/:serviceId/invoice/download-link
     *
     * Same short-lived-URL pattern as the customer route above, but for the
     * technician who did the job. The partner app's invoice screen used to
     * open /api/invoices/:id/download — an endpoint that has never existed —
     * so its download button always landed on a 404 page.
     *
     * The token is minted with the CUSTOMER's userId because the shared
     * download GET checks ownership against invoices.userId; the partner's
     * right to the file is enforced here instead (they must be the provider
     * assigned to this booking).
     */
    app.post("/api/partner/services/:serviceId/invoice/download-link", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const partnerUserId = (req as any).user!.userId;
            const serviceId = parseInt(req.params.serviceId);
            if (isNaN(serviceId)) {
                return res.status(400).json({ success: false, message: "Invalid service id" });
            }

            const [employee] = await db.select().from(employees)
                .where(eq(employees.userId, partnerUserId)).limit(1);
            if (!employee) {
                return res.status(404).json({ success: false, message: "Partner profile not found" });
            }

            const [sr] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, serviceId)).limit(1);
            if (!sr) {
                return res.status(404).json({ success: false, message: "Service request not found" });
            }
            if (sr.providerId !== employee.id) {
                return res.status(403).json({ success: false, message: "This booking is not assigned to you" });
            }
            if (!sr.totalAmount) {
                return res.status(400).json({
                    success: false,
                    message: "No invoice yet — billing for this booking has not been completed.",
                });
            }

            // Idempotent: reuses the existing invoice row when one exists.
            const { invoiceId } = await PaymentService.generateInvoice(
                serviceId,
                sr.userId,
                sr.providerId as number,
            );

            const token = jwt.sign(
                { invoiceId, userId: sr.userId, purpose: 'invoice_download' },
                process.env.JWT_SECRET as string,
                { expiresIn: '5m' },
            );

            const base = process.env.PUBLIC_BASE_URL
                || `${req.protocol}://${req.get('host')}`;

            res.json({
                success: true,
                data: {
                    url: `${base}/api/client/invoices/${encodeURIComponent(invoiceId)}/download?token=${token}`,
                    expiresInSeconds: 300,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== SUPPORT TICKETS (Customer) ====================

    /**
     * POST /api/client/tickets
     * Create a support ticket
     */
    app.post("/api/client/tickets", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { subject, description, category, serviceRequestId, productOrderId } = req.body;

            if (!subject || !description) {
                return res.status(400).json({ success: false, message: "Subject and description are required" });
            }

            const ticket = await SupportTicketService.createTicket({
                userId,
                subject,
                description,
                category: category || 'general',
                serviceRequestId,
                productOrderId,
            });

            res.status(201).json({ success: true, message: "Ticket created", data: ticket });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/client/tickets
     * Get customer's support tickets
     */
    app.get("/api/client/tickets", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const tickets = await SupportTicketService.getUserTickets(userId);
            res.json({ success: true, data: tickets });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/client/tickets/:ticketId
     * Get ticket details with messages
     */
    app.get("/api/client/tickets/:ticketId", authenticateToken, async (req: Request, res, next) => {
        try {
            const ticketId = req.params.ticketId;
            const result = await SupportTicketService.getTicketDetails(ticketId);

            // Verify ticket belongs to this user
            if (result.ticket.userId !== (req as any).user!.userId) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }

            // Internal admin notes are staff-only — stripped here rather than in
            // the app, so a future client can never leak them by rendering the
            // raw thread.
            const visible = (result.messages ?? []).filter((m: any) => !m.isInternal);

            res.json({
                success: true,
                data: {
                    ...result.ticket,
                    messages: visible,
                    ticket: { ...result.ticket, messages: visible },
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/client/tickets/:ticketId/reply
     * Customer replies to their ticket
     */
    app.post("/api/client/tickets/:ticketId/reply", authenticateToken, async (req: Request, res, next) => {
        try {
            const ticketId = req.params.ticketId;
            const { message } = req.body;

            if (!message) {
                return res.status(400).json({ success: false, message: "Message is required" });
            }

            // Ownership was never checked here, so any signed-in user could post
            // into any ticket just by changing the id in the URL.
            const existing = await SupportTicketService.getTicketDetails(ticketId);
            if (existing.ticket.userId !== (req as any).user!.userId) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }

            const msg = await SupportTicketService.addMessage(
                ticketId, message, 'customer', (req as any).user!.userId
            );

            res.json({ success: true, data: msg });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/client/tickets/:ticketId/escalate
     * Customer escalates their ticket
     */
    app.post("/api/client/tickets/:ticketId/escalate", authenticateToken, async (req: Request, res, next) => {
        try {
            const ticketId = req.params.ticketId;
            const result = await SupportTicketService.getTicketDetails(ticketId);

            // Verify ticket belongs to this user
            if (result.ticket.userId !== (req as any).user!.userId) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }

            const updatedTicket = await SupportTicketService.updateTicketStatus(ticketId, 'escalated');

            res.json({ success: true, message: "Ticket escalated successfully", data: updatedTicket });
        } catch (error) {
            next(error);
        }
    });

    // ==================== PARTNER EARNINGS SUMMARY ====================

    /**
     * GET /api/partner/earnings/summary
     * Get partner's earnings summary (today, this week, this month, total)
     */
    app.get("/api/partner/earnings/summary", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;

            const [provider] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            // Get completed services count and earnings for different periods
            const [todayStats] = await db
                .select({
                    count: count(),
                    earnings: sql<string>`COALESCE(SUM(${serviceRequests.totalAmount}), 0)`,
                })
                .from(serviceRequests)
                .where(and(
                    eq(serviceRequests.providerId, provider.id),
                    eq(serviceRequests.status, 'completed'),
                    sql`${serviceRequests.completedAt} >= ${startOfDay}`
                ));

            const [weekStats] = await db
                .select({
                    count: count(),
                    earnings: sql<string>`COALESCE(SUM(${serviceRequests.totalAmount}), 0)`,
                })
                .from(serviceRequests)
                .where(and(
                    eq(serviceRequests.providerId, provider.id),
                    eq(serviceRequests.status, 'completed'),
                    sql`${serviceRequests.completedAt} >= ${startOfWeek}`
                ));

            const [monthStats] = await db
                .select({
                    count: count(),
                    earnings: sql<string>`COALESCE(SUM(${serviceRequests.totalAmount}), 0)`,
                })
                .from(serviceRequests)
                .where(and(
                    eq(serviceRequests.providerId, provider.id),
                    eq(serviceRequests.status, 'completed'),
                    sql`${serviceRequests.completedAt} >= ${startOfMonth}`
                ));

            const [totalStats] = await db
                .select({
                    count: count(),
                    earnings: sql<string>`COALESCE(SUM(${serviceRequests.totalAmount}), 0)`,
                })
                .from(serviceRequests)
                .where(and(
                    eq(serviceRequests.providerId, provider.id),
                    eq(serviceRequests.status, 'completed'),
                ));

            // Get average rating
            const [ratingResult] = await db
                .select({ avg: avg(ratings.rating), count: count() })
                .from(ratings)
                .where(eq(ratings.toProviderId, provider.id));

            res.json({
                success: true,
                data: {
                    today: { services: Number(todayStats?.count || 0), earnings: todayStats?.earnings || "0" },
                    thisWeek: { services: Number(weekStats?.count || 0), earnings: weekStats?.earnings || "0" },
                    thisMonth: { services: Number(monthStats?.count || 0), earnings: monthStats?.earnings || "0" },
                    total: { services: Number(totalStats?.count || 0), earnings: totalStats?.earnings || "0" },
                    rating: {
                        average: ratingResult?.avg ? parseFloat(String(ratingResult.avg)).toFixed(1) : "0.0",
                        count: Number(ratingResult?.count || 0),
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== PHASE 3: VERIFICATION GATE ====================

    /**
     * GET /api/partner/verification-status
     * Returns employee's current verification + online status.
     * Used by EmployeePendingScreen pull-to-refresh (Task 3.5).
     */
    app.get("/api/partner/verification-status", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;

            const [employee] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!employee) {
                return res.status(404).json({ success: false, message: "Employee record not found" });
            }

            res.json({
                success: true,
                data: {
                    employeeId: employee.id,
                    documentVerificationStatus: employee.documentVerificationStatus,
                    isActive: employee.isActive,
                    isOnline: employee.isOnline,
                    partnerId: employee.partnerId,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/partner/availability
     * Toggle employee online/offline status (Task 3.4).
     * Only verified employees can go online.
     */
    app.patch("/api/partner/availability", authenticateServiceman, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { isOnline } = req.body;

            if (typeof isOnline !== 'boolean') {
                return res.status(400).json({ success: false, message: "isOnline must be a boolean" });
            }

            const [employee] = await db.select().from(employees)
                .where(eq(employees.userId, userId)).limit(1);

            if (!employee) {
                return res.status(404).json({ success: false, message: "Employee record not found" });
            }

            // Only verified employees can go online
            if (isOnline && employee.documentVerificationStatus !== 'verified') {
                return res.status(403).json({
                    success: false,
                    message: "You must be verified before going online",
                });
            }

            /**
             * A base location is required to go ONLINE, never to go offline.
             *
             * Checked inline rather than with requireCompleteProfile, because
             * that middleware would gate the whole endpoint — trapping an expert
             * with an incomplete profile in the online state with no way to
             * switch off. Going offline must always be possible.
             *
             * Without a base location an expert cannot be matched to anything:
             * dispatch is decided by pin code, so they would sit "online" and
             * available while never receiving a single job.
             */
            if (isOnline) {
                const [account] = await db
                    .select({ homeAddress: users.homeAddress, pinCode: users.pinCode })
                    .from(users)
                    .where(eq(users.id, userId))
                    .limit(1);

                const missingAddress = !account?.homeAddress || !String(account.homeAddress).trim();
                const missingPinCode = !account?.pinCode || !String(account.pinCode).trim();

                if (missingAddress || missingPinCode) {
                    const missing = [
                        missingAddress ? "address (base location)" : null,
                        missingPinCode ? "pin code" : null,
                    ].filter(Boolean).join(" and ");

                    return res.status(422).json({
                        success: false,
                        code: "PROFILE_INCOMPLETE",
                        message: `Add your ${missing} before going online — jobs are matched to your base location, so you would not receive any.`,
                        missing: { address: missingAddress, pinCode: missingPinCode },
                    });
                }
            }

            const [updated] = await db.update(employees)
                .set({ isOnline, updatedAt: new Date() })
                .where(eq(employees.id, employee.id))
                .returning();

            res.json({
                success: true,
                message: isOnline ? "You are now online and available for assignments" : "You are now offline",
                data: { isOnline: updated.isOnline },
            });
        } catch (error) {
            next(error);
        }
    });
}
