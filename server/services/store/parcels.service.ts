/**
 * Store parcels through India Post: booking an order (UniteFix's own, by
 * staff; a partner's, from their Hub), its label, and keeping the order in
 * step with where the parcel is (bulk tracking job + India Post's webhook).
 *
 * What the parcel's events do to the order:
 *   handed over (picked up / booked at the counter) → dispatched: the GST
 *     invoice is issued and the customer told
 *   out for delivery → the customer is told
 *   delivered → delivered: the return window starts
 *   returned to sender → staff and the seller are alerted (the refund is
 *     decided by people: the goods come back first)
 *
 * Booking is claimed on the order row first, so two people (or a retry)
 * cannot book the same order twice.
 */

import { db } from '../../db';
import { and, eq, inArray, isNull, or, lt, sql, notInArray, gte, asc } from 'drizzle-orm';
import { sellerOrders, sellerOrderItems, businessPartners, products, productVariants, storeShipmentEvents, indiaPostBarcodeSeries, platformConfig, type SellerOrder } from '@shared/schema';
import { GST_STATES } from '@shared/hub';
import { HubError } from '../partner-hub.service';
import { BusinessPartnerService } from '../business-partner.service';
import { withTransaction } from '../../lib/transaction';
import logger from '../../lib/logger';
import { IndiaPost, IndiaPostError, articleNumber, addressLines, foldStatus, statusOf, stateCodeOf, type IpParcel, type IpParty, type IpProduct, type TrackingStatus, type IpEvent } from './india-post.service';

const WAREHOUSE_KEY = 'OPERATIONAL_CONFIG.STORE_WAREHOUSE';
export interface Warehouse { name: string; company: string; line1: string; line2?: string | null; city: string; pincode: string; stateCode: string; phone: string; email?: string | null }

export const TRACKING_LABEL: Record<TrackingStatus, string> = {
    booked: 'Booked with India Post', pickup_cancelled: 'Pickup cancelled by India Post', handed_over: 'With India Post',
    in_transit: 'In transit', on_hold: 'Held at the post office', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
    returning: 'Being returned to the seller', returned: 'Returned to the seller',
};

const ip = (e: unknown) => { if (e instanceof IndiaPostError) throw new HubError(e.message, e.code, e.status); throw e; };
const CLAIM = 'ip:booking';

export class StoreParcels {

    // ── Setup ────────────────────────────────────────────────────────────

    static async warehouse(): Promise<Warehouse | null> {
        const [r] = await db.select({ value: platformConfig.value }).from(platformConfig).where(eq(platformConfig.key, WAREHOUSE_KEY)).limit(1);
        try { return r ? JSON.parse(r.value) as Warehouse : null; } catch { return null; }
    }

    static async setWarehouse(adminId: number, w: Warehouse) {
        if (!GST_STATES[w.stateCode]) throw new HubError('Choose the state.', 'BAD_INPUT');
        if (!/^[1-9]\d{5}$/.test(w.pincode)) throw new HubError('A 6-digit pincode.', 'BAD_INPUT');
        if (!/^[6-9]\d{9}$/.test(w.phone)) throw new HubError('A 10-digit mobile number for India Post.', 'BAD_INPUT');
        const value = JSON.stringify(w);
        await db.insert(platformConfig).values({ key: WAREHOUSE_KEY, value, valueType: 'json', category: 'OPERATIONAL_CONFIG', description: 'Where UniteFix ships its own store orders from (India Post sender / pickup address).', updatedBy: adminId })
            .onConflictDoUpdate({ target: platformConfig.key, set: { value, updatedBy: adminId } });
        return w;
    }

    static async series() {
        const rows = await db.select().from(indiaPostBarcodeSeries).orderBy(asc(indiaPostBarcodeSeries.id));
        return rows.map(r => ({ ...r, left: Math.max(0, r.lastSerial - r.nextSerial + 1), next: r.nextSerial <= r.lastSerial ? articleNumber(r.prefix, r.nextSerial) : null }));
    }

