/**
 * Does this UPI ID actually exist, and whose is it?
 *
 * Format checks (shared/upi.ts) catch a malformed id. They cannot catch a
 * well-formed one that belongs to nobody, and they certainly cannot catch one
 * that belongs to somebody ELSE — which is the case that actually loses money.
 * Only the PSP knows, and the answer it gives back is the registered name.
 *
 * Asks Cashfree first — the Payouts "Validate Payout" call answers with the
 * name registered at the bank, using the same Payouts keys that send the money,
 * and needs no separate activation for UPI. Razorpay's Validate VPA is the
 * fallback, only when PAYMENT_CONFIG.UPI_VPA_VALIDATION_ENABLED is switched on
 * (Razorpay gates it per account).
 *
 * DEGRADES, NEVER BLOCKS. Razorpay gates this endpoint on some accounts and it
 * may need enabling through support; it can also simply be down. In every one of
 * those cases this returns `unverified` rather than throwing, and the caller
 * saves the id with a warning. Locking a partner out of getting paid because a
 * third-party endpoint is unavailable would be a worse bug than the one this
 * exists to prevent.
 */

import axios from 'axios';
import crypto from 'crypto';
import { configService } from './config.service';
import logger from '../lib/logger';
import { cashfreeKeys, cashfreeLive } from '../lib/cashfree-env';
import { CashfreeService } from './cashfree.service';

export type UpiVerificationStatus = 'valid' | 'invalid' | 'unverified';

export interface UpiVerification {
    status: UpiVerificationStatus;
    /** The name the VPA is registered to. Present only when status is 'valid'. */
    customerName?: string;
    /** Why we could not check. Present only when status is 'unverified'. */
    reason?: string;
}

export class UpiValidationService {

    private static async credentials(): Promise<{ keyId: string; keySecret: string } | null> {
        const keyId = process.env.RAZORPAY_KEY_ID
            || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_ID'))
            || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET
            || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_SECRET'))
            || '';

        // Seed placeholders look like credentials but are not.
        if (!keyId || !keySecret || keyId.includes('xxxxx') || keySecret.includes('xxxxx')) {
            return null;
        }
        return { keyId, keySecret };
    }

