/**
 * The admin dashboard's numbers: where money comes from and where it goes,
 * how the work is flowing right now, and what is waiting on staff.
 *
 * MONEY, kept apart on purpose — the old chart summed service invoices and
 * called it revenue, which counted GST and the technician's share as ours and
 * missed every partner stream:
 *
 *   Gross volume      what customers paid through UniteFix (incl. GST)
 *   UniteFix revenue  what UniteFix keeps, before GST: platform fees, parts it
 *                     sold, commission and collection fees, subscriptions
 *   Partner earnings  what partners earn through UniteFix (their jobs, their
 *                     store sales, broadband recharges, payment links)
 *   Expert earnings   what UniteFix's own experts earn on their jobs
 *   GST               collected for the government, nobody's revenue
 *   Partners' own sales  invoices partners raise to their own customers in
 *                     the Hub — their business, shown for context, never
 *                     added to UniteFix's numbers
 *
 * Amounts are worked out in paise and returned in rupees.
 */

import { db } from '../db';
import { and, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql, count, avg } from 'drizzle-orm';
import {
    serviceRequests, ftthRecharges, ftthLeads, b2bOrders, sellerOrders, partnerPayLinks, taxDocuments, taxDocumentLines,
    users, employees, businessPartners, partnerTerritories, partnerServiceRates, products, consignmentLots,
    withdrawalRequests, warrantyClaims, supportTickets, ratings, partRequests, eventBookings,
} from '@shared/schema';
import { nowFilledMs } from '../lib/db-time';
import logger from '../lib/logger';

export type Range = '7d' | '30d' | '90d' | '12m';
type Stream = 'services_direct' | 'services_partner' | 'broadband' | 'parts' | 'store' | 'paylinks' | 'celebrations' | 'subscriptions';

export const STREAMS: Array<{ key: Stream; label: string; note: string }> = [
    { key: 'services_direct', label: 'Services · UniteFix experts', note: 'Platform fee, booking charge and UniteFix parts on jobs done by UniteFix experts' },
    { key: 'services_partner', label: 'Services · partners', note: 'Field fee, booking charge and UniteFix parts on jobs done by partners in their territory' },
    { key: 'broadband', label: 'Broadband', note: 'Convenience fees on recharges, lead fees from operators' },
    { key: 'parts', label: 'Parts sales (B2B)', note: 'Spare parts sold to technicians and partners, before GST' },
    { key: 'store', label: 'Partner store', note: 'Commission, payment collection fee and charges on partner listings' },
    { key: 'paylinks', label: 'Payment links', note: 'Collection fee on partners\' customers paying online' },
    { key: 'celebrations', label: 'Celebrations bookings', note: 'Commission on hall, photography and event bookings made through UniteFix, when the event takes place' },
    { key: 'subscriptions', label: 'Hub subscriptions', note: 'Partner Hub Pro plans, before GST' },
];

interface Event { at: number; stream: Stream; gmv: number; unitefix: number; partner: number; expert: number; gst: number; job?: boolean }

const IST = 330 * 60_000;
const DAY = 86_400_000;
const p = (rupees: unknown) => Math.round(Number(rupees ?? 0) * 100) || 0;
const r = (paise: number) => Math.round(paise) / 100;

