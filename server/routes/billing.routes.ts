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
import { authenticatePartner, authenticateToken, authenticateAny, requireVerifiedPartner } from '../middleware/auth.middleware';
import { BookingState, validateStateTransition } from '../business/booking-state-machine';
import { PaymentService } from '../services/payment.service';
import { BillingEngine, type PricingSnapshot } from '../services/billing-engine';
import { BookingNotifications } from '../services/booking-notifications';
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
    app.post('/api/bookings/:id/submit-bill', authenticatePartner, requireVerifiedPartner, async (req: Request, res: Response, next: NextFunction) => {
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

            // Fixed-price (v2) bookings have no bill to submit — the price was frozen
            // at booking. Route them to request-payment instead of recomputing here.
            if ((booking.pricingSnapshot as any)?.snapshotVersion === 2) {
                return res.status(400).json({
                    success: false,
                    code: 'FIXED_PRICE_BOOKING',
                    message: 'This is a fixed-price booking. Use request-payment to collect the balance.',
                });
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

            // The expert is standing there waiting to be paid — the customer needs
            // this immediately, not on their next app open.
            void BookingNotifications.billSubmitted(bookingId, billedSnapshot.finalTotal ?? 0);

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
     * POST /api/bookings/:id/request-payment
     *
     * Fixed-price (v2) equivalent of submit-bill. The bill was frozen at booking
     * creation, so there is nothing to compute — this just moves the job to
     * PENDING_PAYMENT so the customer can pay the balance (finalTotal = P − 99).
     *
     * Optional body { extraPartsCost, partsNote }: a customer-approved parts add-on
     * that is passed straight through to the technician (added to the balance due
     * and to the technician's earning). Transitions: IN_PROGRESS → PENDING_PAYMENT.
     */
    app.post('/api/bookings/:id/request-payment', authenticatePartner, requireVerifiedPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const partnerId = (req as any).partner?.partnerId;
            const extraPartsCost = Math.max(0, Math.round(parseFloat(req.body?.extraPartsCost) || 0));
            const partsNote = typeof req.body?.partsNote === 'string' ? req.body.partsNote.trim().slice(0, 500) : '';

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.providerId !== partnerId) {
                return res.status(403).json({ success: false, message: 'This booking is not assigned to you' });
            }

            const snapshot = booking.pricingSnapshot as PricingSnapshot | null;
            if (!snapshot || snapshot.snapshotVersion !== 2) {
                return res.status(400).json({
                    success: false,
                    message: 'This booking is not a fixed-price booking. Use submit-bill.',
                });
            }

            const currentState = booking.status as BookingState;
            if (!validateStateTransition(currentState, BookingState.PENDING_PAYMENT)) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot request payment. Booking must be in 'in_progress' state. Current: '${currentState}'.`,
                });
            }

            // Apply an optional customer-approved parts add-on (pass-through to the
            // technician). The base breakdown (gst/fee on P) is untouched.
            const round2 = (x: number) => Math.round(x * 100) / 100;
            const updatedSnapshot: PricingSnapshot = extraPartsCost > 0
                ? {
                    ...snapshot,
                    grossTotal: round2((snapshot.grossTotal ?? 0) + extraPartsCost),
                    finalTotal: round2((snapshot.finalTotal ?? 0) + extraPartsCost),
                    technicianEarning: round2((snapshot.technicianEarning ?? 0) + extraPartsCost),
                    employeeEarnings: round2((snapshot.employeeEarnings ?? 0) + extraPartsCost),
                    extraPartsCost,
                    partsNote: partsNote || undefined,
                }
                : snapshot;

            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.PENDING_PAYMENT as any,
                    totalAmount: Math.round(updatedSnapshot.grossTotal ?? 0),
                    commissionAmount: Math.round(updatedSnapshot.platformFee ?? 0),
                    pricingSnapshot: updatedSnapshot as any,
                    serviceValueTier: BillingEngine.determineServiceValueTier(updatedSnapshot) as any,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            logger.info(`[BILLING] v2 request-payment booking ${bookingId}: finalDue=₹${updatedSnapshot.finalTotal}` +
                (extraPartsCost > 0 ? ` (incl. ₹${extraPartsCost} approved parts)` : ''));

            void BookingNotifications.billSubmitted(bookingId, updatedSnapshot.finalTotal ?? 0);

            res.json({
                success: true,
                message: 'Payment requested. Waiting for customer payment.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    amountDue: updatedSnapshot.finalTotal,
                    technicianEarning: updatedSnapshot.technicianEarning,
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

            // Cancel the booking. bookingFeeStatus is deliberately NOT set here —
            // it previously read 'refunded' before the refund was even attempted,
            // so a silently failed refund was indistinguishable from a real one.
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.CANCELLED as any,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            // Only attempt a refund if the fee was actually collected.
            const feeWasPaid = booking.bookingFeeStatus === 'paid';
            let refundInitiated = false;
            let refundedAmount = 0;
            let refundMessage: string;

            if (!feeWasPaid) {
                refundMessage = 'Booking cancelled. No booking fee had been charged.';
                logger.info(`[BILLING] Booking ${bookingId} cancelled — fee was never captured, no refund due`);
            } else {
                try {
                    const refund = await PaymentService.refundBookingCharge(bookingId);
                    refundInitiated = true;
                    refundedAmount = refund.amountRupees;

                    // Only now is 'refunded' true.
                    await db.update(serviceRequests)
                        .set({ bookingFeeStatus: 'refunded' as any, updatedAt: new Date() })
                        .where(eq(serviceRequests.id, bookingId));

                    refundMessage = refund.alreadyRefunded
                        ? 'Booking cancelled. A refund was already issued for this booking.'
                        : `Booking cancelled. ₹${refundedAmount} will be credited within 5-7 business days.`;
                    logger.info(`[BILLING] Booking ${bookingId} cancelled + ₹${refundedAmount} refunded`);
                } catch (refundErr: any) {
                    // The booking is still cancelled, but the fee remains 'paid' so
                    // the outstanding refund shows up for manual reconciliation
                    // instead of disappearing.
                    logger.error(
                        `[BILLING] REFUND FAILED for booking ${bookingId} — manual refund required: ${refundErr.message}`,
                    );
                    refundMessage =
                        'Booking cancelled. Your refund needs manual processing — our team will contact you shortly.';
                }
            }

            void BookingNotifications.bookingCancelled(bookingId, req.body?.reason);

            res.json({
                success: true,
                message: refundMessage,
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    refundInitiated,
                    refundedAmount,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/v1/bookings/:id/support-link
     *
     * Returns WhatsApp deep link for bookings in ASSIGNED state or beyond.
     * For completed/cancelled bookings, enforces a configurable support window (default 48h).
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

            // Support window check for terminal states
            const terminalStates = ['completed', 'cancelled', 'disputed'];
            const isTerminal = terminalStates.includes(booking.status);
            const supportWindowHours = 48; // Could be fetched from configService
            let supportExpired = false;

            if (isTerminal && booking.completedAt) {
                const completedTime = new Date(booking.completedAt).getTime();
                const windowMs = supportWindowHours * 60 * 60 * 1000;
                supportExpired = Date.now() - completedTime > windowMs;
            }

            res.json({
                success: true,
                data: {
                    whatsappLink: `https://wa.me/${whatsappNumber}?text=${message}`,
                    canCancel: booking.status === BookingState.CREATED,
                    status: booking.status,
                    supportExpired,
                    supportWindowHours,
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
    app.post('/api/bookings/:id/cash-collected', authenticatePartner, requireVerifiedPartner, async (req: Request, res: Response, next: NextFunction) => {
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

            void BookingNotifications.paymentReceived(bookingId, amountCollected, 'cash');
            void BookingNotifications.serviceCompleted(bookingId, snapshot.employeeEarnings);

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
