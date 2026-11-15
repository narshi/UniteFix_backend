/**
 * Travel v2: the default travel manager takes every new trip; the manager
 * collects supplier prices (our own team first, then travel partners); sends
 * the customer a quotation held for a time; the customer books with a 20%
 * advance (not refundable) by payment link; the webhook books the trip.
 *
 *   npx tsx scripts/smoke-travel-quotes.ts
 */

process.env.PAYMENT_LINKS_MOCK = '1';   // never a real Razorpay link from a test

import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, travelTrips, travelPartners, integrationSettings } from '../shared/schema';
import { TravelService } from '../server/services/travel.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], tripIds: number[] = [], partnerIds: number[] = [];
let savedSettings: any = undefined;

async function main() {
    const [prev] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, 'travel')).limit(1);
    savedSettings = prev ?? null;
    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const at = await api.login(sa.username, sa.password);

        // ── settings: the default travel manager ──
        const set = await api.put('/api/admin/travel/settings', { defaultManager: { adminId: sa.id, name: 'Kiran', phone: '94488 50679' }, advancePercent: 20, quoteValidHours: 48 }, at);
        check('staff set the default travel manager, a 20% advance and a 48-hour price hold', set.status === 200, JSON.stringify(set.body).slice(0, 160));

        const cat = (await api.get('/api/travel/catalog')).body.data;
        const pid = (n: string) => cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === n).id;
        const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi').id;
        const [cu] = await db.insert(users).values({ phone: `6${Date.now().toString().slice(-9)}`, username: 'QA Quote Traveller', role: 'user' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const sent = await api.post('/api/travel/trips', {
            tripType: 'round_trip', pace: 'balanced', pickupId: sirsi, placeIds: [pid('Om Beach'), pid('Magod Falls')], regionIds: [],
            adults: 4, children: 0, members: [], startDate: new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10),
            stay: 'standard', rooms: 2, needsCab: true, needsGuide: false, budgetPerPerson: null, notes: null, contactName: 'QA Quote Traveller', contactPhone: '9845012345',
        }, ct);
        const tripId = sent.body?.data?.id; tripIds.push(tripId);
        check('a new trip goes straight to the default manager', sent.status === 201 && sent.body?.data?.manager?.name === 'Kiran' && /Kiran, your travel manager, will call you soon/.test(sent.body?.message), sent.body?.message);
        let mine = (await api.get('/api/travel/trips/mine', ct)).body.data[0];
        check('…and the customer sees Kiran and a Call button from the start', mine.status === 'assigned' && mine.manager?.phone === '9448850679' && mine.canPay === false);

        // ── travel partners ──
        const p1 = await api.post('/api/admin/travel/partners', { name: `QA Coast Cabs ${stamp}`, kinds: ['cab'], baseTown: 'Kumta', regionIds: [cat.regions[0].id], phone: '9876500001' }, at);
        const p2 = await api.post('/api/admin/travel/partners', { name: `QA Sirsi Stays ${stamp}`, kinds: ['stay', 'homestay'], baseTown: 'Sirsi', phone: '9876500002' }, at);
        partnerIds.push(p1.body?.data?.id, p2.body?.data?.id);
        check('staff add travel partners by area and what they provide', p1.status === 201 && p2.status === 201);
        const noKind = await api.post('/api/admin/travel/partners', { name: 'No kind', kinds: [] }, at);
        check('…a partner must say what it provides', noKind.status === 400);

        // ── supplier prices: our team first, then partners ──
        const own = await api.post(`/api/admin/travel/trips/${tripId}/quotes`, { source: 'own', covers: 'Our Innova + driver, 2 days', amount: 9800 }, at);
        const q1 = await api.post(`/api/admin/travel/trips/${tripId}/quotes`, { source: 'partner', partnerId: p1.body.data.id, covers: 'Innova 2 days' }, at);
        check('our own team\'s price and a partner asked for theirs', own.body?.data?.status === 'quoted' && own.body?.data?.label.startsWith('Our team') && q1.body?.data?.status === 'asked' && q1.body?.data?.label === `QA Coast Cabs ${stamp}`);
        const q1b = await api.patch(`/api/admin/travel/trips/${tripId}/quotes/${q1.body.data.id}`, { amount: 8900 }, at);
        check('…the partner\'s price comes in (asked → quoted)', q1b.body?.data?.status === 'quoted' && q1b.body?.data?.amount === 8900);
        const trips = (await api.get('/api/admin/travel/trips?status=open', at)).body.data.trips;
        check('staff see every supplier price on the trip', trips.find((t: any) => t.id === tripId)?.quotes?.length === 2);

        // ── the customer quotation ──
        const sendQ = await api.patch(`/api/admin/travel/trips/${tripId}`, { chosenQuoteId: q1.body.data.id, quoteAmount: 12500, quoteNote: 'Innova 2 days, 2 rooms × 1 night' }, at);
        check('the manager picks the lowest and sends the customer a price', sendQ.status === 200 && /Quotation sent/.test(sendQ.body?.message));
        const [row] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId));
        check('…our cost is recorded beside the customer price', row.costAmount === 8900 && row.quoteAmount === 12500 && row.chosenQuoteId === q1.body.data.id);
        mine = (await api.get('/api/travel/trips/mine', ct)).body.data[0];
        const hrs = (new Date(mine.quote.validUntil).getTime() - Date.now()) / 3600_000;
        check('the customer sees the price, a 20% advance of ₹2,500 and the balance', mine.status === 'quoted' && mine.quote.amount === 12500 && mine.quote.advanceAmount === 2500 && mine.quote.balance === 10000 && mine.canPay === true);
        check('…held for 48 hours', hrs > 47.5 && hrs <= 48);
        const [notice] = (await db.execute(sql`SELECT title, body FROM notifications WHERE user_id = ${cu.id} ORDER BY id DESC LIMIT 1`)).rows as any[];
        check('…and a notification says how long the price is held', /held for 2 days/.test(notice?.body ?? ''), notice?.body);

        // ── booking with the advance ──
        const pay = await api.post(`/api/travel/trips/${tripId}/advance`, {}, ct);
        check('Book now gives a payment link for ₹2,500', pay.status === 200 && pay.body?.data?.amount === 2500 && /^https:\/\/rzp\.io\//.test(pay.body?.data?.url));
        const again = await api.post(`/api/travel/trips/${tripId}/advance`, {}, ct);
        check('…tapping again reuses the same link', again.body?.data?.url === pay.body?.data?.url);
        const [withLink] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId));
        const payload = { payment_link: { entity: { id: withLink.paymentLinkId, notes: { travel_trip_id: String(tripId), payment_type: 'travel_advance' } } }, payment: { entity: { id: `pay_qa_${stamp}`, amount: 250000 } } };
        const r1 = await TravelService.linkPaid(payload);
        const r2 = await TravelService.linkPaid(payload);
        mine = (await api.get('/api/travel/trips/mine', ct)).body.data[0];
        check('when it is paid the trip is booked (Confirmed, advance paid)', r1.handled && mine.status === 'confirmed' && mine.advance.status === 'paid' && mine.canPay === false);
        check('…a repeat webhook changes nothing', (r2 as any).repeat === true);
        const payTwice = await api.post(`/api/travel/trips/${tripId}/advance`, {}, ct);
        check('…and it cannot be paid twice', payTwice.status === 400 && /already paid/.test(payTwice.body?.message));
        const reprice = await api.patch(`/api/admin/travel/trips/${tripId}`, { quoteAmount: 15000 }, at);
        check('staff cannot change a price the advance was paid on', reprice.status === 400);
        check('a booked trip can be cancelled, and the advance is kept', mine.canCancel === true && mine.cancelKeepsAdvance === true);

        // ── an expired price ──
        const sent2 = await api.post('/api/travel/trips', {
            tripType: 'round_trip', pickupId: sirsi, placeIds: [pid('Magod Falls')], regionIds: [], adults: 2, children: 0, members: [],
            startDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA Quote Traveller', contactPhone: '9845012345',
        }, ct);
        tripIds.push(sent2.body.data.id);
        await api.patch(`/api/admin/travel/trips/${sent2.body.data.id}`, { quoteAmount: 4000, validHours: 1 }, at);
        await db.update(travelTrips).set({ quoteValidUntil: new Date(Date.now() - 60_000) }).where(eq(travelTrips.id, sent2.body.data.id));
        const exp = (await api.get('/api/travel/trips/mine', ct)).body.data.find((t: any) => t.id === sent2.body.data.id);
        const payExp = await api.post(`/api/travel/trips/${sent2.body.data.id}/advance`, {}, ct);
        check('once the hold runs out the price shows as expired and cannot be booked', exp.quote.expired === true && exp.canPay === false && payExp.status === 400 && /no longer held/.test(payExp.body?.message));
        const renew = await api.patch(`/api/admin/travel/trips/${sent2.body.data.id}`, { validHours: 24 }, at);
        const ren = (await api.get('/api/travel/trips/mine', ct)).body.data.find((t: any) => t.id === sent2.body.data.id);
        check('…the manager can hold the same price again', renew.status === 200 && ren.canPay === true);

        // ── no default manager ──
        await api.put('/api/admin/travel/settings', { defaultManager: null, advancePercent: 20, quoteValidHours: 48 }, at);
        const sent3 = await api.post('/api/travel/trips', {
            tripType: 'round_trip', pickupId: sirsi, placeIds: [pid('Om Beach')], regionIds: [], adults: 1, children: 0, members: [],
            startDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA Quote Traveller', contactPhone: '9845012345',
        }, ct);
        tripIds.push(sent3.body.data.id);
        check('without a default manager a trip waits for one, as before', sent3.body?.data?.manager === null && /will be assigned/.test(sent3.body?.message));

        // ── partner removal keeps history ──
        await api.del(`/api/admin/travel/partners/${p1.body.data.id}`, at);
        const [p1row] = await db.select().from(travelPartners).where(eq(travelPartners.id, p1.body.data.id));
        await api.del(`/api/admin/travel/partners/${p2.body.data.id}`, at);
        const [p2row] = await db.select().from(travelPartners).where(eq(travelPartners.id, p2.body.data.id));
        check('a partner with prices on trips is hidden, one without is deleted', p1row?.isActive === false && !p2row);
    } finally { await srv.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 1500));
    if (tripIds.length) await db.delete(travelTrips).where(inArray(travelTrips.id, tripIds.filter(Boolean))).catch(e => console.error('cleanup trips', e.message));
    if (partnerIds.filter(Boolean).length) await db.delete(travelPartners).where(inArray(travelPartners.id, partnerIds.filter(Boolean))).catch(e => console.error('cleanup partners', e.message));
    // Put the travel settings back as they were.
    if (savedSettings) await db.insert(integrationSettings).values(savedSettings).onConflictDoUpdate({ target: integrationSettings.key, set: { config: savedSettings.config, updatedBy: savedSettings.updatedBy } }).catch(() => {});
    else await db.delete(integrationSettings).where(eq(integrationSettings.key, 'travel')).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(() => {}); }
    if (adminIds.length) { await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',')})`)).catch(() => {}); await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',')})`)).catch(() => {}); }
    process.exit(summary());
});
