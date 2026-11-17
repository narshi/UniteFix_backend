/**
 * Settling a disputed booking, after the investigation has decided who is right.
 *
 *   customer_right  The customer gets back what they paid. The expert's held
 *                   earning for the job is taken back in full (up to the amount
 *                   refunded). UniteFix's fee covers any part of the refund the
 *                   held earning does not.
 *   shared_fault    The customer gets back the amount the investigator sets. The
 *                   expert loses that same amount from the held earning and keeps
 *                   the rest of it.
 *   expert_right    No refund. The expert's held earning is released to them.
 *
 * One formula for all three:
 *     refund        = R        (customer_right: everything paid; shared: as set)
 *     taken back    = min(R, H)   from the expert's HELD earning H
 *     released      = H − taken back, to the expert's available balance
 *
 * Only the HELD earning can be taken back. Money already released to an expert's
 * available balance is not touched here: any part of R it would have covered is
 * reported, for a person to settle, rather than pushed into a negative balance.
 * The refund is sent first. It cannot be undone, so if the wallet step then fails,
 * the response says so and nothing else is guessed.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions, walletTransactionsV2, partnerWallets, serviceRequests } from '@shared/schema';
import { PaymentService } from './payment.service';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

export type DisputeOutcome = 'customer_right' | 'shared_fault' | 'expert_right';

/** The values the older dialog and tests send, mapped onto the three outcomes. */
export const LEGACY_OUTCOMES: Record<string, DisputeOutcome> = {
    refund_customer: 'customer_right',
    split: 'shared_fault',
    release_employee: 'expert_right',
};

export class DisputeOutcomeError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What the customer paid online for the booking, in rupees (one figure per Razorpay payment). */
async function paidRupees(bookingId: number): Promise<number> {
    const rows = await db.select({ pid: paymentTransactions.razorpayPaymentId, amount: paymentTransactions.amount })
        .from(paymentTransactions)
        .where(and(eq(paymentTransactions.serviceRequestId, bookingId), eq(paymentTransactions.status, 'captured' as any)));
    const byPayment = new Map<string, number>();
    for (const r of rows) {
        if (!r.pid || !(r.amount > 0)) continue;
        byPayment.set(r.pid, Math.max(byPayment.get(r.pid) ?? 0, r.amount));
    }
    return round2(Array.from(byPayment.values()).reduce((a, b) => a + b, 0) / 100);
}

