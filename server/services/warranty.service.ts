/**
 * Spare parts provenance, and who stands behind them.
 *
 * WHY THIS EXISTS
 * A customer's capacitor fails in month three and calls us. Until now there was
 * nothing to answer them with: parts were a free-text word and a lump sum, in
 * two different places, neither recording brand, vendor, warranty length, or any
 * proof of purchase. The question "who honours this?" was unanswerable not as a
 * matter of policy but because the fact it turns on — where the part came from —
 * was never written down.
 *
 * THE TWO WARRANTIES
 * Workmanship (did we fit it right?) is always ours, 30 days, never in dispute.
 * The part (did the component fail?) depends entirely on who bought it. Those
 * were previously one question with no answer; here they are two questions with
 * different owners.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * No wallet reserve is held against undocumented sourcing yet. The wallet has
 * twelve mutation sites across six files and two ledgers that already disagree —
 * a live partner was found holding Rs.416.60 against Rs.173.30 of ledger. Adding
 * a thirteenth writer whose behaviour is conditional on documentation state,
 * before that is unified, would produce the hardest drift in the system to
 * diagnose. `isDocumented` is recorded now so the reserve can be switched on
 * later against real data rather than guesses.
 */

import { db } from '../db';
import { and, eq, desc } from 'drizzle-orm';
import { servicePartItems, warrantyClaims, serviceRequests, users } from '@shared/schema';
import logger from '../lib/logger';

export type PartSource = 'platform' | 'approved_vendor' | 'technician_local' | 'customer_supplied';
export type WarrantyBacker = 'unitefix' | 'vendor' | 'manufacturer' | 'none';
export type Verdict =
    | 'workmanship_fault' | 'part_failed' | 'customer_damage' | 'out_of_warranty' | 'unrelated';
export type CostBearer = 'unitefix' | 'vendor' | 'technician' | 'customer';

/** Our own workmanship guarantee. Independent of any part. */
export const WORKMANSHIP_WARRANTY_DAYS = 30;

/**
 * Sensible defaults so a technician is not typing a number into a box and
 * inventing it. Editable within bounds, not free-entry.
 */
const DEFAULT_WARRANTY_DAYS: Record<string, number> = {
    ac: 180, refrigerator: 180, washing_machine: 180,
    electrical: 90, electronics: 90, geyser: 180,
    plumbing: 90, ro: 180, fan: 90, motor: 180,
};
const MAX_WARRANTY_DAYS = 1825;      // five years
const MAX_UNIT_PRICE_PAISE = 5_000_000;  // Rs.50,000 a unit
const MAX_QUANTITY = 50;             // matches the booking quantity ceiling

export interface PartItemInput {
    partName?: string;
    brand?: string | null;
    category?: string | null;
    sourceType?: string;
    vendorName?: string | null;
    unitPricePaise?: number;
    /** Convenience for clients that think in rupees. Ignored if paise is given. */
    unitPriceRupees?: number;
    quantity?: number;
    warrantyDays?: number;
    vendorBillDate?: string | Date | null;
    billPhotoUrl?: string | null;
    serialNumber?: string | null;
    notes?: string | null;
}

export interface ResolvedPartItem {
    partName: string;
    brand: string | null;
    category: string | null;
    sourceType: PartSource;
    vendorName: string | null;
    unitPricePaise: number;
    quantity: number;
    warrantyDays: number;
    warrantyBacker: WarrantyBacker;
    vendorBillDate: Date | null;
    installedAt: Date;
    warrantyStartsAt: Date | null;
    warrantyExpiresAt: Date | null;
    billPhotoUrl: string | null;
    serialNumber: string | null;
    isDocumented: boolean;
    notes: string | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const int = (v: unknown, fallback = 0) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim().slice(0, max);
    return t.length ? t : null;
};
const asDate = (v: unknown): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
};

const VALID_SOURCES: PartSource[] = ['platform', 'approved_vendor', 'technician_local', 'customer_supplied'];

/**
 * Who stands behind this line.
 *
 * A local part with no bill and no stated warranty is backed by nobody, and
 * saying so plainly on the invoice is the honest position — printing our name
 * over it would be assuming a warranty we never agreed to.
 */
