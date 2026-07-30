/**
 * RazorpayX payout connectivity check — dependency-free (Node 20+ global fetch).
 *
 * Run it wherever the real env vars live (e.g. the Render service "Shell" tab):
 *
 *     node scripts/check-razorpayx.mjs
 *
 * It reads the same env vars the app uses, makes ONE read-only call to the
 * RazorpayX Payouts API, and prints a verdict. It never creates a payout and
 * never prints a full secret.
 */

const keyId = process.env.RAZORPAY_KEY_ID || '';
const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
const accountNumber =
    process.env.RAZORPAYX_ACCOUNT_NUMBER || process.env.RAZORPAY_X_ACCOUNT_NUMBER || '';

const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-2)} (len ${v.length})` : '(not set)');

console.log('\n── RazorpayX configuration ─────────────────────────────');
console.log('RAZORPAY_KEY_ID          :', mask(keyId));
console.log('  key mode               :', keyId.startsWith('rzp_live_') ? 'LIVE'
    : keyId.startsWith('rzp_test_') ? 'TEST  ← payouts do NOT work with test keys'
    : '(unrecognised prefix)');
console.log('RAZORPAY_KEY_SECRET      :', keySecret ? `set (len ${keySecret.length})` : '(not set)');
console.log('RAZORPAYX_ACCOUNT_NUMBER :', mask(accountNumber));
console.log('────────────────────────────────────────────────────────\n');

if (!keyId || !keySecret) {
    console.error('✗ Missing key id/secret — cannot test. Set them and re-run.\n');
    process.exit(1);
}
if (!accountNumber) {
    console.error('✗ RAZORPAYX_ACCOUNT_NUMBER is not set — payouts cannot be debited from any account.\n');
    process.exit(1);
}

const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

// Read-only probe: list at most one payout for the account. Same host + product
// as createPayout, so its HTTP status tells us exactly what the payout POST sees.
const url = `https://api.razorpay.com/v1/payouts?account_number=${encodeURIComponent(accountNumber)}&count=1`;

console.log(`Probing: GET /v1/payouts?account_number=${mask(accountNumber)} …\n`);

try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }

    console.log('HTTP status :', res.status);
    console.log('Response    :', typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body, null, 2), '\n');

    const desc = body?.error?.description || '';

    if (res.status === 200) {
        console.log('✓ RazorpayX Payouts is REACHABLE with these keys + account number.');
        console.log('  If approvals still fail, the error is in the payout body (fund account, amount,');
        console.log('  or account balance) — not connectivity. Read the exact description above.\n');
    } else if (res.status === 400) {
        console.log('~ RazorpayX responded (400). The API is reachable; this is a request/param issue.');
        console.log(`  Razorpay says: "${desc}". Usually a wrong account_number format.\n`);
    } else if (res.status === 401) {
        console.log('✗ 401 Unauthorized — the key id/secret are wrong or not for this account.\n');
    } else if (res.status === 404 || /url was not found/i.test(desc)) {
        console.log('✗ 404 "URL not found" — RazorpayX Payouts is NOT enabled for these keys.');
        console.log('  Even with the account number set, the Payouts *product* must be activated');
        console.log('  (RazorpayX KYC approved) for THIS key id. Payments being live is not enough.');
        console.log('  Fix in the RazorpayX dashboard (x.razorpay.com), then use that account\'s live keys.\n');
    } else {
        console.log(`? Unexpected status ${res.status}. Full response above.\n`);
    }
} catch (err) {
    console.error('✗ Network/request error:', err.message, '\n');
    process.exit(1);
}
