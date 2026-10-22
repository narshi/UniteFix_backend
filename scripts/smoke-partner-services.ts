/**
 * Field partners build their own service list (nothing pre-filled, all
 * removable), bookings reach a partner only for services on that list, and an
 * expert who already works with UniteFix can join a partner — with their say-so.
 *
 *   npm run smoke:partner-services
 */

import { eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, services, serviceCategories, partnerTerritories, partnerServices, partnerServiceRates, serviceRequests } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { PartnerFieldService } from '../server/services/partner-field.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [], userIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
const PIN = '581399';
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;

        // A UniteFix catalogue with plumbing and electrical services.
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Plumbing ${stamp}` } as any).returning(); catIds.push(cat.id);
        const [tap] = await db.insert(services).values({ categoryId: cat.id, name: `QA Tap repair ${stamp}`, basePrice: 400, isActive: true } as any).returning();
        const [fan] = await db.insert(services).values({ categoryId: cat.id, name: `QA Fan installation ${stamp}`, basePrice: 300, isActive: true } as any).returning();
        const [laptop] = await db.insert(services).values({ categoryId: cat.id, name: `QA Laptop repair ${stamp}`, basePrice: 900, isActive: true } as any).returning();
        svcIds.push(tap.id, fan.id, laptop.id);

        // A Plumbing & Electrical partner, created by staff.
        const c = await api.post('/api/admin/business-partners', { legalName: `QA Pipes & Power ${stamp}`, contactPhone: phone(), contactEmail: `qa_pp_${stamp}@example.test`, verticalCodes: ['plumbing', 'electrical'] }, S);
        check('staff can create a Plumbing & Electrical partner', c.status === 201, JSON.stringify(c.body).slice(0, 200));
        const bpId = c.body.data.id; bpIds.push(bpId);
        const ol = await PartnerHubService.createOwnerLogin(bpId, {});
        const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
        const T = (await api.login(ol.username, ol.temporaryPassword))!;
        const me = await api.get('/api/hub/me', T);
        check('…their Hub has Field service (and Parts)', me.body?.data?.modules?.includes('field') && me.body.data.modules.includes('parts'), JSON.stringify(me.body?.data?.modules));

        // Services: empty to start, built by the partner.
        const s0 = await api.get('/api/hub/field/services', T);
        check('a new partner starts with no services — nothing pre-filled', s0.status === 200 && s0.body.data.services.length === 0);
        const r0 = await api.get('/api/hub/field/rates', T);
        check('…and the rates list is no longer the whole UniteFix catalogue', r0.status === 200 && r0.body.data.services.length === 0);
        const choices = await api.get(`/api/hub/field/services/catalogue?q=${encodeURIComponent('QA Tap repair ' + stamp)}`, T);
        check('they can search the UniteFix catalogue to pick from', (choices.body?.data ?? []).some((x: any) => x.catalogServiceId === tap.id && x.nationalPrice === 400));
        const addTap = await api.post('/api/hub/field/services', { catalogServiceId: tap.id }, T);
        const addFan = await api.post('/api/hub/field/services', { catalogServiceId: fan.id, price: 330 }, T);
        check('…add UniteFix services (one at their own price within the band)', addTap.status === 201 && addFan.status === 201, JSON.stringify(addFan.body).slice(0, 200));
        check('…adding the same one twice is refused', (await api.post('/api/hub/field/services', { catalogServiceId: tap.id }, T)).status === 409);
        const outOfBand = await api.post('/api/hub/field/services', { catalogServiceId: laptop.id, price: 5000 }, T);
        check('…a price far outside the band is refused, and the service is not left half-added', outOfBand.status === 400 && !(await db.select().from(partnerServices).where(eq(partnerServices.catalogServiceId, laptop.id))).length);
        const own = await api.post('/api/hub/field/services', { name: 'Overhead tank cleaning', category: 'Plumbing', price: 1200, unit: 'tank', description: 'Up to 1000 L' }, T);
        check('…and add their own service with their own price', own.status === 201 && own.body.data.pricePaise === 120000 && own.body.data.catalogServiceId === null);
        check('…their own service names are unique (any case)', (await api.post('/api/hub/field/services', { name: 'overhead TANK cleaning' }, T)).status === 409);
        check('…and need a name', (await api.post('/api/hub/field/services', { name: ' ' }, T)).status === 400);
        const list = await api.get('/api/hub/field/services', T);
        const byName = (x: string) => list.body.data.services.find((s: any) => s.name === x);
        check('the list shows all three, with the rate for UniteFix ones', list.body.data.services.length === 3 && byName(tap.name)?.kind === 'catalogue' && byName(tap.name)?.rate?.nationalPrice === 400 && byName('Overhead tank cleaning')?.price === 1200);
        const editOwn = await api.patch(`/api/hub/field/services/${own.body.data.id}`, { price: 1500, unit: 'tank up to 1000 L' }, T);
        check('…their own service can be repriced', editOwn.status === 200 && editOwn.body.data.pricePaise === 150000);

        // No automatic routing: even a service they offer, in a pincode they cover, waits for staff.
        await db.insert(partnerTerritories).values({ businessPartnerId: bpId, pincode: PIN, mode: 'exclusive', status: 'active', activatedAt: new Date() } as any);
        const toTap = await PartnerFieldService.route({ catalogServiceId: tap.id, pincode: PIN });
        check('a booking is never sent to a partner automatically, even for a service and pincode they cover', toTap.dispatchPartnerId === null);
        const q = await PartnerFieldService.quote(tap.id, PIN);
        check('the app quote shows UniteFix’s price and names no partner', q?.servicedBy === null && q?.unitPrice === 400);
        const st = await api.put('/api/hub/field/settings', { autoAssign: true, autoAssignMinutes: 0 }, T);
        const [bpRow] = await db.execute(sql`SELECT field_auto_assign FROM business_partners WHERE id = ${bpId}`).then((r: any) => r.rows);
        check('a partner cannot switch on auto-assign (an older client sending it is ignored)', st.status === 200 && bpRow.field_auto_assign === false);

        const del = await api.del(`/api/hub/field/services/${byName(tap.name).id}`, T);
        check('removing a UniteFix service: gone from the list', del.status === 200 && (await api.get('/api/hub/field/services', T)).body.data.services.length === 2);
        await api.post('/api/hub/field/services', { catalogServiceId: tap.id }, T);
        const fanRates = await db.select().from(partnerServiceRates).where(eq(partnerServiceRates.catalogServiceId, fan.id));
        await api.del(`/api/hub/field/services/${byName(fan.name).id}`, T);
        const fanRates2 = await db.select().from(partnerServiceRates).where(eq(partnerServiceRates.catalogServiceId, fan.id));
        check('…and a pending price for a removed service is withdrawn', fanRates.length > 0 && fanRates2.every(r => r.status === 'retired'));
        check('a price can be set only for a service on their list', (await api.put(`/api/hub/field/rates/${laptop.id}`, { price: 900 }, T)).status === 409);

        // Technicians: an expert already with UniteFix joins with a code.
        const expertPhone = `9${String(Date.now()).slice(-9)}`;
        const [eu] = await db.insert(users).values({ phone: expertPhone, username: 'QA Existing Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(eu.id);
        const [expert] = await db.insert(employees).values({ userId: eu.id, fullName: 'QA Existing Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning();
        const tryAdd = await api.post('/api/hub/field/technicians', { fullName: 'QA Existing Expert', phone: expertPhone }, T);
        check('adding an existing UniteFix expert: told they can join with a code (not refused outright)', tryAdd.status === 409 && tryAdd.body?.code === 'EXISTING_EXPERT', JSON.stringify(tryAdd.body));
        const inv = await api.post('/api/hub/field/technicians/invite', { phone: expertPhone }, T);
        check('…a joining code is sent', inv.status === 201 && inv.body?.data?.inviteId, JSON.stringify(inv.body));
        const note = (await db.execute(sql`SELECT body FROM notifications WHERE user_id = ${eu.id} AND type = 'partner_join_code' ORDER BY id DESC LIMIT 1`) as any).rows?.[0]?.body ?? '';
        const code = (note.match(/Joining code: (\d{6})/) ?? [])[1];
        check('…to the expert’s app, saying what joining means', !!code && /stops sending you its own jobs/.test(note) && /wallet stays yours/.test(note), note.slice(0, 160));
        const wrong = await api.post(`/api/hub/field/technicians/invite/${inv.body.data.inviteId}/confirm`, { code: code === '000000' ? '111111' : '000000' }, T);
        check('a wrong code is refused, with tries left', wrong.status === 400 && /tries left/.test(wrong.body?.message ?? ''));
        check('…and they are not linked yet', (await db.select().from(employees).where(eq(employees.id, expert.id)))[0].managedByPartnerId === null);
        const ok = await api.post(`/api/hub/field/technicians/invite/${inv.body.data.inviteId}/confirm`, { code }, T);
        const [linked] = await db.select().from(employees).where(eq(employees.id, expert.id));
        check('the right code: the expert becomes their technician', ok.status === 200 && linked.managedByPartnerId === bpId, JSON.stringify(ok.body));
        check('…and shows in their technicians', ((await api.get('/api/hub/field/technicians', T)).body?.data ?? []).some((t: any) => t.id === expert.id));
        check('…the code cannot be used again', (await api.post(`/api/hub/field/technicians/invite/${inv.body.data.inviteId}/confirm`, { code }, T)).status === 410);
        check('…and inviting them again says they are already yours', (await api.post('/api/hub/field/technicians/invite', { phone: expertPhone }, T)).status === 409);

        // Another partner cannot take them; a busy expert waits; a customer number is not an expert.
        const c2 = await BusinessPartnerService.create({ legalName: `QA Other Field ${stamp}`, contactPhone: phone(), contactEmail: `qa_pp2_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(c2.id);
        const ol2 = await PartnerHubService.createOwnerLogin(c2.id, {});
        const [owner2] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol2.username)); adminIds.push(owner2.id);
        const T2 = (await api.login(ol2.username, ol2.temporaryPassword))!;
        const taken = await api.post('/api/hub/field/technicians/invite', { phone: expertPhone }, T2);
        check('another partner cannot invite an expert who already works for a partner', taken.status === 409 && /another UniteFix partner/.test(taken.body?.message ?? ''));
        const busyPhone = `8${String(Date.now()).slice(-9)}`;
        const [bu] = await db.insert(users).values({ phone: busyPhone, username: 'QA Busy Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(bu.id);
        const [busy] = await db.insert(employees).values({ userId: bu.id, fullName: 'QA Busy Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning();
        const [cust] = await db.insert(users).values({ phone: `7${String(Date.now()).slice(-9)}`, username: 'QA Customer', role: 'user', isActive: true } as any).returning(); userIds.push(cust.id);
        await db.insert(serviceRequests).values({ userId: cust.id, serviceId: `QA-SR-${stamp}`, serviceType: 'repair', brand: 'x', model: 'x', description: 'QA', address: 'x', pincode: PIN, status: 'in_progress', providerId: busy.id } as any);
        const busyInv = await api.post('/api/hub/field/technicians/invite', { phone: busyPhone }, T2);
        check('an expert in the middle of a UniteFix job cannot join until it is done', busyInv.status === 409 && /in progress/.test(busyInv.body?.message ?? ''), JSON.stringify(busyInv.body));
        const custAdd = await api.post('/api/hub/field/technicians', { fullName: 'QA Customer', phone: cust.phone }, T2);
        check('a customer account number is refused with why', custAdd.status === 409 && custAdd.body?.code === 'PHONE_TAKEN' && /customer account/.test(custAdd.body?.message ?? ''));

        // Staff assign every booking: to a partner (who picks the technician) or to a UniteFix expert.
        const booking = async (n: number, extra: Record<string, unknown> = {}) => (await db.insert(serviceRequests).values({
            userId: cust.id, serviceId: `QA-SR-${stamp}-${n}`, serviceType: 'Tap repair', brand: 'x', model: 'x', description: 'QA', address: `Road ${PIN}`, pincode: PIN,
            status: 'created', bookingFeeStatus: 'paid', catalogServiceId: tap.id, pricingSnapshot: { grossTotal: 400, technicianEarning: 300 }, ...extra,
        } as any).returning())[0];
        const b1 = await booking(1);
        const queue = await api.get('/api/admin/assignment-queue', S);
        const qp = (queue.body?.partners ?? []).find((p: any) => p.id === bpId);
        check('the Assignment Queue lists the booking and the partners staff can send it to', (queue.body?.queue ?? []).some((x: any) => x.id === b1.id) && qp?.pincodes.includes(PIN) && qp?.catalogServiceIds.includes(tap.id) && qp?.technicians === 1, JSON.stringify(qp ?? queue.body).slice(0, 200));
        check('…a partner with no verified technician is not offered', !(queue.body?.partners ?? []).some((p: any) => p.id === c2.id));
        const notReady = await api.post(`/api/admin/services/${b1.id}/assign-partner`, { businessPartnerId: c2.id }, S);
        check('…and sending a job to them is refused with why', notReady.status === 409 && /verified technician/.test(notReady.body?.error ?? ''), JSON.stringify(notReady.body));
        const sent = await api.post(`/api/admin/services/${b1.id}/assign-partner`, { businessPartnerId: bpId }, S);
        const [b1r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b1.id));
        check('staff send it to the partner: it carries their name and an assign-by time', sent.status === 200 && b1r.dispatchPartnerId === bpId && b1r.dispatchMode === 'staff' && !!b1r.slaAssignBy && (b1r.pricingSnapshot as any)?.payeePartnerId === bpId, JSON.stringify(sent.body).slice(0, 200));
        check('…it leaves the Assignment Queue', !((await api.get('/api/admin/assignment-queue', S)).body?.queue ?? []).some((x: any) => x.id === b1.id));
        const jobs = await api.get('/api/hub/field/jobs', T);
        check('…and is on the partner’s Jobs page', (jobs.body?.data ?? []).some((j: any) => j.id === b1.id), JSON.stringify(jobs.body).slice(0, 200));
        const pick = await api.post(`/api/hub/field/jobs/${b1.id}/assign`, { employeeId: expert.id }, T);
        check('…where the partner assigns their technician', pick.status === 200 && (await db.select().from(serviceRequests).where(eq(serviceRequests.id, b1.id)))[0].providerId === expert.id, JSON.stringify(pick.body));
        check('…and once a technician is on it, staff cannot just take it back', (await api.post(`/api/admin/services/${b1.id}/recall-partner`, {}, S)).status === 409);

        const b2 = await booking(2);
        await api.post(`/api/admin/services/${b2.id}/assign-partner`, { businessPartnerId: bpId }, S);
        const back = await api.post(`/api/admin/services/${b2.id}/recall-partner`, {}, S);
        const [b2r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b2.id));
        check('staff can take a job back before a technician is on it: back in the queue, no partner on it', back.status === 200 && b2r.dispatchPartnerId === null && !(b2r.pricingSnapshot as any)?.payeePartnerId && ((await api.get('/api/admin/assignment-queue', S)).body?.queue ?? []).some((x: any) => x.id === b2.id));

        const b3 = await booking(3);
        await api.post(`/api/admin/services/${b3.id}/assign-partner`, { businessPartnerId: bpId }, S);
        await db.update(serviceRequests).set({ slaAssignBy: new Date(Date.now() - 60_000) } as any).where(eq(serviceRequests.id, b3.id));
        await PartnerFieldService.escalateOverdue();
        const q3 = ((await api.get('/api/admin/assignment-queue', S)).body?.queue ?? []).find((x: any) => x.id === b3.id);
        check('a job the partner did not assign in time comes back to the queue, marked with their name', q3?.escalatedFromPartnerName === c.body.data.displayName, JSON.stringify(q3 ?? null).slice(0, 200));
        const [ufU] = await db.insert(users).values({ phone: `5${String(Date.now()).slice(-9)}`, username: 'QA UF Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(ufU.id);
        const [uf] = await db.insert(employees).values({ userId: ufU.id, fullName: 'QA UF Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning();
        const toUf = await api.post(`/api/admin/services/${b3.id}/assign`, { technicianId: uf.id }, S);
        const [b3r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b3.id));
        check('…given to a UniteFix expert instead, it is no longer the partner’s', toUf.status === 200 && b3r.providerId === uf.id && b3r.dispatchPartnerId === null && !(b3r.pricingSnapshot as any)?.payeePartnerId, JSON.stringify(toUf.body).slice(0, 160));
        check('…and is off the partner’s Jobs page', !((await api.get('/api/hub/field/jobs', T)).body?.data ?? []).some((j: any) => j.id === b3.id));

        // Reassign to a partner.
        const b5 = await booking(5);
        await api.post(`/api/admin/services/${b5.id}/assign`, { technicianId: uf.id }, S);
        const opts = await api.get(`/api/admin/services/${b5.id}/partner-options`, S);
        const mine = (opts.body?.data ?? []).find((p: any) => p.id === bpId);
        check('the partner options for a booking say who covers its pincode and lists its service', opts.status === 200 && mine?.covers === true && mine?.offers === true && opts.body.pincode === PIN, JSON.stringify(opts.body).slice(0, 200));
        const re = await api.post(`/api/admin/services/${b5.id}/assign-partner`, { businessPartnerId: bpId }, S);
        const [b5r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b5.id));
        check('a job assigned to a UniteFix expert can be reassigned to a partner: the expert is taken off it', re.status === 200 && b5r.providerId === null && b5r.status === 'created' && b5r.dispatchPartnerId === bpId, JSON.stringify(re.body).slice(0, 200));
        const revoked = (await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${ufU.id}`) as any).rows[0].n;
        check('…and the expert is told', revoked >= 2, String(revoked));
        await api.post(`/api/hub/field/jobs/${b5.id}/assign`, { employeeId: expert.id }, T);
        const same = await api.post(`/api/admin/services/${b5.id}/assign-partner`, { businessPartnerId: bpId }, S);
        check('…"reassigning" it to the partner whose technician already has it is refused with why', same.status === 409 && /already with this partner/.test(same.body?.error ?? ''));
        await db.update(serviceRequests).set({ status: 'in_progress' as any }).where(eq(serviceRequests.id, b5.id));
        check('…and once work has started it cannot be moved', (await api.post(`/api/admin/services/${b5.id}/assign-partner`, { businessPartnerId: bpId }, S)).status === 409);
        const svcList = await api.get(`/api/admin/services?q=${encodeURIComponent(`QA-SR-${stamp}-5`)}`, S);
        const row = (svcList.body?.data ?? svcList.body?.services ?? []).find((x: any) => x.id === b5.id);
        check('Service Requests shows which partner has a job', row?.partnerName === c.body.data.displayName && row?.dispatchPartnerId === bpId, JSON.stringify(row ?? svcList.body).slice(0, 200));

        const b4 = await booking(4, { bookingFeeStatus: 'pending' });
        check('an unpaid booking cannot be sent to a partner', (await api.post(`/api/admin/services/${b4.id}/assign-partner`, { businessPartnerId: bpId }, S)).status === 409);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    const extra = [
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (SELECT id FROM service_requests WHERE service_id LIKE 'QA-SR-${stamp}%')`,
        `DELETE FROM service_requests WHERE service_id LIKE 'QA-SR-${stamp}%'`,
        `DELETE FROM partner_technician_invites WHERE business_partner_id IN (${bps})`,
        `DELETE FROM partner_services WHERE business_partner_id IN (${bps})`,
        `DELETE FROM partner_service_rates WHERE business_partner_id IN (${bps})`,
        `DELETE FROM partner_territories WHERE business_partner_id IN (${bps})`,
        `DELETE FROM audit_logs WHERE (entity_type = 'business_partner' AND entity_id IN (${bps})) OR (entity_type = 'employee' AND entity_id IN (SELECT id FROM employees WHERE user_id IN (${uids})))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`,
    ];
    await cleanupPartners(bpIds, adminIds, extra);
    process.exit(summary());
});
