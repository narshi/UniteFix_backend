/**
 * Does the reconciliation actually detect drift?
 *
 *   node -r dotenv/config scripts/smoke-wallet-reconciliation.mjs
 *
 * Builds six wallets — one healthy, five broken in a specific way — runs the
 * same checks the reconciler runs, and asserts each is caught and the healthy
 * one is left alone. A monitor that never fires is worse than none, because it
 * is mistaken for evidence that nothing is wrong.
 *
 * Case 2 reproduces the live gap that started this: held money exceeding the
 * ledger that explains it.
 *
 * Creates its own fixtures and removes them in a `finally`.
 */

import pg from 'pg';

const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await c.connect();

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const money = v => Number(v ?? 0);
const r2 = n => Math.round(n * 100) / 100;
const stamp = String(Date.now()).slice(-9);
const made = { users: [], employees: [] };

/** Mirrors reconcile-wallets.mjs. Returns the set of issue codes for one partner. */
async function issuesFor(pid) {
    const { rows: [w] } = await c.query(
        'SELECT balance_available, balance_hold FROM partner_wallets WHERE partner_id = $1', [pid]);
    const { rows: v2 } = await c.query(
        `SELECT id, transaction_type, amount, is_released, release_date,
                balance_available_before, balance_available_after
           FROM wallet_transactions_v2 WHERE partner_id = $1 ORDER BY id`, [pid]);
    const { rows: [{ n: v1Count }] } = await c.query(
        'SELECT COUNT(*)::int AS n FROM wallet_transactions WHERE provider_id = $1', [pid]);

    const available = money(w.balance_available), held = money(w.balance_hold);
    const codes = new Set();

    const expectedHold = r2(v2.filter(t => t.transaction_type === 'hold_credit' && t.is_released === false)
        .reduce((s, t) => s + money(t.amount), 0));
    if (Math.abs(expectedHold - held) >= 0.01) codes.add('HOLD_MISMATCH');

    for (let i = 1; i < v2.length; i++) {
        const gap = r2(money(v2[i].balance_available_before) - money(v2[i - 1].balance_available_after));
        if (Math.abs(gap) >= 0.01) { codes.add('LEDGER_BREAK'); break; }
    }

    if (available < 0 || held < 0) codes.add('NEGATIVE_BALANCE');
    if (v2.length === 0 && (available > 0 || held > 0)) codes.add('BALANCE_WITHOUT_LEDGER');
    if (v2.some(t => t.transaction_type === 'hold_credit' && t.is_released === false
        && t.release_date && new Date(t.release_date) < new Date())) codes.add('OVERDUE_HOLD');
    if (v1Count > 0 && v2.length === 0) codes.add('V1_ONLY_ACTIVITY');

    return codes;
}

async function makePartner(label, available, held) {
    const suffix = String(made.users.length);
    const { rows: [u] } = await c.query(
        `INSERT INTO users (phone, username, role, is_active, phone_verified)
         VALUES ($1, $2, 'serviceman', true, true) RETURNING id`,
        [`9${stamp.slice(0, 8)}${suffix}`, `QA Recon ${label}`]);
    made.users.push(u.id);
    const { rows: [e] } = await c.query(
        `INSERT INTO employees (user_id, full_name, document_verification_status, is_active)
         VALUES ($1, $2, 'verified', true) RETURNING id`, [u.id, `QA Recon ${label}`]);
    made.employees.push(e.id);
    await c.query(
        `INSERT INTO partner_wallets (partner_id, balance_available, balance_hold, total_earned)
         VALUES ($1, $2, $3, '0.00')`, [e.id, available, held]);
    return e.id;
}

async function hold(pid, amount, { released = false, daysAhead = 5, availBefore = '0.00', availAfter = '0.00' } = {}) {
    await c.query(
        `INSERT INTO wallet_transactions_v2
            (transaction_id, partner_id, transaction_type, amount,
             balance_available_before, balance_available_after,
             balance_hold_before, balance_hold_after, release_date, is_released, description)
         VALUES ($1,$2,'hold_credit',$3,$4,$5,'0.00',$3,$6,$7,'Earnings held for service completion')`,
        [`WHLD-QA-${pid}-${Math.random().toString(36).slice(2, 8)}`, pid, amount,
         availBefore, availAfter, new Date(Date.now() + daysAhead * 86_400_000), released]);
}

