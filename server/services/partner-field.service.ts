/**
 * Field service for business partners (Partner Hub phase 4).
 *
 *   Territories  pincodes a partner serves; proposed by the partner, approved
 *                by UniteFix (which also makes a new pincode serviceable).
 *                One exclusive partner per pincode; several may share one.
 *   Routing      at booking, the customer's pincode → active territory → the
 *                partner's queue (dispatch_partner_id), with an assign-by SLA.
 *                Overdue jobs escalate to UniteFix's own queue.
 *   Rates        a partner's all-in price per catalogue service, within ±N%
 *                of the national price; 'new' partners' rates are reviewed.
 *                A rate applies only when the customer was shown it — an app
 *                that shows the national price gets the national price.
 *   Technicians  ordinary employees rows with managed_by_partner_id. UniteFix
 *                still verifies each one before they can work.
 *   Money        the partner is the employer and the sole payee: the job's
 *                technician earning is held for the usual window, then booked
 *                to the partner ledger (service_value). On cash jobs UniteFix's
 *                share is booked against the partner (cash_collected).
 *                Monthly, the partner's invoice to UniteFix for the work
 *                (subcontract model A) is generated from the released values.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import {
    partnerTerritories, partnerServiceRates, partnerJobEarnings, serviceablePincodes, districts, employees, users,
    serviceRequests, services, serviceCategories, businessPartners, businessPartnerLedger, warrantyClaims, taxDocuments,
    type PartnerTerritory, type ServiceRequest,
} from '@shared/schema';
import { configService } from './config.service';
import { BusinessPartnerService } from './business-partner.service';
import { TaxDocumentService, type Party } from './tax-documents.service';
import { HubError, type HubContext } from './partner-hub.service';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';

const OPEN_JOB = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'];
const ACTIVE_JOB = ['assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'];

export const pinFrom = (body: any): string | null => {
    for (const v of [body?.pinCode, body?.pincode]) { const s = String(v ?? '').trim(); if (/^\d{6}$/.test(s)) return s; }
    const m = String(body?.address ?? '').match(/\b(\d{6})\b/);
    return m ? m[1] : null;
};

export interface Routing {
    dispatchPartnerId: number | null;
    dispatchMode: string | null;
    partnerName: string | null;
    partnerPhone: string | null;
    unitPrice: number | null;          // the partner's rate, when it applies
    platformFeePercent: number | null; // the partner's fee %, when routed
    slaAssignBy: Date | null;
}

export class PartnerFieldService {

    // ══════════════════════════════════════════════════════════════════════
    // Territories
    // ══════════════════════════════════════════════════════════════════════

    static async territories(bpId: number) {
        const rows = await db.select({ t: partnerTerritories, area: serviceablePincodes.area, district: serviceablePincodes.district, serviceable: serviceablePincodes.isActive })
            .from(partnerTerritories).leftJoin(serviceablePincodes, eq(serviceablePincodes.pincode, partnerTerritories.pincode))
            .where(eq(partnerTerritories.businessPartnerId, bpId)).orderBy(asc(partnerTerritories.pincode));
        const open = rows.length ? await db.select({ pin: serviceRequests.pincode, n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(eq(serviceRequests.dispatchPartnerId, bpId), inArray(serviceRequests.status, OPEN_JOB as any))).groupBy(serviceRequests.pincode) : [];
        const openBy = new Map(open.map(o => [o.pin, o.n]));
        return rows.map(r => ({ ...r.t, area: r.area ?? r.t.proposedArea, district: r.district ?? r.t.proposedDistrict, serviceable: !!r.serviceable, openJobs: openBy.get(r.t.pincode) ?? 0 }));
    }

    /** Partner proposes pincodes (pasted list). Nothing is bookable until UniteFix approves. */
    static async propose(ctx: HubContext, input: { pincodes: string[]; area?: string | null }) {
        const pins = Array.from(new Set(input.pincodes.map(p => String(p).trim()).filter(Boolean)));
        if (!pins.length) throw new HubError('Enter at least one pincode.', 'NO_PINCODES');
        if (pins.length > 200) throw new HubError('At most 200 pincodes at a time.', 'TOO_MANY');
        const bad = pins.filter(p => !/^[1-9]\d{5}$/.test(p));
        if (bad.length) throw new HubError(`Not valid pincodes: ${bad.slice(0, 10).join(', ')}`, 'BAD_PINCODE');
        const existing = await db.select({ pincode: partnerTerritories.pincode, status: partnerTerritories.status }).from(partnerTerritories)
            .where(and(eq(partnerTerritories.businessPartnerId, ctx.businessPartnerId), inArray(partnerTerritories.pincode, pins)));
        const mine = new Map(existing.map(e => [e.pincode, e.status]));
        const dists = await db.select().from(districts);
        let added = 0, reopened = 0;
        for (const pin of pins) {
            const st = mine.get(pin);
            if (st && ['proposed', 'active', 'paused'].includes(st)) continue;
            const d = dists.filter(x => pin.startsWith(x.pincodePrefix)).sort((a, b) => b.pincodePrefix.length - a.pincodePrefix.length)[0];
            if (st) {
                await db.update(partnerTerritories).set({ status: 'proposed', proposedAt: new Date(), reviewNote: null, updatedAt: new Date() })
                    .where(and(eq(partnerTerritories.businessPartnerId, ctx.businessPartnerId), eq(partnerTerritories.pincode, pin)));
                reopened++;
            } else {
                await db.insert(partnerTerritories).values({ businessPartnerId: ctx.businessPartnerId, pincode: pin, status: 'proposed', proposedArea: input.area?.trim() || null, proposedDistrict: d?.name ?? null }).onConflictDoNothing();
                added++;
            }
        }
        return { added, reopened, skipped: pins.length - added - reopened };
    }

    static async setPaused(ctx: HubContext, id: number, paused: boolean, reason?: string | null) {
        const [t] = await db.select().from(partnerTerritories).where(and(eq(partnerTerritories.id, id), eq(partnerTerritories.businessPartnerId, ctx.businessPartnerId))).limit(1);
        if (!t) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (paused && t.status !== 'active') throw new HubError('Only an active pincode can be paused.', 'BAD_STATE', 409);
        if (!paused && t.status !== 'paused') throw new HubError('Only a paused pincode can be resumed.', 'BAD_STATE', 409);
        try {
            const [u] = await db.update(partnerTerritories).set({ status: paused ? 'paused' : 'active', pausedReason: paused ? (reason?.trim() || 'Paused by partner') : null, updatedAt: new Date() })
                .where(eq(partnerTerritories.id, id)).returning();
            return u;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('Another partner now holds this pincode exclusively. Ask UniteFix to make it shared.', 'EXCLUSIVE_TAKEN', 409);
            throw e;
        }
    }

    static async withdraw(ctx: HubContext, id: number) {
        const [t] = await db.select().from(partnerTerritories).where(and(eq(partnerTerritories.id, id), eq(partnerTerritories.businessPartnerId, ctx.businessPartnerId))).limit(1);
        if (!t) throw new HubError('Not found', 'NOT_FOUND', 404);
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(eq(serviceRequests.dispatchPartnerId, ctx.businessPartnerId), eq(serviceRequests.pincode, t.pincode), inArray(serviceRequests.status, OPEN_JOB as any)));
        if (n > 0) throw new HubError(`${n} open job(s) in ${t.pincode}. Finish them first.`, 'OPEN_JOBS', 409);
        const [u] = await db.update(partnerTerritories).set({ status: 'withdrawn', updatedAt: new Date() }).where(eq(partnerTerritories.id, id)).returning();
        return u;
    }

    // ── Staff ────────────────────────────────────────────────────────────

    static async adminTerritories(filter: { status?: string; pincode?: string } = {}) {
        const conds: any[] = [];
        if (filter.status) conds.push(eq(partnerTerritories.status, filter.status));
        if (filter.pincode) conds.push(eq(partnerTerritories.pincode, filter.pincode));
        return db.select({ t: partnerTerritories, partnerCode: businessPartners.partnerCode, partnerName: businessPartners.displayName, serviceable: serviceablePincodes.isActive, area: serviceablePincodes.area })
            .from(partnerTerritories)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerTerritories.businessPartnerId))
            .leftJoin(serviceablePincodes, eq(serviceablePincodes.pincode, partnerTerritories.pincode))
            .where(conds.length ? and(...conds) : undefined).orderBy(asc(partnerTerritories.pincode)).limit(2000);
    }

    /**
     * Approve or reject proposed pincodes. Approval makes a new pincode
     * serviceable in the same step — never a pincode a customer can book with
     * nobody to go, nor one granted to a partner that customers cannot book.
     */
    static async review(adminId: number, ids: number[], decision: 'approve' | 'reject', opts: { mode?: 'exclusive' | 'shared'; note?: string | null } = {}) {
        if (!ids.length) throw new HubError('Choose pincodes.', 'NO_IDS');
        const rows = await db.select().from(partnerTerritories).where(and(inArray(partnerTerritories.id, ids), eq(partnerTerritories.status, 'proposed')));
        const done: string[] = [], conflicts: string[] = [];
        for (const t of rows) {
            if (decision === 'reject') {
                await db.update(partnerTerritories).set({ status: 'rejected', reviewNote: opts.note ?? null, updatedAt: new Date() }).where(eq(partnerTerritories.id, t.id));
                done.push(t.pincode); continue;
            }
            const [sp] = await db.select().from(serviceablePincodes).where(eq(serviceablePincodes.pincode, t.pincode)).limit(1);
            // Default: exclusive where UniteFix did not serve the pincode before, shared where it did.
            const mode = opts.mode ?? (sp?.isActive ? 'shared' : 'exclusive');
            try {
                await withTransaction(async (tx) => {
                    if (!sp) {
                        const [d] = t.proposedDistrict ? await tx.select().from(districts).where(eq(districts.name, t.proposedDistrict)).limit(1) : [];
                        await tx.insert(serviceablePincodes).values({ pincode: t.pincode, area: t.proposedArea, district: d?.name ?? t.proposedDistrict, districtId: d?.id ?? null, state: d?.state ?? null, isActive: true }).onConflictDoNothing();
                    } else if (!sp.isActive) {
                        await tx.update(serviceablePincodes).set({ isActive: true }).where(eq(serviceablePincodes.pincode, t.pincode));
                    }
                    await tx.update(partnerTerritories).set({ status: 'active', mode, activatedAt: new Date(), activatedByAdminId: adminId, reviewNote: opts.note ?? null, updatedAt: new Date() })
                        .where(eq(partnerTerritories.id, t.id));
                });
                done.push(t.pincode);
            } catch (e: any) {
                if (e?.code === '23505') { conflicts.push(t.pincode); continue; }
                throw e;
            }
        }
        if (done.length) {
            const { HubAlerts } = await import('./hub-alerts.service');
            const byBp = new Map<number, string[]>();
            for (const t of rows) if (done.includes(t.pincode)) byBp.set(t.businessPartnerId, [...(byBp.get(t.businessPartnerId) ?? []), t.pincode]);
            for (const [bp, pins] of Array.from(byBp)) await HubAlerts.send(bp, 'territory_reviewed', { title: decision === 'approve' ? 'Pincodes approved' : 'Pincodes not approved', body: `${pins.join(', ')} ${decision === 'approve' ? 'are now yours — bookings there come to your queue.' : `were not approved${opts.note ? `: ${opts.note}` : '.'}`}`, link: '/partner/field/territory' });
        }
        return { done, conflicts };
    }

    static async adminUpdate(adminId: number, id: number, patch: { mode?: 'exclusive' | 'shared'; status?: 'active' | 'paused' | 'withdrawn'; note?: string | null }) {
        try {
            const [u] = await db.update(partnerTerritories).set({
                ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.status ? { status: patch.status, pausedReason: patch.status === 'paused' ? (patch.note ?? 'Paused by UniteFix') : null } : {}),
                reviewNote: patch.note ?? undefined, updatedAt: new Date(),
            }).where(eq(partnerTerritories.id, id)).returning();
            if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
            logger.info(`[FIELD] Territory ${u.pincode} (#${id}) updated by admin ${adminId}: ${JSON.stringify(patch)}`);
            return u;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('Another partner already holds this pincode exclusively.', 'EXCLUSIVE_TAKEN', 409);
            throw e;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Routing and price
    // ══════════════════════════════════════════════════════════════════════

    /** The partner serving a pincode: the exclusive one, else the least-loaded sharing partner. */
    static async partnerFor(pincode: string | null): Promise<{ bp: typeof businessPartners.$inferSelect; mode: string } | null> {
        if (!pincode) return null;
        const rows = await db.select({ t: partnerTerritories, bp: businessPartners }).from(partnerTerritories)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerTerritories.businessPartnerId))
            .where(and(eq(partnerTerritories.pincode, pincode), eq(partnerTerritories.status, 'active'), eq(businessPartners.status, 'active')));
        if (!rows.length) return null;
        const excl = rows.find(r => r.t.mode === 'exclusive');
        if (excl) return { bp: excl.bp, mode: 'exclusive' };
        const loads = await db.select({ bp: serviceRequests.dispatchPartnerId, n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(inArray(serviceRequests.dispatchPartnerId, rows.map(r => r.bp.id)), inArray(serviceRequests.status, OPEN_JOB as any))).groupBy(serviceRequests.dispatchPartnerId);
        const load = new Map(loads.map(l => [l.bp, l.n]));
        rows.sort((a, b) => (load.get(a.bp.id) ?? 0) - (load.get(b.bp.id) ?? 0) || a.bp.id - b.bp.id);
        return { bp: rows[0].bp, mode: 'shared' };
    }

    static async liveRate(bpId: number, catalogServiceId: number, at = new Date()) {
        const [r] = await db.select().from(partnerServiceRates).where(and(
            eq(partnerServiceRates.businessPartnerId, bpId), eq(partnerServiceRates.catalogServiceId, catalogServiceId),
            eq(partnerServiceRates.status, 'live'), lte(partnerServiceRates.effectiveFrom, at),
        )).orderBy(desc(partnerServiceRates.effectiveFrom)).limit(1);
        return r ?? null;
    }

    /** What the customer app should show for a service at a pincode. */
    static async quote(catalogServiceId: number, pincode: string | null) {
        const [svc] = await db.select({ basePrice: services.basePrice, name: services.name }).from(services).where(eq(services.id, catalogServiceId)).limit(1);
        if (!svc) return null;
        const p = await this.partnerFor(pincode);
        const rate = p ? await this.liveRate(p.bp.id, catalogServiceId) : null;
        return {
            catalogServiceId, nationalPrice: svc.basePrice, unitPrice: rate?.basePrice ?? svc.basePrice,
            servicedBy: p ? { name: p.bp.displayName, phone: p.bp.fieldSupportPhone ?? p.bp.contactPhone, note: `Serviced by ${p.bp.displayName}, a UniteFix partner` } : null,
        };
    }

    /**
     * Decide routing for a new booking. The partner's rate is used only when
     * the app quoted that exact price to the customer (`quotedUnitPrice`);
     * otherwise the customer pays the national price they were shown.
     */
    static async route(input: { catalogServiceId: number | null; pincode: string | null; urgency?: string | null; quotedUnitPrice?: number | null }): Promise<Routing> {
        const none: Routing = { dispatchPartnerId: null, dispatchMode: null, partnerName: null, partnerPhone: null, unitPrice: null, platformFeePercent: null, slaAssignBy: null };
        try {
            const p = await this.partnerFor(input.pincode);
            if (!p) return none;
            const rate = input.catalogServiceId ? await this.liveRate(p.bp.id, input.catalogServiceId) : null;
            const quoted = input.quotedUnitPrice != null ? Math.round(Number(input.quotedUnitPrice)) : null;
            const fee = p.bp.fieldFeePercent != null ? Number(p.bp.fieldFeePercent) : Number(await configService.get<number>('BUSINESS_CONFIG.PARTNER_FIELD_FEE_PERCENT', 15));
            const hours = Number(await configService.get<number>(input.urgency === 'urgent' ? 'BUSINESS_CONFIG.PARTNER_ASSIGN_SLA_URGENT_HOURS' : 'BUSINESS_CONFIG.PARTNER_ASSIGN_SLA_HOURS', input.urgency === 'urgent' ? 1 : 2));
            return {
                dispatchPartnerId: p.bp.id, dispatchMode: p.mode, partnerName: p.bp.displayName, partnerPhone: p.bp.fieldSupportPhone ?? p.bp.contactPhone,
                unitPrice: rate && quoted === rate.basePrice ? rate.basePrice : null,
                platformFeePercent: Number.isFinite(fee) ? fee : 15,
                slaAssignBy: new Date(Date.now() + hours * 3_600_000),
            };
        } catch (e: any) {
            // Routing is an enhancement to booking; it must never stop one.
            logger.error('[FIELD] Routing failed; booking goes to UniteFix', { error: e?.message });
            return none;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Rates
    // ══════════════════════════════════════════════════════════════════════

    static async guardrailPercent() { return Number(await configService.get<number>('BUSINESS_CONFIG.PARTNER_RATE_GUARDRAIL_PERCENT', 25)) || 25; }

    static async rates(bpId: number) {
        const pct = await this.guardrailPercent();
        const svcs = await db.select({ id: services.id, name: services.name, basePrice: services.basePrice, category: serviceCategories.name })
            .from(services).leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
            .where(and(eq(services.isActive, true), sql`${services.basePrice} > 0`)).orderBy(asc(serviceCategories.name), asc(services.name));
        const mine = await db.select().from(partnerServiceRates).where(eq(partnerServiceRates.businessPartnerId, bpId)).orderBy(desc(partnerServiceRates.effectiveFrom));
        const now = new Date();
        return svcs.map(s => {
            const rs = mine.filter(r => r.catalogServiceId === s.id);
            const live = rs.find(r => r.status === 'live' && new Date(r.effectiveFrom) <= now) ?? null;
            const upcoming = rs.find(r => (r.status === 'live' && new Date(r.effectiveFrom) > now) || r.status === 'pending_review') ?? null;
            const lastRejected = rs.find(r => r.status === 'rejected') ?? null;
            return {
                catalogServiceId: s.id, name: s.name, category: s.category, nationalPrice: s.basePrice,
                floor: Math.ceil(s.basePrice * (100 - pct) / 100), ceiling: Math.floor(s.basePrice * (100 + pct) / 100),
                live: live && { id: live.id, price: live.basePrice, since: live.effectiveFrom },
                upcoming: upcoming && { id: upcoming.id, price: upcoming.basePrice, from: upcoming.effectiveFrom, status: upcoming.status },
                rejected: lastRejected && (!upcoming || new Date(lastRejected.submittedAt!) > new Date(upcoming.submittedAt!)) ? { price: lastRejected.basePrice, note: lastRejected.reviewNote } : null,
            };
        });
    }

    /**
     * Set a rate. Inside the guardrails it is refused nowhere; it goes live no
     * sooner than 24 h ahead (a customer mid-booking never sees a price move),
     * and a 'new'-tier partner's rate waits for UniteFix review.
     */
    static async setRate(ctx: HubContext, input: { catalogServiceId: number; price: number; effectiveFrom?: string | null }) {
        const [svc] = await db.select().from(services).where(eq(services.id, input.catalogServiceId)).limit(1);
        if (!svc || !svc.isActive || svc.basePrice <= 0) throw new HubError('That service is not in the catalogue.', 'NO_SERVICE', 404);
        const price = Math.round(Number(input.price));
        const pct = await this.guardrailPercent();
        const floor = Math.ceil(svc.basePrice * (100 - pct) / 100), ceiling = Math.floor(svc.basePrice * (100 + pct) / 100);
        if (!(price >= floor && price <= ceiling)) throw new HubError(`For ${svc.name} the price must be between ₹${floor} and ₹${ceiling} (national ₹${svc.basePrice}, ±${pct}%).`, 'OUT_OF_BAND');
        const earliest = new Date(Date.now() + 24 * 3_600_000);
        let from = input.effectiveFrom ? new Date(input.effectiveFrom) : earliest;
        if (Number.isNaN(from.getTime())) throw new HubError('Bad start date.', 'BAD_DATE');
        if (from < earliest) from = earliest;
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const status = bp?.fieldTier === 'new' || bp?.fieldTier === 'restricted' ? 'pending_review' : 'live';
        // A newer request replaces any not-yet-effective one.
        await db.update(partnerServiceRates).set({ status: 'retired' }).where(and(
            eq(partnerServiceRates.businessPartnerId, ctx.businessPartnerId), eq(partnerServiceRates.catalogServiceId, svc.id),
            or(eq(partnerServiceRates.status, 'pending_review'), and(eq(partnerServiceRates.status, 'live'), gte(partnerServiceRates.effectiveFrom, new Date()))),
        ));
        const [row] = await db.insert(partnerServiceRates).values({
            businessPartnerId: ctx.businessPartnerId, catalogServiceId: svc.id, basePrice: price, status, effectiveFrom: from, submittedByAdminUserId: ctx.adminUserId,
        }).returning();
        return row;
    }

    /** Back to the national price, from 24 h ahead. */
    static async clearRate(ctx: HubContext, catalogServiceId: number) {
        const [svc] = await db.select().from(services).where(eq(services.id, catalogServiceId)).limit(1);
        if (!svc) throw new HubError('Not found', 'NOT_FOUND', 404);
        return this.setRate(ctx, { catalogServiceId, price: svc.basePrice });
    }

    static async pendingRates() {
        return db.select({ r: partnerServiceRates, partnerName: businessPartners.displayName, partnerCode: businessPartners.partnerCode, serviceName: services.name, nationalPrice: services.basePrice })
            .from(partnerServiceRates)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerServiceRates.businessPartnerId))
            .innerJoin(services, eq(services.id, partnerServiceRates.catalogServiceId))
            .where(eq(partnerServiceRates.status, 'pending_review')).orderBy(asc(partnerServiceRates.submittedAt));
    }

    static async reviewRates(adminId: number, ids: number[], approve: boolean, note?: string | null) {
        if (!ids.length) return [];
        const now = new Date();
        const rows = await db.select().from(partnerServiceRates).where(and(inArray(partnerServiceRates.id, ids), eq(partnerServiceRates.status, 'pending_review')));
        for (const r of rows) {
            // Approval never makes a price effective sooner than its notice period from now.
            const from = new Date(Math.max(new Date(r.effectiveFrom).getTime(), now.getTime() + 24 * 3_600_000));
            await db.update(partnerServiceRates).set({ status: approve ? 'live' : 'rejected', effectiveFrom: approve ? from : r.effectiveFrom, reviewedByAdminId: adminId, reviewedAt: now, reviewNote: note ?? null })
                .where(eq(partnerServiceRates.id, r.id));
        }
        const { HubAlerts } = await import('./hub-alerts.service');
        const byBp = new Map<number, number>();
        for (const r of rows) byBp.set(r.businessPartnerId, (byBp.get(r.businessPartnerId) ?? 0) + 1);
        for (const [bp, n] of Array.from(byBp)) await HubAlerts.send(bp, 'rate_reviewed', { title: approve ? 'Rates approved' : 'Rates not approved', body: `${n} rate change(s) ${approve ? 'approved — they go live at their start time.' : `not approved${note ? `: ${note}` : '.'}`}`, link: '/partner/field/rates' });
        return rows.map(r => r.id);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Technicians
    // ══════════════════════════════════════════════════════════════════════

    static async technicians(bpId: number) {
        const rows = await db.select({ e: employees, phone: users.phone }).from(employees).leftJoin(users, eq(users.id, employees.userId))
            .where(eq(employees.managedByPartnerId, bpId)).orderBy(asc(employees.fullName));
        const ids = rows.map(r => r.e.id);
        const active = ids.length ? await db.select({ p: serviceRequests.providerId, n: sql<number>`count(*)::int` }).from(serviceRequests)
            .where(and(inArray(serviceRequests.providerId, ids), inArray(serviceRequests.status, ACTIVE_JOB as any))).groupBy(serviceRequests.providerId) : [];
        const act = new Map(active.map(a => [a.p, a.n]));
        return rows.map(({ e, phone }) => ({
            id: e.id, partnerId: e.partnerId, fullName: e.fullName, phone, services: e.services ?? [], isActive: !!e.isActive, isOnline: !!e.isOnline,
            verification: e.documentVerificationStatus, adminRemarks: e.adminRemarks,
            documents: { aadhaar: !!e.aadhaarDocUrl, pan: !!e.panDocUrl, photo: !!e.profilePhotoUrl },
            completed: e.totalServicesCompleted ?? 0, rating: Number(e.averageRating ?? 0), activeJobs: act.get(e.id) ?? 0,
        }));
    }

    /**
     * Add a technician. They sign in to the UniteFix app with this mobile
     * number (OTP); UniteFix verifies their documents before they can work.
     */
    static async addTechnician(ctx: HubContext, input: { fullName: string; phone: string; services?: string[] }) {
        const phone = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) throw new HubError('A 10-digit mobile number is needed — it is their app login.', 'BAD_PHONE');
        if (!input.fullName?.trim()) throw new HubError('Name is required.', 'NO_NAME');
        const [taken] = await db.select({ id: users.id }).from(users).where(or(eq(users.phone, phone), eq(users.phone, `+91${phone}`))).limit(1);
        if (taken) throw new HubError('This number already has a UniteFix account. A technician who already works with UniteFix cannot be moved here from the Hub — contact UniteFix.', 'PHONE_TAKEN', 409);
        const { storage } = await import('../storage');
        const user = await withTransaction(async (tx) => {
            const [u] = await tx.insert(users).values({
                phone, username: input.fullName.trim(), role: 'serviceman', password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10), isActive: true,
            } as any).returning();
            return u;
        });
        try {
            const emp = await storage.createServiceProvider({
                userId: user.id, fullName: input.fullName.trim(), partnerType: 'Partner staff', businessName: ctx.displayName,
                services: (input.services ?? []).slice(0, 20), isActive: false, isOnline: false, managedByPartnerId: ctx.businessPartnerId,
            });
            return emp;
        } catch (e) {
            await db.delete(users).where(eq(users.id, user.id));
            throw e;
        }
    }

    static async technician(bpId: number, id: number) {
        const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.managedByPartnerId, bpId))).limit(1);
        if (!e) throw new HubError('Technician not found', 'NOT_FOUND', 404);
        return e;
    }

    /** Partner switches its own person on or off (instant), or edits their trades. Activation needs UniteFix verification. */
    static async updateTechnician(ctx: HubContext, id: number, patch: { isActive?: boolean; services?: string[]; fullName?: string }) {
        const e = await this.technician(ctx.businessPartnerId, id);
        if (patch.isActive === true && e.documentVerificationStatus !== 'verified') throw new HubError('UniteFix has not verified this technician yet. Upload their documents; activation follows verification.', 'NOT_VERIFIED', 409);
        const [u] = await db.update(employees).set({
            ...(patch.isActive !== undefined ? { isActive: patch.isActive, ...(patch.isActive ? {} : { isOnline: false }) } : {}),
            ...(patch.services ? { services: patch.services.slice(0, 20) } : {}),
            ...(patch.fullName?.trim() ? { fullName: patch.fullName.trim() } : {}),
            updatedAt: new Date(),
        }).where(eq(employees.id, id)).returning();
        return u;
    }

    static async setTechnicianDocument(ctx: HubContext, id: number, kind: 'aadhaar' | 'pan' | 'photo', url: string) {
        const e = await this.technician(ctx.businessPartnerId, id);
        const col = kind === 'aadhaar' ? { aadhaarDocUrl: url } : kind === 'pan' ? { panDocUrl: url } : { profilePhotoUrl: url };
        // New documents go back to UniteFix for verification.
        const [u] = await db.update(employees).set({ ...col, ...(e.documentVerificationStatus === 'rejected' ? { documentVerificationStatus: 'pending' as any } : {}), updatedAt: new Date() })
            .where(eq(employees.id, id)).returning();
        return u;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Jobs
    // ══════════════════════════════════════════════════════════════════════

    static async jobs(bpId: number, view: 'queue' | 'active' | 'done' = 'queue') {
        const statusCond = view === 'queue' ? eq(serviceRequests.status, 'created' as any)
            : view === 'active' ? inArray(serviceRequests.status, ACTIVE_JOB as any)
                : inArray(serviceRequests.status, ['completed', 'cancelled'] as any);
        const rows = await db.select({
            sr: serviceRequests, customerName: users.username, customerPhone: users.phone, serviceName: services.name, categoryName: serviceCategories.name,
            techName: employees.fullName,
        }).from(serviceRequests)
            .leftJoin(users, eq(users.id, serviceRequests.userId))
            .leftJoin(services, eq(services.id, serviceRequests.catalogServiceId))
            .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
            .leftJoin(employees, eq(employees.id, serviceRequests.providerId))
            .where(and(eq(serviceRequests.dispatchPartnerId, bpId), eq(serviceRequests.bookingFeeStatus, 'paid'), statusCond))
            .orderBy(view === 'done' ? desc(serviceRequests.updatedAt) : asc(serviceRequests.createdAt)).limit(view === 'done' ? 200 : 500);
        const now = Date.now();
        const ninety = 90 * 86_400_000;
        return rows.map(r => {
            const s = r.sr;
            const closedLongAgo = ['completed', 'cancelled'].includes(s.status as string) && s.updatedAt && now - new Date(s.updatedAt).getTime() > ninety;
            const snap: any = s.pricingSnapshot ?? {};
            return {
                id: s.id, serviceId: s.serviceId, status: s.status, serviceName: r.serviceName ?? s.serviceType, categoryName: r.categoryName, quantity: s.quantity,
                description: s.description, urgency: s.urgency, preferredDate: s.preferredDate, preferredTimeSlot: s.preferredTimeSlot,
                // Customer details only while the job is theirs to do (DPDP): masked 90 days after closing.
                customerName: closedLongAgo ? null : r.customerName, customerPhone: closedLongAgo ? null : r.customerPhone, address: closedLongAgo ? null : s.address,
                pincode: s.pincode, createdAt: s.createdAt, assignedAt: s.assignedAt, completedAt: s.completedAt,
                technician: s.providerId ? { id: s.providerId, name: r.techName } : null,
                slaAssignBy: s.slaAssignBy, overdue: !s.providerId && !!s.slaAssignBy && new Date(s.slaAssignBy).getTime() < now, escalatedAt: s.escalatedAt,
                price: snap.basePrice ?? snap.grossTotal ?? null, yourValue: snap.technicianEarning ?? null, paymentMethod: s.paymentMethod,
            };
        });
    }

    static async assign(ctx: HubContext, serviceRequestId: number, employeeId: number) {
        const [sr] = await db.select().from(serviceRequests).where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.dispatchPartnerId, ctx.businessPartnerId))).limit(1);
        if (!sr) throw new HubError('Job not found', 'NOT_FOUND', 404);
        if (!['created', 'assigned'].includes(sr.status as string)) throw new HubError(`This job is ${sr.status}; it can no longer be reassigned here.`, 'BAD_STATE', 409);
        if (sr.bookingFeeStatus !== 'paid') throw new HubError('The customer has not paid the booking fee yet.', 'UNPAID', 409);
        const e = await this.technician(ctx.businessPartnerId, employeeId);
        if (e.documentVerificationStatus !== 'verified' || !e.isActive) throw new HubError(`${e.fullName ?? 'This technician'} is not verified and active.`, 'NOT_READY', 409);
        const { AdminServiceManager } = await import('./admin-service.manager');
        return sr.status === 'assigned' && sr.providerId
            ? AdminServiceManager.reassignTechnician(serviceRequestId, employeeId, 'Reassigned by partner', ctx.adminUserId)
            : AdminServiceManager.assignTechnician(serviceRequestId, employeeId, ctx.adminUserId);
    }

    /** Unassigned past the SLA → visible in UniteFix's queue too. Run every few minutes. */
    static async escalateOverdue() {
        const rows = await db.update(serviceRequests).set({ escalatedAt: new Date(), escalationReason: 'Not assigned by the partner in time' })
            .where(and(isNotNull(serviceRequests.dispatchPartnerId), isNull(serviceRequests.providerId), isNull(serviceRequests.escalatedAt),
                eq(serviceRequests.status, 'created' as any), eq(serviceRequests.bookingFeeStatus, 'paid'), lt(serviceRequests.slaAssignBy, new Date())))
            .returning({ id: serviceRequests.id, bp: serviceRequests.dispatchPartnerId });
        if (rows.length) logger.warn(`[FIELD] Escalated ${rows.length} partner job(s) past their assign-by time: ${rows.map(r => r.id).join(', ')}`);
        const { HubAlerts } = await import('./hub-alerts.service');
        for (const r of rows) await HubAlerts.send(r.bp, 'job_overdue', { title: 'A job passed its assign-by time', body: 'It now shows in UniteFix\'s queue too. Assign it now or UniteFix may send its own expert.', link: '/partner/field/jobs', refType: 'service_request', refId: r.id });
        return rows;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Money
    // ══════════════════════════════════════════════════════════════════════

    /** The partner employing this technician, if any. */
    static async employerOf(employeeId: number | null | undefined, tx: any = db): Promise<number | null> {
        if (!employeeId) return null;
        const [e] = await tx.select({ bp: employees.managedByPartnerId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
        return e?.bp ?? null;
    }

    /** A partner technician's job is complete: hold its value for the partner. Idempotent per job. */
    static async holdJobValue(tx: any, bpId: number, input: { serviceRequestId: number; employeeId: number; amountRupees: number; releaseAt: Date }) {
        const paise = Math.round(input.amountRupees * 100);
        const rows = await tx.insert(partnerJobEarnings).values({
            businessPartnerId: bpId, serviceRequestId: input.serviceRequestId, employeeId: input.employeeId, amountPaise: paise, releaseAt: input.releaseAt,
        }).onConflictDoNothing().returning();
        if (rows.length) {
            await tx.update(employees).set({ totalServicesCompleted: sql`COALESCE(${employees.totalServicesCompleted}, 0) + 1`, updatedAt: new Date() }).where(eq(employees.id, input.employeeId));
            logger.info(`[FIELD] SR ${input.serviceRequestId}: ₹${input.amountRupees} held for partner #${bpId} until ${input.releaseAt.toISOString().slice(0, 10)}`);
        }
        return rows[0] ?? null;
    }

    /** Cash job: UniteFix's share of the cash the partner's technician kept is owed by the partner. */
    static async bookCashCollected(bpId: number, input: { serviceRequestId: number; serviceId: string; amountRupees: number }) {
        const paise = Math.round(input.amountRupees * 100);
        if (paise <= 0) return null;
        return withTransaction(async (tx) => {
            const [dup] = await tx.select({ id: businessPartnerLedger.id }).from(businessPartnerLedger).where(and(
                eq(businessPartnerLedger.businessPartnerId, bpId), eq(businessPartnerLedger.entryType, 'cash_collected' as any),
                sql`${businessPartnerLedger.metadata}->>'serviceRequestId' = ${String(input.serviceRequestId)}`)).limit(1);
            if (dup) return null;
            return BusinessPartnerService.appendLedger(tx as any, {
                businessPartnerId: bpId, entryType: 'cash_collected' as any, amountPaise: paise,
                description: `UniteFix share of cash collected — job ${input.serviceId}`, metadata: { serviceRequestId: input.serviceRequestId },
            });
        });
    }

    /**
     * Release held job values whose window has passed into the partner ledger.
     * A job with an open warranty claim waits until the claim is decided.
     */
    static async releaseDue(now = new Date()) {
        const due = await db.select({ e: partnerJobEarnings, serviceId: serviceRequests.serviceId }).from(partnerJobEarnings)
            .innerJoin(serviceRequests, eq(serviceRequests.id, partnerJobEarnings.serviceRequestId))
            .where(and(eq(partnerJobEarnings.status, 'held'), lte(partnerJobEarnings.releaseAt, now))).limit(1000);
        let released = 0;
        for (const { e, serviceId } of due) {
            const [claim] = await db.select({ id: warrantyClaims.id }).from(warrantyClaims)
                .where(and(eq(warrantyClaims.serviceRequestId, e.serviceRequestId), inArray(warrantyClaims.status, ['open', 'inspecting'] as any))).limit(1).catch(() => [] as any[]);
            if (claim) continue;
            await withTransaction(async (tx) => {
                const [locked] = await tx.select().from(partnerJobEarnings).where(and(eq(partnerJobEarnings.id, e.id), eq(partnerJobEarnings.status, 'held'))).for('update');
                if (!locked) return;
                const entry = await BusinessPartnerService.appendLedger(tx as any, {
                    businessPartnerId: e.businessPartnerId, entryType: 'service_value' as any, amountPaise: -e.amountPaise,
                    description: `Job ${serviceId} — your service value`, metadata: { serviceRequestId: e.serviceRequestId, earningId: e.id },
                });
                await tx.update(partnerJobEarnings).set({ status: 'released', releasedAt: new Date(), ledgerEntryId: entry?.id ?? null }).where(eq(partnerJobEarnings.id, e.id));
                released++;
            });
        }
        if (released) logger.info(`[FIELD] Released ${released} partner job value(s) to partner ledgers`);
        return released;
    }

    static async earnings(bpId: number) {
        return db.select({ e: partnerJobEarnings, serviceId: serviceRequests.serviceId, completedAt: serviceRequests.completedAt, techName: employees.fullName })
            .from(partnerJobEarnings)
            .innerJoin(serviceRequests, eq(serviceRequests.id, partnerJobEarnings.serviceRequestId))
            .leftJoin(employees, eq(employees.id, partnerJobEarnings.employeeId))
            .where(eq(partnerJobEarnings.businessPartnerId, bpId)).orderBy(desc(partnerJobEarnings.createdAt)).limit(300);
    }

    /**
     * Subcontract model A: each month the partner invoices UniteFix for the
     * work its people did. Generated from the job values (the partner can
     * download it from the Hub). A registered partner charges GST on top,
     * which UniteFix pays (and claims as input tax) — booked as its own
     * service_value line. Unregistered partners issue a bill of supply.
     * Idempotent per partner per month.
     */
    static async issueSubcontractInvoice(bpId: number, month: Date) {
        const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
        const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
        const periodFrom = from.toISOString().slice(0, 10);
        const periodTo = new Date(to.getTime() - 86_400_000).toISOString().slice(0, 10);
        const [exists] = await db.select({ id: taxDocuments.id }).from(taxDocuments)
            .where(and(eq(taxDocuments.issuerPartnerId, bpId), eq(taxDocuments.purpose, 'subcontract'), eq(taxDocuments.periodFrom, periodFrom), ne(taxDocuments.docKind, 'credit_note'))).limit(1);
        if (exists) return null;
        const jobs = await db.select({ e: partnerJobEarnings }).from(partnerJobEarnings)
            .innerJoin(serviceRequests, eq(serviceRequests.id, partnerJobEarnings.serviceRequestId))
            .where(and(eq(partnerJobEarnings.businessPartnerId, bpId), ne(partnerJobEarnings.status, 'reversed'),
                gte(serviceRequests.completedAt, from), lt(serviceRequests.completedAt, to)));
        const total = jobs.reduce((a, j) => a + j.e.amountPaise, 0);
        if (total <= 0) return null;
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) return null;
        const registered = !!bp.gstin;
        const sac = String(await configService.get<string>('BUSINESS_CONFIG.PARTNER_SUBCONTRACT_SAC', '9987') || '9987');
        const { PartnerSalesService } = await import('./partner-sales.service');
        const prefix = await PartnerSalesService.prefixFor(bpId);
        const uf = await TaxDocumentService.unitefixParty();
        try {
            return await withTransaction(async (tx) => {
                const doc = await TaxDocumentService.create(tx as any, {
                    docKind: registered ? 'tax_invoice' : 'bill_of_supply', issuer: 'partner', issuerPartnerId: bpId,
                    seriesKey: `bp-${bpId}-inv`, prefix, letter: '', numberWidth: 4, purpose: 'subcontract',
                    supplier: TaxDocumentService.partnerParty(bp), recipient: uf as Party, periodFrom, periodTo,
                    lines: [{ description: `Field service work for UniteFix customers — ${jobs.length} job(s), ${from.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`, hsnSac: sac, quantity: 1, unit: null, ratePaise: total, taxablePaise: total, gstRate: registered ? 18 : 0 }],
                    notes: 'Generated by the UniteFix Partner Hub from completed jobs. Subcontract: UniteFix is the service provider to the customer.',
                });
                const gst = doc.cgstPaise + doc.sgstPaise + doc.igstPaise;
                if (gst > 0) {
                    await BusinessPartnerService.appendLedger(tx as any, {
                        businessPartnerId: bpId, entryType: 'service_value' as any, amountPaise: -gst,
                        description: `GST on your invoice ${doc.number} to UniteFix`, metadata: { documentId: doc.id, gstOnSubcontract: true },
                    });
                }
                return doc;
            });
        } catch (e: any) {
            if (e?.code === '23505') return null;
            throw e;
        }
    }

    static async runMonthlySubcontractInvoices(month: Date) {
        const bps = await db.selectDistinct({ id: partnerJobEarnings.businessPartnerId }).from(partnerJobEarnings);
        const out: string[] = [];
        for (const { id } of bps) {
            try { const d = await this.issueSubcontractInvoice(id, month); if (d) out.push(d.number); }
            catch (e: any) { logger.error(`[FIELD] Subcontract invoice for partner #${id} failed`, { error: e?.message }); }
        }
        return out;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Partner-first warranty
    // ══════════════════════════════════════════════════════════════════════

    /** The partner answerable for a job: its territory partner, or the employer of whoever did it. */
    static async partnerOfJob(serviceRequestId: number): Promise<number | null> {
        const [sr] = await db.select({ d: serviceRequests.dispatchPartnerId, p: serviceRequests.providerId }).from(serviceRequests).where(eq(serviceRequests.id, serviceRequestId)).limit(1);
        if (!sr) return null;
        return (await this.employerOf(sr.p)) ?? sr.d ?? null;
    }

    static async warrantyClaims(bpId: number) {
        const rows = await db.select({ c: warrantyClaims, serviceId: serviceRequests.serviceId, serviceType: serviceRequests.serviceType, address: serviceRequests.address, customerName: users.username, customerPhone: users.phone, techName: employees.fullName })
            .from(warrantyClaims)
            .innerJoin(serviceRequests, eq(serviceRequests.id, warrantyClaims.serviceRequestId))
            .leftJoin(users, eq(users.id, serviceRequests.userId))
            .leftJoin(employees, eq(employees.id, warrantyClaims.partnerTechnicianId))
            .where(eq(warrantyClaims.partnerId, bpId)).orderBy(desc(warrantyClaims.createdAt)).limit(200);
        const now = Date.now();
        return rows.map(r => ({
            id: r.c.id, claimId: r.c.claimId, status: r.c.status, description: r.c.description, createdAt: r.c.createdAt,
            serviceId: r.serviceId, serviceType: r.serviceType, address: r.address, customerName: r.customerName, customerPhone: r.customerPhone,
            respondBy: r.c.partnerRespondBy, takenAt: r.c.partnerTakenAt, technician: r.techName, note: r.c.partnerNote,
            missed: !r.c.partnerTakenAt && r.c.status === 'open' && !!r.c.partnerRespondBy && new Date(r.c.partnerRespondBy).getTime() < now,
            verdict: r.c.verdict, chargedRupees: r.c.partnerChargePaise != null ? r.c.partnerChargePaise / 100 : null,
        }));
    }

    /** The partner takes the claim and sends one of its technicians to inspect and fix it. */
    static async takeWarranty(ctx: HubContext, claimId: number, input: { employeeId: number; note?: string | null }) {
        const [c] = await db.select().from(warrantyClaims).where(and(eq(warrantyClaims.id, claimId), eq(warrantyClaims.partnerId, ctx.businessPartnerId))).limit(1);
        if (!c) throw new HubError('Claim not found', 'NOT_FOUND', 404);
        if (c.status !== 'open' || c.partnerTakenAt) throw new HubError('This claim is already being handled.', 'BAD_STATE', 409);
        if (c.partnerRespondBy && new Date(c.partnerRespondBy).getTime() < Date.now()) throw new HubError('The 48-hour window has passed; UniteFix is handling this claim.', 'MISSED', 409);
        const e = await this.technician(ctx.businessPartnerId, input.employeeId);
        if (e.documentVerificationStatus !== 'verified' || !e.isActive) throw new HubError(`${e.fullName ?? 'This technician'} is not verified and active.`, 'NOT_READY', 409);
        const [u] = await db.update(warrantyClaims).set({ status: 'inspecting' as any, partnerTakenAt: new Date(), partnerTechnicianId: e.id, partnerNote: input.note?.trim() || null })
            .where(and(eq(warrantyClaims.id, c.id), eq(warrantyClaims.status, 'open' as any))).returning();
        if (!u) throw new HubError('This claim changed meanwhile. Refresh.', 'STALE', 409);
        return u;
    }

    /**
     * Staff settled a claim on a partner's job. If the fault was the partner's
     * (cost bearer 'technician': workmanship, or a part bought without proof)
     * the cost of the fix is charged to the partner, once.
     */
    static async chargeWarranty(claimId: number, amountPaise: number, adminId: number) {
        const [c] = await db.select().from(warrantyClaims).where(eq(warrantyClaims.id, claimId)).limit(1);
        if (!c?.partnerId) throw new HubError('This claim is not on a partner job.', 'NOT_PARTNER', 409);
        if (c.costBearer !== 'technician') throw new HubError('Only a fault that was the partner\'s (workmanship or an undocumented part) is charged to them.', 'NOT_THEIRS', 409);
        if (c.partnerChargePaise != null) throw new HubError('Already charged.', 'CHARGED', 409);
        if (!(amountPaise > 0)) throw new HubError('Enter the cost of the fix.', 'BAD_AMOUNT');
        return withTransaction(async (tx) => {
            const [u] = await tx.update(warrantyClaims).set({ partnerChargePaise: amountPaise }).where(and(eq(warrantyClaims.id, c.id), isNull(warrantyClaims.partnerChargePaise))).returning();
            if (!u) throw new HubError('Already charged.', 'CHARGED', 409);
            await BusinessPartnerService.appendLedger(tx as any, {
                businessPartnerId: c.partnerId!, entryType: 'warranty_draw' as any, amountPaise,
                description: `Warranty claim ${c.claimId} — ${String(c.verdict ?? '').replace(/_/g, ' ')}`, metadata: { warrantyClaimId: c.id }, createdByAdminId: adminId,
            });
            return u;
        });
    }

    /** Booking view for the technician app and the customer: who the provider is. */
    static async servicedBy(sr: Pick<ServiceRequest, 'dispatchPartnerId'>) {
        if (!sr.dispatchPartnerId) return null;
        const bp = await BusinessPartnerService.byId(sr.dispatchPartnerId);
        return bp ? { name: bp.displayName, phone: bp.fieldSupportPhone ?? bp.contactPhone } : null;
    }

    static territoryLabel(t: PartnerTerritory) { return `${t.pincode} (${t.mode}, ${t.status})`; }
}
