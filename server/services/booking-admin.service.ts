/**
 * Staff cancelling or closing a booking from the admin.
 *
 * CANCEL, at any stage before completion. Staff choose what happens to the
 * money the customer paid online (the advance, or the whole price on a prepaid
 * booking): refund all of it, refund part and keep a visit charge, or keep it.
 * They may also pay the expert for a wasted trip. Refund first: if Razorpay
 * refuses it, nothing is cancelled and staff can choose again.
 *
 * CLOSE, when the work was done but the app could not finish it: the customer
 * paid the balance in cash to the expert, or straight to UniteFix (cash at the
 * office, UPI, bank). The money moves exactly as if the app had done it: cash
 * with the expert settles the wallet like "Cash collected"; money UniteFix
 * received credits the expert's earning, held, like an online payment.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { serviceRequests, partRequests } from '@shared/schema';
import { configService } from './config.service';
import { BookingNotifications } from './booking-notifications';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';
import type { PricingSnapshot } from './billing-engine';

export class BookingAdminError extends Error {
    constructor(message: string, public status = 400, public code = 'BAD_REQUEST') { super(message); }
}

const OPEN = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'] as const;
const WORKED = ['assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'] as const;
export type CloseMethod = 'expert_cash' | 'office_cash' | 'upi' | 'bank' | 'other';
const CLOSE_LABEL: Record<CloseMethod, string> = {
    expert_cash: 'cash to the expert', office_cash: 'cash at the UniteFix office', upi: 'UPI to UniteFix', bank: 'bank transfer to UniteFix', other: 'paid to UniteFix',
};

const rupees = (paise: number) => Math.round(paise) / 100;

export class BookingAdminService {
    /** What staff need to choose a refund: what the customer paid online, and who has the job. */
    static async cancelPreview(id: number) {
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        if (!sr) throw new BookingAdminError('Booking not found.', 404, 'NOT_FOUND');
        const { PaymentService } = await import('./payment.service');
        const paidPaise = sr.bookingFeeStatus === 'paid' ? await PaymentService.capturedBookingChargePaise(id) : 0;
        return { status: sr.status, paidOnline: rupees(paidPaise), hasExpert: !!sr.providerId, cancellable: (OPEN as readonly string[]).includes(sr.status as string) };
    }

    static async cancel(id: number, adminId: number, input: { reason?: string; refund?: 'full' | 'partial' | 'none'; refundRupees?: number; visitPayRupees?: number }) {
        const reason = String(input.reason ?? '').trim();
        if (reason.length < 3) throw new BookingAdminError('Say why it is being cancelled; the customer and the expert are told.', 400, 'NO_REASON');
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        if (!sr) throw new BookingAdminError('Booking not found.', 404, 'NOT_FOUND');
        if (!(OPEN as readonly string[]).includes(sr.status as string)) {
            throw new BookingAdminError(`This booking is ${String(sr.status).replace(/_/g, ' ')} and cannot be cancelled.`, 409, 'BAD_STATE');
        }

        const visitPay = Math.round((Number(input.visitPayRupees) || 0) * 100);
        if (visitPay < 0 || visitPay > 500_000) throw new BookingAdminError('Visit pay must be between ₹0 and ₹5,000.', 400, 'BAD_VISIT_PAY');
        if (visitPay > 0 && !sr.providerId) throw new BookingAdminError('No expert is on this booking to pay for a visit.', 400, 'NO_EXPERT');

        // 1. Refund. Before anything else changes, so a refused refund leaves the booking as it was.
        const { PaymentService } = await import('./payment.service');
        const paidPaise = sr.bookingFeeStatus === 'paid' ? await PaymentService.capturedBookingChargePaise(id) : 0;
        const mode = input.refund ?? (paidPaise > 0 ? 'full' : 'none');
        let refundPaise = 0;
        if (mode !== 'none' && paidPaise > 0) {
            refundPaise = mode === 'full' ? paidPaise : Math.round((Number(input.refundRupees) || 0) * 100);
            if (mode === 'partial' && (refundPaise <= 0 || refundPaise > paidPaise)) {
                throw new BookingAdminError(`A part refund must be between ₹0.01 and the ₹${rupees(paidPaise)} the customer paid.`, 400, 'BAD_REFUND');
            }
            try {
                await PaymentService.refundBookingCharge(id, { amountPaise: refundPaise, reason: `Cancelled by UniteFix: ${reason}`.slice(0, 250) });
            } catch (err: any) {
                logger.error(`[ADMIN CANCEL] Refund failed for SR ${id}: ${err.message}`);
                throw new BookingAdminError(`Razorpay did not accept the refund (${err.message}). Nothing was cancelled; try again or choose "No refund" and refund by hand.`, 502, 'REFUND_FAILED');
            }
        }

        // 2. Cancel, claiming the row so two staff cannot both cancel it.
        const [done] = await db.update(serviceRequests).set({
            status: 'cancelled' as any,
            bookingFeeStatus: refundPaise > 0 && refundPaise === paidPaise ? 'refunded' as any : sr.bookingFeeStatus,
            cancelReason: reason.slice(0, 500), cancelledAt: new Date(), cancelledByAdminId: adminId,
            refundPaise, visitPayPaise: visitPay, updatedAt: new Date(),
        }).where(and(eq(serviceRequests.id, id), inArray(serviceRequests.status, OPEN as any))).returning();
        if (!done) throw new BookingAdminError('Someone else changed this booking just now. Refresh and check it.', 409, 'CHANGED');

        // 3. Anything still waiting on the customer is void.
        await db.update(partRequests).set({ status: 'cancelled' }).where(and(eq(partRequests.serviceRequestId, id), eq(partRequests.status, 'pending')));

        // 4. Pay the expert for the trip, held like any earning.
        if (visitPay > 0 && sr.providerId) {
            const { storage } = await import('../storage');
            const holdDays = Number(await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7));
            await storage.creditWalletOnHold(sr.providerId, id, rupees(visitPay), new Date(Date.now() + holdDays * 86_400_000), undefined,
                { description: `Visit pay — booking ${sr.serviceId} cancelled by UniteFix`, countService: false });
        }

        await recordAudit({
            entityType: 'service_request', entityId: id, action: 'admin_cancelled', fromState: sr.status as string, toState: 'cancelled', changedBy: adminId,
            metadata: { reason, refundRupees: rupees(refundPaise), paidOnlineRupees: rupees(paidPaise), visitPayRupees: rupees(visitPay), expertId: sr.providerId, partnerId: sr.dispatchPartnerId },
        });
        void BookingNotifications.cancelledByUniteFix(id, reason, rupees(refundPaise));
        if (sr.dispatchPartnerId) {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(sr.dispatchPartnerId, 'job_new' as any, { title: `Job ${sr.serviceId} cancelled`, body: `UniteFix cancelled this job: ${reason}`, link: '/partner/field/jobs', refType: 'service_request', refId: id }).catch(() => {});
        }
        const parts = [refundPaise > 0 ? `₹${rupees(refundPaise)} refunded to the customer` : paidPaise > 0 ? 'no refund' : null, visitPay > 0 ? `₹${rupees(visitPay)} visit pay to the expert` : null].filter(Boolean);
        return { booking: done, refundRupees: rupees(refundPaise), visitPayRupees: rupees(visitPay), message: `Cancelled${parts.length ? `: ${parts.join(', ')}` : ''}.` };
    }

    static async close(id: number, adminId: number, input: { method?: CloseMethod; amountRupees?: number; reference?: string; note?: string }) {
        const method = input.method as CloseMethod;
        if (!(method in CLOSE_LABEL)) throw new BookingAdminError('Choose how the customer paid.', 400, 'BAD_METHOD');
        const note = String(input.note ?? '').trim();
        if (note.length < 3) throw new BookingAdminError('Add a note on why it is being closed here and not in the app.', 400, 'NO_NOTE');
        const reference = String(input.reference ?? '').trim().slice(0, 80);
        if ((method === 'upi' || method === 'bank') && reference.length < 4) throw new BookingAdminError('Enter the UTR or UPI reference of the payment.', 400, 'NO_REFERENCE');

        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        if (!sr) throw new BookingAdminError('Booking not found.', 404, 'NOT_FOUND');
        if (!(WORKED as readonly string[]).includes(sr.status as string)) {
            throw new BookingAdminError(`This booking is ${String(sr.status).replace(/_/g, ' ')}; only a job someone is working on can be closed.`, 409, 'BAD_STATE');
        }
        if (!sr.providerId) throw new BookingAdminError('Assign the expert who did the work first, so they are paid.', 409, 'NO_EXPERT');
        const snapshot = sr.pricingSnapshot as PricingSnapshot | null;
        if (!snapshot || snapshot.finalTotal == null || (snapshot.snapshotVersion !== 2 && !snapshot.billedAt)) {
            throw new BookingAdminError('This job has no bill yet. The expert enters the charges in the app first.', 409, 'NO_BILL');
        }
        const due = Number(snapshot.finalTotal);
        const amount = Number(input.amountRupees);
        if (!Number.isFinite(amount) || Math.abs(amount - due) > 1) {
            throw new BookingAdminError(`The balance on the bill is ₹${due}. Enter that amount; a different amount needs the bill changed first.`, 400, 'AMOUNT_MISMATCH');
        }

        // Claim it: completed now, so a double click or a late payment cannot settle twice.
        const expertCash = method === 'expert_cash';
        const [done] = await db.update(serviceRequests).set({
            status: 'completed' as any, completedAt: new Date(), updatedAt: new Date(),
            paymentMethod: (expertCash || method === 'office_cash' ? 'cash' : 'online') as any,
            ...(expertCash ? { cashCollectedBy: sr.providerId, cashCollectedAt: new Date() } : {}),
            closedByAdminId: adminId, closeMethod: method, closeReference: reference || null, closeNote: note.slice(0, 500),
        }).where(and(eq(serviceRequests.id, id), inArray(serviceRequests.status, WORKED as any))).returning();
        if (!done) throw new BookingAdminError('Someone else changed this booking just now. Refresh and check it.', 409, 'CHANGED');

        const { storage } = await import('../storage');
        try {
            if (expertCash) {
                // The expert holds the cash: settle the difference on the wallet.
                const { JobSettlementService } = await import('./job-settlement.service');
                await JobSettlementService.settleCash(sr, snapshot, sr.providerId);
            } else {
                // UniteFix has the money: the expert's earning, held, as for an online payment.
                const holdDays = Number(await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7));
                await storage.creditWalletOnHold(sr.providerId, id, await storage.technicianEarningFor(sr), new Date(Date.now() + holdDays * 86_400_000));
            }
        } catch (err: any) {
            // Put it back so staff can try again, rather than leave a completed job unpaid.
            await db.update(serviceRequests).set({ status: sr.status as any, completedAt: null, paymentMethod: sr.paymentMethod as any, cashCollectedBy: sr.cashCollectedBy, cashCollectedAt: sr.cashCollectedAt, closedByAdminId: null, closeMethod: null, closeReference: null, closeNote: null, updatedAt: new Date() }).where(eq(serviceRequests.id, id));
            logger.error(`[ADMIN CLOSE] Settlement failed for SR ${id}: ${err.message}`);
            throw new BookingAdminError(`The expert's wallet could not be updated (${err.message}). The booking was not closed; try again.`, 500, 'SETTLE_FAILED');
        }

        try {
            const { PaymentService } = await import('./payment.service');
            await PaymentService.generateInvoice(id, sr.userId, sr.providerId);
        } catch (err: any) { logger.warn(`[ADMIN CLOSE] Invoice failed for SR ${id}: ${err.message}`); }

        await recordAudit({
            entityType: 'service_request', entityId: id, action: 'admin_closed', fromState: sr.status as string, toState: 'completed', changedBy: adminId,
            metadata: { method, amountRupees: amount, reference: reference || null, note, expertId: sr.providerId, partnerId: sr.dispatchPartnerId },
        });
        void BookingNotifications.paymentReceived(id, amount, CLOSE_LABEL[method]);
        void BookingNotifications.serviceCompleted(id, snapshot.technicianEarning ?? snapshot.employeeEarnings);
        return { booking: done, message: `Closed as completed: ₹${amount} ${CLOSE_LABEL[method]}.` };
    }
}
