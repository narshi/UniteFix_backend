/**
 * Cashfree configuration, read the same way by every Cashfree product.
 *
 * CASHFREE_ENVIRONMENT: PROD / PRODUCTION / LIVE → live; TEST / SANDBOX / unset
 * → test. Payouts used to accept only "PROD" and Verification only
 * "PRODUCTION", so either value left one of them on the wrong side.
 *
 * Cashfree issues separate keys for Payouts and for Cashgram:
 *
 *   Payouts    CASHFREE_PAYOUTS_CLIENT_ID / _CLIENT_SECRET / _PUBLIC_KEY
 *              (the older CASHFREE_CLIENT_ID / _CLIENT_SECRET / CASHFREE_PUBLIC_KEY
 *              still work, so nothing breaks before the new names are set)
 *   Cashgram   CASHFREE_CASHGRAM_CLIENT_ID / _CLIENT_SECRET / _PUBLIC_KEY
 *
 * The public key (Cashfree → Developers → Two-Factor Authentication) lets
 * Cashfree trust a server without a fixed IP — Render's outgoing address is
 * not one we control. It is pasted into Render as the PEM file, with "\n"
 * typed for line breaks, or as just the base64 body.
 */

export type CashfreeProduct = 'payouts' | 'cashgram';

export function cashfreeLive(): boolean {
    return ['PROD', 'PRODUCTION', 'LIVE'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

export function cashfreeEnvValid(): boolean {
    return ['', 'PROD', 'PRODUCTION', 'LIVE', 'TEST', 'SANDBOX'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

const env = (...names: string[]) => names.map(n => (process.env[n] ?? '').trim()).find(Boolean) ?? '';

/** The environment variable names for a product, for messages. */
export const CASHFREE_VARS: Record<CashfreeProduct, { id: string; secret: string; key: string }> = {
    payouts: { id: 'CASHFREE_PAYOUTS_CLIENT_ID', secret: 'CASHFREE_PAYOUTS_CLIENT_SECRET', key: 'CASHFREE_PAYOUTS_PUBLIC_KEY' },
    cashgram: { id: 'CASHFREE_CASHGRAM_CLIENT_ID', secret: 'CASHFREE_CASHGRAM_CLIENT_SECRET', key: 'CASHFREE_CASHGRAM_PUBLIC_KEY' },
};

export function cashfreeKeys(product: CashfreeProduct = 'payouts'): { clientId: string; clientSecret: string } | null {
    const v = CASHFREE_VARS[product];
    const clientId = product === 'payouts' ? env(v.id, 'CASHFREE_CLIENT_ID') : env(v.id);
    const clientSecret = product === 'payouts' ? env(v.secret, 'CASHFREE_CLIENT_SECRET') : env(v.secret);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function cashfreePublicKey(product: CashfreeProduct = 'payouts'): string | null {
    const raw = product === 'payouts' ? env(CASHFREE_VARS.payouts.key, 'CASHFREE_PUBLIC_KEY') : env(CASHFREE_VARS.cashgram.key);
    if (!raw) return null;
    const pem = raw.replace(/\\n/g, '\n');
    if (pem.includes('BEGIN')) return pem;
    const body = pem.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}
