/**
 * Consulting for business partners (Partner Hub phase 5).
 *
 *   Services      fixed session/package, hourly, or monthly retainer — each
 *                 with its SAC and GST rate, so every bill is a proper invoice
 *   Availability  weekly windows in IST plus days off; free slots are the
 *                 windows cut into service-length pieces, minus appointments
 *   Appointments  booked by the partner, or requested by a client from the
 *                 public booking page (the partner confirms); online or on-site;
 *                 private notes, and notes the client sees on their page;
 *                 billed into a normal invoice from Sales
 *   Retainers     invoice themselves on their billing day each month, once
 *
 * Times are stored as UTC instants. India has one zone and no DST, so the
 * IST wall clock is UTC + 5:30 throughout.
 */

import crypto from 'crypto';
import { db } from '../db';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import {
    consultServices, consultAvailability, consultTimeOff, consultAppointments, consultRetainers, consultRetainerBills,
    partnerCustomers, businessPartners, type ConsultService,
} from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { PartnerSalesService, GST_RATES } from './partner-sales.service';
import { BusinessPartnerService } from './business-partner.service';
import logger from '../lib/logger';

const IST = 330 * 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** IST calendar day "YYYY-MM-DD" of an instant. */
export const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
/** The instant of IST wall time `minutes` after midnight on `day`. */
const istInstant = (day: string, minutes: number) => new Date(Date.parse(`${day}T00:00:00Z`) + minutes * 60_000 - IST);
const LIVE = ['requested', 'confirmed'];

export class PartnerConsultingService {

    // ══════════════════════════════════════════════════════════════════════
    // Services
    // ══════════════════════════════════════════════════════════════════════

    static async services(bpId: number, opts: { activeOnly?: boolean; publicOnly?: boolean } = {}) {
        const conds: any[] = [eq(consultServices.businessPartnerId, bpId)];
        if (opts.activeOnly) conds.push(eq(consultServices.isActive, true));
        if (opts.publicOnly) conds.push(eq(consultServices.isPublic, true));
        return db.select().from(consultServices).where(and(...conds)).orderBy(desc(consultServices.isActive), asc(consultServices.name));
    }

    static async service(bpId: number, id: number) {
        const [s] = await db.select().from(consultServices).where(and(eq(consultServices.id, id), eq(consultServices.businessPartnerId, bpId))).limit(1);
        if (!s) throw new HubError('Service not found', 'NOT_FOUND', 404);
        return s;
    }

    private static checkService(input: Partial<{ name: string; kind: string; priceRupees: number; durationMinutes: number; mode: string; sac: string; gstRate: number }>, registered: boolean) {
        if (input.name !== undefined && !input.name.trim()) throw new HubError('Name the service.', 'NO_NAME');
        if (input.kind !== undefined && !['fixed', 'hourly', 'retainer'].includes(input.kind)) throw new HubError('Kind is fixed, hourly or retainer.', 'BAD_KIND');
        if (input.priceRupees !== undefined && !(input.priceRupees >= 0)) throw new HubError('Price cannot be negative.', 'BAD_PRICE');
        if (input.durationMinutes !== undefined && !(input.durationMinutes >= 15 && input.durationMinutes <= 480 && input.durationMinutes % 5 === 0)) throw new HubError('Duration is 15–480 minutes, in steps of 5.', 'BAD_DURATION');
        if (input.mode !== undefined && !['online', 'onsite', 'both'].includes(input.mode)) throw new HubError('Mode is online, onsite or both.', 'BAD_MODE');
        if (input.sac !== undefined && !/^99\d{2,4}$/.test(input.sac)) throw new HubError('A service SAC starts with 99 (e.g. 998311 management consulting).', 'BAD_SAC');
        if (input.gstRate !== undefined && registered && !GST_RATES.includes(input.gstRate)) throw new HubError(`GST rate must be one of ${GST_RATES.join(', ')}%.`, 'BAD_RATE');
    }

