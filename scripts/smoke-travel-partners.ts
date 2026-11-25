/**
 * Travel partners in the Partner Hub, end to end: a Hub account takes over the
 * travel card staff already kept, a checked fleet (Cashfree licence and RC,
 * stubbed), a price asked and answered in the Hub, an assignment offered,
 * accepted and filled from the fleet (expired licence, too few seats and
 * unchecked vehicles refused), the traveller's phone never shown to the
 * partner, no double payment by hand, and the agreed pay on the partner's
 * statement when the trip ends — once.
 *
 *   npx tsx scripts/smoke-travel-partners.ts
 */

process.env.CASHFREE_ENVIRONMENT = 'TEST';
process.env.CASHFREE_VERIFICATION_CLIENT_ID = 'qa-verify-id';
process.env.CASHFREE_VERIFICATION_CLIENT_SECRET = 'qa-verify-secret';

import { eq, and, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { businessPartners, adminUsers, travelPartners, travelTrips, travelTripTeam, travelTripQuotes, businessPartnerLedger, hubAlerts, travelFleetDrivers, travelFleetVehicles } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { TravelPartnerHub } from '../server/services/travel-partner.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [], cardIds: number[] = [], tripIds: number[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ist = (d = 0) => new Date(Date.now() + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10);

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (!url.includes('cashfree.com/verification')) return realFetch(input, init);
    const path = url.split('/verification')[1], body = init?.body ? JSON.parse(init.body) : {};
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/driving-license') {
        const expired = body.dl_number.endsWith('0001');
        return json({ reference_id: 51, status: 'VALID', details_of_driving_licence: { name: 'QA DRIVER', date_of_expiry: expired ? '2023-12-31' : '2035-06-30' } });
    }
    if (path === '/vehicle-rc') {
        const lapsed = body.vehicle_number.endsWith('9999');
        return json({ reference_id: 52, status: 'VALID', owner: 'QA CABS', rc_expiry_date: '2034-01-01', vehicle_insurance_upto: lapsed ? '2024-03-01' : '2030-01-01', permit_valid_upto: '2030-01-01' });
    }
    return new Response('{}', { status: 404 });
}) as any;

