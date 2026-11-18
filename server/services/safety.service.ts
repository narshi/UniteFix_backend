/**
 * Safety desk (shared/safety.ts). SOS, help requests and reports about
 * behaviour, from travellers on a trip and customers during a home-service
 * visit. One queue for staff; severity sets how fast someone must call back.
 *
 * A critical report pauses the person involved from new jobs until staff
 * review it: a service expert (employees.is_active), a travel partner, or a
 * partner's driver (flagged by phone, so they can't be put on another trip).
 *
 * SOS: staff are alerted at once; if nobody acknowledges within 2 minutes the
 * safety lead (Travel settings) is alerted too. Texts to the customer's
 * emergency contacts go from the customer's own phone, so they always arrive.
 */

import { randomBytes } from 'crypto';
import { z } from 'zod';
import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { safetyIncidents, safetyPings, travelTrips, travelTripTeam, travelPartners, serviceRequests, employees, users, adminUsers } from '@shared/schema';
import {
    REPORT_CATEGORIES, HELP_CATEGORIES, SAFETY_ACTIONS, SOS_SHARE_MINUTES, STRIKE_WINDOW_DAYS, STRIKES_TO_REMOVE, RESPONSE_MINUTES,
    type IncidentSubject, type Severity, type SafetyAction,
} from '@shared/safety';
import { NotificationService } from './notification.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class SafetyError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> => {
    const r = schema.safeParse(body);
    if (!r.success) { const i = r.error.issues[0]; throw new SafetyError(i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input'); }
    return r.data;
};
const phone10 = z.string().trim().transform(s => s.replace(/\D/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/, 'a 10-digit Indian mobile number'));
const where = z.object({
    context: z.enum(['trip', 'service']),
    tripId: z.number().int().positive().nullish(),
    serviceRequestId: z.number().int().positive().nullish(),
});
const coords = { lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(), accuracy: z.number().min(0).max(100_000).nullish() };
const token = () => randomBytes(18).toString('base64url');
const code = () => 'SF-' + randomBytes(5).toString('base64').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, '4');
const publicBase = () => (process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'https://unitefix-backend.onrender.com').replace(/\/$/, '');
export const liveUrl = (t: string) => `${publicBase()}/api/safety/live/${t}`;
const mapsUrl = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;

/** Staff are told by email (ADMIN_ALERT_EMAIL) and see it on the Safety desk, which sounds an alarm. */
async function alertStaff(title: string, body: string, data: Record<string, unknown>, alsoEmail?: string | null) {
    void NotificationService.sendToAdmins(title, body, data).catch(() => {});
    if (alsoEmail) {
        try { await NotificationService.sendEmail(alsoEmail, title, `<p style="font:15px/1.5 sans-serif">${body.replace(/</g, '&lt;')}</p><p style="font:13px sans-serif">Open Admin → Safety desk.</p>`); }
        catch (e: any) { logger.warn(`[SAFETY] email to ${alsoEmail} failed: ${e?.message}`); }
    }
}

export class SafetyService {
    // ── Emergency contacts ──────────────────────────────────────────────

    static async contacts(userId: number) {
        const [u] = await db.select({ c: users.emergencyContacts }).from(users).where(eq(users.id, userId)).limit(1);
        return (Array.isArray(u?.c) ? u!.c : []) as Array<{ name: string; phone: string }>;
    }
    static async saveContacts(userId: number, body: unknown) {
        const b = parse(z.object({ contacts: z.array(z.object({ name: z.string().trim().min(1).max(60), phone: phone10 })).max(2) }), body);
        const [me] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
        if (b.contacts.some(c => me?.phone && c.phone === String(me.phone).slice(-10))) throw new SafetyError('Add someone else: this is your own number.');
        await db.update(users).set({ emergencyContacts: b.contacts } as any).where(eq(users.id, userId));
        return b.contacts;
    }

    // ── What the customer is in: a trip or a service visit ─────────────

