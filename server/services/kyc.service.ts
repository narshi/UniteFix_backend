import crypto from 'crypto';
/**
 * KYC checks for business partners.
 *
 * GSTIN and PAN are checked locally (shape, state code, GSTN check digit, PAN
 * inside the GSTIN) — see shared/hub.ts. That proves a number is well-formed,
 * not that it is registered; a GST-portal lookup needs a GSP and is not wired.
 *
 * Bank accounts are verified by penny-drop through Cashfree's Verification
 * API when CASHFREE_VERIFICATION_CLIENT_ID / _SECRET are set. Those are a
 * separate product from Payouts and from the Payment Gateway; without them the
 * check returns `manual`, and an admin confirms the account against the
 * uploaded cancelled cheque. Nothing is ever marked verified by guesswork.
 */

import logger from '../lib/logger';
import { cashfreeLive } from '../lib/cashfree-env';

export type BankCheck =
    | { status: 'verified'; nameAtBank: string | null; reference: string | null }
    | { status: 'failed'; reason: string; reference: string | null }
    | { status: 'manual'; reason: string };

function verificationBase(): string {
    return cashfreeLive()
        ? 'https://api.cashfree.com/verification'
        : 'https://sandbox.cashfree.com/verification';
}

/**
 * Headers for every Cashfree Secure ID call. Production Secure ID needs either
 * the server's IP whitelisted or a signature; set CASHFREE_VERIFICATION_PUBLIC_KEY
 * (the PEM from Secure ID → Developers → Two-Factor Authentication) and every
 * call carries X-Cf-Signature: RSA-OAEP(clientId.epochSeconds), valid 5 minutes.
 */
export function secureIdHeaders(id: string, secret: string): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-client-id': id, 'x-client-secret': secret, 'x-api-version': '2024-12-01' };
    const raw = process.env.CASHFREE_VERIFICATION_PUBLIC_KEY?.trim();
    if (raw) {
        try {
            // Accept the PEM as pasted (real line breaks or "\n"), or just its base64 body.
            const pem = raw.includes('BEGIN PUBLIC KEY') ? raw.replace(/\\n/g, '\n') : `-----BEGIN PUBLIC KEY-----\n${raw}\n-----END PUBLIC KEY-----`;
            h['X-Cf-Signature'] = crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(`${id}.${Math.floor(Date.now() / 1000)}`)).toString('base64');
        } catch (e: any) {
            logger.error('[KYC] CASHFREE_VERIFICATION_PUBLIC_KEY could not be used to sign; calls go unsigned', { error: e?.message });
        }
    }
    return h;
}

export async function verifyBankAccount(input: { accountNumber: string; ifsc: string; name?: string | null }): Promise<BankCheck> {
    const id = process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    const secret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
    if (!id || !secret) {
        return { status: 'manual', reason: 'Automatic bank verification is not configured. UniteFix will check the account against your cancelled cheque.' };
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc.toUpperCase())) {
        return { status: 'failed', reason: 'That IFSC is not valid — 4 letters, a zero, then 6 letters or digits.', reference: null };
    }
    try {
        const res = await fetch(`${verificationBase()}/bank-account/sync`, {
            method: 'POST',
            headers: secureIdHeaders(id, secret),
            body: JSON.stringify({ bank_account: input.accountNumber, ifsc: input.ifsc.toUpperCase(), name: input.name ?? undefined }),
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            logger.warn('[KYC] Bank verification call failed', { status: res.status, code: body?.code });
            return { status: 'manual', reason: 'The bank check could not run right now. UniteFix will verify it by hand.' };
        }
        const ref = body?.reference_id != null ? String(body.reference_id) : null;
        if (String(body?.account_status).toUpperCase() === 'VALID') {
            return { status: 'verified', nameAtBank: body?.name_at_bank ?? null, reference: ref };
        }
        return { status: 'failed', reason: body?.account_status_code ? `The bank reported: ${body.account_status_code}` : 'The bank did not confirm this account.', reference: ref };
    } catch (err: any) {
        logger.warn('[KYC] Bank verification error', { error: err?.message });
        return { status: 'manual', reason: 'The bank check could not run right now. UniteFix will verify it by hand.' };
    }
}
