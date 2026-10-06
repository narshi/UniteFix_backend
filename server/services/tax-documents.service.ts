/**
 * GST documents — tax invoices, credit notes, bills of supply.
 *
 * One store (tax_documents) for every document the platform issues: UniteFix's
 * invoices to partners for parts and fees, and (phase 3) partners' own
 * invoices to their customers. Rules applied everywhere:
 *
 *   - Numbers are consecutive per series per financial year, at most 16
 *     characters (e.g. "UF/26-27/B00042"), allocated atomically.
 *   - Place of supply decides the split: same state → CGST + SGST, else IGST.
 *   - Amounts are frozen at issue. A correction is a credit note against the
 *     original, never an edit.
 *   - B2B documents use the amounts the partner was actually charged, line by
 *     line, never a recomputation.
 */

import { db } from '../db';
import { and, desc, eq, inArray, or, sql, gte, lte } from 'drizzle-orm';
import {
    taxDocuments, taxDocumentLines, documentSeries, b2bOrders, b2bOrderItems, spareParts, businessPartners,
    ftthOperators, ftthOperatorLedger, type TaxDocument,
} from '@shared/schema';
import { checkGstin, financialYear, GST_STATES } from '@shared/hub';
import { loadSellerDetails } from './invoice-generator';
import { BusinessPartnerService } from './business-partner.service';
import { configService } from './config.service';
import logger from '../lib/logger';

type Tx = typeof db;

export interface Party {
    name: string;
    tradeName?: string | null;
    gstin: string | null;
    stateCode: string | null;
    stateName: string | null;
    address: string | null;
    email?: string | null;
    phone?: string | null;
}

export interface DocLineInput {
    description: string;
    hsnSac: string | null;
    quantity: number;
    unit?: string | null;
    ratePaise: number;
    taxablePaise: number;
    gstRate: number;
    /** When the tax was already charged (B2B lines, inclusive fees), pass it — it is split, not recomputed. */
    taxPaise?: number;
}

export class TaxDocumentService {

    // ──────────────────────────────────────────────────────────────────────
    // Parties
    // ──────────────────────────────────────────────────────────────────────

    static async unitefixParty(): Promise<Party> {
        const s = await loadSellerDetails();
        const g = checkGstin(s.gstin);
        // A placeholder GSTIN still carries a state code; Karnataka is the fallback.
        const stateCode = g.stateCode ?? (/^\d{2}/.test(s.gstin) ? s.gstin.slice(0, 2) : '29');
        return {
            name: s.name, gstin: s.gstin || null, stateCode, stateName: GST_STATES[stateCode] ?? null,
            address: s.address, email: s.supportEmail ?? null, phone: s.supportPhone ?? null,
        };
    }

