/**
 * Trips on the road (Phase 2) and after them (Phase 3).
 *
 * Tracking: the traveller's app sends its location in Trip mode (while the
 * app is open) and a driver can share from the trip link in their browser.
 * Passing within 1 km of a planned place checks it off. A family link shows
 * the live position until the trip ends. Staff see today's trips on the
 * Live trips board; the system raises cases on the Safety desk for no
 * signal, off the route, a long unplanned stop and night driving.
 *
 * After: the traveller rates each person; low ratings open a follow-up; the
 * ratings and safety strikes make each partner's score. Staff record what was
 * paid to each partner and the balance collected, so the margin is known.
 *
 * Locations are kept 30 days, longer when the trip has a safety case.
 */

import { randomBytes } from 'crypto';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import {
    travelTrips, travelTripTeam, travelTripPings, travelRatings, travelTripPayouts, travelPlaces, travelPickups, safetyIncidents,
} from '@shared/schema';
import { LIVE_ALERTS, RATING_TAGS, istToday, kmToSegment, straightKm, type TripPlan } from '@shared/travel';
import { STRIKE_WINDOW_DAYS } from '@shared/safety';
import { NotificationService } from './notification.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class TripLiveError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> => {
    const r = schema.safeParse(body);
    if (!r.success) { const i = r.error.issues[0]; throw new TripLiveError(i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input'); }
    return r.data;
};
const locInput = z.object({
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100_000).nullish(), speed: z.number().min(-1).max(200).nullish(),
});
const publicBase = () => (process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'https://unitefix-backend.onrender.com').replace(/\/$/, '');
export const followUrl = (t: string) => `${publicBase()}/api/travel/follow/${t}`;
const istHour = (now: number) => new Date(now + 330 * 60_000).getUTCHours();
type Trip = typeof travelTrips.$inferSelect;
type Alerts = Partial<Record<'no_signal' | 'off_route' | 'long_stop' | 'night_driving', string | null>>;

/** The planned stops with map positions: places from the catalogue, start and end from the pickup points. */
async function routePoints(trip: Trip) {
    const plan = trip.plan as TripPlan | null;
    if (!plan) return [];
    const stops = plan.days.flatMap(d => d.stops);
    const placeIds = stops.filter(s => s.type === 'place' && s.id).map(s => s.id!);
    const pickIds = stops.filter(s => s.type !== 'place' && s.id).map(s => s.id!);
    const places = placeIds.length ? await db.select({ id: travelPlaces.id, lat: travelPlaces.lat, lng: travelPlaces.lng }).from(travelPlaces).where(inArray(travelPlaces.id, placeIds)) : [];
    const picks = pickIds.length ? await db.select({ id: travelPickups.id, lat: travelPickups.lat, lng: travelPickups.lng }).from(travelPickups).where(inArray(travelPickups.id, pickIds)) : [];
    return stops.map(s => {
        const p = s.type === 'place' ? places.find(x => x.id === s.id) : picks.find(x => x.id === s.id);
        return p ? { type: s.type, id: s.id, name: s.name, lat: p.lat, lng: p.lng } : null;
    }).filter((x): x is { type: 'start' | 'place' | 'end'; id: number | null; name: string; lat: number; lng: number } => !!x);
}

/** How far along the plan is: places checked off, and the next one. */
export function progressOf(trip: Pick<Trip, 'plan' | 'checkedPlaceIds'>) {
    const plan = trip.plan as TripPlan | null;
    const places = plan ? plan.days.flatMap(d => d.stops.filter(s => s.type === 'place').map(s => ({ id: s.id, name: s.name, day: d.day }))) : [];
    const done = new Set((Array.isArray(trip.checkedPlaceIds) ? trip.checkedPlaceIds : []) as number[]);
    const next = places.find(p => p.id != null && !done.has(p.id));
    return { done: places.filter(p => p.id != null && done.has(p.id)).length, total: places.length, next: next?.name ?? null, nextDay: next?.day ?? null, checked: Array.from(done) };
}

export class TripLiveService {
    // ── Location ────────────────────────────────────────────────────────

