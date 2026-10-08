/**
 * Celebrations search — find a hall, a photographer or an event planner by
 * place, date and guests.
 *
 * Only live listings (approved by UniteFix) of active partners appear. With a
 * date, each card says whether that partner is free: a hall when any of its
 * spaces big enough for the guests has the asked part of the day free; a
 * photographer when a crew is; planners take any date and confirm it in their
 * quotation. Featured listings come first, then free ones, then by rating or
 * price.
 *
 * Also: the event planners' own listing (readiness, submit), so planners can
 * appear in search the way halls and photographers do.
 */

import { db } from '../db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { partnerListings, businessPartners, venueSpaces, eventPackages, eventGallery, eventThemes, portfolioMedia, portfolioAlbums, serviceablePincodes } from '@shared/schema';
import { HubError } from './partner-hub.service';
import { ListingService, type ListingKind, type Readiness } from './listings.service';
import { VenueService, withDefaults, type VenueProfile } from './venue.service';
import { portfolioDefaults, PortfolioService, type PortfolioProfile } from './portfolio.service';
import { BookingCalendar, isDay, partsOf, istToday, type Slot } from './booking-calendar.service';
import type { EventsProfile } from './events-showcase.service';

export type SearchType = 'halls' | 'photographers' | 'planners';
const KIND: Record<SearchType, ListingKind> = { halls: 'venue', photographers: 'portfolio', planners: 'events' };
const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

export interface SearchInput {
    type: SearchType; city?: string | null; pincode?: string | null; date?: string | null; slot?: Slot | null; guests?: number | null;
    q?: string | null; maxPrice?: number | null; amenities?: string[]; style?: string | null; vegOnly?: boolean; sort?: 'recommended' | 'price' | 'rating';
}

export class CelebrationsSearch {

    /** Places with live listings, for the search box. */
    static async cities() {
        const rows = await db.select({ city: businessPartners.district, kind: partnerListings.kind, n: sql<number>`count(*)::int` })
            .from(partnerListings).innerJoin(businessPartners, eq(businessPartners.id, partnerListings.businessPartnerId))
            .where(and(eq(partnerListings.status, 'live'), eq(businessPartners.status, 'active'))).groupBy(businessPartners.district, partnerListings.kind);
        const m = new Map<string, { city: string; halls: number; photographers: number; planners: number }>();
        for (const r of rows) {
            if (!r.city) continue;
            const x = m.get(r.city) ?? { city: r.city, halls: 0, photographers: 0, planners: 0 };
            if (r.kind === 'venue') x.halls += r.n; else if (r.kind === 'portfolio') x.photographers += r.n; else x.planners += r.n;
            m.set(r.city, x);
        }
        return Array.from(m.values()).sort((a, b) => (b.halls + b.photographers + b.planners) - (a.halls + a.photographers + a.planners));
    }

