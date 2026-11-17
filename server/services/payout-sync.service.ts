/**
 * Reconciling an expert's withdrawal with what Cashfree says happened to the
 * transfer.
 *
 * WHY THIS EXISTS
 * A withdrawal that staff approve is sent to Cashfree and left at 'processing'.
 * Nothing told us how it ended: there is no Cashfree webhook route, so a paid
 * payout stayed at 'processing' for ever, and a failed or reversed one never
 * returned the money to the expert's wallet — it sat in limbo until a member of
 * staff happened to press "Sync" on that row.
 *
 * Two callers now share one code path:
 *   - the Sync button (routes/admin-withdrawals.routes.ts), for one request
 *   - a background job (syncProcessingPayouts), every 15 minutes, for all of
 *     those still in flight
 *
 * RULES
 *   - Every change of state is a CLAIM: a conditional UPDATE that only the
 *     caller who moves the row from its expected state gets a row back from.
 *     The money moves only for that caller. The old button read the status,
 *     decided, then wrote — pressed twice at once (or pressed while the job ran)
 *     it refunded the wallet twice.
 *   - "Failed" or "reversed" puts the money back in ONE transaction with the
 *     wallet row locked, so the ledger's before/after figures are the real ones.
 *   - Never guess. If Cashfree cannot be reached, or has no such transfer, or
 *     still says it is in progress, the request is left exactly as it is.
 *   - If Cashfree says the transfer SUCCEEDED for a request we had already
 *     marked failed and refunded, money has gone out twice over. Nothing is
 *     changed automatically; it is logged as an error and written to the audit
 *     trail for a person to settle.
 */

import { and, asc, eq, inArray, like, lt } from 'drizzle-orm';
import { db } from '../db';
import { withdrawalRequests, partnerWallets, walletTransactionsV2 } from '@shared/schema';
import { CashfreeService } from './cashfree.service';
import { BookingNotifications } from './booking-notifications';
import { recordAudit } from '../lib/audit';
import { withTransaction } from '../lib/transaction';
import { cashfreeKeys } from '../lib/cashfree-env';
import logger from '../lib/logger';

export class PayoutSyncError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

export type SyncResult = {
    /** What Cashfree reports: processed | processing | failed | reversed. */
    payoutStatus: string;
    /** The withdrawal's own status afterwards. */
    localStatus: string;
    /** What this call did. */
    changed: 'completed' | 'refunded' | 'flagged' | 'none';
    message: string;
};

export type SyncVia = 'admin_sync' | 'scheduled_sync';

/** A transfer id this server sent to Cashfree (WDRW_<id> or WDRW_<id>_<attempt>). */
const OUR_TRANSFER = /^WDRW_\d+(_\d+)?$/;

export class PayoutSyncService {

