/**
 * Browser check: admin → Home screen. Staff start a "Monsoon" set from a quick
 * start, add two cards (a category with an app photo, a screen), save, and the
 * preview for a monsoon day shows its heading and cards, topped up with the
 * built-in four. The set is Jun–Sep, so it is not live on the real Home today
 * (November), and it is deleted afterwards. Needs the built server:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-home-screen.ts
 */
import { chromium } from 'playwright';
import { eq, like, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services, homeCardSets } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0, catId = 0;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const month = new Date(Date.now() + 330 * 60_000).getUTCMonth() + 1;
    if (month >= 6 && month <= 9) { check('run outside June–September (the test set would be live)', false); return; }
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const [cat] = await db.insert(serviceCategories).values({ name: `QA Electrical ${stamp}`, sortOrder: -800, isActive: true } as any).returning(); catId = cat.id;
    await db.insert(services).values({ categoryId: cat.id, name: `QA Fan fitting ${stamp}`, basePrice: 249, isActive: true, status: 'ACTIVE' } as any);

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/home-screen', { waitUntil: 'networkidle' });
        check('the page opens and offers season quick starts', await p.getByText('Home screen', { exact: true }).first().isVisible());
        await p.screenshot({ path: `${OUT}/home-screen-page.png`, fullPage: true });

        // Start from "Monsoon", name it, add a category card with an app photo and a screen card.
        const quick = p.getByRole('button', { name: /Monsoon · 1 Jun – 30 Sep/ }).first();
        if (!(await quick.isVisible())) await p.getByText('Start a new set from a season').click();
        await quick.click();
        await p.getByLabel('Name (for staff)').fill(`QA Monsoon ${stamp}`);
        check('the quick start filled the heading and the dates', await p.getByLabel('Heading on the app').inputValue() === 'Monsoon care' && await p.getByText('Every year, 1 Jun – 30 Sep').first().isVisible());
        await p.getByRole('button', { name: 'Add card' }).click();
        await p.getByLabel('Card 1 category').selectOption(String(cat.id));
        await p.getByLabel('Card 1 photo').selectOption('library');
        await p.getByLabel('Card 1 library photo').selectOption('wiring');
        await p.getByLabel('Card 1 label').fill('Wiring check');
        await p.getByRole('button', { name: 'Add card' }).click();
        await p.getByLabel('Card 2 opens').selectOption('screen');
        await p.getByLabel('Card 2 screen').selectOption('recharge');
        check('card rows show the photo the app will use', await p.locator('[data-testid="card-row-1"] img').getAttribute('src').then(s => /wiring/.test(s ?? '')));
        await p.screenshot({ path: `${OUT}/home-screen-editor.png` });
        await p.getByRole('button', { name: 'Save set' }).click();
        await p.waitForTimeout(1500);

        const [row] = await db.select().from(homeCardSets).where(eq(homeCardSets.name, `QA Monsoon ${stamp}`));
        check('saving stores the set: yearly 1 Jun – 30 Sep, two cards in order', !!row && row.schedule === 'yearly' && row.fromMmdd === '06-01' && row.toMmdd === '09-30' && (row.cards as any[]).length === 2 && (row.cards as any[])[0].id === cat.id && (row.cards as any[])[0].photo.key === 'wiring' && (row.cards as any[])[1].screen === 'recharge', JSON.stringify(row ?? null));

        // Preview a monsoon day far ahead.
        await p.getByLabel('Preview date').fill('2099-07-15');
        await p.waitForTimeout(1500);
        const heading = await p.getByTestId('preview-heading').innerText();
        const cards = await p.getByTestId('preview-cards').innerText();
        check('the preview for 15 July shows the set\'s heading', heading === 'Monsoon care', heading);
        check('…its cards first, then built-in ones to make four', /Wiring check[\s\S]*Broadband recharge/.test(cards) && (cards.match(/built-in|filled in/g) ?? []).length >= 2, cards.replace(/\n/g, ' | '));
        check('…and the set is marked as the one showing that day', await p.getByText('Showing that day').first().isVisible());
        await p.screenshot({ path: `${OUT}/home-screen-preview.png`, fullPage: true });
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const rows = await db.select({ id: homeCardSets.id }).from(homeCardSets).where(like(homeCardSets.name, `QA Monsoon ${stamp}%`));
    for (const r of rows) {
        await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'home_card_set' AND entity_id = ${r.id}`));
        await db.delete(homeCardSets).where(eq(homeCardSets.id, r.id));
    }
    await db.execute(sql.raw(`DELETE FROM services WHERE category_id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM service_categories WHERE id = ${catId || 0}`));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
