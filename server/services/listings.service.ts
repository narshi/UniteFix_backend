/**
 * Celebrations listings — a hall's, a photographer's or an event planner's
 * public page, as UniteFix sees it.
 *
 *   draft → submitted → live            UniteFix approves the page
 *                    → changes_requested  with a note; the partner fixes and resubmits
 *   live → paused (by UniteFix) → live
 *
 * Only a live listing is public and appears in Celebrations search. The
 * partner can keep editing a live page; staff can pause it if it goes wrong.
 *
 * Commission: a percentage of a booking made through UniteFix, by kind
 * (config), or a per-listing rate staff set. Reviews: one per booking, by
 * the client, after the event.
 */

import { db } from '../db';
import { and, avg, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { partnerListings, partnerReviews, businessPartners, type PartnerListing } from '@shared/schema';
import { HubError } from './partner-hub.service';
import { configService } from './config.service';

export type ListingKind = 'venue' | 'portfolio' | 'events';
export const LISTING_KINDS: ListingKind[] = ['venue', 'portfolio', 'events'];
export const LISTING_LABEL: Record<ListingKind, string> = { venue: 'Hall', portfolio: 'Photographer', events: 'Event planner' };
/** The booking kind each listing takes. */
export const BOOKING_KIND: Record<ListingKind, 'hall' | 'shoot' | 'event'> = { venue: 'hall', portfolio: 'shoot', events: 'event' };
export const listingKindOf = (bookingKind: string): ListingKind => (bookingKind === 'hall' ? 'venue' : bookingKind === 'shoot' ? 'portfolio' : 'events');
const COMMISSION_KEY: Record<ListingKind, [string, number]> = {
    venue: ['VENUE_COMMISSION_PERCENT', 5],
    portfolio: ['PORTFOLIO_COMMISSION_PERCENT', 8],
    events: ['EVENTS_COMMISSION_PERCENT', 0],
};

export interface Readiness { ready: boolean; checks: Array<{ label: string; done: boolean }> }

export class ListingService {

    static async get(bpId: number, kind: ListingKind): Promise<PartnerListing | null> {
        const [l] = await db.select().from(partnerListings).where(and(eq(partnerListings.businessPartnerId, bpId), eq(partnerListings.kind, kind))).limit(1);
        return l ?? null;
    }

    static async isLive(bpId: number, kind: ListingKind) {
        return (await this.get(bpId, kind))?.status === 'live';
    }

    static view(l: PartnerListing | null, kind: ListingKind) {
        return {
            kind, status: l?.status ?? 'draft', reviewNote: l?.reviewNote ?? null, submittedAt: l?.submittedAt ?? null, reviewedAt: l?.reviewedAt ?? null,
            featured: l?.featured ?? false, commissionPercent: l?.commissionPercent != null ? Number(l.commissionPercent) : null,
        };
    }

    /** The partner asks UniteFix to put the page live. */
    static async submit(bpId: number, kind: ListingKind, readiness: Readiness) {
        if (!readiness.ready) throw new HubError(`Finish your page first: ${readiness.checks.filter(c => !c.done).map(c => c.label.toLowerCase()).join('; ')}.`, 'NOT_READY', 409);
        const cur = await this.get(bpId, kind);
        if (cur?.status === 'live') throw new HubError('Your page is already live.', 'LIVE', 409);
        if (cur?.status === 'paused') throw new HubError('UniteFix paused your page — reply to their note and they will turn it back on.', 'PAUSED', 409);
        const [row] = await db.insert(partnerListings).values({ businessPartnerId: bpId, kind, status: 'submitted', submittedAt: new Date() })
            .onConflictDoUpdate({ target: [partnerListings.businessPartnerId, partnerListings.kind], set: { status: 'submitted', submittedAt: new Date(), updatedAt: new Date() } }).returning();
        try {
            const [bp] = await db.select({ name: businessPartners.displayName }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToAdmins(`${LISTING_LABEL[kind]} page to review`, `${bp?.name ?? 'A partner'} submitted their ${LISTING_LABEL[kind].toLowerCase()} page for Celebrations.`, { type: 'listing_review', businessPartnerId: bpId, kind });
        } catch { /* a missed staff ping must not fail the submission */ }
        return row;
    }

    // ── staff ──────────────────────────────────────────────────────────────

    static async all(filter: { status?: string; kind?: string } = {}) {
        const conds: any[] = [];
        if (filter.status) conds.push(eq(partnerListings.status, filter.status));
        if (filter.kind) conds.push(eq(partnerListings.kind, filter.kind));
        const rows = await db.select({ l: partnerListings, name: businessPartners.displayName, code: businessPartners.partnerCode, city: businessPartners.district, bpStatus: businessPartners.status })
            .from(partnerListings).innerJoin(businessPartners, eq(businessPartners.id, partnerListings.businessPartnerId))
            .where(conds.length ? and(...conds) : undefined).orderBy(desc(partnerListings.submittedAt)).limit(500);
        const ratings = await this.ratings(rows.map(r => r.l.businessPartnerId));
        const defaults = await this.defaultCommissions();
        return rows.map(r => ({
            ...this.view(r.l, r.l.kind as ListingKind), businessPartnerId: r.l.businessPartnerId, name: r.name, code: r.code, city: r.city, partnerStatus: r.bpStatus,
            defaultCommission: defaults[r.l.kind as ListingKind], rating: ratings.get(`${r.l.businessPartnerId}:${r.l.kind}`) ?? null,
        }));
    }

    static async review(adminId: number, bpId: number, kind: ListingKind, input: { decision: 'approve' | 'changes' | 'pause' | 'resume'; note?: string | null }) {
        const cur = await this.get(bpId, kind);
        if (!cur) throw new HubError('This partner has not submitted that page.', 'NOT_FOUND', 404);
        const note = input.note?.trim().slice(0, 1000) || null;
        const next = ({ approve: 'live', changes: 'changes_requested', pause: 'paused', resume: 'live' } as const)[input.decision];
        if (input.decision === 'approve' && !['submitted', 'changes_requested'].includes(cur.status)) throw new HubError(`It is ${cur.status.replace('_', ' ')}, not waiting for review.`, 'BAD_STATE', 409);
        if (input.decision === 'changes' && !['submitted', 'live'].includes(cur.status)) throw new HubError('Only a submitted or live page can be sent back.', 'BAD_STATE', 409);
        if (input.decision === 'pause' && cur.status !== 'live') throw new HubError('Only a live page can be paused.', 'BAD_STATE', 409);
        if (input.decision === 'resume' && cur.status !== 'paused') throw new HubError('Only a paused page can be resumed.', 'BAD_STATE', 409);
        if ((input.decision === 'changes' || input.decision === 'pause') && !note) throw new HubError('Tell the partner what to change.', 'NO_NOTE');
        const [u] = await db.update(partnerListings).set({ status: next, reviewNote: note, reviewedAt: new Date(), reviewedByAdminId: adminId, updatedAt: new Date() })
            .where(and(eq(partnerListings.businessPartnerId, bpId), eq(partnerListings.kind, kind))).returning();
        const { HubAlerts } = await import('./hub-alerts.service');
        const link = kind === 'venue' ? '/partner/venue/page' : kind === 'portfolio' ? '/partner/portfolio' : '/partner/events/showcase';
        await HubAlerts.send(bpId, 'listing_reviewed', {
            title: next === 'live' ? `Your ${LISTING_LABEL[kind].toLowerCase()} page is live` : next === 'paused' ? 'Your page is paused' : 'Changes needed on your page',
            body: next === 'live' ? 'Clients can now find and book you in UniteFix Celebrations.' : note ?? '', link, refType: 'listing', refId: bpId,
        });
        return u;
    }

    static async setFeatured(bpId: number, kind: ListingKind, featured: boolean) {
        const [u] = await db.update(partnerListings).set({ featured, updatedAt: new Date() }).where(and(eq(partnerListings.businessPartnerId, bpId), eq(partnerListings.kind, kind))).returning();
        if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
        return u;
    }

    static async setCommission(bpId: number, kind: ListingKind, percent: number | null) {
        if (percent != null && !(percent >= 0 && percent <= 30)) throw new HubError('Commission is 0–30%.', 'BAD_PERCENT');
        const [u] = await db.update(partnerListings).set({ commissionPercent: percent == null ? null : String(percent), updatedAt: new Date() })
            .where(and(eq(partnerListings.businessPartnerId, bpId), eq(partnerListings.kind, kind))).returning();
        if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
        return u;
    }

    // ── commission ─────────────────────────────────────────────────────────

    static async defaultCommissions(): Promise<Record<ListingKind, number>> {
        const out = {} as Record<ListingKind, number>;
        for (const k of LISTING_KINDS) {
            const [key, d] = COMMISSION_KEY[k];
            const v = Number(await configService.get<number>(`BUSINESS_CONFIG.${key}`, d));
            out[k] = Number.isFinite(v) && v >= 0 ? v : d;
        }
        return out;
    }

    /** The rate for a new booking: the listing's own, else the default for its kind. */
    static async commissionPercent(bpId: number, kind: ListingKind) {
        const l = await this.get(bpId, kind);
        if (l?.commissionPercent != null) return Number(l.commissionPercent);
        return (await this.defaultCommissions())[kind];
    }

    // ── reviews ────────────────────────────────────────────────────────────

    /** "bpId:kind" → { avg, count } over published reviews. */
    static async ratings(bpIds: number[]) {
        const m = new Map<string, { avg: number; count: number }>();
        if (!bpIds.length) return m;
        const rows = await db.select({ bp: partnerReviews.businessPartnerId, kind: partnerReviews.kind, a: avg(partnerReviews.rating), n: count() })
            .from(partnerReviews).where(and(inArray(partnerReviews.businessPartnerId, Array.from(new Set(bpIds))), eq(partnerReviews.status, 'published')))
            .groupBy(partnerReviews.businessPartnerId, partnerReviews.kind);
        for (const r of rows) m.set(`${r.bp}:${r.kind}`, { avg: Math.round(Number(r.a) * 10) / 10, count: Number(r.n) });
        return m;
    }

    static async publicReviews(bpId: number, kind: ListingKind, limit = 12) {
        const rows = await db.select().from(partnerReviews).where(and(eq(partnerReviews.businessPartnerId, bpId), eq(partnerReviews.kind, kind), eq(partnerReviews.status, 'published')))
            .orderBy(desc(partnerReviews.createdAt)).limit(limit);
        const r = (await this.ratings([bpId])).get(`${bpId}:${kind}`) ?? { avg: 0, count: 0 };
        const [dist] = await db.select({
            s5: sql<number>`count(*) filter (where ${partnerReviews.rating} = 5)::int`, s4: sql<number>`count(*) filter (where ${partnerReviews.rating} = 4)::int`,
            s3: sql<number>`count(*) filter (where ${partnerReviews.rating} = 3)::int`, s2: sql<number>`count(*) filter (where ${partnerReviews.rating} = 2)::int`,
            s1: sql<number>`count(*) filter (where ${partnerReviews.rating} = 1)::int`,
        }).from(partnerReviews).where(and(eq(partnerReviews.businessPartnerId, bpId), eq(partnerReviews.kind, kind), eq(partnerReviews.status, 'published')));
        return {
            average: r.avg, count: r.count, stars: [dist?.s5 ?? 0, dist?.s4 ?? 0, dist?.s3 ?? 0, dist?.s2 ?? 0, dist?.s1 ?? 0],
            items: rows.map(x => ({ id: x.id, name: x.reviewerName, occasion: x.occasion, eventDate: x.eventDate, rating: x.rating, body: x.body, reply: x.reply, createdAt: x.createdAt })),
        };
    }

    static async partnerReviews(bpId: number) {
        return db.select().from(partnerReviews).where(eq(partnerReviews.businessPartnerId, bpId)).orderBy(desc(partnerReviews.createdAt)).limit(300);
    }

    static async reply(bpId: number, id: number, reply: string) {
        const text = reply.trim().slice(0, 1000);
        if (text.length < 2) throw new HubError('Write a reply.', 'NO_REPLY');
        const [u] = await db.update(partnerReviews).set({ reply: text, repliedAt: new Date() }).where(and(eq(partnerReviews.id, id), eq(partnerReviews.businessPartnerId, bpId))).returning();
        if (!u) throw new HubError('Review not found', 'NOT_FOUND', 404);
        return u;
    }

    static async allReviews(filter: { status?: string } = {}) {
        return db.select({ r: partnerReviews, partner: businessPartners.displayName }).from(partnerReviews)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerReviews.businessPartnerId))
            .where(filter.status ? eq(partnerReviews.status, filter.status) : undefined).orderBy(desc(partnerReviews.createdAt)).limit(500);
    }

    static async moderate(id: number, input: { status: 'published' | 'hidden'; reason?: string | null }) {
        if (input.status === 'hidden' && !input.reason?.trim()) throw new HubError('Say why it is hidden.', 'NO_REASON');
        const [u] = await db.update(partnerReviews).set({ status: input.status, hiddenReason: input.status === 'hidden' ? input.reason!.trim().slice(0, 300) : null }).where(eq(partnerReviews.id, id)).returning();
        if (!u) throw new HubError('Review not found', 'NOT_FOUND', 404);
        return u;
    }
}
