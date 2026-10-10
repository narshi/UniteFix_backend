/**
 * Cashfree Payouts — partner withdrawals.
 *
 * Replaces RazorpayXService for disbursement only. RazorpayX does not open
 * current accounts in this region, so it could never actually send money from
 * here; Razorpay itself stays exactly where it is for collections (booking fees,
 * bills, FTTH recharges). Two providers, one direction each.
 *
 * THE SHAPE OF THE API, because it is not what the HTTP layer suggests:
 *
 *   - Cashfree v1 answers almost everything with HTTP 200 and puts the real
 *     outcome in `status` ("SUCCESS" | "ERROR") plus a `subCode` that carries the
 *     HTTP-like code ("200", "409", "404"...). An axios try/catch alone will
 *     happily treat a rejected transfer as a success. Every call below reads the
 *     body, not the status line.
 *
 *   - The bearer token is short-lived (minutes). It is cached and refreshed on
 *     expiry or on a 403, never fetched per call.
 *
 *   - `transferId` IS the idempotency key. A repeated id is refused with 409
 *     rather than paid twice, which is the guarantee the RazorpayX path had via
 *     X-Payout-Idempotency. That refusal is treated as "already sent" and the
 *     existing transfer is returned, so a retried approval cannot disburse
 *     twice AND does not surface as a failure that tempts someone to try a
 *     third time under a new id.
 *
 *   - A beneficiary cannot be edited. If a partner changes their UPI id, the
 *     registered beneficiary still points at the OLD one, and addBeneficiary
 *     says 409 and leaves it that way. Sync therefore reads the beneficiary
 *     back, compares, and removes-then-re-adds on any difference. Without this a
 *     partner who updated their details keeps being paid to the account they
 *     left.
 *
 * MONEY: Cashfree takes rupees with two decimals. Callers pass rupees. Nothing
 * here converts to paise — the withdrawal amount is already a decimal string
 * in the database and goes out as it came in.
 */

