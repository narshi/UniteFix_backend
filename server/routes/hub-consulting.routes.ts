/**
 * Partner Hub — phase 5: consulting.
 *
 *   Partner  /api/hub/consulting/services*, /availability*, /slots,
 *            /appointments*, /retainers*
 *   Public   /api/public/consult/:code (profile, services, slots, request a slot)
 *            /api/public/consult/a/:token (the client's booking page, cancel)
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { operatorApplyLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { PartnerConsultingService, istDay } from '../services/partner-consulting.service';
import { registerSummaryContributor } from '../services/hub-summary';
import { docView } from './hub-money.routes';

const rupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}

const serviceSchema = z.object({
    name: z.string().max(120).optional(), description: z.string().max(2000).optional().nullable(),
    kind: z.enum(['fixed', 'hourly', 'retainer']).optional(), priceRupees: z.coerce.number().min(0).max(10_000_000).optional(),
    durationMinutes: z.coerce.number().int().optional(), mode: z.enum(['online', 'onsite', 'both']).optional(),
    sac: z.string().max(8).optional(), gstRate: z.coerce.number().optional(),
    sessionsIncluded: z.coerce.number().int().min(1).max(100).optional().nullable(), hoursIncluded: z.coerce.number().min(0).max(744).optional().nullable(),
    isPublic: z.boolean().optional(), isActive: z.boolean().optional(),
});

function apptView(r: { a: any; customerName: string; customerPhone: string | null; serviceName: string; serviceKind: string }) {
    const a = r.a;
    return {
        id: a.id, status: a.status, source: a.source, startsAt: a.startsAt, endsAt: a.endsAt, mode: a.mode, location: a.location, meetingLink: a.meetingLink,
        customerId: a.customerId, customerName: r.customerName, customerPhone: r.customerPhone, serviceId: a.serviceId, serviceName: r.serviceName, serviceKind: r.serviceKind,
        retainerId: a.retainerId, price: rupees(a.pricePaise), invoiceDocumentId: a.invoiceDocumentId, clientMessage: a.clientMessage,
        privateNotes: a.privateNotes, clientNotes: a.clientNotes, cancelledReason: a.cancelledReason, clientLink: `/book/a/${a.publicToken}`,
    };
}

export function registerHubConsultingRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('consulting');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    registerSummaryContributor('consulting', async (ctx) => {
        if (!ctx.modules.includes('consulting') || !ctx.permissions.includes('ops:view')) return null;
        const today = istDay(new Date());
        const from = new Date(Date.parse(`${today}T00:00:00Z`) - 330 * 60_000);
        const [upcoming, svcs, avail] = await Promise.all([
            PartnerConsultingService.appointments(ctx.businessPartnerId, { from }),
            PartnerConsultingService.services(ctx.businessPartnerId, { activeOnly: true }),
            PartnerConsultingService.availability(ctx.businessPartnerId),
        ]);
        const todays = upcoming.filter(r => istDay(new Date(r.a.startsAt)) === today && ['confirmed', 'requested'].includes(r.a.status)).length;
        const requests = upcoming.filter(r => r.a.status === 'requested').length;
        return {
            stats: [
                { label: 'Appointments today', value: todays },
                { label: 'Booking requests', value: requests, hint: requests ? 'confirm them in Appointments' : undefined },
            ],
            checklist: [
                { label: 'Add your services and packages', done: svcs.length > 0, href: '/partner/consulting/services' },
                { label: 'Publish your availability', done: avail.windows.length > 0, href: '/partner/consulting/calendar' },
            ],
        };
    });

    // ── services ──────────────────────────────────────────────────────────
    app.get('/api/hub/consulting/services', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await PartnerConsultingService.services(ctxOf(req).businessPartnerId)).map(s => PartnerConsultingService.serviceView(s)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consulting/services', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { const s = await PartnerConsultingService.saveService(ctxOf(req), null, parse(serviceSchema, req.body)); res.status(201).json({ success: true, message: 'Service added.', data: PartnerConsultingService.serviceView(s) }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/consulting/services/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { const s = await PartnerConsultingService.saveService(ctxOf(req), Number(req.params.id), parse(serviceSchema, req.body)); res.json({ success: true, message: 'Saved.', data: PartnerConsultingService.serviceView(s) }); } catch (e) { hubError(e, res, next); }
    });

    // ── availability ──────────────────────────────────────────────────────
    app.get('/api/hub/consulting/availability', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerConsultingService.availability(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/consulting/availability', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ windows: z.array(z.object({ weekday: z.number().int(), startTime: z.string(), endTime: z.string() })).max(50) }), req.body);
            res.json({ success: true, message: 'Hours saved.', data: await PartnerConsultingService.setAvailability(ctxOf(req), b.windows) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consulting/time-off', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { const b = parse(z.object({ day: date, reason: z.string().max(200).optional().nullable() }), req.body); await PartnerConsultingService.addTimeOff(ctxOf(req), b.day, b.reason); res.status(201).json({ success: true, message: 'Day off added.' }); } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/hub/consulting/time-off/:id', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { await PartnerConsultingService.removeTimeOff(ctxOf(req), Number(req.params.id)); res.json({ success: true, message: 'Removed.' }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/consulting/slots', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const slots = await PartnerConsultingService.freeSlots(ctxOf(req).businessPartnerId, Number(req.query.serviceId), { days: Number(req.query.days) || 14, noticeMinutes: 0 });
            res.json({ success: true, data: slots });
        } catch (e) { hubError(e, res, next); }
    });

    // ── appointments ──────────────────────────────────────────────────────
    app.get('/api/hub/consulting/appointments', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const from = typeof req.query.from === 'string' ? new Date(`${req.query.from}T00:00:00+05:30`) : undefined;
            const to = typeof req.query.to === 'string' ? new Date(`${req.query.to}T00:00:00+05:30`) : undefined;
            const rows = await PartnerConsultingService.appointments(ctxOf(req).businessPartnerId, {
                from, to, status: typeof req.query.status === 'string' ? req.query.status : undefined, customerId: req.query.customerId ? Number(req.query.customerId) : undefined,
            });
            res.json({ success: true, data: rows.map(apptView) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consulting/appointments', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                customerId: z.number().int(), serviceId: z.number().int(), startsAt: z.string(), durationMinutes: z.number().int().optional(),
                mode: z.enum(['online', 'onsite']).optional(), location: z.string().max(300).optional().nullable(), meetingLink: z.string().max(500).optional().nullable(),
                retainerId: z.number().int().optional().nullable(),
            }), req.body);
            if (b.retainerId) await PartnerConsultingService.retainer(ctxOf(req).businessPartnerId, b.retainerId);
            const a = await PartnerConsultingService.createAppointment(ctxOf(req), b);
            res.status(201).json({ success: true, message: 'Appointment booked.', data: { id: a.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/consulting/appointments/:id', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']).optional(), startsAt: z.string().optional(), durationMinutes: z.number().int().min(15).max(600).optional(),
                meetingLink: z.string().max(500).optional().nullable(), location: z.string().max(300).optional().nullable(),
                privateNotes: z.string().max(5000).optional().nullable(), clientNotes: z.string().max(5000).optional().nullable(), cancelledReason: z.string().max(300).optional().nullable(),
            }), req.body);
            const a = await PartnerConsultingService.updateAppointment(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: b.status ? `Marked ${a.status}.` : 'Saved.', data: { id: a.id, status: a.status } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consulting/appointments/:id/bill', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ dueDate: date.optional().nullable() }), req.body ?? {});
            const doc = await PartnerConsultingService.bill(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: `Invoice ${doc.number} issued.`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });

    // ── retainers ─────────────────────────────────────────────────────────
    app.get('/api/hub/consulting/retainers', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const period = istDay(new Date()).slice(0, 7);
            const rows = await PartnerConsultingService.retainers(ctx.businessPartnerId);
            const out = [];
            for (const { r, customerName } of rows) {
                out.push({
                    id: r.id, title: r.title, customerId: r.customerId, customerName, serviceId: r.serviceId, monthlyFee: rupees(r.monthlyFeePaise), sac: r.sac, gstRate: Number(r.gstRate),
                    hoursIncluded: r.hoursIncluded == null ? null : Number(r.hoursIncluded), hoursUsedThisMonth: await PartnerConsultingService.hoursUsed(r.id, period),
                    billingDay: r.billingDay, startDate: r.startDate, endDate: r.endDate, status: r.status, lastBilledPeriod: r.lastBilledPeriod, lastBillError: r.lastBillError, notes: r.notes,
                });
            }
            res.json({ success: true, data: out });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consulting/retainers', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                customerId: z.number().int(), serviceId: z.number().int().optional().nullable(), title: z.string().max(120).optional(), monthlyFeeRupees: z.coerce.number().positive().optional(),
                billingDay: z.number().int().optional(), startDate: date, endDate: date.optional().nullable(), hoursIncluded: z.coerce.number().min(0).optional().nullable(),
                notes: z.string().max(1000).optional().nullable(), sac: z.string().max(8).optional(), gstRate: z.coerce.number().optional(),
            }), req.body);
            const r = await PartnerConsultingService.createRetainer(ctxOf(req), b);
            res.status(201).json({ success: true, message: `Retainer set up. It invoices itself on day ${r.billingDay} of each month.`, data: { id: r.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/consulting/retainers/:id', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ status: z.enum(['active', 'paused', 'ended']).optional(), monthlyFeeRupees: z.coerce.number().positive().optional(), endDate: date.optional().nullable(), notes: z.string().max(1000).optional().nullable() }), req.body);
            const r = await PartnerConsultingService.updateRetainer(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: `Retainer ${r.status}.` });
        } catch (e) { hubError(e, res, next); }
    });
    /** Bill this month now (e.g. a retainer started after its billing day). Once per month, as ever. */
    app.post('/api/hub/consulting/retainers/:id/bill', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const r = await PartnerConsultingService.retainer(ctx.businessPartnerId, Number(req.params.id));
            if (r.status !== 'active') throw new HubError('Only an active retainer is billed.', 'BAD_STATE', 409);
            const period = typeof req.body?.period === 'string' && /^\d{4}-\d{2}$/.test(req.body.period) ? req.body.period : istDay(new Date()).slice(0, 7);
            const doc = await PartnerConsultingService.billRetainer(ctx, r.id, period);
            if (!doc) throw new HubError(`${period} is already billed.`, 'BILLED', 409);
            res.status(201).json({ success: true, message: `Invoice ${doc.number} issued for ${period}.`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Public booking page (no login). Rate limited under /api/public.
    // ══════════════════════════════════════════════════════════════════════

    app.get('/api/public/consult/a/:token', async (req, res, next) => {
        try {
            const a = await PartnerConsultingService.publicAppointment(req.params.token);
            if (!a) return res.status(404).json({ success: false, message: 'Booking not found' });
            res.json({ success: true, data: a });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/consult/a/:token/cancel', async (req, res, next) => {
        try { await PartnerConsultingService.publicCancel(req.params.token); res.json({ success: true, message: 'Cancelled.' }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/consult/:code', async (req, res, next) => {
        try {
            const bp = await PartnerConsultingService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const svcs = (await PartnerConsultingService.services(bp.id, { activeOnly: true, publicOnly: true })).filter(s => s.kind !== 'retainer');
            res.json({ success: true, data: { name: bp.displayName, city: bp.district, services: svcs.map(s => { const v = PartnerConsultingService.serviceView(s); return { id: v.id, name: v.name, description: v.description, kind: v.kind, price: v.price, durationMinutes: v.durationMinutes, mode: v.mode, gstRate: v.gstRate }; }) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/consult/:code/slots', async (req, res, next) => {
        try {
            const bp = await PartnerConsultingService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const svc = await PartnerConsultingService.service(bp.id, Number(req.query.serviceId));
            if (!svc.isPublic || !svc.isActive) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: await PartnerConsultingService.freeSlots(bp.id, svc.id, { days: 21 }) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/consult/:code/book', operatorApplyLimiter, async (req, res, next) => {
        try {
            const b = parse(z.object({
                serviceId: z.number().int(), startsAt: z.string(), name: z.string().min(2).max(120), phone: z.string().max(20),
                email: z.string().email().max(160).optional().nullable(), message: z.string().max(1000).optional().nullable(), mode: z.enum(['online', 'onsite']).optional(),
            }), req.body);
            const a = await PartnerConsultingService.publicRequest(req.params.code, b);
            res.status(201).json({ success: true, message: 'Requested. You will see it confirmed on your booking page.', data: { link: `/book/a/${a.publicToken}` } });
        } catch (e) { hubError(e, res, next); }
    });
}
