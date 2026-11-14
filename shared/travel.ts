/**
 * Travel planner: the shapes the app, the admin and the server share, and the
 * route optimiser that turns "these places, from here, one way or round" into
 * a day-by-day plan.
 *
 * Places, regions and pickup points are staff-managed rows (travel_* tables).
 * Distances are straight-line km times a road factor for the ghats and coast
 * roads of Uttara Kannada, driven at a hill-road average. They are estimates
 * for planning; the travel manager confirms the real route and the quotation.
 */

export type TripType = 'round_trip' | 'one_way';
export type Pace = 'relaxed' | 'balanced' | 'packed';
export type StayChoice = 'none' | 'budget' | 'standard' | 'premium' | 'homestay';

export const TRIP_STATUSES = ['new', 'assigned', 'contacted', 'quoted', 'confirmed', 'cancelled'] as const;
export type TripStatus = typeof TRIP_STATUSES[number];

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
    new: 'Waiting for a travel manager',
    assigned: 'Travel manager assigned',
    contacted: 'In discussion',
    quoted: 'Quotation sent',
    confirmed: 'Confirmed',
    cancelled: 'Cancelled',
};

export const PLACE_KINDS = ['beach', 'falls', 'temple', 'activity', 'viewpoint', 'nature', 'heritage', 'culture'] as const;
export type PlaceKind = typeof PLACE_KINDS[number];
export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
    beach: 'Beach', falls: 'Waterfall', temple: 'Temple', activity: 'Activity', viewpoint: 'Viewpoint',
    nature: 'Nature', heritage: 'Heritage', culture: 'Culture',
};

export interface Point { id: number; name: string; lat: number; lng: number }
export interface PlanPlace extends Point { visitMinutes: number; regionId: number | null; regionName?: string | null; featured?: boolean; bestMonths?: number[]; kind?: string }

export interface PlanStop {
    type: 'start' | 'place' | 'end';
    id: number | null;
    name: string;
    /** Road km and minutes from the previous stop (0 for the first). */
    driveKm: number;
    driveMinutes: number;
    visitMinutes: number;
}
export interface PlanDay { day: number; stops: PlanStop[]; km: number; minutes: number; stayNear: string | null }
export interface PlanSuggestion { id: number; name: string; regionName: string | null; detourKm: number; inSeason: boolean; featured: boolean }
export interface TripPlan {
    tripType: TripType;
    pace: Pace;
    order: number[];
    days: PlanDay[];
    totalKm: number;
    totalDriveMinutes: number;
    totalVisitMinutes: number;
    nights: number;
    suggestions: PlanSuggestion[];
    /** True when the start has no map position (typed by the customer): the plan starts at the first place. */
    startUnknown: boolean;
}

/** Road km per straight-line km, and the average speed on these roads. */
export const ROAD_FACTOR = 1.35;
export const AVG_KMPH = 38;
/** Hours of travel and sightseeing in a day, by pace. */
export const DAY_MINUTES: Record<Pace, number> = { relaxed: 7 * 60, balanced: 9 * 60, packed: 11 * 60 };

export function straightKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const roadKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => straightKm(a, b) * ROAD_FACTOR;
export const driveMinutes = (km: number) => Math.round(km / AVG_KMPH * 60);

/** Length of a route through points in order (and back to the first when closed). */
function routeKm(pts: Array<{ lat: number; lng: number }>, closed: boolean): number {
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += roadKm(pts[i - 1], pts[i]);
    if (closed && pts.length > 1) km += roadKm(pts[pts.length - 1], pts[0]);
    return km;
}

/**
 * Best order of the places between a fixed start and (optionally) a fixed end.
 * Nearest neighbour, then 2-opt until nothing improves. Small inputs (a trip
 * has a handful of places) so this is effectively optimal.
 */
export function orderPlaces<T extends { lat: number; lng: number }>(places: T[], start: { lat: number; lng: number } | null, end: { lat: number; lng: number } | null): T[] {
    if (places.length <= 1) return [...places];
    const seq = (first: T | null) => {
        const left = [...places];
        const out: T[] = [];
        let cur: { lat: number; lng: number } | null = start;
        if (!cur && first) { out.push(first); left.splice(left.indexOf(first), 1); cur = first; }
        while (left.length) {
            let bi = 0, bd = Infinity;
            left.forEach((p, i) => { const d = cur ? roadKm(cur, p) : 0; if (d < bd) { bd = d; bi = i; } });
            cur = left[bi]; out.push(left[bi]); left.splice(bi, 1);
        }
        return out;
    };
    const cost = (o: T[]) => routeKm([...(start ? [start] : []), ...o, ...(end ? [end] : [])], false);
    // With no start, try each place as the first and keep the best.
    let best = start ? seq(null) : places.map(p => seq(p)).reduce((a, b) => (cost(b) < cost(a) ? b : a));
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 0; i < best.length - 1; i++) {
            for (let k = i + 1; k < best.length; k++) {
                const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
                if (cost(cand) + 1e-9 < cost(best)) { best = cand; improved = true; }
            }
        }
    }
    return best;
}

