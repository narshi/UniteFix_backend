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
import { serviceRequests, employees } from '@shared/schema';
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

            // Double submission guard
            if (booking.pricingSnapshot && (booking.pricingSnapshot as any).billedAt) {
                 return res.status(409).json({
                     success: false,
                     message: 'Bill has already been submitted for this booking',
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
            const serviceValueTier = BillingEngine.determineServiceValueTier(billedSnapshot);
            const snapshotToSave = {
                ...billedSnapshot,
                billedAt: new Date().toISOString()
            };
            
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.PENDING_PAYMENT as any,
                    totalAmount: billedSnapshot.grossTotal,
                    commissionAmount: billedSnapshot.platformFee,
                    pricingSnapshot: snapshotToSave as any,
                    serviceValueTier: serviceValueTier as any,
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

    /**
     * POST /api/bookings/:id/cash-collected
     *
     * Employee confirms customer paid cash.
     * Gate: Booking must be in PENDING_PAYMENT state.
     * Actions:
     *   1. Validate amountCollected matches finalTotal (±₹1 tolerance)
     *   2. Debit UniteFix's share (platformFee + GST) from employee wallet
     *   3. Transition → COMPLETED with paymentMethod = 'cash'
     *   4. Generate invoice
     *   5. Record to audit trail
     *
     * Body: { amountCollected: number }
     */
    app.post('/api/bookings/:id/cash-collected', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { amountCollected } = req.body;
            const partnerId = (req as any).partner?.partnerId;

            if (!amountCollected || typeof amountCollected !== 'number' || amountCollected <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'amountCollected must be a positive number',
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

            // Idempotency check: if already completed with cash, return success
            if (booking.status === BookingState.COMPLETED && booking.paymentMethod === 'cash') {
                return res.json({
                    success: true,
                    message: 'Cash payment already recorded successfully.',
                });
            }

            // State validation — must be PENDING_PAYMENT
            if (booking.status !== BookingState.PENDING_PAYMENT) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot collect cash. Booking must be in 'pending_payment' state. Current: '${booking.status}'.`,
                });
            }

            // Get the frozen billing snapshot
            const snapshot = booking.pricingSnapshot as PricingSnapshot | null;
            if (!snapshot || !snapshot.finalTotal) {
                return res.status(400).json({
                    success: false,
                    message: 'Billing snapshot not found. Submit the bill first.',
                });
            }

            // Validate amount matches expected finalTotal (±₹1 tolerance for rounding)
            const expectedAmount = snapshot.finalTotal;
            if (Math.abs(amountCollected - expectedAmount) > 1) {
                return res.status(400).json({
                    success: false,
                    message: `Amount mismatch. Expected ₹${expectedAmount}, received ₹${amountCollected}.`,
                    data: { expectedAmount, receivedAmount: amountCollected },
                });
            }

            // Calculate UniteFix's share to debit from employee wallet
            const platformDebit = BillingEngine.calculateCashDebitAmount(snapshot);

            // Debit employee wallet (allow negative — recovered from future earnings)
            let walletTransaction = null;
            try {
                const { storage } = await import('../storage');
                walletTransaction = await storage.deductProviderWallet(
                    partnerId,
                    platformDebit,
                    `Platform fee — cash payment booking #${booking.serviceId}`,
                    true // allowNegative: UniteFix always recovers its share
                );
            } catch (walletErr: any) {
                logger.error(`[CASH] Wallet debit failed for booking ${bookingId}:`, walletErr.message);
                // Don't block the completion — log and continue
            }

            // Transition to COMPLETED
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.COMPLETED as any,
                    paymentMethod: 'cash' as any,
                    cashCollectedBy: partnerId,
                    cashCollectedAt: new Date(),
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            // Generate invoice
            let invoiceId = null;
            try {
                const invoice = await PaymentService.generateInvoice(
                    bookingId,
                    booking.userId,
                    partnerId
                );
                invoiceId = invoice.invoiceId;
            } catch (invErr: any) {
                logger.warn(`[CASH] Invoice generation failed for booking ${bookingId}:`, invErr.message);
            }

            logger.info(`[CASH] Cash collected for booking ${bookingId}: amount=₹${amountCollected}, platformDebit=₹${platformDebit}, employee=${partnerId}`);

            res.json({
                success: true,
                message: 'Cash payment recorded. Service completed.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    paymentMethod: 'cash',
                    amountCollected,
                    platformFeeDeducted: platformDebit,
                    employeeEarnings: snapshot.employeeEarnings,
                    invoiceId,
                    walletTransaction: walletTransaction ? {
                        balanceBefore: walletTransaction.balanceBefore,
                        balanceAfter: walletTransaction.balanceAfter,
                    } : null,
                },
            });
        } catch (error) {
            next(error);
        }
    });
}
