/**
 * Photographers — a portfolio a photographer builds in the Hub, shown
 * beautifully to clients, and booking a shoot from it.
 *
 *   Profile    cover photo or reel, bio, styles, where they travel, languages,
 *              since when; how many crews (a studio with associates can shoot
 *              more than one event a day); booking terms
 *   Albums     one story per event: title, story, place, date — photos, short
 *              uploaded clips (≤ 60 s, transcoded by Cloudinary) and linked
 *              films (YouTube / Vimeo / Instagram). Any item can be featured
 *              on the front of the portfolio.
 *   Packages   event packages (Events → Packages); "add-on" ones are extras
 *              to a package (drone, extra album, same-day edit)
 *   Dates      BookingCalendar rows per crew. A request holds the first free
 *              crew for the date while the photographer quotes; confirming
 *              the booking books it (CelebrationBookings.afterConfirm).
 *
 * A request becomes an enquiry with a quotation drafted from exactly what the
 * client chose; the photographer checks it and sends it, and the usual
 * accept → booking → advance follows.
 */

import { db } from '../db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { portfolioAlbums, portfolioMedia, eventPackages, eventEnquiries, businessPartners, type PortfolioMedia, type PortfolioAlbum } from '@shared/schema';
import { DEFAULT_CANCELLATION, PHOTO_STYLES, ALBUM_CATEGORIES } from '@shared/celebrations';
import { HubError, type HubContext } from './partner-hub.service';
import { BookingCalendar, istToday, addDays, isDay, partsOf, type Slot } from './booking-calendar.service';
import { ListingService, type Readiness } from './listings.service';
import { videoLink, isImageUrl } from '../lib/media-embed';
import type { SaleLineInput } from './partner-sales.service';

type Ctx = Pick<HubContext, 'businessPartnerId' | 'adminUserId'>;
type BP = typeof businessPartners.$inferSelect;

export interface PortfolioProfile {
    tagline?: string | null; about?: string | null; coverPhoto?: string | null; coverVideoId?: number | null;
    styles?: string[]; travelAreas?: string[]; languages?: string[]; since?: number | null; instagram?: string | null; youtube?: string | null;
    crews?: number; deliveryDays?: number | null; holdHours?: number; advancePercent?: number; balanceDueDays?: number;
    cancellation?: Array<{ daysBefore: number; refundPercent: number }>;
}
export const portfolioDefaults = (p: PortfolioProfile | null | undefined) => {
    const x = p ?? {};
    return { ...x, styles: x.styles ?? [], travelAreas: x.travelAreas ?? [], languages: x.languages ?? [], crews: x.crews ?? 1, holdHours: x.holdHours ?? 72, advancePercent: x.advancePercent ?? 30, balanceDueDays: x.balanceDueDays ?? 3, cancellation: x.cancellation?.length ? x.cancellation : DEFAULT_CANCELLATION };
};
const strList = (v: unknown, max: number, len = 40) => Array.from(new Set((Array.isArray(v) ? v : []).map(s => String(s).trim().slice(0, len)).filter(Boolean))).slice(0, max);

export class PortfolioService {

    // ══════════════════════════════════════════════════════════════════════
    // Profile
    // ══════════════════════════════════════════════════════════════════════

