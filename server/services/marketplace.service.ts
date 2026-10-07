/**
 * Selling partner products through the UniteFix store (Partner Hub phase 7).
 *
 *   Listings     products rows with seller_partner_id. Legal Metrology and
 *                E-Commerce Rules fields (MRP ≥ price, HSN, GST, origin,
 *                manufacturer, return window, warranty, BIS/WPC). A 'new'
 *                seller's listing is reviewed; a listing is is_active only
 *                while it is 'live', so existing store queries hide the rest.
 *   Checkout     priced on the server from live listings; one Razorpay order;
 *                on capture the payment splits into one seller order per
 *                seller (commission per line; TCS and TDS computed).
 *   Fulfilment   placed → confirmed → packed → dispatched → delivered, with
 *                cancel before dispatch (refund) and return within the window
 *                (credit note + refund). The seller's GST invoice to the
 *                customer is issued at dispatch on the seller's GSTIN.
 *   Settlement   a delivered order settles after its return window: sale −,
 *                commission + GST +, TCS +, TDS + on the partner ledger; the
 *                existing settlement runs pay the balance.
 *   Trust        verified-purchase reviews, seller reply; score and tier from
 *                rating, on-time dispatch, cancellations and returns.
 *
 * Amounts: listing prices are whole rupees (like the rest of the store) and
 * include GST; everything settled or invoiced is in paise.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
    products, productCategories, productOrders, cartItems, users, businessPartners, serviceablePincodes,
    marketCheckouts, sellerOrders, sellerOrderItems, sellerOrderEvents, productReviews, marketplaceCommission, taxDocuments,
    type SellerOrder,
} from '@shared/schema';
import { GST_STATES } from '@shared/hub';
import { HubError, type HubContext } from './partner-hub.service';
import { GST_RATES, PartnerSalesService } from './partner-sales.service';
import { TaxDocumentService, type Party } from './tax-documents.service';
import { BusinessPartnerService } from './business-partner.service';
import { configService } from './config.service';
import { withTransaction } from '../lib/transaction';
import logger from '../lib/logger';
import { nowFilledMs } from '../lib/db-time';

const FLOW: Record<string, string[]> = {
    placed: ['confirmed', 'cancelled'], confirmed: ['packed', 'dispatched', 'cancelled'], packed: ['dispatched', 'cancelled'],
    dispatched: ['delivered'], delivered: [], cancelled: [], returned: [],
};
const paiseOf = (r: number) => Math.round(r * 100);
const r2 = (p: number) => Math.round(p) / 100;

export class MarketplaceService {

    private static razorpay: Razorpay | null = null;
    private static rzp(): Razorpay | null {
        if (this.razorpay) return this.razorpay;
        const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
        if (!id || !secret || id.includes('xxxxx')) return null;
        this.razorpay = new Razorpay({ key_id: id, key_secret: secret });
        return this.razorpay;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Seller readiness
    // ══════════════════════════════════════════════════════════════════════

    /** What stands between this partner and a live listing. Empty = ready. */
    static async readiness(bpId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        const gaps: string[] = [];
        if (!bp) return ['Partner not found'];
        if (!bp.gstin) gaps.push('A GSTIN — sellers of goods through an e-commerce operator must be GST-registered.');
        if (!bp.grievanceName || !bp.grievancePhone || !bp.grievanceEmail) gaps.push('A grievance contact (name, phone, email) — shown to customers on every order.');
        if (!bp.returnPolicy) gaps.push('Your return and refund policy.');
        if (bp.sellerTier === 'restricted') gaps.push('Your seller account is restricted. Contact UniteFix.');
        return gaps;
    }

    static async saveSellerProfile(ctx: HubContext, input: { grievanceName?: string; grievancePhone?: string; grievanceEmail?: string; returnPolicy?: string }) {
        const phone = input.grievancePhone ? input.grievancePhone.replace(/\D/g, '').slice(-10) : undefined;
        if (input.grievancePhone !== undefined && phone?.length !== 10) throw new HubError('Grievance phone must be 10 digits.', 'BAD_PHONE');
        if (input.grievanceEmail !== undefined && input.grievanceEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.grievanceEmail)) throw new HubError('Grievance email is not valid.', 'BAD_EMAIL');
        await db.update(businessPartners).set({
            ...(input.grievanceName !== undefined ? { grievanceName: input.grievanceName.trim() || null } : {}),
            ...(phone !== undefined ? { grievancePhone: phone } : {}),
            ...(input.grievanceEmail !== undefined ? { grievanceEmail: input.grievanceEmail.trim().toLowerCase() || null } : {}),
            ...(input.returnPolicy !== undefined ? { returnPolicy: input.returnPolicy.trim() || null } : {}),
            updatedAt: new Date(),
        }).where(eq(businessPartners.id, ctx.businessPartnerId));
    }

    // ══════════════════════════════════════════════════════════════════════
    // Listings
    // ══════════════════════════════════════════════════════════════════════

    static async listings(bpId: number) {
        return db.select({ p: products, categoryName: productCategories.name }).from(products)
            .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
            .where(eq(products.sellerPartnerId, bpId)).orderBy(desc(products.updatedAt));
    }

    static async listing(bpId: number, id: number) {
        const [p] = await db.select().from(products).where(and(eq(products.id, id), eq(products.sellerPartnerId, bpId))).limit(1);
        if (!p) throw new HubError('Listing not found', 'NOT_FOUND', 404);
        return p;
    }

    static async saveListing(ctx: HubContext, id: number | null, input: {
        name?: string; description?: string | null; categoryId?: number; priceRupees?: number; mrpRupees?: number; stock?: number;
        hsnCode?: string; gstPercent?: number; countryOfOrigin?: string; manufacturer?: string; netQuantity?: string | null;
        returnWindowDays?: number; warrantyMonths?: number | null; warrantyBy?: string | null; bisNumber?: string | null; wpcEta?: string | null;
        images?: string[]; sellerSku?: string | null;
        installationPriceRupees?: number | null; installationSac?: string | null; installationNote?: string | null;
    }) {
        const existing = id ? await this.listing(ctx.businessPartnerId, id) : null;
        const merged = {
            price: input.priceRupees ?? existing?.price, mrp: input.mrpRupees ?? existing?.mrp,
        };
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) { if (!input.name.trim()) throw new HubError('Name the product.', 'NO_NAME'); v.name = input.name.trim().slice(0, 160); }
        if (input.description !== undefined) v.description = input.description?.trim() || null;
        if (input.categoryId !== undefined) {
            const [c] = await db.select().from(productCategories).where(and(eq(productCategories.id, input.categoryId), eq(productCategories.isActive, true))).limit(1);
            if (!c) throw new HubError('Choose a store category.', 'BAD_CATEGORY');
            Object.assign(v, { categoryId: c.id, category: c.name });
        }
        if (input.priceRupees !== undefined) { if (!(Number.isInteger(input.priceRupees) && input.priceRupees > 0)) throw new HubError('Price is a whole number of rupees, more than zero.', 'BAD_PRICE'); v.price = input.priceRupees; }
        if (input.mrpRupees !== undefined) { if (!(Number.isInteger(input.mrpRupees) && input.mrpRupees > 0)) throw new HubError('MRP is a whole number of rupees.', 'BAD_MRP'); v.mrp = input.mrpRupees; }
        if (merged.price != null && merged.mrp != null && merged.price > merged.mrp) throw new HubError(`The price (₹${merged.price}) cannot be above the MRP (₹${merged.mrp}).`, 'ABOVE_MRP');
        if (input.stock !== undefined) { if (!(Number.isInteger(input.stock) && input.stock >= 0 && input.stock <= 100000)) throw new HubError('Stock is a whole number.', 'BAD_STOCK'); v.stock = input.stock; }
        if (input.hsnCode !== undefined) { if (!/^\d{4}(\d{2}){0,2}$/.test(input.hsnCode)) throw new HubError('HSN is 4, 6 or 8 digits.', 'BAD_HSN'); if (input.hsnCode.startsWith('99')) throw new HubError('That is a service code (SAC); goods need an HSN.', 'BAD_HSN'); v.hsnCode = input.hsnCode; }
        if (input.gstPercent !== undefined) { if (!GST_RATES.includes(input.gstPercent)) throw new HubError(`GST rate must be one of ${GST_RATES.join(', ')}%.`, 'BAD_RATE'); v.gstPercent = String(input.gstPercent); }
        if (input.countryOfOrigin !== undefined) { if (!input.countryOfOrigin.trim()) throw new HubError('Country of origin is required (E-Commerce Rules 2020).', 'NO_ORIGIN'); v.countryOfOrigin = input.countryOfOrigin.trim().slice(0, 60); }
        if (input.manufacturer !== undefined) { if (!input.manufacturer.trim()) throw new HubError('Manufacturer or importer is required.', 'NO_MAKER'); v.manufacturer = input.manufacturer.trim().slice(0, 160); }
        if (input.netQuantity !== undefined) v.netQuantity = input.netQuantity?.trim() || null;
        if (input.returnWindowDays !== undefined) { if (!(Number.isInteger(input.returnWindowDays) && input.returnWindowDays >= 0 && input.returnWindowDays <= 30)) throw new HubError('Return window is 0–30 days.', 'BAD_WINDOW'); v.returnWindowDays = input.returnWindowDays; }
        if (input.warrantyMonths !== undefined) v.warrantyMonths = input.warrantyMonths;
        if (input.warrantyBy !== undefined) { if (input.warrantyBy && !['seller', 'manufacturer', 'none'].includes(input.warrantyBy)) throw new HubError('Warranty is by the seller, the manufacturer, or none.', 'BAD_WARRANTY'); v.warrantyBy = input.warrantyBy; }
        if (input.bisNumber !== undefined) v.bisNumber = input.bisNumber?.trim() || null;
        if (input.wpcEta !== undefined) v.wpcEta = input.wpcEta?.trim() || null;
        if (input.sellerSku !== undefined) v.sellerSku = input.sellerSku?.trim() || null;
        if (input.installationPriceRupees !== undefined) {
            if (input.installationPriceRupees != null && !(Number.isInteger(input.installationPriceRupees) && input.installationPriceRupees >= 1 && input.installationPriceRupees <= 100000)) throw new HubError('Installation price is a whole number of rupees, 1–1,00,000 (or leave it empty).', 'BAD_INSTALL');
            v.installationPricePaise = input.installationPriceRupees == null ? null : input.installationPriceRupees * 100;
        }
        if (input.installationSac !== undefined) { if (input.installationSac && !/^99\d{2}(\d{2})?$/.test(input.installationSac)) throw new HubError('Installation is a service: its SAC starts with 99 (4 or 6 digits).', 'BAD_SAC'); v.installationSac = input.installationSac || null; }
        if (input.installationNote !== undefined) v.installationNote = input.installationNote?.trim().slice(0, 300) || null;
        if (input.images !== undefined) { const im = input.images.filter(u => /^https?:\/\/|^data:image\//.test(u)).slice(0, 8); v.images = im; v.thumbnailUrl = im[0] ?? null; }

        if (existing) {
            // Description, category and compliance changes on a live listing by
            // a seller still under review go back to review; price and stock do not.
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            const material = ['name', 'description', 'categoryId', 'hsnCode', 'gstPercent', 'countryOfOrigin', 'manufacturer', 'mrp', 'bisNumber', 'wpcEta'].some(k => k in v);
            const back = existing.listingStatus === 'live' && material && bp?.sellerTier === 'new';
            const [u] = await db.update(products).set({ ...v, ...(back ? { listingStatus: 'pending_review', isActive: false, submittedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(products.id, existing.id)).returning();
            return u;
        }
        for (const k of ['name', 'categoryId', 'price', 'mrp', 'hsnCode', 'gstPercent', 'countryOfOrigin', 'manufacturer']) if (v[k] === undefined) throw new HubError(`${k} is required.`, 'MISSING');
        const [row] = await db.insert(products).values({ ...(v as any), stock: v.stock ?? 0, sellerPartnerId: ctx.businessPartnerId, listingStatus: 'draft', isActive: false }).returning();
        return row;
    }

    /** Draft/rejected → review (new sellers) or live (established sellers). */
    static async submit(ctx: HubContext, id: number) {
        const p = await this.listing(ctx.businessPartnerId, id);
        if (!['draft', 'rejected', 'paused'].includes(p.listingStatus)) throw new HubError(`This listing is ${p.listingStatus}.`, 'BAD_STATE', 409);
        const gaps = await this.readiness(ctx.businessPartnerId);
        if (gaps.length) throw new HubError(`Before listing: ${gaps.join(' ')}`, 'NOT_READY', 409);
        if (!p.hsnCode || p.gstPercent == null || !p.countryOfOrigin || !p.manufacturer || p.mrp == null) throw new HubError('Complete the compliance fields first (MRP, HSN, GST, origin, manufacturer).', 'INCOMPLETE', 409);
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const reviewed = bp?.sellerTier === 'new' && p.listingStatus !== 'paused';
        const [u] = await db.update(products).set({ listingStatus: reviewed ? 'pending_review' : 'live', isActive: !reviewed, rejectionReason: null, submittedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, id)).returning();
        return u;
    }

    static async pause(ctx: HubContext, id: number) {
        const p = await this.listing(ctx.businessPartnerId, id);
        if (p.listingStatus !== 'live') throw new HubError('Only a live listing can be paused.', 'BAD_STATE', 409);
        const [u] = await db.update(products).set({ listingStatus: 'paused', isActive: false, updatedAt: new Date() }).where(eq(products.id, id)).returning();
        return u;
    }

    static async reviewQueue() {
        return db.select({ p: products, sellerName: businessPartners.displayName, sellerCode: businessPartners.partnerCode, categoryName: productCategories.name })
            .from(products).innerJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId))
            .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
            .where(eq(products.listingStatus, 'pending_review')).orderBy(asc(products.submittedAt));
    }

    static async reviewListings(adminId: number, ids: number[], approve: boolean, reason?: string | null) {
        if (!approve && !reason?.trim()) throw new HubError('Say why — the seller sees it.', 'NO_REASON');
        const rows = await db.update(products).set(approve ? { listingStatus: 'live', isActive: true, rejectionReason: null, updatedAt: new Date() } : { listingStatus: 'rejected', isActive: false, rejectionReason: reason!.trim(), updatedAt: new Date() })
            .where(and(inArray(products.id, ids), eq(products.listingStatus, 'pending_review'), isNotNull(products.sellerPartnerId))).returning({ id: products.id });
        logger.info(`[MARKET] Admin ${adminId} ${approve ? 'approved' : 'rejected'} listings ${rows.map(r => r.id).join(', ')}`);
        if (rows.length) {
            const owners = await db.select({ bp: products.sellerPartnerId, name: products.name }).from(products).where(inArray(products.id, rows.map(r => r.id)));
            const { HubAlerts } = await import('./hub-alerts.service');
            const by = new Map<number, string[]>();
            for (const o of owners) if (o.bp) by.set(o.bp, [...(by.get(o.bp) ?? []), o.name]);
            for (const [bp, names] of Array.from(by)) await HubAlerts.send(bp, 'listing_reviewed', { title: approve ? 'Listings approved' : 'Listings not approved', body: `${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''} ${approve ? 'are live in the store.' : `were not approved: ${reason}`}`, link: '/partner/store/listings' });
        }
        return rows.length;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Commission, tax deductions
    // ══════════════════════════════════════════════════════════════════════

    /** Store fee settings, read once per use. */
    static async feeRates() {
        const n = async (k: string, d: number) => Number(await configService.get<number>(`BUSINESS_CONFIG.${k}`, d));
        return {
            gatewayPercent: await n('MARKETPLACE_GATEWAY_FEE_PERCENT', 2),
            gstPercent: parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18'),
            lateDispatchRupees: await n('MARKETPLACE_LATE_DISPATCH_PENALTY_RUPEES', 50),
            cancelPercent: await n('MARKETPLACE_SELLER_CANCEL_PENALTY_PERCENT', 5),
            cancelMinRupees: await n('MARKETPLACE_SELLER_CANCEL_PENALTY_MIN_RUPEES', 25),
            slaHours: await n('MARKETPLACE_DISPATCH_SLA_HOURS', 48),
            courierPer500gRupees: await n('MARKETPLACE_COURIER_RATE_PER_500G_RUPEES', 0),
        };
    }

    /** Payment collection fee on what the customer paid, GST on top — charged with the commission at settlement. */
    static gatewayFee(totalPaise: number, r: { gatewayPercent: number; gstPercent: number }) {
        const fee = Math.round(totalPaise * Math.max(0, r.gatewayPercent) / 100);
        return { gatewayFeePaise: fee, gatewayFeeGstPaise: Math.round(fee * r.gstPercent / 100) };
    }

    /**
     * A charge for letting a customer down: dispatched after the deadline, or
     * cancelled by the seller (or by UniteFix because the seller did not ship).
     * Booked to the partner ledger at once; staff can waive it.
     */
    private static async chargePenalty(tx: any, so: SellerOrder, kind: 'late' | 'cancel') {
        const r = await this.feeRates();
        const paise = kind === 'late' ? Math.round(r.lateDispatchRupees * 100) : Math.max(Math.round(r.cancelMinRupees * 100), Math.round(so.totalPaise * r.cancelPercent / 100));
        if (!(paise > 0)) return 0;
        const reason = kind === 'late' ? `Dispatched after the ${r.slaHours}-hour deadline` : `Cancelled after the customer paid (${r.cancelPercent}% of the order, at least ₹${r.cancelMinRupees})`;
        await BusinessPartnerService.appendLedger(tx, { businessPartnerId: so.sellerPartnerId, entryType: 'store_penalty', amountPaise: paise, description: `Store order ${so.code} — ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`, metadata: { sellerOrderId: so.id, kind } });
        await tx.update(sellerOrders).set({ penaltyPaise: paise, penaltyReason: reason }).where(eq(sellerOrders.id, so.id));
        const { HubAlerts } = await import('./hub-alerts.service');
        void HubAlerts.send(so.sellerPartnerId, 'store_penalty', { title: `₹${r2(paise)} charge on store order ${so.code}`, body: `${reason}. It comes off your next settlement. Ask UniteFix if you think it is wrong.`, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
        return paise;
    }

    /** Staff: take a penalty back (a courier delay, a stock error that was UniteFix's). */
    static async waivePenalty(id: number, adminId: number, note: string) {
        return withTransaction(async (tx) => {
            const [so] = await tx.select().from(sellerOrders).where(eq(sellerOrders.id, id)).for('update');
            if (!so) throw new HubError('Not found', 'NOT_FOUND', 404);
            if (!so.penaltyPaise || so.penaltyWaivedAt) throw new HubError('There is no charge to waive on this order.', 'NO_PENALTY', 409);
            await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'adjustment', amountPaise: -so.penaltyPaise, description: `Store order ${so.code} — charge waived: ${note}`, metadata: { sellerOrderId: so.id }, createdByAdminId: adminId });
            const [u] = await tx.update(sellerOrders).set({ penaltyWaivedAt: new Date(), updatedAt: new Date() }).where(eq(sellerOrders.id, so.id)).returning();
            return u;
        });
    }

    static async commissionRate(categoryId: number | null, tier: string) {
        const [c] = categoryId ? await db.select().from(marketplaceCommission).where(eq(marketplaceCommission.productCategoryId, categoryId)).limit(1) : [];
        const base = c ? Number(c.percent) : Number(await configService.get<number>('BUSINESS_CONFIG.MARKETPLACE_COMMISSION_PERCENT', 10));
        return { percent: Math.max(0, base - (tier === 'preferred' ? 2 : 0)), minPaise: c?.minPaise ?? 0 };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Checkout — priced on the server
    // ══════════════════════════════════════════════════════════════════════

    static async quote(items: Array<{ productId: number; quantity: number; withInstallation?: boolean }>) {
        if (!items.length) throw new HubError('Your cart is empty.', 'EMPTY');
        const ids = items.map(i => i.productId);
        const rows = await db.select({ p: products, bp: businessPartners }).from(products)
            .leftJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId)).where(inArray(products.id, ids));
        const by = new Map(rows.map(r => [r.p.id, r]));
        const lines = items.flatMap(i => {
            const r = by.get(i.productId);
            if (!r) throw new HubError(`Product #${i.productId} is not available.`, 'GONE', 409);
            if (!r.p.sellerPartnerId) throw new HubError(`${r.p.name} is sold by UniteFix and checks out separately.`, 'NOT_MARKETPLACE', 409);
            if (r.p.listingStatus !== 'live' || !r.p.isActive || r.bp?.status !== 'active') throw new HubError(`${r.p.name} is not on sale right now.`, 'GONE', 409);
            const q = Math.floor(Number(i.quantity));
            if (!(q >= 1 && q <= 20)) throw new HubError('Quantity is 1–20.', 'BAD_QTY');
            if ((r.p.stock ?? 0) < q) throw new HubError(`Only ${r.p.stock ?? 0} of ${r.p.name} left.`, 'STOCK', 409);
            const unit = r.p.price * 100, gst = Number(r.p.gstPercent ?? 0);
            const gross = unit * q, taxable = Math.round(gross * 100 / (100 + gst));
            const goods = { kind: 'goods' as string, productId: r.p.id, sellerPartnerId: r.p.sellerPartnerId, sellerName: r.bp!.displayName, name: r.p.name, quantity: q, unitPricePaise: unit, mrpPaise: r.p.mrp != null ? r.p.mrp * 100 : null, gstRate: gst, hsnCode: r.p.hsnCode, taxablePaise: taxable, taxPaise: gross - taxable, totalPaise: gross, returnWindowDays: r.p.returnWindowDays, categoryId: r.p.categoryId };
            if (!i.withInstallation) return [goods];
            if (!r.p.installationPricePaise) throw new HubError(`${r.p.name} is not offered with installation.`, 'NO_INSTALL', 409);
            // A separate service at its own price: SAC and 18% GST, never the goods' rate.
            const ig = r.p.installationPricePaise * q, it = Math.round(ig * 100 / 118);
            return [goods, { ...goods, kind: 'installation', name: `Installation — ${r.p.name}`, unitPricePaise: r.p.installationPricePaise, mrpPaise: null, gstRate: 18, hsnCode: r.p.installationSac || '9987', taxablePaise: it, taxPaise: ig - it, totalPaise: ig }];
        });
        const sellers = Array.from(new Set(lines.map(l => l.sellerPartnerId))).map(id => ({ sellerPartnerId: id, sellerName: lines.find(l => l.sellerPartnerId === id)!.sellerName, totalPaise: lines.filter(l => l.sellerPartnerId === id).reduce((a, l) => a + l.totalPaise, 0) }));
        return { lines, sellers, totalPaise: lines.reduce((a, l) => a + l.totalPaise, 0) };
    }

    /** Start a payment for a cart of partner listings. */
    static async startCheckout(userId: number, input: { items: Array<{ productId: number; quantity: number }>; address: string; pincode: string; name?: string | null; phone?: string | null }) {
        if (!input.address?.trim() || !/^\d{6}$/.test(input.pincode ?? '')) throw new HubError('A delivery address and 6-digit pincode are needed.', 'NO_ADDRESS');
        const q = await this.quote(input.items);
        const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const [c] = await db.insert(marketCheckouts).values({
            userId, amountPaise: q.totalPaise, lines: q.lines as any, address: input.address.trim().slice(0, 500), pincode: input.pincode,
            customerName: input.name?.trim() || u?.username || null, customerPhone: (input.phone ?? u?.phone ?? '').replace(/\D/g, '').slice(-10) || null,
        }).returning();
        const rzp = this.rzp();
        let razorpay: { orderId: string; keyId: string; amount: number } | null = null;
        if (rzp) {
            const ro = await rzp.orders.create({ amount: q.totalPaise, currency: 'INR', receipt: `mkt_${c.id}`, notes: { payment_type: 'marketplace_order', market_checkout_id: String(c.id), customer_id: String(userId) } });
            await db.update(marketCheckouts).set({ razorpayOrderId: ro.id }).where(eq(marketCheckouts.id, c.id));
            razorpay = { orderId: ro.id, keyId: process.env.RAZORPAY_KEY_ID!, amount: q.totalPaise / 100 };
        }
        return { checkoutId: c.id, ...q, razorpay };
    }

    static verifySignature(orderId: string, paymentId: string, signature: string) {
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret) return false;
        const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
        return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    }

    /**
     * The customer paid. Idempotent. Takes stock, writes the customer order
     * and one seller order per seller. If stock ran out in between, the whole
     * payment is refunded and nothing is created.
     */
    static async applyCapture(params: { checkoutId?: number | null; razorpayOrderId?: string | null; razorpayPaymentId: string; amountPaise?: number }) {
        return withTransaction(async (tx) => {
            const cond = params.checkoutId ? eq(marketCheckouts.id, params.checkoutId) : params.razorpayOrderId ? eq(marketCheckouts.razorpayOrderId, params.razorpayOrderId) : null;
            if (!cond) throw new Error('No checkout to apply');
            const [c] = await tx.select().from(marketCheckouts).where(cond).for('update');
            if (!c) throw new Error('Checkout not found');
            if (c.status === 'paid') return { checkout: c, created: false };
            if (params.amountPaise != null && params.amountPaise < c.amountPaise) throw new Error(`Paid ₹${params.amountPaise / 100}, expected ₹${c.amountPaise / 100}`);
            const lines = c.lines as any[];
            // Take stock, all or nothing.
            for (const l of lines) {
                if (l.kind === 'installation') continue;
                const r = await tx.update(products).set({ stock: sql`${products.stock} - ${l.quantity}`, updatedAt: new Date() })
                    .where(and(eq(products.id, l.productId), gte(products.stock, l.quantity))).returning({ id: products.id });
                if (!r.length) {
                    await tx.update(marketCheckouts).set({ status: 'refund_due', razorpayPaymentId: params.razorpayPaymentId }).where(eq(marketCheckouts.id, c.id));
                    logger.error(`[MARKET] Checkout #${c.id}: ${l.name} sold out after payment — full refund due`);
                    void this.refund(params.razorpayPaymentId, c.amountPaise, `market_checkout_${c.id}_soldout`);
                    return { checkout: c, created: false, soldOut: l.name };
                }
            }
            const [po] = await tx.insert(productOrders).values({
                orderId: `MKT-${c.id}-${Date.now().toString(36).toUpperCase()}`, userId: c.userId, status: 'confirmed' as any,
                products: lines.map(l => ({ productId: l.productId, name: l.name, quantity: l.quantity, price: l.unitPricePaise / 100, sellerPartnerId: l.sellerPartnerId, sellerName: l.sellerName })) as any,
                totalAmount: Math.round(c.amountPaise / 100), address: c.address,
            }).returning();
            const tcsPct = Number(await configService.get<number>('BUSINESS_CONFIG.MARKETPLACE_TCS_PERCENT', 0.5));
            const tdsPct = Number(await configService.get<number>('BUSINESS_CONFIG.MARKETPLACE_TDS_PERCENT', 0.1));
            const fees = await this.feeRates();
            const sellerIds = Array.from(new Set(lines.map(l => l.sellerPartnerId as number)));
            const created: SellerOrder[] = [];
            for (const sid of sellerIds) {
                const [bp] = await tx.select().from(businessPartners).where(eq(businessPartners.id, sid)).limit(1);
                const mine = lines.filter(l => l.sellerPartnerId === sid);
                const items = [];
                let commission = 0;
                for (const l of mine) {
                    const rate = await this.commissionRate(l.categoryId ?? null, bp?.sellerTier ?? 'new');
                    const com = Math.max(rate.minPaise * l.quantity, Math.round(l.taxablePaise * rate.percent / 100));
                    commission += com;
                    items.push({ ...l, commissionPaise: com });
                }
                const taxable = mine.reduce((a, l) => a + l.taxablePaise, 0), gst = mine.reduce((a, l) => a + l.taxPaise, 0);
                const [so] = await tx.insert(sellerOrders).values({
                    code: `SO-${c.id}-${sid}`, checkoutId: c.id, productOrderId: po.id, sellerPartnerId: sid, userId: c.userId, status: 'placed',
                    taxablePaise: taxable, gstPaise: gst, totalPaise: taxable + gst,
                    commissionPaise: commission, commissionGstPaise: Math.round(commission * 0.18),
                    tcsPaise: Math.round(taxable * tcsPct / 100), tdsPaise: Math.round(taxable * tdsPct / 100),
                    ...this.gatewayFee(taxable + gst, fees),
                    shipName: c.customerName, shipPhone: c.customerPhone, shipAddress: c.address, shipPincode: c.pincode,
                    returnWindowDays: Math.max(...mine.map(l => Number(l.returnWindowDays ?? 7))),
                    installationStatus: mine.some(l => l.kind === 'installation') ? 'pending' : null,
                }).returning();
                await tx.insert(sellerOrderItems).values(items.map(l => ({
                    sellerOrderId: so.id, productId: l.productId, name: l.name, quantity: l.quantity, unitPricePaise: l.unitPricePaise, mrpPaise: l.mrpPaise,
                    gstRate: String(l.gstRate), hsnCode: l.hsnCode, taxablePaise: l.taxablePaise, taxPaise: l.taxPaise, commissionPaise: l.commissionPaise, kind: l.kind ?? 'goods',
                })));
                await tx.insert(sellerOrderEvents).values({ sellerOrderId: so.id, toStatus: 'placed', actorType: 'customer', actorId: c.userId, note: `Paid ${params.razorpayPaymentId}` });
                created.push(so);
            }
            await tx.update(marketCheckouts).set({ status: 'paid', paidAt: new Date(), razorpayPaymentId: params.razorpayPaymentId, productOrderId: po.id }).where(eq(marketCheckouts.id, c.id));
            await tx.delete(cartItems).where(and(eq(cartItems.userId, c.userId), inArray(cartItems.productId, lines.map(l => l.productId))));
            logger.info(`[MARKET] Checkout #${c.id} paid — ${created.length} seller order(s): ${created.map(s => s.code).join(', ')}`);
            const { HubAlerts } = await import('./hub-alerts.service');
            for (const so of created) void HubAlerts.send(so.sellerPartnerId, 'store_order', { title: `New store order ${so.code}`, body: `₹${(so.totalPaise / 100).toLocaleString('en-IN')} — confirm and dispatch it within the dispatch deadline.`, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
            return { checkout: c, created: true, productOrder: po, sellerOrders: created };
        });
    }

    private static async refund(paymentId: string | null | undefined, amountPaise: number, note: string): Promise<{ status: string; reference: string | null }> {
        if (!paymentId || amountPaise <= 0) return { status: 'none', reference: null };
        const rzp = this.rzp();
        if (!rzp) return { status: 'manual', reference: null };
        try {
            const r: any = await rzp.payments.refund(paymentId, { amount: amountPaise, notes: { reason: note } } as any);
            return { status: 'initiated', reference: r?.id ?? null };
        } catch (e: any) {
            logger.error(`[MARKET] Refund failed for ${paymentId}: ${e?.message ?? e?.error?.description}`);
            return { status: 'failed', reference: null };
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Seller orders
    // ══════════════════════════════════════════════════════════════════════

    static async sellerOrder(id: number, opts: { bpId?: number; userId?: number } = {}) {
        const conds: any[] = [eq(sellerOrders.id, id)];
        if (opts.bpId) conds.push(eq(sellerOrders.sellerPartnerId, opts.bpId));
        if (opts.userId) conds.push(eq(sellerOrders.userId, opts.userId));
        const [o] = await db.select().from(sellerOrders).where(and(...conds)).limit(1);
        if (!o) throw new HubError('Order not found', 'NOT_FOUND', 404);
        return o;
    }

    static async ordersForSeller(bpId: number, status?: string) {
        const raw = await db.select({ o: sellerOrders, placedMs: nowFilledMs(sellerOrders.createdAt) }).from(sellerOrders).where(and(eq(sellerOrders.sellerPartnerId, bpId), ...(status ? [eq(sellerOrders.status, status)] : []))).orderBy(desc(sellerOrders.createdAt)).limit(500);
        const rows = raw.map(r => r.o);
        const placed = new Map(raw.map(r => [r.o.id, Number(r.placedMs)]));
        const ids = rows.map(r => r.id);
        const items = ids.length ? await db.select().from(sellerOrderItems).where(inArray(sellerOrderItems.sellerOrderId, ids)) : [];
        const slaH = (await this.feeRates()).slaHours;
        const now = Date.now();
        return rows.map(o => {
            // The customer's details only while the seller needs them (DPDP): until settled.
            const masked = !!o.settledAt || (o.status === 'cancelled' && !!o.cancelledAt && now - new Date(o.cancelledAt).getTime() > 7 * 86_400_000);
            return {
                ...o, shipName: masked ? null : o.shipName, shipPhone: masked ? null : o.shipPhone, shipAddress: masked ? null : o.shipAddress,
                items: items.filter(i => i.sellerOrderId === o.id),
                dispatchBy: placed.get(o.id) ? new Date(placed.get(o.id)! + slaH * 3_600_000) : null,
                late: ['placed', 'confirmed', 'packed'].includes(o.status) && !!placed.get(o.id) && now - placed.get(o.id)! > slaH * 3_600_000,
            };
        });
    }

    private static async event(tx: any, so: SellerOrder, to: string, actorType: string, actorId: number | null, note?: string | null) {
        await tx.insert(sellerOrderEvents).values({ sellerOrderId: so.id, fromStatus: so.status, toStatus: to, actorType, actorId, note: note ?? null });
    }

    /** Recipient for the seller's invoice: the customer, with the state of their pincode. */
    private static async customerParty(so: SellerOrder): Promise<Party> {
        let stateCode: string | null = null;
        if (so.shipPincode) {
            const [sp] = await db.select({ state: serviceablePincodes.state }).from(serviceablePincodes).where(eq(serviceablePincodes.pincode, so.shipPincode)).limit(1);
            const hit = sp?.state ? Object.entries(GST_STATES).find(([, n]) => n.toLowerCase() === sp.state!.toLowerCase()) : null;
            stateCode = hit?.[0] ?? null;
        }
        return { name: so.shipName ?? 'Customer', gstin: null, stateCode, stateName: stateCode ? GST_STATES[stateCode] : null, address: [so.shipAddress, so.shipPincode].filter(Boolean).join(' ') || null, phone: so.shipPhone };
    }

    /** The seller's tax invoice to the customer, issued on the seller's GSTIN at dispatch. */
    private static async issueSellerInvoice(tx: any, so: SellerOrder) {
        if (so.invoiceDocumentId) return so.invoiceDocumentId;
        const bp = await BusinessPartnerService.byId(so.sellerPartnerId);
        const items = await tx.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
        const prefix = await PartnerSalesService.prefixFor(so.sellerPartnerId);
        const uf = await TaxDocumentService.unitefixParty();
        const doc = await TaxDocumentService.create(tx, {
            docKind: 'tax_invoice', issuer: 'partner', issuerPartnerId: so.sellerPartnerId, seriesKey: `bp-${so.sellerPartnerId}-inv`, prefix, letter: '', numberWidth: 4,
            purpose: 'marketplace_sale', supplier: TaxDocumentService.partnerParty(bp!), recipient: await this.customerParty(so),
            lines: items.map((i: any) => ({ description: i.name, hsnSac: i.hsnCode, quantity: i.quantity, unit: i.kind === 'installation' ? 'job' : 'pcs', ratePaise: Math.round(i.taxablePaise / i.quantity), taxablePaise: i.taxablePaise, gstRate: Number(i.gstRate), taxPaise: i.taxPaise })),
            notes: `Order ${so.code}. Sold by ${bp!.legalName} through UniteFix (e-commerce operator${uf.gstin ? `, GSTIN ${uf.gstin}` : ''}). Grievances: ${bp!.grievanceName ?? ''} ${bp!.grievancePhone ?? ''} ${bp!.grievanceEmail ?? ''}`.trim(),
        });
        return doc.id;
    }

    /** Seller moves an order along. Dispatch needs a courier and tracking id and issues the invoice. */
    static async transition(ctx: HubContext, id: number, to: string, input: { courier?: string | null; trackingId?: string | null; reason?: string | null } = {}) {
        const so = await this.sellerOrder(id, { bpId: ctx.businessPartnerId });
        if (!(FLOW[so.status] ?? []).includes(to)) throw new HubError(`A ${so.status} order cannot become ${to}.`, 'BAD_TRANSITION', 409);
        if (to === 'cancelled') return this.cancel(so, 'seller', ctx.adminUserId, input.reason);
        if (to === 'dispatched') input = { ...input, courier: input.courier?.trim() || so.courier, trackingId: input.trackingId?.trim() || so.trackingId };
        if (to === 'dispatched' && (!input.courier?.trim() || !input.trackingId?.trim())) throw new HubError('Courier and tracking id are needed to dispatch.', 'NO_TRACKING');
        const slaH = (await this.feeRates()).slaHours;
        const [{ placedMs }] = await db.select({ placedMs: nowFilledMs(sellerOrders.createdAt) }).from(sellerOrders).where(eq(sellerOrders.id, so.id));
        return withTransaction(async (tx) => {
            const now = new Date();
            const set: Record<string, unknown> = { status: to, updatedAt: now };
            if (to === 'confirmed') set.confirmedAt = now;
            if (to === 'dispatched') Object.assign(set, { dispatchedAt: now, courier: input.courier!.trim(), trackingId: input.trackingId!.trim(), invoiceDocumentId: await this.issueSellerInvoice(tx, so) });
            if (to === 'delivered') Object.assign(set, { deliveredAt: now, settleAfter: new Date(now.getTime() + so.returnWindowDays * 86_400_000) });
            const [u] = await tx.update(sellerOrders).set(set).where(and(eq(sellerOrders.id, so.id), eq(sellerOrders.status, so.status))).returning();
            if (!u) throw new HubError('The order changed meanwhile. Refresh.', 'STALE', 409);
            await this.event(tx, so, to, 'seller', ctx.adminUserId, to === 'dispatched' ? `${input.courier} ${input.trackingId}` : null);
            if (to === 'dispatched' && placedMs && now.getTime() - Number(placedMs) > slaH * 3_600_000) await this.chargePenalty(tx, so, 'late');
            return u;
        });
    }

    /** The seller installed what the customer bought with installation. Settlement waits for this. */
    static async markInstalled(ctx: HubContext, id: number, note?: string | null) {
        const so = await this.sellerOrder(id, { bpId: ctx.businessPartnerId });
        if (so.installationStatus !== 'pending') throw new HubError('This order has no installation waiting.', 'NO_INSTALL', 409);
        if (so.status !== 'delivered') throw new HubError('Mark it installed after the delivery.', 'BAD_STATE', 409);
        return withTransaction(async (tx) => {
            const [u] = await tx.update(sellerOrders).set({ installationStatus: 'done', installedAt: new Date(), updatedAt: new Date() }).where(and(eq(sellerOrders.id, so.id), eq(sellerOrders.installationStatus, 'pending'))).returning();
            if (!u) throw new HubError('The order changed meanwhile. Refresh.', 'STALE', 409);
            await tx.insert(sellerOrderEvents).values({ sellerOrderId: so.id, fromStatus: so.status, toStatus: so.status, actorType: 'seller', actorId: ctx.adminUserId, note: `Installed${note ? ` — ${note.trim()}` : ''}` });
            return u;
        });
    }

    /** Cancel before dispatch: stock back, the customer refunded for this seller's part. */
    static async cancel(so: SellerOrder, by: 'seller' | 'customer' | 'admin', actorId: number | null, reason?: string | null) {
        if (!['placed', 'confirmed', 'packed'].includes(so.status)) throw new HubError('Only an order not yet dispatched can be cancelled.', 'BAD_STATE', 409);
        if (!reason?.trim()) throw new HubError('Say why.', 'NO_REASON');
        const [c] = await db.select().from(marketCheckouts).where(eq(marketCheckouts.id, so.checkoutId)).limit(1);
        const r = await this.refund(c?.razorpayPaymentId, so.totalPaise, `seller_order_${so.code}_cancelled`);
        return withTransaction(async (tx) => {
            const [u] = await tx.update(sellerOrders).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason.trim(), cancelledBy: by, refundPaise: so.totalPaise, refundStatus: r.status, refundReference: r.reference, updatedAt: new Date() })
                .where(and(eq(sellerOrders.id, so.id), eq(sellerOrders.status, so.status))).returning();
            if (!u) throw new HubError('The order changed meanwhile. Refresh.', 'STALE', 409);
            const items = await tx.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
            for (const i of items) if (i.kind !== 'installation') await tx.update(products).set({ stock: sql`${products.stock} + ${i.quantity}` }).where(eq(products.id, i.productId));
            await this.event(tx, so, 'cancelled', by, actorId, reason.trim());
            if (by === 'seller' || by === 'admin') await this.chargePenalty(tx, so, 'cancel');
            if (so.shipmentRef) void import('./store-shipping.service').then(m => m.StoreShippingService.cancelBooking(so)).catch(() => null);
            return u;
        });
    }

    // ── customer side ────────────────────────────────────────────────────

    static async customerOrders(userId: number) {
        const rows = await db.select({ o: sellerOrders, seller: businessPartners.displayName, legalName: businessPartners.legalName, gstin: businessPartners.gstin, grievancePhone: businessPartners.grievancePhone, grievanceEmail: businessPartners.grievanceEmail })
            .from(sellerOrders).innerJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(eq(sellerOrders.userId, userId)).orderBy(desc(sellerOrders.createdAt)).limit(100);
        const ids = rows.map(r => r.o.id);
        const items = ids.length ? await db.select().from(sellerOrderItems).where(inArray(sellerOrderItems.sellerOrderId, ids)) : [];
        const reviews = items.length ? await db.select().from(productReviews).where(inArray(productReviews.sellerOrderItemId, items.map(i => i.id))) : [];
        const now = Date.now();
        return rows.map(r => ({
            id: r.o.id, code: r.o.code, status: r.o.status, total: r2(r.o.totalPaise), courier: r.o.courier, trackingId: r.o.trackingId, createdAt: r.o.createdAt,
            dispatchedAt: r.o.dispatchedAt, deliveredAt: r.o.deliveredAt, refund: r.o.refundPaise ? { amount: r2(r.o.refundPaise), status: r.o.refundStatus } : null,
            seller: { name: r.seller, legalName: r.legalName, gstin: r.gstin, grievancePhone: r.grievancePhone, grievanceEmail: r.grievanceEmail },
            canCancel: ['placed', 'confirmed', 'packed'].includes(r.o.status),
            canReturn: r.o.status === 'delivered' && !r.o.returnStatus && !!r.o.settleAfter && new Date(r.o.settleAfter).getTime() > now,
            returnStatus: r.o.returnStatus, hasInvoice: !!r.o.invoiceDocumentId, installationStatus: r.o.installationStatus,
            items: items.filter(i => i.sellerOrderId === r.o.id).map(i => ({ id: i.id, productId: i.productId, kind: i.kind, name: i.name, quantity: i.quantity, price: r2(i.unitPricePaise), review: reviews.find(v => v.sellerOrderItemId === i.id)?.rating ?? null })),
        }));
    }

    static async customerCancel(userId: number, id: number, reason: string) {
        const so = await this.sellerOrder(id, { userId });
        return this.cancel(so, 'customer', userId, reason || 'Cancelled by the customer');
    }

    static async requestReturn(userId: number, id: number, reason: string) {
        const so = await this.sellerOrder(id, { userId });
        if (so.status !== 'delivered') throw new HubError('Returns open after delivery.', 'BAD_STATE', 409);
        if (so.returnStatus) throw new HubError(`A return is already ${so.returnStatus}.`, 'BAD_STATE', 409);
        if (!so.settleAfter || new Date(so.settleAfter).getTime() <= Date.now()) throw new HubError(`The ${so.returnWindowDays}-day return window has closed.`, 'WINDOW_CLOSED', 409);
        if (!reason?.trim()) throw new HubError('Tell the seller what is wrong.', 'NO_REASON');
        const [u] = await db.update(sellerOrders).set({ returnStatus: 'requested', returnReason: reason.trim(), returnRequestedAt: new Date(), updatedAt: new Date() }).where(eq(sellerOrders.id, so.id)).returning();
        await db.insert(sellerOrderEvents).values({ sellerOrderId: so.id, fromStatus: so.status, toStatus: 'return_requested', actorType: 'customer', actorId: userId, note: reason.trim() });
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(so.sellerPartnerId, 'store_return', { title: `Return requested on ${so.code}`, body: `"${reason.trim().slice(0, 140)}". Approve or reject it.`, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
        return u;
    }

    /**
     * Seller decides a return. 'received' completes it: the seller's credit
     * note, the customer's refund, stock back. A returned order never settles.
     */
    static async decideReturn(ctx: HubContext | { businessPartnerId?: number; adminUserId: number | null }, id: number, decision: 'approve' | 'reject' | 'received', note?: string | null) {
        const so = await this.sellerOrder(id, ctx.businessPartnerId ? { bpId: ctx.businessPartnerId } : {});
        const allowed: Record<string, string[]> = { requested: ['approve', 'reject'], approved: ['received'] };
        if (!(allowed[so.returnStatus ?? ''] ?? []).includes(decision)) throw new HubError(`Cannot ${decision} a return that is ${so.returnStatus ?? 'not requested'}.`, 'BAD_STATE', 409);
        if (decision === 'reject' && !note?.trim()) throw new HubError('Say why — the customer sees it.', 'NO_REASON');
        if (decision !== 'received') {
            const [u] = await db.update(sellerOrders).set({ returnStatus: decision === 'approve' ? 'approved' : 'rejected', updatedAt: new Date() }).where(eq(sellerOrders.id, so.id)).returning();
            await db.insert(sellerOrderEvents).values({ sellerOrderId: so.id, fromStatus: so.status, toStatus: `return_${decision === 'approve' ? 'approved' : 'rejected'}`, actorType: ctx.businessPartnerId ? 'seller' : 'admin', actorId: ctx.adminUserId, note: note ?? null });
            return u;
        }
        const [c] = await db.select().from(marketCheckouts).where(eq(marketCheckouts.id, so.checkoutId)).limit(1);
        const r = await this.refund(c?.razorpayPaymentId, so.totalPaise, `seller_order_${so.code}_returned`);
        return withTransaction(async (tx) => {
            let cn: number | null = null;
            if (so.invoiceDocumentId) {
                const [inv] = await tx.select().from(taxDocuments).where(eq(taxDocuments.id, so.invoiceDocumentId)).limit(1);
                const items = await tx.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
                const prefix = await PartnerSalesService.prefixFor(so.sellerPartnerId);
                const doc = await TaxDocumentService.create(tx as any, {
                    docKind: 'credit_note', issuer: 'partner', issuerPartnerId: so.sellerPartnerId, seriesKey: `bp-${so.sellerPartnerId}-cn`, prefix, letter: 'C', numberWidth: 4,
                    purpose: 'marketplace_sale', originalDocumentId: so.invoiceDocumentId, supplier: inv.supplier as Party, recipient: inv.recipient as Party,
                    lines: items.map((i: any) => ({ description: i.name, hsnSac: i.hsnCode, quantity: i.quantity, unit: i.kind === 'installation' ? 'job' : 'pcs', ratePaise: Math.round(i.taxablePaise / i.quantity), taxablePaise: i.taxablePaise, gstRate: Number(i.gstRate), taxPaise: i.taxPaise })),
                    notes: `Return of order ${so.code}. ${so.returnReason ?? ''}`.trim(),
                });
                cn = doc.id;
            }
            const items = await tx.select().from(sellerOrderItems).where(eq(sellerOrderItems.sellerOrderId, so.id));
            for (const i of items) if (i.kind !== 'installation') await tx.update(products).set({ stock: sql`${products.stock} + ${i.quantity}` }).where(eq(products.id, i.productId));
            const [u] = await tx.update(sellerOrders).set({ status: 'returned', returnStatus: 'received', creditNoteDocumentId: cn, refundPaise: so.totalPaise, refundStatus: r.status, refundReference: r.reference, updatedAt: new Date() }).where(eq(sellerOrders.id, so.id)).returning();
            await this.event(tx, so, 'returned', ctx.businessPartnerId ? 'seller' : 'admin', ctx.adminUserId, note ?? null);
            return u;
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // Settlement
    // ══════════════════════════════════════════════════════════════════════

    /** Delivered orders past their return window, with no open return, settle to the seller's ledger. */
    static async settleDue(now = new Date()) {
        const due = await db.select().from(sellerOrders).where(and(eq(sellerOrders.status, 'delivered'), isNull(sellerOrders.settledAt), lte(sellerOrders.settleAfter, now),
            or(isNull(sellerOrders.installationStatus), eq(sellerOrders.installationStatus, 'done')),
            or(isNull(sellerOrders.returnStatus), eq(sellerOrders.returnStatus, 'rejected')))).limit(1000);
        let n = 0;
        for (const so of due) {
            await withTransaction(async (tx) => {
                const [locked] = await tx.select().from(sellerOrders).where(and(eq(sellerOrders.id, so.id), isNull(sellerOrders.settledAt))).for('update');
                if (!locked) return;
                const meta = { sellerOrderId: so.id, code: so.code };
                await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'marketplace_sale' as any, amountPaise: -so.totalPaise, description: `Store order ${so.code} — sale`, metadata: meta });
                if (so.commissionPaise) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'marketplace_commission' as any, amountPaise: so.commissionPaise + so.commissionGstPaise, description: `Store order ${so.code} — commission ₹${r2(so.commissionPaise)} + GST`, metadata: meta });
                if (so.gatewayFeePaise) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'gateway_fee', amountPaise: so.gatewayFeePaise + so.gatewayFeeGstPaise, description: `Store order ${so.code} — payment collection fee ₹${r2(so.gatewayFeePaise)} + GST`, metadata: meta });
                if (so.tcsPaise) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'tcs' as any, amountPaise: so.tcsPaise, description: `Store order ${so.code} — GST TCS (claim it in your GSTR-3B)`, metadata: meta });
                if (so.tdsPaise) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'tds' as any, amountPaise: so.tdsPaise, description: `Store order ${so.code} — TDS u/s 194-O (credit in your Form 26AS)`, metadata: meta });
                await tx.update(sellerOrders).set({ settledAt: new Date(), updatedAt: new Date() }).where(eq(sellerOrders.id, so.id));
                n++;
            });
        }
        if (n) logger.info(`[MARKET] Settled ${n} seller order(s) to partner ledgers`);
        return n;
    }

    /** GSTR-8 working: TCS per seller GSTIN for a month (net of returns). */
    static async tcsReport(month: string) {
        const from = new Date(`${month}-01T00:00:00+05:30`);
        const [y, m] = month.split('-').map(Number);
        const to = new Date(Date.UTC(y, m, 1) - 330 * 60_000);
        const rows = await db.select({ o: sellerOrders, gstin: businessPartners.gstin, name: businessPartners.legalName, pan: businessPartners.pan, state: businessPartners.stateCode })
            .from(sellerOrders).innerJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(and(isNotNull(sellerOrders.settledAt), gte(sellerOrders.settledAt, from), lt(sellerOrders.settledAt, to)));
        const by = new Map<string, { gstin: string | null; name: string; pan: string | null; orders: number; taxable: number; tcs: number; tds: number }>();
        for (const r of rows) {
            const k = r.gstin ?? `#${r.o.sellerPartnerId}`;
            const a = by.get(k) ?? { gstin: r.gstin, name: r.name, pan: r.pan, orders: 0, taxable: 0, tcs: 0, tds: 0 };
            a.orders++; a.taxable += r.o.taxablePaise; a.tcs += r.o.tcsPaise; a.tds += r.o.tdsPaise;
            by.set(k, a);
        }
        return Array.from(by.values()).map(a => ({ ...a, taxable: r2(a.taxable), tcs: r2(a.tcs), tds: r2(a.tds) }));
    }

    // ══════════════════════════════════════════════════════════════════════
    // Reviews, score and tier
    // ══════════════════════════════════════════════════════════════════════

    static async addReview(userId: number, itemId: number, input: { rating: number; review?: string | null }) {
        const [i] = await db.select({ i: sellerOrderItems, o: sellerOrders }).from(sellerOrderItems).innerJoin(sellerOrders, eq(sellerOrders.id, sellerOrderItems.sellerOrderId)).where(eq(sellerOrderItems.id, itemId)).limit(1);
        if (!i || i.o.userId !== userId) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (i.o.status !== 'delivered') throw new HubError('You can review once it is delivered.', 'NOT_DELIVERED', 409);
        if (!(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)) throw new HubError('Rating is 1 to 5.', 'BAD_RATING');
        try {
            const [r] = await db.insert(productReviews).values({ sellerOrderItemId: i.i.id, userId, productId: i.i.productId, sellerPartnerId: i.o.sellerPartnerId, rating: input.rating, review: input.review?.trim()?.slice(0, 2000) || null }).returning();
            return r;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('You have already reviewed this item.', 'REVIEWED', 409);
            throw e;
        }
    }

    static async reply(ctx: HubContext, reviewId: number, text: string) {
        const [r] = await db.select().from(productReviews).where(and(eq(productReviews.id, reviewId), eq(productReviews.sellerPartnerId, ctx.businessPartnerId))).limit(1);
        if (!r) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (r.sellerReply) throw new HubError('You have already replied.', 'REPLIED', 409);
        if (!text?.trim()) throw new HubError('Write a reply.', 'NO_TEXT');
        const [u] = await db.update(productReviews).set({ sellerReply: text.trim().slice(0, 1000), updatedAt: new Date() }).where(eq(productReviews.id, r.id)).returning();
        return u;
    }

    static async reviewsForSeller(bpId: number) {
        return db.select({ r: productReviews, productName: products.name }).from(productReviews).innerJoin(products, eq(products.id, productReviews.productId))
            .where(eq(productReviews.sellerPartnerId, bpId)).orderBy(desc(productReviews.createdAt)).limit(200);
    }

    /** Score 0–100 and the tier it implies (unless staff locked the tier). */
    static async metrics(bpId: number, persist = true) {
        const since = new Date(Date.now() - 90 * 86_400_000);
        const orders = await db.select().from(sellerOrders).where(and(eq(sellerOrders.sellerPartnerId, bpId), gte(sellerOrders.createdAt, since)));
        const slaH = Number(await configService.get<number>('BUSINESS_CONFIG.MARKETPLACE_DISPATCH_SLA_HOURS', 48));
        const dispatched = orders.filter(o => o.dispatchedAt);
        const onTime = dispatched.length ? dispatched.filter(o => new Date(o.dispatchedAt!).getTime() - new Date(o.createdAt!).getTime() <= slaH * 3_600_000).length / dispatched.length : 1;
        const sellerCancels = orders.length ? orders.filter(o => o.status === 'cancelled' && o.cancelledBy === 'seller').length / orders.length : 0;
        const delivered = orders.filter(o => o.deliveredAt);
        const returns = delivered.length ? delivered.filter(o => o.returnStatus === 'received').length / delivered.length : 0;
        const [rt] = await db.select({ avg: sql<number>`coalesce(avg(${productReviews.rating}), 0)::float`, n: sql<number>`count(*)::int` }).from(productReviews).where(and(eq(productReviews.sellerPartnerId, bpId), gte(productReviews.createdAt, since)));
        const rating = rt?.n ? rt.avg : 4;   // no reviews yet: neutral, not punished
        const score = Math.round(30 * rating / 5 + 25 * onTime + 15 * (1 - sellerCancels) + 15 * (1 - returns) + 15);
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(sellerOrders).where(and(eq(sellerOrders.sellerPartnerId, bpId), isNotNull(sellerOrders.deliveredAt)));
        const tier = orders.length >= 5 && score < 40 ? 'restricted' : total < 10 ? 'new' : score >= 85 && total >= 50 ? 'preferred' : 'standard';
        const bp = await BusinessPartnerService.byId(bpId);
        if (persist && bp) {
            await db.update(businessPartners).set({ sellerScore: score, ...(bp.sellerTierLocked ? {} : { sellerTier: tier }) }).where(eq(businessPartners.id, bpId));
            // A restricted seller's listings are paused.
            if (!bp.sellerTierLocked && tier === 'restricted') await db.update(products).set({ listingStatus: 'paused', isActive: false }).where(and(eq(products.sellerPartnerId, bpId), eq(products.listingStatus, 'live')));
        }
        return { score, tier: bp?.sellerTierLocked ? bp.sellerTier : tier, computedTier: tier, locked: !!bp?.sellerTierLocked, ratingAvg: rt?.n ? Math.round(rt.avg * 10) / 10 : null, ratingCount: rt?.n ?? 0, onTimeDispatch: Math.round(onTime * 100), sellerCancelRate: Math.round(sellerCancels * 100), returnRate: Math.round(returns * 100), deliveredOrders: total };
    }

    static async recomputeAll() {
        const sellers = await db.selectDistinct({ id: products.sellerPartnerId }).from(products).where(isNotNull(products.sellerPartnerId));
        for (const s of sellers) if (s.id) await this.metrics(s.id).catch(e => logger.warn(`[MARKET] metrics for #${s.id}: ${e?.message}`));
    }

    /** What the store shows about a listing's seller (E-Commerce Rules 2020 disclosures). */
    static async publicSeller(productId: number) {
        const [r] = await db.select({ p: products, bp: businessPartners }).from(products).innerJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId)).where(eq(products.id, productId)).limit(1);
        if (!r || !r.p.isActive) return null;
        const m = await this.metrics(r.bp.id, false);
        const [rv] = await db.select({ avg: sql<number>`coalesce(avg(${productReviews.rating}), 0)::float`, n: sql<number>`count(*)::int` }).from(productReviews).where(and(eq(productReviews.productId, productId), eq(productReviews.isVisible, true)));
        const reviews = await db.select().from(productReviews).where(and(eq(productReviews.productId, productId), eq(productReviews.isVisible, true))).orderBy(desc(productReviews.createdAt)).limit(20);
        return {
            seller: {
                name: r.bp.displayName, legalName: r.bp.legalName, gstin: r.bp.gstin, address: [r.bp.address, r.bp.district, r.bp.pincode].filter(Boolean).join(', '),
                grievance: { name: r.bp.grievanceName, phone: r.bp.grievancePhone, email: r.bp.grievanceEmail }, returnPolicy: r.bp.returnPolicy,
                rating: m.ratingAvg, onTimeDispatch: m.onTimeDispatch, preferred: m.tier === 'preferred',
            },
            product: {
                mrp: r.p.mrp, price: r.p.price, countryOfOrigin: r.p.countryOfOrigin, manufacturer: r.p.manufacturer, netQuantity: r.p.netQuantity,
                returnWindowDays: r.p.returnWindowDays, warrantyMonths: r.p.warrantyMonths, warrantyBy: r.p.warrantyBy, bisNumber: r.p.bisNumber, wpcEta: r.p.wpcEta,
            },
            rating: rv?.n ? { average: Math.round(rv.avg * 10) / 10, count: rv.n } : null,
            reviews: reviews.map(x => ({ rating: x.rating, review: x.review, sellerReply: x.sellerReply, createdAt: x.createdAt })),
            platformGrievance: 'UniteFix grievance officer — see the Help section in the app',
        };
    }

    /** Staff: orders not dispatched within the SLA. */
    static async lateOrders() {
        const slaH = Number(await configService.get<number>('BUSINESS_CONFIG.MARKETPLACE_DISPATCH_SLA_HOURS', 48));
        const before = new Date(Date.now() - slaH * 3_600_000);
        return db.select({ o: sellerOrders, seller: businessPartners.displayName }).from(sellerOrders).innerJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(and(inArray(sellerOrders.status, ['placed', 'confirmed', 'packed']), sql`${nowFilledMs(sellerOrders.createdAt)} < ${before.getTime()}`)).orderBy(asc(sellerOrders.createdAt));
    }

    /** Does a cart contain partner listings? The legacy checkouts refuse them. */
    static async hasPartnerItems(productIds: number[]) {
        if (!productIds.length) return false;
        const [r] = await db.select({ id: products.id }).from(products).where(and(inArray(products.id, productIds), isNotNull(products.sellerPartnerId))).limit(1);
        return !!r;
    }
}