    /**
     * Ask Razorpay whether a VPA exists.
     *
     * In test mode Razorpay answers deterministically: `success@razorpay` is
     * valid and `failure@razorpay` is not, which is how the smoke test exercises
     * both paths without a live account.
     */
    /**
     * Cashfree Payouts → POST /payout/validatePayout { transfer_id, vpa }.
     * VALID comes with name_at_bank; INVALID is an answer; anything else
     * (feature off, keys refused, Cashfree down) is "could not check".
     * The transfer token it also returns is never used — it expires unused.
     */
    /** Cashfree's host; a test points it at a local stand-in. */
    static cashfreeBaseUrl = () => (cashfreeLive() ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com');

    static async verifyWithCashfree(vpa: string): Promise<UpiVerification> {
        const keys = cashfreeKeys();
        if (!keys) return { status: 'unverified', reason: 'Payment provider not configured' };
        const base = this.cashfreeBaseUrl();
        const signature = CashfreeService.signature(keys.clientId);
        try {
            const res = await axios.post(`${base}/payout/validatePayout`,
                { transfer_id: `upiv_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`, vpa },
                {
                    timeout: 8000, validateStatus: () => true,
                    headers: {
                        'Content-Type': 'application/json', 'x-api-version': '2024-01-01',
                        'x-client-id': keys.clientId, 'x-client-secret': keys.clientSecret,
                        ...(signature ? { 'x-cf-signature': signature } : {}),
                    },
                });
            const d: any = res.data ?? {};
            const accountStatus = String(d.account_status ?? '').toUpperCase();
            if (res.status === 200 && accountStatus === 'VALID') {
                const name = typeof d.name_at_bank === 'string' && d.name_at_bank.trim() ? d.name_at_bank.trim() : undefined;
                return { status: 'valid', customerName: name };
            }
            if ((res.status === 200 && accountStatus === 'INVALID') || (res.status === 400 && /vpa/i.test(`${d.code ?? ''} ${d.message ?? ''}`))) {
                return { status: 'invalid' };
            }
            logger.warn('[UPI_VALIDATION] Cashfree could not verify VPA', { httpStatus: res.status, code: d.code, message: d.message });
            return {
                status: 'unverified',
                reason: res.status === 401 || res.status === 403 ? 'Cashfree refused the Payouts keys'
                    : res.status === 422 ? 'UPI validation is not enabled on the Cashfree account'
                    : 'Could not reach the payment provider',
            };
        } catch (error: any) {
            logger.warn('[UPI_VALIDATION] Cashfree VPA check failed', { error: error?.message });
            return { status: 'unverified', reason: 'Could not reach the payment provider' };
        }
    }

    static async verify(vpa: string): Promise<UpiVerification> {
        // Cashfree Payouts first, when its keys are configured.
        if (cashfreeKeys()) {
            const r = await this.verifyWithCashfree(vpa);
            if (r.status !== 'unverified') return r;
            // Could not check with Cashfree — fall through to Razorpay if it is on.
            const razorpayOn = String(await configService.get('PAYMENT_CONFIG.UPI_VPA_VALIDATION_ENABLED', 'false')).toLowerCase() === 'true';
            if (!razorpayOn) return r;
        }

        // OFF until Razorpay verifies the account for the Validate VPA API.
        //
        // A flag rather than commented-out code, for two reasons. Commented code
        // rots — nobody re-reads it, and by the time Razorpay says yes the
        // surrounding function has moved on. And with a flag, switching it on is
        // a config edit on the Settings screen, not a code change and a deploy.
        //
        // Leaving the call live while it cannot succeed is not free: every UPI
        // save fires an HTTP request that is certain to fail, and the partner
        // waits out the 8-second timeout before their id saves.
        //
        // Everything downstream already handles this correctly. `unverified`
        // means "nobody checked", so the id still saves, upi_verified_at stays
        // NULL, and the admin payout dialog shows "Not verified — confirm with
        // the partner before transferring". Manual payouts are unaffected.
        const enabled = String(
            await configService.get('PAYMENT_CONFIG.UPI_VPA_VALIDATION_ENABLED', 'false'),
        ).toLowerCase() === 'true';

        if (!enabled) {
            return {
                status: 'unverified',
                reason: 'UPI verification is not switched on for this account yet',
            };
        }

        const creds = await this.credentials();
        if (!creds) {
            return { status: 'unverified', reason: 'Payment provider not configured' };
        }

        try {
            const { data } = await axios.post(
                'https://api.razorpay.com/v1/payments/validate/vpa',
                { vpa },
                {
                    auth: { username: creds.keyId, password: creds.keySecret },
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 8000,
                },
            );

            if (data?.success === true) {
                return {
                    status: 'valid',
                    // Razorpay returns the name registered against the VPA. This is
                    // the whole point — it is what lets a partner notice they have
                    // typed a stranger's id.
                    customerName: typeof data.customer_name === 'string' && data.customer_name.trim()
                        ? data.customer_name.trim()
                        : undefined,
                };
            }

            return { status: 'invalid' };
        } catch (error: any) {
            const status = error?.response?.status;
            const description = error?.response?.data?.error?.description;

            // A 400 from this endpoint genuinely means "no such VPA" — that is an
            // answer, not a failure.
            if (status === 400 && /vpa/i.test(description ?? '')) {
                return { status: 'invalid' };
            }

            // Everything else — 401 (feature not enabled on the account), 5xx,
            // timeouts, DNS — means we could not find out. Say so honestly rather
            // than condemning a UPI id that may well be fine.
            logger.warn('[UPI_VALIDATION] Could not verify VPA', {
                vpa, httpStatus: status, description, error: error?.message,
            });

            return {
                status: 'unverified',
                reason: status === 401 || status === 403
                    ? 'VPA validation is not enabled on this Razorpay account'
                    : 'Could not reach the payment provider',
            };
        }
    }
}