    static async profile(bpId: number) {
        const [bp] = await db.select({ p: businessPartners.portfolioProfile }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        return portfolioDefaults(bp?.p as PortfolioProfile);
    }

    static async saveProfile(ctx: Ctx, input: PortfolioProfile) {
        const [row] = await db.select({ p: businessPartners.portfolioProfile }).from(businessPartners).where(eq(businessPartners.id, ctx.businessPartnerId)).limit(1);
        const n: PortfolioProfile = { ...((row?.p as PortfolioProfile) ?? {}) };
        const txt = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;
        if (input.tagline !== undefined) n.tagline = txt(input.tagline, 120);
        if (input.about !== undefined) n.about = txt(input.about, 2000);
        if (input.coverPhoto !== undefined) { if (input.coverPhoto && !isImageUrl(input.coverPhoto)) throw new HubError('The cover must be an uploaded photo.', 'BAD_PHOTO'); n.coverPhoto = input.coverPhoto || null; }
        if (input.coverVideoId !== undefined) {
            if (input.coverVideoId) {
                const [m] = await db.select().from(portfolioMedia).where(and(eq(portfolioMedia.id, input.coverVideoId), eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId))).limit(1);
                if (!m || m.kind !== 'video') throw new HubError('Choose one of your uploaded clips for the cover.', 'BAD_VIDEO');
            }
            n.coverVideoId = input.coverVideoId || null;
        }
        if (input.styles !== undefined) n.styles = strList(input.styles, 12);
        if (input.travelAreas !== undefined) n.travelAreas = strList(input.travelAreas, 20, 60);
        if (input.languages !== undefined) n.languages = strList(input.languages, 8, 30);
        if (input.since !== undefined) {
            const y = new Date().getFullYear();
            if (input.since != null && !(Number.isInteger(input.since) && input.since >= 1960 && input.since <= y)) throw new HubError(`Shooting since a year from 1960 to ${y}.`, 'BAD_YEAR');
            n.since = input.since ?? null;
        }
        if (input.instagram !== undefined) {
            const h = String(input.instagram ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
            if (h && !/^[A-Za-z0-9._]{1,30}$/.test(h)) throw new HubError('That is not an Instagram handle.', 'BAD_HANDLE');
            n.instagram = h || null;
        }
        if (input.youtube !== undefined) {
            const u = txt(input.youtube, 300);
            if (u && !/^https:\/\/(www\.)?youtube\.com\/(@|channel\/|c\/)[\w.-]+\/?$/i.test(u)) throw new HubError('Paste your YouTube channel link, like https://www.youtube.com/@yourstudio.', 'BAD_YOUTUBE');
            n.youtube = u;
        }
        if (input.crews !== undefined) { if (!(Number.isInteger(input.crews) && input.crews >= 1 && input.crews <= 10)) throw new HubError('Teams that can shoot at once: 1 to 10.', 'BAD_CREWS'); n.crews = input.crews; }
        if (input.deliveryDays !== undefined) { if (input.deliveryDays != null && !(input.deliveryDays >= 1 && input.deliveryDays <= 365)) throw new HubError('Delivery is 1 to 365 days.', 'BAD_DAYS'); n.deliveryDays = input.deliveryDays ?? null; }
        if (input.holdHours !== undefined) { if (!(input.holdHours >= 12 && input.holdHours <= 168)) throw new HubError('Hold a date for 12 to 168 hours while you quote.', 'BAD_HOLD'); n.holdHours = Math.floor(input.holdHours); }
        if (input.advancePercent !== undefined) { if (!(input.advancePercent >= 10 && input.advancePercent <= 100)) throw new HubError('The advance is 10% to 100%.', 'BAD_ADVANCE'); n.advancePercent = Math.round(input.advancePercent); }
        if (input.balanceDueDays !== undefined) { if (!(input.balanceDueDays >= 0 && input.balanceDueDays <= 60)) throw new HubError('The balance is due 0 to 60 days before.', 'BAD_DAYS'); n.balanceDueDays = Math.floor(input.balanceDueDays); }
        if (input.cancellation !== undefined) {
            const t = (input.cancellation ?? []).map(x => ({ daysBefore: Math.floor(Number(x.daysBefore)), refundPercent: Math.round(Number(x.refundPercent)) }));
            if (!t.length || t.length > 6 || t.some(x => !(x.daysBefore >= 0 && x.daysBefore <= 365 && x.refundPercent >= 0 && x.refundPercent <= 100))) throw new HubError('Up to 6 cancellation rules: days before and refund %.', 'BAD_POLICY');
            const sorted = t.sort((a, b) => b.daysBefore - a.daysBefore);
            if (sorted.some((x, i) => i > 0 && x.refundPercent > sorted[i - 1].refundPercent)) throw new HubError('Refunds cannot grow as the date gets closer.', 'BAD_POLICY');
            if (!sorted.some(x => x.daysBefore === 0)) sorted.push({ daysBefore: 0, refundPercent: 0 });
            n.cancellation = sorted;
        }
        await db.update(businessPartners).set({ portfolioProfile: n as any, updatedAt: new Date() }).where(eq(businessPartners.id, ctx.businessPartnerId));
        return portfolioDefaults(n);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Albums and media
    // ══════════════════════════════════════════════════════════════════════

    static async albums(bpId: number, publishedOnly = false) {
        const rows = await db.select().from(portfolioAlbums).where(and(eq(portfolioAlbums.businessPartnerId, bpId), ...(publishedOnly ? [eq(portfolioAlbums.isPublished, true)] : [])))
            .orderBy(asc(portfolioAlbums.sortOrder), desc(portfolioAlbums.id));
        const counts = rows.length ? await db.select({ id: portfolioMedia.albumId, kind: portfolioMedia.kind, n: sql<number>`count(*)::int` }).from(portfolioMedia)
            .where(inArray(portfolioMedia.albumId, rows.map(r => r.id))).groupBy(portfolioMedia.albumId, portfolioMedia.kind) : [];
        const firstPhoto = rows.length ? await db.selectDistinctOn([portfolioMedia.albumId], { id: portfolioMedia.albumId, url: portfolioMedia.url }).from(portfolioMedia)
            .where(and(inArray(portfolioMedia.albumId, rows.map(r => r.id)), eq(portfolioMedia.kind, 'photo'))).orderBy(portfolioMedia.albumId, asc(portfolioMedia.sortOrder), asc(portfolioMedia.id)) : [];
        const fp = new Map(firstPhoto.map(f => [f.id, f.url]));
        return rows.map(a => ({
            ...a, cover: a.coverUrl ?? fp.get(a.id) ?? null,
            photos: counts.filter(c => c.id === a.id && c.kind === 'photo').reduce((s, c) => s + c.n, 0),
            videos: counts.filter(c => c.id === a.id && c.kind !== 'photo').reduce((s, c) => s + c.n, 0),
        }));
    }

    static async album(bpId: number, id: number) {
        const [a] = await db.select().from(portfolioAlbums).where(and(eq(portfolioAlbums.id, id), eq(portfolioAlbums.businessPartnerId, bpId))).limit(1);
        if (!a) throw new HubError('Album not found', 'NOT_FOUND', 404);
        return a;
    }

    static async saveAlbum(ctx: Ctx, id: number | null, input: { title?: string; story?: string | null; location?: string | null; eventDate?: string | null; category?: string; coverUrl?: string | null; isPublished?: boolean; sortOrder?: number }) {
        const v: Record<string, unknown> = {};
        if (input.title !== undefined) { if (input.title.trim().length < 2) throw new HubError('Give the album a title — "Priya & Arjun, Gokarna".', 'NO_TITLE'); v.title = input.title.trim().slice(0, 100); }
        if (input.story !== undefined) v.story = input.story?.trim().slice(0, 3000) || null;
        if (input.location !== undefined) v.location = input.location?.trim().slice(0, 100) || null;
        if (input.eventDate !== undefined) { if (input.eventDate && !isDay(input.eventDate)) throw new HubError('The date is YYYY-MM-DD.', 'BAD_DATE'); v.eventDate = input.eventDate || null; }
        if (input.category !== undefined) { if (!ALBUM_CATEGORIES.some(([k]) => k === input.category)) throw new HubError('Unknown category.', 'BAD_CATEGORY'); v.category = input.category; }
        if (input.coverUrl !== undefined) { if (input.coverUrl && !isImageUrl(input.coverUrl)) throw new HubError('The cover must be one of your photos.', 'BAD_PHOTO'); v.coverUrl = input.coverUrl || null; }
        if (input.isPublished !== undefined) v.isPublished = !!input.isPublished;
        if (input.sortOrder !== undefined) v.sortOrder = Math.floor(input.sortOrder);
        if (id) {
            const [u] = await db.update(portfolioAlbums).set({ ...v, updatedAt: new Date() }).where(and(eq(portfolioAlbums.id, id), eq(portfolioAlbums.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!u) throw new HubError('Album not found', 'NOT_FOUND', 404);
            return u;
        }
        if (!v.title) throw new HubError('Give the album a title — "Priya & Arjun, Gokarna".', 'NO_TITLE');
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioAlbums).where(eq(portfolioAlbums.businessPartnerId, ctx.businessPartnerId));
        if (n >= 60) throw new HubError('Up to 60 albums.', 'TOO_MANY');
        const [row] = await db.insert(portfolioAlbums).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any), sortOrder: -n }).returning();
        return row;
    }

