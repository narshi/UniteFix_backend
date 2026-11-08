/**
 * Browser check: admin → Book by call. A new caller's number, their name, a
 * service (price shows, the booking fee now by payment link), address and
 * pincode → Book and send the link → the reference, the link and where it went,
 * a waiting row; "Pay after service" switches it; the badge on Service Requests.
 * Fixtures are removed afterwards. Needs the built server in TEST mode with fake
 * payment links and no email/SMS (never real Razorpay links):
 *   npm run build
 *   NODE_ENV=test PAYMENT_LINKS_MOCK=1 SMTP_HOST= ADMIN_ALERT_EMAIL= MSG91_API_KEY= PORT=3000 node dist/index.js
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
        check('the summary shows ₹698 for two, and by link the booking fee now', (await p.getByTestId('cb-total').innerText()) === '₹698' && /^₹\d+$/.test(await p.getByTestId('cb-paynow').innerText()) && (await p.getByTestId('cb-paynow').innerText()) !== '₹0');
        await p.getByLabel('Email for the link (optional)').fill('qa.caller@example.com');
        await p.screenshot({ path: `${OUT}/call-booking-form.png`, fullPage: true });

        await p.getByRole('button', { name: 'Book and send the payment link' }).click();
        await p.getByRole('heading', { name: /^Booked SR\d+/ }).waitFor({ timeout: 10000 });
        const ref = (await p.getByRole('heading', { name: /^Booked SR\d+/ }).innerText()).replace('Booked ', '');
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.serviceId, ref));
        if (sr) { srIds.push(sr.id); userId = sr.userId; }
        check('booked by call with the note, waiting for its fee, with a link', !!sr && sr.bookedVia === 'call' && sr.bookingNote === 'Prefers a morning visit' && sr.quantity === 2 && sr.totalAmount === 698 && sr.bookingFeeStatus === 'pending' && !!sr.paymentLinkUrl, JSON.stringify(sr ?? null));
        const result = await p.getByTestId('link-result').innerText();
        check('…the page shows the link, SMS and email sent, WhatsApp not set up, and a WhatsApp Web button', result.includes(sr!.paymentLinkUrl!) && /SMS/.test(result) && /Email/.test(result) && /WhatsApp: WhatsApp is not set up/.test(result) && await p.getByRole('button', { name: 'Open in WhatsApp Web' }).isVisible(), result);
        await p.screenshot({ path: `${OUT}/call-booking-done.png`, fullPage: true });
        const recentRow = p.getByTestId(`recent-${ref}`);
        check('…the recent list shows it waiting, with resend and copy', /Waiting for ₹\d+/.test(await recentRow.innerText()) && await recentRow.getByRole('button', { name: 'Resend' }).isVisible());
        await recentRow.getByRole('button', { name: 'Resend' }).click();
        await p.waitForTimeout(1200);
        const [afterResend] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, sr!.id));
        check('Resend sends it again (logged on the booking)', ((afterResend.paymentLinkSends as any[]) ?? []).length >= 5);
        await recentRow.getByRole('button', { name: 'Pay after service' }).click();
        await p.waitForTimeout(1500);
        const [switched] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, sr!.id));
        check('"Pay after service" switches it: no fee, into the queue, the row says so', switched.bookingFeeStatus === 'paid' && switched.bookingFee === 0 && switched.paymentLinkStatus === 'cancelled' && /After the service/.test(await recentRow.innerText()));
        await p.screenshot({ path: `${OUT}/call-booking-recent.png`, fullPage: true });

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
        await db.execute(sql.raw(`DELETE FROM payment_transactions WHERE service_request_id = ${id}`)).catch(() => {});
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