export function resolveBacker(source: PartSource, warrantyDays: number, documented: boolean): WarrantyBacker {
    if (warrantyDays <= 0) return 'none';
    switch (source) {
        case 'platform': return 'unitefix';
        case 'approved_vendor': return 'vendor';
        case 'technician_local': return documented ? 'vendor' : 'none';
        case 'customer_supplied': return 'manufacturer';
    }
}

/**
 * Proof of purchase. Only meaningful for a part the technician bought — platform
 * stock is documented by definition, and a customer-supplied part is not the
 * technician's to evidence, so it must never count against them.
 */
export function isDocumented(source: PartSource, item: { billPhotoUrl: string | null; vendorName: string | null; warrantyDays: number }): boolean {
    if (source === 'platform' || source === 'customer_supplied') return true;
    return Boolean(item.billPhotoUrl && item.vendorName && item.warrantyDays > 0);
}

/**
 * When the warranty clock starts.
 *
 * For anything a vendor backs, it starts on the date of THEIR bill, not the day
 * we fitted it. A technician fitting a part bought three weeks earlier would
 * otherwise have us print an expiry the vendor will not honour — a promise we
 * cannot keep, made in writing, on our own letterhead.
 */
export function warrantyWindow(
    backer: WarrantyBacker, warrantyDays: number, vendorBillDate: Date | null, installedAt: Date,
): { startsAt: Date | null; expiresAt: Date | null } {
    if (warrantyDays <= 0 || backer === 'none') return { startsAt: null, expiresAt: null };
    const startsAt = (backer === 'vendor' || backer === 'manufacturer')
        ? (vendorBillDate ?? installedAt)
        : installedAt;
    return { startsAt, expiresAt: new Date(startsAt.getTime() + warrantyDays * 86_400_000) };
}

/** Validate, clamp and complete one line. Never trusts the client. */
export function resolvePartItem(raw: PartItemInput, installedAt = new Date()): ResolvedPartItem {
    const sourceType: PartSource = VALID_SOURCES.includes(raw.sourceType as PartSource)
        ? raw.sourceType as PartSource
        : 'technician_local';

    const category = str(raw.category, 60);
    const defaultDays = category ? (DEFAULT_WARRANTY_DAYS[category.toLowerCase()] ?? 0) : 0;
    const warrantyDays = clamp(
        raw.warrantyDays === undefined ? defaultDays : int(raw.warrantyDays, 0), 0, MAX_WARRANTY_DAYS);

    const unitPricePaise = clamp(
        raw.unitPricePaise !== undefined
            ? int(raw.unitPricePaise, 0)
            : Math.round((Number(raw.unitPriceRupees) || 0) * 100),
        0, MAX_UNIT_PRICE_PAISE);

    const billPhotoUrl = str(raw.billPhotoUrl, 500);
    const vendorName = str(raw.vendorName, 120);
    const documented = isDocumented(sourceType, { billPhotoUrl, vendorName, warrantyDays });
    const warrantyBacker = resolveBacker(sourceType, warrantyDays, documented);
    const vendorBillDate = asDate(raw.vendorBillDate);
    const { startsAt, expiresAt } = warrantyWindow(warrantyBacker, warrantyDays, vendorBillDate, installedAt);

    return {
        partName: str(raw.partName, 120) ?? 'Spare part',
        brand: str(raw.brand, 80),
        category,
        sourceType,
        vendorName,
        unitPricePaise,
        quantity: clamp(int(raw.quantity, 1) || 1, 1, MAX_QUANTITY),
        warrantyDays,
        warrantyBacker,
        vendorBillDate,
        installedAt,
        warrantyStartsAt: startsAt,
        warrantyExpiresAt: expiresAt,
        billPhotoUrl,
        serialNumber: str(raw.serialNumber, 80),
        isDocumented: documented,
        notes: str(raw.notes, 500),
    };
}

export const lineTotalPaise = (i: { unitPricePaise: number; quantity: number }) => i.unitPricePaise * i.quantity;
export const partsTotalPaise = (items: Array<{ unitPricePaise: number; quantity: number }>) =>
    items.reduce((s, i) => s + lineTotalPaise(i), 0);

