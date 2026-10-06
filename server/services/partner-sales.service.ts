/**
 * A partner's own sales: customers, quotations, invoices, credit notes and
 * the payments their customers make.
 *
 * Invoices are tax_documents with issuer 'partner' — the same store and the
 * same rules as UniteFix's own (consecutive per FY, place of supply decides
 * CGST/SGST vs IGST, corrections only by credit note). A partner with no
 * GSTIN cannot charge GST, so it issues a bill of supply instead.
 */

import { db } from '../db';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
    partnerCustomers, partnerQuotations, partnerInvoicePayments, taxDocuments, taxDocumentLines, businessPartners,
    ftthConnections, type PartnerCustomer,
} from '@shared/schema';
import { checkGstin, financialYear, GST_STATES, PLAN_LIMITS } from '@shared/hub';
import { TaxDocumentService, type Party, type DocLineInput } from './tax-documents.service';
import { BusinessPartnerService } from './business-partner.service';
import { EInvoiceService } from './einvoice.service';
import { HubError, type HubContext } from './partner-hub.service';
import { withTransaction } from '../lib/transaction';
import { renderTaxDocumentPdf } from './tax-document-pdf';

/** GST slabs after the September 2025 rationalisation (0.25% and 3% are for specific goods). Confirm with the CA. */
export const GST_RATES = [0, 0.25, 3, 5, 18, 40];

export interface SaleLineInput { description: string; hsnSac?: string | null; quantity: number; unit?: string | null; rateRupees: number; gstRate: number }

const toPaise = (r: number) => Math.round(r * 100);

export class PartnerSalesService {

    // ──────────────────────────────────────────────────────────────────────
    // Customers
    // ──────────────────────────────────────────────────────────────────────

    static async listCustomers(bpId: number, q?: string, includeArchived = false) {
        const conds: any[] = [eq(partnerCustomers.businessPartnerId, bpId)];
        if (!includeArchived) conds.push(isNull(partnerCustomers.archivedAt));
        if (q?.trim()) {
            const t = `%${q.trim()}%`;
            conds.push(or(ilike(partnerCustomers.name, t), ilike(partnerCustomers.phone, t), ilike(partnerCustomers.email, t), ilike(partnerCustomers.gstin, t)));
        }
        return db.select().from(partnerCustomers).where(and(...conds)).orderBy(asc(partnerCustomers.name)).limit(1000);
    }

    static async customer(bpId: number, id: number) {
        const [c] = await db.select().from(partnerCustomers).where(and(eq(partnerCustomers.id, id), eq(partnerCustomers.businessPartnerId, bpId))).limit(1);
        if (!c) throw new HubError('Customer not found', 'NOT_FOUND', 404);
        return c;
    }

    private static normaliseCustomer(input: { name?: string; phone?: string | null; email?: string | null; gstin?: string | null; stateCode?: string | null; address?: string | null; pincode?: string | null; tags?: string[]; notes?: string | null }) {
        const out: Record<string, unknown> = {};
        if (input.name !== undefined) {
            if (!input.name.trim()) throw new HubError('Name is required.', 'NO_NAME');
            out.name = input.name.trim().slice(0, 160);
        }
        if (input.phone !== undefined) {
            const digits = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
            if (input.phone && digits.length !== 10) throw new HubError('Phone must be a 10-digit mobile number.', 'BAD_PHONE');
            out.phone = digits || null;
        }
        if (input.email !== undefined) out.email = input.email?.trim().toLowerCase() || null;
        if (input.gstin !== undefined) {
            const g = String(input.gstin ?? '').trim().toUpperCase();
            if (g) {
                const chk = checkGstin(g);
                if (!chk.valid) throw new HubError(`GSTIN: ${chk.reason}`, 'BAD_GSTIN');
                Object.assign(out, { gstin: g, stateCode: chk.stateCode, stateName: chk.stateName });
            } else out.gstin = null;
        }
        // A registered customer's state comes from its GSTIN; otherwise it is chosen.
        if (input.stateCode !== undefined && !out.gstin) {
            const sc = input.stateCode?.trim() || null;
            if (sc && !GST_STATES[sc]) throw new HubError('Unknown state.', 'BAD_STATE');
            Object.assign(out, { stateCode: sc, stateName: sc ? GST_STATES[sc] : null });
        }
        if (input.address !== undefined) out.address = input.address?.trim() || null;
        if (input.pincode !== undefined) {
            if (input.pincode && !/^\d{6}$/.test(input.pincode)) throw new HubError('Pincode is 6 digits.', 'BAD_PINCODE');
            out.pincode = input.pincode || null;
        }
        if (input.tags !== undefined) out.tags = Array.from(new Set((input.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean))).slice(0, 10);
        if (input.notes !== undefined) out.notes = input.notes?.trim() || null;
        return out;
    }

