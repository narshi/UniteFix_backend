/**
 * Browser check: a booked trip's team is added from the trip card; an SOS puts
 * a red alarm bar on every admin page; the Safety desk picks it up and closes
 * it. Needs the built server with fake payment links:
 *   npm run build
 *   NODE_ENV=test PAYMENT_LINKS_MOCK=1 PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-safety.ts
 */
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import { eq, inArray, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { users, employees, travelTrips, integrationSettings } from '../shared/schema';
import { TravelService } from '../server/services/travel.service';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0; const userIds: number[] = []; const empIds: number[] = []; let tripId = 0; let saved: any = undefined;
const api = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) as any };
};

async function main() {
    const [prev] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, 'travel')).limit(1); saved = prev ?? null;
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = (await api('POST', '/api/admin/auth/login', { username: sa.username, password: sa.password })).body;
    await api('PUT', '/api/admin/travel/settings', { defaultManager: { adminId: sa.id, name: 'Kiran', phone: '9448850679' }, advancePercent: 20, quoteValidHours: 48, cancelCutoffDays: 2, safetyLead: null }, login.token);
    const [cu] = await db.insert(users).values({ phone: `6${Date.now().toString().slice(-9)}`, username: 'QA UI Safe', role: 'user' } as any).returning(); userIds.push(cu.id);
    const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    const [eu] = await db.insert(users).values({ phone: `7${Date.now().toString().slice(-9)}`, username: `QA UI Driver ${stamp}`, role: 'serviceman' } as any).returning(); userIds.push(eu.id);
    const [emp] = await db.insert(employees).values({ userId: eu.id, fullName: `QA UI Driver ${stamp}`, documentVerificationStatus: 'verified', isActive: true } as any).returning(); empIds.push(emp.id);
    const cat = (await api('GET', '/api/travel/catalog')).body.data;
    const sirsi = cat.pickups.find((p: any) => p.name === 'Sirsi').id;
    const magod = cat.regions.flatMap((r: any) => r.places).find((p: any) => p.name === 'Magod Falls').id;
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const sent = await api('POST', '/api/travel/trips', { tripType: 'round_trip', pickupId: sirsi, placeIds: [magod], regionIds: [], adults: 2, children: 0, members: [], startDate: today, stay: 'none', needsCab: true, needsGuide: false, contactName: 'QA UI Safe', contactPhone: '9845012345' }, ct);
    tripId = sent.body.data.id; const code = sent.body.data.code;
    await api('PATCH', `/api/admin/travel/trips/${tripId}`, { quoteAmount: 4000 }, login.token);
    await api('POST', `/api/travel/trips/${tripId}/advance`, {}, ct);
    const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId));
    await TravelService.linkPaid({ payment_link: { entity: { id: t.paymentLinkId, notes: { travel_trip_id: String(tripId) } } }, payment: { entity: { id: `pay_ui_${stamp}`, amount: 80000 } } });

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([tk, u]) => { localStorage.setItem('adminToken', tk); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/travel/trips', { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: 'Booked' }).click();
        const card = p.getByTestId(`trip-${code}`);
        await card.waitFor({ timeout: 8000 });
        check('a booked trip shows the Trip team section with its pickup code', /5\. Trip team/.test(await card.innerText()) && /Pickup code \d{4}/.test(await card.innerText()));
        await card.getByLabel('Expert').selectOption(String(emp.id));
        await card.getByLabel('Vehicle').fill('Innova, white');
        await card.getByLabel('Number plate').fill('KA 31 M 4821');
        await card.getByLabel('Time').fill('07:30');
        await card.getByRole('button', { name: 'Add to the team' }).click();
        await p.waitForTimeout(1200);
        check('our expert is added as driver: verified, with a driver link', new RegExp(`QA UI Driver ${stamp}`).test(await card.innerText()) && await card.getByRole('button', { name: 'Copy driver link' }).isVisible());
        await card.getByLabel('From', { exact: true }).last().selectOption('partner');
        await card.getByLabel('Name', { exact: true }).fill('Partner Cab Driver');
        await card.getByLabel('Phone', { exact: true }).fill('9876543210');
        await card.getByRole('button', { name: 'Add to the team' }).click();
        await p.waitForTimeout(1000);
        check('a partner driver without documents or a reason is refused', !/Partner Cab Driver/.test(await card.innerText()));
        await p.screenshot({ path: `${OUT}/safety-team.png`, fullPage: true });

        // SOS from the app → alarm bar on every admin page.
        const sos = await api('POST', '/api/safety/sos', { context: 'trip', tripId, lat: 14.86, lng: 74.76 }, ct);
        await p.goto(BASE + '/admin/travel/places', { waitUntil: 'networkidle' });
        await p.getByTestId('safety-alarm').waitFor({ timeout: 20000 });
        check('an SOS puts a red alarm bar on other admin pages', new RegExp(sos.body.data.code).test(await p.getByTestId('safety-alarm').innerText()));
        await p.screenshot({ path: `${OUT}/safety-alarm.png`, clip: { x: 0, y: 0, width: 1360, height: 500 } });
        await p.getByRole('link', { name: 'Open the Safety desk' }).click();
        const inc = p.getByTestId(`incident-${sos.body.data.code}`);
        await inc.waitFor({ timeout: 8000 });
        check('the Safety desk shows the SOS with the caller, trip, map and live link', /SOS pressed/.test(await inc.innerText()) && /QA UI Safe/.test(await inc.innerText()) && new RegExp(code).test(await inc.innerText()) && await inc.getByRole('link', { name: /Live location/ }).isVisible());
        await p.screenshot({ path: `${OUT}/safety-desk.png`, fullPage: true });
        await inc.getByRole('button', { name: /Pick up/ }).click();
        await p.waitForTimeout(1500);
        check('picking it up clears the alarm bar', (await p.getByTestId('safety-alarm').count()) === 0);
        await inc.getByLabel('What was done').fill('Called: tyre burst, they were scared; sent a second car');
        await inc.getByRole('button', { name: 'Close the case' }).click();
        await p.waitForTimeout(1200);
        const [row] = (await db.execute(sql`SELECT status, note FROM safety_incidents WHERE code = ${sos.body.data.code}`)).rows as any[];
        check('closing records what was done', row?.status === 'resolved' && /second car/.test(row?.note ?? ''));
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    if (tripId) { await db.execute(sql.raw(`DELETE FROM safety_incidents WHERE trip_id = ${tripId}`)).catch(() => {}); await db.delete(travelTrips).where(eq(travelTrips.id, tripId)).catch(() => {}); }
    if (empIds.length) await db.delete(employees).where(inArray(employees.id, empIds)).catch(() => {});
    if (saved) await db.insert(integrationSettings).values(saved).onConflictDoUpdate({ target: integrationSettings.key, set: { config: saved.config } }).catch(() => {});
    else await db.delete(integrationSettings).where(eq(integrationSettings.key, 'travel')).catch(() => {});
    if (userIds.length) { await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',')})`)).catch(() => {}); await db.delete(users).where(inArray(users.id, userIds)).catch(() => {}); }
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by = ${adminId || 0}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    process.exit(summary());
});
