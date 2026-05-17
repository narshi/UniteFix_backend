/**
 * PHASE 5: Billing Routes — Employee bill submission + invoice calculation
 *
 * Flow:
 * 1. Employee submits spare_parts_cost + service_labor_cost (IN_PROGRESS state)
 * 2. Server calculates: Sub = parts + labor → +15% UniteFix fee → +18% GST → -₹99 booking
 * 3. Creates Razorpay payment order for the balance due
 * 4. Transitions booking to PENDING_PAYMENT
 * 5. Webhook payment.captured → COMPLETED + employee wallet credit
 *
 * Also handles:
 * - ₹99 booking refund on cancellation from CREATED state
 * - WhatsApp support link for ASSIGNED+ bookings
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, sql } from 'drizzle-orm';
import { serviceRequests, employees, invoices } from '@shared/schema';
import { authenticatePartner, authenticateToken } from '../middleware/auth.middleware';
import { BookingState, validateStateTransition } from '../business/booking-state-machine';
import { PaymentService } from '../services/payment.service';
import { configService } from '../services/config.service';
import logger from '../lib/logger';

// ── Invoice Calculation Engine (AI_CONTEXT §5.B) ──────────────────────
interface BillingBreakdown {
    sparePartsCost: number;
    serviceLaborCost: number;
    subtotal: number;           // parts + labor
    uniteFixFeePercent: number; // 15%
    uniteFixFee: number;        // subtotal × 15%
    taxableAmount: number;      // subtotal + fee
    gstPercent: number;         // 18%
    cgst: number;               // 9%
    sgst: number;               // 9%
    grossTotal: number;         // taxableAmount + GST
    bookingFeeCredit: number;   // ₹99 already paid
    finalTotal: number;         // grossTotal - bookingFee (customer pays this)
    employeeEarnings: number;   // subtotal (parts + labor — employee keeps this)
}

async function calculateBilling(
    sparePartsCost: number,
    serviceLaborCost: number
): Promise<BillingBreakdown> {
    const feePercentStr = await configService.get<string>('BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT');
    const gstPercentStr = await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE');
    const bookingFeeStr = await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');

    const uniteFixFeePercent = parseFloat(feePercentStr || '15');
    const gstPercent = parseFloat(gstPercentStr || '18');
    const bookingFeeCredit = parseFloat(bookingFeeStr || '99');

    const subtotal = sparePartsCost + serviceLaborCost;
    const uniteFixFee = parseFloat((subtotal * uniteFixFeePercent / 100).toFixed(2));
    const taxableAmount = subtotal + uniteFixFee;
    const totalGst = parseFloat((taxableAmount * gstPercent / 100).toFixed(2));
    const cgst = parseFloat((totalGst / 2).toFixed(2));
    const sgst = parseFloat((totalGst - cgst).toFixed(2));
    const grossTotal = parseFloat((taxableAmount + totalGst).toFixed(2));
    const finalTotal = parseFloat(Math.max(0, grossTotal - bookingFeeCredit).toFixed(2));

    return {
        sparePartsCost,
        serviceLaborCost,
        subtotal,
        uniteFixFeePercent,
        uniteFixFee,
        taxableAmount,
        gstPercent,
        cgst,
        sgst,
        grossTotal,
        bookingFeeCredit,
        finalTotal,
        employeeEarnings: subtotal, // Employee gets parts + labor (pre-fee, pre-GST)
    };
}

export function registerBillingRoutes(app: Express) {

    /**
     * POST /api/v1/bookings/:id/submit-bill
     *
     * Employee submits spare parts cost + service labor cost.
     * Server calculates full billing breakdown and creates Razorpay order.
     * Transitions: IN_PROGRESS → PENDING_PAYMENT
     *
     * Body: { sparePartsCost: number, serviceLaborCost: number }
     */
    app.post('/api/v1/bookings/:id/submit-bill', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { sparePartsCost = 0, serviceLaborCost = 0 } = req.body;
            const partnerId = (req as any).partner?.partnerId;

            // Validate numeric inputs
            const parts = parseFloat(sparePartsCost);
            const labor = parseFloat(serviceLaborCost);

            if (isNaN(parts) || isNaN(labor) || parts < 0 || labor < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'sparePartsCost and serviceLaborCost must be non-negative numbers',
                });
            }

            if (parts + labor <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Total bill amount must be greater than zero',
                });
            }

            // Fetch booking
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.providerId !== partnerId) {
                return res.status(403).json({ success: false, message: 'This booking is not assigned to you' });
            }

            // State validation
            const currentState = booking.status as BookingState;
            if (!validateStateTransition(currentState, BookingState.PENDING_PAYMENT)) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot submit bill. Booking must be in 'in_progress' state. Current: '${currentState}'.`,
                });
            }

            // Calculate billing breakdown
            const billing = await calculateBilling(parts, labor);

            // Create Razorpay order for the balance due
            let razorpayOrder = null;
            try {
                razorpayOrder = await PaymentService.createFinalPaymentOrder(
                    bookingId,
                    billing.subtotal // Service charge = parts + labor
                );
            } catch (payErr: any) {
                logger.error(`[BILLING] Razorpay order creation failed for booking ${bookingId}:`, payErr.message);
                // Don't block the flow — mark as pending payment, customer can retry
            }

            // Transition to PENDING_PAYMENT
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.PENDING_PAYMENT as any,
                    totalAmount: Math.round(billing.grossTotal),
                    commissionAmount: Math.round(billing.uniteFixFee),
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            logger.info(`[BILLING] Bill submitted for booking ${bookingId}: parts=₹${parts}, labor=₹${labor}, total=₹${billing.finalTotal}`);

            res.json({
                success: true,
                message: 'Bill submitted. Waiting for customer payment.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    billing,
                    razorpayOrderId: razorpayOrder?.orderId || null,
                    amountDue: billing.finalTotal,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/v1/bookings/:id/billing
     *
     * Preview billing calculation without submitting.
     * Used by SubmitBillScreen to show real-time breakdown.
     */
    app.get('/api/v1/bookings/:id/billing', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const sparePartsCost = parseFloat(req.query.parts as string || '0');
            const serviceLaborCost = parseFloat(req.query.labor as string || '0');

            if (isNaN(sparePartsCost) || isNaN(serviceLaborCost)) {
                return res.status(400).json({ success: false, message: 'Invalid cost values' });
            }

            const billing = await calculateBilling(sparePartsCost, serviceLaborCost);

            res.json({ success: true, data: billing });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/v1/bookings/:id/cancel
     *
     * Customer cancels from CREATED state → triggers ₹99 Razorpay refund.
     */
    app.post('/api/v1/bookings/:id/cancel', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const userId = (req as any).user!.userId;

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.userId !== userId) {
                return res.status(403).json({ success: false, message: 'This booking does not belong to you' });
            }

            // Only cancellable from CREATED state (AI_CONTEXT §3.D)
            if (booking.status !== BookingState.CREATED) {
                return res.status(409).json({
                    success: false,
                    message: 'Booking can only be cancelled before an employee is assigned. Please contact support via WhatsApp.',
                    data: {
                        whatsappLink: `https://wa.me/${process.env.WHATSAPP_BUSINESS_NUMBER || '919999999999'}?text=${encodeURIComponent(`Booking ${booking.serviceId}: I need to cancel/reschedule`)}`,
                    },
                });
            }

            // Cancel the booking
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.CANCELLED as any,
                    bookingFeeStatus: 'refunded' as any,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            // Initiate ₹99 refund via Razorpay (best-effort)
            try {
                await PaymentService.refundBookingCharge(bookingId);
                logger.info(`[BILLING] Booking ${bookingId} cancelled + ₹99 refund initiated`);
            } catch (refundErr: any) {
                logger.error(`[BILLING] Refund failed for booking ${bookingId}:`, refundErr.message);
                // Still cancel — admin can manually refund
            }

            res.json({
                success: true,
                message: 'Booking cancelled. ₹99 refund will be processed within 5-7 business days.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    refundInitiated: true,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/v1/bookings/:id/support-link
     *
     * Returns WhatsApp deep link for bookings in ASSIGNED state or beyond (Task 5.9).
     */
    app.get('/api/v1/bookings/:id/support-link', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            const whatsappNumber = process.env.WHATSAPP_BUSINESS_NUMBER || '919999999999';
            const message = encodeURIComponent(
                `Hi UniteFix Support, I need help with booking ${booking.serviceId} (Status: ${booking.status})`
            );

            res.json({
                success: true,
                data: {
                    whatsappLink: `https://wa.me/${whatsappNumber}?text=${message}`,
                    canCancel: booking.status === BookingState.CREATED,
                    status: booking.status,
                },
            });
        } catch (error) {
            next(error);
        }
    });
}