    static partnerParty(bp: typeof businessPartners.$inferSelect): Party {
        return {
            name: bp.legalName, tradeName: bp.displayName !== bp.legalName ? bp.displayName : null,
            gstin: bp.gstin, stateCode: bp.stateCode, stateName: bp.stateName,
            address: [bp.address, bp.district, bp.pincode].filter(Boolean).join(', ') || null,
            email: bp.contactEmail, phone: bp.contactPhone,
        };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Numbering and tax
    // ──────────────────────────────────────────────────────────────────────

    /** Next number in a series for a financial year, allocated atomically. */
    static async nextNumber(tx: Tx, seriesKey: string, fy: string): Promise<number> {
        const r: any = await tx.execute(sql`
            INSERT INTO document_series (series_key, fy, next_no) VALUES (${seriesKey}, ${fy}, 2)
            ON CONFLICT (series_key, fy) DO UPDATE SET next_no = document_series.next_no + 1
            RETURNING next_no - 1 AS n
        `);
        const rows = Array.isArray(r) ? r : r?.rows ?? [];
        return Number(rows[0]?.n);
    }

    /** "UF/26-27/B00042" — always within GST's 16-character limit. */
    static formatNumber(prefix: string, fy: string, letter: string, n: number, width = 5): string {
        const num = `${prefix}/${fy}/${letter}${String(n).padStart(width, '0')}`;
        if (num.length > 16) throw new Error(`Document number ${num} exceeds 16 characters — shorten the prefix.`);
        return num;
    }

    static split(taxPaise: number, interstate: boolean) {
        if (interstate) return { cgst: 0, sgst: 0, igst: taxPaise };
        const cgst = Math.round(taxPaise / 2);
        return { cgst, sgst: taxPaise - cgst, igst: 0 };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Create
    // ──────────────────────────────────────────────────────────────────────

    static async create(tx: Tx, input: {
        /** receipt_voucher / refund_voucher: GST on advances (Rule 50 / 51), events phase. */
        docKind: 'tax_invoice' | 'credit_note' | 'bill_of_supply' | 'receipt_voucher' | 'refund_voucher';
        issuer: 'unitefix' | 'partner';
        issuerPartnerId?: number | null;
        seriesKey: string; prefix: string; letter: string;
        /** Digits in the running number (5 for UniteFix, 4 for partners so a 4-letter prefix still fits 16 chars). */
        numberWidth?: number;
        purpose: string;
        partnerCustomerId?: number | null;
        dueDate?: string | null;
        b2bOrderId?: number | null;
        recipientPartnerId?: number | null;
        originalDocumentId?: number | null;
        supplier: Party; recipient: Party;
        lines: DocLineInput[];
        periodFrom?: string | null; periodTo?: string | null;
        notes?: string | null;
        createdByAdminId?: number | null;
        issuedAt?: Date;
    }): Promise<TaxDocument> {
        if (!input.lines.length) throw new Error('A tax document needs at least one line.');
        const issuedAt = input.issuedAt ?? new Date();
        const fy = financialYear(issuedAt);
        const n = await this.nextNumber(tx, input.seriesKey, fy);
        const number = this.formatNumber(input.prefix, fy, input.letter, n, input.numberWidth ?? 5);

        // Place of supply: the recipient's state. Without one (an unregistered
        // buyer with no state on file) it is taken as the supplier's — said so
        // on the document rather than silently.
        const posCode = input.recipient.stateCode ?? input.supplier.stateCode;
        const posAssumed = !input.recipient.stateCode;
        const interstate = !!posCode && !!input.supplier.stateCode && posCode !== input.supplier.stateCode;

        const lines = input.lines.map((l, i) => {
            const tax = l.taxPaise ?? Math.round(l.taxablePaise * l.gstRate / 100);
            const s = this.split(tax, interstate);
            return { lineNo: i + 1, ...l, tax, ...s, total: l.taxablePaise + tax };
        });
        const sum = (k: 'taxablePaise' | 'cgst' | 'sgst' | 'igst' | 'total') => lines.reduce((a, l) => a + (l as any)[k], 0);

        const [doc] = await tx.insert(taxDocuments).values({
            docKind: input.docKind, issuer: input.issuer, issuerPartnerId: input.issuerPartnerId ?? null,
            seriesKey: input.seriesKey, fy, number, purpose: input.purpose,
            b2bOrderId: input.b2bOrderId ?? null, recipientPartnerId: input.recipientPartnerId ?? null,
            originalDocumentId: input.originalDocumentId ?? null,
            supplier: input.supplier as any, recipient: input.recipient as any,
            placeOfSupplyCode: posCode, placeOfSupplyName: posCode ? (GST_STATES[posCode] ?? null) : null,
            isInterstate: interstate,
            taxablePaise: sum('taxablePaise'), cgstPaise: sum('cgst'), sgstPaise: sum('sgst'), igstPaise: sum('igst'), totalPaise: sum('total'),
            periodFrom: input.periodFrom ?? null, periodTo: input.periodTo ?? null,
            notes: [input.notes, posAssumed ? 'Place of supply taken as the supplier\'s state: the recipient has no state on record.' : null].filter(Boolean).join(' ') || null,
            issuedAt, createdByAdminId: input.createdByAdminId ?? null,
            partnerCustomerId: input.partnerCustomerId ?? null, dueDate: input.dueDate ?? null,
        }).returning();

        await tx.insert(taxDocumentLines).values(lines.map(l => ({
            documentId: doc.id, lineNo: l.lineNo, description: l.description.slice(0, 300), hsnSac: l.hsnSac,
            quantity: String(l.quantity), unit: l.unit ?? null, ratePaise: l.ratePaise, taxablePaise: l.taxablePaise,
            gstRate: String(l.gstRate), cgstPaise: l.cgst, sgstPaise: l.sgst, igstPaise: l.igst, totalPaise: l.total,
        })));
        logger.info(`[GST] ${input.docKind} ${number} (${input.purpose}) — ₹${(doc.totalPaise / 100).toFixed(2)}`);
        return doc;
    }

    // ──────────────────────────────────────────────────────────────────────
    // B2B parts orders — UniteFix → partner
    // ──────────────────────────────────────────────────────────────────────

    static async b2bInvoiceOf(orderId: number, tx: Tx = db) {
        const [doc] = await tx.select().from(taxDocuments).where(and(
            eq(taxDocuments.b2bOrderId, orderId), eq(taxDocuments.purpose, 'b2b_order'),
            eq(taxDocuments.docKind, 'tax_invoice'), eq(taxDocuments.status, 'issued'))).limit(1);
        return doc ?? null;
    }

    /** Tax invoice for a parts order, at dispatch (supply of goods). Idempotent. */
    static async issueB2bInvoice(tx: Tx, orderId: number, adminId: number | null, note?: string) {
        const existing = await this.b2bInvoiceOf(orderId, tx);
        if (existing) return existing;
        const [order] = await tx.select().from(b2bOrders).where(eq(b2bOrders.id, orderId)).limit(1);
        if (!order) throw new Error(`Order #${orderId} not found`);
        const [bp] = await tx.select().from(businessPartners).where(eq(businessPartners.id, order.businessPartnerId)).limit(1);
        const items = await tx.select().from(b2bOrderItems).where(eq(b2bOrderItems.orderId, orderId));
        const parts = items.length ? await tx.select({ id: spareParts.id, hsn: spareParts.hsnCode, unit: spareParts.unit })
            .from(spareParts).where(inArray(spareParts.id, items.map(i => i.sparePartId))) : [];
        const byPart = new Map(parts.map(p => [p.id, p]));
        const defaultHsn = ((await configService.get<string>('BUSINESS_CONFIG.DEFAULT_PART_HSN')) || '').trim() || null;

        const lines: DocLineInput[] = items.map(i => {
            const net = i.unitPricePaise * i.quantity;
            return {
                description: `${i.name} (${i.partCode})${i.specification ? ` — ${i.specification}` : ''}`,
                hsnSac: byPart.get(i.sparePartId)?.hsn ?? defaultHsn,
                quantity: i.quantity, unit: byPart.get(i.sparePartId)?.unit ?? 'piece',
                ratePaise: i.unitPricePaise, taxablePaise: net,
                gstRate: i.gstPercent != null ? Number(i.gstPercent) : 0,
                taxPaise: i.lineTotalPaise - net,      // exactly what was charged
            };
        });
        return this.create(tx, {
            docKind: 'tax_invoice', issuer: 'unitefix', seriesKey: 'uf-b2b', prefix: 'UF', letter: 'B',
            purpose: 'b2b_order', b2bOrderId: orderId, recipientPartnerId: order.businessPartnerId,
            supplier: await this.unitefixParty(), recipient: this.partnerParty(bp),
            lines, notes: [`Order ${order.orderCode}.`, order.paymentMode === 'credit' ? `Payable within ${bp.paymentTermsDays || 0} days.` : 'Paid in advance.', note ?? null].filter(Boolean).join(' '),
            createdByAdminId: adminId,
        });
    }

    /** Credit note reversing a parts invoice in full (accepted return). Idempotent. */
    static async issueB2bCreditNote(tx: Tx, orderId: number, adminId: number | null, reason: string) {
        const [existing] = await tx.select().from(taxDocuments).where(and(
            eq(taxDocuments.b2bOrderId, orderId), eq(taxDocuments.purpose, 'b2b_order'),
            eq(taxDocuments.docKind, 'credit_note'), eq(taxDocuments.status, 'issued'))).limit(1);
        if (existing) return existing;
        const invoice = await this.b2bInvoiceOf(orderId, tx);
        if (!invoice) return null; // nothing was invoiced, nothing to reverse
        const lines = await tx.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, invoice.id));
        return this.create(tx, {
            docKind: 'credit_note', issuer: 'unitefix', seriesKey: 'uf-cn', prefix: 'UF', letter: 'C',
            purpose: 'b2b_order', b2bOrderId: orderId, recipientPartnerId: invoice.recipientPartnerId, originalDocumentId: invoice.id,
            supplier: invoice.supplier as Party, recipient: invoice.recipient as Party,
            lines: lines.map(l => ({
                description: l.description, hsnSac: l.hsnSac, quantity: Number(l.quantity), unit: l.unit,
                ratePaise: l.ratePaise, taxablePaise: l.taxablePaise, gstRate: Number(l.gstRate),
                taxPaise: l.cgstPaise + l.sgstPaise + l.igstPaise,
            })),
            notes: `Against invoice ${invoice.number}. ${reason}`.trim(),
            createdByAdminId: adminId,
        });
    }

