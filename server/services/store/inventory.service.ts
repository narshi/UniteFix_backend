/**
 * Store stock: on-hand stock lives on the product (or its variant); while a
 * customer pays, the quantity is held for them in store_stock_reservations.
 *
 *   available = on-hand − active holds of other checkouts
 *
 * Correctness under many buyers at once comes from one rule: every read that
 * decides "is there enough" happens after locking the stock row
 * (SELECT … FOR UPDATE), and rows are always locked in the same order
 * (product id, then variant id) so two checkouts can never deadlock.
 *
 * A hold that has passed its expiry no longer counts, whether or not the
 * cleanup job has marked it released yet — so a stuck job never blocks sales.
 */

import { sql } from 'drizzle-orm';
import { HubError } from '../partner-hub.service';

type Tx = { execute: (q: any) => Promise<any> };

export interface StockLine { productId: number; variantId: number | null; quantity: number; name: string }

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const keyOf = (l: { productId: number; variantId: number | null }) => `${l.productId}:${l.variantId ?? 0}`;

/** Same item twice (two cart lines of one product) is one stock line. Sorted: the lock order. */
export function mergeStockLines(lines: StockLine[]): StockLine[] {
    const by = new Map<string, StockLine>();
    for (const l of lines) {
        const k = keyOf(l);
        const a = by.get(k);
        if (a) a.quantity += l.quantity; else by.set(k, { ...l });
    }
    return Array.from(by.values()).sort((a, b) => a.productId - b.productId || (a.variantId ?? 0) - (b.variantId ?? 0));
}

export class StoreInventory {

    /** Lock the stock row of one item and return its on-hand quantity (null when the item is gone). */
    private static async lockOnHand(tx: Tx, l: StockLine): Promise<number | null> {
        const r = l.variantId
            ? await tx.execute(sql`SELECT stock FROM product_variants WHERE id = ${l.variantId} AND product_id = ${l.productId} FOR UPDATE`)
            : await tx.execute(sql`SELECT stock FROM products WHERE id = ${l.productId} FOR UPDATE`);
        const row = rowsOf(r)[0];
        return row ? Number(row.stock ?? 0) : null;
    }

    /** Quantity other checkouts hold on an item right now. */
    private static async heldByOthers(tx: Tx, l: StockLine, checkoutId: number): Promise<number> {
        const r = await tx.execute(sql`
            SELECT COALESCE(SUM(quantity), 0)::int AS n FROM store_stock_reservations
            WHERE product_id = ${l.productId} AND COALESCE(variant_id, 0) = ${l.variantId ?? 0}
              AND status = 'held' AND expires_at > NOW() AND checkout_id <> ${checkoutId}`);
        return Number(rowsOf(r)[0]?.n ?? 0);
    }

    /**
     * Hold stock for a checkout. All or nothing: if any item is short, nothing
     * is held and the error names every short item with what is left.
     */
    static async reserve(tx: Tx, checkoutId: number, lines: StockLine[], expiresAt: Date) {
        const merged = mergeStockLines(lines);
        const short: string[] = [];
        for (const l of merged) {
            const onHand = await this.lockOnHand(tx, l);
            if (onHand == null) { short.push(`${l.name} is no longer sold`); continue; }
            const available = onHand - await this.heldByOthers(tx, l, checkoutId);
            if (available < l.quantity) short.push(available > 0 ? `only ${available} of ${l.name} left` : `${l.name} is out of stock`);
        }
        if (short.length) throw new HubError(`Not enough stock: ${short.join('; ')}.`, 'OUT_OF_STOCK', 409);
        for (const l of merged) {
            await tx.execute(sql`
                INSERT INTO store_stock_reservations (checkout_id, product_id, variant_id, quantity, status, expires_at)
                VALUES (${checkoutId}, ${l.productId}, ${l.variantId}, ${l.quantity}, 'held', ${expiresAt})`);
        }
    }