/**
 * An older app build sends one lump sum and a note, with no line items. Rather
 * than leave the record empty — which would misreport as "no parts fitted" and
 * quietly recreate the hole this exists to close — record one honest line: a
 * local part, undocumented, no warranty. That is exactly what it is.
 */
export function synthesiseFromLumpSum(costRupees: number, note?: string | null): PartItemInput[] {
    if (!(costRupees > 0)) return [];
    return [{
        partName: (note && note.trim()) ? note.trim().slice(0, 120) : 'Spare part (unitemised)',
        sourceType: 'technician_local',
        unitPricePaise: Math.round(costRupees * 100),
        quantity: 1,
        warrantyDays: 0,
        notes: 'Recorded from an app build that predates itemised parts.',
    }];
}

/**
 * Replace the parts recorded against a booking.
 *
 * Replace rather than append: both write paths can be called more than once
 * before payment, and appending would double-count a technician who corrected a
 * typo. The line items are the source of truth for what parts cost on this job.
 */
export async function recordPartItems(
    serviceRequestId: number,
    rawItems: PartItemInput[],
    recordedBy: number | null,
    tx?: any,
): Promise<ResolvedPartItem[]> {
    const ctx = tx ?? db;
    const installedAt = new Date();
    const resolved = rawItems.map(r => resolvePartItem(r, installedAt));

    await ctx.delete(servicePartItems).where(eq(servicePartItems.serviceRequestId, serviceRequestId));
    if (!resolved.length) return [];

    await ctx.insert(servicePartItems).values(resolved.map(r => ({
        serviceRequestId,
        partName: r.partName,
        brand: r.brand,
        category: r.category,
        sourceType: r.sourceType as any,
        vendorName: r.vendorName,
        unitPricePaise: r.unitPricePaise,
        quantity: r.quantity,
        warrantyDays: r.warrantyDays,
        warrantyBacker: r.warrantyBacker as any,
        vendorBillDate: r.vendorBillDate,
        installedAt: r.installedAt,
        warrantyStartsAt: r.warrantyStartsAt,
        warrantyExpiresAt: r.warrantyExpiresAt,
        billPhotoUrl: r.billPhotoUrl,
        serialNumber: r.serialNumber,
        isDocumented: r.isDocumented,
        recordedBy,
        notes: r.notes,
    })));

    const undocumented = resolved.filter(r => !r.isDocumented).length;
    logger.info(`[PARTS] Recorded ${resolved.length} part line(s) on SR #${serviceRequestId}`
        + (undocumented ? ` — ${undocumented} undocumented` : ''));
    return resolved;
}

export async function getPartItems(serviceRequestId: number) {
    return db.select().from(servicePartItems)
        .where(eq(servicePartItems.serviceRequestId, serviceRequestId))
        .orderBy(servicePartItems.id);
}

/**
 * Who absorbs the cost, given the technician's verdict.
 *
 * The customer pays nothing on any genuine failure — the first four outcomes all
 * settle internally. That is the point: they experience one rule ("a real
 * failure gets fixed free") and never have to work out which of our suppliers
 * they are arguing with.
 */
export function routeCost(verdict: Verdict, part?: { sourceType: PartSource; isDocumented: boolean } | null): CostBearer {
    if (verdict === 'workmanship_fault') return 'technician';
    if (verdict === 'customer_damage' || verdict === 'out_of_warranty' || verdict === 'unrelated') return 'customer';

    // part_failed
    if (!part) return 'unitefix';
    switch (part.sourceType) {
        case 'platform': return 'unitefix';
        case 'approved_vendor': return 'vendor';
        case 'technician_local': return part.isDocumented ? 'vendor' : 'technician';
        case 'customer_supplied': return 'customer';
    }
}

/** Is this line still in warranty right now? */
export const isInWarranty = (item: { warrantyExpiresAt: Date | string | null }, at = new Date()) =>
    Boolean(item.warrantyExpiresAt) && new Date(item.warrantyExpiresAt as any).getTime() > at.getTime();

