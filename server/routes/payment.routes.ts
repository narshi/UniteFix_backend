/**
 * PHASE 5: Payment & Billing API Routes
 * Technician: Enter service charge
 * Customer: Create final payment order
 * System: Razorpay webhook
 */

import type { Express, Request, Response } from "express";
import { PaymentService } from "../services/payment.service";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import crypto from "crypto";
import { authenticateToken, authenticatePartner } from "../middleware/auth.middleware";
import { mobileLimiter } from "../middleware/rate-limit";
import { storage } from "../storage";
import { BillingEngine } from "../services/billing-engine";
import { PaymentTrackingService } from "../services/payment-tracking.service";
import { BookingState } from "../business/booking-state-machine";
import { 
    paymentTransactions,
    invoices,
    serviceRequests,
    users,
    withdrawalRequests,
    partnerWallets,
    walletTransactionsV2
} from "@shared/schema";

export function registerPaymentRoutes(app: Express) {
    /**
     * POST /api/services/create-with-payment
     * Create service and booking order with frozen pricing snapshot
     */
    app.post("/api/services/create-with-payment", mobileLimiter, authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const { serviceType, description, address, pincode } = req.body;
            const customerId = (req as any).user?.userId;

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!serviceType || !description || !address) {
                return res.status(400).json({ error: "serviceType, description, and address are required" });
            }

            // BILLING ENGINE: Freeze current pricing config into a snapshot
            const pricingSnapshot = await BillingEngine.createBookingSnapshot();

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

            // Write the frozen snapshot to the service_requests row
            await db.update(serviceRequests)
                .set({ pricingSnapshot: pricingSnapshot as any })
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
            const serviceCharge = serviceChargeResult?.[0];

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

            // Verify signature
            const webhookBody = JSON.stringify(req.body);
            const isValid = PaymentService.verifyWebhookSignature(
                webhookBody,
                signature,
                webhookSecret
            );

            if (!isValid) {
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

            const webhookBody = JSON.stringify(req.body);
            const isValid = PaymentService.verifyWebhookSignature(webhookBody, signature, webhookSecret);
            if (!isValid) return res.status(401).json({ error: "Invalid signature" });

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
                            transactionType: 'other',
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
     * Get invoice for completed service
     */
    app.get("/api/customer/services/:id/invoice", authenticateToken as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);

            const invoiceResult = await db.execute(sql`
        SELECT * FROM invoices 
        WHERE service_request_id = ${serviceId}
      `) as any;
            const invoice = invoiceResult?.[0];

            if (!invoice) {
                return res.status(404).json({ error: "Invoice not found" });
            }

            res.json({ invoice });
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

            // Record verified payment via Drizzle ORM (correct columns)
            if (razorpay_payment_id !== 'zero_amount') {
                await PaymentTrackingService.recordPaymentEvent({
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id,
                    amount: 0, // Amount will be updated by webhook
                    eventType: 'payment_captured',
                    status: 'captured',
                    metadata: { verifiedVia: 'mobile_sdk', razorpay_signature },
                });
            }

            // Update bookingFeeStatus for any service request linked to this order
            try {
                let serviceId = null;
                
                if (razorpay_payment_id === 'zero_amount' && razorpay_order_id.startsWith('order_')) {
                    serviceId = parseInt(razorpay_order_id.replace('order_', ''));
                } else {
                    // Find the service request associated with this Razorpay order
                    const txns = await db.select({ serviceRequestId: paymentTransactions.serviceRequestId })
                        .from(paymentTransactions)
                        .where(eq(paymentTransactions.razorpayOrderId, razorpay_order_id))
                        .limit(1);
                    if (txns[0]?.serviceRequestId) {
                        serviceId = txns[0].serviceRequestId;
                    }
                }

                if (serviceId) {
                    const [booking] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, serviceId)).limit(1);
                    
                    if (booking) {
                        if (booking.status === BookingState.PENDING_PAYMENT) {
                            // Final payment successful -> Complete booking
                            const { storage } = await import('../storage');
                            await storage.updateServiceRequestStatus(
                                serviceId,
                                BookingState.COMPLETED,
                                'system',
                                {
                                    razorpayPaymentId: razorpay_payment_id,
                                    notes: 'Final payment verified via mobile SDK'
                                }
                            );
                        } else {
                            // Booking fee or other payment
                            await db.update(serviceRequests)
                                .set({ bookingFeeStatus: 'paid' as any, updatedAt: new Date() })
                                .where(eq(serviceRequests.id, serviceId));
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
