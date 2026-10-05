/**
 * PDF rendering for GST documents and settlement statements.
 *
 * Laid out like an Indian tax invoice: supplier and GSTIN at the top, number,
 * date and place of supply, the recipient with their GSTIN, a line table with
 * HSN/SAC and the CGST/SGST or IGST split, totals, the amount in words and the
 * signatory line. PDFKit's Helvetica has no rupee glyph, so amounts read "Rs.".
 */

import PDFDocument from 'pdfkit';
import type { TaxDocument, TaxDocumentLine } from '@shared/schema';
import type { Party } from './tax-documents.service';
import { rupeesInWords } from '../lib/amount-words';

const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const TITLES: Record<string, string> = { tax_invoice: 'TAX INVOICE', credit_note: 'CREDIT NOTE', bill_of_supply: 'BILL OF SUPPLY' };

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

function partyBlock(doc: PDFKit.PDFDocument, p: Party, x: number, y: number, w: number, heading?: string) {
    let cy = y;
    if (heading) { doc.font('Helvetica-Bold').fontSize(8).fillColor('#555').text(heading.toUpperCase(), x, cy, { width: w }); cy = doc.y + 2; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(p.name, x, cy, { width: w });
    doc.font('Helvetica').fontSize(9);
    if (p.tradeName) doc.text(`Trading as ${p.tradeName}`, x, doc.y, { width: w });
    if (p.address) doc.text(p.address, x, doc.y, { width: w });
    doc.text(`GSTIN: ${p.gstin ?? 'Unregistered'}`, x, doc.y, { width: w });
    if (p.stateName) doc.text(`State: ${p.stateName} (${p.stateCode})`, x, doc.y, { width: w });
    return doc.y;
}

export async function renderTaxDocumentPdf(d: TaxDocument, lines: TaxDocumentLine[], extra?: { againstNumber?: string | null }): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const L = 40, R = 555, W = R - L;
    const supplier = d.supplier as unknown as Party;
    const recipient = d.recipient as unknown as Party;
    const igst = d.isInterstate;

    // Header
    const top = 40;
    const supEnd = partyBlock(doc, supplier, L, top, 300);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(TITLES[d.docKind] ?? 'DOCUMENT', 330, top, { width: R - 330, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    const meta: Array<[string, string]> = [
        ['Number', d.number], ['Date', date(d.issuedAt)],
        ['Place of supply', d.placeOfSupplyName ? `${d.placeOfSupplyName} (${d.placeOfSupplyCode})` : '—'],
        ['Reverse charge', 'No'],
    ];
    if (extra?.againstNumber) meta.push(['Against invoice', extra.againstNumber]);
    if (d.periodFrom) meta.push(['Period', `${date(d.periodFrom)} – ${date(d.periodTo)}`]);
    if (d.irn) meta.push(['IRN', d.irn]);
    let my = top + 24;
    for (const [k, v] of meta) { doc.text(`${k}: ${v}`, 330, my, { width: R - 330, align: 'right' }); my = doc.y; }

    let y = Math.max(supEnd, my) + 12;
    doc.moveTo(L, y).lineTo(R, y).strokeColor('#000').lineWidth(1).stroke();
    y += 8;
    y = partyBlock(doc, recipient, L, y, W, d.docKind === 'credit_note' ? 'Credit to' : 'Bill to') + 12;

    // Table
    // Two fixed layouts, each exactly the printable width (515pt).
    const header: Array<[string, number]> = igst
        ? [['#', 16], ['Description', 175], ['HSN/SAC', 48], ['Qty', 40], ['Rate', 52], ['Taxable', 60], ['GST%', 28], ['IGST', 46], ['Total', 50]]
        : [['#', 16], ['Description', 145], ['HSN/SAC', 46], ['Qty', 36], ['Rate', 50], ['Taxable', 56], ['GST%', 26], ['CGST', 44], ['SGST', 44], ['Total', 52]];

    const drawHeader = () => {
        doc.rect(L, y, W, 16).fill('#efefef').fillColor('#000');
        let x = L;
        doc.font('Helvetica-Bold').fontSize(8);
        for (const [h, w] of header) { doc.text(h, x + 2, y + 4, { width: w - 4, align: h === 'Description' || h === '#' ? 'left' : 'right' }); x += w; }
        y += 18;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(8);
    for (const l of lines) {
        const cells = igst
            ? [String(l.lineNo), l.description, l.hsnSac ?? '—', `${Number(l.quantity)}${l.unit ? ' ' + l.unit : ''}`, num(l.ratePaise), num(l.taxablePaise), `${Number(l.gstRate)}`, num(l.igstPaise), num(l.totalPaise)]
            : [String(l.lineNo), l.description, l.hsnSac ?? '—', `${Number(l.quantity)}${l.unit ? ' ' + l.unit : ''}`, num(l.ratePaise), num(l.taxablePaise), `${Number(l.gstRate)}`, num(l.cgstPaise), num(l.sgstPaise), num(l.totalPaise)];
        const descW = header[1][1] - 4;
        const h = Math.max(14, doc.heightOfString(l.description, { width: descW }) + 6);
        if (y + h > 740) { doc.addPage(); y = 40; drawHeader(); doc.font('Helvetica').fontSize(8); }
        let x = L;
        header.forEach(([hname, w], i) => { doc.text(cells[i] ?? '', x + 2, y + 3, { width: w - 4, align: hname === 'Description' || hname === '#' ? 'left' : 'right' }); x += w; });
        y += h;
        doc.moveTo(L, y).lineTo(R, y).strokeColor('#ddd').lineWidth(0.5).stroke();
    }

    // Totals
    if (y > 640) { doc.addPage(); y = 40; }
    y += 8;
    const tot: Array<[string, number, boolean?]> = [['Taxable value', d.taxablePaise]];
    if (igst) tot.push(['IGST', d.igstPaise]); else { tot.push(['CGST', d.cgstPaise]); tot.push(['SGST', d.sgstPaise]); }
    tot.push([d.docKind === 'credit_note' ? 'Credit total' : 'Invoice total', d.totalPaise, true]);
    for (const [k, v, bold] of tot) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
        doc.text(k, 330, y, { width: 120, align: 'right' });
        doc.text(rs(v), 455, y, { width: R - 455, align: 'right' });
        y = doc.y + 3;
    }
    doc.font('Helvetica').fontSize(9).text(`Amount in words: ${rupeesInWords(d.totalPaise)}`, L, y + 6, { width: W });
    y = doc.y + 10;
    if (d.notes) { doc.fontSize(8).fillColor('#333').text(d.notes, L, y, { width: W }); y = doc.y + 10; }

    // Signatory
    doc.fillColor('#000').fontSize(9).text(`For ${supplier.name}`, 330, Math.max(y, 700), { width: R - 330, align: 'right' });
    doc.text('Authorised signatory', 330, doc.y + 18, { width: R - 330, align: 'right' });
    // Inside the bottom margin, without a line break — 800 would push PDFKit onto a blank page.
    doc.fontSize(7).fillColor('#777').text('Computer-generated document issued through UniteFix.', L, 784, { width: W, align: 'center', lineBreak: false });
    return toBuffer(doc);
}

export async function renderSettlementPdf(input: {
    runCode: string; createdAt: Date; paidAt: Date | null; status: string; method: string | null; payoutReference: string | null;
    partner: Party & { partnerCode: string }; payer: Party;
    ftthOwedPaise: number; b2bBalancePaise: number; offsetPaise: number; payoutPaise: number;
    lines: Array<{ at: Date; source: string; description: string; amountPaise: number }>;
}): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const L = 40, R = 555, W = R - L;
    partyBlock(doc, input.payer, L, 40, 300);
    doc.font('Helvetica-Bold').fontSize(15).text('SETTLEMENT STATEMENT', 300, 40, { width: R - 300, align: 'right' });
    doc.font('Helvetica').fontSize(9)
        .text(`Run: ${input.runCode}`, 300, 62, { width: R - 300, align: 'right' })
        .text(`Prepared: ${date(input.createdAt)}`, 300, doc.y, { width: R - 300, align: 'right' })
        .text(`Status: ${input.status}${input.paidAt ? ` on ${date(input.paidAt)}` : ''}`, 300, doc.y, { width: R - 300, align: 'right' })
        .text(input.payoutReference ? `Reference: ${input.payoutReference}${input.method ? ` (${input.method})` : ''}` : '', 300, doc.y, { width: R - 300, align: 'right' });
    let y = 140;
    doc.moveTo(L, y).lineTo(R, y).stroke();
    y = partyBlock(doc, input.partner, L, y + 8, W, `Paid to (${input.partner.partnerCode})`) + 14;

    const rows: Array<[string, number, boolean?]> = [
        ['Owed to you — broadband recharges and other earnings', input.ftthOwedPaise],
        [input.b2bBalancePaise >= 0 ? 'You owed UniteFix — parts and fees' : 'Owed to you — parts account credit', Math.abs(input.b2bBalancePaise)],
        ['Offset: parts dues settled from what we owed you', -input.offsetPaise],
        ['Paid to your bank in this settlement', input.payoutPaise, true],
    ];
    for (const [k, v, bold] of rows) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
        doc.text(k, L, y, { width: 380 }); doc.text(rs(v), L + 380, y, { width: W - 380, align: 'right' });
        y = doc.y + 6;
    }
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10).text('Entries covered', L, y); y = doc.y + 4;
    doc.font('Helvetica').fontSize(8);
    for (const l of input.lines) {
        if (y > 760) { doc.addPage(); y = 40; }
        doc.text(date(l.at), L, y, { width: 70 });
        doc.text(l.source, L + 72, y, { width: 60 });
        doc.text(l.description, L + 134, y, { width: 300 });
        doc.text(rs(l.amountPaise), L + 436, y, { width: W - 436, align: 'right' });
        y = Math.max(doc.y, y + 11) + 2;
    }
    doc.fontSize(7).fillColor('#777').text('Amounts owed to you are positive. Statement prepared by UniteFix; your full statement is in the Partner Hub under Money.', L, 784, { width: W, align: 'center', lineBreak: false });
    return toBuffer(doc);
}
