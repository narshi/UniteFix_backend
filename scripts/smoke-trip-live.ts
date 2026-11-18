/**
 * Trips on the road and after (Phases 2–3): Trip-mode locations from the
 * traveller and the driver's link, check-ins near planned places, the family
 * link, the Live trips board, the live alerts (no signal, off route, long
 * stop, night driving), 30-day pruning, ratings and scores, and payments to
 * partners with the margin.
 *
 *   npx tsx scripts/smoke-trip-live.ts
 */

process.env.PAYMENT_LINKS_MOCK = '1';

import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, travelTrips, travelPartners, integrationSettings, safetyIncidents, travelTripPings, travelTripTeam } from '../shared/schema';
import { TravelService } from '../server/services/travel.service';
import { TripLiveService } from '../server/services/trip-live.service';
import { istToday } from '../shared/travel';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], tripIds: number[] = [], empIds: number[] = [], partnerIds: number[] = [];
let saved: any = undefined;
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const at = (msAgo: number, now = Date.now()) => new Date(now - msAgo);
const caseCount = async (tripId: number, category: string) => (await db.select().from(safetyIncidents).where(eq(safetyIncidents.tripId, tripId))).filter(c => c.category === category).length;

async function main() {
    const [prev] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, 'travel')).limit(1); saved = prev ?? null;
    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const atok = await api.login(sa.username, sa.password);
        await api.put('/api/admin/travel/settings', { defaultManager: { adminId: sa.id, name: 'Kiran', phone: '9448850679' }, advancePercent: 20, quoteValidHours: 48, cancelCutoffDays: 2, safetyLead: null }, atok);
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Live Traveller', role: 'user' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const [eu] = await db.insert(users).values({ phone: phone(), username: 'QA Live Driver', role: 'serviceman' } as any).returning(); userIds.push(eu.id);
        const [emp] = await db.insert(employees).values({ userId: eu.id, fullName: 'QA Live Driver', documentVerificationStatus: 'verified', isActive: true } as any).returning(); empIds.push(emp.id);
        const cat = (await api.get('/api/travel/catalog')).body.data;
        const place = (x: string) => cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === x);
        const magod = place('Magod Falls'), sathodi = place('Sathodi Falls');
        const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi');
        const book = async () => {
            const s = await api.post('/api/travel/trips', { tripType: 'round_trip', pickupId: sirsi.id, placeIds: [magod.id, sathodi.id], regionIds: [], adults: 2, children: 0, members: [], startDate: istToday(), stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA Live Traveller', contactPhone: '9845012345' }, ct);
            const tid = s.body.data.id; tripIds.push(tid);
            await api.patch(`/api/admin/travel/trips/${tid}`, { quoteAmount: 10000 }, atok);
            await api.post(`/api/travel/trips/${tid}/advance`, {}, ct);
            const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tid));
            await TravelService.linkPaid({ payment_link: { entity: { id: t.paymentLinkId, notes: { travel_trip_id: String(tid) } } }, payment: { entity: { id: `pay_live_${stamp}_${tid}`, amount: 200000 } } });
            return tid;
        };
        const tid = await book();
        const p = await api.post('/api/admin/travel/partners', { name: `QA Live Cabs ${stamp}`, kinds: ['cab', 'stay'], phone: '9876500031' }, atok); partnerIds.push(p.body.data.id);
        const drv = await api.post(`/api/admin/travel/trips/${tid}/team`, { role: 'driver', day: 1, source: 'own', employeeId: emp.id, vehicle: 'Innova', plate: 'KA31M4821', time: '07:30' }, atok);
        const stay = await api.post(`/api/admin/travel/trips/${tid}/team`, { role: 'stay', day: 1, source: 'partner', partnerId: p.body.data.id, name: 'Live Homestay', phone: '9876500032', place: 'Yellapur' }, atok);
        const token = drv.body.data.driverLink.split('/').pop();

        // ── the driver accepts on the link ──
        const page1 = await (await fetch(`${srv.base}/api/travel/driver/${token}`)).text();
        const acc = await api.post(`/api/travel/driver/${token}/accept`, {});
        const page2 = await (await fetch(`${srv.base}/api/travel/driver/${token}`)).text();
        check('the driver can accept the trip on the link', /Accept the trip/.test(page1) && acc.status === 200 && /You accepted this trip/.test(page2));

        // ── nothing is tracked before the trip starts ──
        const early = await api.post(`/api/travel/trips/${tid}/ping`, { lat: sirsi.lat, lng: sirsi.lng }, ct);
        check('Trip mode sends nothing before the trip starts', early.body.data.tracking === false);
        const [t0] = await db.select().from(travelTrips).where(eq(travelTrips.id, tid));
        await api.post(`/api/travel/driver/${token}/start`, { code: t0.startCode });

        // ── traveller locations, check-ins ──
        const p1 = await api.post(`/api/travel/trips/${tid}/ping`, { lat: sirsi.lat, lng: sirsi.lng, accuracy: 20 }, ct);
        const p2 = await api.post(`/api/travel/trips/${tid}/ping`, { lat: magod.lat + 0.003, lng: magod.lng, accuracy: 20 }, ct);
        check('a location within 1 km of Magod Falls checks it off', p1.body.data.tracking && p2.body.data.checked.includes('Magod Falls') && p2.body.data.progress.done === 1 && p2.body.data.progress.next === 'Sathodi Falls');
        let mine = (await api.get('/api/travel/trips/mine', ct)).body.data.find((x: any) => x.id === tid);
        check('the traveller sees progress: 1 of 2 places, next Sathodi', mine.progress.done === 1 && mine.progress.total === 2 && mine.progress.next === 'Sathodi Falls' && !!mine.tracking.lastPingAt);

        // ── the driver shares from the link ──
        const dp = await api.post(`/api/travel/driver/${token}/ping`, { lat: magod.lat, lng: magod.lng + 0.01, speed: 10 });
        const [t1] = await db.select().from(travelTrips).where(eq(travelTrips.id, tid));
        check('the driver can share location from the link page', dp.body.data.tracking === true && t1.lastPingSource === 'driver');

        // ── the family link ──
        const fam = await api.post(`/api/travel/trips/${tid}/family-link`, {}, ct);
        const famPage = await (await fetch(`${srv.base}/api/travel/follow/${fam.body.data.url.split('/').pop()}`)).text();
        check('the family link shows progress, the last location and who they are with', /QA's trip|QA&#39;s trip|QA's/.test(famPage) && /1 of 2 places visited/.test(famPage) && /maps\.google\.com\/\?q=/.test(famPage) && /KA31M4821/.test(famPage));
        mine = (await api.get('/api/travel/trips/mine', ct)).body.data.find((x: any) => x.id === tid);
        check('…and the app has it to share again', mine.familyUrl === fam.body.data.url);

        // ── the Live trips board ──
        const board = (await api.get('/api/admin/travel/live', atok)).body.data;
        const row = board.find((b: any) => b.id === tid);
        check('Live trips shows the trip: last location, progress, driver accepted, family link', !!row && row.status === 'started' && row.last?.source === 'driver' && row.progress.done === 1 && row.drivers[0].accepted === true && !!row.familyUrl);

        // ── live alerts ──
        const now = Date.now();
        await db.delete(travelTripPings).where(eq(travelTripPings.tripId, tid));
        await db.insert(travelTripPings).values({ tripId: tid, source: 'traveller', lat: magod.lat, lng: magod.lng, at: at(25 * 60_000, now) });
        await TripLiveService.liveAlerts(now);
        await TripLiveService.liveAlerts(now);
        check('no location for 20 minutes after sharing: one "no signal" case, not repeated', (await caseCount(tid, 'no_signal')) === 1);

        await db.delete(travelTripPings).where(eq(travelTripPings.tripId, tid));
        await db.insert(travelTripPings).values({ tripId: tid, source: 'traveller', lat: 12.97, lng: 77.59, at: at(60_000, now) }); // Bengaluru
        await TripLiveService.liveAlerts(now);
        await TripLiveService.liveAlerts(now);
        check('far off the planned route: one "off route" case', (await caseCount(tid, 'off_route')) === 1);

        const noon = Date.parse(`${istToday()}T12:00:00+05:30`);
        await db.delete(travelTripPings).where(eq(travelTripPings.tripId, tid));
        const spot = { lat: (magod.lat + sathodi.lat) / 2 + 0.05, lng: (magod.lng + sathodi.lng) / 2 };  // on the way, not at a stop
        for (const m of [44, 30, 15, 5, 1]) await db.insert(travelTripPings).values({ tripId: tid, source: 'traveller', lat: spot.lat + m * 1e-6, lng: spot.lng, at: at(m * 60_000, noon) });
        await TripLiveService.liveAlerts(noon);
        check('45 minutes in one place away from any stop, in the daytime: a "long stop" case', (await caseCount(tid, 'long_stop')) === 1);

        const night = Date.parse(`${istToday()}T23:10:00+05:30`);
        await db.delete(travelTripPings).where(eq(travelTripPings.tripId, tid));
        await db.insert(travelTripPings).values([
            { tripId: tid, source: 'driver', lat: magod.lat, lng: magod.lng, speed: 12, at: at(12 * 60_000, night) },
            { tripId: tid, source: 'driver', lat: magod.lat + 0.05, lng: magod.lng, speed: 12, at: at(60_000, night) },
        ]);
        await TripLiveService.liveAlerts(night);
        await TripLiveService.liveAlerts(night);
        check('moving after 10 pm: one "night driving" case that night', (await caseCount(tid, 'night_driving')) === 1);

        // ── pruning: 30 days, kept with a safety case ──
        const other = await book();
        await db.insert(travelTripPings).values([
            { tripId: other, source: 'traveller', lat: 14.6, lng: 74.8, at: at(40 * 86_400_000) },
            { tripId: tid, source: 'traveller', lat: 14.6, lng: 74.8, at: at(40 * 86_400_000) },
        ]);
        await TripLiveService.prune();
        const left = await db.select().from(travelTripPings).where(inArray(travelTripPings.tripId, [tid, other]));
        check('locations older than 30 days go, except on a trip with a safety case', !left.some(l => l.tripId === other) && left.some(l => l.tripId === tid && Date.now() - l.at!.getTime() > 39 * 86_400_000));

        // ── after: ratings and scores ──
        const early2 = await api.post(`/api/travel/trips/${tid}/ratings`, { ratings: [{ teamMemberId: drv.body.data.id, stars: 5 }] }, ct);
        check('a trip can be rated only once it is finished', early2.status === 400);
        await api.post(`/api/travel/trips/${tid}/end`, {}, ct);
        mine = (await api.get('/api/travel/trips/mine', ct)).body.data.find((x: any) => x.id === tid);
        check('a finished trip asks for ratings', mine.canRate === true && mine.familyUrl === null);
        const rated = await api.post(`/api/travel/trips/${tid}/ratings`, { ratings: [
            { teamMemberId: drv.body.data.id, stars: 5, tags: ['Safe driving', 'On time', 'Not a real tag'] },
            { teamMemberId: stay.body.data.id, stars: 2, comment: 'Room was dirty' },
        ] }, ct);
        check('rating each person; a low one tells the traveller the manager will call', rated.status === 201 && /will call you/.test(rated.body.message) && (await caseCount(tid, 'low_rating')) === 1);
        const again = await api.post(`/api/travel/trips/${tid}/ratings`, { ratings: [{ teamMemberId: drv.body.data.id, stars: 1 }] }, ct);
        check('…and only once', again.status === 400);
        const partners = (await api.get('/api/admin/travel/partners', atok)).body.data;
        const experts = (await api.get('/api/admin/travel/experts', atok)).body.data;
        check('the partner\'s score shows the 2★ rating; our expert\'s shows 5★', partners.find((x: any) => x.id === p.body.data.id)?.score?.avg === 2 && experts.find((x: any) => x.id === emp.id)?.score?.avg === 5);
        const tags = (await db.execute(sql`SELECT tags FROM travel_ratings WHERE trip_id = ${tid} AND role = 'driver'`)).rows[0] as any;
        check('only known tags are kept', JSON.stringify(tags.tags) === JSON.stringify(['Safe driving', 'On time']));

        // ── money: payments to partners, balance, margin ──
        await api.post(`/api/admin/travel/trips/${tid}/payouts`, { partnerId: p.body.data.id, payee: `QA Live Cabs ${stamp}`, amount: 3000, method: 'upi', reference: 'UPI123' }, atok);
        const own = await api.post(`/api/admin/travel/trips/${tid}/payouts`, { payee: 'QA Live Driver', amount: 2500, method: 'cash' }, atok);
        await api.put(`/api/admin/travel/trips/${tid}/balance`, { amount: 8000, method: 'cash' }, atok);
        let tr = (await api.get('/api/admin/travel/trips?status=completed', atok)).body.data.trips.find((x: any) => x.id === tid);
        check('the trip shows price, collected, paid out and margin', tr.money.price === 10000 && tr.money.advance === 2000 && tr.money.collected === 10000 && tr.money.paidOut === 5500 && tr.money.margin === 4500 && tr.money.balanceDue === 0);
        await api.del(`/api/admin/travel/trips/${tid}/payouts/${own.body.data.id}`, atok);
        tr = (await api.get('/api/admin/travel/trips?status=completed', atok)).body.data.trips.find((x: any) => x.id === tid);
        check('removing a payment updates the margin', tr.money.paidOut === 3000 && tr.money.margin === 7000);
        const pp = (await api.get('/api/admin/travel/partners', atok)).body.data.find((x: any) => x.id === p.body.data.id);
        check('the partner shows what they have been paid', pp.paidTotal === 3000 && pp.paidTrips === 1);
        void travelTripTeam;
    } finally { await srv.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const ids = tripIds.filter(Boolean);
    if (ids.length) {
        await db.execute(sql.raw(`DELETE FROM safety_incidents WHERE trip_id IN (${ids.join(',')})`)).catch(e => console.error('cleanup incidents', e.message));
        await db.execute(sql.raw(`DELETE FROM travel_trip_payouts WHERE trip_id IN (${ids.join(',')})`)).catch(() => {});
        await db.delete(travelTrips).where(inArray(travelTrips.id, ids)).catch(e => console.error('cleanup trips', e.message));
    }
    if (partnerIds.length) await db.delete(travelPartners).where(inArray(travelPartners.id, partnerIds)).catch(e => console.error('cleanup partners', e.message));
    if (empIds.length) await db.delete(employees).where(inArray(employees.id, empIds)).catch(() => {});
    if (saved) await db.insert(integrationSettings).values(saved).onConflictDoUpdate({ target: integrationSettings.key, set: { config: saved.config } }).catch(() => {});
    else await db.delete(integrationSettings).where(eq(integrationSettings.key, 'travel')).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(() => {}); }
    if (adminIds.length) { await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',')})`)).catch(() => {}); await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',')})`)).catch(() => {}); }
    process.exit(summary());
});
