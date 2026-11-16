/**
 * The five critical fixes from the pre-launch audit.
 *
 *  C1  Firebase SMS sign-in: the account is the number Firebase verified,
 *      never the number in the request body.
 *  C2  /api/otp/send and /api/otp/verify are gone.
 *  C3  The email-code fallback never attaches a caller's email to an existing
 *      account, and an account first made by email is handed to whoever later
 *      proves its phone number.
 *  C4  The first job routes (/api/service/verify-handshake, /start, /complete)
 *      are retired and change nothing.
 *  C5  /api/payments/verify completes a booking only for its own customer and
 *      only on a final-payment order; a repeat records nothing new.
 *
 * Never calls Razorpay, Firebase or a mail server.
 *
 *   npm run smoke:critical-fixes
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, db } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services, paymentTransactions, otpVerifications } from '../shared/schema';
import { admin } from '../server/lib/firebase';
import { hashOtp } from '../server/lib/otp-hash';

const stamp = Date.now().toString(36);
const userIds: number[] = [], catIds: number[] = [], svcIds: number[] = [], phones: string[] = [];

/** A fresh Indian mobile number in the stored format (+91 and ten digits). */
const newPhone = () => { const p = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`; phones.push(p); return p; };
const ten = (p: string) => p.slice(3);

/** Run the deletes in passes, so foreign-key order does not matter; a table that does not exist is skipped. */
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
    // No key id: bookings take the development path and never reach Razorpay.
    // A secret of our own: signatures for /api/payments/verify are made here.
    delete process.env.RAZORPAY_KEY_ID;
    const RZP_SECRET = `qa-secret-${stamp}`;
    process.env.RAZORPAY_KEY_SECRET = RZP_SECRET;

    // Firebase: each test token maps to what verifyIdToken would return.
    const FIREBASE: Record<string, Record<string, unknown>> = {};
    Object.defineProperty(admin, 'auth', {
        configurable: true,
        value: () => ({
            verifyIdToken: async (t: string) => { const d = FIREBASE[t]; if (!d) throw new Error('invalid token'); return d; },
        }),
    });

    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;

    const mkUser = async (role: 'user' | 'serviceman', name: string, extra: Record<string, unknown> = {}) => {
        const phone = newPhone();
        const [u] = await db.insert(users).values({ phone, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401', phoneVerified: true, ...extra } as any).returning();
        userIds.push(u.id);
        return { u, phone, t: jwt.sign({ userId: u.id, role }, SECRET, { expiresIn: '1h' }) };
    };
    const account = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];
    // Codes are stored hashed, so the digits cannot be read back: set the newest code for
    // this phone to a known one, as if the user had read it from their inbox.
    const KNOWN = '424242';
    const knownCode = async (phone: string) => {
        const row = await latestCode(phone);
        if (!row) return null;
        await db.update(otpVerifications).set({ otp: hashOtp(KNOWN) }).where(eq(otpVerifications.id, row.id));
        return { ...row, otp: KNOWN };
    };
    const latestCode = async (phone: string) => (await db.select().from(otpVerifications)
        .where(and(eq(otpVerifications.phone, phone), eq(otpVerifications.purpose, 'fallback_login'))).orderBy(desc(otpVerifications.id)).limit(1))[0];

    try {
        // ══ C1 — Firebase SMS sign-in ══
        const victim = await mkUser('user', 'QA Crit Victim');
        const attackerPhone = newPhone();
        FIREBASE['tok-attacker'] = { uid: 'a', phone_number: attackerPhone };
        FIREBASE['tok-nophone'] = { uid: 'b' };
        FIREBASE['tok-victim'] = { uid: 'c', phone_number: victim.phone };

        const c1a = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-attacker', phone: ten(victim.phone), role: 'user', mode: 'login' });
        check('C1  a token for my own number does not sign me in as another number', c1a.status === 401 && c1a.body?.code === 'PHONE_MISMATCH' && !c1a.body?.accessToken, `${c1a.status} ${c1a.body?.code}`);
        const c1b = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-nophone', phone: ten(victim.phone), role: 'user', mode: 'login' });
        check('C1  a token with no phone number is refused', c1b.status === 401 && !c1b.body?.accessToken, `${c1b.status}`);
        const c1c = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-victim', phone: ten(victim.phone), role: 'user', mode: 'login' });
        check('C1  the number Firebase verified signs in to its own account', c1c.status === 200 && c1c.body?.user?.id === victim.u.id && !!c1c.body?.accessToken, `${c1c.status} ${c1c.body?.message}`);
        const c1d = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-victim', phone: victim.phone, role: 'user', mode: 'login' });
        check('C1  …with the number written as +91… too', c1d.status === 200 && c1d.body?.user?.id === victim.u.id, `${c1d.status}`);

        // ══ C2 — the open OTP routes ══
        const c2a = await api.post('/api/otp/send', { phone: victim.phone, purpose: 'password_reset' });
        check('C2  /api/otp/send is gone and hands out no code', c2a.status === 404 && c2a.body?.otp === undefined, `${c2a.status}`);
        const c2b = await api.post('/api/otp/verify', { phone: victim.phone, otp: '123456', purpose: 'password_reset' });
        check('C2  /api/otp/verify is gone', c2b.status === 404, `${c2b.status}`);
        const [stray] = await db.select({ id: otpVerifications.id }).from(otpVerifications).where(eq(otpVerifications.phone, victim.phone)).limit(1);
        check('C2  …and no code was stored for that number', !stray);

        // ══ C3 — the email-code fallback ══
        // An account with a proven number and no email (a Truecaller drop-call signup).
        const noEmail = await mkUser('user', 'QA Crit NoEmail');
        const evil = `qa-evil-${stamp}@example.test`;
        const c3a = await api.post('/api/auth/fallback/request-otp', { phone: ten(noEmail.phone), email: evil, role: 'user' });
        check('C3  a stranger cannot attach their email to an existing account', c3a.status === 409 && c3a.body?.code === 'PHONE_SIGNIN_REQUIRED', `${c3a.status} ${c3a.body?.code}`);
        check('C3  …the account is untouched and no code was made', (await account(noEmail.u.id)).email == null && !(await latestCode(noEmail.phone)));
        const c3b = await api.post('/api/auth/fallback/verify-otp', { phone: ten(noEmail.phone), email: evil, code: '000000', role: 'user', mode: 'login' });
        check('C3  …and verify-otp will not take a typed email for it either', c3b.status === 409, `${c3b.status}`);

        // An account made by email code: its number was never proven.
        const mail = `qa-owner-${stamp}@example.test`;
        const byEmail = await mkUser('user', 'QA Crit ByEmail', { phoneVerified: false, email: mail, emailVerified: true, password: 'x'.repeat(60) });
        const c3c = await api.post('/api/auth/fallback/request-otp', { phone: ten(byEmail.phone), email: evil, role: 'user' });
        const code1 = await knownCode(byEmail.phone);
        check('C3  an email-only account still gets its code — at the email on file, not the one typed', c3c.status === 200 && code1?.email === mail && c3c.body?.sentToRegisteredEmail === true, `${c3c.status} ${code1?.email}`);
        const c3d = await api.post('/api/auth/fallback/verify-otp', { phone: ten(byEmail.phone), code: code1?.otp, role: 'user', mode: 'login' });
        const oldRefresh: string = c3d.body?.refreshToken;
        check('C3  …and signs in with it', c3d.status === 200 && c3d.body?.user?.id === byEmail.u.id && !!oldRefresh, `${c3d.status} ${c3d.body?.message}`);

        // A second code, still unused when the number's owner shows up.
        await db.insert(otpVerifications).values({ phone: byEmail.phone, email: mail, otp: '654321', purpose: 'fallback_login', expiresAt: new Date(Date.now() + 10 * 60_000) });
        FIREBASE['tok-owner'] = { uid: 'd', phone_number: byEmail.phone };
        const c3e = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-owner', phone: ten(byEmail.phone), role: 'user', mode: 'login' });
        const claimed = await account(byEmail.u.id);
        check('C3  proving the number signs its owner in to that account', c3e.status === 200 && c3e.body?.user?.id === byEmail.u.id, `${c3e.status} ${c3e.body?.message}`);
        check('C3  …marks the number proven, the email unconfirmed, and removes the password', claimed.phoneVerified === true && claimed.emailVerified === false && claimed.password == null && claimed.email === mail);
        const c3f = await api.post('/api/auth/refresh', { refreshToken: oldRefresh });
        check('C3  …ends the sessions that were open before', c3f.status === 401, `${c3f.status}`);
        const c3g = await api.post('/api/auth/fallback/verify-otp', { phone: ten(byEmail.phone), code: '654321', role: 'user', mode: 'login' });
        check('C3  …a code requested earlier no longer signs anyone in', c3g.status === 409 && !c3g.body?.accessToken, `${c3g.status}`);
        const c3h = await api.post('/api/auth/fallback/request-otp', { phone: ten(byEmail.phone), role: 'user' });
        check('C3  …and no new email code is sent for it', c3h.status === 409, `${c3h.status}`);
        const c3i = await api.post('/api/auth/fallback/firebase-verify', { idToken: 'tok-owner', phone: ten(byEmail.phone), role: 'user', mode: 'login' });
        check('C3  the owner keeps signing in by SMS', c3i.status === 200 && !!c3i.body?.accessToken, `${c3i.status}`);

        // A brand-new number by email (the website's expert registration) still works.
        const fresh = newPhone(), freshMail = `qa-new-${stamp}@example.test`;
        const c3j = await api.post('/api/auth/fallback/request-otp', { phone: ten(fresh), email: freshMail, role: 'serviceman', firstName: 'QA', lastName: 'Crit New' });
        const code2 = await knownCode(fresh);
        const c3k = await api.post('/api/auth/fallback/verify-otp', { phone: ten(fresh), email: freshMail, code: code2?.otp, role: 'serviceman', firstName: 'QA', lastName: 'Crit New', mode: 'signup' });
        if (c3k.body?.user?.id) userIds.push(c3k.body.user.id);
        check('C3  a new number can still register by email code', c3j.status === 200 && c3k.status === 200 && c3k.body?.isNewUser === true && c3k.body?.user?.phoneVerified === false, `${c3j.status} ${c3k.status} ${c3k.body?.message}`);

        // ══ Bookings for C4 and C5 ══
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Crit ${stamp}`, bookingFee: 149 }).returning();
        catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Crit fan ${stamp}`, basePrice: 1000 }).returning();
        svcIds.push(svc.id);
        const owner = await mkUser('user', 'QA Crit Owner');
        const stranger = await mkUser('user', 'QA Crit Stranger');
        const tech = await mkUser('serviceman', 'QA Crit Tech');
        const pending = await mkUser('serviceman', 'QA Crit Unapproved');
        const [emp] = await db.insert(employees).values({ userId: tech.u.id, fullName: 'QA Crit Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        await db.insert(employees).values({ userId: pending.u.id, fullName: 'QA Crit Unapproved', isActive: false, documentVerificationStatus: 'pending' as any } as any);

        const book = async () => {
            const r = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA critical-fix booking', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svc.id }, owner.t);
            const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, r.body?.data?.id ?? 0));
            if (!sr) throw new Error(`booking failed: ${r.status} ${JSON.stringify(r.body)}`);
            return sr;
        };
        const state = async (id: number) => (await db.select({ s: serviceRequests.status, f: serviceRequests.bookingFeeStatus, total: serviceRequests.totalAmount, pm: serviceRequests.paymentMethod }).from(serviceRequests).where(eq(serviceRequests.id, id)))[0];

        // ══ C4 — the first job routes ══
        const job = await book();
        await db.update(serviceRequests).set({ status: 'in_progress' as any, providerId: emp.id }).where(eq(serviceRequests.id, job.id));
        const before = await state(job.id);
        for (const [path, body] of [
            ['/api/service/complete', { serviceId: job.id, totalAmount: 1 }],
            ['/api/service/start', { serviceId: job.id, providerLat: 14.6, providerLong: 74.8 }],
            ['/api/service/verify-handshake', { serviceId: job.id, otp: '123456' }],
        ] as const) {
            const r = await api.post(path, body, pending.t);
            const now = await state(job.id);
            check(`C4  ${path} is retired: an unapproved expert changes nothing on someone else's job`, r.status === 410 && now.s === before.s && now.total === before.total, `${r.status} ${before.s}→${now.s}`);
        }
        const c4own = await api.post('/api/service/complete', { serviceId: job.id, totalAmount: 1 }, tech.t);
        const afterOwn = await state(job.id);
        check('C4  …and the assigned expert cannot use it to skip payment either', c4own.status === 410 && afterOwn.s === 'in_progress' && afterOwn.total === before.total, `${c4own.status} ${afterOwn.s}`);
        check('C4  no login, no answer', (await api.post('/api/service/complete', { serviceId: job.id })).status === 401);

        // ══ C5 — /api/payments/verify ══
        const order = async (srId: number, id: string, paymentType: string, amountPaise: number) => {
            await db.insert(paymentTransactions).values({ serviceRequestId: srId, razorpayOrderId: id, amount: amountPaise, currency: 'INR', eventType: 'order_created', status: 'pending', metadata: { paymentType } } as any);
            return id;
        };
        const verify = (orderId: string, paymentId: string, token: string) => api.post('/api/payments/verify', {
            razorpay_order_id: orderId, razorpay_payment_id: paymentId,
            razorpay_signature: crypto.createHmac('sha256', RZP_SECRET).update(`${orderId}|${paymentId}`).digest('hex'),
        }, token);
        const sdkRows = async (paymentId: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(paymentTransactions)
            .where(and(eq(paymentTransactions.razorpayPaymentId, paymentId), eq(paymentTransactions.eventType, 'payment_captured'))))[0].n;

        // The booking fee is paid as usual…
        const owed = await book();
        await db.update(serviceRequests).set({ bookingFeeStatus: 'pending' as any }).where(eq(serviceRequests.id, owed.id));
        const feeOrder = await order(owed.id, `order_QAfee${stamp}`, 'booking_charge', 14900);
        const feePay = `pay_QAfee${stamp}`;
        const c5a = await verify(feeOrder, feePay, owner.t);
        check('C5  paying the booking fee still marks it paid', c5a.status === 200 && (await state(owed.id)).f === 'paid', `${c5a.status} ${c5a.body?.message}`);

        // …then the job is done and ₹851 is due.
        await db.update(serviceRequests).set({ status: 'pending_payment' as any, providerId: emp.id }).where(eq(serviceRequests.id, owed.id));
        const c5b = await verify(feeOrder, feePay, owner.t);
        const s5b = await state(owed.id);
        check('C5  re-sending the booking-fee payment does NOT complete the booking', s5b.s === 'pending_payment' && s5b.pm !== 'online', `${c5b.status} ${s5b.s}`);
        check('C5  …and records nothing new', (await sdkRows(feePay)) === 1, `${await sdkRows(feePay)} rows`);

        const finalOrder = await order(owed.id, `order_QAfin${stamp}`, 'final_payment', 85100);
        const finalPay = `pay_QAfin${stamp}`;
        const c5c = await verify(finalOrder, finalPay, stranger.t);
        check('C5  someone else cannot confirm a payment on my booking', c5c.status === 403 && (await state(owed.id)).s === 'pending_payment' && (await sdkRows(finalPay)) === 0, `${c5c.status}`);
        const c5d = await api.post('/api/payments/verify', { razorpay_order_id: finalOrder, razorpay_payment_id: finalPay, razorpay_signature: 'f'.repeat(64) }, owner.t);
        check('C5  a wrong signature is still refused', c5d.status === 400 && (await state(owed.id)).s === 'pending_payment', `${c5d.status}`);
        const c5e = await verify(finalOrder, finalPay, owner.t);
        const s5e = await state(owed.id);
        check('C5  the real final payment completes it', c5e.status === 200 && s5e.s === 'completed' && s5e.pm === 'online', `${c5e.status} ${s5e.s} ${c5e.body?.message}`);
        const c5f = await verify(finalOrder, finalPay, owner.t);
        check('C5  sending it again is harmless: one record, still completed', c5f.status === 200 && (await sdkRows(finalPay)) === 1 && (await state(owed.id)).s === 'completed', `${c5f.status} ${await sdkRows(finalPay)} rows`);

        // An order this route does not know (no order_created row): recorded, no booking touched.
        const other = await book();
        await db.update(serviceRequests).set({ status: 'pending_payment' as any, providerId: emp.id }).where(eq(serviceRequests.id, other.id));
        const c5g = await verify(`order_QAnone${stamp}`, `pay_QAnone${stamp}`, owner.t);
        check('C5  a payment for an order with no booking on record completes nothing', c5g.status === 200 && (await state(other.id)).s === 'pending_payment', `${c5g.status}`);
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
        const ph = phones.map(p => `'${p}'`).join(',') || `''`;
        // Own loop, not cleanupPartners: that helper returns at once when it is
        // given no partner or admin ids, which would leave every row below behind.
        await removeFixtures([
            `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM service_part_items WHERE service_request_id IN (${ids})`,
            `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE razorpay_order_id LIKE 'order_QA%${stamp}'`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM employee_technician_types WHERE employee_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM customers WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM otp_verifications WHERE phone IN (${ph})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM services WHERE id IN (${svcIds.join(',') || 0})`,
            `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
