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

/** Earning released to the expert for this booking, before any dispute. */
async function releasedHoldSum(providerId: number, bookingId: number): Promise<number> {
    const [r] = await db.select({ n: sql<string>`coalesce(sum(${walletTransactionsV2.amount}), 0)` }).from(walletTransactionsV2)
        .where(and(eq(walletTransactionsV2.partnerId, providerId), eq(walletTransactionsV2.serviceRequestId, bookingId),
            eq(walletTransactionsV2.transactionType, 'hold_credit'), eq(walletTransactionsV2.isReleased, true)));
    return round2(Number(r?.n ?? 0));
}

/** Earning currently held for this booking because a dispute was opened on it. */
async function disputeHoldSum(providerId: number, bookingId: number): Promise<number> {
    const [r] = await db.select({ n: sql<string>`coalesce(sum(${walletTransactionsV2.amount}), 0)` }).from(walletTransactionsV2)
        .where(and(eq(walletTransactionsV2.partnerId, providerId), eq(walletTransactionsV2.serviceRequestId, bookingId), eq(walletTransactionsV2.transactionType, 'dispute_hold' as any)));
    return round2(Number(r?.n ?? 0));
}

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
    const heldNow = round2(holds.reduce((a, h) => a + parseFloat(h.amount as any), 0));
    // Earning put back on hold when the dispute was opened (holdDisputedEarning) is held too.
    const reheld = providerId ? await disputeHoldSum(providerId, bookingId) : 0;
    const held = round2(heldNow + reheld);
    const takenBack = round2(Math.min(refund, held));
    const released = round2(held - takenBack);
    const uncovered = round2(refund - takenBack);      // refunded beyond what was still held: UniteFix's fee covers it
    // Released to the expert before the dispute and no longer on hold (already withdrawn):
    // not recoverable from the wallet, so it is for a person to settle, not UniteFix's fee.
    const withdrawnAway = providerId ? round2(Math.max(0, (await releasedHoldSum(providerId, bookingId)) - reheld)) : 0;

    // The wallet ledger allows one release and one adjustment per booking (a unique index).
    // Check before the refund goes out, so a booking that cannot be settled automatically
    // moves no money at all.
    if (providerId && held > 0 && (released > 0 || takenBack > 0)) {
        const [clash] = await db.select({ t: walletTransactionsV2.transactionType }).from(walletTransactionsV2)
            .where(and(eq(walletTransactionsV2.serviceRequestId, bookingId), inArray(walletTransactionsV2.transactionType, ['dispute_release', 'dispute_takeback'] as any)))
            .limit(1);
        if (clash) throw new DisputeOutcomeError(`This booking already has a "${clash.t}" entry in the expert's wallet, so it cannot be settled automatically. Nothing was refunded. Settle it by hand.`, 409);
    }

    const summary = { outcome, paidOnline: paid, refunded: 0, heldBefore: held, takenBack, releasedToExpert: released, uncoveredByHeld: uncovered, withdrawnAway, refundId: null as string | null };
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
                transactionType: 'dispute_release', amount: held.toFixed(2),
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
                    transactionType: 'dispute_takeback', amount: (-takenBack).toFixed(2),
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
    if (withdrawnAway > 0) {
        actions.push(`₹${withdrawnAway} of the expert's earning was already withdrawn and could not be taken back: settle it by hand`);
    }

    logger.info(`[DISPUTE] booking #${bookingId} settled as ${outcome} by admin ${adminId}: refunded ₹${summary.refunded}, took back ₹${takenBack}, released ₹${released}`);
    return { ...summary, actions };
}

/**
 * A dispute has been opened on the booking. Any earning already released to the expert
 * goes back into their HOLD, so it cannot be withdrawn while the case is open and the
 * settlement can take it back. Only what is still in their available balance can move;
 * the rest (already withdrawn) is reported as a shortfall for a person to settle.
 * Runs once per booking: a second call moves nothing.
 */
export async function holdDisputedEarning(bookingId: number, adminId: number): Promise<{ moved: number; shortfall: number }> {
    const [booking] = await db.select({ providerId: serviceRequests.providerId }).from(serviceRequests).where(eq(serviceRequests.id, bookingId)).limit(1);
    const providerId = booking?.providerId;
    if (!providerId) return { moved: 0, shortfall: 0 };

    const [already] = await db.select({ id: walletTransactionsV2.id }).from(walletTransactionsV2)
        .where(and(eq(walletTransactionsV2.serviceRequestId, bookingId), eq(walletTransactionsV2.transactionType, 'dispute_hold'))).limit(1);
    if (already) return { moved: 0, shortfall: 0 };

    const released = await db.select({ amount: walletTransactionsV2.amount }).from(walletTransactionsV2).where(and(
        eq(walletTransactionsV2.partnerId, providerId),
        eq(walletTransactionsV2.serviceRequestId, bookingId),
        eq(walletTransactionsV2.transactionType, 'hold_credit'),
        eq(walletTransactionsV2.isReleased, true),
    ));
    const releasedAmt = round2(released.reduce((a, r) => a + parseFloat(r.amount as any), 0));
    if (releasedAmt <= 0) return { moved: 0, shortfall: 0 };

    let moved = 0;
    await withTransaction(async (tx) => {
        const [w] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, providerId)).limit(1).for('update');
        if (!w) throw new Error(`No wallet for expert #${providerId}`);
        const avail0 = parseFloat(w.balanceAvailable as any), hold0 = parseFloat(w.balanceHold as any);
        moved = round2(Math.min(releasedAmt, Math.max(0, avail0)));
        if (moved <= 0) return;
        const avail1 = round2(avail0 - moved), hold1 = round2(hold0 + moved);
        await tx.update(partnerWallets).set({ balanceHold: hold1.toFixed(2), balanceAvailable: avail1.toFixed(2), updatedAt: new Date() })
            .where(eq(partnerWallets.partnerId, providerId));
        await tx.insert(walletTransactionsV2).values({
            transactionId: `DISP-HOLD-${bookingId}-${Date.now()}`, partnerId: providerId, serviceRequestId: bookingId,
            transactionType: 'dispute_hold', amount: moved.toFixed(2),
            balanceAvailableBefore: avail0.toFixed(2), balanceAvailableAfter: avail1.toFixed(2),
            balanceHoldBefore: hold0.toFixed(2), balanceHoldAfter: hold1.toFixed(2),
            description: `Dispute opened: ₹${moved} of released earning back on hold until it is settled`,
        } as any);
    });
    const shortfall = round2(releasedAmt - moved);
    logger.info(`[DISPUTE] booking #${bookingId}: ₹${moved} back on hold for the expert${shortfall > 0 ? `, ₹${shortfall} already withdrawn` : ''} (admin ${adminId})`);
    return { moved, shortfall };
}