/** The start (UTC ms) of the IST day / week (Monday) / month containing t. */
function bucketStart(t: number, g: 'day' | 'week' | 'month') {
    const d = new Date(t + IST);
    let y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    if (g === 'month') day = 1;
    let start = Date.UTC(y, m, day) - IST;
    if (g === 'week') start -= ((d.getUTCDay() + 6) % 7) * DAY;
    return start;
}
const nextBucket = (s: number, g: 'day' | 'week' | 'month') => {
    if (g !== 'month') return s + (g === 'day' ? DAY : 7 * DAY);
    const d = new Date(s + IST);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - IST;
};
const bucketLabel = (s: number, g: 'day' | 'week' | 'month') =>
    new Date(s).toLocaleDateString('en-IN', g === 'month' ? { month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' } : { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export class BusinessOverviewService {

    static window(range: Range, now = Date.now()) {
        const g: 'day' | 'week' | 'month' = range === '12m' ? 'month' : range === '90d' ? 'week' : 'day';
        const len = range === '7d' ? 7 * DAY : range === '30d' ? 30 * DAY : range === '90d' ? 90 * DAY : 365 * DAY;
        // Align the start to a bucket so the first bar is a whole day/week/month.
        const ist = new Date(now + IST);
        const from = range === '12m'
            ? Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 11, 1) - IST   // this month and the 11 before it
            : bucketStart(now - len + DAY, g);
        const span = now - from;
        return { g, from, to: now, prevFrom: from - span, prevTo: from };
    }

    /** Every money event from prevFrom on, in paise. */
    private static async events(since: Date): Promise<{ events: Event[]; partnerOwn: Array<{ at: number; amount: number }> }> {
        const ev: Event[] = [];

        // Services, on completion. v2 jobs carry the split frozen in their snapshot.
        const jobs = await db.select({ snap: serviceRequests.pricingSnapshot, total: serviceRequests.totalAmount, fee: serviceRequests.commissionAmount, partner: serviceRequests.dispatchPartnerId, at: serviceRequests.completedAt })
            .from(serviceRequests).where(and(eq(serviceRequests.status, 'completed' as any), gte(serviceRequests.completedAt, since)));
        for (const j of jobs) {
            if (!j.at) continue;
            const s: any = j.snap ?? {};
            const v2 = s.snapshotVersion === 2;
            const gmv = v2 ? p(s.grossTotal) : p(j.total);
            // v2: the booking charge is carved out of the price and kept by UniteFix, like the platform fee.
            const fee = v2 ? p(s.platformFee) + p(s.bookingFee) + p(s.platformPartsCost) : p(j.fee);
            const gst = v2 ? p(s.gst) + p(s.partsGst) : 0;
            const earn = v2 ? p(s.technicianEarning) : Math.max(0, gmv - fee);
            const partnerJob = !!j.partner;
            ev.push({ at: new Date(j.at).getTime(), stream: partnerJob ? 'services_partner' : 'services_direct', gmv, unitefix: fee, partner: partnerJob ? earn : 0, expert: partnerJob ? 0 : earn, gst, job: true });
        }

        // Broadband recharges (createdAt is filled by the database) and lead fees.
        const rech = await db.select({ at: nowFilledMs(ftthRecharges.createdAt), total: ftthRecharges.totalPaise, uf: ftthRecharges.platformRevenuePaise, op: ftthRecharges.operatorPayablePaise, gst: ftthRecharges.gstOnConvenienceFeePaise })
            .from(ftthRecharges).where(and(eq(ftthRecharges.status, 'success' as any), gte(ftthRecharges.createdAt, since)));
        for (const x of rech) ev.push({ at: Number(x.at), stream: 'broadband', gmv: x.total, unitefix: x.uf, partner: x.op, expert: 0, gst: x.gst ?? 0 });
        const leads = await db.select({ at: ftthLeads.convertedAt, fee: ftthLeads.leadFeePaise }).from(ftthLeads).where(and(isNotNull(ftthLeads.convertedAt), gte(ftthLeads.convertedAt, since)));
        for (const l of leads) {
            if (!l.at || !l.fee) continue;
            const taxable = Math.round(l.fee * 100 / 118);
            ev.push({ at: new Date(l.at).getTime(), stream: 'broadband', gmv: 0, unitefix: taxable, partner: 0, expert: 0, gst: 0 });
        }

        // Parts sold to the trade, on dispatch.
        const b2b = await db.select({ at: b2bOrders.dispatchedAt, total: b2bOrders.totalPaise, sub: b2bOrders.subtotalPaise, disc: b2bOrders.discountPaise, ship: b2bOrders.shippingPaise, gst: b2bOrders.gstPaise })
            .from(b2bOrders).where(and(inArray(b2bOrders.status, ['dispatched', 'delivered'] as any), gte(b2bOrders.dispatchedAt, since)));
        for (const o of b2b) if (o.at) ev.push({ at: new Date(o.at).getTime(), stream: 'parts', gmv: o.total, unitefix: Math.max(0, o.sub - o.disc + o.ship), partner: 0, expert: 0, gst: o.gst });

        // Partner store orders, when placed (cancelled and returned ones are not sales).
        const so = await db.select({ at: nowFilledMs(sellerOrders.createdAt), total: sellerOrders.totalPaise, gst: sellerOrders.gstPaise, com: sellerOrders.commissionPaise, gw: sellerOrders.gatewayFeePaise, pen: sellerOrders.penaltyPaise, waived: sellerOrders.penaltyWaivedAt, status: sellerOrders.status })
            .from(sellerOrders).where(gte(sellerOrders.createdAt, since));
        for (const o of so) {
            const pen = o.waived ? 0 : (o.pen ?? 0);
            if (o.status === 'cancelled' || o.status === 'returned') { if (pen) ev.push({ at: Number(o.at), stream: 'store', gmv: 0, unitefix: pen, partner: -pen, expert: 0, gst: 0 }); continue; }
            ev.push({ at: Number(o.at), stream: 'store', gmv: o.total, unitefix: o.com + o.gw + pen, partner: o.total - o.gst - o.com - o.gw - pen, expert: 0, gst: o.gst });
        }

        // Partners' customers paying through a payment link.
        const pl = await db.select({ at: partnerPayLinks.paidAt, amt: partnerPayLinks.amountPaise, fee: partnerPayLinks.feePaise, feeGst: partnerPayLinks.feeGstPaise })
            .from(partnerPayLinks).where(and(eq(partnerPayLinks.status, 'paid'), gte(partnerPayLinks.paidAt, since)));
        for (const x of pl) if (x.at) ev.push({ at: new Date(x.at).getTime(), stream: 'paylinks', gmv: x.amt, unitefix: x.fee, partner: x.amt - x.fee - x.feeGst, expert: 0, gst: 0 });

        // Celebrations: commission on bookings through UniteFix, when charged (the event took place, or what was kept on a cancellation).
        const cb = await db.select({ at: eventBookings.commissionChargedAt, total: eventBookings.totalPaise, status: eventBookings.status, fee: eventBookings.commissionPaise, pct: eventBookings.commissionPercent })
            .from(eventBookings).where(and(isNotNull(eventBookings.commissionChargedAt), gte(eventBookings.commissionChargedAt, since)));
        for (const x of cb) {
            if (!x.at || !x.fee) continue;
            const base = x.status === 'cancelled' && Number(x.pct) > 0 ? Math.round(x.fee * 100 / Number(x.pct)) : x.total;
            ev.push({ at: new Date(x.at).getTime(), stream: 'celebrations', gmv: base, unitefix: x.fee, partner: base - x.fee, expert: 0, gst: 0 });
        }

        // Hub Pro subscriptions, from the monthly fee invoices.
        const subs = await db.select({ period: taxDocuments.periodFrom, taxable: taxDocumentLines.taxablePaise })
            .from(taxDocumentLines).innerJoin(taxDocuments, eq(taxDocuments.id, taxDocumentLines.documentId))
            .where(and(eq(taxDocuments.purpose, 'fee'), eq(taxDocuments.status, 'issued'), sql`${taxDocumentLines.description} ILIKE 'Partner Hub Pro%'`, gte(taxDocuments.periodFrom, new Date(since.getTime() + IST).toISOString().slice(0, 10))));
        for (const x of subs) if (x.period) ev.push({ at: new Date(`${x.period}T00:00:00+05:30`).getTime(), stream: 'subscriptions', gmv: 0, unitefix: x.taxable, partner: 0, expert: 0, gst: 0 });

        // Partners' own invoices to their own customers — context, not UniteFix money.
        const own = await db.select({ at: taxDocuments.issuedAt, total: taxDocuments.totalPaise }).from(taxDocuments)
            .where(and(eq(taxDocuments.issuer, 'partner'), inArray(taxDocuments.docKind, ['tax_invoice', 'bill_of_supply']), eq(taxDocuments.status, 'issued'),
                notInArray(taxDocuments.purpose, ['subcontract', 'consignment', 'marketplace_sale']), gte(taxDocuments.issuedAt, since)));
        return { events: ev, partnerOwn: own.filter(o => o.at).map(o => ({ at: new Date(o.at!).getTime(), amount: o.total })) };
    }

    static async money(range: Range) {
        const w = this.window(range);
        const { events, partnerOwn } = await this.events(new Date(w.prevFrom));
        const inCur = (t: number) => t >= w.from && t <= w.to;
        const inPrev = (t: number) => t >= w.prevFrom && t < w.prevTo;

        const zero = () => ({ gmv: 0, unitefix: 0, partner: 0, expert: 0, gst: 0, jobs: 0, partnerOwnSales: 0 });
        const cur = zero(), prev = zero();
        const streamCur = new Map<Stream, ReturnType<typeof zero>>(), streamPrev = new Map<Stream, ReturnType<typeof zero>>();
        for (const s of STREAMS) { streamCur.set(s.key, zero()); streamPrev.set(s.key, zero()); }
        const add = (t: ReturnType<typeof zero>, e: Event) => { t.gmv += e.gmv; t.unitefix += e.unitefix; t.partner += e.partner; t.expert += e.expert; t.gst += e.gst; if (e.job) t.jobs++; };

        // Buckets for the chart.
        const buckets: Array<{ start: number; end: number; label: string; by: Record<Stream, number>; gmv: number; partner: number; expert: number; gst: number; partnerOwnSales: number }> = [];
        for (let s = w.from; s <= w.to; s = nextBucket(s, w.g)) {
            buckets.push({ start: s, end: nextBucket(s, w.g), label: bucketLabel(s, w.g), by: Object.fromEntries(STREAMS.map(x => [x.key, 0])) as Record<Stream, number>, gmv: 0, partner: 0, expert: 0, gst: 0, partnerOwnSales: 0 });
        }
        const bucketOf = (t: number) => buckets.find(b => t >= b.start && t < b.end);

        for (const e of events) {
            if (inCur(e.at)) {
                add(cur, e); add(streamCur.get(e.stream)!, e);
                const b = bucketOf(e.at);
                if (b) { b.by[e.stream] += e.unitefix; b.gmv += e.gmv; b.partner += e.partner; b.expert += e.expert; b.gst += e.gst; }
            } else if (inPrev(e.at)) { add(prev, e); add(streamPrev.get(e.stream)!, e); }
        }
        for (const o of partnerOwn) {
            if (inCur(o.at)) { cur.partnerOwnSales += o.amount; const b = bucketOf(o.at); if (b) b.partnerOwnSales += o.amount; }
            else if (inPrev(o.at)) prev.partnerOwnSales += o.amount;
        }

        const totals = (t: ReturnType<typeof zero>) => ({
            gmv: r(t.gmv), unitefix: r(t.unitefix), partner: r(t.partner), expert: r(t.expert), gst: r(t.gst), jobs: t.jobs, partnerOwnSales: r(t.partnerOwnSales),
            takeRate: t.gmv > 0 ? Math.round(t.unitefix / t.gmv * 1000) / 10 : 0,
        });
        return {
            range, granularity: w.g, from: new Date(w.from).toISOString(), to: new Date(w.to).toISOString(),
            totals: { current: totals(cur), previous: totals(prev) },
            streams: STREAMS.map(s => {
                const c = streamCur.get(s.key)!, pv = streamPrev.get(s.key)!;
                return { key: s.key, label: s.label, note: s.note, gmv: r(c.gmv), unitefix: r(c.unitefix), partner: r(c.partner), expert: r(c.expert), gst: r(c.gst), previousUnitefix: r(pv.unitefix) };
            }),
            series: buckets.map(b => ({
                label: b.label, start: new Date(b.start).toISOString(),
                ...Object.fromEntries(STREAMS.map(s => [s.key, r(b.by[s.key])])),
                unitefix: r(STREAMS.reduce((a, s) => a + b.by[s.key], 0)),
                gmv: r(b.gmv), partner: r(b.partner), expert: r(b.expert), gst: r(b.gst), partnerOwnSales: r(b.partnerOwnSales),
            })),
        };
    }

    /** How the work stands right now, and how the period went. */
    static async operations(range: Range) {
        const w = this.window(range);
        const since = new Date(w.from);
        const active = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'];
        const byStatus = await db.select({ status: serviceRequests.status, n: count() }).from(serviceRequests)
            .where(and(inArray(serviceRequests.status, active as any), or(ne(serviceRequests.status, 'created' as any), eq(serviceRequests.bookingFeeStatus, 'paid'))))
            .groupBy(serviceRequests.status);
        const n = (s: string) => Number(byStatus.find(x => x.status === s)?.n ?? 0);
        const [waitingUf] = await db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'created' as any), eq(serviceRequests.bookingFeeStatus, 'paid'), isNull(serviceRequests.providerId), isNull(serviceRequests.dispatchPartnerId)));
        const [waitingPartner] = await db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'created' as any), eq(serviceRequests.bookingFeeStatus, 'paid'), isNull(serviceRequests.providerId), isNotNull(serviceRequests.dispatchPartnerId)));
        const [overdue] = await db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'created' as any), isNull(serviceRequests.providerId), isNotNull(serviceRequests.escalatedAt)));
        const [partsWaiting] = await db.select({ n: count() }).from(partRequests).where(eq(partRequests.status, 'pending'));
        const [done] = await db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'completed' as any), gte(serviceRequests.completedAt, since)));
        const [cancelled] = await db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'cancelled' as any), gte(serviceRequests.updatedAt, since)));
        const [rating] = await db.select({ avg: avg(ratings.rating), n: count() }).from(ratings).where(gte(ratings.createdAt, since));
        const [newCustomers] = await db.select({ n: count() }).from(users).where(and(eq(users.role, 'user'), gte(users.createdAt, since)));
        const [customers] = await db.select({ n: count() }).from(users).where(eq(users.role, 'user'));
        const [experts] = await db.select({ n: count() }).from(employees).where(and(eq(employees.isActive, true), isNull(employees.managedByPartnerId)));
        const [online] = await db.select({ n: count() }).from(employees).where(and(eq(employees.isActive, true), eq(employees.isOnline, true)));
        const [partnerTechs] = await db.select({ n: count() }).from(employees).where(and(eq(employees.isActive, true), isNotNull(employees.managedByPartnerId)));
        const [partners] = await db.select({ n: count() }).from(businessPartners).where(eq(businessPartners.status, 'active'));
        const [pro] = await db.select({ n: count() }).from(businessPartners).where(and(eq(businessPartners.status, 'active'), eq(businessPartners.hubPlan, 'pro')));
        const decided = Number(done?.n ?? 0) + Number(cancelled?.n ?? 0);
        return {
            pipeline: [
                { key: 'waiting', label: 'Waiting for an expert', count: Number(waitingUf?.n ?? 0) + Number(waitingPartner?.n ?? 0), sub: `${waitingPartner?.n ?? 0} with partners` },
                { key: 'assigned', label: 'Assigned', count: n('assigned') + n('accepted') },
                { key: 'onsite', label: 'At the customer', count: n('reached') + n('in_progress') },
                { key: 'payment', label: 'Awaiting payment', count: n('pending_payment') },
            ],
            alerts: { overduePartnerJobs: Number(overdue?.n ?? 0), partsAwaitingCustomer: Number(partsWaiting?.n ?? 0) },
            period: {
                completed: Number(done?.n ?? 0), cancelled: Number(cancelled?.n ?? 0),
                cancellationRate: decided ? Math.round(Number(cancelled?.n ?? 0) / decided * 1000) / 10 : 0,
                rating: rating?.n ? Math.round(Number(rating.avg) * 10) / 10 : null, ratings: Number(rating?.n ?? 0),
                newCustomers: Number(newCustomers?.n ?? 0),
            },
            network: {
                customers: Number(customers?.n ?? 0), experts: Number(experts?.n ?? 0), online: Number(online?.n ?? 0),
                partnerTechnicians: Number(partnerTechs?.n ?? 0), partners: Number(partners?.n ?? 0), proPartners: Number(pro?.n ?? 0),
            },
        };
    }

    /** Queues waiting on staff, each with where to act. Only non-zero ones are returned. */
    static async attention() {
        // One broken count must not take the whole dashboard down.
        const c = async (q: Promise<Array<{ n: number }>>) => { try { return Number((await q)[0]?.n ?? 0); } catch (e: any) { logger.warn(`[OVERVIEW] attention count failed: ${e?.message}`); return 0; } };
        const items: Array<{ key: string; label: string; count: number; href: string; tone: 'urgent' | 'normal'; amount?: number }> = [];
        const push = (key: string, label: string, count: number, href: string, tone: 'urgent' | 'normal' = 'normal', amount?: number) => { if (count > 0) items.push({ key, label, count, href, tone, amount }); };

        push('queue', 'Jobs waiting for a UniteFix expert', await c(db.select({ n: count() }).from(serviceRequests).where(and(eq(serviceRequests.status, 'created' as any), eq(serviceRequests.bookingFeeStatus, 'paid'), isNull(serviceRequests.providerId), or(isNull(serviceRequests.dispatchPartnerId), isNotNull(serviceRequests.escalatedAt))))), '/admin/assignments', 'urgent');
        push('tickets', 'Support tickets open', await c(db.select({ n: count() }).from(supportTickets).where(inArray(supportTickets.status, ['open', 'in_progress'] as any))), '/admin/support-tickets', 'urgent');
        push('warranty', 'Warranty claims to decide', await c(db.select({ n: count() }).from(warrantyClaims).where(inArray(warrantyClaims.status, ['open', 'inspecting'] as any))), '/admin/warranty-claims', 'urgent');
        try {
            const { MarketplaceService } = await import('./marketplace.service');
            push('late_store', 'Store orders past the dispatch deadline', (await MarketplaceService.lateOrders()).length, '/admin/marketplace', 'urgent');
        } catch { /* store not set up */ }
        push('b2b', 'Parts orders to dispatch', await c(db.select({ n: count() }).from(b2bOrders).where(inArray(b2bOrders.status, ['paid', 'confirmed', 'packed'] as any))), '/admin/b2b-orders');
        push('withdrawals', 'Expert withdrawals to pay', await c(db.select({ n: count() }).from(withdrawalRequests).where(eq(withdrawalRequests.status, 'pending' as any))), '/admin/withdrawals');
        try {
            const { SettlementService } = await import('./settlement.service');
            const wl = await SettlementService.worklist();
            const due = wl.filter(x => x.payout > 0 && !x.openRun);
            push('settlements', 'Partners due a settlement', due.length, '/admin/partner-settlements', 'normal', r(due.reduce((a, x) => a + x.payout, 0)));
        } catch { /* settlements not set up */ }
        push('applications', 'Partner applications to review', await c(db.select({ n: count() }).from(businessPartners).where(eq(businessPartners.status, 'pending_approval'))), '/admin/business-partners');
        push('verification', 'Experts waiting for document checks', await c(db.select({ n: count() }).from(employees).where(eq(employees.documentVerificationStatus, 'pending' as any))), '/partners');
        push('territories', 'Pincodes partners asked for', await c(db.select({ n: count() }).from(partnerTerritories).where(eq(partnerTerritories.status, 'proposed'))), '/admin/partner-territories');
        push('rates', 'Partner price changes to review', await c(db.select({ n: count() }).from(partnerServiceRates).where(eq(partnerServiceRates.status, 'pending_review'))), '/admin/partner-territories');
        push('listings', 'Store listings to review', await c(db.select({ n: count() }).from(products).where(eq(products.listingStatus, 'pending_review'))), '/admin/marketplace');
        try {
            const { AccountDeletionService } = await import('./account-deletion.service');
            push('deletions', 'Account deletion requests to review', await AccountDeletionService.pendingCount(), '/admin/account-deletions');
        } catch { /* table not created yet */ }
        push('consignment', 'Consignment stock to receive', await c(db.select({ n: count() }).from(consignmentLots).where(eq(consignmentLots.status, 'proposed'))), '/admin/consignment');
        return items;
    }
}
