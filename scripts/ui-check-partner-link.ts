/**
 * Browser check: a partner's public link page (/p/:code) on a phone and a
 * desktop, and the "Your customer link" card on their Hub Jobs page. Needs the
 * built server running:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-partner-link.ts
 */
import { chromium, devices } from 'playwright';
import { eq } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceCategories, services, partnerTerritories, partnerServices } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const [cat] = await db.insert(serviceCategories).values({ name: `QA UI Link ${stamp}` } as any).returning(); catIds.push(cat.id);
    const names = ['CCTV installation', 'Laptop repair', 'Wi-Fi setup'];
    const svcs = [];
    for (const nm of names) { const [s] = await db.insert(services).values({ categoryId: cat.id, name: `${nm}`, basePrice: 700, isActive: true } as any).returning(); svcIds.push(s.id); svcs.push(s); }
    const bp = await BusinessPartnerService.create({ legalName: `Poorvi Computers ${stamp}`, displayName: 'Poorvi Computers', contactPhone: phone(), contactEmail: `qa_uil_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
    bpIds.push(bp.id);
    await db.insert(partnerTerritories).values({ businessPartnerId: bp.id, pincode: '581401', mode: 'exclusive', status: 'active', activatedAt: new Date() } as any);
    for (const s of svcs) await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: s.id, name: s.name, isActive: true } as any);
    const [tu] = await db.insert(users).values({ phone: phone(), username: 'QA UI Tech', role: 'serviceman', isActive: true } as any).returning(); userIds.push(tu.id);
    await db.insert(employees).values({ userId: tu.id, fullName: 'QA UI Tech', documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: bp.id } as any);
    const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
    const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ol.username, password: ol.temporaryPassword }) })).json();
    const code = (await (await fetch(`${BASE}/api/public/partners/${bp.partnerCode}`)).json()).data.code as string;

    const b = await chromium.launch();
    try {
        // Phone (Android): the app button shows.
        const ctx = await b.newContext({ ...devices['Pixel 5'] });
        const p = await ctx.newPage();
        const errors: string[] = [];
        p.on('pageerror', e => errors.push(e.message));
        await p.goto(`${BASE}/p/${code}`, { waitUntil: 'networkidle' });
        await p.waitForTimeout(700);
        const t = await p.locator('body').innerText();
        check('phone: the link page shows the partner, "New on UniteFix", services and the code', t.includes('Poorvi Computers') && t.includes('New on UniteFix') && t.includes('CCTV installation') && t.includes(code), t.slice(0, 200));
        check('phone (Android): "Book … in the app" opens the app at this partner', (await p.getByRole('link', { name: /Book Poorvi in the app/ }).getAttribute('href'))?.startsWith(`intent://p/${code}`) === true);
        check('phone: no sideways scroll', (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
        await p.screenshot({ path: `${OUT}/link-phone.png`, fullPage: true });
        check('phone: no page errors', errors.length === 0, errors.join(' | '));
        await ctx.close();

        const d = await b.newPage({ viewport: { width: 1280, height: 900 } });
        await d.goto(`${BASE}/p/${code}`, { waitUntil: 'networkidle' });
        await d.waitForTimeout(700);
        check('desktop: no app button, "Get the UniteFix app" instead', !(await d.getByRole('link', { name: /in the app/ }).count()) && await d.getByRole('link', { name: 'Get the UniteFix app' }).isVisible());
        await d.screenshot({ path: `${OUT}/link-desktop.png` });
        await d.goto(`${BASE}/p/NOSUCH${stamp}`, { waitUntil: 'networkidle' });
        await d.waitForTimeout(500);
        check('a wrong code shows a plain message', /No UniteFix partner has this code/.test(await d.locator('body').innerText()));

        // The partner's Hub.
        const h = await b.newPage({ viewport: { width: 1360, height: 900 } });
        await h.goto(BASE + '/admin/login');
        await h.evaluate(([tk, u]) => { localStorage.setItem('adminToken', tk); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await h.goto(BASE + '/partner/field/jobs', { waitUntil: 'networkidle' });
        await h.getByText('Your customer link').waitFor({ timeout: 10_000 });
        const ht = await h.locator('body').innerText();
        check('Hub Jobs: "Your customer link" shows the code, link and bookings', ht.includes(code) && ht.includes(`/p/${code}`) && /0 bookings through your link/.test(ht), ht.slice(0, 300));
        check('…with a QR code and Copy / WhatsApp / Download buttons', await h.locator(`img[alt^="QR code"]`).isVisible() && await h.getByRole('button', { name: 'Copy code' }).isVisible() && await h.getByRole('button', { name: 'Share on WhatsApp' }).isVisible() && await h.getByRole('button', { name: 'Download QR' }).isVisible());
        await h.screenshot({ path: `${OUT}/hub-link.png` });
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM partner_territories WHERE business_partner_id IN (${bps})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`,
    ]);
    clearInterval(keepAlive);
    process.exit(summary());
});
