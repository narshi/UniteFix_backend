/**
 * Partner identity checks — automatic through Cashfree Secure ID, or by hand.
 *
 *   Automatic  PAN, GSTIN, bank account (penny drop), driving licence and
 *              vehicle RC, against the government registries via Cashfree.
 *              Keys: CASHFREE_VERIFICATION_CLIENT_ID / _SECRET (a separate
 *              product from Payouts and the Payment Gateway). Without them,
 *              or when Cashfree is down, the check says so and staff do it.
 *   By hand    Any check, by staff, with a note of how it was checked and the
 *              document compared. FSSAI is always by hand: Cashfree has no
 *              FSSAI lookup.
 *
 * Every result is a new row in partner_verification_checks (who, how, what
 * the registry said); the newest row per check is the current result. The
 * summary columns on business_partners (pan_status, gstin_status,
 * bank_status) follow it, so existing screens keep working.
 *
 * A name that does not match the business (PAN holder, GST legal name, bank
 * account holder) is never passed: it goes to staff as needs_review. A bank
 * account is never marked verified on a mismatched name, since payouts go there.
 *
 * Auto-approval: a partner whose verticals all allow it (AUTO_APPROVE_VERTICALS)
 * is approved by the system the moment the last required document, agreement
 * and check is in place. Everyone else is approved by staff.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { businessPartners, partnerVerificationChecks, partnerDocuments } from '@shared/schema';
import { AUTOMATIC_CHECKS, AUTO_APPROVE_VERTICALS, CHECK_LABEL, checksFor, type CheckCode } from '@shared/hub';
import { cashfreeLive } from '../lib/cashfree-env';
import { HubError } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { verifyBankAccount, secureIdHeaders } from './kyc.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

type Check = typeof partnerVerificationChecks.$inferSelect;
type Outcome = 'verified' | 'failed' | 'needs_review' | 'manual_required';

const base = () => (cashfreeLive() ? 'https://api.cashfree.com/verification' : 'https://sandbox.cashfree.com/verification');
const keys = () => {
    const id = process.env.CASHFREE_VERIFICATION_CLIENT_ID?.trim(), secret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET?.trim();
    return id && secret ? { id, secret } : null;
};
export const automaticChecksConfigured = () => !!keys();

/** PAN shows its last 4; licence and RC numbers their last 4; GSTIN is public on invoices. */
const mask = (v: string | null | undefined, keep = 4) => (v ? `${'•'.repeat(Math.max(0, v.length - keep))}${v.slice(-keep)}` : null);

// ── Names ────────────────────────────────────────────────────────────────

const STOP = new Set(['M/S', 'MS', 'MESSRS', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'CO', 'COMPANY', 'AND', 'THE', 'ENTERPRISES', 'ENTERPRISE', 'SHRI', 'SRI', 'SMT', 'MR', 'MRS', 'DR']);
const tokens = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));

/** match: same words; partial: most words shared; mismatch: few or none. */
export function compareNames(expected: Array<string | null | undefined>, found: string | null | undefined): 'match' | 'partial' | 'mismatch' | null {
    if (!found) return null;
    const f = tokens(found);
    let best: 'match' | 'partial' | 'mismatch' = 'mismatch';
    for (const e of expected) {
        if (!e) continue;
        const x = tokens(e);
        if (!x.length || !f.length) continue;
        const shared = x.filter(t => f.includes(t)).length;
        const ratio = shared / Math.min(x.length, f.length);
        if (shared === x.length && shared === f.length) return 'match';
        if (ratio >= 0.6) best = 'partial';
    }
    return best;
}

/** Cashfree's own name-match verdict, when it gives one. */
const cashfreeNameVerdict = (r: unknown): 'match' | 'partial' | 'mismatch' | null => {
    const v = String(r ?? '').toUpperCase();
    if (v === 'DIRECT_MATCH') return 'match';
    if (v === 'GOOD_PARTIAL_MATCH' || v === 'MODERATE_PARTIAL_MATCH') return 'partial';
    if (v === 'POOR_PARTIAL_MATCH' || v === 'NO_MATCH') return 'mismatch';
    return null;
};