import axios, { type AxiosInstance } from 'axios';
import { db } from '../db';
import { employees, users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger';
import crypto from 'crypto';
import { cashfreeLive, cashfreeEnvValid, cashfreePublicKey, cashfreeKeys, CASHFREE_VARS, type CashfreeProduct } from '../lib/cashfree-env';

type Employee = typeof employees.$inferSelect;

/** Cashfree's own vocabulary for a transfer, as returned by getTransferStatus. */
type CashfreeTransferStatus =
    | 'SUCCESS' | 'PENDING' | 'FAILED' | 'REVERSED' | 'REJECTED' | 'ERROR' | string;

/**
 * What callers get. Provider-neutral on purpose: the withdrawal routes already
 * had to translate RazorpayX's `processed | reversed | failed | cancelled` into
 * local state, and rewriting that translation for every provider is how the
 * same bug gets written twice. The raw status rides along for logs.
 */
export type PayoutStatus = 'processed' | 'processing' | 'failed' | 'reversed';

export interface CashfreeCheck {
    environment: 'PROD' | 'TEST';
    /** The /authorize call carried an X-Cf-Signature from CASHFREE_PUBLIC_KEY. */
    signed: boolean;
    v1: { ok: boolean; message: string; balance?: number | null; available?: number | null };
    v2: { ok: boolean; message: string };
    /** Cashgram's own keys (separate from Payouts). Nothing sends Cashgrams yet; this only proves the keys. */
    cashgram: { configured: boolean; ok: boolean; signed: boolean; message: string };
}

export interface PayoutResult {
    /** The transferId we chose — what the caller stores and later polls with. */
    id: string;
    transferId: string;
    referenceId: string | null;
    utr: string | null;
    /** True when Cashfree already had this transferId and we returned the original. */
    alreadyExisted: boolean;
    raw: unknown;
}

const BASE_URL: Record<string, string> = {
    PROD: 'https://payout-api.cashfree.com/payout/v1',
    TEST: 'https://payout-gamma.cashfree.com/payout/v1',
};

/** Refresh a little before Cashfree would refuse it, so no call lands on the edge. */
const TOKEN_SAFETY_MARGIN_MS = 30_000;

export class CashfreeService {

    /** One sign-in per product: Payouts and Cashgram have their own keys. */
    private static tokens: Partial<Record<CashfreeProduct, { value: string; expiresAt: number }>> = {};

    // ──────────────────────────────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────────────────────────────

    private static credentials(product: CashfreeProduct = 'payouts') {
        const keys = cashfreeKeys(product);
        if (!keys) {
            const v = CASHFREE_VARS[product];
            throw new Error(`Cashfree ${product === 'payouts' ? 'Payouts' : 'Cashgram'} is not configured: set ${v.id} and ${v.secret} in the server environment.`);
        }
        return keys;
    }

    private static baseUrl(): string {
        if (!cashfreeEnvValid()) {
            throw new Error(`CASHFREE_ENVIRONMENT must be PROD (or PRODUCTION) or TEST, got "${process.env.CASHFREE_ENVIRONMENT}".`);
        }
        return cashfreeLive() ? BASE_URL.PROD : BASE_URL.TEST;
    }

    /**
     * X-Cf-Signature for /authorize: "<clientId>.<unix seconds>" encrypted with
     * the Payouts public key (RSA-OAEP, SHA-1), base64. Cashfree accepts this
     * in place of a whitelisted IP. Null when no key is configured.
     */
    static signature(clientId: string, nowMs = Date.now(), product: CashfreeProduct = 'payouts'): string | null {
        const key = cashfreePublicKey(product);
        if (!key) return null;
        const plain = Buffer.from(`${clientId}.${Math.floor(nowMs / 1000)}`);
        return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, plain).toString('base64');
    }

    private static rawClient(): AxiosInstance {
        return axios.create({
            baseURL: this.baseUrl(),
            timeout: 20_000,
            headers: { 'Content-Type': 'application/json' },
            // Cashfree signals most failures in the body with HTTP 200, and signals
            // a few (404 on a missing beneficiary) with a real status. Let every
            // response through so one code path reads them all.
            validateStatus: () => true,
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Auth
    // ──────────────────────────────────────────────────────────────────────

    /**
     * POST /authorize — a bearer token from the client id and secret.
     *
     * Cached until shortly before expiry. Cashfree tokens live for minutes, and
     * the alternative — one authorize per call — doubles every request and
     * trips their rate limit on a busy approval afternoon.
     */
    static async getAuthToken(force = false, product: CashfreeProduct = 'payouts'): Promise<string> {
        const cached = this.tokens[product];
        if (!force && cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const { clientId, clientSecret } = this.credentials(product);
        const signature = this.signature(clientId, Date.now(), product);
        const res = await this.rawClient().post('/authorize', undefined, {
            headers: { 'X-Client-Id': clientId, 'X-Client-Secret': clientSecret, ...(signature ? { 'X-Cf-Signature': signature } : {}) },
        });

        const body = res.data ?? {};
        if (res.status !== 200 || body.status !== 'SUCCESS' || !body.data?.token) {
            const why = body.message || `HTTP ${res.status}`;
            logger.error(`[CASHFREE] ${product} authorize failed: ${why}`);
            const keyVar = CASHFREE_VARS[product].key;
            const hint = /ip|whitelist|signature/i.test(String(why))
                ? (signature ? ` Check that ${keyVar} is the current public key of this Cashfree account.` : ` Set ${keyVar} (Cashfree → Developers → Two-Factor Authentication), or whitelist the server IP.`)
                : '';
            throw new Error(`Cashfree authorization failed: ${why}.${hint}`);
        }

        // `expiry` is a unix timestamp in seconds.
        const expiresAtMs = Number(body.data.expiry) > 0
            ? Number(body.data.expiry) * 1000
            : Date.now() + 5 * 60_000;

        this.tokens[product] = { value: body.data.token, expiresAt: expiresAtMs - TOKEN_SAFETY_MARGIN_MS };
        return body.data.token;
    }

    /**
     * An authenticated request, retried once with a fresh token if Cashfree
     * says the current one is no longer good.
     */
    private static async call<T = any>(
        method: 'get' | 'post',
        path: string,
        body?: unknown,
    ): Promise<{ httpStatus: number; data: T }> {
        const attempt = async (token: string) => {
            const client = this.rawClient();
            const res = method === 'get'
                ? await client.get(path, { headers: { Authorization: `Bearer ${token}` } })
                : await client.post(path, body, { headers: { Authorization: `Bearer ${token}` } });
            return { httpStatus: res.status, data: res.data as T };
        };

        let result = await attempt(await this.getAuthToken());

        const tokenRejected = result.httpStatus === 403
            || /token/i.test(String((result.data as any)?.message ?? '')) && (result.data as any)?.status === 'ERROR';
        if (tokenRejected) {
            result = await attempt(await this.getAuthToken(true));
        }
        return result;
    }

    /** Cashfree's body-level verdict, which is the one that counts. */
    private static ok(data: any): boolean {
        return data?.status === 'SUCCESS' && String(data?.subCode ?? '200') === '200';
    }

    private static reason(data: any, httpStatus: number): string {
        return data?.message || data?.status || `HTTP ${httpStatus}`;
    }

    /**
     * A read-only connection check: authorize, then GET /getBalance. Moves no
     * money and touches no beneficiary — safe to run against production.
     */
    static async check(): Promise<CashfreeCheck> {
        const { clientId, clientSecret } = this.credentials();
        const environment = cashfreeLive() ? 'PROD' : 'TEST';
        const signature = this.signature(clientId);
        const out: CashfreeCheck = { environment, signed: !!signature, v1: { ok: false, message: '' }, v2: { ok: false, message: '' }, cashgram: { configured: false, ok: false, signed: false, message: '' } };

        // v1 — what payouts use today: sign in, then read the balance.
        try {
            await this.getAuthToken(true);
            const r = await this.call('get', '/getBalance');
            if (!this.ok(r.data)) throw new Error(this.reason(r.data, r.httpStatus));
            const d: any = (r.data as any).data ?? {};
            out.v1 = { ok: true, message: 'Signed in and read the balance.', balance: d.balance != null ? Number(d.balance) : null, available: d.availableBalance != null ? Number(d.availableBalance) : null };
        } catch (e: any) {
            out.v1 = { ok: false, message: e?.message ?? 'Failed' };
        }

        // v2 — what Cashfree is moving everyone to: look up a transfer that does
        // not exist. "Not found" proves the keys and signature are accepted.
        try {
            const base = environment === 'PROD' ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout';
            const res = await axios.get(`${base}/transfers`, {
                params: { transfer_id: 'uf_connection_probe' }, timeout: 20_000, validateStatus: () => true,
                headers: { 'x-client-id': clientId, 'x-client-secret': clientSecret, 'x-api-version': '2024-01-01', ...(signature ? { 'x-cf-signature': signature } : {}) },
            });
            const d: any = res.data ?? {};
            const reached = res.status === 200 || (res.status === 404 && d.type !== 'internal_error');
            out.v2 = reached
                ? { ok: true, message: 'Keys accepted.' }
                : { ok: false, message: `HTTP ${res.status}: ${d.message ?? d.code ?? 'no message'}` };
        } catch (e: any) {
            out.v2 = { ok: false, message: e?.message ?? 'Failed' };
        }

        // Cashgram — its own keys; a successful sign-in proves them.
        const cg = cashfreeKeys('cashgram');
        if (!cg) {
            out.cashgram = { configured: false, ok: false, signed: false, message: `Not set up (${CASHFREE_VARS.cashgram.id} / ${CASHFREE_VARS.cashgram.secret}).` };
        } else {
            const signedCg = !!this.signature(cg.clientId, Date.now(), 'cashgram');
            try {
                await this.getAuthToken(true, 'cashgram');
                out.cashgram = { configured: true, ok: true, signed: signedCg, message: 'Signed in.' };
            } catch (e: any) {
                out.cashgram = { configured: true, ok: false, signed: signedCg, message: e?.message ?? 'Failed' };
            }
        }
        return out;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Beneficiaries
    // ──────────────────────────────────────────────────────────────────────

    /** Cashfree accepts letters and spaces only in a beneficiary name, up to 100 chars. */
    private static beneName(raw: string | null | undefined, fallback = 'Service Provider'): string {
        const cleaned = String(raw ?? '').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
        return (cleaned.length >= 2 ? cleaned : fallback).slice(0, 100);
    }

    /** Cashfree wants 8–12 digits, no country code. */
    private static benePhone(raw: string | null | undefined): string {
        const digits = String(raw ?? '').replace(/\D/g, '');
        const trimmed = digits.length > 10 ? digits.slice(-10) : digits;
        return trimmed.length >= 8 ? trimmed : '9999999999';
    }

    /**
     * GET /getBeneficiary/{beneId}. Null when Cashfree does not know the id.
     * Used to detect a registered beneficiary whose details have since changed.
     */
    static async getBeneficiary(beneId: string): Promise<{
        bankAccount: string | null; ifsc: string | null; vpa: string | null;
    } | null> {
        const { httpStatus, data } = await this.call('get', `/getBeneficiary/${encodeURIComponent(beneId)}`);
        if (httpStatus === 404 || String(data?.subCode) === '404') return null;
        if (!this.ok(data)) {
            throw new Error(`Cashfree getBeneficiary failed: ${this.reason(data, httpStatus)}`);
        }
        const b = data.data ?? {};
        return {
            bankAccount: b.bankAccount ?? null,
            ifsc: b.ifsc ?? null,
            vpa: b.vpa ?? null,
        };
    }

    /** POST /removeBeneficiary. A missing beneficiary is not an error here. */
    static async removeBeneficiary(beneId: string): Promise<void> {
        const { httpStatus, data } = await this.call('post', '/removeBeneficiary', { beneId });
        if (httpStatus === 404 || String(data?.subCode) === '404') return;
        if (!this.ok(data)) {
            throw new Error(`Cashfree removeBeneficiary failed: ${this.reason(data, httpStatus)}`);
        }
    }

    /**
     * POST /addBeneficiary. Returns the beneId. A 409 "already exists" is
     * success — the caller has already decided the registered details match.
     */
    static async addBeneficiary(input: {
        beneId: string;
        name: string;
        email: string;
        phone: string;
        bankAccount?: string;
        ifsc?: string;
        vpa?: string;
        address1?: string;
    }): Promise<string> {
        const payload: Record<string, string> = {
            beneId: input.beneId,
            name: this.beneName(input.name),
            email: input.email,
            phone: this.benePhone(input.phone),
            // Mandatory in v1 even for UPI. Nobody is posting anything to it.
            address1: (input.address1 || 'Uttara Kannada, Karnataka').slice(0, 150),
        };
        if (input.bankAccount && input.ifsc) {
            payload.bankAccount = input.bankAccount.replace(/\s+/g, '');
            payload.ifsc = input.ifsc.trim().toUpperCase();
        } else if (input.vpa) {
            payload.vpa = input.vpa.trim().toLowerCase();
        } else {
            throw new Error('A beneficiary needs a bank account and IFSC, or a UPI id.');
        }

        const { httpStatus, data } = await this.call('post', '/addBeneficiary', payload);

        if (this.ok(data)) return input.beneId;
        if (String(data?.subCode) === '409') return input.beneId;   // already registered

        const why = this.reason(data, httpStatus);
        logger.error(`[CASHFREE] addBeneficiary ${input.beneId} failed: ${why}`);
        throw new Error(`Cashfree beneficiary setup failed: ${why}`);
    }

    /**
     * Make sure this partner has a Cashfree beneficiary that matches the payout
     * details on their profile RIGHT NOW, and return its id.
     *
     * Called from two places: the moment a partner saves their UPI id, and the
     * moment an admin approves a withdrawal. The second is a safety net for the
     * first — if the profile sync failed or was skipped, the approval still
     * cannot pay an unregistered partner.
     *
     * Bank account is preferred over UPI when both are present, matching the
     * RazorpayX behaviour this replaces so nobody's payout route changes under
     * them during the migration.
     */
    static async syncEmployeeForPayouts(employee: Employee): Promise<string> {
        const beneId = `EMP-${employee.id}`;

        const hasBank = !!(employee.bankAccountNumber && employee.bankIfsc);
        const hasUpi = !!employee.upiId;
        if (!hasBank && !hasUpi) {
            throw new Error('No bank account or UPI id on file for this partner.');
        }

        const wantBank = hasBank ? employee.bankAccountNumber!.replace(/\s+/g, '') : null;
        const wantIfsc = hasBank ? employee.bankIfsc!.trim().toUpperCase() : null;
        const wantVpa = !hasBank && hasUpi ? employee.upiId!.trim().toLowerCase() : null;

        // What Cashfree has for this partner, if anything.
        const existing = await this.getBeneficiary(beneId);

        const matches = !!existing && (wantBank
            ? (existing.bankAccount ?? '') === wantBank && (existing.ifsc ?? '').toUpperCase() === wantIfsc
            : (existing.vpa ?? '').toLowerCase() === wantVpa);

        if (existing && !matches) {
            // Details changed. Cashfree cannot edit a beneficiary, so it is
            // remove-then-add or keep paying the old account forever.
            logger.info(`[CASHFREE] Beneficiary ${beneId} details changed — re-registering`);
            await this.removeBeneficiary(beneId);
        }

        if (!existing || !matches) {
            const [user] = await db.select({
                email: users.email, phone: users.phone, username: users.username, homeAddress: users.homeAddress,
            }).from(users).where(eq(users.id, employee.userId)).limit(1);

            await this.addBeneficiary({
                beneId,
                name: employee.fullName || user?.username || 'Service Provider',
                email: user?.email || `partner-${employee.id}@unitefix.in`,
                phone: user?.phone || '',
                bankAccount: wantBank ?? undefined,
                ifsc: wantIfsc ?? undefined,
                vpa: wantVpa ?? undefined,
                address1: user?.homeAddress ?? undefined,
            });
        }

        // Registered and matching — or just made so. Record it if the column has
        // not caught up, which also covers a beneficiary registered by hand.
        if (employee.cashfreeBeneId !== beneId) {
            await db.update(employees)
                .set({ cashfreeBeneId: beneId, updatedAt: new Date() })
                .where(eq(employees.id, employee.id));
        }

        return beneId;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Transfers
    // ──────────────────────────────────────────────────────────────────────

    /**
     * POST /requestTransfer.
     *
     * `transferId` is the idempotency key. Cashfree refuses a repeat with 409,
     * and that refusal is returned as a success carrying the ORIGINAL transfer,
     * so a double-clicked or retried approval reports "already sent" instead of
     * either paying twice or failing in a way that invites a third attempt.
     *
     * Mode is IMPS for a bank beneficiary. A UPI-only beneficiary cannot take
     * IMPS, so it goes out as `upi` — the mode follows what was registered, not
     * what the caller asked for, because the caller has no way to know.
     */
    static async createPayout(
        beneId: string,
        amountInRupees: number,
        transferId: string,
        purpose: string = 'payout',
    ): Promise<PayoutResult> {
        if (!(amountInRupees >= 1)) {
            throw new Error(`Cashfree requires at least ₹1.00 per transfer (got ₹${amountInRupees}).`);
        }

        const bene = await this.getBeneficiary(beneId);
        if (!bene) {
            throw new Error(`Beneficiary ${beneId} is not registered with Cashfree. Run payout setup for this partner first.`);
        }
        const transferMode = bene.bankAccount ? 'imps' : 'upi';

        const { httpStatus, data } = await this.call('post', '/requestTransfer', {
            beneId,
            amount: amountInRupees.toFixed(2),
            transferId,
            transferMode,
            remarks: `UniteFix ${purpose}`.slice(0, 70),
        });

        if (this.ok(data)) {
            return {
                id: transferId,
                transferId,
                referenceId: data.data?.referenceId ?? null,
                utr: data.data?.utr ?? null,
                alreadyExisted: false,
                raw: data,
            };
        }

        // Cashfree already has this transferId — the earlier attempt went through.
        if (String(data?.subCode) === '409') {
            logger.warn(`[CASHFREE] Transfer ${transferId} already exists — returning the original, not paying again`);
            const status = await this.fetchPayoutStatus(transferId);
            return {
                id: transferId,
                transferId,
                referenceId: status.referenceId,
                utr: status.utr,
                alreadyExisted: true,
                raw: status.raw,
            };
        }

        const why = this.reason(data, httpStatus);
        logger.error(`[CASHFREE] requestTransfer ${transferId} failed: ${why}`);
        throw new Error(`Cashfree payout failed: ${why}`);
    }

    /**
     * GET /getTransferStatus?transferId=…
     *
     * The fallback when the webhook does not arrive. Cashfree's states are
     * mapped to the neutral set the withdrawal routes already understand:
     *
     *   SUCCESS                   → processed   (money landed; UTR present)
     *   PENDING                   → processing  (in the banking rails)
     *   FAILED | REJECTED | ERROR → failed      (nothing left the account)
     *   REVERSED                  → reversed    (left, then came back — refund the wallet)
     *
     * `reversed` is kept distinct from `failed` because it means money moved
     * twice, and a statement that says otherwise will not reconcile.
     */
    static async fetchPayoutStatus(transferId: string): Promise<{
        status: PayoutStatus;
        providerStatus: CashfreeTransferStatus;
        failureReason?: string;
        utr: string | null;
        referenceId: string | null;
        raw: unknown;
    }> {
        const { httpStatus, data } = await this.call(
            'get', `/getTransferStatus?transferId=${encodeURIComponent(transferId)}`,
        );

        if (!this.ok(data)) {
            const why = this.reason(data, httpStatus);
            logger.error(`[CASHFREE] getTransferStatus ${transferId} failed: ${why}`);
            throw new Error(`Cashfree status check failed: ${why}`);
        }

        const t = data.data?.transfer ?? {};
        const providerStatus: CashfreeTransferStatus = String(t.status ?? 'PENDING').toUpperCase();

        let status: PayoutStatus;
        switch (providerStatus) {
            case 'SUCCESS': status = 'processed'; break;
            case 'REVERSED': status = 'reversed'; break;
            case 'FAILED':
            case 'REJECTED':
            case 'ERROR': status = 'failed'; break;
            default: status = 'processing';
        }

        return {
            status,
            providerStatus,
            failureReason: t.reason || t.message || undefined,
            utr: t.utr ?? null,
            referenceId: t.referenceId ?? null,
            raw: data,
        };
    }
}
