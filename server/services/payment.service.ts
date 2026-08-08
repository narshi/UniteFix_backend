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
import { sql, eq, and, desc } from "drizzle-orm";
import { paymentTransactions, invoices } from "@shared/schema";
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
     * Create a dynamic Razorpay QR Code for a specific service and amount
     */
    static async createDynamicQRCode(
        serviceRequestId: number,
        amount: number,
    ): Promise<{ imageUrl: string; qrCodeId: string }> {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            throw new Error("Razorpay credentials not configured");
        }

        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const amountPaise = Math.round(amount * 100);

        try {
            const qrCode = await razorpay.qrCode.create({
                type: "upi_qr",
                name: "UniteFix Services",
                usage: "single_use",
                fixed_amount: true,
                payment_amount: amountPaise,
                description: `Payment for Service #${serviceRequestId}`,
                close_by: Math.floor(Date.now() / 1000) + 12 * 60, // Razorpay requires minimum 12 mins
                notes: {
                    service_request_id: serviceRequestId.toString(),
                }
            });

            // Record the QR id NOW. The customer pays from their own UPI app, so
            // neither the partner nor the customer app is in the payment loop —
            // without this there is no key to ask Razorpay "was this QR paid?",
            // and completion depends entirely on the webhook arriving.
            await PaymentTrackingService.recordPaymentEvent({
                serviceRequestId,
                razorpayOrderId: `qr_${qrCode.id}`,
                amount: amountPaise,
                currency: 'INR',
                eventType: 'order_created',
                status: 'pending',
                metadata: { paymentType: 'qr_dynamic', qrCodeId: qrCode.id },
            });

            return { imageUrl: qrCode.image_url, qrCodeId: qrCode.id };
        } catch (error: any) {
            logger.error(`[RAZORPAY] Failed to create QR code: ${error.message}`);
            throw new Error(`Failed to generate payment QR Code: ${error.message}`);
        }
    }

    /**
     * Ask Razorpay directly whether a QR has been paid.
     *
     * This is the authoritative fallback for QR collection. Card and in-app UPI
     * both confirm through /api/payments/verify because the paying app returns a
     * payment id to the client; a scanned QR has no such return path, so without
     * this the flow has a single point of failure in the webhook.
     */
    static async fetchQrPaymentStatus(qrCodeId: string): Promise<{
        paid: boolean;
        amountReceivedPaise: number;
        payment?: { id: string; amount: number; method?: string };
    }> {
        const razorpay = await this.getRazorpayInstance();

        const payments: any = await razorpay.qrCode.fetchAllPayments(qrCodeId, {} as any);
        const items: any[] = payments?.items || [];
        const captured = items.find((p) => p.status === 'captured' || p.status === 'authorized');

        if (!captured) {
            return { paid: false, amountReceivedPaise: 0 };
        }

        return {
            paid: true,
            amountReceivedPaise: captured.amount,
            payment: { id: captured.id, amount: captured.amount, method: captured.method },
        };
    }

    /**
     * Complete a booking paid by dynamic QR. Shared by the webhook and the
     * partner-app polling fallback, so both routes behave identically.
     *
     * Idempotent: only acts while the booking is awaiting payment. Re-running it
     * after completion is a no-op, which matters because the webhook and a poll
     * can legitimately land at the same moment.
     */
    static async settleQrPayment(
        serviceRequestId: number,
        payment: { id: string; amount: number; method?: string },
        qrCodeId: string,
    ): Promise<{ settled: boolean; alreadySettled: boolean }> {
        const { storage } = await import('../storage');

        const booking = await storage.getServiceRequest(serviceRequestId);
        if (!booking) throw new Error('Booking not found');

        if (booking.status === BookingState.COMPLETED) {
            return { settled: false, alreadySettled: true };
        }
        if (booking.status !== BookingState.PENDING_PAYMENT) {
            logger.warn(
                `[QR] Ignoring settlement for booking ${serviceRequestId} in state '${booking.status}'`,
            );
            return { settled: false, alreadySettled: false };
        }

        await PaymentTrackingService.recordPaymentEvent({
            serviceRequestId,
            razorpayOrderId: `qr_${qrCodeId}`,
            razorpayPaymentId: payment.id,
            amount: payment.amount,
            currency: 'INR',
            eventType: 'payment_captured',
            status: 'captured',
            method: payment.method,
            metadata: { qr_code_id: qrCodeId, paymentType: 'qr_dynamic' },
        });

        await storage.updateServiceRequestStatus(serviceRequestId, BookingState.COMPLETED);
        await storage.updateServiceRequest(serviceRequestId, { paymentMethod: 'razorpay' as any });
        
        // Credit the technician's wallet since the platform received the money
        await storage.creditProviderWalletForOnlinePayment(serviceRequestId);

        logger.info(`[QR] Booking ${serviceRequestId} settled via QR payment ${payment.id} and wallet credited`);
        return { settled: true, alreadySettled: false };
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
        const srRows = Array.isArray(srResult) ? srResult : (srResult?.rows || []);
        const sr = srRows?.[0];

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
            .update(webhookBody, "utf8")
            .digest("hex");

        // Constant-time compare — a plain === leaks how much of the signature
        // matched via timing. timingSafeEqual throws on length mismatch, so
        // guard that first.
        const expected = Buffer.from(expectedSignature, "utf8");
        const received = Buffer.from(signature || "", "utf8");
        if (expected.length !== received.length) return false;

        return crypto.timingSafeEqual(expected, received);
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
            const notes = payload.payment?.entity?.notes;

            // Link the capture back to its booking. Razorpay echoes the notes we
            // set at order creation, so this is available here — capture rows were
            // previously orphaned, leaving payment_transactions unqueryable by
            // booking and forcing refunds to join through razorpayOrderId.
            const linkedServiceId = notes?.service_request_id
                ? parseInt(notes.service_request_id)
                : undefined;

            // Record capture event via Drizzle ORM (correct columns)
            await PaymentTrackingService.recordPaymentEvent({
                serviceRequestId: Number.isFinite(linkedServiceId as number) ? linkedServiceId : undefined,
                razorpayOrderId: orderId,
                razorpayPaymentId: paymentId,
                amount: amountPaise, // stored as paise
                currency: 'INR',
                eventType: 'payment_captured',
                status: 'captured',
                method: payload.payment?.entity?.method,
                metadata: { ...payload.payment?.entity, paymentType: notes?.payment_type },
            });

            // Also update bookingFeeStatus on the service_requests table
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
                    
                    // Credit the technician's wallet since the platform received the money
                    await storage.creditProviderWalletForOnlinePayment(parseInt(notes.service_request_id));
                    
                    logger.info(`[WEBHOOK] Transitioned booking ${notes.service_request_id} to COMPLETED and wallet credited`);
                } catch (err: any) {
                    logger.warn(`[WEBHOOK] COMPLETED transition failed: ${err.message}`);
                }
            }

            return {
                success: true,
                message: `Payment ${paymentId} captured successfully`,
            };
        }
        
        if (event === "qr_code.credited") {
            const qrEntity = payload.qr_code.entity;
            const paymentEntity = payload.payment.entity;
            const notes = qrEntity.notes || paymentEntity.notes;
            const serviceId = notes?.service_request_id;
            
            if (serviceId) {
                try {
                    // Same code path as the partner-app polling fallback, so a
                    // webhook and a poll arriving together cannot double-settle.
                    await this.settleQrPayment(
                        parseInt(serviceId),
                        {
                            id: paymentEntity.id,
                            amount: paymentEntity.amount, // paise
                            method: paymentEntity.method,
                        },
                        qrEntity.id,
                    );
                } catch (err: any) {
                    logger.warn(`[WEBHOOK] QR Code COMPLETED transition failed: ${err.message}`);
                }
            }
            return {
                success: true,
                message: `QR Code payment captured successfully`,
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

        // Acknowledged with 200 so Razorpay does not retry, but logged so it is
        // visible which events are actually arriving. Note `qr_code.created`
        // fires when the QR is generated, NOT when it is paid — the event that
        // completes a booking is `qr_code.credited`.
        logger.info(`[WEBHOOK] Ignoring unhandled event type: ${event}`);
        return { success: false, message: `Unhandled event type: ${event}` };
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
        const srRows2 = Array.isArray(srResult) ? srResult : (srResult?.rows || []);
        const sr = srRows2?.[0];

        if (!sr || !sr.total_amount) {
            throw new Error("Service billing not completed — totalAmount is missing");
        }

        // Idempotency: completion can be reached from more than one path (customer
        // payment verify, the qr_code.credited webhook, the partner-app poll, cash
        // collection, admin reconcile). Without this guard a booking settled by two
        // of them at once would produce duplicate invoices for the same job.
        const [existing] = await db.select({ invoiceId: invoices.invoiceId })
            .from(invoices)
            .where(eq(invoices.serviceRequestId, serviceRequestId))
            .limit(1);

        if (existing) {
            logger.info(`[INVOICE] Reusing existing invoice ${existing.invoiceId} for SR ${serviceRequestId}`);
            return { invoiceId: existing.invoiceId };
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
    /**
     * Refund a customer for a booking — booking fee, final payment, or both.
     *
     * Dispute resolution previously called refundBookingCharge(), which can only
     * ever reverse the ₹99 fee and ignores any admin-entered amount. A dispute
     * over a ₹5,000 job therefore could not be settled in the customer's favour.
     *
     * @param amountRupees Optional partial amount. Omit for a full refund of
     *   everything the customer has paid on this booking.
     */
    static async refundBookingPayments(
        serviceRequestId: number,
        amountRupees?: number,
        reason = 'Dispute resolved in customer favour',
    ): Promise<{ refunds: Array<{ refundId: string; amountRupees: number }>; totalRefunded: number }> {
        const razorpay = await this.getRazorpayInstance();

        // Every captured payment on this booking, newest first. The final service
        // payment is refunded before the booking fee so a partial refund comes out
        // of the larger amount first.
        const captured = await db.select({
            id: paymentTransactions.id,
            razorpayPaymentId: paymentTransactions.razorpayPaymentId,
            razorpayOrderId: paymentTransactions.razorpayOrderId,
            amount: paymentTransactions.amount,
        })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.serviceRequestId, serviceRequestId),
                eq(paymentTransactions.status, 'captured'),
            ))
            .orderBy(desc(paymentTransactions.amount));

        const refundable = captured.filter((c) => c.razorpayPaymentId && c.amount > 0);
        if (refundable.length === 0) {
            throw new Error(
                `No captured payments found for service request ${serviceRequestId} — nothing to refund.`,
            );
        }

        // Never refund more than was actually collected.
        const totalCapturedPaise = refundable.reduce((sum, c) => sum + c.amount, 0);
        let remainingPaise = amountRupees != null
            ? Math.round(amountRupees * 100)
            : totalCapturedPaise;

        if (remainingPaise <= 0) {
            throw new Error('Refund amount must be greater than zero.');
        }
        if (remainingPaise > totalCapturedPaise) {
            throw new Error(
                `Refund of ₹${remainingPaise / 100} exceeds the ₹${totalCapturedPaise / 100} captured on this booking.`,
            );
        }

        const results: Array<{ refundId: string; amountRupees: number }> = [];

        for (const payment of refundable) {
            if (remainingPaise <= 0) break;

            // Split across payments when a partial refund spans more than one.
            const slicePaise = Math.min(remainingPaise, payment.amount);

            const refund = await razorpay.payments.refund(payment.razorpayPaymentId!, {
                amount: slicePaise,
                notes: { service_request_id: serviceRequestId.toString(), reason },
            });

            await PaymentTrackingService.recordPaymentEvent({
                serviceRequestId,
                razorpayOrderId: payment.razorpayOrderId || undefined,
                razorpayPaymentId: payment.razorpayPaymentId!,
                amount: slicePaise,
                currency: 'INR',
                eventType: 'refund_initiated',
                status: 'refunded',
                metadata: { refundId: refund.id, reason, partial: slicePaise < payment.amount },
            });

            // Only mark the source row refunded when the whole of it was returned.
            if (slicePaise === payment.amount) {
                await db.update(paymentTransactions)
                    .set({ status: 'refunded', updatedAt: new Date() })
                    .where(eq(paymentTransactions.id, payment.id));
            }

            results.push({ refundId: refund.id, amountRupees: slicePaise / 100 });
            remainingPaise -= slicePaise;
        }

        const totalRefunded = results.reduce((s, r) => s + r.amountRupees, 0);
        logger.info(`[REFUND] SR ${serviceRequestId}: ₹${totalRefunded} refunded across ${results.length} payment(s)`);
        return { refunds: results, totalRefunded };
    }

    static async refundBookingCharge(
        serviceRequestId: number,
    ): Promise<{ refundId: string; amountRupees: number; alreadyRefunded?: boolean }> {
        const razorpay = await this.getRazorpayInstance();

        // The captured row and the booking-charge tag live on DIFFERENT rows:
        //   order_created    -> has serviceRequestId + metadata.paymentType, status 'pending'
        //   payment_captured -> has razorpayPaymentId + status 'captured', but historically
        //                       no serviceRequestId and no paymentType tag
        // The previous query required all three on ONE row, so it matched nothing
        // and every cancellation silently skipped the refund. Join the two rows
        // through razorpayOrderId instead.
        const [order] = await db.select({
            razorpayOrderId: paymentTransactions.razorpayOrderId,
            amount: paymentTransactions.amount,
        })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.serviceRequestId, serviceRequestId),
                sql`${paymentTransactions.metadata}->>'paymentType' = 'booking_charge'`,
            ))
            .orderBy(desc(paymentTransactions.createdAt))
            .limit(1);

        if (!order?.razorpayOrderId) {
            throw new Error(
                `No booking-fee order found for service request ${serviceRequestId}. Nothing to refund.`,
            );
        }

        // Already refunded? Do not issue a second refund.
        const [existingRefund] = await db.select({ id: paymentTransactions.id })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.razorpayOrderId, order.razorpayOrderId),
                eq(paymentTransactions.eventType, 'refund_initiated'),
            ))
            .limit(1);

        if (existingRefund) {
            logger.info(`[REFUND] Booking fee for SR ${serviceRequestId} was already refunded`);
            return { refundId: 'already-refunded', amountRupees: 0, alreadyRefunded: true };
        }

        const [captured] = await db.select({
            id: paymentTransactions.id,
            razorpayPaymentId: paymentTransactions.razorpayPaymentId,
            amount: paymentTransactions.amount,
        })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.razorpayOrderId, order.razorpayOrderId),
                eq(paymentTransactions.status, 'captured'),
            ))
            .orderBy(desc(paymentTransactions.createdAt))
            .limit(1);

        if (!captured?.razorpayPaymentId) {
            throw new Error(
                `Booking fee for service request ${serviceRequestId} was never captured — nothing to refund.`,
            );
        }

        // payment_transactions.amount is already in PAISE. The previous code
        // multiplied it by 100 again, which would have requested a 100x refund
        // (a ₹99 fee becoming ₹9,900) the moment the lookup started matching.
        // Prefer the captured amount; fall back to the order amount when the
        // capture row was written with a placeholder of 0.
        const amountPaise = captured.amount > 0 ? captured.amount : order.amount;

        if (!amountPaise || amountPaise <= 0) {
            throw new Error(
                `Cannot determine refund amount for service request ${serviceRequestId}.`,
            );
        }

        try {
            const refund = await razorpay.payments.refund(captured.razorpayPaymentId, {
                amount: amountPaise,
                notes: {
                    service_request_id: serviceRequestId.toString(),
                    reason: 'Customer cancelled from CREATED state',
                },
            });

            await db.update(paymentTransactions)
                .set({ status: 'refunded', updatedAt: new Date() })
                .where(eq(paymentTransactions.id, captured.id));

            await PaymentTrackingService.recordPaymentEvent({
                serviceRequestId,
                razorpayOrderId: order.razorpayOrderId,
                razorpayPaymentId: captured.razorpayPaymentId,
                amount: amountPaise,
                currency: 'INR',
                eventType: 'refund_initiated',
                status: 'refunded',
                metadata: { refundId: refund.id, reason: 'cancellation' },
            });

            logger.info(
                `[REFUND] SR ${serviceRequestId}: ₹${amountPaise / 100} refunded (${refund.id})`,
            );
            return { refundId: refund.id, amountRupees: amountPaise / 100 };
        } catch (err: any) {
            logger.error(`[REFUND] Razorpay refund failed for SR ${serviceRequestId}: ${err.message}`);
            throw err;
        }
    }
}