/** A date field somewhere in a registry answer (validity, expiry, valid upto), as yyyy-mm-dd. */
function findDate(obj: any, key: RegExp, depth = 0): string | null {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && key.test(k)) {
            const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
            if (m) return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
        }
        if (v && typeof v === 'object') { const d = findDate(v, key, depth + 1); if (d) return d; }
    }
    return null;
}

// ── Cashfree Secure ID ───────────────────────────────────────────────────

type CallResult = { kind: 'ok'; body: any } | { kind: 'rejected'; body: any; status: number } | { kind: 'unavailable'; reason: string };

async function secureId(path: string, payload: Record<string, unknown>): Promise<CallResult> {
    const k = keys();
    if (!k) return { kind: 'unavailable', reason: 'not_configured' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
        const res = await fetch(`${base()}${path}`, {
            method: 'POST', signal: ctl.signal,
            headers: secureIdHeaders(k.id, k.secret),
            body: JSON.stringify(payload),
        });
        const body: any = await res.json().catch(() => ({}));
        if (res.ok) return { kind: 'ok', body };
        // 4xx with a reason (a malformed number, not found) is an answer; 401/403/429/5xx are not.
        if (res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) return { kind: 'rejected', body, status: res.status };
        logger.warn(`[VERIFY] Cashfree ${path} answered ${res.status}`, { code: body?.code });
        return { kind: 'unavailable', reason: res.status === 401 || res.status === 403 ? 'keys_refused' : `http_${res.status}` };
    } catch (e: any) {
        logger.warn(`[VERIFY] Cashfree ${path} unreachable: ${e?.message}`);
        return { kind: 'unavailable', reason: 'unreachable' };
    } finally {
        clearTimeout(timer);
    }
}

/** What a driving licence or vehicle RC answer means: valid, expired, or valid with lapsed insurance or permit. */
function readLicenceOrRc(check: 'driving_licence' | 'vehicle_rc', b: any) {
    const valid = /^VALID$/i.test(String(b?.status ?? '')) || b?.valid === true;
    const nameFound: string | null = b?.details_of_driving_licence?.name ?? b?.owner ?? b?.owner_name ?? b?.name ?? null;
    const validUntil = check === 'driving_licence' ? findDate(b, /valid|expir|upto/i) : findDate(b, /rc_expiry|reg_upto|fit_up_to|expiry/i);
    const insuranceUpto = check === 'vehicle_rc' ? findDate(b, /insurance/i) : null;
    const permitUpto = check === 'vehicle_rc' ? findDate(b, /permit/i) : null;
    const detail: Record<string, unknown> = check === 'vehicle_rc' ? { insuranceUpto, permitUpto, vehicleClass: b?.class ?? b?.vehicle_class ?? null } : { classes: b?.details_of_driving_licence?.cov_details ?? null };
    const today = new Date().toISOString().slice(0, 10);
    const expired = !!validUntil && validUntil < today;
    let status: Outcome = !valid ? 'failed' : expired ? 'failed' : 'verified';
    const note: string | null = !valid ? String(b?.message ?? 'Not found or not valid.') : expired ? `Expired on ${validUntil}.`
        : insuranceUpto && insuranceUpto < today ? `Insurance expired on ${insuranceUpto}.` : permitUpto && permitUpto < today ? `Permit expired on ${permitUpto}.` : null;
    if (status === 'verified' && note) status = 'needs_review';
    return { status, nameFound, validUntil, insuranceUpto, permitUpto, note, detail, reference: b?.reference_id != null ? String(b.reference_id) : null };
}

/**
 * Check a driver's licence or a vehicle's RC through Cashfree, for a travel
 * partner's fleet. Returns the reading, or why it could not run.
 */