    static async deleteAlbum(ctx: Ctx, id: number) {
        await this.album(ctx.businessPartnerId, id);
        const media = await db.select().from(portfolioMedia).where(eq(portfolioMedia.albumId, id));
        await db.delete(portfolioAlbums).where(and(eq(portfolioAlbums.id, id), eq(portfolioAlbums.businessPartnerId, ctx.businessPartnerId)));
        return media;
    }

    static async media(bpId: number, albumId?: number | null) {
        return db.select().from(portfolioMedia).where(and(eq(portfolioMedia.businessPartnerId, bpId), ...(albumId ? [eq(portfolioMedia.albumId, albumId)] : [])))
            .orderBy(asc(portfolioMedia.sortOrder), asc(portfolioMedia.id));
    }

    /** Photos 400 in all, clips 30, linked films 60 — generous for any studio, and a bound on storage. */
    static async addMedia(ctx: Ctx, input: { albumId: number; kind: 'photo' | 'video' | 'embed'; url: string; thumbUrl?: string | null; width?: number | null; height?: number | null; durationSec?: number | null; caption?: string | null }) {
        await this.album(ctx.businessPartnerId, input.albumId);
        const [c] = await db.select({ photo: sql<number>`count(*) filter (where ${portfolioMedia.kind} = 'photo')::int`, video: sql<number>`count(*) filter (where ${portfolioMedia.kind} = 'video')::int`, embed: sql<number>`count(*) filter (where ${portfolioMedia.kind} = 'embed')::int`, inAlbum: sql<number>`count(*) filter (where ${portfolioMedia.albumId} = ${input.albumId})::int` })
            .from(portfolioMedia).where(eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId));
        const limit = { photo: 400, video: 30, embed: 60 }[input.kind];
        if ((c as any)[input.kind] >= limit) throw new HubError(`Up to ${limit} ${input.kind === 'photo' ? 'photos' : input.kind === 'video' ? 'clips' : 'linked films'} in your portfolio. Remove some first.`, 'TOO_MANY');
        if (c.inAlbum >= 120) throw new HubError('Up to 120 items in one album.', 'TOO_MANY');
        let url = input.url, provider: string | null = null, thumb = input.thumbUrl ?? null;
        if (input.kind === 'embed') {
            const v = videoLink(input.url);
            if (!v) throw new HubError('Paste a YouTube, Vimeo or Instagram link.', 'BAD_VIDEO');
            const [dupe] = await db.select({ id: portfolioMedia.id }).from(portfolioMedia).where(and(eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId), eq(portfolioMedia.url, v.url))).limit(1);
            if (dupe) throw new HubError('That film is already in your portfolio.', 'DUPLICATE', 409);
            url = v.url; provider = v.provider; thumb = v.thumb;
        } else if (input.kind === 'photo' && !isImageUrl(url)) throw new HubError('Upload a photo.', 'BAD_PHOTO');
        else if (input.kind === 'video' && !/^https:\/\/\S+$/.test(url)) throw new HubError('Upload a clip.', 'BAD_VIDEO');
        const [row] = await db.insert(portfolioMedia).values({
            businessPartnerId: ctx.businessPartnerId, albumId: input.albumId, kind: input.kind, url, thumbUrl: thumb, provider,
            width: input.width ?? null, height: input.height ?? null, durationSec: input.durationSec ?? null, caption: input.caption?.trim().slice(0, 200) || null, sortOrder: c.inAlbum,
        }).returning();
        return row;
    }

    static async updateMedia(ctx: Ctx, id: number, patch: { caption?: string | null; featured?: boolean; albumId?: number }) {
        if (patch.albumId !== undefined) await this.album(ctx.businessPartnerId, patch.albumId);
        if (patch.featured) {
            const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(portfolioMedia).where(and(eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId), eq(portfolioMedia.featured, true)));
            if (n >= 40) throw new HubError('Up to 40 featured items — un-feature one first.', 'TOO_MANY');
        }
        const [u] = await db.update(portfolioMedia).set({
            ...(patch.caption !== undefined ? { caption: patch.caption?.trim().slice(0, 200) || null } : {}),
            ...(patch.featured !== undefined ? { featured: patch.featured } : {}),
            ...(patch.albumId !== undefined ? { albumId: patch.albumId } : {}),
        }).where(and(eq(portfolioMedia.id, id), eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId))).returning();
        if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
        return u;
    }

    static async removeMedia(ctx: Ctx, id: number) {
        const [m] = await db.delete(portfolioMedia).where(and(eq(portfolioMedia.id, id), eq(portfolioMedia.businessPartnerId, ctx.businessPartnerId))).returning();
        if (m?.url) await db.update(portfolioAlbums).set({ coverUrl: null }).where(and(eq(portfolioAlbums.businessPartnerId, ctx.businessPartnerId), eq(portfolioAlbums.coverUrl, m.url)));
        return m ?? null;
    }

    static async reorder(ctx: Ctx, albumId: number, ids: number[]) {
        const list = await this.media(ctx.businessPartnerId, albumId);
        const known = new Set(list.map(m => m.id));
        const order = [...ids.filter(i => known.has(i)), ...list.map(m => m.id).filter(i => !ids.includes(i))];
        for (let i = 0; i < order.length; i++) await db.update(portfolioMedia).set({ sortOrder: i }).where(eq(portfolioMedia.id, order[i]));
        return this.media(ctx.businessPartnerId, albumId);
    }

    static mediaView(m: PortfolioMedia) {
        const v = m.kind === 'embed' ? videoLink(m.url) : null;
        return { id: m.id, albumId: m.albumId, kind: m.kind, url: m.url, thumb: m.thumbUrl ?? v?.thumb ?? null, embed: v?.embed ?? null, provider: m.provider, width: m.width, height: m.height, durationSec: m.durationSec, caption: m.caption, featured: m.featured };
    }

    static albumView(a: Awaited<ReturnType<typeof PortfolioService.albums>>[number] | (PortfolioAlbum & { cover?: string | null; photos?: number; videos?: number })) {
        return { id: a.id, title: a.title, story: a.story, location: a.location, eventDate: a.eventDate, category: a.category, cover: (a as any).cover ?? a.coverUrl ?? null, coverUrl: a.coverUrl, isPublished: a.isPublished, photos: (a as any).photos ?? 0, videos: (a as any).videos ?? 0 };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Packages, dates and the public page
    // ══════════════════════════════════════════════════════════════════════

    static async packages(bpId: number) {
        const rows = await db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), eq(eventPackages.isActive, true), eq(eventPackages.showOnPage, true))).orderBy(asc(eventPackages.pricePaise));
        const v = (x: typeof rows[number]) => ({ id: x.id, name: x.name, category: x.category, description: x.description, unit: x.unit, price: x.pricePaise / 100, gstRate: Number(x.gstRate), photos: x.photos ?? [], maxQty: x.maxQty });
        return { packages: rows.filter(x => !x.isAddon && x.category !== 'venue').map(v), addons: rows.filter(x => x.isAddon).map(v) };
    }

    static async readiness(bpId: number): Promise<Readiness> {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        const p = portfolioDefaults(bp?.portfolioProfile as PortfolioProfile);
        const albums = await this.albums(bpId, true);
        const photos = albums.reduce((a, x) => a + x.photos, 0);
        const { packages } = await this.packages(bpId);
        const checks = [
            { label: 'Your business is approved by UniteFix', done: bp?.status === 'active' },
            { label: 'A cover photo', done: !!p.coverPhoto },
            { label: 'A few lines about you', done: (p.about ?? '').length >= 40 },
            { label: 'At least one album with 6 photos', done: albums.some(a => a.photos >= 6) },
            { label: '12 photos in all', done: photos >= 12 },
            { label: 'At least one package (Events → Packages, shown on your page)', done: packages.length > 0 },
        ];
        return { ready: checks.every(c => c.done), checks };
    }

    static async publicPartner(code: string) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.partnerCode, code)).limit(1);
        if (!bp || bp.status !== 'active') return null;
        const { PartnerHubService } = await import('./partner-hub.service');
        if (!(await PartnerHubService.modulesOf(bp)).includes('portfolio')) return null;
        return bp;
    }

    static async publicPage(bp: BP) {
        const p = portfolioDefaults(bp.portfolioProfile as PortfolioProfile);
        const [albums, featured, pk, reviews, counts] = await Promise.all([
            this.albums(bp.id, true),
            db.select().from(portfolioMedia).innerJoin(portfolioAlbums, eq(portfolioAlbums.id, portfolioMedia.albumId))
                .where(and(eq(portfolioMedia.businessPartnerId, bp.id), eq(portfolioMedia.featured, true), eq(portfolioAlbums.isPublished, true))).orderBy(asc(portfolioMedia.sortOrder), desc(portfolioMedia.id)).limit(40),
            this.packages(bp.id),
            ListingService.publicReviews(bp.id, 'portfolio'),
            db.select({ photos: sql<number>`count(*) filter (where ${portfolioMedia.kind} = 'photo')::int`, films: sql<number>`count(*) filter (where ${portfolioMedia.kind} <> 'photo')::int` })
                .from(portfolioMedia).innerJoin(portfolioAlbums, eq(portfolioAlbums.id, portfolioMedia.albumId)).where(and(eq(portfolioMedia.businessPartnerId, bp.id), eq(portfolioAlbums.isPublished, true))),
        ]);
        let feature = featured.map(r => this.mediaView(r.portfolio_media));
        if (feature.length < 9) {
            // Not enough featured: fill the front with the first photos of each album.
            const more = albums.length ? await db.select().from(portfolioMedia).where(and(inArray(portfolioMedia.albumId, albums.map(a => a.id)), eq(portfolioMedia.kind, 'photo'))).orderBy(asc(portfolioMedia.sortOrder), asc(portfolioMedia.id)).limit(60) : [];
            const have = new Set(feature.map(f => f.id));
            const byAlbum = new Map<number, typeof more>();
            for (const m of more) byAlbum.set(m.albumId!, [...(byAlbum.get(m.albumId!) ?? []), m]);
            for (let round = 0; feature.length < 12 && round < 6; round++) for (const list of Array.from(byAlbum.values())) { const m = list[round]; if (m && !have.has(m.id) && feature.length < 12) { feature.push(this.mediaView(m)); have.add(m.id); } }
        }
        const [cv] = p.coverVideoId ? await db.select().from(portfolioMedia).where(and(eq(portfolioMedia.id, p.coverVideoId), eq(portfolioMedia.businessPartnerId, bp.id))).limit(1) : [];
        const films = albums.length ? await db.select().from(portfolioMedia).where(and(inArray(portfolioMedia.albumId, albums.map(a => a.id)), eq(portfolioMedia.kind, 'embed'))).orderBy(desc(portfolioMedia.featured), asc(portfolioMedia.sortOrder)).limit(6) : [];
        return {
            code: bp.partnerCode, name: bp.displayName, city: bp.district, phone: bp.contactPhone, gstRegistered: !!bp.gstin,
            profile: {
                tagline: p.tagline ?? null, about: p.about ?? null, coverPhoto: p.coverPhoto ?? null, coverVideo: cv ? { url: cv.url, poster: cv.thumbUrl } : null,
                styles: p.styles, travelAreas: p.travelAreas, languages: p.languages, since: p.since ?? null, instagram: p.instagram ?? null, youtube: p.youtube ?? null, deliveryDays: p.deliveryDays ?? null,
            },
            policies: { advancePercent: p.advancePercent, balanceDueDays: p.balanceDueDays, cancellation: p.cancellation, holdHours: p.holdHours },
            stats: { albums: albums.length, photos: counts[0]?.photos ?? 0, films: counts[0]?.films ?? 0 },
            featured: feature,
            films: films.map(f => this.mediaView(f)),
            albums: albums.map(a => this.albumView(a)),
            packages: pk.packages, addons: pk.addons, reviews,
        };
    }

    static async publicAlbum(bp: BP, albumId: number) {
        const [a] = await db.select().from(portfolioAlbums).where(and(eq(portfolioAlbums.id, albumId), eq(portfolioAlbums.businessPartnerId, bp.id), eq(portfolioAlbums.isPublished, true))).limit(1);
        if (!a) return null;
        const media = await this.media(bp.id, a.id);
        const others = (await this.albums(bp.id, true)).filter(x => x.id !== a.id).slice(0, 3).map(x => this.albumView(x));
        return { partner: { code: bp.partnerCode, name: bp.displayName }, album: this.albumView({ ...a, cover: a.coverUrl ?? media.find(m => m.kind === 'photo')?.url ?? null } as any), media: media.map(m => this.mediaView(m)), others };
    }

    /** Free crews per day in a month: { day, am, pm } counts of crews still free. */
    static async availability(bpId: number, month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) throw new HubError('Month is YYYY-MM.', 'BAD_MONTH');
        const p = await this.profile(bpId);
        const { from, to, rows } = await BookingCalendar.monthMap(bpId, 'crew', month);
        const busy = new Map<string, number>();
        for (const r of rows) if (r.resourceId <= p.crews) busy.set(`${r.day}:${r.part}`, (busy.get(`${r.day}:${r.part}`) ?? 0) + 1);
        const today = istToday();
        const out = [];
        for (let d = from; d <= to; d = addDays(d, 1)) {
            const closed = d <= today || d > addDays(today, 730);
            out.push({ day: d, closed, am: closed ? 0 : Math.max(0, p.crews - (busy.get(`${d}:am`) ?? 0)), pm: closed ? 0 : Math.max(0, p.crews - (busy.get(`${d}:pm`) ?? 0)) });
        }
        return { month, crews: p.crews, days: out };
    }

    /** The first crew free for every one of these days and parts. */
    static async freeCrew(bpId: number, days: string[], parts: Array<'am' | 'pm'>, crews: number) {
        for (let c = 1; c <= crews; c++) if (await BookingCalendar.isFree(bpId, 'crew', c, days, parts)) return c;
        return null;
    }

    static async price(bpId: number, input: { packageId: number; days?: number; hours?: number; addons?: Array<{ packageId: number; quantity?: number }> }) {
        const ids = [input.packageId, ...(input.addons ?? []).map(a => a.packageId)];
        const rows = await db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), inArray(eventPackages.id, ids), eq(eventPackages.isActive, true), eq(eventPackages.showOnPage, true)));
        const by = new Map(rows.map(r => [r.id, r]));
        const main = by.get(input.packageId);
        if (!main || main.isAddon || main.category === 'venue') throw new HubError('That package is no longer offered. Refresh the page.', 'NO_PACKAGE', 409);
        const days = Math.floor(Number(input.days ?? 1));
        if (!(days >= 1 && days <= 7)) throw new HubError('A shoot is 1 to 7 days.', 'BAD_DAYS');
        const lines: SaleLineInput[] = [];
        const picked: Array<{ kind: 'package' | 'addon'; packageId: number; name: string; quantity: number; unit: string; rate: number; amount: number }> = [];
        const add = (kind: 'package' | 'addon', x: typeof main, qty: number) => {
            lines.push({ description: x.name + (x.description ? ` — ${x.description}` : ''), hsnSac: x.sac, quantity: qty, unit: x.unit, rateRupees: x.pricePaise / 100, gstRate: Number(x.gstRate) });
            picked.push({ kind, packageId: x.id, name: x.name, quantity: qty, unit: x.unit, rate: x.pricePaise / 100, amount: Math.round(x.pricePaise * qty) / 100 });
        };
        let q = 1;
        if (main.unit === 'day') q = days;
        else if (main.unit === 'hour') { q = Math.floor(Number(input.hours ?? 1)); if (!(q >= 1 && q <= (main.maxQty ?? 12))) throw new HubError(`${main.name}: 1 to ${main.maxQty ?? 12} hours.`, 'BAD_QTY'); }
        add('package', main, q);
        for (const a of input.addons ?? []) {
            const x = by.get(a.packageId);
            if (!x || !x.isAddon) throw new HubError('An extra you chose is no longer offered. Refresh the page.', 'NO_ADDON', 409);
            let n = 1;
            if (x.unit === 'day') n = days;
            else if (x.unit !== 'event') { n = Math.floor(Number(a.quantity ?? 1)); const m = x.maxQty ?? 20; if (!(n >= 1 && n <= m)) throw new HubError(`${x.name}: 1 to ${m}.`, 'BAD_QTY'); }
            add('addon', x, n);
        }
        const taxable = lines.reduce((s, l) => s + Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)), 0);
        const gst = lines.reduce((s, l) => s + Math.round(Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)) * Number(l.gstRate ?? 0) / 100), 0);
        return { lines, picked, estimate: { taxable: taxable / 100, gst: gst / 100, total: (taxable + gst) / 100 } };
    }

    /** A client asks for a shoot: the first free crew is held, an enquiry recorded and a quotation drafted. */
    static async request(bp: BP, input: {
        packageId: number; addons?: Array<{ packageId: number; quantity?: number }>; date: string; days?: number; hours?: number; slot: Slot;
        occasion: string; location: string; guests?: number | null; name: string; phone: string; email?: string | null; notes?: string | null;
    }, channel: { source: 'public' | 'app'; userId?: number | null; basketId?: number | null } = { source: 'public' }) {
        if (!isDay(input.date)) throw new HubError('Choose the date.', 'NO_DATE');
        if (input.date <= istToday()) throw new HubError('Book from tomorrow onwards.', 'PAST_DATE');
        if (!input.occasion?.trim()) throw new HubError('What is the occasion?', 'NO_TYPE');
        if (!input.location?.trim()) throw new HubError('Where is the shoot?', 'NO_PLACE');
        const p = await this.profile(bp.id);
        const priced = await this.price(bp.id, input);
        const days = Array.from({ length: Math.floor(Number(input.days ?? 1)) }, (_, i) => addDays(input.date, i));
        const parts = partsOf(input.slot);
        const crew = await this.freeCrew(bp.id, days, parts, p.crews);
        if (!crew) throw new HubError(`${bp.displayName} is already booked for ${days.length > 1 ? 'one of those days' : 'that date'}. Please try another date.`, 'TAKEN', 409);

        const { PartnerEventsService } = await import('./partner-events.service');
        const { PartnerSalesService } = await import('./partner-sales.service');
        const ctx = { businessPartnerId: bp.id, adminUserId: null } as any;
        const notes = input.notes?.trim().slice(0, 1000) || null;
        const when = `${input.date}${days.length > 1 ? ` to ${days[days.length - 1]}` : ''} (${input.slot === 'full' ? 'full day' : input.slot === 'am' ? 'morning' : 'evening'})`;
        const e = await PartnerEventsService.createEnquiry(ctx, {
            name: input.name, phone: input.phone, email: input.email ?? null, userId: channel.userId ?? null, source: channel.source,
            eventType: input.occasion, eventDate: input.date, guests: input.guests ?? null, venue: input.location.trim().slice(0, 200),
            message: [`Shoot: ${when} at ${input.location.trim()}`, ...priced.picked.map(x => `${x.name}${x.quantity > 1 ? ` × ${x.quantity}` : ''}`), notes ? `Their notes: ${notes}` : null, `Estimate shown: ₹${priced.estimate.total.toLocaleString('en-IN')}`].filter(Boolean).join('\n'),
        }, { silent: true });
        const selection = { kind: 'shoot', packageId: input.packageId, slot: input.slot, days: days.length, dates: days, location: input.location.trim(), crew, items: priced.picked, notes, estimate: priced.estimate };
        try {
            await db.transaction(async (tx) => {
                await BookingCalendar.take(tx, { bpId: bp.id, resourceKind: 'crew', resourceId: crew, days, parts, status: 'hold', holdExpiresAt: new Date(Date.now() + p.holdHours * 3600_000), enquiryId: e.id });
                await tx.update(eventEnquiries).set({ kind: 'shoot', selection: selection as any, basketId: channel.basketId ?? null, updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
            });
        } catch (err) {
            await db.update(eventEnquiries).set({ status: 'lost', lostReason: 'The date was taken while the client was asking', kind: 'shoot', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
            throw err;
        }
        const due = addDays(input.date, -p.balanceDueDays);
        const q = await PartnerSalesService.createQuotation(ctx, {
            customerId: e.customerId, lines: priced.lines,
            validUntil: (() => { const in14 = addDays(istToday(), 14); return in14 < input.date ? in14 : addDays(input.date, -1); })(),
            notes: `${input.occasion}, ${when} at ${input.location.trim()}.${notes ? ` Client's notes: ${notes}` : ''}${p.deliveryDays ? ` Edited photos delivered within ${p.deliveryDays} days.` : ''}`,
            terms: `Advance ${p.advancePercent}% to confirm; balance by ${due < istToday() ? 'the shoot' : due}. Cancellation: ${p.cancellation.map(t => `${t.daysBefore}+ days before — ${t.refundPercent}% refund`).join('; ')}.`,
            source: 'events', sourceRefId: e.id,
        });
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(bp.id, 'enquiry_new', { title: `Shoot request: ${input.occasion}, ${input.date}`, body: `${input.name} — ${priced.picked[0].name}, ${when} at ${input.location.trim()}. The date is held for ${p.holdHours} hours; a quotation of exactly this is drafted — check it and send it from Quotations.`, link: '/partner/events/quotations', refType: 'event_enquiry', refId: e.id });
        return { enquiry: e, quotationId: q.id, estimate: priced.estimate, heldUntil: new Date(Date.now() + p.holdHours * 3600_000) };
    }

    /** A booking was confirmed with no live hold (it lapsed): take a free crew now, or warn. */
    static async bookCrewFor(bpId: number, bookingId: number, enquiryId: number) {
        const [e] = await db.select().from(eventEnquiries).where(eq(eventEnquiries.id, enquiryId)).limit(1);
        const sel = (e?.selection ?? {}) as any;
        const days: string[] = sel.dates?.length ? sel.dates : e?.eventDate ? [e.eventDate] : [];
        if (!days.length) return false;
        const parts = partsOf((sel.slot ?? 'full') as Slot);
        const p = await this.profile(bpId);
        const crew = await this.freeCrew(bpId, days, parts, p.crews);
        if (!crew) return false;
        try { await db.transaction(async (tx) => BookingCalendar.take(tx, { bpId, resourceKind: 'crew', resourceId: crew, days, parts, status: 'booked', bookingId, enquiryId })); return true; }
        catch { return false; }
    }

    static styleList() { return PHOTO_STYLES; }
}
