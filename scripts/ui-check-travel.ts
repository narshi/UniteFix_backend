/**
 * Browser check: Admin → Travel. A trip sent from the app shows under New;
 * staff assign a travel manager and enter the quotation; the customer's
 * "My trips" shows both. Travel Places: add a place with a map position
 * pasted from Google Maps, and it reaches the app. Needs the built server:
 *   npm run build
 *   NODE_ENV=test PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-travel.ts
 */
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import { inArray, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, travelTrips, travelPlaces } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0; const userIds: number[] = []; let tripId = 0;
const api = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
};

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = (await api('POST', '/api/admin/auth/login', { username: sa.username, password: sa.password })).body;
    const [cu] = await db.insert(users).values({ phone: `6${Date.now().toString().slice(-9)}`, username: 'QA UI Traveller', role: 'user' } as any).returning(); userIds.push(cu.id);
    const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const cat = (await api('GET', '/api/travel/catalog')).body.data;
    const pid = (n: string) => cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === n).id;
    const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi').id;
    const sent = await api('POST', '/api/travel/trips', {
        tripType: 'round_trip', pace: 'balanced', pickupId: sirsi, placeIds: [pid('Om Beach'), pid('Magod Falls'), pid('Marikamba Temple')], regionIds: [],
        adults: 3, children: 1, members: [{ name: 'Asha', phone: '9876543210' }], startDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        stay: 'homestay', rooms: 2, needsCab: true, needsGuide: false, budgetPerPerson: 5000, notes: 'UI check trip', contactName: 'QA UI Traveller', contactPhone: '9845012345',
    }, ct);
    tripId = sent.body?.data?.id; const code = sent.body?.data?.code;
    check('a trip is sent from the app', sent.status === 201 && !!code);

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/travel/trips', { waitUntil: 'networkidle' });
        const card = p.getByTestId(`trip-${code}`);
        await card.waitFor({ timeout: 8000 });
        check('the trip shows under Open, waiting for a manager', /Waiting for a travel manager/.test(await card.innerText()));
        check('…with the people, stay, cab and the day-by-day plan', /3 adults, 1 child/.test(await card.innerText()) && /Homestay/.test(await card.innerText()) && /Day 1/.test(await card.innerText()) && /Asha/.test(await card.innerText()));
        check('the sidebar has a Travel group', await p.getByRole('navigation').getByRole('link', { name: 'Trip Requests' }).isVisible());
        await p.screenshot({ path: `${OUT}/travel-trips-new.png`, fullPage: true });
        await card.getByLabel('Name the customer sees').fill('Kiran');
        await card.getByLabel('Their phone').fill('9448850679');
        await card.getByRole('button', { name: 'Assign and tell the customer' }).click();
        await p.waitForTimeout(1200);
        let mine = (await api('GET', '/api/travel/trips/mine', undefined, ct)).body.data[0];
        check('assigning shows the manager in the customer\'s app', mine.status === 'assigned' && mine.manager?.name === 'Kiran');
        const card2 = p.getByTestId(`trip-${code}`);
        await card2.getByLabel('Quotation, whole group (₹)').fill('36500');
        await card2.getByLabel('What the quotation covers (the customer sees this)').fill('Innova 2 days, homestay 2 rooms');
        await card2.getByRole('button', { name: 'Save' }).click();
        await p.waitForTimeout(1200);
        mine = (await api('GET', '/api/travel/trips/mine', undefined, ct)).body.data[0];
        check('the quotation reaches the customer: Quotation sent, ₹36,500', mine.status === 'quoted' && mine.quote?.amount === 36500 && /homestay/.test(mine.quote?.note ?? ''));
        await p.getByRole('button', { name: 'Quoted' }).click();
        await p.waitForTimeout(800);
        check('…and the trip moves to the Quoted filter', await p.getByTestId(`trip-${code}`).isVisible());
        await p.screenshot({ path: `${OUT}/travel-trips-quoted.png`, fullPage: true });

        await p.goto(BASE + '/admin/travel/places', { waitUntil: 'networkidle' });
        check('Travel Places lists the starting places', await p.getByText('Om Beach').first().isVisible() && await p.getByText('Magod Falls').first().isVisible());
        await p.getByRole('button', { name: /Add a place/ }).click();
        const dlg = p.getByRole('dialog');
        await dlg.getByLabel('Name').fill(`QA Lookout ${stamp}`);
        await dlg.getByLabel('Region').selectOption({ label: 'Sirsi' });
        await dlg.getByLabel('Latitude').fill('14.6123, 74.8456');
        check('pasting "lat, lng" from Google Maps fills both boxes', (await dlg.getByLabel('Longitude').inputValue()) === '74.8456');
        await dlg.getByRole('button', { name: 'Save' }).click();
        await p.waitForTimeout(1200);
        const cat2 = (await api('GET', '/api/travel/catalog')).body.data;
        check('the new place reaches the app under Sirsi', cat2.regions.find((r: any) => r.name === 'Sirsi')?.places.some((x: any) => x.name === `QA Lookout ${stamp}`));
        await p.screenshot({ path: `${OUT}/travel-places.png`, fullPage: false });
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    if (tripId) await db.delete(travelTrips).where(inArray(travelTrips.id, [tripId])).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM travel_places WHERE name LIKE 'QA Lookout ${stamp}'`)).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(() => {}); }
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by = ${adminId || 0}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    void travelPlaces;
    process.exit(summary());
});