    /**
     * The customer paid: take the stock. Works whether this checkout's hold is
     * still live or has lapsed — what matters is that, with the row locked,
     * on-hand minus everyone else's live holds still covers the quantity.
     * Returns the first item that could not be covered (and takes nothing).
     */
    static async consume(tx: Tx, checkoutId: number, lines: StockLine[]): Promise<{ ok: true } | { ok: false; name: string }> {
        const merged = mergeStockLines(lines);
        for (const l of merged) {
            const onHand = await this.lockOnHand(tx, l);
            const available = onHand == null ? -1 : onHand - await this.heldByOthers(tx, l, checkoutId);
            if (available < l.quantity) return { ok: false, name: l.name };
        }
        for (const l of merged) {
            if (l.variantId) await tx.execute(sql`UPDATE product_variants SET stock = stock - ${l.quantity}, updated_at = NOW() WHERE id = ${l.variantId}`);
            else await tx.execute(sql`UPDATE products SET stock = stock - ${l.quantity}, updated_at = NOW() WHERE id = ${l.productId}`);
        }
        await tx.execute(sql`UPDATE store_stock_reservations SET status = 'consumed', released_at = NOW() WHERE checkout_id = ${checkoutId} AND status = 'held'`);
        return { ok: true };
    }

    /** Give back a checkout's holds (payment failed, abandoned, replaced). Idempotent. */
    static async release(tx: Tx, checkoutId: number) {
        await tx.execute(sql`UPDATE store_stock_reservations SET status = 'released', released_at = NOW() WHERE checkout_id = ${checkoutId} AND status = 'held'`);
    }

    /** Stock back on the shelf after a cancellation or a received return. */
    static async restock(tx: Tx, lines: Array<{ productId: number; variantId: number | null; quantity: number }>) {
        for (const l of mergeStockLines(lines.map(x => ({ ...x, name: '' })))) {
            if (l.variantId) await tx.execute(sql`UPDATE product_variants SET stock = stock + ${l.quantity}, updated_at = NOW() WHERE id = ${l.variantId}`);
            else await tx.execute(sql`UPDATE products SET stock = stock + ${l.quantity}, updated_at = NOW() WHERE id = ${l.productId}`);
        }
    }

    /** Available quantity per item, for display (no locks: a hint, never a promise). */
    static async availability(exec: Tx, items: Array<{ productId: number; variantId: number | null }>): Promise<Map<string, number>> {
        const out = new Map<string, number>();
        if (!items.length) return out;
        const pids = Array.from(new Set(items.map(i => i.productId)));
        const vids = Array.from(new Set(items.map(i => i.variantId).filter((v): v is number => v != null)));
        const p = rowsOf(await exec.execute(sql`SELECT id, stock FROM products WHERE id IN (${sql.join(pids.map(id => sql`${id}`), sql`, `)})`));
        const v = vids.length ? rowsOf(await exec.execute(sql`SELECT id, stock FROM product_variants WHERE id IN (${sql.join(vids.map(id => sql`${id}`), sql`, `)})`)) : [];
        const held = rowsOf(await exec.execute(sql`
            SELECT product_id, COALESCE(variant_id, 0) AS variant_id, SUM(quantity)::int AS n FROM store_stock_reservations
            WHERE status = 'held' AND expires_at > NOW() AND product_id IN (${sql.join(pids.map(id => sql`${id}`), sql`, `)})
            GROUP BY product_id, COALESCE(variant_id, 0)`));
        const heldBy = new Map(held.map(h => [`${h.product_id}:${h.variant_id}`, Number(h.n)]));
        for (const i of items) {
            const k = keyOf(i);
            const onHand = i.variantId ? Number(v.find(r => Number(r.id) === i.variantId)?.stock ?? 0) : Number(p.find(r => Number(r.id) === i.productId)?.stock ?? 0);
            out.set(k, Math.max(0, onHand - (heldBy.get(k) ?? 0)));
        }
        return out;
    }

    static key = keyOf;
}
