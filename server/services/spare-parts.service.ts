/**
 * Spare parts — the catalogue, technician proposals, and stock.
 *
 * THREE THINGS CALLED "INVENTORY" EXISTED BEFORE THIS. inventory_items had the
 * right shape and was never written to by a real job; products/product_variants
 * is a halted laptop store; service_part_items records what was actually fitted
 * but its 'platform' source was a word the technician chose. This is the one
 * purpose-built model, and it hangs off service_categories because that is the
 * axis services, trades and assignment already pivot on. A capacitor fits AC
 * and fan, so it is a join, not a column.
 *
 * THREE PRICES, THREE AUDIENCES
 *   unitPricePaise   — billed to the CUSTOMER when fitted on a job
 *   tradePricePaise  — billed to a BUSINESS PARTNER on a B2B order
 *   costPricePaise   — what UniteFix paid; never leaves the admin panel
 *
 * PRICE AUTHORITY. For a 'platform' line the catalogue says how much. The
 * technician's figure is ignored, the same way the client names WHICH FTTH
 * add-on and the server says how much. enrichPlatformItems() is where that
 * happens, and both bill paths call it before pricing anything.
 *
 * STOCK IS A LEDGER. spare_part_stock.quantity is a cache of
 * spare_part_movements and is rebuildable from it. Every change is a movement
 * row that says what caused it. Completion never fails on stock: oversold is
 * written down and flagged, and the customer's payment goes through. Money
 * before bookkeeping — the rule parts recording already follows.
 */

import { db } from '../db';
import { and, eq, desc, asc, ilike, inArray, isNull, or, sql, gt } from 'drizzle-orm';
import {
    spareParts, sparePartCategories, sparePartStock, sparePartMovements, sparePartProposals,
    servicePartItems, serviceCategories, employees, serviceRequests,
    type SparePart, type SparePartProposal,
} from '@shared/schema';
import { withTransaction } from '../lib/transaction';
import { configService } from './config.service';
import logger from '../lib/logger';
import type { PartItemInput } from './warranty.service';

export type StockLocation = 'warehouse' | 'technician';
export type MovementType =
    | 'purchase_in' | 'transfer_to_technician' | 'return_to_warehouse'
    | 'consumed' | 'sold_to_partner' | 'partner_return' | 'adjustment' | 'write_off';

