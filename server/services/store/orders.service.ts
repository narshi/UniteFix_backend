/**
 * Orders as customers and staff see them. A checkout with items from two
 * sellers is two orders (two parcels, two invoices); the list groups nothing
 * and hides nothing, so what the customer sees matches what each seller ships.
 */

import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { sellerOrders, sellerOrderItems, sellerOrderEvents, storeShipmentEvents, businessPartners, productReviews, products, taxDocuments } from '@shared/schema';
import { HubError } from '../partner-hub.service';
import { loadSellerDetails } from '../invoice-generator';
import { TRACKING_LABEL } from './parcels.service';

const r2 = (p: number | null | undefined) => (p == null ? null : Math.round(p) / 100);
type SO = typeof sellerOrders.$inferSelect;

const STATUS_LABEL: Record<string, string> = {
    placed: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', dispatched: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned',
};

/** A tracking page the customer can open, when the courier has one. */
export function trackingUrl(courier: string | null, id: string | null): string | null {
    if (!courier || !id) return null;
    const c = courier.toLowerCase();
    // India Post has no stable deep link per article: open its site; the app shows the number to copy.
    if (/india ?post|speed ?post|dop/.test(c)) return 'https://www.indiapost.gov.in/';
    if (c.includes('delhivery')) return `https://www.delhivery.com/track-v2/package/${encodeURIComponent(id)}`;
    return null;
}

export class StoreOrders {

    private static canReturn(o: SO) {
        return o.status === 'delivered' && !o.returnStatus && o.returnWindowDays > 0 && !!o.settleAfter && new Date(o.settleAfter).getTime() > Date.now();
    }

    private static async view(rows: Array<{ o: SO; seller: string | null }>, opts: { withEvents?: boolean } = {}) {
        const ids = rows.map(r => r.o.id);
        const items = ids.length ? await db.select({ i: sellerOrderItems, thumb: products.thumbnailUrl }).from(sellerOrderItems).leftJoin(products, eq(products.id, sellerOrderItems.productId)).where(inArray(sellerOrderItems.sellerOrderId, ids)).orderBy(asc(sellerOrderItems.id)) : [];
        const reviews = items.length ? await db.select().from(productReviews).where(inArray(productReviews.sellerOrderItemId, items.map(x => x.i.id))) : [];
        const events = opts.withEvents && ids.length ? await db.select().from(sellerOrderEvents).where(inArray(sellerOrderEvents.sellerOrderId, ids)).orderBy(asc(sellerOrderEvents.createdAt), asc(sellerOrderEvents.id)) : [];
        const parcelEvents = opts.withEvents && ids.length ? await db.select().from(storeShipmentEvents).where(inArray(storeShipmentEvents.sellerOrderId, ids)).orderBy(desc(storeShipmentEvents.eventAt), desc(storeShipmentEvents.id)) : [];
        const docIds = rows.flatMap(r => [r.o.invoiceDocumentId, r.o.creditNoteDocumentId, r.o.receiptVoucherDocumentId]).filter((x): x is number => x != null);
        const docs = docIds.length ? await db.select({ id: taxDocuments.id, number: taxDocuments.number, kind: taxDocuments.docKind }).from(taxDocuments).where(inArray(taxDocuments.id, docIds)) : [];
        const uf = (await loadSellerDetails()).name || 'UniteFix';
        return rows.map(({ o, seller }) => ({
            id: o.id, code: o.code, status: o.status, statusLabel: STATUS_LABEL[o.status] ?? o.status, createdAt: o.createdAt,
            total: r2(o.totalPaise), tax: r2(o.gstPaise),
            seller: o.sellerPartnerId == null ? uf : seller, soldByUnitefix: o.sellerPartnerId == null,
            shipTo: { name: o.shipName, phone: o.shipPhone, address: o.shipAddress, pincode: o.shipPincode },
            shipment: o.courier || o.trackingId ? {
                courier: o.courier, trackingId: o.trackingId, trackingUrl: trackingUrl(o.courier, o.trackingId),
                status: o.trackingStatus, statusLabel: o.trackingStatus ? TRACKING_LABEL[o.trackingStatus as keyof typeof TRACKING_LABEL] ?? o.trackingStatus : null, updatedAt: o.trackingUpdatedAt,
                ...(opts.withEvents ? { events: parcelEvents.filter(e => e.sellerOrderId === o.id).slice(0, 40).map(e => ({ at: e.eventAt, description: e.description, office: e.office })) } : {}),
            } : null,
            dates: { confirmedAt: o.confirmedAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, cancelledAt: o.cancelledAt },
            refund: o.refundPaise ? { amount: r2(o.refundPaise), status: o.refundStatus } : null,
            cancel: o.status === 'cancelled' ? { by: o.cancelledBy, reason: o.cancelReason } : null,
            return: { windowDays: o.returnWindowDays, until: o.status === 'delivered' && o.returnWindowDays > 0 ? o.settleAfter : null, status: o.returnStatus, reason: o.returnReason },
            documents: docs.filter(d => [o.invoiceDocumentId, o.creditNoteDocumentId, o.receiptVoucherDocumentId].includes(d.id)).map(d => ({ id: d.id, number: d.number, kind: d.kind })),
            canCancel: ['placed', 'confirmed', 'packed'].includes(o.status),
            canReturn: this.canReturn(o),
            hasInvoice: !!o.invoiceDocumentId,
            installationStatus: o.installationStatus,
            items: items.filter(x => x.i.sellerOrderId === o.id).map(x => ({
                id: x.i.id, productId: x.i.productId, variantId: x.i.variantId, kind: x.i.kind, name: x.i.name, image: x.thumb ?? null,
                quantity: x.i.quantity, price: r2(x.i.unitPricePaise), total: r2(x.i.taxablePaise + x.i.taxPaise),
                review: reviews.find(v => v.sellerOrderItemId === x.i.id)?.rating ?? null,
                canReview: o.status === 'delivered' && x.i.kind === 'goods' && !reviews.some(v => v.sellerOrderItemId === x.i.id),
            })),
            ...(opts.withEvents ? { timeline: events.filter(e => e.sellerOrderId === o.id).map(e => ({ status: e.toStatus, label: STATUS_LABEL[e.toStatus] ?? e.toStatus.replace(/_/g, ' '), at: e.createdAt, note: e.actorType === 'customer' || e.toStatus.startsWith('return') ? e.note : (e.toStatus === 'dispatched' ? e.note : null) })) } : {}),
        }));
    }

