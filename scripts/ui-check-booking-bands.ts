/**
 * Browser check: booking bands in the admin Service Catalog (band chip, the
 * band fields in the category form), the admin Enquiries page, and the
 * partner Hub Enquiries page. Needs the built server running:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-booking-bands.ts
 */
import { chromium } from 'playwright';
import { eq, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, users, serviceCategories, services, partnerTerritories, partnerServices, serviceEnquiries } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
const keepAlive = setInterval(() => {}, 1000);
const login = async (username: string, password: string) => (await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).json());

async function main() {
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const [cat] = await db.insert(serviceCategories).values({ name: `QA UI Movers ${stamp}`, bookingBand: 'inspect_quote', inspectionFee: 149, bandColor: '#F59E0B', sortOrder: -100 } as any).returning(); catIds.push(cat.id);
    const [rcat] = await db.insert(serviceCategories).values({ name: `QA UI Travel ${stamp}`, bookingBand: 'referral', sortOrder: -99 } as any).returning(); catIds.push(rcat.id);
    const [svc] = await db.insert(services).values({ categoryId: rcat.id, name: `QA Goa trips ${stamp}`, basePrice: 0, isActive: true } as any).returning(); svcIds.push(svc.id);
    const bp = await BusinessPartnerService.create({ legalName: `QA UI Travels ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_uib_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
    bpIds.push(bp.id);
    await db.insert(partnerTerritories).values({ businessPartnerId: bp.id, pincode: '581401', mode: 'shared', status: 'active', activatedAt: new Date() } as any);
    await db.insert(partnerServices).values({ businessPartnerId: bp.id, catalogServiceId: svc.id, name: svc.name, isActive: true } as any);
    const [cu] = await db.insert(users).values({ phone: `7${String(Date.now()).slice(-9)}`, username: 'QA UI Enquirer', role: 'user', isActive: true } as any).returning(); userIds.push(cu.id);
    await db.insert(serviceEnquiries).values({ ref: `EQUI${stamp}`.slice(0, 20), userId: cu.id, catalogServiceId: svc.id, categoryId: rcat.id, serviceName: svc.name, pincode: '581401', details: 'Family trip to Goa for four people in December', budget: '₹40,000', notifiedPartnerIds: [bp.id] as any, staffDueAt: new Date(Date.now() - 60_000) } as any);
    const ol = await PartnerHubService.createOwnerLogin(bp.id, {});
    const [owner] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, ol.username)); adminIds.push(owner.id);
    const S = await login(sa.username, sa.password), H = await login(ol.username, ol.temporaryPassword);

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [S.token, JSON.stringify(S.admin ?? {})]);
        await p.goto(BASE + '/admin/catalog', { waitUntil: 'networkidle' });
        await p.getByText(cat.name).first().waitFor({ timeout: 10_000 });
        const row = p.locator('button', { hasText: cat.name }).first();
        check('Service Catalog: the category shows its band chip', /Inspect/i.test(await row.innerText()), await row.innerText());
        await p.screenshot({ path: `${OUT}/catalog.png` });
        // The category form has the band fields.
        await row.hover();
        await p.locator('button:has(svg.lucide-pen), button:has(svg.lucide-edit), button:has(svg.lucide-square-pen)').first().click({ timeout: 5000 }).catch(() => {});
        const formVisible = await p.getByLabel('How customers book').isVisible().catch(() => false);
        if (formVisible) {
            check('…the category form has the band picker, inspection fee and colours', await p.getByLabel('How customers book').inputValue() === 'inspect_quote' && await p.getByLabel(/Inspection fee/).inputValue() === '149' && await p.getByText('Band colour in the app').isVisible());
            await p.screenshot({ path: `${OUT}/catalog-form.png` });
        } else {
            check('…the category form opens (edit button)', false, 'edit button not found');
        }

        await p.goto(BASE + '/admin/enquiries', { waitUntil: 'networkidle' });
        await p.getByText(svc.name).first().waitFor({ timeout: 10_000 });
        const et = await p.locator('main').innerText();
        check('admin Enquiries: "Needs staff" lists it with the customer and the Needs staff flag', et.includes('QA UI Enquirer') && et.includes('Needs staff') && et.includes('Family trip to Goa'), et.slice(0, 300));
        await p.getByText(svc.name).first().click();
        check('…opening it shows the details and Forward / Mark called / Close', await p.getByRole('button', { name: 'Forward' }).isVisible() && await p.getByRole('button', { name: 'Mark called' }).isVisible() && await p.getByRole('button', { name: 'Close' }).isVisible());
        await p.screenshot({ path: `${OUT}/enquiries-admin.png` });
        check('admin pages: no page errors', errors.length === 0, errors.join(' | '));

        const h = await b.newPage({ viewport: { width: 1360, height: 900 } });
        await h.goto(BASE + '/admin/login');
        await h.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [H.token, JSON.stringify(H.admin ?? {})]);
        await h.goto(BASE + '/partner/field/enquiries', { waitUntil: 'networkidle' });
        await h.getByText(svc.name).first().waitFor({ timeout: 10_000 });
        check('Hub Enquiries: the partner sees it, Open, with a Take it button and no number yet', await h.getByRole('button', { name: 'Take it' }).isVisible() && !(await h.locator('body').innerText()).includes(cu.phone!));
        await h.getByRole('button', { name: 'Take it' }).click();
        await h.getByText(cu.phone!).waitFor({ timeout: 8000 });
        check('…taking it shows the customer\'s number', (await h.locator('body').innerText()).includes(cu.phone!));
        await h.screenshot({ path: `${OUT}/enquiries-hub.png` });
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0', bps = bpIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM audit_logs WHERE entity_type = 'service_enquiry' AND entity_id IN (SELECT id FROM service_enquiries WHERE user_id IN (${uids}))`,
        `DELETE FROM service_enquiries WHERE user_id IN (${uids})`,
        `DELETE FROM hub_alerts WHERE business_partner_id IN (${bps})`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM partner_territories WHERE business_partner_id IN (${bps})`,
        `DELETE FROM users WHERE id IN (${uids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`,
    ]);
    clearInterval(keepAlive);
    process.exit(summary());
});