export async function settleDispute(input: {
    bookingId: number;
    outcome: DisputeOutcome;
    /** Rupees to refund. Required for shared_fault; ignored otherwise. */
    refundRupees?: number | null;
    adminId: number;
    remarks: string;
}) {
    const { bookingId, outcome, adminId, remarks } = input;

    const [booking] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, bookingId)).limit(1);
    if (!booking) throw new DisputeOutcomeError('Booking not found', 404);
    if (booking.status !== 'disputed') throw new DisputeOutcomeError(`Booking must be in 'disputed' state. Current: '${booking.status}'.`, 409);

    const paid = await paidRupees(bookingId);

    let refund = 0;
    if (outcome === 'customer_right') refund = paid;
    if (outcome === 'shared_fault') {
        const r = Number(input.refundRupees);
        if (!Number.isFinite(r) || r <= 0) throw new DisputeOutcomeError('For a shared fault, enter the amount to refund the customer (more than ₹0).');
        if (r > paid) throw new DisputeOutcomeError(`The customer paid ₹${paid} online, so the refund cannot be more than that.`);
        refund = round2(r);
    }
    if (refund > paid) throw new DisputeOutcomeError(`The customer paid ₹${paid} online, so the refund cannot be more than that.`);

    // The expert's held earning for this job, not yet released.
    const providerId = booking.providerId;
    const holds = providerId ? await db.select().from(walletTransactionsV2).where(and(
        eq(walletTransactionsV2.partnerId, providerId),
        eq(walletTransactionsV2.serviceRequestId, bookingId),
        eq(walletTransactionsV2.transactionType, 'hold_credit'),
        eq(walletTransactionsV2.isReleased, false),
    )) : [];
    const held = round2(holds.reduce((a, h) => a + parseFloat(h.amount as any), 0));
    const takenBack = round2(Math.min(refund, held));
    const released = round2(held - takenBack);
    const uncovered = round2(refund - takenBack);      // refunded beyond what was still held: UniteFix's fee covers it

    // The wallet ledger allows one release and one adjustment per booking (a unique index).
    // Check before the refund goes out, so a booking that cannot be settled automatically
    // moves no money at all.
    if (providerId && held > 0 && (released > 0 || takenBack > 0)) {
        const [clash] = await db.select({ t: walletTransactionsV2.transactionType }).from(walletTransactionsV2)
            .where(and(eq(walletTransactionsV2.serviceRequestId, bookingId), inArray(walletTransactionsV2.transactionType, ['release', 'adjustment'] as any)))
            .limit(1);
        if (clash) throw new DisputeOutcomeError(`This booking already has a "${clash.t}" entry in the expert's wallet, so it cannot be settled automatically. Nothing was refunded. Settle it by hand.`, 409);
    }

    const summary = { outcome, paidOnline: paid, refunded: 0, heldBefore: held, takenBack, releasedToExpert: released, uncoveredByHeld: uncovered, refundId: null as string | null };
    const actions: string[] = [];

    // 1. The refund. Irreversible, so it goes first; a failure here moves no wallet money.
    if (refund > 0) {
        const r = await PaymentService.refundBookingPayments(bookingId, refund, `Dispute: ${outcome.replace(/_/g, ' ')} — ${remarks}`);
        summary.refunded = r.totalRefunded;
        summary.refundId = r.refunds.map(x => x.refundId).join(',');
        actions.push(`Refunded ₹${r.totalRefunded} to the customer`);
    }

    // 2. The expert's held earning: take back the refunded share, release the rest.
    if (providerId && held > 0) {
        await withTransaction(async (tx) => {
            for (const h of holds) {
                const [claimed] = await tx.update(walletTransactionsV2).set({ isReleased: true })
                    .where(and(eq(walletTransactionsV2.id, h.id), eq(walletTransactionsV2.isReleased, false)))
                    .returning({ id: walletTransactionsV2.id });
                if (!claimed) throw new Error('A held earning changed while the dispute was being settled. Nothing was moved from the wallet — check the booking.');
            }
            const [w] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, providerId)).limit(1).for('update');
            if (!w) throw new Error(`No wallet for expert #${providerId}`);
            const avail0 = parseFloat(w.balanceAvailable as any), hold0 = parseFloat(w.balanceHold as any);
            const avail1 = round2(avail0 + held), hold1 = round2(hold0 - held);
            const avail2 = round2(avail1 - takenBack);

            // The held earning is released (the ledger line the hourly job also writes)…
            await tx.update(partnerWallets).set({ balanceHold: hold1.toFixed(2), balanceAvailable: avail1.toFixed(2), updatedAt: new Date() })
                .where(eq(partnerWallets.partnerId, providerId));
            await tx.insert(walletTransactionsV2).values({
                transactionId: `DISP-REL-${bookingId}-${Date.now()}`, partnerId: providerId, serviceRequestId: bookingId,
                transactionType: 'release', amount: held.toFixed(2),
                balanceAvailableBefore: avail0.toFixed(2), balanceAvailableAfter: avail1.toFixed(2),
                balanceHoldBefore: hold0.toFixed(2), balanceHoldAfter: hold1.toFixed(2),
                description: `Dispute settled (${outcome.replace(/_/g, ' ')}): held earning of ₹${held} released`,
            } as any);

            // …and the refunded share is taken back out of it.
            if (takenBack > 0) {
                await tx.update(partnerWallets).set({ balanceAvailable: avail2.toFixed(2), updatedAt: new Date() })
                    .where(eq(partnerWallets.partnerId, providerId));
                await tx.insert(walletTransactionsV2).values({
                    transactionId: `DISP-CLAW-${bookingId}-${Date.now()}`, partnerId: providerId, serviceRequestId: bookingId,
                    transactionType: 'adjustment', amount: (-takenBack).toFixed(2),
                    balanceAvailableBefore: avail1.toFixed(2), balanceAvailableAfter: avail2.toFixed(2),
                    balanceHoldBefore: hold1.toFixed(2), balanceHoldAfter: hold1.toFixed(2),
                    description: `Taken back for the customer's refund (dispute: ${outcome.replace(/_/g, ' ')})`,
                } as any);
            }
        });
        actions.push(takenBack > 0 ? `Took ₹${takenBack} back from the expert's held earning` : 'Expert\'s held earning left whole');
        if (released > 0) actions.push(`Released ₹${released} of the held earning to the expert`);
    }
    if (uncovered > 0 && held > 0) {
        actions.push(`₹${uncovered} of the refund was more than the held earning; UniteFix's fee covers it`);
    }
    if (providerId && held === 0 && refund > 0) {
        actions.push('The expert\'s earning was already released, so nothing was taken back: check whether it should be recovered by hand');
    }

    logger.info(`[DISPUTE] booking #${bookingId} settled as ${outcome} by admin ${adminId}: refunded ₹${summary.refunded}, took back ₹${takenBack}, released ₹${released}`);
    return { ...summary, actions };
}
