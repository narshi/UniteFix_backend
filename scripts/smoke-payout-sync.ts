/**
 * Payout reconciliation: what happens to a withdrawal after it has been sent to
 * Cashfree (services/payout-sync.service.ts). Cashfree is stubbed; nothing is
 * sent anywhere.
 *
 *   - paid          -> completed; asking again changes nothing
 *   - failed        -> the money goes back to the wallet ONCE, however many
 *                      callers ask at the same moment (button presses, the job)
 *   - reversed      -> refunded even after it was recorded as paid
 *   - in progress / Cashfree unreachable -> left exactly as it is
 *   - paid at Cashfree but already refunded here -> flagged, nothing moved
 *   - the background job checks only what it should, and tells the expert once
 *
 *   npm run smoke:payout-sync
 */

import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, partnerWallets, walletTransactionsV2, withdrawalRequests, auditLogs, notifications } from '../shared/schema';
import { CashfreeService } from '../server/services/cashfree.service';
import { syncProcessingPayouts } from '../server/services/payout-sync.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];
let n = 0;
const newPhone = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function removeFixtures(stmts: string[]) {
    let pending = stmts;
    for (let pass = 0; pass < 5 && pending.length; pass++) {
        const failed: string[] = [];
        for (const s of pending) {
            try { await db.execute(sql.raw(s)); }
            catch (e: any) { if (e?.code !== '42P01') failed.push(s); }
        }
        pending = failed;
    }
    if (pending.length) console.error('cleanup left rows behind:', pending.map(p => p.slice(0, 90)));
}

