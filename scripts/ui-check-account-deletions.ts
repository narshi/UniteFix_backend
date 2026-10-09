/**
 * Browser check of the staff page for account deletion requests: seeds one
 * pending request, opens the page, screenshots it and the approve dialog,
 * fails on console errors, and removes everything.
 *
 *   UI_BASE=http://127.0.0.1:3056 UI_OUT=../ui-shots/account-deletions npx tsx scripts/ui-check-account-deletions.ts
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { eq } from 'drizzle-orm';
import { makeSuperAdmin, db, cleanupPartners } from './lib/hub-test-kit';
import { users, adminUsers } from '../shared/schema';
import { AccountDeletionService } from '../server/services/account-deletion.service';

const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:3056';
const OUT = process.env.UI_OUT ?? 'ui-shots/account-deletions';
fs.mkdirSync(OUT, { recursive: true });
const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [];

async function main() {
    const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
    const [u] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'Ravi Kumar', role: 'user', email: 'ravi@example.test', isActive: true } as any).returning();
    userIds.push(u.id);
    await AccountDeletionService.request(u.id, { reasonCategory: 'privacy', reason: 'I would rather not have my home address stored with any app. Please remove my account.' });
    const login = await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.7.7.7' }, body: JSON.stringify({ username: sa.username, password: sa.password }) }).then(r => r.json());
    const [sau] = await db.select().from(adminUsers).where(eq(adminUsers.id, sa.id));
    const browser = await chromium.launch();
    const errors: string[] = [];
    for (const width of [1360, 390]) {
        const page = await browser.newPage({ viewport: { width, height: width > 500 ? 900 : 844 } });
        page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`${BASE}/`);
        await page.evaluate(([t, a]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', a); }, [login.token, JSON.stringify({ id: sau.id, username: sau.username, role: 'super_admin' })]);
        await page.goto(`${BASE}/admin/account-deletions`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(800);
        const text = await page.locator('body').innerText();
        if (!/Ravi Kumar/.test(text) || !/Privacy concerns/.test(text)) errors.push(`@${width}: request not shown`);
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push(`@${width}: horizontal overflow`);
        await page.screenshot({ path: `${OUT}/list-${width}.png`, fullPage: true });
        if (width > 500) {
            await page.getByRole('button', { name: 'Approve deletion' }).first().click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${OUT}/approve-dialog.png` });
        }
        await page.close();
    }
    await browser.close();
    console.log(errors.length ? `FAIL\n${errors.join('\n')}` : 'OK — list, approve dialog, phone width');
    process.exitCode = errors.length ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
    const uids = userIds.join(',') || '0';
    await cleanupPartners([], adminIds, [
        `DELETE FROM account_deletion_requests WHERE user_id IN (${uids})`,
        `DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(process.exitCode ?? 0);
});
