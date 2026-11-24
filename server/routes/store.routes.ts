/**
 * The store for customers (the app's Shop tab) and for staff fulfilling
 * UniteFix's own orders.
 *
 *   Public    /api/store/categories, /api/store/products[/:id]
 *   Customer  /api/store/cart*, /api/store/checkout*, /api/store/orders*, review
 *   Staff     /api/admin/store/orders* (capability: orders)
 *
 * Partners manage their listings and orders under /api/hub/store
 * (hub-store.routes.ts); both sides share MarketplaceService for orders.
 */

import type { Express, Request } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticateAdmin, authenticateToken } from '../middleware/auth.middleware';
import { hubError } from '../middleware/hub-auth';
import { mobileLimiter, publicLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { MarketplaceService } from '../services/marketplace.service';
import { TaxDocumentService } from '../services/tax-documents.service';
import { renderTaxDocumentPdf } from '../services/tax-document-pdf';
import { StoreCatalog, type CatalogSort } from '../services/store/catalog.service';
import { StoreCart } from '../services/store/cart.service';
import { StoreCheckout } from '../services/store/checkout.service';
import { StoreOrders } from '../services/store/orders.service';
import { MAX_QTY } from '../services/store/pricing.service';
import { recordAudit } from '../lib/audit';

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}
const uid = (req: Request) => (req as any).user.userId as number;
/** HMAC over one document of one order and an expiry: the only thing a document link proves. */
function docSignature(orderId: number, docId: number, exp: number) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new HubError('Documents cannot be linked right now.', 'NO_SECRET', 503);
    return crypto.createHmac('sha256', `store-doc:${secret}`).update(`${orderId}.${docId}.${exp}`).digest('hex');
}
const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : undefined; };

const item = z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().nullish(), quantity: z.number().int().min(1).max(MAX_QTY), withInstallation: z.boolean().optional() });
const source = z.object({ source: z.enum(['cart', 'buy_now']), items: z.array(item).max(30).optional() });
const shipTo = z.object({
    name: z.string().trim().min(1).max(120), phone: z.string().trim().max(20),
    line1: z.string().trim().min(3).max(200), line2: z.string().trim().max(200).nullish(),
    city: z.string().trim().min(2).max(80), pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'a 6-digit pincode'),
    stateCode: z.string().regex(/^\d{2}$/, 'a 2-digit GST state code'),
});