async function main() {
    // What Cashfree "says" about each transfer id. A function means it cannot be reached.
    const says: Record<string, 'SUCCESS' | 'FAILED' | 'REVERSED' | 'PENDING' | 'DOWN'> = {};
    const asked: string[] = [];
    (CashfreeService as any).fetchPayoutStatus = async (transferId: string) => {
        asked.push(transferId);
        const s = says[transferId] ?? 'PENDING';
        if (s === 'DOWN') throw new Error('Cashfree status check failed: timeout');
        const status = s === 'SUCCESS' ? 'processed' : s === 'FAILED' ? 'failed' : s === 'REVERSED' ? 'reversed' : 'processing';
        return { status, providerStatus: s, failureReason: s === 'FAILED' ? 'Beneficiary bank is down' : s === 'REVERSED' ? 'Reversed by the bank' : undefined, utr: s === 'SUCCESS' ? 'UTR123456789' : null, referenceId: null, raw: {} };
    };

    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;

        // An expert with a wallet, and a way to make a withdrawal that has been sent to Cashfree.
        const mkExpert = async (balance: number) => {
            const [u] = await db.insert(users).values({ phone: newPhone(), username: `QA Payout ${++n}`, role: 'serviceman', phoneVerified: true } as any).returning();
            userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: `QA Payout ${n}`, isActive: true, documentVerificationStatus: 'verified' as any, upiId: 'qapayout@okhdfcbank' } as any).returning();
            await db.insert(partnerWallets).values({ partnerId: e.id, balanceAvailable: balance.toFixed(2) } as any);
            return { u, e };
        };
        const withdrawal = async (empId: number, amount: number, status: string, payoutId: string | null, ageMinutes = 60) => {
            const [w] = await db.insert(withdrawalRequests).values({ partnerId: empId, amount: amount.toFixed(2), method: 'upi', status: status as any, razorpayPayoutId: payoutId } as any).returning();
            await db.update(withdrawalRequests).set({ updatedAt: new Date(Date.now() - ageMinutes * 60_000) }).where(eq(withdrawalRequests.id, w.id));
            return w;
        };
        const tid = (w: { id: number }) => `WDRW_${w.id}`;
        const wd = async (id: number) => (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, id)))[0];
        const bal = async (empId: number) => Number((await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, empId)))[0].balanceAvailable);
        const refundLines = async (id: number) => (await db.select({ n: sql<number>`count(*)::int` }).from(walletTransactionsV2).where(sql`${walletTransactionsV2.transactionId} LIKE ${`PAYOUT-%-${id}-%`}`))[0].n;
        const auditCount = async (action: string, id: number) => (await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, id))))[0].n;
        const told = async (userId: number) => { await sleep(300); return (await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), sql`${notifications.type} = 'withdrawal_rejected'`)))[0].n; };
        const sync = (id: number) => api.post(`/api/admin/withdrawals/${id}/sync`, {}, S);

        // ══ the button ══
        const a = await mkExpert(300);
        const paid = await withdrawal(a.e.id, 500, 'processing', null); await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(paid) }).where(eq(withdrawalRequests.id, paid.id));
        says[tid(paid)] = 'SUCCESS';
        const p1 = await sync(paid.id);
        check('a payout Cashfree says is paid becomes completed', p1.status === 200 && p1.body?.data?.localStatus === 'completed' && (await wd(paid.id)).status === 'completed' && (await auditCount('withdrawal_completed', paid.id)) === 1, `${p1.status} ${p1.body?.data?.message}`);
        const p2 = await sync(paid.id);
        check('…asking again changes nothing and is not recorded twice', p2.status === 200 && (await auditCount('withdrawal_completed', paid.id)) === 1 && (await bal(a.e.id)) === 300);

        const b = await mkExpert(300);
        const failed = await withdrawal(b.e.id, 500, 'processing', null); await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(failed) }).where(eq(withdrawalRequests.id, failed.id));
        says[tid(failed)] = 'FAILED';
        const burst = await Promise.all(Array.from({ length: 6 }, () => sync(failed.id)));
        check('six presses at once on a failed payout all answer', burst.every(r => r.status === 200), burst.map(r => r.status).join(','));
        check('…and the expert gets the ₹500 back exactly once', (await bal(b.e.id)) === 800 && (await refundLines(failed.id)) === 1 && (await wd(failed.id)).status === 'failed' && (await auditCount('withdrawal_payout_reversed', failed.id)) === 1, `balance ₹${await bal(b.e.id)}, ${await refundLines(failed.id)} refund line(s)`);
        check('…the ledger shows the balance it really moved between', (await db.select().from(walletTransactionsV2).where(sql`${walletTransactionsV2.transactionId} LIKE ${`PAYOUT-%-${failed.id}-%`}`))[0].balanceAvailableBefore === '300.00');
        check('…and the expert was told once', (await told(b.u.id)) === 1);
        check('…the reason is kept on the request', (await wd(failed.id)).failureReason === 'Beneficiary bank is down');

        const c = await mkExpert(100);
        const reversed = await withdrawal(c.e.id, 400, 'completed', null); await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(reversed) }).where(eq(withdrawalRequests.id, reversed.id));
        says[tid(reversed)] = 'REVERSED';
        const r1 = await sync(reversed.id);
        check('a payout recorded as paid, then reversed by the bank, is returned to the wallet', r1.status === 200 && (await bal(c.e.id)) === 500 && (await wd(reversed.id)).status === 'failed', `${r1.status} ₹${await bal(c.e.id)}`);

        const d = await mkExpert(100);
        const flight = await withdrawal(d.e.id, 200, 'processing', null); await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(flight) }).where(eq(withdrawalRequests.id, flight.id));
        says[tid(flight)] = 'PENDING';
        const f1 = await sync(flight.id);
        check('a payout still in progress is left alone', f1.status === 200 && (await wd(flight.id)).status === 'processing' && (await bal(d.e.id)) === 100, `${f1.status} ${f1.body?.data?.message}`);
        says[tid(flight)] = 'DOWN';
        const f2 = await sync(flight.id);
        check('when Cashfree cannot be reached, nothing changes (and it is not called a failure)', f2.status >= 500 && (await wd(flight.id)).status === 'processing' && (await bal(d.e.id)) === 100, `${f2.status}`);

        const e = await mkExpert(100);
        const twice = await withdrawal(e.e.id, 300, 'failed', null); await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(twice) }).where(eq(withdrawalRequests.id, twice.id));
        says[tid(twice)] = 'SUCCESS';
        const t1 = await sync(twice.id);
        check('paid at Cashfree but already refunded here: flagged for staff, no money moves', t1.status === 200 && /paid twice/i.test(t1.body?.data?.message ?? '') && (await wd(twice.id)).status === 'failed' && (await bal(e.e.id)) === 100 && (await auditCount('withdrawal_paid_after_refund', twice.id)) === 1, `${t1.status} ${t1.body?.data?.message}`);

        const manual = await withdrawal(e.e.id, 100, 'completed', 'manual_txn_123');
        check('a payout staff paid by hand has nothing at Cashfree to check', (await sync(manual.id)).status === 400);
        check('a request that was never sent is refused', (await sync((await withdrawal(e.e.id, 100, 'pending', null)).id)).status === 400);
        check('an unknown request is a 404', (await sync(999999999)).status === 404);

        // ══ the background job ══
        asked.length = 0;
        delete process.env.CASHFREE_PAYOUTS_CLIENT_ID; delete process.env.CASHFREE_PAYOUTS_CLIENT_SECRET; delete process.env.CASHFREE_CLIENT_ID; delete process.env.CASHFREE_CLIENT_SECRET;
        const g = await mkExpert(1000);
        const jPaid = await withdrawal(g.e.id, 100, 'processing', null);
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(jPaid) }).where(eq(withdrawalRequests.id, jPaid.id));
        says[tid(jPaid)] = 'SUCCESS';
        const idle = await syncProcessingPayouts();
        check('the job does nothing while Cashfree is not configured', idle.checked === 0 && asked.length === 0 && (await wd(jPaid.id)).status === 'processing');

        process.env.CASHFREE_PAYOUTS_CLIENT_ID = 'qa-id'; process.env.CASHFREE_PAYOUTS_CLIENT_SECRET = 'qa-secret';
        const jFail = await withdrawal(g.e.id, 250, 'processing', null);
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(jFail) }).where(eq(withdrawalRequests.id, jFail.id));
        says[tid(jFail)] = 'FAILED';
        const jDown = await withdrawal(g.e.id, 50, 'processing', null);
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(jDown) }).where(eq(withdrawalRequests.id, jDown.id));
        says[tid(jDown)] = 'DOWN';
        const jFresh = await withdrawal(g.e.id, 60, 'processing', null, 0);                       // sent a moment ago
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(jFresh) }).where(eq(withdrawalRequests.id, jFresh.id));
        const jOld = await withdrawal(g.e.id, 70, 'processing', 'pout_OldRazorpayXId');            // not one of our transfers
        const jDone = await withdrawal(g.e.id, 80, 'completed', null);                             // not in flight
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(jDone) }).where(eq(withdrawalRequests.id, jDone.id));

        const before = await bal(g.e.id);
        const run = await syncProcessingPayouts();
        const askedIds = new Set(asked);
        // Four: the three just made, and the in-flight one from the button tests above (still 'processing', an hour old).
        check('the job checks the four in flight that are old enough and are ours — not a fresh one, an old-style id, or one not in flight',
            run.checked === 4 && askedIds.has(tid(flight)) && askedIds.has(tid(jPaid)) && askedIds.has(tid(jFail)) && askedIds.has(tid(jDown)) && !askedIds.has(tid(jFresh)) && !askedIds.has('pout_OldRazorpayXId') && !askedIds.has(tid(jDone)), `${JSON.stringify(run)} asked ${[...askedIds].join(',')}`);
        check('…one paid, one refunded, two unreachable (left alone)', run.completed === 1 && run.refunded === 1 && run.failed === 2 && (await wd(jPaid.id)).status === 'completed' && (await wd(jFail.id)).status === 'failed' && (await wd(jDown.id)).status === 'processing', JSON.stringify(run));
        check('…and only the failed one\'s ₹250 went back', (await bal(g.e.id)) === before + 250, `₹${before} -> ₹${await bal(g.e.id)}`);
        check('…the expert was told once', (await told(g.u.id)) === 1);

        // The job and the button at the same moment, on one failed payout.
        const h = await mkExpert(0);
        const race = await withdrawal(h.e.id, 700, 'processing', null);
        await db.update(withdrawalRequests).set({ razorpayPayoutId: tid(race) }).where(eq(withdrawalRequests.id, race.id));
        says[tid(race)] = 'FAILED';
        await Promise.all([syncProcessingPayouts(), sync(race.id), sync(race.id), syncProcessingPayouts(), sync(race.id)]);
        check('the job and three button presses together refund once', (await bal(h.e.id)) === 700 && (await refundLines(race.id)) === 1 && (await wd(race.id)).status === 'failed', `₹${await bal(h.e.id)}, ${await refundLines(race.id)} line(s)`);
    } finally {
        // Notifications to experts are sent without waiting; let any still in flight land first,
        // or one is written after the cleanup below has cleared them and blocks the user delete.
        await sleep(1500);
        const uids = userIds.join(',') || '0', aids = adminIds.join(',') || '0';
        const emps = `SELECT id FROM employees WHERE user_id IN (${uids})`;
        const wds = `SELECT id FROM withdrawal_requests WHERE partner_id IN (${emps})`;
        await removeFixtures([
            `DELETE FROM audit_logs WHERE entity_type = 'withdrawal' AND entity_id IN (${wds})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${aids}) AND created_at > now() - interval '1 hour'`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (${emps})`,
            `DELETE FROM withdrawal_requests WHERE partner_id IN (${emps})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (${emps})`,
            `DELETE FROM employee_technician_types WHERE employee_id IN (${emps})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM device_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM admin_users WHERE id IN (${aids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
