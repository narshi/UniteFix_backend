/**
 * Cashfree setup, offline: the environment switch reads the same for Payouts
 * and Verification, and the /authorize signature (for servers without a
 * whitelisted IP) is "<clientId>.<unix seconds>" under RSA-OAEP SHA-1, from a
 * public key pasted in any of the ways Render allows. No call leaves this box.
 *
 *   npm run smoke:cashfree
 */

import crypto from 'crypto';
import { cashfreeLive, cashfreeEnvValid, cashfreePublicKey, cashfreeKeys } from '../server/lib/cashfree-env';
import { CashfreeService } from '../server/services/cashfree.service';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail && !pass ? `  — ${detail}` : ''}`); };

const env = (v: string | undefined) => { if (v === undefined) delete process.env.CASHFREE_ENVIRONMENT; else process.env.CASHFREE_ENVIRONMENT = v; };

for (const v of ['PROD', 'production', 'Live', ' PROD ']) { env(v); check(`"${v}" means live`, cashfreeLive() && cashfreeEnvValid()); }
for (const v of [undefined, '', 'TEST', 'sandbox']) { env(v); check(`"${v ?? 'unset'}" means test`, !cashfreeLive() && cashfreeEnvValid()); }
env('STAGING'); check('an unknown value is refused, not guessed', !cashfreeEnvValid());
env('PRODUCTION');
check('Payouts on PRODUCTION use the live API (it used to throw)', (CashfreeService as any).baseUrl() === 'https://payout-api.cashfree.com/payout/v1');
env('TEST');
check('…and on TEST the test API', (CashfreeService as any).baseUrl() === 'https://payout-gamma.cashfree.com/payout/v1');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
const decrypt = (sig: string) => crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(sig, 'base64')).toString();

delete process.env.CASHFREE_PUBLIC_KEY;
check('no public key: no signature (IP whitelisting is used instead)', CashfreeService.signature('CF123') === null);
const now = Date.UTC(2026, 9, 10, 6, 0, 0);
for (const [label, value] of [['the PEM file as pasted', pem], ['PEM with \\n typed for line breaks', pem.replace(/\n/g, '\\n')], ['only the key body', body]] as const) {
    process.env.CASHFREE_PUBLIC_KEY = value;
    let plain = '';
    try { plain = decrypt(CashfreeService.signature('CF123ABC', now)!); } catch (e: any) { plain = `error: ${e.message}`; }
    check(`signature from ${label}: "<clientId>.<unix seconds>", OAEP SHA-1, base64`, plain === `CF123ABC.${Math.floor(now / 1000)}`, plain);
}
check('the key is read back as a PEM', /^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----\s*$/.test(cashfreePublicKey()!));
const a = CashfreeService.signature('CF1', now), b = CashfreeService.signature('CF1', now);
check('each signature is freshly encrypted (OAEP is randomised)', a !== b && decrypt(a!) === decrypt(b!));

// ── the Payouts variable names ──
const clear = () => { for (const k of Object.keys(process.env)) if (/^CASHFREE_(PAYOUTS_)?(CLIENT_ID|CLIENT_SECRET|PUBLIC_KEY)$/.test(k)) delete process.env[k]; };
clear();
check('no keys: Payouts is not set up', cashfreeKeys() === null);
process.env.CASHFREE_CLIENT_ID = 'OLD_ID'; process.env.CASHFREE_CLIENT_SECRET = 'OLD_SECRET';
check('the older variable names still work', cashfreeKeys()?.clientId === 'OLD_ID');
process.env.CASHFREE_PAYOUTS_CLIENT_ID = 'PAY_ID'; process.env.CASHFREE_PAYOUTS_CLIENT_SECRET = 'PAY_SECRET';
check('the CASHFREE_PAYOUTS_ names win over the older ones', cashfreeKeys()?.clientId === 'PAY_ID' && cashfreeKeys()?.clientSecret === 'PAY_SECRET');
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.CASHFREE_PUBLIC_KEY = other.publicKey.export({ type: 'spki', format: 'pem' }).toString();
process.env.CASHFREE_PAYOUTS_PUBLIC_KEY = pem;
const sig = CashfreeService.signature('PAY_ID', now)!;
check('CASHFREE_PAYOUTS_PUBLIC_KEY wins over the older CASHFREE_PUBLIC_KEY', decrypt(sig) === `PAY_ID.${Math.floor(now / 1000)}`);
clear();

const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