    private static async record(trip: Trip, source: 'traveller' | 'driver', b: z.infer<typeof locInput>, teamMemberId: number | null) {
        await db.insert(travelTripPings).values({ tripId: trip.id, source, teamMemberId, lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null, speed: b.speed ?? null });
        // Check off any planned place within 1 km.
        const pts = await routePoints(trip);
        const checked = new Set((Array.isArray(trip.checkedPlaceIds) ? trip.checkedPlaceIds : []) as number[]);
        const fresh = pts.filter(p => p.type === 'place' && p.id != null && !checked.has(p.id) && straightKm(p, b) <= LIVE_ALERTS.checkInKm).map(p => p.id!);
        fresh.forEach(id => checked.add(id));
        const alerts = { ...((trip.liveAlerts ?? {}) as Alerts), no_signal: null };   // a location again: no-signal can fire later
        await db.update(travelTrips).set({
            lastLat: b.lat, lastLng: b.lng, lastPingAt: new Date(), lastPingSource: source,
            ...(fresh.length ? { checkedPlaceIds: Array.from(checked) } : {}), liveAlerts: alerts, updatedAt: new Date(),
        } as any).where(eq(travelTrips.id, trip.id));
        return { checked: fresh.length ? pts.filter(p => fresh.includes(p.id!)).map(p => p.name) : [], progress: progressOf({ plan: trip.plan, checkedPlaceIds: Array.from(checked) }) };
    }

    /** Trip mode in the traveller's app. */
    static async travellerPing(userId: number, tripId: number, body: unknown) {
        const b = parse(locInput, body);
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TripLiveError('Trip not found.', 404);
        if (t.status !== 'started') return { tracking: false, checked: [], progress: progressOf(t) };
        return { tracking: true, ...(await this.record(t, 'traveller', b, null)) };
    }

