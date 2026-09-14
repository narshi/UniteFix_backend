/**
 * B2B orders — business partners buying from UniteFix stock.
 *
 * A CCTV installer orders ten cameras; an ISP orders a box of splitters. The
 * same catalogue technicians fit from, at the TRADE price, with a tracking
 * timeline and a ledger entry per order.
 *
 * PRICES FREEZE AT PLACEMENT, as every other price in this system does. The
 * order carries the trade price it was placed at; the catalogue can change
 * tomorrow and the receipt still says what was agreed.
 *
 * TWO WAYS TO PAY
 *   prepaid — a Razorpay order whose notes carry payment_type=b2b_order and
 *             the order id. Webhook AND the SDK verify callback land on one
 *             idempotent applyCapture(): whichever arrives first wins.
 *   credit  — refused if credit_limit − outstanding < total, with the
 *             shortfall named. Placement writes the invoice to the partner
 *             ledger (positive: they owe us). Payment received is recorded by
 *             admin against the ledger later.
 *
 * STOCK moves on DISPATCH, not on placement: what is sold is what left the
 * building. sold_to_partner movements are idempotent per order line, so a
 * dispatch pressed twice moves stock once. A placement that exceeds the
 * warehouse is allowed and flagged backordered — a partner may order what
 * you can procure — so admin knows to buy before confirming.
 *
 * MONEY BEFORE BOOKKEEPING. A payment applies even if nothing has been
 * confirmed yet; a refund on cancel goes back through Razorpay the way it came,
 * not through Cashfree.
 */

import Razorpay from 'razorpay';
import { db } from '../db';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import {
    b2bOrders, b2bOrderItems, b2bOrderEvents, spareParts, sparePartStock, businessPartners,
    type B2bOrder,
} from '@shared/schema';
import { withTransaction } from '../lib/transaction';
import { configService } from './config.service';
import { BusinessPartnerService } from './business-partner.service';
import { SparePartsService } from './spare-parts.service';
import { NotificationService } from './notification.service';
import logger from '../lib/logger';

export type B2bStatus = 'draft' | 'placed' | 'paid' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';

export class B2bOrderError extends Error {
    constructor(message: string, public readonly code: string) { super(message); this.name = 'B2bOrderError'; }
}

/** Legal transitions. Anything not listed is refused, whoever asks. */
const TRANSITIONS: Record<B2bStatus, B2bStatus[]> = {
    draft: ['placed', 'cancelled'],
    placed: ['paid', 'confirmed', 'cancelled'],
    paid: ['confirmed', 'cancelled'],
    confirmed: ['packed', 'dispatched', 'cancelled'],
    packed: ['dispatched', 'cancelled'],
    dispatched: ['delivered', 'returned'],
    delivered: ['returned'],
    cancelled: [],
    returned: [],
};

export class B2bOrderService {

