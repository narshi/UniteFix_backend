/**
 * Business partners — the party model.
 *
 * TWO WORDS, on purpose. In this codebase "partner" is a TECHNICIAN
 * (employees, partner_wallets, /api/partner/*). A "business partner" is a
 * company that does commerce with UniteFix: an ISP, a CCTV installer, a
 * computer shop, a consultant. This service never uses bare "partner" for the
 * second thing, and nothing here touches the first.
 *
 * WHAT A BUSINESS PARTNER IS
 * The `business_partners` row is the "who": legal identity, contact, status,
 * commercial terms, payout account, and two logins (web portal via admin_users,
 * mobile via users). What they DO is the set of verticals attached to them.
 * Anything a vertical needs beyond that lives in its own profile table —
 * ftth_operators is the first, linked 1:1 through business_partner_id.
 *
 * Adding a vertical is a row in partner_verticals. A CCTV installer needs no
 * profile table at all. That is the entire scalability mechanism.
 *
 * THE LEDGER
 * business_partner_ledger records what a partner owes or is owed. SIGN
 * CONVENTION, stated once and enforced here:
 *     balance > 0  → the partner owes UniteFix
 *     balance < 0  → UniteFix owes the partner
 * ftth_operator_ledger runs the OPPOSITE convention and is live money. It is
 * NOT migrated. statement() unions the two at read time with signs normalised,
 * so an ISP sees one account without a single row of theirs being rewritten.
 */

import { db } from '../db';
import { and, eq, desc, inArray, sql, gte, lte } from 'drizzle-orm';
import {
    businessPartners, businessPartnerVerticals, partnerVerticals, businessPartnerLedger,
    ftthOperators, ftthOperatorLedger,
    type BusinessPartner,
} from '@shared/schema';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

export type BpLedgerEntryType =
    | 'order_invoice' | 'payment_received' | 'credit_note' | 'refund' | 'adjustment'
    | 'settlement_paid' | 'settlement_received';

export interface BusinessPartnerContext {
    id: number;
    partnerCode: string;
    displayName: string;
    status: string;
    verticals: string[];
    adminUserId: number | null;
    userId: number | null;
    creditLimitPaise: number;
}

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

export class BusinessPartnerService {

    // ──────────────────────────────────────────────────────────────────────
    // Lookup
    // ──────────────────────────────────────────────────────────────────────

    static async verticalCodesOf(businessPartnerId: number): Promise<string[]> {
        const rows = await db.select({ code: partnerVerticals.code })
            .from(businessPartnerVerticals)
            .innerJoin(partnerVerticals, eq(partnerVerticals.id, businessPartnerVerticals.verticalId))
            .where(eq(businessPartnerVerticals.businessPartnerId, businessPartnerId));
        return rows.map(r => r.code);
    }

    static async context(bp: BusinessPartner): Promise<BusinessPartnerContext> {
        return {
            id: bp.id,
            partnerCode: bp.partnerCode,
            displayName: bp.displayName,
            status: bp.status,
            verticals: await this.verticalCodesOf(bp.id),
            adminUserId: bp.adminUserId,
            userId: bp.userId,
            creditLimitPaise: bp.creditLimitPaise,
        };
    }

    static async byId(id: number) {
        const [row] = await db.select().from(businessPartners).where(eq(businessPartners.id, id)).limit(1);
        return row ?? null;
    }

    /** The web-portal door. Falls back through ftth_operators for an un-backfilled ISP. */
    static async byAdminUserId(adminUserId: number) {
        const [direct] = await db.select().from(businessPartners)
            .where(eq(businessPartners.adminUserId, adminUserId)).limit(1);
        if (direct) return direct;

        const [op] = await db.select({ bpId: ftthOperators.businessPartnerId })
            .from(ftthOperators).where(eq(ftthOperators.adminUserId, adminUserId)).limit(1);
        return op?.bpId ? this.byId(op.bpId) : null;
    }

