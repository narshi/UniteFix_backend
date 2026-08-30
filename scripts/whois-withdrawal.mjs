/**
 * Who placed the withdrawals, and what happened to one partner's money?
 *
 *   node -r dotenv/config scripts/whois-withdrawal.mjs surendra
 *
 * READ ONLY. Answers the questions diagnose-withdrawals.mjs leaves open when a
 * complaint arrives as a name: which partner each existing request belongs to,
 * whether the complainant exists at all, where their balance actually is
 * (available vs held), and every wallet movement on their account.
 *
 * Matches on name OR phone OR username, because a partner's display name, their
 * login name and what a colleague calls them are frequently three things.
 */

import pg from 'pg';

const who = process.argv[2];

const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await c.connect();

const h = (s) => console.log(`\n${s}\n${'─'.repeat(s.length)}`);

try {
    h('Every withdrawal request, and whose it is');
    const { rows: all } = await c.query(
        `SELECT w.id, e.full_name, u.phone, w.amount, w.method, w.status,
                w.failure_reason, w.razorpay_payout_id, w.created_at
           FROM withdrawal_requests w
           LEFT JOIN employees e ON e.id = w.partner_id
           LEFT JOIN users u ON u.id = e.user_id
          ORDER BY w.id DESC`);
    console.table(all.length ? all : [{ note: 'no withdrawal requests exist at all' }]);

    h('The minimum a partner is allowed to withdraw');
    const { rows: cfg } = await c.query(
        `SELECT key, value FROM platform_config WHERE key LIKE '%REDEMPTION%' OR key LIKE '%WITHDRAW%'`);
    console.table(cfg.length ? cfg : [{ note: 'no config row — the code falls back to Rs.500' }]);
    console.log('If this is 500 and the partner had less, the APP blocks them before');
    console.log('any request is sent: "Minimum withdrawal amount is Rs.500".');

    if (!who) {
        console.log('\nPass a name to inspect one partner:');
        console.log('  node -r dotenv/config scripts/whois-withdrawal.mjs surendra\n');
        process.exit(0);
    }

    h(`Anyone matching "${who}"`);
    const { rows: people } = await c.query(
        `SELECT e.id AS employee_id, e.full_name, u.id AS user_id, u.username, u.phone,
                u.role, e.is_active, e.document_verification_status AS verification,
                e.upi_id, e.razorpay_fund_account_id IS NOT NULL AS has_fund_account,
                w.balance_available, w.balance_hold, e.total_services_completed
           FROM users u
           LEFT JOIN employees e ON e.user_id = u.id
           LEFT JOIN partner_wallets w ON w.partner_id = e.id
          WHERE u.username ILIKE $1 OR u.phone LIKE $1 OR e.full_name ILIKE $1`,
        [`%${who}%`]);

    if (!people.length) {
        console.log(`Nobody matches "${who}" in users OR employees.`);
        console.log('Try a partial spelling, or their phone number. If they genuinely do not');
        console.log('exist as an employee, they cannot have placed a withdrawal at all and');
        console.log('the screenshot is showing something else.');
        process.exit(0);
    }

    console.table(people);

    for (const p of people) {
        if (!p.employee_id) {
            console.log(`\n${p.username ?? p.phone} is a user but NOT an employee — no wallet, no withdrawals.`);
            continue;
        }

        h(`${p.full_name} — every wallet movement`);
        const { rows: ledger } = await c.query(
            `SELECT id, transaction_id, transaction_type, amount,
                    balance_available_before, balance_available_after,
                    balance_hold_before, balance_hold_after,
                    description, created_at
               FROM wallet_transactions_v2
              WHERE partner_id = $1
              ORDER BY id DESC LIMIT 40`, [p.employee_id]);
        console.table(ledger.length ? ledger : [{ note: 'NO wallet movements at all' }]);

        const { rows: theirs } = await c.query(
            `SELECT id, amount, method, status, failure_reason, created_at
               FROM withdrawal_requests WHERE partner_id = $1 ORDER BY id DESC`, [p.employee_id]);
        console.log('Their withdrawal requests:');
        console.table(theirs.length ? theirs : [{ note: 'NONE' }]);

        console.log('\nReading of the above:');
        console.log(`  Available Rs.${p.balance_available ?? '0.00'}  |  On hold Rs.${p.balance_hold ?? '0.00'}`);
        if (!ledger.length) {
            console.log('  No wallet movements ever. This partner has never earned or been paid');
            console.log('  anything through the wallet, so there was never a balance to withdraw.');
        } else if (!theirs.length) {
            console.log('  Wallet has moved but NO withdrawal request was ever created. Whatever');
            console.log('  they saw on screen never reached the database.');
        }
        if (parseFloat(p.balance_hold ?? '0') > 0) {
            console.log('  NOTE: money sitting in HOLD is not withdrawable yet — it releases after');
            console.log('  BUSINESS_CONFIG.WALLET_HOLD_DAYS. The app only offers balance_available.');
        }
    }

    console.log('');
} catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
} finally {
    await c.end();
}