    /** Orders dispatched before invoicing existed get their invoice now, marked as such. */
    static async issueMissingB2bInvoices(adminId: number | null) {
        const rows = await db.select({ id: b2bOrders.id }).from(b2bOrders)
            .where(inArray(b2bOrders.status, ['dispatched', 'delivered', 'returned'] as any));
        const issued: string[] = [];
        for (const r of rows) {
            if (await this.b2bInvoiceOf(r.id)) continue;
            const doc = await db.transaction(async (tx) => this.issueB2bInvoice(tx as any, r.id, adminId, 'Issued after dispatch, when tax invoicing was introduced.'));
            issued.push(doc.number);
        }
        return issued;
    }

    // ──────────────────────────────────────────────────────────────────────
    // UniteFix's fees — a monthly invoice per partner
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Fees for one month: broadband lead fees (already deducted on the FTTH
     * ledger; treated as GST-inclusive, so the partner's money does not
     * change — the invoice carves the tax out) and the Partner Hub Pro plan
     * (₹ before GST; GST added, and the charge booked to the partner ledger
     * here). Returns null when there is nothing to invoice. Idempotent per
     * partner per month.
     */
    static async issueFeeInvoice(bpId: number, monthStart: Date, adminId: number | null) {
        const from = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1));
        const to = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
        const periodFrom = from.toISOString().slice(0, 10);
        const periodTo = new Date(to.getTime() - 86_400_000).toISOString().slice(0, 10);

        const [dupe] = await db.select({ id: taxDocuments.id }).from(taxDocuments).where(and(
            eq(taxDocuments.purpose, 'fee'), eq(taxDocuments.recipientPartnerId, bpId), eq(taxDocuments.periodFrom, periodFrom), eq(taxDocuments.status, 'issued'))).limit(1);
        if (dupe) return null;

        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) return null;
        const sac = ((await configService.get<string>('BUSINESS_CONFIG.FEE_SAC_CODE')) || '998599').trim();
        const gstRate = parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18');
        const monthLabel = from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const lines: DocLineInput[] = [];

        const [op] = await db.select({ id: ftthOperators.id }).from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bpId)).limit(1);
        if (op) {
            const [lead] = await db.select({ n: sql<number>`count(*)::int`, paise: sql<number>`coalesce(sum(-${ftthOperatorLedger.amountPaise}), 0)::int` })
                .from(ftthOperatorLedger)
                .where(and(eq(ftthOperatorLedger.operatorId, op.id), eq(ftthOperatorLedger.entryType, 'lead_fee'),
                    gte(ftthOperatorLedger.createdAt, from), sql`${ftthOperatorLedger.createdAt} < ${to}`));
            if (lead && lead.paise > 0) {
                const taxable = Math.round(lead.paise * 100 / (100 + gstRate));
                lines.push({ description: `Broadband lead fees — ${lead.n} lead${lead.n === 1 ? '' : 's'} converted, ${monthLabel}`, hsnSac: sac, quantity: lead.n, unit: 'lead', ratePaise: Math.round(taxable / Math.max(1, lead.n)), taxablePaise: taxable, gstRate, taxPaise: lead.paise - taxable });
            }
        }

        const proBilled = bp.hubPlan === 'pro' && (!bp.hubPlanSince || bp.hubPlanSince < to);
        let proTotal = 0;
        if (proBilled) {
            const fee = parseInt((await configService.get<string>('BUSINESS_CONFIG.HUB_PRO_FEE_PAISE')) || '49900', 10);
            if (fee > 0) {
                const tax = Math.round(fee * gstRate / 100);
                proTotal = fee + tax;
                lines.push({ description: `Partner Hub Pro plan — ${monthLabel}`, hsnSac: sac, quantity: 1, unit: 'month', ratePaise: fee, taxablePaise: fee, gstRate, taxPaise: tax });
            }
        }
        if (!lines.length) return null;

        return db.transaction(async (tx) => {
            const doc = await this.create(tx as any, {
                docKind: 'tax_invoice', issuer: 'unitefix', seriesKey: 'uf-fee', prefix: 'UF', letter: 'F', purpose: 'fee',
                recipientPartnerId: bpId, supplier: await this.unitefixParty(), recipient: this.partnerParty(bp), lines,
                periodFrom, periodTo, notes: `UniteFix fees for ${monthLabel}. Lead fees were deducted from your broadband settlements as they arose and are shown inclusive of GST.`,
                createdByAdminId: adminId, issuedAt: new Date(),
            });
            if (proTotal > 0) {
                await BusinessPartnerService.appendLedger(tx as any, {
                    businessPartnerId: bpId, entryType: 'fee_charge', amountPaise: proTotal,
                    description: `Partner Hub Pro — ${monthLabel} (invoice ${doc.number})`, metadata: { taxDocumentId: doc.id }, createdByAdminId: adminId,
                });
            }
            return doc;
        });
    }

    /** All active partners, for the month that starts at monthStart. */
    static async runMonthlyFeeInvoices(monthStart: Date, adminId: number | null) {
        const rows = await db.select({ id: businessPartners.id }).from(businessPartners).where(eq(businessPartners.status, 'active'));
        const issued: string[] = [];
        for (const r of rows) {
            try {
                const doc = await this.issueFeeInvoice(r.id, monthStart, adminId);
                if (doc) issued.push(doc.number);
            } catch (err: any) {
                logger.error(`[GST] fee invoice for partner #${r.id} failed: ${err?.message}`);
            }
        }
        return issued;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reading
    // ──────────────────────────────────────────────────────────────────────

    static async withLines(id: number) {
        const [doc] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, id)).limit(1);
        if (!doc) return null;
        const lines = await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, id)).orderBy(taxDocumentLines.lineNo);
        return { doc, lines };
    }

    /** Documents a partner received (from UniteFix) or issued (its own sales). */
    static async forPartner(bpId: number, opts: { purpose?: string; direction?: 'received' | 'issued'; from?: string; to?: string } = {}) {
        const conds: any[] = [];
        if (opts.direction === 'received') conds.push(eq(taxDocuments.recipientPartnerId, bpId), eq(taxDocuments.issuer, 'unitefix'));
        else if (opts.direction === 'issued') conds.push(eq(taxDocuments.issuerPartnerId, bpId), eq(taxDocuments.issuer, 'partner'));
        else conds.push(or(and(eq(taxDocuments.recipientPartnerId, bpId), eq(taxDocuments.issuer, 'unitefix')), eq(taxDocuments.issuerPartnerId, bpId)));
        if (opts.purpose) conds.push(eq(taxDocuments.purpose, opts.purpose));
        if (opts.from) conds.push(gte(taxDocuments.issuedAt, new Date(opts.from)));
        if (opts.to) conds.push(lte(taxDocuments.issuedAt, new Date(new Date(opts.to).getTime() + 86_399_999)));
        return db.select().from(taxDocuments).where(and(...conds)).orderBy(desc(taxDocuments.issuedAt), desc(taxDocuments.id)).limit(500);
    }

    /** Whether a partner may open a document: it is the recipient or the issuer. */
    static canSee(doc: TaxDocument, bpId: number) {
        return (doc.issuer === 'unitefix' && doc.recipientPartnerId === bpId) || doc.issuerPartnerId === bpId;
    }
}

export const paise = (n: number) => (n / 100).toFixed(2);
