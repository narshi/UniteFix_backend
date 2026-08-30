/**
 * Employee detail page — one expert's whole record in a single call.
 *
 *   npm run dev
 *   node scripts/smoke-employee-detail.mjs
 *
 * The part worth testing is the SPLIT: reaching this route needs employees:view,
 * but wallet history and payout requests additionally need payments:view /
 * withdrawals:view. A role that manages staff should not automatically be able
 * to read what they earn — and when a section is withheld the response must say
 * so, because an empty array that means "you may not see this" is otherwise
 * indistinguishable from one that means "there is nothing here".
 *
 * Creates its own expert, job, rating, wallet and payout, and removes them in a
 * `finally`.
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

const req = async (method, path, { token } = {}) => {
    const res = await fetch(BASE + path, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, json, text };
};

const stamp = String(Date.now()).slice(-9);
const made = { users: [], employees: [], services: [], roles: [], admins: [] };

try {
    // ---- an expert with a job, a rating, a wallet and a payout -------------
    const [eu] = (await c.query(
        `INSERT INTO users (phone, username, role, is_active, phone_verified)
         VALUES ($1,'QA Detail Expert','serviceman',true,true) RETURNING id`, [`9${stamp}`])).rows;
    made.users.push(eu.id);

    const [emp] = (await c.query(
        `INSERT INTO employees (user_id, full_name, upi_id, document_verification_status, is_active, services)
         VALUES ($1,'QA Detail Expert','qadetail@ybl','verified',true,$2) RETURNING id`,
        [eu.id, ['AC Repair']])).rows;
    made.employees.push(emp.id);

    await c.query(
        `INSERT INTO partner_wallets (partner_id, balance_available, balance_hold, total_earned)
         VALUES ($1,'250.00','416.60','2500.00')`, [emp.id]);

    const [cu] = (await c.query(
        `INSERT INTO users (phone, username, role, is_active, phone_verified)
         VALUES ($1,'QA Detail Customer','user',true,true) RETURNING id`, [`8${stamp}`])).rows;
    made.users.push(cu.id);

    // service_requests.total_amount / booking_fee are INTEGER rupees, unlike the
    // wallet's decimals. Passing '800.00' here fails outright.
    const [svc] = (await c.query(
        `INSERT INTO service_requests (service_id, user_id, provider_id, service_type, description, address, status, total_amount, booking_fee)
         VALUES ($1,$2,$3,'AC Repair','Split AC not cooling','12 Test Road, Yellapur','completed',800,250) RETURNING id`,
        [`SVC-QA${stamp}`, cu.id, emp.id])).rows;
    made.services.push(svc.id);

    await c.query(
        `INSERT INTO ratings (service_request_id, from_user_id, to_provider_id, rating, review, is_visible)
         VALUES ($1,$2,$3,5,'Excellent work, very professional',true)`, [svc.id, cu.id, emp.id]);

    await c.query(
        `INSERT INTO wallet_transactions_v2
            (transaction_id, partner_id, transaction_type, amount, release_date, is_released, description)
         VALUES ($1,$2,'hold_credit','416.60',$3,false,'Earnings held for service completion')`,
        [`WHLD-QA-${stamp}`, emp.id, new Date(Date.now() + 5 * 86_400_000)]);

    await c.query(
        `INSERT INTO withdrawal_requests (partner_id, amount, method, status)
         VALUES ($1,'250.00','upi','pending')`, [emp.id]);

    // ---- a super_admin sees everything ------------------------------------
    const [sa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='super_admin' AND is_active=true
           AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows;
    const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    let r = await req('GET', `/api/admin/servicemen/${emp.id}/detail`, { token: superToken });
    check('super_admin loads the full record', r.status === 200, `status ${r.status}`);

    const d = r.json?.data;
    check('profile, stats, jobs, ratings, wallet and payouts all present',
        !!d?.employee && !!d?.stats && Array.isArray(d?.jobs) && Array.isArray(d?.ratings)
        && Array.isArray(d?.wallet) && Array.isArray(d?.withdrawals),
        Object.keys(d ?? {}).join(','));

    check('jobs are counted correctly', d?.stats?.jobsCompleted === 1 && d?.stats?.jobsTotal === 1,
        `${d?.stats?.jobsCompleted}/${d?.stats?.jobsTotal}`);
    check('the rating average is computed from real reviews',
        d?.stats?.averageRating === 5 && d?.stats?.ratingCount === 1,
        `${d?.stats?.averageRating} from ${d?.stats?.ratingCount}`);
    check('the review text comes through',
        /Excellent work/.test(d?.ratings?.[0]?.review ?? ''), d?.ratings?.[0]?.review);
    check('the job carries its rating', d?.jobs?.[0]?.rating === 5, String(d?.jobs?.[0]?.rating));

    check('held money reports when it frees up',
        d?.stats?.balanceHold === '416.60' && !!d?.stats?.nextReleaseDate,
        `₹${d?.stats?.balanceHold} → ${d?.stats?.nextReleaseDate}`);
    check('the payout request is listed', d?.withdrawals?.length === 1, String(d?.withdrawals?.length));
    check('payout readiness is reported',
        d?.employee?.hasPayoutDestination === true && d?.employee?.payoutAutomationReady === false,
        `dest=${d?.employee?.hasPayoutDestination} auto=${d?.employee?.payoutAutomationReady}`);

    // ---- a role with staff access but NO money access ----------------------
    const [role] = (await c.query(
        `INSERT INTO admin_roles (slug, name, scope, is_system)
         VALUES ($1,'QA Staff Only','staff',false) RETURNING id`, [`qa_staff_${stamp}`])).rows;
    made.roles.push(role.id);
    await c.query(
        `INSERT INTO admin_role_capabilities (role_id, capability) VALUES ($1,'employees:view')`, [role.id]);

    const [ad] = (await c.query(
        `INSERT INTO admin_users (username, email, password, role, role_id, is_active)
         VALUES ($1,$2,'x',$3,$4,true) RETURNING id`,
        [`qastaff${stamp}`, `qastaff${stamp}@x.com`, `qa_staff_${stamp}`, role.id])).rows;
    made.admins.push(ad.id);
    const staffToken = jwt.sign({ userId: ad.id, role: `qa_staff_${stamp}` }, process.env.JWT_SECRET, { expiresIn: '1h' });

    r = await req('GET', `/api/admin/servicemen/${emp.id}/detail`, { token: staffToken });
    check('a staff-only role can open the page', r.status === 200, `status ${r.status}`);

    const s = r.json?.data;
    check('...and sees jobs and ratings', Array.isArray(s?.jobs) && Array.isArray(s?.ratings),
        `${s?.jobs?.length} jobs, ${s?.ratings?.length} ratings`);
    check('...but NOT wallet history', s?.wallet === null, JSON.stringify(s?.wallet));
    check('...and NOT payout requests', s?.withdrawals === null, JSON.stringify(s?.withdrawals));
    check('the response says money was WITHHELD, not that there is none',
        s?.visibility?.wallet === false && s?.visibility?.withdrawals === false,
        JSON.stringify(s?.visibility));

    // ---- grant payments:view and the wallet appears ------------------------
    await c.query(
        `INSERT INTO admin_role_capabilities (role_id, capability) VALUES ($1,'payments:view')`, [role.id]);
    r = await req('GET', `/api/admin/servicemen/${emp.id}/detail`, { token: staffToken });
    check('granting payments:view reveals the wallet, on the same token',
        Array.isArray(r.json?.data?.wallet) && r.json?.data?.visibility?.wallet === true,
        `wallet=${Array.isArray(r.json?.data?.wallet) ? r.json.data.wallet.length + ' rows' : 'null'}`);
    check('payouts stay hidden without withdrawals:view',
        r.json?.data?.withdrawals === null, JSON.stringify(r.json?.data?.withdrawals));

    // ---- an operator gets nothing -----------------------------------------
    const [opAdmin] = (await c.query(
        `SELECT id FROM admin_users WHERE role='operator' AND is_active=true LIMIT 1`)).rows;
    if (opAdmin) {
        const opToken = jwt.sign({ userId: opAdmin.id, role: 'operator' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        r = await req('GET', `/api/admin/servicemen/${emp.id}/detail`, { token: opToken });
        check('an FTTH operator cannot read an employee record at all', r.status === 403, `status ${r.status}`);
    }

    r = await req('GET', `/api/admin/servicemen/999999/detail`, { token: superToken });
    check('an unknown employee is a clean 404', r.status === 404, `status ${r.status}`);

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        for (const id of made.employees) {
            await c.query('DELETE FROM ratings WHERE to_provider_id=$1', [id]);
            await c.query('DELETE FROM withdrawal_requests WHERE partner_id=$1', [id]);
            await c.query('DELETE FROM wallet_transactions_v2 WHERE partner_id=$1', [id]);
            await c.query('DELETE FROM wallet_transactions WHERE provider_id=$1', [id]);
            await c.query('DELETE FROM service_requests WHERE provider_id=$1', [id]);
            await c.query('DELETE FROM partner_wallets WHERE partner_id=$1', [id]);
            await c.query('DELETE FROM employees WHERE id=$1', [id]);
        }
        for (const id of made.services) await c.query('DELETE FROM service_requests WHERE id=$1', [id]);
        for (const id of made.users) await c.query('DELETE FROM users WHERE id=$1', [id]);
        for (const id of made.admins) await c.query('DELETE FROM admin_users WHERE id=$1', [id]);
        for (const id of made.roles) await c.query('DELETE FROM admin_roles WHERE id=$1', [id]);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