    private static async member(token: string) {
        const [m] = await db.select().from(travelTripTeam).where(eq(travelTripTeam.driverToken, token)).limit(1);
        if (!m) throw new TripLiveError('This link is not valid.', 404);
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.id, m.tripId)).limit(1);
        if (!t) throw new TripLiveError('Trip not found.', 404);
        return { m, t };
    }
    /** The driver shares from the trip link while driving. */
    static async driverPing(token: string, body: unknown) {
        const b = parse(locInput, body);
        const { m, t } = await this.member(token);
        if (t.status !== 'started') return { tracking: false };
        await this.record(t, 'driver', b, m.id);
        return { tracking: true };
    }
    /** The driver accepts the trip on the link (Phase 3 partner portal). */
    static async driverAccept(token: string) {
        const { m, t } = await this.member(token);
        if (t.status === 'cancelled' || t.status === 'completed') throw new TripLiveError('This trip is no longer active.');
        if (!m.acceptedAt) {
            await db.update(travelTripTeam).set({ acceptedAt: new Date() }).where(eq(travelTripTeam.id, m.id));
            await recordAudit({ entityType: 'travel', entityId: t.id, action: 'travel_team_accepted', metadata: { code: t.code, name: m.name } });
        }
        return { message: 'Thank you. The travel manager can see you have accepted this trip.' };
    }

    // ── Family link ─────────────────────────────────────────────────────

    static async familyLink(userId: number, tripId: number) {
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TripLiveError('Trip not found.', 404);
        if (!['confirmed', 'started'].includes(t.status)) throw new TripLiveError('The family link works for a booked trip until it ends.');
        let token = t.familyToken;
        if (!token) {
            token = randomBytes(18).toString('base64url');
            await db.update(travelTrips).set({ familyToken: token } as any).where(eq(travelTrips.id, t.id));
        }
        return { url: followUrl(token) };
    }

    /** What family see: where the trip is, how far along, who they are with. Stops when the trip ends. */
    static async followPage(token: string): Promise<string> {
        const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
        const shell = (inner: string, refresh: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="60">' : ''}<title>UniteFix trip</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#F5F7FA;color:#14243B}main{max-width:520px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0}.box{background:#fff;border:1px solid #E6EAF0;border-radius:14px;padding:16px;margin-top:14px}.muted{color:#687588;font-size:14px}a.btn{display:block;text-align:center;background:#09264A;color:#fff;padding:14px;border-radius:999px;text-decoration:none;font-weight:700;margin-top:12px}.bar{height:8px;border-radius:4px;background:#E6EAF0;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:#FF8A00}.pill{display:inline-block;background:#FFF1E0;color:#9A4A00;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:700}</style></head><body><main>${inner}</main></body></html>`;
        const [t] = await db.select().from(travelTrips).where(eq(travelTrips.familyToken, token)).limit(1);
        if (!t) return shell('<h1>This link is not valid</h1><p class="muted">Ask the person who sent it to share it again.</p>', false);
        const first = (t.contactName ?? 'Your family').split(' ')[0];
        if (t.status !== 'started' && t.status !== 'confirmed') {
            return shell(`<h1>${esc(first)}'s trip</h1><div class="box">${t.status === 'completed' ? 'The trip is finished. They are back.' : 'This trip is not active, so the location is no longer shared.'}</div>`, false);
        }
        const p = progressOf(t);
        const team = await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, t.id));
        const ago = t.lastPingAt ? Math.max(0, Math.round((Date.now() - t.lastPingAt.getTime()) / 60_000)) : null;
        return shell(`
            <h1>${esc(first)}'s trip</h1><p class="muted">UniteFix trip ${esc(t.code)} · ${esc(t.pickupText)}${t.tripType === 'round_trip' ? ' round trip' : ` to ${esc(t.dropText)}`}</p>
            <div class="box">${t.status === 'started' ? '<span class="pill">On trip</span>' : `<span class="pill">Starts ${esc(t.startDate)}</span>`}
              ${p.total ? `<p style="margin:10px 0 0">${p.done} of ${p.total} places visited${p.next ? ` · next: <b>${esc(p.next)}</b>` : ''}</p><div class="bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>` : ''}
            </div>
            <div class="box"><b>Last known location</b>
              ${t.lastLat != null && t.lastLng != null ? `<p class="muted">${ago === 0 ? 'Just now' : `${ago} min ago`} · from the ${esc(t.lastPingSource === 'driver' ? 'driver' : 'traveller')}'s phone</p><a class="btn" href="https://maps.google.com/?q=${t.lastLat},${t.lastLng}">Open in Google Maps</a>` : '<p class="muted">Not shared yet. It appears once the trip starts and the app is open.</p>'}
            </div>
            ${team.length ? `<div class="box"><b>Who they are with</b><ul>${team.map(m => `<li>${esc(m.role)}: ${esc(m.name)}${m.vehicle ? `, ${esc(m.vehicle)}` : ''}${m.plate ? ` <b>${esc(m.plate)}</b>` : ''}</li>`).join('')}</ul></div>` : ''}
            <div class="box muted">Worried? Call their travel manager ${esc(t.managerName ?? '')} ${esc(t.managerPhone ?? '')}. In an emergency call 112.</div>`, true);
    }

    // ── Staff: today's trips ────────────────────────────────────────────

    static async board(now = Date.now()) {
        const today = istToday(now);
        const trips = await db.select().from(travelTrips).where(sql`${travelTrips.status} = 'started' OR (${travelTrips.status} = 'confirmed' AND ${travelTrips.startDate} = ${today})`).orderBy(asc(travelTrips.startDate)).limit(200);
        const ids = trips.map(t => t.id);
        const team = ids.length ? await db.select().from(travelTripTeam).where(inArray(travelTripTeam.tripId, ids)) : [];
        const open = ids.length ? await db.select({ tripId: safetyIncidents.tripId, code: safetyIncidents.code, category: safetyIncidents.category, severity: safetyIncidents.severity, kind: safetyIncidents.kind })
            .from(safetyIncidents).where(and(inArray(safetyIncidents.tripId, ids), sql`${safetyIncidents.status} <> 'resolved'`)) : [];
        return trips.map(t => {
            const p = progressOf(t);
            const drivers = team.filter(m => m.tripId === t.id && m.role === 'driver');
            return {
                id: t.id, code: t.code, status: t.status, startDate: t.startDate, days: t.days, contactName: t.contactName, contactPhone: t.contactPhone,
                managerName: t.managerName, from: t.pickupText, people: t.adults + t.children,
                last: t.lastLat != null && t.lastLng != null ? { lat: t.lastLat, lng: t.lastLng, at: t.lastPingAt, source: t.lastPingSource, minutes: t.lastPingAt ? Math.round((now - t.lastPingAt.getTime()) / 60_000) : null } : null,
                progress: p, drivers: drivers.map(d => ({ name: d.name, phone: d.phone, plate: d.plate, time: d.time, day: d.day, accepted: !!d.acceptedAt })),
                cases: open.filter(o => o.tripId === t.id), familyUrl: t.familyToken ? followUrl(t.familyToken) : null,
            };
        });
    }

    /** Every 5 minutes: raise cases for trips on the road that look wrong. Each alert fires once until it clears. */
    static async liveAlerts(now = Date.now()) {
        const trips = await db.select().from(travelTrips).where(eq(travelTrips.status, 'started')).limit(500);
        const { SafetyService } = await import('./safety.service');
        let raised = 0;
        const hour = istHour(now);
        const today = istToday(now);
        for (const t of trips) {
            const alerts: Alerts = { ...((t.liveAlerts ?? {}) as Alerts) };
            const fire = async (key: keyof Alerts, category: 'no_signal' | 'off_route' | 'long_stop' | 'night_driving', text: string, mark: string) => {
                alerts[key] = mark; raised++;
                await SafetyService.systemAlert(t.id, category, text);
            };
            const recent = await db.select().from(travelTripPings).where(and(eq(travelTripPings.tripId, t.id), gte(travelTripPings.at, new Date(now - 90 * 60_000)))).orderBy(desc(travelTripPings.at)).limit(200);
            const last = recent[0];
            const who = `${t.contactName} (${t.contactPhone})`;
            // No signal: it was sharing in the last 90 minutes, and nothing for 20.
            if (last && now - last.at!.getTime() > LIVE_ALERTS.noSignalMinutes * 60_000 && !alerts.no_signal) {
                await fire('no_signal', 'no_signal', `No location from trip ${t.code} for ${Math.round((now - last.at!.getTime()) / 60_000)} minutes (phone off, no signal, or the app closed). Call ${who}.`, new Date(now).toISOString());
            }
            if (last && now - last.at!.getTime() <= LIVE_ALERTS.noSignalMinutes * 60_000) {
                const pts = await routePoints(t);
                // Off the route: further than 15 km from every leg of the plan.
                if (pts.length >= 2) {
                    let best = Infinity;
                    for (let i = 1; i < pts.length; i++) best = Math.min(best, kmToSegment(last, pts[i - 1], pts[i]));
                    if (best > LIVE_ALERTS.offRouteKm && !alerts.off_route) {
                        await fire('off_route', 'off_route', `Trip ${t.code} is ${Math.round(best)} km from the planned route. Location: https://maps.google.com/?q=${last.lat},${last.lng}. Check with ${who}.`, new Date(now).toISOString());
                    } else if (best <= LIVE_ALERTS.offRouteKm && alerts.off_route) alerts.off_route = null;
                }
                // Long stop: 45 minutes within 300 m, away from every planned stop, in the daytime.
                const window = recent.filter(r => now - r.at!.getTime() <= LIVE_ALERTS.longStopMinutes * 60_000);
                const spanOk = window.length >= 3 && now - window[window.length - 1].at!.getTime() >= (LIVE_ALERTS.longStopMinutes - 5) * 60_000;
                const still = spanOk && window.every(r => straightKm(r, last) * 1000 <= LIVE_ALERTS.longStopRadiusM);
                const atStop = pts.some(p => straightKm(p, last) <= LIVE_ALERTS.checkInKm);
                const daytime = hour >= 7 && hour < 21;
                if (still && !atStop && daytime && !alerts.long_stop) {
                    await fire('long_stop', 'long_stop', `Trip ${t.code} has not moved for ${LIVE_ALERTS.longStopMinutes} minutes, away from any planned stop. Location: https://maps.google.com/?q=${last.lat},${last.lng}. Breakdown? Call ${who}.`, new Date(now).toISOString());
                } else if (!still && alerts.long_stop) alerts.long_stop = null;
                // Night driving: moving after 10 pm (or before 5 am), once a night.
                const night = hour >= LIVE_ALERTS.nightFromHour || hour < LIVE_ALERTS.nightUntilHour;
                const quarter = recent.filter(r => now - r.at!.getTime() <= 15 * 60_000);
                const moved = quarter.length >= 2 && straightKm(quarter[quarter.length - 1], quarter[0]) >= 2;
                const fast = (last.speed ?? 0) > 4;
                if (night && (moved || fast) && alerts.night_driving !== today) {
                    await fire('night_driving', 'night_driving', `Trip ${t.code} is on the road at night. Check the driver is rested and the route is safe. Call ${who}.`, today);
                }
            }
            if (JSON.stringify(alerts) !== JSON.stringify(t.liveAlerts ?? {})) {
                await db.update(travelTrips).set({ liveAlerts: alerts } as any).where(eq(travelTrips.id, t.id));
            }
        }
        return raised;
    }

    /** Daily: locations older than 30 days go, except on trips with a safety case. */
    static async prune(now = Date.now()) {
        const r = await db.execute(sql`DELETE FROM travel_trip_pings p WHERE p.at < ${new Date(now - 30 * 86_400_000)}
            AND NOT EXISTS (SELECT 1 FROM safety_incidents s WHERE s.trip_id = p.trip_id)`);
        const n = (r as any).rowCount ?? 0;
        if (n) logger.info(`[TRIP] pruned ${n} old trip locations`);
        return n;
    }

    // ── After the trip: ratings ─────────────────────────────────────────

    static async rate(userId: number, tripId: number, body: unknown) {
        const b = parse(z.object({ ratings: z.array(z.object({
            teamMemberId: z.number().int().positive(), stars: z.number().int().min(1).max(5),
            tags: z.array(z.string().trim().max(40)).max(8).default([]), comment: z.string().trim().max(1000).nullish(),
        })).min(1).max(30) }), body);
        const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, tripId), eq(travelTrips.customerUserId, userId))).limit(1);
        if (!t) throw new TripLiveError('Trip not found.', 404);
        if (t.status !== 'completed') throw new TripLiveError('You can rate the trip once it is finished.');
        if (t.ratedAt) throw new TripLiveError('You have already rated this trip. Thank you!');
        const team = await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, tripId));
        const rows = b.ratings.map(r => {
            const m = team.find(x => x.id === r.teamMemberId);
            if (!m) throw new TripLiveError('That person was not on this trip.');
            const allowed = RATING_TAGS[m.role] ?? [];
            return { tripId, teamMemberId: m.id, role: m.role, name: m.name, employeeId: m.employeeId, partnerId: m.partnerId, phone: m.phone, stars: r.stars, tags: r.tags.filter(x => allowed.includes(x)), comment: r.comment ?? null };
        });
        await db.insert(travelRatings).values(rows);
        await db.update(travelTrips).set({ ratedAt: new Date() } as any).where(eq(travelTrips.id, tripId));
        const low = rows.filter(r => r.stars < 3);
        if (low.length) {
            const { SafetyService } = await import('./safety.service');
            await SafetyService.systemAlert(tripId, 'low_rating', `Low rating on trip ${t.code}: ${low.map(r => `${r.name} (${r.role}) ${r.stars}★${r.comment ? ` "${r.comment}"` : ''}`).join('; ')}. Call ${t.contactName} (${t.contactPhone}) to follow up.`);
        }
        return { message: low.length ? 'Thank you. Your travel manager will call you about what went wrong.' : 'Thank you for rating your trip!' };
    }

    /** Scores: average stars and strikes per travel partner and per expert, last 6 months. */
    static async scores() {
        const since = new Date(Date.now() - STRIKE_WINDOW_DAYS * 86_400_000);
        const byPartner = await db.select({ partnerId: travelRatings.partnerId, avg: sql<number>`round(avg(${travelRatings.stars})::numeric, 1)::float`, n: sql<number>`count(*)::int` })
            .from(travelRatings).where(and(gte(travelRatings.createdAt, since), sql`${travelRatings.partnerId} IS NOT NULL`)).groupBy(travelRatings.partnerId);
        const byExpert = await db.select({ employeeId: travelRatings.employeeId, avg: sql<number>`round(avg(${travelRatings.stars})::numeric, 1)::float`, n: sql<number>`count(*)::int` })
            .from(travelRatings).where(and(gte(travelRatings.createdAt, since), sql`${travelRatings.employeeId} IS NOT NULL`)).groupBy(travelRatings.employeeId);
        const strikes = await db.select({ subject: safetyIncidents.subject }).from(safetyIncidents).where(and(eq(safetyIncidents.action, 'strike'), gte(safetyIncidents.resolvedAt, since)));
        const cases = await db.select({ subject: safetyIncidents.subject }).from(safetyIncidents).where(and(gte(safetyIncidents.createdAt, since), eq(safetyIncidents.kind, 'report')));
        const count = (rows: Array<{ subject: unknown }>, key: 'partnerId' | 'employeeId', id: number) => rows.filter(r => (r.subject as any)?.[key] === id).length;
        return {
            partners: Object.fromEntries(byPartner.map(r => [r.partnerId!, { avg: r.avg, ratings: r.n, strikes: count(strikes, 'partnerId', r.partnerId!), reports: count(cases, 'partnerId', r.partnerId!) }])),
            experts: Object.fromEntries(byExpert.map(r => [r.employeeId!, { avg: r.avg, ratings: r.n, strikes: count(strikes, 'employeeId', r.employeeId!), reports: count(cases, 'employeeId', r.employeeId!) }])),
        };
    }

    // ── Money: what was paid to partners, the balance collected, the margin ──

    static async money(tripIds: number[]) {
        if (!tripIds.length) return new Map<number, { payouts: Array<typeof travelTripPayouts.$inferSelect>; ratings: Array<typeof travelRatings.$inferSelect> }>();
        const payouts = await db.select().from(travelTripPayouts).where(inArray(travelTripPayouts.tripId, tripIds)).orderBy(asc(travelTripPayouts.id));
        const ratings = await db.select().from(travelRatings).where(inArray(travelRatings.tripId, tripIds));
        return new Map(tripIds.map(id => [id, { payouts: payouts.filter(p => p.tripId === id), ratings: ratings.filter(r => r.tripId === id) }]));
    }
    static summary(t: Trip, payouts: Array<{ amount: number }>) {
        const paidOut = payouts.reduce((s, p) => s + p.amount, 0);
        const advance = t.advanceStatus === 'paid' ? (t.advanceAmount ?? 0) : 0;
        const collected = advance + (t.balanceReceived ?? 0);
        const price = t.quoteAmount ?? 0;
        return { price, advance, balanceReceived: t.balanceReceived ?? 0, balanceDue: Math.max(0, price - collected), collected, paidOut, margin: price - paidOut, cashInHand: collected - paidOut };
    }

    static async addPayout(adminId: number, tripId: number, body: unknown) {
        const b = parse(z.object({
            partnerId: z.number().int().positive().nullish(), teamMemberId: z.number().int().positive().nullish(), payee: z.string().trim().min(2).max(100),
            amount: z.number().int().min(1).max(10_000_000), method: z.enum(['upi', 'bank', 'cash', 'other']).default('upi'),
            reference: z.string().trim().max(100).nullish(), note: z.string().trim().max(300).nullish(),
            paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        }), body);
        const [t] = await db.select({ id: travelTrips.id, code: travelTrips.code }).from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) throw new TripLiveError('Trip not found.', 404);
        const { TravelPartnerHub } = await import('./travel-partner.service');
        if (await TravelPartnerHub.paidThroughHub(b.partnerId)) {
            throw new TripLiveError('This partner has a Hub account: their agreed pay goes on their statement when the trip ends and is paid through Partner Settlements. Recording it here would pay them twice.', 409);
        }
        const [row] = await db.insert(travelTripPayouts).values({ tripId, partnerId: b.partnerId ?? null, teamMemberId: b.teamMemberId ?? null, payee: b.payee, amount: b.amount, method: b.method, reference: b.reference ?? null, note: b.note ?? null, paidOn: b.paidOn ?? istToday(), createdBy: adminId }).returning();
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_payout_recorded', changedBy: adminId, metadata: { code: t.code, payee: b.payee, amount: b.amount, method: b.method, reference: b.reference ?? null } });
        return row;
    }
    static async deletePayout(adminId: number, tripId: number, payoutId: number) {
        const [row] = await db.delete(travelTripPayouts).where(and(eq(travelTripPayouts.id, payoutId), eq(travelTripPayouts.tripId, tripId))).returning();
        if (!row) throw new TripLiveError('Not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_payout_removed', changedBy: adminId, metadata: { payee: row.payee, amount: row.amount } });
    }
    static async setBalance(adminId: number, tripId: number, body: unknown) {
        const b = parse(z.object({ amount: z.number().int().min(0).max(10_000_000), method: z.enum(['upi', 'bank', 'cash', 'other']).default('cash') }), body);
        const [row] = await db.update(travelTrips).set({ balanceReceived: b.amount, balanceMethod: b.method, updatedAt: new Date() } as any).where(eq(travelTrips.id, tripId)).returning();
        if (!row) throw new TripLiveError('Trip not found.', 404);
        await recordAudit({ entityType: 'travel', entityId: tripId, action: 'travel_balance_recorded', changedBy: adminId, metadata: { code: row.code, amount: b.amount, method: b.method } });
        return row;
    }

    /** Tell the traveller after the trip that they can rate it. */
    static async askForRating(tripId: number) {
        const [t] = await db.select({ userId: travelTrips.customerUserId, code: travelTrips.code }).from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (t?.userId) void NotificationService.sendToUser(t.userId, 'How was your trip?', `Rate your driver, stay and guide for trip ${t.code}. It takes a minute and helps other travellers.`, 'travel_trip', { tripId, url: 'unitefix://travel' }).catch(() => {});
    }
}

