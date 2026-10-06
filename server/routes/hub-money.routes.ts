/**
 * Partner Hub — phase 2: purchases, money, GST documents, settlements.
 *
 *   Partner  /api/hub/purchases*, /api/hub/money, /api/hub/tax-documents/:id/pdf,
 *            /api/hub/settlements/:id/pdf, /api/b2b/tax-documents/:id/pdf (app)
 *   Staff    /api/admin/hub/settlements*, /api/admin/hub/tax-documents*,
 *            /api/admin/hub/fee-invoices/run, /api/admin/hub/b2b-invoices/backfill
 */

import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { partnerPurchaseBills, settlementRuns, taxDocuments } from '@shared/schema';
import { checkGstin } from '@shared/hub';
import { validateBody } from '../middleware/validate';
import { authenticateAdmin, requireSuperAdmin, authenticateBusinessPartner } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { TaxDocumentService } from '../services/tax-documents.service';
import { renderTaxDocumentPdf } from '../services/tax-document-pdf';
import { SettlementService, SettlementError } from '../services/settlement.service';
import { BusinessPartnerService } from '../services/business-partner.service';
import { uploadDocumentBuffer } from '../services/cloudinary.service';
import { recordAudit } from '../lib/audit';
import { registerSummaryContributor, rupeeLabel } from '../services/hub-summary';
import { B2bOrderService } from '../services/b2b-order.service';

const rupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;
const toPaise = (r: number) => Math.round(r * 100);

const billSchema = z.object({
    supplierName: z.string().trim().min(2).max(160),
    supplierGstin: z.string().trim().max(15).optional().nullable(),
    billNumber: z.string().trim().min(1).max(40),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    taxableRupees: z.coerce.number().min(0).max(1e8),
    cgstRupees: z.coerce.number().min(0).max(1e8).default(0),
    sgstRupees: z.coerce.number().min(0).max(1e8).default(0),
    igstRupees: z.coerce.number().min(0).max(1e8).default(0),
    notes: z.string().trim().max(300).optional().nullable(),
});

const upload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) ? cb(null, true) : cb(new Error('Upload a PDF or an image.')),
});

export function docView(d: typeof taxDocuments.$inferSelect) {
    return {
        id: d.id, docKind: d.docKind, issuer: d.issuer, number: d.number, purpose: d.purpose, fy: d.fy,
        b2bOrderId: d.b2bOrderId, issuedAt: d.issuedAt, periodFrom: d.periodFrom, periodTo: d.periodTo,
        supplier: d.supplier, recipient: d.recipient, placeOfSupply: d.placeOfSupplyName, isInterstate: d.isInterstate,
        taxable: rupees(d.taxablePaise), cgst: rupees(d.cgstPaise), sgst: rupees(d.sgstPaise), igst: rupees(d.igstPaise), total: rupees(d.totalPaise),
        status: d.status, irn: d.irn, irnStatus: d.irnStatus, notes: d.notes,
    };
}

function runView(r: typeof settlementRuns.$inferSelect) {
    return {
        id: r.id, runCode: r.runCode, status: r.status, ftthOwed: rupees(r.ftthOwedPaise), b2bBalance: rupees(r.b2bBalancePaise),
        offset: rupees(r.offsetPaise), payout: rupees(r.payoutPaise), method: r.method, payoutReference: r.payoutReference,
        failureReason: r.failureReason, notes: r.notes, createdAt: r.createdAt, paidAt: r.paidAt,
    };
}