try {
    // ── 1. Healthy: held balance exactly matches its one unreleased hold ──
    const clean = await makePartner('Clean', '0.00', '500.00');
    await hold(clean, '500.00');
    let codes = await issuesFor(clean);
    check('a healthy wallet raises NOTHING', codes.size === 0, [...codes].join(',') || 'no issues');

    // ── 2. The live case: held money the ledger cannot explain ──
    const drift = await makePartner('Drift', '0.00', '416.60');
    await hold(drift, '173.30');
    codes = await issuesFor(drift);
    check('held money exceeding its ledger is caught', codes.has('HOLD_MISMATCH'), [...codes].join(','));

    // ── 3. A balance that moved with no row to explain it ──
    const brk = await makePartner('Break', '900.00', '0.00');
    await c.query(
        `INSERT INTO wallet_transactions_v2
            (transaction_id, partner_id, transaction_type, amount,
             balance_available_before, balance_available_after, balance_hold_before, balance_hold_after, description)
         VALUES ($1,$2,'adjustment','100.00','0.00','100.00','0.00','0.00','first')`,
        [`ADJ-QA-${brk}-a`, brk]);
    // Next entry claims it started from 400, not the 100 the previous one left.
    await c.query(
        `INSERT INTO wallet_transactions_v2
            (transaction_id, partner_id, transaction_type, amount,
             balance_available_before, balance_available_after, balance_hold_before, balance_hold_after, description)
         VALUES ($1,$2,'adjustment','500.00','400.00','900.00','0.00','0.00','second')`,
        [`ADJ-QA-${brk}-b`, brk]);
    codes = await issuesFor(brk);
    check('a discontinuous ledger chain is caught', codes.has('LEDGER_BREAK'), [...codes].join(','));

    // ── 4. Impossible state ──
    const neg = await makePartner('Negative', '-50.00', '0.00');
    codes = await issuesFor(neg);
    check('a negative balance is caught', codes.has('NEGATIVE_BALANCE'), [...codes].join(','));

    // ── 5. Money with no history whatsoever ──
    const ghost = await makePartner('Ghost', '750.00', '0.00');
    codes = await issuesFor(ghost);
    check('money with no ledger history at all is caught',
        codes.has('BALANCE_WITHOUT_LEDGER'), [...codes].join(','));

    // ── 6. Release job stopped ──
    const stuck = await makePartner('Stuck', '0.00', '300.00');
    await hold(stuck, '300.00', { daysAhead: -3 });
    codes = await issuesFor(stuck);
    check('money past its release date is caught', codes.has('OVERDUE_HOLD'), [...codes].join(','));

    // ── 7. History the partner's app can never show ──
    const v1only = await makePartner('V1Only', '200.00', '0.00');
    await c.query(
        `INSERT INTO wallet_transactions (provider_id, amount, type, description)
         VALUES ($1,'200.00','credit','Earnings for online payment')`, [v1only]);
    codes = await issuesFor(v1only);
    check('v1-only history is flagged as invisible to the partner',
        codes.has('V1_ONLY_ACTIVITY'), [...codes].join(','));

    // ── 8. Precision: paise-level drift must not slip through ──
    const paise = await makePartner('Paise', '0.00', '100.01');
    await hold(paise, '100.00');
    codes = await issuesFor(paise);
    check('a one-paisa discrepancy is still caught', codes.has('HOLD_MISMATCH'), [...codes].join(','));

    // ── 9. And rounding noise must not create false alarms ──
    const exact = await makePartner('Exact', '0.00', '333.33');
    await hold(exact, '111.11');
    await hold(exact, '111.11');
    await hold(exact, '111.11');
    codes = await issuesFor(exact);
    check('three thirds summing exactly do NOT false-alarm',
        !codes.has('HOLD_MISMATCH'), [...codes].join(',') || 'no issues');

} catch (err) {
    console.error('\nTest aborted:', err.message);
    process.exitCode = 1;
} finally {
    try {
        for (const id of made.employees) {
            await c.query('DELETE FROM wallet_transactions_v2 WHERE partner_id = $1', [id]);
            await c.query('DELETE FROM wallet_transactions WHERE provider_id = $1', [id]);
            await c.query('DELETE FROM partner_wallets WHERE partner_id = $1', [id]);
            await c.query('DELETE FROM employees WHERE id = $1', [id]);
        }
        for (const id of made.users) await c.query('DELETE FROM users WHERE id = $1', [id]);
    } catch (e) {
        console.error('Cleanup warning:', e.message);
    }
    await c.end();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
}