    static async createCustomer(ctx: HubContext, input: Parameters<typeof PartnerSalesService.normaliseCustomer>[0] & { name: string }) {
        const fields = this.normaliseCustomer(input);
        if (!fields.stateCode) {
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            Object.assign(fields, { stateCode: bp?.stateCode ?? null, stateName: bp?.stateName ?? null });
        }
        try {
            const [row] = await db.insert(partnerCustomers).values({ businessPartnerId: ctx.businessPartnerId, ...(fields as any), createdByAdminUserId: ctx.adminUserId }).returning();
            return row;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('A customer with this phone number already exists.', 'DUPLICATE', 409);
            throw e;
        }
    }

    static async updateCustomer(ctx: HubContext, id: number, input: Parameters<typeof PartnerSalesService.normaliseCustomer>[0] & { archived?: boolean }) {
        await this.customer(ctx.businessPartnerId, id);
        const fields = this.normaliseCustomer(input);
        if (input.archived !== undefined) (fields as any).archivedAt = input.archived ? new Date() : null;
        try {
            const [row] = await db.update(partnerCustomers).set({ ...(fields as any), updatedAt: new Date() })
                .where(and(eq(partnerCustomers.id, id), eq(partnerCustomers.businessPartnerId, ctx.businessPartnerId))).returning();
            return row;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('Another customer already has this phone number.', 'DUPLICATE', 409);
            throw e;
        }
    }

    /** Broadband partners: bring subscribers into the customer book once. */
    static async importBroadbandSubscribers(ctx: HubContext) {
        if (!ctx.ftthOperatorId) throw new HubError('No broadband operator on this account.', 'NO_BROADBAND');
        const conns = await db.select().from(ftthConnections).where(eq(ftthConnections.operatorId, ctx.ftthOperatorId));
        const existing = await db.select({ phone: partnerCustomers.phone, conn: partnerCustomers.ftthConnectionId }).from(partnerCustomers)
            .where(eq(partnerCustomers.businessPartnerId, ctx.businessPartnerId));
        const phones = new Set(existing.map(e => e.phone).filter(Boolean));
        const conns2 = new Set(existing.map(e => e.conn).filter(Boolean));
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        let added = 0, linked = 0;
        for (const c of conns) {
            if (conns2.has(c.id)) continue;
            const phone = (c.customerPhone ?? '').replace(/\D/g, '').slice(-10) || null;
            if (phone && phones.has(phone)) {
                await db.update(partnerCustomers).set({ ftthConnectionId: c.id, updatedAt: new Date() })
                    .where(and(eq(partnerCustomers.businessPartnerId, ctx.businessPartnerId), eq(partnerCustomers.phone, phone), isNull(partnerCustomers.ftthConnectionId)));
                linked++;
                continue;
            }
            await db.insert(partnerCustomers).values({
                businessPartnerId: ctx.businessPartnerId, name: c.customerName || c.ispConnectionId || `Subscriber ${c.id}`, phone, email: c.customerEmail,
                address: c.installationAddress, stateCode: bp?.stateCode ?? null, stateName: bp?.stateName ?? null, tags: ['broadband'],
                linkedUserId: c.userId, ftthConnectionId: c.id, createdByAdminUserId: ctx.adminUserId,
            }).onConflictDoNothing();
            if (phone) phones.add(phone);
            added++;
        }
        return { added, linked, total: conns.length };
    }

