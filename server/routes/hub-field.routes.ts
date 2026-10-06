/**
 * Partner Hub — phase 4: field service.
 *
 *   Partner  /api/hub/field/territories*, /technicians*, /rates*, /jobs*,
 *            /earnings, /settings
 *   Customer /api/services/quote — the price and provider for a service at a pincode
 *   Staff    /api/admin/hub/territories*, /api/admin/hub/rates*,
 *            /api/admin/hub/partners/:id/field, /api/admin/hub/subcontract-invoices/run
 */

import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { businessPartners, taxDocuments } from '@shared/schema';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { PartnerFieldService } from '../services/partner-field.service';
import { uploadDocumentBuffer } from '../services/cloudinary.service';
import { registerSummaryContributor } from '../services/hub-summary';
import { recordAudit } from '../lib/audit';
import { docView } from './hub-money.routes';

const rupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}

const upload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) ? cb(null, true) : cb(new Error('Upload a PDF or an image.')),
});

export function registerHubFieldRoutes(app: Express) {
    const active = authenticateHub();
    const field = hubModule('field');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    registerSummaryContributor('field', async (ctx) => {
        if (!ctx.modules.includes('field') || !ctx.permissions.includes('ops:view')) return null;
        const [queue, techs, terr] = await Promise.all([
            PartnerFieldService.jobs(ctx.businessPartnerId, 'queue'),
            PartnerFieldService.technicians(ctx.businessPartnerId),
            PartnerFieldService.territories(ctx.businessPartnerId),
        ]);
        const overdue = queue.filter(j => j.overdue).length;
        const checklist = [
            { label: 'Propose the pincodes you serve', done: terr.some(x => x.status === 'active'), href: '/partner/field/territory' },
            { label: 'Add your technicians and their documents', done: techs.some(x => x.verification === 'verified'), href: '/partner/field/technicians' },
        ];
        return {
            stats: [
                { label: 'Jobs to assign', value: queue.length, hint: overdue ? `${overdue} past the assign-by time` : undefined },
                { label: 'Technicians ready', value: techs.filter(t => t.isActive && t.verification === 'verified').length, hint: `${techs.filter(t => t.verification !== 'verified').length} awaiting UniteFix verification` },
            ],
            checklist,
        };
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Territory
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/field/territories', active, field, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerFieldService.territories(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/field/territories', active, field, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ pincodes: z.union([z.array(z.string()), z.string()]), area: z.string().max(120).optional().nullable() }), req.body);
            const pins = Array.isArray(b.pincodes) ? b.pincodes : b.pincodes.split(/[\s,;]+/);
            const r = await PartnerFieldService.propose(ctxOf(req), { pincodes: pins, area: b.area });
            res.status(201).json({ success: true, message: `${r.added + r.reopened} pincode(s) sent to UniteFix for approval.${r.skipped ? ` ${r.skipped} already on your list.` : ''}`, data: r });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/field/territories/:id/:action', active, field, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req), id = Number(req.params.id);
            let row;
            if (req.params.action === 'pause') row = await PartnerFieldService.setPaused(ctx, id, true, req.body?.reason);
            else if (req.params.action === 'resume') row = await PartnerFieldService.setPaused(ctx, id, false);
            else if (req.params.action === 'withdraw') row = await PartnerFieldService.withdraw(ctx, id);
            else return res.status(404).json({ success: false, message: 'Unknown action' });
            res.json({ success: true, message: `${row.pincode} is now ${row.status}.`, data: row });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Technicians
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/field/technicians', active, field, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerFieldService.technicians(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/field/technicians', active, field, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ fullName: z.string().min(2).max(120), phone: z.string().max(20), services: z.array(z.string().max(60)).max(20).optional() }), req.body);
            const ctx = ctxOf(req);
            const e = await PartnerFieldService.addTechnician(ctx, b);
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_technician_added', changedBy: ctx.adminUserId, metadata: { employeeId: e.id } });
            res.status(201).json({ success: true, message: `${e.fullName} added. They sign in to the UniteFix app with their mobile number. Upload their documents — UniteFix verifies them before their first job.`, data: { id: e.id, partnerId: e.partnerId } });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/hub/field/technicians/:id', active, field, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ isActive: z.boolean().optional(), services: z.array(z.string().max(60)).max(20).optional(), fullName: z.string().max(120).optional() }), req.body);
            const e = await PartnerFieldService.updateTechnician(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: 'Saved.', data: { id: e.id, isActive: e.isActive } });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/field/technicians/:id/documents/:kind', active, field, hubCan('ops:manage'), upload.single('file'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const kind = req.params.kind as 'aadhaar' | 'pan' | 'photo';
            if (!['aadhaar', 'pan', 'photo'].includes(kind)) throw new HubError('Unknown document', 'BAD_KIND');
            if (!req.file) throw new HubError('Choose a file.', 'NO_FILE');
            await PartnerFieldService.technician(ctx.businessPartnerId, Number(req.params.id));
            let url: string;
            try { url = (await uploadDocumentBuffer(req.file.buffer, `partner_staff/${ctx.partnerCode}`, req.file.mimetype)).url; }
            catch (err: any) { throw new HubError(`Upload failed: ${err?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502); }
            await PartnerFieldService.setTechnicianDocument(ctx, Number(req.params.id), kind, url);
            res.status(201).json({ success: true, message: 'Uploaded. UniteFix will verify it.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Rates
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/field/rates', active, field, hubCan('ops:view'), async (req, res, next) => {
        try {
            const pct = await PartnerFieldService.guardrailPercent();
            res.json({ success: true, data: { guardrailPercent: pct, services: await PartnerFieldService.rates(ctxOf(req).businessPartnerId) } });
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/hub/field/rates/:serviceId', active, field, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ price: z.coerce.number().int().positive().max(10_000_000), effectiveFrom: z.string().optional().nullable() }), req.body);
            const r = await PartnerFieldService.setRate(ctxOf(req), { catalogServiceId: Number(req.params.serviceId), price: b.price, effectiveFrom: b.effectiveFrom });
            res.json({ success: true, message: r.status === 'live' ? `₹${r.basePrice} goes live ${new Date(r.effectiveFrom).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : `₹${r.basePrice} sent to UniteFix for review.`, data: r });
        } catch (e) { hubError(e, res, next); }
    });

    app.delete('/api/hub/field/rates/:serviceId', active, field, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const r = await PartnerFieldService.clearRate(ctxOf(req), Number(req.params.serviceId));
            res.json({ success: true, message: 'Back to the national price from tomorrow.', data: r });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Jobs
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/field/jobs', active, field, hubCan('ops:view'), async (req, res, next) => {
        try {
            const view = (['queue', 'active', 'done'] as const).find(v => v === req.query.view) ?? 'queue';
            res.json({ success: true, data: await PartnerFieldService.jobs(ctxOf(req).businessPartnerId, view) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/field/jobs/:id/assign', active, field, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ employeeId: z.number().int() }), req.body);
            await PartnerFieldService.assign(ctxOf(req), Number(req.params.id), b.employeeId);
            res.json({ success: true, message: 'Assigned. The technician has been notified.' });
        } catch (e: any) {
            if (!(e instanceof HubError) && e?.message) return res.status(409).json({ success: false, message: e.message });
            hubError(e, res, next);
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Money and settings
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/field/earnings', active, field, hubCan('money:view'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const [rows, invoices] = await Promise.all([
                PartnerFieldService.earnings(ctx.businessPartnerId),
                db.select().from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, ctx.businessPartnerId), eq(taxDocuments.purpose, 'subcontract'))).orderBy(desc(taxDocuments.issuedAt)),
            ]);
            res.json({
                success: true, data: {
                    held: rupees(rows.filter(r => r.e.status === 'held').reduce((a, r) => a + r.e.amountPaise, 0)),
                    released: rupees(rows.filter(r => r.e.status === 'released').reduce((a, r) => a + r.e.amountPaise, 0)),
                    jobs: rows.map(r => ({ id: r.e.id, serviceId: r.serviceId, technician: r.techName, amount: rupees(r.e.amountPaise), status: r.e.status, releaseAt: r.e.releaseAt, completedAt: r.completedAt })),
                    invoices: invoices.map(docView),
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/hub/field/settings', active, field, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ fieldSupportPhone: z.string().max(20).optional().nullable() }), req.body);
            const phone = b.fieldSupportPhone ? b.fieldSupportPhone.replace(/\D/g, '').slice(-10) : null;
            if (b.fieldSupportPhone && phone?.length !== 10) throw new HubError('A 10-digit number customers can call.', 'BAD_PHONE');
            await db.update(businessPartners).set({ fieldSupportPhone: phone, updatedAt: new Date() }).where(eq(businessPartners.id, ctxOf(req).businessPartnerId));
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Customer: price and provider at a pincode
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/services/quote', async (req, res, next) => {
        try {
            const id = Number(req.query.catalogServiceId ?? req.query.serviceId);
            const pin = typeof req.query.pincode === 'string' && /^\d{6}$/.test(req.query.pincode) ? req.query.pincode : null;
            if (!id) return res.status(400).json({ success: false, message: 'catalogServiceId is required' });
            const q = await PartnerFieldService.quote(id, pin);
            if (!q) return res.status(404).json({ success: false, message: 'Service not found' });
            res.json({ success: true, data: q });
        } catch (e) { next(e); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Staff
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/hub/territories', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await PartnerFieldService.adminTerritories({ status: typeof req.query.status === 'string' ? req.query.status : undefined, pincode: typeof req.query.pincode === 'string' ? req.query.pincode : undefined });
            res.json({ success: true, data: rows.map(r => ({ ...r.t, partnerCode: r.partnerCode, partnerName: r.partnerName, serviceable: !!r.serviceable, area: r.area ?? r.t.proposedArea })) });
        } catch (e) { next(e); }
    });

    app.post('/api/admin/hub/territories/review', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500), decision: z.enum(['approve', 'reject']), mode: z.enum(['exclusive', 'shared']).optional(), note: z.string().max(300).optional().nullable() }), req.body);
            const admin = (req as any).admin as { userId: number };
            const r = await PartnerFieldService.review(admin.userId, b.ids, b.decision, { mode: b.mode, note: b.note });
            res.json({ success: true, message: `${r.done.length} ${b.decision === 'approve' ? 'approved' : 'rejected'}.${r.conflicts.length ? ` Already exclusive to another partner: ${r.conflicts.join(', ')} — approve those as shared.` : ''}`, data: r });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/admin/hub/territories/:id', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ mode: z.enum(['exclusive', 'shared']).optional(), status: z.enum(['active', 'paused', 'withdrawn']).optional(), note: z.string().max(300).optional().nullable() }), req.body);
            const admin = (req as any).admin as { userId: number };
            const row = await PartnerFieldService.adminUpdate(admin.userId, Number(req.params.id), b);
            res.json({ success: true, message: 'Saved.', data: row });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/admin/hub/rates/pending', authenticateAdmin, async (_req, res, next) => {
        try {
            const rows = await PartnerFieldService.pendingRates();
            res.json({ success: true, data: rows.map(r => ({ id: r.r.id, partnerName: r.partnerName, partnerCode: r.partnerCode, serviceName: r.serviceName, nationalPrice: r.nationalPrice, price: r.r.basePrice, effectiveFrom: r.r.effectiveFrom, submittedAt: r.r.submittedAt })) });
        } catch (e) { next(e); }
    });

    app.post('/api/admin/hub/rates/review', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).min(1).max(500), approve: z.boolean(), note: z.string().max(300).optional().nullable() }), req.body);
            const admin = (req as any).admin as { userId: number };
            const ids = await PartnerFieldService.reviewRates(admin.userId, b.ids, b.approve, b.note);
            res.json({ success: true, message: `${ids.length} rate(s) ${b.approve ? 'approved' : 'rejected'}.` });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/admin/hub/partners/:id/field', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ fieldFeePercent: z.number().min(5).max(40).nullable().optional(), fieldTier: z.enum(['new', 'standard', 'preferred', 'restricted']).optional() }), req.body);
            const admin = (req as any).admin as { userId: number };
            await db.update(businessPartners).set({
                ...(b.fieldFeePercent !== undefined ? { fieldFeePercent: b.fieldFeePercent == null ? null : String(b.fieldFeePercent) } : {}),
                ...(b.fieldTier ? { fieldTier: b.fieldTier } : {}), updatedAt: new Date(),
            }).where(eq(businessPartners.id, Number(req.params.id)));
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.id), action: 'hub_field_settings', changedBy: admin.userId, metadata: b });
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/admin/hub/subcontract-invoices/run', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), req.body);
            const issued = await PartnerFieldService.runMonthlySubcontractInvoices(new Date(`${b.month}-01T00:00:00Z`));
            res.json({ success: true, message: issued.length ? `${issued.length} partner invoice(s) generated.` : 'Nothing new to invoice for that month.', data: { issued } });
        } catch (e) { next(e); }
    });

    app.post('/api/admin/hub/field/release', authenticateAdmin, requireSuperAdmin, async (_req, res, next) => {
        try {
            const escalated = await PartnerFieldService.escalateOverdue();
            const released = await PartnerFieldService.releaseDue();
            res.json({ success: true, message: `${released} job value(s) released; ${escalated.length} job(s) escalated.` });
        } catch (e) { next(e); }
    });
}
