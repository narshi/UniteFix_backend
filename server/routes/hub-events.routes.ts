/**
 * Partner Hub — phase 6: events.
 *
 *   Partner  /api/hub/events/packages*, /enquiries*, /quotations/:id/share,
 *            /bookings*, /milestones/:id/pay, /vendors*, /costs*, /payables
 *   Public   /api/public/events/:code (profile + enquiry form),
 *            /api/public/events/q/:token (quotation: view, PDF, accept/decline),
 *            /api/public/events/e/:token (enquiry status)
 *   App      /api/events/partners?pincode=, /api/events/enquiries, /api/events/my-enquiries
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { operatorApplyLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { PartnerEventsService } from '../services/partner-events.service';
import { PartnerSalesService } from '../services/partner-sales.service';
import { registerSummaryContributor } from '../services/hub-summary';
import { docView } from './hub-money.routes';

const rupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}

const lineSchema = z.object({
    description: z.string().max(300), hsnSac: z.string().max(8).optional().nullable(), quantity: z.coerce.number().positive().max(1e6),
    unit: z.string().max(12).optional().nullable(), rateRupees: z.coerce.number().min(0).max(1e8), gstRate: z.coerce.number().min(0).max(40).default(0),
});
const enquirySchema = z.object({
    eventType: z.string().min(2).max(80), eventDate: date.optional().nullable(), guests: z.coerce.number().int().positive().max(100000).optional().nullable(),
    venue: z.string().max(200).optional().nullable(), budgetRupees: z.coerce.number().min(0).max(1e9).optional().nullable(), message: z.string().max(2000).optional().nullable(),
});

export function registerHubEventsRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('events');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    registerSummaryContributor('events', async (ctx) => {
        if (!ctx.modules.includes('events') || !ctx.permissions.includes('ops:view')) return null;
        const [enq, upcoming, pk, vendors] = await Promise.all([
            PartnerEventsService.enquiries(ctx.businessPartnerId, 'new'),
            PartnerEventsService.bookings(ctx.businessPartnerId, { from: today() }),
            PartnerEventsService.packages(ctx.businessPartnerId),
            PartnerEventsService.vendors(ctx.businessPartnerId),
        ]);
        return {
            stats: [
                { label: 'New enquiries', value: enq.length },
                { label: 'Upcoming events', value: upcoming.filter(b => b.b.status === 'confirmed').length },
            ],
            checklist: [
                { label: 'Build your packages', done: pk.length > 0, href: '/partner/events/packages' },
                { label: 'Add your vendors', done: vendors.length > 0, href: '/partner/events/vendors' },
            ],
        };
    });

    // ── packages ──────────────────────────────────────────────────────────
    const pkgView = (p: any) => ({ id: p.id, name: p.name, category: p.category, description: p.description, unit: p.unit, price: rupees(p.pricePaise), sac: p.sac, gstRate: Number(p.gstRate), isActive: p.isActive });
    const pkgSchema = z.object({ name: z.string().max(120).optional(), category: z.string().optional(), description: z.string().max(500).optional().nullable(), unit: z.string().max(20).optional(), priceRupees: z.coerce.number().min(0).max(1e8).optional(), sac: z.string().max(8).optional(), gstRate: z.coerce.number().optional(), isActive: z.boolean().optional() });
    app.get('/api/hub/events/packages', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await PartnerEventsService.packages(ctxOf(req).businessPartnerId)).map(pkgView) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/packages', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Package added.', data: pkgView(await PartnerEventsService.savePackage(ctxOf(req), null, parse(pkgSchema, req.body))) }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/packages/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Saved.', data: pkgView(await PartnerEventsService.savePackage(ctxOf(req), Number(req.params.id), parse(pkgSchema, req.body))) }); } catch (e) { hubError(e, res, next); }
    });

    // ── enquiries ─────────────────────────────────────────────────────────
    app.get('/api/hub/events/enquiries', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const rows = await PartnerEventsService.enquiries(ctxOf(req).businessPartnerId, typeof req.query.status === 'string' ? req.query.status : undefined);
            res.json({ success: true, data: rows.map(r => ({ ...r.e, budget: rupees(r.e.budgetPaise), customerName: r.customerName, customerPhone: r.customerPhone, publicToken: undefined, statusLink: `/events/e/${r.e.publicToken}` })) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/enquiries', active, mod, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const b = parse(enquirySchema.extend({ customerId: z.number().int().optional().nullable(), name: z.string().max(120).optional(), phone: z.string().max(20).optional() }), req.body);
            const e = await PartnerEventsService.createEnquiry(ctxOf(req), { ...b, source: 'hub' });
            res.status(201).json({ success: true, message: 'Enquiry added.', data: { id: e.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/enquiries/:id', active, mod, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ status: z.enum(['new', 'contacted', 'quoted', 'lost']).optional(), lostReason: z.string().max(300).optional().nullable(), eventDate: date.optional().nullable(), guests: z.number().int().positive().optional().nullable(), venue: z.string().max(200).optional().nullable() }), req.body);
            const e = await PartnerEventsService.updateEnquiry(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: 'Saved.', data: { id: e.id, status: e.status } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/enquiries/:id/quote', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ packages: z.array(z.object({ packageId: z.number().int(), quantity: z.coerce.number().positive() })).max(100).optional(), lines: z.array(lineSchema).max(100).optional(), validUntil: date.optional().nullable(), notes: z.string().max(1000).optional().nullable(), terms: z.string().max(2000).optional().nullable() }), req.body);
            const q = await PartnerEventsService.quote(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: `Quotation ${q.number} drafted.`, data: { id: q.id, number: q.number, total: rupees(q.totalPaise) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/quotations/:id/share', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const q = await PartnerEventsService.share(ctxOf(req), Number(req.params.id));
            res.json({ success: true, message: 'Send this link to the client — they can accept or decline it there.', data: { link: `/events/q/${q.publicToken}`, status: q.status } });
        } catch (e) { hubError(e, res, next); }
    });

    // ── bookings ──────────────────────────────────────────────────────────
    app.get('/api/hub/events/bookings', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const rows = await PartnerEventsService.bookings(ctxOf(req).businessPartnerId, { from: typeof req.query.from === 'string' ? req.query.from : undefined, to: typeof req.query.to === 'string' ? req.query.to : undefined });
            res.json({ success: true, data: rows.map(r => ({ id: r.b.id, title: r.b.title, eventDate: r.b.eventDate, venue: r.b.venue, guests: r.b.guests, status: r.b.status, total: rupees(r.b.totalPaise), paid: rupees(r.paidPaise), vendorCost: rupees(r.vendorCostPaise), customerName: r.customerName, customerPhone: r.customerPhone, invoiced: !!r.b.finalInvoiceDocumentId })) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/bookings', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                quotationId: z.number().int(), title: z.string().max(120).optional(), eventDate: date.optional(), venue: z.string().max(200).optional().nullable(), guests: z.number().int().positive().optional().nullable(),
                milestones: z.array(z.object({ label: z.string().max(80), amountRupees: z.coerce.number().positive().optional(), percent: z.coerce.number().positive().max(100).optional(), dueDate: date.optional().nullable() })).max(12).optional(),
            }), req.body);
            const r = await PartnerEventsService.confirmBooking(ctxOf(req), b.quotationId, b);
            res.status(201).json({ success: true, message: `Booking confirmed.${r.sameDay ? ` Note: you already have ${r.sameDay} event(s) that day.` : ''}`, data: { id: r.booking.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/events/bookings/:id', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const d = await PartnerEventsService.bookingDetail(ctxOf(req).businessPartnerId, Number(req.params.id));
            const paid = d.milestones.filter(m => m.m.status === 'paid').reduce((a, m) => a + m.m.amountPaise, 0);
            const cost = d.costs.reduce((a, c) => a + c.c.taxablePaise + c.c.gstPaise, 0);
            res.json({
                success: true, data: {
                    ...d.booking, total: rupees(d.booking.totalPaise), paid: rupees(paid), vendorCost: rupees(cost), margin: rupees((d.quotation?.taxablePaise ?? 0) - d.costs.reduce((a, c) => a + c.c.taxablePaise, 0)),
                    customer: d.customer && { id: d.customer.id, name: d.customer.name, phone: d.customer.phone },
                    quotation: d.quotation && { id: d.quotation.id, number: d.quotation.number, version: d.quotation.version, lines: d.quotation.lines, taxable: rupees(d.quotation.taxablePaise), tax: rupees(d.quotation.taxPaise) },
                    milestones: d.milestones.map(m => ({ id: m.m.id, label: m.m.label, dueDate: m.m.dueDate, amount: rupees(m.m.amountPaise), status: m.m.status, paidOn: m.m.paidOn, method: m.m.method, reference: m.m.reference, receiptDocumentId: m.m.receiptDocumentId, receiptNumber: m.receiptNumber })),
                    costs: d.costs.map(c => ({ id: c.c.id, vendorName: c.vendorName, description: c.c.description, taxable: rupees(c.c.taxablePaise), gst: rupees(c.c.gstPaise), dueDate: c.c.dueDate, status: c.c.status, paidOn: c.c.paidOn, billNumber: c.c.billNumber, inPurchaseRegister: !!c.c.purchaseBillId })),
                    refunds: d.refunds.map(docView),
                },
            });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/bookings/:id', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                checklist: z.array(z.object({ text: z.string().max(200), done: z.boolean(), owner: z.string().max(80).optional().nullable() })).max(100).optional(),
                staff: z.array(z.object({ name: z.string().max(80), role: z.string().max(60).optional().nullable(), phone: z.string().max(20).optional().nullable() })).max(100).optional(),
                notes: z.string().max(3000).optional().nullable(), venue: z.string().max(200).optional().nullable(), guests: z.number().int().positive().optional().nullable(), status: z.literal('completed').optional(),
            }), req.body);
            const u = await PartnerEventsService.updateBooking(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: 'Saved.', data: { id: u.id, status: u.status } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/bookings/:id/final-invoice', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ dueDate: date.optional().nullable() }), req.body ?? {});
            const doc = await PartnerEventsService.finalInvoice(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: `Final invoice ${doc.number} issued; advances adjusted.`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/bookings/:id/cancel', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ reason: z.string().min(3).max(300), refundRupees: z.coerce.number().min(0).optional() }), req.body);
            const r = await PartnerEventsService.cancel(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: r.voucher ? `Cancelled. Refund voucher ${r.voucher.number} issued.` : 'Cancelled.', data: { voucher: r.voucher && docView(r.voucher), kept: r.kept } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/milestones/:id/pay', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ method: z.string(), reference: z.string().max(80).optional().nullable(), paidOn: date.optional().nullable() }), req.body);
            const r = await PartnerEventsService.payMilestone(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: r.voucher ? `Recorded. Receipt voucher ${r.voucher.number} issued.` : 'Recorded against the final invoice.', data: { voucher: r.voucher && docView(r.voucher) } });
        } catch (e) { hubError(e, res, next); }
    });

    // ── vendors and payables ──────────────────────────────────────────────
    const vendorSchema = z.object({ name: z.string().max(120).optional(), category: z.string().optional(), phone: z.string().max(20).optional().nullable(), gstin: z.string().max(15).optional().nullable(), notes: z.string().max(500).optional().nullable(), isActive: z.boolean().optional() });
    app.get('/api/hub/events/vendors', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerEventsService.vendors(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/vendors', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Vendor added.', data: await PartnerEventsService.saveVendor(ctxOf(req), null, parse(vendorSchema, req.body)) }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/vendors/:id', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Saved.', data: await PartnerEventsService.saveVendor(ctxOf(req), Number(req.params.id), parse(vendorSchema, req.body)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/bookings/:id/costs', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ vendorId: z.number().int(), description: z.string().max(200), taxableRupees: z.coerce.number().positive(), gstRupees: z.coerce.number().min(0).optional(), dueDate: date.optional().nullable() }), req.body);
            const c = await PartnerEventsService.addCost(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: 'Vendor cost added.', data: { id: c.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/costs/:id/pay', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ paidOn: date.optional().nullable(), reference: z.string().max(80).optional().nullable(), billNumber: z.string().max(40).optional().nullable() }), req.body);
            const c = await PartnerEventsService.payCost(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: c.purchaseBillId ? 'Paid. The bill is in your purchase register.' : 'Paid.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/events/payables', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const rows = await PartnerEventsService.payables(ctxOf(req).businessPartnerId);
            res.json({ success: true, data: rows.map(r => ({ id: r.c.id, vendorName: r.vendorName, bookingId: r.c.bookingId, bookingTitle: r.bookingTitle, eventDate: r.eventDate, description: r.c.description, amount: rupees(r.c.taxablePaise + r.c.gstPaise), gst: rupees(r.c.gstPaise), dueDate: r.c.dueDate })) });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Public pages (no login; rate limited under /api/public)
    // ══════════════════════════════════════════════════════════════════════

    app.get('/api/public/events/q/:token', async (req, res, next) => {
        try { const q = await PartnerEventsService.publicQuote(req.params.token); if (!q) return res.status(404).json({ success: false, message: 'Not found' }); res.json({ success: true, data: q }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/events/q/:token/pdf', async (req, res, next) => {
        try {
            const q = await PartnerEventsService.publicQuote(req.params.token);
            if (!q) return res.status(404).json({ success: false, message: 'Not found' });
            const { db } = await import('../db');
            const { partnerQuotations } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            const [row] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.publicToken, q.token!)).limit(1);
            const r = await PartnerSalesService.quotationPdf(row.businessPartnerId, row.id);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${r.name}.pdf"`);
            res.send(r.pdf);
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/events/q/:token/respond', operatorApplyLimiter, async (req, res, next) => {
        try {
            const b = parse(z.object({ decision: z.enum(['accept', 'decline']), note: z.string().max(1000).optional().nullable() }), req.body);
            const q = await PartnerEventsService.respond(req.params.token, b.decision, b.note);
            res.json({ success: true, message: q.status === 'accepted' ? 'Accepted. The planner will confirm your booking and the advance.' : 'Declined. Thank you for letting us know.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/events/e/:token', async (req, res, next) => {
        try { const e = await PartnerEventsService.publicEnquiry(req.params.token); if (!e) return res.status(404).json({ success: false, message: 'Not found' }); res.json({ success: true, data: e }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/events/:code', async (req, res, next) => {
        try {
            const bp = await PartnerEventsService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const pk = await PartnerEventsService.packages(bp.id, true);
            res.json({ success: true, data: { name: bp.displayName, city: bp.district, packages: pk.map(p => ({ name: p.name, category: p.category, unit: p.unit, price: rupees(p.pricePaise), description: p.description })) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/events/:code/enquire', operatorApplyLimiter, async (req, res, next) => {
        try {
            const bp = await PartnerEventsService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(enquirySchema.extend({ name: z.string().min(2).max(120), phone: z.string().max(20), email: z.string().email().max(160).optional().nullable() }), req.body);
            const e = await PartnerEventsService.createEnquiry({ businessPartnerId: bp.id, adminUserId: null }, { ...b, source: 'public' });
            res.status(201).json({ success: true, message: `${bp.displayName} will get back to you with a quotation.`, data: { link: `/events/e/${e.publicToken}` } });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // The UniteFix customer app
    // ══════════════════════════════════════════════════════════════════════

    app.get('/api/events/partners', async (req, res, next) => {
        try {
            const pin = typeof req.query.pincode === 'string' && /^\d{6}$/.test(req.query.pincode) ? req.query.pincode : null;
            if (!pin) return res.status(400).json({ success: false, message: 'pincode is required' });
            res.json({ success: true, data: await PartnerEventsService.partnersNear(pin) });
        } catch (e) { next(e); }
    });
    app.post('/api/events/enquiries', authenticateToken, async (req, res, next) => {
        try {
            const b = parse(enquirySchema.extend({ partnerId: z.number().int() }), req.body);
            const e = await PartnerEventsService.appEnquire((req as any).user.userId, b);
            res.status(201).json({ success: true, message: 'Enquiry sent. The planner will reply with a quotation here.', data: { id: e.id } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/events/my-enquiries', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerEventsService.myEnquiries((req as any).user.userId) }); } catch (e) { hubError(e, res, next); }
    });
}