/** Split the ordered route into days that fit the pace. */
export function planTrip(input: {
    places: PlanPlace[];
    start: Point | null;
    startName?: string | null;
    end: Point | null;
    endName?: string | null;
    tripType: TripType;
    pace: Pace;
    candidates?: PlanPlace[];
    month?: number;
    /** Towns to name overnight stops by (the pickup points): "Night near Murdeshwar", not the island. */
    towns?: Point[];
}): TripPlan {
    const { tripType, pace } = input;
    const start = input.start;
    const end = tripType === 'round_trip' ? start : input.end;
    const ordered = orderPlaces(input.places, start, end);
    const cap = DAY_MINUTES[pace];

    const legs: PlanStop[] = [];
    const startUnknown = !start;
    legs.push({ type: 'start', id: start?.id ?? null, name: start?.name ?? input.startName ?? (ordered[0]?.name ?? 'Start'), driveKm: 0, driveMinutes: 0, visitMinutes: 0 });
    let prev: { lat: number; lng: number } | null = start;
    for (const p of ordered) {
        const km = prev ? roadKm(prev, p) : 0;
        legs.push({ type: 'place', id: p.id, name: p.name, driveKm: Math.round(km), driveMinutes: driveMinutes(km), visitMinutes: p.visitMinutes });
        prev = p;
    }
    const endPoint = end;
    const endName = tripType === 'round_trip' ? (start?.name ?? input.startName ?? null) : (end?.name ?? input.endName ?? null);
    if (endName) {
        const km = prev && endPoint ? roadKm(prev, endPoint) : 0;
        legs.push({ type: 'end', id: endPoint?.id ?? null, name: endName, driveKm: Math.round(km), driveMinutes: driveMinutes(km), visitMinutes: 0 });
    }

    // Name a night by the nearest town within 30 km of where the day ends, else the place itself.
    const coords = new Map(ordered.map(p => [p.id, p] as const));
    const stayTown = (s: PlanStop): string => {
        const at = s.id != null ? coords.get(s.id) : null;
        if (!at || !input.towns?.length) return s.name;
        let best: Point | null = null, bd = 30;
        for (const t of input.towns) { const d = straightKm(at, t); if (d < bd) { bd = d; best = t; } }
        return best?.name ?? s.name;
    };

    const days: PlanDay[] = [];
    let cur: PlanDay = { day: 1, stops: [], km: 0, minutes: 0, stayNear: null };
    for (const s of legs) {
        const need = s.driveMinutes + s.visitMinutes;
        // A new day when this stop would overrun the day, unless the day is still empty
        // (or holds only the start). The last leg home may overrun by up to 2 hours.
        const onlyStart = cur.stops.every(x => x.type === 'start');
        const slack = s.type === 'end' ? 120 : 0;
        if (!onlyStart && cur.minutes + need > cap + slack) {
            const last = cur.stops[cur.stops.length - 1];
            cur.stayNear = last ? stayTown(last) : null;
            days.push(cur);
            cur = { day: cur.day + 1, stops: [], km: 0, minutes: 0, stayNear: null };
        }
        cur.stops.push(s); cur.km += s.driveKm; cur.minutes += need;
    }
    days.push(cur);

    const chosen = new Set(ordered.map(p => p.id));
    const month = input.month ?? (new Date().getMonth() + 1);
    const routePts = [...(start ? [start] : []), ...ordered, ...(end && tripType === 'one_way' ? [end] : [])];
    const suggestions: PlanSuggestion[] = (input.candidates ?? [])
        .filter(c => !chosen.has(c.id))
        .map(c => {
            // Cheapest place to slot it into the route: the extra road km.
            let detour = Infinity;
            if (routePts.length === 0) detour = 0;
            else if (routePts.length === 1) detour = roadKm(routePts[0], c);
            else for (let i = 1; i < routePts.length; i++) detour = Math.min(detour, roadKm(routePts[i - 1], c) + roadKm(c, routePts[i]) - roadKm(routePts[i - 1], routePts[i]));
            return { id: c.id, name: c.name, regionName: c.regionName ?? null, detourKm: Math.max(0, Math.round(detour)), inSeason: !!c.bestMonths?.includes(month), featured: !!c.featured };
        })
        .filter(s => s.detourKm <= 25)
        .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.inSeason) - Number(a.inSeason) || a.detourKm - b.detourKm)
        .slice(0, 4);

    return {
        tripType, pace, order: ordered.map(p => p.id), days,
        totalKm: days.reduce((s, d) => s + d.km, 0),
        totalDriveMinutes: legs.reduce((s, l) => s + l.driveMinutes, 0),
        totalVisitMinutes: legs.reduce((s, l) => s + l.visitMinutes, 0),
        nights: Math.max(0, days.length - 1),
        suggestions, startUnknown,
    };
}

/** Seats needed → the cab a manager would usually quote. */
export function suggestedVehicle(people: number): string {
    if (people <= 4) return 'Sedan (4 seats)';
    if (people <= 7) return 'SUV / Innova (7 seats)';
    if (people <= 12) return 'Tempo Traveller (12 seats)';
    if (people <= 17) return 'Tempo Traveller (17 seats)';
    return 'Mini bus';
}