    static async saveService(ctx: HubContext, id: number | null, input: { name?: string; description?: string | null; kind?: string; priceRupees?: number; durationMinutes?: number; mode?: string; sac?: string; gstRate?: number; sessionsIncluded?: number | null; hoursIncluded?: number | null; isPublic?: boolean; isActive?: boolean }) {
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        this.checkService(input, !!bp?.gstin);
        const values: Record<string, unknown> = {};
        if (input.name !== undefined) values.name = input.name.trim().slice(0, 120);
        if (input.description !== undefined) values.description = input.description?.trim() || null;
        if (input.kind !== undefined) values.kind = input.kind;
        if (input.priceRupees !== undefined) values.pricePaise = Math.round(input.priceRupees * 100);
        if (input.durationMinutes !== undefined) values.durationMinutes = input.durationMinutes;
        if (input.mode !== undefined) values.mode = input.mode;
        if (input.sac !== undefined) values.sac = input.sac;
        if (input.gstRate !== undefined) values.gstRate = String(bp?.gstin ? input.gstRate : 0);
        if (input.sessionsIncluded !== undefined) values.sessionsIncluded = input.sessionsIncluded;
        if (input.hoursIncluded !== undefined) values.hoursIncluded = input.hoursIncluded == null ? null : String(input.hoursIncluded);
        if (input.isPublic !== undefined) values.isPublic = input.isPublic;
        if (input.isActive !== undefined) values.isActive = input.isActive;
        if (id) {
            await this.service(ctx.businessPartnerId, id);
            const [u] = await db.update(consultServices).set({ ...values, updatedAt: new Date() }).where(eq(consultServices.id, id)).returning();
            return u;
        }
        if (!values.name || values.pricePaise === undefined) throw new HubError('Name and price are required.', 'MISSING');
        const [row] = await db.insert(consultServices).values({ businessPartnerId: ctx.businessPartnerId, ...(values as any), gstRate: values.gstRate ?? String(bp?.gstin ? 18 : 0) }).returning();
        return row;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Availability and slots
    // ══════════════════════════════════════════════════════════════════════

    static async availability(bpId: number) {
        const [windows, off] = await Promise.all([
            db.select().from(consultAvailability).where(eq(consultAvailability.businessPartnerId, bpId)).orderBy(asc(consultAvailability.weekday), asc(consultAvailability.startTime)),
            db.select().from(consultTimeOff).where(and(eq(consultTimeOff.businessPartnerId, bpId), gte(consultTimeOff.day, istDay(new Date())))).orderBy(asc(consultTimeOff.day)),
        ]);
        return { windows, timeOff: off };
    }

    /** Replace the weekly hours in one go — what the editor sends. */
    static async setAvailability(ctx: HubContext, windows: Array<{ weekday: number; startTime: string; endTime: string }>) {
        for (const w of windows) {
            if (!(Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6)) throw new HubError('Weekday is 0 (Sunday) to 6 (Saturday).', 'BAD_DAY');
            if (!HHMM.test(w.startTime) || !HHMM.test(w.endTime)) throw new HubError('Times are HH:MM (24-hour).', 'BAD_TIME');
            if (toMin(w.endTime) <= toMin(w.startTime)) throw new HubError(`${w.startTime}–${w.endTime}: the end must be after the start.`, 'BAD_TIME');
        }
        for (let d = 0; d <= 6; d++) {
            const day = windows.filter(w => w.weekday === d).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
            for (let i = 1; i < day.length; i++) if (toMin(day[i].startTime) < toMin(day[i - 1].endTime)) throw new HubError('Two windows on the same day overlap.', 'OVERLAP');
        }
        await db.transaction(async (tx) => {
            await tx.delete(consultAvailability).where(eq(consultAvailability.businessPartnerId, ctx.businessPartnerId));
            if (windows.length) await tx.insert(consultAvailability).values(windows.map(w => ({ businessPartnerId: ctx.businessPartnerId, ...w })));
        });
        return this.availability(ctx.businessPartnerId);
    }

    static async addTimeOff(ctx: HubContext, day: string, reason?: string | null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HubError('Date is YYYY-MM-DD.', 'BAD_DATE');
        await db.insert(consultTimeOff).values({ businessPartnerId: ctx.businessPartnerId, day, reason: reason ?? null }).onConflictDoNothing();
    }

    static async removeTimeOff(ctx: HubContext, id: number) {
        await db.delete(consultTimeOff).where(and(eq(consultTimeOff.id, id), eq(consultTimeOff.businessPartnerId, ctx.businessPartnerId)));
    }

    /**
     * Free start times for a service over the next `days` days: working
     * windows cut into service-length slots (on a 15-minute grid), skipping
     * days off, anything already booked, and anything starting within the
     * notice period.
     */
    static async freeSlots(bpId: number, serviceId: number, opts: { from?: Date; days?: number; noticeMinutes?: number } = {}) {
        const svc = await this.service(bpId, serviceId);
        const dur = svc.durationMinutes;
        const from = opts.from ?? new Date();
        const days = Math.min(60, Math.max(1, opts.days ?? 14));
        const earliest = from.getTime() + (opts.noticeMinutes ?? 120) * 60_000;
        const { windows, timeOff } = await this.availability(bpId);
        const offDays = new Set(timeOff.map(t => String(t.day).slice(0, 10)));
        const end = new Date(from.getTime() + days * 86_400_000);
        const busy = await db.select({ s: consultAppointments.startsAt, e: consultAppointments.endsAt }).from(consultAppointments)
            .where(and(eq(consultAppointments.businessPartnerId, bpId), inArray(consultAppointments.status, LIVE), lt(consultAppointments.startsAt, end), gte(consultAppointments.endsAt, from)));
        const out: Array<{ startsAt: string; endsAt: string; day: string; time: string }> = [];
        for (let i = 0; i < days; i++) {
            const day = istDay(new Date(from.getTime() + i * 86_400_000));
            if (offDays.has(day)) continue;
            const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
            for (const w of windows.filter(x => x.weekday === weekday)) {
                for (let m = toMin(w.startTime); m + dur <= toMin(w.endTime); m += 15) {
                    const s = istInstant(day, m), e = new Date(s.getTime() + dur * 60_000);
                    if (s.getTime() < earliest) continue;
                    if (busy.some(b => new Date(b.s).getTime() < e.getTime() && new Date(b.e).getTime() > s.getTime())) continue;
                    out.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), day, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
                }
            }
        }
        return out;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Appointments
    // ══════════════════════════════════════════════════════════════════════

    private static async assertFree(bpId: number, s: Date, e: Date, exceptId?: number) {
        const conds: any[] = [eq(consultAppointments.businessPartnerId, bpId), inArray(consultAppointments.status, LIVE), lt(consultAppointments.startsAt, e), gt(consultAppointments.endsAt, s)];
        if (exceptId) conds.push(ne(consultAppointments.id, exceptId));
        const [clash] = await db.select({ id: consultAppointments.id }).from(consultAppointments).where(and(...conds)).limit(1);
        if (clash) throw new HubError('That time overlaps another appointment.', 'CLASH', 409);
    }

    static async createAppointment(ctx: HubContext | { businessPartnerId: number; adminUserId: number | null }, input: {
        customerId: number; serviceId: number; startsAt: string; durationMinutes?: number; mode?: string; location?: string | null; meetingLink?: string | null;
        status?: 'requested' | 'confirmed'; source?: 'hub' | 'public'; clientMessage?: string | null; retainerId?: number | null;
    }) {
        const svc = await this.service(ctx.businessPartnerId, input.serviceId);
        if (!svc.isActive) throw new HubError('That service is not offered any more.', 'INACTIVE', 409);
        await PartnerSalesService.customer(ctx.businessPartnerId, input.customerId);
        const s = new Date(input.startsAt);
        if (Number.isNaN(s.getTime())) throw new HubError('Bad start time.', 'BAD_TIME');
        const dur = input.durationMinutes ?? svc.durationMinutes;
        if (!(dur >= 15 && dur <= 600)) throw new HubError('Duration is 15–600 minutes.', 'BAD_DURATION');
        const e = new Date(s.getTime() + dur * 60_000);
        const mode = input.mode ?? (svc.mode === 'both' ? 'online' : svc.mode);
        if (!['online', 'onsite'].includes(mode) || (svc.mode !== 'both' && svc.mode !== mode)) throw new HubError(`This service is ${svc.mode === 'both' ? 'online or on-site' : svc.mode}.`, 'BAD_MODE');
        await this.assertFree(ctx.businessPartnerId, s, e);
        // Hourly services are priced by the time booked; a retainer's sessions are covered by the retainer.
        const price = input.retainerId ? 0 : svc.kind === 'hourly' ? Math.round(svc.pricePaise * dur / 60) : svc.pricePaise;
        const [row] = await db.insert(consultAppointments).values({
            businessPartnerId: ctx.businessPartnerId, customerId: input.customerId, serviceId: svc.id, retainerId: input.retainerId ?? null,
            startsAt: s, endsAt: e, mode, location: input.location?.trim() || null, meetingLink: input.meetingLink?.trim() || null,
            status: input.status ?? 'confirmed', source: input.source ?? 'hub', clientMessage: input.clientMessage?.trim() || null,
            pricePaise: price, publicToken: crypto.randomBytes(18).toString('base64url'), createdByAdminUserId: ctx.adminUserId,
        }).returning();
        return row;
    }

    static async appointment(bpId: number, id: number) {
        const [a] = await db.select().from(consultAppointments).where(and(eq(consultAppointments.id, id), eq(consultAppointments.businessPartnerId, bpId))).limit(1);
        if (!a) throw new HubError('Appointment not found', 'NOT_FOUND', 404);
        return a;
    }

    static async appointments(bpId: number, opts: { from?: Date; to?: Date; status?: string; customerId?: number } = {}) {
        const conds: any[] = [eq(consultAppointments.businessPartnerId, bpId)];
        if (opts.from) conds.push(gte(consultAppointments.startsAt, opts.from));
        if (opts.to) conds.push(lt(consultAppointments.startsAt, opts.to));
        if (opts.status) conds.push(eq(consultAppointments.status, opts.status));
        if (opts.customerId) conds.push(eq(consultAppointments.customerId, opts.customerId));
        return db.select({ a: consultAppointments, customerName: partnerCustomers.name, customerPhone: partnerCustomers.phone, serviceName: consultServices.name, serviceKind: consultServices.kind })
            .from(consultAppointments)
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, consultAppointments.customerId))
            .innerJoin(consultServices, eq(consultServices.id, consultAppointments.serviceId))
            .where(and(...conds)).orderBy(asc(consultAppointments.startsAt)).limit(1000);
    }

    static async updateAppointment(ctx: HubContext, id: number, patch: {
        status?: 'confirmed' | 'completed' | 'cancelled' | 'no_show'; startsAt?: string; durationMinutes?: number; meetingLink?: string | null; location?: string | null;
        privateNotes?: string | null; clientNotes?: string | null; cancelledReason?: string | null;
    }) {
        const a = await this.appointment(ctx.businessPartnerId, id);
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.status) {
            const allowed: Record<string, string[]> = { requested: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled', 'no_show'], completed: [], cancelled: [], no_show: ['completed'] };
            if (!allowed[a.status]?.includes(patch.status)) throw new HubError(`A ${a.status} appointment cannot become ${patch.status}.`, 'BAD_TRANSITION', 409);
            if (patch.status === 'confirmed') await this.assertFree(ctx.businessPartnerId, new Date(a.startsAt), new Date(a.endsAt), a.id);
            set.status = patch.status;
            if (patch.status === 'cancelled') set.cancelledReason = patch.cancelledReason?.trim() || null;
        }
        if (patch.startsAt || patch.durationMinutes) {
            if (!LIVE.includes(a.status)) throw new HubError('Only an upcoming appointment can be moved.', 'BAD_STATE', 409);
            const s = patch.startsAt ? new Date(patch.startsAt) : new Date(a.startsAt);
            const dur = patch.durationMinutes ?? Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000);
            const e = new Date(s.getTime() + dur * 60_000);
            await this.assertFree(ctx.businessPartnerId, s, e, a.id);
            Object.assign(set, { startsAt: s, endsAt: e });
            const svc = await this.service(ctx.businessPartnerId, a.serviceId);
            if (svc.kind === 'hourly' && !a.retainerId && !a.invoiceDocumentId) set.pricePaise = Math.round(svc.pricePaise * dur / 60);
        }
        if (patch.meetingLink !== undefined) set.meetingLink = patch.meetingLink?.trim() || null;
        if (patch.location !== undefined) set.location = patch.location?.trim() || null;
        if (patch.privateNotes !== undefined) set.privateNotes = patch.privateNotes?.trim() || null;
        if (patch.clientNotes !== undefined) set.clientNotes = patch.clientNotes?.trim() || null;
        const [u] = await db.update(consultAppointments).set(set).where(eq(consultAppointments.id, id)).returning();
        return u;
    }

    /** Bill a completed appointment as a normal invoice in the partner's series. */
    static async bill(ctx: HubContext, id: number, input: { dueDate?: string | null; upfront?: boolean } = {}) {
        const a = await this.appointment(ctx.businessPartnerId, id);
        if (a.invoiceDocumentId) throw new HubError('Already billed.', 'BILLED', 409);
        if (a.retainerId) throw new HubError('This session is covered by a retainer, which bills monthly.', 'RETAINER', 409);
        // Upfront: the client pays before the session (a pay link), so the invoice is issued now — within the 30 days GST allows for services.
        if (!(['completed', 'no_show'].includes(a.status) || (input.upfront && a.status === 'confirmed'))) throw new HubError(input.upfront ? 'Confirm the appointment before asking for payment.' : 'Bill after the session is completed.', 'BAD_STATE', 409);
        if (a.pricePaise <= 0) throw new HubError('This appointment has no price.', 'NO_PRICE', 409);
        const svc = await this.service(ctx.businessPartnerId, a.serviceId);
        const hours = (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 3_600_000;
        const when = new Date(new Date(a.startsAt).getTime() + IST).toISOString().slice(0, 16).replace('T', ' ');
        const line = svc.kind === 'hourly'
            ? { description: `${svc.name} — session on ${when} IST`, hsnSac: svc.sac, quantity: Math.round(hours * 100) / 100, unit: 'hr', rateRupees: svc.pricePaise / 100, gstRate: Number(svc.gstRate) }
            : { description: `${svc.name} — session on ${when} IST`, hsnSac: svc.sac, quantity: 1, unit: null, rateRupees: a.pricePaise / 100, gstRate: Number(svc.gstRate) };
        const doc = await PartnerSalesService.issueInvoice(ctx, { customerId: a.customerId, lines: [line], dueDate: input.dueDate ?? null, source: 'consulting' });
        await db.update(consultAppointments).set({ invoiceDocumentId: doc.id, updatedAt: new Date() }).where(eq(consultAppointments.id, id));
        return doc;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Retainers
    // ══════════════════════════════════════════════════════════════════════

    static async retainers(bpId: number) {
        return db.select({ r: consultRetainers, customerName: partnerCustomers.name })
            .from(consultRetainers).innerJoin(partnerCustomers, eq(partnerCustomers.id, consultRetainers.customerId))
            .where(eq(consultRetainers.businessPartnerId, bpId)).orderBy(desc(consultRetainers.createdAt));
    }

    static async retainer(bpId: number, id: number) {
        const [r] = await db.select().from(consultRetainers).where(and(eq(consultRetainers.id, id), eq(consultRetainers.businessPartnerId, bpId))).limit(1);
        if (!r) throw new HubError('Retainer not found', 'NOT_FOUND', 404);
        return r;
    }

    static async createRetainer(ctx: HubContext, input: { customerId: number; serviceId?: number | null; title?: string; monthlyFeeRupees?: number; billingDay?: number; startDate: string; endDate?: string | null; hoursIncluded?: number | null; notes?: string | null; sac?: string; gstRate?: number }) {
        await PartnerSalesService.customer(ctx.businessPartnerId, input.customerId);
        const svc = input.serviceId ? await this.service(ctx.businessPartnerId, input.serviceId) : null;
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const fee = input.monthlyFeeRupees != null ? Math.round(input.monthlyFeeRupees * 100) : svc?.pricePaise;
        if (!fee || fee <= 0) throw new HubError('Monthly fee is required.', 'NO_FEE');
        const day = input.billingDay ?? 1;
        if (!(day >= 1 && day <= 28)) throw new HubError('Billing day is 1–28 (every month has one).', 'BAD_DAY');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new HubError('Start date is YYYY-MM-DD.', 'BAD_DATE');
        if (input.endDate && input.endDate < input.startDate) throw new HubError('The end is before the start.', 'BAD_DATE');
        const sac = input.sac ?? svc?.sac ?? '998311';
        if (!/^99\d{2,4}$/.test(sac)) throw new HubError('A service SAC starts with 99.', 'BAD_SAC');
        const gst = bp?.gstin ? (input.gstRate ?? Number(svc?.gstRate ?? 18)) : 0;
        if (bp?.gstin && !GST_RATES.includes(gst)) throw new HubError('Bad GST rate.', 'BAD_RATE');
        const [row] = await db.insert(consultRetainers).values({
            businessPartnerId: ctx.businessPartnerId, customerId: input.customerId, serviceId: svc?.id ?? null,
            title: (input.title?.trim() || svc?.name || 'Monthly retainer').slice(0, 120), monthlyFeePaise: fee, sac, gstRate: String(gst),
            hoursIncluded: input.hoursIncluded == null ? (svc?.hoursIncluded ?? null) : String(input.hoursIncluded), billingDay: day,
            startDate: input.startDate, endDate: input.endDate ?? null, notes: input.notes ?? null, createdByAdminUserId: ctx.adminUserId,
        }).returning();
        return row;
    }

    static async updateRetainer(ctx: HubContext, id: number, patch: { status?: 'active' | 'paused' | 'ended'; monthlyFeeRupees?: number; endDate?: string | null; notes?: string | null }) {
        const r = await this.retainer(ctx.businessPartnerId, id);
        if (r.status === 'ended') throw new HubError('This retainer has ended.', 'ENDED', 409);
        const [u] = await db.update(consultRetainers).set({
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.monthlyFeeRupees != null ? { monthlyFeePaise: Math.round(patch.monthlyFeeRupees * 100) } : {}),
            ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
            updatedAt: new Date(),
        }).where(eq(consultRetainers.id, id)).returning();
        return u;
    }

    /** Hours used this month against the retainer, from its completed sessions. */
    static async hoursUsed(retainerId: number, period: string) {
        const from = new Date(Date.parse(`${period}-01T00:00:00Z`) - IST);
        const [y, m] = period.split('-').map(Number);
        const to = new Date(Date.UTC(y, m, 1) - IST);
        const [row] = await db.select({ h: sql<number>`coalesce(sum(extract(epoch from (${consultAppointments.endsAt} - ${consultAppointments.startsAt})) / 3600), 0)::float` })
            .from(consultAppointments).where(and(eq(consultAppointments.retainerId, retainerId), eq(consultAppointments.status, 'completed'), gte(consultAppointments.startsAt, from), lt(consultAppointments.startsAt, to)));
        return Math.round((row?.h ?? 0) * 100) / 100;
    }

    /**
     * Invoice one retainer for one month (YYYY-MM), at most once. The month
     * row is claimed first, so two runs racing cannot both invoice.
     */
    static async billRetainer(ctx: { businessPartnerId: number; plan: any; adminUserId: number | null }, retainerId: number, period: string) {
        const r = await this.retainer(ctx.businessPartnerId, retainerId);
        const claimed = await db.insert(consultRetainerBills).values({ retainerId, period }).onConflictDoNothing().returning();
        if (!claimed.length) return null;
        try {
            const [y, m] = period.split('-').map(Number);
            const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
            const doc = await PartnerSalesService.issueInvoice(ctx as any, {
                customerId: r.customerId, source: 'consulting',
                lines: [{ description: `${r.title} — retainer for ${monthName}${r.hoursIncluded ? ` (up to ${Number(r.hoursIncluded)} hours)` : ''}`, hsnSac: r.sac, quantity: 1, unit: 'month', rateRupees: r.monthlyFeePaise / 100, gstRate: Number(r.gstRate) }],
                dueDate: new Date(Date.UTC(y, m - 1, Math.min(28, r.billingDay + 15))).toISOString().slice(0, 10),
                notes: `Retainer #${r.id}.`,
            });
            await db.update(consultRetainerBills).set({ documentId: doc.id }).where(and(eq(consultRetainerBills.retainerId, retainerId), eq(consultRetainerBills.period, period)));
            await db.update(consultRetainers).set({ lastBilledPeriod: period, lastBillError: null, updatedAt: new Date() }).where(eq(consultRetainers.id, retainerId));
            return doc;
        } catch (e: any) {
            await db.delete(consultRetainerBills).where(and(eq(consultRetainerBills.retainerId, retainerId), eq(consultRetainerBills.period, period)));
            await db.update(consultRetainers).set({ lastBillError: e?.message ?? 'Invoice failed', updatedAt: new Date() }).where(eq(consultRetainers.id, retainerId));
            throw e;
        }
    }

    /** Every active retainer whose billing day has come this month (IST) and is not yet billed. */
    static async runDueRetainers(now = new Date()) {
        const today = istDay(now);
        const period = today.slice(0, 7), dom = Number(today.slice(8, 10));
        const due = await db.select({ r: consultRetainers, plan: businessPartners.hubPlan, bpStatus: businessPartners.status })
            .from(consultRetainers).innerJoin(businessPartners, eq(businessPartners.id, consultRetainers.businessPartnerId))
            .where(and(eq(consultRetainers.status, 'active'), lte(consultRetainers.billingDay, dom), lte(consultRetainers.startDate, today),
                or(isNull(consultRetainers.endDate), gte(consultRetainers.endDate, `${period}-01`)),
                or(isNull(consultRetainers.lastBilledPeriod), ne(consultRetainers.lastBilledPeriod, period))));
        const issued: string[] = [];
        for (const { r, plan, bpStatus } of due) {
            if (bpStatus !== 'active') continue;
            try {
                const d = await this.billRetainer({ businessPartnerId: r.businessPartnerId, plan, adminUserId: null }, r.id, period);
                if (d) issued.push(d.number);
            } catch (e: any) {
                logger.warn(`[CONSULT] Retainer #${r.id} not billed for ${period}: ${e?.message}`);
            }
        }
        if (issued.length) logger.info(`[CONSULT] Retainer invoices issued: ${issued.join(', ')}`);
        return issued;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Public booking page
    // ══════════════════════════════════════════════════════════════════════

    static async publicPartner(code: string) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.partnerCode, code)).limit(1);
        if (!bp || bp.status !== 'active') return null;
        const { PartnerHubService } = await import('./partner-hub.service');
        const mods = await PartnerHubService.modulesOf(bp);
        if (!mods.includes('consulting')) return null;
        return bp;
    }

    /** A client asks for a slot. The partner confirms it in the Hub. */
    static async publicRequest(code: string, input: { serviceId: number; startsAt: string; name: string; phone: string; email?: string | null; message?: string | null; mode?: string }) {
        const bp = await this.publicPartner(code);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        const svc = await this.service(bp.id, input.serviceId);
        if (!svc.isActive || !svc.isPublic || svc.kind === 'retainer') throw new HubError('That service cannot be booked online.', 'NOT_BOOKABLE', 409);
        const free = await this.freeSlots(bp.id, svc.id, { days: 60 });
        const s = new Date(input.startsAt);
        if (!free.some(f => new Date(f.startsAt).getTime() === s.getTime())) throw new HubError('That time is no longer free. Pick another.', 'TAKEN', 409);
        const phone = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) throw new HubError('A 10-digit mobile number, please.', 'BAD_PHONE');
        if (!input.name?.trim()) throw new HubError('Your name, please.', 'NO_NAME');
        let [cust] = await db.select().from(partnerCustomers).where(and(eq(partnerCustomers.businessPartnerId, bp.id), eq(partnerCustomers.phone, phone), isNull(partnerCustomers.archivedAt))).limit(1);
        if (!cust) {
            [cust] = await db.insert(partnerCustomers).values({ businessPartnerId: bp.id, name: input.name.trim().slice(0, 160), phone, email: input.email?.trim().toLowerCase() || null, stateCode: bp.stateCode, stateName: bp.stateName, tags: ['online booking'] }).returning();
        }
        const appt = await this.createAppointment({ businessPartnerId: bp.id, adminUserId: null }, {
            customerId: cust.id, serviceId: svc.id, startsAt: s.toISOString(), mode: input.mode, status: 'requested', source: 'public', clientMessage: input.message ?? null,
        });
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(bp.id, 'booking_request', { title: `Booking request: ${svc.name}`, body: `${cust.name} asked for ${new Date(appt.startsAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. Confirm it so they get the details.`, link: '/partner/consulting/appointments', refType: 'consult_appointment', refId: appt.id });
        return appt;
    }

    static async publicAppointment(token: string) {
        const [row] = await db.select({ a: consultAppointments, serviceName: consultServices.name, partnerName: businessPartners.displayName, partnerPhone: businessPartners.contactPhone })
            .from(consultAppointments)
            .innerJoin(consultServices, eq(consultServices.id, consultAppointments.serviceId))
            .innerJoin(businessPartners, eq(businessPartners.id, consultAppointments.businessPartnerId))
            .where(eq(consultAppointments.publicToken, token)).limit(1);
        if (!row) return null;
        const a = row.a;
        return {
            service: row.serviceName, consultant: row.partnerName, consultantPhone: row.partnerPhone, startsAt: a.startsAt, endsAt: a.endsAt, mode: a.mode,
            status: a.status, location: a.status === 'confirmed' ? a.location : null, meetingLink: a.status === 'confirmed' ? a.meetingLink : null,
            notes: a.clientNotes, price: a.pricePaise / 100,
            payLink: a.invoiceDocumentId ? await (await import('./partner-pay-links.service')).PartnerPayLinkService.openForAppointment(a.id) : null,
        };
    }

    static async publicCancel(token: string) {
        const [a] = await db.select().from(consultAppointments).where(eq(consultAppointments.publicToken, token)).limit(1);
        if (!a) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (!LIVE.includes(a.status)) throw new HubError(`This appointment is ${a.status}.`, 'BAD_STATE', 409);
        if (new Date(a.startsAt).getTime() - Date.now() < 2 * 3_600_000) throw new HubError('Less than 2 hours to go — please call to cancel.', 'TOO_LATE', 409);
        await db.update(consultAppointments).set({ status: 'cancelled', cancelledReason: 'Cancelled by the client online', updatedAt: new Date() }).where(eq(consultAppointments.id, a.id));
    }

    static serviceView(s: ConsultService) {
        return {
            id: s.id, name: s.name, description: s.description, kind: s.kind, price: s.pricePaise / 100, durationMinutes: s.durationMinutes, mode: s.mode,
            sac: s.sac, gstRate: Number(s.gstRate), sessionsIncluded: s.sessionsIncluded, hoursIncluded: s.hoursIncluded == null ? null : Number(s.hoursIncluded),
            isPublic: s.isPublic, isActive: s.isActive,
        };
    }
}

