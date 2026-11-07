/**
 * Browser check: the admin Service Catalog's service form has "Typical duration",
 * and saving it stores the value. Needs the built server:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-service-duration.ts
 */
import { chromium } from 'playwright';
import { eq, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0, catId = 0;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const [cat] = await db.insert(serviceCategories).values({ name: `QA Duration ${stamp}`, sortOrder: -600 } as any).returning(); catId = cat.id;

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/catalog', { waitUntil: 'networkidle' });
        await p.locator('button', { hasText: cat.name }).first().click();
        await p.getByRole('button', { name: /Add Service/ }).click();
        const field = p.getByLabel('Typical duration');
        await field.waitFor({ timeout: 5000 });
        check('the service form has "Typical duration"', await field.isVisible());
        await p.locator('#svc-name, input[name="name"]').last().fill(`QA Tap fitting ${stamp}`);
        await field.fill('30–45 mins');
        await p.screenshot({ path: `${OUT}/duration-form.png` });
        await p.getByRole('button', { name: /^(Save|Create|Add)( Service)?$/i }).last().click();
        await p.waitForTimeout(1500);
        const [row] = await db.select({ d: services.durationLabel }).from(services).where(eq(services.name, `QA Tap fitting ${stamp}`));
        check('saving stores the duration', row?.d === '30–45 mins', JSON.stringify(row ?? null));
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql.raw(`DELETE FROM services WHERE category_id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
