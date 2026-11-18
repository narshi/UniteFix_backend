/**
 * Browser check: any staff member changes their own password from the menu
 * ("Change password" above Secure Logout); the old one stops working.
 *   npm run build
 *   NODE_ENV=test PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-admin-password.ts
 */
import { chromium } from 'playwright';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0;
const login = async (username: string, password: string) => (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).status;

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const res: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [res.token, JSON.stringify(res.admin ?? {})]);
        await p.goto(BASE + '/admin/travel/places', { waitUntil: 'networkidle' });
        await p.getByRole('button', { name: 'Change password' }).click();
        await p.getByLabel('Current password').fill('wrong-password-123');
        await p.getByLabel('New password', { exact: true }).fill('Fresh-Pass-2026!');
        await p.getByLabel('New password again').fill('Fresh-Pass-2026!');
        await p.getByRole('dialog').getByRole('button', { name: 'Change password' }).click();
        await p.waitForTimeout(800);
        check('a wrong current password is refused', /current password is not right/i.test(await p.locator('body').innerText()));
        await p.getByLabel('Current password').fill(sa.password);
        await p.getByLabel('New password again').fill('Fresh-Pass-2026?');
        check('two different new passwords are caught before sending', /two new passwords differ/.test(await p.getByRole('dialog').innerText()) && await p.getByRole('dialog').getByRole('button', { name: 'Change password' }).isDisabled());
        await p.getByLabel('New password again').fill('Fresh-Pass-2026!');
        await p.screenshot({ path: `${OUT}/change-password.png` });
        await p.getByRole('dialog').getByRole('button', { name: 'Change password' }).click();
        await p.waitForTimeout(1200);
        check('the password changes and the dialog closes', (await p.getByRole('dialog').count()) === 0 && /Password changed/.test(await p.locator('body').innerText()));
        const [row] = (await db.execute(sql`SELECT password FROM admin_users WHERE id = ${sa.id}`)).rows as any[];
        check('the new password signs in; the old one no longer matches', (await login(sa.username, 'Fresh-Pass-2026!')) === 200 && !(await bcrypt.compare(sa.password, row.password)) && await bcrypt.compare('Fresh-Pass-2026!', row.password));
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}
main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE changed_by = ${adminId || 0}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    process.exit(summary());
});
