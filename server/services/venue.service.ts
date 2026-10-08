/**
 * Halls — a hall partner's property, spaces, rates and calendar, and booking
 * a date from their public page.
 *
 *   Profile   the page (cover, video tour, about, address, amenities, house
 *             rules) and the policies (time slots, weekend days, peak dates,
 *             advance %, refundable deposit, cancellation terms, instant
 *             booking or confirm-first, how long a date is held)
 *   Spaces    main hall, mini hall, lawn — capacity, photos, a rent for each
 *             kind of day (weekday / weekend / peak) and part of day
 *             (morning / evening / full day)
 *   Calendar  BookingCalendar rows per space; the hall blocks its own dates
 *
 * Booking a date (public page or the app):
 *   1. the client picks a space, date, slot, guests and add-ons and sees the
 *      price (rent at that day's rate + add-ons, GST at each line's rate)
 *   2. the slot is HELD for them (database-enforced, no double booking) and
 *      an enquiry is recorded with exactly what they chose
 *   3a. instant booking: a quotation is issued and accepted on the spot, the
 *      booking is created PENDING with an advance + balance plan, and the
 *      client gets a payment link for the advance. Paying it confirms the
 *      booking and books the date (CelebrationBookings.onMilestonePaid).
 *   3b. confirm-first: the hall accepts (→ 3a) or declines (→ released)
 *      within the hold.
 *   A hold that lapses gives the date back (CelebrationBookings.tick).
 *
 * The refundable security deposit is collected and returned by the hall;
 * UniteFix only records it on the booking.
 */

import { db } from '../db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { venueSpaces, eventPackages, eventEnquiries, eventBookings, eventMilestones, partnerQuotations, partnerCustomers, businessPartners, type VenueSpace } from '@shared/schema';
import { DEFAULT_CANCELLATION, AMENITIES, SPACE_KINDS } from '@shared/celebrations';
import { HubError, type HubContext } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { BookingCalendar, partsOf, istToday, addDays, isDay, weekdayOf, type Slot } from './booking-calendar.service';
import { ListingService, type Readiness } from './listings.service';
import { videoLink, isImageUrl, cleanPhotoList } from '../lib/media-embed';
import type { SaleLineInput } from './partner-sales.service';
import crypto from 'crypto';

