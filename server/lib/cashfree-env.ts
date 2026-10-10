/**
 * Which Cashfree environment the server talks to — one reading for every
 * Cashfree product (Payouts and Verification).
 *
 * CASHFREE_ENVIRONMENT: PROD / PRODUCTION / LIVE → live; TEST / SANDBOX / unset
 * → test. Payouts used to accept only "PROD" and Verification only
 * "PRODUCTION", so either value left one of them on the wrong side.
 */

export function cashfreeLive(): boolean {
    return ['PROD', 'PRODUCTION', 'LIVE'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

export function cashfreeEnvValid(): boolean {
    return ['', 'PROD', 'PRODUCTION', 'LIVE', 'TEST', 'SANDBOX'].includes((process.env.CASHFREE_ENVIRONMENT ?? '').trim().toUpperCase());
}

/**
 * The Payouts public key (Payouts dashboard → Developers → Two-Factor
 * Authentication → Public Key), for servers without a fixed IP to whitelist —
 * Render's outbound address is not one we control. Pasted into Render either
 * as the whole PEM file, with "\n" typed literally for line breaks, or as just
 * the base64 body.
 */
export function cashfreePublicKey(): string | null {
    const raw = (process.env.CASHFREE_PUBLIC_KEY ?? '').trim();
    if (!raw) return null;
    const pem = raw.replace(/\\n/g, '\n');
    if (pem.includes('BEGIN')) return pem;
    const body = pem.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}
