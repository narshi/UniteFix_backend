/**
 * Partner Hub — phase 3: customers, quotations, invoices, payments, GST desk.
 *
 *   /api/hub/customers*        customer book (+ import broadband subscribers)
 *   /api/hub/quotations*       versioned quotations → invoice
 *   /api/hub/invoices*         invoices / bills of supply, credit notes, payments, IRN
 *   /api/hub/sales/settings    invoice prefix, terms, filing frequency
 *   /api/hub/gst/*             summary, registers (CSV), HSN summary, GSTR-1 JSON (Pro)
 */

import type { Express } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { businessPartners, taxDocuments, type PartnerCustomer, type TaxDocument } from '@shared/schema';
import { PLAN_LIMITS } from '@shared/hub';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { PartnerSalesService, GST_RATES } from '../services/partner-sales.service';
import { GstDeskService } from '../services/gst-desk.service';
import { BusinessPartnerService } from '../services/business-partner.service';
import { registerSummaryContributor, rupeeLabel } from '../services/hub-summary';
import { docView } from './hub-money.routes';

const rupees = (p: number | null | undefined) => p == null ? null : Math.round(p) / 100;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const customerSchema = z.object({
    name: z.string().max(160).optional(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().max(160).optional().nullable(),
    gstin: z.string().max(15).optional().nullable(),
    stateCode: z.string().max(2).optional().nullable(),
    address: z.string().max(400).optional().nullable(),
    pincode: z.string().max(6).optional().nullable(),
    tags: z.array(z.string().max(30)).max(10).optional(),
    notes: z.string().max(1000).optional().nullable(),
    archived: z.boolean().optional(),
});

const lineSchema = z.object({
    description: z.string().max(300),
    hsnSac: z.string().max(8).optional().nullable(),
    quantity: z.coerce.number().positive().max(1e6),
    unit: z.string().max(12).optional().nullable(),
    rateRupees: z.coerce.number().min(0).max(1e8),
    gstRate: z.coerce.number().min(0).max(40).default(0),
});

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'BAD_INPUT');
    return r.data;
}

function customerView(c: PartnerCustomer, outstanding?: number) {
    return {
        id: c.id, name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, stateCode: c.stateCode, stateName: c.stateName,
        address: c.address, pincode: c.pincode, tags: c.tags, notes: c.notes, archived: !!c.archivedAt,
        fromBroadband: !!c.ftthConnectionId, outstanding: outstanding == null ? undefined : rupees(outstanding), createdAt: c.createdAt,
    };
}

function invoiceRow(r: { doc: TaxDocument; paidPaise: number; creditedPaise: number; outstandingPaise: number }) {
    const today = new Date().toISOString().slice(0, 10);
    return {
        ...docView(r.doc), customerId: r.doc.partnerCustomerId, dueDate: r.doc.dueDate,
        paid: rupees(r.paidPaise), credited: rupees(r.creditedPaise), outstanding: rupees(r.outstandingPaise),
        overdue: r.outstandingPaise > 0 && !!r.doc.dueDate && r.doc.dueDate < today,
    };
}