type Ctx = Pick<HubContext, 'businessPartnerId' | 'adminUserId'>;
type BP = typeof businessPartners.$inferSelect;
type DayType = 'weekday' | 'weekend' | 'peak';
const SLOTS: Slot[] = ['am', 'pm', 'full'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface VenueProfile {
    tagline?: string | null; about?: string | null; coverPhoto?: string | null; videoUrl?: string | null;
    address?: string | null; mapUrl?: string | null; amenities?: string[]; rooms?: number | null; parking?: number | null;
    catering?: 'in_house' | 'outside' | 'both' | null;
    rules?: { vegOnly?: boolean; alcohol?: 'no' | 'allowed' | 'licensed'; outsideCaterers?: boolean; outsideDecorators?: boolean; musicUntil?: string | null; notes?: string | null };
    slots?: { am: { from: string; to: string }; pm: { from: string; to: string } };
    weekendDays?: number[];
    peakDates?: Array<{ date: string; label: string | null }>;
    advancePercent?: number; balanceDueDays?: number; depositRupees?: number;
    cancellation?: Array<{ daysBefore: number; refundPercent: number }>;
    instantBooking?: boolean; holdHours?: number;
}

export function withDefaults(p: VenueProfile | null | undefined): Required<Pick<VenueProfile, 'slots' | 'weekendDays' | 'peakDates' | 'advancePercent' | 'balanceDueDays' | 'depositRupees' | 'cancellation' | 'instantBooking' | 'holdHours' | 'amenities'>> & VenueProfile {
    const x = p ?? {};
    return {
        ...x,
        amenities: x.amenities ?? [],
        slots: x.slots ?? { am: { from: '07:00', to: '15:00' }, pm: { from: '18:00', to: '23:30' } },
        weekendDays: x.weekendDays ?? [0, 6],
        peakDates: x.peakDates ?? [],
        advancePercent: x.advancePercent ?? 25,
        balanceDueDays: x.balanceDueDays ?? 7,
        depositRupees: x.depositRupees ?? 0,
        cancellation: x.cancellation?.length ? x.cancellation : DEFAULT_CANCELLATION,
        instantBooking: x.instantBooking ?? true,
        holdHours: x.holdHours ?? 24,
    };
}

const token = () => crypto.randomBytes(18).toString('base64url');

export class VenueService {

    // ══════════════════════════════════════════════════════════════════════
    // Profile and policies
    // ══════════════════════════════════════════════════════════════════════

    static async profile(bpId: number) {
        const [bp] = await db.select({ p: businessPartners.venueProfile }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        return withDefaults(bp?.p as VenueProfile);
    }

    static async saveProfile(ctx: Ctx, input: VenueProfile) {
        const cur = (await db.select({ p: businessPartners.venueProfile }).from(businessPartners).where(eq(businessPartners.id, ctx.businessPartnerId)).limit(1))[0]?.p as VenueProfile ?? {};
        const n: VenueProfile = { ...cur };
        const txt = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;
        if (input.tagline !== undefined) n.tagline = txt(input.tagline, 120);
        if (input.about !== undefined) n.about = txt(input.about, 2000);
        if (input.address !== undefined) n.address = txt(input.address, 300);
        if (input.mapUrl !== undefined) {
            const m = txt(input.mapUrl, 500);
            if (m && !/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*$/i.test(m)) throw new HubError('Paste a Google Maps link (Share → Copy link).', 'BAD_MAP');
            n.mapUrl = m;
        }
        if (input.coverPhoto !== undefined) {
            if (input.coverPhoto && !isImageUrl(input.coverPhoto)) throw new HubError('The cover must be an uploaded photo.', 'BAD_PHOTO');
            n.coverPhoto = input.coverPhoto || null;
        }
        if (input.videoUrl !== undefined) {
            if (input.videoUrl && !videoLink(input.videoUrl)) throw new HubError('Paste a YouTube, Vimeo or Instagram link for the video tour.', 'BAD_VIDEO');
            n.videoUrl = input.videoUrl ? videoLink(input.videoUrl)!.url : null;
        }
        if (input.amenities !== undefined) n.amenities = Array.from(new Set((input.amenities ?? []).map(a => String(a).trim().slice(0, 40)).filter(Boolean))).slice(0, 40);
        if (input.rooms !== undefined) n.rooms = input.rooms == null ? null : Math.max(0, Math.min(500, Math.floor(input.rooms)));
        if (input.parking !== undefined) n.parking = input.parking == null ? null : Math.max(0, Math.min(5000, Math.floor(input.parking)));
        if (input.catering !== undefined) n.catering = input.catering && ['in_house', 'outside', 'both'].includes(input.catering) ? input.catering : null;
        if (input.rules !== undefined) {
            const r = input.rules ?? {};
            if (r.musicUntil && !HHMM.test(r.musicUntil)) throw new HubError('Music until is a time like 22:30.', 'BAD_TIME');
            n.rules = { vegOnly: !!r.vegOnly, alcohol: r.alcohol && ['no', 'allowed', 'licensed'].includes(r.alcohol) ? r.alcohol : 'no', outsideCaterers: !!r.outsideCaterers, outsideDecorators: !!r.outsideDecorators, musicUntil: r.musicUntil || null, notes: txt(r.notes, 600) };
        }
        if (input.slots !== undefined) {
            const s = input.slots;
            if (!s || ![s.am?.from, s.am?.to, s.pm?.from, s.pm?.to].every(t => HHMM.test(String(t)))) throw new HubError('Slot times are like 07:00 and 15:00.', 'BAD_TIME');
            if (s.am.from >= s.am.to) throw new HubError('The morning slot must end after it starts.', 'BAD_TIME');
            n.slots = { am: { from: s.am.from, to: s.am.to }, pm: { from: s.pm.from, to: s.pm.to } };
        }
        if (input.weekendDays !== undefined) n.weekendDays = Array.from(new Set((input.weekendDays ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))).sort();
        if (input.peakDates !== undefined) {
            const list = (input.peakDates ?? []).filter(p => isDay(p?.date)).map(p => ({ date: p.date, label: p.label?.trim().slice(0, 60) || null }));
            if (list.length > 400) throw new HubError('Up to 400 peak dates.', 'TOO_MANY');
            const seen = new Set<string>();
            n.peakDates = list.filter(p => (seen.has(p.date) ? false : (seen.add(p.date), true))).sort((a, b) => a.date.localeCompare(b.date));
        }
        if (input.advancePercent !== undefined) {
            if (!(input.advancePercent >= 10 && input.advancePercent <= 100)) throw new HubError('The advance is 10% to 100% of the booking.', 'BAD_ADVANCE');
            n.advancePercent = Math.round(input.advancePercent);
        }
        if (input.balanceDueDays !== undefined) {
            if (!(input.balanceDueDays >= 0 && input.balanceDueDays <= 60)) throw new HubError('The balance is due 0 to 60 days before the event.', 'BAD_DAYS');
            n.balanceDueDays = Math.floor(input.balanceDueDays);
        }
        if (input.depositRupees !== undefined) {
            if (!(input.depositRupees >= 0 && input.depositRupees <= 1_000_000)) throw new HubError('The deposit is ₹0 to ₹10,00,000.', 'BAD_DEPOSIT');
            n.depositRupees = Math.round(input.depositRupees);
        }
        if (input.cancellation !== undefined) {
            const tiers = (input.cancellation ?? []).map(t => ({ daysBefore: Math.floor(Number(t.daysBefore)), refundPercent: Math.round(Number(t.refundPercent)) }));
            if (!tiers.length || tiers.length > 6 || tiers.some(t => !(t.daysBefore >= 0 && t.daysBefore <= 365 && t.refundPercent >= 0 && t.refundPercent <= 100))) throw new HubError('Up to 6 cancellation rules: days before (0–365) and refund (0–100%).', 'BAD_POLICY');
            if (new Set(tiers.map(t => t.daysBefore)).size !== tiers.length) throw new HubError('Each cancellation rule needs a different number of days.', 'BAD_POLICY');
            const sorted = [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
            if (sorted.some((t, i) => i > 0 && t.refundPercent > sorted[i - 1].refundPercent)) throw new HubError('Refunds cannot grow as the event gets closer.', 'BAD_POLICY');
            if (!sorted.some(t => t.daysBefore === 0)) sorted.push({ daysBefore: 0, refundPercent: 0 });
            n.cancellation = sorted;
        }
        if (input.instantBooking !== undefined) n.instantBooking = !!input.instantBooking;
        if (input.holdHours !== undefined) {
            if (!(input.holdHours >= 2 && input.holdHours <= 72)) throw new HubError('Hold a date for 2 to 72 hours.', 'BAD_HOLD');
            n.holdHours = Math.floor(input.holdHours);
        }
        await db.update(businessPartners).set({ venueProfile: n as any, updatedAt: new Date() }).where(eq(businessPartners.id, ctx.businessPartnerId));
        return withDefaults(n);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Spaces
    // ══════════════════════════════════════════════════════════════════════

    static async spaces(bpId: number, activeOnly = false) {
        return db.select().from(venueSpaces).where(and(eq(venueSpaces.businessPartnerId, bpId), ...(activeOnly ? [eq(venueSpaces.isActive, true)] : [])))
            .orderBy(asc(venueSpaces.sortOrder), asc(venueSpaces.id));
    }

    static async space(bpId: number, id: number) {
        const [s] = await db.select().from(venueSpaces).where(and(eq(venueSpaces.id, id), eq(venueSpaces.businessPartnerId, bpId))).limit(1);
        if (!s) throw new HubError('Space not found', 'NOT_FOUND', 404);
        return s;
    }

    /** Rates come in rupees from the Hub: { weekday: { am, pm, full }, weekend: {…}, peak: {…} }. */
    static async saveSpace(ctx: Ctx, id: number | null, input: {
        name?: string; kind?: string; description?: string | null; seated?: number | null; floating?: number | null; areaSqft?: number | null;
        photos?: string[]; videoUrl?: string | null; features?: string[]; included?: string | null;
        ratesRupees?: Partial<Record<DayType, Partial<Record<Slot, number | null>>>>; gstRate?: number; sac?: string; isActive?: boolean; sortOrder?: number;
    }) {
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) { if (input.name.trim().length < 2) throw new HubError('Name the space (Main hall, Lawn…).', 'NO_NAME'); v.name = input.name.trim().slice(0, 80); }
        if (input.kind !== undefined) { if (!SPACE_KINDS.some(([k]) => k === input.kind)) throw new HubError('Unknown kind of space.', 'BAD_KIND'); v.kind = input.kind; }
        if (input.description !== undefined) v.description = input.description?.trim().slice(0, 1000) || null;
        const cap = (x: number | null | undefined, what: string) => { if (x == null) return null; if (!(Number.isInteger(x) && x > 0 && x <= 20000)) throw new HubError(`${what} is a number of guests (1–20,000).`, 'BAD_CAPACITY'); return x; };
        if (input.seated !== undefined) v.seated = cap(input.seated, 'Seated capacity');
        if (input.floating !== undefined) v.floating = cap(input.floating, 'Floating capacity');
        if (input.areaSqft !== undefined) v.areaSqft = input.areaSqft == null ? null : Math.max(1, Math.min(1_000_000, Math.floor(input.areaSqft)));
        if (input.photos !== undefined) v.photos = cleanPhotoList(input.photos, 12);
        if (input.videoUrl !== undefined) {
            if (input.videoUrl && !videoLink(input.videoUrl)) throw new HubError('Paste a YouTube, Vimeo or Instagram link.', 'BAD_VIDEO');
            v.videoUrl = input.videoUrl ? videoLink(input.videoUrl)!.url : null;
        }
        if (input.features !== undefined) v.features = Array.from(new Set((input.features ?? []).map(f => String(f).trim().slice(0, 60)).filter(Boolean))).slice(0, 20);
        if (input.included !== undefined) v.included = input.included?.trim().slice(0, 600) || null;
        if (input.ratesRupees !== undefined) {
            const out: Record<string, Record<string, number>> = {};
            for (const dt of ['weekday', 'weekend', 'peak'] as DayType[]) {
                const r = input.ratesRupees?.[dt] ?? {};
                const o: Record<string, number> = {};
                for (const s of SLOTS) {
                    const x = r[s];
                    if (x == null || x === 0) continue;
                    if (!(x > 0 && x <= 10_000_000)) throw new HubError('Rents are in rupees, more than zero.', 'BAD_RATE');
                    o[s] = Math.round(x * 100);
                }
                if (Object.keys(o).length) out[dt] = o;
            }
            v.rates = out;
        }
        if (input.gstRate !== undefined) {
            if (![0, 5, 12, 18, 28].includes(input.gstRate)) throw new HubError('GST is 0, 5, 12, 18 or 28%.', 'BAD_GST');
            v.gstRate = String(bp?.gstin ? input.gstRate : 0);
        }
        if (input.sac !== undefined) { if (!/^\d{4,8}$/.test(input.sac)) throw new HubError('SAC is 4–8 digits.', 'BAD_SAC'); v.sac = input.sac; }
        if (input.isActive !== undefined) v.isActive = !!input.isActive;
        if (input.sortOrder !== undefined) v.sortOrder = Math.floor(input.sortOrder);
        if (v.seated != null || v.floating != null || id) {
            // nothing: capacity is optional per kind (a small room may only have seated)
        }
        if (id) {
            const [u] = await db.update(venueSpaces).set({ ...v, updatedAt: new Date() }).where(and(eq(venueSpaces.id, id), eq(venueSpaces.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!u) throw new HubError('Space not found', 'NOT_FOUND', 404);
            return u;
        }
        if (!v.name) throw new HubError('Name the space (Main hall, Lawn…).', 'NO_NAME');
        const n = (await this.spaces(ctx.businessPartnerId)).length;
        if (n >= 20) throw new HubError('Up to 20 spaces.', 'TOO_MANY');
        const [row] = await db.insert(venueSpaces).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any), gstRate: (v.gstRate as string) ?? String(bp?.gstin ? 18 : 0), sortOrder: n }).returning();
        return row;
    }

    static async addSpacePhoto(ctx: Ctx, id: number, url: string) {
        const s = await this.space(ctx.businessPartnerId, id);
        const photos = [...(s.photos ?? []), url];
        if (photos.length > 12) throw new HubError('Up to 12 photos per space.', 'TOO_MANY');
        return this.saveSpace(ctx, id, { photos });
    }

    // ══════════════════════════════════════════════════════════════════════
    // Pricing
    // ══════════════════════════════════════════════════════════════════════

    static dayType(p: ReturnType<typeof withDefaults>, day: string): { type: DayType; label: string | null } {
        const peak = p.peakDates.find(x => x.date === day);
        if (peak) return { type: 'peak', label: peak.label };
        return { type: p.weekendDays.includes(weekdayOf(day)) ? 'weekend' : 'weekday', label: null };
    }

    /**
     * The rent for one slot on one kind of day, in paise; null if the space
     * does not offer that slot. Weekend falls back to the weekday rent, peak
     * to the weekend rent; a full day not priced on its own is morning +
     * evening.
     */
    static rate(space: VenueSpace, type: DayType, slot: Slot): number | null {
        const r = space.rates ?? {};
        const pick = (s: Slot) => {
            const chain: DayType[] = type === 'peak' ? ['peak', 'weekend', 'weekday'] : type === 'weekend' ? ['weekend', 'weekday'] : ['weekday'];
            for (const t of chain) { const x = r[t]?.[s]; if (x && x > 0) return x; }
            return null;
        };
        const direct = pick(slot);
        if (direct) return direct;
        if (slot === 'full') { const a = pick('am'), b = pick('pm'); return a && b ? a + b : null; }
        return null;
    }

    static offered(space: VenueSpace): Slot[] {
        return SLOTS.filter(s => this.rate(space, 'weekday', s) != null);
    }

    static fromPrice(space: VenueSpace): number | null {
        const list = this.offered(space).map(s => this.rate(space, 'weekday', s)!).filter(Boolean);
        return list.length ? Math.min(...list) / 100 : null;
    }

    /** Price a booking from the database. Add-ons are the hall's event packages shown on its page. */
    static async price(bpId: number, input: { spaceId: number; date: string; slot: Slot; guests?: number | null; addons?: Array<{ packageId: number; quantity?: number }> }) {
        const p = await this.profile(bpId);
        const s = await this.space(bpId, input.spaceId).catch(() => null);
        if (!s || !s.isActive) throw new HubError('That space is not available.', 'NO_SPACE', 409);
        if (!isDay(input.date)) throw new HubError('Choose a date.', 'NO_DATE');
        if (!SLOTS.includes(input.slot)) throw new HubError('Choose morning, evening or full day.', 'NO_SLOT');
        const guests = input.guests ?? null;
        if (guests != null && !(Number.isInteger(guests) && guests > 0 && guests <= 100000)) throw new HubError('Guests must be a positive number.', 'BAD_GUESTS');
        const max = Math.max(s.seated ?? 0, s.floating ?? 0);
        if (guests && max && guests > max) throw new HubError(`${s.name} holds up to ${max} guests${s.seated && s.floating ? ` (${s.seated} seated, ${s.floating} floating)` : ''}.`, 'TOO_MANY_GUESTS', 409);
        const { type, label } = this.dayType(p, input.date);
        const rent = this.rate(s, type, input.slot);
        if (rent == null) throw new HubError(`${s.name} is not let for ${input.slot === 'full' ? 'a full day' : input.slot === 'am' ? 'mornings' : 'evenings'}.`, 'NO_SLOT', 409);
        const slotTimes = input.slot === 'full' ? `${p.slots.am.from}–${p.slots.pm.to}` : `${p.slots[input.slot].from}–${p.slots[input.slot].to}`;
        const slotName = input.slot === 'full' ? 'Full day' : input.slot === 'am' ? 'Morning' : 'Evening';
        const lines: SaleLineInput[] = [{ description: `${s.name} — ${slotName} (${slotTimes}) on ${input.date}${label ? `, ${label}` : ''}`, hsnSac: s.sac, quantity: 1, unit: 'slot', rateRupees: rent / 100, gstRate: Number(s.gstRate) }];
        const picked: Array<{ kind: 'space' | 'addon'; packageId?: number; name: string; quantity: number; unit: string; rate: number; amount: number }> = [
            { kind: 'space', name: `${s.name} — ${slotName}`, quantity: 1, unit: 'slot', rate: rent / 100, amount: rent / 100 },
        ];
        const ids = (input.addons ?? []).map(a => a.packageId);
        if (ids.length) {
            const pk = await db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), inArray(eventPackages.id, ids), eq(eventPackages.isActive, true)));
            const by = new Map(pk.map(x => [x.id, x]));
            for (const a of input.addons ?? []) {
                const x = by.get(a.packageId);
                if (!x || x.category === 'venue' || x.showOnPage === false) throw new HubError('An add-on you chose is no longer offered. Refresh the page.', 'NO_ADDON', 409);
                let qty = 1;
                if (x.unit === 'plate') { if (!guests) throw new HubError(`Enter the number of guests for ${x.name}.`, 'NO_GUESTS'); qty = guests; }
                else if (x.unit !== 'event') { qty = Math.floor(Number(a.quantity ?? 1)); const m = x.maxQty ?? 50; if (!(qty >= 1 && qty <= m)) throw new HubError(`${x.name}: choose 1 to ${m}.`, 'BAD_QTY'); }
                lines.push({ description: x.name + (x.description ? ` — ${x.description}` : ''), hsnSac: x.sac, quantity: qty, unit: x.unit, rateRupees: x.pricePaise / 100, gstRate: Number(x.gstRate) });
                picked.push({ kind: 'addon', packageId: x.id, name: x.name, quantity: qty, unit: x.unit, rate: x.pricePaise / 100, amount: Math.round(x.pricePaise * qty) / 100 });
            }
        }
        const taxable = lines.reduce((a, l) => a + Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)), 0);
        const gst = lines.reduce((a, l) => a + Math.round(Math.round(Number(l.rateRupees) * 100 * Number(l.quantity)) * Number(l.gstRate ?? 0) / 100), 0);
        const total = taxable + gst;
        const advance = p.advancePercent >= 100 ? total : Math.round(total * p.advancePercent / 100);
        return {
            space: s, profile: p, dayType: type, dayLabel: label, slotName, slotTimes, lines, picked,
            estimate: { taxable: taxable / 100, gst: gst / 100, total: total / 100, advance: advance / 100, balance: (total - advance) / 100, deposit: p.depositRupees, advancePercent: p.advancePercent },
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Calendar
    // ══════════════════════════════════════════════════════════════════════

    /** A month for the Hub: every live row, with whose booking it is. */
    static async calendar(bpId: number, month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) throw new HubError('Month is YYYY-MM.', 'BAD_MONTH');
        const { from, to, rows } = await BookingCalendar.monthMap(bpId, 'space', month);
        const enqIds = Array.from(new Set(rows.map(r => r.enquiryId).filter((x): x is number => !!x)));
        const bkIds = Array.from(new Set(rows.map(r => r.bookingId).filter((x): x is number => !!x)));
        const enq = enqIds.length ? await db.select({ id: eventEnquiries.id, eventType: eventEnquiries.eventType, name: partnerCustomers.name }).from(eventEnquiries)
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, eventEnquiries.customerId)).where(inArray(eventEnquiries.id, enqIds)) : [];
        const bk = bkIds.length ? await db.select({ id: eventBookings.id, title: eventBookings.title, status: eventBookings.status }).from(eventBookings).where(inArray(eventBookings.id, bkIds)) : [];
        const em = new Map(enq.map(e => [e.id, e])), bm = new Map(bk.map(b => [b.id, b]));
        const p = await this.profile(bpId);
        const days: Array<{ day: string; type: DayType; label: string | null }> = [];
        for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, ...this.dayType(p, d) });
        return {
            month, days, spaces: (await this.spaces(bpId)).map(s => ({ id: s.id, name: s.name, isActive: s.isActive })),
            entries: rows.map(r => ({
                id: r.id, spaceId: r.resourceId, day: r.day, part: r.part, status: r.status, holdExpiresAt: r.holdExpiresAt, note: r.note,
                enquiryId: r.enquiryId, bookingId: r.bookingId,
                who: r.bookingId ? bm.get(r.bookingId)?.title ?? null : r.enquiryId ? `${em.get(r.enquiryId)?.eventType ?? 'Request'} — ${em.get(r.enquiryId)?.name ?? ''}` : null,
            })),
        };
    }

    /** The public grid: for each day of the month, is the morning / evening free, and what kind of day is it. */
    static async availability(bpId: number, spaceId: number, month: string) {
        if (!/^\d{4}-\d{2}$/.test(month)) throw new HubError('Month is YYYY-MM.', 'BAD_MONTH');
        const s = await this.space(bpId, spaceId);
        if (!s.isActive) throw new HubError('That space is not available.', 'NO_SPACE', 404);
        const { from, to, rows } = await BookingCalendar.monthMap(bpId, 'space', month, [spaceId]);
        const taken = new Set(rows.map(r => `${r.day}:${r.part}`));
        const p = await this.profile(bpId);
        const today = istToday();
        const last = addDays(today, 540);
        const out = [];
        for (let d = from; d <= to; d = addDays(d, 1)) {
            const closed = d <= today || d > last;
            const dt = this.dayType(p, d);
            out.push({
                day: d, type: dt.type, label: dt.label, closed,
                am: closed ? 'closed' : taken.has(`${d}:am`) ? 'taken' : this.rate(s, dt.type, 'am') != null ? 'free' : 'na',
                pm: closed ? 'closed' : taken.has(`${d}:pm`) ? 'taken' : this.rate(s, dt.type, 'pm') != null ? 'free' : 'na',
                full: closed || taken.has(`${d}:am`) || taken.has(`${d}:pm`) ? false : this.rate(s, dt.type, 'full') != null,
                from: this.rate(s, dt.type, 'am') ?? this.rate(s, dt.type, 'pm') ?? this.rate(s, dt.type, 'full'),
            });
        }
        return { month, spaceId, days: out.map(x => ({ ...x, from: x.from != null ? x.from / 100 : null })) };
    }

    // ══════════════════════════════════════════════════════════════════════
    // The public page
    // ══════════════════════════════════════════════════════════════════════

    static async readiness(bpId: number): Promise<Readiness> {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        const p = withDefaults(bp?.venueProfile as VenueProfile);
        const spaces = (await this.spaces(bpId, true));
        const good = spaces.filter(s => (s.photos ?? []).length >= 3 && (s.seated || s.floating) && this.offered(s).length);
        const checks = [
            { label: 'Your business is approved by UniteFix', done: bp?.status === 'active' },
            { label: 'A cover photo', done: !!p.coverPhoto },
            { label: 'A few lines about the property', done: (p.about ?? '').length >= 40 },
            { label: 'The address', done: (p.address ?? '').length >= 10 },
            { label: 'At least one space with 3 photos, its capacity and a rent', done: good.length > 0 },
        ];
        return { ready: checks.every(c => c.done), checks };
    }

    static async publicPartner(code: string) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.partnerCode, code)).limit(1);
        if (!bp || bp.status !== 'active') return null;
        const { PartnerHubService } = await import('./partner-hub.service');
        if (!(await PartnerHubService.modulesOf(bp)).includes('venue')) return null;
        return bp;
    }

    /** Everything the public page shows. `preview` lets the partner see it before it is live. */
    static async publicPage(bp: BP) {
        const p = withDefaults(bp.venueProfile as VenueProfile);
        const [spaces, addons, reviews] = await Promise.all([
            this.spaces(bp.id, true),
            db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bp.id), eq(eventPackages.isActive, true), eq(eventPackages.showOnPage, true))).orderBy(asc(eventPackages.category), asc(eventPackages.name)),
            ListingService.publicReviews(bp.id, 'venue'),
        ]);
        const tour = p.videoUrl ? videoLink(p.videoUrl) : null;
        return {
            code: bp.partnerCode, name: bp.displayName, city: bp.district, pincode: bp.pincode, phone: bp.contactPhone, gstRegistered: !!bp.gstin,
            profile: {
                tagline: p.tagline ?? null, about: p.about ?? null, coverPhoto: p.coverPhoto ?? null, video: tour, address: p.address ?? null, mapUrl: p.mapUrl ?? null,
                amenities: p.amenities, rooms: p.rooms ?? null, parking: p.parking ?? null, catering: p.catering ?? null, rules: p.rules ?? null,
            },
            policies: { slots: p.slots, weekendDays: p.weekendDays, advancePercent: p.advancePercent, balanceDueDays: p.balanceDueDays, deposit: p.depositRupees, cancellation: p.cancellation, instantBooking: p.instantBooking, holdHours: p.holdHours },
            spaces: spaces.map(s => ({
                id: s.id, name: s.name, kind: s.kind, description: s.description, seated: s.seated, floating: s.floating, areaSqft: s.areaSqft,
                photos: s.photos ?? [], video: s.videoUrl ? videoLink(s.videoUrl) : null, features: s.features ?? [], included: s.included, gstRate: Number(s.gstRate),
                slots: this.offered(s), from: this.fromPrice(s),
                rates: (['weekday', 'weekend', 'peak'] as DayType[]).map(t => ({ type: t, am: this.rate(s, t, 'am'), pm: this.rate(s, t, 'pm'), full: this.rate(s, t, 'full') }))
                    .map(r => ({ type: r.type, am: r.am != null ? r.am / 100 : null, pm: r.pm != null ? r.pm / 100 : null, full: r.full != null ? r.full / 100 : null })),
            })).filter(s => s.slots.length),
            addons: addons.filter(x => x.category !== 'venue').map(x => ({ id: x.id, name: x.name, category: x.category, description: x.description, unit: x.unit, price: x.pricePaise / 100, gstRate: Number(x.gstRate), photos: x.photos ?? [], maxQty: x.maxQty })),
            reviews,
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Booking a date
    // ══════════════════════════════════════════════════════════════════════

    static async request(bp: BP, input: {
        spaceId: number; date: string; slot: Slot; guests?: number | null; occasion: string; addons?: Array<{ packageId: number; quantity?: number }>;
        name: string; phone: string; email?: string | null; notes?: string | null;
    }, channel: { source: 'public' | 'app'; userId?: number | null; basketId?: number | null } = { source: 'public' }) {
        if (!isDay(input.date)) throw new HubError('Choose the date.', 'NO_DATE');
        if (input.date <= istToday()) throw new HubError('Book from tomorrow onwards.', 'PAST_DATE');
        if (input.date > addDays(istToday(), 540)) throw new HubError('Bookings open up to 18 months ahead.', 'TOO_FAR');
        if (!input.occasion?.trim()) throw new HubError('What is the occasion?', 'NO_TYPE');
        const priced = await this.price(bp.id, input);
        const p = priced.profile;
        const parts = partsOf(input.slot);
        // A quick check for a friendly message; the INSERT below is the real guard.
        if (!(await BookingCalendar.isFree(bp.id, 'space', input.spaceId, [input.date], parts))) throw new HubError(`${priced.space.name} is already booked for that ${priced.slotName.toLowerCase()}. Please pick another date or time.`, 'TAKEN', 409);

        const { PartnerEventsService } = await import('./partner-events.service');
        const ctx = { businessPartnerId: bp.id, adminUserId: null } as any;
        const notes = input.notes?.trim().slice(0, 1000) || null;
        const summary = [
            `${priced.space.name}, ${priced.slotName.toLowerCase()} (${priced.slotTimes}) on ${input.date}${priced.dayLabel ? ` — ${priced.dayLabel}` : ''}`,
            ...priced.picked.filter(x => x.kind === 'addon').map(x => `${x.name}${x.quantity > 1 ? ` × ${x.quantity}` : ''}`),
            notes ? `Their notes: ${notes}` : null,
            `Price shown: ₹${priced.estimate.total.toLocaleString('en-IN')} incl. GST; advance ₹${priced.estimate.advance.toLocaleString('en-IN')}`,
        ].filter(Boolean).join('\n');
        const e = await PartnerEventsService.createEnquiry(ctx, {
            name: input.name, phone: input.phone, email: input.email ?? null, userId: channel.userId ?? null, source: channel.source,
            eventType: input.occasion, eventDate: input.date, guests: input.guests ?? null, venue: priced.space.name, message: summary,
        }, { silent: true });
        const holdUntil = new Date(Date.now() + p.holdHours * 3600_000);
        const selection = {
            kind: 'hall', spaceId: priced.space.id, space: priced.space.name, slot: input.slot, slotName: priced.slotName, slotTimes: priced.slotTimes,
            dayType: priced.dayType, dayLabel: priced.dayLabel, items: priced.picked, notes, estimate: priced.estimate, instant: p.instantBooking,
        };
        try {
            await db.transaction(async (tx) => {
                await BookingCalendar.take(tx, { bpId: bp.id, resourceKind: 'space', resourceId: priced.space.id, days: [input.date], parts, status: 'hold', holdExpiresAt: holdUntil, enquiryId: e.id });
                await tx.update(eventEnquiries).set({ kind: 'hall', selection: selection as any, basketId: channel.basketId ?? null, updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
            });
        } catch (err) {
            await db.update(eventEnquiries).set({ status: 'lost', lostReason: 'The date was taken while the client was booking', kind: 'hall', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
            throw err;
        }

        const { HubAlerts } = await import('./hub-alerts.service');
        let booking: { id: number } | null = null, payUrl: string | null = null;
        if (p.instantBooking) {
            let r;
            try { r = await this.bookRequest(ctx, e.id, priced.lines, holdUntil); }
            catch (err) {
                // Give the date back at once rather than when the hold lapses.
                await db.transaction(async (tx) => { await BookingCalendar.release(tx, { enquiryId: e.id }); await tx.update(eventEnquiries).set({ status: 'lost', lostReason: 'The booking could not be completed', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id)); });
                throw err;
            }
            booking = r.booking; payUrl = r.payUrl;
            await HubAlerts.send(bp.id, 'booking_request', { title: `Booked: ${priced.space.name}, ${input.date}`, body: `${input.name} booked ${priced.slotName.toLowerCase()} for ${input.occasion}${input.guests ? `, ${input.guests} guests` : ''}. The date is held until the ${p.advancePercent}% advance is paid.`, link: `/partner/events/bookings/${r.booking.id}`, refType: 'event_booking', refId: r.booking.id });
        } else {
            await HubAlerts.send(bp.id, 'booking_request', { title: `Hall request: ${priced.space.name}, ${input.date}`, body: `${input.name} asks for the ${priced.slotName.toLowerCase()} for ${input.occasion}${input.guests ? `, ${input.guests} guests` : ''}. Accept or decline within ${p.holdHours} hours — the date is held until then.`, link: '/partner/venue/requests', refType: 'event_enquiry', refId: e.id });
        }
        return { enquiry: e, booking, payUrl, holdUntil, estimate: priced.estimate, instant: p.instantBooking };
    }

    /**
     * Turn a hall request into a booking awaiting the advance: an accepted
     * quotation of exactly what was asked, the advance + balance plan, the
     * date still held, and a payment link for the advance.
     */
    static async bookRequest(ctx: Ctx, enquiryId: number, lines: SaleLineInput[] | null, holdUntil: Date) {
        const { PartnerEventsService } = await import('./partner-events.service');
        const { PartnerSalesService } = await import('./partner-sales.service');
        const { PartnerPayLinkService } = await import('./partner-pay-links.service');
        const e = await PartnerEventsService.enquiry(ctx.businessPartnerId, enquiryId);
        const sel = (e.selection ?? {}) as any;
        if (!lines) lines = (await this.price(ctx.businessPartnerId, { spaceId: sel.spaceId, date: e.eventDate!, slot: sel.slot, guests: e.guests, addons: (sel.items ?? []).filter((x: any) => x.kind === 'addon').map((x: any) => ({ packageId: x.packageId, quantity: x.quantity })) }).catch(() => null))?.lines ?? null;
        if (!lines) throw new HubError('This request can no longer be priced — the space or an add-on changed. Quote it from Enquiries instead.', 'REPRICE', 409);
        const p = await this.profile(ctx.businessPartnerId);
        const q = await PartnerSalesService.createQuotation(ctx as any, {
            customerId: e.customerId, lines, validUntil: e.eventDate!,
            notes: `${e.eventType} on ${e.eventDate}${e.guests ? `, ${e.guests} guests` : ''}. ${sel.space ?? ''}, ${String(sel.slotName ?? '').toLowerCase()} (${sel.slotTimes ?? ''}).${p.depositRupees ? ` A refundable security deposit of ₹${p.depositRupees.toLocaleString('en-IN')} is paid to the hall separately.` : ''}`,
            terms: `Advance ${p.advancePercent}% to confirm; balance ${p.balanceDueDays} days before the event. Cancellation: ${p.cancellation.map(t => `${t.daysBefore}+ days before — ${t.refundPercent}% refund`).join('; ')}.`,
            source: 'events', sourceRefId: e.id,
        });
        // The client chose and agreed to exactly this on the page.
        await db.update(partnerQuotations).set({ status: 'accepted', respondedAt: new Date(), publicToken: token(), updatedAt: new Date() }).where(eq(partnerQuotations.id, q.id));
        const due = addDays(e.eventDate!, -p.balanceDueDays) < istToday() ? istToday() : addDays(e.eventDate!, -p.balanceDueDays);
        const plan = p.advancePercent >= 100
            ? [{ label: 'Full payment to confirm', percent: 100, dueDate: istToday() }]
            : [{ label: `Advance (${p.advancePercent}%) to confirm`, percent: p.advancePercent, dueDate: istToday() }, { label: 'Balance before the event', percent: 100 - p.advancePercent, dueDate: due }];
        const { booking } = await PartnerEventsService.confirmBooking(ctx as any, q.id, { title: `${e.eventType} — ${sel.space ?? 'hall'}`, eventDate: e.eventDate!, venue: sel.space ?? null, guests: e.guests, milestones: plan });
        const listingPct = e.source !== 'hub' ? await ListingService.commissionPercent(ctx.businessPartnerId, 'venue') : null;
        await db.transaction(async (tx) => {
            await tx.update(eventBookings).set({
                kind: 'hall', origin: e.source, spaceId: sel.spaceId ?? null, slot: sel.slot ?? null, status: 'pending', holdExpiresAt: holdUntil,
                depositPaise: Math.round(p.depositRupees * 100), depositStatus: p.depositRupees > 0 ? 'due' : 'none', cancellationPolicy: p.cancellation as any,
                commissionPercent: listingPct != null ? String(listingPct) : null, updatedAt: new Date(),
            }).where(eq(eventBookings.id, booking.id));
            await BookingCalendar.attach(tx, e.id, booking.id, holdUntil);
        });
        const [first] = await db.select().from(eventMilestones).where(eq(eventMilestones.bookingId, booking.id)).orderBy(asc(eventMilestones.sortOrder)).limit(1);
        const link = await PartnerPayLinkService.create(ctx, { kind: 'milestone', refId: first.id });
        return { booking, payUrl: link.url, quotationId: q.id };
    }

    /** Confirm-first halls answer a request. */
    static async answer(ctx: Ctx, enquiryId: number, input: { decision: 'accept' | 'decline'; reason?: string | null }) {
        const { PartnerEventsService } = await import('./partner-events.service');
        const e = await PartnerEventsService.enquiry(ctx.businessPartnerId, enquiryId);
        if (e.kind !== 'hall') throw new HubError('This is not a hall request.', 'BAD_KIND', 409);
        if (e.status !== 'new' && e.status !== 'contacted') throw new HubError(`This request is already ${e.status}.`, 'BAD_STATE', 409);
        const held = await BookingCalendar.forEnquiry(e.id);
        if (input.decision === 'decline') {
            await db.transaction(async (tx) => {
                await BookingCalendar.release(tx, { enquiryId: e.id });
                await tx.update(eventEnquiries).set({ status: 'lost', lostReason: input.reason?.trim() || 'The hall could not take this booking', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
            });
            return { declined: true };
        }
        if (!held.length || held.some(h => h.status === 'hold' && h.holdExpiresAt && h.holdExpiresAt < new Date())) {
            // The hold lapsed — take the date again if it is still free.
            const sel = (e.selection ?? {}) as any;
            await db.transaction(async (tx) => {
                await BookingCalendar.release(tx, { enquiryId: e.id });
                await BookingCalendar.take(tx, { bpId: ctx.businessPartnerId, resourceKind: 'space', resourceId: sel.spaceId, days: [e.eventDate!], parts: partsOf(sel.slot), status: 'hold', holdExpiresAt: new Date(Date.now() + 3600_000), enquiryId: e.id });
            });
        }
        const p = await this.profile(ctx.businessPartnerId);
        return this.bookRequest(ctx, e.id, null, new Date(Date.now() + Math.max(24, p.holdHours) * 3600_000));
    }

    /** Requests waiting for a confirm-first hall's answer. */
    static async pendingRequests(bpId: number) {
        const rows = await db.select({ e: eventEnquiries, name: partnerCustomers.name, phone: partnerCustomers.phone }).from(eventEnquiries)
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, eventEnquiries.customerId))
            .where(and(eq(eventEnquiries.businessPartnerId, bpId), eq(eventEnquiries.kind, 'hall'), inArray(eventEnquiries.status, ['new', 'contacted']))).orderBy(asc(eventEnquiries.eventDate));
        const out = [];
        for (const r of rows) {
            const held = await BookingCalendar.forEnquiry(r.e.id);
            out.push({ id: r.e.id, name: r.name, phone: r.phone, occasion: r.e.eventType, date: r.e.eventDate, guests: r.e.guests, source: r.e.source, selection: r.e.selection, createdAt: r.e.createdAt, heldUntil: held[0]?.holdExpiresAt ?? null, held: held.length > 0 });
        }
        return out;
    }

    static amenityList() { return AMENITIES; }
}
