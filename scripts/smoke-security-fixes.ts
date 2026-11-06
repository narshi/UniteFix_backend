/**
 * Three fixes from the security audit:
 *  1. Only a token from the admin login opens admin routes. An app token
 *     (customer, expert, partner owner) whose users.id equals an admin's id
 *     used to be treated as that admin.
 *  2. Two wallet-release runs at once credit a held payment once, not twice.
 *  3. A repeated or simultaneous payment.captured webhook records one capture.
 * Never calls Razorpay or Cashfree.
 *
 *   npm run smoke:security-fixes
 */

import jwt from 'jsonwebtoken';
import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, partnerWallets, walletTransactionsV2, paymentTransactions } from '../shared/schema';
import { PaymentService } from '../server/services/payment.service';
import { releaseHeldWalletFunds } from '../server/services/task_queues';

const stamp = Date.now().toString(36);
let adminId = 0, userId = 0, empId = 0;
const payIds: string[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        // ── 1. admin tokens ──
        const sa = await makeSuperAdmin(stamp); adminId = sa.id;
        const S = await api.login(sa.username, sa.password);
        check('the admin login still opens admin routes', (await api.get('/api/admin/withdrawals?limit=1', S)).status === 200);
        const decoded: any = jwt.decode(S!);
        check('…its token is stamped as an admin login', decoded?.kind === 'admin');
        for (const role of ['user', 'serviceman', 'business_partner']) {
            const app = jwt.sign({ userId: sa.id, role }, SECRET, { expiresIn: '5m' });
            const r = await api.get('/api/admin/withdrawals?limit=1', app);
            check(`an app token (${role}) with the same id as an admin is refused`, r.status === 403, `${r.status}`);
        }
        const legacy = jwt.sign({ userId: sa.id, role: 'super_admin' }, SECRET, { expiresIn: '5m' });
        const lr = await api.get('/api/admin/withdrawals?limit=1', legacy);
        check('an unstamped admin token from before the fix is asked to sign in again (401)', lr.status === 401 && lr.body?.code === 'SESSION_EXPIRED', JSON.stringify(lr.body));
        const forged = jwt.sign({ userId: 999999, role: 'super_admin', kind: 'admin' }, SECRET, { expiresIn: '5m' });
        check('a stamped token for no admin account is still refused', (await api.get('/api/admin/withdrawals?limit=1', forged)).status === 403);

        // ── 2. wallet release, two runs at once ──
        const [u] = await db.insert(users).values({ phone: `9${String(Date.now()).slice(-9)}`, username: 'QA Release Expert', role: 'serviceman', isActive: true } as any).returning(); userId = u.id;
        const [e] = await db.insert(employees).values({ userId: u.id, fullName: 'QA Release Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning(); empId = e.id;
        await db.insert(partnerWallets).values({ partnerId: e.id, balanceHold: '500.00', balanceAvailable: '100.00' } as any);
        await db.insert(walletTransactionsV2).values({
            transactionId: `QA-REL-${stamp}`, partnerId: e.id, transactionType: 'hold_credit', amount: '500.00',
            isReleased: false, releaseDate: new Date(Date.now() - 60_000), description: 'QA held earning',
        } as any);
        await Promise.all([releaseHeldWalletFunds(), releaseHeldWalletFunds(), releaseHeldWalletFunds()]);
        const [w] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, e.id));
        check('three release runs at once move the ₹500 hold to available exactly once', Number(w.balanceAvailable) === 600 && Number(w.balanceHold) === 0, JSON.stringify({ available: w.balanceAvailable, hold: w.balanceHold }));
        await releaseHeldWalletFunds();
        const [w2] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, e.id));
        check('…and a later run does not move it again', Number(w2.balanceAvailable) === 600);

        // ── 3. payment.captured delivered more than once ──
        const captured = (id: string) => ({ payment: { entity: { id, order_id: `order_${id}`, amount: 9900, method: 'upi', notes: { payment_type: 'qa_none' } } } });
        const rows = async (id: string) => (await db.select({ id: paymentTransactions.id, amount: paymentTransactions.amount }).from(paymentTransactions)
            .where(and(eq(paymentTransactions.razorpayPaymentId, id), eq(paymentTransactions.eventType, 'payment_captured' as any))));
        const p1 = `pay_QA${stamp}a`; payIds.push(p1);
        // The app's verify step lands first with an amount-0 row, as it does live.
        await db.insert(paymentTransactions).values({ razorpayOrderId: `order_${p1}`, razorpayPaymentId: p1, amount: 0, eventType: 'payment_captured', status: 'captured', metadata: { verifiedVia: 'mobile_sdk' } } as any);
        const first = await PaymentService.handleWebhook('payment.captured', captured(p1));
        const again = await PaymentService.handleWebhook('payment.captured', captured(p1));
        const r1 = await rows(p1);
        check('the webhook still records the real amount after the app\'s amount-0 row', r1.some(r => r.amount === 9900) && first.success);
        check('a redelivered capture adds no second row', r1.filter(r => r.amount > 0).length === 1 && /already recorded/.test(again.message), JSON.stringify(r1));
        const p2 = `pay_QA${stamp}b`; payIds.push(p2);
        await Promise.all([1, 2, 3].map(() => PaymentService.handleWebhook('payment.captured', captured(p2))));
        check('three deliveries at the same moment record one capture', (await rows(p2)).filter(r => r.amount > 0).length === 1);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    for (const p of payIds) await db.execute(sql`DELETE FROM payment_transactions WHERE razorpay_payment_id = ${p} OR razorpay_order_id = ${'order_' + p}`);
    if (empId) {
        await db.execute(sql`DELETE FROM notifications WHERE user_id = ${userId}`);
        await db.execute(sql`DELETE FROM wallet_transactions_v2 WHERE partner_id = ${empId}`);
        await db.execute(sql`DELETE FROM partner_wallets WHERE partner_id = ${empId}`);
        await db.execute(sql`DELETE FROM employees WHERE id = ${empId}`);
    }
    if (userId) await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    if (adminId) await db.execute(sql`DELETE FROM admin_users WHERE id = ${adminId}`).catch(() => {});
    process.exit(summary());
});
