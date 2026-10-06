/**
 * Partner Hub — phase 3 end to end: customers, quotations, invoices, bills of
 * supply, payments, credit notes, e-invoice status, plan limits, GST desk.
 *
 *   npm run smoke:hub-p3
 */

import { and, eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, ftthOperators, ftthConnections, taxDocuments } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);

        // ── fixtures: a registered Karnataka partner, an unregistered one ──
        const ka = await BusinessPartnerService.create({
            legalName: `QA Quick Tech ${stamp}`, displayName: 'Quick Tech Karwar', gstin: await gstinFor('29', 'QAQTK1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p3ka_${stamp}@example.test`, verticalCodes: ['isp', 'computer'], approvedByAdminId: sa.id,
        });
        const un = await BusinessPartnerService.create({
            legalName: `QA Small Shop ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p3un_${stamp}@example.test`, verticalCodes: ['computer'], approvedByAdminId: sa.id,
        });
        bpIds.push(ka.id, un.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', address: 'Karwar' }).where(eq(businessPartners.id, ka.id));
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', address: 'Sirsi' }).where(eq(businessPartners.id, un.id));
        const kaLogin = await PartnerHubService.createOwnerLogin(ka.id, {});
        const unLogin = await PartnerHubService.createOwnerLogin(un.id, {});
        for (const e of [kaLogin.username, unLogin.username]) {
            const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id);
        }
        const ka1 = (await api.login(kaLogin.username, kaLogin.temporaryPassword))!;
        const un1 = (await api.login(unLogin.username, unLogin.temporaryPassword))!;

        // ── customers ─────────────────────────────────────────────────────
        const walkIn = await api.post('/api/hub/customers', { name: 'QA Ravi', phone: '+91 98450 11111', email: 'Ravi@Example.test', address: 'MG Road', pincode: '581301' }, ka1);
        check('a customer is added', walkIn.status === 201 && walkIn.body?.data?.phone === '9845011111' && walkIn.body?.data?.stateCode === '29', walkIn.body?.message);
        const dup = await api.post('/api/hub/customers', { name: 'QA Ravi again', phone: '9845011111' }, ka1);
        check('the same phone twice is refused', dup.status === 409);
        const badG = await api.post('/api/hub/customers', { name: 'QA Bad', gstin: '29AAAAA0000A1Z0' }, ka1);
        check('a GSTIN with a wrong check digit is refused', badG.status === 400 && /GSTIN/.test(badG.body?.message ?? ''));
        const mhGstin = await gstinFor('27', 'QAMHB1234K');
        const mhB2b = await api.post('/api/hub/customers', { name: 'QA Pune Office', gstin: mhGstin, address: 'Pune' }, ka1);
        check('a registered customer takes its state from the GSTIN', mhB2b.status === 201 && mhB2b.body?.data?.stateCode === '27' && mhB2b.body?.data?.stateName === 'Maharashtra');
        const mhB2c = await api.post('/api/hub/customers', { name: 'QA Pune Home', stateCode: '27' }, ka1);
        const foreignC = await api.get(`/api/hub/customers/${walkIn.body.data.id}`, un1);
        check('another partner cannot see the customer', foreignC.status === 404);
        const search = await api.get('/api/hub/customers?q=pune', ka1);
        check('customer search', search.status === 200 && search.body?.data?.length === 2);

        // ── invoices ──────────────────────────────────────────────────────
        const noHsn = await api.post('/api/hub/invoices', { customerId: walkIn.body.data.id, lines: [{ description: 'Laptop service', quantity: 1, rateRupees: 1000, gstRate: 18 }] }, ka1);
        check('a registered business must give HSN/SAC', noHsn.status === 400 && noHsn.body?.code === 'NO_HSN');
        const badRate = await api.post('/api/hub/invoices', { customerId: walkIn.body.data.id, lines: [{ description: 'Laptop service', hsnSac: '998713', quantity: 1, rateRupees: 1000, gstRate: 12 }] }, ka1);
        check('a GST rate that no longer exists (12%) is refused', badRate.status === 400 && badRate.body?.code === 'BAD_RATE');
        const inv1 = await api.post('/api/hub/invoices', { customerId: walkIn.body.data.id, dueDate: '2026-01-01', lines: [
            { description: 'Laptop service', hsnSac: '998713', quantity: 1, rateRupees: 1000, gstRate: 18 },
            { description: 'RAM 8GB', hsnSac: '847330', quantity: 2, unit: 'pcs', rateRupees: 1500, gstRate: 18 },
        ] }, ka1);
        const d1 = inv1.body?.data;
        check('in-state invoice: CGST + SGST', inv1.status === 201 && d1?.docKind === 'tax_invoice' && d1.cgst === 360 && d1.sgst === 360 && d1.igst === 0 && d1.total === 4720, JSON.stringify(d1 && { c: d1.cgst, s: d1.sgst, t: d1.total }));
        check('number uses the business initials, within 16 characters', /^QTK\/\d{2}-\d{2}\/0001$/.test(d1?.number ?? ''), d1?.number);
        const prefix = await api.put('/api/hub/sales/settings', { invoicePrefix: 'ZZ' }, ka1);
        check('the prefix is fixed once an invoice exists', prefix.status === 409);
        const inv2 = await api.post('/api/hub/invoices', { customerId: mhB2b.body.data.id, lines: [{ description: 'AMC — 10 desktops', hsnSac: '998713', quantity: 10, rateRupees: 2000, gstRate: 18 }] }, ka1);
        const d2 = inv2.body?.data;
        check('out-of-state registered customer: IGST, place of supply Maharashtra', inv2.status === 201 && d2?.igst === 3600 && d2?.cgst === 0 && d2?.placeOfSupply === 'Maharashtra' && /0002$/.test(d2.number), JSON.stringify(d2 && { i: d2.igst, n: d2.number }));
        check('below ₹5 crore: no IRN needed', d2?.irnStatus === null);

        // Unregistered partner → bill of supply, never GST
        const unCust = await api.post('/api/hub/customers', { name: 'QA Sirsi Customer' }, un1);
        const bos = await api.post('/api/hub/invoices', { customerId: unCust.body.data.id, lines: [{ description: 'Printer repair', quantity: 1, rateRupees: 800, gstRate: 18 }] }, un1);
        check('a business without GSTIN issues a bill of supply with no GST', bos.status === 201 && bos.body?.data?.docKind === 'bill_of_supply' && bos.body.data.total === 800 && bos.body.data.cgst === 0, JSON.stringify(bos.body?.data && { k: bos.body.data.docKind, t: bos.body.data.total }));

        // PDFs and isolation
        const pdf = await fetch(`${base}/api/hub/tax-documents/${d1.id}/pdf`, { headers: { Authorization: `Bearer ${ka1}` } });
        check('the partner downloads its own invoice PDF', pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        const foreignPdf = await api.get(`/api/hub/tax-documents/${d1.id}/pdf`, un1);
        check('another partner cannot open it', foreignPdf.status === 404);
        const foreignInv = await api.get(`/api/hub/invoices/${d1.id}`, un1);
        check('…nor read it', foreignInv.status === 404);

        // ── payments and credit notes ─────────────────────────────────────
        const pay1 = await api.post(`/api/hub/invoices/${d1.id}/payments`, { amountRupees: 2000, method: 'upi', reference: 'UPI123', receivedOn: '2026-10-05' }, ka1);
        check('a part payment is recorded', pay1.status === 201);
        const over = await api.post(`/api/hub/invoices/${d1.id}/payments`, { amountRupees: 5000, method: 'cash', receivedOn: '2026-10-05' }, ka1);
        check('paying more than is outstanding is refused', over.status === 400 && over.body?.code === 'OVERPAY');
        const view1 = await api.get(`/api/hub/invoices/${d1.id}`, ka1);
        check('outstanding = total − paid, and it shows as overdue', view1.body?.data?.outstanding === 2720 && view1.body?.data?.overdue === true, String(view1.body?.data?.outstanding));
        const cn = await api.post(`/api/hub/invoices/${d1.id}/credit-note`, { reason: 'One RAM stick returned', lines: [{ lineNo: 2, quantity: 1 }] }, ka1);
        check('a credit note for one returned item', cn.status === 201 && cn.body?.data?.docKind === 'credit_note' && cn.body.data.total === 1770 && /\/C0001$/.test(cn.body.data.number), JSON.stringify(cn.body?.data && { t: cn.body.data.total, n: cn.body.data.number }) + ' ' + (cn.body?.message ?? ''));
        const view2 = await api.get(`/api/hub/invoices/${d1.id}`, ka1);
        check('the credit note reduces what is outstanding', view2.body?.data?.outstanding === 950 && view2.body?.data?.creditNotes?.length === 1, String(view2.body?.data?.outstanding));
        const overCn = await api.post(`/api/hub/invoices/${d1.id}/credit-note`, { reason: 'too much', lines: [{ lineNo: 1, quantity: 1 }, { lineNo: 2, quantity: 2 }] }, ka1);
        check('crediting more than is left is refused', overCn.status === 400 && overCn.body?.code === 'OVER_CREDIT');
        const cn2 = await api.post(`/api/hub/invoices/${d2.id}/credit-note`, { reason: 'One desktop off contract', lines: [{ lineNo: 1, quantity: 1 }] }, ka1);
        check('a credit note to a registered customer keeps IGST', cn2.status === 201 && cn2.body?.data?.igst === 360);

        // ── quotations ────────────────────────────────────────────────────
        const q = await api.post('/api/hub/quotations', { customerId: walkIn.body.data.id, validUntil: '2026-12-31', lines: [{ description: 'CCTV 4-camera kit', hsnSac: '852589', quantity: 1, rateRupees: 18000, gstRate: 18 }] }, ka1);
        check('a quotation is saved with its own number', q.status === 201 && /^QTK\/Q\/\d{2}-\d{2}\/0001$/.test(q.body?.data?.number ?? '') && q.body.data.total === 21240, q.body?.data?.number);
        const qPdf = await fetch(`${base}/api/hub/quotations/${q.body.data.id}/pdf`, { headers: { Authorization: `Bearer ${ka1}` } });
        check('the quotation prints as a PDF', qPdf.status === 200 && Buffer.from(await qPdf.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        const sent = await api.post(`/api/hub/quotations/${q.body.data.id}/status`, { status: 'sent' }, ka1);
        check('marked sent', sent.status === 200 && sent.body?.data?.status === 'sent');
        const rev = await api.put(`/api/hub/quotations/${q.body.data.id}`, { lines: [{ description: 'CCTV 4-camera kit', hsnSac: '852589', quantity: 1, rateRupees: 16500, gstRate: 18 }] }, ka1);
        check('revising a sent quotation makes version 2', rev.status === 200 && rev.body?.data?.version === 2 && rev.body.data.id !== q.body.data.id && rev.body.data.number === q.body.data.number);
        const old = await api.get(`/api/hub/quotations/${q.body.data.id}`, ka1);
        check('…and version 1 is kept, superseded', old.body?.data?.status === 'superseded' && old.body?.data?.history?.length === 2);
        const oldInv = await api.post(`/api/hub/quotations/${q.body.data.id}/invoice`, {}, ka1);
        check('a superseded version cannot be invoiced', oldInv.status === 409);
        await api.post(`/api/hub/quotations/${rev.body.data.id}/status`, { status: 'accepted' }, ka1);
        const fromQ = await api.post(`/api/hub/quotations/${rev.body.data.id}/invoice`, { dueDate: '2026-11-15' }, ka1);
        check('an accepted quotation becomes an invoice', fromQ.status === 201 && fromQ.body?.data?.total === 19470, fromQ.body?.message);
        const qAfter = await api.get(`/api/hub/quotations/${rev.body.data.id}`, ka1);
        check('…and is marked invoiced, linked to it', qAfter.body?.data?.status === 'invoiced' && qAfter.body?.data?.invoiceDocumentId === fromQ.body?.data?.id);
        const twice = await api.post(`/api/hub/quotations/${rev.body.data.id}/invoice`, {}, ka1);
        check('it cannot be invoiced twice', twice.status === 409);

        // ── e-invoicing above ₹5 crore ────────────────────────────────────
        await db.update(businessPartners).set({ aatoAbove5cr: true }).where(eq(businessPartners.id, ka.id));
        const big = await api.post('/api/hub/invoices', { customerId: mhB2b.body.data.id, lines: [{ description: 'Network audit', hsnSac: '998313', quantity: 1, rateRupees: 5000, gstRate: 18 }] }, ka1);
        check('above ₹5 crore a B2B invoice is flagged as needing an IRN — never a made-up one', big.status === 201 && big.body?.data?.irnStatus === 'pending_provider' && !big.body.data.irn && /IRN/.test(big.body?.message ?? ''));
        const b2cBig = await api.post('/api/hub/invoices', { customerId: walkIn.body.data.id, lines: [{ description: 'Service', hsnSac: '998713', quantity: 1, rateRupees: 100, gstRate: 18 }] }, ka1);
        check('B2C invoices need no IRN', b2cBig.body?.data?.irnStatus === null);
        const badIrn = await api.post(`/api/hub/invoices/${big.body.data.id}/irn`, { irn: 'not-an-irn-at-all' }, ka1);
        check('a malformed IRN is refused', badIrn.status === 400);
        const irn = 'a'.repeat(64);
        const goodIrn = await api.post(`/api/hub/invoices/${big.body.data.id}/irn`, { irn }, ka1);
        check('an IRN from the portal is recorded', goodIrn.status === 200 && goodIrn.body?.data?.irn === irn && goodIrn.body.data.irnStatus === 'recorded');
        await db.update(businessPartners).set({ aatoAbove5cr: false }).where(eq(businessPartners.id, ka.id));

        // B2CL — interstate, unregistered, above ₹1 lakh
        const b2cl = await api.post('/api/hub/invoices', { customerId: mhB2c.body.data.id, lines: [{ description: 'Server rack', hsnSac: '847150', quantity: 1, rateRupees: 150000, gstRate: 18 }] }, ka1);
        check('interstate sale to an unregistered buyer: IGST', b2cl.status === 201 && b2cl.body?.data?.igst === 27000);

        // ── roles ─────────────────────────────────────────────────────────
        const inv = await api.post('/api/hub/team', { name: 'QA Dispatcher', email: `qa_p3d_${stamp}@example.test`, role: 'dispatcher' }, ka1);
        const [dRow] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, `qa_p3d_${stamp}@example.test`)); if (dRow) adminIds.push(dRow.id);
        const disp = (await api.login(inv.body.data.username, inv.body.data.temporaryPassword))!;
        check('a dispatcher can look up customers', (await api.get('/api/hub/customers', disp)).status === 200);
        check('…but cannot invoice', (await api.post('/api/hub/invoices', { customerId: walkIn.body.data.id, lines: [{ description: 'x', hsnSac: '998713', quantity: 1, rateRupees: 1, gstRate: 18 }] }, disp)).status === 403);
        check('…nor open the GST desk', (await api.get('/api/hub/gst/summary', disp)).status === 403);

        // ── GST desk ──────────────────────────────────────────────────────
        const period = new Date().toISOString().slice(0, 7);
        const sum = await api.get(`/api/hub/gst/summary?period=${period}`, ka1);
        const issued = await db.select().from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, ka.id), eq(taxDocuments.issuer, 'partner')));
        const sign = (k: string) => k === 'credit_note' ? -1 : 1;
        const outCgst = issued.reduce((a, d) => a + sign(d.docKind) * d.cgstPaise, 0) / 100;
        const outIgst = issued.reduce((a, d) => a + sign(d.docKind) * d.igstPaise, 0) / 100;
        check('summary: output tax is invoices less credit notes', sum.status === 200 && sum.body?.data?.output?.cgst === outCgst && sum.body?.data?.output?.igst === outIgst, JSON.stringify(sum.body?.data?.output) + ` expected cgst ${outCgst} igst ${outIgst}`);
        check('summary: due dates for a monthly filer (11th / 20th)', /-11$/.test(sum.body?.data?.dueDates?.gstr1 ?? '') && /-20$/.test(sum.body?.data?.dueDates?.gstr3b ?? ''));
        check('summary: HSN rows split B2B / B2C', (sum.body?.data?.hsn ?? []).some((h: any) => h.b2b) && (sum.body?.data?.hsn ?? []).some((h: any) => !h.b2b));
        await api.put('/api/hub/sales/settings', { gstFilingFrequency: 'quarterly' }, ka1);
        const q2 = await api.get(`/api/hub/gst/summary?period=2026-Q2`, ka1);
        check('quarterly filer in Karnataka: GSTR-1 by the 13th, 3B by the 22nd after the quarter', q2.body?.data?.dueDates?.gstr1 === '2026-10-13' && q2.body?.data?.dueDates?.gstr3b === '2026-10-22', JSON.stringify(q2.body?.data?.dueDates));

        const csvRes = await fetch(`${base}/api/hub/gst/sales-register.csv?period=${period}`, { headers: { Authorization: `Bearer ${ka1}` } });
        const csv = await csvRes.text();
        check('sales register CSV lists invoices and credit notes (negative)', csvRes.status === 200 && csv.includes(d1.number) && csv.includes(cn.body.data.number) && /credit_note,issued,[^\n]*,-/.test(csv));
        const hsnCsv = await fetch(`${base}/api/hub/gst/hsn-summary.csv?period=${period}`, { headers: { Authorization: `Bearer ${ka1}` } });
        check('HSN summary CSV', hsnCsv.status === 200 && (await hsnCsv.text()).includes('998713'));

        const starterJson = await api.get(`/api/hub/gst/gstr1.json?period=${period}`, ka1);
        check('GSTR-1 export is a Pro feature', starterJson.status === 402);
        await db.update(businessPartners).set({ hubPlan: 'pro' }).where(eq(businessPartners.id, ka.id));
        const g = await api.get(`/api/hub/gst/gstr1.json?period=${period}`, ka1);
        const j = g.body;
        check('GSTR-1: header gstin and period', g.status === 200 && j?.gstin === ka.gstin && j?.fp === period.slice(5) + period.slice(0, 4));
        check('GSTR-1: B2B grouped by customer GSTIN', j?.b2b?.[0]?.ctin === mhGstin && j.b2b[0].inv.length === 2);
        check('GSTR-1: B2CL for the interstate ₹1.77 lakh sale', j?.b2cl?.[0]?.pos === '27' && j.b2cl[0].inv[0].itms[0].itm_det.iamt === 27000);
        const b2cs18 = (j?.b2cs ?? []).find((r: any) => r.pos === '29' && r.rt === 18);
        check('GSTR-1: B2CS nets the B2C credit note', !!b2cs18 && b2cs18.txval === 4000 - 1500 + 16500 + 100, JSON.stringify(b2cs18));
        check('GSTR-1: CDNR for the credit note to the registered customer', j?.cdnr?.[0]?.ctin === mhGstin && j.cdnr[0].nt[0].ntty === 'C');
        check('GSTR-1: HSN split into hsn_b2b and hsn_b2c', !!j?.hsn?.hsn_b2b?.length && !!j?.hsn?.hsn_b2c?.length);
        check('GSTR-1: documents issued (Table 13)', j?.doc_issue?.doc_det?.some((d: any) => d.doc_num === 1 && d.docs[0].totnum >= 5));
        const unJson = await api.get(`/api/hub/gst/gstr1.json?period=${period}`, un1);
        check('no GSTR-1 for an unregistered business', unJson.status === 402 || unJson.status === 400);

        // ── Starter invoice limit ─────────────────────────────────────────
        await db.update(businessPartners).set({ hubPlan: 'starter' }).where(eq(businessPartners.id, un.id));
        let lastStatus = 0;
        for (let i = 0; i < 25; i++) {
            const r = await api.post('/api/hub/invoices', { customerId: unCust.body.data.id, lines: [{ description: `Visit ${i}`, quantity: 1, rateRupees: 100 }] }, un1);
            lastStatus = r.status;
            if (r.status !== 201) break;
        }
        check('Starter: invoicing stops after 25 a month', lastStatus === 402, String(lastStatus));

        // ── broadband subscribers into the customer book ──────────────────
        const [op] = await db.insert(ftthOperators).values({ companyName: `QA Op ${stamp}`, contactEmail: `qa_p3op_${stamp}@example.test`, contactPhone: ka.contactPhone, status: 'active', businessPartnerId: ka.id } as any).returning();
        await db.insert(ftthConnections).values([
            { operatorId: op.id, customerName: 'QA Sub One', customerPhone: '9845011111', ispConnectionId: `QA-${stamp}-1`, status: 'active' } as any,
            { operatorId: op.id, customerName: 'QA Sub Two', customerPhone: '9845022222', ispConnectionId: `QA-${stamp}-2`, status: 'active' } as any,
        ]);
        const imp = await api.post('/api/hub/customers/import-broadband', {}, ka1);
        check('importing subscribers adds new ones and links existing customers by phone', imp.status === 200 && imp.body?.data?.added === 1 && imp.body?.data?.linked === 1, JSON.stringify(imp.body?.data) + ' ' + (imp.body?.message ?? ''));
        const imp2 = await api.post('/api/hub/customers/import-broadband', {}, ka1);
        check('importing again adds nothing', imp2.body?.data?.added === 0 && imp2.body?.data?.linked === 0);

        // ── home page ─────────────────────────────────────────────────────
        const home = await api.get('/api/hub/summary', ka1);
        check('home shows what customers owe', home.status === 200 && JSON.stringify(home.body?.data ?? {}).includes('Customers owe you'));
    } finally {
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM ftth_connections WHERE operator_id IN (SELECT id FROM ftth_operators WHERE business_partner_id IN (${bpIds.join(',') || 0}))`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(async (e) => { console.error(e); await cleanupPartners(bpIds, adminIds); process.exit(1); });
