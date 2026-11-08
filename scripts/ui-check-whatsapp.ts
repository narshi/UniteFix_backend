/**
 * Browser check: admin → WhatsApp, against a fake Meta on port 3999. Connect
 * (Meta's name and number appear), submit the template (Pending), Meta approves
 * it (Check status → Approved, "Sending automatically"). Needs the built server
 * pointed at the fake and at a test settings row:
 *   npm run build
 *   NODE_ENV=test WHATSAPP_GRAPH_BASE=http://127.0.0.1:3999 WHATSAPP_SETTINGS_KEY=whatsapp_ui_test PORT=3000 node dist/index.js
 *   npx tsx scripts/ui-check-whatsapp.ts
 */
import express from 'express';
import { chromium } from 'playwright';
import { eq, sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { integrationSettings } from '../shared/schema';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0;
const meta = { status: 'PENDING' };
const fake = express(); fake.use(express.json());
const ok = (req: any, res: any) => (req.headers.authorization === 'Bearer EAAG-ui-token' ? true : (res.status(401).json({ error: { message: 'Invalid OAuth access token.' } }), false));
fake.get('/:id', (req, res) => { if (ok(req, res)) res.json({ display_phone_number: '+91 80000 00000', verified_name: 'UniteFix' }); });
fake.post('/:waba/message_templates', (req, res) => { if (ok(req, res)) res.json({ id: 't1', status: 'PENDING' }); });
fake.get('/:waba/message_templates', (req, res) => { if (ok(req, res)) res.json({ data: [{ name: req.query.name, status: meta.status, language: 'en', category: 'UTILITY', rejected_reason: 'NONE' }] }); });
fake.post('/:id/messages', (req, res) => { if (ok(req, res)) res.json({ messages: [{ id: 'wamid.1' }] }); });

async function main() {
    const fakeServer = await new Promise<any>(r => { const s = fake.listen(3999, '127.0.0.1', () => r(s)); });
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const b = await chromium.launch();
    try {
        const p = await b.newPage({ viewport: { width: 1360, height: 1200 } });
        const errors: string[] = []; p.on('pageerror', e => errors.push(e.message));
        await p.goto(BASE + '/admin/login');
        await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [login.token, JSON.stringify(login.admin ?? {})]);
        await p.goto(BASE + '/admin/whatsapp', { waitUntil: 'networkidle' });
        check('the page opens: not connected', /Not connected/.test(await p.getByTestId('wa-state').innerText()));
        await p.getByLabel('Access token').fill('EAAG-ui-token');
        await p.getByLabel('Phone number ID').fill('109876543210987');
        await p.getByLabel('WhatsApp Business Account ID').fill('200000000000001');
        await p.getByRole('button', { name: 'Connect and check' }).click();
        await p.getByTestId('wa-number').waitFor({ timeout: 8000 });
        check('connecting shows the number Meta knows', /UniteFix · \+91 80000 00000/.test(await p.getByTestId('wa-number').innerText()));
        check('…the token field is cleared and shows only that one is saved', (await p.getByLabel('Access token').inputValue()) === '' && /Saved \(ends …oken\)/.test((await p.getByLabel('Access token').getAttribute('placeholder')) ?? ''));
        await p.getByRole('button', { name: 'Send it to Meta for approval' }).click();
        await p.getByTestId('wa-template-status').waitFor({ timeout: 8000 });
        check('the template goes to Meta: Pending', /Pending/.test(await p.getByTestId('wa-template-status').innerText()) && /Waiting for template approval/.test(await p.getByTestId('wa-state').innerText()));
        meta.status = 'APPROVED';
        await p.getByRole('button', { name: 'Check status' }).click();
        await p.waitForFunction(() => /Approved/.test(document.querySelector('[data-testid="wa-template-status"]')?.textContent ?? ''), null, { timeout: 8000 });
        await p.waitForTimeout(500);
        check('Meta approves it: Approved, and payment links go on WhatsApp automatically', /Sending automatically/.test(await p.getByTestId('wa-state').innerText()));
        await p.screenshot({ path: `${OUT}/whatsapp-page.png`, fullPage: true });
        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally { await b.close(); fakeServer.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.delete(integrationSettings).where(eq(integrationSettings.key, 'whatsapp_ui_test')).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'integration' AND changed_by = ${adminId || 0}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id = ${adminId || 0}`)).catch(() => {});
    process.exit(summary());
});
