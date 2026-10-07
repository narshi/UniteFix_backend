/**
 * Partner Hub — follow-up features end to end: partner alerts,
            , online pay
 * links for partners' customers, store gateway fee and penalties, field
 * auto-assign and working hours, bundles, consignment, go-live checklist.
 *
 *   npm run smoke:hub-extras
 */

import jwt from 'jsonwebtoken';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, users, employees, services, serviceCategories, serviceRequests, serviceablePincodes, partnerTerritories, hubAlerts } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [], userIds: number[] = [], catIds: number[] = [], svcIds: number[] = [], pins: string[] = [];
const extraCleanup: string[] = [];
const inDays = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

async function freshPin() {
    for (;;) {
        const p = `78${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
        const [x] = await db.select().from(serviceablePincodes).where(eq(serviceablePincodes.pincode, p)).limit(1);
        const [y] = await db.select().from(partnerTerritories).where(eq(partnerTerritories.pincode, p)).limit(1);
        if (!x && !y && !pins.includes(p)) { pins.push(p); return p; }
    }
}

export const ctx: Record<string, any> = {};

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        const bp = await BusinessPartnerService.create({
            legalName: `QA Coastal Partners ${stamp}`, displayName: 'Coastal Partners', gstin: await gstinFor('29', 'QACPT1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_x_${stamp}@example.test`, verticalCodes: ['computer', 'consultation', 'events', 'electronics'], approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada',
        });
        bpIds.push(bp.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', hubPlan: 'pro', fieldTier: 'standard', bankStatus: 'verified', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', beneficiaryName: 'QA' }).where(eq(businessPartners.id, bp.id));
        const login = await PartnerHubService.createOwnerLogin(bp.id, {});
        const [ar] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, login.username)); adminIds.push(ar.id);
        const t = (await api.login(login.username, login.temporaryPassword))!;
        Object.assign(ctx, { api, base, staff, sa, bp, t, SECRET });

        // ═════════════════ alerts ═════════════════
        const pe = await api.post(`/api/public/events/${bp.partnerCode}/enquire`, { name: 'QA Asha', phone: '9876500099', eventType: 'Birthday', eventDate: inDays(20), guests: 40 });
        const al1 = await api.get('/api/hub/alerts', t);
        check('alerts: a public enquiry raises an alert in the Hub', pe.status === 201 && al1.body?.data?.items?.some((a: any) => a.kind === 'enquiry_new' && /Birthday/.test(a.title)));
        const enq = (await api.get('/api/hub/events/enquiries', t)).body.data[0];
        await api.post('/api/hub/events/packages', { name: 'Hall', category: 'venue', priceRupees: 10000 }, t);
        const pk = (await api.get('/api/hub/events/packages', t)).body.data[0];
        const q = await api.post(`/api/hub/events/enquiries/${enq.id}/quote`, { packages: [{ packageId: pk.id, quantity: 1 }] }, t);
        const sh = await api.post(`/api/hub/events/quotations/${q.body.data.id}/share`, {}, t);
        await api.post(`/api/public${sh.body.data.link}/respond`, { decision: 'accept' });
        ctx.quotationId = q.body.data.id;
        const svc = await api.post('/api/hub/consulting/services', { name: 'IT audit', kind: 'fixed', priceRupees: 2000, durationMinutes: 60, mode: 'online' }, t);
        await api.put('/api/hub/consulting/availability', { windows: [0, 1, 2, 3, 4, 5, 6].map(d => ({ weekday: d, startTime: '09:00', endTime: '18:00' })) }, t);
        ctx.consultServiceId = svc.body.data.id;
        const slots = await api.get(`/api/public/consult/${bp.partnerCode}/slots?serviceId=${svc.body.data.id}`);
        await api.post(`/api/public/consult/${bp.partnerCode}/book`, { serviceId: svc.body.data.id, startsAt: slots.body.data[3].startsAt, name: 'QA Ravi', phone: '9876500088' });
        const al2 = await api.get('/api/hub/alerts', t);
        const kinds = (al2.body?.data?.items ?? []).map((a: any) => a.kind);
        check('alerts: quotation accepted and consulting booking request raise alerts', kinds.includes('quote_accepted') && kinds.includes('booking_request'), kinds.join(','));
        check('alerts: unread count', al2.body?.data?.unread >= 3);
        await api.post('/api/hub/alerts/read', { id: al2.body.data.items[0].id }, t);
        check('alerts: mark one read', (await api.get('/api/hub/alerts', t)).body.data.unread === al2.body.data.unread - 1);
        await api.post('/api/hub/alerts/read', {}, t);
        check('alerts: mark all read', (await api.get('/api/hub/alerts', t)).body.data.unread === 0);
        const pr = await api.put('/api/hub/alerts/prefs', { sms: true, email: false }, t);
        check('alerts: the owner chooses the channels', pr.status === 200 && pr.body?.data?.sms === true && pr.body.data.email === false);
        const inv = await api.post('/api/hub/team', { name: 'QA Disp', email: `qa_xd_${stamp}@example.test`, role: 'dispatcher' }, t);
        const [dr] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_xd_${stamp}@example.test`)); if (dr) adminIds.push(dr.id);
        const disp = (await api.login(inv.body.data.username, inv.body.data.temporaryPassword))!;
        Object.assign(ctx, { disp });
        check('alerts: a dispatcher sees alerts but cannot change the channels', (await api.get('/api/hub/alerts', disp)).status === 200 && (await api.put('/api/hub/alerts/prefs', { sms: false }, disp)).status === 403);
        const other = await BusinessPartnerService.create({ legalName: `QA Other ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_xo_${stamp}@example.test`, verticalCodes: ['events'], approvedByAdminId: sa.id });
        bpIds.push(other.id);
        const ol = await PartnerHubService.createOwnerLogin(other.id, {});
        const [or] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(or.id);
        const t2 = (await api.login(ol.username, ol.temporaryPassword))!;
        Object.assign(ctx, { other, t2 });
        const al3 = await api.get('/api/hub/alerts', t2);
        check('alerts: another partner sees only its own (its welcome)', al3.body?.data?.items?.every((a: any) => a.kind === 'application_approved' || a.businessPartnerId === other.id) && !al3.body.data.items.some((a: any) => a.kind === 'enquiry_new'));

        // Field: a job in the partner's territory → alert
        const pin = await freshPin();
        await api.post('/api/hub/field/territories', { pincodes: [pin] }, t);
        const terr = (await api.get('/api/hub/field/territories', t)).body.data.find((x: any) => x.pincode === pin);
        await api.post('/api/admin/hub/territories/review', { ids: [terr.id], decision: 'approve' }, staff);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA X ${stamp}`, bookingFee: 99 }).returning(); catIds.push(cat.id);
        const [svc2] = await db.insert(services).values({ categoryId: cat.id, name: `QA Laptop ${stamp}`, basePrice: 900 }).returning(); svcIds.push(svc2.id);
        const [cu] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA X Customer', role: 'user', homeAddress: `Road ${pin}`, pinCode: pin } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        Object.assign(ctx, { pin, cat, svc2, cu, ct });
        const bk = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA', address: `Road ${pin}`, pinCode: pin, catalogServiceId: svc2.id }, ct);
        await new Promise(r => setTimeout(r, 400));
        const jobAlert = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'job_new')));
        check('alerts: a booking in the partner\'s territory raises "new job"', bk.status === 201 && jobAlert.length === 1 && jobAlert[0].refId === bk.body.data.id);
        const terrAlert = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'territory_reviewed')));
        check('alerts: UniteFix approving pincodes is announced', terrAlert.length === 1);
        ctx.job = bk.body.data;

        const { runExtras } = await import('./smoke-hub-extras.more');
        await runExtras(ctx, { userIds, catIds, svcIds, extraCleanup, adminIds });
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0', bpl = bpIds.join(',') || '0';
        await cleanupPartners(bpIds, adminIds, [
            ...extraCleanup,
            `DELETE FROM hub_alerts WHERE business_partner_id IN (${bpl})`,
            `DELETE FROM partner_pay_links WHERE business_partner_id IN (${bpl})`,
            `DELETE FROM consult_retainer_bills WHERE retainer_id IN (SELECT id FROM consult_retainers WHERE business_partner_id IN (${bpl}))`,
            ...['consult_appointments', 'consult_retainers', 'consult_services', 'consult_availability', 'consult_time_off'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bpl})`),
            `DELETE FROM event_vendor_costs WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bpl}))`,
            `DELETE FROM event_milestones WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bpl}))`,
            ...['event_bookings', 'event_enquiries', 'event_vendors', 'event_packages', 'partner_territories', 'partner_service_rates'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bpl})`),
            `DELETE FROM partner_job_earnings WHERE service_request_id IN (${ids})`,
            `DELETE FROM warranty_claims WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM employees WHERE managed_by_partner_id IN (${bpl})`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM services WHERE id IN (${svcIds.join(',') || 0})`,
            `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || 0})`,
            `DELETE FROM serviceable_pincodes WHERE pincode IN (${pins.map(p => `'${p}'`).join(',') || "''"})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
