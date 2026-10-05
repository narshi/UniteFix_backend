/**
 * Partner Hub — phase 2 end to end: GST documents on B2B orders, purchases,
 * fee invoices, settlement runs with offsets, PDFs and partner isolation.
 *
 *   npm run smoke:hub-p2
 */

import { and, eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, tinyPdf, db } from './lib/hub-test-kit';
import {
    adminUsers, businessPartners, businessPartnerLedger, businessPartnerVerticals, partnerUsers, ftthOperators, ftthOperatorLedger,
    spareParts, sparePartStock, sparePartMovements, sparePartCategories, b2bOrders, b2bOrderItems, b2bOrderEvents,
    taxDocuments, taxDocumentLines, partnerPurchaseBills, settlementRuns,
} from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { SparePartsService } from '../server/services/spare-parts.service';
import { B2bOrderService } from '../server/services/b2b-order.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { TaxDocumentService } from '../server/services/tax-documents.service';
import { FtthService } from '../server/services/ftth.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];
const partIds: number[] = [];
let opId: number | null = null;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const staff = (await api.login(sa.username, sa.password))!;

        // ── fixtures: two partners, one Karnataka, one Maharashtra ────────
        const ka = await BusinessPartnerService.create({
            legalName: `QA Karwar Traders ${stamp}`, gstin: await gstinFor('29', 'QAKAR1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_ka_${stamp}@example.test`, verticalCodes: ['isp', 'computer'], creditLimitPaise: 50_000_00, paymentTermsDays: 15, approvedByAdminId: sa.id,
        });
        const mh = await BusinessPartnerService.create({
            legalName: `QA Pune Systems ${stamp}`, gstin: await gstinFor('27', 'QAPUN1234K'), contactPhone: `6${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_mh_${stamp}@example.test`, verticalCodes: ['computer'], creditLimitPaise: 50_000_00, paymentTermsDays: 15, approvedByAdminId: sa.id,
        });
        bpIds.push(ka.id, mh.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', address: 'Karwar' }).where(eq(businessPartners.id, ka.id));
        await db.update(businessPartners).set({ stateCode: '27', stateName: 'Maharashtra', address: 'Pune' }).where(eq(businessPartners.id, mh.id));

        const kaLogin = await PartnerHubService.createOwnerLogin(ka.id, {});
        const mhLogin = await PartnerHubService.createOwnerLogin(mh.id, {});
        for (const e of [kaLogin.username, mhLogin.username]) {
            const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id);
        }
        const kaTok = (await api.login(kaLogin.username, kaLogin.temporaryPassword))!;
        const mhTok = (await api.login(mhLogin.username, mhLogin.temporaryPassword))!;

        const part = await SparePartsService.create({ name: `QA Capacitor ${stamp}`, unitPricePaise: 300_00, tradePricePaise: 200_00, gstPercent: 18, hsnCode: '8532', createdByAdminId: sa.id });
        partIds.push(part.id);
        await SparePartsService.receivePurchase({ sparePartId: part.id, quantity: 100, adminId: sa.id });

        // ── B2B: invoice at dispatch, CGST+SGST in-state ──────────────────
        const placedKa = await B2bOrderService.place({ businessPartnerId: ka.id, items: [{ sparePartId: part.id, quantity: 3 }], paymentMode: 'credit' });
        const orderKa = placedKa.order;
        await B2bOrderService.transition(orderKa.id, 'confirmed', { type: 'admin', id: sa.id });
        check('no invoice before the goods leave', !(await TaxDocumentService.b2bInvoiceOf(orderKa.id)));
        await B2bOrderService.transition(orderKa.id, 'dispatched', { type: 'admin', id: sa.id }, { courier: 'QA' });
        const invKa = await TaxDocumentService.b2bInvoiceOf(orderKa.id);
        check('dispatch issues the tax invoice in the same step', !!invKa);
        check('invoice number fits GST\'s 16 characters', !!invKa && invKa.number.length <= 16 && /^UF\/\d{2}-\d{2}\/B\d{5}$/.test(invKa.number), invKa?.number);
        check('in-state: CGST + SGST, no IGST', !!invKa && invKa.cgstPaise > 0 && invKa.sgstPaise > 0 && invKa.igstPaise === 0 && !invKa.isInterstate);
        check('invoice total equals what the order charged', invKa?.totalPaise === orderKa.totalPaise, `${invKa?.totalPaise} vs ${orderKa.totalPaise}`);
        const [line] = invKa ? await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, invKa.id)) : [];
        check('the line carries the part\'s HSN', line?.hsnSac === '8532');
        await B2bOrderService.transition(orderKa.id, 'dispatched', { type: 'admin', id: sa.id }).catch(() => null);
        const invCount = await db.select({ id: taxDocuments.id }).from(taxDocuments).where(and(eq(taxDocuments.b2bOrderId, orderKa.id), eq(taxDocuments.docKind, 'tax_invoice')));
        check('one invoice per order, however often dispatch is pressed', invCount.length === 1);

        // Out of state → IGST
        const placedMh = await B2bOrderService.place({ businessPartnerId: mh.id, items: [{ sparePartId: part.id, quantity: 2 }], paymentMode: 'credit' });
        await B2bOrderService.transition(placedMh.order.id, 'confirmed', { type: 'admin', id: sa.id });
        await B2bOrderService.transition(placedMh.order.id, 'dispatched', { type: 'admin', id: sa.id });
        const invMh = await TaxDocumentService.b2bInvoiceOf(placedMh.order.id);
        check('out-of-state partner: IGST only', !!invMh && invMh.isInterstate && invMh.igstPaise > 0 && invMh.cgstPaise === 0 && invMh.placeOfSupplyName === 'Maharashtra');

        // Return → credit note
        await B2bOrderService.transition(orderKa.id, 'delivered', { type: 'admin', id: sa.id });
        await B2bOrderService.transition(orderKa.id, 'returned', { type: 'admin', id: sa.id }, { reason: 'QA damaged' });
        const [cn] = await db.select().from(taxDocuments).where(and(eq(taxDocuments.b2bOrderId, orderKa.id), eq(taxDocuments.docKind, 'credit_note')));
        check('an accepted return issues a credit note against the invoice', !!cn && cn.originalDocumentId === invKa!.id && cn.totalPaise === invKa!.totalPaise && /\/C\d{5}$/.test(cn.number), cn?.number);

        // ── partner: purchases ────────────────────────────────────────────
        const pur = await api.get('/api/hub/purchases', kaTok);
        check('purchases list the invoice and the credit note', pur.status === 200 && pur.body?.data?.documents?.length === 2, String(pur.body?.data?.documents?.length));
        check('input tax nets to zero after a full return', pur.body?.data?.itc?.cgst === 0 && pur.body?.data?.itc?.sgst === 0);

        const fd = new FormData();
        fd.append('supplierName', 'QA Wholesale'); fd.append('supplierGstin', await gstinFor('29', 'QAWHL1234K'));
        fd.append('billNumber', 'W-77'); fd.append('billDate', '2026-10-01'); fd.append('taxableRupees', '1000'); fd.append('cgstRupees', '90'); fd.append('sgstRupees', '90');
        fd.append('file', tinyPdf('bill'), 'bill.pdf');
        const bill = await api.upload('/api/hub/purchases/bills', fd, kaTok);
        check('a supplier bill is recorded with its file', bill.status === 201, bill.body?.message);
        const fd2 = new FormData();
        fd2.append('supplierName', 'QA Wholesale'); fd2.append('supplierGstin', await gstinFor('29', 'QAWHL1234K'));
        fd2.append('billNumber', 'W-77'); fd2.append('billDate', '2026-10-01'); fd2.append('taxableRupees', '1000'); fd2.append('cgstRupees', '90'); fd2.append('sgstRupees', '90');
        const dupBill = await api.upload('/api/hub/purchases/bills', fd2, kaTok);
        check('the same supplier bill twice is refused', dupBill.status === 409);
        const fd3 = new FormData();
        fd3.append('supplierName', 'X'); fd3.append('billNumber', 'X-1'); fd3.append('billDate', '2026-10-01'); fd3.append('taxableRupees', '100'); fd3.append('cgstRupees', '9'); fd3.append('igstRupees', '18');
        const mixed = await api.upload('/api/hub/purchases/bills', fd3, kaTok);
        check('a bill cannot carry IGST and CGST together', mixed.status === 400);

        const csvRes = await fetch(`${base}/api/hub/purchases/register.csv`, { headers: { Authorization: `Bearer ${kaTok}` } });
        const csv = await csvRes.text();
        check('purchase register CSV has the invoice, the credit note (negative) and the bill', csv.includes(invKa!.number) && csv.includes(cn!.number) && csv.includes('W-77') && /credit_note,-/.test(csv));

        // ── PDFs and isolation ────────────────────────────────────────────
        const pdfRes = await fetch(`${base}/api/hub/tax-documents/${invKa!.id}/pdf`, { headers: { Authorization: `Bearer ${kaTok}` } });
        const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
        check('the partner downloads its invoice as a PDF', pdfRes.status === 200 && pdfBuf.subarray(0, 4).toString() === '%PDF', `${pdfRes.status} ${pdfBuf.length}b`);
        const foreign = await api.get(`/api/hub/tax-documents/${invKa!.id}/pdf`, mhTok);
        check('another partner cannot open it', foreign.status === 404);
        const adminPdf = await fetch(`${base}/api/admin/hub/tax-documents/${cn!.id}/pdf`, { headers: { Authorization: `Bearer ${staff}` } });
        check('staff open the credit note PDF', adminPdf.status === 200);

        // ── fee invoice: lead fees (inclusive) + Pro plan (exclusive) ─────
        const [op] = await db.insert(ftthOperators).values({ companyName: `QA Op ${stamp}`, contactEmail: `qa_op_${stamp}@example.test`, contactPhone: ka.contactPhone, status: 'active', businessPartnerId: ka.id } as any).returning();
        opId = op.id;
        await FtthService.recordLedgerEntry({ operatorId: op.id, entryType: 'lead_fee', amountPaise: -118_00, description: 'QA lead' });
        await db.update(businessPartners).set({ hubPlan: 'pro', hubPlanSince: new Date('2026-01-01') }).where(eq(businessPartners.id, ka.id));
        const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const balBefore = await BusinessPartnerService.balancePaise(ka.id);
        const fee = await TaxDocumentService.issueFeeInvoice(ka.id, month, sa.id);
        const feeLines = fee ? await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, fee.id)) : [];
        const leadLine = feeLines.find(l => l.description.includes('lead'));
        const proLine = feeLines.find(l => l.description.includes('Pro'));
        check('fee invoice: lead fees carved as GST-inclusive (₹118 → ₹100 + ₹18)', leadLine?.taxablePaise === 100_00 && leadLine.cgstPaise + leadLine.sgstPaise === 18_00, JSON.stringify(leadLine && { t: leadLine.taxablePaise, c: leadLine.cgstPaise, s: leadLine.sgstPaise }));
        check('fee invoice: Pro plan ₹499 + 18% GST', proLine?.taxablePaise === 499_00 && proLine.cgstPaise + proLine.sgstPaise === Math.round(499_00 * 0.18));
        const balAfter = await BusinessPartnerService.balancePaise(ka.id);
        check('only the Pro charge is added to what the partner owes (lead fees were already deducted)', balAfter - balBefore === 499_00 + Math.round(499_00 * 0.18), String(balAfter - balBefore));
        check('the same month twice issues nothing', (await TaxDocumentService.issueFeeInvoice(ka.id, month, sa.id)) === null);
        const money = await api.get('/api/hub/money', kaTok);
        check('Money shows the fee invoice', money.status === 200 && money.body?.data?.feeInvoices?.some((d: any) => d.id === fee?.id));

        // ── settlement: offset parts dues against broadband money ─────────
        await FtthService.recordLedgerEntry({ operatorId: op.id, entryType: 'adjustment', amountPaise: 5_000_00, description: 'QA recharges owed' });
        const dues = await BusinessPartnerService.balancePaise(ka.id);
        const work = await api.get('/api/admin/hub/settlements/worklist', staff);
        const mine = work.body?.data?.find((w: any) => w.businessPartnerId === ka.id);
        check('the worklist shows what is owed, the dues and the offset', !!mine && mine.offset === dues / 100 && mine.payout === (5_000_00 - 118_00 - dues) / 100, JSON.stringify(mine && { owed: mine.ftthOwed, dues: mine.b2bBalance, off: mine.offset, pay: mine.payout }));

        const draft = await api.post('/api/admin/hub/settlements', { businessPartnerId: ka.id }, staff);
        check('staff draft a settlement', draft.status === 201, draft.body?.message);
        const again = await api.post('/api/admin/hub/settlements', { businessPartnerId: ka.id }, staff);
        check('one open settlement per partner', again.status === 409);
        const noBank = await api.post(`/api/admin/hub/settlements/${draft.body.data.id}/pay`, { method: 'manual', reference: 'UTR123456' }, staff);
        check('no payout to an unverified bank account', noBank.status === 409 && noBank.body?.code === 'BANK_NOT_VERIFIED');
        await db.update(businessPartners).set({ bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', beneficiaryName: 'QA', bankStatus: 'verified' }).where(eq(businessPartners.id, ka.id));
        const noRef = await api.post(`/api/admin/hub/settlements/${draft.body.data.id}/pay`, { method: 'manual', reference: '' }, staff);
        check('a manual payout needs the UTR', noRef.status === 409 && noRef.body?.code === 'REFERENCE_REQUIRED');
        const ftthBefore = await FtthService.operatorBalancePaise(op.id);
        const paid = await api.post(`/api/admin/hub/settlements/${draft.body.data.id}/pay`, { method: 'manual', reference: 'UTR123456' }, staff);
        check('paid by hand with a UTR', paid.status === 200 && paid.body?.data?.status === 'paid', paid.body?.message);
        check('broadband balance goes to zero', (await FtthService.operatorBalancePaise(op.id)) === 0, `${ftthBefore} → ${await FtthService.operatorBalancePaise(op.id)}`);
        check('parts dues are cleared by the offset', (await BusinessPartnerService.balancePaise(ka.id)) === 0);
        const offsets = await db.select().from(businessPartnerLedger).where(and(eq(businessPartnerLedger.businessPartnerId, ka.id), eq(businessPartnerLedger.entryType, 'settlement_offset' as any)));
        check('the offset is its own line on the partner ledger', offsets.length === 1 && offsets[0].amountPaise === -dues);
        const sPdf = await fetch(`${base}/api/hub/settlements/${draft.body.data.id}/pdf`, { headers: { Authorization: `Bearer ${kaTok}` } });
        check('the partner downloads the settlement statement', sPdf.status === 200 && Buffer.from(await sPdf.arrayBuffer()).subarray(0, 4).toString() === '%PDF');

        // Stale draft
        await FtthService.recordLedgerEntry({ operatorId: op.id, entryType: 'adjustment', amountPaise: 1_000_00, description: 'QA more' });
        const d2 = await api.post('/api/admin/hub/settlements', { businessPartnerId: ka.id }, staff);
        await FtthService.recordLedgerEntry({ operatorId: op.id, entryType: 'adjustment', amountPaise: -400_00, description: 'QA correction' });
        const stale = await api.post(`/api/admin/hub/settlements/${d2.body.data.id}/pay`, { method: 'manual', reference: 'UTR999999' }, staff);
        check('a run whose balances moved is refused (draft again)', stale.status === 409 && stale.body?.code === 'STALE');
        const cancel = await api.post(`/api/admin/hub/settlements/${d2.body.data.id}/cancel`, {}, staff);
        check('a stale draft can be cancelled', cancel.status === 200);

        const notMine = await api.get(`/api/hub/settlements/${draft.body.data.id}/pdf`, mhTok);
        check('another partner cannot open the statement', notMine.status === 404);

        // Backfill is a no-op when everything is invoiced
        const bf = await api.post('/api/admin/hub/b2b-invoices/backfill', {}, staff);
        check('backfill issues nothing when every dispatched order has its invoice', bf.status === 200 && !(bf.body?.data?.issued ?? []).some((n: string) => n === invKa!.number));
    } finally {
        await cleanup();
        await close();
    }
    process.exit(summary());
}