    static async mine(userId: number, q: { page?: number; limit?: number; status?: 'open' | 'done' | 'all' } = {}) {
        const limit = Math.min(50, Math.max(1, q.limit ?? 20)), page = Math.max(1, q.page ?? 1);
        const conds: any[] = [eq(sellerOrders.userId, userId)];
        if (q.status === 'open') conds.push(inArray(sellerOrders.status, ['placed', 'confirmed', 'packed', 'dispatched']));
        if (q.status === 'done') conds.push(inArray(sellerOrders.status, ['delivered', 'cancelled', 'returned']));
        const rows = await db.select({ o: sellerOrders, seller: businessPartners.displayName }).from(sellerOrders)
            .leftJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(and(...conds)).orderBy(desc(sellerOrders.createdAt), desc(sellerOrders.id)).limit(limit + 1).offset((page - 1) * limit);
        return { items: await this.view(rows.slice(0, limit)), page, hasMore: rows.length > limit };
    }

    static async one(userId: number, id: number) {
        const rows = await db.select({ o: sellerOrders, seller: businessPartners.displayName }).from(sellerOrders)
            .leftJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(and(eq(sellerOrders.id, id), eq(sellerOrders.userId, userId))).limit(1);
        if (!rows.length) throw new HubError('Order not found', 'NOT_FOUND', 404);
        const [v] = await this.view(rows, { withEvents: true });
        const s = rows[0].o.sellerPartnerId == null ? null : (await db.select().from(businessPartners).where(eq(businessPartners.id, rows[0].o.sellerPartnerId)).limit(1))[0];
        const uf = await loadSellerDetails();
        return { ...v, grievance: s ? { name: s.grievanceName, phone: s.grievancePhone, email: s.grievanceEmail } : { name: 'UniteFix support', phone: uf.supportPhone, email: uf.supportEmail } };
    }

    /** A document the customer may download: one of their own order's. */
    static async documentFor(userId: number, orderId: number, docId: number) {
        const [o] = await db.select().from(sellerOrders).where(and(eq(sellerOrders.id, orderId), eq(sellerOrders.userId, userId))).limit(1);
        if (!o || ![o.invoiceDocumentId, o.creditNoteDocumentId, o.receiptVoucherDocumentId, o.refundVoucherDocumentId].includes(docId)) throw new HubError('Not found', 'NOT_FOUND', 404);
        return docId;
    }

    // ── Staff ────────────────────────────────────────────────────────────

    static async adminList(q: { scope?: 'unitefix' | 'partners' | 'all'; status?: string; search?: string; page?: number }) {
        const limit = 50, page = Math.max(1, q.page ?? 1);
        const conds: any[] = [];
        if ((q.scope ?? 'unitefix') === 'unitefix') conds.push(isNull(sellerOrders.sellerPartnerId));
        if (q.scope === 'partners') conds.push(sql`${sellerOrders.sellerPartnerId} IS NOT NULL`);
        if (q.status === 'to_ship') conds.push(inArray(sellerOrders.status, ['placed', 'confirmed', 'packed']));
        else if (q.status === 'returns') conds.push(inArray(sellerOrders.returnStatus, ['requested', 'approved']));
        else if (q.status) conds.push(eq(sellerOrders.status, q.status));
        const s = q.search?.trim();
        if (s) conds.push(or(ilike(sellerOrders.code, `%${s}%`), ilike(sellerOrders.shipName, `%${s}%`), ilike(sellerOrders.shipPhone, `%${s}%`), ilike(sellerOrders.trackingId, `%${s}%`)));
        const rows = await db.select({ o: sellerOrders, seller: businessPartners.displayName }).from(sellerOrders)
            .leftJoin(businessPartners, eq(businessPartners.id, sellerOrders.sellerPartnerId))
            .where(conds.length ? and(...conds) : undefined).orderBy(desc(sellerOrders.createdAt)).limit(limit + 1).offset((page - 1) * limit);
        const [counts] = await db.select({
            toShip: sql<number>`count(*) filter (where ${sellerOrders.sellerPartnerId} IS NULL AND ${sellerOrders.status} IN ('placed','confirmed','packed'))::int`,
            returns: sql<number>`count(*) filter (where ${sellerOrders.sellerPartnerId} IS NULL AND ${sellerOrders.returnStatus} IN ('requested','approved'))::int`,
        }).from(sellerOrders);
        return { items: await this.view(rows.slice(0, limit), { withEvents: true }), page, hasMore: rows.length > limit, counts };
    }
}