    /**
     * Ask Cashfree about one withdrawal and bring our record in line.
     * Throws PayoutSyncError for a request that cannot be reconciled, and
     * whatever CashfreeService throws when Cashfree cannot be asked.
     */
    static async reconcile(withdrawalId: number, actorAdminId: number | null, via: SyncVia): Promise<SyncResult> {
        const [w] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawalId)).limit(1);
        if (!w) throw new PayoutSyncError('Withdrawal request not found', 404);
        if (!w.razorpayPayoutId) throw new PayoutSyncError('No payout has been issued for this request yet.');
        if (w.razorpayPayoutId.startsWith('manual_txn_')) throw new PayoutSyncError('This one was paid by hand, so there is nothing at Cashfree to check.');

        const { status, providerStatus, failureReason, utr } = await CashfreeService.fetchPayoutStatus(w.razorpayPayoutId);
        const amount = parseFloat(w.amount as any);

        // ── Paid ────────────────────────────────────────────────────────
        if (status === 'processed') {
            const [claimed] = await db.update(withdrawalRequests)
                .set({ status: 'completed', updatedAt: new Date() })
                .where(and(eq(withdrawalRequests.id, withdrawalId), eq(withdrawalRequests.status, 'processing')))
                .returning({ id: withdrawalRequests.id });

            if (claimed) {
                await recordAudit({
                    entityType: 'withdrawal', entityId: withdrawalId, action: 'withdrawal_completed',
                    changedBy: actorAdminId, fromState: 'processing', toState: 'completed',
                    metadata: { amount, partnerId: w.partnerId, transferId: w.razorpayPayoutId, utr, providerStatus, reconciledVia: via },
                });
                return { payoutStatus: status, localStatus: 'completed', changed: 'completed', message: 'Payout confirmed as paid.' };
            }

            const [now] = await db.select({ status: withdrawalRequests.status }).from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawalId)).limit(1);
            if (now?.status === 'failed') {
                // Paid at Cashfree, but we had refunded the expert. A person has to settle it.
                logger.error(`[PAYOUT_SYNC] withdrawal #${withdrawalId}: Cashfree says transfer ${w.razorpayPayoutId} SUCCEEDED, but it is marked failed and the wallet was refunded — the expert has been paid twice. Needs staff.`, { utr });
                await recordAudit({
                    entityType: 'withdrawal', entityId: withdrawalId, action: 'withdrawal_paid_after_refund',
                    changedBy: actorAdminId, fromState: 'failed', toState: 'failed',
                    metadata: { amount, partnerId: w.partnerId, transferId: w.razorpayPayoutId, utr, providerStatus, reconciledVia: via, needsStaff: true },
                });
                return { payoutStatus: status, localStatus: 'failed', changed: 'flagged', message: 'Cashfree says this transfer was PAID, but the request was marked failed and the wallet refunded. The expert has been paid twice: settle it by hand. Nothing was changed.' };
            }
            return { payoutStatus: status, localStatus: now?.status ?? w.status, changed: 'none', message: 'Already recorded as paid.' };
        }

        // ── Failed or reversed ──────────────────────────────────────────
        if (status === 'failed' || status === 'reversed') {
            // A reversal can come after the money was recorded as paid; a plain failure cannot.
            const from = status === 'reversed' ? ['processing', 'completed'] : ['processing'];
            const reason = failureReason || `Payout ${status}`;

            const refunded = await withTransaction(async (tx) => {
                const [claimed] = await tx.update(withdrawalRequests)
                    .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
                    .where(and(eq(withdrawalRequests.id, withdrawalId), inArray(withdrawalRequests.status, from as any)))
                    .returning({ id: withdrawalRequests.id });
                if (!claimed) return false;        // another caller got there first, or it was already settled

                const [wallet] = await tx.select().from(partnerWallets)
                    .where(eq(partnerWallets.partnerId, w.partnerId)).limit(1).for('update');
                if (!wallet) throw new Error(`No wallet for expert #${w.partnerId} to return ₹${amount} to`);   // rolls the claim back

                const after = (parseFloat(wallet.balanceAvailable as any) + amount).toFixed(2);
                await tx.update(partnerWallets).set({ balanceAvailable: after, updatedAt: new Date() }).where(eq(partnerWallets.partnerId, w.partnerId));
                await tx.insert(walletTransactionsV2).values({
                    transactionId: `PAYOUT-${status.toUpperCase()}-${withdrawalId}-${Date.now()}`,
                    partnerId: w.partnerId,
                    transactionType: 'refund',
                    amount: amount.toFixed(2),
                    balanceAvailableBefore: wallet.balanceAvailable,
                    balanceAvailableAfter: after,
                    balanceHoldBefore: wallet.balanceHold,
                    balanceHoldAfter: wallet.balanceHold,
                    description: `Payout ${status} — funds returned: ${failureReason || 'no reason given'}`,
                });
                return true;
            });

            if (!refunded) {
                const [now] = await db.select({ status: withdrawalRequests.status }).from(withdrawalRequests).where(eq(withdrawalRequests.id, withdrawalId)).limit(1);
                return { payoutStatus: status, localStatus: now?.status ?? w.status, changed: 'none', message: 'Already reconciled — the wallet was refunded.' };
            }

            logger.warn(`[PAYOUT_SYNC] withdrawal #${withdrawalId}: transfer ${w.razorpayPayoutId} ${status} — ₹${amount} returned to expert #${w.partnerId} (${via})`);
            await recordAudit({
                entityType: 'withdrawal', entityId: withdrawalId, action: 'withdrawal_payout_reversed',
                changedBy: actorAdminId, fromState: w.status, toState: 'failed',
                metadata: { amount, partnerId: w.partnerId, razorpayPayoutId: w.razorpayPayoutId, payoutStatus: status, failureReason: failureReason || null, walletRefunded: true, reconciledVia: via },
            });
            // The expert is told once, by the call that moved the money.
            void BookingNotifications.withdrawalRejected(w.partnerId, amount, `the bank could not take the payment${failureReason ? ` (${failureReason})` : ''}`);
            return { payoutStatus: status, localStatus: 'failed', changed: 'refunded', message: `Payout ${status}. Funds returned to the expert's wallet.` };
        }

        // ── Still in flight ─────────────────────────────────────────────
        return { payoutStatus: status, localStatus: w.status, changed: 'none', message: failureReason?.startsWith('Waiting for approval') ? failureReason : 'Payout is still in progress.' };
    }
}