    /** The mobile door. */
    static async byUserId(userId: number) {
        const [row] = await db.select().from(businessPartners)
            .where(eq(businessPartners.userId, userId)).limit(1);
        return row ?? null;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────────────

    /** "BP-0001". Human-readable, and the thing a partner reads out on the phone. */
    static async nextPartnerCode(tx: typeof db = db): Promise<string> {
        const [row] = await tx.select({ n: sql<number>`coalesce(max(id), 0)` }).from(businessPartners);
        return `BP-${pad(Number(row?.n ?? 0) + 1)}`;
    }

    static async create(input: {
        legalName: string;
        displayName?: string | null;
        gstin?: string | null;
        pan?: string | null;
        contactName?: string | null;
        contactPhone: string;
        contactEmail?: string | null;
        address?: string | null;
        pincode?: string | null;
        district?: string | null;
        verticalCodes?: string[];
        creditLimitPaise?: number;
        paymentTermsDays?: number;
        adminUserId?: number | null;
        userId?: number | null;
        notes?: string | null;
        /** Set when an admin creates it directly; skips pending_approval. */
        approvedByAdminId?: number | null;
    }) {
        return withTransaction(async (tx) => {
            const partnerCode = await this.nextPartnerCode(tx as any);
            const approve = !!input.approvedByAdminId;

            const [bp] = await tx.insert(businessPartners).values({
                partnerCode,
                legalName: input.legalName.trim(),
                displayName: (input.displayName ?? input.legalName).trim(),
                gstin: input.gstin?.trim().toUpperCase() ?? null,
                pan: input.pan?.trim().toUpperCase() ?? null,
                contactName: input.contactName ?? null,
                contactPhone: input.contactPhone.trim(),
                contactEmail: input.contactEmail?.trim().toLowerCase() ?? null,
                address: input.address ?? null,
                pincode: input.pincode ?? null,
                district: input.district ?? null,
                status: approve ? 'active' : 'pending_approval',
                adminUserId: input.adminUserId ?? null,
                userId: input.userId ?? null,
                creditLimitPaise: Math.max(0, input.creditLimitPaise ?? 0),
                paymentTermsDays: Math.max(0, input.paymentTermsDays ?? 0),
                approvedByAdminId: input.approvedByAdminId ?? null,
                approvedAt: approve ? new Date() : null,
                notes: input.notes ?? null,
            }).returning();

            if (input.verticalCodes?.length) {
                await this.setVerticals(bp.id, input.verticalCodes, tx as any);
            }

            logger.info(`[BP] Created business partner ${partnerCode} (${bp.displayName})`
                + (approve ? ' — approved on creation' : ' — pending approval'));
            return bp;
        });
    }

    /** Replace the partner's verticals. Unknown codes are refused, not skipped. */
    static async setVerticals(businessPartnerId: number, codes: string[], tx: typeof db = db) {
        const wanted = Array.from(new Set(codes.map(c => c.trim().toLowerCase()).filter(Boolean)));
        const rows = wanted.length
            ? await tx.select().from(partnerVerticals).where(inArray(partnerVerticals.code, wanted))
            : [];
        const missing = wanted.filter(c => !rows.some(r => r.code === c));
        if (missing.length) {
            throw new Error(`Unknown vertical(s): ${missing.join(', ')}`);
        }

        await tx.delete(businessPartnerVerticals)
            .where(eq(businessPartnerVerticals.businessPartnerId, businessPartnerId));
        if (rows.length) {
            await tx.insert(businessPartnerVerticals).values(
                rows.map(r => ({ businessPartnerId, verticalId: r.id })),
            );
        }
        return rows.map(r => r.code);
    }

    /**
     * Approve. The readiness gate lives here, not in the route: a contact
     * phone, at least one vertical, and a GSTIN if they are being given credit.
     * Nobody goes active with credit and no tax identity.
     */
    static async approve(id: number, adminId: number, terms?: {
        verticalCodes?: string[];
        creditLimitPaise?: number;
        paymentTermsDays?: number;
    }) {
        return withTransaction(async (tx) => {
            const [bp] = await tx.select().from(businessPartners).where(eq(businessPartners.id, id)).limit(1);
            if (!bp) return null;

            if (terms?.verticalCodes) await this.setVerticals(id, terms.verticalCodes, tx as any);
            const verticals = await this.verticalCodesOf(id);
            const credit = terms?.creditLimitPaise ?? bp.creditLimitPaise;

            const problems: string[] = [];
            if (!bp.contactPhone) problems.push('a contact phone');
            if (!verticals.length) problems.push('at least one vertical');
            if (credit > 0 && !bp.gstin) problems.push('a GSTIN (required before extending credit)');
            if (problems.length) {
                throw new Error(`Cannot approve yet — needs ${problems.join(', ')}.`);
            }

            const [updated] = await tx.update(businessPartners).set({
                status: 'active',
                creditLimitPaise: Math.max(0, credit),
                paymentTermsDays: Math.max(0, terms?.paymentTermsDays ?? bp.paymentTermsDays),
                approvedByAdminId: adminId,
                approvedAt: new Date(),
                rejectionReason: null,
                updatedAt: new Date(),
            }).where(eq(businessPartners.id, id)).returning();

            logger.info(`[BP] ${bp.partnerCode} approved by admin #${adminId}; verticals=${verticals.join(',')}; credit=${credit}`);
            return updated;
        });
    }

    static async setStatus(id: number, status: 'active' | 'paused' | 'disabled', reason?: string | null) {
        const [updated] = await db.update(businessPartners).set({
            status,
            rejectionReason: status === 'active' ? null : (reason ?? null),
            updatedAt: new Date(),
        }).where(eq(businessPartners.id, id)).returning();
        return updated ?? null;
    }

    static async reject(id: number, adminId: number, reason: string) {
        const [updated] = await db.update(businessPartners).set({
            status: 'disabled',
            rejectionReason: reason,
            approvedByAdminId: adminId,
            updatedAt: new Date(),
        }).where(and(eq(businessPartners.id, id), eq(businessPartners.status, 'pending_approval'))).returning();
        return updated ?? null;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Ledger
    // ──────────────────────────────────────────────────────────────────────

    static async balancePaise(businessPartnerId: number, tx: typeof db = db): Promise<number> {
        const [row] = await tx.select({ bal: businessPartnerLedger.balanceAfterPaise })
            .from(businessPartnerLedger)
            .where(eq(businessPartnerLedger.businessPartnerId, businessPartnerId))
            .orderBy(desc(businessPartnerLedger.id)).limit(1);
        return row?.bal ?? 0;
    }

    /**
     * Append one entry and carry the balance forward. Idempotent for order-bound
     * entries through the (entry_type, b2b_order_id) unique index — a second
     * invoice for the same order is refused by the database, not by luck.
     */
    static async appendLedger(tx: typeof db, entry: {
        businessPartnerId: number;
        entryType: BpLedgerEntryType;
        amountPaise: number;                 // signed per the convention above
        b2bOrderId?: number | null;
        paymentTransactionId?: number | null;
        description?: string | null;
        metadata?: Record<string, unknown>;
        createdByAdminId?: number | null;
    }) {
        const before = await this.balancePaise(entry.businessPartnerId, tx);
        const after = before + entry.amountPaise;
        const rows = await tx.insert(businessPartnerLedger).values({
            businessPartnerId: entry.businessPartnerId,
            entryType: entry.entryType,
            amountPaise: entry.amountPaise,
            b2bOrderId: entry.b2bOrderId ?? null,
            paymentTransactionId: entry.paymentTransactionId ?? null,
            balanceBeforePaise: before,
            balanceAfterPaise: after,
            description: entry.description ?? null,
            metadata: (entry.metadata ?? null) as any,
            createdByAdminId: entry.createdByAdminId ?? null,
        }).onConflictDoNothing().returning();
        return rows[0] ?? null;
    }

    /** Public wrapper for entries raised outside an order flow. */
    static async recordLedgerEntry(entry: Parameters<typeof BusinessPartnerService.appendLedger>[1]) {
        return withTransaction(async (tx) => this.appendLedger(tx as any, entry));
    }

    /**
     * Outstanding = what they owe us right now, floored at zero. Credit left =
     * limit − outstanding. A negative balance (we owe them) does not increase
     * their credit; netting is a business decision not taken yet.
     */
    static async creditPosition(businessPartnerId: number, tx: typeof db = db) {
        const [bp] = await tx.select({ limit: businessPartners.creditLimitPaise })
            .from(businessPartners).where(eq(businessPartners.id, businessPartnerId)).limit(1);
        const balance = await this.balancePaise(businessPartnerId, tx);
        const outstanding = Math.max(0, balance);
        const limit = bp?.limit ?? 0;
        return { limitPaise: limit, outstandingPaise: outstanding, availablePaise: Math.max(0, limit - outstanding), balancePaise: balance };
    }

    /**
     * One statement across both ledgers. FTTH rows are flipped into this
     * convention at read time (their positive = we owe them = our negative).
     */
    static async statement(businessPartnerId: number, opts?: { from?: Date; to?: Date; limit?: number }) {
        const limit = Math.min(500, Math.max(1, opts?.limit ?? 200));

        const bpWhere = [eq(businessPartnerLedger.businessPartnerId, businessPartnerId)];
        if (opts?.from) bpWhere.push(gte(businessPartnerLedger.createdAt, opts.from));
        if (opts?.to) bpWhere.push(lte(businessPartnerLedger.createdAt, opts.to));

        const own = await db.select().from(businessPartnerLedger)
            .where(and(...bpWhere)).orderBy(desc(businessPartnerLedger.createdAt)).limit(limit);

        const [op] = await db.select({ id: ftthOperators.id })
            .from(ftthOperators).where(eq(ftthOperators.businessPartnerId, businessPartnerId)).limit(1);

        let ftth: Array<{ id: number; entryType: string; amountPaise: number; description: string | null; createdAt: Date | null }> = [];
        if (op) {
            const fWhere = [eq(ftthOperatorLedger.operatorId, op.id)];
            if (opts?.from) fWhere.push(gte(ftthOperatorLedger.createdAt, opts.from));
            if (opts?.to) fWhere.push(lte(ftthOperatorLedger.createdAt, opts.to));
            ftth = await db.select({
                id: ftthOperatorLedger.id, entryType: ftthOperatorLedger.entryType,
                amountPaise: ftthOperatorLedger.amountPaise, description: ftthOperatorLedger.description,
                createdAt: ftthOperatorLedger.createdAt,
            }).from(ftthOperatorLedger).where(and(...fWhere)).orderBy(desc(ftthOperatorLedger.createdAt)).limit(limit);
        }

        const lines = [
            ...own.map(e => ({
                source: 'b2b' as const,
                id: `bp-${e.id}`,
                entryType: e.entryType,
                // Already in this convention.
                amountPaise: e.amountPaise,
                description: e.description,
                b2bOrderId: e.b2bOrderId,
                createdAt: e.createdAt,
            })),
            ...ftth.map(e => ({
                source: 'ftth' as const,
                id: `ftth-${e.id}`,
                entryType: e.entryType,
                // Flip: FTTH positive means UniteFix owes the operator.
                amountPaise: -e.amountPaise,
                description: e.description,
                b2bOrderId: null as number | null,
                createdAt: e.createdAt,
            })),
        ].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)).slice(0, limit);

        const b2bBalance = await this.balancePaise(businessPartnerId);
        let ftthBalance = 0;
        if (op) {
            const [row] = await db.select({ bal: ftthOperatorLedger.balanceAfterPaise })
                .from(ftthOperatorLedger).where(eq(ftthOperatorLedger.operatorId, op.id))
                .orderBy(desc(ftthOperatorLedger.id)).limit(1);
            ftthBalance = -(row?.bal ?? 0);
        }

        return {
            convention: 'positive = partner owes UniteFix; negative = UniteFix owes partner',
            b2bBalancePaise: b2bBalance,
            ftthBalancePaise: ftthBalance,
            // Shown side by side, NOT summed: netting is a decision not yet taken.
            lines,
        };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Backfill
    // ──────────────────────────────────────────────────────────────────────

    /**
     * One business_partners row per ftth_operators row that has none.
     * Idempotent; returns what it did. Run from scripts/backfill-business-partners.ts.
     */
    static async backfillFromFtthOperators(dryRun = false) {
        const ops = await db.select().from(ftthOperators)
            .where(sql`${ftthOperators.businessPartnerId} IS NULL`).orderBy(ftthOperators.id);

        const [isp] = await db.select().from(partnerVerticals).where(eq(partnerVerticals.code, 'isp')).limit(1);
        if (!isp) throw new Error("Vertical 'isp' is not seeded — run migrations first");

        const results: Array<{ operatorId: number; companyName: string; partnerCode: string | null }> = [];

        for (const op of ops) {
            if (dryRun) { results.push({ operatorId: op.id, companyName: op.companyName, partnerCode: null }); continue; }

            await withTransaction(async (tx) => {
                const partnerCode = await this.nextPartnerCode(tx as any);
                // Operator statuses map 1:1 onto business partner statuses.
                const status = op.status as 'pending_approval' | 'active' | 'paused' | 'disabled';
                const [bp] = await tx.insert(businessPartners).values({
                    partnerCode,
                    legalName: op.legalName ?? op.companyName,
                    displayName: op.companyName,
                    gstin: op.gstin,
                    contactName: op.contactName,
                    contactPhone: op.contactPhone,
                    contactEmail: op.contactEmail,
                    status,
                    adminUserId: op.adminUserId,
                    approvedByAdminId: op.approvedByAdminId,
                    approvedAt: op.approvedAt,
                    rejectionReason: op.rejectionReason,
                    notes: `Backfilled from ftth_operators #${op.id}`,
                    createdAt: op.createdAt ?? new Date(),
                }).returning();
                await tx.insert(businessPartnerVerticals).values({ businessPartnerId: bp.id, verticalId: isp.id });
                await tx.update(ftthOperators).set({ businessPartnerId: bp.id, updatedAt: new Date() })
                    .where(eq(ftthOperators.id, op.id));
                results.push({ operatorId: op.id, companyName: op.companyName, partnerCode });
            });
        }
        return results;
    }
}

/** Convenience for routes that need the party behind an admin_users or users id. */
export async function resolveBusinessPartnerForLogin(opts: { adminUserId?: number; userId?: number }) {
    if (opts.adminUserId) {
        const bp = await BusinessPartnerService.byAdminUserId(opts.adminUserId);
        if (bp) return bp;
    }
    if (opts.userId) {
        const bp = await BusinessPartnerService.byUserId(opts.userId);
        if (bp) return bp;
    }
    return null;
}

