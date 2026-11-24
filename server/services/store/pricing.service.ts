/**
 * Store pricing: the one place that turns "these products, these quantities"
 * into priced, taxed lines. Always computed from the database, never from
 * what the app sends; the cart, buy now and checkout all go through here.
 *
 * A product is on sale only when it is active and live, its seller (if a
 * partner) is active, and it carries what a compliant invoice needs: an HSN
 * code and a GST rate, and a sale price not above its MRP (Legal Metrology).
 * UniteFix's own products have seller_partner_id NULL.
 *
 * Money: product prices are whole rupees, variant prices are paise (as the
 * catalogue stores them); every line here is in paise, GST-inclusive.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { products, productVariants, businessPartners } from '@shared/schema';
import { HubError } from '../partner-hub.service';
import { GST_RATES } from '../partner-sales.service';
import { loadSellerDetails } from '../invoice-generator';
import logger from '../../lib/logger';

export const MAX_LINES = 30;
export const MAX_QTY = 20;

export interface QuoteItem { productId: number; variantId?: number | null; quantity: number; withInstallation?: boolean }

export interface QuoteLine {
    kind: 'goods' | 'installation';
    productId: number; variantId: number | null; variantLabel: string | null;
    sellerPartnerId: number | null; sellerName: string;
    name: string; image: string | null; categoryId: number | null;
    quantity: number; unitPricePaise: number; mrpPaise: number | null;
    gstRate: number; hsnCode: string | null;
    taxablePaise: number; taxPaise: number; totalPaise: number;
    returnWindowDays: number;
}

export interface Evaluated { item: QuoteItem; lines: QuoteLine[]; issue: { code: string; message: string } | null }

type Exec = typeof db;

/** Same product, variant and installation choice asked twice: one line. */
export function mergeItems(items: QuoteItem[]): QuoteItem[] {
    const by = new Map<string, QuoteItem>();
    for (const i of items) {
        const k = `${i.productId}:${i.variantId ?? 0}:${i.withInstallation ? 1 : 0}`;
        const a = by.get(k);
        if (a) a.quantity += i.quantity; else by.set(k, { ...i, variantId: i.variantId ?? null });
    }
    return Array.from(by.values());
}

export class StorePricing {

    /** UniteFix as a seller: the name customers see. */
    static async unitefixName() {
        return (await loadSellerDetails()).name || 'UniteFix';
    }

