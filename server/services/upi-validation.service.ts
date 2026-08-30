/**
 * Does this UPI ID actually exist, and whose is it?
 *
 * Format checks (shared/upi.ts) catch a malformed id. They cannot catch a
 * well-formed one that belongs to nobody, and they certainly cannot catch one
 * that belongs to somebody ELSE — which is the case that actually loses money.
 * Only the PSP knows, and the answer it gives back is the registered name.
 *
 * Uses Razorpay's Validate VPA endpoint on the standard payment-gateway keys, so
 * unlike the RazorpayX fund-account sync this does NOT need RazorpayX activated.
 *
 * DEGRADES, NEVER BLOCKS. Razorpay gates this endpoint on some accounts and it
 * may need enabling through support; it can also simply be down. In every one of
 * those cases this returns `unverified` rather than throwing, and the caller
 * saves the id with a warning. Locking a partner out of getting paid because a
 * third-party endpoint is unavailable would be a worse bug than the one this
 * exists to prevent.
 */

import axios from 'axios';
import { configService } from './config.service';
import logger from '../lib/logger';

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
    static async verify(vpa: string): Promise<UpiVerification> {
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