    static async search(input: SearchInput) {
        const kind = KIND[input.type];
        if (!kind) throw new HubError('Search halls, photographers or planners.', 'BAD_TYPE');
        if (input.date && (!isDay(input.date) || input.date <= istToday())) throw new HubError('Choose a date from tomorrow onwards.', 'BAD_DATE');
        if (input.pincode && !/^\d{6}$/.test(input.pincode)) throw new HubError('A pincode is 6 digits.', 'BAD_PINCODE');
        const rows = await db.select({ bp: businessPartners, featured: partnerListings.featured }).from(partnerListings)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerListings.businessPartnerId))
            .where(and(eq(partnerListings.kind, kind), eq(partnerListings.status, 'live'), eq(businessPartners.status, 'active'))).limit(500);

        // where
        let district: string | null = null;
        if (input.pincode) {
            const [sp] = await db.select({ d: serviceablePincodes.district }).from(serviceablePincodes).where(eq(serviceablePincodes.pincode, input.pincode)).limit(1);
            district = sp?.d ?? null;
        }
        const city = norm(input.city);
        const near = (bp: typeof businessPartners.$inferSelect) => {
            const travel = input.type === 'photographers' ? portfolioDefaults(bp.portfolioProfile as PortfolioProfile).travelAreas.map(norm) : [];
            if (input.pincode) return (bp.coveragePincodes ?? []).includes(input.pincode) || (!!district && norm(bp.district) === norm(district)) || (!!bp.pincode && bp.pincode.slice(0, 3) === input.pincode.slice(0, 3)) || (!!district && travel.includes(norm(district)));
            if (city) return norm(bp.district).includes(city) || city.includes(norm(bp.district) || '\u0000') || travel.some(t => t.includes(city) || city.includes(t));
            return true;
        };
        const q = norm(input.q);
        const list = rows.filter(r => near(r.bp) && (!q || norm(r.bp.displayName).includes(q)));
        const ratings = await ListingService.ratings(list.map(r => r.bp.id));
        const parts = input.slot ? partsOf(input.slot) : null;

        const cards = [];
        for (const { bp, featured } of list) {
            const rating = ratings.get(`${bp.id}:${kind}`) ?? null;
            const base = { code: bp.partnerCode, name: bp.displayName, city: bp.district, featured, rating };
            if (input.type === 'halls') {
                const p = withDefaults(bp.venueProfile as VenueProfile);
                if (input.vegOnly && !p.rules?.vegOnly) continue;
                if (input.amenities?.length && !input.amenities.every(a => p.amenities.includes(a))) continue;
                const spaces = (await VenueService.spaces(bp.id, true)).filter(s => VenueService.offered(s).length);
                const fits = spaces.filter(s => !input.guests || Math.max(s.seated ?? 0, s.floating ?? 0) >= input.guests);
                if (!fits.length) continue;
                const from = Math.min(...fits.map(s => VenueService.fromPrice(s) ?? Infinity));
                if (input.maxPrice && from > input.maxPrice) continue;
                let available: boolean | null = null;
                if (input.date) {
                    available = false;
                    const dt = VenueService.dayType(p, input.date).type;
                    for (const s of fits) {
                        const want = parts ?? (['am', 'pm'] as const);
                        const ok = parts ? (await BookingCalendar.isFree(bp.id, 'space', s.id, [input.date], parts)) && VenueService.rate(s, dt, input.slot!) != null
                            : (await Promise.all(want.map(pt => BookingCalendar.isFree(bp.id, 'space', s.id, [input.date!], [pt])))).some(Boolean);
                        if (ok) { available = true; break; }
                    }
                }
                cards.push({
                    ...base, cover: p.coverPhoto ?? spaces[0]?.photos?.[0] ?? null, tagline: p.tagline ?? null, from: Number.isFinite(from) ? from : null, available,
                    capacity: Math.max(...spaces.map(s => Math.max(s.seated ?? 0, s.floating ?? 0))), spaces: spaces.length,
                    highlights: [p.amenities.includes('Air conditioning') ? 'AC' : null, p.rooms ? `${p.rooms} rooms` : null, p.rules?.vegOnly ? 'Veg only' : null, p.parking ? `Parking ${p.parking}` : null].filter(Boolean),
                    url: `/halls/${bp.partnerCode}`,
                });
            } else if (input.type === 'photographers') {
                const p = portfolioDefaults(bp.portfolioProfile as PortfolioProfile);
                if (input.style && !p.styles.map(norm).includes(norm(input.style))) continue;
                const { packages } = await PortfolioService.packages(bp.id);
                if (!packages.length) continue;
                const from = Math.min(...packages.map(k => k.price));
                if (input.maxPrice && from > input.maxPrice) continue;
                let available: boolean | null = null;
                if (input.date) available = !!(await PortfolioService.freeCrew(bp.id, [input.date], parts ?? ['am', 'pm'], p.crews));
                const shots = await db.select({ url: portfolioMedia.url }).from(portfolioMedia).innerJoin(portfolioAlbums, eq(portfolioAlbums.id, portfolioMedia.albumId))
                    .where(and(eq(portfolioMedia.businessPartnerId, bp.id), eq(portfolioMedia.kind, 'photo'), eq(portfolioAlbums.isPublished, true))).orderBy(sql`${portfolioMedia.featured} desc`, asc(portfolioMedia.sortOrder)).limit(4);
                cards.push({
                    ...base, cover: p.coverPhoto ?? shots[0]?.url ?? null, shots: shots.map(s => s.url).slice(0, 3), tagline: p.tagline ?? null, from, available,
                    highlights: p.styles.slice(0, 3), since: p.since ?? null, url: `/photographers/${bp.partnerCode}`,
                });
            } else {
                const p = (bp.eventsProfile as EventsProfile) ?? {};
                const pk = await db.select({ price: eventPackages.pricePaise, category: eventPackages.category }).from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bp.id), eq(eventPackages.isActive, true), eq(eventPackages.showOnPage, true)));
                const [th] = await db.select({ n: sql<number>`count(*)::int`, min: sql<number>`min(${eventThemes.pricePaise})::int` }).from(eventThemes).where(and(eq(eventThemes.businessPartnerId, bp.id), eq(eventThemes.isActive, true)));
                const prices = [...pk.map(x => x.price), ...(th?.n ? [th.min] : [])].filter(x => x > 0);
                const from = prices.length ? Math.min(...prices) / 100 : null;
                if (input.maxPrice && from != null && from > input.maxPrice) continue;
                const [g] = await db.select({ url: eventGallery.url }).from(eventGallery).where(and(eq(eventGallery.businessPartnerId, bp.id), eq(eventGallery.kind, 'photo'))).orderBy(asc(eventGallery.sortOrder)).limit(1);
                cards.push({
                    ...base, cover: p.coverPhoto ?? g?.url ?? null, tagline: p.tagline ?? null, from, available: null,
                    highlights: Array.from(new Set(pk.map(x => x.category))).filter(c => c !== 'venue').slice(0, 4).map(c => ({ decor: 'Décor', catering: 'Catering', cake: 'Cakes', av: 'Sound & light', photography: 'Photography', staff: 'Staff', other: 'More' } as Record<string, string>)[c] ?? c),
                    themes: th?.n ?? 0, url: `/events/${bp.partnerCode}`,
                });
            }
        }
        const sort = input.sort ?? 'recommended';
        cards.sort((a: any, b: any) => {
            if (sort === 'price') return (a.from ?? Infinity) - (b.from ?? Infinity);
            if (sort === 'rating') return (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0);
            return Number(b.featured) - Number(a.featured) || Number(b.available !== false) - Number(a.available !== false) || (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0) || (a.from ?? Infinity) - (b.from ?? Infinity);
        });
        return { type: input.type, count: cards.length, results: cards.slice(0, 60) };
    }

    // ── planners' listing ──────────────────────────────────────────────────

    static async eventsReadiness(bpId: number): Promise<Readiness> {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        const p = (bp?.eventsProfile as EventsProfile) ?? {};
        const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(eventGallery).where(eq(eventGallery.businessPartnerId, bpId));
        const [k] = await db.select({ n: sql<number>`count(*)::int` }).from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), eq(eventPackages.isActive, true), eq(eventPackages.showOnPage, true)));
        const checks = [
            { label: 'Your business is approved by UniteFix', done: bp?.status === 'active' },
            { label: 'A cover photo', done: !!p.coverPhoto },
            { label: 'A few lines about you', done: (p.about ?? '').length >= 40 },
            { label: 'At least 4 photos or Instagram posts of your work', done: (g?.n ?? 0) >= 4 },
            { label: 'Something clients can choose — a venue, theme or add-on', done: (k?.n ?? 0) > 0 },
        ];
        return { ready: checks.every(c => c.done), checks };
    }

    /** Counts per listing kind for the staff dashboard. */
    static async counts() {
        const rows = await db.select({ kind: partnerListings.kind, status: partnerListings.status, n: sql<number>`count(*)::int` }).from(partnerListings).groupBy(partnerListings.kind, partnerListings.status);
        return rows;
    }

    static async liveIds(kind: ListingKind, ids: number[]) {
        if (!ids.length) return new Set<number>();
        const rows = await db.select({ id: partnerListings.businessPartnerId }).from(partnerListings).where(and(eq(partnerListings.kind, kind), eq(partnerListings.status, 'live'), inArray(partnerListings.businessPartnerId, ids)));
        return new Set(rows.map(r => r.id));
    }
}
