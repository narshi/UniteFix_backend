/**
 * Checkout: from a cart (or one item, "Buy now") to a Razorpay payment, with
 * the stock held while the customer pays.
 *
 *   start   one transaction, serialised per customer by an advisory lock:
 *           replay an Idempotency-Key, supersede the customer's other open
 *           checkout (one hold per customer), price on the server, insert the
 *           checkout, hold the stock. Then, outside the transaction, create
 *           the Razorpay order (a network call never holds a row lock).
 *   pay     the app's verify call, the webhook and the reconciliation job all
 *           land on MarketplaceService.applyCapture, which is idempotent.
 *   expire  holds end after STORE_HOLD_MINUTES; a payment that arrives later
 *           still succeeds if the stock is still free, else it is refunded.
 *
 * Many buyers, few units: holds are taken under a row lock on the stock row,
 * so the 11th buyer of 10 units is told "out of stock" before paying, not after.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { marketCheckouts, sellerOrders, users } from '@shared/schema';
import { GST_STATES } from '@shared/hub';
import { withTransaction } from '../../lib/transaction';
import { configService } from '../config.service';
import { HubError } from '../partner-hub.service';
import { MarketplaceService } from '../marketplace.service';
import { StorePricing, MAX_LINES, type QuoteItem, type QuoteLine } from './pricing.service';
import { StoreInventory } from './inventory.service';
import { StoreCart } from './cart.service';
import { StoreParcels } from './parcels.service';
import logger from '../../lib/logger';

const r2 = (p: number) => Math.round(p) / 100;
type Checkout = typeof marketCheckouts.$inferSelect;

export interface ShipTo { name: string; phone: string; line1: string; line2?: string | null; city: string; pincode: string; stateCode: string }
export interface StartInput { source: 'cart' | 'buy_now'; items?: QuoteItem[]; shipTo: ShipTo }

/** Test and local runs only: pay without Razorpay. Never in production. */
export const paymentsMocked = () => process.env.NODE_ENV !== 'production' && process.env.STORE_PAYMENTS_MOCK === '1';

export class StoreCheckout {

    static async holdMinutes() {
        const m = Number(await configService.get<number>('BUSINESS_CONFIG.STORE_HOLD_MINUTES', 15));
        return Math.min(60, Math.max(5, Number.isFinite(m) ? m : 15));
    }

