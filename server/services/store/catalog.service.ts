/**
 * What the Shop tab shows: UniteFix's own products and partners' live
 * listings, in one catalogue. Only products that can be invoiced (HSN and GST
 * rate set) and whose seller is active are listed. Availability shown here is
 * a hint (on-hand minus live holds); the real check happens at checkout.
 */

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { products, productVariants, productImages, productCategories, businessPartners, productReviews } from '@shared/schema';
import { HubError } from '../partner-hub.service';
import { loadSellerDetails } from '../invoice-generator';
import { StoreInventory } from './inventory.service';

const r2 = (p: number | null | undefined) => (p == null ? null : Math.round(p) / 100);

/** Listed = live, active, invoiceable, and (for a partner listing) an active seller. */
const listed = and(
    eq(products.isActive, true), eq(products.listingStatus, 'live'), isNotNull(products.hsnCode), isNotNull(products.gstPercent),
    or(isNull(products.sellerPartnerId), eq(businessPartners.status, 'active')),
);

export type CatalogSort = 'relevance' | 'new' | 'price_asc' | 'price_desc' | 'rating';

export class StoreCatalog {

    static async categories() {
        const rows = await db.select({ id: productCategories.id, name: productCategories.name, slug: productCategories.slug, iconUrl: productCategories.iconUrl, n: sql<number>`count(${products.id})::int` })
            .from(productCategories)
            .leftJoin(products, eq(products.categoryId, productCategories.id))
            .leftJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId))
            .where(and(eq(productCategories.isActive, true), or(isNull(products.id), listed)))
            .groupBy(productCategories.id).orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
        return rows.filter(r => r.n > 0).map(r => ({ id: r.id, name: r.name, slug: r.slug, iconUrl: r.iconUrl, count: r.n }));
    }

    static async list(q: { search?: string; categoryId?: number; sort?: CatalogSort; page?: number; limit?: number }) {
        const limit = Math.min(40, Math.max(1, q.limit ?? 20));
        const page = Math.max(1, Math.min(500, q.page ?? 1));
        const conds: any[] = [listed];
        if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
        const s = q.search?.trim().slice(0, 80);
        if (s) {
            const like = `%${s.replace(/[%_\\]/g, m => `\\${m}`)}%`;
            conds.push(or(ilike(products.name, like), ilike(products.description, like), ilike(products.category, like), ilike(products.manufacturer, like)));
        }
        // Price shown: the lowest live option, else the product's own price (paise).
        const fromPaise = sql<number>`COALESCE((SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = ${products.id} AND v.is_active), ${products.price} * 100)`;
        const rating = sql<number>`(SELECT AVG(r.rating)::float FROM product_reviews r WHERE r.product_id = ${products.id} AND r.is_visible)`;
        const ratingCount = sql<number>`(SELECT COUNT(*)::int FROM product_reviews r WHERE r.product_id = ${products.id} AND r.is_visible)`;
        const order = q.sort === 'price_asc' ? [asc(fromPaise), asc(products.id)]
            : q.sort === 'price_desc' ? [desc(fromPaise), asc(products.id)]
            : q.sort === 'rating' ? [sql`${rating} DESC NULLS LAST`, desc(products.id)]
            : q.sort === 'new' ? [desc(products.createdAt), desc(products.id)]
            : s ? [sql`CASE WHEN ${products.name} ILIKE ${`${s}%`} THEN 0 ELSE 1 END`, desc(products.updatedAt)]
            : [desc(products.updatedAt), desc(products.id)];
        const rows = await db.select({ p: products, sellerName: businessPartners.displayName, fromPaise, rating, ratingCount, total: sql<number>`count(*) OVER()::int` })
            .from(products).leftJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId))
            .where(and(...conds)).orderBy(...order).limit(limit).offset((page - 1) * limit);

        const ids = rows.map(r => r.p.id);
        const variants = ids.length ? await db.select({ id: productVariants.id, productId: productVariants.productId }).from(productVariants).where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true))) : [];
        const avail = await StoreInventory.availability(db as any, [
            ...rows.filter(r => !variants.some(v => v.productId === r.p.id)).map(r => ({ productId: r.p.id, variantId: null })),
            ...variants.map(v => ({ productId: v.productId, variantId: v.id })),
        ]);
        const uf = (await loadSellerDetails()).name || 'UniteFix';
        const total = rows[0]?.total ?? 0;
        return {
            items: rows.map(r => {
                const vs = variants.filter(v => v.productId === r.p.id);
                const available = vs.length ? vs.reduce((a, v) => a + (avail.get(`${r.p.id}:${v.id}`) ?? 0), 0) : (avail.get(`${r.p.id}:0`) ?? 0);
                const images = (r.p.images ?? []) as string[];
                return {
                    id: r.p.id, name: r.p.name, image: r.p.thumbnailUrl ?? images[0] ?? null, categoryId: r.p.categoryId, category: r.p.category,
                    price: r2(Number(r.fromPaise)), mrp: r.p.mrp, hasOptions: vs.length > 0, inStock: available > 0, lowStock: available > 0 && available <= 3,
                    rating: r.rating != null ? Math.round(Number(r.rating) * 10) / 10 : null, ratingCount: Number(r.ratingCount ?? 0),
                    seller: r.p.sellerPartnerId ? r.sellerName : uf, soldByUnitefix: r.p.sellerPartnerId == null,
                };
            }),
            page, limit, total, hasMore: page * limit < total,
        };
    }

    static async product(id: number) {
        const [r] = await db.select({ p: products, bp: businessPartners, categoryName: productCategories.name }).from(products)
            .leftJoin(businessPartners, eq(businessPartners.id, products.sellerPartnerId))
            .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
            .where(and(eq(products.id, id), listed)).limit(1);
        if (!r) throw new HubError('This product is not on sale.', 'NOT_FOUND', 404);
        const p = r.p;
        const variants = await db.select().from(productVariants).where(and(eq(productVariants.productId, id), eq(productVariants.isActive, true))).orderBy(asc(productVariants.price));
        const gallery = await db.select().from(productImages).where(eq(productImages.productId, id)).orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));
        const avail = await StoreInventory.availability(db as any, variants.length ? variants.map(v => ({ productId: id, variantId: v.id })) : [{ productId: id, variantId: null }]);
        const [rt] = await db.select({ avg: sql<number>`coalesce(avg(${productReviews.rating}), 0)::float`, n: sql<number>`count(*)::int` }).from(productReviews).where(and(eq(productReviews.productId, id), eq(productReviews.isVisible, true)));
        const reviews = await db.select().from(productReviews).where(and(eq(productReviews.productId, id), eq(productReviews.isVisible, true))).orderBy(desc(productReviews.createdAt)).limit(20);
        const uf = await loadSellerDetails();
        const images = Array.from(new Set([p.thumbnailUrl, ...((p.images ?? []) as string[]), ...gallery.map(g => g.imageUrl)].filter((x): x is string => !!x)));
        const seller = p.sellerPartnerId
            ? { name: r.bp!.displayName, legalName: r.bp!.legalName, gstin: r.bp!.gstin, soldByUnitefix: false, address: [r.bp!.address, r.bp!.district, r.bp!.pincode].filter(Boolean).join(', '), grievance: { name: r.bp!.grievanceName, phone: r.bp!.grievancePhone, email: r.bp!.grievanceEmail }, returnPolicy: r.bp!.returnPolicy }
            : { name: uf.name, legalName: uf.name, gstin: uf.gstin, soldByUnitefix: true, address: uf.address, grievance: { name: 'UniteFix support', phone: uf.supportPhone, email: uf.supportEmail }, returnPolicy: null };
        const one = avail.get(`${id}:0`) ?? 0;
        return {
            id: p.id, name: p.name, description: p.description, category: r.categoryName ?? p.category, categoryId: p.categoryId, images,
            price: variants.length ? r2(variants[0].price) : p.price, mrp: variants.length ? r2(variants[0].mrp ?? (p.mrp != null ? p.mrp * 100 : null)) : p.mrp,
            available: variants.length ? null : one, inStock: variants.length ? variants.some(v => (avail.get(`${id}:${v.id}`) ?? 0) > 0) : one > 0,
            options: variants.map(v => ({ id: v.id, label: v.variantLabel, attributes: v.attributes, price: r2(v.price), mrp: r2(v.mrp ?? (p.mrp != null ? p.mrp * 100 : null)), available: avail.get(`${id}:${v.id}`) ?? 0 })),
            specifications: p.specifications ?? null,
            // Disclosures the E-Commerce Rules and Legal Metrology ask for, before purchase.
            details: { countryOfOrigin: p.countryOfOrigin, manufacturer: p.manufacturer, netQuantity: p.netQuantity, warrantyMonths: p.warrantyMonths, warrantyBy: p.warrantyBy, bisNumber: p.bisNumber, gstPercent: p.gstPercent == null ? null : Number(p.gstPercent) },
            returnPolicy: { returnable: (p.returnWindowDays ?? 0) > 0, days: p.returnWindowDays ?? 0, text: (p.returnWindowDays ?? 0) > 0 ? `Returnable within ${p.returnWindowDays} day${p.returnWindowDays === 1 ? '' : 's'} of delivery.` : 'Not returnable. If it arrives damaged or wrong, contact support within 48 hours.' },
            installation: p.installationPricePaise ? { price: r2(p.installationPricePaise), note: p.installationNote } : null,
            seller,
            rating: rt?.n ? { average: Math.round(rt.avg * 10) / 10, count: rt.n } : null,
            reviews: reviews.map(x => ({ rating: x.rating, review: x.review, sellerReply: x.sellerReply, createdAt: x.createdAt })),
        };
    }
}
