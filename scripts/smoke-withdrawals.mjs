/**
 * Partner wallet redemption — end to end.
 *
 *   npm run dev
 *   node scripts/smoke-withdrawals.mjs
 *
 * The regression this exists for: POST /api/partner/wallet/withdraw used to
 * require employees.razorpay_fund_account_id. That id is only ever written by
 * RazorpayXService.syncEmployeeForPayouts, whose failure was swallowed when the
 * partner saved their UPI — so a partner with a perfectly good UPI id got a 400
 * saying "UPI ID not found", no withdrawal_requests row was written, and nothing
 * appeared on the admin Withdrawals screen. RazorpayX is not even configured
 * here, so this was every partner, not one.
 *
 * The case that matters most below is "no fund account can STILL request a
 * payout" — that is the bug, expressed as a test.
 *
 * Creates its own partner and wallet, and removes them in a `finally`.
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
let userId, employeeId, partnerToken;

try {
    // ---- a partner with a UPI id, a balance, and NO fund account ----------
    const [u] = (await c.query(
        `INSERT INTO users (phone, username, role, is_active, phone_verified)
         VALUES ($1,'QA Payout Partner','serviceman',true,true) RETURNING id`,
        [`9${stamp}`])).rows;
    userId = u.id;

    const [e] = (await c.query(
        `INSERT INTO employees (user_id, full_name, upi_id, document_verification_status, is_active)
         VALUES ($1,'QA Payout Partner','qapartner@upi','verified',true) RETURNING id`,
        [userId])).rows;
    employeeId = e.id;

    await c.query(
        `INSERT INTO partner_wallets (partner_id, balance_available, balance_hold)
         VALUES ($1,'5000.00','0.00')`, [employeeId]);

    partnerToken = jwt.sign({ userId, role: 'serviceman' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const row = (await c.query(
        'SELECT razorpay_fund_account_id FROM employees WHERE id=$1', [employeeId])).rows[0];
    check('fixture partner has NO RazorpayX fund account',
        row.razorpay_fund_account_id === null, String(row.razorpay_fund_account_id));

    // ---- THE regression --------------------------------------------------
    let r = await req('POST', '/api/partner/wallet/withdraw', {
        token: partnerToken, body: { amount: 1000, method: 'upi' },
    });
    check('a partner with no fund account CAN still request a payout',
        r.status === 200, `status ${r.status} ${r.json?.message ?? r.text.slice(0, 120)}`);

    const { rows: created } = await c.query(
        'SELECT id, amount, method, status FROM withdrawal_requests WHERE partner_id=$1', [employeeId]);
    check('a withdrawal_requests row was actually written',
        created.length === 1 && created[0].status === 'pending',
        created.length ? `#${created[0].id} ${created[0].status} ₹${created[0].amount}` : 'none');

    // ---- it reaches the admin screen -------------------------------------
    const [sa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='super_admin' AND is_active=true
           AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows;
    const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    r = await req('GET', '/api/admin/withdrawals?status=all&limit=100', { token: superToken });
    const visible = (r.json?.data ?? []).some(w => w.request?.partnerId === employeeId);
    check('and it is visible on the admin Withdrawals screen', visible,
        `status ${r.status}, ${(r.json?.data ?? []).length} row(s) returned`);

    // ---- the wallet moved with it ----------------------------------------
    const wallet = (await c.query(
        'SELECT balance_available FROM partner_wallets WHERE partner_id=$1', [employeeId])).rows[0];
    check('the wallet was debited in the same transaction',
        parseFloat(wallet.balance_available) === 4000, `₹${wallet.balance_available}`);

    const ledger = (await c.query(
        `SELECT transaction_type FROM wallet_transactions_v2 WHERE partner_id=$1`, [employeeId])).rows;
    check('a wallet ledger entry was written', ledger.length === 1, ledger.map(l => l.transaction_type).join(','));

    // ---- the guards that SHOULD still refuse ------------------------------
    r = await req('POST', '/api/partner/wallet/withdraw', {
        token: partnerToken, body: { amount: 99999, method: 'upi' },
    });
    check('overdrawing is still refused', r.status === 400, `status ${r.status}`);

    r = await req('POST', '/api/partner/wallet/withdraw', {
        token: partnerToken, body: { amount: 1, method: 'upi' },
    });
    check('below the minimum is still refused', r.status === 400, `status ${r.status}`);

    // A bank payout with no bank details on file names the real problem now,
    // instead of failing with something about UPI.
    r = await req('POST', '/api/partner/wallet/withdraw', {
        token: partnerToken, body: { amount: 1000, method: 'bank' },
    });
    check('requesting a bank payout with no bank details is refused clearly',
        r.status === 400 && r.json?.code === 'NO_BANK_DETAILS',
        `status ${r.status} code ${r.json?.code}`);

    // ---- a partner with no payout destination at all ----------------------
    await c.query('UPDATE employees SET upi_id=NULL WHERE id=$1', [employeeId]);
    r = await req('POST', '/api/partner/wallet/withdraw', {
        token: partnerToken, body: { amount: 1000, method: 'upi' },
    });
    check('no payout destination is still refused, with an actionable code',
        r.status === 400 && r.json?.code === 'NO_PAYOUT_DESTINATION',
        `status ${r.status} code ${r.json?.code}`);
    await c.query('UPDATE employees SET upi_id=$2 WHERE id=$1', [employeeId, 'qapartner@upi']);

    // ---- admin can see the broken payout setup ----------------------------
    r = await req('GET', `/api/admin/servicemen/list?q=QA Payout Partner`, { token: superToken });
    const listed = (r.json?.data ?? []).find(p => p.id === employeeId);
    check('the admin list reports payout readiness',
        listed && listed.hasPayoutDestination === true && listed.payoutAutomationReady === false,
        listed ? `destination=${listed.hasPayoutDestination} automation=${listed.payoutAutomationReady}` : 'partner not listed');

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        if (employeeId) {
            await c.query('DELETE FROM withdrawal_requests WHERE partner_id=$1', [employeeId]);
            await c.query('DELETE FROM wallet_transactions_v2 WHERE partner_id=$1', [employeeId]);
            await c.query('DELETE FROM wallet_transactions WHERE provider_id=$1', [employeeId]);
            await c.query('DELETE FROM partner_wallets WHERE partner_id=$1', [employeeId]);
            await c.query('DELETE FROM employees WHERE id=$1', [employeeId]);
        }
        if (userId) await c.query('DELETE FROM users WHERE id=$1', [userId]);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
