/**
 * Partner Hub — phase 6 end to end: events — packages, enquiries from the
 * Hub / public page / UniteFix app, versioned quotations accepted by link,
 * bookings with advances (receipt vouchers), vendors and payables, the final
 * invoice adjusting advances, cancellation with a refund voucher, GST desk.
 *
 *   npm run smoke:hub-p6
 */

import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, users, taxDocuments, taxDocumentLines, partnerPurchaseBills, eventEnquiries } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [];
const bpIds: number[] = [];
const userIds: number[] = [];
const inDays = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const ev = await BusinessPartnerService.create({
            legalName: `QA Utsav Events ${stamp}`, displayName: 'Utsav Events', gstin: await gstinFor('29', 'QAUTS1234K'), contactPhone: `7${String(Date.now()).slice(-9)}`,
            contactEmail: `qa_p6_${stamp}@example.test`, verticalCodes: ['events'], approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada',
        });
        const other = await BusinessPartnerService.create({
            legalName: `QA Advisor ${stamp}`, contactPhone: `6${String(Date.now()).slice(-9)}`, contactEmail: `qa_p6b_${stamp}@example.test`, verticalCodes: ['consultation'], approvedByAdminId: sa.id, pincode: '581301',
        });
        bpIds.push(ev.id, other.id);
        await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka', hubPlan: 'pro' }).where(eq(businessPartners.id, ev.id));
        const l1 = await PartnerHubService.createOwnerLogin(ev.id, {});
        const l2 = await PartnerHubService.createOwnerLogin(other.id, {});
        for (const e of [l1.username, l2.username]) { const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, e)); if (r) adminIds.push(r.id); }
        const t1 = (await api.login(l1.username, l1.temporaryPassword))!;
        const t2 = (await api.login(l2.username, l2.temporaryPassword))!;
        check('a partner without events cannot use it', (await api.get('/api/hub/events/packages', t2)).status === 403);

        // ── packages ──────────────────────────────────────────────────────
        const bad = await api.post('/api/hub/events/packages', { name: 'Hall', category: 'venue', priceRupees: 50000, sac: '9403' }, t1);
        check('a goods HSN is refused for an event package', bad.status === 400 && bad.body?.code === 'BAD_SAC');
        const venue = await api.post('/api/hub/events/packages', { name: 'Banquet hall', category: 'venue', unit: 'event', priceRupees: 50000 }, t1);
        const food = await api.post('/api/hub/events/packages', { name: 'Veg buffet', category: 'catering', unit: 'plate', priceRupees: 450, sac: '996337', gstRate: 5 }, t1);
        const decor = await api.post('/api/hub/events/packages', { name: 'Floral décor', category: 'decor', unit: 'event', priceRupees: 30000 }, t1);
        check('packages for venue (18%), catering per plate (5%) and décor', venue.status === 201 && food.body?.data?.gstRate === 5 && decor.status === 201);

        // ── the channel: public page and the app ──────────────────────────
        const pub = await api.get(`/api/public/events/${ev.partnerCode}`);
        check('the public page shows the packages', pub.status === 200 && pub.body?.data?.packages?.length === 3);
        check('no events page for a partner without events', (await api.get(`/api/public/events/${other.partnerCode}`)).status === 404);
        const pe = await api.post(`/api/public/events/${ev.partnerCode}/enquire`, { name: 'QA Kavya', phone: '9876500011', eventType: 'Wedding reception', eventDate: inDays(40), guests: 200, venue: 'Karwar', budgetRupees: 250000 });
        check('anyone can enquire from the public page', pe.status === 201 && /\/events\/e\//.test(pe.body?.data?.link ?? ''));
        const near = await api.get('/api/events/partners?pincode=581401');
        check('the app lists events planners near a pincode (and only events partners)', near.status === 200 && near.body?.data?.some((p: any) => p.id === ev.id) && !near.body.data.some((p: any) => p.id === other.id), JSON.stringify(near.body?.data?.map((p: any) => p.name)));
        const [cu] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA App Customer', role: 'user', homeAddress: 'Sirsi', pinCode: '581401' } as any).returning();
        userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        const ae = await api.post('/api/events/enquiries', { partnerId: ev.id, eventType: 'Birthday party', eventDate: inDays(20), guests: 60 }, ct);
        check('a UniteFix app customer sends an enquiry', ae.status === 201, ae.body?.message);
        const ae2 = await api.post('/api/events/enquiries', { partnerId: ev.id, eventType: 'Birthday party', eventDate: inDays(20), guests: 60 }, ct);
        check('a second one within minutes is held back', ae2.status === 429);
        const past = await api.post('/api/hub/events/enquiries', { name: 'X', phone: '9000000001', eventType: 'Party', eventDate: '2020-01-01' }, t1);
        check('an enquiry for a past date is refused', past.status === 400 && past.body?.code === 'PAST_DATE');
        const enq = await api.get('/api/hub/events/enquiries', t1);
        check('the partner sees enquiries from the page and the app', enq.body?.data?.length === 2 && enq.body.data.some((e: any) => e.source === 'app') && enq.body.data.some((e: any) => e.source === 'public'));
        const wedding = enq.body.data.find((e: any) => e.source === 'public');

        // ── quotation from packages, revised, accepted by link ────────────
        const q = await api.post(`/api/hub/events/enquiries/${wedding.id}/quote`, { packages: [{ packageId: venue.body.data.id, quantity: 1 }, { packageId: food.body.data.id, quantity: 200 }, { packageId: decor.body.data.id, quantity: 1 }] }, t1);
        check('a quotation from packages: ₹1,70,000 + ₹18,900 GST (mixed 18% and 5%)', q.status === 201 && q.body?.data?.total === 188900, JSON.stringify(q.body?.data));
        const sh = await api.post(`/api/hub/events/quotations/${q.body.data.id}/share`, {}, t1);
        const link1 = sh.body?.data?.link as string;
        check('sharing gives the client a link and marks it sent', sh.status === 200 && /\/events\/q\//.test(link1) && sh.body.data.status === 'sent');
        const rev = await api.put(`/api/hub/quotations/${q.body.data.id}`, { lines: [
            { description: 'Banquet hall', hsnSac: '998596', quantity: 1, rateRupees: 45000, gstRate: 18 },
            { description: 'Veg buffet', hsnSac: '996337', quantity: 200, rateRupees: 450, gstRate: 5 },
            { description: 'Floral décor', hsnSac: '998596', quantity: 1, rateRupees: 30000, gstRate: 18 },
        ] }, t1);
        check('the partner revises it (a sent quotation becomes version 2)', rev.status === 200 && rev.body?.data?.version === 2);
        const old = await api.get(`/api/public${link1}`);
        check('the client\'s old link shows the latest version', old.status === 200 && old.body?.data?.replaced === true && old.body.data.version === 2 && old.body.data.total === 183000, JSON.stringify({ v: old.body?.data?.version, t: old.body?.data?.total }));
        const tokenV2 = old.body.data.token;
        const qpdf = await fetch(`${base}/api/public/events/q/${tokenV2}/pdf`);
        check('the client can download the quotation PDF', qpdf.status === 200 && Buffer.from(await qpdf.arrayBuffer()).subarray(0, 4).toString() === '%PDF');
        const oldAccept = await api.post(`/api/public${link1}/respond`, { decision: 'accept' });
        check('the superseded version cannot be accepted', oldAccept.status === 409);
        const acc = await api.post(`/api/public/events/q/${tokenV2}/respond`, { decision: 'accept', note: 'Looks good' });
        check('the client accepts version 2 by link', acc.status === 200);
        check('…once', (await api.post(`/api/public/events/q/${tokenV2}/respond`, { decision: 'decline' })).status === 409);

        // ── booking and the advance ───────────────────────────────────────
        const bk = await api.post('/api/hub/events/bookings', { quotationId: rev.body.data.id, title: 'Kavya wedding reception' }, t1);
        check('the accepted quotation becomes a booking', bk.status === 201, bk.body?.message);
        const [wonEnq] = await db.select().from(eventEnquiries).where(eq(eventEnquiries.id, wedding.id));
        check('…and the enquiry is won', wonEnq.status === 'won');
        check('a quotation is booked once', (await api.post('/api/hub/events/bookings', { quotationId: rev.body.data.id }, t1)).status === 409);
        const d1 = await api.get(`/api/hub/events/bookings/${bk.body.data.id}`, t1);
        const ms = d1.body?.data?.milestones ?? [];
        check('default plan: 30% advance + 70% balance, summing to the quote exactly', ms.length === 2 && Math.round((ms[0].amount + ms[1].amount) * 100) === 183000_00 && ms[0].amount === 54900, JSON.stringify(ms.map((m: any) => m.amount)));
        const payA = await api.post(`/api/hub/events/milestones/${ms[0].id}/pay`, { method: 'upi', reference: 'UPI-ADV-1' }, t1);
        check('the advance is recorded with a GST receipt voucher', payA.status === 200 && payA.body?.data?.voucher?.docKind === 'receipt_voucher' && /\/R\d{4}$/.test(payA.body.data.voucher.number), payA.body?.message);
        const rv = payA.body.data.voucher;
        const rvLines = await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, rv.id));
        check('the voucher totals the advance, tax carved out at each rate in proportion', Math.round(rv.total * 100) === 54900_00 && rvLines.length === 2 && rvLines.some(l => Number(l.gstRate) === 5) && rvLines.some(l => Number(l.gstRate) === 18));
        const rvPdf = await fetch(`${base}/api/hub/tax-documents/${rv.id}/pdf`, { headers: { Authorization: `Bearer ${t1}` } });
        check('the receipt voucher prints', rvPdf.status === 200);
        check('paying the same milestone twice is refused', (await api.post(`/api/hub/events/milestones/${ms[0].id}/pay`, { method: 'cash' }, t1)).status === 409);

        // ── vendors ───────────────────────────────────────────────────────
        const vNo = await api.post('/api/hub/events/vendors', { name: 'QA Flower Mart', category: 'decor' }, t1);
        const vG = await api.post('/api/hub/events/vendors', { name: 'QA Sound Co', category: 'av', gstin: await gstinFor('29', 'QASND1234K') }, t1);
        const noG = await api.post(`/api/hub/events/bookings/${bk.body.data.id}/costs`, { vendorId: vNo.body.data.id, description: 'Flowers', taxableRupees: 8000, gstRupees: 1440 }, t1);
        check('an unregistered vendor cannot charge GST', noG.status === 400 && noG.body?.code === 'NO_GSTIN');
        await api.post(`/api/hub/events/bookings/${bk.body.data.id}/costs`, { vendorId: vNo.body.data.id, description: 'Flowers', taxableRupees: 8000 }, t1);
        const cost = await api.post(`/api/hub/events/bookings/${bk.body.data.id}/costs`, { vendorId: vG.body.data.id, description: 'PA system', taxableRupees: 12000, gstRupees: 2160 }, t1);
        const pay0 = await api.post(`/api/hub/events/costs/${cost.body.data.id}/pay`, {}, t1);
        check('paying a GST vendor needs their bill number', pay0.status === 400 && pay0.body?.code === 'NO_BILL');
        const pay1 = await api.post(`/api/hub/events/costs/${cost.body.data.id}/pay`, { billNumber: 'SC-881', reference: 'NEFT1' }, t1);
        const [pb] = await db.select().from(partnerPurchaseBills).where(and(eq(partnerPurchaseBills.businessPartnerId, ev.id), eq(partnerPurchaseBills.billNumber, 'SC-881')));
        check('…and then the bill joins the purchase register (CGST + SGST)', pay1.status === 200 && !!pb && pb.cgstPaise + pb.sgstPaise === 2160_00);
        const payables = await api.get('/api/hub/events/payables', t1);
        check('unpaid vendor costs show as payables', payables.body?.data?.length === 1 && payables.body.data[0].vendorName === 'QA Flower Mart');
        const d2 = await api.get(`/api/hub/events/bookings/${bk.body.data.id}`, t1);
        check('the booking shows its margin before GST (₹1,65,000 − ₹20,000 vendor costs)', d2.body?.data?.margin === 145000, String(d2.body?.data?.margin));

        // ── event day ─────────────────────────────────────────────────────
        const cl = await api.patch(`/api/hub/events/bookings/${bk.body.data.id}`, { checklist: [{ text: 'Stage ready by 5pm', done: true }], staff: [{ name: 'Ravi', role: 'Coordinator', phone: '9000011111' }] }, t1);
        check('checklist and staff are saved on the booking', cl.status === 200);
        check('it cannot be marked completed before the day', (await api.patch(`/api/hub/events/bookings/${bk.body.data.id}`, { status: 'completed' }, t1)).status === 409);

        // ── final invoice adjusts the advance ─────────────────────────────
        const fin = await api.post(`/api/hub/events/bookings/${bk.body.data.id}/final-invoice`, {}, t1);
        check('the final tax invoice is issued for the quotation', fin.status === 201 && fin.body?.data?.total === 183000, fin.body?.message);
        const inv = await api.get(`/api/hub/invoices/${fin.body.data.id}`, t1);
        check('…with the advance counted as paid (balance ₹1,28,100)', inv.body?.data?.paid === 54900 && inv.body?.data?.outstanding === 128100, JSON.stringify({ p: inv.body?.data?.paid, o: inv.body?.data?.outstanding }));
        const [rvRow] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, rv.id));
        check('…and the receipt voucher linked to it', rvRow.originalDocumentId === fin.body.data.id);
        check('a second final invoice is refused', (await api.post(`/api/hub/events/bookings/${bk.body.data.id}/final-invoice`, {}, t1)).status === 409);
        const payB = await api.post(`/api/hub/events/milestones/${ms[1].id}/pay`, { method: 'bank', reference: 'NEFT-BAL' }, t1);
        const inv2 = await api.get(`/api/hub/invoices/${fin.body.data.id}`, t1);
        check('the balance after the invoice is a payment on it, not another voucher', payB.status === 200 && payB.body?.data?.voucher === null && inv2.body?.data?.outstanding === 0);
        check('vouchers do not appear as invoices in Sales', !((await api.get('/api/hub/invoices', t1)).body?.data ?? []).some((d: any) => d.docKind === 'receipt_voucher'));

        // ── GST desk ──────────────────────────────────────────────────────
        const period = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
        const sum = await api.get(`/api/hub/gst/summary?period=${period}`, t1);
        const finDoc = (await db.select().from(taxDocuments).where(eq(taxDocuments.id, fin.body.data.id)))[0];
        const finTax = (finDoc.cgstPaise + finDoc.sgstPaise + finDoc.igstPaise) / 100;
        const outTax = sum.body?.data?.output ? sum.body.data.output.cgst + sum.body.data.output.sgst + sum.body.data.output.igst : NaN;
        check('summary: advance tax added on receipt and adjusted on invoice — output equals the invoice\'s tax', Math.abs(outTax - finTax) < 0.02, `${outTax} vs ${finTax}`);
        const g = await api.get(`/api/hub/gst/gstr1.json?period=${period}`, t1);
        check('GSTR-1 has Table 11A (advances) and 11B (adjusted)', !!g.body?.at?.length && !!g.body?.txpd?.length && g.body.at[0].itms.some((i: any) => i.rt === 5));
        check('…and receipt vouchers in Table 13', g.body?.doc_issue?.doc_det?.some((d: any) => d.doc_num === 6));
        const pur = await api.get(`/api/hub/gst/summary?period=${period}`, t1);
        check('the vendor bill\'s GST is input tax', (pur.body?.data?.input?.cgst ?? 0) + (pur.body?.data?.input?.sgst ?? 0) >= 2160);

        // ── cancellation with a refund ────────────────────────────────────
        const party = enq.body.data.find((e: any) => e.source === 'app');
        const q2 = await api.post(`/api/hub/events/enquiries/${party.id}/quote`, { packages: [{ packageId: decor.body.data.id, quantity: 1 }] }, t1);
        await api.post(`/api/hub/events/quotations/${q2.body.data.id}/share`, {}, t1);
        await api.post(`/api/hub/quotations/${q2.body.data.id}/status`, { status: 'accepted' }, t1);
        const bk2 = await api.post('/api/hub/events/bookings', { quotationId: q2.body.data.id, milestones: [{ label: 'Advance', amountRupees: 10000 }, { label: 'Balance', amountRupees: 25400 }] }, t1);
        check('a custom payment plan must add up to the quotation', bk2.status === 201);
        const bad2 = await api.post('/api/hub/events/bookings', { quotationId: q2.body.data.id, milestones: [{ label: 'x', amountRupees: 1 }] }, t1);
        check('…or it is refused', bad2.status === 409 || bad2.status === 400);
        const d3 = await api.get(`/api/hub/events/bookings/${bk2.body.data.id}`, t1);
        await api.post(`/api/hub/events/milestones/${d3.body.data.milestones[0].id}/pay`, { method: 'cash' }, t1);
        const over = await api.post(`/api/hub/events/bookings/${bk2.body.data.id}/cancel`, { reason: 'Client cancelled', refundRupees: 20000 }, t1);
        check('a refund cannot exceed the advance received', over.status === 400 && over.body?.code === 'OVER_REFUND');
        const cx = await api.post(`/api/hub/events/bookings/${bk2.body.data.id}/cancel`, { reason: 'Client cancelled', refundRupees: 6000 }, t1);
        check('cancelling with a partial refund issues a refund voucher; the rest is kept', cx.status === 200 && cx.body?.data?.voucher?.docKind === 'refund_voucher' && cx.body.data.kept === 4000, cx.body?.message);
        const my = await api.get('/api/events/my-enquiries', ct);
        check('the app customer sees their enquiry, now won, with the quotation link', my.status === 200 && my.body?.data?.[0]?.status === 'won' && my.body.data[0].quotation?.status === 'accepted' && (my.body.data[0].quotation?.link ?? '').startsWith('/events/q/'), JSON.stringify(my.body?.data?.[0]));
        const status = await api.get(`/api/public${pe.body.data.link}`);
        check('the public enquirer\'s status page links the quotation', status.status === 200 && /\/events\/q\//.test(status.body?.data?.quotation ?? ''));
        const home = await api.get('/api/hub/summary', t1);
        check('home shows events', JSON.stringify(home.body?.data ?? {}).includes('Upcoming events'));
    } finally {
        const bp = bpIds.join(',') || '0';
        await cleanupPartners(bpIds, adminIds, [
            `DELETE FROM event_vendor_costs WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
            `DELETE FROM event_milestones WHERE booking_id IN (SELECT id FROM event_bookings WHERE business_partner_id IN (${bp}))`,
            `DELETE FROM event_bookings WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_enquiries WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_vendors WHERE business_partner_id IN (${bp})`,
            `DELETE FROM event_packages WHERE business_partner_id IN (${bp})`,
            `DELETE FROM users WHERE id IN (${userIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(async (e) => { console.error(e); await cleanupPartners(bpIds, adminIds); process.exit(1); });
