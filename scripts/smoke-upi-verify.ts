/**
 * Expert UPI verification through Cashfree Payouts ("Validate Payout"),
 * against a local stand-in for Cashfree — no real call leaves this box.
 *
 *   A real UPI ID comes back with the name registered at the bank; one that
 *   does not exist is refused; when Cashfree cannot answer (feature off, keys
 *   refused, outage) the id still saves as "not verified". Staff can check an
 *   expert's saved UPI ID again from the admin dashboard.
 *
 *   npm run smoke:upi-verify
 */

import http from 'http';
import type { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees } from '../shared/schema';
import { UpiValidationService } from '../server/services/upi-validation.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];
const seen: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
let mode: 'normal' | 'feature_off' | 'down' | 'keys' = 'normal';

// The stand-in: success@upi is VALID (Ravi Kumar), nobody@upi INVALID, bad-format → 400.
const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        seen.push({ headers: req.headers, body });
        const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
        if (req.url !== '/payout/validatePayout') return send(404, { message: 'no route' });
        if (mode === 'down') return send(503, { message: 'unavailable' });
        if (mode === 'keys') return send(401, { code: 'authentication_failed', message: 'Invalid clientId and clientSecret combination' });
        if (mode === 'feature_off') return send(422, { code: 'failed_to_process_request', message: 'feature not enabled' });
        if (!/^[\w.-]+@[\w.-]+$/.test(body.vpa ?? '')) return send(400, { code: 'vpa_invalid', message: 'vpa : invalid' });
        if (body.vpa === 'success@upi') return send(200, { transfer_token: 'tok', vpa: body.vpa, account_status: 'VALID', name_at_bank: 'RAVI KUMAR' });
        return send(200, { transfer_token: '', vpa: body.vpa, account_status: 'INVALID' });
    });
});

async function main() {
    await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
    const fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    UpiValidationService.cashfreeBaseUrl = () => fakeBase;
    for (const k of ['CASHFREE_CLIENT_ID', 'CASHFREE_CLIENT_SECRET', 'CASHFREE_PUBLIC_KEY', 'CASHFREE_PAYOUTS_PUBLIC_KEY']) delete process.env[k];
    process.env.CASHFREE_PAYOUTS_CLIENT_ID = 'QA_PAYOUTS_ID';
    process.env.CASHFREE_PAYOUTS_CLIENT_SECRET = 'QA_PAYOUTS_SECRET';

    const { base, close } = await bootServer();
    const api = client(base);
    try {
        // ── the service ──
        const ok = await UpiValidationService.verify('success@upi');
        check('a real UPI ID comes back with the name registered at the bank', ok.status === 'valid' && ok.customerName === 'RAVI KUMAR');
        const last = seen[seen.length - 1];
        check('…asked with the Payouts keys and Cashfree\'s API version', last.headers['x-client-id'] === 'QA_PAYOUTS_ID' && last.headers['x-client-secret'] === 'QA_PAYOUTS_SECRET' && last.headers['x-api-version'] === '2024-01-01');
        check('…with a fresh, valid transfer id (letters, digits, underscores, ≤ 40)', /^[A-Za-z0-9_]{1,40}$/.test(last.body.transfer_id) && seen.length === 1);
        await UpiValidationService.verify('success@upi');
        check('each check uses a new transfer id', seen[0].body.transfer_id !== seen[1].body.transfer_id);
        check('a UPI ID that does not exist is refused', (await UpiValidationService.verify('nobody@upi')).status === 'invalid');
        check('a malformed one too', (await UpiValidationService.verify('not a vpa')).status === 'invalid');
        mode = 'feature_off';
        const off = await UpiValidationService.verify('success@upi');
        check('feature not enabled at Cashfree: saved as not verified, with the reason', off.status === 'unverified' && /not enabled/.test(off.reason ?? ''));
        mode = 'keys';
        check('keys refused: not verified, never "not found"', (await UpiValidationService.verify('success@upi')).status === 'unverified');
        mode = 'down';
        check('Cashfree down: not verified, never "not found"', (await UpiValidationService.verify('success@upi')).status === 'unverified');
        mode = 'normal';

        // ── the expert saves a UPI ID in the app ──
        const SECRET = process.env.JWT_SECRET as string;
        const [u] = await db.insert(users).values({ phone: `9${String(Date.now()).slice(-9)}`, username: 'QA UPI Expert', role: 'serviceman', isActive: true } as any).returning();
        userIds.push(u.id);
        const t = jwt.sign({ userId: u.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        const [emp] = await db.insert(employees).values({ userId: u.id, fullName: 'QA UPI Expert', upiId: 'success@upi' } as any).returning();
        const v = await api.post('/api/partner/profile/upi/validate', { upiId: 'success@upi' }, t);
        check('the app\'s "check this UPI ID" shows whose it is', v.status === 200 && JSON.stringify(v.body).includes('RAVI KUMAR'), JSON.stringify(v.body).slice(0, 200));

        // ── staff check a UPI ID saved before verification was on ──
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const st = (await api.login(sa.username, sa.password))!;
        check('an older UPI ID starts as not verified', !emp.upiVerifiedAt);
        const r1 = await api.post(`/api/admin/servicemen/${emp.id}/upi/verify`, {}, st);
        const [e1] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('staff "Verify now" records the registered name', r1.status === 200 && !!e1.upiVerifiedAt && e1.upiVerifiedName === 'RAVI KUMAR' && /RAVI KUMAR/.test(r1.body.message), JSON.stringify(r1.body));
        mode = 'down';
        const r2 = await api.post(`/api/admin/servicemen/${emp.id}/upi/verify`, {}, st);
        const [e2] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('when Cashfree cannot answer, nothing is changed and staff are told', r2.status === 502 && !!e2.upiVerifiedAt && /Nothing was changed/.test(r2.body.message));
        mode = 'normal';
        await db.update(employees).set({ upiId: 'nobody@upi' }).where(eq(employees.id, emp.id));
        const r3 = await api.post(`/api/admin/servicemen/${emp.id}/upi/verify`, {}, st);
        const [e3] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('a UPI ID that turns out not to exist loses its verified mark', r3.status === 200 && r3.body.data.status === 'invalid' && !e3.upiVerifiedAt && !e3.upiVerifiedName);
        check('staff without sign-in cannot run it', (await api.post(`/api/admin/servicemen/${emp.id}/upi/verify`, {})).status === 401);
    } finally {
        await close();
        fake.close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    await cleanupPartners([], adminIds, [
        `DELETE FROM audit_logs WHERE entity_type = 'employee' AND entity_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
