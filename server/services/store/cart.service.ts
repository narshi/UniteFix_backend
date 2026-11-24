/**
 * The customer's cart, kept on the server so it follows them across devices
 * and so checkout can trust it. One row per product (and option); adding the
 * same thing again raises the quantity in a single atomic upsert, so two taps
 * at once never make two rows or lose an increment.
 *
 * Adding checks the item is on sale and in stock now, but holds nothing:
 * stock is held only at checkout. Reading the cart re-prices every line and
 * says what changed (price, stock, no longer sold) beside it.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { storeCartLines } from '@shared/schema';
import { withTransaction } from '../../lib/transaction';
import { HubError } from '../partner-hub.service';
import { StorePricing, MAX_LINES, MAX_QTY, type QuoteLine } from './pricing.service';
import { StoreInventory } from './inventory.service';

const r2 = (p: number) => Math.round(p) / 100;

export class StoreCart {

    static async lines(userId: number, exec: typeof db = db) {
        return exec.select().from(storeCartLines).where(eq(storeCartLines.userId, userId)).orderBy(storeCartLines.createdAt, storeCartLines.id);
    }

    /** The cart as the app shows it: current prices, availability and any problem per line. */
    static async view(userId: number) {
        const rows = await this.lines(userId);
        const ev = await StorePricing.evaluate(rows.map(r => ({ productId: r.productId, variantId: r.variantId, quantity: r.quantity })));
        const avail = await StoreInventory.availability(db as any, rows.map(r => ({ productId: r.productId, variantId: r.variantId })));
        const out = rows.map(r => {
            const e = ev.find(x => x.item.productId === r.productId && (x.item.variantId ?? null) === (r.variantId ?? null));
            const line: QuoteLine | undefined = e?.lines.find(l => l.kind === 'goods');
            const available = avail.get(StoreInventory.key(r)) ?? 0;
            let issue = e?.issue ?? null;
            if (!issue && available < r.quantity) issue = available > 0 ? { code: 'LOW_STOCK', message: `Only ${available} left. Lower the quantity to buy.` } : { code: 'OUT_OF_STOCK', message: 'Out of stock.' };
            return {
                id: r.id, productId: r.productId, variantId: r.variantId, quantity: r.quantity, available,
                name: line?.name ?? null, image: line?.image ?? null, seller: line?.sellerName ?? null, sellerPartnerId: line?.sellerPartnerId ?? null,
                price: line ? r2(line.unitPricePaise) : null, mrp: line?.mrpPaise != null ? r2(line.mrpPaise) : null, lineTotal: line ? r2(line.totalPaise) : null,
                priceChanged: !!line && r.pricePaiseSeen != null && r.pricePaiseSeen !== line.unitPricePaise,
                previousPrice: line && r.pricePaiseSeen != null && r.pricePaiseSeen !== line.unitPricePaise ? r2(r.pricePaiseSeen) : null,
                issue, _line: issue ? null : line,
            };
        });
        const buyable = out.filter(l => l._line).map(l => l._line!);
        const t = StorePricing.totals(buyable);
        return {
            lines: out.map(({ _line, ...l }) => l),
            count: out.reduce((a, l) => a + l.quantity, 0),
            total: r2(t.totalPaise), tax: r2(t.taxPaise), savings: r2(t.savingsPaise),
            sellers: t.sellers.map(s => ({ name: s.sellerName, total: r2(s.totalPaise), items: s.items })),
            canCheckout: out.length > 0 && out.every(l => !l.issue),
        };
    }

    /** Add (or add more of) an item. Returns the new cart. */
    static async add(userId: number, input: { productId: number; variantId?: number | null; quantity: number }) {
        const qty = Math.floor(Number(input.quantity));
        if (!(qty >= 1 && qty <= MAX_QTY)) throw new HubError(`Quantity is 1 to ${MAX_QTY}.`, 'BAD_QTY');
        const [e] = await StorePricing.evaluate([{ productId: input.productId, variantId: input.variantId ?? null, quantity: qty }]);
        if (!e || e.issue) throw new HubError(e?.issue?.message ?? 'This product is no longer sold.', e?.issue?.code ?? 'GONE', 409);
        const line = e.lines[0];
        await withTransaction(async (tx) => {
            // One cart per customer at a time: two adds from two devices queue here.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(4243, ${userId})`);
            const existing = await this.lines(userId, tx);
            const same = existing.find(l => l.productId === line.productId && (l.variantId ?? null) === line.variantId);
            if (!same && existing.length >= MAX_LINES) throw new HubError(`Your cart holds at most ${MAX_LINES} different items.`, 'CART_FULL', 409);
            const want = Math.min(MAX_QTY, (same?.quantity ?? 0) + qty);
            const avail = (await StoreInventory.availability(tx as any, [{ productId: line.productId, variantId: line.variantId }])).get(StoreInventory.key(line)) ?? 0;
            if (avail <= 0) throw new HubError(`${line.name} is out of stock.`, 'OUT_OF_STOCK', 409);
            if (want > avail) throw new HubError(`Only ${avail} of ${line.name} left${same ? ` (you have ${same.quantity} in your cart)` : ''}.`, 'LOW_STOCK', 409);
            await tx.execute(sql`
                INSERT INTO store_cart_lines (user_id, product_id, variant_id, quantity, price_paise_seen)
                VALUES (${userId}, ${line.productId}, ${line.variantId}, ${qty}, ${line.unitPricePaise})
                ON CONFLICT (user_id, product_id, (COALESCE(variant_id, 0)))
                DO UPDATE SET quantity = LEAST(store_cart_lines.quantity + EXCLUDED.quantity, ${MAX_QTY}),
                              price_paise_seen = EXCLUDED.price_paise_seen, updated_at = NOW()`);
        });
        return this.view(userId);
    }

    /** Set a line's quantity; 0 removes it. */
    static async setQuantity(userId: number, lineId: number, quantity: number) {
        const qty = Math.floor(Number(quantity));
        if (!(qty >= 0 && qty <= MAX_QTY)) throw new HubError(`Quantity is 0 to ${MAX_QTY}.`, 'BAD_QTY');
        const [l] = await db.select().from(storeCartLines).where(and(eq(storeCartLines.id, lineId), eq(storeCartLines.userId, userId))).limit(1);
        if (!l) throw new HubError('That item is not in your cart.', 'NOT_FOUND', 404);
        if (qty === 0) {
            await db.delete(storeCartLines).where(eq(storeCartLines.id, l.id));
        } else {
            if (qty > l.quantity) {
                const avail = (await StoreInventory.availability(db as any, [{ productId: l.productId, variantId: l.variantId }])).get(StoreInventory.key(l)) ?? 0;
                if (qty > avail) throw new HubError(avail > 0 ? `Only ${avail} left.` : 'Out of stock.', avail > 0 ? 'LOW_STOCK' : 'OUT_OF_STOCK', 409);
            }
            // Seeing the new price is accepting it: the line stops saying "price changed".
            const [e] = await StorePricing.evaluate([{ productId: l.productId, variantId: l.variantId, quantity: qty }]);
            const seen = e?.lines[0]?.unitPricePaise ?? l.pricePaiseSeen;
            await db.update(storeCartLines).set({ quantity: qty, pricePaiseSeen: seen, updatedAt: new Date() }).where(eq(storeCartLines.id, l.id));
        }
        return this.view(userId);
    }

    static async remove(userId: number, lineId: number) {
        await db.delete(storeCartLines).where(and(eq(storeCartLines.id, lineId), eq(storeCartLines.userId, userId)));
        return this.view(userId);
    }

    static async clear(userId: number) {
        await db.delete(storeCartLines).where(eq(storeCartLines.userId, userId));
    }

    /** After a paid cart checkout: take out what was bought (only up to the quantity bought). */
    static async removeBought(tx: typeof db, userId: number, bought: Array<{ productId: number; variantId: number | null; quantity: number }>) {
        for (const b of bought) {
            await tx.execute(sql`
                DELETE FROM store_cart_lines WHERE user_id = ${userId} AND product_id = ${b.productId} AND COALESCE(variant_id, 0) = ${b.variantId ?? 0} AND quantity <= ${b.quantity}`);
            await tx.execute(sql`
                UPDATE store_cart_lines SET quantity = quantity - ${b.quantity}, updated_at = NOW()
                WHERE user_id = ${userId} AND product_id = ${b.productId} AND COALESCE(variant_id, 0) = ${b.variantId ?? 0} AND quantity > ${b.quantity}`);
        }
    }
}
