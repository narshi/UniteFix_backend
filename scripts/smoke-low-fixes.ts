/**
 * The low findings from the pre-launch audit that have a behaviour to check.
 *
 *  L1  The old database password is no longer in the plan document.
 *  L2  The orders list still answers once, after the duplicate handler and the
 *      repeated route registrations were removed.
 *  L3  The email route that could never succeed is gone.
 *  L5  The public code generator is gone.
 *  L6  A profile picture can only be one of our own uploads.
 *  L7  Sign-in codes are stored hashed and still verify (a row written before
 *      the change too); a payment signature of the wrong shape is refused.
 *  L8  Two cancels sent together cancel once; the staff activate/deactivate
 *      route takes a real boolean and only a customer account.
 *
 * L4 (logging), L9 (opt-in database certificate check) and L10 are not
 * behaviours a request can show. Never calls Razorpay or Cashfree.
 *
 *   npm run smoke:low-fixes
 */

import fs from 'fs';
import jwt from 'jsonwebtoken';
import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, serviceRequests, otpVerifications, auditLogs } from '../shared/schema';
import { hashOtp, otpMatches } from '../server/lib/otp-hash';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], phones: string[] = [];
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
    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = `qa-secret-${stamp}`;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const token = (userId: number, role: string) => jwt.sign({ userId, role }, SECRET, { expiresIn: '15m' });
    const mkUser = async (role: 'user' | 'serviceman', name: string, extra: Record<string, unknown> = {}) => {
        const phone = newPhone();
        const [u] = await db.insert(users).values({ phone, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401', phoneVerified: true, ...extra } as any).returning();
        userIds.push(u.id);
        return { u, phone, t: token(u.id, role) };
    };

    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const owner = await mkUser('user', 'QA Low Owner');
        const tech = await mkUser('serviceman', 'QA Low Tech');

        // ══ L1 ══
        const plan = fs.readFileSync('REMEDIATION_PLAN.md', 'utf8');
        check('L1  the plan document holds no database password', !/postgres(ql)?:\/\/[^:\s]+:(?!<)[^@\s]+@/.test(plan));

        // ══ L2 ══
        const orders = await api.get('/api/admin/orders', S);
        check('L2  the orders list answers once, from the one handler left', orders.status === 200 && Array.isArray(orders.body?.data), `${orders.status}`);
        const pending = await api.get('/api/admin/employees/pending', S);
        check('L2  …and the verification queue (its module was registered twice) still answers', pending.status === 200, `${pending.status}`);

        // ══ L3, L5 ══
        check('L3  the email route that could never succeed is gone', (await api.post('/api/auth/email/verify-request', { email: 'a@b.co' }, owner.t)).status === 404);
        check('L5  the public code generator is gone', (await api.post('/api/utils/generate-code', {})).status === 404);

        // ══ L6 — profile picture links ══
        const pic = (imageUrl: string, t = owner.t) => api.post('/api/client/profile/picture', { imageUrl }, t);
        const bad = await Promise.all([
            pic('https://evil.example/pixel.png'),
            pic('http://res.cloudinary.com/demo/image/upload/a.jpg'),
            pic('https://res.cloudinary.com.evil.example/demo/a.jpg'),
            pic('https://user:pw@res.cloudinary.com/demo/a.jpg'),
            pic('javascript:alert(1)'),
        ]);
        check('L6  a picture link that is not one of our Cloudinary uploads is refused', bad.every(r => r.status === 400), bad.map(r => r.status).join(','));
        const good = await pic('https://res.cloudinary.com/demo/image/upload/v1/unitefix/profile_pictures/a.jpg');
        check('L6  one of our own uploads is accepted', good.status === 200 && /cloudinary/.test(good.body?.data?.profilePicture ?? ''), `${good.status}`);

        // ══ L7 — codes stored hashed ══
        check('L7  the helper matches its own hash, a plain row from before, and nothing else',
            otpMatches(hashOtp('123456'), '123456') && !otpMatches(hashOtp('123456'), '123457') && otpMatches('123456', '123456') && !otpMatches('123456', '654321') && !otpMatches(null, '1') && !otpMatches(hashOtp('1'), undefined as any));
        const fresh = newPhone(), mail = `qa-low-${stamp}@example.test`;
        const ask = await api.post('/api/auth/fallback/request-otp', { phone: fresh.slice(3), email: mail, role: 'user' });
        const [row] = await db.select().from(otpVerifications).where(eq(otpVerifications.phone, fresh));
        check('L7  a code that was requested is stored as a hash, not as digits', ask.status === 200 && /^[0-9a-f]{64}$/.test(row?.otp ?? ''), `${ask.status} ${row?.otp?.length}`);
        await db.update(otpVerifications).set({ otp: hashOtp('313131') }).where(eq(otpVerifications.id, row.id));
        const wrong = await api.post('/api/auth/fallback/verify-otp', { phone: fresh.slice(3), email: mail, code: '000001', role: 'user', mode: 'signup' });
        check('L7  a wrong code is refused', wrong.status === 400, `${wrong.status}`);
        const right = await api.post('/api/auth/fallback/verify-otp', { phone: fresh.slice(3), email: mail, code: '313131', role: 'user', mode: 'signup' });
        if (right.body?.user?.id) userIds.push(right.body.user.id);
        check('L7  the right code signs in', right.status === 200 && !!right.body?.accessToken, `${right.status} ${right.body?.message}`);
        // A code written before the change (plain digits) still works for a deploy that lands mid-flow.
        const legacy = await mkUser('user', 'QA Low Legacy', { email: `qa-low-legacy-${stamp}@example.test`, phoneVerified: false, emailVerified: true });
        await db.insert(otpVerifications).values({ phone: legacy.phone, email: legacy.u.email, otp: '272727', purpose: 'fallback_login', expiresAt: new Date(Date.now() + 600_000) });
        const old = await api.post('/api/auth/fallback/verify-otp', { phone: legacy.phone.slice(3), code: '272727', role: 'user', mode: 'login' });
        check('L7  …and a plain-digit row from before the change still verifies', old.status === 200 && !!old.body?.accessToken, `${old.status} ${old.body?.message}`);
        const sigs = await Promise.all([
            api.post('/api/payments/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'short' }, owner.t),
            api.post('/api/payments/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: { a: 1 } }, owner.t),
            api.post('/api/payments/verify', { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'f'.repeat(64) }, owner.t),
        ]);
        check('L7  a payment signature of the wrong length or type is refused cleanly', sigs.every(r => r.status === 400), sigs.map(r => r.status).join(','));

        // ══ L8 — cancel claim, staff status route ══
        const [bk] = await db.insert(serviceRequests).values({
            userId: owner.u.id, serviceId: `QA-LOW-${stamp}-1`, serviceType: 'QA low', brand: 'x', model: 'x', description: 'QA', address: 'Main road, Sirsi 581401',
            status: 'created', bookingFee: 149, bookingFeeStatus: 'pending',
        } as any).returning();
        const both = await Promise.all([api.post(`/api/services/${bk.id}/cancel`, {}, owner.t), api.post(`/api/services/${bk.id}/cancel`, {}, owner.t), api.post(`/api/services/${bk.id}/cancel`, {}, owner.t)]);
        const [after] = await db.select({ s: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, bk.id));
        check('L8  three cancels sent together cancel the booking once', both.filter(r => r.status === 200).length === 1 && after.s === 'cancelled', both.map(r => r.status).join(','));
        const [assigned] = await db.insert(serviceRequests).values({
            userId: owner.u.id, serviceId: `QA-LOW-${stamp}-2`, serviceType: 'QA low', brand: 'x', model: 'x', description: 'QA', address: 'Main road, Sirsi 581401',
            status: 'assigned', bookingFee: 149, bookingFeeStatus: 'paid',
        } as any).returning();
        const late = await api.post(`/api/services/${assigned.id}/cancel`, {}, owner.t);
        check('L8  a booking an expert already has cannot be cancelled by the customer', late.status === 400 && (await db.select({ s: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, assigned.id)))[0].s === 'assigned', `${late.status}`);

        const patch = (id: number, body: any) => api.patch(`/api/admin/users/${id}/status`, body, S);
        const strings = await Promise.all([patch(owner.u.id, { isActive: 'false' }), patch(owner.u.id, {}), patch(owner.u.id, { isActive: 0 })]);
        check('L8  the staff status route refuses anything that is not true or false', strings.every(r => r.status === 400) && (await db.select().from(users).where(eq(users.id, owner.u.id)))[0].isActive !== false, strings.map(r => r.status).join(','));
        const onExpert = await patch(tech.u.id, { isActive: false });
        check('L8  …and refuses an expert account (they have their own screens)', onExpert.status === 404 && (await db.select().from(users).where(eq(users.id, tech.u.id)))[0].isActive !== false, `${onExpert.status}`);
        const off = await patch(owner.u.id, { isActive: false });
        check('L8  a customer is deactivated, without their password hash in the answer', off.status === 200 && off.body?.data?.isActive === false && off.body?.data?.password === undefined, `${off.status}`);
        check('L8  …and it is in the audit trail', (await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(and(eq(auditLogs.action, 'user_deactivated'), eq(auditLogs.entityId, owner.u.id))))[0].n === 1);
        await patch(owner.u.id, { isActive: true });
    } finally {
        const uids = userIds.join(',') || '0', aids = adminIds.join(',') || '0';
        const ph = phones.map(p => `'${p}'`).join(',') || `''`;
        const srs = `SELECT id FROM service_requests WHERE user_id IN (${uids})`;
        await removeFixtures([
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
            `DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id IN (${uids})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${aids}) AND created_at > now() - interval '1 hour'`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${srs})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE user_id IN (${uids})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM customers WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM otp_verifications WHERE phone IN (${ph})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM admin_users WHERE id IN (${aids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
