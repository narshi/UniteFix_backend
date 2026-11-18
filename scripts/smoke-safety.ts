/**
 * Trip day and safety: the 2-day cancellation rule; the trip team (our verified
 * experts; a partner's driver needs documents or a reason); the pickup code and
 * the driver's link; emergency contacts; SOS with live location and escalation;
 * reports that pause someone, strikes, clearing; help; and the safety shield on a
 * home-service booking. Plus the evening-before reminder and late-driver alert.
 *
 *   npx tsx scripts/smoke-safety.ts
 */

process.env.PAYMENT_LINKS_MOCK = '1';

import jwt from 'jsonwebtoken';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, bootServer, client, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, travelTrips, travelPartners, integrationSettings, safetyIncidents, serviceRequests } from '../shared/schema';
import { TravelService } from '../server/services/travel.service';
import { SafetyService } from '../server/services/safety.service';
import { istToday } from '../shared/travel';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], tripIds: number[] = [], empIds: number[] = [], srIds: number[] = [], partnerIds: number[] = [];
let saved: any = undefined;
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const dayFrom = (d: number) => new Date(Date.parse(`${istToday()}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

async function main() {
    const [prev] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, 'travel')).limit(1);
    saved = prev ?? null;
    const srv = await bootServer();
    try {
        const api = client(srv.base);
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const at = await api.login(sa.username, sa.password);
        await api.put('/api/admin/travel/settings', { defaultManager: { adminId: sa.id, name: 'Kiran', phone: '9448850679' }, advancePercent: 20, quoteValidHours: 48, cancelCutoffDays: 2, safetyLead: { name: 'Owner', phone: '9845000001', email: null } }, at);

        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA Safe Traveller', role: 'user' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const cat = (await api.get('/api/travel/catalog')).body.data;
        const pid = (x: string) => cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === x).id;
        const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi').id;
        const book = async (startDate: string) => {
            const s = await api.post('/api/travel/trips', { tripType: 'round_trip', pickupId: sirsi, placeIds: [pid('Magod Falls')], regionIds: [], adults: 2, children: 0, members: [], startDate, stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA Safe Traveller', contactPhone: '9845012345' }, ct);
            const tid = s.body.data.id; tripIds.push(tid);
            await api.patch(`/api/admin/travel/trips/${tid}`, { quoteAmount: 5000 }, at);
            await api.post(`/api/travel/trips/${tid}/advance`, {}, ct);
            const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tid));
            await TravelService.linkPaid({ payment_link: { entity: { id: t.paymentLinkId, notes: { travel_trip_id: String(tid) } } }, payment: { entity: { id: `pay_${stamp}_${tid}`, amount: 100000 } } });
            return tid;
        };
        const mine = async (tid: number) => (await api.get('/api/travel/trips/mine', ct)).body.data.find((t: any) => t.id === tid);

        // ── cancellation: at least 2 days before ──
        const far = await book(dayFrom(5));
        let v = await mine(far);
        check('a booked trip shows the pickup code only from the evening before', v.status === 'confirmed' && v.startCode === null && !!v.startCodeFrom);
        check('5 days before: cancel allowed, last day shown, advance kept', v.canCancel === true && v.cancelBy === dayFrom(3) && v.cancelKeepsAdvance === true);
        const near = await book(dayFrom(1));
        v = await mine(near);
        check('1 day before: no cancel in the app, with the reason', v.canCancel === false && /Within 2 days of the trip it can't be cancelled in the app\. Call Kiran/.test(v.cancelBlocked ?? ''));
        const c1 = await api.post(`/api/travel/trips/${near}/cancel`, {}, ct);
        check('…and the server refuses it too, with the manager\'s number', c1.status === 400 && /9448850679/.test(c1.body?.message));
        const c2 = await api.post(`/api/travel/trips/${far}/cancel`, {}, ct);
        check('the 5-days-away trip cancels', c2.status === 200 && (await mine(far)).status === 'cancelled');

        // ── the trip team ──
        const today = await book(dayFrom(0));
        const [eu] = await db.insert(users).values({ phone: phone(), username: 'QA Driver Expert', role: 'serviceman' } as any).returning(); userIds.push(eu.id);
        const [emp] = await db.insert(employees).values({ userId: eu.id, fullName: 'QA Driver Expert', documentVerificationStatus: 'verified', isActive: true } as any).returning(); empIds.push(emp.id);
        const experts = (await api.get('/api/admin/travel/experts', at)).body.data;
        check('staff can pick from our verified experts', experts.some((e: any) => e.id === emp.id));
        const ownDriver = await api.post(`/api/admin/travel/trips/${today}/team`, { role: 'driver', day: 1, source: 'own', employeeId: emp.id, vehicle: 'Innova', plate: 'ka 31 m 4821', time: '00:01' }, at);
        check('our expert goes on the trip as driver, with a driver link', ownDriver.status === 201 && ownDriver.body.data.name === 'QA Driver Expert' && ownDriver.body.data.plate === 'KA 31 M 4821' && /\/api\/travel\/driver\//.test(ownDriver.body.data.driverLink));
        const p = await api.post('/api/admin/travel/partners', { name: `QA Safe Cabs ${stamp}`, kinds: ['cab'], phone: '9876500021' }, at); partnerIds.push(p.body.data.id);
        const noDocs = await api.post(`/api/admin/travel/trips/${today}/team`, { role: 'driver', source: 'partner', partnerId: p.body.data.id, name: 'Partner Driver', phone: '9876543299' }, at);
        check('a partner\'s driver without licence, RC and photo is refused', noDocs.status === 400 && /licence, RC and photo/.test(noDocs.body?.message));
        const withReason = await api.post(`/api/admin/travel/trips/${today}/team`, { role: 'driver', day: 2, source: 'partner', partnerId: p.body.data.id, name: 'Partner Driver', phone: '9876543299', docOverride: 'Licence seen on WhatsApp, RC to follow' }, at);
        check('…unless staff write why (logged), and it shows as not verified', withReason.status === 201 && withReason.body.data.verified === false);
        await api.post(`/api/admin/travel/trips/${today}/team`, { role: 'stay', day: 1, source: 'partner', name: 'Green Valley Homestay', phone: '9876543298', place: 'Yellapur', time: '18:00' }, at);
        v = await mine(today);
        check('the traveller sees the team, phones and the pickup code on the day', v.team.length === 3 && v.team.some((m: any) => m.name === 'QA Driver Expert' && m.phone && m.plate === 'KA 31 M 4821' && m.ours) && /^\d{4}$/.test(v.startCode ?? ''));

        // ── pickup code and the driver's link ──
        const [trow] = await db.select().from(travelTrips).where(eq(travelTrips.id, today));
        const token = ownDriver.body.data.driverLink.split('/').pop();
        const page = await (await fetch(`${srv.base}/api/travel/driver/${token}`)).text();
        check('the driver\'s link opens a page asking for the code', /Start the trip/.test(page) && new RegExp(trow.code).test(page));
        const wrong = await api.post(`/api/travel/driver/${token}/start`, { code: trow.startCode === '1234' ? '4321' : '1234' });
        check('a wrong code does not start the trip', wrong.status === 400 && /does not match/.test(wrong.body?.message));
        const right = await api.post(`/api/travel/driver/${token}/start`, { code: trow.startCode });
        v = await mine(today);
        check('the right code starts it: On trip, the shield and End are available', right.status === 200 && v.status === 'started' && v.statusLabel === 'On trip' && v.canEnd === true && v.safetyActive === true);

        // ── emergency contacts ──
        const own = await api.put('/api/safety/contacts', { contacts: [{ name: 'Me', phone: (cu.phone as string) }] }, ct);
        check('you cannot add your own number as an emergency contact', own.status === 400);
        const ok = await api.put('/api/safety/contacts', { contacts: [{ name: 'Amma', phone: '98450 11111' }, { name: 'Ravi', phone: '9845022222' }] }, ct);
        check('two emergency contacts are saved', ok.status === 200 && (await api.get('/api/safety/contacts', ct)).body.data.length === 2);

        // ── SOS ──
        const sos = await api.post('/api/safety/sos', { context: 'trip', tripId: today, lat: 14.86, lng: 74.76, accuracy: 15 }, ct);
        check('SOS: a critical case, a live link and the text for the contacts', sos.status === 201 && /^SF-/.test(sos.body.data.code) && /\/api\/safety\/live\//.test(sos.body.data.liveUrl) && sos.body.data.contacts.length === 2 && /SOS from QA Safe Traveller/.test(sos.body.data.smsText) && sos.body.data.manager?.name === 'Kiran');
        await api.post(`/api/safety/sos/${sos.body.data.id}/ping`, { lat: 14.87, lng: 74.77 }, ct);
        const live = await (await fetch(`${srv.base}/api/safety/live/${sos.body.data.liveUrl.split("/").pop()}`)).text();
        check('the live page shows the latest location and who they are with', /QA Safe Traveller pressed SOS/.test(live) && /14\.87,74\.77/.test(live) && /KA 31 M 4821/.test(live));
        let alarm = (await api.get('/api/admin/safety/alarm', at)).body.data;
        check('staff see it on the alarm until someone picks it up', alarm.critical.some((x: any) => x.id === sos.body.data.id));
        await db.update(safetyIncidents).set({ createdAt: new Date(Date.now() - 3 * 60_000) }).where(eq(safetyIncidents.id, sos.body.data.id));
        await SafetyService.escalate();
        const [esc] = await db.select().from(safetyIncidents).where(eq(safetyIncidents.id, sos.body.data.id));
        check('not picked up in 2 minutes: escalated to the safety lead', !!esc.escalatedAt);
        await api.post(`/api/admin/safety/incidents/${sos.body.data.id}/acknowledge`, {}, at);
        alarm = (await api.get('/api/admin/safety/alarm', at)).body.data;
        check('picking it up clears the alarm', !alarm.critical.some((x: any) => x.id === sos.body.data.id));

        // ── a critical report pauses our expert; clearing lifts it ──
        const rep = await api.post('/api/safety/report', { context: 'trip', tripId: today, category: 'drunk', teamMemberId: ownDriver.body.data.id, description: 'Smelled of alcohol' }, ct);
        const [e1] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('a critical report: 5-minute callback promised and the expert paused', rep.status === 201 && rep.body.data.severity === 'critical' && /within 5 minutes/.test(rep.body.message) && e1.isActive === false);
        const noNote = await api.post(`/api/admin/safety/incidents/${rep.body.data.id}/resolve`, { action: 'clear', note: '' }, at);
        check('closing a case needs a note', noNote.status === 400);
        await api.post(`/api/admin/safety/incidents/${rep.body.data.id}/resolve`, { action: 'clear', note: 'Spoke to both; it was cough syrup, driver fine' }, at);
        const [e2] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('"Cleared" lifts the pause', e2.isActive === true);

        // ── strikes: three in 6 months suspends ──
        let last: any;
        for (let i = 0; i < 3; i++) {
            const r = await api.post('/api/safety/report', { context: 'trip', tripId: today, category: 'rude', teamMemberId: ownDriver.body.data.id }, ct);
            last = await api.post(`/api/admin/safety/incidents/${r.body.data.id}/resolve`, { action: 'strike', note: `Strike ${i + 1}` }, at);
        }
        const [e3] = await db.select().from(employees).where(eq(employees.id, emp.id));
        check('the third strike suspends them', /third strike/.test(last.body?.message) && e3.isActive === false);
        await db.update(employees).set({ isActive: true } as any).where(eq(employees.id, emp.id));

        // ── a partner's driver with a critical case can't be put on another trip ──
        const pd = (await mine(today)).team.find((m: any) => m.name === 'Partner Driver');
        await api.post('/api/safety/report', { context: 'trip', tripId: today, category: 'harassment', teamMemberId: pd.id }, ct);
        const again = await api.post(`/api/admin/travel/trips/${today}/team`, { role: 'driver', day: 3, source: 'partner', partnerId: p.body.data.id, name: 'Same Driver', phone: '9876543299', docs: { licence: true, rc: true, photo: true } }, at);
        check('a partner\'s driver with an open critical case is refused', again.status === 400 && /safety case/.test(again.body?.message));

        // ── help ──
        const help = await api.post('/api/safety/help', { context: 'trip', tripId: today, category: 'breakdown', description: 'Flat tyre near Magod' }, ct);
        check('help: the manager will call within 10 minutes', help.status === 201 && /within 10 minutes/.test(help.body.message));
        const other = await api.post('/api/safety/help', { context: 'trip', tripId: far + 999999, category: 'other' }, ct);
        check('nobody can raise cases on a trip that isn\'t theirs', other.status === 404);

        // ── home-service booking ──
        const [sr] = await db.insert(serviceRequests).values({ serviceId: `QA-S-${stamp}`, userId: cu.id, serviceType: 'Plumbing', description: 'QA', address: 'QA', status: 'in_progress', providerId: emp.id } as any).returning(); srIds.push(sr.id);
        const sRep = await api.post('/api/safety/report', { context: 'service', serviceRequestId: sr.id, category: 'extra_money', description: 'Asked for ₹500 more in cash' }, ct);
        const [inc] = await db.select().from(safetyIncidents).where(eq(safetyIncidents.id, sRep.body.data.id));
        check('the shield works on a home-service visit: report about the assigned expert', sRep.status === 201 && (inc.subject as any)?.employeeId === emp.id && inc.severity === 'high');
        const list = (await api.get('/api/admin/safety/incidents?status=open', at)).body.data.incidents;
        check('the safety desk lists open cases, critical first', list.length > 0 && list[0].severity === 'critical');

        // ── end, reminder, late driver ──
        const end = await api.post(`/api/travel/trips/${today}/end`, {}, ct);
        check('the traveller ends the trip: Completed', end.status === 200 && (await mine(today)).status === 'completed');
        const tmr = await book(dayFrom(1));
        await api.post(`/api/admin/travel/trips/${tmr}/team`, { role: 'driver', day: 1, source: 'own', employeeId: emp.id, vehicle: 'Innova', plate: 'KA31M4821', time: '07:30' }, at);
        const sevenPm = Date.parse(`${istToday()}T19:00:00+05:30`);
        const r1 = await TravelService.tripDayJobs(sevenPm);
        const [rt] = await db.select().from(travelTrips).where(eq(travelTrips.id, tmr));
        check('the evening before at 7 pm: the reminder is sent once', r1.reminded >= 1 && !!rt.reminderSentAt && (await TravelService.tripDayJobs(sevenPm)).reminded === 0);
        const nextMorning = Date.parse(`${dayFrom(1)}T07:50:00+05:30`);
        const r2 = await TravelService.tripDayJobs(nextMorning);
        const lateCase = await db.select().from(safetyIncidents).where(eq(safetyIncidents.tripId, tmr));
        check('pickup at 07:30, not started by 07:50: the late-driver alert opens a case', r2.late >= 1 && lateCase.some(c => c.category === 'driver_late'));
    } finally { await srv.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const ids = tripIds.filter(Boolean);
    if (ids.length || srIds.length) await db.execute(sql.raw(`DELETE FROM safety_incidents WHERE trip_id IN (${ids.join(',') || 0}) OR service_request_id IN (${srIds.join(',') || 0})`)).catch(e => console.error('cleanup incidents', e.message));
    if (ids.length) await db.delete(travelTrips).where(inArray(travelTrips.id, ids)).catch(e => console.error('cleanup trips', e.message));
    if (srIds.length) await db.delete(serviceRequests).where(inArray(serviceRequests.id, srIds)).catch(e => console.error('cleanup sr', e.message));
    if (partnerIds.length) await db.delete(travelPartners).where(inArray(travelPartners.id, partnerIds)).catch(() => {});
    if (empIds.length) await db.delete(employees).where(inArray(employees.id, empIds)).catch(e => console.error('cleanup emp', e.message));
    if (saved) await db.insert(integrationSettings).values(saved).onConflictDoUpdate({ target: integrationSettings.key, set: { config: saved.config, updatedBy: saved.updatedBy } }).catch(() => {});
    else await db.delete(integrationSettings).where(eq(integrationSettings.key, 'travel')).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(e => console.error('cleanup users', e.message)); }
    if (adminIds.length) { await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by IN (${adminIds.join(',')})`)).catch(() => {}); await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',')})`)).catch(() => {}); }
    process.exit(summary());
});
