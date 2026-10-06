/**
 * GST desk — a partner's returns, prepared from what the Hub already holds.
 *
 *   Sales register      every invoice / credit note / bill of supply it issued
 *   Purchase register   UniteFix's invoices to it + supplier bills it recorded
 *   Summary             output tax, input tax, the difference (an estimate —
 *                       the real set-off happens in GSTR-3B on the portal)
 *   HSN summary         by HSN/SAC and rate, split B2B / B2C as GSTR-1 asks
 *   GSTR-1 JSON         b2b, b2cl, b2cs, cdnr, cdnur, nil, hsn, doc_issue —
 *                       for the GST offline tool; Pro plan only
 *   Due dates           GSTR-1 and GSTR-3B by filing frequency and state
 *
 * Nothing here files anything. The partner (or their CA) checks and uploads.
 */

import { db } from '../db';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { taxDocuments, taxDocumentLines, partnerPurchaseBills, type TaxDocument, type TaxDocumentLine } from '@shared/schema';
import { GST_STATES } from '@shared/hub';
import { BusinessPartnerService } from './business-partner.service';
import { TaxDocumentService } from './tax-documents.service';
import { HubError } from './partner-hub.service';

/** Interstate invoices to unregistered buyers above this go to B2CL (₹1 lakh since Aug 2024). */
export const B2CL_THRESHOLD_PAISE = 100_000_00;

/** States whose quarterly GSTR-3B falls on the 22nd; everyone else files by the 24th. */
const GSTR3B_22ND = new Set(['22', '23', '24', '26', '27', '29', '30', '31', '32', '33', '34', '35', '36', '37']);

const r2 = (p: number) => Math.round(p) / 100;
const ddmmyyyy = (d: Date | string | null) => {
    const x = new Date(d ?? Date.now());
    const ist = new Date(x.getTime() + 330 * 60_000);
    return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
};
const isoDay = (d: Date | string | null) => new Date(new Date(d ?? Date.now()).getTime() + 330 * 60_000).toISOString().slice(0, 10);

export interface Period { from: string; to: string; label: string; fp: string }

export class GstDeskService {

