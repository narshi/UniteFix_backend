/**
 * Travel planner. Customers pick regions and places, the app shows an
 * optimised one-way or round-trip plan, and they send it for a quotation.
 * Staff assign a travel manager, who calls the customer and sends the
 * quotation by hand; the app shows each step.
 *
 * Regions, places and pickup points are staff-managed (Admin → Travel).
 */

import { randomBytes } from 'crypto';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { travelRegions, travelPlaces, travelPickups, travelTrips, travelTripMembers, travelPartners, travelTripQuotes, travelTripTeam, integrationSettings, adminUsers, adminRoleCapabilities, users, employees } from '@shared/schema';
import {
    planTrip, PLACE_KINDS, TRIP_STATUSES, TRIP_STATUS_LABEL, TRAVEL_PARTNER_KINDS, DEFAULT_TRAVEL_SETTINGS, advanceFor, suggestedVehicle,
    type PlanPlace, type TripPlan, type TripStatus, type TravelSettings,
} from '@shared/travel';
import { istToday, daysUntil, cancelByDate } from '@shared/travel';
import { TripLiveService, progressOf, followUrl } from './trip-live.service';
import { SYSTEM_ROLES } from '@shared/capabilities';
import { NotificationService } from './notification.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class TravelError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> => {
    const r = schema.safeParse(body);
    if (!r.success) {
        const i = r.error.issues[0];
        throw new TravelError(i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input');
    }
    return r.data;
};

const months = z.array(z.number().int().min(1).max(12)).max(12);
const phone = z.string().trim().transform(s => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^(\+?91)?[6-9]\d{9}$/, 'a 10-digit Indian mobile number'));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 2026-12-20');

const planInput = z.object({
    tripType: z.enum(['round_trip', 'one_way']).default('round_trip'),
    pace: z.enum(['relaxed', 'balanced', 'packed']).default('balanced'),
    pickupId: z.number().int().positive().nullish(),
    pickupText: z.string().trim().max(120).nullish(),
    dropId: z.number().int().positive().nullish(),
    dropText: z.string().trim().max(120).nullish(),
    placeIds: z.array(z.number().int().positive()).max(20).default([]),
    regionIds: z.array(z.number().int().positive()).max(20).default([]),
});

const tripInput = planInput.extend({
    placeIds: z.array(z.number().int().positive()).min(1, 'pick at least one place').max(20),
    adults: z.number().int().min(1).max(60),
    children: z.number().int().min(0).max(40).default(0),
    members: z.array(z.object({ name: z.string().trim().min(1).max(80), phone: phone.nullish().or(z.literal('').transform(() => null)) })).max(40).default([]),
    startDate: isoDate,
    stay: z.enum(['none', 'budget', 'standard', 'premium', 'homestay']).default('standard'),
    rooms: z.number().int().min(1).max(40).nullish(),
    needsCab: z.boolean().default(true),
    needsGuide: z.boolean().default(false),
    budgetPerPerson: z.number().int().min(0).max(1_000_000).nullish(),
    notes: z.string().trim().max(1000).nullish(),
    contactName: z.string().trim().min(1).max(80),
    contactPhone: phone,
});

const regionInput = z.object({
    name: z.string().trim().min(2).max(80),
    tagline: z.string().trim().max(160).nullish(),
    photoKey: z.string().trim().max(40).nullish(),
    photoUrl: z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)),
    bestMonths: months.default([]),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
});
const placeInput = z.object({
    regionId: z.number().int().positive().nullable(),
    name: z.string().trim().min(2).max(100),
    kind: z.enum(PLACE_KINDS).default('nature'),
    description: z.string().trim().max(400).nullish(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    visitMinutes: z.number().int().min(15).max(12 * 60).default(90),
    bestMonths: months.default([]),
    featured: z.boolean().default(false),
    photoUrl: z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
});
const pickupInput = z.object({
    name: z.string().trim().min(2).max(80),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    sortOrder: z.number().int().default(0),
    isActive: z.boolean().default(true),
});

const OPEN: TripStatus[] = ['new', 'assigned', 'contacted', 'quoted'];
const SETTINGS_KEY = 'travel';
const publicBase = () => (process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'https://unitefix-backend.onrender.com').replace(/\/$/, '');
const driverLink = (t: string) => `${publicBase()}/api/travel/driver/${t}`;
/** The driver's trip link (shared with a travel partner's Hub so they can forward it). */
export const driverLinkFor = driverLink;
/** Payment links are faked in tests and local runs (never in production), as for call bookings. */
const mockLinks = () => process.env.PAYMENT_LINKS_MOCK === '1' && process.env.NODE_ENV !== 'production';
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
/** The 4-digit code the traveller gives the driver at pickup. */
const pickupCode = () => String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
const hhmm = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time like 07:30');
const teamInput = z.object({
    role: z.enum(['driver', 'stay', 'guide', 'activity']),
    day: z.number().int().min(1).max(60).nullish(),
    source: z.enum(['own', 'partner']).default('partner'),
    employeeId: z.number().int().positive().nullish(),
    partnerId: z.number().int().positive().nullish(),
    name: z.string().trim().max(100).nullish(),
    phone: z.string().trim().max(20).nullish(),
    vehicle: z.string().trim().max(80).nullish(),
    plate: z.string().trim().max(20).nullish(),
    place: z.string().trim().max(200).nullish(),
    time: hhmm.nullish().or(z.literal('').transform(() => null)),
    docs: z.object({ licence: z.boolean().optional(), rc: z.boolean().optional(), photo: z.boolean().optional() }).default({}),
    docOverride: z.string().trim().max(300).nullish(),
    /** What UniteFix pays the partner for this assignment, rupees (paid through their statement when they have a Hub account). */
    partnerAmount: z.number().int().min(0).max(10_000_000).nullish(),
});

const partnerInput = z.object({
    name: z.string().trim().min(2).max(100),
    kinds: z.array(z.enum(TRAVEL_PARTNER_KINDS)).min(1, 'say what they provide').max(TRAVEL_PARTNER_KINDS.length),
    baseTown: z.string().trim().max(80).nullish(),
    regionIds: z.array(z.number().int().positive()).max(30).default([]),
    contactName: z.string().trim().max(80).nullish(),
    phone: phone.nullish().or(z.literal('').transform(() => null)),
    notes: z.string().trim().max(500).nullish(),
    isActive: z.boolean().default(true),
});
const quoteInput = z.object({
    source: z.enum(['own', 'partner']),
    partnerId: z.number().int().positive().nullish(),
    label: z.string().trim().max(100).nullish(),
    covers: z.string().trim().max(400).nullish(),
    amount: z.number().int().min(0).max(10_000_000).nullish(),
    status: z.enum(['asked', 'quoted', 'declined']).optional(),
    note: z.string().trim().max(400).nullish(),
});
const idList = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(n => Number.isInteger(n)) : []);

export class TravelService {
    // ── The app ─────────────────────────────────────────────────────────

