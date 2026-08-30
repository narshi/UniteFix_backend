/**
 * Why did a partner's redemption never reach the admin Withdrawals screen?
 *
 *   node -r dotenv/config scripts/diagnose-withdrawals.mjs
 *   node -r dotenv/config scripts/diagnose-withdrawals.mjs 9876543210   # one partner
 *
 * READ ONLY. Runs SELECTs and nothing else — safe against production.
 *
 * The usual answer: POST /api/partner/wallet/withdraw refuses to create the
 * request unless the employee has a razorpay_fund_account_id, that id is only
 * ever written by RazorpayXService.syncEmployeeForPayouts, and that sync is
 * swallowed as "non-fatal" when the partner saves their UPI. So the partner ends
 * up with a UPI id, no fund account, a 400 that says "UPI ID not found" (which
 * is untrue and unactionable), and no row for the admin to see.
 */

import pg from 'pg';

const phoneArg = process.argv[2];

const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await c.connect();

const h = (s) => console.log(`\n${s}\n${'─'.repeat(s.length)}`);

try {
    h('1. Withdrawal requests that exist');
    const { rows: counts } = await c.query(
        `SELECT status, COUNT(*)::int n, MAX(created_at) AS latest
           FROM withdrawal_requests GROUP BY status ORDER BY status`);
    console.table(counts.length ? counts : [{ status: '(none at all)', n: 0, latest: null }]);

    h('2. Would any request be hidden from the admin list?');
    // The admin list INNER JOINs employees and users. A request whose partner or
    // user row is missing would silently vanish from the screen with no error.
    const { rows: [hidden] } = await c.query(
        `SELECT COUNT(*)::int n FROM withdrawal_requests w
          WHERE NOT EXISTS (SELECT 1 FROM employees e
                             JOIN users u ON u.id = e.user_id
                            WHERE e.id = w.partner_id)`);
    console.log(hidden.n === 0
        ? 'No. Every request joins cleanly to an employee and user.'
        : `YES — ${hidden.n} request(s) are invisible on the admin screen because the join fails.`);

    h('3. Partners BLOCKED from requesting a payout');
    // This is the real gate. upiId is set but razorpay_fund_account_id is not, so
    // the endpoint 400s before writing anything.
    const { rows: blocked } = await c.query(
        `SELECT e.id, e.full_name, u.phone,
                (e.upi_id IS NOT NULL)                  AS has_upi,
                (e.razorpay_contact_id IS NOT NULL)     AS has_contact,
                (e.razorpay_fund_account_id IS NOT NULL) AS has_fund_account,
                COALESCE(w.balance_available, '0')       AS available
           FROM employees e
           JOIN users u ON u.id = e.user_id
           LEFT JOIN partner_wallets w ON w.partner_id = e.id
          WHERE e.upi_id IS NOT NULL
            AND e.razorpay_fund_account_id IS NULL
          ORDER BY (COALESCE(w.balance_available,'0'))::numeric DESC
          LIMIT 25`);

    if (blocked.length === 0) {
        console.log('None. Every partner with a UPI id also has a fund account.');
    } else {
        console.log(`${blocked.length} partner(s) have a UPI id but NO RazorpayX fund account.`);
        console.log('Each of them gets 400 "UPI ID not found" and no request is created:\n');
        console.table(blocked);
    }

    h('4. Is RazorpayX actually usable?');
    const keyId = process.env.RAZORPAY_KEY_ID ?? '';
    console.log('RAZORPAY_KEY_ID           :', keyId ? keyId.slice(0, 14) + '…' : 'NOT SET');
    console.log('RAZORPAY_KEY_SECRET       :', process.env.RAZORPAY_KEY_SECRET ? 'set' : 'NOT SET');
    console.log('RAZORPAYX_ACCOUNT_NUMBER  :', process.env.RAZORPAYX_ACCOUNT_NUMBER ? 'set' : 'NOT SET');
    if (keyId.startsWith('rzp_test')) {
        console.log('\n  NOTE: this is a TEST key. Contacts and Fund Accounts are RazorpayX');
        console.log('  (payouts) APIs, not payment-gateway APIs — they fail unless RazorpayX');
        console.log('  is activated on the account, whatever the key.');
    }

    h('5. Partners with a balance who could be trying right now');
    const { rows: withBalance } = await c.query(
        `SELECT e.id, e.full_name, u.phone, w.balance_available,
                (e.razorpay_fund_account_id IS NOT NULL) AS can_request
           FROM partner_wallets w
           JOIN employees e ON e.id = w.partner_id
           JOIN users u ON u.id = e.user_id
          WHERE (w.balance_available)::numeric > 0
          ORDER BY (w.balance_available)::numeric DESC LIMIT 15`);
    console.table(withBalance.length ? withBalance : [{ note: 'no partner has an available balance' }]);

    if (phoneArg) {
        h(`6. Partner ${phoneArg} in detail`);
        const { rows } = await c.query(
            `SELECT e.id AS employee_id, e.full_name, u.phone, e.upi_id,
                    e.bank_account_number, e.bank_ifsc,
                    e.razorpay_contact_id, e.razorpay_fund_account_id,
                    w.balance_available, w.balance_hold
               FROM users u JOIN employees e ON e.user_id = u.id
               LEFT JOIN partner_wallets w ON w.partner_id = e.id
              WHERE u.phone LIKE $1`, [`%${phoneArg}%`]);
        if (!rows.length) {
            console.log('No partner found with that phone.');
        } else {
            console.table(rows);
            const p = rows[0];
            console.log('\nDiagnosis:');
            if (!p.upi_id && !p.bank_account_number) {
                console.log('  No payout destination saved. The block is correct — ask them to add a UPI id.');
            } else if (!p.razorpay_fund_account_id) {
                console.log('  Has a payout destination but NO fund account, so /api/partner/wallet/withdraw');
                console.log('  refuses with "UPI ID not found" and writes nothing. THIS is the reported bug.');
            } else {
                console.log('  Payout setup looks complete — the failure is elsewhere; check server logs');
                console.log('  around their attempt for a 400/500 on /api/partner/wallet/withdraw.');
            }
            const { rows: theirs } = await c.query(
                'SELECT id, amount, method, status, created_at FROM withdrawal_requests WHERE partner_id = $1 ORDER BY id DESC LIMIT 10',
                [p.employee_id]);
            console.log('\nTheir withdrawal requests:');
            console.table(theirs.length ? theirs : [{ note: 'none — nothing was ever created' }]);
        }
    } else {
        console.log('\nTip: pass the partner\'s phone number to inspect one account:');
        console.log('  node -r dotenv/config scripts/diagnose-withdrawals.mjs 9876543210');
    }

    console.log('');
} catch (err) {
    console.error('Diagnostic failed:', err.message);
    process.exitCode = 1;
} finally {
    await c.end();
}