    /** What is being bought: the cart, or the one "Buy now" item. */
    private static async itemsFor(userId: number, input: { source: 'cart' | 'buy_now'; items?: QuoteItem[] }, exec: typeof db = db): Promise<QuoteItem[]> {
        if (input.source === 'buy_now') {
            if (input.items?.length !== 1) throw new HubError('Buy now is for one item.', 'BAD_INPUT');
            return input.items;
        }
        const lines = await StoreCart.lines(userId, exec);
        if (!lines.length) throw new HubError('Your cart is empty.', 'EMPTY');
        return lines.map(l => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity }));
    }

    static summary(lines: QuoteLine[]) {
        const t = StorePricing.totals(lines);
        return {
            total: r2(t.totalPaise), tax: r2(t.taxPaise), savings: r2(t.savingsPaise),
            sellers: t.sellers.map(s => ({ name: s.sellerName, total: r2(s.totalPaise), items: s.items, isUnitefix: s.sellerPartnerId == null })),
            lines: lines.map(l => ({
                kind: l.kind, productId: l.productId, variantId: l.variantId, name: l.name, image: l.image, seller: l.sellerName,
                quantity: l.quantity, price: r2(l.unitPricePaise), mrp: l.mrpPaise != null ? r2(l.mrpPaise) : null, total: r2(l.totalPaise),
                gstRate: l.gstRate, returnWindowDays: l.returnWindowDays,
            })),
        };
    }

    /** The order summary before paying (no stock held). Says if anything is short. */
    static async preview(userId: number, input: { source: 'cart' | 'buy_now'; items?: QuoteItem[] }) {
        const items = await this.itemsFor(userId, input);
        const q = await StorePricing.quote(items);
        const goods = q.lines.filter(l => l.kind === 'goods');
        const avail = await StoreInventory.availability(db as any, goods);
        const short = goods.filter(l => (avail.get(StoreInventory.key(l)) ?? 0) < l.quantity).map(l => {
            const a = avail.get(StoreInventory.key(l)) ?? 0;
            return a > 0 ? `only ${a} of ${l.name} left` : `${l.name} is out of stock`;
        });
        return { ...this.summary(q.lines), stockIssues: short, multipleParcels: q.sellers.length > 1 };
    }

    /** Start paying. Same Idempotency-Key, same checkout: a retried tap never charges twice. */
    static async start(userId: number, input: StartInput, idempotencyKey?: string | null) {
        const ship = this.validShip(input.shipTo);
        await StoreParcels.checkDestination(ship.pincode, ship.stateCode);
        const key = idempotencyKey?.trim() || null;
        if (key && !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HubError('Idempotency-Key must be 8–80 letters, digits, - or _.', 'BAD_INPUT');
        const holdMin = await this.holdMinutes();
        const [u] = await db.select({ username: users.username, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);

        const { checkout, replay } = await withTransaction(async (tx) => {
            // One checkout start at a time per customer: a double tap, two devices, a retry.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(4242, ${userId})`);
            if (key) {
                const [existing] = await tx.select().from(marketCheckouts).where(and(eq(marketCheckouts.userId, userId), eq(marketCheckouts.idempotencyKey, key))).limit(1);
                if (existing) return { checkout: existing, replay: true };
            }
            const items = await this.itemsFor(userId, input, tx);
            if (items.length > MAX_LINES) throw new HubError(`At most ${MAX_LINES} different items in one order.`, 'TOO_MANY');
            const q = await StorePricing.quote(items, tx);

            // One live hold per customer: an earlier unpaid checkout gives its stock back.
            // (If it is paid after all, capture still succeeds while stock lasts.)
            const open = await tx.select({ id: marketCheckouts.id }).from(marketCheckouts).where(and(eq(marketCheckouts.userId, userId), eq(marketCheckouts.status, 'pending')));
            for (const o of open) {
                await StoreInventory.release(tx as any, o.id);
                await tx.update(marketCheckouts).set({ status: 'superseded' }).where(and(eq(marketCheckouts.id, o.id), eq(marketCheckouts.status, 'pending')));
            }

            const expiresAt = new Date(Date.now() + holdMin * 60_000);
            const [c] = await tx.insert(marketCheckouts).values({
                userId, amountPaise: q.totalPaise, lines: q.lines as any, status: 'pending',
                address: [ship.line1, ship.line2, ship.city, `${GST_STATES[ship.stateCode]} ${ship.pincode}`].filter(Boolean).join(', ').slice(0, 500),
                pincode: ship.pincode, shipStateCode: ship.stateCode,
                customerName: ship.name || u?.username || null, customerPhone: ship.phone || (u?.phone ?? '').replace(/\D/g, '').slice(-10) || null,
                idempotencyKey: key, source: input.source, expiresAt,
            }).returning();
            await StoreInventory.reserve(tx as any, c.id, q.lines.filter(l => l.kind === 'goods').map(l => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, name: l.name })), expiresAt);
            return { checkout: c, replay: false };
        }, 'store checkout start');

        if (checkout.status === 'paid') return this.payload(checkout, replay);
        if (checkout.status !== 'pending') throw new HubError('This checkout has ended. Start again.', 'CHECKOUT_ENDED', 409);
        const ready = await this.ensureGatewayOrder(checkout);
        if (!replay) logger.info(`[STORE] Checkout #${ready.id} by user #${userId}: ₹${r2(ready.amountPaise)}, ${(ready.lines as any[]).length} line(s), held ${holdMin} min`);
        return this.payload(ready, replay);
    }

    private static validShip(s: ShipTo): ShipTo {
        const phone = String(s?.phone ?? '').replace(/\D/g, '').slice(-10);
        if (!s?.name?.trim()) throw new HubError('Add the name to deliver to.', 'NO_ADDRESS');
        if (!/^[6-9]\d{9}$/.test(phone)) throw new HubError('Add a 10-digit mobile number for the delivery.', 'NO_ADDRESS');
        if (!s.line1?.trim() || !s.city?.trim()) throw new HubError('Add the delivery address and city.', 'NO_ADDRESS');
        if (!/^[1-9]\d{5}$/.test(s.pincode ?? '')) throw new HubError('Add a 6-digit pincode.', 'NO_ADDRESS');
        if (!GST_STATES[s.stateCode]) throw new HubError('Choose the state.', 'NO_ADDRESS');
        return { name: s.name.trim().slice(0, 120), phone, line1: s.line1.trim().slice(0, 200), line2: s.line2?.trim().slice(0, 200) || null, city: s.city.trim().slice(0, 80), pincode: s.pincode, stateCode: s.stateCode };
    }

    /** Create the Razorpay order once (a race keeps the first). On failure the stock goes back. */
    private static async ensureGatewayOrder(c: Checkout): Promise<Checkout> {
        if (c.razorpayOrderId || paymentsMocked()) return c;
        const rzp = MarketplaceService.rzp();
        const fail = async (reason: string) => {
            await withTransaction(async (tx) => {
                await StoreInventory.release(tx as any, c.id);
                await tx.update(marketCheckouts).set({ status: 'failed', failureReason: reason.slice(0, 300) }).where(and(eq(marketCheckouts.id, c.id), eq(marketCheckouts.status, 'pending')));
            });
        };
        if (!rzp) { await fail('payments not configured'); throw new HubError('Online payment is not available right now. Try again later.', 'PAYMENTS_OFF', 503); }
        try {
            const ro: any = await rzp.orders.create({ amount: c.amountPaise, currency: 'INR', receipt: `mkt_${c.id}`, notes: { payment_type: 'marketplace_order', market_checkout_id: String(c.id), customer_id: String(c.userId) } });
            const [won] = await db.update(marketCheckouts).set({ razorpayOrderId: ro.id }).where(and(eq(marketCheckouts.id, c.id), sql`${marketCheckouts.razorpayOrderId} IS NULL`)).returning();
            if (won) return won;
            const [now] = await db.select().from(marketCheckouts).where(eq(marketCheckouts.id, c.id)).limit(1);
            return now;
        } catch (e: any) {
            logger.error(`[STORE] Razorpay order for checkout #${c.id} failed: ${e?.message ?? e?.error?.description}`);
            await fail(`gateway: ${e?.message ?? 'error'}`);
            throw new HubError('Could not start the payment. Try again.', 'GATEWAY', 502);
        }
    }

    private static payload(c: Checkout, replay: boolean) {
        const lines = c.lines as QuoteLine[];
        return {
            checkoutId: c.id, status: c.status, replay, expiresAt: c.expiresAt,
            ...this.summary(lines),
            payment: paymentsMocked() && !c.razorpayOrderId
                ? { provider: 'mock' as const }
                : { provider: 'razorpay' as const, orderId: c.razorpayOrderId, keyId: process.env.RAZORPAY_KEY_ID ?? null, amountPaise: c.amountPaise, currency: 'INR', prefill: { name: c.customerName, contact: c.customerPhone } },
        };
    }

    /** The app's call after Razorpay's success callback. */
    static async verify(userId: number, checkoutId: number, b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
        if (!MarketplaceService.verifySignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new HubError('Payment could not be verified.', 'BAD_SIGNATURE', 400);
        return this.result(await MarketplaceService.applyCapture({ checkoutId, razorpayOrderId: b.razorpay_order_id, razorpayPaymentId: b.razorpay_payment_id, userId }));
    }

    /** Tests and local runs: mark paid without Razorpay. */
    static async mockPay(userId: number, checkoutId: number) {
        if (!paymentsMocked()) throw new HubError('Not found', 'NOT_FOUND', 404);
        return this.result(await MarketplaceService.applyCapture({ checkoutId, razorpayPaymentId: `pay_mock_${checkoutId}_${Date.now().toString(36)}`, userId }));
    }

    private static async result(r: any) {
        if (r.soldOut) return { status: 'refund_due' as const, message: `${r.soldOut} sold out while you paid. Your payment is being refunded in full.`, orders: [] };
        const rows = await db.select({ id: sellerOrders.id, code: sellerOrders.code }).from(sellerOrders).where(eq(sellerOrders.checkoutId, r.checkout.id));
        return { status: 'paid' as const, message: 'Order placed.', orders: rows };
    }

    /** For the app after payment: is my order in? (If verify failed on a bad network, the webhook may already have placed it.) */
    static async status(userId: number, checkoutId: number) {
        const [c] = await db.select().from(marketCheckouts).where(and(eq(marketCheckouts.id, checkoutId), eq(marketCheckouts.userId, userId))).limit(1);
        if (!c) throw new HubError('Not found', 'NOT_FOUND', 404);
        const orders = c.status === 'paid' ? await db.select({ id: sellerOrders.id, code: sellerOrders.code }).from(sellerOrders).where(eq(sellerOrders.checkoutId, c.id)) : [];
        return { checkoutId: c.id, status: c.status, total: r2(c.amountPaise), expiresAt: c.expiresAt, failureReason: c.status === 'refund_due' ? c.failureReason : null, orders };
    }

    /** The customer closed the payment sheet: give the stock back now rather than at expiry. */
    static async abandon(userId: number, checkoutId: number) {
        await withTransaction(async (tx) => {
            const [c] = await tx.select().from(marketCheckouts).where(and(eq(marketCheckouts.id, checkoutId), eq(marketCheckouts.userId, userId))).for('update');
            if (!c || c.status !== 'pending') return;
            await StoreInventory.release(tx as any, c.id);
            await tx.update(marketCheckouts).set({ status: 'abandoned' }).where(eq(marketCheckouts.id, c.id));
        });
    }

    // ── Jobs ─────────────────────────────────────────────────────────────

    /** Holds past their time go back on the shelf; their checkouts are marked expired. */
    static async expireHolds() {
        const r: any = await db.execute(sql`
            UPDATE store_stock_reservations SET status = 'released', released_at = NOW()
            WHERE status = 'held' AND expires_at <= NOW()`);
        const c: any = await db.execute(sql`
            UPDATE market_checkouts SET status = 'expired'
            WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= NOW() - INTERVAL '2 minutes'`);
        const released = r?.rowCount ?? 0, expired = c?.rowCount ?? 0;
        if (released || expired) logger.info(`[STORE] Released ${released} expired hold(s); ${expired} checkout(s) expired`);
        return { released, expired };
    }

    /**
     * A payment the app never confirmed and the webhook never delivered: ask
     * Razorpay about recent unpaid checkouts and apply any captured payment.
     * applyCapture is idempotent, so overlapping with the webhook is harmless.
     */
    static async reconcile() {
        const rzp = MarketplaceService.rzp();
        if (!rzp) return { checked: 0, applied: 0 };
        const rows = await db.select().from(marketCheckouts).where(and(
            inArray(marketCheckouts.status, ['pending', 'expired', 'superseded', 'abandoned']),
            sql`${marketCheckouts.razorpayOrderId} IS NOT NULL`,
            sql`${marketCheckouts.createdAt} > NOW() - INTERVAL '48 hours'`,
            sql`${marketCheckouts.createdAt} < NOW() - INTERVAL '3 minutes'`,
        )).orderBy(desc(marketCheckouts.createdAt)).limit(100);
        let applied = 0;
        for (const c of rows) {
            try {
                const res: any = await rzp.orders.fetchPayments(c.razorpayOrderId!);
                const paid = (res?.items ?? []).find((p: any) => p.status === 'captured');
                if (!paid) continue;
                await MarketplaceService.applyCapture({ checkoutId: c.id, razorpayOrderId: c.razorpayOrderId, razorpayPaymentId: paid.id, amountPaise: paid.amount });
                applied++;
                logger.warn(`[STORE] Reconciled checkout #${c.id}: payment ${paid.id} had not been applied`);
            } catch (e: any) {
                logger.error(`[STORE] Reconcile checkout #${c.id}: ${e?.message ?? e?.error?.description}`);
            }
        }
        return { checked: rows.length, applied };
    }

    /** Receipt vouchers that were not issued right after payment (a failure then) are issued now. */
    static async backfillVouchers() {
        const rows: any = await db.execute(sql`SELECT id FROM seller_orders WHERE receipt_voucher_document_id IS NULL AND created_at > NOW() - INTERVAL '30 days' AND created_at < NOW() - INTERVAL '5 minutes' LIMIT 200`);
        const ids = (Array.isArray(rows) ? rows : rows?.rows ?? []).map((r: any) => Number(r.id));
        return ids.length ? MarketplaceService.issueReceiptVouchers(ids) : 0;
    }
}