    /** Active regions with their places, and the pickup points: what the planner offers. */
    static async catalog() {
        const regions = await db.select().from(travelRegions).where(eq(travelRegions.isActive, true)).orderBy(asc(travelRegions.sortOrder), asc(travelRegions.id));
        const places = await db.select().from(travelPlaces).where(eq(travelPlaces.isActive, true)).orderBy(asc(travelPlaces.sortOrder), asc(travelPlaces.id));
        const pickups = await db.select().from(travelPickups).where(eq(travelPickups.isActive, true)).orderBy(asc(travelPickups.sortOrder), asc(travelPickups.id));
        const month = new Date().getMonth() + 1;
        const live = new Set(regions.map(r => r.id));
        return {
            month,
            regions: regions.map(r => ({
                id: r.id, name: r.name, tagline: r.tagline, photoKey: r.photoKey, photoUrl: r.photoUrl,
                bestMonths: idList(r.bestMonths), inSeason: idList(r.bestMonths).includes(month),
                places: places.filter(p => p.regionId === r.id).map(p => this.placeView(p, month)),
            })).filter(r => r.places.length > 0),
            // Places without a region (or in a hidden one) still show, under "More places".
            otherPlaces: places.filter(p => p.regionId == null || !live.has(p.regionId)).map(p => this.placeView(p, month)),
            pickups: pickups.map(p => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
        };
    }

    private static placeView(p: typeof travelPlaces.$inferSelect, month: number) {
        const bm = idList(p.bestMonths);
        return {
            id: p.id, regionId: p.regionId, name: p.name, kind: p.kind, description: p.description,
            lat: p.lat, lng: p.lng, visitMinutes: p.visitMinutes, featured: p.featured, photoUrl: p.photoUrl,
            bestMonths: bm, inSeason: bm.length === 0 || bm.includes(month),
        };
    }

    /** The optimised plan for a set of places, one way or round. Pure calculation; nothing is saved. */
    static async plan(body: unknown): Promise<TripPlan> {
        const b = parse(planInput, body);
        return this.computePlan(b);
    }

    private static async computePlan(b: z.infer<typeof planInput>): Promise<TripPlan> {
        if (b.tripType === 'one_way' && !b.dropId && !b.dropText) throw new TravelError('Say where the trip ends.');
        const all = await db.select({ p: travelPlaces, regionName: travelRegions.name }).from(travelPlaces)
            .leftJoin(travelRegions, eq(travelRegions.id, travelPlaces.regionId))
            .where(eq(travelPlaces.isActive, true));
        const asPlan = (r: (typeof all)[number]): PlanPlace => ({
            id: r.p.id, name: r.p.name, lat: r.p.lat, lng: r.p.lng, visitMinutes: r.p.visitMinutes, regionId: r.p.regionId,
            regionName: r.regionName, featured: r.p.featured, bestMonths: idList(r.p.bestMonths), kind: r.p.kind,
        });
        const want = new Set(b.placeIds);
        const places = all.filter(r => want.has(r.p.id)).map(asPlan);
        if (places.length !== want.size) throw new TravelError('One of those places is no longer offered. Refresh and pick again.');
        // Suggestions come from the regions picked (or the places' regions).
        const regions = new Set([...b.regionIds, ...places.map(p => p.regionId).filter((x): x is number => x != null)]);
        const candidates = all.filter(r => r.p.regionId != null && regions.has(r.p.regionId)).map(asPlan);

        const point = async (id: number | null | undefined) => {
            if (!id) return null;
            const [p] = await db.select().from(travelPickups).where(eq(travelPickups.id, id)).limit(1);
            if (!p) throw new TravelError('That pickup point is no longer offered.');
            return { id: p.id, name: p.name, lat: p.lat, lng: p.lng };
        };
        const towns = (await db.select().from(travelPickups).where(eq(travelPickups.isActive, true)))
            .filter(t => !/airport/i.test(t.name)).map(t => ({ id: t.id, name: t.name, lat: t.lat, lng: t.lng }));
        return planTrip({
            places, candidates, towns, tripType: b.tripType, pace: b.pace,
            start: await point(b.pickupId), startName: b.pickupText ?? null,
            end: b.tripType === 'one_way' ? await point(b.dropId) : null, endName: b.dropText ?? null,
        });
    }

    static async createTrip(userId: number, body: unknown) {
        const b = parse(tripInput, body);
        if (!b.pickupId && !b.pickupText) throw new TravelError('Say where to pick you up.');
        const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
        if (b.startDate < today) throw new TravelError('The start date has passed. Pick a later date.');
        const plan = await this.computePlan(b);
        const names = async (id: number | null | undefined, text: string | null | undefined) => {
            if (!id) return text ?? null;
            const [p] = await db.select({ name: travelPickups.name }).from(travelPickups).where(eq(travelPickups.id, id)).limit(1);
            return p?.name ?? text ?? null;
        };
        const pickupText = await names(b.pickupId, b.pickupText);
        const dropText = b.tripType === 'round_trip' ? pickupText : await names(b.dropId, b.dropText);

        let trip: typeof travelTrips.$inferSelect | undefined;
        for (let attempt = 0; attempt < 5 && !trip; attempt++) {
            const code = 'TR-' + randomBytes(5).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, '7');
            try {
                [trip] = await db.insert(travelTrips).values({
                    code, customerUserId: userId, contactName: b.contactName, contactPhone: b.contactPhone.slice(-10),
                    adults: b.adults, children: b.children, tripType: b.tripType,
                    pickupId: b.pickupId ?? null, pickupText, dropId: b.tripType === 'one_way' ? b.dropId ?? null : b.pickupId ?? null, dropText,
                    regionIds: b.regionIds, placeIds: plan.order, plan, pace: b.pace, startDate: b.startDate, days: plan.days.length,
                    stay: b.stay, rooms: b.stay === 'none' ? null : b.rooms ?? null, needsCab: b.needsCab, needsGuide: b.needsGuide,
                    budgetPerPerson: b.budgetPerPerson ?? null, notes: b.notes ?? null,
                }).returning();
            } catch (e: any) {
                if (e?.code !== '23505') throw e;
            }
        }
        if (!trip) throw new TravelError('Could not save the trip. Try again.', 500);
        if (b.members.length) {
            await db.insert(travelTripMembers).values(b.members.map(m => ({ tripId: trip!.id, name: m.name, phone: m.phone ? m.phone.slice(-10) : null })));
        }
        logger.info(`[TRAVEL] Trip ${trip.code} sent by user #${userId}: ${plan.order.length} places, ${plan.days.length} days`);
        // The default travel manager takes every new trip, so the customer knows at once who will call.
        const m = (await this.settings()).defaultManager;
        if (m?.name && m.phone) {
            await db.update(travelTrips).set({ managerAdminId: m.adminId ?? null, managerName: m.name, managerPhone: m.phone, assignedAt: new Date(), status: 'assigned', updatedAt: new Date() })
                .where(eq(travelTrips.id, trip.id));
            void NotificationService.sendToUser(userId, 'Your travel manager will call you',
                `${m.name} is your travel manager for trip ${trip.code} and will call you soon with a quotation.`,
                'travel_trip', { tripId: trip.id, code: trip.code, url: 'unitefix://travel' }).catch(() => {});
        }
        void NotificationService.sendToAdmins('New trip request', `${trip.code}: ${b.adults + b.children} people, ${plan.days.length} days from ${pickupText ?? '?'}${m?.name ? `, with ${m.name}` : ''}.`, { tripId: trip.id }).catch(() => {});
        return {
            id: trip.id, code: trip.code,
            manager: m?.name && m.phone ? { name: m.name, phone: m.phone } : null,
            message: m?.name && m.phone
                ? `Your plan is sent. ${m.name}, your travel manager, will call you soon with a quotation.`
                : 'Your plan is sent. A travel manager will be assigned and will call you soon with a quotation.',
        };
    }

    static async myTrips(userId: number) {
        const rows = await db.select().from(travelTrips).where(eq(travelTrips.customerUserId, userId)).orderBy(desc(travelTrips.createdAt)).limit(50);
        const ids = rows.map(r => r.id);
        const members = ids.length ? await db.select().from(travelTripMembers).where(inArray(travelTripMembers.tripId, ids)) : [];
        const team = ids.length ? await db.select().from(travelTripTeam).where(inArray(travelTripTeam.tripId, ids)).orderBy(asc(travelTripTeam.day), asc(travelTripTeam.id)) : [];
        const cfg = await this.settings();
        return rows.map(t => this.customerView(t, members.filter(m => m.tripId === t.id), team.filter(m => m.tripId === t.id), cfg.cancelCutoffDays));
    }

    /** From 6 pm IST the evening before the trip: the pickup code and the team's phone numbers show. */
    static codeFrom(startDate: string | null) {
        return startDate ? new Date(Date.parse(`${startDate}T00:00:00+05:30`) - 6 * 3600_000) : null;
    }
    static teamVerified(m: typeof travelTripTeam.$inferSelect) {
        if (m.role !== 'driver' || m.source === 'own') return true;
        const d = (m.docs ?? {}) as { licence?: boolean; rc?: boolean; photo?: boolean };
        return !!(d.licence && d.rc && d.photo);
    }