/** Thrown for a caller's mistake; routes map it to 400. */
export class SparePartsError extends Error {
    constructor(message: string, public readonly code: string) { super(message); this.name = 'SparePartsError'; }
}

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export class SparePartsService {

    // ──────────────────────────────────────────────────────────────────────
    // Catalogue
    // ──────────────────────────────────────────────────────────────────────

    /** "AC-CAP-2-5UF" from a category and a name; suffixed if taken. */
    static async nextPartCode(name: string, categoryName?: string | null, tx: typeof db = db): Promise<string> {
        const base = [categoryName ? slug(categoryName).slice(0, 6) : null, slug(name)].filter(Boolean).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        let code = base;
        for (let i = 2; i < 100; i++) {
            const [hit] = await tx.select({ id: spareParts.id }).from(spareParts).where(eq(spareParts.partCode, code)).limit(1);
            if (!hit) return code;
            code = `${base}-${i}`;
        }
        return `${base}-${Date.now().toString(36).toUpperCase()}`;
    }

    static async byId(id: number) {
        const [row] = await db.select().from(spareParts).where(eq(spareParts.id, id)).limit(1);
        return row ?? null;
    }

    static async categoriesOf(sparePartId: number): Promise<Array<{ id: number; name: string }>> {
        return db.select({ id: serviceCategories.id, name: serviceCategories.name })
            .from(sparePartCategories)
            .innerJoin(serviceCategories, eq(serviceCategories.id, sparePartCategories.categoryId))
            .where(eq(sparePartCategories.sparePartId, sparePartId));
    }

    static async setCategories(sparePartId: number, categoryIds: number[], tx: typeof db = db) {
        const ids = Array.from(new Set(categoryIds.filter(n => Number.isInteger(n) && n > 0)));
        if (ids.length) {
            const found = await tx.select({ id: serviceCategories.id }).from(serviceCategories).where(inArray(serviceCategories.id, ids));
            const missing = ids.filter(i => !found.some(f => f.id === i));
            if (missing.length) throw new SparePartsError(`Unknown category id(s): ${missing.join(', ')}`, 'UNKNOWN_CATEGORY');
        }
        await tx.delete(sparePartCategories).where(eq(sparePartCategories.sparePartId, sparePartId));
        if (ids.length) await tx.insert(sparePartCategories).values(ids.map(categoryId => ({ sparePartId, categoryId })));
    }

    static async create(input: {
        name: string; brand?: string | null; specification?: string | null; unit?: string;
        unitPricePaise: number; tradePricePaise?: number | null; costPricePaise?: number | null;
        warrantyDays?: number; gstPercent?: number | null; photoUrl?: string | null;
        categoryIds?: number[]; createdByAdminId: number; createdFromProposalId?: number | null;
        partCode?: string | null;
    }) {
        if (!(input.unitPricePaise >= 0)) throw new SparePartsError('Customer price must be zero or more', 'BAD_PRICE');
        return withTransaction(async (tx) => {
            let catName: string | null = null;
            if (input.categoryIds?.[0]) {
                const [c] = await tx.select({ name: serviceCategories.name }).from(serviceCategories)
                    .where(eq(serviceCategories.id, input.categoryIds[0])).limit(1);
                catName = c?.name ?? null;
            }
            const partCode = input.partCode?.trim().toUpperCase() || await this.nextPartCode(input.name, catName, tx as any);
            const [row] = await tx.insert(spareParts).values({
                partCode,
                name: input.name.trim(),
                brand: input.brand?.trim() || null,
                specification: input.specification?.trim() || null,
                unit: input.unit?.trim() || 'piece',
                unitPricePaise: Math.round(input.unitPricePaise),
                tradePricePaise: input.tradePricePaise != null ? Math.round(input.tradePricePaise) : null,
                costPricePaise: input.costPricePaise != null ? Math.round(input.costPricePaise) : null,
                warrantyDays: Math.max(0, Math.min(1825, input.warrantyDays ?? 0)),
                gstPercent: input.gstPercent != null ? String(input.gstPercent) : null,
                photoUrl: input.photoUrl ?? null,
                status: 'active',
                createdFromProposalId: input.createdFromProposalId ?? null,
                createdByAdminId: input.createdByAdminId,
            }).returning();
            if (input.categoryIds?.length) await this.setCategories(row.id, input.categoryIds, tx as any);
            logger.info(`[PARTS] Catalogue: created ${row.partCode} "${row.name}" by admin #${input.createdByAdminId}`);
            return row;
        });
    }

    /**
     * Search, category first. The job's category is what the technician is
     * standing in front of; everything else is a fallback, and the response
     * says which bucket each result came from so the UI can group them.
     */
    static async search(opts: {
        q?: string; categoryId?: number | null; includeInactive?: boolean; limit?: number;
        forEmployeeId?: number | null;   // adds "in your kit" counts
    }) {
        const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
        const where = [] as any[];
        if (!opts.includeInactive) where.push(eq(spareParts.isActive, true), eq(spareParts.status, 'active'));
        if (opts.q?.trim()) {
            const term = `%${opts.q.trim()}%`;
            where.push(or(
                ilike(spareParts.name, term), ilike(spareParts.partCode, term),
                ilike(spareParts.brand, term), ilike(spareParts.specification, term),
            ));
        }
        const rows = await db.select().from(spareParts).where(where.length ? and(...where) : undefined)
            .orderBy(asc(spareParts.name)).limit(limit * 2);

        const ids = rows.map(r => r.id);
        if (!ids.length) return [];

        const cats = await db.select().from(sparePartCategories).where(inArray(sparePartCategories.sparePartId, ids));
        const inCategory = new Set(
            opts.categoryId ? cats.filter(c => c.categoryId === opts.categoryId).map(c => c.sparePartId) : [],
        );

        const stock = await db.select().from(sparePartStock).where(inArray(sparePartStock.sparePartId, ids));
        const warehouse = new Map<number, number>();
        const kit = new Map<number, number>();
        for (const s of stock) {
            if (s.location === 'warehouse') warehouse.set(s.sparePartId, s.quantity);
            else if (opts.forEmployeeId && s.holderEmployeeId === opts.forEmployeeId) kit.set(s.sparePartId, s.quantity);
        }

        return rows
            .map(r => ({
                ...r,
                inJobCategory: inCategory.has(r.id),
                categoryIds: cats.filter(c => c.sparePartId === r.id).map(c => c.categoryId),
                warehouseQty: warehouse.get(r.id) ?? 0,
                kitQty: kit.get(r.id) ?? 0,
            }))
            // Job-category matches first, then everything else, alphabetical within.
            .sort((a, b) => Number(b.inJobCategory) - Number(a.inJobCategory) || a.name.localeCompare(b.name))
            .slice(0, limit);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Price authority + access gate for job lines
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Rewrite the technician's part lines against the catalogue BEFORE pricing.
     *
     * For every line that references a catalogue part: name, brand, price and
     * warranty come from the catalogue, the line is marked 'platform', and the
     * technician's figures are discarded. A referenced part that does not
     * exist or is retired is downgraded to a local purchase with a reason.
     *
     * Access: only a parts-enabled technician may fit from stock. While the
     * strict gate is off (the default until the app's parts picker ships) a
     * platform line from anyone else is downgraded with a reason rather than
     * refused — refusing would block real bills from an app that cannot yet
     * show the technician why. BUSINESS_CONFIG.PARTS_STRICT_GATE flips it.
     */
    static async enrichPlatformItems(rawItems: PartItemInput[], employeeId: number | null): Promise<{
        items: PartItemInput[]; warnings: string[];
    }> {
        const warnings: string[] = [];
        const wantsPlatform = rawItems.filter(r => r.sourceType === 'platform' || r.sparePartId);
        if (!wantsPlatform.length) return { items: rawItems, warnings };

        let access: string = 'none';
        if (employeeId) {
            const [e] = await db.select({ a: employees.partsAccess }).from(employees).where(eq(employees.id, employeeId)).limit(1);
            access = e?.a ?? 'none';
        }
        const strict = String(await configService.get('BUSINESS_CONFIG.PARTS_STRICT_GATE', 'false')) === 'true';

        if (access !== 'active') {
            const msg = 'Fitting parts from UniteFix stock needs spare-parts access. Enable it from your profile — a refundable deposit applies.';
            if (strict) throw new SparePartsError(msg, 'PARTS_ACCESS_REQUIRED');
            warnings.push(msg + ' These lines were recorded as local purchases.');
            return {
                items: rawItems.map(r => (r.sourceType === 'platform' || r.sparePartId)
                    ? { ...r, sourceType: 'technician_local', sparePartId: null } : r),
                warnings,
            };
        }

        const ids = Array.from(new Set(wantsPlatform.map(r => r.sparePartId).filter((x): x is number => Number.isInteger(x) && (x as number) > 0)));
        const parts = ids.length ? await db.select().from(spareParts).where(inArray(spareParts.id, ids)) : [];
        const byId = new Map(parts.map(p => [p.id, p]));

        const items = rawItems.map(r => {
            if (!(r.sourceType === 'platform' || r.sparePartId)) return r;
            const part = r.sparePartId ? byId.get(r.sparePartId) : undefined;
            if (!part || !part.isActive || part.status !== 'active') {
                warnings.push(`"${r.partName ?? 'A part'}" is not in the UniteFix catalogue; recorded as a local purchase.`);
                return { ...r, sourceType: 'technician_local', sparePartId: null };
            }
            return {
                ...r,
                sourceType: 'platform',
                sparePartId: part.id,
                partName: part.name,
                brand: part.brand,
                unitPricePaise: part.unitPricePaise,          // the catalogue says how much
                unitPriceRupees: undefined,
                gstPercent: part.gstPercent != null ? Number(part.gstPercent) : null,
                warrantyDays: part.warrantyDays,
                vendorName: null,
                billPhotoUrl: null,
            };
        });
        return { items, warnings };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Proposals
    // ──────────────────────────────────────────────────────────────────────

    static async propose(input: {
        employeeId: number; serviceRequestId?: number | null; name: string; brand?: string | null;
        specification?: string | null; categoryId?: number | null; unit?: string;
        indicativePricePaise?: number | null; vendorName?: string | null; photoUrl?: string | null;
    }): Promise<SparePartProposal> {
        const [e] = await db.select({ a: employees.partsAccess }).from(employees).where(eq(employees.id, input.employeeId)).limit(1);
        if (e?.a !== 'active') {
            throw new SparePartsError('Proposing parts for the catalogue needs spare-parts access.', 'PARTS_ACCESS_REQUIRED');
        }
        const [row] = await db.insert(sparePartProposals).values({
            proposedByEmployeeId: input.employeeId,
            serviceRequestId: input.serviceRequestId ?? null,
            name: input.name.trim().slice(0, 120),
            brand: input.brand?.trim().slice(0, 80) || null,
            specification: input.specification?.trim().slice(0, 200) || null,
            categoryId: input.categoryId ?? null,
            unit: input.unit?.trim() || 'piece',
            indicativePricePaise: input.indicativePricePaise != null ? Math.max(0, Math.round(input.indicativePricePaise)) : null,
            vendorName: input.vendorName?.trim().slice(0, 120) || null,
            photoUrl: input.photoUrl ?? null,
        }).returning();
        logger.info(`[PARTS] Proposal #${row.id} "${row.name}" by employee #${input.employeeId}`);
        return row;
    }

    /**
     * Approve: create the catalogue row and re-point every fitted line that
     * carries this proposal. The technician's original lines were recorded as
     * local purchases so the job was never blocked; now they become what they
     * always were meant to be, without changing their price — that was agreed
     * with the customer at the time.
     */
    static async approveProposal(proposalId: number, adminId: number, overrides: {
        name?: string; brand?: string | null; specification?: string | null; unit?: string;
        unitPricePaise: number; tradePricePaise?: number | null; costPricePaise?: number | null;
        warrantyDays?: number; categoryIds?: number[]; notes?: string | null;
    }) {
        return withTransaction(async (tx) => {
            const [p] = await tx.select().from(sparePartProposals).where(eq(sparePartProposals.id, proposalId)).limit(1);
            if (!p) return null;
            if (p.status !== 'pending') throw new SparePartsError(`Proposal is already ${p.status}.`, 'PROPOSAL_NOT_PENDING');

            const created = await this.create({
                name: overrides.name ?? p.name,
                brand: overrides.brand !== undefined ? overrides.brand : p.brand,
                specification: overrides.specification !== undefined ? overrides.specification : p.specification,
                unit: overrides.unit ?? p.unit,
                unitPricePaise: overrides.unitPricePaise,
                tradePricePaise: overrides.tradePricePaise ?? null,
                costPricePaise: overrides.costPricePaise ?? null,
                warrantyDays: overrides.warrantyDays ?? 0,
                categoryIds: overrides.categoryIds ?? (p.categoryId ? [p.categoryId] : []),
                createdByAdminId: adminId,
                createdFromProposalId: p.id,
                photoUrl: p.photoUrl,
            });

            await tx.update(sparePartProposals).set({
                status: 'approved', resolvedSparePartId: created.id,
                reviewedByAdminId: adminId, reviewedAt: new Date(), reviewNotes: overrides.notes ?? null,
            }).where(eq(sparePartProposals.id, proposalId));

            const repointed = await tx.update(servicePartItems)
                .set({ sparePartId: created.id })
                .where(eq(servicePartItems.proposalId, proposalId)).returning({ id: servicePartItems.id });

            logger.info(`[PARTS] Proposal #${proposalId} approved → ${created.partCode}; ${repointed.length} fitted line(s) re-pointed`);
            return { part: created, repointed: repointed.length };
        });
    }

    /** The part already exists under another name. Point the proposal and its lines at it. */
    static async mergeProposal(proposalId: number, intoSparePartId: number, adminId: number, notes?: string | null) {
        return withTransaction(async (tx) => {
            const [p] = await tx.select().from(sparePartProposals).where(eq(sparePartProposals.id, proposalId)).limit(1);
            if (!p) return null;
            if (p.status !== 'pending') throw new SparePartsError(`Proposal is already ${p.status}.`, 'PROPOSAL_NOT_PENDING');
            const [target] = await tx.select().from(spareParts).where(eq(spareParts.id, intoSparePartId)).limit(1);
            if (!target) throw new SparePartsError('That catalogue part does not exist.', 'UNKNOWN_PART');

            await tx.update(sparePartProposals).set({
                status: 'merged', resolvedSparePartId: target.id,
                reviewedByAdminId: adminId, reviewedAt: new Date(), reviewNotes: notes ?? null,
            }).where(eq(sparePartProposals.id, proposalId));
            const repointed = await tx.update(servicePartItems).set({ sparePartId: target.id })
                .where(eq(servicePartItems.proposalId, proposalId)).returning({ id: servicePartItems.id });
            logger.info(`[PARTS] Proposal #${proposalId} merged into ${target.partCode}; ${repointed.length} line(s) re-pointed`);
            return { part: target, repointed: repointed.length };
        });
    }

    static async rejectProposal(proposalId: number, adminId: number, reason: string) {
        const [row] = await db.update(sparePartProposals).set({
            status: 'rejected', reviewedByAdminId: adminId, reviewedAt: new Date(), reviewNotes: reason,
        }).where(and(eq(sparePartProposals.id, proposalId), eq(sparePartProposals.status, 'pending'))).returning();
        return row ?? null;
    }

    static async listProposals(opts: { status?: string; employeeId?: number; limit?: number }) {
        const where = [] as any[];
        if (opts.status && opts.status !== 'all') where.push(eq(sparePartProposals.status, opts.status as any));
        if (opts.employeeId) where.push(eq(sparePartProposals.proposedByEmployeeId, opts.employeeId));
        return db.select({
            proposal: sparePartProposals,
            proposerName: employees.fullName,
            categoryName: serviceCategories.name,
            jobRef: serviceRequests.serviceId,
        })
            .from(sparePartProposals)
            .leftJoin(employees, eq(employees.id, sparePartProposals.proposedByEmployeeId))
            .leftJoin(serviceCategories, eq(serviceCategories.id, sparePartProposals.categoryId))
            .leftJoin(serviceRequests, eq(serviceRequests.id, sparePartProposals.serviceRequestId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(sparePartProposals.createdAt))
            .limit(Math.min(500, opts.limit ?? 200));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Stock — a ledger and a cache of it
    // ──────────────────────────────────────────────────────────────────────

    private static async stockRow(tx: typeof db, sparePartId: number, location: StockLocation, holderEmployeeId: number | null) {
        const where = [eq(sparePartStock.sparePartId, sparePartId), eq(sparePartStock.location, location)];
        where.push(location === 'warehouse' ? isNull(sparePartStock.holderEmployeeId) : eq(sparePartStock.holderEmployeeId, holderEmployeeId!));
        const [row] = await tx.select().from(sparePartStock).where(and(...where)).limit(1);
        if (row) return row;
        const [created] = await tx.insert(sparePartStock).values({
            sparePartId, location, holderEmployeeId: location === 'warehouse' ? null : holderEmployeeId, quantity: 0,
        }).returning();
        return created;
    }

    /**
     * One movement against one stock row. The single writer. `allowNegative`
     * is for consumption only — a job must complete even if the count is
     * wrong, so the row is floored at zero and the movement notes 'oversold'.
     */
    /** The single writer for stock. Public so B2B dispatch can use it; nothing else should. */
    static async move(tx: typeof db, input: {
        sparePartId: number; movementType: MovementType; delta: number;
        location: StockLocation; holderEmployeeId?: number | null;
        fromLocation?: StockLocation | null; toLocation?: StockLocation | null;
        fromHolder?: number | null; toHolder?: number | null;
        serviceRequestId?: number | null; servicePartItemId?: number | null; b2bOrderItemId?: number | null;
        unitCostPaise?: number | null; performedByEmployeeId?: number | null; performedByAdminId?: number | null;
        notes?: string | null; allowNegative?: boolean;
    }) {
        const row = await this.stockRow(tx, input.sparePartId, input.location, input.holderEmployeeId ?? null);
        const before = row.quantity;
        let after = before + input.delta;
        let notes = input.notes ?? null;
        if (after < 0) {
            if (!input.allowNegative) {
                throw new SparePartsError(`Only ${before} in stock at ${input.location}; cannot move ${-input.delta}.`, 'INSUFFICIENT_STOCK');
            }
            notes = [notes, `oversold by ${-after}`].filter(Boolean).join('; ');
            after = 0;
        }
        const [movement] = await tx.insert(sparePartMovements).values({
            movementId: `SPM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            sparePartId: input.sparePartId,
            movementType: input.movementType,
            quantity: input.delta,
            fromLocation: input.fromLocation ?? null, toLocation: input.toLocation ?? null,
            fromHolderEmployeeId: input.fromHolder ?? null, toHolderEmployeeId: input.toHolder ?? null,
            serviceRequestId: input.serviceRequestId ?? null,
            servicePartItemId: input.servicePartItemId ?? null,
            b2bOrderItemId: input.b2bOrderItemId ?? null,
            unitCostPaise: input.unitCostPaise ?? null,
            performedByEmployeeId: input.performedByEmployeeId ?? null,
            performedByAdminId: input.performedByAdminId ?? null,
            stockBefore: before, stockAfter: after, notes,
        }).onConflictDoNothing().returning();
        if (!movement) return null;   // idempotent repeat (same fitted line / order line)
        await tx.update(sparePartStock).set({ quantity: after, updatedAt: new Date() }).where(eq(sparePartStock.id, row.id));
        return movement;
    }

    static async receivePurchase(input: { sparePartId: number; quantity: number; unitCostPaise?: number | null; adminId: number; notes?: string | null }) {
        if (!(input.quantity > 0)) throw new SparePartsError('Quantity must be positive', 'BAD_QTY');
        return withTransaction(async (tx) => this.move(tx as any, {
            sparePartId: input.sparePartId, movementType: 'purchase_in', delta: input.quantity,
            location: 'warehouse', toLocation: 'warehouse', unitCostPaise: input.unitCostPaise ?? null,
            performedByAdminId: input.adminId, notes: input.notes ?? null,
        }));
    }

    /** Monday morning: the technician takes five capacitors from the office. */
    static async issueToTechnician(input: { sparePartId: number; quantity: number; employeeId: number; adminId: number; notes?: string | null }) {
        if (!(input.quantity > 0)) throw new SparePartsError('Quantity must be positive', 'BAD_QTY');
        return withTransaction(async (tx) => {
            const out = await this.move(tx as any, {
                sparePartId: input.sparePartId, movementType: 'transfer_to_technician', delta: -input.quantity,
                location: 'warehouse', fromLocation: 'warehouse', toLocation: 'technician', toHolder: input.employeeId,
                performedByAdminId: input.adminId, notes: input.notes ?? null,
            });
            const into = await this.move(tx as any, {
                sparePartId: input.sparePartId, movementType: 'transfer_to_technician', delta: input.quantity,
                location: 'technician', holderEmployeeId: input.employeeId, fromLocation: 'warehouse', toLocation: 'technician',
                toHolder: input.employeeId, performedByAdminId: input.adminId, notes: input.notes ?? null,
            });
            return { out, into };
        });
    }

    static async returnToWarehouse(input: { sparePartId: number; quantity: number; employeeId: number; adminId?: number | null; notes?: string | null }) {
        if (!(input.quantity > 0)) throw new SparePartsError('Quantity must be positive', 'BAD_QTY');
        return withTransaction(async (tx) => {
            const out = await this.move(tx as any, {
                sparePartId: input.sparePartId, movementType: 'return_to_warehouse', delta: -input.quantity,
                location: 'technician', holderEmployeeId: input.employeeId, fromLocation: 'technician', toLocation: 'warehouse',
                fromHolder: input.employeeId, performedByAdminId: input.adminId ?? null, performedByEmployeeId: input.employeeId, notes: input.notes ?? null,
            });
            const into = await this.move(tx as any, {
                sparePartId: input.sparePartId, movementType: 'return_to_warehouse', delta: input.quantity,
                location: 'warehouse', fromLocation: 'technician', toLocation: 'warehouse', fromHolder: input.employeeId,
                performedByAdminId: input.adminId ?? null, notes: input.notes ?? null,
            });
            return { out, into };
        });
    }

    /** A count found the shelf disagrees with the ledger. Write the difference down. */
    static async adjust(input: { sparePartId: number; location: StockLocation; holderEmployeeId?: number | null; actualQuantity: number; adminId: number; notes?: string | null }) {
        if (!(input.actualQuantity >= 0)) throw new SparePartsError('Counted quantity cannot be negative', 'BAD_QTY');
        return withTransaction(async (tx) => {
            const row = await this.stockRow(tx as any, input.sparePartId, input.location, input.holderEmployeeId ?? null);
            const delta = input.actualQuantity - row.quantity;
            if (delta === 0) return { movement: null, shortage: 0 };
            const movement = await this.move(tx as any, {
                sparePartId: input.sparePartId, movementType: 'adjustment', delta,
                location: input.location, holderEmployeeId: input.holderEmployeeId ?? null,
                toLocation: input.location, toHolder: input.location === 'technician' ? (input.holderEmployeeId ?? null) : null,
                performedByAdminId: input.adminId, notes: input.notes ?? `count: ${row.quantity} → ${input.actualQuantity}`,
            });
            // A shortage on a technician's kit is theirs to answer for.
            return { movement, shortage: delta < 0 && input.location === 'technician' ? -delta : 0 };
        });
    }

    /**
     * Consume the platform lines of a completed job. Called INSIDE the completion
     * transaction. Takes from the technician's kit if they hold any, else the
     * warehouse. Oversold is written down and flagged, never thrown — the
     * customer has paid, and a wrong count is fixed by a count, not by refusing
     * their payment. Idempotent per fitted line through the unique index.
     */
    static async consumeForJob(tx: typeof db, serviceRequestId: number, employeeId: number | null) {
        const lines = await tx.select().from(servicePartItems).where(and(
            eq(servicePartItems.serviceRequestId, serviceRequestId),
            eq(servicePartItems.sourceType, 'platform'),
            sql`${servicePartItems.sparePartId} IS NOT NULL`,
        ));
        const results: Array<{ lineId: number; from: StockLocation; oversold: boolean }> = [];
        for (const line of lines) {
            const partId = line.sparePartId!;
            let from: StockLocation = 'warehouse';
            if (employeeId) {
                const kit = await this.stockRow(tx, partId, 'technician', employeeId);
                if (kit.quantity > 0) from = 'technician';
            }
            const m = await this.move(tx, {
                sparePartId: partId, movementType: 'consumed', delta: -line.quantity,
                location: from, holderEmployeeId: from === 'technician' ? employeeId : null,
                fromLocation: from, fromHolder: from === 'technician' ? employeeId : null,
                serviceRequestId, servicePartItemId: line.id, performedByEmployeeId: employeeId,
                allowNegative: true,
            });
            if (m) {
                const oversold = /oversold/.test(m.notes ?? '');
                if (oversold) logger.warn(`[PARTS] Oversold on SR #${serviceRequestId} line #${line.id} (${line.partName}) — count needed`);
                results.push({ lineId: line.id, from, oversold });
            }
        }
        return results;
    }

    static async stockFor(sparePartId: number) {
        return db.select().from(sparePartStock).where(eq(sparePartStock.sparePartId, sparePartId));
    }

    static async kitOf(employeeId: number) {
        return db.select({ stock: sparePartStock, part: spareParts })
            .from(sparePartStock).innerJoin(spareParts, eq(spareParts.id, sparePartStock.sparePartId))
            .where(and(eq(sparePartStock.location, 'technician'), eq(sparePartStock.holderEmployeeId, employeeId), gt(sparePartStock.quantity, 0)))
            .orderBy(asc(spareParts.name));
    }

    static async movements(opts: { sparePartId?: number; employeeId?: number; limit?: number }) {
        const where = [] as any[];
        if (opts.sparePartId) where.push(eq(sparePartMovements.sparePartId, opts.sparePartId));
        if (opts.employeeId) where.push(or(
            eq(sparePartMovements.fromHolderEmployeeId, opts.employeeId), eq(sparePartMovements.toHolderEmployeeId, opts.employeeId),
            eq(sparePartMovements.performedByEmployeeId, opts.employeeId),
        ));
        return db.select({ movement: sparePartMovements, part: { partCode: spareParts.partCode, name: spareParts.name } })
            .from(sparePartMovements).innerJoin(spareParts, eq(spareParts.id, sparePartMovements.sparePartId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(sparePartMovements.createdAt)).limit(Math.min(500, opts.limit ?? 200));
    }

    /**
     * Which stock row a movement was written against. One rule per type, so the
     * ledger can always be replayed:
     *   purchase_in / sold_to_partner / partner_return  → warehouse
     *   transfer_to_technician  → the row the SIGN says: − is warehouse, + is the technician (toHolder)
     *   return_to_warehouse     → − is the technician (fromHolder), + is warehouse
     *   consumed                → fromLocation / fromHolder
     *   adjustment / write_off  → toLocation / toHolder (move() records the row adjusted there)
     */
    static affectedRow(m: { movementType: string; quantity: number; fromLocation: string | null; toLocation: string | null;
        fromHolderEmployeeId: number | null; toHolderEmployeeId: number | null }): { location: StockLocation; holder: number | null } {
        switch (m.movementType) {
            case 'transfer_to_technician':
                return m.quantity < 0 ? { location: 'warehouse', holder: null } : { location: 'technician', holder: m.toHolderEmployeeId };
            case 'return_to_warehouse':
                return m.quantity < 0 ? { location: 'technician', holder: m.fromHolderEmployeeId } : { location: 'warehouse', holder: null };
            case 'consumed':
                return m.fromLocation === 'technician'
                    ? { location: 'technician', holder: m.fromHolderEmployeeId } : { location: 'warehouse', holder: null };
            case 'adjustment':
            case 'write_off':
                return m.toLocation === 'technician'
                    ? { location: 'technician', holder: m.toHolderEmployeeId } : { location: 'warehouse', holder: null };
            default:
                return { location: 'warehouse', holder: null };
        }
    }

    /** Rebuild the cache from the ledger for one part. The proof the cache is only a cache. */
    static async rebuildStockCache(sparePartId: number) {
        return withTransaction(async (tx) => {
            const rows = await tx.select().from(sparePartMovements)
                .where(eq(sparePartMovements.sparePartId, sparePartId)).orderBy(asc(sparePartMovements.id));
            const totals = new Map<string, { location: StockLocation; holder: number | null; qty: number }>();
            for (const m of rows) {
                const { location, holder } = this.affectedRow(m);
                const k = `${location}:${holder ?? 0}`;
                const cur = totals.get(k) ?? { location, holder, qty: 0 };
                // Oversold consumption was floored at zero on the cache; replay the same floor.
                cur.qty = Math.max(0, cur.qty + m.quantity);
                totals.set(k, cur);
            }
            for (const t of Array.from(totals.values())) {
                const row = await this.stockRow(tx as any, sparePartId, t.location, t.holder);
                await tx.update(sparePartStock).set({ quantity: t.qty, updatedAt: new Date() }).where(eq(sparePartStock.id, row.id));
            }
            return Array.from(totals.values());
        });
    }
}

export type { SparePart };
