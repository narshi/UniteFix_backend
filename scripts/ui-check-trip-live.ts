/**
 * Browser check: Live trips shows a trip on the road with its progress and
 * driver; on the trip card staff record the balance and a payment to a
 * partner and see the margin; Travel Partners shows the partner's score.
 * Needs the built server with fake payment links:
 *   npm run build
 *   NODE_ENV=test PAYMENT_LINKS_MOCK=1 PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-trip-live.ts
 */
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, travelTrips, travelPartners, integrationSettings } from '../shared/schema';
import { TravelService } from '../server/services/travel.service';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0; const userIds: number[] = []; const empIds: number[] = []; let tripId = 0; let partnerId = 0; let saved: any = undefined;
const api = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
};

async function main() {
    const [prev] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, 'travel')).limit(1); saved = prev ?? null;
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = (await api('POST', '/api/admin/auth/login', { username: sa.username, password: sa.password })).body;
    const tok = login.token;
    await api('PUT', '/api/admin/travel/settings', { defaultManager: { adminId: sa.id, name: 'Kiran', phone: '9448850679' }, advancePercent: 20, quoteValidHours: 48, cancelCutoffDays: 2, safetyLead: null }, tok);
    const [cu] = await db.insert(users).values({ phone: `6${Date.now().toString().slice(-9)}`, username: 'QA UI Live', role: 'user' } as any).returning(); userIds.push(cu.id);
    const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const [eu] = await db.insert(users).values({ phone: `7${Date.now().toString().slice(-9)}`, username: 'QA UI Live Driver', role: 'serviceman' } as any).returning(); userIds.push(eu.id);
    const [emp] = await db.insert(employees).values({ userId: eu.id, fullName: `QA UI Live Driver ${stamp}`, documentVerificationStatus: 'verified', isActive: true } as any).returning(); empIds.push(emp.id);
    const cat = (await api('GET', '/api/travel/catalog')).body.data;
    const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi');
    const magod = cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === 'Magod Falls');
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const sent = await api('POST', '/api/travel/trips', { tripType: 'round_trip', pickupId: sirsi.id, placeIds: [magod.id], regionIds: [], adults: 2, children: 0, members: [], startDate: today, stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA UI Live', contactPhone: '9845012345' }, ct);
    tripId = sent.body.data.id; const code = sent.body.data.code;
    await api('PATCH', `/api/admin/travel/trips/${tripId}`, { quoteAmount: 9000 }, tok);
    await api('POST', `/api/travel/trips/${tripId}/advance`, {}, ct);
    const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId));
    await TravelService.linkPaid({ payment_link: { entity: { id: t.paymentLinkId, notes: { travel_trip_id: String(tripId) } } }, payment: { entity: { id: `pay_uilive_${stamp}`, amount: 180000 } } });
    const partner = await api('POST', '/api/admin/travel/partners', { name: `QA UI Live Cabs ${stamp}`, kinds: ['cab'], phone: '9876500041' }, tok); partnerId = partner.body.data.id;
    const drv = await api('POST', `/api/admin/travel/trips/${tripId}/team`, { role: 'driver', day: 1, source: 'own', employeeId: emp.id, plate: 'KA31M1111', time: '07:30' }, tok);
    const token = drv.body.data.driverLink.split('/').pop();
    const [t2] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId));
    await api('POST', `/api/travel/driver/${token}/accept`, {});
    await api('POST', `/api/travel/driver/${token}/start`, { code: t2.startCode });
    await api('POST', `/api/travel/trips/${tripId}/ping`, { lat: magod.lat, lng: magod.lng }, ct);

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([k, u]) => { localStorage.setItem('adminToken', k); localStorage.setItem('adminUser', u); }, [tok, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/travel/live', { waitUntil: 'networkidle' });
        const live = p.getByTestId(`live-${code}`);
        await live.waitFor({ timeout: 8000 });
        const txt = await live.innerText();
        check('Live trips shows it on the road with progress, the last location and the accepted driver', /On trip/.test(txt) && /1 of 1 places/.test(txt) && /traveller's app/.test(txt) && /accepted/.test(txt));
        await p.screenshot({ path: `${OUT}/live-trips.png`, fullPage: true });

        await p.goto(BASE + '/admin/travel/trips', { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: 'On trip' }).click();
        const card = p.getByTestId(`trip-${code}`);
        await card.waitFor({ timeout: 8000 });
        check('the trip card shows Money: price and the advance collected', /6\. Money/.test(await card.innerText()) && /₹9,000/.test(await card.innerText()) && /Advance ₹1,800/.test(await card.innerText()));
        await card.getByLabel('Balance received on the trip (₹)').fill('7200');
        await card.getByRole('button', { name: 'Save balance' }).click();
        await p.waitForTimeout(1000);
        await card.getByLabel('Paid to').selectOption(`p:${partnerId}`);
        await card.getByLabel('Amount paid').fill('5000');
        await card.getByLabel('Reference').fill('UTR998877');
        await card.getByRole('button', { name: 'Record payment' }).click();
        await p.waitForTimeout(1200);
        const after = await card.innerText();
        check('recording the balance and a partner payment shows the margin', /UTR998877/.test(after) && /margin\s*₹4,000/i.test(after) && /still due/.test(after) === false);
        await p.screenshot({ path: `${OUT}/trip-money.png`, fullPage: true });

        await p.goto(BASE + '/admin/travel/partners', { waitUntil: 'networkidle' });
        check('Travel Partners shows what the partner has been paid', /Paid ₹5,000 over 1 trip/.test(await p.getByTestId(`score-${partnerId}`).innerText()));
        check('the menu has Live Trips', await p.getByRole('navigation').getByRole('link', { name: 'Live Trips' }).isVisible());
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    if (tripId) { await db.execute(sql.raw(`DELETE FROM safety_incidents WHERE trip_id = ${tripId}`)).catch(() => {}); await db.execute(sql.raw(`DELETE FROM travel_trip_payouts WHERE trip_id = ${tripId}`)).catch(() => {}); await db.delete(travelTrips).where(eq(travelTrips.id, tripId)).catch(() => {}); }
    if (partnerId) await db.delete(travelPartners).where(eq(travelPartners.id, partnerId)).catch(() => {});
    if (empIds.length) await db.delete(employees).where(inArray(employees.id, empIds)).catch(() => {});
    if (saved) await db.insert(integrationSettings).values(saved).onConflictDoUpdate({ target: integrationSettings.key, set: { config: saved.config } }).catch(() => {});
    else await db.delete(integrationSettings).where(eq(integrationSettings.key, 'travel')).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(() => {}); }
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by = ${adminId || 0}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    process.exit(summary());
});
