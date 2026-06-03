/**
 * PHASE 5: Razorpay Payment Service
 * 
 * Handles:
 * - Booking charge (₹99 default, configurable) at creation
 * - Final payment after service completion
 * - Webhook verification for COMPLETED gate
 * - Refunds
 * 
 * BILLING RULE: Financial math lives in BillingEngine (billing-engine.ts).
 * This service handles Razorpay integration and invoice persistence ONLY.
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import { paymentTransactions } from "@shared/schema";
import { configService } from "./config.service";
import { PaymentTrackingService } from "./payment-tracking.service";
import { BookingState } from "../business/booking-state-machine";
import logger from "../lib/logger";

interface RazorpayConfig {
    keyId: string;
    keySecret: string;
}

export class PaymentService {
    private static razorpay: Razorpay;

    /**
   * Initialize Razorpay instance.
   * Priority: process.env → platform_config DB table.
   * Env vars are the source of truth for secrets; DB may contain seed placeholders.
   */
    private static async getRazorpayInstance(): Promise<Razorpay> {
        if (this.razorpay) return this.razorpay;

        // Prefer env vars (always authoritative for secrets)
        let keyId = process.env.RAZORPAY_KEY_ID;
        let keySecret = process.env.RAZORPAY_KEY_SECRET;

        // Fall back to DB config only if env vars are missing
        if (!keyId) {
            keyId = await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_ID") || undefined;
        }
        if (!keySecret) {
            keySecret = await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_SECRET") || undefined;
        }

        // Guard against seed placeholders like 'rzp_test_xxxxx' or 'secret_xxxxx'
        if (keyId && (keyId.includes('xxxxx') || keyId.length < 15)) {
            logger.warn('[RAZORPAY] DB key looks like a placeholder, clearing');
            keyId = process.env.RAZORPAY_KEY_ID;
        }
        if (keySecret && (keySecret.includes('xxxxx') || keySecret.length < 15)) {
            logger.warn('[RAZORPAY] DB secret looks like a placeholder, clearing');
            keySecret = process.env.RAZORPAY_KEY_SECRET;
        }

        if (!keyId || !keySecret) {
            throw new Error("Razorpay credentials not configured");
        }

        logger.info(`[RAZORPAY] Initialized with key: ${keyId.substring(0, 12)}...`);

        this.razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });

        return this.razorpay;
    }

    /**
     * Create Razorpay order for booking charge (₹99 default)
     * Called when service request is created
     */
    static async createBookingOrder(
        serviceRequestId: number,
        customerId: number
    ): Promise<{ orderId: string; amount: number; currency: string }> {
        // Get booking charge from config (₹99 default — matches schema and BillingEngine)
        const bookingCharge = await configService.get<string>("BUSINESS_CONFIG.BASE_SERVICE_FEE");
        const parsedAmount = parseFloat(bookingCharge || "99");

        if (parsedAmount <= 0) {
            // Free booking — no Razorpay order required
            return {
                orderId: `free_booking_${serviceRequestId}_${Date.now()}`,
                amount: 0,
                currency: "INR",
            };
        }

        const razorpay = await this.getRazorpayInstance();
        const amount = parsedAmount * 100; // Convert to paise

        // Create Razorpay order
        const order = await razorpay.orders.create({
            amount,
            currency: "INR",
            receipt: `booking_${serviceRequestId}_${Date.now()}`,
            notes: {
                service_request_id: serviceRequestId.toString(),
                customer_id: customerId.toString(),
                payment_type: "booking_charge",
            },
        });

        // Record to payment audit trail (uses Drizzle ORM with correct columns)
        await PaymentTrackingService.recordPaymentEvent({
            serviceRequestId,
            razorpayOrderId: order.id,
            amount: amount, // in paise
            currency: 'INR',
            eventType: 'order_created',
            status: 'pending',
            metadata: { paymentType: 'booking_charge', customerId },
        });

        return {
            orderId: order.id,
            amount: amount / 100,
            currency: "INR",
        };
    }

    /**
     * Create Razorpay order for final payment
     * Called after technician enters service charge
     */
    static async createFinalPaymentOrder(
        serviceRequestId: number,
        serviceCharge: number
    ): Promise<{ orderId: string; amount: number; invoice: any }> {
        const razorpay = await this.getRazorpayInstance();

        // Calculate invoice
        const invoice = await this.calculateInvoice(serviceRequestId, serviceCharge);

        // Create Razorpay order for amount due
        const order = await razorpay.orders.create({
            amount: invoice.amountDue * 100, // Convert to paise
            currency: "INR",
            receipt: `final_${serviceRequestId}_${Date.now()}`,
            notes: {
                service_request_id: serviceRequestId.toString(),
                payment_type: "final_payment",
                booking_charge: invoice.bookingCharge.toString(),
                service_charge: invoice.serviceCharge.toString(),
                gst: invoice.gstAmount.toString(),
            },
        });

        // Record to payment audit trail (uses Drizzle ORM with correct columns)
        await PaymentTrackingService.recordPaymentEvent({
            serviceRequestId,
            razorpayOrderId: order.id,
            amount: invoice.amountDue * 100, // convert rupees → paise for DB
            currency: 'INR',
            eventType: 'order_created',
            status: 'pending',
            metadata: { paymentType: 'final_payment', invoice },
        });

        return {
            orderId: order.id,
            amount: invoice.amountDue,
            invoice,
        };
    }

    /**
     * @deprecated PHASE 2 COMPAT SHIM — reads frozen snapshot first, safe for continued use.
     * Callers: createFinalPaymentOrder (only).
     * The canonical billing formula lives in server/services/billing-engine.ts.
     * Snapshot path: returns exact values from pricing_snapshot (immutable).
     * Legacy path: reverse-calculates from config (for pre-refactor bookings only).
     */
    static async calculateInvoice(
        serviceRequestId: number,
        serviceCharge: number
    ): Promise<{
        bookingCharge: number;
        serviceCharge: number;
        subtotal: number;
        gstPercentage: number;
        gstAmount: number;
        totalAmount: number;
        amountPaid: number;
        amountDue: number;
    }> {
        // Fetch booking to get the frozen snapshot
        const srResult = await db.execute(sql`
            SELECT booking_fee, pricing_snapshot, total_amount
            FROM service_requests WHERE id = ${serviceRequestId}
        `) as any;
        const sr = srResult?.[0];

        const defaultFee = await configService.get<number>("BUSINESS_CONFIG.BASE_SERVICE_FEE", 99);
        const bookingFee = (sr?.booking_fee !== undefined && sr?.booking_fee !== null) ? parseInt(sr.booking_fee) : defaultFee;
        const snapshot = sr?.pricing_snapshot;

        // If snapshot exists with billing data, use it directly
        if (snapshot && snapshot.grossTotal && snapshot.finalTotal !== undefined) {
            return {
                bookingCharge: (snapshot.bookingFee !== undefined && snapshot.bookingFee !== null) ? snapshot.bookingFee : bookingFee,
                serviceCharge: snapshot.subtotal || serviceCharge,
                subtotal: snapshot.taxableAmount || (serviceCharge + bookingFee),
                gstPercentage: snapshot.gstPercent || 18,
                gstAmount: (snapshot.cgst || 0) + (snapshot.sgst || 0),
                totalAmount: snapshot.grossTotal,
                amountPaid: (snapshot.bookingFeeCredit !== undefined && snapshot.bookingFeeCredit !== null) ? snapshot.bookingFeeCredit : bookingFee,
                amountDue: snapshot.finalTotal,
            };
        }

        // Fallback for legacy bookings: use simplified calculation (aligned with BillingEngine integer math)
        const bookingChargeStr = await configService.get<string>("BUSINESS_CONFIG.BASE_SERVICE_FEE");
        const gstPercentageStr = await configService.get<string>("BUSINESS_CONFIG.GST_PERCENTAGE");
        const bookingCharge = Math.round(parseFloat(bookingChargeStr || "99"));
        const gstPercentage = Math.round(parseFloat(gstPercentageStr || "18"));

        const subtotal = bookingCharge + serviceCharge;
        const gstAmount = Math.round((subtotal * gstPercentage) / 100);
        const totalAmount = subtotal + gstAmount;
        const amountPaid = bookingCharge;
        const amountDue = Math.max(0, totalAmount - amountPaid);

        return {
            bookingCharge,
            serviceCharge,
            subtotal,
            gstPercentage,
            gstAmount,
            totalAmount,
            amountPaid,
            amountDue,
        };
    }

    /**
     * Verify Razorpay webhook signature
     * CRITICAL: Gates COMPLETED transition
     */
    static verifyWebhookSignature(
        webhookBody: string,
        signature: string,
        secret: string
    ): boolean {
        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(webhookBody)
            .digest("hex");

        return expectedSignature === signature;
    }

    /**
     * Handle Razorpay webhook
     * Updates payment status and allows COMPLETED transition
     */
    static async handleWebhook(
        event: string,
        payload: any
    ): Promise<{ success: boolean; message: string }> {
        if (event === "payment.captured") {
            const paymentId = payload.payment.entity.id;
            const orderId = payload.payment.entity.order_id;
            const amountPaise = payload.payment.entity.amount; // Razorpay sends paise

            // Record capture event via Drizzle ORM (correct columns)
            await PaymentTrackingService.recordPaymentEvent({
                razorpayOrderId: orderId,
                razorpayPaymentId: paymentId,
                amount: amountPaise, // stored as paise
                currency: 'INR',
                eventType: 'payment_captured',
                status: 'captured',
                method: payload.payment?.entity?.method,
                metadata: payload.payment?.entity,
            });

            // Also update bookingFeeStatus on the service_requests table
            const notes = payload.payment?.entity?.notes;
            if (notes?.payment_type === 'booking_charge' && notes?.service_request_id) {
                try {
                    await db.execute(sql`
                        UPDATE service_requests
                        SET booking_fee_status = 'paid', updated_at = NOW()
                        WHERE id = ${parseInt(notes.service_request_id)}
                    `);
                } catch (err: any) {
                    logger.warn(`[WEBHOOK] bookingFeeStatus update failed: ${err.message}`);
                }
            }

            if (notes?.payment_type === 'final_payment' && notes?.service_request_id) {
                try {
                    const { storage } = await import('../storage');
                    await storage.updateServiceRequestStatus(
                        parseInt(notes.service_request_id),
                        BookingState.COMPLETED,
                    );
                    // Store payment metadata separately
                    await storage.updateServiceRequest(parseInt(notes.service_request_id), {
                        paymentMethod: 'razorpay' as any,
                    });
                    logger.info(`[WEBHOOK] Transitioned booking ${notes.service_request_id} to COMPLETED`);
                } catch (err: any) {
                    logger.warn(`[WEBHOOK] COMPLETED transition failed: ${err.message}`);
                }
            }

            return {
                success: true,
                message: `Payment ${paymentId} captured successfully`,
            };
        }

        if (event === "payment.failed") {
            const orderId = payload.payment.entity.order_id;
            const amountPaise = payload.payment.entity.amount || 0; // Razorpay sends paise

            // Record failure event via Drizzle ORM (correct columns)
            await PaymentTrackingService.recordPaymentEvent({
                razorpayOrderId: orderId,
                amount: amountPaise, // stored as paise
                eventType: 'payment_failed',
                status: 'failed',
                metadata: payload.payment?.entity,
            });

            return {
                success: true,
                message: "Payment failed event processed",
            };
        }

        return { success: false, message: "Unhandled event type" };
    }

    /**
     * Check if final payment is verified
     * Called before allowing COMPLETED transition
     */
    static async isFinalPaymentVerified(serviceRequestId: number): Promise<boolean> {
        // Use Drizzle ORM with correct column names (status, eventType)
        const results = await db.select({ id: paymentTransactions.id })
            .from(paymentTransactions)
            .where(
                and(
                    eq(paymentTransactions.serviceRequestId, serviceRequestId),
                    eq(paymentTransactions.eventType, 'payment_captured'),
                    eq(paymentTransactions.status, 'captured')
                )
            )
            .limit(1);

        return results.length > 0;
    }

    /**
     * Generate invoice on COMPLETED
     * Saves to invoices table using the ACTUAL Drizzle schema columns:
     * invoice_id, service_request_id, user_id, provider_id, base_amount, cgst, sgst, discount, total_amount
     */
    static async generateInvoice(
        serviceRequestId: number,
        customerId: number,
        providerId: number
    ): Promise<{ invoiceId: string }> {
        // Get booking data from service_requests — prefer pricing_snapshot for accuracy
        const srResult = await db.execute(sql`
            SELECT total_amount, commission_amount, booking_fee, pricing_snapshot
            FROM service_requests
            WHERE id = ${serviceRequestId}
        `) as any;
        const sr = srResult?.[0];

        if (!sr || !sr.total_amount) {
            throw new Error("Service billing not completed — totalAmount is missing");
        }

        const snapshot = sr.pricing_snapshot;
        let baseAmount: number;
        let cgst: number;
        let sgst: number;
        let totalAmount: number;
        let bookingFee: number;

        const defaultFee = await configService.get<number>("BUSINESS_CONFIG.BASE_SERVICE_FEE", 99);

        if (snapshot && snapshot.snapshotVersion && snapshot.grossTotal) {
            // Use exact values from the frozen billing snapshot (no reverse-engineering)
            baseAmount = snapshot.taxableAmount || snapshot.subtotal || 0;
            cgst = snapshot.cgst || 0;
            sgst = snapshot.sgst || 0;
            totalAmount = snapshot.grossTotal;
            bookingFee = (snapshot.bookingFeeCredit !== undefined && snapshot.bookingFeeCredit !== null)
                ? snapshot.bookingFeeCredit
                : ((snapshot.bookingFee !== undefined && snapshot.bookingFee !== null) ? snapshot.bookingFee : defaultFee);
        } else {
            // Legacy fallback: reverse-engineer from totalAmount (less precise)
            totalAmount = parseInt(sr.total_amount);
            bookingFee = (sr.booking_fee !== undefined && sr.booking_fee !== null) ? parseInt(sr.booking_fee) : defaultFee;
            const taxableAmountCalc = Math.round(totalAmount / 1.18);
            const totalGst = totalAmount - taxableAmountCalc;
            baseAmount = taxableAmountCalc;
            cgst = Math.round(totalGst / 2);
            sgst = totalGst - cgst;
        }

        const invoiceId = `UF-INV-${serviceRequestId}-${Date.now().toString(36).toUpperCase()}`;

        // Insert invoice using correct Drizzle schema columns
        await db.execute(sql`
            INSERT INTO invoices (
                invoice_id,
                service_request_id,
                user_id,
                provider_id,
                base_amount,
                cgst,
                sgst,
                discount,
                total_amount
            ) VALUES (
                ${invoiceId},
                ${serviceRequestId},
                ${customerId},
                ${providerId},
                ${baseAmount},
                ${cgst},
                ${sgst},
                ${bookingFee},
                ${totalAmount}
            )
        `);

        return { invoiceId };
    }

    /**
     * PHASE 5: Refund booking charge (₹99) on cancellation from CREATED state
     * AI_CONTEXT §5.G: Only from CREATED state
     */
    static async refundBookingCharge(serviceRequestId: number): Promise<{ refundId: string } | null> {
        const razorpay = await this.getRazorpayInstance();

        // Find the booking charge payment using Drizzle ORM to avoid raw SQL column name issues
        const paymentResult = await db.select({
            id: paymentTransactions.id,
            razorpayPaymentId: paymentTransactions.razorpayPaymentId,
            amount: paymentTransactions.amount
        })
        .from(paymentTransactions)
        .where(
            and(
                eq(paymentTransactions.serviceRequestId, serviceRequestId),
                eq(paymentTransactions.status, 'captured'),
                sql`${paymentTransactions.metadata}->>'paymentType' = 'booking_charge'`
            )
        )
        .limit(1);
        
        const payment = paymentResult?.[0];

        if (!payment?.razorpayPaymentId) {
            logger.warn(`[REFUND] No captured booking payment found for SR ${serviceRequestId}`);
            return null;
        }

        try {
            const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
                amount: Math.round(payment.amount * 100), // Convert to paise
                notes: {
                    service_request_id: serviceRequestId.toString(),
                    reason: 'Customer cancelled from CREATED state',
                },
            });

            // Update payment record using correct column 'status'
            await db.update(paymentTransactions)
                .set({
                    status: 'refunded',
                    updatedAt: new Date()
                })
                .where(eq(paymentTransactions.id, payment.id));

            // PHASE 10: Record refund to audit trail
            await PaymentTrackingService.recordPaymentEvent({
                serviceRequestId,
                razorpayPaymentId: payment.razorpayPaymentId,
                amount: Math.round(payment.amount * 100),
                currency: 'INR',
                eventType: 'refund_initiated',
                status: 'refunded',
                metadata: { refundId: refund.id, reason: 'cancellation' },
            });

            logger.info(`[REFUND] Booking refund initiated: SR ${serviceRequestId}, refund ${refund.id}`);
            return { refundId: refund.id };
        } catch (err: any) {
            logger.error(`[REFUND] Razorpay refund failed for SR ${serviceRequestId}:`, err.message);
            throw err;
        }
    }
}
