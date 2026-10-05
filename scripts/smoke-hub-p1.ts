/**
 * Partner Hub — phase 1 end to end, over HTTP against the real route stack.
 *
 *   npm run smoke:hub-p1
 *
 * Apply → sign in while pending → KYC/bank/documents/agreements → submit →
 * staff review and approve → team, roles, revocation, plan limits, module
 * overrides; plus the safety checks: a Hub token never reaches staff routes,
 * and the legacy FTTH operator login keeps working inside the Hub.
 */

import { and, eq, inArray, like } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, tinyPdf, db } from './lib/hub-test-kit';
import {
    adminUsers, businessPartners, partnerUsers, ftthOperators, ftthOperatorPincodes, serviceablePincodes,
} from '../shared/schema';

const stamp = Date.now().toString(36);
const createdAdminIds: number[] = [];
const createdBpIds: number[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); createdAdminIds.push(sa.id);
        const staff = await api.login(sa.username, sa.password);
        check('staff super_admin can sign in', !!staff);

        // ── public ────────────────────────────────────────────────────────
        const v = await api.get('/api/hub/verticals');
        check('the vertical list includes event management', v.body?.data?.some((x: any) => x.code === 'events'));

        const [pin] = await db.select({ p: serviceablePincodes.pincode }).from(serviceablePincodes).limit(1);
        const pan = `QAB${stamp.slice(-2).toUpperCase().replace(/[^A-Z]/g, 'Q').padEnd(2, 'Q')}1234K`.slice(0, 10);
        const panOk = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan) ? pan : 'QABCD1234K';
        const gstin = await gstinFor('29', panOk);
        const email = `qa_bp_${stamp}@example.test`;
        const phone = `9${String(Date.now()).slice(-9)}`;
        const form = {
            businessName: `QA NetServe ${stamp}`, gstin, contactName: 'QA Owner', phone, email,
            verticals: ['isp', 'computer'], coveragePincodes: [pin?.p ?? '581359', '999999'], password: 'Owner-pass-123',
        };

        const typo = await api.post('/api/hub/apply', { ...form, gstin: gstin.slice(0, 14) + (gstin[14] === 'A' ? 'B' : 'A') });
        check('a GSTIN with a wrong check digit is refused', typo.status === 400 && typo.body?.code === 'BAD_GSTIN', typo.body?.message);

        const mismatch = await api.post('/api/hub/apply', { ...form, pan: 'ZZZZZ9999Z' });
        check('a PAN that is not inside the GSTIN is refused', mismatch.status === 400 && mismatch.body?.code === 'PAN_MISMATCH');

        const noCoverage = await api.post('/api/hub/apply', { ...form, coveragePincodes: [] });
        check('broadband applicants must give coverage pincodes', noCoverage.status === 400 && noCoverage.body?.code === 'NO_COVERAGE');

        const applied = await api.post('/api/hub/apply', form);
        check('a valid application is accepted', applied.status === 201, applied.body?.message);
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.contactEmail, email)).limit(1);
        if (bp) createdBpIds.push(bp.id);
        if (bp?.adminUserId) createdAdminIds.push(bp.adminUserId);
        check('...stored pending, state read from the GSTIN', bp?.status === 'pending_approval' && bp?.stateName === 'Karnataka' && bp?.pan === panOk);

        const dup = await api.post('/api/hub/apply', { ...form, email: `x_${email}` });
        check('a second application from the same phone is refused', dup.status === 409);

        // ── pending sign-in ───────────────────────────────────────────────
        const owner = await api.login(email, form.password);
        check('the applicant can sign in while pending', !!owner);

        const staffRoute = await api.get('/api/admin/me', owner);
        check('a Hub token is refused on staff routes', staffRoute.status === 403, String(staffRoute.status));
        const staffList = await api.get('/api/admin/business-partners', owner);
        check('...including the business partner admin list', staffList.status === 403);

        const me = await api.get('/api/hub/me', owner);
        const mods: string[] = me.body?.data?.modules ?? [];
        check('/api/hub/me answers while pending, as owner', me.status === 200 && me.body?.data?.role === 'owner' && me.body?.data?.status === 'pending_approval');
        check('modules: core + broadband + field + parts from isp+computer', ['home', 'sales', 'gst', 'broadband', 'field', 'parts'].every(m => mods.includes(m)) && !mods.includes('events'), mods.join(','));

        const teamWhilePending = await api.get('/api/hub/team', owner);
        check('non-onboarding routes wait for approval', teamWhilePending.status === 403 && teamWhilePending.body?.code === 'PARTNER_NOT_ACTIVE');

        const early = await api.post('/api/hub/onboarding/submit', {}, owner);
        check('submitting an incomplete application says what is missing', early.status === 400 && /Documents|Agreement|Bank/.test(early.body?.message ?? ''), early.body?.message);

        const bank = await api.put('/api/hub/onboarding/bank', { beneficiaryName: 'QA NetServe', accountNumber: '123456789012', ifsc: 'HDFC0001234' }, owner);
        check('bank details saved; without verification keys it goes to manual review', bank.status === 200 && bank.body?.data?.status === 'pending', bank.body?.message);

        const badIfsc = await api.put('/api/hub/onboarding/bank', { beneficiaryName: 'QA', accountNumber: '123456789012', ifsc: 'HDFC1001234' }, owner);
        check('a malformed IFSC is refused', badIfsc.status === 400);

        const ob = await api.get('/api/hub/onboarding', owner);
        const required: string[] = (ob.body?.data?.documents ?? []).filter((d: any) => d.required).map((d: any) => d.code);
        check('required documents follow the verticals (ISP licence for broadband)', ['pan_card', 'gst_certificate', 'bank_proof', 'isp_licence'].every(c => required.includes(c)), required.join(','));
        check('agreements: core + broadband + field annexes', ['core', 'isp', 'field'].every(c => (ob.body?.data?.agreements ?? []).some((a: any) => a.code === c)));

        for (const code of required) {
            const fd = new FormData();
            fd.append('docType', code);
            fd.append('file', tinyPdf(code), `${code}.pdf`);
            const up = await api.upload('/api/hub/documents', fd, owner);
            if (up.status !== 201) check(`upload ${code}`, false, `${up.status} ${up.body?.message}`);
        }
        const wrongType = new FormData();
        wrongType.append('docType', 'pan_card');
        wrongType.append('file', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
        const wt = await api.upload('/api/hub/documents', wrongType, owner);
        check('only PDFs and images are accepted', wt.status >= 400);

        const acc = await api.post('/api/hub/agreements/accept', {}, owner);
        check('agreements accepted with version', acc.status === 200 && (acc.body?.data?.accepted ?? []).includes('core@2026-10-v1'));

        const sub = await api.post('/api/hub/onboarding/submit', {}, owner);
        check('a complete application submits', sub.status === 200 && !!sub.body?.data?.submittedAt, sub.body?.message);

        // ── staff review ──────────────────────────────────────────────────
        const detail = await api.get(`/api/admin/hub/partners/${bp.id}`, staff);
        check('staff see onboarding, documents and team', detail.status === 200 && detail.body?.data?.onboarding?.documents?.length >= 4 && detail.body?.data?.team?.length === 1);

        const docId = detail.body.data.onboarding.documents.find((d: any) => d.code === 'pan_card')?.document?.id;
        const rejNoNote = await api.post(`/api/admin/hub/partners/${bp.id}/documents/${docId}/review`, { status: 'rejected' }, staff);
        check('rejecting a document needs a reason', rejNoNote.status === 400);
        const ver = await api.post(`/api/admin/hub/partners/${bp.id}/documents/${docId}/review`, { status: 'verified' }, staff);
        check('staff verify a document', ver.status === 200 && ver.body?.data?.status === 'verified');

        const bankOk = await api.post(`/api/admin/hub/partners/${bp.id}/bank-verified`, { reference: 'cancelled cheque matched' }, staff);
        check('staff confirm the bank account by hand', bankOk.status === 200);

        const appr = await api.post(`/api/admin/business-partners/${bp.id}/approve`, {}, staff);
        check('approval works', appr.status === 200, appr.body?.message);
        const [op] = await db.select().from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bp.id)).limit(1);
        const opPins = op ? await db.select().from(ftthOperatorPincodes).where(eq(ftthOperatorPincodes.operatorId, op.id)) : [];
        check('approval creates the FTTH operator for broadband, with only serviceable pincodes', !!op && op.status === 'active' && opPins.length === 1 && !opPins.some(p => p.pincode === '999999'), `${opPins.map(p => p.pincode)}`);

        // ── approved: team, roles, FTTH, B2B ──────────────────────────────
        const team = await api.get('/api/hub/team', owner);
        check('team opens after approval', team.status === 200 && team.body?.data?.[0]?.role === 'owner');

        const ftthMe = await api.get('/api/ftth/admin/me', owner);
        check('the owner\'s Hub login opens the broadband (FTTH) routes', ftthMe.status === 200, String(ftthMe.status));
        const b2bMe = await api.get('/api/b2b/me', owner);
        check('...and the parts (B2B) routes', b2bMe.status === 200, String(b2bMe.status));

        const inv = await api.post('/api/hub/team', { name: 'QA Accountant', email: `qa_acc_${stamp}@example.test`, role: 'accountant' }, owner);
        check('the owner invites an accountant (temporary password shown once)', inv.status === 201 && !!inv.body?.data?.temporaryPassword);
        const [accLogin] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_acc_${stamp}@example.test`));
        if (accLogin) createdAdminIds.push(accLogin.id);
        const acct = await api.login(`qa_acc_${stamp}@example.test`, inv.body?.data?.temporaryPassword);
        const accMe = await api.get('/api/hub/me', acct);
        check('the accountant signs in to the same business with their own role', accMe.body?.data?.role === 'accountant' && accMe.body?.data?.businessPartnerId === bp.id);
        const accInvite = await api.post('/api/hub/team', { name: 'X', email: `qa_x_${stamp}@example.test`, role: 'manager' }, acct);
        check('an accountant cannot invite people', accInvite.status === 403);
        const accFtth = await api.get('/api/ftth/admin/me', acct);
        check('a team member reaches the broadband routes through the business', accFtth.status === 200, String(accFtth.status));
        const accBank = await api.put('/api/hub/onboarding/bank', { beneficiaryName: 'Thief', accountNumber: '999999999999', ifsc: 'HDFC0001234' }, acct);
        check('only the owner may touch bank details', accBank.status === 403);
        const ownerBank = await api.put('/api/hub/onboarding/bank', { beneficiaryName: 'Thief', accountNumber: '999999999999', ifsc: 'HDFC0001234' }, owner);
        check('...and once verified and approved, not even the owner', ownerBank.status === 409 && ownerBank.body?.code === 'BANK_LOCKED');

        const memberId = inv.body?.data?.member?.id;
        const revoke = await api.patch(`/api/hub/team/${memberId}`, { status: 'revoked' }, owner);
        check('the owner revokes the accountant', revoke.status === 200);
        const afterRevoke = await api.get('/api/hub/me', acct);
        check('a revoked login stops working on the next request', afterRevoke.status === 403, afterRevoke.body?.code);
        const reLogin = await api.login(`qa_acc_${stamp}@example.test`, inv.body?.data?.temporaryPassword);
        check('...and cannot sign in again', !reLogin);

        const ownerSelf = await api.patch(`/api/hub/team/${team.body.data[0].id}`, { status: 'revoked' }, owner);
        check('the owner cannot be removed from the Hub', ownerSelf.status === 409);

        // Starter plan: 3 active people.
        const m1 = await api.post('/api/hub/team', { name: 'M1', email: `qa_m1_${stamp}@example.test`, role: 'dispatcher' }, owner);
        const m2 = await api.post('/api/hub/team', { name: 'M2', email: `qa_m2_${stamp}@example.test`, role: 'manager' }, owner);
        const m3 = await api.post('/api/hub/team', { name: 'M3', email: `qa_m3_${stamp}@example.test`, role: 'manager' }, owner);
        for (const e of ['m1', 'm2', 'm3']) {
            const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_${e}_${stamp}@example.test`));
            if (r) createdAdminIds.push(r.id);
        }
        check('the Starter plan stops at 3 active people', m1.status === 201 && m2.status === 201 && m3.status === 402, `${m1.status}/${m2.status}/${m3.status}`);
        await api.put(`/api/admin/hub/partners/${bp.id}/plan`, { plan: 'pro' }, staff);
        const m3b = await api.post('/api/hub/team', { name: 'M3', email: `qa_m3_${stamp}@example.test`, role: 'manager' }, owner);
        const [m3row] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_m3_${stamp}@example.test`));
        if (m3row) createdAdminIds.push(m3row.id);
        check('...Pro lifts the limit', m3b.status === 201);

        const off = await api.put(`/api/admin/hub/partners/${bp.id}/modules`, { module: 'field', enabled: false }, staff);
        const meOff = await api.get('/api/hub/me', owner);
        check('staff can switch a vertical module off', off.status === 200 && !meOff.body?.data?.modules?.includes('field'));
        const on = await api.put(`/api/admin/hub/partners/${bp.id}/modules`, { module: 'events', enabled: true }, staff);
        const meOn = await api.get('/api/hub/me', owner);
        check('...or on, beyond the verticals', on.status === 200 && meOn.body?.data?.modules?.includes('events'));
        const coreOff = await api.put(`/api/admin/hub/partners/${bp.id}/modules`, { module: 'sales', enabled: false }, staff);
        check('core modules cannot be switched off', coreOff.status === 400);

        const gstLock = await api.patch('/api/hub/profile', { gstin: await gstinFor('27', panOk) }, owner);
        check('the GSTIN is locked once approved', gstLock.status === 409);

        // ── legacy FTTH operator login inside the Hub ─────────────────────
        const legacyPw = 'Legacy-op-123';
        const [legacy] = await db.insert(adminUsers).values({
            username: `qa_legacy_${stamp}`, email: `qa_legacy_${stamp}@example.test`, password: await bcrypt.hash(legacyPw, 10), role: 'operator', isActive: true,
        }).returning();
        createdAdminIds.push(legacy.id);
        await db.insert(ftthOperators).values({
            companyName: `QA Legacy ISP ${stamp}`, contactEmail: `qa_legacy_${stamp}@example.test`, contactPhone: `8${String(Date.now()).slice(-9)}`,
            status: 'active', adminUserId: legacy.id,
        } as any);
        const legacyTok = await api.login(legacy.username, legacyPw);
        const legacyMe = await api.get('/api/hub/me', legacyTok);
        const [linked] = await db.select().from(ftthOperators).where(eq(ftthOperators.adminUserId, legacy.id)).limit(1);
        if (linked?.businessPartnerId) createdBpIds.push(linked.businessPartnerId);
        check('a legacy operator login opens the Hub, linked to a new partner record', legacyMe.status === 200 && legacyMe.body?.data?.role === 'owner' && !!linked?.businessPartnerId && legacyMe.body?.data?.modules?.includes('broadband'));
        const legacyFtth = await api.get('/api/ftth/admin/me', legacyTok);
        check('...and its FTTH routes still answer', legacyFtth.status === 200);
    } finally {
        await cleanup();
        await close();
    }
    process.exit(summary());
}

async function cleanup() {
    try {
        const { partnerDocuments, partnerAgreements, partnerModules, businessPartnerVerticals } = await import('../shared/schema');
        if (createdBpIds.length) {
            const ops = await db.select({ id: ftthOperators.id }).from(ftthOperators).where(inArray(ftthOperators.businessPartnerId, createdBpIds));
            if (ops.length) {
                await db.delete(ftthOperatorPincodes).where(inArray(ftthOperatorPincodes.operatorId, ops.map(o => o.id)));
                await db.delete(ftthOperators).where(inArray(ftthOperators.id, ops.map(o => o.id)));
            }
            await db.delete(partnerUsers).where(inArray(partnerUsers.businessPartnerId, createdBpIds));
            await db.delete(partnerDocuments).where(inArray(partnerDocuments.businessPartnerId, createdBpIds));
            await db.delete(partnerAgreements).where(inArray(partnerAgreements.businessPartnerId, createdBpIds));
            await db.delete(partnerModules).where(inArray(partnerModules.businessPartnerId, createdBpIds));
            await db.delete(businessPartnerVerticals).where(inArray(businessPartnerVerticals.businessPartnerId, createdBpIds));
            await db.delete(businessPartners).where(inArray(businessPartners.id, createdBpIds));
        }
        await db.delete(ftthOperators).where(like(ftthOperators.companyName, `QA Legacy ISP ${stamp}`));
        if (createdAdminIds.length) {
            await db.delete(partnerUsers).where(inArray(partnerUsers.adminUserId, createdAdminIds));
            await db.delete(adminUsers).where(inArray(adminUsers.id, createdAdminIds));
        }
    } catch (e: any) {
        console.error('cleanup failed:', e.message);
    }
}

main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
