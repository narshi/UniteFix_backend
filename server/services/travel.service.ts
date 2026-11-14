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
import { travelRegions, travelPlaces, travelPickups, travelTrips, travelTripMembers, adminUsers, adminRoleCapabilities, users } from '@shared/schema';
import { planTrip, PLACE_KINDS, TRIP_STATUSES, TRIP_STATUS_LABEL, suggestedVehicle, type PlanPlace, type TripPlan, type TripStatus } from '@shared/travel';
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
        return {
            id: trip.id, code: trip.code,
            message: 'Your plan is sent. A travel manager will be assigned and will call you soon with a quotation.',
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
            quote: t.quoteAmount != null ? { amount: t.quoteAmount, note: t.quoteNote, at: t.quotedAt } : null,
            members: members.map(m => ({ name: m.name, phone: m.phone })),
            createdAt: t.createdAt,
            canCancel: OPEN.includes(status),
        };
    }

    static async cancelMine(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        if (!OPEN.includes(t.status as TripStatus)) throw new TravelError('This trip can no longer be cancelled here. Call your travel manager.');
        await db.update(travelTrips).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(travelTrips.id, t.id));
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

    static async update(adminId: number, tripId: number, body: unknown) {
        const b = parse(z.object({
            status: z.enum(TRIP_STATUSES).optional(),
            quoteAmount: z.number().int().min(0).max(10_000_000).nullish(),
            quoteNote: z.string().trim().max(1000).nullish(),
            staffNote: z.string().trim().max(2000).nullish(),
        }), body);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TravelError('Trip not found.', 404);
        const quoted = b.quoteAmount != null && b.quoteAmount !== t.quoteAmount;
        let status = b.status ?? t.status;
        if (quoted && !b.status && OPEN.includes(t.status as TripStatus)) status = 'quoted';
        if (status !== 'new' && status !== 'cancelled' && !t.managerName) throw new TravelError('Assign a travel manager first.');
        const set: Record<string, unknown> = { status, updatedAt: new Date() };
        if (b.quoteAmount !== undefined) { set.quoteAmount = b.quoteAmount; if (quoted) set.quotedAt = new Date(); }
        if (b.quoteNote !== undefined) set.quoteNote = b.quoteNote;
        if (b.staffNote !== undefined) set.staffNote = b.staffNote;
        const [row] = await db.update(travelTrips).set(set as any).where(eq(travelTrips.id, tripId)).returning();
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_trip_updated', changedBy: adminId, fromState: t.status, toState: status, metadata: { code: t.code, quoteAmount: b.quoteAmount ?? undefined } });
        if (t.customerUserId) {
            const tell = (title: string, text: string) => void NotificationService.sendToUser(t.customerUserId!, title, text, 'travel_trip', { tripId, code: t.code, url: 'unitefix://travel' }).catch(() => {});
            if (quoted) tell('Your trip quotation', `Trip ${t.code}: ₹${b.quoteAmount!.toLocaleString('en-IN')} for your group. ${t.managerName ?? 'Your travel manager'} will go through it with you.`);
            else if (status === 'confirmed' && t.status !== 'confirmed') tell('Trip confirmed', `Trip ${t.code} is confirmed. Have a great journey!`);
            else if (status === 'cancelled' && t.status !== 'cancelled') tell('Trip cancelled', `Trip ${t.code} was cancelled. Call your travel manager if this is a mistake.`);
        }
        return row;
    }

    static async customerName(userId: number) {
        const [u] = await db.select({ name: users.username, phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
        return u ?? null;
    }
}
