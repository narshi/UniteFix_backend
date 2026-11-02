/**
 * A partner's technicians are paid into their own UniteFix wallets, and the
 * partner earns a commission on each job: a percentage or a fixed amount, the
 * partner's default or the technician's own. The partner's owner can work jobs
 * himself, with no commission.
 *
 *   npm run smoke:partner-commission
 */

import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceRequests, partnerWallets, partnerJobEarnings, businessPartners } from '../shared/schema';
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
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const bp = await BusinessPartnerService.create({ legalName: `QA Comm ${stamp}`, contactPhone: phone(), contactEmail: `qa_comm_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
        const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
        const T = (await api.login(ol.username, ol.temporaryPassword))!;
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Comm Customer', role: 'user', isActive: true } as any).returning(); userIds.push(cu.id);
        const s799 = await BillingEngine.createCatalogSnapshot(799, { bookingFee: 99 });
        const earning = s799.technicianEarning!;   // 557.27
        const booking = async (providerId: number, status = 'pending_payment') => (await db.insert(serviceRequests).values({
            userId: cu.id, serviceId: `QA-CM-${stamp}-${++n}`, serviceType: 'QA job', brand: 'x', model: 'x', description: 'QA', address: 'x',
            status, providerId, bookingFeeStatus: 'paid', pricingSnapshot: s799, dispatchPartnerId: bp.id,
        } as any).returning())[0];
        const wallet = async (id: number) => (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, id)))[0];
        const held = async (srId: number) => (await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, srId)))[0];

        // ── Settings ──
        const s0 = await api.get('/api/hub/field/settings', T);
        check('a partner’s default commission is 20% of each job', s0.body?.data?.commission?.type === 'percent' && s0.body.data.commission.value === 20, JSON.stringify(s0.body?.data?.commission));
        check('a percentage above 100 is refused', (await api.put('/api/hub/field/settings', { commissionType: 'percent', commissionValue: 150 }, T)).status === 400);
        const s1 = await api.put('/api/hub/field/settings', { commissionType: 'percent', commissionValue: 25, fieldSupportPhone: '9876543210' }, T);
        check('the partner sets 25%, and the customer support phone is saved too (it used to be dropped)', s1.status === 200 && s1.body?.data?.commission?.value === 25 && s1.body.data.fieldSupportPhone === '9876543210', JSON.stringify(s1.body?.data));

        // ── Technicians ──
        const add = await api.post('/api/hub/field/technicians', { fullName: 'QA Comm Tech', phone: phone() }, T);
        const techId = add.body?.data?.id;
        const [tu] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, techId)); userIds.push(tu.userId!);
        await db.update(employees).set({ documentVerificationStatus: 'verified', isActive: true } as any).where(eq(employees.id, techId));
        const list = (await api.get('/api/hub/field/technicians', T)).body?.data ?? [];
        check('a new technician uses the partner’s default (no commission of their own)', list.find((t: any) => t.id === techId)?.commission === null);

        // Online job at the default 25%.
        const b1 = await booking(techId);
        await storage.updateServiceRequestStatus(b1.id, 'completed');
        const c1 = Math.round(earning * 25) / 100;
        check('an online job: the partner’s 25% is held for the partner', near((await held(b1.id))?.amountPaise / 100, c1), JSON.stringify(await held(b1.id)));
        check('…and the rest is held in the technician’s own wallet', near((await wallet(techId))?.balanceHold, earning - c1), JSON.stringify(await wallet(techId)));

        // The technician's own fixed commission.
        check('a fixed commission must be 0 or more', (await api.patch(`/api/hub/field/technicians/${techId}`, { commission: { type: 'fixed', value: -5 } }, T)).status === 400);
        await api.patch(`/api/hub/field/technicians/${techId}`, { commission: { type: 'fixed', value: 100 } }, T);
        const b2 = await booking(techId);
        await storage.updateServiceRequestStatus(b2.id, 'completed');
        check('a technician’s own ₹100 a job beats the default', near((await held(b2.id))?.amountPaise / 100, 100));
        check('…and they get the rest', near((await wallet(techId))?.balanceHold, (earning - c1) + (earning - 100)));

        // A cash job: the technician keeps the cash, and the wallet pays UniteFix's share plus the commission.
        await api.patch(`/api/hub/field/technicians/${techId}`, { commission: { type: 'percent', value: 10 } }, T);
        const before = Number((await wallet(techId))?.balanceAvailable ?? 0);
        const b3 = await booking(techId, 'in_progress');
        const k = await api.post(`/api/admin/services/${b3.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'Cash job, commission test' }, S);
        const c3 = Math.round(earning * 10) / 100;
        const debit = BillingEngine.calculateCashDebitAmount(s799) + c3;
        check('a cash job: the partner’s 10% is held for the partner', k.status === 200 && near((await held(b3.id))?.amountPaise / 100, c3), JSON.stringify(k.body).slice(0, 200));
        check('…and the technician’s wallet pays UniteFix’s share plus that commission', near(Number((await wallet(techId))?.balanceAvailable) - before, -debit), JSON.stringify({ w: await wallet(techId), debit }));

        // The commission never exceeds the job.
        await api.patch(`/api/hub/field/technicians/${techId}`, { commission: { type: 'fixed', value: 5000 } }, T);
        const b4 = await booking(techId);
        await storage.updateServiceRequestStatus(b4.id, 'completed');
        check('a fixed commission larger than the job takes the whole job, never more', near((await held(b4.id))?.amountPaise / 100, earning));
        await api.patch(`/api/hub/field/technicians/${techId}`, { commission: null }, T);
        check('clearing it puts the technician back on the default', ((await api.get('/api/hub/field/technicians', T)).body?.data ?? []).find((t: any) => t.id === techId)?.commission === null);

        // The technician's app shows their wallet (no "employer") and the cut.
        const tok = jwt.sign({ userId: tu.userId, role: 'serviceman' }, process.env.JWT_SECRET!, { expiresIn: '5m' });
        const prof = await api.get('/api/partner/profile', tok);
        check('the technician’s app shows their wallet, with who they work with and the commission', prof.status === 200 && prof.body?.data?.employer === null && prof.body.data.worksWith?.name === bp.displayName && /25% of each job/.test(prof.body.data.worksWith.commission), JSON.stringify(prof.body?.data?.worksWith ?? prof.body).slice(0, 200));

        // ── The owner working jobs himself ──
        const [bpRow] = await db.select().from(businessPartners).where(eq(businessPartners.id, bp.id));
        const ownLogin = await api.post('/api/hub/field/technicians', { fullName: 'QA Owner', phone: bpRow.contactPhone, isOwner: true }, T);
        check('the owner can add himself as a technician with his mobile number', ownLogin.status === 201, JSON.stringify(ownLogin.body));
        const ownerTechId = ownLogin.body?.data?.id;
        const [ou] = await db.select({ userId: employees.userId, isPartnerOwner: employees.isPartnerOwner }).from(employees).where(eq(employees.id, ownerTechId)); userIds.push(ou.userId!);
        check('…marked as the owner', ou.isPartnerOwner === true);
        check('…only once', (await api.post('/api/hub/field/technicians', { fullName: 'QA Owner 2', phone: phone(), isOwner: true }, T)).body?.code === 'OWNER_EXISTS');
        check('…and no commission can be set on his own jobs', (await api.patch(`/api/hub/field/technicians/${ownerTechId}`, { commission: { type: 'percent', value: 10 } }, T)).status === 409);
        await db.update(employees).set({ documentVerificationStatus: 'verified', isActive: true } as any).where(eq(employees.id, ownerTechId));
        const b5 = await booking(ownerTechId);
        await storage.updateServiceRequestStatus(b5.id, 'completed');
        check('the owner’s own job: all of it in his wallet, no commission held', !(await held(b5.id)) && near((await wallet(ownerTechId))?.balanceHold, earning));

        // The partner's own app login number cannot also be a technician login.
        const [bu] = await db.insert(users).values({ phone: phone(), username: 'QA BP Login', role: 'business_partner', isActive: true } as any).returning(); userIds.push(bu.id);
        await db.update(businessPartners).set({ userId: bu.id } as any).where(eq(businessPartners.id, bp.id));
        const clash = await api.post('/api/hub/field/technicians', { fullName: 'QA Again', phone: bu.phone }, T);
        check('the partner app login number is refused with why', clash.body?.code === 'OWN_LOGIN', JSON.stringify(clash.body));

        // Partner's jobs list shows the commission.
        const jobs = (await api.get('/api/hub/field/jobs?view=done', T)).body?.data ?? [];
        const j1 = jobs.find((j: any) => j.id === b1.id);
        check('the partner’s Jobs page shows the job value and their commission', j1 && near(j1.yourValue, earning) && near(j1.yourCommission, Math.round(earning * 25) / 100), JSON.stringify(j1 ?? null).slice(0, 200));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    const srs = `SELECT id FROM service_requests WHERE service_id LIKE 'QA-CM-${stamp}-%'`;
    await cleanupPartners(bpIds, adminIds, [
        `UPDATE business_partners SET user_id = NULL WHERE id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM partner_job_earnings WHERE service_request_id IN (${srs})`,
        `DELETE FROM invoices WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM wallet_transactions WHERE provider_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
        `DELETE FROM audit_logs WHERE entity_type = 'business_partner' AND entity_id IN (${bpIds.join(',') || '0'})`,
        `DELETE FROM service_requests WHERE service_id LIKE 'QA-CM-${stamp}-%'`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
