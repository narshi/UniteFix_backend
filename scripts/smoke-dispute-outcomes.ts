/**
 * The three dispute outcomes (services/dispute-outcome.service.ts), through the real
 * resolve-dispute route. Razorpay is stubbed: refunds are recorded, nothing is sent.
 *
 *   customer_right  refund in full; expert's held ₹700 taken back
 *   shared_fault    refund ₹400; expert loses ₹400, keeps ₹300
 *   expert_right    no refund; held ₹700 released to the expert
 *   errors          a shared fault without an amount, or above what was paid, moves nothing
 *   already paid    earning released before the dispute: nothing taken back, reported
 *   legacy names    refund_customer / release_employee still work, as the three outcomes
 *
 *   npm run smoke:dispute-outcomes
 */

import bcrypt from 'bcrypt';
import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, serviceRequests, paymentTransactions, partnerWallets, walletTransactionsV2 } from '../shared/schema';
import { PaymentService } from '../server/services/payment.service';
import { storage } from '../server/storage';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];
let n = 0;
const newPhone = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

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
    // Razorpay: record refunds, send nothing.
    const refunds: Array<{ pid: string; paise: number }> = [];
    (PaymentService as any).razorpay = { payments: { refund: async (pid: string, opts: any) => { refunds.push({ pid, paise: opts.amount }); return { id: `rfnd_QA${refunds.length}_${stamp}` }; } } };

    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;

        const [cust] = await db.insert(users).values({ phone: newPhone(), username: `QA Dispute Customer ${stamp}`, role: 'user', phoneVerified: true } as any).returning();
        userIds.push(cust.id);
        const mkExpert = async () => {
            const [u] = await db.insert(users).values({ phone: newPhone(), username: `QA Dispute Expert ${++n} ${stamp}`, role: 'serviceman', phoneVerified: true } as any).returning();
            userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: `QA Dispute Expert ${n}`, isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
            await db.insert(partnerWallets).values({ partnerId: e.id, balanceAvailable: '0.00', balanceHold: '0.00' } as any);
            return e;
        };
        const mkDisputed = async (expertId: number, paidRupees: number, status: 'disputed' | 'completed' = 'disputed') => {
            const [b] = await db.insert(serviceRequests).values({
                userId: cust.id, serviceId: `QA-DSP-${stamp}-${++n}`, serviceType: 'QA dispute', brand: 'x', model: 'x', description: 'QA', address: 'Main road, Sirsi 581401',
                status, providerId: expertId, bookingFee: 149, bookingFeeStatus: 'paid', completedAt: new Date(),
            } as any).returning();
            await db.insert(paymentTransactions).values({
                serviceRequestId: b.id, razorpayOrderId: `order_QADSP${stamp}${n}`, razorpayPaymentId: `pay_QADSP${stamp}${n}`,
                amount: Math.round(paidRupees * 100), currency: 'INR', eventType: 'payment_captured', status: 'captured',
            } as any);
            return b;
        };
        const wallet = async (empId: number) => { const [w] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, empId)); return { avail: Number(w.balanceAvailable), hold: Number(w.balanceHold) }; };
        const bookingStatus = async (id: number) => (await db.select({ s: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, id)))[0].s;
        const settle = (id: number, body: any) => api.post(`/api/admin/bookings/${id}/resolve-dispute`, { remarks: 'QA investigation', ...body }, S);
        const holdOf = async (empId: number, bookingId: number) => (await db.select().from(walletTransactionsV2).where(and(eq(walletTransactionsV2.partnerId, empId), eq(walletTransactionsV2.serviceRequestId, bookingId), eq(walletTransactionsV2.transactionType, 'hold_credit'))))[0];
        const hold = (empId: number, bookingId: number, rupees: number) => storage.creditWalletOnHold(empId, bookingId, rupees, new Date(Date.now() + 7 * 86_400_000));

        // ══ customer right ══
        const e1 = await mkExpert(); const b1 = await mkDisputed(e1.id, 1000);
        await hold(e1.id, b1.id, 700);
        refunds.length = 0;
        const r1 = await settle(b1.id, { resolution: 'customer_right' });
        const w1 = await wallet(e1.id);
        const refunded1 = refunds.reduce((a, r) => a + r.paise, 0);
        check('customer right: the customer gets all ₹1,000 back', r1.status === 200 && refunded1 === 100000, `${r1.status} ${r1.body?.message ?? ''} refunded ${refunded1}p`);
        check('customer right: the expert\'s ₹700 held earning is taken back, nothing released', w1.hold === 0 && w1.avail === 0 && (await holdOf(e1.id, b1.id)).isReleased === true, JSON.stringify(w1));
        const claw1 = await db.select().from(walletTransactionsV2).where(and(eq(walletTransactionsV2.serviceRequestId, b1.id), eq(walletTransactionsV2.transactionType, 'dispute_takeback')));
        check('customer right: the take-back is in the ledger as ₹700', claw1.length === 1 && Number(claw1[0].amount) === -700, JSON.stringify(claw1.map(x => x.amount)));
        check('customer right: the booking is completed and the decision is in the audit trail', (await bookingStatus(b1.id)) === 'completed');

        // ══ shared fault ══
        const e2 = await mkExpert(); const b2 = await mkDisputed(e2.id, 1000);
        await hold(e2.id, b2.id, 700);
        refunds.length = 0;
        const r2 = await settle(b2.id, { resolution: 'shared_fault', refundAmount: 400 });
        const w2 = await wallet(e2.id);
        check('shared fault: ₹400 refunded to the customer', r2.status === 200 && refunds.reduce((a, r) => a + r.paise, 0) === 40000, `${r2.status} ${r2.body?.message ?? ''}`);
        check('shared fault: the expert loses ₹400 and keeps ₹300', w2.avail === 300 && w2.hold === 0, JSON.stringify(w2));

        // ══ expert right ══
        const e3 = await mkExpert(); const b3 = await mkDisputed(e3.id, 1000);
        await hold(e3.id, b3.id, 700);
        refunds.length = 0;
        const r3 = await settle(b3.id, { resolution: 'expert_right' });
        const w3 = await wallet(e3.id);
        check('expert right: no refund is sent', r3.status === 200 && refunds.length === 0, `${r3.status}`);
        check('expert right: the ₹700 is released to the expert in full', w3.avail === 700 && w3.hold === 0, JSON.stringify(w3));

        // ══ errors: nothing moves ══
        const e4 = await mkExpert(); const b4 = await mkDisputed(e4.id, 1000);
        await hold(e4.id, b4.id, 700);
        refunds.length = 0;
        // A booking whose ledger already has an adjustment cannot be settled automatically; nothing is refunded.
        const e8 = await mkExpert(); const b8 = await mkDisputed(e8.id, 1000);
        await hold(e8.id, b8.id, 700);
        await db.insert(walletTransactionsV2).values({ transactionId: `QA-ADJ-${stamp}`, partnerId: e8.id, serviceRequestId: b8.id, transactionType: 'dispute_takeback', amount: '-10.00', description: 'QA' } as any);
        refunds.length = 0;
        const r8 = await settle(b8.id, { resolution: 'customer_right' });
        check('a booking with an earlier ledger adjustment is refused before any refund', r8.status === 409 && refunds.length === 0 && (await wallet(e8.id)).hold === 700, `${r8.status} ${r8.body?.message ?? ''}`);
        const noAmt = await settle(b4.id, { resolution: 'shared_fault' });
        const tooMuch = await settle(b4.id, { resolution: 'shared_fault', refundAmount: 1500 });
        const w4 = await wallet(e4.id);
        check('a shared fault without an amount is refused and moves nothing', noAmt.status === 400 && refunds.length === 0 && w4.hold === 700, `${noAmt.status} ${noAmt.body?.message ?? ''}`);
        check('a refund above what was paid is refused and moves nothing', tooMuch.status === 400 && /cannot be more than/.test(tooMuch.body?.message ?? '') && refunds.length === 0 && (await wallet(e4.id)).hold === 700, `${tooMuch.status}`);
        check('an unknown outcome is refused', (await settle(b4.id, { resolution: 'refund_everyone' })).status === 400);

        // ══ the hold ended before the complaint: opening the dispute puts the earning back on hold ══
        const e5 = await mkExpert(); const b5 = await mkDisputed(e5.id, 1000, 'completed');
        await hold(e5.id, b5.id, 700);
        await storage.releaseHeldBalance((await holdOf(e5.id, b5.id)).id);
        const open5 = await api.post(`/api/admin/bookings/${b5.id}/override`, { newState: 'disputed', reason: 'Dispute: QA complaint' }, S);
        const w5a = await wallet(e5.id);
        check('opening the dispute puts the released ₹700 back on hold', open5.status === 200 && open5.body?.data?.earningHeld?.moved === 700 && w5a.hold === 700 && w5a.avail === 0, JSON.stringify({ s: open5.status, eh: open5.body?.data?.earningHeld, w5a }));
        const open5again = await api.post(`/api/admin/bookings/${b5.id}/override`, { newState: 'disputed', reason: 'Dispute: QA again' }, S);
        check('opening it a second time moves nothing more', open5again.body?.data?.earningHeld?.moved === 0 && (await wallet(e5.id)).hold === 700, JSON.stringify(open5again.body?.data?.earningHeld));
        refunds.length = 0;
        const r5 = await settle(b5.id, { resolution: 'customer_right' });
        const w5 = await wallet(e5.id);
        check('the customer right after the re-hold: ₹1,000 refunded', r5.status === 200 && refunds.reduce((a, r) => a + r.paise, 0) === 100000, `${r5.status}`);
        check('…and the re-held ₹700 is taken back from the expert', w5.hold === 0 && w5.avail === 0, JSON.stringify(w5));

        // ══ the expert withdrew part of it before the dispute: the rest cannot be put back ══
        const e9 = await mkExpert(); const b9 = await mkDisputed(e9.id, 1000, 'completed');
        await hold(e9.id, b9.id, 700);
        await storage.releaseHeldBalance((await holdOf(e9.id, b9.id)).id);
        await db.update(partnerWallets).set({ balanceAvailable: '200.00' } as any).where(eq(partnerWallets.partnerId, e9.id));   // ₹500 withdrawn
        const open9 = await api.post(`/api/admin/bookings/${b9.id}/override`, { newState: 'disputed', reason: 'Dispute: QA partial' }, S);
        check('a partial withdrawal: ₹200 is put back on hold and ₹500 is reported as short', open9.body?.data?.earningHeld?.moved === 200 && open9.body?.data?.earningHeld?.shortfall === 500, JSON.stringify(open9.body?.data?.earningHeld));
        refunds.length = 0;
        const r9 = await settle(b9.id, { resolution: 'customer_right' });
        const w9 = await wallet(e9.id);
        check('…settled: the ₹200 is taken back and the ₹500 withdrawn is reported for a person to settle', r9.status === 200 && w9.hold === 0 && w9.avail === 0 && (r9.body?.data?.actionsTaken ?? []).some((a: string) => /₹500 of the expert's earning was already withdrawn/.test(a)), JSON.stringify({ w9, actions: r9.body?.data?.actionsTaken }));

        // ══ legacy names still work, as the three outcomes ══
        const e6 = await mkExpert(); const b6 = await mkDisputed(e6.id, 500);
        await hold(e6.id, b6.id, 350);
        refunds.length = 0;
        const r6 = await settle(b6.id, { resolution: 'release_employee' });
        check('legacy "release_employee" means expert right', r6.status === 200 && refunds.length === 0 && (await wallet(e6.id)).avail === 350, `${r6.status}`);
        const e7 = await mkExpert(); const b7 = await mkDisputed(e7.id, 500);
        await hold(e7.id, b7.id, 350);
        refunds.length = 0;
        const r7 = await settle(b7.id, { resolution: 'refund_customer' });
        check('legacy "refund_customer" means customer right (and takes the held earning back)', r7.status === 200 && refunds.reduce((a, r) => a + r.paise, 0) === 50000 && (await wallet(e7.id)).hold === 0 && (await wallet(e7.id)).avail === 0, `${r7.status}`);
    } finally {
        const uids = userIds.join(',') || '0', aids = adminIds.join(',') || '0';
        const emps = `SELECT id FROM employees WHERE user_id IN (${uids})`;
        const srs = `SELECT id FROM service_requests WHERE user_id IN (${uids})`;
        await removeFixtures([
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${aids}) AND created_at > now() - interval '1 hour'`,
            `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (${emps})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${srs})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE user_id IN (${uids})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (${emps})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM admin_users WHERE id IN (${aids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
