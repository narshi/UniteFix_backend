/**
 * A Celebrations plan — one client asking a hall, a photographer and an event
 * planner for the same day at once.
 *
 * The client builds the plan in their browser (or the app), then sends it
 * with their details once. Every item is checked first (live listing, the
 * date free, the price), so a plan with a taken date is caught before
 * anything is held; then each partner gets its own request, exactly as if it
 * came from their page, tied together by the plan. One page shows the client
 * where each stands.
 */

import crypto from 'crypto';
import { db } from '../db';
import { asc, eq } from 'drizzle-orm';
import { celebrationBaskets, eventEnquiries, eventBookings, businessPartners } from '@shared/schema';
import { HubError } from './partner-hub.service';
import { ListingService } from './listings.service';
import { VenueService } from './venue.service';
import { PortfolioService } from './portfolio.service';
import { BookingCalendar, isDay, istToday, partsOf, addDays, type Slot } from './booking-calendar.service';
import { CelebrationBookings } from './celebration-bookings.service';

export type PlanItemInput =
    | { type: 'hall'; code: string; spaceId: number; slot: Slot; addons?: Array<{ packageId: number; quantity?: number }> }
    | { type: 'photographer'; code: string; packageId: number; days?: number; hours?: number; slot: Slot; addons?: Array<{ packageId: number; quantity?: number }>; location?: string | null }
    | { type: 'planner'; code: string; venueId?: number | null; themeId?: number | null; ownVenue?: string | null; customization?: string | null; addons?: Array<{ packageId: number; quantity?: number }> };

export class CelebrationPlan {

    static async send(input: {
        date: string; guests?: number | null; occasion: string; name: string; phone: string; email?: string | null; notes?: string | null; location?: string | null; items: PlanItemInput[];
    }, channel: { source: 'public' | 'app'; userId?: number | null } = { source: 'public' }) {
        if (!isDay(input.date) || input.date <= istToday()) throw new HubError('Choose a date from tomorrow onwards.', 'BAD_DATE');
        if (!input.items.length || input.items.length > 6) throw new HubError('A plan has 1 to 6 partners.', 'BAD_PLAN');
        if (new Set(input.items.map(i => `${i.type}:${i.code}`)).size !== input.items.length) throw new HubError('Each partner once per plan.', 'DUPLICATE');
        const phone = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) throw new HubError('A 10-digit mobile number, please.', 'BAD_PHONE');

        // 1. Check everything before holding anything.
        const checked: Array<{ item: PlanItemInput; bp: typeof businessPartners.$inferSelect }> = [];
        const problems: Array<{ code: string; type: string; message: string }> = [];
        const hallVenue = input.items.find(i => i.type === 'hall');
        for (const item of input.items) {
            try {
                if (item.type === 'hall') {
                    const bp = await VenueService.publicPartner(item.code);
                    if (!bp || !(await ListingService.isLive(bp.id, 'venue'))) throw new HubError('This hall is not taking bookings.', 'NOT_FOUND', 404);
                    await VenueService.price(bp.id, { spaceId: item.spaceId, date: input.date, slot: item.slot, guests: input.guests ?? null, addons: item.addons });
                    if (!(await BookingCalendar.isFree(bp.id, 'space', item.spaceId, [input.date], partsOf(item.slot)))) throw new HubError('This hall is already booked for that time.', 'TAKEN', 409);
                    checked.push({ item, bp });
                } else if (item.type === 'photographer') {
                    const bp = await PortfolioService.publicPartner(item.code);
                    if (!bp || !(await ListingService.isLive(bp.id, 'portfolio'))) throw new HubError('This photographer is not taking bookings.', 'NOT_FOUND', 404);
                    await PortfolioService.price(bp.id, item);
                    const p = await PortfolioService.profile(bp.id);
                    const days = Array.from({ length: Math.floor(Number(item.days ?? 1)) }, (_, k) => addDays(input.date, k));
                    if (!(await PortfolioService.freeCrew(bp.id, days, partsOf(item.slot), p.crews))) throw new HubError('This photographer is already booked that day.', 'TAKEN', 409);
                    checked.push({ item, bp });
                } else {
                    const { PartnerEventsService } = await import('./partner-events.service');
                    const { EventsShowcaseService } = await import('./events-showcase.service');
                    const bp = await PartnerEventsService.publicPartner(item.code);
                    if (!bp || !(await ListingService.isLive(bp.id, 'events'))) throw new HubError('This planner is not taking requests here.', 'NOT_FOUND', 404);
                    await EventsShowcaseService.price(bp.id, { guests: input.guests ?? null, venueId: item.venueId ?? null, themeId: item.themeId ?? null, addons: item.addons });
                    checked.push({ item, bp });
                }
            } catch (e: any) {
                problems.push({ code: item.code, type: item.type, message: e?.message ?? 'Not available' });
            }
        }
        if (problems.length) throw Object.assign(new HubError(`${problems.length === 1 ? 'One partner' : `${problems.length} partners`} in your plan cannot take this date: ${problems.map(p => p.message).join(' ')}`, 'PLAN_PROBLEMS', 409), { problems });