/**
 * Every payout we sent to Cashfree that still says 'processing', checked once.
 *
 * Skips ones sent in the last few minutes (give Cashfree time), and anything
 * that is not one of our own transfer ids (an older RazorpayX id would only
 * come back "not found"). A request still processing after a day is logged
 * loudly: it is waiting on an approval in the Cashfree dashboard, or stuck.
 * Does nothing at all while Cashfree is not configured.
 */
export async function syncProcessingPayouts(): Promise<{ checked: number; completed: number; refunded: number; flagged: number; failed: number }> {
    const tally = { checked: 0, completed: 0, refunded: 0, flagged: 0, failed: 0 };
    if (!cashfreeKeys()) return tally;

    try {
        const due = await db.select({ id: withdrawalRequests.id, payoutId: withdrawalRequests.razorpayPayoutId, createdAt: withdrawalRequests.createdAt, updatedAt: withdrawalRequests.updatedAt })
            .from(withdrawalRequests)
            .where(and(
                eq(withdrawalRequests.status, 'processing'),
                like(withdrawalRequests.razorpayPayoutId, 'WDRW\\_%'),
                // The cutoff is worked out HERE, not with the database's now(): the app writes
                // these timestamps as UTC wall-clock, while now() is read in the database's own
                // time zone — on a database set to anything but UTC (this machine's is IST) a
                // request sent a moment ago looked hours old and was checked at once.
                lt(withdrawalRequests.updatedAt, new Date(Date.now() - 3 * 60_000)),
            ))
            .orderBy(asc(withdrawalRequests.updatedAt))
            .limit(50);

        for (const row of due) {
            if (!row.payoutId || !OUR_TRANSFER.test(row.payoutId)) continue;
            tally.checked++;
            try {
                const r = await PayoutSyncService.reconcile(row.id, null, 'scheduled_sync');
                if (r.changed === 'completed') tally.completed++;
                else if (r.changed === 'refunded') tally.refunded++;
                else if (r.changed === 'flagged') tally.flagged++;
                else if (row.updatedAt && Date.now() - new Date(row.updatedAt).getTime() > 24 * 3_600_000) {
                    logger.error(`[PAYOUT_SYNC] withdrawal #${row.id} has been "processing" for over a day (${r.message}) — check Cashfree: it may be waiting for approval in the dashboard.`);
                }
            } catch (err: any) {
                // Cashfree unreachable, or no such transfer: leave it, try again next time.
                tally.failed++;
                logger.warn(`[PAYOUT_SYNC] withdrawal #${row.id}: could not be checked — ${err?.message}`);
            }
        }
        if (tally.completed || tally.refunded || tally.flagged) {
            logger.info(`[PAYOUT_SYNC] checked ${tally.checked}: ${tally.completed} paid, ${tally.refunded} returned to wallets, ${tally.flagged} need staff`);
        }
    } catch (err: any) {
        logger.error('[PAYOUT_SYNC] job failed', { error: err?.message });
    }
    return tally;
}
