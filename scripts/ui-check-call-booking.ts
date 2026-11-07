/**
 * Browser check: admin → Book by call. A new caller's number, their name, a
 * service (price shows, ₹0 now), address and pincode → Book → the booking
 * reference, a "Booked by call" row in the database, the recent list, and the
 * badge on Service Requests. Fixtures are removed afterwards. Needs the built server:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-call-booking.ts
 */
import { chromium } from 'playwright';
import { eq, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services, serviceRequests, users } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0, catId = 0, userId = 0;
const srIds: number[] = [];
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const [cat] = await db.insert(serviceCategories).values({ name: `QA Plumbing ${stamp}`, sortOrder: -950, isActive: true } as any).returning(); catId = cat.id;
    const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Tap repair ${stamp}`, basePrice: 349, isActive: true, status: 'ACTIVE' } as any).returning();
    let phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
    while ((await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length) phone = '6' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/book-by-call', { waitUntil: 'networkidle' });
        check('the page opens from the sidebar route', await p.getByRole('heading', { name: 'Book by call' }).isVisible());

        await p.getByLabel('Mobile number').fill(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
        await p.getByLabel('Name (new customer)').waitFor({ timeout: 8000 });
        check('an unknown number asks for the new customer\'s name', true);
        await p.getByLabel('Name (new customer)').fill(`QA Caller ${stamp}`);
        await p.locator('#cb-cat').selectOption(String(cat.id));
        await p.locator('#cb-svc').selectOption(String(svc.id));
        await p.getByLabel('More').click();
        await p.getByLabel("The problem, in the customer's words").fill('Kitchen tap leaking');
        await p.getByLabel('Address for the visit').fill('12, 3rd Cross, Jayanagar');
        await p.getByLabel('Pincode').fill('560011');
        await p.getByLabel('Note for the team (not shown to the customer)').fill('Prefers a morning visit');
        await p.waitForFunction(() => document.querySelector('[data-testid="cb-total"]')?.textContent === '₹698', null, { timeout: 8000 }).catch(() => {});
        check('the summary shows the price for two and ₹0 now', (await p.getByTestId('cb-total').innerText()) === '₹698' && await p.getByText('₹0', { exact: true }).isVisible());
        await p.screenshot({ path: `${OUT}/call-booking-form.png`, fullPage: true });

        await p.getByRole('button', { name: 'Book for the customer' }).click();
        await p.getByRole('heading', { name: /^Booked SR\d+/ }).waitFor({ timeout: 10000 });
        const ref = (await p.getByRole('heading', { name: /^Booked SR\d+/ }).innerText()).replace('Booked ', '');
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.serviceId, ref));
        if (sr) { srIds.push(sr.id); userId = sr.userId; }
        check('booking shows the reference, and the row is booked by call with the note', !!sr && sr.bookedVia === 'call' && sr.bookingNote === 'Prefers a morning visit' && sr.quantity === 2 && sr.totalAmount === 698 && sr.bookingFee === 0, JSON.stringify(sr ?? null));
        check('…the recent list shows it with who booked it', await p.getByRole('cell', { name: new RegExp(ref) }).isVisible() && await p.getByRole('cell', { name: sa.username }).first().isVisible());
        await p.screenshot({ path: `${OUT}/call-booking-done.png`, fullPage: true });

        await p.goto(BASE + '/services', { waitUntil: 'networkidle' });
        await p.waitForTimeout(1000);
        const row = p.locator('tr', { hasText: ref }).first();
        check('Service Requests shows the "Booked by call" badge on it', (await row.count()) > 0 && /Booked by call/.test(await row.innerText()), (await row.count()) ? await row.innerText() : 'row not on the first page');
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await new Promise(r => setTimeout(r, 2500));   // the booking notification lands in the background
    for (const id of srIds) {
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id = ${id}`)).catch(() => {});
        await db.delete(serviceRequests).where(eq(serviceRequests.id, id)).catch(e => console.error('cleanup sr', e.message));
    }
    if (userId) {
        await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id = ${userId}`)).catch(() => {});
        await db.execute(sql.raw(`DELETE FROM customers WHERE user_id = ${userId}`)).catch(() => {});
        await db.execute(sql.raw(`DELETE FROM users WHERE id = ${userId} AND username LIKE 'QA Caller %'`)).catch(e => console.error('cleanup user', e.message));
    }
    await db.execute(sql.raw(`DELETE FROM services WHERE category_id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
