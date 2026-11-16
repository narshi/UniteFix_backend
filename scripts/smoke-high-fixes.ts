/**
 * The high findings from the pre-launch audit (server side).
 *
 *  H1  /api/auth/check-phone answers "registered or not" and nothing else.
 *  H2  Password sign-up, sign-in and reset for app accounts are retired.
 *  H3  /api/business/partners: only the guarded, trimmed directory remains.
 *  H4  Two withdrawal requests sent together cannot both draw the same money.
 *  H5  Database Console: reads run read-only and are audited; writes need the
 *      admin's own password; the console can be switched off.
 *  H6  Staff responses carry an expert's identity and bank numbers masked.
 *  H8  Staff-created experts get no password (was 'Temp123!').
 *
 * H7 (upload-key passwords out of git) is a build-file change, checked with
 * `gradlew :app:signingReport`.
 *
 *   npm run smoke:high-fixes
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, adminUsers, adminRoles, adminRoleCapabilities, partnerWallets, withdrawalRequests, auditLogs } from '../shared/schema';
import { isHardBlocked } from '../server/routes/admin-db-console.routes';
import { configService } from '../server/services/config.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], roleIds: number[] = [];

const newPhone = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

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
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;

    /** A staff login whose custom role holds exactly these capabilities. */
    const makeStaff = async (tag: string, capabilities: string[]) => {
        const [role] = await db.insert(adminRoles).values({ slug: `qa_high_${tag}_${stamp}`, name: `QA High ${tag} ${stamp}`, scope: 'staff' } as any).returning();
        roleIds.push(role.id);
        if (capabilities.length) await db.insert(adminRoleCapabilities).values(capabilities.map(capability => ({ roleId: role.id, capability })));
        const password = `Staff-${tag}-${stamp}-pw!`;
        const [row] = await db.insert(adminUsers).values({
            username: `qa_high_${tag}_${stamp}`, email: `qa_high_${tag}_${stamp}@example.test`, password: await bcrypt.hash(password, 10),
            role: role.slug, roleId: role.id, isActive: true,
        } as any).returning();
        adminIds.push(row.id);
        return { id: row.id, token: (await api.login(row.username, password))! };
    };

    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const viewer = await makeStaff('viewer', ['employees:view']);
        const manager = await makeStaff('manager', ['employees:manage']);
        const support = await makeStaff('support', ['support:view']);

        // A customer with an email and a password, and a verified expert with identity and bank details.
        const custPhone = newPhone(), custMail = `qa-high-cust-${stamp}@example.test`;
        const [cust] = await db.insert(users).values({ phone: custPhone, username: 'QA High Customer', role: 'user', email: custMail, password: await bcrypt.hash('secret12', 10), phoneVerified: true } as any).returning();
        userIds.push(cust.id);
        const techPhone = newPhone();
        const [techUser] = await db.insert(users).values({ phone: techPhone, username: `QA High Tech ${stamp}`, role: 'serviceman', homeAddress: 'Sirsi 581401', pinCode: '581401', phoneVerified: true } as any).returning();
        userIds.push(techUser.id);
        const SENSITIVE = { aadhaarNumber: '123412341234', panNumber: 'ABCDE1234F', bankAccountNumber: '50100123456789', bankIfsc: 'HDFC0001234', aadhaarDocUrl: 'https://example.test/aadhaar.jpg', panDocUrl: 'https://example.test/pan.jpg' };
        const [emp] = await db.insert(employees).values({ userId: techUser.id, fullName: `QA High Tech ${stamp}`, isActive: true, documentVerificationStatus: 'verified' as any, upiId: 'qahigh@okhdfcbank', ...SENSITIVE } as any).returning();
        const techToken = jwt.sign({ userId: techUser.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        const empRow = async () => (await db.select().from(employees).where(eq(employees.id, emp.id)))[0];

        // ══ H1 — check-phone ══
        const h1a = await api.post('/api/auth/check-phone', { phone: custPhone.slice(3) });
        const keys = Object.keys(h1a.body ?? {}).sort().join(',');
        check('H1  a registered number answers "exists" and nothing about its owner', h1a.status === 200 && h1a.body?.exists === true && keys === 'exists,success' && !JSON.stringify(h1a.body).includes(custMail), keys);
        const h1b = await api.post('/api/auth/check-phone', { phone: newPhone().slice(3) });
        check('H1  an unknown number answers "does not exist"', h1b.status === 200 && h1b.body?.exists === false);

        // ══ H2 — password accounts ══
        const retired: Array<[string, any]> = [
            ['/api/auth/signup/initiate', { email: `qa-high-new-${stamp}@example.test` }],
            ['/api/auth/signup/verify', { email: `qa-high-new-${stamp}@example.test`, otp: '123456' }],
            ['/api/auth/signup/complete', { signupToken: 'x', password: 'secret12' }],
            ['/api/auth/signup', { phone: newPhone(), username: 'QA High Squatter', password: 'secret12' }],
            ['/api/auth/login', { phone: custPhone, password: 'secret12' }],
            ['/api/auth/forgot-password', { email: custMail }],
            ['/api/auth/verify-reset-otp', { email: custMail, otp: '123456' }],
            ['/api/auth/reset-password', { resetToken: 'x', newPassword: 'secret12' }],
        ];
        for (const [path, body] of retired) {
            const r = await api.post(path, body);
            check(`H2  ${path} is retired`, r.status === 410 && r.body?.code === 'PASSWORD_SIGNIN_RETIRED' && !r.body?.accessToken && !r.body?.token && !r.body?.resetToken && !r.body?.signupToken, `${r.status}`);
        }
        const [squat] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'QA High Squatter')).limit(1);
        check('H2  …and no account was created by the old sign-up', !squat);
        check('H2  staff sign-in is untouched', !!S && (await api.get('/api/admin/me', S)).status === 200);

        // ══ H3 — /api/business/partners ══
        const h3a = await api.put(`/api/business/partners/${emp.id}`, { bankAccountNumber: '99999999999', upiId: 'thief@okaxis', documentVerificationStatus: 'pending', walletBalance: '99999.00' }, viewer.token);
        const afterPut = await empRow();
        check('H3  the write that took any body is gone; the expert record is unchanged', h3a.status === 404 && afterPut.bankAccountNumber === SENSITIVE.bankAccountNumber && afterPut.upiId === 'qahigh@okhdfcbank' && afterPut.documentVerificationStatus === 'verified', `${h3a.status}`);
        for (const [m, p] of [['post', `/api/business/partners/${emp.id}/suspend`], ['post', `/api/business/partners/${emp.id}/verify`], ['del', `/api/business/partners/${emp.id}`], ['get', '/api/business/partners/pending'], ['get', `/api/business/partners/${emp.id}`]] as const) {
            const r = await (api as any)[m](p, m === 'post' ? {} : viewer.token, viewer.token);
            check(`H3  ${m.toUpperCase()} ${p.replace(String(emp.id), ':id')} is gone`, r.status === 404, `${r.status}`);
        }
        check('H3  …and the expert was neither suspended nor removed', (await empRow())?.documentVerificationStatus === 'verified');
        const h3b = await api.get('/api/business/partners', support.token);
        check('H3  a role with none of the directory capabilities is refused', h3b.status === 403 && h3b.body?.code === 'CAPABILITY_REQUIRED', `${h3b.status}`);
        check('H3  no login, no directory', (await api.get('/api/business/partners')).status === 401);
        const h3c = await api.get('/api/business/partners', viewer.token);
        const entry = Array.isArray(h3c.body) ? h3c.body.find((p: any) => p.id === emp.id) : null;
        const leaked = entry ? ['bankAccountNumber', 'bankIfsc', 'upiId', 'aadhaarNumber', 'panNumber', 'aadhaarDocUrl', 'panDocUrl', 'email'].filter(k => k in entry) : ['(not found)'];
        check('H3  the directory lists the expert with picker fields only', h3c.status === 200 && !!entry && entry.partnerName === `QA High Tech ${stamp}` && entry.verificationStatus === 'verified' && 'partsAccess' in entry && leaked.length === 0, `leaked: ${leaked.join(',') || 'none'}`);

        // ══ H6 — masking in staff responses ══
        const masked = (e: any) => e?.bankAccountNumber === '••••6789' && e?.aadhaarNumber === '••••1234' && e?.panNumber === '••••234F';
        const h6a = await api.get(`/api/admin/servicemen/list?q=${encodeURIComponent(`QA High Tech ${stamp}`)}`, viewer.token);
        const listed = h6a.body?.data?.find((p: any) => p.id === emp.id);
        check('H6  the experts list masks Aadhaar, PAN and bank numbers', h6a.status === 200 && masked(listed), JSON.stringify({ b: listed?.bankAccountNumber, a: listed?.aadhaarNumber, p: listed?.panNumber }));
        check('H6  …keeps what the screen uses', listed?.hasPayoutDestination === true && listed?.partnerName === `QA High Tech ${stamp}` && listed?.hasAadhaarDoc === true);
        check('H6  …and gives a view-only role no document links', !!listed && !('aadhaarDocUrl' in listed) && !('panDocUrl' in listed));
        const h6b = await api.get(`/api/admin/servicemen/${emp.id}/detail`, viewer.token);
        const detail = h6b.body?.data?.employee;
        check('H6  the expert detail page gets the same masking', h6b.status === 200 && masked(detail) && !('aadhaarDocUrl' in detail) && detail.hasPayoutDestination === true, `${h6b.status}`);
        const h6c = await api.get(`/api/admin/servicemen/${emp.id}/detail`, manager.token);
        check('H6  a role that manages experts sees the document links, numbers still masked', h6c.status === 200 && masked(h6c.body?.data?.employee) && h6c.body?.data?.employee?.aadhaarDocUrl === SENSITIVE.aadhaarDocUrl, `${h6c.status}`);
        const h6d = await api.post(`/api/admin/servicemen/${emp.id}/approve`, {}, S);
        check('H6  action responses are masked too', h6d.status === 200 && masked(h6d.body?.data), `${h6d.status}`);
        const stored = await empRow();
        check('H6  the stored values are untouched', stored.bankAccountNumber === SENSITIVE.bankAccountNumber && stored.aadhaarNumber === SENSITIVE.aadhaarNumber && stored.panNumber === SENSITIVE.panNumber);

        // ══ H4 — two withdrawals at once ══
        const min = Number(await configService.get('BUSINESS_CONFIG.MIN_WALLET_REDEMPTION', 500)) || 500;
        const amount = Math.max(min, 600), balance = amount * 1.5;   // enough for one, not for two
        await db.insert(partnerWallets).values({ partnerId: emp.id, balanceAvailable: balance.toFixed(2) } as any);
        const shots = await Promise.all(Array.from({ length: 6 }, () => api.post('/api/partner/wallet/withdraw', { amount, method: 'upi' }, techToken)));
        const okCount = shots.filter(r => r.status === 200 && r.body?.success).length;
        const [wallet] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id));
        const requests = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.partnerId, emp.id));
        check('H4  of six requests sent together, exactly one is accepted', okCount === 1, `${okCount} accepted; statuses ${shots.map(r => r.status).join(',')}`);
        check('H4  …one payout request exists, and the wallet was debited once', requests.length === 1 && Number(wallet.balanceAvailable) === balance - amount, `${requests.length} request(s), ₹${wallet.balanceAvailable} left of ₹${balance}`);

        // ══ H5 — Database Console ══
        const q = (body: any, token = S) => api.post('/api/admin/db/query', body, token);
        const auditCount = async (action: string) => (await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
            .where(and(eq(auditLogs.entityType, 'db_console'), eq(auditLogs.action, action), eq(auditLogs.changedBy, sa.id))))[0].n;

        const h5a = await q({ sql: `SELECT ${sa.id} AS n` });
        check('H5  a read runs', h5a.status === 200 && h5a.body?.data?.readOnly === true && h5a.body?.data?.rows?.[0]?.n === sa.id, `${h5a.status} ${h5a.body?.message ?? ''}`);
        check('H5  …and is written to the audit trail', (await auditCount('db_console_read')) === 1);
        // Passes the text check as a read, but changes a sequence: the database must refuse it.
        const h5b = await q({ sql: `SELECT nextval('users_id_seq')` });
        check('H5  a statement that slips past the text check as a "read" is refused by the database', h5b.status === 400 && /read-only transaction/i.test(h5b.body?.message ?? ''), `${h5b.status} ${h5b.body?.message}`);

        const write = `UPDATE admin_users SET last_login = now() WHERE id = ${sa.id}`;
        const lastLogin = async () => (await db.select({ t: adminUsers.lastLogin }).from(adminUsers).where(eq(adminUsers.id, sa.id)))[0].t?.getTime() ?? 0;
        const before = await lastLogin();
        const h5c = await q({ sql: write });
        check('H5  a write first asks for confirmation and a password', h5c.status === 428 && h5c.body?.requiresConfirmation === true && h5c.body?.requiresPassword === true, `${h5c.status}`);
        const h5d = await q({ sql: write, confirm: true });
        check('H5  confirm alone is not enough', h5d.status === 403 && h5d.body?.code === 'PASSWORD_REQUIRED', `${h5d.status} ${h5d.body?.code}`);
        const h5e = await q({ sql: write, confirm: true, password: 'not-my-password' });
        check('H5  a wrong password runs nothing', h5e.status === 403 && h5e.body?.code === 'WRONG_PASSWORD' && (await lastLogin()) === before, `${h5e.status} ${h5e.body?.code}`);
        check('H5  …and the refusal is recorded', (await auditCount('db_console_password_refused')) === 1);
        const h5f = await q({ sql: write, confirm: true, password: sa.password });
        check('H5  the right password runs the write', h5f.status === 200 && h5f.body?.data?.rowCount === 1 && (await lastLogin()) > before, `${h5f.status} ${h5f.body?.message ?? ''}`);
        check('H5  …and it is recorded', (await auditCount('db_console_update')) === 1);

        // The blocklist. Checked on text only for anything that could do damage; the one
        // statement actually sent names a schema that does not exist.
        check('H5  the blocklist sees through a comment between the words', isHardBlocked('drop/**/schema public cascade') && isHardBlocked('DROP -- x\n DATABASE unitefix') && isHardBlocked('DO $$ BEGIN EXECUTE \'drop schema public cascade\'; END $$'));
        check('H5  …and leaves ordinary statements alone', !isHardBlocked('SELECT * FROM users') && !isHardBlocked('DROP TABLE qa_tmp') && !isHardBlocked(write));
        const h5g = await q({ sql: `drop/**/schema qa_no_such_schema_${stamp} cascade`, confirm: true, password: sa.password });
        check('H5  a blocked statement is refused before it reaches the database', h5g.status === 400 && /^Refused/.test(h5g.body?.message ?? ''), `${h5g.status} ${h5g.body?.message}`);

        check('H5  a staff login that is not a super admin cannot use the console', (await q({ sql: 'SELECT 1' }, manager.token)).status === 403);
        process.env.DB_CONSOLE_DISABLED = '1';
        const h5h = await q({ sql: 'SELECT 1' });
        const h5i = await api.get('/api/admin/db/schema', S);
        delete process.env.DB_CONSOLE_DISABLED;
        check('H5  DB_CONSOLE_DISABLED=1 switches the console off, even for a super admin', h5h.status === 403 && h5h.body?.code === 'DB_CONSOLE_OFF' && h5i.status === 403, `${h5h.status} ${h5i.status}`);
        check('H5  …and it comes back when the switch is cleared', (await q({ sql: 'SELECT 1' })).status === 200);

        // ══ H8 — staff-created experts ══
        const mkExpert = async (extra: Record<string, unknown>) => {
            const phone = newPhone();
            const r = await api.post('/api/admin/servicemen/create', { partnerName: `QA High Created ${stamp}`, email: `qa-high-created-${phone.slice(-6)}@example.test`, phone, location: '581401', ...extra }, S);
            const [u] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
            if (u) userIds.push(u.id);
            return { r, u };
        };
        const h8a = await mkExpert({});
        check('H8  an expert created with no password gets none (not Temp123!)', h8a.r.status === 201 && !!h8a.u && h8a.u.password == null, `${h8a.r.status} ${h8a.r.body?.message ?? ''}`);
        const h8b = await mkExpert({ password: 'Temp123!' });
        check('H8  …and a password sent by an old dashboard build is not stored', h8b.r.status === 201 && !!h8b.u && h8b.u.password == null, `${h8b.r.status}`);
        const h8c = await api.post('/api/auth/login', { phone: h8a.u?.phone, password: 'Temp123!' });
        check('H8  the old default password opens nothing', h8c.status === 410 && !h8c.body?.accessToken, `${h8c.status}`);
    } finally {
        const uids = userIds.join(',') || '0', aids = adminIds.join(',') || '0', rids = roleIds.join(',') || '0';
        const emps = `SELECT id FROM employees WHERE user_id IN (${uids})`;
        await removeFixtures([
            `DELETE FROM withdrawal_requests WHERE partner_id IN (${emps})`,
            `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (${emps})`,
            `DELETE FROM wallet_transactions WHERE provider_id IN (${emps})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (${emps})`,
            `DELETE FROM employee_technician_types WHERE employee_id IN (${emps})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM audit_logs WHERE changed_by IN (${aids}) AND created_at > now() - interval '1 hour'`,
            `DELETE FROM audit_logs WHERE entity_type = 'employee' AND entity_id IN (${emps})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM customers WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM device_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM admin_users WHERE id IN (${aids})`,
            `DELETE FROM admin_role_capabilities WHERE role_id IN (${rids})`,
            `DELETE FROM admin_roles WHERE id IN (${rids})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
