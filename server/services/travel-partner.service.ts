/**
 * Travel partners in the Partner Hub.
 *
 * UniteFix sells the trip to the traveller and assigns its parts — a cab, a
 * stay, a guide, an activity — to partners at an agreed price. A partner with
 * a Hub account ("travel" vertical, module 'travel'):
 *
 *   Price requests  staff ask for a price on a trip (Trip requests → Supplier
 *                   prices); the partner answers in the Hub instead of by phone.
 *   Assignments     staff put the partner on the trip team at an agreed pay;
 *                   the partner accepts or declines, then puts a driver and a
 *                   vehicle from their fleet on it (or names the contact for a
 *                   stay, guide or activity) and forwards the driver's link.
 *   Fleet           drivers (licence) and vehicles (RC, insurance, permit),
 *                   checked through Cashfree Secure ID or by staff. Only checked,
 *                   current drivers and vehicles with enough seats can be put on
 *                   a trip; that is what the traveller's "verified" badge means.
 *   Pay             when the trip ends, the agreed amount goes to the partner's
 *                   statement (ledger entry travel_job, once per assignment) and
 *                   is paid on their payout schedule. Staff no longer record those
 *                   payouts by hand.
 *
 * Travellers' phone numbers are not shown to partners: they work through the
 * travel manager, and the driver through the trip link (pickup code, location).
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import {
    businessPartners, travelPartners, travelTrips, travelTripQuotes, travelTripTeam, travelFleetDrivers, travelFleetVehicles, travelRegions,
} from '@shared/schema';
import { TRAVEL_PARTNER_KINDS, type TripPlan } from '@shared/travel';
import { HubError } from './partner-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { lookupLicenceOrRc } from './partner-verification.service';
import { withTransaction } from '../lib/transaction';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

type Card = typeof travelPartners.$inferSelect;
type Team = typeof travelTripTeam.$inferSelect;
type Trip = typeof travelTrips.$inferSelect;

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mask = (v: string) => `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
const phone = z.string().trim().transform(s => s.replace(/[\s-]/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit mobile number'));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like 1990-05-21');
const OPEN_TRIP = ['new', 'assigned', 'contacted', 'quoted', 'confirmed'];

export class TravelPartnerHub {

    // ── The partner's card ──────────────────────────────────────────────

    /** The travel partner card behind a Hub account; made from the account if staff never had one. */
    static async cardFor(bpId: number): Promise<Card> {
        const [c] = await db.select().from(travelPartners).where(eq(travelPartners.businessPartnerId, bpId)).limit(1);
        if (c) return c;
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Partner not found', 'NOT_FOUND', 404);
        // A card staff already keep for this phone number becomes theirs, with its history.
        const ph = (bp.contactPhone ?? '').replace(/\D/g, '').slice(-10);
        const [same] = ph ? await db.select().from(travelPartners).where(and(eq(travelPartners.phone, ph), isNull(travelPartners.businessPartnerId))).limit(1) : [];
        if (same) {
            const [u] = await db.update(travelPartners).set({ businessPartnerId: bpId, updatedAt: new Date() }).where(and(eq(travelPartners.id, same.id), isNull(travelPartners.businessPartnerId))).returning();
            if (u) { logger.info(`[TRAVEL-HUB] ${bp.partnerCode} linked to travel partner card #${u.id} by phone`); return u; }
        }
        const [made] = await db.insert(travelPartners).values({ name: bp.displayName, phone: ph || null, contactName: bp.contactName ?? null, businessPartnerId: bpId, kinds: [], regionIds: [] })
            .onConflictDoNothing().returning();
        if (made) return made;
        const [again] = await db.select().from(travelPartners).where(eq(travelPartners.businessPartnerId, bpId)).limit(1);
        return again;
    }

    /** Staff: this card is that Hub partner (by partner code, e.g. BP-0042). */
    static async linkCard(adminId: number, cardId: number, partnerCode: string) {
        const [card] = await db.select().from(travelPartners).where(eq(travelPartners.id, cardId)).limit(1);
        if (!card) throw new HubError('Travel partner not found', 'NOT_FOUND', 404);
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.partnerCode, partnerCode.trim().toUpperCase())).limit(1);
        if (!bp) throw new HubError(`No Hub partner ${partnerCode}.`, 'NOT_FOUND', 404);
        if (!(await BusinessPartnerService.verticalCodesOf(bp.id)).includes('travel')) throw new HubError(`${bp.displayName} is not a travel partner in the Hub. Add the Travel type to their account first.`, 'NOT_TRAVEL', 409);
        const [other] = await db.select().from(travelPartners).where(eq(travelPartners.businessPartnerId, bp.id)).limit(1);
        if (other && other.id !== card.id) throw new HubError(`${bp.displayName} is already linked to "${other.name}".`, 'ALREADY_LINKED', 409);
        const [u] = await db.update(travelPartners).set({ businessPartnerId: bp.id, updatedAt: new Date() }).where(eq(travelPartners.id, card.id)).returning();
        await recordAudit({ entityType: 'travel', entityId: card.id, action: 'travel_partner_linked_to_hub', changedBy: adminId, metadata: { partnerCode: bp.partnerCode } });
        return u;
    }

    /** The Hub account behind a card, if any. */
    static async bpOfCard(cardId: number | null | undefined): Promise<number | null> {
        if (!cardId) return null;
        const [c] = await db.select({ bp: travelPartners.businessPartnerId }).from(travelPartners).where(eq(travelPartners.id, cardId)).limit(1);
        return c?.bp ?? null;
    }

    static async profile(bpId: number) {
        const c = await this.cardFor(bpId);
        const regions = await db.select({ id: travelRegions.id, name: travelRegions.name }).from(travelRegions).where(eq(travelRegions.isActive, true));
        return { id: c.id, name: c.name, kinds: (c.kinds ?? []) as string[], baseTown: c.baseTown, regionIds: (c.regionIds ?? []) as number[], contactName: c.contactName, phone: c.phone, regions, allKinds: TRAVEL_PARTNER_KINDS };
    }

    static async saveProfile(bpId: number, body: unknown) {
        const b = parse(z.object({
            kinds: z.array(z.enum(TRAVEL_PARTNER_KINDS)).min(1, 'say what you provide').max(TRAVEL_PARTNER_KINDS.length),
            baseTown: z.string().trim().max(80).nullish(), regionIds: z.array(z.number().int().positive()).max(30).default([]),
            contactName: z.string().trim().max(80).nullish(), phone: phone.nullish(),
        }), body);
        const c = await this.cardFor(bpId);
        const [u] = await db.update(travelPartners).set({ kinds: b.kinds, baseTown: b.baseTown ?? null, regionIds: b.regionIds, contactName: b.contactName ?? null, ...(b.phone ? { phone: b.phone } : {}), updatedAt: new Date() }).where(eq(travelPartners.id, c.id)).returning();
        return u;
    }

    // ── Fleet ───────────────────────────────────────────────────────────

    private static driverView(d: typeof travelFleetDrivers.$inferSelect) {
        return { id: d.id, name: d.name, phone: d.phone, photoUrl: d.photoUrl, dlNumber: mask(d.dlNumber), dlStatus: d.dlStatus, dlValidUntil: d.dlValidUntil, dlNameAtRto: d.dlNameAtRto, dlCheckedAt: d.dlCheckedAt, dlCheckMethod: d.dlCheckMethod, dlCheckNote: d.dlCheckNote, isActive: d.isActive, ready: this.driverReady(d, today()) === null };
    }
    private static vehicleView(v: typeof travelFleetVehicles.$inferSelect) {
        return { id: v.id, regNo: v.regNo, model: v.model, seats: v.seats, rcStatus: v.rcStatus, rcValidUntil: v.rcValidUntil, insuranceUpto: v.insuranceUpto, permitUpto: v.permitUpto, rcOwner: v.rcOwner, rcCheckedAt: v.rcCheckedAt, rcCheckMethod: v.rcCheckMethod, rcCheckNote: v.rcCheckNote, isActive: v.isActive, ready: this.vehicleReady(v, today(), 0) === null };
    }

    /** Why a driver cannot drive until `until` (null = can). */
    static driverReady(d: typeof travelFleetDrivers.$inferSelect, until: string) {
        if (!d.isActive) return `${d.name} is not in your active fleet.`;
        if (d.dlStatus !== 'verified') return `${d.name}'s driving licence is not checked yet.`;
        if (d.dlValidUntil && d.dlValidUntil < until) return `${d.name}'s licence expires on ${d.dlValidUntil}, before the trip ends.`;
        return null;
    }
    /** Why a vehicle cannot carry `people` until `until` (null = can). */
    static vehicleReady(v: typeof travelFleetVehicles.$inferSelect, until: string, people: number) {
        if (!v.isActive) return `${v.regNo} is not in your active fleet.`;
        if (v.rcStatus !== 'verified') return `${v.regNo}'s registration is not checked yet.`;
        for (const [label, d] of [['registration', v.rcValidUntil], ['insurance', v.insuranceUpto], ['permit', v.permitUpto]] as const) {
            if (d && d < until) return `${v.regNo}'s ${label} expires on ${d}, before the trip ends.`;
        }
        if (people > 0 && v.seats < people) return `${v.regNo} seats ${v.seats}; this trip has ${people} people.`;
        return null;
    }

    static async fleet(bpId: number) {
        const drivers = await db.select().from(travelFleetDrivers).where(eq(travelFleetDrivers.businessPartnerId, bpId)).orderBy(desc(travelFleetDrivers.isActive), travelFleetDrivers.name);
        const vehicles = await db.select().from(travelFleetVehicles).where(eq(travelFleetVehicles.businessPartnerId, bpId)).orderBy(desc(travelFleetVehicles.isActive), travelFleetVehicles.regNo);
        return { drivers: drivers.map(d => this.driverView(d)), vehicles: vehicles.map(v => this.vehicleView(v)) };
    }

    static async saveDriver(bpId: number, id: number | null, body: unknown) {
        const base = z.object({ name: z.string().trim().min(2).max(80), phone, dlNumber: z.string().trim().min(6).max(25), dob: ymd, photoUrl: z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)) });
        const b = parse(id ? base.partial() : base, body) as any;
        if (!id) for (const k of ['name', 'phone', 'dlNumber', 'dob']) if (!b[k]) throw new HubError(`${k} is required.`, 'MISSING');
        const dl = b.dlNumber ? String(b.dlNumber).replace(/[\s-]/g, '').toUpperCase() : undefined;
        let row: typeof travelFleetDrivers.$inferSelect;
        if (id) {
            const [cur] = await db.select().from(travelFleetDrivers).where(and(eq(travelFleetDrivers.id, id), eq(travelFleetDrivers.businessPartnerId, bpId))).limit(1);
            if (!cur) throw new HubError('Driver not found', 'NOT_FOUND', 404);
            const changed = (dl && dl !== cur.dlNumber) || (b.dob && b.dob !== cur.dob);
            [row] = await db.update(travelFleetDrivers).set({
                ...(b.name ? { name: b.name } : {}), ...(b.phone ? { phone: b.phone } : {}), ...(b.photoUrl !== undefined ? { photoUrl: b.photoUrl } : {}),
                ...(dl ? { dlNumber: dl } : {}), ...(b.dob ? { dob: b.dob } : {}),
                ...(changed ? { dlStatus: 'unverified', dlValidUntil: null, dlNameAtRto: null, dlCheckedAt: null, dlCheckMethod: null, dlCheckNote: null } : {}),
                updatedAt: new Date(),
            }).where(eq(travelFleetDrivers.id, id)).returning();
            if (!changed) return this.driverView(row);
        } else {
            [row] = await db.insert(travelFleetDrivers).values({ businessPartnerId: bpId, name: b.name, phone: b.phone, dlNumber: dl!, dob: b.dob, photoUrl: b.photoUrl ?? null }).returning();
        }
        return this.checkDriver(bpId, row.id, null);
    }

    /** Check a driver's licence through Cashfree. Without Cashfree, staff check it (it stays "unverified"). */
    static async checkDriver(bpId: number | null, id: number, adminId: number | null) {
        const [d] = await db.select().from(travelFleetDrivers).where(and(eq(travelFleetDrivers.id, id), ...(bpId ? [eq(travelFleetDrivers.businessPartnerId, bpId)] : []))).limit(1);
        if (!d) throw new HubError('Driver not found', 'NOT_FOUND', 404);
        const r = await lookupLicenceOrRc('driving_licence', d.dlNumber, d.dob);
        if (r.kind === 'unavailable') {
            const [u] = await db.update(travelFleetDrivers).set({ dlCheckNote: r.reason === 'not_configured' ? 'UniteFix will check this licence by hand.' : 'The licence check could not run just now. Try again, or UniteFix will check it.', updatedAt: new Date() }).where(eq(travelFleetDrivers.id, id)).returning();
            return this.driverView(u);
        }
        const [u] = await db.update(travelFleetDrivers).set({
            dlStatus: r.status === 'manual_required' ? 'unverified' : r.status, dlValidUntil: r.validUntil, dlNameAtRto: r.nameFound, dlCheckedAt: new Date(), dlCheckMethod: 'cashfree', dlCheckNote: r.note, updatedAt: new Date(),
        }).where(eq(travelFleetDrivers.id, id)).returning();
        if (adminId) await recordAudit({ entityType: 'travel', entityId: id, action: `fleet_driver_checked_${r.status}`, changedBy: adminId, metadata: { reference: r.reference } });
        return this.driverView(u);
    }

    static async saveVehicle(bpId: number, id: number | null, body: unknown) {
        const base = z.object({ regNo: z.string().trim().min(6).max(15), model: z.string().trim().min(2).max(80), seats: z.number().int().min(1).max(60) });
        const b = parse(id ? base.partial() : base, body) as any;
        if (!id) for (const k of ['regNo', 'model', 'seats']) if (!b[k]) throw new HubError(`${k} is required.`, 'MISSING');
        const reg = b.regNo ? String(b.regNo).replace(/[\s-]/g, '').toUpperCase() : undefined;
        let row: typeof travelFleetVehicles.$inferSelect;
        try {
            if (id) {
                const [cur] = await db.select().from(travelFleetVehicles).where(and(eq(travelFleetVehicles.id, id), eq(travelFleetVehicles.businessPartnerId, bpId))).limit(1);
                if (!cur) throw new HubError('Vehicle not found', 'NOT_FOUND', 404);
                const changed = !!reg && reg !== cur.regNo;
                [row] = await db.update(travelFleetVehicles).set({
                    ...(reg ? { regNo: reg } : {}), ...(b.model ? { model: b.model } : {}), ...(b.seats ? { seats: b.seats } : {}),
                    ...(changed ? { rcStatus: 'unverified', rcValidUntil: null, insuranceUpto: null, permitUpto: null, rcOwner: null, rcCheckedAt: null, rcCheckMethod: null, rcCheckNote: null } : {}),
                    updatedAt: new Date(),
                }).where(eq(travelFleetVehicles.id, id)).returning();
                if (!changed) return this.vehicleView(row);
            } else {
                [row] = await db.insert(travelFleetVehicles).values({ businessPartnerId: bpId, regNo: reg!, model: b.model, seats: b.seats }).returning();
            }
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('That vehicle is already in your fleet.', 'DUPLICATE', 409);
            throw e;
        }
        return this.checkVehicle(bpId, row.id, null);
    }

    static async checkVehicle(bpId: number | null, id: number, adminId: number | null) {
        const [v] = await db.select().from(travelFleetVehicles).where(and(eq(travelFleetVehicles.id, id), ...(bpId ? [eq(travelFleetVehicles.businessPartnerId, bpId)] : []))).limit(1);
        if (!v) throw new HubError('Vehicle not found', 'NOT_FOUND', 404);
        const r = await lookupLicenceOrRc('vehicle_rc', v.regNo);
        if (r.kind === 'unavailable') {
            const [u] = await db.update(travelFleetVehicles).set({ rcCheckNote: r.reason === 'not_configured' ? 'UniteFix will check this vehicle\'s papers by hand.' : 'The RC check could not run just now. Try again, or UniteFix will check it.', updatedAt: new Date() }).where(eq(travelFleetVehicles.id, id)).returning();
            return this.vehicleView(u);
        }
        const [u] = await db.update(travelFleetVehicles).set({
            rcStatus: r.status === 'manual_required' ? 'unverified' : r.status, rcValidUntil: r.validUntil, insuranceUpto: r.insuranceUpto, permitUpto: r.permitUpto, rcOwner: r.nameFound,
            rcCheckedAt: new Date(), rcCheckMethod: 'cashfree', rcCheckNote: r.note, updatedAt: new Date(),
        }).where(eq(travelFleetVehicles.id, id)).returning();
        if (adminId) await recordAudit({ entityType: 'travel', entityId: id, action: `fleet_vehicle_checked_${r.status}`, changedBy: adminId, metadata: { reference: r.reference } });
        return this.vehicleView(u);
    }

    static async setActive(bpId: number, kind: 'driver' | 'vehicle', id: number, active: boolean) {
        const t = kind === 'driver' ? travelFleetDrivers : travelFleetVehicles;
        const [u] = await db.update(t).set({ isActive: active, updatedAt: new Date() } as any).where(and(eq(t.id, id), eq(t.businessPartnerId, bpId))).returning();
        if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
        return u;
    }

    /** Staff check a licence or a vehicle's papers by hand (or overrule Cashfree), with a note. */
    static async staffReview(adminId: number, kind: 'driver' | 'vehicle', id: number, body: unknown) {
        const b = parse(z.object({ status: z.enum(['verified', 'failed']), note: z.string().trim().min(5).max(300), validUntil: ymd.nullish(), insuranceUpto: ymd.nullish(), permitUpto: ymd.nullish() }), body);
        if (kind === 'driver') {
            const [u] = await db.update(travelFleetDrivers).set({ dlStatus: b.status, dlValidUntil: b.validUntil ?? undefined, dlCheckedAt: new Date(), dlCheckMethod: 'manual', dlCheckNote: b.note, updatedAt: new Date() }).where(eq(travelFleetDrivers.id, id)).returning();
            if (!u) throw new HubError('Driver not found', 'NOT_FOUND', 404);
            await recordAudit({ entityType: 'travel', entityId: id, action: `fleet_driver_${b.status}_manual`, changedBy: adminId, metadata: { note: b.note } });
            return this.driverView(u);
        }
        const [u] = await db.update(travelFleetVehicles).set({ rcStatus: b.status, rcValidUntil: b.validUntil ?? undefined, insuranceUpto: b.insuranceUpto ?? undefined, permitUpto: b.permitUpto ?? undefined, rcCheckedAt: new Date(), rcCheckMethod: 'manual', rcCheckNote: b.note, updatedAt: new Date() }).where(eq(travelFleetVehicles.id, id)).returning();
        if (!u) throw new HubError('Vehicle not found', 'NOT_FOUND', 404);
        await recordAudit({ entityType: 'travel', entityId: id, action: `fleet_vehicle_${b.status}_manual`, changedBy: adminId, metadata: { note: b.note } });
        return this.vehicleView(u);
    }

    /** Staff: a Hub partner's fleet, from their travel partner card. */
    static async fleetOfCard(cardId: number) {
        const bp = await this.bpOfCard(cardId);
        return bp ? { businessPartnerId: bp, ...(await this.fleet(bp)) } : null;
    }

    // ── Trips as the partner sees them ──────────────────────────────────

    private static tripBrief(t: Trip) {
        const plan = t.plan as TripPlan | null;
        const end = t.startDate ? addDays(t.startDate, Math.max(0, (t.days ?? 1) - 1)) : null;
        return {
            code: t.code, status: t.status, startDate: t.startDate, endDate: end, days: t.days, people: t.adults + t.children, adults: t.adults, children: t.children,
            from: t.pickupText, to: t.dropText, tripType: t.tripType, stay: t.stay, needsCab: t.needsCab, needsGuide: t.needsGuide, pace: t.pace,
            plan: plan ? plan.days.map(d => ({ day: d.day, stayNear: d.stayNear, km: d.km, stops: d.stops.map(s => s.name) })) : [],
            totalKm: plan?.totalKm ?? null,
            manager: t.managerName ? { name: t.managerName, phone: t.managerPhone } : null,
        };
    }

    static async priceRequests(bpId: number) {
        const card = await this.cardFor(bpId);
        const rows = await db.select({ q: travelTripQuotes, t: travelTrips }).from(travelTripQuotes).innerJoin(travelTrips, eq(travelTrips.id, travelTripQuotes.tripId))
            .where(eq(travelTripQuotes.partnerId, card.id)).orderBy(desc(travelTripQuotes.createdAt)).limit(60);
        return rows.map(({ q, t }) => ({
            id: q.id, status: q.status, amount: q.amount, covers: q.covers, note: q.note, askedAt: q.createdAt, respondedAt: q.respondedAt,
            chosen: t.chosenQuoteId === q.id, open: q.status === 'asked' && OPEN_TRIP.includes(t.status) && t.chosenQuoteId !== q.id,
            canChange: q.status !== 'declined' && ['new', 'assigned', 'contacted', 'quoted'].includes(t.status) && t.chosenQuoteId !== q.id,
            trip: this.tripBrief(t),
        }));
    }

    static async answerPrice(bpId: number, hubUserId: number | null, quoteId: number, body: unknown) {
        const b = parse(z.object({ decline: z.boolean().optional(), amount: z.number().int().min(1).max(10_000_000).optional(), covers: z.string().trim().max(400).nullish(), note: z.string().trim().max(400).nullish() }), body);
        const card = await this.cardFor(bpId);
        const [row] = await db.select({ q: travelTripQuotes, t: travelTrips }).from(travelTripQuotes).innerJoin(travelTrips, eq(travelTrips.id, travelTripQuotes.tripId))
            .where(and(eq(travelTripQuotes.id, quoteId), eq(travelTripQuotes.partnerId, card.id))).limit(1);
        if (!row) throw new HubError('Request not found', 'NOT_FOUND', 404);
        if (row.t.chosenQuoteId === row.q.id) throw new HubError('UniteFix has already accepted this price. Call the travel manager to change it.', 'CHOSEN', 409);
        if (!['new', 'assigned', 'contacted', 'quoted'].includes(row.t.status)) throw new HubError('This trip no longer needs a price.', 'CLOSED', 409);
        if (!b.decline && !b.amount) throw new HubError('Give your price, or decline.', 'NO_AMOUNT');
        const [u] = await db.update(travelTripQuotes).set({
            status: b.decline ? 'declined' : 'quoted', amount: b.decline ? null : b.amount!, covers: b.covers ?? row.q.covers, note: b.note ?? null,
            respondedAt: new Date(), respondedByAdminUserId: hubUserId, updatedAt: new Date(),
        }).where(eq(travelTripQuotes.id, quoteId)).returning();
        const { NotificationService } = await import('./notification.service');
        void NotificationService.sendToAdmins(b.decline ? 'Partner declined a price request' : 'Partner sent a price',
            `${card.name} for trip ${row.t.code}: ${b.decline ? 'cannot do it' : `₹${b.amount!.toLocaleString('en-IN')}`}${b.note ? ` — ${b.note}` : ''}.`, { tripId: row.t.id }).catch(() => null);
        return u;
    }

    static async assignments(bpId: number) {
        const card = await this.cardFor(bpId);
        const rows = await db.select({ m: travelTripTeam, t: travelTrips }).from(travelTripTeam).innerJoin(travelTrips, eq(travelTrips.id, travelTripTeam.tripId))
            .where(eq(travelTripTeam.partnerId, card.id)).orderBy(desc(travelTrips.startDate), travelTripTeam.day).limit(100);
        const { driverLinkFor } = await import('./travel.service');
        return rows.map(({ m, t }) => ({
            id: m.id, role: m.role, day: m.day, time: m.time, place: m.place,
            status: m.partnerStatus ?? 'accepted', respondedAt: m.partnerRespondedAt, declineReason: m.partnerDeclineReason,
            pay: m.partnerAmount, paidToStatement: !!m.earningPostedAt,
            driver: m.fleetDriverId ? { name: m.name, phone: m.phone } : null, vehicle: m.fleetVehicleId ? { model: m.vehicle, plate: m.plate } : null,
            contact: m.role !== 'driver' && m.name ? { name: m.name, phone: m.phone } : null,
            driverLink: m.role === 'driver' && m.driverToken && ['confirmed', 'started'].includes(t.status) && m.fleetDriverId ? driverLinkFor(m.driverToken) : null,
            accepted: !!m.acceptedAt, verified: m.role !== 'driver' || !!(m.fleetDriverId && m.fleetVehicleId),
            trip: this.tripBrief(t),
        }));
    }

    private static async ownAssignment(bpId: number, teamId: number) {
        const card = await this.cardFor(bpId);
        const [row] = await db.select({ m: travelTripTeam, t: travelTrips }).from(travelTripTeam).innerJoin(travelTrips, eq(travelTrips.id, travelTripTeam.tripId))
            .where(and(eq(travelTripTeam.id, teamId), eq(travelTripTeam.partnerId, card.id))).limit(1);
        if (!row) throw new HubError('Assignment not found', 'NOT_FOUND', 404);
        return { ...row, card };
    }

    static async respond(bpId: number, teamId: number, body: unknown) {
        const b = parse(z.object({ accept: z.boolean(), reason: z.string().trim().max(300).optional() }), body);
        const { m, t, card } = await this.ownAssignment(bpId, teamId);
        if (['started', 'completed', 'cancelled'].includes(t.status)) throw new HubError(`This trip is ${t.status}.`, 'CLOSED', 409);
        if (!b.accept && !b.reason?.trim()) throw new HubError('Say why, so the travel manager can find someone else.', 'NO_REASON');
        const [u] = await db.update(travelTripTeam).set({ partnerStatus: b.accept ? 'accepted' : 'declined', partnerRespondedAt: new Date(), partnerDeclineReason: b.accept ? null : b.reason!.trim(), updatedAt: new Date() }).where(eq(travelTripTeam.id, m.id)).returning();
        if (!b.accept) {
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToAdmins('Partner declined an assignment', `${card.name} cannot do the ${m.role} on trip ${t.code}${m.day ? ` (day ${m.day})` : ''}: ${b.reason}. Assign someone else.`, { tripId: t.id }).catch(() => null);
        }
        return u;
    }

    /** Put a checked driver and vehicle from the fleet on a cab assignment. */
    static async assignFleet(bpId: number, teamId: number, body: unknown) {
        const b = parse(z.object({ driverId: z.number().int().positive(), vehicleId: z.number().int().positive(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish() }), body);
        const { m, t } = await this.ownAssignment(bpId, teamId);
        if (m.role !== 'driver') throw new HubError('This assignment is not a cab.', 'NOT_DRIVER', 409);
        if (m.partnerStatus === 'declined') throw new HubError('You declined this assignment.', 'DECLINED', 409);
        if (['completed', 'cancelled'].includes(t.status)) throw new HubError(`This trip is ${t.status}.`, 'CLOSED', 409);
        const [d] = await db.select().from(travelFleetDrivers).where(and(eq(travelFleetDrivers.id, b.driverId), eq(travelFleetDrivers.businessPartnerId, bpId))).limit(1);
        const [v] = await db.select().from(travelFleetVehicles).where(and(eq(travelFleetVehicles.id, b.vehicleId), eq(travelFleetVehicles.businessPartnerId, bpId))).limit(1);
        if (!d || !v) throw new HubError('Choose a driver and a vehicle from your fleet.', 'NOT_FOUND', 404);
        const until = t.startDate ? addDays(t.startDate, Math.max(0, (t.days ?? 1) - 1)) : today();
        const why = this.driverReady(d, until) ?? this.vehicleReady(v, until, t.adults + t.children);
        if (why) throw new HubError(why, 'NOT_READY', 409);
        const { SafetyService } = await import('./safety.service');
        const flag = await SafetyService.phoneFlag(d.phone);
        if (flag) throw new HubError(`${d.name} has an open safety case (${flag}) and cannot be put on a trip until it is closed.`, 'SAFETY_FLAG', 409);
        const [u] = await db.update(travelTripTeam).set({
            name: d.name, phone: d.phone, photoUrl: d.photoUrl, vehicle: v.model, plate: v.regNo, docs: { licence: true, rc: true, photo: !!d.photoUrl }, docOverride: null,
            fleetDriverId: d.id, fleetVehicleId: v.id, partnerStatus: 'accepted', partnerRespondedAt: m.partnerRespondedAt ?? new Date(),
            ...(b.time ? { time: b.time } : {}), updatedAt: new Date(),
        }).where(eq(travelTripTeam.id, m.id)).returning();
        await recordAudit({ entityType: 'travel', entityId: t.id, action: 'travel_partner_assigned_fleet', changedBy: null as any, metadata: { teamId: m.id, driverId: d.id, vehicleId: v.id, plate: v.regNo } });
        return u;
    }

    /** For a stay, guide or activity: who the traveller meets, where and when. */
    static async setDetails(bpId: number, teamId: number, body: unknown) {
        const b = parse(z.object({ name: z.string().trim().min(2).max(100), phone: phone.nullish(), place: z.string().trim().max(200).nullish(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish() }), body);
        const { m, t } = await this.ownAssignment(bpId, teamId);
        if (m.role === 'driver') throw new HubError('For a cab, choose a driver and vehicle from your fleet.', 'USE_FLEET', 409);
        if (m.partnerStatus === 'declined') throw new HubError('You declined this assignment.', 'DECLINED', 409);
        if (['completed', 'cancelled'].includes(t.status)) throw new HubError(`This trip is ${t.status}.`, 'CLOSED', 409);
        const [u] = await db.update(travelTripTeam).set({ name: b.name, phone: b.phone ?? null, place: b.place ?? m.place, time: b.time ?? m.time, partnerStatus: 'accepted', partnerRespondedAt: m.partnerRespondedAt ?? new Date(), updatedAt: new Date() }).where(eq(travelTripTeam.id, m.id)).returning();
        return u;
    }

    // ── Money ───────────────────────────────────────────────────────────

    /**
     * The trip ended: each Hub partner's agreed pay goes onto their statement,
     * once per assignment (the row is claimed first), and is paid on their
     * payout schedule. Declined assignments and assignments with no agreed pay
     * get nothing.
     */
    static async postEarnings(tripId: number) {
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t || t.status !== 'completed') return 0;
        const rows = await db.select({ m: travelTripTeam, bp: travelPartners.businessPartnerId, card: travelPartners.name }).from(travelTripTeam)
            .innerJoin(travelPartners, eq(travelPartners.id, travelTripTeam.partnerId))
            .where(and(eq(travelTripTeam.tripId, tripId), isNull(travelTripTeam.earningPostedAt), sql`${travelPartners.businessPartnerId} IS NOT NULL`, sql`${travelTripTeam.partnerAmount} > 0`, sql`COALESCE(${travelTripTeam.partnerStatus}, 'accepted') <> 'declined'`));
        let n = 0;
        for (const r of rows) {
            await withTransaction(async (tx) => {
                const [claimed] = await tx.update(travelTripTeam).set({ earningPostedAt: new Date() }).where(and(eq(travelTripTeam.id, r.m.id), isNull(travelTripTeam.earningPostedAt))).returning();
                if (!claimed) return;
                const what = { driver: 'cab', stay: 'stay', guide: 'guide', activity: 'activity' }[r.m.role] ?? r.m.role;
                await BusinessPartnerService.appendLedger(tx as any, {
                    businessPartnerId: r.bp!, entryType: 'travel_job', amountPaise: -(r.m.partnerAmount! * 100),
                    description: `Trip ${t.code} — ${what}${r.m.day ? `, day ${r.m.day}` : ''}`, metadata: { tripId, teamMemberId: r.m.id },
                } as any);
                n++;
            });
        }
        if (n) logger.info(`[TRAVEL-HUB] Trip ${t.code}: ${n} partner earning(s) added to statements`);
        return n;
    }

    /** True when this card's partner is paid through Partner Settlements (so not by hand on the trip). */
    static async paidThroughHub(cardId: number | null | undefined) {
        return !!(await this.bpOfCard(cardId));
    }
}

