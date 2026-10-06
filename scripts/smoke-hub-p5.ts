/**
 * Partner Hub — phase 5 end to end: consulting services, availability and
 * free slots, appointments (Hub and public), billing, retainers.
 *
 *   npm run smoke:hub-p5
 */

import { and, eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, consultAppointments, consultRetainers, taxDocuments, partnerCustomers } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { PartnerConsultingService, istDay } from '../server/services/partner-consulting.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];

/** The next date (IST) that falls on `weekday`, at least `after` days ahead. */
function nextWeekday(weekday: number, after = 1) {
    for (let i = after; i < after + 8; i++) {
        const d = istDay(new Date(Date.now() + i * 86_400_000));
        if (new Date(`${d}T00:00:00Z`).getUTCDay() === weekday) return d;
    }
    throw new Error('unreachable');
}
const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const bp = await BusinessPartnerService.create({
            legalName: `QA Rao Advisory ${stamp}`, displayName: 'Rao Advisory', gstin: await gstinFor('29', 'QARAO1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p5_${stamp}@example.test`, verticalCodes: ['consultation'], approvedByAdminId: sa.id,
        });
        const other = await BusinessPartnerService.create({
            legalName: `QA Fixit ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_p5b_${stamp}@example.test`, verticalCodes: ['computer'], approvedByAdminId: sa.id,
        });
        bpIds.push(bp.id, other.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(eq(businessPartners.id, bp.id));
        const l1 = await PartnerHubService.createOwnerLogin(bp.id, {});
        const l2 = await PartnerHubService.createOwnerLogin(other.id, {});
        for (const e of [l1.username, l2.username]) { const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id); }
        const t1 = (await api.login(l1.username, l1.temporaryPassword))!;
        const t2 = (await api.login(l2.username, l2.temporaryPassword))!;

        check('a partner without consulting cannot use it', (await api.get('/api/hub/consulting/services', t2)).status === 403);

        // ── services ──────────────────────────────────────────────────────
        const badSac = await api.post('/api/hub/consulting/services', { name: 'Tax planning', kind: 'fixed', priceRupees: 2000, durationMinutes: 60, sac: '8471' }, t1);
        check('a goods HSN is refused as a service SAC', badSac.status === 400 && badSac.body?.code === 'BAD_SAC');
        const s1 = await api.post('/api/hub/consulting/services', { name: 'Tax planning session', kind: 'fixed', priceRupees: 2000, durationMinutes: 60, mode: 'both' }, t1);
        const s2 = await api.post('/api/hub/consulting/services', { name: 'Advisory (hourly)', kind: 'hourly', priceRupees: 1500, durationMinutes: 90, mode: 'online' }, t1);
        const s3 = await api.post('/api/hub/consulting/services', { name: 'CFO on call', kind: 'retainer', priceRupees: 25000, durationMinutes: 60, hoursIncluded: 8 }, t1);
        check('fixed, hourly and retainer services are added with SAC 998311 and 18% GST', s1.status === 201 && s2.status === 201 && s3.status === 201 && s1.body.data.sac === '998311' && s1.body.data.gstRate === 18);

        // ── availability ──────────────────────────────────────────────────
        const overlap = await api.put('/api/hub/consulting/availability', { windows: [{ weekday: 1, startTime: '10:00', endTime: '13:00' }, { weekday: 1, startTime: '12:00', endTime: '14:00' }] }, t1);
        check('overlapping windows are refused', overlap.status === 400 && overlap.body?.code === 'OVERLAP');
        const av = await api.put('/api/hub/consulting/availability', { windows: [{ weekday: 1, startTime: '10:00', endTime: '13:00' }, { weekday: 1, startTime: '15:00', endTime: '17:00' }, { weekday: 3, startTime: '10:00', endTime: '12:00' }] }, t1);
        check('weekly hours are saved', av.status === 200 && av.body?.data?.windows?.length === 3);
        const monday = nextWeekday(1, 2);
        const slots = await api.get(`/api/hub/consulting/slots?serviceId=${s1.body.data.id}&days=10`, t1);
        const mondaySlots = (slots.body?.data ?? []).filter((x: any) => x.day === monday);
        check('Monday 10–13 & 15–17 gives 60-minute slots on a 15-minute grid (9 + 5)', mondaySlots.length === 14 && mondaySlots[0].time === '10:00' && mondaySlots[mondaySlots.length - 1].time === '16:00', `${mondaySlots.length} ${mondaySlots[0]?.time}`);
        const tuesday = nextWeekday(2, 2);
        check('no slots on a day without hours', !(slots.body?.data ?? []).some((x: any) => x.day === tuesday));
        await api.post('/api/hub/consulting/time-off', { day: monday, reason: 'Conference' }, t1);
        const slots2 = await api.get(`/api/hub/consulting/slots?serviceId=${s1.body.data.id}&days=10`, t1);
        check('a day off removes its slots', !(slots2.body?.data ?? []).some((x: any) => x.day === monday));
        const avail = await api.get('/api/hub/consulting/availability', t1);
        await api.del(`/api/hub/consulting/time-off/${avail.body.data.timeOff[0].id}`, t1);

        // ── appointments from the Hub ─────────────────────────────────────
        const cust = await api.post('/api/hub/customers', { name: 'QA Meera', phone: '9811122233' }, t1);
        const a1 = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: s1.body.data.id, startsAt: ist(monday, '10:00'), mode: 'online', meetingLink: 'https://meet.example/abc' }, t1);
        check('the partner books an appointment', a1.status === 201, a1.body?.message);
        const clash = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: s2.body.data.id, startsAt: ist(monday, '10:30') }, t1);
        check('an overlapping appointment is refused', clash.status === 409 && clash.body?.code === 'CLASH');
        const wrongMode = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: s2.body.data.id, startsAt: ist(monday, '15:00'), mode: 'onsite' }, t1);
        check('an online-only service cannot be booked on-site', wrongMode.status === 400 && wrongMode.body?.code === 'BAD_MODE');
        const a2 = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: s2.body.data.id, startsAt: ist(monday, '15:00') }, t1);
        const [a2row] = await db.select().from(consultAppointments).where(eq(consultAppointments.id, a2.body.data.id));
        check('an hourly service is priced by the time booked (1.5 h × ₹1,500)', a2row.pricePaise === 2250_00);
        const slots3 = await api.get(`/api/hub/consulting/slots?serviceId=${s1.body.data.id}&days=10`, t1);
        const m3 = (slots3.body?.data ?? []).filter((x: any) => x.day === monday).map((x: any) => x.time);
        check('booked time disappears from the free slots', !m3.includes('10:00') && m3.includes('11:00') && !m3.includes('15:00') && !m3.includes('16:00'), m3.join(' '));
        check('another partner cannot see the appointment', (await api.patch(`/api/hub/consulting/appointments/${a1.body.data.id}`, { privateNotes: 'x' }, t2)).status === 403);

        // ── bill ──────────────────────────────────────────────────────────
        const early = await api.post(`/api/hub/consulting/appointments/${a1.body.data.id}/bill`, {}, t1);
        check('a session is billed after it happens', early.status === 409);
        await api.patch(`/api/hub/consulting/appointments/${a1.body.data.id}`, { status: 'completed', clientNotes: 'File 80C proofs by Friday.', privateNotes: 'Prefers calls' }, t1);
        const bill = await api.post(`/api/hub/consulting/appointments/${a1.body.data.id}/bill`, {}, t1);
        const [inv] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, bill.body?.data?.id ?? 0));
        check('billing issues a tax invoice: ₹2,000 + 18% under SAC 998311', bill.status === 201 && inv?.taxablePaise === 2000_00 && inv.cgstPaise + inv.sgstPaise === 360_00, bill.body?.message);
        check('…and it is a normal invoice in Sales', (await api.get(`/api/hub/invoices/${inv.id}`, t1)).body?.data?.lines?.[0]?.hsnSac === '998311');
        check('the same session cannot be billed twice', (await api.post(`/api/hub/consulting/appointments/${a1.body.data.id}/bill`, {}, t1)).status === 409);
        await api.patch(`/api/hub/consulting/appointments/${a2.body.data.id}`, { status: 'completed' }, t1);
        const bill2 = await api.post(`/api/hub/consulting/appointments/${a2.body.data.id}/bill`, {}, t1);
        check('hourly bill: 1.5 hours at ₹1,500', bill2.status === 201 && bill2.body?.data?.taxable === 2250);

        // ── public booking ────────────────────────────────────────────────
        const pub = await api.get(`/api/public/consult/${bp.partnerCode}`);
        check('the public page lists bookable services (not retainers)', pub.status === 200 && pub.body?.data?.services?.length === 2 && !pub.body.data.services.some((s: any) => s.kind === 'retainer'));
        check('no public page for a partner without consulting', (await api.get(`/api/public/consult/${other.partnerCode}`)).status === 404);
        const wed = nextWeekday(3, 2);
        const ps = await api.get(`/api/public/consult/${bp.partnerCode}/slots?serviceId=${s1.body.data.id}`);
        const wedSlot = (ps.body?.data ?? []).find((x: any) => x.day === wed && x.time === '10:00');
        check('the public sees free slots', !!wedSlot);
        const notFree = await api.post(`/api/public/consult/${bp.partnerCode}/book`, { serviceId: s1.body.data.id, startsAt: ist(wed, '10:05'), name: 'QA Anil', phone: '9822233344' });
        check('a time that is not a free slot is refused', notFree.status === 409 && notFree.body?.code === 'TAKEN');
        const req1 = await api.post(`/api/public/consult/${bp.partnerCode}/book`, { serviceId: s1.body.data.id, startsAt: wedSlot.startsAt, name: 'QA Anil', phone: '9822233344', message: 'GST notice' });
        check('a client requests a slot without an account', req1.status === 201 && /\/book\/a\//.test(req1.body?.data?.link ?? ''));
        const [newCust] = await db.select().from(partnerCustomers).where(and(eq(partnerCustomers.businessPartnerId, bp.id), eq(partnerCustomers.phone, '9822233344')));
        check('…and becomes a customer of the partner', !!newCust && newCust.tags.includes('online booking'));
        const again = await api.post(`/api/public/consult/${bp.partnerCode}/book`, { serviceId: s1.body.data.id, startsAt: wedSlot.startsAt, name: 'QA Other', phone: '9833344455' });
        check('the same slot cannot be taken twice', again.status === 409);
        const token = req1.body.data.link.split('/').pop();
        const page = await api.get(`/api/public/consult/a/${token}`);
        check('the client\'s page shows it as requested, without the meeting link', page.status === 200 && page.body?.data?.status === 'requested' && page.body?.data?.meetingLink === null);
        const list = await api.get('/api/hub/consulting/appointments?status=requested', t1);
        const reqA = list.body?.data?.find((x: any) => x.clientLink.endsWith(token));
        check('the partner sees the request with the client\'s message', !!reqA && reqA.clientMessage === 'GST notice' && reqA.source === 'public');
        await api.patch(`/api/hub/consulting/appointments/${reqA.id}`, { status: 'confirmed', meetingLink: 'https://meet.example/xyz', clientNotes: 'Bring the notice.' }, t1);
        const page2 = await api.get(`/api/public/consult/a/${token}`);
        check('once confirmed the client sees the link and the notes', page2.body?.data?.status === 'confirmed' && page2.body?.data?.meetingLink === 'https://meet.example/xyz' && page2.body?.data?.notes === 'Bring the notice.');
        const cancel = await api.post(`/api/public/consult/a/${token}/cancel`, {});
        check('the client can cancel from their page', cancel.status === 200 && (await api.get(`/api/public/consult/a/${token}`)).body?.data?.status === 'cancelled');

        // ── retainers ─────────────────────────────────────────────────────
        const today = istDay(new Date());
        const ret = await api.post('/api/hub/consulting/retainers', { customerId: cust.body.data.id, serviceId: s3.body.data.id, billingDay: 1, startDate: `${today.slice(0, 7)}-01` }, t1);
        check('a monthly retainer is set up from the service', ret.status === 201, ret.body?.message);
        const issued = await PartnerConsultingService.runDueRetainers();
        const [r1] = await db.select().from(consultRetainers).where(eq(consultRetainers.id, ret.body.data.id));
        check('it invoices itself on its billing day', issued.length === 1 && r1.lastBilledPeriod === today.slice(0, 7));
        const [rInv] = await db.select().from(taxDocuments).where(eq(taxDocuments.number, issued[0]));
        check('…for ₹25,000 + GST under the service SAC', rInv?.taxablePaise === 25000_00 && rInv.cgstPaise + rInv.sgstPaise === 4500_00);
        check('running again the same month issues nothing', (await PartnerConsultingService.runDueRetainers()).length === 0);
        const manual = await api.post(`/api/hub/consulting/retainers/${ret.body.data.id}/bill`, {}, t1);
        check('billing the month by hand is refused once billed', manual.status === 409);
        // A retainer session: covered, not billed separately; counts against hours.
        const rs = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: s1.body.data.id, startsAt: ist(wed, '11:00'), retainerId: ret.body.data.id }, t1);
        await api.patch(`/api/hub/consulting/appointments/${rs.body.data.id}`, { status: 'completed' }, t1);
        const rsBill = await api.post(`/api/hub/consulting/appointments/${rs.body.data.id}/bill`, {}, t1);
        check('a session under a retainer is not billed separately', rsBill.status === 409 && rsBill.body?.code === 'RETAINER');
        await api.patch(`/api/hub/consulting/retainers/${ret.body.data.id}`, { status: 'paused' }, t1);
        const rl = await api.get('/api/hub/consulting/retainers', t1);
        check('paused retainers are listed with hours used this month', rl.body?.data?.[0]?.status === 'paused' && typeof rl.body?.data?.[0]?.hoursUsedThisMonth === 'number');

        // Plan limit on automated retainer invoices is reported, not hidden
        const ret2 = await api.post('/api/hub/consulting/retainers', { customerId: cust.body.data.id, title: 'Books', monthlyFeeRupees: 5000, billingDay: 1, startDate: `${today.slice(0, 7)}-01` }, t1);
        // The partner is on Starter (the default): 25 invoices a month.
        // fill the month to the Starter limit with direct invoices
        const used = (await api.get('/api/hub/sales/settings', t1)).body?.data?.invoicesThisMonth ?? 0;
        for (let i = used; i < 25; i++) await api.post('/api/hub/invoices', { customerId: cust.body.data.id, lines: [{ description: `QA ${i}`, hsnSac: '998311', quantity: 1, rateRupees: 1, gstRate: 18 }] }, t1);
        await PartnerConsultingService.runDueRetainers();
        const [r2] = await db.select().from(consultRetainers).where(eq(consultRetainers.id, ret2.body.data.id));
        check('a retainer over the Starter invoice limit is not billed, and says why', r2.lastBilledPeriod === null && /Starter plan/.test(r2.lastBillError ?? ''), r2.lastBillError ?? '');

        const home = await api.get('/api/hub/summary', t1);
        check('home shows booking requests and the consulting checklist', JSON.stringify(home.body?.data ?? {}).includes('Booking requests'));
    } finally {
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM consult_retainer_bills WHERE retainer_id IN (SELECT id FROM consult_retainers WHERE business_partner_id IN (${bpIds.join(',') || 0}))`,
            `DELETE FROM consult_appointments WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM consult_retainers WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM consult_services WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM consult_availability WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
            `DELETE FROM consult_time_off WHERE business_partner_id IN (${bpIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(async (e) => { console.error(e); await cleanupPartners(bpIds, adminIds); process.exit(1); });
