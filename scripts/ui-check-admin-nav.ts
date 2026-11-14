/**
 * Browser check: the admin menu in groups. The current page's group opens by
 * itself, groups fold and unfold, "Find a page" filters across groups, and a
 * super admin still reaches every page. Needs the built server:
 *   npm run build
 *   NODE_ENV=test PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-admin-nav.ts
 */
import { chromium } from 'playwright';
import { sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import fs from 'fs';

// Read the menu from the sidebar source (it imports browser-only modules).
const src = fs.readFileSync('client/src/components/admin/sidebar.tsx', 'utf8');
const navGroups = [...src.replace(/\r\n/g, '\n').matchAll(/label: "([^"]+)", icon: "[^"]+", items: \[([\s\S]*?)\n    \],/g)]
    .map(m => ({ label: m[1], items: [...m[2].matchAll(/href: "/g)] }));
if (navGroups.length < 5) throw new Error(`read ${navGroups.length} menu groups from the sidebar source`);

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0;

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); localStorage.removeItem('adminNavOpenGroups'); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/whatsapp', { waitUntil: 'networkidle' });
        const nav = p.getByRole('navigation').first();
        await nav.getByRole('button', { name: /Settings & System/ }).waitFor({ timeout: 8000 });

        const groupNames = navGroups.map(g => g.label);
        const shown = await Promise.all(groupNames.map(async n => (await nav.getByRole('button', { name: new RegExp(n.replace(/[&]/g, '\\&')) }).count()) > 0));
        check('a super admin sees every group', shown.every(Boolean), groupNames.filter((_, i) => !shown[i]).join(', '));
        check('the current page\'s group opens by itself, with the page marked', (await nav.getByRole('button', { name: /Settings & System/ }).getAttribute('aria-expanded')) === 'true'
            && (await nav.locator('a[aria-current="page"]').innerText()).includes('WhatsApp'));
        check('other groups start folded', (await nav.getByRole('button', { name: /^.*Bookings/ }).getAttribute('aria-expanded')) === 'false'
            && (await nav.getByRole('link', { name: 'Service Requests' }).count()) === 0);
        await p.screenshot({ path: `${OUT}/admin-nav-folded.png`, clip: { x: 0, y: 0, width: 300, height: 1000 } });

        await nav.getByRole('button', { name: /Bookings/ }).click();
        check('unfolding Bookings shows its pages', await nav.getByRole('link', { name: 'Book by Call' }).isVisible());
        await nav.getByRole('link', { name: 'Book by Call' }).click();
        await p.waitForURL(/book-by-call/);
        check('…and a page opens from it', (await nav.locator('a[aria-current="page"]').innerText()).includes('Book by Call'));
        await p.reload({ waitUntil: 'networkidle' });
        check('open groups are remembered after a reload', (await nav.getByRole('button', { name: /Settings & System/ }).getAttribute('aria-expanded')) === 'true'
            && (await nav.getByRole('button', { name: /Bookings/ }).getAttribute('aria-expanded')) === 'true');

        await p.getByLabel('Find a page').fill('with');
        check('"Find a page" filters across groups', (await nav.getByRole('link', { name: 'Withdrawals' }).isVisible()) && (await nav.getByRole('link', { name: 'Book by Call' }).count()) === 0);
        await p.screenshot({ path: `${OUT}/admin-nav-search.png`, clip: { x: 0, y: 0, width: 300, height: 600 } });
        await p.getByLabel('Find a page').fill('zzzz');
        check('…and says when nothing matches', await nav.getByText('No page called "zzzz".').isVisible());
        await p.getByLabel('Find a page').fill('');

        const total = navGroups.reduce((s, g) => s + g.items.length, 0) + 1;
        for (const g of navGroups) { const btn = nav.getByRole('button', { name: new RegExp(g.label.replace(/[&]/g, '\\&')) }); if ((await btn.getAttribute('aria-expanded')) === 'false') await btn.click(); }
        check('with every group open, all pages are in the menu', (await nav.getByRole('link').count()) === total, `${await nav.getByRole('link').count()} of ${total}`);
        await p.screenshot({ path: `${OUT}/admin-nav-open.png`, fullPage: true });
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    process.exit(summary());
});
