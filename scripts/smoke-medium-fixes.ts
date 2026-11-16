/**
 * The medium findings from the pre-launch audit (server side).
 *
 *  M1   Wrong start codes on a booking are counted; five lock it for a while.
 *  M2   A good rating shortens the hold on an earning, never to nothing; a
 *       disputed booking's earning stays on hold.
 *  M3   An app token issued for longer than an hour is refused; a closed
 *       expert account is signed out.
 *  M4   Changing the profile email does not create a new way to sign in.
 *  M5   The verification and dispute routes are reachable (access map), and
 *       resolving a dispute releases the held earning exactly once.
 *  M6   Product ordering is paused on the server; a cart row can only be
 *       removed by its owner.
 *  M7   Wallet top-up / deduction: Payments capability, a real amount, audited.
 *  M8   Razorpay is always sent whole paise.
 *  M9   A repeated "payout failed" webhook refunds the wallet once.
 *  M10  Only the booking's customer can open its booking-fee payment.
 *  M11  Invoice download takes a customer's app session and nothing else.
 *  M12  Sample business details are treated as missing, never shown.
 *  M13  `npm run db:push` refuses a database that is not on this machine.
 *
 * M14 (CI) is the workflow that runs this file. Never calls Razorpay or Cashfree.
 *
 *   npm run smoke:medium-fixes
 */

import crypto from 'crypto';
import { spawnSync } from 'child_process';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import {
    users, employees, serviceRequests, adminUsers, adminRoles, adminRoleCapabilities, partnerWallets,
    walletTransactionsV2, withdrawalRequests, auditLogs, paymentTransactions, products, cartItems, otpVerifications,
} from '../shared/schema';
import { storage } from '../server/storage';
import { PaymentService } from '../server/services/payment.service';
import { releaseHeldWalletFunds } from '../server/services/task_queues';
import { loadSellerDetails } from '../server/services/invoice-generator';
import { SAMPLE_GSTIN, realGstin, realPhone, realUpiId } from '../server/lib/business-identity';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], roleIds: number[] = [], productIds: number[] = [], phones: string[] = [];

