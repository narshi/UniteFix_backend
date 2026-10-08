/**
 * Dashboard money: each stream lands in its own column — UniteFix's revenue,
 * partners' earnings, experts' earnings, GST — and nothing is counted twice.
 * Compares before/after totals, so it does not depend on what is already in
 * the database.
 *
 *   npm run smoke:overview
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db, cleanupPartners, gstinFor } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services, partnerPayLinks } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], catIds: number[] = [], svcIds: number[] = [], bpIds: number[] = [];
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        const get = async () => (await api.get('/api/admin/reports/overview?range=30d', staff)).body?.data;
        const before = await get();
        check('the overview loads for staff', !!before && Array.isArray(before.series) && before.series.length === 30 && before.streams.length === 8, JSON.stringify(before && { s: before.series.length, st: before.streams?.length }));
        check('12 months means 12 bars', (await api.get('/api/admin/reports/overview?range=12m', staff)).body?.data?.series?.length === 12);
        check('it is not public', (await api.get('/api/admin/reports/overview')).status === 401);

        // ── seed: one UniteFix-expert job, one partner job, one payment link ──
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Ov ${stamp}`, bookingFee: 149 }).returning(); catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Ov fan ${stamp}`, basePrice: 1000 }).returning(); svcIds.push(svc.id);
        const [cu] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Ov Customer', role: 'user', homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const [tu] = await db.insert(users).values({ phone: `9${String(Date.now()).slice(-9)}`, username: 'QA Ov Tech', role: 'serviceman', homeAddress: 'Sirsi', pinCode: '581401' } as any).returning(); userIds.push(tu.id);
        const [emp] = await db.insert(employees).values({ userId: tu.id, fullName: 'QA Ov Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const bp = await BusinessPartnerService.create({ legalName: `QA Ov Partner ${stamp}`, displayName: 'Ov Partner', gstin: await gstinFor('29', 'QAOVP1234K'), contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_ov_${stamp}@example.test`, verticalCodes: ['computer'], approvedByAdminId: sa.id });
        bpIds.push(bp.id);

        const complete = async (partnerId: number | null) => {
            const b = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svc.id }, ct);
            const id = b.body.data.id;
            await db.update(serviceRequests).set({ providerId: emp.id, dispatchPartnerId: partnerId, status: 'completed' as any, completedAt: new Date() }).where(eq(serviceRequests.id, id));
            const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id));
            return sr.pricingSnapshot as any;
        };
        const direct = await complete(null);
        const viaPartner = await complete(bp.id);
        await db.insert(partnerPayLinks).values({ businessPartnerId: bp.id, token: crypto.randomBytes(18).toString('base64url'), kind: 'invoice', refId: 0, description: 'QA', amountPaise: 100000, status: 'paid', paidAt: new Date(), feePaise: 2000, feeGstPaise: 360 });

        const after = await get();
        const d = (key: string, col: string) => (after.streams.find((s: any) => s.key === key)?.[col] ?? 0) - (before.streams.find((s: any) => s.key === key)?.[col] ?? 0);
        check('UniteFix-expert job: customer total is volume, the platform fee is UniteFix revenue, the rest is the expert\'s',
            near(d('services_direct', 'gmv'), direct.grossTotal) && near(d('services_direct', 'unitefix'), direct.platformFee + direct.bookingFee) && near(d('services_direct', 'expert'), direct.technicianEarning) && near(d('services_direct', 'partner'), 0),
            JSON.stringify({ gmv: d('services_direct', 'gmv'), uf: d('services_direct', 'unitefix'), ex: d('services_direct', 'expert'), snap: [direct.grossTotal, direct.platformFee, direct.bookingFee, direct.technicianEarning] }));
        check('partner job: kept apart — the technician\'s share is the partner\'s earning, not an expert\'s',
            near(d('services_partner', 'gmv'), viaPartner.grossTotal) && near(d('services_partner', 'unitefix'), viaPartner.platformFee + viaPartner.bookingFee) && near(d('services_partner', 'partner'), viaPartner.technicianEarning) && near(d('services_partner', 'expert'), 0));
        check('payment link: ₹1,000 paid, UniteFix keeps the ₹20 fee, the partner ₹976.40',
            near(d('paylinks', 'gmv'), 1000) && near(d('paylinks', 'unitefix'), 20) && near(d('paylinks', 'partner'), 976.4));
        const dt = (col: string) => after.totals.current[col] - before.totals.current[col];
        check('totals are the sum of the streams, GST kept separate',
            near(dt('unitefix'), direct.platformFee + direct.bookingFee + viaPartner.platformFee + viaPartner.bookingFee + 20) && near(dt('gst'), direct.gst + viaPartner.gst) && dt('jobs') === 2);
        check('volume = UniteFix + partners + experts + GST for these jobs',
            near(d('services_direct', 'gmv'), d('services_direct', 'unitefix') + d('services_direct', 'expert') + d('services_direct', 'gst')) && near(d('services_partner', 'gmv'), d('services_partner', 'unitefix') + d('services_partner', 'partner') + d('services_partner', 'gst')));
        const lastBar = after.series[after.series.length - 1], lastBefore = before.series[before.series.length - 1];
        check('today\'s bar carries the new revenue, split by stream',
            near(lastBar.unitefix - lastBefore.unitefix, dt('unitefix')) && near(lastBar.services_partner - lastBefore.services_partner, viaPartner.platformFee + viaPartner.bookingFee));
        check('take rate is UniteFix revenue over volume', near(after.totals.current.takeRate, Math.round(after.totals.current.unitefix / after.totals.current.gmv * 1000) / 10));
        check('operations and the staff to-do list come with it', Array.isArray(after.operations?.pipeline) && after.operations.pipeline.length === 4 && Array.isArray(after.attention) && after.operations.network.partners >= 1);
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM partner_pay_links WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM services WHERE id IN (${svcIds.join(',') || 0})`,
            `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