/** Is the booking still inside our own workmanship guarantee? */
export function isInWorkmanshipWindow(completedAt: Date | string | null, at = new Date()): boolean {
    if (!completedAt) return false;
    const end = new Date(completedAt).getTime() + WORKMANSHIP_WARRANTY_DAYS * 86_400_000;
    return end > at.getTime();
}

/**
 * What a customer is entitled to on this booking, in the words they should hear.
 * Answering this used to require a phone call to a technician who might remember.
 */
export async function warrantySummary(serviceRequestId: number) {
    const [booking] = await db.select().from(serviceRequests)
        .where(eq(serviceRequests.id, serviceRequestId)).limit(1);
    if (!booking) return null;

    const parts = await getPartItems(serviceRequestId);
    const completedAt = (booking as any).completedAt ?? (booking as any).updatedAt ?? null;
    const workmanshipActive = isInWorkmanshipWindow(completedAt);

    return {
        serviceRequestId,
        workmanship: {
            days: WORKMANSHIP_WARRANTY_DAYS,
            active: workmanshipActive,
            expiresAt: completedAt
                ? new Date(new Date(completedAt).getTime() + WORKMANSHIP_WARRANTY_DAYS * 86_400_000)
                : null,
            backedBy: 'UniteFix',
            statement: workmanshipActive
                ? `Our work on this job is guaranteed until ${new Date(new Date(completedAt).getTime() + WORKMANSHIP_WARRANTY_DAYS * 86_400_000).toLocaleDateString('en-IN')}.`
                : 'The 30-day guarantee on our work has ended for this job.',
        },
        parts: parts.map(p => ({
            id: p.id,
            partName: p.partName,
            brand: p.brand,
            quantity: p.quantity,
            warrantyDays: p.warrantyDays,
            backedBy: backerLabel(p.warrantyBacker as WarrantyBacker, p.vendorName),
            expiresAt: p.warrantyExpiresAt,
            active: isInWarranty(p as any),
            statement: partStatement(p as any),
        })),
        canClaim: workmanshipActive || parts.some(p => isInWarranty(p as any)),
    };
}

export function backerLabel(backer: WarrantyBacker, vendorName: string | null): string {
    switch (backer) {
        case 'unitefix': return 'UniteFix';
        case 'vendor': return vendorName ?? 'Supplying vendor';
        case 'manufacturer': return 'Manufacturer';
        case 'none': return 'No warranty';
    }
}

/** One sentence a customer or an admin can read without interpreting anything. */
export function partStatement(p: {
    partName: string; warrantyDays: number; warrantyBacker: WarrantyBacker;
    vendorName: string | null; warrantyExpiresAt: Date | string | null; sourceType: PartSource;
}): string {
    if (p.sourceType === 'customer_supplied') {
        return `${p.partName} was supplied by you, so its warranty stays with wherever you bought it. Our fitting of it is covered by our ${WORKMANSHIP_WARRANTY_DAYS}-day guarantee.`;
    }
    if (p.warrantyDays <= 0 || p.warrantyBacker === 'none') {
        return `${p.partName} carries no separate part warranty. Our ${WORKMANSHIP_WARRANTY_DAYS}-day guarantee still covers the fitting.`;
    }
    const until = p.warrantyExpiresAt
        ? new Date(p.warrantyExpiresAt).toLocaleDateString('en-IN') : 'unknown';
    const who = backerLabel(p.warrantyBacker, p.vendorName);
    const live = isInWarranty(p as any);
    return live
        ? `${p.partName} is under a ${p.warrantyDays}-day warranty backed by ${who}, valid until ${until}. Raise it with us and we will handle the claim.`
        : `${p.partName} had a ${p.warrantyDays}-day warranty backed by ${who}, which ended on ${until}.`;
}