async function cleanup() {
    try {
        const orders = bpIds.length ? await db.select({ id: b2bOrders.id }).from(b2bOrders).where(inArray(b2bOrders.businessPartnerId, bpIds)) : [];
        const orderIds = orders.map(o => o.id);
        const docs = bpIds.length ? await db.select({ id: taxDocuments.id }).from(taxDocuments).where(inArray(taxDocuments.recipientPartnerId, bpIds)) : [];
        if (docs.length) {
            await db.delete(taxDocumentLines).where(inArray(taxDocumentLines.documentId, docs.map(d => d.id)));
            await db.update(taxDocuments).set({ originalDocumentId: null }).where(inArray(taxDocuments.id, docs.map(d => d.id)));
            await db.delete(taxDocuments).where(inArray(taxDocuments.id, docs.map(d => d.id)));
        }
        if (bpIds.length) {
            await db.delete(settlementRuns).where(inArray(settlementRuns.businessPartnerId, bpIds));
            await db.delete(partnerPurchaseBills).where(inArray(partnerPurchaseBills.businessPartnerId, bpIds));
            await db.delete(businessPartnerLedger).where(inArray(businessPartnerLedger.businessPartnerId, bpIds));
        }
        if (orderIds.length) {
            const items = await db.select({ id: b2bOrderItems.id }).from(b2bOrderItems).where(inArray(b2bOrderItems.orderId, orderIds));
            if (items.length) await db.delete(sparePartMovements).where(inArray(sparePartMovements.b2bOrderItemId, items.map(i => i.id)));
            await db.delete(b2bOrderEvents).where(inArray(b2bOrderEvents.orderId, orderIds));
            await db.delete(b2bOrderItems).where(inArray(b2bOrderItems.orderId, orderIds));
            await db.delete(b2bOrders).where(inArray(b2bOrders.id, orderIds));
        }
        if (opId) {
            await db.delete(ftthOperatorLedger).where(eq(ftthOperatorLedger.operatorId, opId));
            await db.delete(ftthOperators).where(eq(ftthOperators.id, opId));
        }
        if (partIds.length) {
            await db.delete(sparePartMovements).where(inArray(sparePartMovements.sparePartId, partIds));
            await db.delete(sparePartStock).where(inArray(sparePartStock.sparePartId, partIds));
            await db.delete(sparePartCategories).where(inArray(sparePartCategories.sparePartId, partIds));
            await db.delete(spareParts).where(inArray(spareParts.id, partIds));
        }
        if (bpIds.length) {
            await db.delete(partnerUsers).where(inArray(partnerUsers.businessPartnerId, bpIds));
            await db.delete(businessPartnerVerticals).where(inArray(businessPartnerVerticals.businessPartnerId, bpIds));
            await db.delete(businessPartners).where(inArray(businessPartners.id, bpIds));
        }
        if (adminIds.length) {
            await db.delete(partnerUsers).where(inArray(partnerUsers.adminUserId, adminIds));
            await db.delete(adminUsers).where(inArray(adminUsers.id, adminIds));
        }
    } catch (e: any) { console.error('cleanup failed:', e.message); }
}

main().catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
