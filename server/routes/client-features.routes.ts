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
import { db } from "../db";
import { eq, and, desc, sql, avg, count } from "drizzle-orm";
import {
    ratings, serviceRequests, serviceProviders, users,
    partnerWallets, walletTransactionsV2, invoices,
    supportTickets, ticketMessages,
} from "@shared/schema";
import { authenticateToken, authenticatePartner } from "../middleware/auth.middleware";
import { SupportTicketService } from "../services/support.service";
import { InvoiceGenerator } from "../services/invoice-generator";

// Auth middleware aliases — import from canonical auth.middleware.ts
// authenticateToken protects customer routes
// authenticatePartner (aliased as authenticateServiceman) protects partner routes
const authenticateServiceman = authenticatePartner;

// Request type with user info from auth middleware
interface AuthenticatedRequest extends Request {
    user?: { userId: number; role: string };
}

export function registerClientFeatureRoutes(app: Express) {

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
            const [provider] = await db.select().from(serviceProviders)
                .where(eq(serviceProviders.id, providerId)).limit(1);

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
    app.get("/api/client/profile", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

            if (!user || user.deletedAt) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            res.json({
                success: true,
                data: { ...user, password: undefined },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/client/profile
     * Update user profile (name, email, address, pinCode)
     */
    app.patch("/api/client/profile", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { username, email, homeAddress, pinCode } = req.body;

            const updates: any = { updatedAt: new Date() };
            if (username !== undefined) updates.username = username;
            if (email !== undefined) updates.email = email;
            if (homeAddress !== undefined) updates.homeAddress = homeAddress;
            if (pinCode !== undefined) updates.pinCode = pinCode;

            const [updated] = await db.update(users)
                .set(updates)
                .where(eq(users.id, userId))
                .returning();

            res.json({
                success: true,
                message: "Profile updated",
                data: { ...updated, password: undefined },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/client/profile/picture
     * Upload profile picture (accepts base64 or URL)
     * In production, this would integrate with S3/Cloudinary
     */
    app.post("/api/client/profile/picture", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { imageUrl } = req.body;

            if (!imageUrl) {
                return res.status(400).json({ success: false, message: "Image URL is required" });
            }

            // TODO: In production, upload base64/file to S3/Cloudinary and get CDN URL
            // For now, accepts a direct URL
            const [updated] = await db.update(users)
                .set({ profilePicture: imageUrl, updatedAt: new Date() })
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
    app.delete("/api/client/profile/picture", authenticateToken, async (req: Request, res, next) => {
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
     */
    app.delete("/api/client/account", authenticateToken, async (req: Request, res, next) => {
        try {
            const userId = (req as any).user!.userId;
            const { password } = req.body;

            if (!password) {
                return res.status(400).json({ success: false, message: "Password required to delete account" });
            }

            // Verify password
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
            if (!user) return res.status(404).json({ success: false, message: "User not found" });

            const bcrypt = await import('bcrypt');
            const valid = await bcrypt.compare(password, user.password);
            if (!valid) {
                return res.status(401).json({ success: false, message: "Incorrect password" });
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
            const [provider] = await db.select().from(serviceProviders)
                .where(eq(serviceProviders.userId, userId)).limit(1);

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
                    partnerName: provider.partnerName,
                    balanceHold: wallet.balanceHold,
                    balanceAvailable: wallet.balanceAvailable,
                    totalEarned: wallet.totalEarned,
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

            const [provider] = await db.select().from(serviceProviders)
                .where(eq(serviceProviders.userId, userId)).limit(1);

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

            const [provider] = await db.select().from(serviceProviders)
                .where(eq(serviceProviders.userId, userId)).limit(1);

            if (!provider) {
                return res.status(404).json({ success: false, message: "Provider not found" });
            }

            // Get wallet
            const [wallet] = await db.select().from(partnerWallets)
                .where(eq(partnerWallets.partnerId, provider.id)).limit(1);

            if (!wallet) {
                return res.status(400).json({ success: false, message: "Wallet not found" });
            }

            const available = parseFloat(wallet.balanceAvailable);
            const minRedemption = 500; // From platform config

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

            // Create withdrawal transaction
            const [transaction] = await db.insert(walletTransactionsV2).values({
                transactionId: `WDRW-${provider.id}-${Date.now()}`,
                partnerId: provider.id,
                transactionType: transactionType as any,
                amount: amount.toFixed(2),
                balanceAvailableBefore: wallet.balanceAvailable,
                balanceAvailableAfter: newAvailable.toFixed(2),
                balanceHoldBefore: wallet.balanceHold,
                balanceHoldAfter: wallet.balanceHold,
                description: `Withdrawal via ${method.toUpperCase()}`,
                metadata: { method, requestedAt: new Date().toISOString() },
            }).returning();

            // Update wallet
            await db.update(partnerWallets)
                .set({
                    balanceAvailable: newAvailable.toFixed(2),
                    updatedAt: new Date(),
                })
                .where(eq(partnerWallets.partnerId, provider.id));

            res.json({
                success: true,
                message: `Withdrawal of ₹${amount} via ${method.toUpperCase()} initiated`,
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
    app.get("/api/client/invoices/:invoiceId/download", authenticateToken, async (req: Request, res, next) => {
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

            const pdfBuffer = await InvoiceGenerator.generatePDF(invoice.id);

            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename=${invoiceIdStr}.pdf`);
            res.send(pdfBuffer);
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

            res.json({ success: true, data: result });
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

            const msg = await SupportTicketService.addMessage(
                ticketId, message, 'customer', (req as any).user!.userId
            );

            res.json({ success: true, data: msg });
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

            const [provider] = await db.select().from(serviceProviders)
                .where(eq(serviceProviders.userId, userId)).limit(1);

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
}