export async function lookupLicenceOrRc(check: 'driving_licence' | 'vehicle_rc', number: string, dob?: string | null) {
    const n = number.replace(/[\s-]/g, '').toUpperCase();
    const vid = `fleet-${check}-${Date.now().toString(36)}`;
    const r = await secureId(check === 'driving_licence' ? '/driving-license' : '/vehicle-rc', check === 'driving_licence' ? { dl_number: n, dob, verification_id: vid } : { vehicle_number: n, verification_id: vid });
    if (r.kind === 'unavailable') return { kind: 'unavailable' as const, reason: r.reason, note: UNAVAILABLE_NOTE[r.reason] ?? 'The automatic check could not run.' };
    if (r.kind === 'rejected') return { kind: 'answer' as const, status: 'failed' as Outcome, nameFound: null, validUntil: null, insuranceUpto: null, permitUpto: null, note: String(r.body?.message ?? 'The registry did not accept this number.').slice(0, 300), detail: {}, reference: null };
    return { kind: 'answer' as const, ...readLicenceOrRc(check, r.body) };
}

const UNAVAILABLE_NOTE: Record<string, string> = {
    not_configured: 'Automatic checks are not set up (Cashfree verification keys are missing). Check it by hand.',
    keys_refused: 'Cashfree refused the verification keys. Check the keys in the server settings, or check it by hand.',
    unreachable: 'Cashfree could not be reached. Try again, or check it by hand.',
};

// ── Service ──────────────────────────────────────────────────────────────

export class PartnerVerification {