    static customerParty(c: PartnerCustomer): Party {
        return { name: c.name, gstin: c.gstin, stateCode: c.stateCode, stateName: c.stateName, address: [c.address, c.pincode].filter(Boolean).join(', ') || null, email: c.email, phone: c.phone };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Lines and numbering
    // ──────────────────────────────────────────────────────────────────────

    static checkLines(lines: SaleLineInput[], registered: boolean) {
        if (!lines.length) throw new HubError('Add at least one line.', 'NO_LINES');
        if (lines.length > 100) throw new HubError('At most 100 lines.', 'TOO_MANY_LINES');
        return lines.map((l, i) => {
            const n = i + 1;
            if (!l.description?.trim()) throw new HubError(`Line ${n}: describe the item or service.`, 'BAD_LINE');
            if (!(l.quantity > 0)) throw new HubError(`Line ${n}: quantity must be more than zero.`, 'BAD_LINE');
            if (!(l.rateRupees >= 0)) throw new HubError(`Line ${n}: rate cannot be negative.`, 'BAD_LINE');
            const rate = registered ? Number(l.gstRate ?? 0) : 0;
            if (registered && !GST_RATES.includes(rate)) throw new HubError(`Line ${n}: GST rate must be one of ${GST_RATES.join(', ')}%.`, 'BAD_RATE');
            const hsn = l.hsnSac?.trim() || null;
            if (registered && (!hsn || !/^\d{4,8}$/.test(hsn))) throw new HubError(`Line ${n}: HSN (goods) or SAC (services) is required — 4 to 8 digits.`, 'NO_HSN');
            const ratePaise = toPaise(l.rateRupees);
            const taxable = Math.round(ratePaise * l.quantity);
            return { description: l.description.trim().slice(0, 300), hsnSac: hsn, quantity: l.quantity, unit: l.unit?.trim() || null, ratePaise, taxablePaise: taxable, gstRate: rate } as DocLineInput;
        });
    }

    static totals(lines: DocLineInput[]) {
        const taxable = lines.reduce((a, l) => a + l.taxablePaise, 0);
        const tax = lines.reduce((a, l) => a + Math.round(l.taxablePaise * l.gstRate / 100), 0);
        return { taxable, tax, total: taxable + tax };
    }

    /** "KNS" from "Karwar NetServe"; fixed on first use so the series never changes name. */
    static async prefixFor(bpId: number): Promise<string> {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (bp.invoicePrefix) return bp.invoicePrefix;
        const words = bp.displayName.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
        let p = words.length >= 2 ? words.map(w => w[0]).join('').slice(0, 3) : (words[0] ?? 'INV').slice(0, 3);
        if (!p) p = 'INV';
        await db.update(businessPartners).set({ invoicePrefix: p }).where(eq(businessPartners.id, bpId));
        return p;
    }

    static async invoicesThisMonth(bpId: number) {
        const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(taxDocuments)
            .where(and(eq(taxDocuments.issuerPartnerId, bpId), eq(taxDocuments.issuer, 'partner'), inArray(taxDocuments.docKind, ['tax_invoice', 'bill_of_supply']), gte(taxDocuments.issuedAt, start)));
        return n;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Invoices
    // ──────────────────────────────────────────────────────────────────────

    static async issueInvoice(ctx: HubContext, input: { customerId: number; lines: SaleLineInput[]; dueDate?: string | null; notes?: string | null; quotationId?: number | null; source?: string | null }) {
        const limit = PLAN_LIMITS[ctx.plan].invoicesPerMonth;
        if (limit !== null && (await this.invoicesThisMonth(ctx.businessPartnerId)) >= limit) {
            throw new HubError(`The Starter plan includes ${limit} invoices a month. Upgrade to Pro for unlimited invoicing.`, 'PLAN_LIMIT', 402);
        }
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        const customer = await this.customer(ctx.businessPartnerId, input.customerId);
        const registered = !!bp.gstin && bp.gstinStatus !== 'invalid';
        const lines = this.checkLines(input.lines, registered);
        const prefix = await this.prefixFor(bp.id);

        const doc = await withTransaction(async (tx) => {
            const d = await TaxDocumentService.create(tx as any, {
                docKind: registered ? 'tax_invoice' : 'bill_of_supply', issuer: 'partner', issuerPartnerId: bp.id,
                seriesKey: `bp-${bp.id}-inv`, prefix, letter: '', numberWidth: 4, purpose: 'partner_sale',
                supplier: TaxDocumentService.partnerParty(bp), recipient: this.customerParty(customer), lines,
                partnerCustomerId: customer.id, dueDate: input.dueDate ?? null,
                notes: [input.notes?.trim() || null, bp.invoiceTerms || null, registered ? null : 'Supplier not registered under GST; no GST charged.'].filter(Boolean).join(' ') || null,
                createdByAdminId: ctx.adminUserId,
            });
            if (input.quotationId) {
                await tx.update(partnerQuotations).set({ status: 'invoiced', invoiceDocumentId: d.id, updatedAt: new Date() })
                    .where(and(eq(partnerQuotations.id, input.quotationId), eq(partnerQuotations.businessPartnerId, bp.id)));
            }
            return d;
        });

        // E-invoice: above ₹5 cr turnover, B2B invoices need an IRN.
        if (registered && EInvoiceService.required(bp.aatoAbove5cr, customer.gstin)) {
            const r = await EInvoiceService.generate(doc.number);
            const [u] = await db.update(taxDocuments).set(r.status === 'generated' ? { irn: r.irn, irnStatus: 'generated' } : { irnStatus: 'pending_provider' })
                .where(eq(taxDocuments.id, doc.id)).returning();
            return u;
        }
        return doc;
    }

    static async invoice(bpId: number, id: number) {
        const found = await TaxDocumentService.withLines(id);
        if (!found || found.doc.issuer !== 'partner' || found.doc.issuerPartnerId !== bpId) throw new HubError('Invoice not found', 'NOT_FOUND', 404);
        const payments = await db.select().from(partnerInvoicePayments).where(eq(partnerInvoicePayments.documentId, id)).orderBy(asc(partnerInvoicePayments.receivedOn));
        const credits = await db.select().from(taxDocuments).where(and(eq(taxDocuments.originalDocumentId, id), eq(taxDocuments.docKind, 'credit_note'), eq(taxDocuments.status, 'issued')));
        const paid = payments.reduce((a, p) => a + p.amountPaise, 0);
        const credited = credits.reduce((a, c) => a + c.totalPaise, 0);
        return { ...found, payments, credits, paidPaise: paid, creditedPaise: credited, outstandingPaise: Math.max(0, found.doc.totalPaise - credited - paid) };
    }

    static async listInvoices(bpId: number, opts: { customerId?: number; kind?: string } = {}) {
        const conds: any[] = [eq(taxDocuments.issuer, 'partner'), eq(taxDocuments.issuerPartnerId, bpId)];
        if (opts.customerId) conds.push(eq(taxDocuments.partnerCustomerId, opts.customerId));
        if (opts.kind) conds.push(eq(taxDocuments.docKind, opts.kind));
        else conds.push(inArray(taxDocuments.docKind, ['tax_invoice', 'bill_of_supply', 'credit_note']), ne(taxDocuments.purpose, 'subcontract'));
        const docs = await db.select().from(taxDocuments).where(and(...conds)).orderBy(desc(taxDocuments.issuedAt), desc(taxDocuments.id)).limit(1000);
        const ids = docs.map(d => d.id);
        const pays = ids.length ? await db.select({ doc: partnerInvoicePayments.documentId, s: sql<number>`sum(${partnerInvoicePayments.amountPaise})::int` })
            .from(partnerInvoicePayments).where(inArray(partnerInvoicePayments.documentId, ids)).groupBy(partnerInvoicePayments.documentId) : [];
        const cns = ids.length ? await db.select({ orig: taxDocuments.originalDocumentId, s: sql<number>`sum(${taxDocuments.totalPaise})::int` })
            .from(taxDocuments).where(and(inArray(taxDocuments.originalDocumentId, ids), eq(taxDocuments.docKind, 'credit_note'))).groupBy(taxDocuments.originalDocumentId) : [];
        const paidBy = new Map(pays.map(p => [p.doc, p.s]));
        const credBy = new Map(cns.map(c => [c.orig, c.s]));
        return docs.map(d => {
            const paid = paidBy.get(d.id) ?? 0, credited = credBy.get(d.id) ?? 0;
            return { doc: d, paidPaise: paid, creditedPaise: credited, outstandingPaise: d.docKind === 'credit_note' ? 0 : Math.max(0, d.totalPaise - credited - paid) };
        });
    }

    /** Credit note against an invoice — whole lines, or a part of a line's quantity. Never more than is left. */
    static async creditNote(ctx: HubContext, invoiceId: number, input: { lines: Array<{ lineNo: number; quantity: number }>; reason: string }) {
        const inv = await this.invoice(ctx.businessPartnerId, invoiceId);
        if (inv.doc.docKind === 'credit_note') throw new HubError('A credit note cannot be credited.', 'BAD_TARGET');
        if (!input.reason?.trim()) throw new HubError('Say why — it is printed on the credit note.', 'NO_REASON');
        const picked = input.lines.filter(l => l.quantity > 0).map(l => {
            const src = inv.lines.find(x => x.lineNo === l.lineNo);
            if (!src) throw new HubError(`Line ${l.lineNo} is not on the invoice.`, 'BAD_LINE');
            if (l.quantity > Number(src.quantity)) throw new HubError(`Line ${l.lineNo}: more than was invoiced.`, 'BAD_QTY');
            const share = l.quantity / Number(src.quantity);
            const taxable = Math.round(src.taxablePaise * share);
            const tax = Math.round((src.cgstPaise + src.sgstPaise + src.igstPaise) * share);
            return { description: src.description, hsnSac: src.hsnSac, quantity: l.quantity, unit: src.unit, ratePaise: src.ratePaise, taxablePaise: taxable, gstRate: Number(src.gstRate), taxPaise: tax } as DocLineInput;
        });
        if (!picked.length) throw new HubError('Choose what to credit.', 'NO_LINES');
        const { taxable, tax } = picked.reduce((a, l) => ({ taxable: a.taxable + l.taxablePaise, tax: a.tax + (l.taxPaise ?? 0) }), { taxable: 0, tax: 0 });
        if (taxable + tax > inv.doc.totalPaise - inv.creditedPaise) throw new HubError('That is more than is left to credit on this invoice.', 'OVER_CREDIT');
        const prefix = await this.prefixFor(ctx.businessPartnerId);
        return withTransaction(async (tx) => TaxDocumentService.create(tx as any, {
            docKind: 'credit_note', issuer: 'partner', issuerPartnerId: ctx.businessPartnerId,
            seriesKey: `bp-${ctx.businessPartnerId}-cn`, prefix, letter: 'C', numberWidth: 4, purpose: 'partner_sale',
            originalDocumentId: inv.doc.id, supplier: inv.doc.supplier as Party, recipient: inv.doc.recipient as Party,
            lines: picked, partnerCustomerId: inv.doc.partnerCustomerId,
            notes: `Against ${inv.doc.number}. ${input.reason.trim()}`, createdByAdminId: ctx.adminUserId,
        }));
    }

    static async recordPayment(ctx: HubContext, invoiceId: number, input: { amountRupees: number; method: string; reference?: string | null; receivedOn: string; notes?: string | null }) {
        const inv = await this.invoice(ctx.businessPartnerId, invoiceId);
        const amount = toPaise(input.amountRupees);
        if (!(amount > 0)) throw new HubError('Amount must be more than zero.', 'BAD_AMOUNT');
        if (amount > inv.outstandingPaise) throw new HubError(`Only ₹${(inv.outstandingPaise / 100).toFixed(2)} is outstanding on this invoice.`, 'OVERPAY');
        if (!['cash', 'upi', 'bank', 'card', 'cheque', 'other'].includes(input.method)) throw new HubError('Unknown payment method.', 'BAD_METHOD');
        const [row] = await db.insert(partnerInvoicePayments).values({
            businessPartnerId: ctx.businessPartnerId, documentId: invoiceId, amountPaise: amount, method: input.method,
            reference: input.reference?.trim() || null, receivedOn: input.receivedOn, notes: input.notes?.trim() || null, createdByAdminUserId: ctx.adminUserId,
        }).returning();
        return row;
    }

    /** IRN generated on the IRP portal by hand, recorded on the invoice. */
    static async recordIrn(ctx: HubContext, invoiceId: number, irn: string) {
        await this.invoice(ctx.businessPartnerId, invoiceId);
        if (!/^[a-f0-9]{64}$/i.test(irn.trim())) throw new HubError('An IRN is a 64-character hash from the IRP.', 'BAD_IRN');
        const [u] = await db.update(taxDocuments).set({ irn: irn.trim().toLowerCase(), irnStatus: 'recorded' }).where(eq(taxDocuments.id, invoiceId)).returning();
        return u;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Quotations
    // ──────────────────────────────────────────────────────────────────────

    static async createQuotation(ctx: HubContext, input: { customerId: number; lines: SaleLineInput[]; validUntil?: string | null; notes?: string | null; terms?: string | null; source?: string | null; sourceRefId?: number | null }) {
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        await this.customer(ctx.businessPartnerId, input.customerId);
        const registered = !!bp.gstin;
        const lines = this.checkLines(input.lines, registered);
        const t = this.totals(lines);
        const prefix = await this.prefixFor(bp.id);
        return withTransaction(async (tx) => {
            const n = await TaxDocumentService.nextNumber(tx as any, `bp-${bp.id}-quote`, financialYear());
            const number = `${prefix}/Q/${financialYear()}/${String(n).padStart(4, '0')}`;
            const [q] = await tx.insert(partnerQuotations).values({
                businessPartnerId: bp.id, customerId: input.customerId, number, status: 'draft', validUntil: input.validUntil ?? null,
                lines: lines as any, taxablePaise: t.taxable, taxPaise: t.tax, totalPaise: t.total, notes: input.notes ?? null,
                terms: input.terms ?? bp.invoiceTerms ?? null, source: input.source ?? null, sourceRefId: input.sourceRefId ?? null, createdByAdminUserId: ctx.adminUserId,
            }).returning();
            return q;
        });
    }

    static async quotation(bpId: number, id: number) {
        const [q] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.id, id), eq(partnerQuotations.businessPartnerId, bpId))).limit(1);
        if (!q) throw new HubError('Quotation not found', 'NOT_FOUND', 404);
        return q;
    }

