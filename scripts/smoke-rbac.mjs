/**
 * Roles & capabilities smoke test.
 *
 *   npm run dev
 *   node scripts/smoke-rbac.mjs
 *
 * The point of this file is the NEGATIVE cases. A role system that grants
 * correctly but fails to deny is worthless, so most of what follows checks that
 * a restricted role is actually stopped — at the API, not just in the UI.
 *
 * Also covers the lockout guards: you cannot delete, demote or disable your way
 * to a platform nobody can administer.
 *
 * Creates its own roles and accounts and removes them in a `finally`.
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

const stamp = String(Date.now()).slice(-9);
const created = { roleIds: [], accountIds: [], operatorIds: [] };
let managerRoleId, managerToken, managerAccountId;

try {
    const [sa] = (await c.query(
        `SELECT id FROM admin_users WHERE role='super_admin' AND is_active=true AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows;
    const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // ================= catalogue =================
    let r = await req('GET', '/api/admin/roles/capabilities', { token: superToken });
    check('capability catalogue is served from the server',
        r.status === 200 && Array.isArray(r.json?.data?.areas) && r.json.data.areas.length > 10,
        `${r.json?.data?.areas?.length} areas`);

    r = await req('GET', '/api/admin/me', { token: superToken });
    check('super_admin holds every staff capability',
        r.json?.data?.capabilities?.includes('db_console:manage')
        && r.json?.data?.capabilities?.includes('accounts:manage'),
        `${r.json?.data?.capabilities?.length} capabilities`);

    // ================= create a restricted role =================
    r = await req('POST', '/api/admin/roles', {
        token: superToken,
        body: {
            name: `QA Manager ${stamp}`,
            description: 'Bookings and orders, no money or accounts',
            scope: 'staff',
            capabilities: ['bookings:manage', 'orders:manage', 'payments:view'],
        },
    });
    check('super_admin creates a custom role', r.status === 201, `status ${r.status}`);
    managerRoleId = r.json?.data?.id;
    if (managerRoleId) created.roleIds.push(managerRoleId);

    r = await req('POST', '/api/admin/roles', {
        token: superToken,
        body: { name: 'Super Admin', scope: 'staff', capabilities: [] },
    });
    check('a reserved role name is refused', r.status === 409, `status ${r.status}`);

    r = await req('POST', '/api/admin/roles', {
        token: superToken,
        // operator_portal belongs to the other side of the boundary.
        body: { name: `QA Bad ${stamp}`, scope: 'staff', capabilities: ['operator_portal:manage'] },
    });
    check('a cross-scope capability is refused', r.status === 400, `status ${r.status}`);

    // ================= an account on that role =================
    const username = `qamgr${stamp}`;
    r = await req('POST', '/api/admin/admins', {
        token: superToken,
        body: { username, email: `${username}@example.com`, roleId: managerRoleId },
    });
    check('super_admin creates an account on the custom role',
        r.status === 201 && !!r.json?.data?.temporaryPassword, `status ${r.status}`);
    managerAccountId = r.json?.data?.id;
    if (managerAccountId) created.accountIds.push(managerAccountId);
    const managerPassword = r.json?.data?.temporaryPassword;

    r = await req('POST', '/api/admin/auth/login', { body: { username, password: managerPassword } });
    managerToken = r.json?.token;
    check('the new account can sign in', r.status === 200 && !!managerToken, `status ${r.status}`);

    r = await req('GET', '/api/admin/me', { token: managerToken });
    const caps = r.json?.data?.capabilities ?? [];
    check('manage implies view', caps.includes('bookings:view') && caps.includes('bookings:manage'),
        caps.filter(x => x.startsWith('bookings')).join(','));
    check('ungranted areas are absent', !caps.includes('withdrawals:view') && !caps.includes('accounts:view'),
        `${caps.length} capabilities`);

    // ================= the negatives that matter =================
    const GRANTED = [
        ['GET', '/api/admin/services', 'bookings:view'],
        ['GET', '/api/admin/orders', 'orders:view'],
        ['GET', '/api/admin/payments/transactions', 'payments:view'],
    ];
    for (const [method, path] of GRANTED) {
        r = await req(method, path, { token: managerToken });
        check(`granted: ${path}`, r.status !== 403, `status ${r.status}`);
    }

    const REFUSED = [
        ['GET', '/api/admin/withdrawals'],
        ['GET', '/api/admin/db/schema'],
        ['POST', '/api/admin/db/query'],
        ['GET', '/api/admin/audit-logs'],
        ['GET', '/api/admin/admins'],
        ['GET', '/api/admin/roles'],
        ['GET', '/api/admin/users'],
        ['GET', '/api/admin/ftth/operators'],
        ['GET', '/api/admin/notifications/campaigns'],
        ['GET', '/api/admin/config'],
        ['GET', '/api/admin/inventory'],
    ];
    for (const [method, path] of REFUSED) {
        r = await req(method, path, { token: managerToken });
        check(`refused: ${path}`, r.status === 403, `status ${r.status}`);
    }

    // Read granted, write refused — the view/manage split has to actually split.
    r = await req('POST', '/api/admin/payments/refunds', { token: managerToken, body: {} });
    check('payments:view does not permit a payments write', r.status === 403, `status ${r.status}`);

    r = await req('POST', '/api/admin/roles', {
        token: managerToken, body: { name: 'Escalation', scope: 'staff', capabilities: ['accounts:manage'] },
    });
    check('a restricted role cannot create roles', r.status === 403, `status ${r.status}`);

    r = await req('PATCH', `/api/admin/admins/${managerAccountId}`, {
        token: managerToken, body: { roleId: 1 },
    });
    check('a restricted role cannot change its own role', r.status === 403, `status ${r.status}`);

    // ================= capability changes take effect immediately =================
    r = await req('PATCH', `/api/admin/roles/${managerRoleId}`, {
        token: superToken,
        body: { capabilities: ['bookings:manage', 'orders:manage', 'payments:view', 'withdrawals:view'] },
    });
    check('super_admin edits the role', r.status === 200, `status ${r.status}`);

    r = await req('GET', '/api/admin/withdrawals', { token: managerToken });
    check('a new grant applies on the SAME token, no re-login', r.status !== 403, `status ${r.status}`);

    r = await req('PATCH', `/api/admin/roles/${managerRoleId}`, {
        token: superToken, body: { capabilities: ['bookings:manage'] },
    });
    r = await req('GET', '/api/admin/withdrawals', { token: managerToken });
    check('a revoked grant also applies on the same token', r.status === 403, `status ${r.status}`);

    // ================= super_admin is not editable down =================
    const [superRole] = (await c.query(`SELECT id FROM admin_roles WHERE slug='super_admin'`)).rows;
    r = await req('PATCH', `/api/admin/roles/${superRole.id}`, {
        token: superToken, body: { capabilities: ['dashboard:view'] },
    });
    check('Super Admin capabilities cannot be edited down', r.status === 409, `status ${r.status}`);

    r = await req('DELETE', `/api/admin/roles/${superRole.id}`, { token: superToken });
    check('a built-in role cannot be deleted', r.status === 409, `status ${r.status}`);

    r = await req('DELETE', `/api/admin/roles/${managerRoleId}`, { token: superToken });
    check('a role still in use cannot be deleted', r.status === 409, `status ${r.status}`);

    // ================= the staff/operator boundary =================
    const [operatorRole] = (await c.query(`SELECT id FROM admin_roles WHERE slug='operator'`)).rows;
    r = await req('PATCH', `/api/admin/admins/${managerAccountId}`, {
        token: superToken, body: { roleId: operatorRole.id },
    });
    check('a staff account cannot be moved to an operator role', r.status === 409, `status ${r.status}`);

    // An operator account is still refused every staff route, capabilities or not.
    const opUsername = `qaop${stamp}`;
    r = await req('POST', '/api/admin/admins', {
        token: superToken,
        body: {
            username: opUsername, email: `${opUsername}@example.com`, roleId: operatorRole.id,
            operator: { companyName: `QA RBAC ISP ${stamp}`, contactPhone: `9${stamp}` },
        },
    });
    check('creating an operator account also creates its company profile',
        r.status === 201 && !!r.json?.data?.operatorId, `status ${r.status}`);
    if (r.json?.data?.id) created.accountIds.push(r.json.data.id);
    if (r.json?.data?.operatorId) created.operatorIds.push(r.json.data.operatorId);
    const opPassword = r.json?.data?.temporaryPassword;

    r = await req('POST', '/api/admin/auth/login', { body: { username: opUsername, password: opPassword } });
    const opToken = r.json?.token;
    check('the operator account signs in', r.status === 200 && !!opToken, `status ${r.status}`);

    for (const path of ['/api/admin/me', '/api/admin/services', '/api/admin/roles', '/api/admin/admins']) {
        r = await req('GET', path, { token: opToken });
        check(`operator still refused ${path}`, r.status === 403, `status ${r.status}`);
    }
    r = await req('GET', '/api/ftth/admin/me', { token: opToken });
    check('operator reaches their own portal', r.status === 200, `status ${r.status}`);

    // ================= lockout guards =================
    r = await req('PATCH', `/api/admin/admins/${sa.id}/status`, { token: superToken, body: { isActive: false } });
    check('you cannot deactivate yourself', r.status === 400, `status ${r.status}`);

    r = await req('DELETE', `/api/admin/admins/${sa.id}`, { token: superToken });
    check('you cannot delete yourself', r.status === 400, `status ${r.status}`);

    // ================= archive vs purge =================
    r = await req('GET', `/api/admin/admins/${managerAccountId}/delete-impact`, { token: superToken });
    check('delete-impact reports what would be lost',
        r.status === 200 && typeof r.json?.data?.canPurge === 'boolean',
        `action ${r.json?.data?.action}`);
    const expectPurge = r.json?.data?.canPurge;

    r = await req('DELETE', `/api/admin/admins/${managerAccountId}`, { token: superToken });
    check('the account is removed', r.status === 200, `${r.json?.data?.action}`);
    check('unreferenced account purged, referenced account archived',
        r.json?.data?.action === (expectPurge ? 'purged' : 'archived'),
        `${r.json?.data?.action}`);

    if (r.json?.data?.action === 'purged') {
        created.accountIds = created.accountIds.filter(id => id !== managerAccountId);
    }

    // A removed account must lose access at once, not at token expiry.
    r = await req('GET', '/api/admin/services', { token: managerToken });
    check('a removed account is refused on its existing token', r.status === 403, `status ${r.status}`);

    // Asserted against the database rather than by attempting a login: this
    // script signs in several times and /api/admin/auth/login is limited to 5
    // attempts per 15 minutes per IP, so a sixth returns 429 and would tell us
    // nothing about the account.
    const { rows: leftovers } = await c.query(
        `SELECT id, deleted_at, is_active FROM admin_users WHERE username = $1`, [username]);
    check('a removed account is gone, or archived and disabled',
        leftovers.length === 0 || (leftovers[0].deleted_at !== null && leftovers[0].is_active === false),
        leftovers.length === 0 ? 'purged' : `archived=${leftovers[0].deleted_at !== null} active=${leftovers[0].is_active}`);

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        for (const opId of created.operatorIds) {
            await c.query('DELETE FROM ftth_operator_pincodes WHERE operator_id=$1', [opId]);
            await c.query(`DELETE FROM audit_logs WHERE entity_type='ftth_operator' AND entity_id=$1`, [opId]);
            await c.query('DELETE FROM ftth_operators WHERE id=$1', [opId]);
        }
        for (const id of created.accountIds) {
            await c.query(`DELETE FROM audit_logs WHERE entity_type='admin_user' AND entity_id=$1`, [id]);
            await c.query('UPDATE audit_logs SET changed_by=NULL WHERE changed_by=$1', [id]);
            await c.query('DELETE FROM admin_users WHERE id=$1', [id]);
        }
        for (const id of created.roleIds) {
            await c.query(`DELETE FROM audit_logs WHERE entity_type='admin_role' AND entity_id=$1`, [id]);
            await c.query('DELETE FROM admin_roles WHERE id=$1', [id]);
        }
        await c.query(`DELETE FROM admin_users WHERE username LIKE 'qamgr%' OR username LIKE 'qaop%'`);
        await c.query(`DELETE FROM admin_roles WHERE name LIKE 'QA %'`);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
