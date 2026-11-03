/**
 * A partner working from the UniteFix app: the app login acts as the business
 * owner in the Partner Hub (jobs, team, commission), the owner can put himself
 * on his own team with that same login, take a job himself, and switch to
 * technician mode to work it.
 *
 *   npm run smoke:partner-app
 */

import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceRequests, businessPartners, partnerJobEarnings, partnerWallets } from '../shared/schema';
import { BillingEngine } from '../server/services/billing-engine';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { storage } from '../server/storage';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.011;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const bp = await BusinessPartnerService.create({ legalName: `QA App Partner ${stamp}`, contactPhone: phone(), contactEmail: `qa_app_${stamp}@example.test`, verticalCodes: ['plumbing'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        // The partner's mobile login, as staff create it: a users row with role business_partner.
        const [pu] = await db.insert(users).values({ phone: phone(), username: 'QA App Owner', role: 'business_partner', isActive: true } as any).returning(); userIds.push(pu.id);
        await db.update(businessPartners).set({ userId: pu.id } as any).where(eq(businessPartners.id, bp.id));
        const A = jwt.sign({ userId: pu.id, role: 'business_partner' }, SECRET, { expiresIn: '1h' });

        // ── the app login is the owner in the Hub ──
        const me = await api.get('/api/hub/me', A);
        check('the app login opens the Partner Hub as the owner', me.status === 200 && me.body?.data?.role === 'owner' && (me.body.data.modules ?? []).includes('field'), JSON.stringify(me.body?.data && { role: me.body.data.role, m: me.body.data.modules }).slice(0, 200));
        check('…and sees its jobs and team', (await api.get('/api/hub/field/jobs', A)).status === 200 && (await api.get('/api/hub/field/technicians', A)).status === 200);
        check('…and can set its commission', (await api.put('/api/hub/field/settings', { commissionType: 'fixed', commissionValue: 100 }, A)).body?.data?.commission?.value === 100);

        // ── the owner on his own team, with his own login ──
        check('his own number without "This is me" is refused with what to do', (await api.post('/api/hub/field/technicians', { fullName: 'QA App Owner', phone: pu.phone }, A)).body?.code === 'OWN_LOGIN');
        const addMe = await api.post('/api/hub/field/technicians', { fullName: 'QA App Owner', phone: pu.phone, isOwner: true }, A);
        const ownerEmpId = addMe.body?.data?.id;
        const [oe] = await db.select().from(employees).where(eq(employees.id, ownerEmpId ?? 0));
        check('with "This is me" he is on his team, on the same login (no second number)', addMe.status === 201 && oe?.userId === pu.id && oe.isPartnerOwner === true, JSON.stringify(addMe.body).slice(0, 200));
        check('…once', (await api.post('/api/hub/field/technicians', { fullName: 'QA App Owner', phone: pu.phone, isOwner: true }, A)).body?.code === 'OWNER_EXISTS');

        // A technician too, and a job UniteFix sends.
        const add = await api.post('/api/hub/field/technicians', { fullName: 'QA App Tech', phone: phone() }, A);
        const techId = add.body?.data?.id;
        const [tu] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, techId)); userIds.push(tu.userId!);
        await db.update(employees).set({ documentVerificationStatus: 'verified', isActive: true } as any).where(eq(employees.id, techId));
        await db.update(employees).set({ documentVerificationStatus: 'verified', isActive: true } as any).where(eq(employees.id, ownerEmpId));
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA App Customer', role: 'user', isActive: true } as any).returning(); userIds.push(cu.id);
        const snap = await BillingEngine.createCatalogSnapshot(799, { bookingFee: 99 });
        const mk = async () => (await db.insert(serviceRequests).values({
            userId: cu.id, serviceId: `QA-AP-${stamp}-${++n}`, serviceType: 'QA tap repair', brand: 'x', model: 'x', description: 'QA', address: 'x',
            status: 'created', bookingFeeStatus: 'paid', pricingSnapshot: snap, dispatchPartnerId: bp.id, dispatchMode: 'staff',
        } as any).returning())[0];
        const j1 = await mk(), j2 = await mk();
        const q = (await api.get('/api/hub/field/jobs?view=queue', A)).body?.data ?? [];
        check('the jobs UniteFix sent are on his Jobs list', q.some((j: any) => j.id === j1.id) && q.some((j: any) => j.id === j2.id));
        check('he assigns one to his technician', (await api.post(`/api/hub/field/jobs/${j1.id}/assign`, { employeeId: techId }, A)).status === 200 && (await db.select().from(serviceRequests).where(eq(serviceRequests.id, j1.id)))[0].providerId === techId);
        check('…and takes the other himself', (await api.post(`/api/hub/field/jobs/${j2.id}/assign`, { employeeId: ownerEmpId }, A)).status === 200 && (await db.select().from(serviceRequests).where(eq(serviceRequests.id, j2.id)))[0].providerId === ownerEmpId);

        // ── technician mode ──
        const ses = await api.post('/api/hub/field/technician-session', {}, A);
        check('he switches to technician mode: a technician session on the same login', ses.status === 200 && ses.body?.user?.role === 'serviceman' && ses.body.user.id === pu.id && ses.body.user.employeeId === ownerEmpId && !!ses.body.accessToken && !!ses.body.refreshToken, JSON.stringify(ses.body).slice(0, 200));
        const mine = await api.get('/api/serviceman/assignments', ses.body?.accessToken);
        check('…where the job he took is his to work, and his technician’s is not', mine.status === 200 && (mine.body?.data ?? []).some((a: any) => a.id === j2.id) && !(mine.body?.data ?? []).some((a: any) => a.id === j1.id), JSON.stringify(mine.body).slice(0, 200));
        check('…and the technician session is not a Hub login', (await api.get('/api/hub/me', ses.body?.accessToken)).status === 403);
        check('the web Hub login cannot switch (technician mode is in the app)', (await (async () => {
            const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
            const [ow] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(ow.id);
            const T = (await api.login(ol.username, ol.temporaryPassword))!;
            return (await api.post('/api/hub/field/technician-session', {}, T)).body?.code;
        })()) === 'APP_ONLY');

        // ── money: his own job pays him in full; his technician's pays the commission ──
        for (const j of [j1, j2]) {
            await db.update(serviceRequests).set({ status: 'pending_payment' as any }).where(eq(serviceRequests.id, j.id));
            await storage.updateServiceRequestStatus(j.id, 'completed');
        }
        const [h1] = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, j1.id));
        const [h2] = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, j2.id));
        const [ow] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, ownerEmpId));
        check('his technician’s job: his ₹100 commission is held for the business', near((h1?.amountPaise ?? 0) / 100, 100));
        check('his own job: all of it to him, no commission', !h2 && near(ow?.balanceHold, snap.technicianEarning!), JSON.stringify({ h2, ow }));

        // A switched-off app login is refused.
        await db.update(users).set({ isActive: false } as any).where(eq(users.id, pu.id));
        check('a switched-off app login cannot open the Hub', (await api.get('/api/hub/me', A)).body?.code === 'LOGIN_DISABLED');
        void S;
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    const srs = `SELECT id FROM service_requests WHERE service_id LIKE 'QA-AP-${stamp}-%'`;
    await cleanupPartners(bpIds, adminIds, [
        `UPDATE business_partners SET user_id = NULL WHERE id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM partner_job_earnings WHERE service_request_id IN (${srs})`,
        `DELETE FROM invoices WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM wallet_transactions WHERE provider_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
        `DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM service_requests WHERE service_id LIKE 'QA-AP-${stamp}-%'`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
