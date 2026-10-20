/**
 * Cashfree Payouts — partner withdrawals.
 *
 * Replaces RazorpayXService for disbursement only. RazorpayX does not open
 * current accounts in this region, so it could never actually send money from
 * here; Razorpay itself stays exactly where it is for collections (booking fees,
 * bills, FTTH recharges). Two providers, one direction each.
 *
 * TRANSFERS AND BENEFICIARIES USE PAYOUTS v2 (Cashfree retired v1 for them).
 * The v1 sign-in (/authorize) and balance remain only for "Test connection".
 *
 *   - v1 answers almost everything with HTTP 200 and puts the real outcome in
 *     `status` plus a `subCode`; v2 uses real HTTP statuses. Both are read
 *     from the body, never from the status line alone.
 *
 *   - The v1 bearer token is short-lived (minutes). It is cached and refreshed
 *     on expiry or on a 403, never fetched per call.
 *
 *   - `transferId` IS the idempotency key. A repeated id is refused with 409
 *     rather than paid twice, which is the guarantee the RazorpayX path had via
 *     X-Payout-Idempotency. That refusal is treated as "already sent" and the
 *     existing transfer is returned, so a retried approval cannot disburse
 *     twice AND does not surface as a failure that tempts someone to try a
 *     third time under a new id.
 *
 *   - A beneficiary cannot be edited, and v2 refuses a second beneficiary for
 *     the same bank account. Beneficiary ids are therefore derived from the
 *     destination (beneIdFor): a partner who changes their UPI ID or account
 *     gets a new beneficiary, and nobody is ever paid to an account they left.
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
import { cashfreeLive, cashfreeEnvValid, cashfreePublicKey, cashfreeKeys, CASHFREE_VARS, cashfreeDiagnostics } from '../lib/cashfree-env';

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
    /** Which keys the server is using (masked) — to compare with the Cashfree dashboard. */
    using: ReturnType<typeof cashfreeDiagnostics> & { outboundIp: string | null };
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

    private static token: { value: string; expiresAt: number } | null = null;

    // ──────────────────────────────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────────────────────────────

    private static credentials() {
        const keys = cashfreeKeys();
        if (!keys) throw new Error(`Cashfree Payouts is not configured: set ${CASHFREE_VARS.id} and ${CASHFREE_VARS.secret} in the server environment.`);
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
    static signature(clientId: string, nowMs = Date.now()): string | null {
        const key = cashfreePublicKey();
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
    static async getAuthToken(force = false): Promise<string> {
        if (!force && this.token && this.token.expiresAt > Date.now()) {
            return this.token.value;
        }

        const { clientId, clientSecret } = this.credentials();
        const signature = this.signature(clientId);
        const res = await this.rawClient().post('/authorize', undefined, {
            headers: { 'X-Client-Id': clientId, 'X-Client-Secret': clientSecret, ...(signature ? { 'X-Cf-Signature': signature } : {}) },
        });

        const body = res.data ?? {};
        if (res.status !== 200 || body.status !== 'SUCCESS' || !body.data?.token) {
            const why = body.message || `HTTP ${res.status}`;
            logger.error(`[CASHFREE] authorize failed: ${why}`);
            const keyVar = CASHFREE_VARS.key;
            const hint = /ip|whitelist|signature/i.test(String(why))
                ? (signature ? ` Check that ${keyVar} is the current public key of this Cashfree account.` : ` Set ${keyVar} (Cashfree → Developers → Two-Factor Authentication), or whitelist the server IP.`)
                : '';
            throw new Error(`Cashfree authorization failed: ${why}.${hint}`);
        }

        // `expiry` is a unix timestamp in seconds.
        const expiresAtMs = Number(body.data.expiry) > 0
            ? Number(body.data.expiry) * 1000
            : Date.now() + 5 * 60_000;

        this.token = { value: body.data.token, expiresAt: expiresAtMs - TOKEN_SAFETY_MARGIN_MS };
        return this.token.value;
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
    /** The IP this server reaches the internet from right now — what Cashfree checks against its whitelist. */
    static async outboundIp(): Promise<string | null> {
        try {
            const r = await axios.get('https://api.ipify.org', { params: { format: 'json' }, timeout: 5000 });
            return typeof r.data?.ip === 'string' ? r.data.ip : null;
        } catch { return null; }
    }

    static async check(): Promise<CashfreeCheck> {
        const { clientId, clientSecret } = this.credentials();
        const environment = cashfreeLive() ? 'PROD' : 'TEST';
        const signature = this.signature(clientId);
        const out: CashfreeCheck = { environment, signed: !!signature, v1: { ok: false, message: '' }, v2: { ok: false, message: '' }, using: { ...cashfreeDiagnostics(), outboundIp: await this.outboundIp() } };

        // v1 — sign-in and balance only (transfers moved to v2).
        try {
            await this.getAuthToken(true);
            const r = await this.call('get', '/getBalance');
            if (!this.ok(r.data)) throw new Error(this.reason(r.data, r.httpStatus));
            const d: any = (r.data as any).data ?? {};
            out.v1 = { ok: true, message: 'Signed in and read the balance.', balance: d.balance != null ? Number(d.balance) : null, available: d.availableBalance != null ? Number(d.availableBalance) : null };
        } catch (e: any) {
            out.v1 = { ok: false, message: e?.message ?? 'Failed' };
        }

        // v2 — what transfers use: look up a transfer that does not exist.
        // "Not found" proves the keys and signature are accepted.
        try {
            const r = await this.v2('get', '/transfers', { params: { transfer_id: 'uf_connection_probe' } });
            const d: any = r.data ?? {};
            const reached = r.httpStatus === 200 || (r.httpStatus === 404 && d.type !== 'internal_error');
            out.v2 = reached ? { ok: true, message: 'Keys accepted.' } : { ok: false, message: `HTTP ${r.httpStatus}: ${d.message ?? d.code ?? 'no message'}` };
        } catch (e: any) {
            out.v2 = { ok: false, message: e?.message ?? 'Failed' };
        }

        return out;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Payouts v2 (Cashfree retired v1 transfers: "The payout v1 and v1.2 APIs
    // have been deprecated. Please use v2 APIs.")
    //
    //   - Every call carries x-client-id / x-client-secret / x-api-version and,
    //     when a public key is set, a fresh x-cf-signature (valid 5 minutes).
    //   - Answers use real HTTP statuses; errors are { type, code, message }.
    //   - transfer_id allows letters, digits and underscores only, so ids made
    //     elsewhere (WDRW-12, DEP-REF-5) are mapped to WDRW_12 / DEP_REF_5 —
    //     the same mapping on the way in and when looking a transfer up.
    // ──────────────────────────────────────────────────────────────────────

    private static v2Base(): string {
        if (!cashfreeEnvValid()) {
            throw new Error(`CASHFREE_ENVIRONMENT must be PROD (or PRODUCTION) or TEST, got "${process.env.CASHFREE_ENVIRONMENT}".`);
        }
        return cashfreeLive() ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout';
    }

    private static async v2<T = any>(method: 'get' | 'post' | 'delete', path: string, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<{ httpStatus: number; data: T }> {
        const { clientId, clientSecret } = this.credentials();
        const signature = this.signature(clientId);
        const res = await axios.request({
            method, url: `${this.v2Base()}${path}`, params: opts.params, data: opts.body,
            timeout: 20_000, validateStatus: () => true,
            headers: {
                'Content-Type': 'application/json', 'x-api-version': '2024-01-01',
                'x-client-id': clientId, 'x-client-secret': clientSecret,
                ...(signature ? { 'x-cf-signature': signature } : {}),
            },
        });
        return { httpStatus: res.status, data: res.data as T };
    }

    private static v2Reason(data: any, httpStatus: number): string {
        return data?.message || data?.code || `HTTP ${httpStatus}`;
    }

    /** Cashfree v2 transfer ids: letters, digits and underscores, up to 40. */
    static v2TransferId(raw: string): string {
        return String(raw).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
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
     * The beneficiary id for a destination: the same bank account (or UPI ID)
     * always maps to the same id, whoever is being paid. Cashfree v2 refuses a
     * second beneficiary for an account it already has, and a beneficiary
     * cannot be edited — so an id tied to the destination, not the person,
     * never collides and never points at an account someone has left.
     * Alphanumeric only: UFB… for bank, UFU… for UPI.
     */
    static beneIdFor(dest: { bankAccount?: string | null; ifsc?: string | null; vpa?: string | null }): string {
        const bank = dest.bankAccount && dest.ifsc ? `${dest.bankAccount.replace(/\s+/g, '')}:${dest.ifsc.trim().toUpperCase()}` : null;
        const key = bank ?? `upi:${String(dest.vpa ?? '').trim().toLowerCase()}`;
        return `UF${bank ? 'B' : 'U'}${crypto.createHash('sha256').update(key).digest('hex').slice(0, 30).toUpperCase()}`;
    }

    /** GET /beneficiary?beneficiary_id=… — null when Cashfree does not know it. */
    static async getBeneficiary(beneId: string): Promise<{ beneId: string; bankAccount: string | null; ifsc: string | null; vpa: string | null } | null> {
        const { httpStatus, data } = await this.v2('get', '/beneficiary', { params: { beneficiary_id: beneId } });
        if (httpStatus === 404) return null;
        if (httpStatus !== 200) throw new Error(`Cashfree beneficiary lookup failed: ${this.v2Reason(data, httpStatus)}`);
        const d: any = data ?? {};
        const i = d.beneficiary_instrument_details ?? {};
        return { beneId: d.beneficiary_id ?? beneId, bankAccount: i.bank_account_number ?? null, ifsc: i.bank_ifsc ?? null, vpa: i.vpa ?? null };
    }

    /**
     * Make sure Cashfree has a beneficiary for this destination, and return
     * the id to pay. The id comes from the destination (beneIdFor); any
     * `beneId` passed in is ignored. When Cashfree already holds this bank
     * account under another id (registered earlier, or by hand on the
     * dashboard), that id is returned instead.
     */
    static async addBeneficiary(input: {
        beneId?: string;
        name: string;
        email: string;
        phone: string;
        bankAccount?: string;
        ifsc?: string;
        vpa?: string;
        address1?: string;
    }): Promise<string> {
        const bankAccount = input.bankAccount ? input.bankAccount.replace(/\s+/g, '') : '';
        const ifsc = input.ifsc ? input.ifsc.trim().toUpperCase() : '';
        const vpa = input.vpa ? input.vpa.trim().toLowerCase() : '';
        if (!(bankAccount && ifsc) && !vpa) throw new Error('A beneficiary needs a bank account and IFSC, or a UPI id.');
        const toBank = !!(bankAccount && ifsc);
        const beneId = this.beneIdFor(toBank ? { bankAccount, ifsc } : { vpa });
        const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) ? input.email : 'payouts@unitefix.com';

        const { httpStatus, data } = await this.v2('post', '/beneficiary', {
            body: {
                beneficiary_id: beneId,
                beneficiary_name: this.beneName(input.name),
                beneficiary_instrument_details: toBank ? { bank_account_number: bankAccount, bank_ifsc: ifsc } : { vpa },
                beneficiary_contact_details: {
                    beneficiary_email: email.slice(0, 200),
                    beneficiary_phone: this.benePhone(input.phone),
                    beneficiary_country_code: '+91',
                    beneficiary_address: String(input.address1 || 'Uttara Kannada Karnataka').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150),
                },
            },
        });
        if (httpStatus === 200 || httpStatus === 201) return beneId;

        if (httpStatus === 409) {
            // Already registered. The id is a hash of the destination, so a
            // beneficiary with OUR id is this same UPI ID / account from an
            // earlier payout (or test payout) — reuse it. Decided by looking it
            // up and by the error naming the id, not by one exact error code,
            // which Cashfree does not keep consistent. Refused only when the
            // lookup shows a clearly different destination under that id.
            const mine = await this.getBeneficiary(beneId).catch(() => undefined);
            const idTaken = !!mine || /beneficiary[_ ]?id/i.test(`${(data as any)?.code ?? ''} ${(data as any)?.message ?? ''}`);
            if (idTaken) {
                const shown = (v: string | null | undefined) => (v && !/[*xX]{3,}/.test(v) ? v : null); // Cashfree may mask
                const differs = !!mine && (toBank
                    ? (!!shown(mine.bankAccount) && mine.bankAccount!.replace(/\s+/g, '') !== bankAccount) || (!!mine.ifsc && mine.ifsc.toUpperCase() !== ifsc)
                    : !!shown(mine.vpa) && mine.vpa!.trim().toLowerCase() !== vpa);
                if (!differs) return beneId;
                logger.error(`[CASHFREE] beneficiary ${beneId} exists with different details`);
            }
        }
        if (httpStatus === 409 && toBank) {
            // This account is registered under another id — pay that one.
            const r = await this.v2('get', '/beneficiary', { params: { bank_account_number: bankAccount, bank_ifsc: ifsc } });
            const existing = (r.data as any)?.beneficiary_id;
            if (r.httpStatus === 200 && existing) return String(existing);
        }
        const why = this.v2Reason(data, httpStatus);
        logger.error(`[CASHFREE] beneficiary ${beneId} not created: ${why}`);
        if (httpStatus === 409) {
            throw new Error(`Cashfree beneficiary setup failed: ${why}. This ${toBank ? 'account' : 'UPI ID'} is already registered in Cashfree under another beneficiary — remove it under Payouts → Beneficiaries in the Cashfree dashboard, then try again.`);
        }
        throw new Error(`Cashfree beneficiary setup failed: ${why}`);
    }

    /**
     * The beneficiary for this partner's payout details as they are RIGHT NOW,
     * and its id. A withdrawal pays the way the expert asked (`prefer`: their
     * UPI ID or their bank account) and refuses if that one is not on file,
     * rather than paying somewhere they did not choose. Without `prefer`
     * (profile sync, refunds), the bank account wins when both are present.
     * Called when a partner saves their UPI ID and again when a payout is
     * approved, so an approval can never pay a partner who was not set up.
     */
    static async syncEmployeeForPayouts(employee: Employee, prefer?: 'upi' | 'bank' | string | null): Promise<string> {
        const hasBank = !!(employee.bankAccountNumber && employee.bankIfsc);
        const hasUpi = !!employee.upiId;
        if (!hasBank && !hasUpi) {
            throw new Error('No bank account or UPI id on file for this partner.');
        }
        if (prefer === 'upi' && !hasUpi) throw new Error('This withdrawal asked for UPI, but no UPI ID is on file for this partner.');
        if (prefer === 'bank' && !hasBank) throw new Error('This withdrawal asked for a bank transfer, but no bank account and IFSC are on file for this partner.');
        const useBank = prefer === 'upi' ? false : prefer === 'bank' ? true : hasBank;
        const [user] = await db.select({
            email: users.email, phone: users.phone, username: users.username, homeAddress: users.homeAddress,
        }).from(users).where(eq(users.id, employee.userId)).limit(1);

        const beneId = await this.addBeneficiary({
            name: employee.fullName || user?.username || 'Service Provider',
            email: user?.email || `partner-${employee.id}@unitefix.in`,
            phone: user?.phone || '',
            ...(useBank ? { bankAccount: employee.bankAccountNumber!, ifsc: employee.bankIfsc! } : { vpa: employee.upiId! }),
            address1: user?.homeAddress ?? undefined,
        });

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
     * POST /transfers.
     *
     * `transferId` is the idempotency key: a repeat is refused with 409, and
     * that refusal returns the ORIGINAL transfer as "already sent", so a
     * retried approval neither pays twice nor fails in a way that invites a
     * third try. On a 5xx or a timeout Cashfree says not to send again; the
     * transfer is looked up, and if Cashfree cannot say, it is reported as in
     * progress — never as failed, because a "failed" refunds the wallet and
     * the money may already be on its way.
     *
     * Mode is UPI for a UPI beneficiary and IMPS for a bank one.
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
        const tid = this.v2TransferId(transferId);

        let mode: 'upi' | 'imps';
        if (beneId.startsWith('UFU')) mode = 'upi';
        else if (beneId.startsWith('UFB')) mode = 'imps';
        else {
            const bene = await this.getBeneficiary(beneId);
            if (!bene) throw new Error(`Beneficiary ${beneId} is not registered with Cashfree. Run payout setup for this partner first.`);
            mode = bene.bankAccount ? 'imps' : 'upi';
        }

        const result = (raw: unknown, alreadyExisted: boolean, d: any = {}): PayoutResult => ({
            id: tid, transferId: tid, referenceId: d.cf_transfer_id ? String(d.cf_transfer_id) : null,
            utr: d.transfer_utr ?? null, alreadyExisted, raw,
        });

        let httpStatus = 0, data: any = null;
        try {
            ({ httpStatus, data } = await this.v2('post', '/transfers', {
                body: {
                    transfer_id: tid,
                    transfer_amount: Number(amountInRupees.toFixed(2)),
                    transfer_currency: 'INR',
                    transfer_mode: mode,
                    beneficiary_details: { beneficiary_id: beneId },
                    transfer_remarks: `UniteFix ${purpose}`.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70),
                },
            }));
        } catch (e: any) {
            httpStatus = 0;   // timeout or network: treat like a 5xx below
            logger.error(`[CASHFREE] transfer ${tid} request did not complete: ${e?.message}`);
        }

        if (httpStatus === 200 || httpStatus === 201) {
            const st = String(data?.status ?? '').toUpperCase();
            if (['FAILED', 'REJECTED', 'MANUALLY_REJECTED'].includes(st)) {
                const why = data?.status_description || data?.status_code || st;
                logger.error(`[CASHFREE] transfer ${tid} ${st}: ${why}`);
                throw new Error(`Cashfree payout failed: ${why}`);
            }
            return result(data, false, data);
        }

        if (httpStatus === 409) {
            logger.warn(`[CASHFREE] Transfer ${tid} already exists — returning the original, not paying again`);
            const status = await this.fetchPayoutStatus(tid);
            return { id: tid, transferId: tid, referenceId: status.referenceId, utr: status.utr, alreadyExisted: true, raw: status.raw };
        }

        if (httpStatus === 0 || httpStatus >= 500) {
            try {
                const status = await this.fetchPayoutStatus(tid);
                if (status.status === 'failed') throw new Error(`Cashfree payout failed: ${status.failureReason ?? status.providerStatus}`);
                return { id: tid, transferId: tid, referenceId: status.referenceId, utr: status.utr, alreadyExisted: false, raw: status.raw };
            } catch (e: any) {
                if (/payout failed/.test(e?.message ?? '')) throw e;
                if (/not found/i.test(e?.message ?? '')) throw new Error(`Cashfree payout failed: Cashfree did not take the transfer (${this.v2Reason(data, httpStatus)}).`);
                // Cashfree could not tell us either way — leave it in progress, never refund on a guess.
                logger.error(`[CASHFREE] transfer ${tid}: outcome unknown after ${httpStatus || 'timeout'}; left in progress for a status check`);
                return { id: tid, transferId: tid, referenceId: null, utr: null, alreadyExisted: false, raw: data };
            }
        }

        const why = this.v2Reason(data, httpStatus);
        const code = (data as any)?.code ? `, code ${(data as any).code}` : '';
        const type = (data as any)?.type ? `, type ${(data as any).type}` : '';
        logger.error(`[CASHFREE] transfer ${tid} refused (${httpStatus}): ${why}`, { response: data, url: `${this.v2Base()}/transfers`, apiVersion: '2024-01-01', mode });
        // Exactly what Cashfree answered, so a refusal can be taken to Cashfree support as it is.
        throw new Error(`Cashfree payout failed: ${why} [POST ${this.v2Base()}/transfers, x-api-version 2024-01-01 → HTTP ${httpStatus}${code}${type}]`);
    }

    /**
     * GET /transfers?transfer_id=…, mapped to the neutral set the withdrawal
     * and settlement code understands:
     *
     *   SUCCESS                                   → processed (money landed; UTR present)
     *   RECEIVED | QUEUED | PENDING | APPROVAL_PENDING → processing
     *   FAILED | REJECTED | MANUALLY_REJECTED     → failed    (nothing left the account)
     *   REVERSED                                  → reversed  (left, then came back)
     *
     * APPROVAL_PENDING means Cashfree is holding it for approval on its
     * dashboard (Payouts → Transfers → Approve) — the reason says so.
     */
    static async fetchPayoutStatus(transferId: string): Promise<{
        status: PayoutStatus;
        providerStatus: CashfreeTransferStatus;
        failureReason?: string;
        utr: string | null;
        referenceId: string | null;
        raw: unknown;
    }> {
        const tid = this.v2TransferId(transferId);
        const { httpStatus, data } = await this.v2('get', '/transfers', { params: { transfer_id: tid } });
        if (httpStatus === 404) throw new Error(`Cashfree has no transfer ${tid} (not found).`);
        if (httpStatus !== 200) {
            const why = this.v2Reason(data, httpStatus);
            logger.error(`[CASHFREE] transfer status ${tid} failed: ${why}`);
            throw new Error(`Cashfree status check failed: ${why}`);
        }
        const d: any = data ?? {};
        const providerStatus: CashfreeTransferStatus = String(d.status ?? 'PENDING').toUpperCase();
        let status: PayoutStatus;
        switch (providerStatus) {
            case 'SUCCESS': status = 'processed'; break;
            case 'REVERSED': status = 'reversed'; break;
            case 'FAILED':
            case 'REJECTED':
            case 'MANUALLY_REJECTED': status = 'failed'; break;
            default: status = 'processing';
        }
        const failureReason = providerStatus === 'APPROVAL_PENDING'
            ? `Waiting for approval on the Cashfree dashboard (Payouts → Transfers → Approve)${d.status_code ? ` — ${d.status_code}` : ''}`
            : (d.status_description || (status !== 'processed' && d.status_code && d.status_code !== providerStatus ? d.status_code : undefined) || undefined);
        return {
            status,
            providerStatus,
            failureReason,
            utr: d.transfer_utr ?? null,
            referenceId: d.cf_transfer_id ? String(d.cf_transfer_id) : null,
            raw: data,
        };
    }
}
