/**
 * Jobs that do not finish in one visit: continue another day, and "could not
 * fix" with a follow-up by another expert. The first expert earns the visit
 * pay; whoever finishes earns the rest; the job never pays out more than it
 * is worth — online, in cash, and on a partner's job with commission.
 *
 *   npm run smoke:job-progress
 */

import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, serviceRequests, partnerWallets, partnerJobEarnings, partRequests, walletTransactionsV2 } from '../shared/schema';
import { BillingEngine } from '../server/services/billing-engine';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { storage } from '../server/storage';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.011;
const r2 = (x: number) => Math.round(x * 100) / 100;
const day = (k: number) => new Date(Date.now() + 5.5 * 3_600_000 + k * 86_400_000).toISOString().slice(0, 10);

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA JP Customer', role: 'user', isActive: true } as any).returning(); userIds.push(cu.id);
        const expert = async (managedBy: number | null = null) => {
            const [u] = await db.insert(users).values({ phone: phone(), username: 'QA JP Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: 'QA JP Expert', documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: managedBy } as any).returning();
            return { e, t: jwt.sign({ userId: u.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' }) };
        };
        const s799 = await BillingEngine.createCatalogSnapshot(799, { bookingFee: 99 });
        const earning = s799.technicianEarning!;
        const booking = async (providerId: number, extra: Record<string, unknown> = {}) => (await db.insert(serviceRequests).values({
            userId: cu.id, serviceId: `QA-JP-${stamp}-${++n}`, serviceType: 'QA job', brand: 'x', model: 'x', description: 'QA', address: 'x',
            status: 'in_progress', providerId, bookingFeeStatus: 'paid', pricingSnapshot: s799, ...extra,
        } as any).returning())[0];
        const sr = async (id: number) => (await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)))[0];
        const wallet = async (id: number) => (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, id)))[0];

        // ── continue another day ──
        const a = await expert();
        const j1 = await booking(a.e.id);
        check('a day in the past or today is refused', (await api.post(`/api/bookings/${j1.id}/continue-later`, { date: day(0), note: 'Wiring half done' }, a.t)).body?.code === 'BAD_DATE');
        check('more than 14 days ahead is refused', (await api.post(`/api/bookings/${j1.id}/continue-later`, { date: day(20), note: 'Wiring half done' }, a.t)).body?.code === 'BAD_DATE');
        check('a note is required', (await api.post(`/api/bookings/${j1.id}/continue-later`, { date: day(1), note: '' }, a.t)).body?.code === 'NO_NOTE');
        const p1 = await api.post(`/api/bookings/${j1.id}/continue-later`, { date: day(1), note: 'Wiring of two rooms done; kitchen tomorrow' }, a.t);
        const p1r = await sr(j1.id);
        check('the expert ends the day with the date and a note; the job stays in progress', p1.status === 200 && p1r.status === 'in_progress' && p1r.pausedUntil === day(1) && (p1r.visitLog as any[]).length === 1, JSON.stringify(p1.body).slice(0, 200));
        const other = await expert();
        check('another expert cannot pause someone else’s job', (await api.post(`/api/bookings/${j1.id}/continue-later`, { date: day(1), note: 'x x x' }, other.t)).status === 403);
        const r1 = await api.post(`/api/bookings/${j1.id}/resume`, {}, a.t);
        const r1r = await sr(j1.id);
        check('next day the expert resumes without an OTP; both days are in the visit log', r1.status === 200 && r1r.pausedUntil === null && (r1r.visitLog as any[]).map((v: any) => v.kind).join(',') === 'paused,resumed');
        check('resuming a job that is not paused is refused', (await api.post(`/api/bookings/${j1.id}/resume`, {}, a.t)).body?.code === 'NOT_PAUSED');

        // ── could not fix: a UniteFix expert, finished online by another ──
        check('a reason is required', (await api.post(`/api/bookings/${j1.id}/cannot-fix`, { reason: 'no' }, a.t)).body?.code === 'NO_REASON');
        await db.insert(partRequests).values({ serviceRequestId: j1.id, employeeId: a.e.id, customerUserId: cu.id, status: 'approved', items: [], reason: 'QA', sentAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } as any);
        const cf = await api.post(`/api/bookings/${j1.id}/cannot-fix`, { reason: 'Motor shaft is bent; needs a lathe shop' }, a.t);
        const cfr = await sr(j1.id);
        check('could not fix: the job goes back unassigned, marked as a follow-up', cf.status === 200 && cfr.status === 'created' && cfr.providerId === null && cfr.followUpCount === 1 && /lathe/.test(cfr.lastAttemptReason ?? ''), JSON.stringify(cf.body));
        check('…the first expert earns the ₹150 visit pay, held', cf.body?.data?.visitPayRupees === 150 && near((await wallet(a.e.id))?.balanceHold, 150));
        check('…recorded against the booking', cfr.priorVisitPayPaise === 15000 && (await db.select().from(walletTransactionsV2).where(eq(walletTransactionsV2.partnerId, a.e.id))).some(t => (t.metadata as any)?.forBooking === j1.id));
        check('…parts approved for that visit are withdrawn', (await db.select().from(partRequests).where(eq(partRequests.serviceRequestId, j1.id))).every(p => p.status === 'cancelled'));
        const q = (await api.get('/api/admin/assignment-queue', S)).body?.queue ?? [];
        check('…and it is in the Assignment Queue as a follow-up with the reason', q.some((x: any) => x.id === j1.id && x.followUpCount === 1 && /lathe/.test(x.lastAttemptReason ?? '')));
        const b = await expert();
        await db.update(serviceRequests).set({ providerId: b.e.id, status: 'pending_payment' as any }).where(eq(serviceRequests.id, j1.id));
        await storage.updateServiceRequestStatus(j1.id, 'completed');
        check('the second expert finishes; paid online they earn the job less the visit pay', near((await wallet(b.e.id))?.balanceHold, r2(earning - 150)), JSON.stringify(await wallet(b.e.id)));

        // ── followed up and paid in cash ──
        const c = await expert(), d = await expert();
        const j2 = await booking(c.e.id);
        await api.post(`/api/bookings/${j2.id}/cannot-fix`, { reason: 'Needs a part from Hubballi' }, c.t);
        await db.update(serviceRequests).set({ providerId: d.e.id, status: 'in_progress' as any }).where(eq(serviceRequests.id, j2.id));
        const k = await api.post(`/api/admin/services/${j2.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'Follow-up done, paid cash' }, S);
        const debit = r2(BillingEngine.calculateCashDebitAmount(s799) + 150);
        check('in cash, the second expert’s wallet also pays back the visit pay', k.status === 200 && near((await wallet(d.e.id))?.balanceAvailable, -debit), JSON.stringify({ w: await wallet(d.e.id), debit }));

        // ── a partner's job: back to the partner, commission on what is left ──
        const bp = await BusinessPartnerService.create({ legalName: `QA JP Partner ${stamp}`, contactPhone: phone(), contactEmail: `qa_jp_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
        const T = (await api.login(ol.username, ol.temporaryPassword))!;
        const { adminUsers } = await import('../shared/schema');
        const [ow] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(ow.id);
        const p = await expert(bp.id), p2 = await expert(bp.id);
        const j3 = await booking(p.e.id, { dispatchPartnerId: bp.id, dispatchMode: 'staff' });
        await api.post(`/api/bookings/${j3.id}/cannot-fix`, { reason: 'Earthing fault inside the wall' }, p.t);
        const j3r = await sr(j3.id);
        const pj = ((await api.get('/api/hub/field/jobs?view=queue', T)).body?.data ?? []).find((x: any) => x.id === j3.id);
        check('a partner technician’s job goes back to the partner’s Jobs, marked follow-up', j3r.dispatchPartnerId === bp.id && j3r.providerId === null && pj?.followUpCount === 1, JSON.stringify(pj ?? null).slice(0, 200));
        check('…the first technician gets the visit pay in full (no commission on it)', near((await wallet(p.e.id))?.balanceHold, 150) && !(await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, j3.id))).length);
        await db.update(serviceRequests).set({ providerId: p2.e.id, status: 'pending_payment' as any }).where(eq(serviceRequests.id, j3.id));
        await storage.updateServiceRequestStatus(j3.id, 'completed');
        const left = r2(earning - 150), comm = r2(left * 0.2);
        const [held] = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, j3.id));
        check('…the partner’s 20% is on what is left, and the second technician gets the rest', near(held?.amountPaise / 100, comm) && near((await wallet(p2.e.id))?.balanceHold, r2(left - comm)), JSON.stringify({ held: held?.amountPaise, w: await wallet(p2.e.id), comm }));
        check('…so the job paid out exactly its value', near(150 + comm + r2(left - comm), earning));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    const srs = `SELECT id FROM service_requests WHERE service_id LIKE 'QA-JP-${stamp}-%'`;
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM part_requests WHERE service_request_id IN (${srs})`,
        `DELETE FROM partner_job_earnings WHERE service_request_id IN (${srs})`,
        `DELETE FROM invoices WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM wallet_transactions WHERE provider_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
        `DELETE FROM service_requests WHERE service_id LIKE 'QA-JP-${stamp}-%'`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