    /** "2026-09" → that month; "2026-Q2" → Jul–Sep 2026 (FY quarters: Q1 = Apr–Jun). */
    static period(p: string): Period {
        let m = /^(\d{4})-(\d{2})$/.exec(p);
        if (m) {
            const y = Number(m[1]), mo = Number(m[2]);
            if (mo < 1 || mo > 12) throw new HubError('Bad month.', 'BAD_PERIOD');
            const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
            return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${last}`, label: new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), fp: `${m[2]}${m[1]}` };
        }
        m = /^(\d{4})-Q([1-4])$/.exec(p);
        if (m) {
            const y = Number(m[1]), q = Number(m[2]);
            const startMonth = [4, 7, 10, 1][q - 1];
            const year = q === 4 ? y + 1 : y;
            const endMonth = startMonth + 2;
            const last = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
            const mm = (n: number) => String(n).padStart(2, '0');
            return { from: `${year}-${mm(startMonth)}-01`, to: `${year}-${mm(endMonth)}-${last}`, label: `Q${q} FY ${y}-${String(y + 1).slice(2)}`, fp: `${mm(endMonth)}${year}` };
        }
        throw new HubError('Period is YYYY-MM or YYYY-Q1..Q4 (financial-year quarter).', 'BAD_PERIOD');
    }

    private static async issued(bpId: number, per: Period) {
        const docs = await db.select().from(taxDocuments).where(and(
            eq(taxDocuments.issuer, 'partner'), eq(taxDocuments.issuerPartnerId, bpId),
            gte(taxDocuments.issuedAt, new Date(`${per.from}T00:00:00+05:30`)), lte(taxDocuments.issuedAt, new Date(`${per.to}T23:59:59.999+05:30`)),
        )).orderBy(asc(taxDocuments.issuedAt), asc(taxDocuments.id));
        const lines = docs.length ? await db.select().from(taxDocumentLines).where(inArray(taxDocumentLines.documentId, docs.map(d => d.id))).orderBy(asc(taxDocumentLines.lineNo)) : [];
        const byDoc = new Map<number, TaxDocumentLine[]>();
        for (const l of lines) { const a = byDoc.get(l.documentId) ?? []; a.push(l); byDoc.set(l.documentId, a); }
        return docs.map(d => ({ doc: d, lines: byDoc.get(d.id) ?? [] }));
    }

    static async salesRegister(bpId: number, per: Period) {
        const rows = await this.issued(bpId, per);
        return rows.map(({ doc: d }) => {
            const s = d.docKind === 'credit_note' ? -1 : 1;
            const rc = d.recipient as any;
            return {
                id: d.id, date: isoDay(d.issuedAt), number: d.number, kind: d.docKind, status: d.status,
                customer: rc?.name ?? '', customerGstin: rc?.gstin ?? null, placeOfSupply: d.placeOfSupplyName,
                taxable: r2(s * d.taxablePaise), cgst: r2(s * d.cgstPaise), sgst: r2(s * d.sgstPaise), igst: r2(s * d.igstPaise), total: r2(s * d.totalPaise),
                irnStatus: d.irnStatus,
            };
        });
    }

    static async purchaseRegister(bpId: number, per: Period) {
        const docs = await TaxDocumentService.forPartner(bpId, { direction: 'received', from: per.from, to: per.to });
        const bills = await db.select().from(partnerPurchaseBills).where(and(eq(partnerPurchaseBills.businessPartnerId, bpId), gte(partnerPurchaseBills.billDate, per.from), lte(partnerPurchaseBills.billDate, per.to)));
        return [
            ...docs.map(d => {
                const s = d.docKind === 'credit_note' ? -1 : 1;
                const sp = d.supplier as any;
                return { source: 'unitefix', date: isoDay(d.issuedAt), number: d.number, kind: d.docKind, supplier: sp?.name ?? 'UniteFix', supplierGstin: sp?.gstin ?? null, taxable: r2(s * d.taxablePaise), cgst: r2(s * d.cgstPaise), sgst: r2(s * d.sgstPaise), igst: r2(s * d.igstPaise), total: r2(s * d.totalPaise) };
            }),
            ...bills.map(b => ({ source: 'bill', date: b.billDate, number: b.billNumber, kind: 'supplier_bill', supplier: b.supplierName, supplierGstin: b.supplierGstin, taxable: r2(b.taxablePaise), cgst: r2(b.cgstPaise), sgst: r2(b.sgstPaise), igst: r2(b.igstPaise), total: r2(b.totalPaise) })),
        ].sort((a, b) => a.date.localeCompare(b.date));
    }

    static async summary(bpId: number, per: Period) {
        const [sales, purchases, bp] = await Promise.all([this.salesRegister(bpId, per), this.purchaseRegister(bpId, per), BusinessPartnerService.byId(bpId)]);
        const live = sales.filter(s => s.status === 'issued');
        const add = (rows: Array<{ taxable: number; cgst: number; sgst: number; igst: number }>) => rows.reduce((a, r) => ({ taxable: a.taxable + r.taxable, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst, igst: a.igst + r.igst }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
        const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
        const output = add(live), input = add(purchases);
        const outTax = output.cgst + output.sgst + output.igst, inTax = input.cgst + input.sgst + input.igst;
        return {
            period: per, registered: !!bp?.gstin, gstin: bp?.gstin ?? null, frequency: bp?.gstFilingFrequency ?? 'monthly',
            output: round(output), input: round(input),
            netPayableEstimate: Math.round(Math.max(0, outTax - inTax) * 100) / 100,
            creditCarriedEstimate: Math.round(Math.max(0, inTax - outTax) * 100) / 100,
            counts: { invoices: live.filter(s => s.kind !== 'credit_note').length, creditNotes: live.filter(s => s.kind === 'credit_note').length, purchases: purchases.length },
            irnPending: live.filter(s => s.irnStatus === 'pending_provider').length,
            dueDates: this.dueDates(per, bp?.gstFilingFrequency ?? 'monthly', bp?.stateCode ?? null),
        };
    }

    /** Statutory due dates for the period's returns (extensions are notified separately by CBIC). */
    static dueDates(per: Period, frequency: string, stateCode: string | null) {
        const [y, m] = per.to.split('-').map(Number);
        const next = (day: number) => { const d = new Date(Date.UTC(y, m, day)); return d.toISOString().slice(0, 10); };
        if (frequency === 'quarterly') {
            return { gstr1: next(13), gstr3b: next(stateCode && GSTR3B_22ND.has(stateCode) ? 22 : 24), note: 'Quarterly (QRMP): the first two months of each quarter need IFF (optional) and PMT-06 tax payment by the 25th.' };
        }
        return { gstr1: next(11), gstr3b: next(20), note: null };
    }

    static async hsnSummary(bpId: number, per: Period) {
        const rows = (await this.issued(bpId, per)).filter(r => r.doc.status === 'issued');
        const acc = new Map<string, { hsn: string; rate: number; b2b: boolean; desc: string; uqc: string; qty: number; txval: number; iamt: number; camt: number; samt: number }>();
        for (const { doc, lines } of rows) {
            const s = doc.docKind === 'credit_note' ? -1 : 1;
            const b2b = !!(doc.recipient as any)?.gstin;
            for (const l of lines) {
                const hsn = l.hsnSac || 'NA';
                const rate = Number(l.gstRate);
                const key = `${b2b ? 'B' : 'C'}|${hsn}|${rate}`;
                const a = acc.get(key) ?? { hsn, rate, b2b, desc: l.description.slice(0, 30), uqc: uqcOf(l.unit), qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
                a.qty += s * Number(l.quantity); a.txval += s * l.taxablePaise; a.iamt += s * l.igstPaise; a.camt += s * l.cgstPaise; a.samt += s * l.sgstPaise;
                acc.set(key, a);
            }
        }
        return Array.from(acc.values()).map(a => ({ ...a, qty: Math.round(a.qty * 1000) / 1000, txval: r2(a.txval), iamt: r2(a.iamt), camt: r2(a.camt), samt: r2(a.samt) }))
            .sort((x, y) => Number(y.b2b) - Number(x.b2b) || x.hsn.localeCompare(y.hsn) || x.rate - y.rate);
    }

    /**
     * GSTR-1 in the shape the GST offline tool imports. Nil-rated lines go to
     * Table 8 ("nil"), not into B2B/B2CS. A credit note to an unregistered
     * buyer reduces B2CS unless the original was a B2CL invoice (then CDNUR).
     */
    static async gstr1(bpId: number, per: Period) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp?.gstin) throw new HubError('GSTR-1 is for GST-registered businesses. Add your GSTIN first.', 'NOT_REGISTERED');
        const rows = (await this.issued(bpId, per)).filter(r => r.doc.status === 'issued');
        const originals = new Map<number, TaxDocument>();
        const origIds = rows.map(r => r.doc.originalDocumentId).filter((x): x is number => !!x);
        if (origIds.length) for (const o of await db.select().from(taxDocuments).where(inArray(taxDocuments.id, origIds))) originals.set(o.id, o);

        const isB2cl = (d: TaxDocument) => !(d.recipient as any)?.gstin && d.isInterstate && d.totalPaise > B2CL_THRESHOLD_PAISE;
        const items = (lines: TaxDocumentLine[]) => {
            const byRate = new Map<number, { txval: number; iamt: number; camt: number; samt: number }>();
            for (const l of lines) {
                const rt = Number(l.gstRate);
                if (rt === 0) continue;
                const a = byRate.get(rt) ?? { txval: 0, iamt: 0, camt: 0, samt: 0 };
                a.txval += l.taxablePaise; a.iamt += l.igstPaise; a.camt += l.cgstPaise; a.samt += l.sgstPaise;
                byRate.set(rt, a);
            }
            return Array.from(byRate.entries()).map(([rt, a], i) => ({ num: i + 1, itm_det: { rt, txval: r2(a.txval), iamt: r2(a.iamt), camt: r2(a.camt), samt: r2(a.samt), csamt: 0 } }));
        };
        const pos = (d: TaxDocument) => d.placeOfSupplyCode ?? bp.stateCode ?? '';

        const b2b = new Map<string, any[]>();
        const b2cl = new Map<string, any[]>();
        const b2cs = new Map<string, { sply_ty: string; pos: string; typ: 'OE'; rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: 0 }>();
        const cdnr = new Map<string, any[]>();
        const cdnur: any[] = [];
        const nil = { INTRB2B: 0, INTRAB2B: 0, INTRB2C: 0, INTRAB2C: 0 };
        const docIssue: Record<number, string[]> = { 1: [], 5: [] };

        for (const { doc: d, lines } of rows) {
            const ctin: string | null = (d.recipient as any)?.gstin ?? null;
            const cn = d.docKind === 'credit_note';
            docIssue[cn ? 5 : 1].push(d.number);
            // Nil-rated lines (Table 8)
            const nilVal = lines.filter(l => Number(l.gstRate) === 0).reduce((a, l) => a + l.taxablePaise, 0) * (cn ? -1 : 1);
            if (nilVal) nil[`${d.isInterstate ? 'INTR' : 'INTRA'}${ctin ? 'B2B' : 'B2C'}` as keyof typeof nil] += nilVal;
            const its = items(lines);
            if (!its.length) continue;

            if (!cn && ctin) {
                const a = b2b.get(ctin) ?? [];
                a.push({ inum: d.number, idt: ddmmyyyy(d.issuedAt), val: r2(d.totalPaise), pos: pos(d), rchrg: 'N', inv_typ: 'R', itms: its, ...(d.irn ? { irn: d.irn } : {}) });
                b2b.set(ctin, a);
            } else if (!cn && isB2cl(d)) {
                const a = b2cl.get(pos(d)) ?? [];
                a.push({ inum: d.number, idt: ddmmyyyy(d.issuedAt), val: r2(d.totalPaise), itms: its.map(i => ({ num: i.num, itm_det: { rt: i.itm_det.rt, txval: i.itm_det.txval, iamt: i.itm_det.iamt, csamt: 0 } })) });
                b2cl.set(pos(d), a);
            } else if (cn && ctin) {
                const a = cdnr.get(ctin) ?? [];
                a.push({ ntty: 'C', nt_num: d.number, nt_dt: ddmmyyyy(d.issuedAt), val: r2(d.totalPaise), pos: pos(d), rchrg: 'N', inv_typ: 'R', itms: its });
                cdnr.set(ctin, a);
            } else if (cn && d.originalDocumentId && originals.has(d.originalDocumentId) && isB2cl(originals.get(d.originalDocumentId)!)) {
                cdnur.push({ typ: 'B2CL', ntty: 'C', nt_num: d.number, nt_dt: ddmmyyyy(d.issuedAt), val: r2(d.totalPaise), pos: pos(d), itms: its.map(i => ({ num: i.num, itm_det: { rt: i.itm_det.rt, txval: i.itm_det.txval, iamt: i.itm_det.iamt, csamt: 0 } })) });
            } else {
                // B2CS — aggregated; credit notes net off.
                const s = cn ? -1 : 1;
                for (const l of lines) {
                    const rt = Number(l.gstRate);
                    if (rt === 0) continue;
                    const sply = d.isInterstate ? 'INTER' : 'INTRA';
                    const key = `${sply}|${pos(d)}|${rt}`;
                    const a = b2cs.get(key) ?? { sply_ty: sply, pos: pos(d), typ: 'OE' as const, rt, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 as const };
                    a.txval += s * l.taxablePaise; a.iamt += s * l.igstPaise; a.camt += s * l.cgstPaise; a.samt += s * l.sgstPaise;
                    b2cs.set(key, a);
                }
            }
        }

        const hsn = await this.hsnSummary(bpId, per);
        const hsnRow = (h: typeof hsn[number], i: number) => ({ num: i + 1, hsn_sc: h.hsn, desc: h.desc, uqc: h.uqc, qty: h.qty, rt: h.rate, txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: 0 });
        const docRange = (nums: string[]) => {
            if (!nums.length) return null;
            const sorted = [...nums].sort();
            return { num: 1, from: sorted[0], to: sorted[sorted.length - 1], totnum: nums.length, cancel: 0, net_issue: nums.length };
        };

        const out: Record<string, unknown> = { gstin: bp.gstin, fp: per.fp };
        if (b2b.size) out.b2b = Array.from(b2b.entries()).map(([ctin, inv]) => ({ ctin, inv }));
        if (b2cl.size) out.b2cl = Array.from(b2cl.entries()).map(([p, inv]) => ({ pos: p, inv }));
        const b2csRows = Array.from(b2cs.values()).filter(v => v.txval !== 0).map(v => ({ ...v, txval: r2(v.txval), iamt: r2(v.iamt), camt: r2(v.camt), samt: r2(v.samt) }));
        if (b2csRows.length) out.b2cs = b2csRows;
        if (cdnr.size) out.cdnr = Array.from(cdnr.entries()).map(([ctin, nt]) => ({ ctin, nt }));
        if (cdnur.length) out.cdnur = cdnur;
        if (Object.values(nil).some(v => v !== 0)) out.nil = { inv: Object.entries(nil).filter(([, v]) => v !== 0).map(([sply_ty, v]) => ({ sply_ty, nil_amt: r2(v), expt_amt: 0, ngsup_amt: 0 })) };
        const hb = hsn.filter(h => h.b2b && h.rate > 0).map(hsnRow), hc = hsn.filter(h => !h.b2b && h.rate > 0).map(hsnRow);
        if (hb.length || hc.length) out.hsn = { ...(hb.length ? { hsn_b2b: hb } : {}), ...(hc.length ? { hsn_b2c: hc } : {}) };
        const dd = [[1, docRange(docIssue[1])], [5, docRange(docIssue[5])]].filter(([, r]) => r).map(([n, r]) => ({ doc_num: n, docs: [r] }));
        if (dd.length) out.doc_issue = { doc_det: dd };
        return out;
    }

    static csv(rows: Array<Record<string, unknown>>, columns: Array<[string, string]>) {
        const esc = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
        return [columns.map(c => c[1]).join(','), ...rows.map(r => columns.map(c => esc(r[c[0]])).join(','))].join('\n');
    }
}

/** GST "unit quantity code" from the unit printed on the line. */
function uqcOf(unit: string | null): string {
    const u = (unit ?? '').trim().toLowerCase();
    if (!u) return 'OTH';
    if (['pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'unit', 'units'].includes(u)) return 'NOS';
    if (['hr', 'hrs', 'hour', 'hours'].includes(u)) return 'OTH';
    if (['m', 'mtr', 'metre', 'meter', 'metres', 'meters'].includes(u)) return 'MTR';
    if (['kg', 'kgs'].includes(u)) return 'KGS';
    if (['box', 'boxes'].includes(u)) return 'BOX';
    if (['set', 'sets'].includes(u)) return 'SET';
    if (['roll', 'rolls'].includes(u)) return 'ROL';
    return 'OTH';
}
