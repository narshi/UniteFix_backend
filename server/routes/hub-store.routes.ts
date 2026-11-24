/**
 * Partner Hub — phase 7: selling products through the UniteFix store.
 *
 *   Partner   /api/hub/store/*  overview, seller profile, listings, orders, returns, reviews
 *   Customer  /api/store/*      in store.routes.ts (shared engine: MarketplaceService)
 *   Staff     /api/admin/hub/store/*  listing review, late orders, commission,
 *                               seller tier, TCS/TDS report, settle now
 *
 */

import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asc, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db';
import { productCategories, marketplaceCommission, businessPartners, sellerOrders } from '@shared/schema';
import { authenticateAdmin, requireSuperAdmin, authenticateToken } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { MarketplaceService } from '../services/marketplace.service';
import { StoreShippingService } from '../services/store-shipping.service';
import { TaxDocumentService } from '../services/tax-documents.service';
import { renderTaxDocumentPdf } from '../services/tax-document-pdf';
import { uploadDocumentBuffer } from '../services/cloudinary.service';
import { registerSummaryContributor } from '../services/hub-summary';
import { recordAudit } from '../lib/audit';

const r2 = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;
function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}
const upload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Upload an image.')),
});
const itemsSchema = z.array(z.object({ productId: z.number().int(), quantity: z.number().int().min(1).max(20), withInstallation: z.boolean().optional() })).min(1).max(50);

function listingView(r: { p: any; categoryName: string | null }) {
    const p = r.p;
    return {
        id: p.id, name: p.name, description: p.description, categoryId: p.categoryId, categoryName: r.categoryName, price: p.price, mrp: p.mrp, stock: p.stock,
        hsnCode: p.hsnCode, gstPercent: p.gstPercent == null ? null : Number(p.gstPercent), countryOfOrigin: p.countryOfOrigin, manufacturer: p.manufacturer,
        netQuantity: p.netQuantity, returnWindowDays: p.returnWindowDays, warrantyMonths: p.warrantyMonths, warrantyBy: p.warrantyBy, bisNumber: p.bisNumber, wpcEta: p.wpcEta,
        images: p.images ?? [], sellerSku: p.sellerSku, installationPrice: p.installationPricePaise != null ? p.installationPricePaise / 100 : null, installationSac: p.installationSac, installationNote: p.installationNote, status: p.listingStatus, rejectionReason: p.rejectionReason, updatedAt: p.updatedAt,
    };
}

