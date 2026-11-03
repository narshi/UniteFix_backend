/**
 * Browser check: Admin → Withdrawals → "Retry payout" offers UPI and bank
 * (IMPS / NEFT / RTGS), and "Pay manually instead". Never presses the
 * Cashfree send. Needs the built server running:
 *   npm run build; NODE_ENV=production PORT=3000 node dist/index.js  (localhost:3000 passes CORS)
 *   UI_BASE=http://localhost:3000 npx tsx scripts/ui-check-withdrawal-retry.ts
 */
import { chromium } from 'playwright';
import { sql } from 'drizzle-orm';
import { check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';

const BASE = process.env.UI_BASE ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const stamp = Date.now().toString(36);
let adminId = 0, userId = 0, empId = 0, wId = 0;
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const sa = await makeSuperAdmin(stamp); adminId = sa.id;
    const login: any = await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: sa.password }) })).json();
    const token = login.token;
    const phone = `9${String(Date.now()).slice(-9)}`;
    userId = ((await db.execute(sql`INSERT INTO users (phone, username, role, is_active) VALUES (${phone}, 'QA Retry Expert', 'serviceman', true) RETURNING id`)) as any).rows[0].id;
    empId = ((await db.execute(sql`INSERT INTO employees (user_id, full_name, upi_id, bank_account_number, bank_ifsc, bank_name, document_verification_status, is_active)
        VALUES (${userId}, 'QA Retry Expert', 'qaretry@upi', '50100012345678', 'HDFC0001234', 'HDFC Bank', 'verified', true) RETURNING id`)) as any).rows[0].id;
    await db.execute(sql`INSERT INTO partner_wallets (partner_id, balance_available, balance_hold) VALUES (${empId}, '500.00', '0.00')`);
    wId = ((await db.execute(sql`INSERT INTO withdrawal_requests (partner_id, amount, method, status, failure_reason) VALUES (${empId}, '250.00', 'upi', 'failed', 'QA: beneficiary bank offline') RETURNING id`)) as any).rows[0].id;

    const b = await chromium.launch();
    try {
        for (const width of [1360, 390]) {
            const p = await b.newPage({ viewport: { width, height: 900 } });
            const errors: string[] = [];
            p.on('pageerror', e => errors.push(e.message));
            await p.goto(BASE + '/admin/login');
            await p.evaluate(([t, u]) => { localStorage.setItem('adminToken', t); localStorage.setItem('adminUser', u); }, [token, JSON.stringify(login.admin ?? login.user ?? {})]);
            await p.goto(BASE + '/admin/withdrawals', { waitUntil: 'networkidle' });
            const row = p.locator('tr', { hasText: 'QA Retry Expert' });
            await row.getByRole('button', { name: 'Retry payout' }).click();
            const dlg = p.getByRole('alertdialog');
            await dlg.waitFor();
            const t = await dlg.innerText();
            check(`[${width}] the Retry box offers UPI and Bank transfer`, /Pay by/.test(t) && /UPI/.test(t) && /Bank transfer/.test(t), t.slice(0, 200));
            check(`[${width}] …starts on what they asked for (UPI), and says so`, await dlg.getByRole('button', { name: /Retry via Cashfree by UPI/ }).isVisible() && /What they asked for/.test(t));
            await p.screenshot({ path: `${OUT}/retry-upi-${width}.png`, fullPage: true });
            await dlg.getByRole('button', { name: /Bank transfer/ }).click();
            const t2 = await dlg.innerText();
            check(`[${width}] choosing Bank shows the account and IMPS / NEFT / RTGS`, /50100012345678/.test(t2) && /HDFC0001234/.test(t2) && /IMPS/.test(t2) && /NEFT/.test(t2) && /RTGS/.test(t2));
            check(`[${width}] …and the button follows it (IMPS)`, await dlg.getByRole('button', { name: /Retry via Cashfree by IMPS/ }).isVisible());
            await dlg.getByRole('button', { name: 'NEFT', exact: true }).click();
            check(`[${width}] NEFT can be picked`, await dlg.getByRole('button', { name: /Retry via Cashfree by NEFT/ }).isVisible());
            check(`[${width}] RTGS is off below ₹2 lakh`, await dlg.getByRole('button', { name: 'RTGS', exact: true }).isDisabled());
            check(`[${width}] "Pay manually instead" is there`, await dlg.getByRole('button', { name: 'Pay manually instead' }).isVisible());
            await p.screenshot({ path: `${OUT}/retry-bank-${width}.png`, fullPage: true });
            const scroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            check(`[${width}] no sideways scroll`, scroll <= 1, String(scroll));
            if (width === 390) {
                // Pay manually instead: reopens (wallet only, no Cashfree) and opens the record-payment form on NEFT.
                await dlg.getByRole('button', { name: 'Pay manually instead' }).click();
                await p.getByText(/Pay ₹250(\.00)? yourself/).waitFor({ timeout: 8000 });
                const t3 = await p.getByRole('alertdialog').innerText();
                check('Pay manually instead: the record-payment form opens, on NEFT, asking for UTR and proof', /UTR/.test(t3) && /Payment proof/.test(t3), t3.slice(0, 200));
                const [w] = ((await db.execute(sql`SELECT status, payout_attempt FROM withdrawal_requests WHERE id = ${wId}`)) as any).rows;
                const [wal] = ((await db.execute(sql`SELECT balance_available FROM partner_wallets WHERE partner_id = ${empId}`)) as any).rows;
                check('…the request is pending again and the amount came off the wallet once', w.status === 'pending' && w.payout_attempt === 2 && Number(wal.balance_available) === 250, JSON.stringify({ w, wal }));
                await p.screenshot({ path: `${OUT}/retry-manual-${width}.png`, fullPage: true });
            }
            check(`[${width}] no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200));
            await p.close();
        }
    } finally { await b.close(); }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    await db.execute(sql`DELETE FROM audit_logs WHERE entity_type = 'withdrawal' AND entity_id = ${wId}`);
    await db.execute(sql`DELETE FROM withdrawal_requests WHERE partner_id = ${empId}`);
    await db.execute(sql`DELETE FROM wallet_transactions_v2 WHERE partner_id = ${empId}`);
    await db.execute(sql`DELETE FROM partner_wallets WHERE partner_id = ${empId}`);
    await db.execute(sql`DELETE FROM notifications WHERE user_id = ${userId}`);
    await db.execute(sql`DELETE FROM employees WHERE id = ${empId}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
    await db.execute(sql`DELETE FROM admin_sessions WHERE admin_user_id = ${adminId}`).catch(() => {});
    await db.execute(sql`DELETE FROM admin_users WHERE id = ${adminId}`).catch(() => {});
    clearInterval(keepAlive);
    process.exit(summary());
});
