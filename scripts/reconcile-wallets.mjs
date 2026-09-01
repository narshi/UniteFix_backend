/**
 * Do partner wallets agree with their ledgers?
 *
 *   npm run reconcile:wallets            # every wallet
 *   npm run reconcile:wallets -- 17      # one partner, by employee id
 *
 * STRICTLY READ-ONLY — safe against production. It runs SELECTs and nothing
 * else, and never repairs anything: moving money based on a reconstruction this
 * codebase cannot yet do reliably would be worse than the drift.
 *
 * Standalone SQL rather than importing the service, so it runs on a deployed
 * container without a TypeScript loader. The checks mirror
 * server/services/wallet-reconciliation.service.ts — keep them in step.
 */

import pg from 'pg';

const arg = process.argv[2];
const onlyPartner = arg && /^\d+$/.test(arg) ? Number(arg) : null;

const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await c.connect();

const money = v => Number(v ?? 0);
const r2 = n => Math.round(n * 100) / 100;
const rs = n => 'Rs.' + Number(n).toFixed(2);

try {
    const { rows: wallets } = await c.query(
        `SELECT w.partner_id, w.balance_available, w.balance_hold,
                e.full_name, u.phone
           FROM partner_wallets w
           LEFT JOIN employees e ON e.id = w.partner_id
           LEFT JOIN users u ON u.id = e.user_id
          ${onlyPartner ? 'WHERE w.partner_id = $1' : ''}
          ORDER BY w.partner_id`,
        onlyPartner ? [onlyPartner] : []);

    if (!wallets.length) {
        console.log(onlyPartner ? `No wallet for partner ${onlyPartner}.` : 'No partner wallets exist.');
        process.exit(0);
    }

    const affected = [];
    let totalHoldDrift = 0;
    const totals = {};

    for (const w of wallets) {
        const pid = Number(w.partner_id);
        const available = money(w.balance_available);
        const held = money(w.balance_hold);
        const issues = [];

        const { rows: v2 } = await c.query(
            `SELECT id, transaction_type, amount, is_released, release_date,
                    balance_available_before, balance_available_after
               FROM wallet_transactions_v2 WHERE partner_id = $1 ORDER BY id`, [pid]);

        const { rows: [{ n: v1Count }] } = await c.query(
            'SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE provider_id = $1', [pid]);

        // 1. Holds — the one unambiguous figure. Only v2 writes holds.
        const expectedHold = r2(v2
            .filter(t => t.transaction_type === 'hold_credit' && t.is_released === false)
            .reduce((s, t) => s + money(t.amount), 0));
        if (Math.abs(expectedHold - held) >= 0.01) {
            const diff = r2(held - expectedHold);
            totalHoldDrift += Math.abs(diff);
            issues.push({
                code: 'HOLD_MISMATCH',
                detail: `held ${rs(held)} but unreleased holds total ${rs(expectedHold)} `
                    + `(${diff > 0 ? '+' : ''}${rs(diff)} unaccounted for)`,
            });
        }

        // 2. Continuity — a gap here is a balance that moved with no row to explain it.
        for (let i = 1; i < v2.length; i++) {
            const prev = v2[i - 1], cur = v2[i];
            const gap = r2(money(cur.balance_available_before) - money(prev.balance_available_after));
            if (Math.abs(gap) >= 0.01) {
                issues.push({
                    code: 'LEDGER_BREAK',
                    detail: `available moved ${gap > 0 ? '+' : ''}${rs(gap)} between entry #${prev.id} `
                        + `(${prev.transaction_type}) and #${cur.id} (${cur.transaction_type}) with nothing recording it`,
                });
                break;
            }
        }

        // 3. Impossible states.
        if (available < 0 || held < 0) {
            issues.push({ code: 'NEGATIVE_BALANCE', detail: `available ${rs(available)}, held ${rs(held)}` });
        }
        if (v2.length === 0 && (available > 0 || held > 0)) {
            issues.push({
                code: 'BALANCE_WITHOUT_LEDGER',
                detail: `${rs(available + held)} in the wallet with no v2 ledger history at all`,
            });
        }

        // 4. Release job stopped.
        const overdue = v2.filter(t => t.transaction_type === 'hold_credit' && t.is_released === false
            && t.release_date && new Date(t.release_date) < new Date());
        if (overdue.length) {
            const amt = r2(overdue.reduce((s, t) => s + money(t.amount), 0));
            const oldest = overdue.reduce((a, b) => new Date(a.release_date) < new Date(b.release_date) ? a : b);
            issues.push({
                code: 'OVERDUE_HOLD',
                detail: `${rs(amt)} past its release date and still held (oldest due `
                    + `${new Date(oldest.release_date).toISOString().slice(0, 10)}) — release job may not be running`,
            });
        }

        // 5. Split-brain: history the partner's app cannot show.
        if (v1Count > 0 && v2.length === 0) {
            issues.push({
                code: 'V1_ONLY_ACTIVITY',
                detail: `${v1Count} entr${v1Count === 1 ? 'y' : 'ies'} exist only in the v1 ledger, `
                    + `so the partner's app shows none of them`,
            });
        }

        issues.forEach(i => { totals[i.code] = (totals[i.code] ?? 0) + 1; });
        if (issues.length) affected.push({ pid, w, available, held, issues, v1Count, v2Count: v2.length });
    }

    // ── output ──────────────────────────────────────────────────────────
    console.log(`\nWallet reconciliation — ${wallets.length} wallet(s) checked`);
    console.log('='.repeat(64));

    if (!affected.length) {
        console.log('\n  Every wallet agrees with its ledger.\n');
        process.exit(0);
    }

    for (const a of affected) {
        console.log(`\n  ${a.w.full_name ?? 'Partner ' + a.pid} (employee ${a.pid})${a.w.phone ? ' · ' + a.w.phone : ''}`);
        console.log(`  available ${rs(a.available)} | held ${rs(a.held)} | ${a.v2Count} v2 entries, ${a.v1Count} v1`);
        for (const i of a.issues) console.log(`    [${i.code}] ${i.detail}`);
    }

    console.log('\n' + '='.repeat(64));
    console.log(`  ${affected.length} of ${wallets.length} wallet(s) do not reconcile.`);
    Object.entries(totals).sort().forEach(([k, v]) => console.log(`    ${k.padEnd(24)} ${v}`));
    if (totalHoldDrift > 0) {
        console.log(`\n  Total unaccounted in held balances: ${rs(totalHoldDrift)}`);
    }
    console.log('\n  Nothing was changed. Investigate before adjusting any balance.\n');
} catch (err) {
    console.error('Reconciliation failed:', err.message);
    process.exitCode = 1;
} finally {
    await c.end();
}
