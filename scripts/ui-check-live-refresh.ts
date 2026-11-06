/**
 * Browser check: the admin Service Requests list keeps itself current, so a
 * booking created after the page opened appears without a reload. Needs the
 * built server running:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   npx tsx scripts/ui-check-live-refresh.ts
 */
import { chromium } from 'playwright';
import { sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const stamp = Date.now().toString(36);
let adminId = 0, custId = 0;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    custId = ((await db.execute(sql`INSERT INTO users (phone, username, role, is_active) VALUES (${`7${String(Date.now()).slice(-9)}`}, 'QA Live Customer', 'user', true) RETURNING id`)) as any).rows[0].id;

    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
        let calls = 0;
        p.on('request', r => { if (/\/api\/admin\/services\?/.test(r.url())) calls++; });
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/services', { waitUntil: 'networkidle' });
        const before = calls;
        // A booking made after the page loaded (as a customer would, from the app).
        await db.execute(sql`INSERT INTO service_requests (user_id, service_id, service_type, brand, model, description, address, pincode, status, booking_fee_status)
            VALUES (${custId}, ${`QA-LIVE-${stamp}`}, 'Fan repair', 'x', 'x', 'QA live refresh', 'QA Road', '577201', 'created', 'paid')`);
        const seen = await p.getByText(`QA-LIVE-${stamp}`).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
        check('a booking made after the page opened appears without a reload (within 30 s)', seen);
        check('…by the list re-fetching on its own', calls > before, `${before} → ${calls} list requests`);
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql`DELETE FROM service_requests WHERE service_id = ${`QA-LIVE-${stamp}`}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${custId}`);
    await db.execute(sql`DELETE FROM admin_users WHERE id = ${adminId}`).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
