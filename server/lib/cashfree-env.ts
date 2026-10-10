/**
 * Cashfree configuration, read the same way by every Cashfree product.
 *
 * CASHFREE_ENVIRONMENT: PROD / PRODUCTION / LIVE → live; TEST / SANDBOX / unset
 * → test. Payouts used to accept only "PROD" and Verification only
 * "PRODUCTION", so either value left one of them on the wrong side.
 *
 * Payouts keys: CASHFREE_PAYOUTS_CLIENT_ID / _CLIENT_SECRET / _PUBLIC_KEY.
 * The older CASHFREE_CLIENT_ID / _CLIENT_SECRET / CASHFREE_PUBLIC_KEY still
 * work while the new names are empty.
 *
 * The public key (Payouts → Developers → Two-Factor Authentication) lets
 * Cashfree trust a server without a fixed IP — Render's outgoing address is
 * not one we control. It is pasted into Render as the PEM file, with "\n"
 * typed for line breaks, or as just the base64 body.
 */

export function cashfreeLive(): boolean {
    return ['PROD', 'PRODUCTION', 'LIVE'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

export function cashfreeEnvValid(): boolean {
    return ['', 'PROD', 'PRODUCTION', 'LIVE', 'TEST', 'SANDBOX'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

const env = (...names: string[]) => names.map(n => (process.env[n] ?? '').trim()).find(Boolean) ?? '';

/** The environment variable names, for messages. */
export const CASHFREE_VARS = { id: 'CASHFREE_PAYOUTS_CLIENT_ID', secret: 'CASHFREE_PAYOUTS_CLIENT_SECRET', key: 'CASHFREE_PAYOUTS_PUBLIC_KEY' } as const;

export function cashfreeKeys(): { clientId: string; clientSecret: string } | null {
    const clientId = env(CASHFREE_VARS.id, 'CASHFREE_CLIENT_ID');
    const clientSecret = env(CASHFREE_VARS.secret, 'CASHFREE_CLIENT_SECRET');
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function cashfreePublicKey(): string | null {
    const raw = env(CASHFREE_VARS.key, 'CASHFREE_PUBLIC_KEY');
    if (!raw) return null;
    const pem = raw.replace(/\\n/g, '\n');
    if (pem.includes('BEGIN')) return pem;
    const body = pem.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}