    /**
     * Revising a quotation the customer has seen creates a new version and
     * supersedes the old — what was sent is never overwritten.
     */
    static async reviseQuotation(ctx: HubContext, id: number, input: { lines: SaleLineInput[]; validUntil?: string | null; notes?: string | null; terms?: string | null }) {
        const q = await this.quotation(ctx.businessPartnerId, id);
        if (['invoiced', 'superseded'].includes(q.status)) throw new HubError(`This quotation is ${q.status}.`, 'LOCKED', 409);
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const lines = this.checkLines(input.lines, !!bp?.gstin);
        const t = this.totals(lines);
        if (q.status === 'draft') {
            const [u] = await db.update(partnerQuotations).set({ lines: lines as any, taxablePaise: t.taxable, taxPaise: t.tax, totalPaise: t.total, validUntil: input.validUntil ?? q.validUntil, notes: input.notes ?? q.notes, terms: input.terms ?? q.terms, updatedAt: new Date() })
                .where(eq(partnerQuotations.id, id)).returning();
            return u;
        }
        return withTransaction(async (tx) => {
            await tx.update(partnerQuotations).set({ status: 'superseded', updatedAt: new Date() }).where(eq(partnerQuotations.id, id));
            const [n] = await tx.insert(partnerQuotations).values({
                businessPartnerId: q.businessPartnerId, customerId: q.customerId, number: q.number, version: q.version + 1, status: 'draft',
                validUntil: input.validUntil ?? q.validUntil, lines: lines as any, taxablePaise: t.taxable, taxPaise: t.tax, totalPaise: t.total,
                notes: input.notes ?? q.notes, terms: input.terms ?? q.terms, source: q.source, sourceRefId: q.sourceRefId, createdByAdminUserId: ctx.adminUserId,
            }).returning();
            return n;
        });
    }