        // 2. The plan, then each request.
        const [basket] = await db.insert(celebrationBaskets).values({
            token: crypto.randomBytes(18).toString('base64url'), name: input.name.trim().slice(0, 120), phone, email: input.email?.trim() || null, userId: channel.userId ?? null,
            occasion: input.occasion.trim().slice(0, 80), eventDate: input.date, guests: input.guests ?? null,
        }).returning();
        const ch = { ...channel, basketId: basket.id };
        const results: Array<{ type: string; code: string; partner: string; ok: boolean; link?: string; payUrl?: string | null; message?: string }> = [];
        const hallName = hallVenue ? checked.find(c => c.item === hallVenue)?.bp.displayName ?? null : null;
        for (const { item, bp } of checked) {
            try {
                const who = { name: input.name, phone, email: input.email ?? null, notes: input.notes ?? null };
                if (item.type === 'hall') {
                    const r = await VenueService.request(bp, { ...who, spaceId: item.spaceId, date: input.date, slot: item.slot, guests: input.guests ?? null, occasion: input.occasion, addons: item.addons }, ch);
                    results.push({ type: item.type, code: item.code, partner: bp.displayName, ok: true, link: CelebrationBookings.customerLink(r.enquiry.publicToken), payUrl: r.payUrl });
                } else if (item.type === 'photographer') {
                    const r = await PortfolioService.request(bp, { ...who, packageId: item.packageId, days: item.days, hours: item.hours, slot: item.slot, addons: item.addons, date: input.date, occasion: input.occasion, location: item.location || hallName || input.location || 'To be confirmed', guests: input.guests ?? null }, ch);
                    results.push({ type: item.type, code: item.code, partner: bp.displayName, ok: true, link: CelebrationBookings.customerLink(r.enquiry.publicToken) });
                } else {
                    const { EventsShowcaseService } = await import('./events-showcase.service');
                    const r = await EventsShowcaseService.request(bp, { ...who, eventType: input.occasion, eventDate: input.date, guests: input.guests ?? null, venueId: item.venueId ?? null, ownVenue: item.ownVenue ?? hallName ?? input.location ?? null, themeId: item.themeId ?? null, customization: item.customization ?? input.notes ?? null, addons: item.addons }, ch);
                    results.push({ type: item.type, code: item.code, partner: bp.displayName, ok: true, link: CelebrationBookings.customerLink(r.enquiry.publicToken) });
                }
            } catch (e: any) {
                // Taken in the seconds between the check and the hold — the rest still go.
                results.push({ type: item.type, code: item.code, partner: bp.displayName, ok: false, message: e?.message ?? 'Not sent' });
            }
        }
        return { token: basket.token, link: `/celebrations/plan/${basket.token}`, results };
    }

    /** The plan's page: every partner asked, where each request stands, and what to pay. */
    static async view(token: string) {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
        const [b] = await db.select().from(celebrationBaskets).where(eq(celebrationBaskets.token, token)).limit(1);
        if (!b) return null;
        const enq = await db.select({ e: eventEnquiries, partner: businessPartners.displayName, code: businessPartners.partnerCode }).from(eventEnquiries)
            .innerJoin(businessPartners, eq(businessPartners.id, eventEnquiries.businessPartnerId)).where(eq(eventEnquiries.basketId, b.id)).orderBy(asc(eventEnquiries.id));
        const items = [];
        for (const r of enq) {
            const v = await CelebrationBookings.publicView(r.e.publicToken);
            const [bk] = await db.select({ id: eventBookings.id }).from(eventBookings).where(eq(eventBookings.enquiryId, r.e.id)).limit(1);
            const due = v?.booking?.milestones.find(m => m.payUrl) ?? null;
            items.push({
                kind: r.e.kind, partner: r.partner, code: r.code, link: CelebrationBookings.customerLink(r.e.publicToken),
                stage: v?.booking ? v.booking.status : r.e.status === 'lost' ? 'closed' : v?.quotation ? 'quoted' : 'requested',
                total: v?.booking?.total ?? (r.e.selection as any)?.estimate?.total ?? null, paid: v?.booking?.paid ?? 0, payUrl: due?.payUrl ?? null, payAmount: due?.amount ?? null,
                quotation: v?.quotation ?? null, heldUntil: v?.booking?.holdExpiresAt ?? v?.heldUntil ?? null, booked: !!bk, note: r.e.status === 'lost' ? r.e.lostReason : null,
            });
        }
        return { name: b.name.split(/\s+/)[0], occasion: b.occasion, eventDate: b.eventDate, guests: b.guests, items, estimate: items.reduce((a, i) => a + (i.stage === 'closed' || i.stage === 'cancelled' ? 0 : Number(i.total ?? 0)), 0) };
    }
}
