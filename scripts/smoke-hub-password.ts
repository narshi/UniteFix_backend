/**
 * Partner Hub temporary passwords, end to end on the real routes:
 *  - a login made by UniteFix or the owner must choose its own password
 *    before anything else in the Hub (enforced by the server, not the page)
 *  - the change: right current password, not the same, not too easy
 *  - staff reset the owner's password; the owner resets a team member's;
 *    the old password and an old session stop working
 *
 *   npx tsx scripts/smoke-hub-password.ts
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, cleanupPartners, gstinFor, db } from './lib/hub-test-kit';
import { adminUsers, auditLogs } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [];
const must = async (username: string) => (await db.select({ m: adminUsers.mustChangePassword }).from(adminUsers).where(eq(adminUsers.username, username)))[0]?.m;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        check('an existing staff login is not asked to change anything', (await must(sa.username)) === false);
        const bp = await BusinessPartnerService.create({ legalName: `QA Password Works ${stamp}`, displayName: 'Password Works', gstin: await gstinFor('29', 'QAPWD1234K'), contactPhone: `9${String(Date.now()).slice(-9)}`, contactEmail: `qa_pw_${stamp}@example.test`, verticalCodes: ['electronics'], approvedByAdminId: sa.id });
        const bp2 = await BusinessPartnerService.create({ legalName: `QA No Login ${stamp}`, displayName: 'No Login', gstin: await gstinFor('29', 'QANLG1234K'), contactPhone: `8${String(Date.now()).slice(-9)}`, contactEmail: `qa_pw2_${stamp}@example.test`, verticalCodes: ['electronics'], approvedByAdminId: sa.id });
        bpIds.push(bp.id, bp2.id);

        // ── The owner's first sign-in ─────────────────────────────────────
        const r0 = await api.post(`/api/admin/hub/partners/${bp.id}/owner-login`, {}, staff);
        const owner = r0.body?.data as { username: string; temporaryPassword: string };
        const [ol] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, owner.username)); adminIds.push(ol.id);
        check('a new Hub login is marked: choose your own password', r0.status === 201 && (await must(owner.username)) === true);
        const t1 = (await api.login(owner.username, owner.temporaryPassword, { keepTemporary: true }))!;
        const me = await api.get('/api/hub/me', t1);
        check('signed in on the temporary password: the Hub says so (and shares nothing else)', me.status === 200 && me.body?.data?.mustChangePassword === true && me.body.data.business === null, JSON.stringify(me.body?.data)?.slice(0, 200));
        const blocked = await Promise.all(['/api/hub/summary', '/api/hub/team', '/api/hub/store/orders', '/api/hub/onboarding'].map(p => api.get(p, t1)));
        check('…every other Hub call is refused until then (server-side, not just the page)', blocked.every(b => b.status === 403 && b.body?.code === 'PASSWORD_CHANGE_REQUIRED'), blocked.map(b => `${b.status}:${b.body?.code}`).join(' '));

        let r = await api.post('/api/hub/password', { currentPassword: 'wrong-one', newPassword: 'Malnad-2026-x' }, t1);
        check('the change needs the temporary password', r.status === 401 && r.body?.code === 'BAD_PASSWORD');
        r = await api.post('/api/hub/password', { currentPassword: owner.temporaryPassword, newPassword: owner.temporaryPassword }, t1);
        check('…and a different password', r.status === 400 && r.body?.code === 'SAME_PASSWORD');
        r = await api.post('/api/hub/password', { currentPassword: owner.temporaryPassword, newPassword: 'short' }, t1);
        check('…at least 8 characters', r.status === 400 && r.body?.code === 'WEAK_PASSWORD');
        r = await api.post('/api/hub/password', { currentPassword: owner.temporaryPassword, newPassword: 'password123' }, t1);
        check('…not an easy one', r.status === 400 && r.body?.code === 'WEAK_PASSWORD');
        const own = `Own-${stamp}-pw`;
        r = await api.post('/api/hub/password', { currentPassword: owner.temporaryPassword, newPassword: own }, t1);
        check('the owner chooses their own: done', r.status === 200 && (await must(owner.username)) === false);
        check('…and the Hub opens on the same session', (await api.get('/api/hub/summary', t1)).status === 200 && (await api.get('/api/hub/me', t1)).body?.data?.mustChangePassword === false);
        check('the temporary password no longer signs in', (await api.login(owner.username, owner.temporaryPassword, { keepTemporary: true })) === null);
        const t2 = (await api.login(owner.username, own, { keepTemporary: true }))!;
        check('…their own does', !!t2 && (await api.get('/api/hub/summary', t2)).status === 200);

        // ── Staff reset the owner ─────────────────────────────────────────
        r = await api.post(`/api/admin/hub/partners/${bp2.id}/reset-owner-password`, {}, staff);
        check('reset needs a login to reset (create one instead)', r.status === 409 && r.body?.code === 'NO_LOGIN');
        r = await api.post(`/api/admin/hub/partners/${bp.id}/reset-owner-password`, {}, null);
        check('…and staff (no token: refused)', r.status === 401);
        r = await api.post(`/api/admin/hub/partners/${bp.id}/reset-owner-password`, {}, staff);
        const reset = r.body?.data as { username: string; temporaryPassword: string };
        check('staff reset the owner\'s password: a new temporary one, shown once', r.status === 200 && reset.username === owner.username && reset.temporaryPassword.length >= 10 && reset.temporaryPassword !== owner.temporaryPassword);
        check('…their old password stops working at once', (await api.login(owner.username, own, { keepTemporary: true })) === null);
        const old = await api.get('/api/hub/summary', t2);
        check('…a session opened before the reset can do nothing but choose a password', old.status === 403 && old.body?.code === 'PASSWORD_CHANGE_REQUIRED');
        r = await api.post('/api/hub/password', { currentPassword: own, newPassword: 'Another-own-1' }, t2);
        check('…and cannot choose one without the new temporary password', r.status === 401);
        const t3 = (await api.login(owner.username, reset.temporaryPassword, { keepTemporary: true }))!;
        r = await api.post('/api/hub/password', { currentPassword: reset.temporaryPassword, newPassword: `Own2-${stamp}-pw` }, t3);
        check('the owner signs in with it and chooses their own again', r.status === 200 && (await api.get('/api/hub/summary', t3)).status === 200);

        // ── The owner resets a team member ────────────────────────────────
        r = await api.post('/api/hub/team', { name: 'QA Accountant', email: `qa_pw_acc_${stamp}@example.test`, phone: null, role: 'accountant' }, t3);
        const member = r.body?.data as { member: { id: number }; username: string; temporaryPassword: string };
        const [ml] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, member.username)); adminIds.push(ml.id);
        check('an invited team member also starts on a temporary password', r.status === 201 && (await must(member.username)) === true, JSON.stringify(r.body).slice(0, 200));
        const team = (await api.get('/api/hub/team', t3)).body?.data as Array<{ id: number; role: string }>;
        const ownerRow = team.find(m => m.role === 'owner')!;
        r = await api.post(`/api/hub/team/${ownerRow.id}/reset-password`, {}, t3);
        check('the owner\'s own password is not reset from the team page', r.status === 409 && r.body?.code === 'OWNER_LOCKED');
        const tm = (await api.login(member.username, member.temporaryPassword))!;   // the kit chooses theirs, as they would
        check('the member chooses their own and works', (await must(member.username)) === false && (await api.get('/api/hub/summary', tm)).status === 200);
        r = await api.post(`/api/hub/team/${member.member.id}/reset-password`, {}, tm);
        check('an accountant cannot reset anyone', r.status === 403);
        r = await api.post(`/api/hub/team/${member.member.id}/reset-password`, {}, t3);
        check('the owner resets the member: new temporary password, theirs stops working', r.status === 200 && !!r.body?.data?.temporaryPassword && (await must(member.username)) === true && (await api.get('/api/hub/summary', tm)).status === 403);
        const otherOwner = await api.post(`/api/admin/hub/partners/${bp2.id}/owner-login`, {}, staff);
        const [ol2] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, otherOwner.body.data.username)); adminIds.push(ol2.id);
        const t4 = (await api.login(otherOwner.body.data.username, otherOwner.body.data.temporaryPassword))!;
        r = await api.post(`/api/hub/team/${member.member.id}/reset-password`, {}, t4);
        check('another business cannot reset this business\'s people', r.status === 404);

        const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(inArray(auditLogs.entityId, [bp.id]));
        const acts = new Set(audits.map(a => a.action));
        check('every step is in the audit log', ['hub_owner_login_created', 'hub_temporary_password_replaced', 'hub_owner_password_reset', 'hub_member_password_reset'].every(a => acts.has(a)), Array.from(acts).join(', '));
    } finally {
        await close();
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',') || 0})`)).catch(() => null);
        await cleanupPartners(bpIds, adminIds).catch(e => console.warn('cleanup', e?.message));
        await db.delete(adminUsers).where(inArray(adminUsers.id, adminIds)).catch(() => null);
    }
    process.exit(summary() ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