    /**
     * Price each item, or say why it can't be bought. Never throws for an
     * item problem: the cart shows the reason beside the line.
     */
    static async evaluate(items: QuoteItem[], exec: Exec = db): Promise<Evaluated[]> {
        const merged = mergeItems(items);
        if (!merged.length) return [];
        const ids = Array.from(new Set(merged.map(i => i.productId)));
        const rows = await exec.select({ p: products, bp: businessPartners }).from(products)
            .leftJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId)).where(inArray(products.id, ids));
        const variants = await exec.select().from(productVariants).where(inArray(productVariants.productId, ids));
        const byId = new Map(rows.map(r => [r.p.id, r]));
        const ufName = await this.unitefixName();

        return merged.map((item): Evaluated => {
            const bad = (code: string, message: string): Evaluated => ({ item, lines: [], issue: { code, message } });
            const q = Math.floor(Number(item.quantity));
            if (!(q >= 1 && q <= MAX_QTY)) return bad('BAD_QTY', `Quantity is 1 to ${MAX_QTY}.`);
            const r = byId.get(item.productId);
            if (!r) return bad('GONE', 'This product is no longer sold.');
            const p = r.p;
            if (!p.isActive || p.listingStatus !== 'live' || (p.sellerPartnerId != null && r.bp?.status !== 'active')) return bad('GONE', `${p.name} is not on sale right now.`);
            const gst = p.gstPercent == null ? null : Number(p.gstPercent);
            if (!p.hsnCode || gst == null || !GST_RATES.includes(gst)) {
                logger.warn(`[STORE] Product #${p.id} "${p.name}" is active but has no HSN/GST rate; it cannot be invoiced, so it is not sold.`);
                return bad('GONE', `${p.name} is not on sale right now.`);
            }
            const live = variants.filter(v => v.productId === p.id && v.isActive);
            let v: typeof variants[number] | undefined;
            if (live.length) {
                if (!item.variantId) return bad('CHOOSE_VARIANT', `Choose an option for ${p.name}.`);
                v = live.find(x => x.id === item.variantId);
                if (!v) return bad('GONE', `That option of ${p.name} is no longer sold.`);
            } else if (item.variantId) {
                return bad('GONE', `That option of ${p.name} is no longer sold.`);
            }
            const unit = v ? v.price : p.price * 100;
            const mrp = v ? (v.mrp ?? (p.mrp != null ? p.mrp * 100 : null)) : (p.mrp != null ? p.mrp * 100 : null);
            if (!(unit > 0)) return bad('GONE', `${p.name} is not on sale right now.`);
            if (mrp != null && unit > mrp) {
                logger.warn(`[STORE] Product #${p.id}${v ? ` variant #${v.id}` : ''}: price above MRP; not sold.`);
                return bad('GONE', `${p.name} is not on sale right now.`);
            }
            const gross = unit * q, taxable = Math.round(gross * 100 / (100 + gst));
            const images = (p.images ?? []) as string[];
            const goods: QuoteLine = {
                kind: 'goods', productId: p.id, variantId: v?.id ?? null, variantLabel: v?.variantLabel ?? null,
                sellerPartnerId: p.sellerPartnerId ?? null, sellerName: p.sellerPartnerId ? (r.bp?.displayName ?? 'Seller') : ufName,
                name: v ? `${p.name} (${v.variantLabel})` : p.name, image: p.thumbnailUrl ?? images[0] ?? null, categoryId: p.categoryId ?? null,
                quantity: q, unitPricePaise: unit, mrpPaise: mrp, gstRate: gst, hsnCode: p.hsnCode,
                taxablePaise: taxable, taxPaise: gross - taxable, totalPaise: gross, returnWindowDays: Number(p.returnWindowDays ?? 0),
            };
            if (!item.withInstallation) return { item, lines: [goods], issue: null };
            if (!p.installationPricePaise) return bad('NO_INSTALL', `${p.name} is not offered with installation.`);
            // A separate service at its own price: SAC and 18% GST, never the goods' rate.
            const ig = p.installationPricePaise * q, it = Math.round(ig * 100 / 118);
            return { item, issue: null, lines: [goods, { ...goods, kind: 'installation', name: `Installation — ${p.name}`, unitPricePaise: p.installationPricePaise, mrpPaise: null, gstRate: 18, hsnCode: p.installationSac || '9987', taxablePaise: it, taxPaise: ig - it, totalPaise: ig }] };
        });
    }

    /** Price a whole order; any item that can't be bought stops it with that item's reason. */
    static async quote(items: QuoteItem[], exec: Exec = db) {
        const merged = mergeItems(items);
        if (!merged.length) throw new HubError('Your cart is empty.', 'EMPTY');
        if (merged.length > MAX_LINES) throw new HubError(`At most ${MAX_LINES} different items in one order.`, 'TOO_MANY');
        const ev = await this.evaluate(merged, exec);
        const firstBad = ev.find(e => e.issue);
        if (firstBad) throw new HubError(firstBad.issue!.message, firstBad.issue!.code, 409);
        const lines = ev.flatMap(e => e.lines);
        return { lines, ...this.totals(lines) };
    }

    static totals(lines: QuoteLine[]) {
        const keys = Array.from(new Set(lines.map(l => l.sellerPartnerId ?? 0)));
        const sellers = keys.map(k => {
            const mine = lines.filter(l => (l.sellerPartnerId ?? 0) === k);
            return { sellerPartnerId: k === 0 ? null : k, sellerName: mine[0].sellerName, totalPaise: mine.reduce((a, l) => a + l.totalPaise, 0), items: mine.length };
        });
        const mrpTotal = lines.reduce((a, l) => a + (l.mrpPaise ?? l.unitPricePaise) * l.quantity, 0);
        const totalPaise = lines.reduce((a, l) => a + l.totalPaise, 0);
        return { sellers, totalPaise, taxPaise: lines.reduce((a, l) => a + l.taxPaise, 0), savingsPaise: Math.max(0, mrpTotal - totalPaise) };
    }

    /** Is this product (any of its options) sellable? For the catalogue filter. */
    static sellableWhere() {
        return and(eq(products.isActive, true), eq(products.listingStatus, 'live'));
    }
}