    /** A range India Post allocated, e.g. ET 21433001 – 21434000. Overlaps with an existing range are refused. */
    static async addSeries(adminId: number, s: { prefix: string; firstSerial: number; lastSerial: number; product: IpProduct; note?: string | null }) {
        const prefix = s.prefix.trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(prefix)) throw new HubError('The prefix is two letters, e.g. ET.', 'BAD_INPUT');
        if (!(s.firstSerial >= 0 && s.lastSerial <= 99_999_999 && s.firstSerial <= s.lastSerial)) throw new HubError('Serials are 8 digits, first ≤ last.', 'BAD_INPUT');
        return withTransaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(4243, 1)`);
            const [clash] = await tx.select({ id: indiaPostBarcodeSeries.id }).from(indiaPostBarcodeSeries).where(and(eq(indiaPostBarcodeSeries.prefix, prefix), sql`${indiaPostBarcodeSeries.firstSerial} <= ${s.lastSerial} AND ${indiaPostBarcodeSeries.lastSerial} >= ${s.firstSerial}`)).limit(1);
            if (clash) throw new HubError('This range overlaps one already added.', 'OVERLAP', 409);
            const [row] = await tx.insert(indiaPostBarcodeSeries).values({ prefix, firstSerial: s.firstSerial, lastSerial: s.lastSerial, nextSerial: s.firstSerial, product: s.product, note: s.note ?? null, createdBy: adminId }).returning();
            return row;
        });
    }

    static async setSeriesActive(id: number, active: boolean) {
        const [row] = await db.update(indiaPostBarcodeSeries).set({ isActive: active }).where(eq(indiaPostBarcodeSeries.id, id)).returning();
        if (!row) throw new HubError('Not found', 'NOT_FOUND', 404);
        return row;
    }

    /** The next article number, taken atomically. Used numbers are never given out again. */
    static async takeArticleNumber(product: IpProduct): Promise<string> {
        const r: any = await db.execute(sql`
            UPDATE india_post_barcode_series SET next_serial = next_serial + 1
            WHERE id = (SELECT id FROM india_post_barcode_series WHERE is_active AND product = ${product} AND next_serial <= last_serial ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING prefix, next_serial - 1 AS serial`);
        const row = (r.rows ?? r)[0];
        if (row) return articleNumber(row.prefix, Number(row.serial));
        // Test mode with no range ever added: a made-up number (ZZ, never a real prefix). Once ranges exist, running out is real.
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(indiaPostBarcodeSeries).where(eq(indiaPostBarcodeSeries.product, product));
        if (IndiaPost.mode() === 'mock' && !n) return articleNumber('ZZ', Math.floor(Math.random() * 99_999_999));
        throw new HubError(`No India Post article numbers left for ${product === 'SP' ? 'Speed Post' : 'Business Parcel'}. Add the range India Post allocated in Store Orders → Shipping setup.`, 'NO_NUMBERS', 409);
    }

    static async setup() {
        return { indiaPost: IndiaPost.status(), warehouse: await this.warehouse(), series: await this.series() };
    }

    // ── Parties ──────────────────────────────────────────────────────────

    private static async sender(so: SellerOrder): Promise<IpParty> {
        if (so.sellerPartnerId == null) {
            const w = await this.warehouse();
            if (!w) throw new HubError('Set UniteFix\'s shipping address first (Store Orders → Shipping setup).', 'NO_WAREHOUSE', 409);
            return { name: w.name, company: w.company, lines: addressLines([w.line1, w.line2]), city: w.city, state: GST_STATES[w.stateCode], pincode: w.pincode, mobile: w.phone, email: w.email ?? null };
        }
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, so.sellerPartnerId)).limit(1);
        if (!bp?.address?.trim() || !/^[1-9]\d{5}$/.test(bp.pincode ?? '')) throw new HubError('Add your full address and pincode in your profile first: India Post collects from there.', 'NO_ADDRESS', 409);
        const pin = await IndiaPost.pincode(bp.pincode!).catch(() => null);
        return { name: bp.legalName, company: bp.displayName || bp.legalName, lines: addressLines([bp.address]), city: bp.district || pin?.city || 'NA', state: bp.stateName ?? pin?.stateName ?? null, pincode: bp.pincode!, mobile: bp.contactPhone, email: bp.contactEmail ?? null };
    }

    /** The customer, from the address saved at checkout ("line1, line2, city, State 560001"). */
    private static async receiver(so: SellerOrder): Promise<IpParty> {
        const parts = String(so.shipAddress ?? '').split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length && /\d{6}$/.test(parts[parts.length - 1])) parts.pop();
        const city = parts.length > 1 ? parts.pop()! : null;
        const pin = so.shipPincode ? await IndiaPost.pincode(so.shipPincode).catch(() => null) : null;
        return { name: so.shipName ?? 'Customer', company: so.shipName ?? 'Customer', lines: addressLines(parts.length ? parts : [so.shipAddress]), city: city || pin?.city || 'NA', state: so.shipStateCode ? GST_STATES[so.shipStateCode] : pin?.stateName ?? null, pincode: so.shipPincode ?? '', mobile: so.shipPhone ?? '' };
    }

    // ── Parcel and postage ───────────────────────────────────────────────

    /** Weight and size from the products: weights add up; the size is the largest item, stacked. Null when a product has none. */
    static async suggestedParcel(soId: number): Promise<IpParcel & { complete: boolean }> {
        const rows = await db.select({ q: sellerOrderItems.quantity, kind: sellerOrderItems.kind, pw: products.weightGrams, vw: productVariants.weightGrams, l: products.packageLengthCm, w: products.packageWidthCm, h: products.packageHeightCm })
            .from(sellerOrderItems).innerJoin(products, eq(products.id, sellerOrderItems.productId)).leftJoin(productVariants, eq(productVariants.id, sellerOrderItems.variantId))
            .where(eq(sellerOrderItems.sellerOrderId, soId));
        const goods = rows.filter(r => r.kind === 'goods');
        const complete = goods.length > 0 && goods.every(r => (r.vw ?? r.pw) && r.l && r.w && r.h);
        const weight = goods.reduce((a, r) => a + (r.vw ?? r.pw ?? 500) * r.q, 0) + 50;   // + packing
        const L = Math.max(14, ...goods.map(r => r.l ?? 20)), W = Math.max(9, ...goods.map(r => r.w ?? 15));
        const H = Math.max(1, goods.reduce((a, r) => a + (r.h ?? 10) * r.q, 0));
        return { weightGrams: Math.round(weight), lengthCm: Math.min(150, L), widthCm: Math.min(150, W), heightCm: Math.min(150, H), complete };
    }

    static async quote(so: SellerOrder, product: IpProduct, parcel: IpParcel) {
        const [from, to] = [await this.sender(so), await this.receiver(so)];
        return IndiaPost.tariff(product, from.pincode, to.pincode, parcel).catch(ip);
    }

    // ── Booking ──────────────────────────────────────────────────────────

    /**
     * Book an order with India Post. `actor` decides whose order it may be:
     * staff book UniteFix's own, a partner books its own.
     */
    static async book(so: SellerOrder, actor: { partnerId: number | null }, input: { product: IpProduct; parcel: IpParcel; handover: 'pickup' | 'dropoff'; pickupDate?: string | null; slot?: '10:00-13:00' | '13:00-16:00' | null }) {
        if ((so.sellerPartnerId ?? null) !== actor.partnerId) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (IndiaPost.mode() === 'off') throw new HubError('India Post shipping is not switched on yet.', 'OFF', 409);
        if (!['confirmed', 'packed'].includes(so.status)) throw new HubError('Book the parcel once the order is confirmed and before it is dispatched.', 'BAD_STATE', 409);
        if (so.shipmentRef && so.shipmentRef !== CLAIM) throw new HubError(`Already booked: ${so.courier} ${so.trackingId}.`, 'BOOKED', 409);
        const problem = IndiaPost.parcelProblem(input.product, input.parcel);
        if (problem) throw new HubError(problem, 'BAD_PARCEL');

        let pickupAt: Date | null = null;
        if (input.handover === 'pickup') {
            if (!input.pickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.pickupDate) || !input.slot) throw new HubError('Choose the pickup day and time slot.', 'BAD_INPUT');
            pickupAt = new Date(`${input.pickupDate}T${input.slot === '10:00-13:00' ? '10:00:00' : '13:00:00'}+05:30`);
            const days = (pickupAt.getTime() - Date.now()) / 86_400_000;
            if (!(days > -0.1 && days <= 7)) throw new HubError('The pickup is today or within the next 7 days.', 'BAD_INPUT');
        }
        const sender = await this.sender(so), receiver = await this.receiver(so);
        const office = await IndiaPost.pincode(sender.pincode).catch(ip);
        if (!office?.officeId) throw new HubError(`India Post has no booking office listed for pincode ${sender.pincode}.`, 'NO_OFFICE', 409);
        const dest = await IndiaPost.pincode(receiver.pincode).catch(() => null);
        if (dest && !dest.deliverable) throw new HubError(`India Post does not deliver to pincode ${receiver.pincode}.`, 'NOT_SERVICEABLE', 409);

        // Claim the order: a second click, a second staff member or a retry stops here.
        const [claimed] = await db.update(sellerOrders).set({ shipmentRef: CLAIM, updatedAt: new Date() })
            .where(and(eq(sellerOrders.id, so.id), inArray(sellerOrders.status, ['confirmed', 'packed']),
                or(isNull(sellerOrders.shipmentRef), and(eq(sellerOrders.shipmentRef, CLAIM), lt(sellerOrders.updatedAt, new Date(Date.now() - 5 * 60_000))))))
            .returning({ id: sellerOrders.id });
        if (!claimed) throw new HubError('This order is being booked or is already booked. Refresh.', 'BOOKING', 409);

        let article: string;
        let res: { batchId: string; tariffPaise: number | null };
        let tariff: Awaited<ReturnType<typeof IndiaPost.tariff>> | null = null;
        try {
            tariff = await IndiaPost.tariff(input.product, sender.pincode, receiver.pincode, input.parcel).catch(e => { if (e instanceof IndiaPostError && e.code === 'BAD_PARCEL') throw e; logger.warn(`[INDIA-POST] No tariff for ${so.code}: ${e?.message}`); return null; });
            article = await this.takeArticleNumber(input.product);
            res = await IndiaPost.book({
                product: input.product, articleNumber: article, parcel: input.parcel, sender, receiver, reference: so.code,
                handover: input.handover === 'pickup' ? { kind: 'pickup', officeId: office.officeId, date: pickupAt!, slot: input.slot! } : { kind: 'dropoff', officeId: office.officeId },
            });
        } catch (e) {
            await db.update(sellerOrders).set({ shipmentRef: null }).where(and(eq(sellerOrders.id, so.id), eq(sellerOrders.shipmentRef, CLAIM)));
            if (e instanceof IndiaPostError) {
                logger.warn(`[INDIA-POST] Booking ${so.code} refused: ${e.message}`);
                throw new HubError(e.message, e.code, e.status === 422 ? 422 : e.status);
            }
            throw e;
        }

        const postage = tariff ? { paise: tariff.basePaise, gstPaise: tariff.taxPaise } : res.tariffPaise ? { paise: Math.round(res.tariffPaise / 1.18), gstPaise: res.tariffPaise - Math.round(res.tariffPaise / 1.18) } : { paise: 0, gstPaise: 0 };
        const u = await withTransaction(async (tx) => {
            const [row] = await tx.update(sellerOrders).set({
                courier: 'India Post', carrier: 'india_post', trackingId: article, shipmentRef: `ip:${IndiaPost.mode() === 'mock' ? 'mock:' : ''}${res.batchId}`.slice(0, 200),
                parcel: { ...input.parcel, product: input.product, handover: input.handover, pickupDate: input.pickupDate ?? null, slot: input.slot ?? null, officeId: office.officeId, officeName: office.offices.find(o => o.officeId === office.officeId)?.name ?? null } as any,
                courierChargePaise: postage.paise, courierChargeGstPaise: postage.gstPaise, trackingStatus: 'booked', trackingUpdatedAt: new Date(), updatedAt: new Date(),
            }).where(and(eq(sellerOrders.id, so.id), eq(sellerOrders.shipmentRef, CLAIM))).returning();
            if (!row) throw new HubError('The order changed while booking. Refresh.', 'STALE', 409);
            await tx.insert(storeShipmentEvents).values({ sellerOrderId: so.id, carrier: 'india_post', articleNumber: article, code: 'BOOKING', description: input.handover === 'pickup' ? `Pickup booked for ${input.pickupDate} ${input.slot}` : `Booked: drop at ${row.parcel && (row.parcel as any).officeName || 'the post office'}`, status: 'booked', office: null, eventAt: new Date(), source: 'booking', raw: { batchId: res.batchId } as any }).onConflictDoNothing();
            // A partner pays the postage through their statement (returned if the order is cancelled).
            if (so.sellerPartnerId != null && postage.paise > 0) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: so.sellerPartnerId, entryType: 'fee_charge', amountPaise: postage.paise + postage.gstPaise, description: `India Post for store order ${so.code} — ${article}, ${input.parcel.weightGrams} g`, metadata: { sellerOrderId: so.id, articleNumber: article } });
            return row;
        });
        logger.info(`[INDIA-POST] Booked ${so.code} as ${article} (${input.product}, ${input.handover}, ${IndiaPost.mode()})`);
        return { order: u, articleNumber: article, mode: IndiaPost.mode(), postage: (postage.paise + postage.gstPaise) / 100, handover: input.handover, office: (u.parcel as any)?.officeName ?? null };
    }

    /** India Post's A6 label when live; UniteFix's own 4×6 label (with the article barcode) otherwise. */
    static async label(so: SellerOrder): Promise<Buffer> {
        const { StoreShippingService } = await import('../store-shipping.service');
        if (so.carrier === 'india_post' && so.trackingId && IndiaPost.mode() === 'live') {
            try {
                const p = so.parcel as any;
                const sender = await this.sender(so), receiver = await this.receiver(so);
                const pdf = await IndiaPost.label({ articleNumber: so.trackingId, product: p?.product ?? 'SP', parcel: p, sender, receiver, bookingOffice: { name: p?.officeName ?? '', pincode: sender.pincode }, totalPaise: so.courierChargePaise + so.courierChargeGstPaise, reference: so.code });
                if (pdf) return pdf;
            } catch (e: any) { logger.warn(`[INDIA-POST] Label for ${so.code} fell back to ours: ${e?.message}`); }
        }
        return StoreShippingService.labelFor(so, so.sellerPartnerId == null ? await this.warehouse() : null);
    }

    // ── Tracking ─────────────────────────────────────────────────────────

    /** Record events for an order and move it along. Repeats are ignored. */
    static async apply(so: SellerOrder, events: IpEvent[], source: 'tracking' | 'webhook') {
        if (!events.length || !so.trackingId) return { added: 0, status: so.trackingStatus };
        const rows = events.map(e => ({ sellerOrderId: so.id, carrier: 'india_post', articleNumber: so.trackingId!, code: e.code, description: e.description.slice(0, 200), status: statusOf(e.code, e.description, e.rts), office: e.office?.slice(0, 120) ?? null, eventAt: e.at, source, raw: e.raw as any }));
        const added = await db.insert(storeShipmentEvents).values(rows).onConflictDoNothing().returning({ status: storeShipmentEvents.status, at: storeShipmentEvents.eventAt });
        if (!added.length) return { added: 0, status: so.trackingStatus };
        const before = (so.trackingStatus as TrackingStatus | null) ?? null;
        const now = foldStatus(before, added.map(a => ({ status: a.status as TrackingStatus | null, at: a.at })));
        if (now !== before) {
            await db.update(sellerOrders).set({ trackingStatus: now, trackingUpdatedAt: new Date() }).where(and(eq(sellerOrders.id, so.id), before == null ? isNull(sellerOrders.trackingStatus) : eq(sellerOrders.trackingStatus, before)));
            await this.effects(so, before, now!);
        }
        return { added: added.length, status: now };
    }

    private static async effects(so: SellerOrder, before: TrackingStatus | null, now: TrackingStatus) {
        const { MarketplaceService } = await import('../marketplace.service');
        const { NotificationService } = await import('../notification.service');
        const { HubAlerts } = await import('../hub-alerts.service');
        // Handed over to India Post at some point (a return means it left too): the goods have gone, so the invoice is due.
        const reached = now !== 'booked' && now !== 'pickup_cancelled';
        try {
            let status = so.status;
            if (reached && ['confirmed', 'packed'].includes(status)) { await MarketplaceService.systemTransition(so.id, 'dispatched', `India Post ${so.trackingId}`); status = 'dispatched'; }
            if (now === 'delivered' && status === 'dispatched') await MarketplaceService.systemTransition(so.id, 'delivered', `India Post: delivered`);
        } catch (e: any) { logger.warn(`[INDIA-POST] ${so.code}: could not move the order to match "${now}": ${e?.message}`); }

        const tell = (title: string, body: string) => NotificationService.sendToUser(so.userId, title, body, 'store_order', { orderId: so.id, sellerOrderId: so.id, url: `unitefix://order/${so.id}` }).catch(() => null);
        if (now === 'out_for_delivery' && before !== 'out_for_delivery') await tell('Out for delivery', `Your order ${so.code} is out for delivery with India Post today.`);
        if (now === 'on_hold' && before !== 'on_hold') await tell('Waiting at the post office', `India Post is holding your order ${so.code} (${so.trackingId}). Collect it from the post office or call them to redeliver.`);
        if (now === 'returning' && before !== 'returning') {
            await tell('Order being returned', `India Post could not deliver ${so.code} and is returning it to the seller. We will contact you about a refund.`);
            const msg = `India Post is returning ${so.code} (${so.trackingId}) to the sender: not delivered or refused.`;
            if (so.sellerPartnerId != null) await HubAlerts.send(so.sellerPartnerId, 'store_order', { title: 'Parcel coming back', body: msg, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
            await NotificationService.sendToAdmins('Store parcel returning', msg, { sellerOrderId: so.id }).catch(() => null);
        }
        if (now === 'returned' && before !== 'returned') {
            const msg = `${so.code} (${so.trackingId}) is back with the sender. Check the goods and refund the customer.`;
            if (so.sellerPartnerId != null) await HubAlerts.send(so.sellerPartnerId, 'store_order', { title: 'Parcel returned', body: msg, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
            await NotificationService.sendToAdmins('Store parcel returned', msg, { sellerOrderId: so.id }).catch(() => null);
        }
        if (now === 'pickup_cancelled' && before !== 'pickup_cancelled') {
            const msg = `India Post cancelled the pickup for ${so.code} (${so.trackingId}). Drop the parcel at the post office with the same label, or call them to collect.`;
            if (so.sellerPartnerId != null) await HubAlerts.send(so.sellerPartnerId, 'store_order', { title: 'Pickup cancelled', body: msg, link: '/partner/store/orders', refType: 'seller_order', refId: so.id });
            else await NotificationService.sendToAdmins('India Post pickup cancelled', msg, { sellerOrderId: so.id }).catch(() => null);
        }
    }

    /** Every open India Post parcel, 500 at a time. Runs every 30 minutes. */
    static async syncTracking() {
        if (IndiaPost.mode() === 'off') return { checked: 0, updated: 0 };
        const open = await db.select().from(sellerOrders).where(and(
            eq(sellerOrders.carrier, 'india_post'), notInArray(sellerOrders.status, ['cancelled']),
            or(isNull(sellerOrders.trackingStatus), notInArray(sellerOrders.trackingStatus, ['delivered', 'returned'])),
            gte(sellerOrders.createdAt, new Date(Date.now() - 90 * 86_400_000)),
        )).limit(5000);
        let updated = 0;
        for (let i = 0; i < open.length; i += 500) {
            const chunk = open.slice(i, i + 500);
            let events: Map<string, IpEvent[]>;
            try { events = await IndiaPost.track(chunk.map(o => o.trackingId!).filter(Boolean)); }
            catch (e: any) { logger.warn(`[INDIA-POST] Tracking failed: ${e?.message}`); break; }
            for (const so of chunk) {
                const ev = events.get(String(so.trackingId).toUpperCase());
                if (!ev?.length) continue;
                try { if ((await this.apply(so, ev, 'tracking')).added) updated++; }
                catch (e: any) { logger.warn(`[INDIA-POST] Applying tracking to ${so.code} failed: ${e?.message}`); }
            }
        }
        return { checked: open.length, updated };
    }

    /** India Post's push: one event or a list. Unknown article numbers are counted, not errors. */
    static async webhook(body: unknown) {
        const list = IndiaPost.webhookEvents(body);
        const byArticle = new Map<string, IpEvent[]>();
        for (const x of list) byArticle.set(x.article, [...(byArticle.get(x.article) ?? []), x.event]);
        const orders = byArticle.size ? await db.select().from(sellerOrders).where(and(eq(sellerOrders.carrier, 'india_post'), inArray(sellerOrders.trackingId, Array.from(byArticle.keys())))) : [];
        let applied = 0;
        for (const so of orders) applied += (await this.apply(so, byArticle.get(String(so.trackingId).toUpperCase()) ?? [], 'webhook')).added;
        return { received: list.length, matched: orders.length, applied, unknown: byArticle.size - orders.length };
    }

    /** The events of an order, newest first (for staff, the seller and the customer). */
    static async events(soId: number) {
        const rows = await db.select().from(storeShipmentEvents).where(eq(storeShipmentEvents.sellerOrderId, soId)).orderBy(sql`${storeShipmentEvents.eventAt} DESC`, sql`${storeShipmentEvents.id} DESC`).limit(100);
        return rows.map(r => ({ at: r.eventAt, description: r.description, office: r.office, status: r.status }));
    }

    // ── Checkout ─────────────────────────────────────────────────────────

    /** India Post checks run when it is live (or a test switches them on). */
    static checksPincodes() { return IndiaPost.mode() === 'live' || process.env.STORE_CHECK_PINCODES === '1'; }

    /** For the address form: the state and city of a pincode, and whether India Post delivers there. */
    static async pincodeHint(pin: string) {
        const info = await IndiaPost.pincode(pin).catch(() => null);
        if (!info) return { known: false as const };
        return { known: true as const, deliverable: info.deliverable, stateCode: info.stateCode, stateName: info.stateName, city: info.city ? titleCase(info.city) : null };
    }

    /**
     * At checkout: refuse a pincode India Post does not deliver to, or one in a
     * different state than chosen (the state decides the GST on the invoice).
     * If India Post cannot be reached, the sale goes ahead.
     */
    static async checkDestination(pin: string, stateCode: string) {
        if (!this.checksPincodes()) return;
        let info;
        try { info = await IndiaPost.pincode(pin); } catch (e: any) { logger.warn(`[INDIA-POST] Pincode ${pin} not checked: ${e?.message}`); return; }
        if (!info) return;
        if (!info.deliverable) throw new HubError(`India Post does not deliver to pincode ${pin}. Check the pincode or use another address.`, 'NOT_SERVICEABLE');
        const code = info.stateCode ?? stateCodeOf(info.stateName);
        if (code && code !== stateCode) throw new HubError(`Pincode ${pin} is in ${GST_STATES[code]}, not ${GST_STATES[stateCode] ?? 'the state chosen'}. Choose ${GST_STATES[code]}.`, 'STATE_MISMATCH');
    }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