    private static razorpay: Razorpay | null = null;
    private static async rzp(): Promise<Razorpay> {
        if (this.razorpay) return this.razorpay;
        const keyId = process.env.RAZORPAY_KEY_ID || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_ID')) || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_SECRET')) || '';
        if (!keyId || !keySecret || keyId.includes('xxxxx')) throw new Error('Razorpay credentials not configured');
        this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
        return this.razorpay;
    }
    static async razorpayKeyId(): Promise<string> {
        return process.env.RAZORPAY_KEY_ID || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_ID')) || '';
    }

    static async nextOrderCode(tx: typeof db = db): Promise<string> {
        const year = new Date().getFullYear();
        const [row] = await tx.select({ n: sql<number>`coalesce(max(id), 0)` }).from(b2bOrders);
        return `B2B-${year}-${String(Number(row?.n ?? 0) + 1).padStart(5, '0')}`;
    }

    private static async event(tx: typeof db, orderId: number, input: {
        eventType: string; fromStatus?: string | null; toStatus?: string | null;
        actorType: 'partner' | 'admin' | 'system'; actorId?: number | null; payload?: Record<string, unknown> | null;
    }) {
        await tx.insert(b2bOrderEvents).values({
            orderId, eventType: input.eventType as any, fromStatus: input.fromStatus ?? null, toStatus: input.toStatus ?? null,
            actorType: input.actorType, actorId: input.actorId ?? null, payload: (input.payload ?? null) as any,
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Quote & place
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Price a cart from the catalogue. Nothing from the client but ids and
     * quantities is trusted. Parts with no trade price are not for sale B2B.
     */
    static async quote(items: Array<{ sparePartId: number; quantity: number }>) {
        const clean = items
            .map(i => ({ sparePartId: Number(i.sparePartId), quantity: Math.floor(Number(i.quantity)) }))
            .filter(i => Number.isInteger(i.sparePartId) && i.sparePartId > 0 && i.quantity > 0 && i.quantity <= 10_000);
        if (!clean.length) throw new B2bOrderError('Add at least one part to the order.', 'EMPTY_ORDER');

        const ids = Array.from(new Set(clean.map(i => i.sparePartId)));
        const parts = await db.select().from(spareParts).where(inArray(spareParts.id, ids));
        const byId = new Map(parts.map(p => [p.id, p]));
        const stock = await db.select().from(sparePartStock).where(and(inArray(sparePartStock.sparePartId, ids), eq(sparePartStock.location, 'warehouse')));
        const warehouse = new Map(stock.map(s => [s.sparePartId, s.quantity]));

        const defaultGst = parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18');

        const lines = clean.map(i => {
            const p = byId.get(i.sparePartId);
            if (!p || !p.isActive || p.status !== 'active') throw new B2bOrderError(`Part #${i.sparePartId} is not available.`, 'PART_UNAVAILABLE');
            if (p.tradePricePaise == null) throw new B2bOrderError(`${p.name} (${p.partCode}) is not sold to partners.`, 'NOT_FOR_TRADE');
            const gstPct = p.gstPercent != null ? Number(p.gstPercent) : defaultGst;
            // Trade price is GST-exclusive; GST is added per line and rounded per line.
            const net = p.tradePricePaise * i.quantity;
            const gst = Math.round(net * gstPct / 100);
            const available = warehouse.get(p.id) ?? 0;
            return {
                sparePartId: p.id, partCode: p.partCode, name: p.name, specification: p.specification,
                quantity: i.quantity, unitPricePaise: p.tradePricePaise, gstPercent: gstPct,
                netPaise: net, gstPaise: gst, lineTotalPaise: net + gst,
                availableQty: available, backordered: available < i.quantity,
            };
        });

        const subtotalPaise = lines.reduce((s, l) => s + l.netPaise, 0);
        const gstPaise = lines.reduce((s, l) => s + l.gstPaise, 0);
        return { lines, subtotalPaise, gstPaise, shippingPaise: 0, discountPaise: 0, totalPaise: subtotalPaise + gstPaise };
    }

    static async place(input: {
        businessPartnerId: number;
        items: Array<{ sparePartId: number; quantity: number }>;
        paymentMode: 'prepaid' | 'credit';
        deliveryAddress?: Record<string, unknown> | null;
        deliveryContact?: Record<string, unknown> | null;
        notes?: string | null;
    }) {
        const q = await this.quote(input.items);
        const bp = await BusinessPartnerService.byId(input.businessPartnerId);
        if (!bp || bp.status !== 'active') throw new B2bOrderError('This business partner cannot place orders right now.', 'PARTNER_NOT_ACTIVE');

        return withTransaction(async (tx) => {
            if (input.paymentMode === 'credit') {
                const pos = await BusinessPartnerService.creditPosition(bp.id, tx as any);
                if (pos.limitPaise <= 0) throw new B2bOrderError('This account is prepaid only. Pay now, or ask UniteFix about credit terms.', 'PREPAID_ONLY');
                if (pos.availablePaise < q.totalPaise) {
                    const short = q.totalPaise - pos.availablePaise;
                    throw new B2bOrderError(
                        `Credit available is ₹${(pos.availablePaise / 100).toFixed(2)}; this order needs ₹${(q.totalPaise / 100).toFixed(2)} — ₹${(short / 100).toFixed(2)} short. Pay the balance, or reduce the order.`,
                        'CREDIT_EXCEEDED',
                    );
                }
            }

            const orderCode = await this.nextOrderCode(tx as any);
            const [order] = await tx.insert(b2bOrders).values({
                orderCode, businessPartnerId: bp.id, status: 'placed',
                paymentMode: input.paymentMode, paymentStatus: 'unpaid',
                subtotalPaise: q.subtotalPaise, gstPaise: q.gstPaise, shippingPaise: q.shippingPaise, discountPaise: q.discountPaise, totalPaise: q.totalPaise,
                deliveryAddress: (input.deliveryAddress ?? { address: bp.address, pincode: bp.pincode, district: bp.district }) as any,
                deliveryContact: (input.deliveryContact ?? { name: bp.contactName, phone: bp.contactPhone }) as any,
                notes: input.notes ?? null,
            }).returning();

            await tx.insert(b2bOrderItems).values(q.lines.map(l => ({
                orderId: order.id, sparePartId: l.sparePartId, partCode: l.partCode, name: l.name, specification: l.specification,
                quantity: l.quantity, unitPricePaise: l.unitPricePaise, gstPercent: String(l.gstPercent), lineTotalPaise: l.lineTotalPaise,
                backordered: l.backordered,
            })));

            await this.event(tx as any, order.id, {
                eventType: 'placed', toStatus: 'placed', actorType: 'partner', actorId: bp.id,
                payload: { paymentMode: input.paymentMode, lines: q.lines.length, backordered: q.lines.filter(l => l.backordered).length },
            });

            // Credit: the invoice is the ledger entry, written now. One per order.
            if (input.paymentMode === 'credit') {
                await BusinessPartnerService.appendLedger(tx as any, {
                    businessPartnerId: bp.id, entryType: 'order_invoice', amountPaise: q.totalPaise, b2bOrderId: order.id,
                    description: `Order ${orderCode} on credit`,
                });
            }

            // Prepaid: a Razorpay order for the app to open.
            let razorpay: { orderId: string; keyId: string } | null = null;
            if (input.paymentMode === 'prepaid') {
                const rzp = await this.rzp();
                const ro = await rzp.orders.create({
                    amount: q.totalPaise, currency: 'INR',
                    receipt: `b2b_${order.id}_${Date.now()}`.slice(0, 40),
                    notes: { payment_type: 'b2b_order', b2b_order_id: String(order.id), business_partner_id: String(bp.id) },
                });
                await tx.update(b2bOrders).set({ razorpayOrderId: ro.id, updatedAt: new Date() }).where(eq(b2bOrders.id, order.id));
                razorpay = { orderId: ro.id, keyId: await this.razorpayKeyId() };
            }

            logger.info(`[B2B] ${orderCode} placed by ${bp.partnerCode}: ${q.lines.length} line(s), ${q.totalPaise} paise, ${input.paymentMode}`);
            return { order: { ...order, razorpayOrderId: razorpay?.orderId ?? null }, quote: q, razorpay };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Payment
    // ──────────────────────────────────────────────────────────────────────

    static async applyCapture(params: { razorpayOrderId?: string | null; razorpayPaymentId: string; orderId?: number | null; amountPaise?: number; method?: string }) {
        return withTransaction(async (tx) => {
            const locator = params.orderId ? eq(b2bOrders.id, params.orderId)
                : params.razorpayOrderId ? eq(b2bOrders.razorpayOrderId, params.razorpayOrderId) : null;
            if (!locator) return { applied: false, reason: 'no locator' };
            const [order] = await tx.select().from(b2bOrders).where(locator).for('update').limit(1);
            if (!order) return { applied: false, reason: 'order not found' };
            if (order.paymentStatus === 'paid' || order.razorpayPaymentId === params.razorpayPaymentId) {
                return { applied: false, orderId: order.id, reason: 'already paid' };
            }
            if (params.amountPaise && params.amountPaise < order.totalPaise) {
                logger.warn(`[B2B] Capture ${params.amountPaise} < total ${order.totalPaise} on ${order.orderCode} — recorded as partial`);
            }
            const paidInFull = !params.amountPaise || params.amountPaise >= order.totalPaise;
            const nextStatus: B2bStatus = order.status === 'placed' ? 'paid' : order.status;
            await tx.update(b2bOrders).set({
                paymentStatus: paidInFull ? 'paid' : 'partially_paid', razorpayPaymentId: params.razorpayPaymentId,
                paidAt: new Date(), status: nextStatus, updatedAt: new Date(),
            }).where(eq(b2bOrders.id, order.id));
            await this.event(tx as any, order.id, {
                eventType: 'payment_received', fromStatus: order.status, toStatus: nextStatus, actorType: 'system',
                payload: { razorpayPaymentId: params.razorpayPaymentId, amountPaise: params.amountPaise ?? order.totalPaise, method: params.method ?? null },
            });
            // The ledger shows the sale and the payment so a statement reconciles;
            // net effect on the balance is zero for a prepaid order.
            await BusinessPartnerService.appendLedger(tx as any, {
                businessPartnerId: order.businessPartnerId, entryType: 'order_invoice', amountPaise: order.totalPaise, b2bOrderId: order.id,
                description: `Order ${order.orderCode}`,
            });
            await BusinessPartnerService.appendLedger(tx as any, {
                businessPartnerId: order.businessPartnerId, entryType: 'payment_received', amountPaise: -(params.amountPaise ?? order.totalPaise), b2bOrderId: order.id,
                description: `Payment for ${order.orderCode} (${params.razorpayPaymentId})`,
            });
            logger.info(`[B2B] ${order.orderCode} paid (${params.razorpayPaymentId})`);
            return { applied: true, orderId: order.id };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Transitions
    // ──────────────────────────────────────────────────────────────────────

    private static assertTransition(from: B2bStatus, to: B2bStatus) {
        if (!TRANSITIONS[from]?.includes(to)) {
            throw new B2bOrderError(`An order that is ${from} cannot become ${to}.`, 'BAD_TRANSITION');
        }
    }

    static async transition(orderId: number, to: B2bStatus, actor: { type: 'admin' | 'partner' | 'system'; id?: number | null }, payload?: Record<string, unknown> | null) {
        const updated = await withTransaction(async (tx) => {
            const [order] = await tx.select().from(b2bOrders).where(eq(b2bOrders.id, orderId)).for('update').limit(1);
            if (!order) return null;
            const from = order.status as B2bStatus;
            this.assertTransition(from, to);

            // A credit order can be confirmed unpaid; a prepaid one cannot leave 'placed' without money.
            if (order.paymentMode === 'prepaid' && order.paymentStatus === 'unpaid' && ['confirmed', 'packed', 'dispatched'].includes(to)) {
                throw new B2bOrderError('This prepaid order has not been paid yet.', 'UNPAID');
            }

            const patch: Partial<typeof b2bOrders.$inferInsert> = { status: to, updatedAt: new Date() };
            if (to === 'confirmed') { patch.confirmedAt = new Date(); patch.confirmedByAdminId = actor.id ?? null; }
            if (to === 'dispatched') { patch.dispatchedAt = new Date(); patch.dispatchedByAdminId = actor.id ?? null; }
            if (to === 'delivered') patch.deliveredAt = new Date();
            if (to === 'cancelled') { patch.cancelledAt = new Date(); patch.cancelReason = String(payload?.reason ?? '') || null; }

            // Dispatch is where stock leaves. Once per line, however many times pressed.
            if (to === 'dispatched') {
                const items = await tx.select().from(b2bOrderItems).where(eq(b2bOrderItems.orderId, orderId));
                for (const it of items) {
                    const toShip = it.quantity - it.quantityFulfilled;
                    if (toShip <= 0) continue;
                    const m = await SparePartsService.move(tx as any, {
                        sparePartId: it.sparePartId, movementType: 'sold_to_partner', delta: -toShip,
                        location: 'warehouse', fromLocation: 'warehouse', b2bOrderItemId: it.id,
                        performedByAdminId: actor.id ?? null, notes: `B2B ${order.orderCode}`, allowNegative: true,
                    });
                    if (m) await tx.update(b2bOrderItems).set({ quantityFulfilled: it.quantity }).where(eq(b2bOrderItems.id, it.id));
                }
            }
            if (to === 'returned') {
                const items = await tx.select().from(b2bOrderItems).where(eq(b2bOrderItems.orderId, orderId));
                for (const it of items) {
                    if (it.quantityFulfilled <= 0) continue;
                    await SparePartsService.move(tx as any, {
                        sparePartId: it.sparePartId, movementType: 'partner_return', delta: it.quantityFulfilled,
                        location: 'warehouse', toLocation: 'warehouse', b2bOrderItemId: it.id,
                        performedByAdminId: actor.id ?? null, notes: `Return of B2B ${order.orderCode}`,
                    });
                }
                await BusinessPartnerService.appendLedger(tx as any, {
                    businessPartnerId: order.businessPartnerId, entryType: 'credit_note', amountPaise: -order.totalPaise, b2bOrderId: order.id,
                    description: `Return accepted on ${order.orderCode}`, createdByAdminId: actor.id ?? null,
                });
            }
            if (to === 'cancelled') {
                if (order.paymentMode === 'credit' && from !== 'draft') {
                    // The invoice was written at placement; a credit note cancels it.
                    await BusinessPartnerService.appendLedger(tx as any, {
                        businessPartnerId: order.businessPartnerId, entryType: 'credit_note', amountPaise: -order.totalPaise, b2bOrderId: order.id,
                        description: `Cancelled ${order.orderCode}`, createdByAdminId: actor.id ?? null,
                    });
                }
                if (order.paymentMode === 'prepaid' && order.paymentStatus === 'paid' && order.razorpayPaymentId) {
                    // Money goes back the way it came.
                    try {
                        const rzp = await this.rzp();
                        await rzp.payments.refund(order.razorpayPaymentId, { amount: order.totalPaise, notes: { reason: 'b2b_order_cancelled', order: order.orderCode } } as any);
                        patch.paymentStatus = 'refunded';
                        await BusinessPartnerService.appendLedger(tx as any, {
                            businessPartnerId: order.businessPartnerId, entryType: 'refund', amountPaise: order.totalPaise, b2bOrderId: order.id,
                            description: `Refund for cancelled ${order.orderCode}`, createdByAdminId: actor.id ?? null,
                        });
                    } catch (err: any) {
                        logger.error(`[B2B] Razorpay refund failed for ${order.orderCode}: ${err?.message} — refund manually`);
                        payload = { ...(payload ?? {}), refundFailed: err?.message ?? 'unknown' };
                    }
                }
            }

            const [updated] = await tx.update(b2bOrders).set(patch).where(eq(b2bOrders.id, orderId)).returning();
            await this.event(tx as any, orderId, {
                eventType: to === 'cancelled' ? 'cancelled' : to === 'returned' ? 'returned' : to === 'delivered' ? 'delivered'
                    : to === 'dispatched' ? 'dispatched' : to === 'packed' ? 'packed' : to === 'confirmed' ? 'confirmed' : 'note',
                fromStatus: from, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, payload: payload ?? null,
            });
            logger.info(`[B2B] ${order.orderCode}: ${from} → ${to} by ${actor.type}${actor.id ? ` #${actor.id}` : ''}`);
            return updated;
        });

        // Tell the partner's phone, after commit and outside the transaction —
        // a push that fails must never roll back a dispatch. The partner's own
        // actions (cancel) are not echoed back to them.
        if (updated && actor.type !== 'partner') void this.notifyPartner(updated, to, payload);
        return updated;
    }

    /** Push to the business partner's mobile login, if it has one. Never throws. */
    private static async notifyPartner(order: B2bOrder, to: B2bStatus, payload?: Record<string, unknown> | null) {
        try {
            const bp = await BusinessPartnerService.byId(order.businessPartnerId);
            if (!bp?.userId) return;
            const text: Partial<Record<B2bStatus, [string, string]>> = {
                confirmed: ['Order confirmed', `${order.orderCode} is confirmed and being picked.`],
                packed: ['Order packed', `${order.orderCode} is packed and waiting for the courier.`],
                dispatched: ['Order dispatched', `${order.orderCode} is on its way${payload?.courier ? ` via ${payload.courier}` : ''}${payload?.trackingId ? ` (${payload.trackingId})` : ''}.`],
                delivered: ['Order delivered', `${order.orderCode} has been delivered. Check the goods and report any problem from the order page.`],
                cancelled: ['Order cancelled', `${order.orderCode} was cancelled by UniteFix${payload?.reason ? `: ${payload.reason}` : ''}.`],
                returned: ['Return accepted', `Your return on ${order.orderCode} is accepted and credited to your statement.`],
            };
            const t = text[to];
            if (!t) return;
            await NotificationService.sendToUser(bp.userId, t[0], t[1], 'b2b_order_update', { type: 'b2b_order_update', orderId: String(order.id), role: 'business_partner' });
        } catch (err: any) {
            logger.warn(`[B2B] partner push failed for ${order.orderCode}: ${err?.message}`);
        }
    }

    /** A partner may cancel only what UniteFix has not yet committed to. */
    static async partnerCancel(orderId: number, businessPartnerId: number, reason: string) {
        const [order] = await db.select().from(b2bOrders).where(and(eq(b2bOrders.id, orderId), eq(b2bOrders.businessPartnerId, businessPartnerId))).limit(1);
        if (!order) return null;
        if (!['placed', 'paid'].includes(order.status)) {
            throw new B2bOrderError('This order has been confirmed and can only be cancelled by UniteFix now.', 'TOO_LATE');
        }
        return this.transition(orderId, 'cancelled', { type: 'partner', id: businessPartnerId }, { reason });
    }

    static async partnerRequestReturn(orderId: number, businessPartnerId: number, reason: string) {
        return withTransaction(async (tx) => {
            const [order] = await tx.select().from(b2bOrders).where(and(eq(b2bOrders.id, orderId), eq(b2bOrders.businessPartnerId, businessPartnerId))).limit(1);
            if (!order) return null;
            if (order.status !== 'delivered') throw new B2bOrderError('Only a delivered order can be returned.', 'NOT_DELIVERED');
            await this.event(tx as any, orderId, { eventType: 'return_requested', actorType: 'partner', actorId: businessPartnerId, payload: { reason } });
            return order;
        });
    }

    static async addNote(orderId: number, actor: { type: 'admin' | 'partner'; id: number }, payload: Record<string, unknown>) {
        return withTransaction(async (tx) => this.event(tx as any, orderId, { eventType: 'note', actorType: actor.type, actorId: actor.id, payload }));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reads
    // ──────────────────────────────────────────────────────────────────────

    static async detail(orderId: number, businessPartnerId?: number) {
        const where = businessPartnerId ? and(eq(b2bOrders.id, orderId), eq(b2bOrders.businessPartnerId, businessPartnerId)) : eq(b2bOrders.id, orderId);
        const [order] = await db.select().from(b2bOrders).where(where).limit(1);
        if (!order) return null;
        const [items, events, partner] = await Promise.all([
            db.select().from(b2bOrderItems).where(eq(b2bOrderItems.orderId, orderId)).orderBy(b2bOrderItems.id),
            db.select().from(b2bOrderEvents).where(eq(b2bOrderEvents.orderId, orderId)).orderBy(b2bOrderEvents.createdAt),
            db.select({ code: businessPartners.partnerCode, name: businessPartners.displayName }).from(businessPartners).where(eq(businessPartners.id, order.businessPartnerId)).limit(1),
        ]);
        return { order, items, events, partner: partner[0] ?? null };
    }

    static async list(opts: { businessPartnerId?: number; status?: string; limit?: number }) {
        const where = [] as any[];
        if (opts.businessPartnerId) where.push(eq(b2bOrders.businessPartnerId, opts.businessPartnerId));
        if (opts.status && opts.status !== 'all') where.push(eq(b2bOrders.status, opts.status as any));
        return db.select({ order: b2bOrders, partnerCode: businessPartners.partnerCode, partnerName: businessPartners.displayName })
            .from(b2bOrders).innerJoin(businessPartners, eq(businessPartners.id, b2bOrders.businessPartnerId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(desc(b2bOrders.createdAt)).limit(Math.min(500, opts.limit ?? 100));
    }

    /**
     * Stage view for the tracking screen — the same three-to-six-step pattern
     * the recharge tracker uses, derived from status so it cannot disagree
     * with the order.
     */
    static stages(order: B2bOrder) {
        const seq: B2bStatus[] = order.paymentMode === 'prepaid'
            ? ['placed', 'paid', 'confirmed', 'dispatched', 'delivered']
            : ['placed', 'confirmed', 'dispatched', 'delivered'];
        const labels: Record<string, string> = {
            placed: 'Order placed', paid: 'Payment received', confirmed: 'Confirmed by UniteFix',
            packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered',
        };
        const rank = (s: string) => { const i = seq.indexOf(s as B2bStatus); return i < 0 ? (s === 'packed' ? seq.indexOf('confirmed') + 0.5 : -1) : i; };
        const current = rank(order.status);
        const terminal = order.status === 'cancelled' || order.status === 'returned';
        return {
            terminal, terminalLabel: terminal ? (order.status === 'cancelled' ? 'Cancelled' : 'Returned') : null,
            steps: seq.map((s, i) => ({ key: s, label: labels[s], done: !terminal && current >= i, current: !terminal && Math.floor(current) === i })),
        };
    }
}
