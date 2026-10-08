/**
 * An events partner's public showcase, and booking from it.
 *
 * The partner shows their work (photos, Instagram posts), their venues and
 * their themes, and lists add-ons (photography, cakes, catering…). A client
 * builds their event on the page — venue, theme, their own touches, add-ons —
 * sees a live estimate, and sends it. That becomes an enquiry with a
 * quotation already drafted from exactly what they chose; the partner checks
 * the date and sends it, and the usual accept → booking → advance follows.
 *
 * Prices on the page are the partner's own package and theme prices; the
 * server recomputes everything from the database when the request arrives.
 */

import { db } from '../db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { eventThemes, eventGallery, eventPackages, eventEnquiries, businessPartners, type EventTheme, type EventGalleryItem } from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import type { SaleLineInput } from './partner-sales.service';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
type Ctx = Pick<HubContext, 'businessPartnerId' | 'adminUserId'>;

export interface EventsProfile { tagline?: string | null; about?: string | null; coverPhoto?: string | null; instagram?: string | null }

/** Instagram post / reel URL → its canonical form, or null if it is not one. */
export function instagramPost(raw: string): { url: string; embed: string } | null {
    const m = String(raw ?? '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/);
    if (!m) return null;
    const kind = m[1] === 'reels' ? 'reel' : m[1];
    const url = `https://www.instagram.com/${kind}/${m[2]}/`;
    return { url, embed: `${url}embed/captioned/` };
}

/** An image the page may show: our uploads (https or, without Cloudinary, a data URI). */
const isImage = (u: unknown) => typeof u === 'string' && (/^https:\/\/\S+$/i.test(u) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(u)) && u.length < 2_500_000;
const cleanPhotos = (list: unknown, max = 8) => (Array.isArray(list) ? list.filter(isImage).slice(0, max) as string[] : []);

export class EventsShowcaseService {

    // ── profile ───────────────────────────────────────────────────────────

    static async profile(bpId: number): Promise<EventsProfile> {
        const [bp] = await db.select({ p: businessPartners.eventsProfile }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        return (bp?.p as EventsProfile) ?? {};
    }

    static async saveProfile(ctx: Ctx, input: EventsProfile) {
        const cur = await this.profile(ctx.businessPartnerId);
        const next: EventsProfile = { ...cur };
        if (input.tagline !== undefined) next.tagline = input.tagline?.trim().slice(0, 120) || null;
        if (input.about !== undefined) next.about = input.about?.trim().slice(0, 1200) || null;
        if (input.coverPhoto !== undefined) {
            if (input.coverPhoto && !isImage(input.coverPhoto)) throw new HubError('The cover photo must be an uploaded image.', 'BAD_PHOTO');
            next.coverPhoto = input.coverPhoto || null;
        }
        if (input.instagram !== undefined) {
            const h = String(input.instagram ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '');
            if (h && !/^[A-Za-z0-9._]{1,30}$/.test(h)) throw new HubError('That is not an Instagram handle (letters, numbers, dots and underscores).', 'BAD_HANDLE');
            next.instagram = h || null;
        }
        await db.update(businessPartners).set({ eventsProfile: next as any, updatedAt: new Date() }).where(eq(businessPartners.id, ctx.businessPartnerId));
        return next;
    }

    // ── themes ────────────────────────────────────────────────────────────

    static async themes(bpId: number, activeOnly = false) {
        return db.select().from(eventThemes).where(and(eq(eventThemes.businessPartnerId, bpId), ...(activeOnly ? [eq(eventThemes.isActive, true)] : [])))
            .orderBy(asc(eventThemes.sortOrder), asc(eventThemes.name));
    }

    static async saveTheme(ctx: Ctx, id: number | null, input: { name?: string; description?: string | null; suitableFor?: string | null; photos?: string[]; priceRupees?: number; gstRate?: number; isActive?: boolean; sortOrder?: number }) {
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) { if (input.name.trim().length < 2) throw new HubError('Name the theme.', 'NO_NAME'); v.name = input.name.trim().slice(0, 80); }
        if (input.description !== undefined) v.description = input.description?.trim().slice(0, 600) || null;
        if (input.suitableFor !== undefined) v.suitableFor = input.suitableFor?.trim().slice(0, 120) || null;
        if (input.photos !== undefined) v.photos = cleanPhotos(input.photos);
        if (input.priceRupees !== undefined) { if (!(input.priceRupees >= 0)) throw new HubError('Price cannot be negative.', 'BAD_PRICE'); v.pricePaise = Math.round(input.priceRupees * 100); }
        if (input.gstRate !== undefined) v.gstRate = String(bp?.gstin ? input.gstRate : 0);
        if (input.isActive !== undefined) v.isActive = input.isActive;
        if (input.sortOrder !== undefined) v.sortOrder = Math.floor(input.sortOrder);
        if (id) {
            const [u] = await db.update(eventThemes).set({ ...v, updatedAt: new Date() }).where(and(eq(eventThemes.id, id), eq(eventThemes.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!u) throw new HubError('Theme not found', 'NOT_FOUND', 404);
            return u;
        }
        if (!v.name) throw new HubError('Name the theme.', 'NO_NAME');
        const n = (await this.themes(ctx.businessPartnerId)).length;
        if (n >= 40) throw new HubError('Up to 40 themes.', 'TOO_MANY');
        const [row] = await db.insert(eventThemes).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any), gstRate: (v.gstRate as string) ?? String(bp?.gstin ? 18 : 0), sortOrder: n }).returning();
        return row;
    }

    static async addThemePhoto(ctx: Ctx, id: number, url: string) {
        const [t] = await db.select().from(eventThemes).where(and(eq(eventThemes.id, id), eq(eventThemes.businessPartnerId, ctx.businessPartnerId))).limit(1);
        if (!t) throw new HubError('Theme not found', 'NOT_FOUND', 404);
        const photos = [...(t.photos ?? []), url];
        if (photos.length > 8) throw new HubError('Up to 8 photos per theme.', 'TOO_MANY');
        return this.saveTheme(ctx, id, { photos });
    }

    // ── gallery ───────────────────────────────────────────────────────────

    static async gallery(bpId: number) {
        return db.select().from(eventGallery).where(eq(eventGallery.businessPartnerId, bpId)).orderBy(asc(eventGallery.sortOrder), asc(eventGallery.id));
    }

    static async addToGallery(ctx: Ctx, input: { kind: 'photo' | 'instagram'; url: string; caption?: string | null; themeId?: number | null }) {
        const list = await this.gallery(ctx.businessPartnerId);
        if (list.length >= 60) throw new HubError('Up to 60 items in your gallery. Remove some first.', 'TOO_MANY');
        let url: string;
        if (input.kind === 'instagram') {
            const ig = instagramPost(input.url);
            if (!ig) throw new HubError('Paste the link of an Instagram post or reel, like https://www.instagram.com/p/ABC123/.', 'BAD_INSTAGRAM');
            if (list.some(g => g.url === ig.url)) throw new HubError('That post is already in your gallery.', 'DUPLICATE', 409);
            url = ig.url;
        } else {
            if (!isImage(input.url)) throw new HubError('Upload a photo.', 'BAD_PHOTO');
            url = input.url;
        }
        if (input.themeId) {
            const [t] = await db.select({ id: eventThemes.id }).from(eventThemes).where(and(eq(eventThemes.id, input.themeId), eq(eventThemes.businessPartnerId, ctx.businessPartnerId))).limit(1);
            if (!t) throw new HubError('Theme not found', 'NOT_FOUND', 404);
        }
        const [row] = await db.insert(eventGallery).values({ businessPartnerId: ctx.businessPartnerId, kind: input.kind, url, caption: input.caption?.trim().slice(0, 200) || null, themeId: input.themeId ?? null, sortOrder: list.length }).returning();
        return row;
    }

    static async updateGalleryItem(ctx: Ctx, id: number, patch: { caption?: string | null; themeId?: number | null }) {
        const [u] = await db.update(eventGallery).set({
            ...(patch.caption !== undefined ? { caption: patch.caption?.trim().slice(0, 200) || null } : {}),
            ...(patch.themeId !== undefined ? { themeId: patch.themeId } : {}),
        }).where(and(eq(eventGallery.id, id), eq(eventGallery.businessPartnerId, ctx.businessPartnerId))).returning();
        if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
        return u;
    }

    static async removeFromGallery(ctx: Ctx, id: number) {
        await db.delete(eventGallery).where(and(eq(eventGallery.id, id), eq(eventGallery.businessPartnerId, ctx.businessPartnerId)));
    }

    /** Put the gallery in the order given (ids not listed keep their place after). */
    static async reorderGallery(ctx: Ctx, ids: number[]) {
        const list = await this.gallery(ctx.businessPartnerId);
        const known = new Set(list.map(g => g.id));
        const order = [...ids.filter(i => known.has(i)), ...list.map(g => g.id).filter(i => !ids.includes(i))];
        for (let i = 0; i < order.length; i++) await db.update(eventGallery).set({ sortOrder: i }).where(eq(eventGallery.id, order[i]));
        return this.gallery(ctx.businessPartnerId);
    }

    static galleryView(g: EventGalleryItem) {
        const ig = g.kind === 'instagram' ? instagramPost(g.url) : null;
        return { id: g.id, kind: g.kind, url: g.url, embed: ig?.embed ?? null, caption: g.caption, themeId: g.themeId };
    }

    static themeView(t: EventTheme) {
        return { id: t.id, name: t.name, description: t.description, suitableFor: t.suitableFor, photos: t.photos ?? [], price: t.pricePaise / 100, gstRate: Number(t.gstRate), isActive: t.isActive };
    }

    // ── the public page ───────────────────────────────────────────────────

    /** Everything the public page shows, for an active events partner. */
    static async publicShowcase(bp: typeof businessPartners.$inferSelect) {
        const [packages, themes, gallery] = await Promise.all([
            db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bp.id), eq(eventPackages.isActive, true))).orderBy(asc(eventPackages.category), asc(eventPackages.name)),
            this.themes(bp.id, true),
            this.gallery(bp.id),
        ]);
        const p = (bp.eventsProfile as EventsProfile) ?? {};
        const pk = (x: typeof packages[number]) => ({ id: x.id, name: x.name, category: x.category, description: x.description, unit: x.unit, price: x.pricePaise / 100, gstRate: Number(x.gstRate), photos: x.photos ?? [], capacity: x.capacity, maxQty: x.maxQty });
        return {
            name: bp.displayName, city: bp.district, phone: bp.contactPhone, gstRegistered: !!bp.gstin,
            profile: { tagline: p.tagline ?? null, about: p.about ?? null, coverPhoto: p.coverPhoto ?? null, instagram: p.instagram ?? null },
            gallery: gallery.map(g => this.galleryView(g)),
            venues: packages.filter(x => x.category === 'venue' && x.showOnPage).map(pk),
            themes: themes.map(t => this.themeView(t)),
            addons: packages.filter(x => x.category !== 'venue' && x.showOnPage).map(pk),
        };
    }

    /**
     * Price what the client built, from the database. Per-plate items are for
     * every guest; pieces, hours and days take the client's count; per-event
     * items count once.
     */
    static async price(bpId: number, input: { guests?: number | null; venueId?: number | null; themeId?: number | null; addons?: Array<{ packageId: number; quantity?: number }> }) {
        const lines: SaleLineInput[] = [];
        const picked: Array<{ kind: 'venue' | 'theme' | 'addon'; name: string; quantity: number; unit: string; rate: number; amount: number }> = [];
        const guests = input.guests ?? null;
        const ids = [...(input.venueId ? [input.venueId] : []), ...(input.addons ?? []).map(a => a.packageId)];
        const pk = ids.length ? await db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), inArray(eventPackages.id, ids), eq(eventPackages.isActive, true))) : [];
        const by = new Map(pk.map(p => [p.id, p]));
        const add = (kind: 'venue' | 'theme' | 'addon', name: string, desc: string | null, sac: string, gst: number, unit: string, ratePaise: number, qty: number) => {
            lines.push({ description: name + (desc ? ` — ${desc}` : ''), hsnSac: sac, quantity: qty, unit, rateRupees: ratePaise / 100, gstRate: gst });
            picked.push({ kind, name, quantity: qty, unit, rate: ratePaise / 100, amount: Math.round(ratePaise * qty) / 100 });
        };
        if (input.venueId) {
            const v = by.get(input.venueId);
            if (!v || v.category !== 'venue' || v.showOnPage === false) throw new HubError('That venue is no longer available.', 'NO_VENUE', 409);
            if (v.capacity && guests && guests > v.capacity) throw new HubError(`${v.name} holds up to ${v.capacity} guests.`, 'TOO_MANY_GUESTS', 409);
            add('venue', v.name, v.description, v.sac, Number(v.gstRate), v.unit, v.pricePaise, 1);
        }
        if (input.themeId) {
            const [t] = await db.select().from(eventThemes).where(and(eq(eventThemes.id, input.themeId), eq(eventThemes.businessPartnerId, bpId), eq(eventThemes.isActive, true))).limit(1);
            if (!t) throw new HubError('That theme is no longer available.', 'NO_THEME', 409);
            add('theme', `${t.name} theme decoration`, t.description, t.sac, Number(t.gstRate), 'event', t.pricePaise, 1);
        }
        for (const a of input.addons ?? []) {
            const x = by.get(a.packageId);
            if (!x || x.category === 'venue' || x.showOnPage === false) throw new HubError('An add-on you chose is no longer available. Refresh the page.', 'NO_ADDON', 409);
            let qty = 1;
            if (x.unit === 'plate') {
                if (!guests) throw new HubError(`Enter the number of guests for ${x.name}.`, 'NO_GUESTS');
                qty = guests;
            } else if (x.unit !== 'event') {
                qty = Math.floor(Number(a.quantity ?? 1));
                const max = x.maxQty ?? 50;
                if (!(qty >= 1 && qty <= max)) throw new HubError(`${x.name}: choose 1 to ${max}.`, 'BAD_QTY');
            }
            add('addon', x.name, x.description, x.sac, Number(x.gstRate), x.unit, x.pricePaise, qty);
        }
        if (!lines.length) throw new HubError('Choose a venue, a theme or at least one item.', 'NOTHING');
        const taxablePaise = lines.reduce((s, l) => s + Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)), 0);
        const gstPaise = lines.reduce((s, l) => s + Math.round(Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)) * Number(l.gstRate ?? 0) / 100), 0);
        return { lines, picked, estimate: { taxable: taxablePaise / 100, gst: gstPaise / 100, total: (taxablePaise + gstPaise) / 100 } };
    }

    /** A client's request from the public page → enquiry + a draft quotation of exactly what they chose. */
    static async request(bp: typeof businessPartners.$inferSelect, input: {
        name: string; phone: string; email?: string | null; eventType: string; eventDate?: string | null; guests?: number | null;
        venueId?: number | null; ownVenue?: string | null; themeId?: number | null; customization?: string | null; addons?: Array<{ packageId: number; quantity?: number }>;
    }, channel: { source: 'public' | 'app'; userId?: number | null; basketId?: number | null } = { source: 'public' }) {
        if (!input.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) throw new HubError('Choose the event date.', 'NO_DATE');
        if (input.eventDate < today()) throw new HubError('The event date has passed.', 'PAST_DATE');
        const priced = await this.price(bp.id, input);
        const venueName = input.venueId ? priced.picked.find(p => p.kind === 'venue')?.name ?? null : (input.ownVenue?.trim() || null);
        const themeName = input.themeId ? priced.picked.find(p => p.kind === 'theme')?.name.replace(/ theme decoration$/, '') ?? null : null;
        const custom = input.customization?.trim().slice(0, 1000) || null;
        const summary = [
            venueName ? `Venue: ${venueName}${input.venueId ? '' : ' (client\'s own)'}` : null,
            themeName ? `Theme: ${themeName}` : null,
            ...priced.picked.filter(p => p.kind === 'addon').map(p => `${p.name}${p.quantity > 1 ? ` × ${p.quantity}` : ''}`),
            custom ? `Their touches: ${custom}` : null,
            `Estimate shown: ₹${priced.estimate.total.toLocaleString('en-IN')}`,
        ].filter(Boolean).join('\n');

        const { PartnerEventsService } = await import('./partner-events.service');
        const { PartnerSalesService } = await import('./partner-sales.service');
        const ctx = { businessPartnerId: bp.id, adminUserId: null } as any;
        const e = await PartnerEventsService.createEnquiry(ctx, {
            name: input.name, phone: input.phone, email: input.email ?? null, source: channel.source, userId: channel.userId ?? null,
            eventType: input.eventType, eventDate: input.eventDate, guests: input.guests ?? null, venue: venueName, message: summary,
        });
        const selection = { venueId: input.venueId ?? null, ownVenue: input.venueId ? null : venueName, themeId: input.themeId ?? null, theme: themeName, customization: custom, items: priced.picked, estimate: priced.estimate };
        await db.update(eventEnquiries).set({ selection: selection as any, basketId: channel.basketId ?? null, updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
        // Drafted, not sent: the partner checks the date (and can adjust) before the client sees it.
        const q = await PartnerSalesService.createQuotation(ctx, {
            customerId: e.customerId, lines: priced.lines,
            validUntil: (() => { const in14 = new Date(Date.parse(`${today()}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10); return in14 < input.eventDate! ? in14 : input.eventDate!; })(),
            notes: `${input.eventType} on ${input.eventDate}${input.guests ? `, ${input.guests} guests` : ''}${venueName ? `, ${venueName}` : ''}.${custom ? ` Client's requests: ${custom}` : ''}`,
            source: 'events', sourceRefId: e.id,
        });
        return { enquiry: e, quotationId: q.id, estimate: priced.estimate };
    }
}
