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
import { serviceRequests } from "@shared/schema";

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
     * POST /api/technician/services/:id/enter-service-charge
     * Technician enters service charge after completing work
     */
    app.post("/api/technician/services/:id/enter-service-charge", authenticatePartner as any, async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const { serviceAmount, partsUsed, notes } = req.body;
            const technicianId = (req as any).user?.userId;

            if (!technicianId) {
                return res.status(401).json({ error: "Unauthorized - Technician only" });
            }

            if (!serviceAmount || serviceAmount <= 0) {
                return res.status(400).json({ error: "Valid service amount required" });
            }

            // Insert service charge
            await db.execute(sql`
        INSERT INTO service_charges (
          service_request_id,
          service_amount,
          parts_used,
          technician_notes,
          entered_by
        ) VALUES (
          ${serviceId},
          ${serviceAmount},
          ${partsUsed || ''},
          ${notes || ''},
          ${technicianId}
        )
        ON CONFLICT (service_request_id) DO UPDATE
        SET service_amount = ${serviceAmount},
            parts_used = ${partsUsed || ''},
            technician_notes = ${notes || ''},
            entered_at = NOW()
      `);

            res.json({
                message: "Service charge recorded successfully",
                serviceAmount,
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

            // Update payment_transactions table if it exists
            try {
                await db.execute(sql`
                    UPDATE payment_transactions
                    SET payment_status = 'captured',
                        razorpay_payment_id = ${razorpay_payment_id},
                        razorpay_signature = ${razorpay_signature},
                        updated_at = NOW()
                    WHERE razorpay_order_id = ${razorpay_order_id}
                `);
            } catch (dbErr: any) {
                // Table may not exist yet — log but don't fail
                console.warn(`[PAYMENT] DB update skipped: ${dbErr.message}`);
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
