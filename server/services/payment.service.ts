/**
 * PHASE 5: Razorpay Payment Service
 * 
 * Handles:
 * - Booking charge (₹250) at creation
 * - Final payment after service completion
 * - Webhook verification for COMPLETED gate
 * - Refunds
 * 
 * LOCKED REQUIREMENTS:
 * - Booking: ₹250
 * - Service charge: Variable (entered by technician)
 * - GST: 18% on (Booking + Service)
 * - Invoice generated on COMPLETED
 * - COMPLETED gated by webhook verification
 */

import Razorpay from "razorpay";
import crypto from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { configService } from "./config.service";
import { PaymentTrackingService } from "./payment-tracking.service";

interface RazorpayConfig {
    keyId: string;
    keySecret: string;
}

export class PaymentService {
    private static razorpay: Razorpay;

    /**
   * Initialize Razorpay instance
     */
    private static async getRazorpayInstance(): Promise<Razorpay> {
        if (this.razorpay) return this.razorpay;

        const keyId = await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_ID");
        const keySecret = await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_SECRET");

        if (!keyId || !keySecret) {
            throw new Error("Razorpay credentials not configured");
        }

        this.razorpay = new Razorpay({
            key_id: keyId,
            key_secret: keySecret,
        });

        return this.razorpay;
    }

    /**
     * Create Razorpay order for booking charge (₹250)
     * Called when service request is created
     */
    static async createBookingOrder(
        serviceRequestId: number,
        customerId: number
    ): Promise<{ orderId: string; amount: number; currency: string }> {
        const razorpay = await this.getRazorpayInstance();

        // Get booking charge from config
        const bookingCharge = await configService.get<string>("BUSINESS_CONFIG.BASE_SERVICE_FEE");
        const amount = parseFloat(bookingCharge || "250") * 100; // Convert to paise

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

        // Save to database
        await db.execute(sql`
      INSERT INTO payment_transactions (
        transaction_id,
        service_request_id,
        razorpay_order_id,
        amount,
        payment_type,
        payment_status
      ) VALUES (
        ${`txn_${Date.now()}_${serviceRequestId}`},
        ${serviceRequestId},
        ${order.id},
        ${amount / 100},
        'booking_charge',
        'pending'
      )
    `);

        // PHASE 10: Record to payment audit trail
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

        // Save to database
        await db.execute(sql`
      INSERT INTO payment_transactions (
        transaction_id,
        service_request_id,
        razorpay_order_id,
        amount,
        payment_type,
        payment_status
      ) VALUES (
        ${`txn_${Date.now()}_${serviceRequestId}`},
        ${serviceRequestId},
        ${order.id},
        ${invoice.amountDue},
        'final_payment',
        'pending'
      )
    `);

        // PHASE 10: Record to payment audit trail
        await PaymentTrackingService.recordPaymentEvent({
            serviceRequestId,
            razorpayOrderId: order.id,
            amount: invoice.amountDue * 100, // in paise
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
     * Calculate invoice per locked requirements
     * Booking: ₹250 | Service: variable | GST: 18% | Total - AlreadyPaid = Due
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
        // Get booking charge from config
        const bookingChargeStr = await configService.get<string>("BUSINESS_CONFIG.BASE_SERVICE_FEE");
        const gstPercentageStr = await configService.get<string>("BUSINESS_CONFIG.GST_PERCENTAGE");

        const bookingCharge = parseFloat(bookingChargeStr || "250");
        const gstPercentage = parseFloat(gstPercentageStr || "18");

        // Calculate per locked requirements
        const subtotal = bookingCharge + serviceCharge;
        const gstAmount = parseFloat(((subtotal * gstPercentage) / 100).toFixed(2));
        const totalAmount = subtotal + gstAmount;
        const amountPaid = bookingCharge; // Already paid at booking
        const amountDue = totalAmount - amountPaid;

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
            const amount = payload.payment.entity.amount / 100;

            // Update payment transaction
            await db.execute(sql`
        UPDATE payment_transactions 
        SET payment_status = 'captured',
            razorpay_payment_id = ${paymentId},
            webhook_verified = true,
            webhook_verified_at = NOW(),
            updated_at = NOW()
        WHERE razorpay_order_id = ${orderId}
      `);

            // PHASE 10: Record capture to audit trail
            await PaymentTrackingService.recordPaymentEvent({
                razorpayOrderId: orderId,
                razorpayPaymentId: paymentId,
                amount: amount * 100, // in paise
                currency: 'INR',
                eventType: 'payment_captured',
                status: 'captured',
                method: payload.payment?.entity?.method,
                metadata: payload.payment?.entity,
            });

            return {
                success: true,
                message: `Payment ${paymentId} captured successfully`,
            };
        }

        if (event === "payment.failed") {
            const orderId = payload.payment.entity.order_id;

            await db.execute(sql`
        UPDATE payment_transactions 
        SET payment_status = 'failed',
                updated_at = NOW()
        WHERE razorpay_order_id = ${orderId}
                `);

            // PHASE 10: Record failure to audit trail
            await PaymentTrackingService.recordPaymentEvent({
                razorpayOrderId: orderId,
                amount: payload.payment.entity.amount / 100 || 0,
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
        const paymentResult = await db.execute(sql`
      SELECT id FROM payment_transactions 
      WHERE service_request_id = ${serviceRequestId}
        AND payment_type = 'final_payment'
        AND payment_status = 'captured'
        AND webhook_verified = true
      LIMIT 1
                `) as any;
        const payment = paymentResult?.[0];

        return !!payment;
    }

    /**
     * Generate invoice on COMPLETED
     * Saves to invoices table
     */
    static async generateInvoice(
        serviceRequestId: number,
        customerId: number,
        providerId: number
    ): Promise<{ invoiceId: string }> {
        // Get service charge
        const serviceChargeResult = await db.execute(sql`
      SELECT service_amount FROM service_charges 
      WHERE service_request_id = ${serviceRequestId}
                `) as any;
        const serviceChargeRow = serviceChargeResult?.[0];

        if (!serviceChargeRow) {
            throw new Error("Service charge not entered");
        }

        const serviceCharge = parseFloat(serviceChargeRow.service_amount);
        const invoice = await this.calculateInvoice(serviceRequestId, serviceCharge);

        const invoiceId = `INV - ${serviceRequestId} - ${Date.now()}`;

        // Insert invoice
        await db.execute(sql`
      INSERT INTO invoices(
                    invoice_id,
                    service_request_id,
                    user_id,
                    provider_id,
                    booking_charge,
                    service_charge,
                    subtotal,
                    gst_percentage,
                    gst_amount,
                    total_amount_updated,
                    amount_paid,
                    amount_due,
                    payment_status
                ) VALUES(
                    ${invoiceId},
                    ${serviceRequestId},
                    ${customerId},
                    ${providerId},
                    ${invoice.bookingCharge},
                    ${invoice.serviceCharge},
                    ${invoice.subtotal},
                    ${invoice.gstPercentage},
                    ${invoice.gstAmount},
                    ${invoice.totalAmount},
                    ${invoice.amountPaid},
                    ${invoice.amountDue},
                    'paid'
                )
                `);

        return { invoiceId };
    }
}
