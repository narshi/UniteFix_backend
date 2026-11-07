/**
 * Browser check: the admin Service Catalog's Home showcase controls — a
 * category's tagline and yearly highlight (and its "Featured now" chip), and
 * ticking services to move them to another category. Needs the built server:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-category-showcase.ts
 */
import { chromium } from 'playwright';
import { inArray, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
const catIds: number[] = [], svcIds: number[] = [];
let adminId = 0;
const keepAlive = setInterval(() => {}, 1000);
const mmdd = (d: number) => new Date(Date.now() + 330 * 60_000 + d * 86_400_000).toISOString().slice(5, 10);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const [tax] = await db.insert(serviceCategories).values({ name: `QA Tax ITR ${stamp}`, sortOrder: -500, tagline: 'Tax, ITR and legal help', featureOn: true, featureFrom: mmdd(-3), featureTo: mmdd(3), featureTitle: 'ITR season is here' } as any).returning(); catIds.push(tax.id);
    const [visit] = await db.insert(serviceCategories).values({ name: `QA Visiting ${stamp}`, sortOrder: -499 } as any).returning(); catIds.push(visit.id);
    for (const n of ['AC repair', 'Fridge repair']) { const [s] = await db.insert(services).values({ categoryId: tax.id, name: `QA ${n} ${stamp}`, basePrice: 0, isActive: true } as any).returning(); svcIds.push(s.id); }

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/catalog', { waitUntil: 'networkidle' });
        const row = p.locator('button', { hasText: tax.name }).first();
        await row.waitFor({ timeout: 10_000 });
        check('a category highlighted now shows "Featured now" in the list', /Featured now/i.test(await row.innerText()), await row.innerText());

        // Its form: tagline and the yearly highlight.
        await row.hover();
        await p.locator('button:has(svg.lucide-pen), button:has(svg.lucide-edit), button:has(svg.lucide-square-pen)').first().click({ timeout: 5000 });
        await p.getByLabel('Tagline on the app').waitFor({ timeout: 5000 });
        check('the category form has the tagline', await p.getByLabel('Tagline on the app').inputValue() === 'Tax, ITR and legal help');
        check('…and the yearly highlight: on, from/to, title', await p.getByText("Highlight on the app's Home (every year)").isVisible()
            && await p.getByLabel('From month').inputValue() === mmdd(-3).slice(0, 2) && await p.getByLabel('Banner title').inputValue() === 'ITR season is here');
        await p.screenshot({ path: `${OUT}/showcase-form.png` });
        await p.keyboard.press('Escape');

        // Tick both services and move them.
        await p.locator('button', { hasText: tax.name }).first().click();
        for (const id of svcIds) {
            const [s] = await db.select({ name: services.name }).from(services).where(inArray(services.id, [id]));
            await p.getByLabel(`Select ${s.name}`).check();
        }
        await p.getByText('2 selected').waitFor({ timeout: 5000 });
        await p.getByLabel('Move to category').selectOption(String(visit.id));
        await p.screenshot({ path: `${OUT}/showcase-move.png` });
        await p.getByRole('button', { name: 'Move', exact: true }).click();
        await p.waitForTimeout(1200);
        const rows = await db.select({ cat: services.categoryId }).from(services).where(inArray(services.id, svcIds));
        check('ticking two services and Move puts them in the new category', rows.length === 2 && rows.every(r => r.cat === visit.id), JSON.stringify(rows));
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_category' AND entity_id IN (${catIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM services WHERE id IN (${svcIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id IN (${catIds.join(',') || '0'})`));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