export function registerHubSalesRoutes(app: Express) {
    const active = authenticateHub();
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    registerSummaryContributor('sales', async (ctx) => {
        if (!ctx.permissions.includes('sales:manage')) return null;
        const rows = await PartnerSalesService.listInvoices(ctx.businessPartnerId);
        const today = new Date().toISOString().slice(0, 10);
        const due = rows.reduce((a, r) => a + r.outstandingPaise, 0);
        const overdue = rows.filter(r => r.outstandingPaise > 0 && r.doc.dueDate && r.doc.dueDate < today).length;
        const used = await PartnerSalesService.invoicesThisMonth(ctx.businessPartnerId);
        const limit = PLAN_LIMITS[ctx.plan].invoicesPerMonth;
        return {
            stats: [
                { label: 'Customers owe you', value: rupeeLabel(due), hint: overdue ? `${overdue} invoice${overdue === 1 ? '' : 's'} overdue` : undefined },
                { label: 'Invoices this month', value: limit ? `${used} / ${limit}` : used },
            ],
        };
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Customers
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/customers', active, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const [rows, owed] = await Promise.all([
                PartnerSalesService.listCustomers(ctx.businessPartnerId, typeof req.query.q === 'string' ? req.query.q : undefined, req.query.archived === '1'),
                PartnerSalesService.receivables(ctx.businessPartnerId),
            ]);
            res.json({ success: true, data: rows.map(c => customerView(c, owed.get(c.id) ?? 0)) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/customers', active, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const body = parse(customerSchema.extend({ name: z.string().min(1).max(160) }), req.body);
            const row = await PartnerSalesService.createCustomer(ctxOf(req), body);
            res.status(201).json({ success: true, message: 'Customer added.', data: customerView(row) });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/customers/:id', active, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const c = await PartnerSalesService.customer(ctx.businessPartnerId, Number(req.params.id));
            const canSales = ctx.permissions.includes('sales:manage');
            const [invoices, quotes] = canSales ? await Promise.all([
                PartnerSalesService.listInvoices(ctx.businessPartnerId, { customerId: c.id }),
                PartnerSalesService.listQuotations(ctx.businessPartnerId, { customerId: c.id }),
            ]) : [[], []];
            res.json({
                success: true, data: {
                    customer: customerView(c, invoices.reduce((a, r) => a + r.outstandingPaise, 0)),
                    invoices: invoices.map(invoiceRow),
                    quotations: quotes.map(q => ({ id: q.q.id, number: q.q.number, version: q.q.version, status: q.q.status, total: rupees(q.q.totalPaise), createdAt: q.q.createdAt })),
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/hub/customers/:id', active, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const row = await PartnerSalesService.updateCustomer(ctxOf(req), Number(req.params.id), parse(customerSchema, req.body));
            res.json({ success: true, message: 'Saved.', data: customerView(row) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/customers/import-broadband', active, hubCan('customers:manage'), async (req, res, next) => {
        try {
            const r = await PartnerSalesService.importBroadbandSubscribers(ctxOf(req));
            res.json({ success: true, message: `${r.added} added, ${r.linked} matched to existing customers.`, data: r });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Sales settings
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/sales/settings', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            const [issued] = await db.select({ id: taxDocuments.id }).from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, ctx.businessPartnerId), eq(taxDocuments.issuer, 'partner'))).limit(1);
            const limit = PLAN_LIMITS[ctx.plan].invoicesPerMonth;
            res.json({
                success: true, data: {
                    invoicePrefix: bp?.invoicePrefix ?? null, prefixLocked: !!issued, invoiceTerms: bp?.invoiceTerms ?? null,
                    gstFilingFrequency: bp?.gstFilingFrequency ?? 'monthly', registered: !!bp?.gstin, gstin: bp?.gstin ?? null,
                    eInvoiceRequired: !!bp?.aatoAbove5cr, gstRates: GST_RATES, plan: ctx.plan,
                    invoicesThisMonth: await PartnerSalesService.invoicesThisMonth(ctx.businessPartnerId), invoiceLimit: limit,
                    gstExports: PLAN_LIMITS[ctx.plan].gstExports,
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/hub/sales/settings', active, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const b = parse(z.object({
                invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, '1–4 letters or digits').optional(),
                invoiceTerms: z.string().max(600).optional().nullable(),
                gstFilingFrequency: z.enum(['monthly', 'quarterly']).optional(),
            }), req.body);
            const set: Record<string, unknown> = { updatedAt: new Date() };
            if (b.invoicePrefix !== undefined) {
                const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
                if (bp?.invoicePrefix !== b.invoicePrefix) {
                    const [issued] = await db.select({ id: taxDocuments.id }).from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, ctx.businessPartnerId), eq(taxDocuments.issuer, 'partner'))).limit(1);
                    if (issued) throw new HubError('The invoice prefix is fixed once your first invoice is issued — a series must not change name mid-year.', 'PREFIX_LOCKED', 409);
                }
                set.invoicePrefix = b.invoicePrefix;
            }
            if (b.invoiceTerms !== undefined) set.invoiceTerms = b.invoiceTerms?.trim() || null;
            if (b.gstFilingFrequency) set.gstFilingFrequency = b.gstFilingFrequency;
            await db.update(businessPartners).set(set).where(eq(businessPartners.id, ctx.businessPartnerId));
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Quotations
    // ═══════════════════════════════════════════════════════════════════════

    const quoteView = (q: any, customerName?: string) => ({
        id: q.id, number: q.number, version: q.version, status: q.status, customerId: q.customerId, customerName, validUntil: q.validUntil,
        lines: q.lines, taxable: rupees(q.taxablePaise), tax: rupees(q.taxPaise), total: rupees(q.totalPaise), notes: q.notes, terms: q.terms,
        source: q.source, invoiceDocumentId: q.invoiceDocumentId, createdAt: q.createdAt, updatedAt: q.updatedAt,
    });

    app.get('/api/hub/quotations', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const rows = await PartnerSalesService.listQuotations(ctxOf(req).businessPartnerId, { source: typeof req.query.source === 'string' ? req.query.source : undefined });
            res.json({ success: true, data: rows.map(r => quoteView(r.q, r.customerName)) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/quotations', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ customerId: z.number().int(), lines: z.array(lineSchema).min(1).max(100), validUntil: date.optional().nullable(), notes: z.string().max(1000).optional().nullable(), terms: z.string().max(1000).optional().nullable() }), req.body);
            const q = await PartnerSalesService.createQuotation(ctxOf(req), b);
            res.status(201).json({ success: true, message: `Quotation ${q.number} saved.`, data: quoteView(q) });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/quotations/:id', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const q = await PartnerSalesService.quotation(ctx.businessPartnerId, Number(req.params.id));
            const c = await PartnerSalesService.customer(ctx.businessPartnerId, q.customerId);
            const history = (await PartnerSalesService.listQuotations(ctx.businessPartnerId, { customerId: q.customerId })).filter(r => r.q.number === q.number).map(r => quoteView(r.q));
            res.json({ success: true, data: { ...quoteView(q, c.name), customer: customerView(c), history } });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/quotations/:id/pdf', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const r = await PartnerSalesService.quotationPdf(ctxOf(req).businessPartnerId, Number(req.params.id));
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${r.name}.pdf"`);
            res.send(r.pdf);
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/hub/quotations/:id', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ lines: z.array(lineSchema).min(1).max(100), validUntil: date.optional().nullable(), notes: z.string().max(1000).optional().nullable(), terms: z.string().max(1000).optional().nullable() }), req.body);
            const q = await PartnerSalesService.reviseQuotation(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: q.version > 1 && q.id !== Number(req.params.id) ? `Saved as version ${q.version}.` : 'Saved.', data: quoteView(q) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/quotations/:id/status', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ status: z.enum(['sent', 'accepted', 'declined', 'expired']) }), req.body);
            const q = await PartnerSalesService.setQuotationStatus(ctxOf(req), Number(req.params.id), b.status);
            res.json({ success: true, message: `Marked ${q.status}.`, data: quoteView(q) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/quotations/:id/invoice', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ dueDate: date.optional().nullable() }), req.body ?? {});
            const doc = await PartnerSalesService.invoiceFromQuotation(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: `Invoice ${doc.number} issued.`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Invoices
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/invoices', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const rows = await PartnerSalesService.listInvoices(ctx.businessPartnerId, { kind: typeof req.query.kind === 'string' ? req.query.kind : undefined });
            res.json({ success: true, data: rows.map(invoiceRow) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/invoices', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ customerId: z.number().int(), lines: z.array(lineSchema).min(1).max(100), dueDate: date.optional().nullable(), notes: z.string().max(1000).optional().nullable() }), req.body);
            const doc = await PartnerSalesService.issueInvoice(ctxOf(req), b);
            const irnNote = doc.irnStatus === 'pending_provider' ? ' It needs an IRN — generate it on the IRP portal and record it here.' : '';
            res.status(201).json({ success: true, message: `${doc.docKind === 'bill_of_supply' ? 'Bill of supply' : 'Invoice'} ${doc.number} issued.${irnNote}`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/invoices/:id', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const r = await PartnerSalesService.invoice(ctxOf(req).businessPartnerId, Number(req.params.id));
            res.json({
                success: true, data: {
                    ...invoiceRow({ doc: r.doc, paidPaise: r.paidPaise, creditedPaise: r.creditedPaise, outstandingPaise: r.doc.docKind === 'credit_note' ? 0 : r.outstandingPaise }),
                    lines: r.lines.map(l => ({ lineNo: l.lineNo, description: l.description, hsnSac: l.hsnSac, quantity: Number(l.quantity), unit: l.unit, rate: rupees(l.ratePaise), taxable: rupees(l.taxablePaise), gstRate: Number(l.gstRate), tax: rupees(l.cgstPaise + l.sgstPaise + l.igstPaise), total: rupees(l.totalPaise) })),
                    payments: r.payments.map(p => ({ id: p.id, amount: rupees(p.amountPaise), method: p.method, reference: p.reference, receivedOn: p.receivedOn, notes: p.notes })),
                    creditNotes: r.credits.map(docView),
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/invoices/:id/credit-note', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ reason: z.string().min(3).max(300), lines: z.array(z.object({ lineNo: z.number().int(), quantity: z.coerce.number().min(0) })).min(1) }), req.body);
            const doc = await PartnerSalesService.creditNote(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: `Credit note ${doc.number} issued.`, data: docView(doc) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/invoices/:id/payments', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ amountRupees: z.coerce.number().positive(), method: z.string(), reference: z.string().max(80).optional().nullable(), receivedOn: date, notes: z.string().max(300).optional().nullable() }), req.body);
            const p = await PartnerSalesService.recordPayment(ctxOf(req), Number(req.params.id), b);
            res.status(201).json({ success: true, message: 'Payment recorded.', data: { id: p.id, amount: rupees(p.amountPaise) } });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/invoices/:id/irn', active, hubCan('gst:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ irn: z.string().min(10).max(80) }), req.body);
            const d = await PartnerSalesService.recordIrn(ctxOf(req), Number(req.params.id), b.irn);
            res.json({ success: true, message: 'IRN recorded.', data: docView(d) });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // GST desk
    // ═══════════════════════════════════════════════════════════════════════

    const periodOf = (req: any) => GstDeskService.period(typeof req.query.period === 'string' ? req.query.period : new Date().toISOString().slice(0, 7));

    app.get('/api/hub/gst/summary', active, hubCan('gst:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const per = periodOf(req);
            const [summary, hsn] = await Promise.all([GstDeskService.summary(ctx.businessPartnerId, per), GstDeskService.hsnSummary(ctx.businessPartnerId, per)]);
            res.json({ success: true, data: { ...summary, hsn, gstExports: PLAN_LIMITS[ctx.plan].gstExports } });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/gst/sales-register', active, hubCan('gst:manage'), async (req, res, next) => {
        try {
            const rows = await GstDeskService.salesRegister(ctxOf(req).businessPartnerId, periodOf(req));
            res.json({ success: true, data: rows });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/gst/:register.csv', active, hubCan('gst:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const per = periodOf(req);
            let csv: string;
            if (req.params.register === 'sales-register') {
                csv = GstDeskService.csv(await GstDeskService.salesRegister(ctx.businessPartnerId, per), [['date', 'Date'], ['number', 'Number'], ['kind', 'Type'], ['status', 'Status'], ['customer', 'Customer'], ['customerGstin', 'Customer GSTIN'], ['placeOfSupply', 'Place of supply'], ['taxable', 'Taxable'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['total', 'Total']]);
            } else if (req.params.register === 'purchase-register') {
                csv = GstDeskService.csv(await GstDeskService.purchaseRegister(ctx.businessPartnerId, per), [['date', 'Date'], ['number', 'Number'], ['kind', 'Type'], ['supplier', 'Supplier'], ['supplierGstin', 'Supplier GSTIN'], ['taxable', 'Taxable'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['total', 'Total']]);
            } else if (req.params.register === 'hsn-summary') {
                csv = GstDeskService.csv((await GstDeskService.hsnSummary(ctx.businessPartnerId, per)).map(h => ({ ...h, b2b: h.b2b ? 'B2B' : 'B2C' })), [['b2b', 'Type'], ['hsn', 'HSN/SAC'], ['desc', 'Description'], ['uqc', 'UQC'], ['qty', 'Quantity'], ['rate', 'Rate %'], ['txval', 'Taxable'], ['camt', 'CGST'], ['samt', 'SGST'], ['iamt', 'IGST']]);
            } else return res.status(404).json({ success: false, message: 'Unknown register' });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${req.params.register}-${ctx.partnerCode}-${per.fp}.csv"`);
            res.send(csv);
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/gst/gstr1.json', active, hubCan('gst:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            if (!PLAN_LIMITS[ctx.plan].gstExports) throw new HubError('GSTR-1 export is part of Hub Pro. Registers stay free on every plan.', 'PLAN_LIMIT', 402);
            const per = periodOf(req);
            const json = await GstDeskService.gstr1(ctx.businessPartnerId, per);
            res.setHeader('Content-Disposition', `attachment; filename="GSTR1-${(json as any).gstin}-${per.fp}.json"`);
            res.json(json);
        } catch (e) { hubError(e, res, next); }
    });
}

