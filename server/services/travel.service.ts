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
import { travelRegions, travelPlaces, travelPickups, travelTrips, travelTripMembers, travelPartners, travelTripQuotes, integrationSettings, adminUsers, adminRoleCapabilities, users } from '@shared/schema';
import {
    planTrip, PLACE_KINDS, TRIP_STATUSES, TRIP_STATUS_LABEL, TRAVEL_PARTNER_KINDS, DEFAULT_TRAVEL_SETTINGS, advanceFor, suggestedVehicle,
    type PlanPlace, type TripPlan, type TripStatus, type TravelSettings,
} from '@shared/travel';
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
/** Payment links are faked in tests and local runs (never in production), as for call bookings. */
const mockLinks = () => process.env.PAYMENT_LINKS_MOCK === '1' && process.env.NODE_ENV !== 'production';
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

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
        return rows.map(t => this.customerView(t, members.filter(m => m.tripId === t.id)));
    }

    private static customerView(t: typeof travelTrips.$inferSelect, members: Array<typeof travelTripMembers.$inferSelect>) {
        const plan = t.plan as TripPlan | null;
        const status = (TRIP_STATUSES as readonly string[]).includes(t.status) ? t.status as TripStatus : 'new';
        return {
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
            canCancel: OPEN.includes(status) || status === 'confirmed',
            cancelKeepsAdvance: t.advanceStatus === 'paid',
        };
    }

    static async cancelMine(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        if (!OPEN.includes(t.status as TripStatus) && t.status !== 'confirmed') throw new TravelError('This trip can no longer be cancelled here. Call your travel manager.');
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
        };
    }

    static async saveSettings(adminId: number, body: unknown) {
        const b = parse(z.object({
            defaultManager: z.object({ adminId: z.number().int().positive().nullish(), name: z.string().trim().min(2).max(80), phone }).nullable(),
            advancePercent: z.number().int().min(0).max(100),
            quoteValidHours: z.number().int().min(1).max(24 * 30),
        }), body);
        if (b.defaultManager?.adminId && !(await this.managers()).some(m => m.id === b.defaultManager!.adminId)) {
            throw new TravelError('That staff member cannot take trips. Give their role the Travel area in Roles & Access.');
        }
        const config: TravelSettings = {
            defaultManager: b.defaultManager ? { adminId: b.defaultManager.adminId ?? null, name: b.defaultManager.name, phone: b.defaultManager.phone.slice(-10) } : null,
            advancePercent: b.advancePercent, quoteValidHours: b.quoteValidHours,
        };
        await db.insert(integrationSettings).values({ key: SETTINGS_KEY, config, updatedBy: adminId } as any)
            .onConflictDoUpdate({ target: integrationSettings.key, set: { config, updatedBy: adminId, updatedAt: new Date() } as any });
        await recordAudit({ entityType: 'travel', entityId: 0, action: 'travel_settings_updated', changedBy: adminId, metadata: { defaultManager: config.defaultManager?.name ?? null, advancePercent: config.advancePercent, quoteValidHours: config.quoteValidHours } });
        return config;
    }

    // ── Travel partners ─────────────────────────────────────────────────

    static async partners() {
        return db.select().from(travelPartners).orderBy(desc(travelPartners.isActive), asc(travelPartners.name));
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
            ...(closed ? {} : { status: 'confirmed' }), updatedAt: new Date(),
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

    static async customerName(userId: number) {
        const [u] = await db.select({ name: users.username, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
        return u ?? null;
    }
}