export function registerHubStoreRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('marketplace');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    registerSummaryContributor('marketplace', async (ctx) => {
        if (!ctx.modules.includes('marketplace') || !ctx.permissions.includes('ops:view')) return null;
        const [orders, gaps, listings] = await Promise.all([MarketplaceService.ordersForSeller(ctx.businessPartnerId), MarketplaceService.readiness(ctx.businessPartnerId), MarketplaceService.listings(ctx.businessPartnerId)]);
        const toShip = orders.filter(o => ['placed', 'confirmed', 'packed'].includes(o.status));
        return {
            stats: [
                { label: 'Store orders to ship', value: toShip.length, hint: toShip.some(o => o.late) ? `${toShip.filter(o => o.late).length} past the dispatch deadline` : undefined },
                { label: 'Live listings', value: listings.filter(l => l.p.listingStatus === 'live').length },
            ],
            checklist: [
                { label: 'Seller details: grievance contact and return policy', done: gaps.length === 0, href: '/partner/store/listings' },
                { label: 'List your first product (MRP and HSN required)', done: listings.length > 0, href: '/partner/store/listings' },
            ],
        };
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Partner
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/store/overview', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, ctx.businessPartnerId)).limit(1);
            res.json({
                success: true, data: {
                    gaps: await MarketplaceService.readiness(ctx.businessPartnerId), metrics: await MarketplaceService.metrics(ctx.businessPartnerId, false),
                    profile: { grievanceName: bp.grievanceName, grievancePhone: bp.grievancePhone, grievanceEmail: bp.grievanceEmail, returnPolicy: bp.returnPolicy, gstin: bp.gstin, tier: bp.sellerTier },
                },
            });
        } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/store/profile', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ grievanceName: z.string().max(120).optional(), grievancePhone: z.string().max(20).optional(), grievanceEmail: z.string().max(160).optional(), returnPolicy: z.string().max(2000).optional() }), req.body);
            await MarketplaceService.saveSellerProfile(ctxOf(req), b);
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/store/categories', active, mod, async (_req, res, next) => {
        try { res.json({ success: true, data: await db.select({ id: productCategories.id, name: productCategories.name }).from(productCategories).where(eq(productCategories.isActive, true)).orderBy(asc(productCategories.name)) }); } catch (e) { hubError(e, res, next); }
    });

    const listingSchema = z.object({
        name: z.string().max(160).optional(), description: z.string().max(5000).optional().nullable(), categoryId: z.number().int().optional(),
        priceRupees: z.number().int().optional(), mrpRupees: z.number().int().optional(), stock: z.number().int().optional(),
        hsnCode: z.string().max(8).optional(), gstPercent: z.number().optional(), countryOfOrigin: z.string().max(60).optional(), manufacturer: z.string().max(160).optional(),
        netQuantity: z.string().max(60).optional().nullable(), returnWindowDays: z.number().int().optional(), warrantyMonths: z.number().int().min(0).max(120).optional().nullable(),
        warrantyBy: z.string().optional().nullable(), bisNumber: z.string().max(40).optional().nullable(), wpcEta: z.string().max(40).optional().nullable(),
        images: z.array(z.string().max(500)).max(8).optional(), sellerSku: z.string().max(60).optional().nullable(),
        installationPriceRupees: z.number().int().optional().nullable(), installationSac: z.string().max(8).optional().nullable(), installationNote: z.string().max(300).optional().nullable(),
    });
    app.get('/api/hub/store/listings', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await MarketplaceService.listings(ctxOf(req).businessPartnerId)).map(listingView) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/listings', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try { const p = await MarketplaceService.saveListing(ctxOf(req), null, parse(listingSchema, req.body)); res.status(201).json({ success: true, message: 'Saved as a draft. Submit it when ready.', data: { id: p.id } }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/store/listings/:id', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try { const p = await MarketplaceService.saveListing(ctxOf(req), Number(req.params.id), parse(listingSchema, req.body)); res.json({ success: true, message: p.listingStatus === 'pending_review' ? 'Saved — back in review because a listed detail changed.' : 'Saved.', data: { id: p.id, status: p.listingStatus } }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/listings/:id/submit', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try { const p = await MarketplaceService.submit(ctxOf(req), Number(req.params.id)); res.json({ success: true, message: p.listingStatus === 'live' ? 'Live in the store.' : 'Sent to UniteFix for review.', data: { status: p.listingStatus } }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/listings/:id/pause', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try { await MarketplaceService.pause(ctxOf(req), Number(req.params.id)); res.json({ success: true, message: 'Paused.' }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/listings/:id/images', active, mod, hubCan('sales:manage'), upload.single('file'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const p = await MarketplaceService.listing(ctx.businessPartnerId, Number(req.params.id));
            if (!req.file) throw new HubError('Choose an image.', 'NO_FILE');
            let url: string;
            try { url = (await uploadDocumentBuffer(req.file.buffer, `store/${ctx.partnerCode}`, req.file.mimetype)).url; } catch (err: any) { throw new HubError(`Upload failed: ${err?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502); }
            await MarketplaceService.saveListing(ctx, p.id, { images: [...(p.images ?? []), url] });
            res.status(201).json({ success: true, message: 'Image added.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/store/orders', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const rows = await MarketplaceService.ordersForSeller(ctxOf(req).businessPartnerId, typeof req.query.status === 'string' ? req.query.status : undefined);
            const fees = await MarketplaceService.feeRates();
            res.json({ success: true, data: rows.map(o => ({
                ...o, taxable: r2(o.taxablePaise), gst: r2(o.gstPaise), total: r2(o.totalPaise), commission: r2(o.commissionPaise + o.commissionGstPaise), tcs: r2(o.tcsPaise), tds: r2(o.tdsPaise),
                gatewayFee: r2(o.gatewayFeePaise + o.gatewayFeeGstPaise),
                penalty: o.penaltyPaise && !o.penaltyWaivedAt ? r2(o.penaltyPaise) : 0, penaltyReason: o.penaltyReason, penaltyWaived: !!o.penaltyWaivedAt,
                net: r2(o.totalPaise - o.commissionPaise - o.commissionGstPaise - o.tcsPaise - o.tdsPaise - o.gatewayFeePaise - o.gatewayFeeGstPaise),
                lateCharge: o.late ? fees.lateDispatchRupees : 0,
                items: o.items.map(i => ({ ...i, price: r2(i.unitPricePaise) })),
            })), shipping: { mode: StoreShippingService.mode(), ratePer500g: fees.courierPer500gRupees, gstPercent: fees.gstPercent } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/orders/:id/transition', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ to: z.enum(['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled']), courier: z.string().max(60).optional().nullable(), trackingId: z.string().max(80).optional().nullable(), reason: z.string().max(300).optional().nullable() }), req.body);
            const o = await MarketplaceService.transition(ctxOf(req), Number(req.params.id), b.to, b);
            res.json({ success: true, message: o.status === 'dispatched' ? 'Dispatched. Your GST invoice to the customer has been issued.' : o.status === 'cancelled' ? 'Cancelled; the customer is refunded.' : `Marked ${o.status}.`, data: { status: o.status } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/orders/:id/installed', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            await MarketplaceService.markInstalled(ctxOf(req), Number(req.params.id), typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : null);
            res.json({ success: true, message: 'Marked installed. The order settles after its return window.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/orders/:id/courier', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ weightGrams: z.coerce.number().int(), lengthCm: z.coerce.number(), widthCm: z.coerce.number(), heightCm: z.coerce.number() }), req.body);
            const r = await StoreShippingService.book(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: `Courier booked: Delhivery ${r.waybill}${r.mode === 'mock' ? ' (test booking — the courier account is not live yet)' : ''}.${r.charge ? ` ₹${r.charge} comes off your settlement.` : ''} Print the label and dispatch.`, data: { waybill: r.waybill, mode: r.mode, trackingUrl: r.trackingUrl, charge: r.charge } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/store/orders/:id/label.pdf', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const pdf = await StoreShippingService.label(ctxOf(req).businessPartnerId, Number(req.params.id));
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="label-${req.params.id}.pdf"`);
            res.send(pdf);
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/orders/:id/return', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'received']), note: z.string().max(300).optional().nullable() }), req.body);
            const o = await MarketplaceService.decideReturn(ctxOf(req), Number(req.params.id), b.decision, b.note);
            res.json({ success: true, message: b.decision === 'received' ? 'Return completed: credit note issued, customer refunded.' : `Return ${o.returnStatus}.` });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/store/reviews', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await MarketplaceService.reviewsForSeller(ctxOf(req).businessPartnerId)).map(r => ({ ...r.r, productName: r.productName })) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/store/reviews/:id/reply', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try { await MarketplaceService.reply(ctxOf(req), Number(req.params.id), String(req.body?.reply ?? '')); res.json({ success: true, message: 'Reply posted.' }); } catch (e) { hubError(e, res, next); }
    });

    // Customer routes (catalogue, cart, checkout, orders) live in store.routes.ts.

    // ═══════════════════════════════════════════════════════════════════════
    // Staff
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/hub/store/listings/pending', authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: (await MarketplaceService.reviewQueue()).map(r => ({ ...listingView({ p: r.p, categoryName: r.categoryName }), sellerName: r.sellerName, sellerCode: r.sellerCode, submittedAt: r.p.submittedAt })) }); } catch (e) { next(e); }
    });
    app.post('/api/admin/hub/store/listings/review', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500), approve: z.boolean(), reason: z.string().max(300).optional().nullable() }), req.body);
            const n = await MarketplaceService.reviewListings((req as any).admin.userId, b.ids, b.approve, b.reason);
            res.json({ success: true, message: `${n} listing(s) ${b.approve ? 'approved — live in the store' : 'rejected'}.` });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/store/late', authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: (await MarketplaceService.lateOrders()).map(r => ({ id: r.o.id, code: r.o.code, seller: r.seller, status: r.o.status, total: r2(r.o.totalPaise), createdAt: r.o.createdAt })) }); } catch (e) { next(e); }
    });
    app.post('/api/admin/hub/store/orders/:id/cancel', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const so = await MarketplaceService.sellerOrder(Number(req.params.id));
            await MarketplaceService.cancel(so, 'admin', (req as any).admin.userId, String(req.body?.reason ?? 'Not dispatched in time'));
            res.json({ success: true, message: 'Cancelled and refunded. It counts against the seller.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/store/orders/:id/waive', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ note: z.string().min(3).max(300) }), req.body);
            const so = await MarketplaceService.waivePenalty(Number(req.params.id), (req as any).admin.userId, b.note);
            await recordAudit({ entityType: 'business_partner', entityId: so.sellerPartnerId ?? 0, action: 'store_penalty_waived', changedBy: (req as any).admin.userId, metadata: { sellerOrderId: so.id, code: so.code, note: b.note, penaltyPaise: so.penaltyPaise } });
            res.json({ success: true, message: `Charge of ₹${r2(so.penaltyPaise)} waived; credited back to the seller.` });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/store/penalties', authenticateAdmin, async (_req, res, next) => {
        try {
            const rows = await db.select({ o: sellerOrders, seller: businessPartners.displayName }).from(sellerOrders).innerJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
                .where(gt(sellerOrders.penaltyPaise, 0)).orderBy(desc(sellerOrders.updatedAt)).limit(200);
            res.json({ success: true, data: rows.map(r => ({ id: r.o.id, code: r.o.code, seller: r.seller, penalty: r2(r.o.penaltyPaise), reason: r.o.penaltyReason, waived: !!r.o.penaltyWaivedAt, status: r.o.status, at: r.o.updatedAt })) });
        } catch (e) { next(e); }
    });
    app.get('/api/admin/hub/store/commission', authenticateAdmin, async (_req, res, next) => {
        try {
            const cats = await db.select().from(productCategories).orderBy(asc(productCategories.name));
            const rates = await db.select().from(marketplaceCommission);
            res.json({ success: true, data: cats.map(c => { const r = rates.find(x => x.productCategoryId === c.id); return { categoryId: c.id, name: c.name, percent: r ? Number(r.percent) : null, minRupees: r ? r.minPaise / 100 : null }; }) });
        } catch (e) { next(e); }
    });
    app.put('/api/admin/hub/store/commission/:categoryId', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ percent: z.number().min(0).max(50).nullable(), minRupees: z.number().min(0).max(100000).optional() }), req.body);
            const id = Number(req.params.categoryId);
            if (b.percent == null) await db.delete(marketplaceCommission).where(eq(marketplaceCommission.productCategoryId, id));
            else await db.insert(marketplaceCommission).values({ productCategoryId: id, percent: String(b.percent), minPaise: Math.round((b.minRupees ?? 0) * 100), updatedBy: (req as any).admin.userId })
                .onConflictDoUpdate({ target: marketplaceCommission.productCategoryId, set: { percent: String(b.percent), minPaise: Math.round((b.minRupees ?? 0) * 100), updatedBy: (req as any).admin.userId, updatedAt: new Date() } });
            res.json({ success: true, message: 'Saved. Applies to orders placed from now.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/admin/hub/partners/:id/seller', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ sellerTier: z.enum(['new', 'standard', 'preferred', 'restricted']).optional(), locked: z.boolean().optional(), delhiveryPickupName: z.string().max(120).optional().nullable() }), req.body);
            const id = Number(req.params.id);
            await db.update(businessPartners).set({ ...(b.sellerTier ? { sellerTier: b.sellerTier } : {}), ...(b.locked !== undefined ? { sellerTierLocked: b.locked } : {}), ...(b.delhiveryPickupName !== undefined ? { delhiveryPickupName: b.delhiveryPickupName?.trim() || null } : {}), updatedAt: new Date() }).where(eq(businessPartners.id, id));
            if (b.locked === false) await MarketplaceService.metrics(id);
            await recordAudit({ entityType: 'business_partner', entityId: id, action: 'hub_seller_tier', changedBy: (req as any).admin.userId, metadata: b });
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/store/tcs.csv', authenticateAdmin, async (req, res, next) => {
        try {
            const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
            const rows = await MarketplaceService.tcsReport(month);
            const esc = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
            const csv = [['Seller GSTIN', 'Seller', 'PAN', 'Orders settled', 'Net taxable value', 'GST TCS', 'TDS 194-O'].join(','), ...rows.map(r => [r.gstin, r.name, r.pan, r.orders, r.taxable, r.tcs, r.tds].map(esc).join(','))].join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="store-tcs-tds-${month}.csv"`);
            res.send(csv);
        } catch (e) { next(e); }
    });
    app.post('/api/admin/hub/store/settle', authenticateAdmin, requireSuperAdmin, async (_req, res, next) => {
        try { const n = await MarketplaceService.settleDue(); res.json({ success: true, message: `${n} order(s) settled to seller ledgers.` }); } catch (e) { next(e); }
    });

}
