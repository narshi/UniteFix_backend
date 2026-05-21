/**
 * PHASE 5: Billing Routes — Employee bill submission + invoice calculation
 *
 * Flow:
 * 1. Employee submits spare_parts_cost + service_labor_cost (IN_PROGRESS state)
 * 2. BillingEngine calculates using FROZEN rates from booking's pricing_snapshot
 * 3. Creates Razorpay payment order for the balance due
 * 4. Transitions booking to PENDING_PAYMENT
 * 5. Webhook payment.captured → COMPLETED + employee wallet credit
 *
 * Also handles:
 * - ₹99 booking refund on cancellation from CREATED state
 * - WhatsApp support link for ASSIGNED+ bookings
 *
 * BILLING RULE: All financial math flows through BillingEngine. No inline formulas.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, sql } from 'drizzle-orm';
import { serviceRequests } from '@shared/schema';
import { authenticatePartner, authenticateToken, authenticateAny } from '../middleware/auth.middleware';
import { BookingState, validateStateTransition } from '../business/booking-state-machine';
import { PaymentService } from '../services/payment.service';
import { BillingEngine, type PricingSnapshot } from '../services/billing-engine';
import logger from '../lib/logger';

export function registerBillingRoutes(app: Express) {

    /**
     * POST /api/v1/bookings/:id/submit-bill
     *
     * Employee submits spare parts cost + service labor cost.
     * Uses the FROZEN pricing_snapshot from booking creation for calculation.
     * Transitions: IN_PROGRESS → PENDING_PAYMENT
     *
     * Body: { sparePartsCost: number, serviceLaborCost: number }
     */
    app.post('/api/bookings/:id/submit-bill', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
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

            // BILLING ENGINE: Use frozen snapshot from booking creation.
            // If booking was created before migration (no snapshot), build a legacy one.
            let existingSnapshot = booking.pricingSnapshot as PricingSnapshot | null;
            if (!existingSnapshot || !existingSnapshot.snapshotVersion) {
                existingSnapshot = BillingEngine.buildLegacySnapshot({
                    bookingFee: booking.bookingFee,
                    totalAmount: null, // Not yet billed
                    commissionAmount: null,
                });
            }

            // Calculate full billing using FROZEN rates (not live config)
            const billedSnapshot = BillingEngine.calculateFinalBill(parts, labor, existingSnapshot);

            // Create Razorpay order for the balance due
            let razorpayOrder = null;
            try {
                razorpayOrder = await PaymentService.createFinalPaymentOrder(
                    bookingId,
                    billedSnapshot.subtotal! // Service charge = parts + labor
                );
            } catch (payErr: any) {
                logger.error(`[BILLING] Razorpay order creation failed for booking ${bookingId}:`, payErr.message);
                // Don't block the flow — mark as pending payment, customer can retry
            }

            // Transition to PENDING_PAYMENT and freeze the complete billing snapshot
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.PENDING_PAYMENT as any,
                    totalAmount: billedSnapshot.grossTotal,
                    commissionAmount: billedSnapshot.platformFee,
                    pricingSnapshot: billedSnapshot as any,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            logger.info(`[BILLING] Bill submitted for booking ${bookingId}: parts=₹${parts}, labor=₹${labor}, grossTotal=₹${billedSnapshot.grossTotal}, finalDue=₹${billedSnapshot.finalTotal}`);

            res.json({
                success: true,
                message: 'Bill submitted. Waiting for customer payment.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    billing: billedSnapshot,
                    razorpayOrderId: razorpayOrder?.orderId || null,
                    amountDue: billedSnapshot.finalTotal,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/v1/bookings/:id/billing
     *
     * Preview billing calculation OR return the frozen snapshot.
     * If query params parts/labor are provided, calculates a preview.
     * If no params, returns the stored snapshot from the booking.
     * Used by SubmitBillScreen (partner) and FinalPaymentScreen (customer).
     */
    app.get('/api/bookings/:id/billing', authenticateAny, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);

            // Fetch booking to get the snapshot
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            const sparePartsCost = parseFloat(req.query.parts as string || '0');
            const serviceLaborCost = parseFloat(req.query.labor as string || '0');

            // If parts/labor are provided, return a preview calculation
            if (sparePartsCost > 0 || serviceLaborCost > 0) {
                let snapshot = booking.pricingSnapshot as PricingSnapshot | null;
                if (!snapshot || !snapshot.snapshotVersion) {
                    snapshot = BillingEngine.buildLegacySnapshot({
                        bookingFee: booking.bookingFee,
                        totalAmount: null,
                        commissionAmount: null,
                    });
                }

                const preview = BillingEngine.previewBill(sparePartsCost, serviceLaborCost, snapshot);
                return res.json({ success: true, data: { billing: preview } });
            }

            // No params — return the stored snapshot (for customer FinalPaymentScreen)
            if (booking.pricingSnapshot) {
                return res.json({ success: true, data: { billing: booking.pricingSnapshot } });
            }

            // Legacy booking without snapshot — build one from stored values
            const legacySnapshot = BillingEngine.buildLegacySnapshot({
                bookingFee: booking.bookingFee,
                totalAmount: booking.totalAmount,
                commissionAmount: booking.commissionAmount,
            });

            res.json({ success: true, data: { billing: legacySnapshot } });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/v1/bookings/:id/cancel
     *
     * Customer cancels from CREATED state → triggers ₹99 Razorpay refund.
     */
    app.post('/api/bookings/:id/cancel', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
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
    app.get('/api/bookings/:id/support-link', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
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
