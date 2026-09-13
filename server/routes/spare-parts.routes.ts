/**
 * Spare parts — admin catalogue, proposals, stock; technician search and kit.
 *
 * Admin paths map to the `inventory` capability area (capability-map.ts).
 * Technician paths sit under /api/partner/parts — "partner" here means a
 * technician, as it does everywhere under /api/partner.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { spareParts, employees, serviceRequests, services } from '@shared/schema';
import { authenticateAdmin, authenticatePartner } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { SparePartsService, SparePartsError } from '../services/spare-parts.service';
import { recordAudit } from '../lib/audit';

const rupeesToPaise = (r: number) => Math.round(r * 100);
const paiseToRupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;

const partSchema = z.object({
    name: z.string().trim().min(2).max(120),
    brand: z.string().trim().max(80).optional().nullable(),
    specification: z.string().trim().max(200).optional().nullable(),
    unit: z.string().trim().max(20).optional(),
    unitPriceRupees: z.number().min(0).max(500_000),
    tradePriceRupees: z.number().min(0).max(500_000).optional().nullable(),
    costPriceRupees: z.number().min(0).max(500_000).optional().nullable(),
    warrantyDays: z.number().int().min(0).max(1825).optional(),
    gstPercent: z.number().min(0).max(28).optional().nullable(),
    photoUrl: z.string().trim().url().max(500).optional().nullable(),
    categoryIds: z.array(z.number().int().positive()).max(10).optional(),
    partCode: z.string().trim().max(40).optional().nullable(),
});
const partPatchSchema = partSchema.partial().extend({
    status: z.enum(['active', 'discontinued', 'pending_review']).optional(),
    isActive: z.boolean().optional(),
});
const approveSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    brand: z.string().trim().max(80).optional().nullable(),
    specification: z.string().trim().max(200).optional().nullable(),
    unit: z.string().trim().max(20).optional(),
    unitPriceRupees: z.number().min(0).max(500_000),
    tradePriceRupees: z.number().min(0).max(500_000).optional().nullable(),
    costPriceRupees: z.number().min(0).max(500_000).optional().nullable(),
    warrantyDays: z.number().int().min(0).max(1825).optional(),
    categoryIds: z.array(z.number().int().positive()).max(10).optional(),
    notes: z.string().trim().max(500).optional().nullable(),
});
const proposeSchema = z.object({
    serviceRequestId: z.number().int().positive().optional().nullable(),
    name: z.string().trim().min(2).max(120),
    brand: z.string().trim().max(80).optional().nullable(),
    specification: z.string().trim().max(200).optional().nullable(),
    categoryId: z.number().int().positive().optional().nullable(),
    unit: z.string().trim().max(20).optional(),
    indicativePriceRupees: z.number().min(0).max(500_000).optional().nullable(),
    vendorName: z.string().trim().max(120).optional().nullable(),
    photoUrl: z.string().trim().url().max(500).optional().nullable(),
});
const stockInSchema = z.object({
    sparePartId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10_000),
    unitCostRupees: z.number().min(0).max(500_000).optional().nullable(),
    notes: z.string().trim().max(300).optional().nullable(),
});
const issueSchema = z.object({
    sparePartId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(1000),
    employeeId: z.number().int().positive(),
    notes: z.string().trim().max(300).optional().nullable(),
});
const countSchema = z.object({
    sparePartId: z.number().int().positive(),
    location: z.enum(['warehouse', 'technician']),
    holderEmployeeId: z.number().int().positive().optional().nullable(),
    actualQuantity: z.number().int().min(0).max(100_000),
    notes: z.string().trim().max(300).optional().nullable(),
});

async function partView(p: typeof spareParts.$inferSelect) {
    const [categories, stock] = await Promise.all([
        SparePartsService.categoriesOf(p.id),
        SparePartsService.stockFor(p.id),
    ]);
    return {
        id: p.id,
        partCode: p.partCode,
        name: p.name,
        brand: p.brand,
        specification: p.specification,
        unit: p.unit,
        unitPrice: paiseToRupees(p.unitPricePaise),
        tradePrice: paiseToRupees(p.tradePricePaise),
        costPrice: paiseToRupees(p.costPricePaise),
        warrantyDays: p.warrantyDays,
        gstPercent: p.gstPercent != null ? Number(p.gstPercent) : null,
        photoUrl: p.photoUrl,
        status: p.status,
        isActive: p.isActive,
        categories,
        warehouseQty: stock.filter(s => s.location === 'warehouse').reduce((a, s) => a + s.quantity, 0),
        techniciansHolding: stock.filter(s => s.location === 'technician' && s.quantity > 0).length,
        createdFromProposalId: p.createdFromProposalId,
        createdAt: p.createdAt,
    };
}

/** A technician's parts access, or a 403 that says how to get it. */
async function requirePartsAccess(req: Request, res: Response, next: NextFunction) {
    const employeeId = (req as any).partner?.partnerId;
    const [e] = await db.select({ a: employees.partsAccess }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (e?.a !== 'active') {
        return res.status(403).json({
            success: false,
            code: 'PARTS_ACCESS_REQUIRED',
            partsAccess: e?.a ?? 'none',
            message: e?.a === 'requested'
                ? 'Your spare-parts access is awaiting approval.'
                : e?.a === 'suspended'
                    ? 'Your spare-parts access is suspended. Top up your deposit to restore it.'
                    : 'Fitting parts from UniteFix stock needs spare-parts access. Enable it from your profile — a refundable deposit applies.',
        });
    }
    (req as any).employeeId = employeeId;
    next();
}

const mapErr = (error: any, res: Response, next: NextFunction) => {
    if (error instanceof SparePartsError) {
        return res.status(error.code === 'UNKNOWN_PART' || error.code === 'UNKNOWN_CATEGORY' ? 404 : 400)
            .json({ success: false, code: error.code, message: error.message });
    }
    next(error);
};

export function registerSparePartsRoutes(app: Express) {

    // ═══════════════════════════════════════════════════════════════════════
    // Admin — catalogue
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/spare-parts', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await SparePartsService.search({
                q: typeof req.query.q === 'string' ? req.query.q : undefined,
                categoryId: req.query.categoryId ? Number(req.query.categoryId) : null,
                includeInactive: String(req.query.includeInactive) === 'true',
                limit: req.query.limit ? Number(req.query.limit) : 100,
            });
            res.json({
                success: true,
                data: rows.map(r => ({
                    id: r.id, partCode: r.partCode, name: r.name, brand: r.brand, specification: r.specification, unit: r.unit,
                    unitPrice: paiseToRupees(r.unitPricePaise), tradePrice: paiseToRupees(r.tradePricePaise), costPrice: paiseToRupees(r.costPricePaise),
                    warrantyDays: r.warrantyDays, status: r.status, isActive: r.isActive,
                    categoryIds: r.categoryIds, warehouseQty: r.warehouseQty,
                })),
            });
        } catch (error) { next(error); }
    });

    app.post('/api/admin/spare-parts', authenticateAdmin, validateBody(partSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const b = req.body as z.infer<typeof partSchema>;
            const part = await SparePartsService.create({
                name: b.name, brand: b.brand, specification: b.specification, unit: b.unit,
                unitPricePaise: rupeesToPaise(b.unitPriceRupees),
                tradePricePaise: b.tradePriceRupees != null ? rupeesToPaise(b.tradePriceRupees) : null,
                costPricePaise: b.costPriceRupees != null ? rupeesToPaise(b.costPriceRupees) : null,
                warrantyDays: b.warrantyDays, gstPercent: b.gstPercent ?? null, photoUrl: b.photoUrl ?? null,
                categoryIds: b.categoryIds, createdByAdminId: admin.userId, partCode: b.partCode ?? null,
            });
            await recordAudit({ entityType: 'spare_part', entityId: part.id, action: 'spare_part_created', changedBy: admin.userId, metadata: { partCode: part.partCode } });
            res.status(201).json({ success: true, data: await partView(part) });
        } catch (error) { mapErr(error, res, next); }
    });

    app.get('/api/admin/spare-parts/proposals', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await SparePartsService.listProposals({
                status: typeof req.query.status === 'string' ? req.query.status : 'pending',
            });
            res.json({
                success: true,
                data: rows.map(r => ({
                    ...r.proposal,
                    indicativePrice: paiseToRupees(r.proposal.indicativePricePaise),
                    proposerName: r.proposerName, categoryName: r.categoryName, jobRef: r.jobRef,
                })),
            });
        } catch (error) { next(error); }
    });

    app.post('/api/admin/spare-parts/proposals/:id/approve', authenticateAdmin, validateBody(approveSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const admin = (req as any).admin as { userId: number };
                const b = req.body as z.infer<typeof approveSchema>;
                const result = await SparePartsService.approveProposal(Number(req.params.id), admin.userId, {
                    name: b.name, brand: b.brand, specification: b.specification, unit: b.unit,
                    unitPricePaise: rupeesToPaise(b.unitPriceRupees),
                    tradePricePaise: b.tradePriceRupees != null ? rupeesToPaise(b.tradePriceRupees) : null,
                    costPricePaise: b.costPriceRupees != null ? rupeesToPaise(b.costPriceRupees) : null,
                    warrantyDays: b.warrantyDays, categoryIds: b.categoryIds, notes: b.notes ?? null,
                });
                if (!result) return res.status(404).json({ success: false, message: 'Proposal not found' });
                await recordAudit({ entityType: 'spare_part_proposal', entityId: Number(req.params.id), action: 'proposal_approved', changedBy: admin.userId, metadata: { partCode: result.part.partCode, repointed: result.repointed } });
                res.json({
                    success: true,
                    message: `Added ${result.part.partCode} to the catalogue${result.repointed ? ` and updated ${result.repointed} fitted line(s)` : ''}.`,
                    data: { part: await partView(result.part), repointed: result.repointed },
                });
            } catch (error) { mapErr(error, res, next); }
        });

    app.post('/api/admin/spare-parts/proposals/:id/merge', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const into = Number(req.body?.sparePartId);
            if (!Number.isInteger(into) || into <= 0) return res.status(400).json({ success: false, message: 'sparePartId is required' });
            const result = await SparePartsService.mergeProposal(Number(req.params.id), into, admin.userId, req.body?.notes ?? null);
            if (!result) return res.status(404).json({ success: false, message: 'Proposal not found' });
            await recordAudit({ entityType: 'spare_part_proposal', entityId: Number(req.params.id), action: 'proposal_merged', changedBy: admin.userId, metadata: { into: result.part.partCode, repointed: result.repointed } });
            res.json({ success: true, message: `Merged into ${result.part.partCode}.`, data: { part: await partView(result.part), repointed: result.repointed } });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/spare-parts/proposals/:id/reject', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const reason = String(req.body?.reason ?? '').trim();
            if (reason.length < 3) return res.status(400).json({ success: false, message: 'Give a reason the technician will read.' });
            const row = await SparePartsService.rejectProposal(Number(req.params.id), admin.userId, reason);
            if (!row) return res.status(404).json({ success: false, message: 'No pending proposal with that id' });
            await recordAudit({ entityType: 'spare_part_proposal', entityId: row.id, action: 'proposal_rejected', changedBy: admin.userId, metadata: { reason } });
            res.json({ success: true, data: row });
        } catch (error) { next(error); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Admin — stock
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/spare-parts/stock/movements', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await SparePartsService.movements({
                sparePartId: req.query.sparePartId ? Number(req.query.sparePartId) : undefined,
                employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : 200,
            });
            res.json({ success: true, data: rows.map(r => ({ ...r.movement, part: r.part, unitCost: paiseToRupees(r.movement.unitCostPaise) })) });
        } catch (error) { next(error); }
    });

    app.post('/api/admin/spare-parts/stock/receive', authenticateAdmin, validateBody(stockInSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const b = req.body as z.infer<typeof stockInSchema>;
            const m = await SparePartsService.receivePurchase({
                sparePartId: b.sparePartId, quantity: b.quantity, adminId: admin.userId,
                unitCostPaise: b.unitCostRupees != null ? rupeesToPaise(b.unitCostRupees) : null, notes: b.notes ?? null,
            });
            await recordAudit({ entityType: 'stock_movement', entityId: m?.id ?? 0, action: 'stock_received', changedBy: admin.userId, metadata: b });
            res.status(201).json({ success: true, data: m });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/spare-parts/stock/issue', authenticateAdmin, validateBody(issueSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const b = req.body as z.infer<typeof issueSchema>;
            const [e] = await db.select({ a: employees.partsAccess, name: employees.fullName }).from(employees).where(eq(employees.id, b.employeeId)).limit(1);
            if (!e) return res.status(404).json({ success: false, message: 'Technician not found' });
            if (e.a !== 'active') {
                return res.status(400).json({ success: false, code: 'PARTS_ACCESS_REQUIRED', message: `${e.name ?? 'This technician'} does not have spare-parts access, so stock cannot be issued to them.` });
            }
            const r = await SparePartsService.issueToTechnician({ ...b, adminId: admin.userId, notes: b.notes ?? null });
            await recordAudit({ entityType: 'stock_movement', entityId: r.out?.id ?? 0, action: 'stock_issued', changedBy: admin.userId, metadata: b });
            res.status(201).json({ success: true, data: r });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/spare-parts/stock/count', authenticateAdmin, validateBody(countSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const b = req.body as z.infer<typeof countSchema>;
            if (b.location === 'technician' && !b.holderEmployeeId) {
                return res.status(400).json({ success: false, message: 'holderEmployeeId is required when counting a technician kit' });
            }
            const r = await SparePartsService.adjust({ ...b, adminId: admin.userId, notes: b.notes ?? null });
            await recordAudit({ entityType: 'stock_movement', entityId: r.movement?.id ?? 0, action: 'stock_counted', changedBy: admin.userId, metadata: { ...b, shortage: r.shortage } });
            res.json({
                success: true,
                message: r.movement ? (r.shortage ? `Shortage of ${r.shortage} recorded on the technician's kit.` : 'Count recorded.') : 'Count matches — nothing changed.',
                data: r,
            });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/spare-parts/:id/rebuild-stock', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const totals = await SparePartsService.rebuildStockCache(Number(req.params.id));
            res.json({ success: true, data: totals });
        } catch (error) { next(error); }
    });

    app.get('/api/admin/spare-parts/:id', authenticateAdmin, async (req, res, next) => {
        try {
            const part = await SparePartsService.byId(Number(req.params.id));
            if (!part) return res.status(404).json({ success: false, message: 'Part not found' });
            const stock = await SparePartsService.stockFor(part.id);
            res.json({ success: true, data: { ...(await partView(part)), stock } });
        } catch (error) { next(error); }
    });

    app.patch('/api/admin/spare-parts/:id', authenticateAdmin, validateBody(partPatchSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const id = Number(req.params.id);
            const existing = await SparePartsService.byId(id);
            if (!existing) return res.status(404).json({ success: false, message: 'Part not found' });
            const b = req.body as z.infer<typeof partPatchSchema>;
            const [updated] = await db.update(spareParts).set({
                ...(b.name !== undefined ? { name: b.name } : {}),
                ...(b.brand !== undefined ? { brand: b.brand } : {}),
                ...(b.specification !== undefined ? { specification: b.specification } : {}),
                ...(b.unit !== undefined ? { unit: b.unit } : {}),
                ...(b.unitPriceRupees !== undefined ? { unitPricePaise: rupeesToPaise(b.unitPriceRupees) } : {}),
                ...(b.tradePriceRupees !== undefined ? { tradePricePaise: b.tradePriceRupees != null ? rupeesToPaise(b.tradePriceRupees) : null } : {}),
                ...(b.costPriceRupees !== undefined ? { costPricePaise: b.costPriceRupees != null ? rupeesToPaise(b.costPriceRupees) : null } : {}),
                ...(b.warrantyDays !== undefined ? { warrantyDays: b.warrantyDays } : {}),
                ...(b.gstPercent !== undefined ? { gstPercent: b.gstPercent != null ? String(b.gstPercent) : null } : {}),
                ...(b.photoUrl !== undefined ? { photoUrl: b.photoUrl } : {}),
                ...(b.status !== undefined ? { status: b.status } : {}),
                ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
                updatedAt: new Date(),
            }).where(eq(spareParts.id, id)).returning();
            if (b.categoryIds) await SparePartsService.setCategories(id, b.categoryIds);
            await recordAudit({ entityType: 'spare_part', entityId: id, action: 'spare_part_updated', changedBy: admin.userId, metadata: { fields: Object.keys(b) } });
            res.json({ success: true, data: await partView(updated) });
        } catch (error) { mapErr(error, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Technician — /api/partner/parts   ("partner" = technician here)
    // ═══════════════════════════════════════════════════════════════════════

    /** Search, the job's category first. Optional ?serviceRequestId= supplies the category. */
    app.get('/api/partner/parts/search', authenticatePartner, requirePartsAccess, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).employeeId as number;
            let categoryId: number | null = req.query.categoryId ? Number(req.query.categoryId) : null;
            if (!categoryId && req.query.serviceRequestId) {
                // The booking stores the service by NAME; the category hangs off the
                // catalogue row of that name. One join, so the technician standing in
                // front of an AC sees AC parts first without the app knowing the id.
                const [hit] = await db.select({ categoryId: services.categoryId })
                    .from(serviceRequests)
                    .innerJoin(services, eq(services.name, serviceRequests.serviceType))
                    .where(eq(serviceRequests.id, Number(req.query.serviceRequestId)))
                    .limit(1);
                categoryId = hit?.categoryId ?? null;
            }
            const rows = await SparePartsService.search({
                q: typeof req.query.q === 'string' ? req.query.q : undefined,
                categoryId, forEmployeeId: employeeId, limit: 40,
            });
            res.json({
                success: true,
                data: rows.map(r => ({
                    id: r.id, partCode: r.partCode, name: r.name, brand: r.brand, specification: r.specification, unit: r.unit,
                    // Only the customer price. Trade and cost are not the technician's business.
                    unitPrice: paiseToRupees(r.unitPricePaise), warrantyDays: r.warrantyDays,
                    inJobCategory: r.inJobCategory, kitQty: r.kitQty, warehouseQty: r.warehouseQty,
                    availability: r.kitQty > 0 ? 'in_your_kit' : r.warehouseQty > 0 ? 'warehouse' : 'out_of_stock',
                })),
            });
        } catch (error) { next(error); }
    });

    app.post('/api/partner/parts/proposals', authenticatePartner, requirePartsAccess, validateBody(proposeSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const employeeId = (req as any).employeeId as number;
                const b = req.body as z.infer<typeof proposeSchema>;
                const row = await SparePartsService.propose({
                    employeeId, serviceRequestId: b.serviceRequestId ?? null, name: b.name, brand: b.brand, specification: b.specification,
                    categoryId: b.categoryId ?? null, unit: b.unit,
                    indicativePricePaise: b.indicativePriceRupees != null ? rupeesToPaise(b.indicativePriceRupees) : null,
                    vendorName: b.vendorName, photoUrl: b.photoUrl ?? null,
                });
                res.status(201).json({
                    success: true,
                    message: 'Sent for review. Add it to this job as a local purchase for now — once approved it will be in the catalogue for everyone.',
                    data: { ...row, indicativePrice: paiseToRupees(row.indicativePricePaise) },
                });
            } catch (error) { mapErr(error, res, next); }
        });

    app.get('/api/partner/parts/proposals', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).partner?.partnerId as number;
            const rows = await SparePartsService.listProposals({ employeeId, status: 'all', limit: 100 });
            res.json({ success: true, data: rows.map(r => ({ ...r.proposal, indicativePrice: paiseToRupees(r.proposal.indicativePricePaise), categoryName: r.categoryName })) });
        } catch (error) { next(error); }
    });

    app.get('/api/partner/parts/stock', authenticatePartner, requirePartsAccess, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).employeeId as number;
            const kit = await SparePartsService.kitOf(employeeId);
            const movements = await SparePartsService.movements({ employeeId, limit: 50 });
            res.json({
                success: true,
                data: {
                    items: kit.map(k => ({ sparePartId: k.part.id, partCode: k.part.partCode, name: k.part.name, brand: k.part.brand, quantity: k.stock.quantity, unitPrice: paiseToRupees(k.part.unitPricePaise) })),
                    movements: movements.map(m => ({ id: m.movement.id, type: m.movement.movementType, quantity: m.movement.quantity, part: m.part, notes: m.movement.notes, at: m.movement.createdAt })),
                },
            });
        } catch (error) { next(error); }
    });

    app.post('/api/partner/parts/stock/return', authenticatePartner, requirePartsAccess, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).employeeId as number;
            const sparePartId = Number(req.body?.sparePartId); const quantity = Number(req.body?.quantity);
            if (!Number.isInteger(sparePartId) || !Number.isInteger(quantity) || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'sparePartId and a positive quantity are required' });
            }
            const r = await SparePartsService.returnToWarehouse({ sparePartId, quantity, employeeId, notes: req.body?.notes ?? 'Returned by technician' });
            res.json({ success: true, message: 'Returned to the warehouse.', data: r });
        } catch (error) { mapErr(error, res, next); }
    });
}
