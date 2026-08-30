/**
 * FTTH Phase 0 smoke test — operator onboarding and the access boundary.
 *
 *   npm run dev            # in another terminal
 *   node scripts/smoke-ftth-phase0.mjs
 *
 * Walks an ISP from public application through super_admin approval, sign-in,
 * suspension and reactivation, and asserts the boundary in both directions: an
 * operator token is refused by every staff route, and an operator LOGIN cannot
 * be promoted to staff from the Administrators page.
 *
 * Creates its own throwaway operator and pincode and deletes them in a
 * `finally`, so it leaves the database as it found it.
 *
 * Two notes if it fails oddly:
 *   - The apply endpoint allows 5 submissions/hour per IP. A second run inside
 *     the hour 429s; restart the dev server to reset the in-memory store.
 *   - It mints a super_admin token from JWT_SECRET rather than logging in, so
 *     it needs no passwords and creates no staff accounts.
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json, text };
};

// --- setup: a serviceable pincode to apply against -------------------------
await c.query(`INSERT INTO serviceable_pincodes (pincode, area, district, state, is_active)
               VALUES ('581359','Yellapur','Uttara Kannada','Karnataka',true)
               ON CONFLICT (pincode) DO NOTHING`);

// Impersonate an existing super_admin by minting a token — no account is
// created or modified.
const [sa] = (await c.query(
  `SELECT id, username FROM admin_users WHERE role='super_admin' AND is_active=true ORDER BY id LIMIT 1`
)).rows;
const superToken = jwt.sign({ userId: sa.id, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const [plainAdmin] = (await c.query(
  `SELECT id FROM admin_users WHERE role='admin' AND is_active=true ORDER BY id LIMIT 1`
)).rows;
const adminToken = plainAdmin
  ? jwt.sign({ userId: plainAdmin.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' })
  : null;

const phone = '9' + String(Date.now()).slice(-9);
const email = `qa.ftth.${Date.now()}@example.com`;
let operatorId, operatorToken, username, password;

try {
  // --- 1. public apply ----------------------------------------------------
  let r = await req('POST', '/api/ftth/operators/apply', {
    body: {
      companyName: 'QA Fibre Networks',
      contactEmail: email,
      contactPhone: phone,
      gstin: '29ABCDE1234F1Z5',
      pincodes: ['581359'],
    },
  });
  check('apply creates a pending application', r.status === 201, `status ${r.status}`);
  operatorId = r.json?.data?.applicationId;

  // --- 2. unknown pincode is refused --------------------------------------
  r = await req('POST', '/api/ftth/operators/apply', {
    body: { companyName: 'Nowhere ISP', contactEmail: 'x@y.com', contactPhone: '9' + String(Date.now() + 7).slice(-9), pincodes: ['999999'] },
  });
  check('apply refuses an unserviceable pincode', r.status === 400, `status ${r.status}`);

  // --- 3. duplicate application ------------------------------------------
  r = await req('POST', '/api/ftth/operators/apply', {
    body: { companyName: 'QA Fibre Again', contactEmail: 'dupe@example.com', contactPhone: phone, pincodes: ['581359'] },
  });
  check('duplicate application from same phone is refused', r.status === 409, `status ${r.status}`);

  // --- 4. self-approval fields are ignored --------------------------------
  const sneakyPhone = '9' + String(Date.now() + 11).slice(-9);
  r = await req('POST', '/api/ftth/operators/apply', {
    body: {
      companyName: 'Sneaky ISP', contactEmail: 'sneaky@example.com', contactPhone: sneakyPhone,
      pincodes: ['581359'], status: 'active', leadFeePaise: 0, adminUserId: 1,
    },
  });
  const sneakyId = r.json?.data?.applicationId;
  const sneakyRow = (await c.query('SELECT status, admin_user_id, lead_fee_paise FROM ftth_operators WHERE id=$1', [sneakyId])).rows[0];
  check('applicant cannot self-approve via extra fields',
    sneakyRow?.status === 'pending_approval' && sneakyRow?.admin_user_id === null && sneakyRow?.lead_fee_paise === null,
    JSON.stringify(sneakyRow));

  // --- 5. plain admin cannot approve --------------------------------------
  if (adminToken) {
    r = await req('POST', `/api/admin/ftth/operators/${operatorId}/approve`, {
      token: adminToken, body: { username: 'shouldnotwork' },
    });
    check('plain admin cannot approve an operator', r.status === 403, `status ${r.status}`);
  }

  // --- 6. super_admin approves --------------------------------------------
  username = 'qafibre' + String(Date.now()).slice(-5);
  r = await req('POST', `/api/admin/ftth/operators/${operatorId}/approve`, {
    token: superToken, body: { username, leadFeePaise: 40000, convenienceFeePaise: 1000 },
  });
  check('super_admin approves and mints a login', r.status === 200 && !!r.json?.data?.temporaryPassword, `status ${r.status}`);
  password = r.json?.data?.temporaryPassword;

  // --- 7. double approval -------------------------------------------------
  r = await req('POST', `/api/admin/ftth/operators/${operatorId}/approve`, {
    token: superToken, body: { username: username + 'x' },
  });
  check('approving twice is refused', r.status === 409, `status ${r.status}`);

  // --- 8. operator signs in through the normal admin login ----------------
  r = await req('POST', '/api/admin/auth/login', { body: { username, password } });
  operatorToken = r.json?.token;
  check('operator signs in at /api/admin/auth/login', r.status === 200 && !!operatorToken, `status ${r.status}`);
  const claim = operatorToken ? JSON.parse(Buffer.from(operatorToken.split('.')[1], 'base64').toString()) : {};
  check('token carries role=operator', claim.role === 'operator', `role ${claim.role}`);

  // --- 9. the boundary ----------------------------------------------------
  r = await req('GET', '/api/ftth/admin/me', { token: operatorToken });
  check('operator can read their own profile', r.status === 200 && r.json?.data?.companyName === 'QA Fibre Networks', `status ${r.status}`);
  check('profile carries the operator\'s coverage', r.json?.data?.pincodes?.includes('581359'), JSON.stringify(r.json?.data?.pincodes));

  for (const path of [
    '/api/admin/me',
    '/api/admin/users',
    '/api/admin/admins',
    '/api/admin/db/schema',
    '/api/admin/withdrawals',
    '/api/admin/notifications/campaigns',
    '/api/admin/ftth/operators',
  ]) {
    r = await req('GET', path, { token: operatorToken });
    check(`operator is refused ${path}`, r.status === 403, `status ${r.status}`);
  }

  r = await req('POST', '/api/admin/ftth/operators/1/approve', { token: operatorToken, body: { username: 'evil' } });
  check('operator cannot approve operators', r.status === 403, `status ${r.status}`);

  // --- 10. an operator login cannot be promoted ---------------------------
  //
  // THE dangerous direction: promoting a third-party ISP's login into a staff
  // role would hand them the whole console — every customer, the SQL console,
  // payouts — off one dropdown. Refused by scope, not by capability, so no
  // combination of ticked boxes can reach it.
  const opAdminId = (await c.query('SELECT admin_user_id FROM ftth_operators WHERE id=$1', [operatorId])).rows[0].admin_user_id;
  const [superRole] = (await c.query(`SELECT id FROM admin_roles WHERE slug='super_admin'`)).rows;
  const [adminRole] = (await c.query(`SELECT id FROM admin_roles WHERE slug='admin'`)).rows;

  r = await req('PATCH', `/api/admin/admins/${opAdminId}`, { token: superToken, body: { roleId: superRole.id } });
  check('an operator login cannot be promoted to super_admin', r.status === 409, `status ${r.status}`);

  r = await req('PATCH', `/api/admin/admins/${opAdminId}`, { token: superToken, body: { roleId: adminRole.id } });
  check('an operator login cannot be promoted to staff at all', r.status === 409, `status ${r.status}`);

  const stillOperator = (await c.query('SELECT role FROM admin_users WHERE id=$1', [opAdminId])).rows[0];
  check('the operator row is untouched by the attempts', stillOperator.role === 'operator', stillOperator.role);

  // Toggling an operator from Roles & Access is now ALLOWED — that endpoint
  // moves ftth_operators.status in the same transaction, so the two flags can no
  // longer disagree. The old refusal existed only because it could not.
  r = await req('PATCH', `/api/admin/admins/${opAdminId}/status`, { token: superToken, body: { isActive: false } });
  check('deactivating an operator from Roles & Access works', r.status === 200, `status ${r.status}`);

  const opStatus = (await c.query('SELECT status FROM ftth_operators WHERE id=$1', [operatorId])).rows[0];
  check('and it moves the operator profile with it', opStatus.status === 'paused', opStatus.status);

  await req('PATCH', `/api/admin/admins/${opAdminId}/status`, { token: superToken, body: { isActive: true } });

  r = await req('POST', '/api/admin/auth/register', {
    token: superToken, body: { username: 'strandedop' + Date.now(), email: `stranded${Date.now()}@x.com`, password: 'password123', role: 'operator' },
  });
  check('cannot create a stranded operator login via /register', r.status === 400, `status ${r.status}`);

  // --- 11. pausing takes effect immediately, on the SAME token ------------
  r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}/status`, { token: superToken, body: { status: 'paused' } });
  check('super_admin can pause an operator', r.status === 200, `status ${r.status}`);

  r = await req('GET', '/api/ftth/admin/me', { token: operatorToken });
  check('paused operator is refused on their existing token',
    r.status === 403 && r.json?.code === 'OPERATOR_NOT_ACTIVE', `status ${r.status} code ${r.json?.code}`);

  const loginRow = (await c.query('SELECT is_active FROM admin_users WHERE id=$1', [opAdminId])).rows[0];
  check('pausing also disables the login row', loginRow?.is_active === false, `is_active ${loginRow?.is_active}`);

  r = await req('PATCH', `/api/admin/ftth/operators/${operatorId}/status`, { token: superToken, body: { status: 'active' } });
  r = await req('GET', '/api/ftth/admin/me', { token: operatorToken });
  check('reactivating restores access on the same token', r.status === 200, `status ${r.status}`);

  // --- 12. audit trail ----------------------------------------------------
  const audits = (await c.query(
    `SELECT action FROM audit_logs WHERE entity_type='ftth_operator' AND entity_id=$1 ORDER BY id`, [operatorId]
  )).rows.map(x => x.action);
  check('every operator action is audited',
    ['ftth_operator_applied', 'ftth_operator_approved', 'ftth_operator_status_changed'].every(a => audits.includes(a)),
    audits.join(', '));

} finally {
  // --- cleanup ------------------------------------------------------------
  const ids = (await c.query(`SELECT id, admin_user_id FROM ftth_operators WHERE contact_email LIKE 'qa.ftth.%' OR contact_email IN ('sneaky@example.com','dupe@example.com')`)).rows;
  for (const row of ids) {
    await c.query('DELETE FROM audit_logs WHERE entity_type=$1 AND entity_id=$2', ['ftth_operator', row.id]);
    await c.query('DELETE FROM ftth_operator_pincodes WHERE operator_id=$1', [row.id]);
    await c.query('DELETE FROM ftth_operators WHERE id=$1', [row.id]);
    if (row.admin_user_id) await c.query('DELETE FROM admin_users WHERE id=$1', [row.admin_user_id]);
  }
  await c.query(`DELETE FROM admin_users WHERE username LIKE 'strandedop%'`);
  // Only if no operator still claims it — a real operator (the demo seed, say)
  // may legitimately cover this pincode, and the FK is right to refuse.
  await c.query(
    `DELETE FROM serviceable_pincodes sp WHERE sp.pincode = '581359'
       AND NOT EXISTS (SELECT 1 FROM ftth_operator_pincodes WHERE pincode = sp.pincode)`);
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}
