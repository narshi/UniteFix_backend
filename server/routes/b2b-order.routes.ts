/**
 * B2B ordering — business partners buying from UniteFix stock.
 *
 * Partner side under /api/b2b (authenticateBusinessPartner — either the web
 * portal or the mobile app). Admin side under /api/admin/b2b-orders → `orders`
 * capability area.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { b2bOrders, spareParts } from '@shared/schema';
import { authenticateAdmin, authenticateBusinessPartner } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { B2bOrderService, B2bOrderError } from '../services/b2b-order.service';
import { SparePartsService } from '../services/spare-parts.service';
import { PaymentTrackingService } from '../services/payment-tracking.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

const paiseToRupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;

const placeSchema = z.object({
    items: z.array(z.object({ sparePartId: z.number().int().positive(), quantity: z.number().int().min(1).max(10_000) })).min(1).max(60),
    paymentMode: z.enum(['prepaid', 'credit']).default('prepaid'),
    deliveryAddress: z.record(z.unknown()).optional().nullable(),
    deliveryContact: z.record(z.unknown()).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
});
const verifySchema = z.object({
    razorpay_order_id: z.string().trim().min(4),
    razorpay_payment_id: z.string().trim().min(4),
    razorpay_signature: z.string().trim().min(4),
});
const transitionSchema = z.object({
    reason: z.string().trim().max(500).optional(),
    courier: z.string().trim().max(80).optional(),
    trackingId: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
});

const mapErr = (error: any, res: Response, next: NextFunction) => {
    if (error instanceof B2bOrderError) {
        const status = error.code === 'CREDIT_EXCEEDED' || error.code === 'PREPAID_ONLY' ? 402 : error.code === 'BAD_TRANSITION' ? 409 : 400;
        return res.status(status).json({ success: false, code: error.code, message: error.message });
    }
    if (/Razorpay credentials/i.test(error?.message ?? '')) return res.status(503).json({ success: false, message: 'Payments are unavailable right now.' });
    next(error);
};

function orderView(d: NonNullable<Awaited<ReturnType<typeof B2bOrderService.detail>>>) {
    const { order, items, events, partner } = d;
    return {
        id: order.id, orderCode: order.orderCode, status: order.status,
        paymentMode: order.paymentMode, paymentStatus: order.paymentStatus,
        subtotal: paiseToRupees(order.subtotalPaise), gst: paiseToRupees(order.gstPaise), shipping: paiseToRupees(order.shippingPaise),
        discount: paiseToRupees(order.discountPaise), total: paiseToRupees(order.totalPaise),
        deliveryAddress: order.deliveryAddress, deliveryContact: order.deliveryContact, notes: order.notes, cancelReason: order.cancelReason,
        placedAt: order.placedAt, paidAt: order.paidAt, confirmedAt: order.confirmedAt, dispatchedAt: order.dispatchedAt, deliveredAt: order.deliveredAt, cancelledAt: order.cancelledAt,
        partner,
        items: items.map(i => ({
            id: i.id, sparePartId: i.sparePartId, partCode: i.partCode, name: i.name, specification: i.specification,
            quantity: i.quantity, quantityFulfilled: i.quantityFulfilled, backordered: i.backordered,
            unitPrice: paiseToRupees(i.unitPricePaise), gstPercent: i.gstPercent != null ? Number(i.gstPercent) : null, lineTotal: paiseToRupees(i.lineTotalPaise),
        })),
        // The tracking timeline: every event, plus a stage view derived from status.
        events: events.map(e => ({ id: e.id, type: e.eventType, from: e.fromStatus, to: e.toStatus, actor: e.actorType, payload: e.payload, at: e.createdAt })),
        tracking: B2bOrderService.stages(order),
    };
}

export function registerB2bOrderRoutes(app: Express) {

    // ═══════════════════════════════════════════════════════════════════════
    // Partner — catalogue + orders
    // ═══════════════════════════════════════════════════════════════════════

    /** What is for sale to this partner: trade price and availability, never cost. */
    app.get('/api/b2b/catalog', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await SparePartsService.search({
                q: typeof req.query.q === 'string' ? req.query.q : undefined,
                categoryId: req.query.categoryId ? Number(req.query.categoryId) : null,
                limit: req.query.limit ? Number(req.query.limit) : 60,
            });
            res.json({
                success: true,
                data: rows
                    .filter(r => r.tradePricePaise != null)
                    .map(r => ({
                        id: r.id, partCode: r.partCode, name: r.name, brand: r.brand, specification: r.specification, unit: r.unit,
                        tradePrice: paiseToRupees(r.tradePricePaise), gstPercent: r.gstPercent != null ? Number(r.gstPercent) : null,
                        warrantyDays: r.warrantyDays, categoryIds: r.categoryIds,
                        availability: r.warehouseQty > 10 ? 'in_stock' : r.warehouseQty > 0 ? 'low' : 'backorder',
                    })),
            });
        } catch (error) { next(error); }
    });

    app.get('/api/b2b/catalog/:id', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const [p] = await db.select().from(spareParts).where(and(eq(spareParts.id, Number(req.params.id)), eq(spareParts.isActive, true))).limit(1);
            if (!p || p.tradePricePaise == null) return res.status(404).json({ success: false, message: 'Not available' });
            const stock = await SparePartsService.stockFor(p.id);
            const wh = stock.filter(s => s.location === 'warehouse').reduce((a, s) => a + s.quantity, 0);
            res.json({
                success: true,
                data: {
                    id: p.id, partCode: p.partCode, name: p.name, brand: p.brand, specification: p.specification, unit: p.unit, photoUrl: p.photoUrl,
                    tradePrice: paiseToRupees(p.tradePricePaise), gstPercent: p.gstPercent != null ? Number(p.gstPercent) : null, warrantyDays: p.warrantyDays,
                    categories: await SparePartsService.categoriesOf(p.id),
                    availability: wh > 10 ? 'in_stock' : wh > 0 ? 'low' : 'backorder',
                },
            });
        } catch (error) { next(error); }
    });

    /** Price a cart without placing it. */
    app.post('/api/b2b/orders/quote', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const q = await B2bOrderService.quote(Array.isArray(req.body?.items) ? req.body.items : []);
            res.json({
                success: true,
                data: {
                    lines: q.lines.map(l => ({ ...l, unitPrice: paiseToRupees(l.unitPricePaise), net: paiseToRupees(l.netPaise), gst: paiseToRupees(l.gstPaise), lineTotal: paiseToRupees(l.lineTotalPaise) })),
                    subtotal: paiseToRupees(q.subtotalPaise), gst: paiseToRupees(q.gstPaise), total: paiseToRupees(q.totalPaise),
                    backordered: q.lines.filter(l => l.backordered).map(l => l.name),
                },
            });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/b2b/orders', authenticateBusinessPartner, validateBody(placeSchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const b = req.body as z.infer<typeof placeSchema>;
            const r = await B2bOrderService.place({ businessPartnerId: ctx.id, ...b });
            const d = await B2bOrderService.detail(r.order.id);
            res.status(201).json({
                success: true,
                message: b.paymentMode === 'credit'
                    ? `Order ${r.order.orderCode} placed on credit. UniteFix will confirm it shortly.`
                    : `Order ${r.order.orderCode} placed. Complete the payment to proceed.`,
                data: {
                    order: orderView(d!),
                    razorpay: r.razorpay ? { orderId: r.razorpay.orderId, keyId: r.razorpay.keyId, amount: paiseToRupees(r.order.totalPaise) } : null,
                },
            });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/b2b/orders/:id/verify-payment', authenticateBusinessPartner, validateBody(verifySchema), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as z.infer<typeof verifySchema>;
            const secret = process.env.RAZORPAY_KEY_SECRET;
            if (!secret) return res.status(500).json({ success: false, message: 'Payment verification not configured' });
            const expected = crypto.createHmac('sha256', secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
            const a = Buffer.from(expected, 'utf8'); const bsig = Buffer.from(razorpay_signature, 'utf8');
            if (a.length !== bsig.length || !crypto.timingSafeEqual(a, bsig)) {
                logger.warn('[B2B] signature mismatch', { razorpay_order_id });
                return res.status(400).json({ success: false, message: 'Invalid payment signature' });
            }
            const [order] = await db.select().from(b2bOrders).where(and(eq(b2bOrders.id, Number(req.params.id)), eq(b2bOrders.businessPartnerId, ctx.id))).limit(1);
            if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
            if (order.razorpayOrderId !== razorpay_order_id) return res.status(400).json({ success: false, message: 'That payment is for a different order' });

            try {
                await PaymentTrackingService.recordPaymentEvent({
                    b2bOrderId: order.id, razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id,
                    amount: order.totalPaise, currency: 'INR', eventType: 'payment_captured', status: 'captured',
                    metadata: { source: 'sdk_verify', paymentType: 'b2b_order' },
                });
            } catch (e: any) { logger.warn(`[B2B] tracking record failed: ${e?.message}`); }

            await B2bOrderService.applyCapture({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, orderId: order.id });
            const d = await B2bOrderService.detail(order.id);
            res.json({ success: true, message: 'Payment received.', data: orderView(d!) });
        } catch (error) { mapErr(error, res, next); }
    });

    /**
     * Resume an interrupted checkout. A prepaid order whose Razorpay checkout
     * was dismissed still has its Razorpay order (they stay payable), so the app
     * re-opens the same one rather than creating a second order for the same goods.
     */
    app.get('/api/b2b/orders/:id/payment', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const [order] = await db.select().from(b2bOrders).where(and(eq(b2bOrders.id, Number(req.params.id)), eq(b2bOrders.businessPartnerId, ctx.id))).limit(1);
            if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
            if (order.paymentMode !== 'prepaid' || order.paymentStatus === 'paid' || order.status !== 'placed' || !order.razorpayOrderId) {
                return res.status(409).json({ success: false, message: 'This order has nothing left to pay.' });
            }
            res.json({ success: true, data: { orderId: order.razorpayOrderId, keyId: await B2bOrderService.razorpayKeyId(), amount: paiseToRupees(order.totalPaise) } });
        } catch (error) { mapErr(error, res, next); }
    });

    app.get('/api/b2b/orders', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const rows = await B2bOrderService.list({ businessPartnerId: ctx.id, status: typeof req.query.status === 'string' ? req.query.status : undefined });
            res.json({
                success: true,
                data: rows.map(r => ({
                    id: r.order.id, orderCode: r.order.orderCode, status: r.order.status, paymentMode: r.order.paymentMode, paymentStatus: r.order.paymentStatus,
                    total: paiseToRupees(r.order.totalPaise), placedAt: r.order.placedAt, deliveredAt: r.order.deliveredAt,
                    tracking: B2bOrderService.stages(r.order),
                })),
            });
        } catch (error) { next(error); }
    });

    app.get('/api/b2b/orders/:id', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const d = await B2bOrderService.detail(Number(req.params.id), ctx.id);
            if (!d) return res.status(404).json({ success: false, message: 'Order not found' });
            res.json({ success: true, data: orderView(d) });
        } catch (error) { next(error); }
    });

    app.post('/api/b2b/orders/:id/cancel', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const reason = String(req.body?.reason ?? 'Cancelled by partner').trim().slice(0, 500);
            const updated = await B2bOrderService.partnerCancel(Number(req.params.id), ctx.id, reason);
            if (!updated) return res.status(404).json({ success: false, message: 'Order not found' });
            const d = await B2bOrderService.detail(updated.id);
            res.json({ success: true, message: updated.paymentStatus === 'refunded' ? 'Cancelled. Your payment is being refunded to the original method.' : 'Cancelled.', data: orderView(d!) });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/b2b/orders/:id/return', authenticateBusinessPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const reason = String(req.body?.reason ?? '').trim();
            if (reason.length < 5) return res.status(400).json({ success: false, message: 'Tell us what is wrong with the delivery.' });
            const order = await B2bOrderService.partnerRequestReturn(Number(req.params.id), ctx.id, reason);
            if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
            res.json({ success: true, message: 'Return requested. UniteFix will get in touch to arrange collection.' });
        } catch (error) { mapErr(error, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Admin — fulfilment
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/b2b-orders', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await B2bOrderService.list({
                status: typeof req.query.status === 'string' ? req.query.status : undefined,
                businessPartnerId: req.query.businessPartnerId ? Number(req.query.businessPartnerId) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : 200,
            });
            res.json({
                success: true,
                data: rows.map(r => ({
                    id: r.order.id, orderCode: r.order.orderCode, status: r.order.status, paymentMode: r.order.paymentMode, paymentStatus: r.order.paymentStatus,
                    total: paiseToRupees(r.order.totalPaise), placedAt: r.order.placedAt, partnerCode: r.partnerCode, partnerName: r.partnerName,
                    // Ageing, so a queue that is silently stalling is visible at a glance.
                    ageHours: r.order.placedAt ? Math.round((Date.now() - new Date(r.order.placedAt).getTime()) / 3_600_000) : null,
                })),
            });
        } catch (error) { next(error); }
    });

    app.get('/api/admin/b2b-orders/:id', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const d = await B2bOrderService.detail(Number(req.params.id));
            if (!d) return res.status(404).json({ success: false, message: 'Order not found' });
            res.json({ success: true, data: orderView(d) });
        } catch (error) { next(error); }
    });

    const adminTransition = (to: 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned') =>
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const admin = (req as any).admin as { userId: number };
                const b = req.body as z.infer<typeof transitionSchema>;
                const payload: Record<string, unknown> = {};
                if (b.reason) payload.reason = b.reason;
                if (b.courier) payload.courier = b.courier;
                if (b.trackingId) payload.trackingId = b.trackingId;
                if (b.note) payload.note = b.note;
                if (to === 'cancelled' && !b.reason) return res.status(400).json({ success: false, message: 'Give a reason the partner will read.' });

                const updated = await B2bOrderService.transition(Number(req.params.id), to, { type: 'admin', id: admin.userId }, payload);
                if (!updated) return res.status(404).json({ success: false, message: 'Order not found' });
                await recordAudit({ entityType: 'b2b_order', entityId: updated.id, action: `b2b_order_${to}`, changedBy: admin.userId, toState: to, metadata: payload });
                const d = await B2bOrderService.detail(updated.id);
                res.json({ success: true, message: `${updated.orderCode} is now ${to}.`, data: orderView(d!) });
            } catch (error) { mapErr(error, res, next); }
        };

    app.post('/api/admin/b2b-orders/:id/confirm', authenticateAdmin, validateBody(transitionSchema), adminTransition('confirmed'));
    app.post('/api/admin/b2b-orders/:id/pack', authenticateAdmin, validateBody(transitionSchema), adminTransition('packed'));
    app.post('/api/admin/b2b-orders/:id/dispatch', authenticateAdmin, validateBody(transitionSchema), adminTransition('dispatched'));
    app.post('/api/admin/b2b-orders/:id/deliver', authenticateAdmin, validateBody(transitionSchema), adminTransition('delivered'));
    app.post('/api/admin/b2b-orders/:id/cancel', authenticateAdmin, validateBody(transitionSchema), adminTransition('cancelled'));
    app.post('/api/admin/b2b-orders/:id/accept-return', authenticateAdmin, validateBody(transitionSchema), adminTransition('returned'));

    app.post('/api/admin/b2b-orders/:id/note', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const note = String(req.body?.note ?? '').trim();
            if (note.length < 2) return res.status(400).json({ success: false, message: 'Write a note.' });
            await B2bOrderService.addNote(Number(req.params.id), { type: 'admin', id: admin.userId }, { note });
            const d = await B2bOrderService.detail(Number(req.params.id));
            if (!d) return res.status(404).json({ success: false, message: 'Order not found' });
            res.json({ success: true, data: orderView(d) });
        } catch (error) { next(error); }
    });
}