export function registerStoreRoutes(app: Express) {

    // ── Browse (public) ──────────────────────────────────────────────────

    app.get('/api/store/categories', publicLimiter, async (_req, res, next) => {
        try { res.set('Cache-Control', 'public, max-age=60'); res.json({ success: true, data: await StoreCatalog.categories() }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/products', publicLimiter, async (req, res, next) => {
        try {
            const sort = ['relevance', 'new', 'price_asc', 'price_desc', 'rating'].includes(String(req.query.sort)) ? String(req.query.sort) as CatalogSort : undefined;
            const data = await StoreCatalog.list({ search: typeof req.query.search === 'string' ? req.query.search : undefined, categoryId: num(req.query.categoryId), sort, page: num(req.query.page), limit: num(req.query.limit) });
            res.set('Cache-Control', 'public, max-age=30');
            res.json({ success: true, data });
        } catch (e) { hubError(e, res, next); }
    });
    /** A partner listing's seller disclosures (E-Commerce Rules), for pages that show only those. */
    app.get('/api/store/products/:id/seller', publicLimiter, async (req, res, next) => {
        try { const s = await MarketplaceService.publicSeller(Number(req.params.id)); if (!s) return res.status(404).json({ success: false, message: 'Not a partner listing' }); res.json({ success: true, data: s }); } catch (e) { hubError(e, res, next); }
    });
    /** Price a list of items (with installation, too) without a cart: what an order would cost now. */
    app.post('/api/store/quote', authenticateToken, async (req, res, next) => {
        try {
            const { items } = parse(z.object({ items: z.array(item).min(1).max(30) }), req.body);
            const { StorePricing } = await import('../services/store/pricing.service');
            const { StoreInventory } = await import('../services/store/inventory.service');
            const q = await StorePricing.quote(items);
            const goods = q.lines.filter(l => l.kind === 'goods');
            const avail = await StoreInventory.availability((await import('../db')).db as any, goods);
            const short = goods.find(l => (avail.get(StoreInventory.key(l)) ?? 0) < l.quantity);
            if (short) throw new HubError(`Only ${avail.get(StoreInventory.key(short)) ?? 0} of ${short.name} left.`, 'STOCK', 409);
            const r2 = (p: number) => Math.round(p) / 100;
            res.json({ success: true, data: { total: r2(q.totalPaise), sellers: q.sellers.map(s => ({ sellerPartnerId: s.sellerPartnerId, sellerName: s.sellerName, total: r2(s.totalPaise) })), lines: q.lines.map(l => ({ ...l, total: r2(l.totalPaise) })) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/products/:id', publicLimiter, async (req, res, next) => {
        try { res.set('Cache-Control', 'no-store'); res.json({ success: true, data: await StoreCatalog.product(Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });

    // ── Cart ─────────────────────────────────────────────────────────────

    app.get('/api/store/cart', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreCart.view(uid(req)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/cart/lines', mobileLimiter, authenticateToken, async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Added to your cart.', data: await StoreCart.add(uid(req), parse(item.omit({ withInstallation: true }), req.body)) }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/store/cart/lines/:id', mobileLimiter, authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreCart.setQuantity(uid(req), Number(req.params.id), parse(z.object({ quantity: z.number().int().min(0).max(MAX_QTY) }), req.body).quantity) }); } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/store/cart/lines/:id', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreCart.remove(uid(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/store/cart', authenticateToken, async (req, res, next) => {
        try { await StoreCart.clear(uid(req)); res.json({ success: true, message: 'Cart emptied.' }); } catch (e) { hubError(e, res, next); }
    });

    // ── Checkout ─────────────────────────────────────────────────────────

    app.post('/api/store/checkout/preview', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreCheckout.preview(uid(req), parse(source, req.body)) }); } catch (e) { hubError(e, res, next); }
    });
    /** Send an Idempotency-Key header (a fresh one per "Place order" tap; the same one on a retry). */
    app.post('/api/store/checkout', mobileLimiter, authenticateToken, async (req, res, next) => {
        try {
            const b = parse(source.extend({ shipTo }), req.body);
            const data = await StoreCheckout.start(uid(req), b, req.get('Idempotency-Key'));
            res.status(data.replay ? 200 : 201).json({ success: true, data });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/checkout/:id', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreCheckout.status(uid(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/checkout/:id/verify', authenticateToken, async (req, res, next) => {
        try {
            const b = parse(z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }), req.body);
            const r = await StoreCheckout.verify(uid(req), Number(req.params.id), b);
            res.status(r.status === 'paid' ? 200 : 409).json({ success: r.status === 'paid', message: r.message, data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/checkout/:id/abandon', authenticateToken, async (req, res, next) => {
        try { await StoreCheckout.abandon(uid(req), Number(req.params.id)); res.json({ success: true }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/checkout/:id/mock-pay', authenticateToken, async (req, res, next) => {
        try {
            const r = await StoreCheckout.mockPay(uid(req), Number(req.params.id));
            res.status(r.status === 'paid' ? 200 : 409).json({ success: r.status === 'paid', message: r.message, data: r });
        } catch (e) { hubError(e, res, next); }
    });

    // ── My orders ────────────────────────────────────────────────────────

    app.get('/api/store/orders', authenticateToken, async (req, res, next) => {
        try {
            const status = ['open', 'done', 'all'].includes(String(req.query.status)) ? String(req.query.status) as 'open' | 'done' | 'all' : 'all';
            res.json({ success: true, data: await StoreOrders.mine(uid(req), { status, page: num(req.query.page), limit: num(req.query.limit) }) });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/orders/:id', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await StoreOrders.one(uid(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/orders/:id/cancel', mobileLimiter, authenticateToken, async (req, res, next) => {
        try {
            const b = parse(z.object({ reason: z.string().trim().min(2).max(300) }), req.body);
            await MarketplaceService.customerCancel(uid(req), Number(req.params.id), b.reason);
            res.json({ success: true, message: 'Cancelled. Your refund is on its way.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/orders/:id/return', mobileLimiter, authenticateToken, async (req, res, next) => {
        try {
            const b = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
            await MarketplaceService.requestReturn(uid(req), Number(req.params.id), b.reason);
            res.json({ success: true, message: 'Return requested. The seller will respond.' });
        } catch (e) { hubError(e, res, next); }
    });
    const sendDoc = async (docId: number, res: any) => {
        const found = await TaxDocumentService.withLines(docId);
        if (!found) throw new HubError('Not found', 'NOT_FOUND', 404);
        const pdf = await renderTaxDocumentPdf(found.doc, found.lines);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${found.doc.number.replace(/\//g, '-')}.pdf"`);
        res.send(pdf);
    };
    app.get('/api/store/orders/:id/documents/:docId', authenticateToken, async (req, res, next) => {
        try { await sendDoc(await StoreOrders.documentFor(uid(req), Number(req.params.id), Number(req.params.docId)), res); } catch (e) { hubError(e, res, next); }
    });
    /**
     * The app opens a document in the phone's browser, which cannot send the
     * login token. So it asks for a link signed for that one document, valid
     * for 10 minutes; the token never appears in a URL.
     */
    app.post('/api/store/orders/:id/documents/:docId/link', authenticateToken, async (req, res, next) => {
        try {
            const orderId = Number(req.params.id), docId = await StoreOrders.documentFor(uid(req), Number(req.params.id), Number(req.params.docId));
            const exp = Math.floor(Date.now() / 1000) + 600;
            const base = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
            res.json({ success: true, data: { url: `${base}/api/store/doc/${orderId}/${docId}.pdf?exp=${exp}&sig=${docSignature(orderId, docId, exp)}` } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/doc/:orderId/:docId.pdf', publicLimiter, async (req, res, next) => {
        try {
            const orderId = Number(req.params.orderId), docId = Number(req.params.docId), exp = Number(req.query.exp);
            const sig = String(req.query.sig ?? '');
            const good = docSignature(orderId, docId, exp);
            if (!(exp > Date.now() / 1000) || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) {
                return res.status(403).type('text/plain').send('This link has expired. Open the document again from your order in the app.');
            }
            const so = await MarketplaceService.sellerOrder(orderId);
            if (![so.invoiceDocumentId, so.creditNoteDocumentId, so.receiptVoucherDocumentId, so.refundVoucherDocumentId].includes(docId)) throw new HubError('Not found', 'NOT_FOUND', 404);
            res.setHeader('Cache-Control', 'private, no-store');
            await sendDoc(docId, res);
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/store/orders/:id/invoice', authenticateToken, async (req, res, next) => {
        try {
            const so = await MarketplaceService.sellerOrder(Number(req.params.id), { userId: uid(req) });
            if (!so.invoiceDocumentId) throw new HubError('The invoice is issued when the order ships.', 'NOT_FOUND', 404);
            await sendDoc(so.invoiceDocumentId, res);
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/store/items/:itemId/review', mobileLimiter, authenticateToken, async (req, res, next) => {
        try {
            const b = parse(z.object({ rating: z.number().int().min(1).max(5), review: z.string().trim().max(2000).nullish() }), req.body);
            await MarketplaceService.addReview(uid(req), Number(req.params.itemId), b);
            res.status(201).json({ success: true, message: 'Thanks for your review.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ── Staff: UniteFix's own orders ─────────────────────────────────────

    app.get('/api/admin/store/orders', authenticateAdmin, async (req, res, next) => {
        try {
            const scope = ['unitefix', 'partners', 'all'].includes(String(req.query.scope)) ? String(req.query.scope) as 'unitefix' | 'partners' | 'all' : 'unitefix';
            res.json({ success: true, data: await StoreOrders.adminList({ scope, status: typeof req.query.status === 'string' ? req.query.status : undefined, search: typeof req.query.search === 'string' ? req.query.search : undefined, page: num(req.query.page) }) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/store/orders/:id/transition', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ to: z.enum(['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled']), courier: z.string().trim().max(60).nullish(), trackingId: z.string().trim().max(60).nullish(), reason: z.string().trim().max(300).nullish() }), req.body);
            const adminId = (req as any).admin.userId;
            await MarketplaceService.adminTransition(adminId, Number(req.params.id), b.to, b);
            await recordAudit({ entityType: 'store_order', entityId: Number(req.params.id), action: `store_order_${b.to}`, changedBy: adminId, metadata: { courier: b.courier ?? undefined, trackingId: b.trackingId ?? undefined, reason: b.reason ?? undefined } });
            res.json({ success: true, message: `Order ${b.to}.` });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/store/orders/:id/return', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'received']), note: z.string().trim().max(300).nullish() }), req.body);
            const adminId = (req as any).admin.userId;
            const so = await MarketplaceService.sellerOrder(Number(req.params.id));
            if (so.sellerPartnerId != null) throw new HubError('The seller decides returns on their orders.', 'NOT_OURS', 409);
            await MarketplaceService.decideReturn({ adminUserId: adminId }, so.id, b.decision, b.note);
            await recordAudit({ entityType: 'store_order', entityId: so.id, action: `store_return_${b.decision}`, changedBy: adminId, metadata: { note: b.note ?? undefined } });
            res.json({ success: true, message: b.decision === 'received' ? 'Return received: credit note issued and refund started.' : `Return ${b.decision === 'approve' ? 'approved' : 'rejected'}.` });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/store/orders/:id/documents/:docId', authenticateAdmin, async (req, res, next) => {
        try {
            const so = await MarketplaceService.sellerOrder(Number(req.params.id));
            const d = Number(req.params.docId);
            if (![so.invoiceDocumentId, so.creditNoteDocumentId, so.receiptVoucherDocumentId, so.refundVoucherDocumentId].includes(d)) throw new HubError('Not found', 'NOT_FOUND', 404);
            await sendDoc(d, res);
        } catch (e) { hubError(e, res, next); }
    });
}
