/**
 * Travel planner end to end: the catalogue the app shows, the optimised
 * one-way and round-trip plans, sending a trip for a quotation, staff
 * assigning a travel manager and quoting, the customer seeing each step,
 * and staff managing places.
 *
 *   npx tsx scripts/smoke-travel.ts
 */

import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, travelTrips, travelPlaces, travelRegions, travelPickups } from '../shared/schema';
import { orderPlaces, roadKm } from '../shared/travel';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], tripIds: number[] = [];
const extra = { regions: [] as number[], places: [] as number[], pickups: [] as number[] };

async function main() {
    // The optimiser on its own: four points on a line, given shuffled.
    const line = [3, 1, 4, 2].map(i => ({ id: i, lat: 14 + i * 0.1, lng: 74.5 }));
    check('the optimiser visits places in the shortest order', orderPlaces(line, { lat: 14, lng: 74.5 }, null).map(p => p.id).join() === '1,2,3,4');
    check('…and with a fixed end it heads towards it', orderPlaces(line, { lat: 14.25, lng: 74.5 }, { lat: 14.5, lng: 74.5 }).map(p => p.id).join() === '2,1,3,4' || orderPlaces(line, { lat: 14.25, lng: 74.5 }, { lat: 14.5, lng: 74.5 }).map(p => p.id).join() === '1,2,3,4');

    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const cat = (await api.get('/api/travel/catalog')).body?.data;
        const regionNames = (cat?.regions ?? []).map((r: any) => r.name);
        check('the app gets the starting regions', ['Murdeshwar to Gokarna', 'Sirsi', 'Yellapur', 'Mundgod', 'Dandeli'].every(n => regionNames.includes(n)), regionNames.join(', '));
        check('…with places and pickup points', cat.regions.every((r: any) => r.places.length > 0) && cat.pickups.length >= 10);
        const pid = (name: string) => cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === name)?.id;
        const pick = (name: string) => cat.pickups.find((p: any) => p.name === name)?.id;
        const sirsi = pick('Sirsi'), goa = pick('Goa airport (Dabolim)');
        const places = ['Om Beach', 'Marikamba Temple', 'Murudeshwar Temple & Shiva statue', 'Magod Falls', 'Gokarna Mahabaleshwar Temple'].map(pid);
        check('the places named exist', places.every(Boolean));
        const sirsiRegion = cat.regions.find((r: any) => r.name === 'Sirsi')?.id;

        const round = (await api.post('/api/travel/plan', { tripType: 'round_trip', pace: 'balanced', pickupId: sirsi, placeIds: places })).body?.data;
        check('a round trip from Sirsi is planned', round?.days?.length >= 2 && round.order.length === 5, JSON.stringify(round?.days?.map((d: any) => d.stops.map((s: any) => s.name))));
        check('…starting and ending at Sirsi', round.days[0].stops[0].name === 'Sirsi' && round.days.at(-1).stops.at(-1).name === 'Sirsi');
        check('…keeping Om Beach next to the Gokarna temple', Math.abs(round.order.indexOf(pid('Om Beach')) - round.order.indexOf(pid('Gokarna Mahabaleshwar Temple'))) === 1);
        check('…with nights to stay where a day ends', round.nights === round.days.length - 1 && round.days.slice(0, -1).every((d: any) => !!d.stayNear));
        check('…and best picks nearby that are not chosen yet', Array.isArray(round.suggestions) && round.suggestions.every((s: any) => !round.order.includes(s.id)));

        const oneWay = (await api.post('/api/travel/plan', { tripType: 'one_way', pace: 'balanced', pickupId: sirsi, dropId: goa, placeIds: places })).body?.data;
        check('a one-way trip Sirsi → Goa airport ends at the airport', oneWay?.days.at(-1).stops.at(-1).name === 'Goa airport (Dabolim)');
        const relaxed = (await api.post('/api/travel/plan', { tripType: 'round_trip', pace: 'relaxed', pickupId: sirsi, placeIds: places })).body?.data;
        const packed = (await api.post('/api/travel/plan', { tripType: 'round_trip', pace: 'packed', pickupId: sirsi, placeIds: places })).body?.data;
        check('a relaxed pace takes at least as many days as a packed one', relaxed.days.length >= packed.days.length && relaxed.days.length > 1);
        const typed = (await api.post('/api/travel/plan', { tripType: 'round_trip', pickupText: 'My home in Siddapur', placeIds: places })).body?.data;
        check('a typed pickup (no map position) still plans, from the first place', typed?.startUnknown === true && typed.days[0].stops[0].name === 'My home in Siddapur');
        const noEnd = await api.post('/api/travel/plan', { tripType: 'one_way', pickupId: sirsi, placeIds: places });
        check('a one-way plan without an end is refused with a reason', noEnd.status === 400 && /ends/.test(noEnd.body?.message));

        // ── the customer sends it ──
        const [cu] = await db.insert(users).values({ phone: `6${Date.now().toString().slice(-9)}`, username: 'QA Traveller', role: 'user' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const future = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
        const body = {
            tripType: 'round_trip', pace: 'balanced', pickupId: sirsi, placeIds: places, regionIds: [sirsiRegion],
            adults: 4, children: 2, members: [{ name: 'Asha', phone: '9876543210' }, { name: 'Ravi' }],
            startDate: future, stay: 'standard', rooms: 2, needsCab: true, needsGuide: true, budgetPerPerson: 6000,
            notes: 'Vegetarian food please', contactName: 'QA Traveller', contactPhone: '98450 12345',
        };
        const anon = await api.post('/api/travel/trips', body);
        check('sending a trip needs sign-in', anon.status === 401 || anon.status === 403);
        const sent = await api.post('/api/travel/trips', body, ct);
        check('the customer sends the trip for a quotation', sent.status === 201 && /^TR-[A-Z0-9]{6}$/.test(sent.body?.data?.code), JSON.stringify(sent.body).slice(0, 200));
        check('…and is told a travel manager will be assigned and will call', /travel manager will be assigned and will call you soon/.test(sent.body?.message ?? ''));
        const tripId = sent.body?.data?.id; tripIds.push(tripId);
        const past = await api.post('/api/travel/trips', { ...body, startDate: '2020-01-01' }, ct);
        check('a start date in the past is refused', past.status === 400 && /passed/.test(past.body?.message));
        let mine = (await api.get('/api/travel/trips/mine', ct)).body?.data?.[0];
        check('"My trips" shows it waiting for a manager, with the plan', mine?.status === 'new' && mine.places.length === 5 && mine.members.length === 2 && mine.days >= 2);

        // ── staff ──
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const at = await api.login(sa.username, sa.password);
        const list = (await api.get('/api/admin/travel/trips?status=new', at)).body?.data;
        const row = list?.trips?.find((t: any) => t.id === tripId);
        check('staff see the new trip with people, members and the suggested cab', !!row && row.people === 6 && row.members.length === 2 && /Innova|7 seats/.test(row.vehicle));
        const managers = (await api.get('/api/admin/travel/managers', at)).body?.data ?? [];
        check('a super admin can take trips', managers.some((m: any) => m.id === sa.id));
        const quoteEarly = await api.patch(`/api/admin/travel/trips/${tripId}`, { quoteAmount: 42000 }, at);
        check('a quotation before a manager is assigned is refused', quoteEarly.status === 400 && /Assign a travel manager/.test(quoteEarly.body?.message));
        const asg = await api.post(`/api/admin/travel/trips/${tripId}/assign`, { managerAdminId: sa.id, managerName: 'Kiran', managerPhone: '9448850679' }, at);
        check('staff assign a travel manager', asg.status === 200, JSON.stringify(asg.body));
        mine = (await api.get('/api/travel/trips/mine', ct)).body?.data?.[0];
        check('…and the customer sees who will call', mine?.status === 'assigned' && mine.manager?.name === 'Kiran' && mine.manager.phone === '9448850679');
        await api.patch(`/api/admin/travel/trips/${tripId}`, { quoteAmount: 42000, quoteNote: 'Cab, 2 rooms x 2 nights, guide' }, at);
        mine = (await api.get('/api/travel/trips/mine', ct)).body?.data?.[0];
        check('a quotation moves it to "Quotation sent" and the customer sees the amount', mine?.status === 'quoted' && mine.quote?.amount === 42000);
        const [notice] = (await db.execute(sql`SELECT title FROM notifications WHERE user_id = ${cu.id} ORDER BY id DESC LIMIT 2`)).rows as any[];
        check('…with a notification', /quotation/i.test(notice?.title ?? ''), notice?.title);
        const cancel = await api.post(`/api/travel/trips/${tripId}/cancel`, {}, ct);
        check('the customer can still cancel an open trip', cancel.status === 200 && (await api.get('/api/travel/trips/mine', ct)).body?.data?.[0]?.status === 'cancelled');

        // ── staff manage places ──
        const reg = await api.post('/api/admin/travel/regions', { name: `QA Region ${stamp}`, tagline: 'Test', bestMonths: [11] }, at);
        extra.regions.push(reg.body?.data?.id);
        const pl = await api.post('/api/admin/travel/places', { regionId: reg.body?.data?.id, name: `QA Viewpoint ${stamp}`, kind: 'viewpoint', lat: 14.6, lng: 74.8, visitMinutes: 45, featured: true }, at);
        extra.places.push(pl.body?.data?.id);
        const cat2 = (await api.get('/api/travel/catalog')).body?.data;
        check('a region and place staff add appear in the app', cat2.regions.some((r: any) => r.name === `QA Region ${stamp}` && r.places.some((p: any) => p.name === `QA Viewpoint ${stamp}`)));
        await api.patch(`/api/admin/travel/places/${pl.body?.data?.id}`, { isActive: false }, at);
        const cat3 = (await api.get('/api/travel/catalog')).body?.data;
        check('…hiding the place hides it (and its now-empty region)', !cat3.regions.some((r: any) => r.name === `QA Region ${stamp}`));
        const delReg = await api.del(`/api/admin/travel/regions/${reg.body?.data?.id}`, at);
        check('a region with places cannot be deleted', delReg.status === 400);
        const badPlace = await api.post('/api/admin/travel/places', { regionId: null, name: 'Nowhere', lat: 200, lng: 74 }, at);
        check('a place with an impossible map position is refused', badPlace.status === 400);
        const pk = await api.post('/api/admin/travel/pickups', { name: `QA Pickup ${stamp}`, lat: 14.5, lng: 74.6 }, at);
        extra.pickups.push(pk.body?.data?.id);
        check('staff add a pickup point', pk.status === 201 && (await api.get('/api/travel/catalog')).body?.data?.pickups.some((p: any) => p.name === `QA Pickup ${stamp}`));
        void roadKm;
    } finally { await srv.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 1500));
    if (tripIds.length) await db.delete(travelTrips).where(inArray(travelTrips.id, tripIds.filter(Boolean))).catch(e => console.error('cleanup trips', e.message));
    if (extra.places.length) await db.delete(travelPlaces).where(inArray(travelPlaces.id, extra.places.filter(Boolean))).catch(() => {});
    if (extra.regions.length) await db.delete(travelRegions).where(inArray(travelRegions.id, extra.regions.filter(Boolean))).catch(() => {});
    if (extra.pickups.length) await db.delete(travelPickups).where(inArray(travelPickups.id, extra.pickups.filter(Boolean))).catch(() => {});
    if (userIds.length) {
        await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {});
        await db.delete(users).where(inArray(users.id, userIds)).catch(e => console.error('cleanup users', e.message));
    }
    if (adminIds.length) {
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',')})`)).catch(() => {});
        await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',')})`)).catch(() => {});
    }
    void eq;
    process.exit(summary());
});
