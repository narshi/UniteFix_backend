/**
 * Browser check of the Partner Hub: seeds a partner with every module, signs
 * in, opens every Hub page, the public pages and the staff pages in Chromium
 * (Playwright), fails on console errors, crashes or blank pages, saves a
 * screenshot of each, checks a phone-width page for sideways scroll, and
 * removes everything it created.
 *
 *   1. npm run build
 *   2. NODE_ENV=production PORT=3056 CLIENT_URL=http://127.0.0.1:3056 node dist/index.js
 *   3. UI_BASE=http://127.0.0.1:3056 UI_OUT=./ui-shots npx tsx scripts/ui-check-hub.ts
 *
 * (Run against the built app: CLIENT_URL must allow the origin, or the
 * production CORS check rejects the module script.)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import { client, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, employees, productCategories } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:3056';
const OUT = process.env.UI_OUT ?? 'ui-shots';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [];
let catId = 0;
const inDays = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
    const api = client(BASE);
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const staff = (await api.login(sa.username, sa.password))!;
    const bp = await BusinessPartnerService.create({
        legalName: `QA Coastal Tech Services ${stamp}`, displayName: 'Coastal Tech', gstin: await gstinFor('29', 'QACST1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
        contactEmail: `qa_ui_${stamp}@example.test`, verticalCodes: ['computer', 'consultation', 'events', 'electronics'], approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada', address: 'Karwar',
    });
    bpIds.push(bp.id);
    await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', hubPlan: 'pro', grievanceName: 'Ravi', grievancePhone: '9845000111', grievanceEmail: 'help@coastal.example', returnPolicy: '7 days' }).where(eq(businessPartners.id, bp.id));
    const login = await PartnerHubService.createOwnerLogin(bp.id, {});
    const [ar] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, login.username)); adminIds.push(ar.id);
    const t = (await api.login(login.username, login.temporaryPassword))!;
    const me = (await api.get('/api/hub/me', t)).body?.data ?? null;

    // ── seed a little of everything ──────────────────────────────────────
    const c = await api.post('/api/hub/customers', { name: 'QA Meera Naik', phone: '9811122233', address: 'MG Road, Karwar', pincode: '581301' }, t);
    const cid = c.body?.data?.id;
    const inv = await api.post('/api/hub/invoices', { customerId: cid, dueDate: inDays(10), lines: [{ description: 'Laptop service', hsnSac: '998713', quantity: 1, rateRupees: 1200, gstRate: 18 }, { description: 'SSD 512GB', hsnSac: '847170', quantity: 1, unit: 'pcs', rateRupees: 3500, gstRate: 18 }] }, t);
    await api.post('/api/hub/quotations', { customerId: cid, lines: [{ description: 'CCTV 4-camera kit', hsnSac: '852589', quantity: 1, rateRupees: 18000, gstRate: 18 }] }, t);
    await api.post('/api/hub/field/territories', { pincodes: '581302, 581303', area: 'Karwar outskirts' }, t);
    await api.post('/api/hub/field/technicians', { fullName: 'QA Suresh', phone: `9${String(Date.now()).slice(-9)}`, services: ['Laptop'] }, t);
    const svc = await api.post('/api/hub/consulting/services', { name: 'IT audit session', kind: 'fixed', priceRupees: 2500, durationMinutes: 60, mode: 'both' }, t);
    await api.put('/api/hub/consulting/availability', { windows: [1, 2, 3, 4, 5].map(d => ({ weekday: d, startTime: '10:00', endTime: '13:00' })) }, t);
    const slots = await api.get(`/api/hub/consulting/slots?serviceId=${svc.body.data.id}&days=10`, t);
    if (slots.body?.data?.[0]) await api.post('/api/hub/consulting/appointments', { customerId: cid, serviceId: svc.body.data.id, startsAt: slots.body.data[0].startsAt, mode: 'online', meetingLink: 'https://meet.example/x' }, t);
    await api.post('/api/hub/consulting/retainers', { customerId: cid, title: 'Managed IT', monthlyFeeRupees: 8000, billingDay: 28, startDate: inDays(0) }, t);
    const pk = await api.post('/api/hub/events/packages', { name: 'Banquet hall', category: 'venue', priceRupees: 40000 }, t);
    await api.post('/api/hub/events/packages', { name: 'Veg buffet', category: 'catering', unit: 'plate', priceRupees: 400, sac: '996337', gstRate: 5 }, t);
    await api.post('/api/hub/events/vendors', { name: 'QA Flowers', category: 'decor' }, t);
    const enq = await api.post('/api/hub/events/enquiries', { name: 'QA Kavya', phone: '9876500011', eventType: 'Wedding reception', eventDate: inDays(30), guests: 150 }, t);
    const q = await api.post(`/api/hub/events/enquiries/${enq.body.data.id}/quote`, { packages: [{ packageId: pk.body.data.id, quantity: 1 }] }, t);
    const share = await api.post(`/api/hub/events/quotations/${q.body.data.id}/share`, {}, t);
    await api.post(`/api/public${share.body.data.link}/respond`, { decision: 'accept' });
    const bk = await api.post('/api/hub/events/bookings', { quotationId: q.body.data.id, title: 'Kavya reception' }, t);
    const [cat] = await db.insert(productCategories).values({ name: `QA UI Net ${stamp}`, slug: `qa-ui-${stamp}` }).returning(); catId = cat.id;
    await api.post('/api/hub/store/listings', { name: 'Dual-band router', categoryId: cat.id, priceRupees: 2499, mrpRupees: 2999, stock: 10, hsnCode: '85176290', gstPercent: 18, countryOfOrigin: 'India', manufacturer: 'QA Networks' }, t);

    // ── browse ───────────────────────────────────────────────────────────
    const pages = [
        '/partner', '/partner/onboarding', '/partner/settings', '/partner/team', '/partner/documents',
        '/partner/customers', `/partner/customers/${cid}`, '/partner/sales/invoices', `/partner/sales/invoices/${inv.body?.data?.id}`, '/partner/sales/invoices/new',
        '/partner/sales/quotations', '/partner/sales/quotations/new', '/partner/gst', '/partner/purchases', '/partner/money',
        '/partner/parts', '/partner/parts/orders',
        '/partner/field/jobs', '/partner/field/technicians', '/partner/field/territory', '/partner/field/rates', '/partner/field/warranty', '/partner/field/earnings',
        '/partner/consulting/appointments', '/partner/consulting/calendar', '/partner/consulting/services', '/partner/consulting/retainers',
        '/partner/events/enquiries', '/partner/events/quotations', '/partner/events/bookings', `/partner/events/bookings/${bk.body?.data?.id}`, '/partner/events/calendar', '/partner/events/packages', '/partner/events/vendors',
        '/partner/store/listings', '/partner/store/orders', '/partner/store/reviews',
    ];
    const publicPages = [`/book/${bp.partnerCode}`, `/events/${bp.partnerCode}`, share.body.data.link, '/apply'];
    const adminPages = ['/admin/partner-territories', '/admin/marketplace', '/admin/partner-settlements', '/admin/business-partners'];

    const browser = await chromium.launch();
    const results: Array<{ path: string; ok: boolean; errors: string[]; title: string }> = [];
    async function visit(ctxToken: string | null, user: any, path: string, shot: string) {
        const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
        const errors: string[] = [];
        page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(m.text())) errors.push(m.text().slice(0, 300)); });
        page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        if (ctxToken) await page.evaluate(([tk, u]) => { localStorage.setItem('adminToken', tk as string); localStorage.setItem('adminUser', u as string); }, [ctxToken, JSON.stringify(user)]);
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(e => errors.push(`nav: ${e.message.slice(0, 120)}`));
        await page.waitForTimeout(800);
        const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
        const h1 = await page.locator('h1').first().innerText().catch(() => '');
        const crashed = /Something went wrong|Unexpected Application Error|is not a function|Cannot read properties/i.test(text) || text.trim().length < 30;
        await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });
        results.push({ path, ok: !crashed && errors.length === 0, errors: crashed ? [`crash/blank: ${text.slice(0, 200)}`, ...errors] : errors, title: h1 });
        await page.close();
    }
    const userObj = { id: ar.id, username: login.username, role: 'partner' };
    let i = 0;
    for (const p of pages) await visit(t, userObj, p, `hub-${String(++i).padStart(2, '0')}-${p.replace(/\W+/g, '_')}`);
    for (const p of publicPages) await visit(null, null, p, `public-${String(++i).padStart(2, '0')}-${p.split('/')[1]}`);
    const [sau] = await db.select().from(adminUsers).where(eq(adminUsers.id, sa.id));
    for (const p of adminPages) await visit(staff, { id: sau.id, username: sau.username, role: 'super_admin' }, p, `admin-${String(++i).padStart(2, '0')}-${p.replace(/\W+/g, '_')}`);
    // mobile width spot check
    const mpage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mpage.goto(`${BASE}/`); await mpage.evaluate(([tk, u]) => { localStorage.setItem('adminToken', tk as string); localStorage.setItem('adminUser', u as string); }, [t, JSON.stringify(userObj)]);
    await mpage.goto(`${BASE}/partner/sales/invoices`, { waitUntil: 'networkidle' }); await mpage.waitForTimeout(600);
    const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await mpage.screenshot({ path: `${OUT}/mobile-invoices.png` });
    await browser.close();
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, mobileOverflow: overflow, nav: me?.modules }, null, 2));
    const failed = results.filter(r => !r.ok).length;
    for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.path}  [${r.title}]${r.errors.length ? '\n     ' + r.errors.join('\n     ') : ''}`);
    console.log(`mobile horizontal overflow on invoices: ${overflow}`);
    console.log(`
${results.length - failed}/${results.length} pages OK`);
    process.exitCode = failed || overflow ? 1 : 0;
}

main().catch(e => { console.error(e); }).finally(async () => {
    const bp = bpIds.join(',') || '0';
    const techs = bpIds.length ? await db.select({ u: employees.userId }).from(employees).where(eq(employees.managedByPartnerId, bpIds[0])) : [];
    const tu = techs.map(x => x.u).join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM consult_retainer_bills WHERE retainer_id IN (SELECT id FROM consult_retainers WHERE business_partner_id IN (${bp}))`,
        ...['consult_appointments', 'consult_retainers', 'consult_services', 'consult_availability', 'consult_time_off'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bp})`),
        `DELETE FROM event_vendor_costs WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
        `DELETE FROM event_milestones WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
        ...['event_bookings', 'event_enquiries', 'event_vendors', 'event_packages', 'partner_territories', 'partner_service_rates'].map(x => `DELETE FROM ${x} WHERE business_partner_id IN (${bp})`),
        `DELETE FROM products WHERE seller_partner_id IN (${bp})`,
        `DELETE FROM product_categories WHERE id = ${catId || 0}`,
        `DELETE FROM employees WHERE managed_by_partner_id IN (${bp})`,
        `DELETE FROM users WHERE id IN (${tu})`,
    ]);
    process.exit(process.exitCode ?? 0);
});