    private static async record(bpId: number, row: Omit<typeof partnerVerificationChecks.$inferInsert, 'businessPartnerId'>) {
        const [c] = await db.insert(partnerVerificationChecks).values({ ...row, businessPartnerId: bpId }).returning();
        // The summary columns other screens read.
        const set: Record<string, unknown> = {};
        if (row.check === 'pan') set.panStatus = row.status === 'verified' ? 'verified' : row.status === 'failed' ? 'invalid' : row.status === 'needs_review' ? 'mismatch' : undefined;
        if (row.check === 'gstin') set.gstinStatus = row.status === 'verified' ? 'verified' : row.status === 'failed' ? 'invalid' : undefined;
        if (row.check === 'gstin' && row.status === 'verified') set.gstinCheckedAt = new Date();
        for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];
        if (Object.keys(set).length) await db.update(businessPartners).set({ ...set, updatedAt: new Date() } as any).where(eq(businessPartners.id, bpId));
        return c;
    }

    /** Run one check through Cashfree. Records the answer; a Cashfree outage records nothing but says so. */
    static async runAutomatic(bpId: number, check: CheckCode, opts: { adminId?: number | null; dlNumber?: string; dob?: string; rcNumber?: string } = {}): Promise<Check> {
        if (!AUTOMATIC_CHECKS.includes(check)) throw new HubError(`${CHECK_LABEL[check]} is checked by hand: compare the certificate and record the result.`, 'MANUAL_ONLY');
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        const names = [bp.legalName, bp.displayName, bp.beneficiaryName, bp.contactName];
        const vid = `bp${bp.id}-${check}-${Date.now().toString(36)}`;
        const by = opts.adminId ?? null;

        const unavailable = async (reason: string, subject: string | null): Promise<Check> => {
            if (reason !== 'not_configured') throw new HubError(UNAVAILABLE_NOTE[reason] ?? 'The automatic check could not run. Try again, or check it by hand.', 'CHECK_UNAVAILABLE', 502);
            return this.record(bpId, { check, subject, status: 'manual_required', method: 'cashfree', note: UNAVAILABLE_NOTE.not_configured, checkedByAdminId: by });
        };

        if (check === 'bank') {
            if (!bp.bankAccountNumber || !bp.bankIfsc) throw new HubError('The partner has not added bank details yet.', 'NO_DATA');
            const r = await verifyBankAccount({ accountNumber: bp.bankAccountNumber, ifsc: bp.bankIfsc, name: bp.beneficiaryName ?? bp.legalName });
            const subject = `${mask(bp.bankAccountNumber)} · ${bp.bankIfsc}`;
            if (r.status === 'manual') {
                if (!keys()) return unavailable('not_configured', subject);
                throw new HubError(r.reason, 'CHECK_UNAVAILABLE', 502);
            }
            if (r.status === 'failed') {
                await db.update(businessPartners).set({ bankStatus: 'failed', bankVerificationRef: r.reference, updatedAt: new Date() }).where(eq(businessPartners.id, bpId));
                return this.record(bpId, { check, subject, status: 'failed', method: 'cashfree', reference: r.reference, note: r.reason, checkedByAdminId: by });
            }
            const nm = compareNames(names, r.nameAtBank);
            const ok = nm !== 'mismatch';
            await db.update(businessPartners).set({
                bankStatus: ok ? 'verified' : 'pending', bankVerifiedAt: ok ? new Date() : null, bankVerificationRef: r.reference,
                bankHolderNameAtBank: r.nameAtBank, updatedAt: new Date(),
            }).where(eq(businessPartners.id, bpId));
            const c = await this.record(bpId, {
                check, subject, status: ok ? 'verified' : 'needs_review', method: 'cashfree', nameFound: r.nameAtBank, nameMatch: nm, reference: r.reference, checkedByAdminId: by,
                note: ok ? null : `The bank says the account holder is "${r.nameAtBank}", which does not match ${bp.legalName}. Confirm with the partner before any payout.`,
            });
            await this.afterCheck(bpId, c);
            return c;
        }

        let path: string, payload: Record<string, unknown>, subject: string | null;
        if (check === 'pan') {
            if (!bp.pan) throw new HubError('No PAN on file for this partner.', 'NO_DATA');
            path = '/pan'; payload = { pan: bp.pan, name: bp.legalName, verification_id: vid }; subject = mask(bp.pan);
        } else if (check === 'gstin') {
            if (!bp.gstin) throw new HubError('No GSTIN on file for this partner.', 'NO_DATA');
            path = '/gstin'; payload = { GSTIN: bp.gstin, business_name: bp.legalName, verification_id: vid }; subject = bp.gstin;
        } else if (check === 'driving_licence') {
            if (!opts.dlNumber?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(opts.dob ?? '')) throw new HubError('Give the licence number and the holder\'s date of birth (yyyy-mm-dd).', 'NO_DATA');
            const dl = opts.dlNumber.replace(/[\s-]/g, '').toUpperCase();
            path = '/driving-license'; payload = { dl_number: dl, dob: opts.dob, verification_id: vid }; subject = mask(dl);
        } else {
            if (!opts.rcNumber?.trim()) throw new HubError('Give the vehicle registration number.', 'NO_DATA');
            const rc = opts.rcNumber.replace(/[\s-]/g, '').toUpperCase();
            path = '/vehicle-rc'; payload = { vehicle_number: rc, verification_id: vid }; subject = rc;
        }

        const r = await secureId(path, payload);
        if (r.kind === 'unavailable') return unavailable(r.reason, subject);
        if (r.kind === 'rejected') {
            const msg = String(r.body?.message ?? r.body?.error ?? 'The registry did not accept this number.');
            const c = await this.record(bpId, { check, subject, status: 'failed', method: 'cashfree', note: msg.slice(0, 300), reference: r.body?.reference_id != null ? String(r.body.reference_id) : null, checkedByAdminId: by });
            await this.afterCheck(bpId, c);
            return c;
        }
        const b = r.body;
        const reference = b?.reference_id != null ? String(b.reference_id) : null;
        let status: Outcome, nameFound: string | null = null, nameMatch: ReturnType<typeof compareNames> = null, validUntil: string | null = null, note: string | null = null;
        let detail: Record<string, unknown> = {};

        if (check === 'pan') {
            const valid = b?.valid === true || /^(VALID|E)$/i.test(String(b?.pan_status ?? b?.status ?? ''));
            nameFound = b?.registered_name ?? b?.name_pan_card ?? b?.name ?? null;
            nameMatch = cashfreeNameVerdict(b?.name_match_result) ?? compareNames(names, nameFound);
            detail = { type: b?.type ?? null, nameMatchScore: b?.name_match_score ?? null, aadhaarSeeding: b?.aadhaar_seeding_status ?? null };
            status = !valid ? 'failed' : nameMatch === 'mismatch' ? 'needs_review' : 'verified';
            note = !valid ? String(b?.message ?? 'PAN not found or not valid.') : nameMatch === 'mismatch' ? `The PAN is in the name of "${nameFound}", not ${bp.legalName}.` : null;
        } else if (check === 'gstin') {
            const valid = b?.valid === true;
            const gstStatus = String(b?.gst_in_status ?? b?.status ?? '');
            const active = !gstStatus || /active/i.test(gstStatus);
            nameFound = b?.legal_name_of_business ?? b?.legal_name ?? null;
            nameMatch = compareNames(names, nameFound) === 'mismatch' ? compareNames(names, b?.trade_name_of_business ?? null) ?? 'mismatch' : compareNames(names, nameFound);
            detail = { gstStatus: gstStatus || null, tradeName: b?.trade_name_of_business ?? null, registeredOn: b?.date_of_registration ?? null, taxpayerType: b?.taxpayer_type ?? null, constitution: b?.constitution_of_business ?? null, address: b?.principal_place_address ?? null };
            status = !valid || !active ? 'failed' : nameMatch === 'mismatch' ? 'needs_review' : 'verified';
            note = !valid ? String(b?.message ?? 'GSTIN not found.') : !active ? `The GSTIN is ${gstStatus}, not active.` : nameMatch === 'mismatch' ? `The GSTIN is registered to "${nameFound}", not ${bp.legalName}.` : null;
        } else {
            const x = readLicenceOrRc(check as 'driving_licence' | 'vehicle_rc', b);
            ({ status, nameFound, validUntil, note } = x);
            detail = x.detail;
        }

        const c = await this.record(bpId, { check, subject, status, method: 'cashfree', nameFound, nameMatch, validUntil, reference, detail, note: note?.slice(0, 300) ?? null, checkedByAdminId: by });
        await this.afterCheck(bpId, c);
        return c;
    }

    /** Staff record a check they did by hand: how, and against which document. */
    static async recordManual(adminId: number, bpId: number, check: CheckCode, input: { status: 'verified' | 'failed'; note: string; documentId?: number | null; validUntil?: string | null; subject?: string | null }) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        const note = input.note?.trim();
        if (!note || note.length < 5) throw new HubError('Note how you checked it (for example "FSSAI certificate matched on FoSCoS, valid to 2028").', 'NOTE_REQUIRED');
        if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) throw new HubError('Valid until is a date like 2028-03-31.', 'BAD_DATE');
        if (input.documentId) {
            const [doc] = await db.select().from(partnerDocuments).where(and(eq(partnerDocuments.id, input.documentId), eq(partnerDocuments.businessPartnerId, bpId))).limit(1);
            if (!doc) throw new HubError('That document is not this partner\'s.', 'BAD_DOCUMENT');
            await db.update(partnerDocuments).set({ status: input.status === 'verified' ? 'verified' : 'rejected', reviewNote: note.slice(0, 300), reviewedByAdminId: adminId, reviewedAt: new Date(), ...(input.validUntil ? { expiresAt: input.validUntil } : {}) }).where(eq(partnerDocuments.id, doc.id));
        }
        const subject = input.subject?.trim() || (check === 'pan' ? mask(bp.pan) : check === 'gstin' ? bp.gstin : check === 'bank' ? (bp.bankAccountNumber ? `${mask(bp.bankAccountNumber)} · ${bp.bankIfsc}` : null) : null);
        if (check === 'bank') {
            if (input.status === 'verified') {
                if (!bp.bankAccountNumber) throw new HubError('The partner has not added bank details yet.', 'NO_DATA');
                await db.update(businessPartners).set({ bankStatus: 'verified', bankVerifiedAt: new Date(), bankVerificationRef: `manual: ${note.slice(0, 80)}`, updatedAt: new Date() }).where(eq(businessPartners.id, bpId));
            } else {
                await db.update(businessPartners).set({ bankStatus: 'failed', updatedAt: new Date() }).where(eq(businessPartners.id, bpId));
            }
        }
        const c = await this.record(bpId, { check, subject, status: input.status, method: 'manual', note: note.slice(0, 300), documentId: input.documentId ?? null, validUntil: input.validUntil ?? null, checkedByAdminId: adminId });
        await recordAudit({ entityType: 'business_partner', entityId: bpId, action: `check_${check}_${input.status}_manual`, changedBy: adminId, metadata: { note: note.slice(0, 200), documentId: input.documentId ?? null } });
        await this.afterCheck(bpId, c);
        return c;
    }

    /** What this partner needs checked, and where each stands. */
    static async summary(bpId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        const required = checksFor(verticals, !!bp.gstin);
        const history = await db.select().from(partnerVerificationChecks).where(eq(partnerVerificationChecks.businessPartnerId, bpId)).orderBy(desc(partnerVerificationChecks.createdAt), desc(partnerVerificationChecks.id)).limit(100);
        const today = new Date().toISOString().slice(0, 10);
        const latestOf = (code: CheckCode) => history.find(h => h.check === code) ?? null;
        const codes = Array.from(new Set<CheckCode>([...required, ...(history.map(h => h.check) as CheckCode[])]));
        const items = codes.map(code => {
            const latest = latestOf(code);
            const expired = !!latest?.validUntil && latest.validUntil < today;
            return {
                code, label: CHECK_LABEL[code] ?? code, required: required.includes(code), automatic: AUTOMATIC_CHECKS.includes(code),
                passed: latest?.status === 'verified' && !expired, expired, latest,
            };
        });
        return {
            automaticConfigured: automaticChecksConfigured(),
            items,
            allRequiredPassed: items.filter(i => i.required).every(i => i.passed),
            history,
        };
    }

    /** Run every required automatic check that has data and has not passed yet (on submit, or "Run checks"). */
    static async runAll(bpId: number, adminId: number | null = null) {
        const s = await this.summary(bpId);
        const bp = await BusinessPartnerService.byId(bpId);
        const results: Array<{ check: CheckCode; status?: string; error?: string }> = [];
        for (const i of s.items) {
            if (!i.required || !i.automatic || i.passed) continue;
            if (i.code === 'driving_licence' || i.code === 'vehicle_rc') continue; // need numbers staff enter
            if (i.code === 'bank' && !bp?.bankAccountNumber) continue;
            if (i.code === 'pan' && !bp?.pan) continue;
            try { const c = await this.runAutomatic(bpId, i.code, { adminId }); results.push({ check: i.code, status: c.status }); }
            catch (e: any) { results.push({ check: i.code, error: e?.message }); }
        }
        await this.maybeAutoApprove(bpId);
        return results;
    }

    private static async afterCheck(bpId: number, c: Check) {
        logger.info(`[VERIFY] Partner #${bpId} ${c.check}: ${c.status} (${c.method})`);
        if (c.status === 'verified') await this.maybeAutoApprove(bpId);
    }

    /**
     * Approve without staff when the partner's verticals all allow it and
     * everything is in: submitted, required documents uploaded, agreements
     * accepted, every required check passed. One status change wins.
     */
    static async maybeAutoApprove(bpId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp || bp.status !== 'pending_approval' || !bp.submittedAt) return false;
        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        if (!verticals.length || !verticals.every(v => AUTO_APPROVE_VERTICALS.includes(v))) return false;
        const { PartnerHubService } = await import('./partner-hub.service');
        const o = await PartnerHubService.onboarding(bpId);
        if (!o.documents.filter(d => d.required).every(d => d.done) || !o.agreements.every(a => a.accepted)) return false;
        if (!(await this.summary(bpId)).allRequiredPassed) return false;
        const [u] = await db.update(businessPartners).set({ status: 'active', approvedAt: new Date(), autoApprovedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
            .where(and(eq(businessPartners.id, bpId), eq(businessPartners.status, 'pending_approval'))).returning();
        if (!u) return false;
        logger.info(`[VERIFY] ${bp.partnerCode} auto-approved (${verticals.join(', ')}): every check passed`);
        await recordAudit({ entityType: 'business_partner', entityId: bpId, action: 'auto_approved', changedBy: null as any, metadata: { verticals } });
        await PartnerHubService.afterApproval(bpId, null as any);
        const { NotificationService } = await import('./notification.service');
        void NotificationService.sendToAdmins('Partner auto-approved', `${bp.displayName} (${bp.partnerCode}) passed every check and is live as a ${verticals.join(', ')} partner.`, { businessPartnerId: bpId }).catch(() => null);
        return true;
    }
}
