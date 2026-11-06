/**
 * Browser check: Dashboard → "Jobs waiting for an expert" offers "Send to
 * partner" next to "Assign Employee", and it opens the partner picker. Needs
 * the built server running:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-dashboard-partner.ts
 */
import { chromium } from 'playwright';
import { sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0, custId = 0;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    custId = ((await db.execute(sql`INSERT INTO users (phone, username, role, is_active) VALUES (${`7${String(Date.now()).slice(-9)}`}, 'QA Dash Customer', 'user', true) RETURNING id`)) as any).rows[0].id;
    await db.execute(sql`INSERT INTO service_requests (user_id, service_id, service_type, brand, model, description, address, pincode, status, booking_fee_status)
        VALUES (${custId}, ${`QA-DASH-${stamp}`}, 'Fan repair', 'x', 'x', 'QA dashboard partner', 'QA Road', '577201', 'created', 'paid')`);

    const b = await chromium.launch();
    try {
        for (const width of [1360, 390]) {
            const p = await b.newPage({ viewport: { width, height: 900 } });
            const errors: string[] = [];
            p.on('pageerror', e => errors.push(e.message));
            await p.goto(BASE + '/admin/login');
            await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
            await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' });
            const row = p.locator('tr', { hasText: `QA-DASH-${stamp}` });
            check(`[${width}] the waiting job shows both Assign Employee and Send to partner`, await row.getByRole('button', { name: 'Assign Employee' }).isVisible() && await row.getByRole('button', { name: 'Send to partner' }).isVisible());
            await row.getByRole('button', { name: 'Send to partner' }).click();
            const dlg = p.getByRole('dialog');
            await dlg.getByText('Send to a partner').waitFor({ timeout: 10_000 });
            await p.waitForTimeout(800);
            const t = await dlg.innerText();
            check(`[${width}] Send to partner opens the partner picker for that job`, new RegExp(`QA-DASH-${stamp}`).test(t) && !/Loading…/.test(t), t.slice(0, 220));
            await p.screenshot({ path: `${OUT}/dash-partner-${width}.png`, fullPage: false });
            const scroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            check(`[${width}] no sideways scroll`, scroll <= 1, String(scroll));
            check(`[${width}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200));
            await p.close();
        }
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql`DELETE FROM service_requests WHERE service_id = ${`QA-DASH-${stamp}`}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${custId}`);
    await db.execute(sql`DELETE FROM admin_users WHERE id = ${adminId}`).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