    private static customerView(t: typeof travelTrips.$inferSelect, members: Array<typeof travelTripMembers.$inferSelect>, team: Array<typeof travelTripTeam.$inferSelect> = [], cutoff = DEFAULT_TRAVEL_SETTINGS.cancelCutoffDays) {
        const plan = t.plan as TripPlan | null;
        const status = (TRIP_STATUSES as readonly string[]).includes(t.status) ? t.status as TripStatus : 'new';
        const booked = status === 'confirmed' || status === 'started' || status === 'completed';
        const from = this.codeFrom(t.startDate);
        const evening = status === 'confirmed' && !!from && Date.now() >= from.getTime();
        const phones = evening || status === 'started';
        const tooLate = status === 'confirmed' && !!t.startDate && daysUntil(t.startDate) < cutoff;
        return {
            team: booked ? team.map(m => ({
                id: m.id, day: m.day, role: m.role, name: m.name, phone: phones ? m.phone : null, photoUrl: m.photoUrl,
                vehicle: m.vehicle, plate: m.plate, place: m.place, time: m.time, verified: this.teamVerified(m), ours: m.source === 'own',
            })) : [],
            startCode: evening ? t.startCode : null,
            startCodeFrom: status === 'confirmed' ? from : null,
            startedAt: t.startedAt, endedAt: t.endedAt,
            cancelBy: t.startDate && booked ? cancelByDate(t.startDate, cutoff) : null,
            cancelCutoffDays: cutoff,
            cancelBlocked: tooLate ? `Within ${cutoff} days of the trip it can't be cancelled in the app. Call ${t.managerName ?? 'your travel manager'} to change or cancel it.` : null,
            canEnd: status === 'started',
            safetyActive: status === 'confirmed' || status === 'started',
            progress: progressOf(t),
            tracking: { lastPingAt: t.lastPingAt, source: t.lastPingSource },
            familyUrl: t.familyToken && (status === 'confirmed' || status === 'started') ? followUrl(t.familyToken) : null,
            canRate: status === 'completed' && !t.ratedAt && team.length > 0,
            ratedAt: t.ratedAt,
            id: t.id, code: t.code, status, statusLabel: TRIP_STATUS_LABEL[status],
            tripType: t.tripType, from: t.pickupText, to: t.dropText, startDate: t.startDate, days: t.days,
            adults: t.adults, children: t.children, stay: t.stay, needsCab: t.needsCab, needsGuide: t.needsGuide,
            places: plan ? plan.days.flatMap(d => d.stops.filter(s => s.type === 'place').map(s => s.name)) : [],
            totalKm: plan?.totalKm ?? null,
            manager: t.managerName ? { name: t.managerName, phone: t.managerPhone } : null,
            quote: t.quoteAmount != null ? {
                amount: t.quoteAmount, note: t.quoteNote, at: t.quotedAt,
                validUntil: t.quoteValidUntil, expired: !!t.quoteValidUntil && t.quoteValidUntil.getTime() < Date.now() && t.advanceStatus !== 'paid',
                advancePercent: t.advancePercent ?? DEFAULT_TRAVEL_SETTINGS.advancePercent,
                advanceAmount: t.advanceAmount ?? advanceFor(t.quoteAmount, t.advancePercent ?? DEFAULT_TRAVEL_SETTINGS.advancePercent),
                balance: t.quoteAmount - (t.advanceAmount ?? advanceFor(t.quoteAmount, t.advancePercent ?? DEFAULT_TRAVEL_SETTINGS.advancePercent)),
            } : null,
            advance: { status: t.advanceStatus as 'none' | 'due' | 'paid', paidAt: t.advancePaidAt },
            canPay: status === 'quoted' && t.advanceStatus !== 'paid' && t.quoteAmount != null && (!t.quoteValidUntil || t.quoteValidUntil.getTime() > Date.now()),
            members: members.map(m => ({ name: m.name, phone: m.phone })),
            createdAt: t.createdAt,
            canCancel: OPEN.includes(status) || (status === 'confirmed' && !tooLate),
            cancelKeepsAdvance: t.advanceStatus === 'paid',
        };
    }