const newPhone = () => { const p = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`; phones.push(p); return p; };

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
    // No Razorpay key id (bookings take the development path); our own secrets for signatures.
    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = `qa-secret-${stamp}`;
    const XSECRET = `qa-x-${stamp}`;
    process.env.RAZORPAYX_WEBHOOK_SECRET = XSECRET;
    delete process.env.SHOP_ORDERING_ENABLED;

    // Razorpay itself: record what an order would have been created with.
    const orders: any[] = [];
    (PaymentService as any).razorpay = { orders: { create: async (o: any) => { orders.push(o); return { id: `order_QAm${stamp}${orders.length}` }; } } };

    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const sign = (userId: number, role: string, expiresIn = '15m', extra: Record<string, unknown> = {}) => jwt.sign({ userId, role, ...extra }, SECRET, { expiresIn } as any);

    const mkUser = async (role: 'user' | 'serviceman', name: string, extra: Record<string, unknown> = {}) => {
        const phone = newPhone();
        const [u] = await db.insert(users).values({ phone, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401', phoneVerified: true, ...extra } as any).returning();
        userIds.push(u.id);
        return { u, phone, t: sign(u.id, role) };
    };
    const mkStaff = async (tag: string, capabilities: string[]) => {
        const [role] = await db.insert(adminRoles).values({ slug: `qa_med_${tag}_${stamp}`, name: `QA Med ${tag} ${stamp}`, scope: 'staff' } as any).returning();
        roleIds.push(role.id);
        if (capabilities.length) await db.insert(adminRoleCapabilities).values(capabilities.map(capability => ({ roleId: role.id, capability })));
        const password = `Staff-${tag}-${stamp}-pw!`;
        const [row] = await db.insert(adminUsers).values({ username: `qa_med_${tag}_${stamp}`, email: `qa_med_${tag}_${stamp}@example.test`, password: await bcrypt.hash(password, 10), role: role.slug, roleId: role.id, isActive: true } as any).returning();
        adminIds.push(row.id);
        return { id: row.id, token: (await api.login(row.username, password))! };
    };
    let srN = 0;
    const booking = async (userId: number, providerId: number | null, fields: Record<string, unknown> = {}) => {
        const [r] = await db.insert(serviceRequests).values({
            userId, serviceId: `QA-MED-${stamp}-${++srN}`, serviceType: 'QA medium fixes', brand: 'x', model: 'x', description: 'QA', address: 'Main road, Sirsi 581401',
            status: 'created', providerId, bookingFee: 149, bookingFeeStatus: 'paid', ...fields,
        } as any).returning();
        return r;
    };
    const sr = async (id: number) => (await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)))[0];
    const wallet = async (empId: number) => (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, empId)))[0];
    const holdOf = async (srId: number) => (await db.select().from(walletTransactionsV2).where(and(eq(walletTransactionsV2.serviceRequestId, srId), eq(walletTransactionsV2.transactionType, 'hold_credit'))))[0];
    const audits = async (action: string, entityId: number) => (await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId))))[0].n;

    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const owner = await mkUser('user', 'QA Med Owner');
        const stranger = await mkUser('user', 'QA Med Stranger');
        const tech = await mkUser('serviceman', 'QA Med Tech');
        const [emp] = await db.insert(employees).values({ userId: tech.u.id, fullName: 'QA Med Tech', isActive: true, documentVerificationStatus: 'verified' as any, upiId: 'qamed@okhdfcbank' } as any).returning();

        // ══ M1 — start code attempts ══
        const job = await booking(owner.u.id, emp.id, { status: 'reached', handshakeOtp: '482913' });
        const start = (otp: string) => api.patch(`/api/bookings/${job.id}/start`, { otp }, tech.t);
        const tries = [];
        for (let i = 0; i < 4; i++) tries.push(await start('000000'));
        check('M1  wrong start codes are refused and counted down', tries.every(r => r.status === 400) && tries[0].body?.attemptsLeft === 4 && tries[3].body?.attemptsLeft === 1, tries.map(r => `${r.status}:${r.body?.attemptsLeft}`).join(' '));
        const fifth = await start('000000');
        check('M1  the fifth wrong code locks the booking\'s code', fifth.status === 429 && fifth.body?.code === 'OTP_LOCKED' && !!(await sr(job.id)).handshakeLockedUntil, `${fifth.status} ${fifth.body?.code}`);
        const locked = await start('482913');
        check('M1  while locked, even the right code is refused and the job has not started', locked.status === 429 && (await sr(job.id)).status === 'reached', `${locked.status}`);
        await db.update(serviceRequests).set({ handshakeLockedUntil: new Date(Date.now() - 1000) }).where(eq(serviceRequests.id, job.id));
        const good = await start('482913');
        const started = await sr(job.id);
        check('M1  after the lock, the right code starts the job and the count is cleared', good.status === 200 && started.status === 'in_progress' && started.handshakeAttempts === 0 && started.handshakeLockedUntil == null, `${good.status} ${good.body?.message}`);

        // ══ M2 — minimum hold after a good rating; disputes freeze the hold ══
        const rated = await booking(owner.u.id, emp.id, { status: 'completed', completedAt: new Date(), totalAmount: 1000 });
        await storage.creditWalletOnHold(emp.id, rated.id, 500, new Date(Date.now() + 7 * 86_400_000));
        const m2a = await api.post(`/api/ratings/service/${rated.id}`, { rating: 5, review: 'QA' }, owner.t);
        const h1 = await holdOf(rated.id);
        const hoursOut = h1?.releaseDate ? (new Date(h1.releaseDate).getTime() - Date.now()) / 3_600_000 : -1;
        check('M2  a 5-star rating does not release the earning on the spot', m2a.status === 201 && h1?.isReleased === false && Number((await wallet(emp.id)).balanceAvailable) === 0, `${m2a.status} released=${h1?.isReleased}`);
        check('M2  …it brings the release forward to about a day after the job, not a week', hoursOut > 20 && hoursOut <= 24.1, `${hoursOut.toFixed(1)} h`);
        await db.update(serviceRequests).set({ completedAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(serviceRequests.id, rated.id));
        const again = await storage.fastTrackHeldBalanceByService(rated.id, 24);
        check('M2  past the minimum, a good rating releases it', again === 'released' && (await holdOf(rated.id)).isReleased === true && Number((await wallet(emp.id)).balanceAvailable) === 500, again);

        // ══ M5 — access map, and a dispute from start to finish ══
        const nobody = await mkStaff('nobody', ['support:view']);
        const pendingList = await api.get('/api/admin/employees/pending?status=verified', S);
        check('M5  the verification queue is reachable (it was refused for every admin)', pendingList.status === 200 && Array.isArray(pendingList.body?.data), `${pendingList.status} ${pendingList.body?.code ?? ''}`);
        const disputed = await booking(owner.u.id, emp.id, { status: 'completed', completedAt: new Date(), totalAmount: 800 });
        await storage.creditWalletOnHold(emp.id, disputed.id, 300, new Date(Date.now() - 60_000));   // due for release already
        const trail = await api.get(`/api/admin/bookings/${disputed.id}/billing`, S);
        check('M5  a booking\'s billing trail is reachable', trail.status === 200 && trail.body?.data?.booking?.id === disputed.id, `${trail.status}`);
        check('M5  …but not for a role without the Service Requests capability', (await api.get(`/api/admin/bookings/${disputed.id}/billing`, nobody.token)).status === 403);
        const mark = await api.post(`/api/admin/bookings/${disputed.id}/override`, { newState: 'disputed', reason: 'Dispute: QA customer says the job was not done' }, S);
        check('M5  staff can mark a booking as disputed', mark.status === 200 && (await sr(disputed.id)).status === 'disputed', `${mark.status} ${mark.body?.message}`);
        const availBefore = Number((await wallet(emp.id)).balanceAvailable);
        await releaseHeldWalletFunds();
        check('M2  the hourly release leaves a disputed booking\'s earning on hold', (await holdOf(disputed.id)).isReleased === false && Number((await wallet(emp.id)).balanceAvailable) === availBefore);
        check('M2  …and a good rating does not release it either', (await storage.fastTrackHeldBalanceByService(disputed.id, 0)) === 'none' && (await holdOf(disputed.id)).isReleased === false);
        // A "released" ledger line on the same booking: it is not a hold, and must not be moved again.
        await db.insert(walletTransactionsV2).values({ transactionId: `WREL-QA-${stamp}`, partnerId: emp.id, serviceRequestId: disputed.id, transactionType: 'release', amount: '300.00', description: 'QA ledger line' } as any);
        const resolve = await api.post(`/api/admin/bookings/${disputed.id}/resolve-dispute`, { resolution: 'release_employee', remarks: 'QA: complaint not upheld' }, S);
        const afterResolve = await wallet(emp.id);
        check('M5  resolving in the expert\'s favour completes the booking', resolve.status === 200 && (await sr(disputed.id)).status === 'completed', `${resolve.status} ${resolve.body?.message}`);
        check('M5  …and releases the held ₹300 exactly once', (await holdOf(disputed.id)).isReleased === true && Number(afterResolve.balanceAvailable) === availBefore + 300 && Number(afterResolve.balanceHold) === 0, `available ₹${afterResolve.balanceAvailable} (was ₹${availBefore}), hold ₹${afterResolve.balanceHold}`);
        check('M5  …with the decision in the audit trail', (await audits('dispute_resolved', disputed.id)) === 1 && (await audits('booking_state_overridden', disputed.id)) === 1);

        // ══ M3 — token lifetime, closed expert account ══
        const longLived = sign(owner.u.id, 'user', '30d');
        check('M3  a 30-day app token is refused', (await api.get('/api/client/profile', longLived)).status === 403 && (await api.get('/api/services/my-requests', longLived)).status === 403);
        check('M3  …a normal 15-minute one is not', (await api.get('/api/client/profile', owner.t)).status === 200);
        check('M3  …nor is a 30-day expert token accepted', (await api.get('/api/partner/verification-status', sign(tech.u.id, 'serviceman', '30d'))).status === 403 && (await api.get('/api/partner/verification-status', tech.t)).status === 200);
        const gone = await mkUser('serviceman', 'QA Med Closed Tech');
        await db.insert(employees).values({ userId: gone.u.id, fullName: 'QA Med Closed Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any);
        check('M3  an expert works while the account is open', (await api.get('/api/partner/verification-status', gone.t)).status === 200);
        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.u.id));
        const closed = await api.get('/api/partner/verification-status', gone.t);
        check('M3  …and is signed out once it is closed', closed.status === 403 && /closed/i.test(closed.body?.message ?? ''), `${closed.status} ${closed.body?.message}`);

        // ══ M4 — changing the profile email ══
        const oldMail = `qa-med-old-${stamp}@example.test`, newMail = `qa-med-new-${stamp}@example.test`;
        const proven = await mkUser('user', 'QA Med Proven', { email: oldMail, emailVerified: true });
        const same = await api.patch('/api/client/profile', { email: oldMail.toUpperCase() }, proven.t);
        check('M4  re-sending the same email changes nothing', same.status === 200 && (await db.select().from(users).where(eq(users.id, proven.u.id)))[0].emailVerified === true);
        const changed = await api.patch('/api/client/profile', { email: newMail }, proven.t);
        const afterChange = (await db.select().from(users).where(eq(users.id, proven.u.id)))[0];
        check('M4  a new email is saved, but as unconfirmed', changed.status === 200 && afterChange.email === newMail && afterChange.emailVerified === false, `${changed.status}`);
        const code = await api.post('/api/auth/fallback/request-otp', { phone: proven.phone.slice(3), role: 'user' });
        const [made] = await db.select({ id: otpVerifications.id }).from(otpVerifications).where(eq(otpVerifications.phone, proven.phone)).limit(1);
        check('M4  …so no sign-in code is sent to it', code.status === 409 && code.body?.code === 'PHONE_SIGNIN_REQUIRED' && !made, `${code.status} ${code.body?.code}`);
        const emailOnly = await mkUser('user', 'QA Med EmailOnly', { phoneVerified: false, email: `qa-med-only-${stamp}@example.test`, emailVerified: true });
        const swap = await api.patch('/api/client/profile', { email: `qa-med-thief-${stamp}@example.test`, username: 'QA Med EmailOnly Renamed' }, emailOnly.t);
        const afterSwap = (await db.select().from(users).where(eq(users.id, emailOnly.u.id)))[0];
        check('M4  an account that signs in by email alone cannot have that email swapped', swap.status === 409 && swap.body?.code === 'VERIFY_PHONE_FIRST' && afterSwap.email === `qa-med-only-${stamp}@example.test` && afterSwap.username === 'QA Med EmailOnly', `${swap.status} ${swap.body?.code}`);
        check('M4  …though the rest of its profile can still be edited', (await api.patch('/api/client/profile', { username: 'QA Med EmailOnly Renamed' }, emailOnly.t)).status === 200);

        // ══ M6 — the shop is paused on the server ══
        const [product] = await db.insert(products).values({ name: `QA Med product ${stamp}`, price: 500, category: 'QA' } as any).returning();
        productIds.push(product.id);
        const place = await api.post('/api/orders/place', { products: [{ productId: product.id, quantity: -3 }], address: 'x' }, owner.t);
        const add = await api.post('/api/cart/add', { productId: product.id, quantity: 1 }, owner.t);
        const pay = await api.post('/api/shop/create-order', { amount: 1, address: 'x' }, owner.t);
        check('M6  placing an order, adding to the cart and the shop payment all answer "paused"', [place, add, pay].every(r => r.status === 503 && r.body?.code === 'SHOP_PAUSED'), [place, add, pay].map(r => r.status).join(','));
        const [mine] = await db.insert(cartItems).values({ userId: owner.u.id, productId: product.id, quantity: 1 } as any).returning();
        await api.del(`/api/cart/${mine.id}`, stranger.t);
        check('M6  someone else cannot remove a row from my cart', (await db.select().from(cartItems).where(eq(cartItems.id, mine.id))).length === 1);
        await api.del(`/api/cart/${mine.id}`, owner.t);
        check('M6  …I can', (await db.select().from(cartItems).where(eq(cartItems.id, mine.id))).length === 0);
        process.env.SHOP_ORDERING_ENABLED = '1';
        const bad = await api.post('/api/orders/place', { products: [{ productId: product.id, quantity: -3 }], address: 'x' }, owner.t);
        delete process.env.SHOP_ORDERING_ENABLED;
        check('M6  with the shop switched on, a negative quantity is still refused', bad.status === 400, `${bad.status}`);

        // ══ M7 — wallet adjustments ══
        const hr = await mkStaff('hr', ['employees:manage']);
        const topup = (body: any, token = S) => api.post(`/api/admin/servicemen/${emp.id}/topup`, body, token);
        const w0 = Number((await wallet(emp.id)).balanceAvailable);
        const refused = await topup({ amount: 100 }, hr.token);
        check('M7  a role that only manages experts cannot credit a wallet', refused.status === 403 && refused.body?.code === 'CAPABILITY_REQUIRED' && Number((await wallet(emp.id)).balanceAvailable) === w0, `${refused.status} ${refused.body?.code}`);
        const junk = await Promise.all([topup({ amount: '10abc' }), topup({ amount: 0 }), topup({ amount: -5 }), topup({ amount: 0.001 }), topup({ amount: 5_000_000 }), topup({})]);
        check('M7  amounts that are not real rupee amounts are refused', junk.every(r => r.status === 400) && Number((await wallet(emp.id)).balanceAvailable) === w0, junk.map(r => r.status).join(','));
        const okTop = await topup({ amount: '25.50', description: 'QA goodwill' });
        check('M7  a real top-up is applied', okTop.status === 200 && Number((await wallet(emp.id)).balanceAvailable) === w0 + 25.5, `${okTop.status} ${okTop.body?.message}`);
        check('M7  …and written to the audit trail', (await audits('wallet_topped_up', emp.id)) === 1);
        const noReason = await api.post(`/api/admin/servicemen/${emp.id}/deduct`, { amount: 5 }, S);
        const okDed = await api.post(`/api/admin/servicemen/${emp.id}/deduct`, { amount: 5.5, description: 'QA correction' }, S);
        check('M7  a deduction needs a reason, is applied and audited', noReason.status === 400 && okDed.status === 200 && Number((await wallet(emp.id)).balanceAvailable) === w0 + 20 && (await audits('wallet_deducted', emp.id)) === 1, `${noReason.status} ${okDed.status}`);

        // ══ M8 — whole paise to Razorpay ══
        const paise = await booking(owner.u.id, emp.id, { status: 'pending_payment', totalAmount: 1384, pricingSnapshot: { snapshotVersion: 2, bookingFee: 149, bookingFeeCredit: 149, subtotal: 1000, taxableAmount: 1000, grossTotal: 1383.57, finalTotal: 1234.57 } });
        orders.length = 0;
        const fin = await PaymentService.createFinalPaymentOrder(paise.id, 1000);
        const [finRow] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.razorpayOrderId, fin.orderId));
        check('M8  a bill of ₹1234.57 is sent to Razorpay as 123457 paise exactly', orders[0]?.amount === 123457 && Number.isInteger(orders[0]?.amount) && finRow?.amount === 123457, `${orders[0]?.amount} (1234.57 × 100 = ${1234.57 * 100})`);

        // ══ M10 — the booking-fee payment order ══
        const unpaid = await booking(owner.u.id, null, { bookingFeeStatus: 'pending', pricingSnapshot: { snapshotVersion: 2, bookingFee: 149.99 } });
        orders.length = 0;
        const notMine = await api.post(`/api/customer/services/${unpaid.id}/create-booking-payment`, {}, stranger.t);
        check('M10 someone else cannot open a payment on my booking', notMine.status === 404 && orders.length === 0, `${notMine.status}`);
        const isMine = await api.post(`/api/customer/services/${unpaid.id}/create-booking-payment`, {}, owner.t);
        check('M10 …I can, and the fee goes out in whole paise too', isMine.status === 200 && orders[0]?.amount === 14999, `${isMine.status} ${orders[0]?.amount}`);

        // ══ M9 — the RazorpayX "payout failed" webhook ══
        const payoutId = `pout_QA${stamp}`;
        const [wd] = await db.insert(withdrawalRequests).values({ partnerId: emp.id, amount: '200.00', method: 'upi', status: 'processing', razorpayPayoutId: payoutId } as any).returning();
        const w1 = Number((await wallet(emp.id)).balanceAvailable);
        const hook = async (event: string) => {
            const raw = JSON.stringify({ event, payload: { payout: { entity: { id: payoutId, failure_reason: 'QA bank refused' } } } });
            const res = await fetch(`${base}/api/webhooks/razorpayx`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', XSECRET).update(raw).digest('hex') }, body: raw });
            return res.status;
        };
        const deliveries = await Promise.all(Array.from({ length: 5 }, () => hook('payout.failed')));
        const refunds = (await db.select({ n: sql<number>`count(*)::int` }).from(walletTransactionsV2).where(and(eq(walletTransactionsV2.partnerId, emp.id), sql`${walletTransactionsV2.transactionId} LIKE ${`REFUND-FAIL-${wd.id}-%`}`)))[0].n;
        check('M9  five deliveries of one failed payout put the money back once', deliveries.every(s => s === 200) && Number((await wallet(emp.id)).balanceAvailable) === w1 + 200 && refunds === 1, `statuses ${deliveries.join(',')}; ${refunds} refund line(s); ₹${(await wallet(emp.id)).balanceAvailable}`);
        await hook('payout.processed');
        check('M9  a late "processed" does not turn the failed payout back into a paid one', (await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, wd.id)))[0].status === 'failed');
        const unsigned = await fetch(`${base}/api/webhooks/razorpayx`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'f'.repeat(64) }, body: JSON.stringify({ event: 'payout.failed', payload: {} }) });
        check('M9  a webhook with a wrong signature is still refused', unsigned.status === 401);

        // ══ M11 — invoice download ══
        const dl = (token: string) => fetch(`${base}/api/client/invoices/INV-QA-NONE-${stamp}/download`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.status);
        check('M11 a customer\'s own session reaches the invoice lookup', (await dl(owner.t)) === 404);
        const staffLookalike = jwt.sign({ userId: owner.u.id, role: 'super_admin', kind: 'admin' }, SECRET, { expiresIn: '8h' });
        check('M11 a staff token carrying the same id is refused', (await dl(staffLookalike)) === 403 && (await dl(S)) === 403);
        check('M11 …so are an expert\'s token, a token made for something else, and a 30-day one', (await dl(tech.t)) === 403 && (await dl(sign(owner.u.id, 'user', '5m', { purpose: 'invoice_download', invoiceId: 'INV-OTHER' }))) === 403 && (await dl(longLived)) === 403);

        // ══ M12 — sample business details ══
        check('M12 the sample GSTIN, phone numbers and UPI ID count as missing', realGstin(SAMPLE_GSTIN) === '' && realGstin(' 29aaacu1234f1zq ') === '29AAACU1234F1ZQ' && realPhone('+91-9876543210') === undefined && realPhone('919999999999') === undefined && realPhone('+91 94488 50679') === '+91 94488 50679' && realUpiId('yourmerchant@upi') === '' && realUpiId('unitefix@okhdfcbank') === 'unitefix@okhdfcbank');
        const seller = await loadSellerDetails();
        check('M12 invoices never carry the sample GSTIN or the sample phone number', seller.gstin !== SAMPLE_GSTIN && !/9876543210/.test(seller.supportPhone ?? ''), `gstin "${seller.gstin}" phone "${seller.supportPhone ?? ''}"`);
        const pub = await api.get('/api/config/public');
        check('M12 the app is never handed the sample UPI ID or a made-up WhatsApp number', pub.status === 200 && pub.body?.data?.companyUpiId !== 'yourmerchant@upi' && !/^919999999999$/.test(pub.body?.data?.whatsappNumber ?? ''), JSON.stringify({ upi: pub.body?.data?.companyUpiId, wa: pub.body?.data?.whatsappNumber }));
        const cancelLate = await api.post(`/api/services/${job.id}/cancel`, {}, owner.t);
        check('M12 "contact support" links do not point at 919999999999', cancelLate.status === 400 && /^https:\/\/wa\.me\/\d{11,13}\?text=/.test(cancelLate.body?.data?.whatsappLink ?? '') && !/919999999999/.test(cancelLate.body?.data?.whatsappLink ?? ''), cancelLate.body?.data?.whatsappLink);

        // ══ M13 — db:push guard ══
        const guard = (url: string) => spawnSync(process.execPath, ['scripts/require-local-db.mjs'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }).status;
        check('M13 the schema push refuses a database that is not on this machine', guard('postgresql://u:p@dpg-abc123-a.singapore-postgres.render.com/unitefix_db') === 1 && guard('postgresql://u:p@db.example.com:5432/x') === 1 && guard('not a url') === 1);
        check('M13 …and runs for a local one', guard('postgresql://u:p@localhost:5432/x') === 0 && guard('postgresql://u:p@127.0.0.1/x') === 0);
    } finally {
        const uids = userIds.join(',') || '0', aids = adminIds.join(',') || '0', rids = roleIds.join(',') || '0';
        const emps = `SELECT id FROM employees WHERE user_id IN (${uids})`;
        const srs = `SELECT id FROM service_requests WHERE user_id IN (${uids})`;
        const ph = phones.map(p => `'${p}'`).join(',') || `''`;
        await removeFixtures([
            `DELETE FROM ratings WHERE service_request_id IN (${srs})`,
            `DELETE FROM withdrawal_requests WHERE partner_id IN (${emps})`,
            `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (${emps}) OR service_request_id IN (${srs})`,
            `DELETE FROM wallet_transactions WHERE provider_id IN (${emps}) OR service_request_id IN (${srs})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (${emps})`,
            `DELETE FROM invoices WHERE service_request_id IN (${srs})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${srs})`,
            `DELETE FROM payment_transactions WHERE razorpay_order_id LIKE 'order_QAm${stamp}%'`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
            `DELETE FROM audit_logs WHERE entity_type = 'employee' AND entity_id IN (${emps})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${aids}) AND created_at > now() - interval '1 hour'`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM cart_items WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE user_id IN (${uids})`,
            `DELETE FROM employee_technician_types WHERE employee_id IN (${emps})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM customers WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM device_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM otp_verifications WHERE phone IN (${ph})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM products WHERE id IN (${productIds.join(',') || 0})`,
            `DELETE FROM admin_users WHERE id IN (${aids})`,
            `DELETE FROM admin_role_capabilities WHERE role_id IN (${rids})`,
            `DELETE FROM admin_roles WHERE id IN (${rids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