    /** Check the customer owns the trip or booking, and gather who is involved. */
    private static async scope(userId: number, w: z.infer<typeof where>) {
        if (w.context === 'trip') {
            if (!w.tripId) throw new SafetyError('Which trip?');
            const [t] = await db.select().from(travelTrips).where(and(eq(travelTrips.id, w.tripId), eq(travelTrips.customerUserId, userId))).limit(1);
            if (!t) throw new SafetyError('Trip not found.', 404);
            const team = await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, t.id));
            return { trip: t, sr: null, team, label: `trip ${t.code}`, managerName: t.managerName, managerPhone: t.managerPhone };
        }
        if (!w.serviceRequestId) throw new SafetyError('Which booking?');
        const [sr] = await db.select({ id: serviceRequests.id, ref: serviceRequests.serviceId, userId: serviceRequests.userId, providerId: serviceRequests.providerId, serviceType: serviceRequests.serviceType })
            .from(serviceRequests).where(and(eq(serviceRequests.id, w.serviceRequestId), eq(serviceRequests.userId, userId))).limit(1);
        if (!sr) throw new SafetyError('Booking not found.', 404);
        return { trip: null, sr, team: [] as Array<typeof travelTripTeam.$inferSelect>, label: `booking ${sr.ref}`, managerName: null, managerPhone: null };
    }

    private static async expertSubject(employeeId: number | null | undefined): Promise<IncidentSubject | null> {
        if (!employeeId) return null;
        const [e] = await db.select({ id: employees.id, name: employees.fullName, bp: employees.managedByPartnerId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
        return e ? { type: 'expert', name: e.name, employeeId: e.id, businessPartnerId: e.bp ?? null } : null;
    }

    private static async create(v: {
        kind: 'sos' | 'report' | 'help'; severity: Severity; category: string | null; context: 'trip' | 'service';
        tripId: number | null; serviceRequestId: number | null; reporterUserId: number; subject: IncidentSubject | null;
        description: string | null; lat?: number | null; lng?: number | null; live?: boolean;
    }) {
        for (let i = 0; i < 5; i++) {
            try {
                const [row] = await db.insert(safetyIncidents).values({
                    code: code(), kind: v.kind, severity: v.severity, category: v.category, context: v.context, tripId: v.tripId, serviceRequestId: v.serviceRequestId,
                    reporterUserId: v.reporterUserId, subject: v.subject as any, description: v.description, lat: v.lat ?? null, lng: v.lng ?? null,
                    liveToken: v.live ? token() : null, liveUntil: v.live ? new Date(Date.now() + SOS_SHARE_MINUTES * 60_000) : null,
                }).returning();
                return row;
            } catch (e: any) { if (e?.code !== '23505') throw e; }
        }
        throw new SafetyError('Could not save. Try again.', 500);
    }

    // ── SOS ─────────────────────────────────────────────────────────────

    static async sos(userId: number, body: unknown) {
        const b = parse(where.extend(coords), body);
        const s = await this.scope(userId, b);
        const [me] = await db.select({ name: users.username, phone: users.phone, contacts: users.emergencyContacts }).from(users).where(eq(users.id, userId)).limit(1);
        const subject = s.sr ? await this.expertSubject(s.sr.providerId) : null;
        const inc = await this.create({
            kind: 'sos', severity: 'critical', category: 'sos', context: b.context, tripId: s.trip?.id ?? null, serviceRequestId: s.sr?.id ?? null,
            reporterUserId: userId, subject, description: null, lat: b.lat, lng: b.lng, live: true,
        });
        if (b.lat != null && b.lng != null) await db.insert(safetyPings).values({ incidentId: inc.id, lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null });
        const team = s.team.map(m => `${m.role}: ${m.name}${m.plate ? ` (${m.plate})` : ''}`).join('; ');
        const where_ = b.lat != null && b.lng != null ? mapsUrl(b.lat, b.lng) : 'location not shared';
        await alertStaff(`SOS ${inc.code}: ${me?.name ?? 'A customer'} on ${s.label}`,
            `SOS from ${me?.name ?? 'a customer'} (${me?.phone ?? '?'}) on ${s.label}. Location: ${where_}. Live: ${liveUrl(inc.liveToken!)}.${team ? ` Team: ${team}.` : ''}${subject?.name ? ` Expert: ${subject.name}.` : ''} Call them now.`,
            { incidentId: inc.id, code: inc.code });
        await recordAudit({ entityType: 'safety', entityId: inc.id, action: 'safety_sos', changedBy: userId, metadata: { code: inc.code, context: b.context, tripId: s.trip?.id, serviceRequestId: s.sr?.id } });
        logger.warn(`[SAFETY] SOS ${inc.code} by user #${userId} on ${s.label}`);
        const contacts = (Array.isArray(me?.contacts) ? me!.contacts : []) as Array<{ name: string; phone: string }>;
        return {
            id: inc.id, code: inc.code, liveUrl: liveUrl(inc.liveToken!), liveMinutes: SOS_SHARE_MINUTES,
            manager: s.managerName && s.managerPhone ? { name: s.managerName, phone: s.managerPhone } : null,
            contacts,
            // The text the app puts in the customer's own SMS to their contacts.
            smsText: `SOS from ${me?.name ?? 'me'} via UniteFix. I need help. My live location: ${liveUrl(inc.liveToken!)}${b.lat != null && b.lng != null ? ` (map: ${mapsUrl(b.lat, b.lng)})` : ''}`,
        };
    }

    /** The app sends the location every 30 s while an SOS is live. */
    static async ping(userId: number, incidentId: number, body: unknown) {
        const b = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).nullish() }), body);
        const [inc] = await db.select().from(safetyIncidents).where(and(eq(safetyIncidents.id, incidentId), eq(safetyIncidents.reporterUserId, userId))).limit(1);
        if (!inc) throw new SafetyError('Not found.', 404);
        if (!inc.liveUntil || inc.liveUntil.getTime() < Date.now()) return { live: false };
        await db.insert(safetyPings).values({ incidentId, lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null });
        await db.update(safetyIncidents).set({ lat: b.lat, lng: b.lng, updatedAt: new Date() }).where(eq(safetyIncidents.id, incidentId));
        return { live: true, until: inc.liveUntil };
    }

    /** "I'm safe": stop sharing. The case stays open for staff. */
    static async stopSharing(userId: number, incidentId: number) {
        await db.update(safetyIncidents).set({ liveUntil: new Date(), updatedAt: new Date() }).where(and(eq(safetyIncidents.id, incidentId), eq(safetyIncidents.reporterUserId, userId)));
    }

    /** The page family and staff open from the SOS link: the latest position, refreshing. */
    static async livePage(t: string): Promise<string> {
        const [inc] = await db.select().from(safetyIncidents).where(eq(safetyIncidents.liveToken, t)).limit(1);
        const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
        const page = (title: string, inner: string, refresh = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="30">' : ''}<title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#F5F7FA;color:#14243B}main{max-width:520px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 6px}.box{background:#fff;border:1px solid #E6EAF0;border-radius:14px;padding:16px;margin-top:14px}.sos{background:#B4232A;color:#fff;border-radius:14px;padding:14px 16px}a.btn{display:block;text-align:center;background:#09264A;color:#fff;padding:14px;border-radius:999px;text-decoration:none;font-weight:700;margin-top:12px}.muted{color:#687588;font-size:14px}</style></head><body><main>${inner}</main></body></html>`;
        if (!inc) return page('Link not found', '<h1>This link is not valid</h1><p class="muted">Ask the person who sent it to share it again.</p>');
        const [last] = await db.select().from(safetyPings).where(eq(safetyPings.incidentId, inc.id)).orderBy(desc(safetyPings.at)).limit(1);
        const [who] = inc.reporterUserId ? await db.select({ name: users.username }).from(users).where(eq(users.id, inc.reporterUserId)).limit(1) : [];
        const live = !!inc.liveUntil && inc.liveUntil.getTime() > Date.now();
        const at = last?.at ?? inc.createdAt;
        const lat = last?.lat ?? inc.lat, lng = last?.lng ?? inc.lng;
        const ago = at ? Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000)) : null;
        const team = inc.tripId ? await db.select().from(travelTripTeam).where(eq(travelTripTeam.tripId, inc.tripId)) : [];
        return page(`${who?.name ?? 'Someone'} shared their location`, `
            <div class="sos"><b>${esc(who?.name ?? 'Someone')} pressed SOS on UniteFix.</b><br>${live ? 'Their location updates here every 30 seconds.' : 'They are no longer sharing their location.'}</div>
            <div class="box"><h1>Last known location</h1>
            ${lat != null && lng != null ? `<p class="muted">${ago === 0 ? 'Just now' : `${ago} min ago`}${last?.accuracy ? ` · within ${Math.round(last.accuracy)} m` : ''}</p><a class="btn" href="${mapsUrl(lat, lng)}">Open in Google Maps</a>` : '<p class="muted">No location was shared yet.</p>'}
            </div>
            ${team.length ? `<div class="box"><b>Who they are with</b><ul>${team.map(m => `<li>${esc(m.role)}: ${esc(m.name)}${m.vehicle ? `, ${esc(m.vehicle)}` : ''}${m.plate ? ` <b>${esc(m.plate)}</b>` : ''}</li>`).join('')}</ul></div>` : ''}
            <div class="box"><b>In danger? Call 112</b> (police and ambulance).<p class="muted">UniteFix staff have been alerted and are calling them. Case ${esc(inc.code)}.</p></div>`, live);
    }

    // ── Reports and help ────────────────────────────────────────────────

    static async report(userId: number, body: unknown) {
        const b = parse(where.extend({
            category: z.enum(Object.keys(REPORT_CATEGORIES) as [keyof typeof REPORT_CATEGORIES, ...Array<keyof typeof REPORT_CATEGORIES>]),
            teamMemberId: z.number().int().positive().nullish(),
            about: z.string().trim().max(100).nullish(),
            description: z.string().trim().max(2000).nullish(),
            ...coords,
        }), body);
        const s = await this.scope(userId, b);
        let subject: IncidentSubject | null = null;
        if (s.sr) subject = await this.expertSubject(s.sr.providerId);
        else if (b.teamMemberId) {
            const m = s.team.find(x => x.id === b.teamMemberId);
            if (!m) throw new SafetyError('That person is not on this trip.');
            subject = { type: m.role as IncidentSubject['type'], name: m.name, teamMemberId: m.id, employeeId: m.employeeId, partnerId: m.partnerId, phone: m.phone ?? null };
        } else subject = { type: 'other', name: b.about ?? null };
        const severity = REPORT_CATEGORIES[b.category].severity as Severity;
        const inc = await this.create({
            kind: 'report', severity, category: b.category, context: b.context, tripId: s.trip?.id ?? null, serviceRequestId: s.sr?.id ?? null,
            reporterUserId: userId, subject, description: b.description ?? null, lat: b.lat, lng: b.lng,
        });
        let paused: unknown = null;
        if (severity === 'critical') paused = await this.pause(inc.id, subject);
        await alertStaff(`${severity === 'critical' ? 'CRITICAL report' : 'Report'} ${inc.code}: ${REPORT_CATEGORIES[b.category].label}`,
            `${REPORT_CATEGORIES[b.category].label} on ${s.label}${subject?.name ? `, about ${subject.name}` : ''}. ${severity === 'critical' ? 'They are paused from new jobs. Call the customer within 5 minutes.' : `Respond within ${RESPONSE_MINUTES[severity] >= 60 ? `${RESPONSE_MINUTES[severity] / 60} h` : `${RESPONSE_MINUTES[severity]} min`}.`}`,
            { incidentId: inc.id, code: inc.code });
        await recordAudit({ entityType: 'safety', entityId: inc.id, action: 'safety_report', changedBy: userId, metadata: { code: inc.code, category: b.category, severity, paused } });
        return {
            id: inc.id, code: inc.code, severity,
            message: severity === 'critical'
                ? 'Reported. Our team will call you within 5 minutes. If you are in danger, call 112 now.'
                : severity === 'high' ? 'Reported. Our team will call you within 30 minutes.' : 'Reported. Our team will look into it and get back to you within a day.',
        };
    }

    static async help(userId: number, body: unknown) {
        const b = parse(where.extend({
            category: z.enum(Object.keys(HELP_CATEGORIES) as [keyof typeof HELP_CATEGORIES, ...Array<keyof typeof HELP_CATEGORIES>]),
            description: z.string().trim().max(2000).nullish(),
            ...coords,
        }), body);
        const s = await this.scope(userId, b);
        const severity = HELP_CATEGORIES[b.category].severity as Severity;
        const inc = await this.create({
            kind: 'help', severity, category: b.category, context: b.context, tripId: s.trip?.id ?? null, serviceRequestId: s.sr?.id ?? null,
            reporterUserId: userId, subject: null, description: b.description ?? null, lat: b.lat, lng: b.lng,
        });
        await alertStaff(`Help ${inc.code}: ${HELP_CATEGORIES[b.category].label}`, `${HELP_CATEGORIES[b.category].label} on ${s.label}.${b.description ? ` "${b.description}"` : ''}`, { incidentId: inc.id });
        return {
            id: inc.id, code: inc.code,
            manager: s.managerName && s.managerPhone ? { name: s.managerName, phone: s.managerPhone } : null,
            message: b.category === 'medical' ? 'Sent. For an emergency call 108 or 112 now; your travel manager will call you.' : 'Sent. Your travel manager will call you within 10 minutes.',
        };
    }

    /** A system alert on a trip (a late driver), into the same queue. */
    static async systemAlert(tripId: number, category: keyof typeof HELP_CATEGORIES, description: string) {
        const [t] = await db.select({ userId: travelTrips.customerUserId, code: travelTrips.code }).from(travelTrips).where(eq(travelTrips.id, tripId)).limit(1);
        if (!t) return null;
        const inc = await this.create({ kind: 'help', severity: HELP_CATEGORIES[category].severity as Severity, category, context: 'trip', tripId, serviceRequestId: null, reporterUserId: t.userId!, subject: null, description });
        await alertStaff(`Trip ${t.code}: ${HELP_CATEGORIES[category].label}`, description, { incidentId: inc.id });
        return inc;
    }

    // ── Pausing people ──────────────────────────────────────────────────

    /** Off new jobs until reviewed. Returns what was changed, so "Clear" can put it back. */
    private static async pause(incidentId: number, subject: IncidentSubject | null) {
        if (!subject) return null;
        const done: Record<string, unknown> = {};
        if (subject.employeeId) {
            const [e] = await db.select({ active: employees.isActive }).from(employees).where(eq(employees.id, subject.employeeId)).limit(1);
            if (e) { await db.update(employees).set({ isActive: false, updatedAt: new Date() } as any).where(eq(employees.id, subject.employeeId)); done.employee = { id: subject.employeeId, wasActive: e.active }; }
        }
        if (subject.partnerId && !subject.employeeId) {
            // A partner's driver or host: the partner stays (other drivers are fine), the person is flagged by phone.
            done.teamMember = { id: subject.teamMemberId ?? null, phone: subject.phone ?? null };
        }
        await db.update(safetyIncidents).set({ paused: done as any }).where(eq(safetyIncidents.id, incidentId));
        return done;
    }

    /** A phone with an open critical case, or a suspension or ban, must not be put on a trip. */
    static async phoneFlag(phone: string | null | undefined) {
        const p = String(phone ?? '').replace(/\D/g, '').slice(-10);
        if (p.length !== 10) return null;
        const rows = await db.select({ code: safetyIncidents.code, status: safetyIncidents.status, action: safetyIncidents.action, severity: safetyIncidents.severity })
            .from(safetyIncidents).where(sql`${safetyIncidents.subject}->>'phone' = ${p}`);
        const hit = rows.find(r => (r.status !== 'resolved' && r.severity === 'critical') || r.action === 'suspend' || r.action === 'ban');
        return hit ? hit.code : null;
    }

    // ── Staff ───────────────────────────────────────────────────────────

    static async list(q: { status?: string; kind?: string }) {
        const conds = [];
        if (q.status === 'open') conds.push(ne(safetyIncidents.status, 'resolved'));
        else if (q.status && ['acknowledged', 'resolved'].includes(q.status)) conds.push(eq(safetyIncidents.status, q.status));
        if (q.kind && ['sos', 'report', 'help'].includes(q.kind)) conds.push(eq(safetyIncidents.kind, q.kind));
        const rows = await db.select({
            i: safetyIncidents, reporterName: users.username, reporterPhone: users.phone,
            tripCode: travelTrips.code, managerName: travelTrips.managerName, managerPhone: travelTrips.managerPhone, bookingRef: serviceRequests.serviceId,
        }).from(safetyIncidents)
            .leftJoin(users, eq(users.id, safetyIncidents.reporterUserId))
            .leftJoin(travelTrips, eq(travelTrips.id, safetyIncidents.tripId))
            .leftJoin(serviceRequests, eq(serviceRequests.id, safetyIncidents.serviceRequestId))
            .where(conds.length ? and(...conds) : undefined)
            .orderBy(sql`CASE ${safetyIncidents.status} WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END`, sql`CASE ${safetyIncidents.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`, desc(safetyIncidents.createdAt))
            .limit(200);
        const ids = rows.map(r => r.i.id);
        const pings = ids.length ? await db.select({ incidentId: safetyPings.incidentId, n: sql<number>`count(*)::int`, at: sql<Date>`max(${safetyPings.at})` }).from(safetyPings).where(inArray(safetyPings.incidentId, ids)).groupBy(safetyPings.incidentId) : [];
        const strikes = await this.strikeCounts(rows.map(r => r.i.subject as IncidentSubject | null));
        return {
            alarm: await this.alarm(),
            incidents: rows.map(r => {
                const subj = r.i.subject as IncidentSubject | null;
                const p = pings.find(x => x.incidentId === r.i.id);
                return {
                    ...r.i, reporterName: r.reporterName, reporterPhone: r.reporterPhone, tripCode: r.tripCode, bookingRef: r.bookingRef,
                    managerName: r.managerName, managerPhone: r.managerPhone,
                    live: !!r.i.liveUntil && r.i.liveUntil.getTime() > Date.now(), liveUrl: r.i.liveToken ? liveUrl(r.i.liveToken) : null,
                    pings: p?.n ?? 0, lastPingAt: p?.at ?? null,
                    strikes: subj ? strikes.get(this.subjectKey(subj) ?? '') ?? 0 : 0,
                    dueAt: new Date((r.i.createdAt?.getTime() ?? Date.now()) + RESPONSE_MINUTES[r.i.severity as Severity] * 60_000),
                };
            }),
        };
    }

    /** What sounds the alarm on every admin page: critical cases nobody has picked up. */
    static async alarm() {
        const rows = await db.select({ id: safetyIncidents.id, code: safetyIncidents.code, kind: safetyIncidents.kind, createdAt: safetyIncidents.createdAt })
            .from(safetyIncidents).where(and(eq(safetyIncidents.status, 'open'), eq(safetyIncidents.severity, 'critical'))).orderBy(desc(safetyIncidents.createdAt)).limit(10);
        const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(safetyIncidents).where(ne(safetyIncidents.status, 'resolved'));
        return { critical: rows, open: open.n };
    }

    private static subjectKey(s: IncidentSubject | null) {
        if (!s) return null;
        if (s.employeeId) return `e:${s.employeeId}`;
        if (s.phone) return `p:${s.phone}`;
        if (s.partnerId) return `t:${s.partnerId}`;
        return null;
    }
    private static async strikeCounts(subjects: Array<IncidentSubject | null>) {
        const since = new Date(Date.now() - STRIKE_WINDOW_DAYS * 86_400_000);
        const rows = await db.select({ subject: safetyIncidents.subject }).from(safetyIncidents)
            .where(and(eq(safetyIncidents.action, 'strike'), gte(safetyIncidents.resolvedAt, since)));
        const m = new Map<string, number>();
        for (const r of rows) { const k = this.subjectKey(r.subject as IncidentSubject); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
        void subjects;
        return m;
    }

    static async acknowledge(adminId: number, id: number) {
        const [row] = await db.update(safetyIncidents).set({ status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: adminId, updatedAt: new Date() })
            .where(and(eq(safetyIncidents.id, id), eq(safetyIncidents.status, 'open'))).returning();
        if (!row) throw new SafetyError('Already picked up or closed.', 409);
        await recordAudit({ entityType: 'safety', entityId: id, action: 'safety_acknowledged', changedBy: adminId, metadata: { code: row.code } });
        return row;
    }

    static async resolve(adminId: number, id: number, body: unknown) {
        const b = parse(z.object({ action: z.enum(SAFETY_ACTIONS), note: z.string().trim().min(3, 'say what was done').max(2000) }), body);
        const [inc] = await db.select().from(safetyIncidents).where(eq(safetyIncidents.id, id)).limit(1);
        if (!inc) throw new SafetyError('Not found.', 404);
        const subj = inc.subject as IncidentSubject | null;
        const paused = (inc.paused ?? {}) as { employee?: { id: number; wasActive: boolean | null } };
        let action: SafetyAction = b.action;
        let note = b.note;
        const setEmployee = async (active: boolean) => { if (subj?.employeeId) await db.update(employees).set({ isActive: active, updatedAt: new Date() } as any).where(eq(employees.id, subj.employeeId)); };
        const setPartner = async (active: boolean) => { if (subj?.partnerId && !subj.employeeId && !subj.phone) await db.update(travelPartners).set({ isActive: active, updatedAt: new Date() }).where(eq(travelPartners.id, subj.partnerId)); };
        if (action === 'suspend' || action === 'ban') { await setEmployee(false); await setPartner(false); }
        else if (paused.employee) {
            // Lift the pause from the critical report unless the outcome removes them.
            if (action === 'strike') {
                const key = this.subjectKey(subj);
                const n = key ? ((await this.strikeCounts([subj])).get(key) ?? 0) + 1 : 1;
                if (n >= STRIKES_TO_REMOVE) { action = 'suspend'; note = `${note} (strike ${n} in ${STRIKE_WINDOW_DAYS / 30} months: suspended)`; await setEmployee(false); }
                else await setEmployee(paused.employee.wasActive ?? true);
            } else await setEmployee(paused.employee.wasActive ?? true);
        } else if (action === 'strike') {
            const key = this.subjectKey(subj);
            const n = key ? ((await this.strikeCounts([subj])).get(key) ?? 0) + 1 : 1;
            if (n >= STRIKES_TO_REMOVE) { action = 'suspend'; note = `${note} (strike ${n} in ${STRIKE_WINDOW_DAYS / 30} months: suspended)`; await setEmployee(false); await setPartner(false); }
        }
        // A strike is still counted when it turned into a suspension.
        const [row] = await db.update(safetyIncidents).set({
            status: 'resolved', resolvedAt: new Date(), resolvedBy: adminId, action: b.action === 'strike' ? 'strike' : action, note, updatedAt: new Date(),
            ...(inc.acknowledgedAt ? {} : { acknowledgedAt: new Date(), acknowledgedBy: adminId }),
            liveUntil: inc.liveUntil && inc.liveUntil.getTime() > Date.now() ? new Date() : inc.liveUntil,
        }).where(eq(safetyIncidents.id, id)).returning();
        await recordAudit({ entityType: 'safety', entityId: id, action: `safety_resolved_${action}`, changedBy: adminId, metadata: { code: inc.code, subject: subj?.name ?? null, note } });
        if (inc.reporterUserId) {
            void NotificationService.sendToUser(inc.reporterUserId, 'We looked into your report', `Case ${inc.code} is closed. Thank you for telling us. Reply in the app if anything is still wrong.`, 'safety', { code: inc.code }).catch(() => {});
        }
        return { ...row, outcome: action };
    }

    /** Every minute: a critical case nobody picked up in 2 minutes goes to the safety lead too. */
    static async escalate() {
        const due = await db.select().from(safetyIncidents).where(and(
            eq(safetyIncidents.status, 'open'), eq(safetyIncidents.severity, 'critical'), isNull(safetyIncidents.escalatedAt),
            lt(safetyIncidents.createdAt, new Date(Date.now() - 2 * 60_000)),
        )).limit(20);
        if (!due.length) return 0;
        const { TravelService } = await import('./travel.service');
        const lead = (await TravelService.settings()).safetyLead;
        for (const inc of due) {
            await db.update(safetyIncidents).set({ escalatedAt: new Date() }).where(eq(safetyIncidents.id, inc.id));
            await alertStaff(`NOT PICKED UP: ${inc.kind === 'sos' ? 'SOS' : 'critical report'} ${inc.code}`,
                `Nobody has picked up ${inc.code} for 2 minutes.${lead ? ` ${lead.name}, please call the customer now (${lead.phone}).` : ''} Live: ${inc.liveToken ? liveUrl(inc.liveToken) : '-'}`,
                { incidentId: inc.id }, lead?.email ?? null);
            logger.warn(`[SAFETY] ${inc.code} escalated to the safety lead`);
        }
        return due.length;
    }

    static async staffPhoneFor(adminId: number) {
        const [a] = await db.select({ name: adminUsers.username }).from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
        return a?.name ?? null;
    }
}

void or;