    static async cancelMine(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        if (!OPEN.includes(t.status as TripStatus) && t.status !== 'confirmed') throw new TravelError('This trip can no longer be cancelled here. Call your travel manager.');
        const cutoff = (await this.settings()).cancelCutoffDays;
        if (t.status === 'confirmed' && t.startDate && daysUntil(t.startDate) < cutoff) {
            throw new TravelError(`Within ${cutoff} days of the trip it can't be cancelled in the app. Call ${t.managerName ?? 'your travel manager'}${t.managerPhone ? ` on ${t.managerPhone}` : ''} to change or cancel it.`);
        }
        await db.update(travelTrips).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(travelTrips.id, t.id));
        if (t.paymentLinkId && t.paymentLinkStatus === 'created') await this.cancelLink(t.paymentLinkId);
        // The advance stays with the booking: the driver and hosts kept these dates.
        void NotificationService.sendToAdmins('Trip cancelled by the customer',
            `${t.code} was cancelled${t.advanceStatus === 'paid' ? `; the ${rupees(t.advanceAmount ?? 0)} advance is kept` : ''}. Tell the partners.`, { tripId: t.id }).catch(() => {});
    }

    // ── Staff: places ───────────────────────────────────────────────────

    static async adminCatalog() {
        const regions = await db.select().from(travelRegions).orderBy(asc(travelRegions.sortOrder), asc(travelRegions.id));
        const places = await db.select().from(travelPlaces).orderBy(asc(travelPlaces.sortOrder), asc(travelPlaces.id));
        const pickups = await db.select().from(travelPickups).orderBy(asc(travelPickups.sortOrder), asc(travelPickups.id));
        return { regions, places, pickups };
    }

    static async saveRegion(adminId: number, id: number | null, body: unknown) {
        const b = parse(id ? regionInput.partial() : regionInput, body);
        const [row] = id
            ? await db.update(travelRegions).set({ ...b, updatedAt: new Date() } as any).where(eq(travelRegions.id, id)).returning()
            : await db.insert(travelRegions).values(b as any).returning();
        if (!row) throw new TravelError('Region not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: row.id, action: id ? 'travel_region_updated' : 'travel_region_created', changedBy: adminId, metadata: { name: row.name } });
        return row;
    }
    static async deleteRegion(adminId: number, id: number) {
        const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(travelPlaces).where(eq(travelPlaces.regionId, id));
        if (used.n > 0) throw new TravelError('Move or delete its places first, or hide the region instead.');
        const [row] = await db.delete(travelRegions).where(eq(travelRegions.id, id)).returning();
        if (!row) throw new TravelError('Region not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: id, action: 'travel_region_deleted', changedBy: adminId, metadata: { name: row.name } });
    }

    static async savePlace(adminId: number, id: number | null, body: unknown) {
        const b = parse(id ? placeInput.partial() : placeInput, body);
        const [row] = id
            ? await db.update(travelPlaces).set({ ...b, updatedAt: new Date() } as any).where(eq(travelPlaces.id, id)).returning()
            : await db.insert(travelPlaces).values(b as any).returning();
        if (!row) throw new TravelError('Place not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: row.id, action: id ? 'travel_place_updated' : 'travel_place_created', changedBy: adminId, metadata: { name: row.name } });
        return row;
    }
    /** Sent trips keep their own copy of the plan, so a place can go without touching them. */
    static async deletePlace(adminId: number, id: number) {
        const [row] = await db.delete(travelPlaces).where(eq(travelPlaces.id, id)).returning();
        if (!row) throw new TravelError('Place not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: id, action: 'travel_place_deleted', changedBy: adminId, metadata: { name: row.name } });
    }

    static async savePickup(adminId: number, id: number | null, body: unknown) {
        const b = parse(id ? pickupInput.partial() : pickupInput, body);
        const [row] = id
            ? await db.update(travelPickups).set(b as any).where(eq(travelPickups.id, id)).returning()
            : await db.insert(travelPickups).values(b as any).returning();
        if (!row) throw new TravelError('Pickup point not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: row.id, action: id ? 'travel_pickup_updated' : 'travel_pickup_created', changedBy: adminId, metadata: { name: row.name } });
        return row;
    }
    static async deletePickup(adminId: number, id: number) {
        const [row] = await db.delete(travelPickups).where(eq(travelPickups.id, id)).returning();
        if (!row) throw new TravelError('Pickup point not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: id, action: 'travel_pickup_deleted', changedBy: adminId, metadata: { name: row.name } });
    }

    // ── Staff: trip requests ────────────────────────────────────────────

    static async trips(q: { status?: string; search?: string; mine?: number | null }) {
        const where = [];
        if (q.status === 'open') where.push(inArray(travelTrips.status, OPEN));
        else if (q.status && (TRIP_STATUSES as readonly string[]).includes(q.status)) where.push(eq(travelTrips.status, q.status));
        if (q.mine) where.push(eq(travelTrips.managerAdminId, q.mine));
        const s = q.search?.trim();
        if (s) where.push(or(ilike(travelTrips.code, `%${s}%`), ilike(travelTrips.contactName, `%${s}%`), ilike(travelTrips.contactPhone, `%${s}%`))!);
        const rows = await db.select().from(travelTrips).where(where.length ? and(...where) : undefined).orderBy(desc(travelTrips.createdAt)).limit(200);
        const ids = rows.map(r => r.id);
        const members = ids.length ? await db.select().from(travelTripMembers).where(inArray(travelTripMembers.tripId, ids)) : [];
        const quotes = ids.length ? await db.select().from(travelTripQuotes).where(inArray(travelTripQuotes.tripId, ids)).orderBy(asc(travelTripQuotes.id)) : [];
        const team = ids.length ? await db.select().from(travelTripTeam).where(inArray(travelTripTeam.tripId, ids)).orderBy(asc(travelTripTeam.day), asc(travelTripTeam.id)) : [];
        const money = await TripLiveService.money(ids);
        const [counts] = await db.select({
            new: sql<number>`count(*) filter (where status = 'new')::int`,
            open: sql<number>`count(*) filter (where status in ('new','assigned','contacted','quoted'))::int`,
        }).from(travelTrips);
        return {
            counts,
            trips: rows.map(t => {
                const plan = t.plan as TripPlan | null;
                const people = t.adults + t.children;
                return {
                    ...t, plan, people, vehicle: suggestedVehicle(people),
                    members: members.filter(m => m.tripId === t.id).map(m => ({ id: m.id, name: m.name, phone: m.phone, status: m.status })),
                    quotes: quotes.filter(q => q.tripId === t.id),
                    team: team.filter(m => m.tripId === t.id).map(m => ({ ...m, verified: this.teamVerified(m), driverLink: m.driverToken ? driverLink(m.driverToken) : null, accepted: !!m.acceptedAt })),
                    payouts: money.get(t.id)?.payouts ?? [], ratings: money.get(t.id)?.ratings ?? [],
                    money: TripLiveService.summary(t, money.get(t.id)?.payouts ?? []),
                    progress: progressOf(t), familyUrl: t.familyToken ? followUrl(t.familyToken) : null,
                };
            }),
        };
    }

    /** Staff who can take trips: super admins and anyone whose role holds the travel capability. */
    static async managers() {
        const rows = await db.select({ id: adminUsers.id, username: adminUsers.username, email: adminUsers.email, role: adminUsers.role, roleId: adminUsers.roleId })
            .from(adminUsers).where(and(eq(adminUsers.isActive, true), sql`${adminUsers.deletedAt} IS NULL`)).orderBy(asc(adminUsers.username));
        const roleIds = Array.from(new Set(rows.map(r => r.roleId).filter((x): x is number => x != null)));
        const travelRoles = roleIds.length
            ? new Set((await db.select({ roleId: adminRoleCapabilities.roleId }).from(adminRoleCapabilities)
                .where(and(inArray(adminRoleCapabilities.roleId, roleIds), inArray(adminRoleCapabilities.capability, ['travel:manage', 'travel:view'])))).map(r => r.roleId))
            : new Set<number>();
        return rows.filter(r => r.role === SYSTEM_ROLES.SUPER_ADMIN || (r.roleId != null && travelRoles.has(r.roleId)))
            .map(r => ({ id: r.id, name: r.username, email: r.email, role: r.role }));
    }

    static async assign(adminId: number, tripId: number, body: unknown) {
        const b = parse(z.object({
            managerAdminId: z.number().int().positive().nullish(),
            managerName: z.string().trim().min(2).max(80),
            managerPhone: phone,
        }), body);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        if (t.status === 'cancelled' || t.status === 'confirmed') throw new TravelError(`This trip is ${t.status}.`);
        if (b.managerAdminId) {
            const ok = (await this.managers()).some(m => m.id === b.managerAdminId);
            if (!ok) throw new TravelError('That staff member cannot take trips. Give their role the Travel area in Roles & Access.');
        }
        const [row] = await db.update(travelTrips).set({
            managerAdminId: b.managerAdminId ?? null, managerName: b.managerName, managerPhone: b.managerPhone.slice(-10),
            assignedAt: new Date(), status: t.status === 'new' ? 'assigned' : t.status, updatedAt: new Date(),
        }).where(eq(travelTrips.id, tripId)).returning();
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_trip_assigned', changedBy: adminId, fromState: t.status, toState: row.status, metadata: { code: t.code, manager: b.managerName } });
        if (t.customerUserId) {
            void NotificationService.sendToUser(t.customerUserId, 'Your travel manager is assigned',
                `${b.managerName} will call you soon about trip ${t.code}. You can also call them on ${b.managerPhone.slice(-10)}.`,
                'travel_trip', { tripId, code: t.code, url: 'unitefix://travel' }).catch(() => {});
        }
        return row;
    }

    /**
     * Staff update a trip. Entering a quotation amount sends it to the customer:
     * the price is held for the validity hours and booking takes the advance.
     */
    static async update(adminId: number, tripId: number, body: unknown) {
        const b = parse(z.object({
            status: z.enum(TRIP_STATUSES).optional(),
            quoteAmount: z.number().int().min(0).max(10_000_000).nullish(),
            quoteNote: z.string().trim().max(1000).nullish(),
            staffNote: z.string().trim().max(2000).nullish(),
            validHours: z.number().int().min(1).max(24 * 30).optional(),
            chosenQuoteId: z.number().int().positive().nullish(),
        }), body);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        const quoted = b.quoteAmount != null && b.quoteAmount !== t.quoteAmount;
        if (quoted && t.advanceStatus === 'paid') throw new TravelError('The advance is already paid on this price. Change it with the customer first.');
        let status = b.status ?? t.status;
        if (quoted && !b.status && OPEN.includes(t.status as TripStatus)) status = 'quoted';
        if (status !== 'new' && status !== 'cancelled' && !t.managerName) throw new TravelError('Assign a travel manager first.');
        const set: Record<string, unknown> = { status, updatedAt: new Date() };
        const cfg = await this.settings();
        if (b.quoteAmount !== undefined) {
            set.quoteAmount = b.quoteAmount;
            if (quoted) {
                set.quotedAt = new Date();
                set.quoteValidUntil = new Date(Date.now() + (b.validHours ?? cfg.quoteValidHours) * 3600_000);
                set.advancePercent = cfg.advancePercent;
                set.advanceAmount = advanceFor(b.quoteAmount!, cfg.advancePercent);
                set.advanceStatus = 'due';
                if (t.paymentLinkId && t.paymentLinkStatus === 'created') { await this.cancelLink(t.paymentLinkId); set.paymentLinkStatus = 'cancelled'; }
            }
        } else if (b.validHours && t.quoteAmount != null && t.advanceStatus !== 'paid') {
            set.quoteValidUntil = new Date(Date.now() + b.validHours * 3600_000);   // hold the same price longer
        }
        if (b.chosenQuoteId !== undefined) {
            if (b.chosenQuoteId) {
                const [q] = await db.select().from(travelTripQuotes).where(and(eq(travelTripQuotes.id, b.chosenQuoteId), eq(travelTripQuotes.tripId, tripId))).limit(1);
                if (!q) throw new TravelError('That supplier price is not on this trip.');
                set.chosenQuoteId = q.id; set.costAmount = q.amount;
            } else { set.chosenQuoteId = null; set.costAmount = null; }
        }
        if (b.quoteNote !== undefined) set.quoteNote = b.quoteNote;
        if (b.staffNote !== undefined) set.staffNote = b.staffNote;
        if (status === 'confirmed' && !t.startCode) set.startCode = pickupCode();   // booked by staff (advance taken another way)
        const [row] = await db.update(travelTrips).set(set as any).where(eq(travelTrips.id, tripId)).returning();
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_trip_updated', changedBy: adminId, fromState: t.status, toState: status, metadata: { code: t.code, quoteAmount: b.quoteAmount ?? undefined, costAmount: (set.costAmount as number | undefined) ?? undefined } });
        if (t.customerUserId) {
            const tell = (title: string, text: string) => void NotificationService.sendToUser(t.customerUserId!, title, text, 'travel_trip', { tripId, code: t.code, url: 'unitefix://travel' }).catch(() => {});
            if (quoted) {
                const hrs = b.validHours ?? cfg.quoteValidHours;
                tell('Your trip quotation is ready', `Trip ${t.code}: ${rupees(b.quoteAmount!)} for your group. Book with ${cfg.advancePercent}% (${rupees(advanceFor(b.quoteAmount!, cfg.advancePercent))}) — this price is held for ${hrs >= 24 ? `${Math.round(hrs / 24)} day${hrs >= 48 ? 's' : ''}` : `${hrs} hours`}.`);
            } else if (status === 'confirmed' && t.status !== 'confirmed') tell('Trip confirmed', `Trip ${t.code} is confirmed. Have a great journey!`);
            else if (status === 'cancelled' && t.status !== 'cancelled') tell('Trip cancelled', `Trip ${t.code} was cancelled. Call your travel manager if this is a mistake.`);
        }
        return row;
    }

    // ── Settings ────────────────────────────────────────────────────────

    static async settings(): Promise<TravelSettings> {
        const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, SETTINGS_KEY)).limit(1);
        const c = (row?.config ?? {}) as Partial<TravelSettings>;
        return {
            defaultManager: c.defaultManager?.name && c.defaultManager.phone ? c.defaultManager : null,
            advancePercent: Number.isInteger(c.advancePercent) ? c.advancePercent! : DEFAULT_TRAVEL_SETTINGS.advancePercent,
            quoteValidHours: Number.isInteger(c.quoteValidHours) ? c.quoteValidHours! : DEFAULT_TRAVEL_SETTINGS.quoteValidHours,
            cancelCutoffDays: Number.isInteger(c.cancelCutoffDays) ? c.cancelCutoffDays! : DEFAULT_TRAVEL_SETTINGS.cancelCutoffDays,
            safetyLead: c.safetyLead?.name && c.safetyLead.phone ? c.safetyLead : null,
        };
    }

    static async saveSettings(adminId: number, body: unknown) {
        const b = parse(z.object({
            defaultManager: z.object({ adminId: z.number().int().positive().nullish(), name: z.string().trim().min(2).max(80), phone }).nullable(),
            advancePercent: z.number().int().min(0).max(100),
            quoteValidHours: z.number().int().min(1).max(24 * 30),
            cancelCutoffDays: z.number().int().min(0).max(30).default(DEFAULT_TRAVEL_SETTINGS.cancelCutoffDays),
            safetyLead: z.object({ name: z.string().trim().min(2).max(80), phone, email: z.string().trim().email().max(120).nullish().or(z.literal('').transform(() => null)) }).nullable().default(null),
        }), body);
        if (b.defaultManager?.adminId && !(await this.managers()).some(m => m.id === b.defaultManager!.adminId)) {
            throw new TravelError('That staff member cannot take trips. Give their role the Travel area in Roles & Access.');
        }
        const config: TravelSettings = {
            defaultManager: b.defaultManager ? { adminId: b.defaultManager.adminId ?? null, name: b.defaultManager.name, phone: b.defaultManager.phone.slice(-10) } : null,
            advancePercent: b.advancePercent, quoteValidHours: b.quoteValidHours, cancelCutoffDays: b.cancelCutoffDays,
            safetyLead: b.safetyLead ? { name: b.safetyLead.name, phone: b.safetyLead.phone.slice(-10), email: b.safetyLead.email ?? null } : null,
        };
        await db.insert(integrationSettings).values({ key: SETTINGS_KEY, config, updatedBy: adminId } as any)
            .onConflictDoUpdate({ target: integrationSettings.key, set: { config, updatedBy: adminId, updatedAt: new Date() } as any });
        await recordAudit({ entityType: 'travel', entityId: 0, action: 'travel_settings_updated', changedBy: adminId, metadata: { defaultManager: config.defaultManager?.name ?? null, advancePercent: config.advancePercent, quoteValidHours: config.quoteValidHours } });
        return config;
    }

    // ── Travel partners ─────────────────────────────────────────────────

    /** With each partner's score: average rating and strikes in the last 6 months. Best first. */
    static async partners() {
        const rows = await db.select().from(travelPartners).orderBy(desc(travelPartners.isActive), asc(travelPartners.name));
        const sc = await TripLiveService.scores();
        const paid = rows.length ? await db.execute(sql`SELECT partner_id, COALESCE(SUM(amount),0)::int AS total, COUNT(DISTINCT trip_id)::int AS trips FROM travel_trip_payouts WHERE partner_id IS NOT NULL GROUP BY partner_id`) : { rows: [] };
        const paidBy = new Map(((paid as any).rows as Array<{ partner_id: number; total: number; trips: number }>).map(r => [r.partner_id, r]));
        return rows.map(p => ({ ...p, score: sc.partners[p.id] ?? null, paidTotal: paidBy.get(p.id)?.total ?? 0, paidTrips: paidBy.get(p.id)?.trips ?? 0 }))
            .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (b.score?.avg ?? 0) - (a.score?.avg ?? 0) || a.name.localeCompare(b.name));
    }
    static async savePartner(adminId: number, id: number | null, body: unknown) {
        const b = parse(id ? partnerInput.partial() : partnerInput, body);
        const v: Record<string, unknown> = { ...b };
        if (typeof b.phone === 'string') v.phone = b.phone.slice(-10);
        const [row] = id
            ? await db.update(travelPartners).set({ ...v, updatedAt: new Date() } as any).where(eq(travelPartners.id, id)).returning()
            : await db.insert(travelPartners).values(v as any).returning();
        if (!row) throw new TravelError('Travel partner not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: row.id, action: id ? 'travel_partner_updated' : 'travel_partner_created', changedBy: adminId, metadata: { name: row.name } });
        return row;
    }
    /** A partner with quotes on trips is hidden, not deleted, so the trips keep their history. */
    static async deletePartner(adminId: number, id: number) {
        const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(travelTripQuotes).where(eq(travelTripQuotes.partnerId, id));
        if (used.n > 0) {
            await db.update(travelPartners).set({ isActive: false, updatedAt: new Date() }).where(eq(travelPartners.id, id));
        } else {
            const [row] = await db.delete(travelPartners).where(eq(travelPartners.id, id)).returning();
            if (!row) throw new TravelError('Travel partner not found.', 404);
        }
        await recordAudit({ entityType: 'travel', entityId: id, action: used.n > 0 ? 'travel_partner_hidden' : 'travel_partner_deleted', changedBy: adminId });
    }

    // ── Supplier prices on a trip ───────────────────────────────────────

    static async addQuote(adminId: number, tripId: number, body: unknown) {
        const b = parse(quoteInput, body);
        const [t] = await db.select({ id: travelTrips.id }).from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        let label = b.label?.trim() || 'Our team (UniteFix experts)';
        if (b.source === 'partner') {
            if (!b.partnerId) throw new TravelError('Choose the travel partner.');
            const [p] = await db.select().from(travelPartners).where(eq(travelPartners.id, b.partnerId)).limit(1);
            if (!p) throw new TravelError('Travel partner not found.', 404);
            label = p.name;
        }
        const [row] = await db.insert(travelTripQuotes).values({
            tripId, source: b.source, partnerId: b.source === 'partner' ? b.partnerId! : null, label, covers: b.covers ?? null,
            amount: b.amount ?? null, status: b.status ?? (b.amount != null ? 'quoted' : 'asked'), note: b.note ?? null, createdBy: adminId,
        }).returning();
        if (row.status === 'asked' && row.partnerId) {
            const { TravelPartnerHub } = await import('./travel-partner.service');
            const bp = await TravelPartnerHub.bpOfCard(row.partnerId);
            if (bp) {
                const [trip] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
                const { HubAlerts } = await import('./hub-alerts.service');
                void HubAlerts.send(bp, 'travel_price_request', { title: `Price wanted for trip ${trip?.code ?? ''}`, body: `${(trip?.adults ?? 0) + (trip?.children ?? 0)} people, ${trip?.days ?? '?'} days from ${trip?.startDate ?? 'soon'}${b.covers ? `: ${b.covers}` : ''}. Send your price in the Hub.`, link: '/partner/travel', refType: 'travel_quote', refId: row.id }).catch(() => null);
            }
        }
        return row;
    }
    static async updateQuote(adminId: number, tripId: number, quoteId: number, body: unknown) {
        const b = parse(quoteInput.partial(), body);
        const set: Record<string, unknown> = { updatedAt: new Date() };
        for (const k of ['covers', 'amount', 'note', 'status'] as const) if (b[k] !== undefined) set[k] = b[k];
        if (b.amount != null && !b.status) set.status = 'quoted';
        const [row] = await db.update(travelTripQuotes).set(set as any).where(and(eq(travelTripQuotes.id, quoteId), eq(travelTripQuotes.tripId, tripId))).returning();
        if (!row) throw new TravelError('Supplier price not found.', 404);
        void adminId;
        return row;
    }
    static async deleteQuote(tripId: number, quoteId: number) {
        await db.update(travelTrips).set({ chosenQuoteId: null, costAmount: null }).where(and(eq(travelTrips.id, tripId), eq(travelTrips.chosenQuoteId, quoteId)));
        const [row] = await db.delete(travelTripQuotes).where(and(eq(travelTripQuotes.id, quoteId), eq(travelTripQuotes.tripId, tripId))).returning();
        if (!row) throw new TravelError('Supplier price not found.', 404);
    }

    // ── The advance ─────────────────────────────────────────────────────

    /** A payment link for the advance on the customer's quotation (reused while it is still open). */
    static async startAdvance(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        if (t.advanceStatus === 'paid') throw new TravelError('The advance is already paid. Your trip is booked.');
        if (t.status !== 'quoted' || t.quoteAmount == null) throw new TravelError('There is no quotation to book yet. Your travel manager will send one.');
        const left = t.quoteValidUntil ? t.quoteValidUntil.getTime() - Date.now() : 48 * 3600_000;
        if (left < 20 * 60_000) throw new TravelError('This price is no longer held. Ask your travel manager to renew it.');
        const amount = t.advanceAmount ?? advanceFor(t.quoteAmount, t.advancePercent ?? DEFAULT_TRAVEL_SETTINGS.advancePercent);
        if (amount < 1) throw new TravelError('This quotation has no advance to pay. Your travel manager will confirm it.');
        if (t.paymentLinkId && t.paymentLinkStatus === 'created' && t.paymentLinkUrl) return { url: t.paymentLinkUrl, amount };
        const expiresAt = new Date(Date.now() + left);
        let link: { id: string; url: string };
        if (mockLinks()) link = { id: `plink_test_trip_${t.id}_${Date.now().toString(36)}`, url: `https://rzp.io/i/test-${t.code}` };
        else {
            const { PaymentService } = await import('./payment.service');
            const rp: any = await PaymentService.client();
            const l = await rp.paymentLink.create({
                amount: Math.round(amount * 100), currency: 'INR', accept_partial: false,
                description: `UniteFix trip ${t.code}: ${t.advancePercent ?? DEFAULT_TRAVEL_SETTINGS.advancePercent}% advance (not refundable)`,
                reference_id: `${t.code}-${Date.now().toString(36)}`,
                customer: { name: t.contactName || 'Customer', contact: `+91${t.contactPhone}` },
                notify: { sms: false, email: false }, reminder_enable: false,
                expire_by: Math.floor(expiresAt.getTime() / 1000),
                notes: { travel_trip_id: String(t.id), payment_type: 'travel_advance', trip_code: t.code },
            });
            link = { id: l.id, url: l.short_url };
        }
        await db.update(travelTrips).set({ paymentLinkId: link.id, paymentLinkUrl: link.url, paymentLinkStatus: 'created', updatedAt: new Date() }).where(eq(travelTrips.id, t.id));
        return { url: link.url, amount };
    }

    /**
     * The advance arrived (webhook payment_link.paid, or payment.captured as a
     * backup; whichever comes first). The trip is booked; a second delivery is a no-op.
     */
    static async advancePaid(tripId: number, p: { paymentId: string; amountPaise: number; linkId?: string | null }) {
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) return { handled: false };
        const closed = t.status === 'cancelled';
        const [u] = await db.update(travelTrips).set({
            advanceStatus: 'paid', advancePaidAt: new Date(), advancePaymentId: p.paymentId, paymentLinkStatus: 'paid',
            ...(closed ? {} : { status: 'confirmed', startCode: t.startCode ?? pickupCode() }), updatedAt: new Date(),
        }).where(and(eq(travelTrips.id, tripId), sql`${travelTrips.advanceStatus} IS DISTINCT FROM 'paid'`)).returning({ id: travelTrips.id });
        if (!u) return { handled: true, repeat: true };
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_advance_paid', fromState: t.status, toState: closed ? t.status : 'confirmed', metadata: { code: t.code, paymentId: p.paymentId, amountPaise: p.amountPaise, linkId: p.linkId ?? null } });
        if (closed) {
            void NotificationService.sendToAdmins('Advance paid on a cancelled trip', `${t.code} was paid after it was cancelled. Call the customer: rebook or refund.`, { tripId }).catch(() => {});
            return { handled: true, closed: true };
        }
        if (t.customerUserId) {
            void NotificationService.sendToUser(t.customerUserId, 'Your trip is booked!',
                `Trip ${t.code}: ${rupees(Math.round(p.amountPaise / 100))} advance received. ${t.managerName ?? 'Your travel manager'} will share the driver and stay details before you leave.`,
                'travel_trip', { tripId, code: t.code, url: 'unitefix://travel' }).catch(() => {});
        }
        void NotificationService.sendToAdmins('Trip booked', `${t.code}: advance ${rupees(Math.round(p.amountPaise / 100))} paid. Confirm the partners.`, { tripId }).catch(() => {});
        return { handled: true };
    }

    /** Webhook payment_link.paid for a trip advance; false when the link is not a trip's. */
    static async linkPaid(payload: any) {
        const link = payload?.payment_link?.entity, pay = payload?.payment?.entity;
        const tripId = Number(link?.notes?.travel_trip_id);
        if (!Number.isInteger(tripId) || !pay?.id) return { handled: false };
        return this.advancePaid(tripId, { paymentId: pay.id, amountPaise: pay.amount, linkId: link?.id });
    }
    static async linkEnded(payload: any, status: 'expired' | 'cancelled') {
        const id = payload?.payment_link?.entity?.id;
        if (!id) return;
        await db.update(travelTrips).set({ paymentLinkStatus: status }).where(and(eq(travelTrips.paymentLinkId, id), eq(travelTrips.paymentLinkStatus, 'created')));
    }
    private static async cancelLink(id: string) {
        if (mockLinks() || id.startsWith('plink_test_')) return;
        try { const { PaymentService } = await import('./payment.service'); const rp: any = await PaymentService.client(); await rp.paymentLink.cancel(id); }
        catch (e: any) { logger.warn(`[TRAVEL] Could not cancel payment link ${id}: ${e?.message}`); }
    }

    // ── The trip team ───────────────────────────────────────────────────

    /** Our own verified, active service experts, to put on a trip. */
    static async experts() {
        const sc = await TripLiveService.scores();
        const rows = await db.select({ id: employees.id, name: employees.fullName, phone: users.phone, photo: users.profilePicture })
            .from(employees).innerJoin(users, eq(users.id, employees.userId))
            .where(and(eq(employees.isActive, true), eq(employees.documentVerificationStatus, 'verified' as any), sql`${employees.managedByPartnerId} IS NULL`))
            .orderBy(asc(employees.fullName)).limit(500);
        return rows.map(e => ({ ...e, score: sc.experts[e.id] ?? null }));
    }

    static async saveTeam(adminId: number, tripId: number, memberId: number | null, body: unknown) {
        const b = parse(memberId ? teamInput.partial() : teamInput, body);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        const prev = memberId ? (await db.select().from(travelTripTeam).where(and(eq(travelTripTeam.id, memberId), eq(travelTripTeam.tripId, tripId))).limit(1))[0] : null;
        if (memberId && !prev) throw new TravelError('Not found.', 404);
        const m = { ...(prev ?? {}), ...b } as any;
        let hubBp: number | null = null;
        if (m.source === 'own') {
            if (!m.employeeId) throw new TravelError('Choose which of our experts.');
            const [e] = await db.select({ name: employees.fullName, active: employees.isActive, status: employees.documentVerificationStatus, phone: users.phone, photo: users.profilePicture })
                .from(employees).innerJoin(users, eq(users.id, employees.userId)).where(eq(employees.id, m.employeeId)).limit(1);
            if (!e) throw new TravelError('Expert not found.', 404);
            if (!e.active || e.status !== 'verified') throw new TravelError(`${e.name} is not active and verified, so they cannot be put on a trip.`);
            m.name = e.name; m.phone = String(e.phone ?? '').slice(-10) || null; m.photoUrl = e.photo ?? null; m.partnerId = null;
        } else {
            // A partner with a Hub account accepts in the Hub and puts their own checked driver and vehicle on it.
            const { TravelPartnerHub } = await import('./travel-partner.service');
            hubBp = m.partnerId ? await TravelPartnerHub.bpOfCard(m.partnerId) : null;
            if (hubBp && !m.name?.trim()) {
                const [card] = await db.select({ name: travelPartners.name }).from(travelPartners).where(eq(travelPartners.id, m.partnerId)).limit(1);
                m.name = `${card?.name ?? 'Partner'} (to confirm)`;
            }
            if (!m.name?.trim()) throw new TravelError('Who is it? Add their name.');
            m.employeeId = null;
            if (m.phone) {
                const p = String(m.phone).replace(/\D/g, '').slice(-10);
                if (!/^[6-9]\d{9}$/.test(p)) throw new TravelError('Phone must be a 10-digit Indian mobile number.');
                m.phone = p;
                const { SafetyService } = await import('./safety.service');
                const flag = await SafetyService.phoneFlag(p);
                if (flag) throw new TravelError(`This person has a safety case (${flag}) and cannot be put on a trip until it is closed.`);
            }
            if (m.role === 'driver' && !(hubBp && !m.fleetDriverId && !b.name)) {
                const d = m.docs ?? {};
                if (!(d.licence && d.rc && d.photo) && !(m.docOverride && m.docOverride.trim().length >= 5)) {
                    throw new TravelError("A partner's driver needs licence, RC and photo checked. If you assign them anyway, write why.");
                }
                if (!m.phone) throw new TravelError("Add the driver's mobile number: the traveller and the safety desk need it.");
            }
        }
        const values = {
            tripId, day: m.day ?? null, role: m.role, source: m.source, employeeId: m.employeeId ?? null, partnerId: m.partnerId ?? null,
            name: String(m.name).trim(), phone: m.phone ?? null, photoUrl: m.photoUrl ?? null, vehicle: m.vehicle ?? null,
            plate: m.plate ? String(m.plate).toUpperCase() : null, place: m.place ?? null, time: m.time ?? null, docs: m.docs ?? {}, docOverride: m.docOverride ?? null,
            driverToken: m.role === 'driver' ? (prev?.driverToken ?? randomBytes(16).toString('base64url')) : null, updatedAt: new Date(),
            partnerAmount: m.partnerAmount ?? null,
            // Offered to a Hub partner until they accept; a new partner on the row is a new offer.
            ...(hubBp && (!prev || prev.partnerId !== m.partnerId) ? { partnerStatus: 'offered', partnerRespondedAt: null, partnerDeclineReason: null, fleetDriverId: null, fleetVehicleId: null } : {}),
            ...(!hubBp ? { partnerStatus: null } : {}),
        };
        const [row] = memberId
            ? await db.update(travelTripTeam).set(values as any).where(eq(travelTripTeam.id, memberId)).returning()
            : await db.insert(travelTripTeam).values({ ...values, createdBy: adminId } as any).returning();
        if (hubBp && row.partnerStatus === 'offered' && (!prev || prev.partnerId !== row.partnerId)) {
            const { HubAlerts } = await import('./hub-alerts.service');
            const what = { driver: 'cab', stay: 'stay', guide: 'guide', activity: 'activity' }[row.role as string] ?? row.role;
            void HubAlerts.send(hubBp, 'travel_assignment', { title: `New ${what} for trip ${t.code}`, body: `${t.adults + t.children} people from ${t.startDate ?? 'soon'}${row.day ? `, day ${row.day}` : ''}${row.partnerAmount ? `, ₹${row.partnerAmount.toLocaleString('en-IN')}` : ''}. Accept it in your Hub.`, link: '/partner/travel', refType: 'travel_team', refId: row.id }).catch(() => null);
        }
        await recordAudit({ entityType: 'travel', entityId: tripId, action: memberId ? 'travel_team_updated' : 'travel_team_added', changedBy: adminId, metadata: { code: t.code, role: row.role, name: row.name, verified: this.teamVerified(row), override: row.docOverride ?? null } });
        return { ...row, verified: this.teamVerified(row), driverLink: row.driverToken ? driverLink(row.driverToken) : null };
    }
    static async deleteTeam(adminId: number, tripId: number, memberId: number) {
        const [row] = await db.delete(travelTripTeam).where(and(eq(travelTripTeam.id, memberId), eq(travelTripTeam.tripId, tripId))).returning();
        if (!row) throw new TravelError('Not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_team_removed', changedBy: adminId, metadata: { name: row.name, role: row.role } });
    }

    // ── Trip day: start with the pickup code, end ───────────────────────

    private static async begin(t: typeof travelTrips.$inferSelect, by: string) {
        if (t.status === 'started') return t;
        if (t.status !== 'confirmed') throw new TravelError(t.status === 'completed' ? 'This trip is already finished.' : 'This trip is not booked yet.');
        if (t.startDate && daysUntil(t.startDate) > 0) throw new TravelError(`The trip starts on ${t.startDate}. Enter the code at pickup.`);
        const [row] = await db.update(travelTrips).set({ status: 'started', startedAt: new Date(), updatedAt: new Date() }).where(eq(travelTrips.id, t.id)).returning();
        await recordAudit({ entityType: 'travel', entityId: t.id, action: 'travel_trip_started', fromState: 'confirmed', toState: 'started', metadata: { code: t.code, by } });
        if (t.customerUserId) void NotificationService.sendToUser(t.customerUserId, 'Your trip has started', `Have a great trip! The Safety shield and Help are on your trip screen if you need anything.`, 'travel_trip', { tripId: t.id, url: 'unitefix://travel' }).catch(() => {});
        return row;
    }
    private static async finish(t: typeof travelTrips.$inferSelect, by: string) {
        if (t.status === 'completed') return t;
        if (t.status !== 'started') throw new TravelError('The trip has not started.');
        const [row] = await db.update(travelTrips).set({ status: 'completed', endedAt: new Date(), updatedAt: new Date() }).where(eq(travelTrips.id, t.id)).returning();
        await recordAudit({ entityType: 'travel', entityId: t.id, action: 'travel_trip_completed', fromState: 'started', toState: 'completed', metadata: { code: t.code, by } });
        void TripLiveService.askForRating(t.id);
        void import('./travel-partner.service').then(m => m.TravelPartnerHub.postEarnings(t.id)).catch(e => logger.error(`[TRAVEL] partner earnings for ${t.code}: ${e?.message}`));
        return row;
    }

    private static async byDriverToken(token: string) {
        const [m] = await db.select().from(travelTripTeam).where(eq(travelTripTeam.driverToken, token)).limit(1);
        if (!m) throw new TravelError('This link is not valid. Ask the travel manager for a new one.', 404);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, m.tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        return { m, t };
    }
    /** The driver enters the code the traveller shows: proof the right car came. */
    static async driverStart(token: string, body: unknown) {
        const b = parse(z.object({ code: z.string().trim().regex(/^\d{4}$/, 'the 4-digit code') }), body);
        const { m, t } = await this.byDriverToken(token);
        if (!t.startCode || b.code !== t.startCode) throw new TravelError('That code does not match this trip. Ask the traveller to read it again from their app.');
        await this.begin(t, `driver ${m.name}`);
        return { message: 'Trip started. Drive safe!' };
    }
    static async driverEnd(token: string) {
        const { m, t } = await this.byDriverToken(token);
        await this.finish(t, `driver ${m.name}`);
        return { message: 'Trip finished. Thank you!' };
    }
    static async staffStart(adminId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        await this.begin(t, `staff #${adminId}`);
    }
    static async staffEnd(adminId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        await this.finish(t, `staff #${adminId}`);
    }
    static async endMine(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        await this.finish(t, 'traveller');
    }

    /** The driver's page: no app, no login; the link is the key. */
    static async driverPage(token: string): Promise<string> {
        const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
        const shell = (inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UniteFix trip</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#F5F7FA;color:#14243B}main{max-width:480px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0}.box{background:#fff;border:1px solid #E6EAF0;border-radius:14px;padding:16px;margin-top:14px}.muted{color:#687588;font-size:14px}input{font-size:28px;letter-spacing:10px;text-align:center;width:100%;box-sizing:border-box;padding:12px;border:2px solid #09264A;border-radius:12px}button{width:100%;margin-top:12px;padding:14px;border:0;border-radius:999px;background:#FF8A00;color:#fff;font-weight:700;font-size:16px}button.alt{background:#09264A}#msg{margin-top:10px;font-weight:600}</style></head><body><main>${inner}</main></body></html>`;
        let ctx: { m: typeof travelTripTeam.$inferSelect; t: typeof travelTrips.$inferSelect };
        try { ctx = await this.byDriverToken(token); } catch { return shell('<h1>This link is not valid</h1><p class="muted">Ask the UniteFix travel manager for a new one.</p>'); }
        const { m, t } = ctx;
        const first = (t.contactName ?? '').split(' ')[0];
        const head = `<h1>Trip ${esc(t.code)}</h1><p class="muted">Driver: ${esc(m.name)}${m.plate ? ` · ${esc(m.plate)}` : ''}</p>
          <div class="box"><b>Pickup:</b> ${esc(t.pickupText)}<br><b>Date:</b> ${esc(t.startDate)}${m.time ? ` at ${esc(m.time)}` : ''}<br><b>Travellers:</b> ${esc(first)} + ${t.adults + t.children - 1}<br><b>Travel manager:</b> ${esc(t.managerName)} ${esc(t.managerPhone)}</div>`;
        const post = (path: string, withCode: boolean) => `<script>async function go(){var b=document.getElementById('b');b.disabled=true;var r=await fetch('${driverLink(token).replace(publicBase(), '')}/${path}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${withCode ? "{code:document.getElementById('c').value}" : '{}'})});var j=await r.json().catch(function(){return{}});document.getElementById('msg').textContent=j.message||'Something went wrong.';b.disabled=false;if(r.ok)setTimeout(function(){location.reload()},1200)}</script>`;
        const base = driverLink(token).replace(publicBase(), '');
        // Accept the trip (Phase 3), and share location while the page is open on a trip (Phase 2).
        const accept = m.acceptedAt
            ? `<div class="box" style="border-color:#A7F3D0;background:#ECFBF3"><b>You accepted this trip.</b></div>`
            : `<div class="box"><b>Can you do this trip?</b><button id="acc" class="alt" onclick="accept()">Accept the trip</button><div id="accmsg"></div></div><script>async function accept(){var b=document.getElementById('acc');b.disabled=true;var r=await fetch('${base}/accept',{method:'POST'});var j=await r.json().catch(function(){return{}});document.getElementById('accmsg').textContent=j.message||'Something went wrong.';if(r.ok)setTimeout(function(){location.reload()},1200);else b.disabled=false}</script>`;
        const share = `<div class="box"><b>Share your location while driving</b><p class="muted">Keep this page open. The travel manager and the traveller's family see where the trip is. It stops when the trip ends.</p><button id="sh" class="alt" onclick="share()">Start sharing</button><div id="shmsg" class="muted"></div></div><script>var last=0,watching=null;function send(p){var now=Date.now();if(now-last<60000)return;last=now;fetch('${base}/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,speed:p.coords.speed})}).then(function(r){return r.json()}).then(function(j){document.getElementById('shmsg').textContent=j.data&&j.data.tracking?'Shared at '+new Date().toLocaleTimeString():'The trip is not on, so nothing is shared.'}).catch(function(){})}function share(){if(!navigator.geolocation){document.getElementById('shmsg').textContent='This phone cannot share location from the browser.';return}if(watching!==null)return;watching=navigator.geolocation.watchPosition(send,function(e){document.getElementById('shmsg').textContent='Location is blocked: allow it for this page.'},{enableHighAccuracy:true,maximumAge:30000});document.getElementById('sh').textContent='Sharing…';document.getElementById('sh').disabled=true}</script>`;
        if (t.status === 'confirmed') return shell(`${head}${accept}<div class="box"><b>At pickup, ask the traveller for the 4-digit code in their UniteFix app.</b><input id="c" inputmode="numeric" maxlength="4" autocomplete="one-time-code" aria-label="Pickup code"><button id="b" onclick="go()">Start the trip</button><div id="msg"></div></div>${post('start', true)}`);
        if (t.status === 'started') return shell(`${head}${share}<div class="box"><b>Trip in progress.</b> Drive safe. When you drop everyone at the end, press below.<button id="b" class="alt" onclick="go()">Trip finished</button><div id="msg"></div></div>${post('end', false)}`);
        return shell(`${head}<div class="box">${t.status === 'completed' ? 'This trip is finished. Thank you!' : 'This trip is not active.'}</div>`);
    }

    // ── Every 15 minutes: the evening-before reminder and the late-driver alert ──

    static async tripDayJobs(now = Date.now()) {
        const ist = new Date(now + 330 * 60_000);
        const today = istToday(now);
        const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        let reminded = 0, late = 0;
        if (ist.getUTCHours() >= 18) {
            const due = await db.select().from(travelTrips).where(and(eq(travelTrips.status, 'confirmed'), eq(travelTrips.startDate, tomorrow), sql`${travelTrips.reminderSentAt} IS NULL`)).limit(100);
            for (const t of due) {
                const team = await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, t.id));
                const d = team.find(m => m.role === 'driver' && (m.day == null || m.day === 1));
                const text = d
                    ? `Tomorrow ${d.time ? `at ${d.time} ` : ''}${d.name} picks you up${d.vehicle ? ` in a ${d.vehicle}` : ''}${d.plate ? ` (${d.plate})` : ''}. Your pickup code is ${t.startCode}: give it to the driver.`
                    : `Your trip starts tomorrow. Your pickup code is ${t.startCode}. ${t.managerName ?? 'Your travel manager'} will share the driver's details.`;
                await db.update(travelTrips).set({ reminderSentAt: new Date() }).where(eq(travelTrips.id, t.id));
                if (t.customerUserId) void NotificationService.sendToUser(t.customerUserId, 'Your trip is tomorrow', text, 'travel_trip', { tripId: t.id, url: 'unitefix://travel' }).catch(() => {});
                reminded++;
            }
        }
        const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        const todays = await db.select().from(travelTrips).where(and(eq(travelTrips.status, 'confirmed'), eq(travelTrips.startDate, today), sql`${travelTrips.lateAlertAt} IS NULL`)).limit(200);
        for (const t of todays) {
            const team = await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, t.id));
            const d = team.find(m => m.role === 'driver' && (m.day == null || m.day === 1) && m.time);
            if (!d?.time) continue;
            const [h, mm] = d.time.split(':').map(Number);
            if (nowMin < h * 60 + mm + 15) continue;
            await db.update(travelTrips).set({ lateAlertAt: new Date() }).where(eq(travelTrips.id, t.id));
            const { SafetyService } = await import('./safety.service');
            await SafetyService.systemAlert(t.id, 'driver_late', `Pickup was at ${d.time} and the trip has not started. Call ${d.name}${d.phone ? ` (${d.phone})` : ''} and the traveller (${t.contactPhone}).`);
            late++;
        }
        return { reminded, late };
    }

    static async customerName(userId: number) {
        const [u] = await db.select({ name: users.username, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
        return u ?? null;
    }
}