async function sendDocPdf(res: Response, docId: number, allow: (d: typeof taxDocuments.$inferSelect) => boolean) {
    const found = await TaxDocumentService.withLines(docId);
    if (!found || !allow(found.doc)) return res.status(404).json({ success: false, message: 'Document not found' });
    let against: string | null = null;
    if (found.doc.originalDocumentId) {
        const [o] = await db.select({ number: taxDocuments.number }).from(taxDocuments).where(eq(taxDocuments.id, found.doc.originalDocumentId)).limit(1);
        against = o?.number ?? null;
    }
    const pdf = await renderTaxDocumentPdf(found.doc, found.lines, { againstNumber: against });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${found.doc.number.replace(/\//g, '-')}.pdf"`);
    res.send(pdf);
}

function settlementError(e: any, res: Response, next: NextFunction) {
    if (e instanceof SettlementError) return res.status(e.code === 'NOT_FOUND' ? 404 : e.code === 'PAYOUT_FAILED' ? 502 : 409).json({ success: false, code: e.code, message: e.message });
    hubError(e, res, next);
}

export function registerHubMoneyRoutes(app: Express) {
    const active = authenticateHub();

    // Home page figures for the money and parts modules.
    registerSummaryContributor('money', async (ctx) => {
        if (!ctx.permissions.includes('money:view')) return null;
        const p = await SettlementService.position(ctx.businessPartnerId);
        return { stats: [
            { label: 'UniteFix owes you', value: rupeeLabel(p.ftthOwed + Math.max(0, -p.b2bBalance)), hint: p.offset ? `${rupeeLabel(p.offset)} goes to parts dues` : undefined },
            { label: 'You owe UniteFix', value: rupeeLabel(Math.max(0, p.b2bBalance)) },
        ] };
    });
    registerSummaryContributor('parts', async (ctx) => {
        if (!ctx.modules.includes('parts')) return null;
        const rows = await B2bOrderService.list({ businessPartnerId: ctx.businessPartnerId, limit: 200 });
        const open = rows.filter(r => !['delivered', 'cancelled', 'returned'].includes(r.order.status)).length;
        return { stats: [{ label: 'Parts orders in progress', value: open }] };
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Partner — purchases
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/purchases', active, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const [docs, bills] = await Promise.all([
                TaxDocumentService.forPartner(ctx.businessPartnerId, { direction: 'received' }),
                db.select().from(partnerPurchaseBills).where(eq(partnerPurchaseBills.businessPartnerId, ctx.businessPartnerId)).orderBy(desc(partnerPurchaseBills.billDate)),
            ]);
            // Input tax: UniteFix invoices add, its credit notes take away, uploaded bills add.
            const sign = (k: string) => k === 'credit_note' ? -1 : 1;
            const itc = {
                cgst: rupees(docs.reduce((a, d) => a + sign(d.docKind) * d.cgstPaise, 0) + bills.reduce((a, b) => a + b.cgstPaise, 0)),
                sgst: rupees(docs.reduce((a, d) => a + sign(d.docKind) * d.sgstPaise, 0) + bills.reduce((a, b) => a + b.sgstPaise, 0)),
                igst: rupees(docs.reduce((a, d) => a + sign(d.docKind) * d.igstPaise, 0) + bills.reduce((a, b) => a + b.igstPaise, 0)),
            };
            res.json({
                success: true,
                data: {
                    documents: docs.map(docView),
                    bills: bills.map(b => ({ id: b.id, supplierName: b.supplierName, supplierGstin: b.supplierGstin, billNumber: b.billNumber, billDate: b.billDate, taxable: rupees(b.taxablePaise), cgst: rupees(b.cgstPaise), sgst: rupees(b.sgstPaise), igst: rupees(b.igstPaise), total: rupees(b.totalPaise), fileUrl: b.fileUrl, notes: b.notes })),
                    itc,
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/purchases/bills', active, hubCan('purchases:manage'), upload.single('file'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const parsed = billSchema.safeParse(req.body);
            if (!parsed.success) throw new HubError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '), 'BAD_INPUT');
            const b = parsed.data;
            const gstin = b.supplierGstin?.trim().toUpperCase() || null;
            if (gstin && !checkGstin(gstin).valid) throw new HubError(`Supplier GSTIN: ${checkGstin(gstin).reason}`, 'BAD_GSTIN');
            if (b.igstRupees > 0 && (b.cgstRupees > 0 || b.sgstRupees > 0)) throw new HubError('A bill has either IGST or CGST + SGST, not both.', 'BAD_TAX');
            let fileUrl: string | null = null;
            if (req.file) fileUrl = (await uploadDocumentBuffer(req.file.buffer, `partner_bills/${ctx.partnerCode}`, req.file.mimetype)).url;
            const total = toPaise(b.taxableRupees) + toPaise(b.cgstRupees) + toPaise(b.sgstRupees) + toPaise(b.igstRupees);
            const [row] = await db.insert(partnerPurchaseBills).values({
                businessPartnerId: ctx.businessPartnerId, supplierName: b.supplierName, supplierGstin: gstin, billNumber: b.billNumber, billDate: b.billDate,
                taxablePaise: toPaise(b.taxableRupees), cgstPaise: toPaise(b.cgstRupees), sgstPaise: toPaise(b.sgstRupees), igstPaise: toPaise(b.igstRupees),
                totalPaise: total, fileUrl, notes: b.notes ?? null, createdByAdminUserId: ctx.adminUserId,
            }).returning();
            res.status(201).json({ success: true, message: 'Bill recorded.', data: { id: row.id } });
        } catch (e: any) {
            if (e?.code === '23505') return res.status(409).json({ success: false, message: 'That bill number from this supplier is already recorded.' });
            hubError(e, res, next);
        }
    });

    app.delete('/api/hub/purchases/bills/:id', active, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const rows = await db.delete(partnerPurchaseBills).where(and(eq(partnerPurchaseBills.id, Number(req.params.id)), eq(partnerPurchaseBills.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!rows.length) return res.status(404).json({ success: false, message: 'Bill not found' });
            res.json({ success: true, message: 'Removed.' });
        } catch (e) { hubError(e, res, next); }
    });

    /** Purchase register as CSV, for the accountant. */
    app.get('/api/hub/purchases/register.csv', active, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const from = typeof req.query.from === 'string' ? req.query.from : '1900-01-01';
            const to = typeof req.query.to === 'string' ? req.query.to : '2999-12-31';
            const docs = (await TaxDocumentService.forPartner(ctx.businessPartnerId, { direction: 'received', from, to }));
            const bills = await db.select().from(partnerPurchaseBills).where(and(eq(partnerPurchaseBills.businessPartnerId, ctx.businessPartnerId), gte(partnerPurchaseBills.billDate, from), lte(partnerPurchaseBills.billDate, to)));
            const rowsOut = [
                ['Date', 'Supplier', 'Supplier GSTIN', 'Document', 'Type', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
                ...docs.map(d => {
                    const s = d.docKind === 'credit_note' ? -1 : 1;
                    return [String(d.issuedAt).slice(0, 10), (d.supplier as any).name, (d.supplier as any).gstin ?? '', d.number, d.docKind, s * d.taxablePaise / 100, s * d.cgstPaise / 100, s * d.sgstPaise / 100, s * d.igstPaise / 100, s * d.totalPaise / 100];
                }),
                ...bills.map(b => [b.billDate, b.supplierName, b.supplierGstin ?? '', b.billNumber, 'supplier_bill', b.taxablePaise / 100, b.cgstPaise / 100, b.sgstPaise / 100, b.igstPaise / 100, b.totalPaise / 100]),
            ];
            const csv = rowsOut.map(r => r.map(v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="purchase-register-${ctx.partnerCode}-${from}-${to}.csv"`);
            res.send(csv);
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Partner — money
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/money', active, hubCan('money:view'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const [statement, position, runs, fees, credit] = await Promise.all([
                BusinessPartnerService.statement(ctx.businessPartnerId, { limit: 300 }),
                SettlementService.position(ctx.businessPartnerId),
                SettlementService.list({ businessPartnerId: ctx.businessPartnerId, limit: 50 }),
                TaxDocumentService.forPartner(ctx.businessPartnerId, { direction: 'received', purpose: 'fee' }),
                BusinessPartnerService.creditPosition(ctx.businessPartnerId),
            ]);
            res.json({
                success: true,
                data: {
                    owedToYou: rupees(position.ftthOwed + Math.max(0, -position.b2bBalance)),
                    youOwe: rupees(Math.max(0, position.b2bBalance)),
                    nextPayout: rupees(position.payout), offsetNext: rupees(position.offset),
                    credit: { limit: rupees(credit.limitPaise), outstanding: rupees(credit.outstandingPaise), available: rupees(credit.availablePaise) },
                    lines: statement.lines.map((l: any) => ({ id: `${l.source}-${l.id}`, source: l.source, entryType: l.entryType, amount: rupees(l.amountPaise), description: l.description, createdAt: l.createdAt })),
                    settlements: runs.map(r => runView(r.run)),
                    feeInvoices: fees.map(docView),
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/tax-documents/:id/pdf', active, async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            await sendDocPdf(res, Number(req.params.id), d => TaxDocumentService.canSee(d, ctx.businessPartnerId));
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/settlements/:id/pdf', active, hubCan('money:view'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const [run] = await db.select().from(settlementRuns).where(and(eq(settlementRuns.id, Number(req.params.id)), eq(settlementRuns.businessPartnerId, ctx.businessPartnerId))).limit(1);
            if (!run) return res.status(404).json({ success: false, message: 'Not found' });
            const pdf = await SettlementService.pdf(run);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${run.runCode}.pdf"`);
            res.send(pdf);
        } catch (e) { settlementError(e, res, next); }
    });

    /** The app's business-partner mode (mobile login) can open its own GST documents too. */
    app.get('/api/b2b/tax-documents/:id/pdf', authenticateBusinessPartner, async (req, res, next) => {
        try {
            const bp = (req as any).businessPartner as { id: number };
            await sendDocPdf(res, Number(req.params.id), d => TaxDocumentService.canSee(d, bp.id));
        } catch (e) { next(e); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Staff
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/hub/settlements/worklist', authenticateAdmin, async (_req, res, next) => {
        try {
            const rows = await SettlementService.worklist();
            res.json({ success: true, data: rows.map(r => ({ ...r, ftthOwed: rupees(r.ftthOwed), b2bBalance: rupees(r.b2bBalance), offset: rupees(r.offset), payout: rupees(r.payout) })) });
        } catch (e) { next(e); }
    });

    app.get('/api/admin/hub/settlements', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await SettlementService.list({ businessPartnerId: req.query.partnerId ? Number(req.query.partnerId) : undefined });
            res.json({ success: true, data: rows.map(r => ({ ...runView(r.run), partnerCode: r.partnerCode, displayName: r.displayName, businessPartnerId: r.run.businessPartnerId })) });
        } catch (e) { next(e); }
    });

    app.post('/api/admin/hub/settlements', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const run = await SettlementService.create(Number(req.body?.businessPartnerId), admin.userId, req.body?.notes ?? null);
            await recordAudit({ entityType: 'business_partner', entityId: run.businessPartnerId, action: 'settlement_drafted', changedBy: admin.userId, metadata: { runCode: run.runCode, payoutPaise: run.payoutPaise, offsetPaise: run.offsetPaise } });
            res.status(201).json({ success: true, message: `Draft ${run.runCode}: pay ₹${rupees(run.payoutPaise)}${run.offsetPaise ? `, offset ₹${rupees(run.offsetPaise)}` : ''}.`, data: runView(run) });
        } catch (e) { settlementError(e, res, next); }
    });

    app.post('/api/admin/hub/settlements/:id/pay', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const how = req.body?.method === 'cashfree' ? { method: 'cashfree' as const } : { method: 'manual' as const, reference: String(req.body?.reference ?? '') };
            const run = await SettlementService.pay(Number(req.params.id), admin.userId, how);
            await recordAudit({ entityType: 'business_partner', entityId: run.businessPartnerId, action: `settlement_${run.status}`, changedBy: admin.userId, metadata: { runCode: run.runCode, method: run.method, reference: run.payoutReference } });
            res.json({ success: true, message: run.status === 'paid' ? 'Settlement recorded as paid.' : 'Transfer requested; it shows as paid once the bank confirms.', data: runView(run) });
        } catch (e) { settlementError(e, res, next); }
    });

    app.post('/api/admin/hub/settlements/:id/cancel', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const run = await SettlementService.cancel(Number(req.params.id), admin.userId);
            res.json({ success: true, message: 'Draft cancelled.', data: runView(run) });
        } catch (e) { settlementError(e, res, next); }
    });

    app.post('/api/admin/hub/settlements/:id/sync', authenticateAdmin, async (req, res, next) => {
        try {
            const run = await SettlementService.sync(Number(req.params.id));
            res.json({ success: true, data: runView(run) });
        } catch (e) { settlementError(e, res, next); }
    });

    app.get('/api/admin/hub/settlements/:id/pdf', authenticateAdmin, async (req, res, next) => {
        try {
            const [run] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, Number(req.params.id))).limit(1);
            if (!run) return res.status(404).json({ success: false, message: 'Not found' });
            const pdf = await SettlementService.pdf(run);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${run.runCode}.pdf"`);
            res.send(pdf);
        } catch (e) { settlementError(e, res, next); }
    });

    app.get('/api/admin/hub/tax-documents', authenticateAdmin, async (req, res, next) => {
        try {
            const conds: any[] = [];
            if (req.query.partnerId) conds.push(eq(taxDocuments.recipientPartnerId, Number(req.query.partnerId)));
            if (typeof req.query.purpose === 'string') conds.push(eq(taxDocuments.purpose, req.query.purpose));
            if (typeof req.query.issuer === 'string') conds.push(eq(taxDocuments.issuer, req.query.issuer));
            const rows = await db.select().from(taxDocuments).where(conds.length ? and(...conds) : undefined).orderBy(desc(taxDocuments.issuedAt)).limit(500);
            res.json({ success: true, data: rows.map(docView) });
        } catch (e) { next(e); }
    });

    app.get('/api/admin/hub/tax-documents/:id/pdf', authenticateAdmin, async (req, res, next) => {
        try { await sendDocPdf(res, Number(req.params.id), () => true); } catch (e) { next(e); }
    });

    app.post('/api/admin/hub/fee-invoices/run', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const m = String(req.body?.month ?? '');
            if (!/^\d{4}-\d{2}$/.test(m)) throw new HubError('month must be YYYY-MM', 'BAD_MONTH');
            const issued = await TaxDocumentService.runMonthlyFeeInvoices(new Date(`${m}-01T00:00:00Z`), admin.userId);
            await recordAudit({ entityType: 'business_partner', entityId: 0, action: 'fee_invoices_run', changedBy: admin.userId, metadata: { month: m, issued } });
            res.json({ success: true, message: issued.length ? `${issued.length} fee invoice(s) issued.` : 'No fees to invoice for that month (or already invoiced).', data: { issued } });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/admin/hub/b2b-invoices/backfill', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const issued = await TaxDocumentService.issueMissingB2bInvoices(admin.userId);
            res.json({ success: true, message: issued.length ? `${issued.length} invoice(s) issued for orders dispatched earlier.` : 'Every dispatched order already has its invoice.', data: { issued } });
        } catch (e) { next(e); }
    });
}