async function hubPartner(label: string, verticals: string[], phone: string) {
    const bp = await BusinessPartnerService.create({ legalName: `QA ${label} ${stamp}`, displayName: `${label} ${stamp}`, contactPhone: phone, contactEmail: `qa-${label.toLowerCase().replace(/\W/g, '')}-${stamp}@example.test`, verticalCodes: verticals, approvedByAdminId: adminIds[0] });
    bpIds.push(bp.id);
    await db.update(businessPartners).set({ bankAccountNumber: `50100${phone.slice(-7)}`, bankIfsc: 'HDFC0001234', bankStatus: 'verified', beneficiaryName: bp.legalName }).where(eq(businessPartners.id, bp.id));
    const l = await PartnerHubService.createOwnerLogin(bp.id, {});
    const [u] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, l.username)); if (u) adminIds.push(u.id);
    return { bp, login: l };
}

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;
        const ph = `98${String(Date.now()).slice(-8)}`;
        // The card staff already keep for this operator, with the same phone.
        const [oldCard] = await db.insert(travelPartners).values({ name: `QA Sirsi Cabs (old card) ${stamp}`, phone: ph, kinds: ['cab'], regionIds: [] }).returning(); cardIds.push(oldCard.id);
        const { bp, login } = await hubPartner('Sirsi Cabs', ['travel'], ph);
        const pt = (await api.login(login.username, login.temporaryPassword))!;

        let r = await api.get('/api/hub/travel/profile', pt);
        check('the Hub account takes over the card staff kept for the same phone (history kept)', r.status === 200 && r.body?.data?.id === oldCard.id, JSON.stringify(r.body).slice(0, 200));
        const card = r.body.data.id;

        // ── Fleet, checked through Cashfree ──
        r = await api.post('/api/hub/travel/fleet/drivers', { name: 'Raghu', phone: '9845011111', dlNumber: 'KA31 20150012345', dob: '1988-04-12' }, pt);
        const good = r.body?.data;
        check('a driver added: licence checked through Cashfree, valid to 2035, number masked', r.status === 201 && good?.dlStatus === 'verified' && good.dlValidUntil === '2035-06-30' && /^•+\d{4}$/.test(good.dlNumber) && good.ready, JSON.stringify(good));
        r = await api.post('/api/hub/travel/fleet/drivers', { name: 'Old Licence', phone: '9845022222', dlNumber: 'KA3120100000001', dob: '1970-01-01' }, pt);
        const expired = r.body?.data;
        check('an expired licence is not accepted', expired?.dlStatus === 'failed' && !expired.ready && /Expired/.test(expired.dlCheckNote ?? ''));
        r = await api.post('/api/hub/travel/fleet/vehicles', { regNo: 'KA 31 AB 1234', model: 'Innova Crysta, white', seats: 6 }, pt);
        const innova = r.body?.data;
        check('a vehicle added: RC, insurance and permit read from the registry', innova?.rcStatus === 'verified' && innova.insuranceUpto === '2030-01-01' && innova.permitUpto === '2030-01-01' && innova.ready, JSON.stringify(innova));
        r = await api.post('/api/hub/travel/fleet/vehicles', { regNo: 'KA31AB9999', model: 'Swift Dzire', seats: 4 }, pt);
        const lapsed = r.body?.data;
        check('a vehicle with lapsed insurance goes to review, not ready', lapsed?.rcStatus === 'needs_review' && !lapsed.ready);
        r = await api.post('/api/hub/travel/fleet/vehicles', { regNo: 'KA31AB1234', model: 'again', seats: 6 }, pt);
        check('the same vehicle twice is refused', r.status === 409);

        // ── A trip, a price asked and answered in the Hub ──
        const [trip] = await db.insert(travelTrips).values({ code: `TR-QA${stamp.slice(-5).toUpperCase()}`, contactName: 'QA Traveller', contactPhone: '9000012345', adults: 4, children: 1, tripType: 'round_trip', startDate: ist(5), days: 3, pickupText: 'Sirsi', dropText: 'Sirsi', status: 'contacted', managerName: 'Kiran', managerPhone: '9448850679' } as any).returning(); tripIds.push(trip.id);
        r = await api.post(`/api/admin/travel/trips/${trip.id}/quotes`, { source: 'partner', partnerId: card, covers: 'Innova for 3 days, driver bata included' }, staff);
        check('staff ask the partner for a price', r.status === 201);
        await sleep(300);
        const alerts = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'travel_price_request')));
        check('…the partner is alerted in their Hub', alerts.length === 1);
        r = await api.get('/api/hub/travel/requests', pt);
        const req = r.body?.data?.[0];
        check('the request shows in the Hub with the trip: people, dates, route, manager', req?.open && req.trip.people === 5 && req.trip.days === 3 && req.trip.manager?.name === 'Kiran');
        check('…and never the traveller\'s phone', !JSON.stringify(r.body).includes('9000012345') && !JSON.stringify(r.body).includes('QA Traveller'));
        r = await api.post(`/api/hub/travel/requests/${req.id}`, { amount: 9000, note: 'Tolls extra' }, pt);
        const [q] = await db.select().from(travelTripQuotes).where(eq(travelTripQuotes.id, req.id));
        check('the partner sends ₹9,000 from the Hub; staff see it', r.status === 200 && q.status === 'quoted' && q.amount === 9000 && !!q.respondedAt);

        // ── Assignment offered, accepted, filled from the fleet ──
        r = await api.post(`/api/admin/travel/trips/${trip.id}/team`, { role: 'driver', source: 'partner', partnerId: card, partnerAmount: 9000 }, staff);
        const teamId = r.body?.data?.id;
        check('staff assign the cab to the Hub partner at ₹9,000 (no driver name needed yet)', r.status === 201 && r.body?.data?.partnerStatus === 'offered' && r.body.data.partnerAmount === 9000, JSON.stringify(r.body).slice(0, 200));
        const [plain] = await db.insert(travelPartners).values({ name: `QA No Hub ${stamp}`, phone: `97${String(Date.now()).slice(-8)}`, kinds: ['guide'], regionIds: [] }).returning(); cardIds.push(plain.id);
        r = await api.post(`/api/admin/travel/trips/${trip.id}/team`, { role: 'guide', source: 'partner', partnerId: plain.id }, staff);
        check('a partner without a Hub account still needs a name typed in', r.status === 400);
        await sleep(300);
        check('…the Hub partner is alerted (urgent)', (await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'travel_assignment')))).length === 1);
        r = await api.get('/api/hub/travel/assignments', pt);
        check('the assignment waits in the Hub with the pay', r.body?.data?.[0]?.status === 'offered' && r.body.data[0].pay === 9000);
        r = await api.post(`/api/hub/travel/assignments/${teamId}/fleet`, { driverId: expired.id, vehicleId: innova.id }, pt);
        check('a driver with an expired licence cannot be put on the trip', r.status === 409 && r.body?.code === 'NOT_READY');
        const [small] = await db.insert(travelFleetVehicles).values({ businessPartnerId: bp.id, regNo: `KA31QA${stamp.slice(-4).toUpperCase()}`, model: 'Alto', seats: 3, rcStatus: 'verified', rcValidUntil: '2033-01-01', insuranceUpto: '2030-01-01' }).returning();
        r = await api.post(`/api/hub/travel/assignments/${teamId}/fleet`, { driverId: good.id, vehicleId: small.id }, pt);
        check('a car with 3 seats cannot carry 5 people', r.status === 409 && /seats 3/.test(r.body?.message ?? ''));
        r = await api.post(`/api/hub/travel/assignments/${teamId}/fleet`, { driverId: good.id, vehicleId: lapsed.id }, pt);
        check('a vehicle under review cannot be used', r.status === 409);
        r = await api.post(`/api/hub/travel/assignments/${teamId}/fleet`, { driverId: good.id, vehicleId: innova.id, time: '07:30' }, pt);
        const [tm] = await db.select().from(travelTripTeam).where(eq(travelTripTeam.id, teamId));
        check('a checked driver and Innova go on the trip; accepted; the traveller sees them verified', r.status === 200 && tm.name === 'Raghu' && tm.plate === 'KA31AB1234' && tm.partnerStatus === 'accepted' && tm.time === '07:30' && (tm.docs as any).licence && (tm.docs as any).rc);
        const st = (await api.get('/api/admin/travel/trips?status=all', staff)).body?.data?.trips?.find((x: any) => x.id === trip.id)?.team?.find((m: any) => m.id === teamId);
        check('staff see "partner accepted", the driver and ₹9,000', st?.partnerStatus === 'accepted' && st.name === 'Raghu' && st.partnerAmount === 9000);

        // A second assignment the partner declines.
        r = await api.post(`/api/admin/travel/trips/${trip.id}/team`, { role: 'stay', source: 'partner', partnerId: card, partnerAmount: 4000, day: 1 }, staff);
        const stayId = r.body?.data?.id;
        r = await api.post(`/api/hub/travel/assignments/${stayId}/respond`, { accept: false }, pt);
        check('declining needs a reason', r.status === 400);
        r = await api.post(`/api/hub/travel/assignments/${stayId}/respond`, { accept: false, reason: 'Fully booked that night' }, pt);
        check('the partner declines the stay; staff are told', r.status === 200 && (await db.select().from(travelTripTeam).where(eq(travelTripTeam.id, stayId)))[0].partnerStatus === 'declined');

        // Another Hub partner sees none of it.
        const other = await hubPartner('Other Travels', ['travel'], `96${String(Date.now()).slice(-8)}`);
        const ot = (await api.login(other.login.username, other.login.temporaryPassword))!;
        r = await api.post(`/api/hub/travel/assignments/${teamId}/respond`, { accept: true }, ot);
        check('another partner cannot touch this assignment', r.status === 404 && (await api.get('/api/hub/travel/assignments', ot)).body?.data?.length === 0);
        r = await api.post(`/api/hub/travel/fleet/drivers/${good.id}/check`, {}, ot);
        check('…nor another partner\'s driver', r.status === 404);
        const food = await hubPartner('Not Travel', ['food'], `95${String(Date.now()).slice(-8)}`);
        r = await api.post(`/api/admin/travel/partners/${plain.id}/link`, { partnerCode: food.bp.partnerCode }, staff);
        check('linking a card to a partner who is not a travel partner is refused', r.status === 409);
        r = await api.get('/api/hub/travel/assignments', (await api.login(food.login.username, food.login.temporaryPassword))!);
        check('a partner without the Travel type has no travel pages', r.status === 403 || r.status === 404, `${r.status}`);

        // ── On the road and after: the link, no double payment, pay to the statement once ──
        await db.update(travelTrips).set({ status: 'confirmed', startDate: ist(0), startCode: '4321' }).where(eq(travelTrips.id, trip.id));
        r = await api.get('/api/hub/travel/assignments', pt);
        const link = r.body?.data?.find((x: any) => x.id === teamId)?.driverLink;
        check('once booked, the partner gets the driver\'s trip link to forward', typeof link === 'string' && link.includes('/api/travel/driver/'));
        r = await api.post(`/api/admin/travel/trips/${trip.id}/payouts`, { partnerId: card, payee: 'Sirsi Cabs', amount: 9000, method: 'upi' }, staff);
        check('staff cannot also pay this partner by hand (it would pay twice)', r.status === 409);
        await api.post(`/api/admin/travel/trips/${trip.id}/start`, {}, staff);
        r = await api.post(`/api/admin/travel/trips/${trip.id}/end`, {}, staff);
        for (let i = 0; i < 20 && !(await db.select().from(travelTripTeam).where(eq(travelTripTeam.id, teamId)))[0].earningPostedAt; i++) await sleep(150);
        const led = await db.select().from(businessPartnerLedger).where(and(eq(businessPartnerLedger.businessPartnerId, bp.id), eq(businessPartnerLedger.entryType, 'travel_job' as any)));
        check('trip ends: ₹9,000 on the partner\'s statement for the cab; nothing for the declined stay', r.status === 200 && led.length === 1 && led[0].amountPaise === -900000, JSON.stringify(led.map(l => l.amountPaise)));
        await TravelPartnerHub.postEarnings(trip.id);
        check('…posted once, however often it runs', (await db.select().from(businessPartnerLedger).where(and(eq(businessPartnerLedger.businessPartnerId, bp.id), eq(businessPartnerLedger.entryType, 'travel_job' as any)))).length === 1);
        r = await api.get('/api/hub/payouts', pt);
        check('the partner sees ₹9,000 owed in Money (paid on their payout schedule)', r.body?.data?.owed === 9000);
        r = await api.get('/api/hub/travel/assignments', pt);
        check('…and the finished trip "on your statement"', r.body?.data?.find((x: any) => x.id === teamId)?.paidToStatement === true);

        // ── Staff decide a vehicle by hand ──
        r = await api.post(`/api/admin/travel/fleet/vehicles/${lapsed.id}/review`, { status: 'failed', note: 'Insurance lapsed in March; asked for renewal' }, staff);
        check('staff reject a vehicle by hand, with a note', r.status === 200 && (await db.select().from(travelFleetVehicles).where(eq(travelFleetVehicles.id, lapsed.id)))[0].rcCheckMethod === 'manual');
        r = await api.get(`/api/admin/travel/partners/${card}/fleet`, staff);
        check('staff see the partner\'s fleet from the travel card', r.body?.data?.drivers?.length === 2 && r.body.data.vehicles.length === 3);
    } finally {
        globalThis.fetch = realFetch;
        const t = tripIds.length ? tripIds.join(',') : '0', c = cardIds.length ? cardIds.join(',') : '0', b = bpIds.length ? bpIds.join(',') : '0';
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM travel_trips WHERE id IN (${t})`,
            `DELETE FROM travel_partners WHERE id IN (${c}) OR business_partner_id IN (${b})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