    static async setQuotationStatus(ctx: HubContext, id: number, status: 'sent' | 'accepted' | 'declined' | 'expired') {
        const q = await this.quotation(ctx.businessPartnerId, id);
        const allowed: Record<string, string[]> = { draft: ['sent', 'accepted', 'declined'], sent: ['accepted', 'declined', 'expired'], accepted: ['declined'], declined: [], expired: [], invoiced: [], superseded: [] };
        if (!allowed[q.status]?.includes(status)) throw new HubError(`A ${q.status} quotation cannot become ${status}.`, 'BAD_TRANSITION', 409);
        const [u] = await db.update(partnerQuotations).set({ status, updatedAt: new Date() }).where(eq(partnerQuotations.id, id)).returning();
        return u;
    }

    static async invoiceFromQuotation(ctx: HubContext, id: number, input: { dueDate?: string | null }) {
        const q = await this.quotation(ctx.businessPartnerId, id);
        if (!['accepted', 'sent', 'draft'].includes(q.status)) throw new HubError(`A ${q.status} quotation cannot be invoiced.`, 'BAD_TRANSITION', 409);
        const lines = (q.lines as any[]).map(l => ({ description: l.description, hsnSac: l.hsnSac, quantity: Number(l.quantity), unit: l.unit, rateRupees: l.ratePaise / 100, gstRate: Number(l.gstRate) }));
        return this.issueInvoice(ctx, { customerId: q.customerId, lines, dueDate: input.dueDate ?? null, notes: `Quotation ${q.number}${q.version > 1 ? ` v${q.version}` : ''}.`, quotationId: q.id, source: q.source });
    }

