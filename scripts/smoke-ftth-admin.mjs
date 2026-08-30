/**
 * FTTH staff-oversight smoke test.
 *
 *   npm run dev
 *   node scripts/smoke-ftth-admin.mjs
 *
 * Covers the controls that outlive approval: editing commercial terms, resetting
 * a locked-out operator's password, editing coverage on their behalf, and the
 * read-only activity view — plus the guard that a plain admin cannot do any of
 * it, and that an operator cannot reach the staff endpoints at all.
 *
 * Uses its own throwaway operator and cleans up in a `finally`.
 */

import 'dotenv/config';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

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

const PIN = '581359';
const PIN2 = '581355';
const stamp = String(Date.now()).slice(-9);
let operatorId, opAdminId, operatorToken;

try {
    for (const [p, area] of [[PIN, 'Yellapur'], [PIN2, 'Mundgod']]) {
        await c.query(
            `INSERT INTO serviceable_pincodes (pincode, area, district, state, is_active)
             VALUES ($1,$2,'Uttara Kannada','Karnataka',true) ON CONFLICT (pincode) DO NOTHING`, [p, area]);
    }

    const [sa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='super_admin' AND is_active=true ORDER BY id LIMIT 1`)).rows;
    const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const [pa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`)).rows;
    const adminToken = pa
        ? jwt.sign({ userId: pa.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' })
        : null;

    const [admin] = (await c.query(
        `INSERT INTO admin_users (username, email, password, role, is_active)
         VALUES ($1,$2,$3,'operator',true) RETURNING id`,
        [`qaadm${stamp}`, `qa.admin.${stamp}@example.com`, await bcrypt.hash('initial-pass-123', 10)])).rows;
    opAdminId = admin.id;

    const [op] = (await c.query(
        `INSERT INTO ftth_operators
            (admin_user_id, company_name, contact_email, contact_phone, status, convenience_fee_paise, lead_fee_paise)
         VALUES ($1,'QA Oversight ISP',$2,$3,'active',1000,40000) RETURNING id`,
        [admin.id, `qa.admin.${stamp}@example.com`, `9${stamp}`])).rows;
    operatorId = op.id;
    await c.query(`INSERT INTO ftth_operator_pincodes (operator_id, pincode) VALUES ($1,$2)`, [operatorId, PIN]);
    operatorToken = jwt.sign({ userId: admin.id, role: 'operator' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // ============ edit commercial terms after approval ============
    let r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}`, {
        token: superToken, body: { leadFeeRupees: 250, convenienceFeeRupees: 15, contactName: 'Renegotiated Desk' },
    });
    check('super_admin can change terms after approval', r.status === 200, `status ${r.status}`);

    let row = (await c.query(
        'SELECT lead_fee_paise, convenience_fee_paise, contact_name FROM ftth_operators WHERE id=$1',
        [operatorId])).rows[0];
    check('rupees convert to paise on the way in',
        row.lead_fee_paise === 25000 && row.convenience_fee_paise === 1500,
        `${row.lead_fee_paise} / ${row.convenience_fee_paise}`);

    // A new fee must apply to the NEXT recharge, and the operator's own view
    // should reflect it immediately.
    r = await req('GET', '/api/ftth/admin/me', { token: operatorToken });
    check('operator sees the new convenience fee immediately',
        r.json?.data?.convenienceFee === 15, `fee ${r.json?.data?.convenienceFee}`);

    r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}`, {
        token: superToken, body: { leadFeeRupees: null },
    });
    row = (await c.query('SELECT lead_fee_paise FROM ftth_operators WHERE id=$1', [operatorId])).rows[0];
    check('null clears the term back to the platform default',
        row.lead_fee_paise === null, `lead_fee_paise ${row.lead_fee_paise}`);

    // ============ plain admin is refused ============
    if (adminToken) {
        r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}`, {
            token: adminToken, body: { leadFeeRupees: 0 },
        });
        check('plain admin cannot change commercial terms', r.status === 403, `status ${r.status}`);

        r = await req('POST', `/api/admin/ftth/operators/${operatorId}/reset-password`, { token: adminToken, body: {} });
        check('plain admin cannot reset an operator password', r.status === 403, `status ${r.status}`);

        r = await req('GET', `/api/admin/ftth/operators/${operatorId}/activity`, { token: adminToken });
        check('plain admin CAN read the activity view', r.status === 200, `status ${r.status}`);
    }

    // ============ operator cannot reach staff controls ============
    r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}`, {
        token: operatorToken, body: { leadFeeRupees: 0 },
    });
    check('operator cannot edit their own commercial terms', r.status === 403, `status ${r.status}`);

    r = await req('GET', `/api/admin/ftth/operators/${operatorId}/activity`, { token: operatorToken });
    check('operator cannot reach the staff activity view', r.status === 403, `status ${r.status}`);

    // ============ password reset ============
    const before = (await c.query('SELECT password FROM admin_users WHERE id=$1', [opAdminId])).rows[0].password;
    r = await req('POST', `/api/admin/ftth/operators/${operatorId}/reset-password`, { token: superToken, body: {} });
    const temp = r.json?.data?.temporaryPassword;
    check('super_admin resets the password and gets it once',
        r.status === 200 && typeof temp === 'string' && temp.length >= 12, `status ${r.status}`);

    const after = (await c.query('SELECT password FROM admin_users WHERE id=$1', [opAdminId])).rows[0].password;
    check('the stored password actually changed and is hashed',
        after !== before && after.startsWith('$2'), after.slice(0, 7));

    r = await req('POST', '/api/admin/auth/login', {
        body: { username: `qaadm${stamp}`, password: temp },
    });
    check('the operator can sign in with the new password',
        r.status === 200 && !!r.json?.token, `status ${r.status}`);

    // ============ coverage on their behalf ============
    r = await req('PUT', `/api/admin/ftth/operators/${operatorId}/coverage`, {
        token: superToken, body: { pincodes: [PIN, PIN2] },
    });
    check('super_admin edits coverage on the operator\'s behalf', r.status === 200, `status ${r.status}`);

    const pins = (await c.query(
        'SELECT pincode FROM ftth_operator_pincodes WHERE operator_id=$1 ORDER BY pincode', [operatorId])).rows;
    check('both pincodes saved', pins.length === 2, pins.map(p => p.pincode).join(','));

    r = await req('PUT', `/api/admin/ftth/operators/${operatorId}/coverage`, {
        token: superToken, body: { pincodes: ['999999'] },
    });
    check('an unserviceable pincode is still refused', r.status === 400, `status ${r.status}`);

    // ============ activity view ============
    r = await req('GET', `/api/admin/ftth/operators/${operatorId}/activity`, { token: superToken });
    const d = r.json?.data;
    check('activity returns plans, customers, leads, recharges, ledger and a summary',
        !!d && Array.isArray(d.plans) && Array.isArray(d.connections) && Array.isArray(d.leads)
        && Array.isArray(d.recharges) && Array.isArray(d.ledger) && !!d.summary,
        Object.keys(d ?? {}).join(','));
    check('summary reports UniteFix revenue', typeof d?.summary?.unitefixRevenue === 'number',
        `unitefixRevenue ${d?.summary?.unitefixRevenue}`);

    // ============ audit ============
    const audits = (await c.query(
        `SELECT action FROM audit_logs WHERE entity_type='ftth_operator' AND entity_id=$1 ORDER BY id`,
        [operatorId])).rows.map(a => a.action);
    check('every staff action on an operator is audited',
        ['ftth_operator_updated', 'ftth_operator_password_reset', 'ftth_operator_coverage_updated']
            .every(a => audits.includes(a)),
        audits.join(', '));

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        if (operatorId) {
            await c.query('DELETE FROM ftth_operator_pincodes WHERE operator_id=$1', [operatorId]);
            await c.query(`DELETE FROM audit_logs WHERE entity_type='ftth_operator' AND entity_id=$1`, [operatorId]);
            await c.query('DELETE FROM ftth_operators WHERE id=$1', [operatorId]);
        }
        if (opAdminId) await c.query('DELETE FROM admin_users WHERE id=$1', [opAdminId]);
        // PIN2 is ours; PIN may be the demo seed's, so leave it alone.
        await c.query('DELETE FROM serviceable_pincodes WHERE pincode=$1', [PIN2]);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