export async function createClaim(input: {
    serviceRequestId: number;
    partItemId?: number | null;
    raisedByUserId: number;
    description: string;
}) {
    const claimId = `WC-${input.serviceRequestId}-${Date.now().toString(36).toUpperCase()}`;
    const [claim] = await db.insert(warrantyClaims).values({
        claimId,
        serviceRequestId: input.serviceRequestId,
        partItemId: input.partItemId ?? null,
        raisedByUserId: input.raisedByUserId,
        description: input.description.trim().slice(0, 2000),
        status: 'open',
    }).returning();
    logger.info(`[WARRANTY] Claim ${claimId} opened on SR #${input.serviceRequestId}`);
    return claim;
}

/** Record the inspection verdict and let it route the cost. No case-by-case judgement. */
export async function settleClaim(claimId: number, verdict: Verdict, inspectedBy: number, notes?: string) {
    const [claim] = await db.select().from(warrantyClaims).where(eq(warrantyClaims.id, claimId)).limit(1);
    if (!claim) return null;

    let part: any = null;
    if (claim.partItemId) {
        [part] = await db.select().from(servicePartItems)
            .where(eq(servicePartItems.id, claim.partItemId)).limit(1);
    }

    const costBearer = routeCost(verdict, part
        ? { sourceType: part.sourceType as PartSource, isDocumented: part.isDocumented }
        : null);

    const [updated] = await db.update(warrantyClaims).set({
        status: 'resolved',
        verdict: verdict as any,
        verdictNotes: notes?.trim().slice(0, 2000) ?? null,
        costBearer: costBearer as any,
        inspectedBy,
        inspectedAt: new Date(),
        resolvedAt: new Date(),
    }).where(eq(warrantyClaims.id, claimId)).returning();

    logger.info(`[WARRANTY] Claim ${claim.claimId} → ${verdict}, cost borne by ${costBearer}`);
    return updated;
}

/**
 * Claims with the context needed to act on one.
 *
 * Joined here rather than fetched per row by the screen: an admin deciding a
 * verdict needs the customer, the job, the part and who supplied it in front of
 * them, and a list that made a request per claim to assemble that would be slow
 * and would still leave the sourcing — the fact the whole decision turns on —
 * one more click away.
 */
export async function listClaims(filter?: { status?: string; serviceRequestId?: number }) {
    const where = [] as any[];
    if (filter?.status) where.push(eq(warrantyClaims.status, filter.status as any));
    if (filter?.serviceRequestId) where.push(eq(warrantyClaims.serviceRequestId, filter.serviceRequestId));

    const q = db
        .select({
            claim: warrantyClaims,
            booking: {
                serviceId: serviceRequests.serviceId,
                serviceType: serviceRequests.serviceType,
                address: serviceRequests.address,
                providerId: serviceRequests.providerId,
            },
            customerName: users.username,
            customerPhone: users.phone,
            part: {
                id: servicePartItems.id,
                partName: servicePartItems.partName,
                brand: servicePartItems.brand,
                sourceType: servicePartItems.sourceType,
                vendorName: servicePartItems.vendorName,
                isDocumented: servicePartItems.isDocumented,
                warrantyBacker: servicePartItems.warrantyBacker,
                warrantyExpiresAt: servicePartItems.warrantyExpiresAt,
                unitPricePaise: servicePartItems.unitPricePaise,
                quantity: servicePartItems.quantity,
                billPhotoUrl: servicePartItems.billPhotoUrl,
            },
        })
        .from(warrantyClaims)
        .leftJoin(serviceRequests, eq(serviceRequests.id, warrantyClaims.serviceRequestId))
        .leftJoin(users, eq(users.id, warrantyClaims.raisedByUserId))
        .leftJoin(servicePartItems, eq(servicePartItems.id, warrantyClaims.partItemId))
        .orderBy(desc(warrantyClaims.createdAt))
        .limit(200);

    const rows = await (where.length ? q.where(and(...where)) : q);

    // The verdict each row WOULD route to, shown before anyone commits to it, so
    // the consequence of a choice is visible at the point of making it.
    return rows.map(r => ({
        ...r,
        wouldRoute: r.part
            ? {
                part_failed: routeCost('part_failed', {
                    sourceType: r.part.sourceType as PartSource,
                    isDocumented: r.part.isDocumented,
                }),
            }
            : { part_failed: 'unitefix' as CostBearer },
    }));
}
