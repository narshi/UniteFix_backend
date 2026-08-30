/**
 * UPI ID validation.
 *
 *   npm run dev
 *   node scripts/smoke-upi-validation.mjs
 *
 * Before this, the only check was `upiId.includes('@')`, so an email address,
 * a typo'd handle and plain nonsense all saved successfully — and the partner
 * found out when a payout failed, if ever.
 *
 * The two cases that matter most below:
 *   - a VALID UPI registered to someone else is refused until the partner
 *     confirms the name (the only failure that actually loses money), and
 *   - when the provider cannot be reached, the id still saves. Locking a
 *     partner out of getting paid because a third party is down would be a
 *     worse bug than the one this prevents.
 *
 * Razorpay answers deterministically in test mode: success@razorpay is valid,
 * failure@razorpay is not. Where the account has the endpoint disabled the
 * service returns 'unverified', and the assertions below accept either — the
 * point is that neither outcome strands the partner.
 */

import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const req = async (method, path, { token, body } = {}) => {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, json, text };
};

const stamp = String(Date.now()).slice(-9);
let userId, employeeId, token;

try {
    const [u] = (await c.query(
        `INSERT INTO users (phone, username, role, is_active, phone_verified)
         VALUES ($1,'QA UPI Partner','serviceman',true,true) RETURNING id`, [`9${stamp}`])).rows;
    userId = u.id;
    const [e] = (await c.query(
        `INSERT INTO employees (user_id, full_name, document_verification_status, is_active)
         VALUES ($1,'QA UPI Partner','verified',true) RETURNING id`, [userId])).rows;
    employeeId = e.id;
    token = jwt.sign({ userId, role: 'serviceman' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // ================= format: what used to slip through =================
    const REJECTED = [
        ['ramesh@gmail.com', 'LOOKS_LIKE_EMAIL', 'an email address'],
        ['ramesh@yahoo.co', 'LOOKS_LIKE_EMAIL', 'another email address'],
        ['9876543210', 'NO_HANDLE', 'no @ at all'],
        ['a@b@c', 'MULTIPLE_AT', 'two @ signs'],
        ['a@b', 'TOO_SHORT', 'too short to be real'],
        ['ram esh@ybl', 'BAD_CHARACTERS', 'a space in the middle'],
        ['', 'EMPTY', 'empty'],
    ];

    for (const [value, code, why] of REJECTED) {
        const r = await req('PUT', '/api/partner/profile/upi', { token, body: { upiId: value } });
        check(`rejected (${why}): ${JSON.stringify(value)}`,
            r.status === 400 && r.json?.code === code,
            `status ${r.status} code ${r.json?.code}`);
    }

    // The email case is the one partners actually hit, so its wording matters.
    let r = await req('PUT', '/api/partner/profile/upi', { token, body: { upiId: 'ramesh@gmail.com' } });
    check('the email message says what is wrong, not just "invalid"',
        /email address/i.test(r.json?.message ?? '') && /@ybl|@okhdfcbank/.test(r.json?.message ?? ''),
        r.json?.message);

    const stored = (await c.query('SELECT upi_id FROM employees WHERE id=$1', [employeeId])).rows[0];
    check('nothing was saved by any rejected attempt', stored.upi_id === null, String(stored.upi_id));

    // ================= format: what should pass =================
    r = await req('POST', '/api/partner/profile/upi/validate', { token, body: { upiId: '9876543210@ybl' } });
    check('a well-formed id passes the format check', r.status === 200 && r.json?.data?.status !== undefined,
        `status ${r.json?.data?.status}`);

    r = await req('POST', '/api/partner/profile/upi/validate', { token, body: { upiId: 'ramesh@somenewpsp' } });
    check('an unfamiliar handle warns but is not rejected',
        r.status === 200 && r.json?.data?.status !== 'invalid' && !!r.json?.data?.warning,
        r.json?.data?.warning ?? `status ${r.json?.data?.status}`);

    r = await req('POST', '/api/partner/profile/upi/validate', { token, body: { upiId: 'RAMESH@YBL' } });
    check('case is normalised before storing', r.json?.data?.upiId === 'ramesh@ybl', r.json?.data?.upiId);

    // ================= the PSP check =================
    r = await req('POST', '/api/partner/profile/upi/validate', { token, body: { upiId: 'failure@razorpay' } });
    const failureStatus = r.json?.data?.status;
    check('a nonexistent id is reported invalid, or honestly unverified',
        failureStatus === 'invalid' || failureStatus === 'unverified', `status ${failureStatus}`);

    r = await req('POST', '/api/partner/profile/upi/validate', { token, body: { upiId: 'success@razorpay' } });
    const successStatus = r.json?.data?.status;
    const returnedName = r.json?.data?.customerName;
    check('a real id is reported valid, or honestly unverified',
        successStatus === 'valid' || successStatus === 'unverified',
        `status ${successStatus}${returnedName ? ` name=${returnedName}` : ''}`);

    // ================= the case that loses money =================
    if (successStatus === 'valid' && returnedName) {
        r = await req('PUT', '/api/partner/profile/upi', { token, body: { upiId: 'success@razorpay' } });
        check('a valid id is held back until the partner confirms the name',
            r.status === 409 && r.json?.code === 'CONFIRM_NAME' && r.json?.data?.customerName === returnedName,
            `status ${r.status} code ${r.json?.code}`);

        r = await req('PUT', '/api/partner/profile/upi', {
            token, body: { upiId: 'success@razorpay', confirmedName: 'Somebody Else' },
        });
        check('confirming the WRONG name does not get through', r.status === 409, `status ${r.status}`);

        r = await req('PUT', '/api/partner/profile/upi', {
            token, body: { upiId: 'success@razorpay', confirmedName: returnedName },
        });
        check('confirming the right name saves it', r.status === 200, `status ${r.status}`);
        check('and the verification is recorded', r.json?.upiVerified === true, `upiVerified=${r.json?.upiVerified}`);

        const row = (await c.query(
            'SELECT upi_id, upi_verified_at, upi_verified_name FROM employees WHERE id=$1', [employeeId])).rows[0];
        check('verified_at and verified_name are stored',
            row.upi_verified_at !== null && row.upi_verified_name === returnedName,
            `${row.upi_verified_at} / ${row.upi_verified_name}`);
    } else {
        // Endpoint not enabled on this account — assert the degradation instead.
        console.log('\n  (Razorpay VPA validation unavailable here — asserting the fallback instead)\n');

        r = await req('PUT', '/api/partner/profile/upi', { token, body: { upiId: '9876543210@ybl' } });
        check('an unverifiable id still SAVES rather than stranding the partner',
            r.status === 200, `status ${r.status} ${r.json?.message ?? ''}`);
        check('and it is recorded as unverified, not falsely verified',
            r.json?.upiVerified === false, `upiVerified=${r.json?.upiVerified}`);

        const row = (await c.query(
            'SELECT upi_id, upi_verified_at FROM employees WHERE id=$1', [employeeId])).rows[0];
        check('upi_verified_at stays NULL — "unchecked", not a false claim',
            row.upi_id === '9876543210@ybl' && row.upi_verified_at === null,
            `${row.upi_id} / verified_at=${row.upi_verified_at}`);
    }

    // ================= admin can see the difference =================
    const [sa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='super_admin' AND is_active=true
           AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows;
    const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    r = await req('GET', '/api/admin/servicemen/list?q=QA UPI Partner', { token: superToken });
    const listed = (r.json?.data ?? []).find(p => p.id === employeeId);
    check('the admin list exposes UPI verification state',
        listed && 'upiVerifiedAt' in listed, listed ? `upiVerifiedAt=${listed.upiVerifiedAt}` : 'not listed');

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        if (employeeId) await c.query('DELETE FROM employees WHERE id=$1', [employeeId]);
        if (userId) await c.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