    static async listQuotations(bpId: number, opts: { customerId?: number; source?: string } = {}) {
        const conds: any[] = [eq(partnerQuotations.businessPartnerId, bpId)];
        if (opts.customerId) conds.push(eq(partnerQuotations.customerId, opts.customerId));
        if (opts.source) conds.push(eq(partnerQuotations.source, opts.source));
        return db.select({ q: partnerQuotations, customerName: partnerCustomers.name }).from(partnerQuotations)
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, partnerQuotations.customerId))
            .where(and(...conds)).orderBy(desc(partnerQuotations.createdAt)).limit(500);
    }

    /** A quotation printed in the same layout as an invoice, titled QUOTATION. Not a tax document. */
    static async quotationPdf(bpId: number, id: number) {
        const q = await this.quotation(bpId, id);
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        const c = await this.customer(bpId, q.customerId);
        const supplier = TaxDocumentService.partnerParty(bp), recipient = this.customerParty(c);
        const posCode = recipient.stateCode ?? supplier.stateCode;
        const interstate = !!posCode && !!supplier.stateCode && posCode !== supplier.stateCode;
        const lines = (q.lines as any[]).map((l, i) => {
            const tax = Math.round(l.taxablePaise * Number(l.gstRate) / 100);
            const s = TaxDocumentService.split(tax, interstate);
            return { id: i, documentId: 0, lineNo: i + 1, description: l.description, hsnSac: l.hsnSac, quantity: String(l.quantity), unit: l.unit ?? null, ratePaise: l.ratePaise, taxablePaise: l.taxablePaise, gstRate: String(l.gstRate), cgstPaise: s.cgst, sgstPaise: s.sgst, igstPaise: s.igst, totalPaise: l.taxablePaise + tax };
        });
        const sum = (k: 'cgstPaise' | 'sgstPaise' | 'igstPaise') => lines.reduce((a, l) => a + l[k], 0);
        const doc: any = {
            docKind: 'quotation', number: q.version > 1 ? `${q.number} v${q.version}` : q.number, issuedAt: q.updatedAt ?? q.createdAt,
            supplier, recipient, placeOfSupplyCode: posCode, placeOfSupplyName: posCode ? (GST_STATES[posCode] ?? null) : null, isInterstate: interstate,
            taxablePaise: q.taxablePaise, cgstPaise: sum('cgstPaise'), sgstPaise: sum('sgstPaise'), igstPaise: sum('igstPaise'), totalPaise: lines.reduce((a, l) => a + l.totalPaise, 0),
            notes: [q.notes, q.terms].filter(Boolean).join(' ') || null, irn: null, periodFrom: null, dueDate: null,
        };
        return { pdf: await renderTaxDocumentPdf(doc, lines as any, { validUntil: q.validUntil }), name: doc.number.replace(/\//g, '-') };
    }

    /** What each customer owes: invoices − credit notes − payments. */
    static async receivables(bpId: number) {
        const rows = await this.listInvoices(bpId);
        const by = new Map<number, number>();
        for (const r of rows) if (r.doc.partnerCustomerId && r.doc.docKind !== 'credit_note') by.set(r.doc.partnerCustomerId, (by.get(r.doc.partnerCustomerId) ?? 0) + r.outstandingPaise);
        return by;
    }
}
