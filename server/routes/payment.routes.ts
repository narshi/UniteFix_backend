/**
 * PHASE 5: Payment & Billing API Routes
 * Technician: Enter service charge
 * Customer: Create final payment order
 * System: Razorpay webhook
 */

import type { Express, Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { db } from "../db";
import { sql, eq, and, desc, isNotNull } from "drizzle-orm";
import crypto from "crypto";
import { authenticateToken, authenticatePartner , requireVerifiedPartner} from "../middleware/auth.middleware";
import { mobileLimiter } from "../middleware/rate-limit";
import { storage } from "../storage";
import { BillingEngine } from "../services/billing-engine";
import { PaymentTrackingService } from "../services/payment-tracking.service";
import { BookingState } from "../business/booking-state-machine";
import { BookingNotifications } from "../services/booking-notifications";
import logger from "../lib/logger";
import { configService } from "../services/config.service";
import { 
    paymentTransactions,
    invoices,
    serviceRequests,
    services,
    users,
    withdrawalRequests,
    partnerWallets,
    walletTransactionsV2,
    employees
} from "@shared/schema";

export function registerPaymentRoutes(app: Express) {
    /**
     * POST /api/services/create-with-payment
     * Create service and booking order with frozen pricing snapshot
     */
    app.post("/api/services/create-with-payment", mobileLimiter, authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { serviceType, description, address, pincode, serviceId } = req.body;
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!serviceType || !description || !address) {
                return res.status(400).json({ error: "serviceType, description, and address are required" });
            }

            // FIXED-PRICE CATALOG (v2): if the client sent a catalog serviceId whose
            // base price is set, freeze the whole bill now — the price is known up
            // front, so there is no later bill-submission step. Falls back to the v1
            // (technician-billed) snapshot when no priced catalog service is given,
            // so old app builds keep working unchanged.
            // See routes.ts: clamped, not trusted.
            const quantity = Math.max(1, Math.min(50, Math.floor(Number(req.body?.quantity)) || 1));

            let pricingSnapshot = await BillingEngine.createBookingSnapshot();
            let catalogTotal: number | null = null;
            let catalogCommission: number | null = null;

            if (serviceId) {
                const [svc] = await db.select({ basePrice: services.basePrice })
                    .from(services).where(eq(services.id, Number(serviceId))).limit(1);
                if (svc && svc.basePrice > 0) {
                    pricingSnapshot = await BillingEngine.createCatalogSnapshotForQuantity(svc.basePrice, quantity);
                    catalogTotal = pricingSnapshot.grossTotal ?? svc.basePrice;
                    catalogCommission = Math.round(pricingSnapshot.platformFee ?? 0);
                }
            }

            // Create service request via storage layer with frozen booking fee
            const serviceRequest = await storage.createServiceRequest({
                userId: customerId,
                serviceType,
                description,
                address,
                status: 'created',
                bookingFee: pricingSnapshot.bookingFee,
                bookingFeeStatus: pricingSnapshot.bookingFee === 0 ? 'paid' : 'pending',
            });

            // Write the frozen snapshot to the service_requests row. For a catalog
            // booking the total and commission are known now, so freeze them too.
            await db.update(serviceRequests)
                .set({
                    pricingSnapshot: pricingSnapshot as any,
                    ...(catalogTotal !== null ? { totalAmount: catalogTotal } : {}),
                    ...(catalogCommission !== null ? { commissionAmount: catalogCommission } : {}),
                })
                .where(eq(serviceRequests.id, serviceRequest.id));

            // Create Razorpay order for booking charge
            const order = await PaymentService.createBookingOrder(serviceRequest.id, customerId);

            res.json({
                message: "Service created. Please complete booking payment.",
                serviceRequestId: serviceRequest.id,
                serviceId: serviceRequest.serviceId,
                razorpayOrder: order,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/customer/services/:id/create-booking-payment
     * Customer retries booking payment.
     */
    app.post("/api/customer/services/:id/create-booking-payment", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const [booking] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, serviceId)).limit(1);

            if (!booking) {
                return res.status(404).json({ error: "Booking not found" });
            }
            if (booking.bookingFeeStatus === 'paid') {
                return res.status(400).json({ error: "Booking fee already paid" });
            }

            const order = await PaymentService.createBookingOrder(booking.id, customerId);

            res.json({
                message: "Booking payment order created",
                razorpayOrder: order,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/customer/services/:id/create-final-payment
     * Customer creates final payment order after bill has been submitted.
     * Reads the FROZEN pricing_snapshot to verify bill exists and get the correct amount.
     */
    app.post("/api/customer/services/:id/create-final-payment", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // Read the frozen snapshot from the booking to verify bill has been submitted
            const [booking] = await db.select({
                totalAmount: serviceRequests.totalAmount,
                pricingSnapshot: serviceRequests.pricingSnapshot,
                status: serviceRequests.status,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceId))
            .limit(1);

            if (!booking) {
                return res.status(404).json({ error: "Booking not found" });
            }

            const snapshot = booking.pricingSnapshot as any;

            // If snapshot has billing data, use the frozen finalTotal directly
            if (snapshot && snapshot.finalTotal !== undefined && snapshot.subtotal) {
                // Update paymentMethod to 'online' to lock the cash button on the partner app side
                await db.update(serviceRequests)
                    .set({ paymentMethod: 'online' })
                    .where(eq(serviceRequests.id, serviceId));

                // createFinalPaymentOrder internally calls calculateInvoice which
                // now reads the snapshot first — pass subtotal as serviceCharge for compatibility
                const result = await PaymentService.createFinalPaymentOrder(
                    serviceId, 
                    snapshot.subtotal // This is parts + labor from the snapshot
                );

                return res.json({
                    message: "Final payment order created",
                    razorpayOrder: {
                        orderId: result.orderId,
                        amount: result.amount,
                        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
                    },
                    invoice: result.invoice,
                });
            }

            // Legacy fallback: read from service_charges table
            const serviceChargeResult = await db.execute(sql`
                SELECT service_amount FROM service_charges 
                WHERE service_request_id = ${serviceId}
            `) as any;
            const scRows = Array.isArray(serviceChargeResult) ? serviceChargeResult : (serviceChargeResult?.rows || []);
            const serviceCharge = scRows?.[0];

            if (!serviceCharge) {
                return res.status(400).json({
                    error: "Bill not submitted yet. Employee must submit the bill first."
                });
            }

            const amount = parseFloat(serviceCharge.service_amount);
            const result = await PaymentService.createFinalPaymentOrder(serviceId, amount);

            res.json({
                message: "Final payment order created",
                razorpayOrder: {
                    orderId: result.orderId,
                    amount: result.amount,
                    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
                },
                invoice: result.invoice,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/customer/services/:id/cancel-final-payment
     * Customer cancels the Razorpay payment modal, unlock cash payment
     */
    app.post("/api/customer/services/:id/cancel-final-payment", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const customerId = (req as any).user?.userId;

            if (!customerId) return res.status(401).json({ error: "Unauthorized" });

            await db.update(serviceRequests)
                .set({ paymentMethod: 'pending' })
                .where(eq(serviceRequests.id, serviceId));

            res.json({ success: true, message: "Payment method reverted to pending" });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/partner/services/:id/generate-qr
     * Partner generates a dynamic Razorpay QR for customer to scan
     */
    app.post("/api/partner/services/:id/generate-qr", authenticatePartner as any, requireVerifiedPartner as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const partnerId = (req as any).partner?.partnerId;

            const [booking] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, serviceId)).limit(1);
            if (!booking) return res.status(404).json({ error: "Booking not found" });

            if (!partnerId) {
                // Try fetching it if it wasn't populated
                const userId = (req as any).user?.userId;
                if (!userId) return res.status(401).json({ error: "Unauthorized" });
                const [provider] = await db.select().from(employees).where(eq(employees.userId, userId)).limit(1);
                if (!provider) return res.status(403).json({ error: "Provider not found" });
                
                if (booking.providerId !== provider.id) return res.status(403).json({ error: "Not assigned to this booking" });
            } else {
                if (booking.providerId !== partnerId) return res.status(403).json({ error: "Not assigned to this booking" });
            }

            const snapshot = booking.pricingSnapshot as any;
            let finalAmount = 0;
            if (snapshot && snapshot.finalTotal !== undefined) {
                finalAmount = snapshot.finalTotal;
            } else if (booking.totalAmount !== null) {
                // totalAmount is an integer column — already a number, not a string.
                finalAmount = booking.totalAmount;
            } else {
                return res.status(400).json({ error: "Bill not submitted yet." });
            }
            
            if (finalAmount <= 0) {
                return res.status(400).json({ error: "Amount must be greater than 0" });
            }

            // Generate Razorpay QR Code
            const { imageUrl, qrCodeId } = await PaymentService.createDynamicQRCode(serviceId, finalAmount);

            // qrCodeId lets the app poll qr-status below, so collection does not
            // depend on the webhook arriving.
            res.json({ success: true, data: { qrImageUrl: imageUrl, qrCodeId } });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * GET /api/partner/services/:id/qr-status
     *
     * Authoritative check on whether a dynamic QR has been paid, asked directly
     * of Razorpay. A scanned QR is paid from the customer's own UPI app, so no
     * client receives a payment id the way card/in-app UPI does — without this
     * the booking can only be completed by the webhook, and stays stuck in
     * pending_payment whenever webhook delivery fails.
     *
     * Settles the booking when payment is confirmed, using the same idempotent
     * path as the webhook.
     */
    app.get("/api/partner/services/:id/qr-status", authenticatePartner as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            if (Number.isNaN(serviceId)) {
                return res.status(400).json({ success: false, message: "Invalid service id" });
            }

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, serviceId)).limit(1);
            if (!booking) {
                return res.status(404).json({ success: false, message: "Booking not found" });
            }

            const partnerId = (req as any).partner?.partnerId;
            if (booking.providerId !== partnerId) {
                return res.status(403).json({ success: false, message: "Not assigned to this booking" });
            }

            // Already done (webhook may have won the race).
            if (booking.status === BookingState.COMPLETED) {
                return res.json({ success: true, data: { paid: true, status: booking.status } });
            }

            // Most recent QR issued for this booking.
            const [qrTxn] = await db.select().from(paymentTransactions)
                .where(and(
                    eq(paymentTransactions.serviceRequestId, serviceId),
                    sql`${paymentTransactions.razorpayOrderId} LIKE 'qr_%'`,
                ))
                .orderBy(desc(paymentTransactions.createdAt))
                .limit(1);

            const qrCodeId = (qrTxn?.metadata as any)?.qrCodeId
                || qrTxn?.razorpayOrderId?.replace(/^qr_/, '');

            if (!qrCodeId) {
                return res.json({
                    success: true,
                    data: { paid: false, status: booking.status, reason: 'no_qr_generated' },
                });
            }

            const result = await PaymentService.fetchQrPaymentStatus(qrCodeId);

            if (result.paid && result.payment) {
                await PaymentService.settleQrPayment(serviceId, result.payment, qrCodeId);
                return res.json({
                    success: true,
                    data: { paid: true, status: BookingState.COMPLETED, amount: result.amountReceivedPaise / 100 },
                });
            }

            res.json({ success: true, data: { paid: false, status: booking.status } });
        } catch (error: any) {
            logger.error(`[QR_STATUS] ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * GET /api/admin/payments/stuck
     *
     * Bookings sitting in pending_payment — the safety net for a QR that was paid
     * but never settled (webhook lost AND the partner closed the app before the
     * poll confirmed it). Admin-authenticated via the /api/admin middleware.
     */
    app.get("/api/admin/payments/stuck", async (req: Request, res: Response) => {
        try {
            const rows = await db
                .select({
                    id: serviceRequests.id,
                    serviceId: serviceRequests.serviceId,
                    serviceType: serviceRequests.serviceType,
                    status: serviceRequests.status,
                    pricingSnapshot: serviceRequests.pricingSnapshot,
                    totalAmount: serviceRequests.totalAmount,
                    updatedAt: serviceRequests.updatedAt,
                    customerName: users.username,
                    customerPhone: users.phone,
                    partnerName: employees.fullName,
                })
                .from(serviceRequests)
                .leftJoin(users, eq(serviceRequests.userId, users.id))
                .leftJoin(employees, eq(serviceRequests.providerId, employees.id))
                .where(eq(serviceRequests.status, BookingState.PENDING_PAYMENT as any))
                .orderBy(desc(serviceRequests.updatedAt));

            // Attach the QR id (if one was issued) so the UI can link to Razorpay.
            const enriched = await Promise.all(rows.map(async (r) => {
                const [qrTxn] = await db.select().from(paymentTransactions)
                    .where(and(
                        eq(paymentTransactions.serviceRequestId, r.id),
                        sql`${paymentTransactions.razorpayOrderId} LIKE 'qr_%'`,
                    ))
                    .orderBy(desc(paymentTransactions.createdAt))
                    .limit(1);

                const snapshot = r.pricingSnapshot as any;
                return {
                    ...r,
                    amountDue: snapshot?.finalTotal ?? r.totalAmount ?? 0,
                    qrCodeId: (qrTxn?.metadata as any)?.qrCodeId
                        || qrTxn?.razorpayOrderId?.replace(/^qr_/, '') || null,
                    waitingSinceMinutes: r.updatedAt
                        ? Math.floor((Date.now() - new Date(r.updatedAt).getTime()) / 60000)
                        : null,
                };
            }));

            res.json({ success: true, data: enriched });
        } catch (error: any) {
            logger.error(`[ADMIN_STUCK] ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * POST /api/admin/services/:id/reconcile-payment
     *
     * Asks Razorpay whether this booking's QR was actually paid and settles it if
     * so. Same idempotent path as the webhook and the partner poll — it will not
     * double-credit, and it refuses to invent a payment that Razorpay has no
     * record of.
     */
    app.post("/api/admin/services/:id/reconcile-payment", async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            if (Number.isNaN(serviceId)) {
                return res.status(400).json({ success: false, message: "Invalid service id" });
            }

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, serviceId)).limit(1);
            if (!booking) {
                return res.status(404).json({ success: false, message: "Booking not found" });
            }

            if (booking.status === BookingState.COMPLETED) {
                return res.json({
                    success: true,
                    data: { paid: true, settled: false, message: "Already completed" },
                });
            }

            const [qrTxn] = await db.select().from(paymentTransactions)
                .where(and(
                    eq(paymentTransactions.serviceRequestId, serviceId),
                    sql`${paymentTransactions.razorpayOrderId} LIKE 'qr_%'`,
                ))
                .orderBy(desc(paymentTransactions.createdAt))
                .limit(1);

            const qrCodeId = (qrTxn?.metadata as any)?.qrCodeId
                || qrTxn?.razorpayOrderId?.replace(/^qr_/, '');

            if (!qrCodeId) {
                return res.json({
                    success: true,
                    data: {
                        paid: false, settled: false,
                        message: "No QR was generated for this booking — nothing to reconcile.",
                    },
                });
            }

            const result = await PaymentService.fetchQrPaymentStatus(qrCodeId);

            if (!result.paid || !result.payment) {
                return res.json({
                    success: true,
                    data: {
                        paid: false, settled: false, qrCodeId,
                        message: "Razorpay has no captured payment for this QR.",
                    },
                });
            }

            const settlement = await PaymentService.settleQrPayment(serviceId, result.payment, qrCodeId);
            logger.info(`[ADMIN_RECONCILE] Booking ${serviceId} reconciled by admin`);

            res.json({
                success: true,
                data: {
                    paid: true,
                    settled: settlement.settled,
                    qrCodeId,
                    paymentId: result.payment.id,
                    amount: result.amountReceivedPaise / 100,
                    message: settlement.settled
                        ? "Payment confirmed — booking marked completed."
                        : "Payment confirmed; booking was already settled.",
                },
            });
        } catch (error: any) {
            logger.error(`[ADMIN_RECONCILE] ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * POST /api/webhooks/razorpay
     * Razorpay webhook handler
     * Verifies signature and updates payment status
     */
    app.post("/api/webhooks/razorpay", async (req: Request, res: Response) => {
        try {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            if (!webhookSecret) {
                console.error('RAZORPAY_WEBHOOK_SECRET not configured');
                return res.status(500).json({ error: "Webhook not configured" });
            }
            const signature = req.headers["x-razorpay-signature"] as string;

            if (!signature) {
                return res.status(400).json({ error: "Missing signature" });
            }

            // Hash the exact bytes Razorpay signed. req.rawBody is captured by the
            // express.json verify hook; JSON.stringify(req.body) re-serialises and
            // will not byte-match, so it failed every signature check with 401.
            if (!req.rawBody) {
                console.error('[WEBHOOK] rawBody missing — cannot verify signature');
                return res.status(500).json({ error: "Webhook body capture unavailable" });
            }

            const isValid = PaymentService.verifyWebhookSignature(
                req.rawBody.toString('utf8'),
                signature,
                webhookSecret
            );

            if (!isValid) {
                // Diagnostic: distinguishes the two causes of a 401 without ever
                // logging the secret or a usable signature.
                //   rawBodyMatches=false, stringifyMatches=true  -> body capture problem
                //   both false                                   -> the configured
                //     RAZORPAY_WEBHOOK_SECRET does not match the dashboard secret
                const stringifyMatches = PaymentService.verifyWebhookSignature(
                    JSON.stringify(req.body), signature, webhookSecret,
                );
                logger.warn('[WEBHOOK] Razorpay signature verification failed', {
                    rawBodyMatches: false,
                    stringifyMatches,
                    likelyCause: stringifyMatches
                        ? 'raw-body capture (deploy fix)'
                        : 'RAZORPAY_WEBHOOK_SECRET mismatch with Razorpay dashboard',
                    rawBodyBytes: req.rawBody.length,
                    stringifyBytes: Buffer.byteLength(JSON.stringify(req.body)),
                    contentType: req.headers['content-type'],
                    receivedSigLength: signature.length,
                    // Fingerprints only — not reversible into a valid signature.
                    secretFingerprint: crypto.createHash('sha256')
                        .update(webhookSecret).digest('hex').slice(0, 8),
                });
                return res.status(401).json({ error: "Invalid signature" });
            }

            // Handle webhook event
            const { event, payload } = req.body;
            const result = await PaymentService.handleWebhook(event, payload);

            res.json(result);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/webhooks/razorpayx
     * RazorpayX Webhook (Payouts)
     * Handles payout.processed, payout.failed, etc.
     */
    app.post("/api/webhooks/razorpayx", async (req: Request, res: Response) => {
        try {
            const webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET;
            if (!webhookSecret) {
                console.error('RAZORPAYX_WEBHOOK_SECRET not configured');
                return res.status(500).json({ error: "Webhook not configured" });
            }
            
            const signature = req.headers["x-razorpay-signature"] as string;
            if (!signature) return res.status(400).json({ error: "Missing signature" });

            // Same raw-bytes requirement as the Razorpay webhook above.
            if (!req.rawBody) {
                console.error('[WEBHOOK] rawBody missing — cannot verify signature');
                return res.status(500).json({ error: "Webhook body capture unavailable" });
            }
            const isValid = PaymentService.verifyWebhookSignature(
                req.rawBody.toString('utf8'),
                signature,
                webhookSecret,
            );
            if (!isValid) {
                logger.warn('[WEBHOOK] RazorpayX signature verification failed');
                return res.status(401).json({ error: "Invalid signature" });
            }

            const { event, payload } = req.body;
            
            if (event === 'payout.processed') {
                const payoutId = payload.payout.entity.id;
                await db.update(withdrawalRequests)
                    .set({ status: 'completed', updatedAt: new Date() })
                    .where(eq(withdrawalRequests.razorpayPayoutId, payoutId));
            } else if (event === 'payout.failed' || event === 'payout.reversed') {
                const payout = payload.payout.entity;
                const failureReason = payout.failure_reason || 'Payout failed';
                
                const [request] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.razorpayPayoutId, payout.id)).limit(1);
                
                if (request && request.status !== 'failed' && request.status !== 'rejected') {
                    // Update request
                    await db.update(withdrawalRequests)
                        .set({ status: 'failed', failureReason, updatedAt: new Date() })
                        .where(eq(withdrawalRequests.id, request.id));
                        
                    // Refund to wallet
                    const [wallet] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, request.partnerId)).limit(1);
                    if (wallet) {
                        const amount = parseFloat(request.amount as any);
                        const currentAvail = parseFloat(wallet.balanceAvailable as any);
                        await db.update(partnerWallets)
                            .set({ balanceAvailable: (currentAvail + amount).toFixed(2) })
                            .where(eq(partnerWallets.partnerId, request.partnerId));
                            
                        await db.insert(walletTransactionsV2).values({
                            transactionId: `REFUND-FAIL-${request.id}-${Date.now()}`,
                            partnerId: request.partnerId,
                            transactionType: 'refund', // Payout failed → funds returned
                            amount: amount.toFixed(2),
                            balanceAvailableBefore: wallet.balanceAvailable,
                            balanceAvailableAfter: (currentAvail + amount).toFixed(2),
                            description: `Withdrawal Failed Refund: ${failureReason}`,
                        });
                    }
                }
            }

            res.json({ received: true });
        } catch (error: any) {
            console.error("RazorpayX Webhook Error:", error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/customer/services/:id/invoice
     * Get invoice for completed service.
     *
     * Visible only to the booking's customer and the technician who did the
     * job — the previous version let any logged-in user read any invoice by
     * guessing booking ids. The response is normalised to camelCase because
     * the raw snake_case row rendered every amount as undefined in the app's
     * invoice screen.
     */
    app.get("/api/customer/services/:id/invoice", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const requesterId = (req as any).user?.userId;

            const srResult = await db.execute(sql`
        SELECT sr.user_id, sr.service_type, e.user_id AS provider_user_id
        FROM service_requests sr
        LEFT JOIN employees e ON e.id = sr.provider_id
        WHERE sr.id = ${serviceId}
      `) as any;
            const srRows = Array.isArray(srResult) ? srResult : (srResult?.rows || []);
            const sr = srRows?.[0];

            if (!sr) {
                return res.status(404).json({ error: "Service request not found" });
            }
            if (sr.user_id !== requesterId && sr.provider_user_id !== requesterId) {
                return res.status(403).json({ error: "Not authorised to view this invoice" });
            }

            const invoiceResult = await db.execute(sql`
        SELECT i.*, u.username AS customer_name
        FROM invoices i
        LEFT JOIN users u ON u.id = i.user_id
        WHERE i.service_request_id = ${serviceId}
      `) as any;
            const invRows = Array.isArray(invoiceResult) ? invoiceResult : (invoiceResult?.rows || []);
            const row = invRows?.[0];

            if (!row) {
                return res.status(404).json({ error: "Invoice not found" });
            }

            const totalAmount = Number(row.total_amount || 0);
            const advancePaid = Number(row.discount || 0);
            const serviceAmount = Number(row.base_amount || 0);
            const gstAmount = Number(row.cgst || 0) + Number(row.sgst || 0);
            // Approved spare parts are a pass-through: they are inside the total
            // but not inside the taxable amount, so the breakdown needs them
            // explicitly or the lines don't sum to what the customer paid.
            const otherCharges = Math.max(0, Math.round((totalAmount - (serviceAmount + gstAmount)) * 100) / 100);

            // Load company details from admin config for the invoice view
            const [companyName, companyAddress, companyGstin, placeOfSupply, supportEmail, supportPhone] = await Promise.all([
                configService.get<string>('BUSINESS_CONFIG.COMPANY_NAME', 'UniteFix Solutions Pvt Ltd'),
                configService.get<string>('BUSINESS_CONFIG.COMPANY_ADDRESS', 'Yellapur, Uttara Kannada, Karnataka - 581359'),
                configService.get<string>('BUSINESS_CONFIG.COMPANY_GSTIN', '29ABCDE1234F1Z5'),
                configService.get<string>('BUSINESS_CONFIG.PLACE_OF_SUPPLY', 'Yellapur, Karnataka'),
                configService.get<string>('BUSINESS_CONFIG.SUPPORT_EMAIL', 'support@unitefix.com'),
                configService.get<string>('BUSINESS_CONFIG.SUPPORT_PHONE', '+91-9876543210'),
            ]);

            res.json({
                invoice: {
                    id: row.id,
                    invoiceNumber: row.invoice_id,
                    serviceRequestId: row.service_request_id,
                    serviceAmount,
                    gstAmount,
                    otherCharges,
                    totalAmount,
                    // The booking fee is an advance INSIDE the total, not an
                    // extra charge — sent as advance/balance so the app never
                    // renders it as an additive line item.
                    advancePaid,
                    balancePaid: Math.max(0, totalAmount - advancePaid),
                    // Invoices are only generated once payment has settled.
                    status: 'paid',
                    createdAt: row.created_at,
                    customerName: row.customer_name || undefined,
                    serviceType: sr.service_type || undefined,
                    // Company/seller details from admin config
                    companyName: companyName?.trim() || undefined,
                    companyAddress: companyAddress?.trim() || undefined,
                    companyGstin: companyGstin?.trim() || undefined,
                    placeOfSupply: placeOfSupply?.trim() || undefined,
                    supportEmail: supportEmail?.trim() || undefined,
                    supportPhone: supportPhone?.trim() || undefined,
                },
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== RAZORPAY NATIVE SDK VERIFICATION ====================

    /**
     * POST /api/payments/verify
     * Mobile SDK sends razorpay_payment_id, razorpay_order_id, razorpay_signature
     * Backend verifies HMAC signature and marks payment as captured
     */
    app.post("/api/payments/verify", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

            if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
                return res.status(400).json({
                    success: false,
                    message: "Missing required fields: razorpay_payment_id, razorpay_order_id, razorpay_signature",
                });
            }

            if (razorpay_payment_id !== 'zero_amount') {
                // Verify signature using HMAC SHA256
                const secret = process.env.RAZORPAY_KEY_SECRET;
                if (!secret) {
                    return res.status(500).json({ success: false, message: "Payment verification not configured" });
                }

                const expectedSignature = crypto
                    .createHmac("sha256", secret)
                    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                    .digest("hex");

                if (expectedSignature !== razorpay_signature) {
                    console.error(`[PAYMENT] Signature mismatch for order ${razorpay_order_id}`);
                    return res.status(400).json({ success: false, message: "Invalid payment signature" });
                }
            }

            // Resolve the booking BEFORE recording the capture.
            //
            // This ordering is load-bearing. The capture row must carry
            // serviceRequestId, because storage.updateServiceRequestStatus ->
            // isFinalPaymentVerified() looks for a captured row *for that booking*
            // before allowing PENDING_PAYMENT -> COMPLETED and generating the
            // invoice. Previously the capture was written with serviceRequestId
            // NULL, so that check always failed, the transition threw, the error
            // was swallowed by the catch below, and the result was: money taken,
            // booking stuck in pending_payment, and NO INVOICE EVER CREATED.
            let serviceId: number | null = null;

            if (razorpay_payment_id === 'zero_amount' && razorpay_order_id.startsWith('order_')) {
                serviceId = parseInt(razorpay_order_id.replace('order_', ''));
            } else {
                // The order_created row carries the booking link.
                const txns = await db.select({ serviceRequestId: paymentTransactions.serviceRequestId })
                    .from(paymentTransactions)
                    .where(and(
                        eq(paymentTransactions.razorpayOrderId, razorpay_order_id),
                        isNotNull(paymentTransactions.serviceRequestId),
                    ))
                    .limit(1);
                if (txns[0]?.serviceRequestId) {
                    serviceId = txns[0].serviceRequestId;
                }
            }

            // An FTTH recharge resolves the same way and for the same reason: the
            // capture row must carry its entity link, or the recharge is invisible
            // to the reconcile tooling and unresolvable if the webhook is late.
            let ftthRechargeId: number | null = null;
            if (!serviceId && razorpay_payment_id !== 'zero_amount') {
                const { FtthService } = await import("../services/ftth.service");
                ftthRechargeId = await FtthService.rechargeIdForOrder(razorpay_order_id);
            }

            // Record verified payment via Drizzle ORM (correct columns)
            if (razorpay_payment_id !== 'zero_amount') {
                await PaymentTrackingService.recordPaymentEvent({
                    serviceRequestId: serviceId ?? undefined,
                    ftthRechargeId: ftthRechargeId ?? undefined,
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id,
                    amount: 0, // Amount will be updated by webhook
                    eventType: 'payment_captured',
                    status: 'captured',
                    metadata: { verifiedVia: 'mobile_sdk', razorpay_signature },
                });
            }

            // Extend the connection now rather than waiting on the webhook, so the
            // app can show the new expiry immediately. Idempotent — if the webhook
            // has already landed, this is a no-op, and if it has not, the webhook
            // will find the recharge already applied.
            if (ftthRechargeId) {
                try {
                    const { FtthService } = await import("../services/ftth.service");
                    const result = await FtthService.applyCapture({
                        razorpayOrderId: razorpay_order_id,
                        razorpayPaymentId: razorpay_payment_id,
                        rechargeId: ftthRechargeId,
                    });
                    return res.json({
                        success: true,
                        message: result.applied
                            ? "Recharge successful"
                            : "Payment already recorded",
                        data: { rechargeId: ftthRechargeId },
                    });
                } catch (err: any) {
                    logger.error(`[PAYMENT] FTTH recharge apply failed: ${err.message}`, {
                        razorpay_order_id, ftthRechargeId,
                    });
                    // Do NOT fail the request: the money is captured and the
                    // webhook will settle it. Telling the customer the payment
                    // failed here would be a lie.
                    return res.json({
                        success: true,
                        message: "Payment received. Your recharge will be confirmed shortly.",
                        data: { rechargeId: ftthRechargeId },
                    });
                }
            }

            // Update bookingFeeStatus for any service request linked to this order
            try {
                if (serviceId) {
                    const [booking] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, serviceId)).limit(1);
                    
                    if (booking) {
                        if (booking.status === BookingState.PENDING_PAYMENT) {
                            // Final payment successful -> Complete booking
                            const { storage } = await import('../storage');
                            await storage.updateServiceRequestStatus(
                                serviceId,
                                BookingState.COMPLETED,
                            );
                            // Store payment reference as metadata via updateServiceRequest
                            await storage.updateServiceRequest(serviceId, {
                                paymentMethod: 'razorpay' as any,
                            });

                            const paidAmount = (booking.pricingSnapshot as any)?.finalTotal
                                ?? booking.totalAmount
                                ?? 0;
                            void BookingNotifications.paymentReceived(serviceId, paidAmount, 'online');
                            void BookingNotifications.serviceCompleted(serviceId);
                        } else {
                            // Booking fee or other payment
                            const [updated] = await db.update(serviceRequests)
                                .set({ bookingFeeStatus: 'paid' as any, updatedAt: new Date() })
                                .where(eq(serviceRequests.id, serviceId))
                                .returning({ id: serviceRequests.id, status: serviceRequests.status });

                            /**
                             * The booking is announced HERE, not at creation.
                             * Firing it when the row was inserted meant the
                             * notification landed as the Razorpay sheet opened —
                             * before payment, and regardless of whether the
                             * customer went through with it.
                             *
                             * Guarded on the row having actually moved to paid so
                             * a duplicate webhook cannot announce it twice.
                             */
                            if (updated?.id) {
                                void BookingNotifications.bookingCreated(serviceId);
                            }
                        }
                    }
                }
            } catch (dbErr: any) {
                console.warn(`[PAYMENT] bookingFeeStatus update skipped: ${dbErr.message}`);
            }

            console.log(`[PAYMENT] ✅ Verified payment ${razorpay_payment_id} for order ${razorpay_order_id}`);
            res.json({ success: true, message: "Payment verified successfully" });
        } catch (error: any) {
            console.error('[PAYMENT] Verification error:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // ==================== SHOP PRODUCT PAYMENT ====================

    /**
     * POST /api/shop/create-order
     * Creates Razorpay order for product checkout
     * Body: { amount: number, address: string }
     */
    app.post("/api/shop/create-order", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { amount, address } = req.body;
            const customerId = (req as any).user?.userId;

            if (!amount || amount <= 0) {
                return res.status(400).json({ success: false, message: "Valid amount is required" });
            }

            const keyId = process.env.RAZORPAY_KEY_ID;
            const keySecret = process.env.RAZORPAY_KEY_SECRET;

            if (!keyId || !keySecret) {
                return res.status(500).json({ success: false, message: "Payment gateway not configured" });
            }

            const Razorpay = (await import('razorpay')).default;
            const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

            const order = await razorpay.orders.create({
                amount: Math.round(amount * 100), // Rupees → Paise
                currency: 'INR',
                receipt: `shop_${customerId}_${Date.now()}`,
                notes: {
                    customer_id: customerId?.toString() || '',
                    payment_type: 'product_order',
                    address: (address || '').substring(0, 200),
                },
            });

            // Record order in payment_transactions via Drizzle ORM
            await PaymentTrackingService.recordPaymentEvent({
                razorpayOrderId: order.id,
                amount: Math.round(amount * 100), // paise
                currency: 'INR',
                eventType: 'order_created',
                status: 'pending',
                metadata: { paymentType: 'product_order', customerId },
            });

            console.log(`[SHOP] Razorpay order ${order.id} created for customer ${customerId}, amount: ₹${amount}`);

            res.json({
                success: true,
                data: {
                    razorpayOrderId: order.id,
                    razorpayKeyId: keyId,
                    amount,
                },
            });
        } catch (error: any) {
            console.error('[SHOP] Order creation failed:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    });
}
