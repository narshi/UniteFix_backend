/**
 * Later sections of smoke-hub-extras, added as each feature lands.
 */
import crypto from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { check, db } from './lib/hub-test-kit';
import { partnerPayLinks, partnerInvoicePayments, businessPartnerLedger, eventMilestones, hubAlerts, taxDocumentLines, consultAppointments, employees, serviceRequests, spareParts, sparePartStock, consignmentLots, taxDocuments } from '../shared/schema';
import { SparePartsService } from '../server/services/spare-parts.service';
import { ConsignmentService } from '../server/services/consignment.service';
import { PartnerFieldService, addWorkingTime } from '../server/services/partner-field.service';
import { PaymentService } from '../server/services/payment.service';
import { TaxDocumentService } from '../server/services/tax-documents.service';
import { BusinessPartnerService } from '../server/services/business-partner.service';

type Track = { userIds: number[]; catIds: number[]; svcIds: number[]; extraCleanup: string[]; adminIds: number[] };
const inDays = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
const tokenOf = (url: string) => url.split('/').pop()!;
const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');

export async function runExtras(ctx: Record<string, any>, track: Track) {
    await payLinks(ctx, track);
    await fieldHours(ctx, track);
    await consignment(ctx, track);
    await goLive(ctx);
    await eventsShowcase(ctx);
}

async function payLinks(ctx: Record<string, any>, track: Track) {
    const { api, t, t2, bp, disp } = ctx;
    const cust = await api.post('/api/hub/customers', { name: 'QA Meera Traders', phone: '9876500077', email: 'qa_meera@example.test' }, t);
    const inv = await api.post('/api/hub/invoices', { customerId: cust.body.data.id, lines: [{ description: 'Network setup', hsnSac: '998713', quantity: 1, rateRupees: 5000, gstRate: 18 }] }, t);
    const invId = inv.body.data.id;
    const l1 = await api.post('/api/hub/pay-links', { kind: 'invoice', refId: invId }, t);
    check('pay links: a link for an invoice\'s balance', l1.status === 201 && l1.body.data.amount === 5900 && /^\/pay\/[A-Za-z0-9_-]{20,}$/.test(l1.body.data.url) && l1.body.data.gateway === false, JSON.stringify(l1.body));
    const l1b = await api.post('/api/hub/pay-links', { kind: 'invoice', refId: invId }, t);
    check('pay links: asking again gives the same open link', l1b.body?.data?.id === l1.body.data.id);
    check('pay links: another business cannot make a link for this invoice', (await api.post('/api/hub/pay-links', { kind: 'invoice', refId: invId }, t2)).status === 404);
    check('pay links: a dispatcher cannot make links (sales permission)', (await api.post('/api/hub/pay-links', { kind: 'invoice', refId: invId }, disp)).status === 403);
    check('pay links: not more than is outstanding', (await api.post('/api/hub/pay-links', { kind: 'invoice', refId: invId, amountRupees: 6000 }, t)).status === 400);

    const tok = tokenOf(l1.body.data.url);
    const pv = await api.get(`/api/public/pay/${tok}`);
    check('pay page: shows the business, what it is for and the amount — no login', pv.status === 200 && pv.body.data.business === 'Coastal Partners' && pv.body.data.amount === 5900 && /Invoice/.test(pv.body.data.description) && pv.body.data.status === 'open');
    check('pay page: a made-up token is refused', (await api.get('/api/public/pay/notarealtoken1234567890')).status === 404);
    const noGw = await api.post(`/api/public/pay/${tok}/order`, {});
    check('pay page: without gateway keys it says to pay the business directly', noGw.status === 503 && pv.body.data.gateway === false);

    // The signed callback. Keys are stripped for tests; a throwaway secret signs locally.
    process.env.RAZORPAY_KEY_SECRET = `qa_secret_${Date.now()}`;
    const orderId = `order_QA${Date.now()}`, payId = `pay_QA${Date.now()}`;
    const mo = `order_QAM${Date.now()}`, mp = `pay_QAM${Date.now()}`;
    track.extraCleanup.push(`DELETE FROM payment_transactions WHERE razorpay_order_id IN ('${orderId}', '${mo}', 'order_QAnone')`);
    await db.update(partnerPayLinks).set({ razorpayOrderId: orderId }).where(eq(partnerPayLinks.id, l1.body.data.id));
    check('pay page: a forged signature is refused', (await api.post(`/api/public/pay/${tok}/confirm`, { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: 'f'.repeat(64) })).status === 400);
    const ok = await api.post(`/api/public/pay/${tok}/confirm`, { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign(orderId, payId) });
    check('pay page: a signed payment is accepted', ok.status === 200 && ok.body.data.status === 'paid' && ok.body.data.paymentId === payId, JSON.stringify(ok.body));
    const again = await api.post(`/api/public/pay/${tok}/confirm`, { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: sign(orderId, payId) });
    await PaymentService.handleWebhook('payment.captured', { payment: { entity: { id: payId, order_id: orderId, amount: 590000, method: 'upi', notes: { payment_type: 'partner_collection', pay_link_id: String(l1.body.data.id) } } } });
    const pays = await db.select().from(partnerInvoicePayments).where(eq(partnerInvoicePayments.documentId, invId));
    check('capture is idempotent: callback twice and the webhook record one payment', again.status === 200 && pays.length === 1 && pays[0].method === 'online' && pays[0].reference === payId && pays[0].amountPaise === 590000);
    const invAfter = await api.get(`/api/hub/invoices/${invId}`, t);
    check('the invoice shows paid in full', invAfter.body?.data?.outstanding === 0, JSON.stringify(invAfter.body?.data?.outstanding));
    const led = await db.select().from(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, bp.id));
    const coll = led.filter(l => l.entryType === ('online_collection' as any)), fee = led.filter(l => l.entryType === ('gateway_fee' as any));
    check('ledger: UniteFix owes the partner the amount, less the fee + GST', coll.length === 1 && coll[0].amountPaise === -590000 && fee.length === 1 && fee[0].amountPaise === Math.round(590000 * 0.02) + Math.round(Math.round(590000 * 0.02) * 0.18), JSON.stringify(led.map(l => [l.entryType, l.amountPaise])));
    const al = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'payment_received')));
    check('the business is alerted that it was paid', al.length === 1 && /5,900/.test(al[0].title));
    const list = await api.get('/api/hub/pay-links', t);
    check('the Online payments list shows it paid, with the net', list.body?.data?.links?.[0]?.status === 'paid' && list.body.data.links[0].net === 5900 - (590000 * 0.02 + 590000 * 0.02 * 0.18) / 100 && list.body.data.links[0].customer === 'QA Meera Traders');
    check('pay page after payment: says paid, cannot be paid again', (await api.get(`/api/public/pay/${tok}`)).body.data.status === 'paid' && (await api.post(`/api/public/pay/${tok}/order`, {})).status === 409);

    // A link goes stale when the invoice is paid another way.
    const inv2 = await api.post('/api/hub/invoices', { customerId: cust.body.data.id, lines: [{ description: 'AMC visit', hsnSac: '998713', quantity: 1, rateRupees: 1000, gstRate: 18 }] }, t);
    const l2 = await api.post('/api/hub/pay-links', { kind: 'invoice', refId: inv2.body.data.id }, t);
    await api.post(`/api/hub/invoices/${inv2.body.data.id}/payments`, { amountRupees: 500, method: 'cash', receivedOn: inDays(0) }, t);
    const stale = await api.post(`/api/public/pay/${tokenOf(l2.body.data.url)}/order`, {});
    check('a link is closed if the invoice was part-paid another way since', stale.status === 410 && (await api.get(`/api/public/pay/${tokenOf(l2.body.data.url)}`)).body.data.status === 'cancelled');
    const l2b = await api.post('/api/hub/pay-links', { kind: 'invoice', refId: inv2.body.data.id }, t);
    check('a fresh link is for the balance', l2b.status === 201 && l2b.body.data.amount === 680 && l2b.body.data.id !== l2.body.data.id);
    const cx = await api.post(`/api/hub/pay-links/${l2b.body.data.id}/cancel`, {}, t);
    check('the business can cancel an open link', cx.status === 200 && (await api.post(`/api/public/pay/${tokenOf(l2b.body.data.url)}/order`, {})).status === 410);

    // Event milestone: an advance, paid online → receipt voucher
    const bk = await api.post('/api/hub/events/bookings', { quotationId: ctx.quotationId, eventDate: inDays(20), milestones: [{ label: 'Advance', percent: 30, dueDate: inDays(1) }, { label: 'Balance', percent: 70 }] }, t);
    const [m1] = await db.select().from(eventMilestones).where(eq(eventMilestones.bookingId, bk.body.data.id)).orderBy(eventMilestones.sortOrder).limit(1);
    const ml = await api.post('/api/hub/pay-links', { kind: 'milestone', refId: m1.id }, t);
    check('pay links: a link for an event advance', ml.status === 201 && ml.body.data.amount === m1.amountPaise / 100 && /Advance/.test(ml.body.data.description), JSON.stringify(ml.body));
    await db.update(partnerPayLinks).set({ razorpayOrderId: mo }).where(eq(partnerPayLinks.id, ml.body.data.id));
    await PaymentService.handleWebhook('payment.captured', { payment: { entity: { id: mp, order_id: mo, amount: m1.amountPaise, method: 'card', notes: { payment_type: 'partner_collection', pay_link_id: String(ml.body.data.id) } } } });
    const [m1b] = await db.select().from(eventMilestones).where(eq(eventMilestones.id, m1.id));
    check('the webhook alone settles it: milestone paid online with a GST receipt voucher', m1b.status === 'paid' && m1b.method === 'online' && m1b.reference === mp && !!m1b.receiptDocumentId, JSON.stringify(m1b));
    const short = await PaymentService.handleWebhook('payment.captured', { payment: { entity: { id: 'pay_QAshort', order_id: 'order_QAnone', amount: 100, notes: { payment_type: 'partner_collection', pay_link_id: '0' } } } });
    check('a webhook for an unknown link changes nothing', short.success === true);

    // Consulting: pay before the session
    const appt = await api.post('/api/hub/consulting/appointments', { customerId: cust.body.data.id, serviceId: ctx.consultServiceId, startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 11) + '05:30:00.000Z' }, t);
    const early = await api.post(`/api/hub/consulting/appointments/${appt.body.data.id}/bill`, {}, t);
    const up = await api.post(`/api/hub/consulting/appointments/${appt.body.data.id}/bill`, { upfront: true }, t);
    check('consulting: billing before the session needs "upfront" (for a pay link)', early.status === 409 && up.status === 201, JSON.stringify([early.status, up.body]));
    const cl = await api.post('/api/hub/pay-links', { kind: 'invoice', refId: up.body.data.id }, t);
    const [a] = await db.select().from(consultAppointments).where(eq(consultAppointments.id, appt.body.data.id));
    const cp = await api.get(`/api/public/consult/a/${a.publicToken}`);
    check('the client\'s booking page shows the Pay button', cp.body?.data?.payLink?.url === cl.body.data.url && cp.body.data.payLink.amount === 2360, JSON.stringify(cp.body?.data?.payLink));

    // Monthly UniteFix fee invoice carries the collection fee
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const feeDoc = await TaxDocumentService.issueFeeInvoice(bp.id, new Date(`${month}-01T00:00:00Z`), null);
    const lines = feeDoc ? await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, feeDoc.id)) : [];
    const want = Math.round(590000 * 0.02) + Math.round(m1.amountPaise * 0.02);
    check('UniteFix\'s monthly invoice lists the online collection fee', lines.some(l => /Online payment collection — 2 payments/.test(l.description) && l.taxablePaise === want), JSON.stringify(lines.map(l => [l.description, l.taxablePaise])));
    delete process.env.RAZORPAY_KEY_SECRET;
}

/** IST wall time → Date. */
const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`);

async function fieldHours(ctx: Record<string, any>, track: Track) {
    const { api, t, disp, bp } = ctx;

    // ── the clock itself ──────────────────────────────────────────────
    const monSat = [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '09:00', endTime: '19:00' }));
    const none = { hours: null, holidays: new Set<string>() };
    check('working time: no hours set → plain time', addWorkingTime(ist('2026-10-05', '18:30'), 120, none).getTime() === ist('2026-10-05', '20:30').getTime());
    check('working time: Monday 18:30 + 2 h → Tuesday 10:30 (closed overnight)', addWorkingTime(ist('2026-10-05', '18:30'), 120, { hours: monSat, holidays: new Set() }).getTime() === ist('2026-10-06', '10:30').getTime());
    check('working time: a holiday on Tuesday pushes it to Wednesday 10:30', addWorkingTime(ist('2026-10-05', '18:30'), 120, { hours: monSat, holidays: new Set(['2026-10-06']) }).getTime() === ist('2026-10-07', '10:30').getTime());
    check('working time: booked on Sunday (closed) → Monday 11:00', addWorkingTime(ist('2026-10-04', '12:00'), 120, { hours: monSat, holidays: new Set() }).getTime() === ist('2026-10-05', '11:00').getTime());
    check('working time: round the clock but closed on a holiday', addWorkingTime(ist('2026-10-05', '23:00'), 120, { hours: null, holidays: new Set(['2026-10-06']) }).getTime() === ist('2026-10-07', '01:00').getTime());

    // ── settings ──────────────────────────────────────────────────────
    const st = await api.get('/api/hub/field/settings', t);
    check('field settings: round the clock, auto-assign off by default', st.status === 200 && st.body.data.hours === null && st.body.data.autoAssign === false && st.body.data.autoAssignMinutes === 15);
    check('hours must end after they start', (await api.put('/api/hub/field/settings', { hours: [{ weekday: 1, startTime: '19:00', endTime: '09:00' }] }, t)).status === 400);
    check('a dispatcher cannot change hours', (await api.put('/api/hub/field/settings', { hours: null }, disp)).status === 403);
    check('a holiday cannot be in the past', (await api.post('/api/hub/field/holidays', { day: '2020-01-01' }, t)).status === 400);
    const today = new Date(Date.now() + 330 * 60_000);
    const dayIn = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const h = await api.post('/api/hub/field/holidays', { day: dayIn(1), reason: 'QA festival' }, t);
    check('a holiday is added', h.status === 201 && h.body.data.holidays.some((x: any) => x.day === dayIn(1)));

    // Open only three days from now: a booking now is due that day, not in 2 hours.
    const far = (today.getUTCDay() + 3) % 7;
    const sv = await api.put('/api/hub/field/settings', { hours: [{ weekday: far, startTime: '09:00', endTime: '19:00' }] }, t);
    check('hours saved', sv.status === 200 && sv.body.data.hours.length === 1);
    const bk = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA hours', address: `Road ${ctx.pin}`, pinCode: ctx.pin, catalogServiceId: ctx.svc2.id }, ctx.ct);
    const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, bk.body.data.id));
    const due = sr.slaAssignBy ? new Date(sr.slaAssignBy) : null;
    check('a job booked outside working hours is due 2 working hours after opening', !!due && due.getTime() === ist(dayIn(3), '11:00').getTime(), `${due?.toISOString()} vs ${ist(dayIn(3), '11:00').toISOString()}`);
    await api.put('/api/hub/field/settings', { hours: null }, t);

    // ── auto-assign ───────────────────────────────────────────────────
    const tech = await api.post('/api/hub/field/technicians', { fullName: 'QA Auto Tech', phone: `9${String(Date.now()).slice(-9)}`, services: ['CCTV'] }, t);
    const [emp] = await db.select().from(employees).where(eq(employees.id, tech.body.data.id));
    track.userIds.push(emp.userId!);
    ctx.tech = emp;
    await db.update(employees).set({ documentVerificationStatus: 'verified' as any, isActive: true }).where(eq(employees.id, emp.id));
    const jobs = [ctx.job.id, sr.id];
    check('auto-assign is off: nothing happens', (await PartnerFieldService.autoAssignDue()).every(d => !jobs.includes(d.serviceRequestId)));
    await api.put('/api/hub/field/settings', { autoAssign: true, autoAssignMinutes: 60 }, t);
    check('inside the window the partner can still pick by hand', (await PartnerFieldService.autoAssignDue()).every(d => !jobs.includes(d.serviceRequestId)));
    await api.put('/api/hub/field/settings', { autoAssignMinutes: 0 }, t);
    check('only a technician with the right trade is chosen (CCTV ≠ laptop)', (await PartnerFieldService.autoAssignDue()).every(d => !jobs.includes(d.serviceRequestId)));
    await db.update(employees).set({ services: ['Laptop'] }).where(eq(employees.id, emp.id));
    const aa = await PartnerFieldService.autoAssignDue();
    const after = await db.select().from(serviceRequests).where(inArray(serviceRequests.id, jobs));
    check('past the window: assigned to the matching technician', jobs.every(id => aa.some(d => d.serviceRequestId === id)) && after.every(r => r.providerId === emp.id && r.status === 'assigned'), JSON.stringify(after.map(r => [r.id, r.providerId, r.status])));
    const al = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, bp.id), eq(hubAlerts.kind, 'job_assigned')));
    check('the partner is told, and it never runs twice', al.length === 2 && (await PartnerFieldService.autoAssignDue()).length === 0);
    await api.put('/api/hub/field/settings', { autoAssign: false }, t);
}

async function consignment(ctx: Record<string, any>, track: Track) {
    const { api, t, disp, bp, staff, sa } = ctx;
    const stamp = Date.now().toString(36).toUpperCase();
    const [part] = await db.insert(spareParts).values({ partCode: `QA-CONS-${stamp}`, name: `QA Capacitor ${stamp}`, unit: 'piece', unitPricePaise: 15000, tradePricePaise: 10000, gstPercent: '18', hsnCode: '8532', status: 'active' as any, isActive: true }).returning();
    track.extraCleanup.push(
        `DELETE FROM consignment_draws WHERE spare_part_id = ${part.id}`,
        `DELETE FROM consignment_lots WHERE spare_part_id = ${part.id}`,
        `DELETE FROM spare_part_movements WHERE spare_part_id = ${part.id}`,
        `DELETE FROM spare_part_stock WHERE spare_part_id = ${part.id}`,
        `DELETE FROM audit_logs WHERE entity_type = 'spare_part' AND entity_id = ${part.id}`,
        `DELETE FROM spare_parts WHERE id = ${part.id}`,
    );
    check('consignment: a price at or above UniteFix\'s trade price is refused', (await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 10, unitPayoutRupees: 100 }, t)).body?.code === 'PRICE_TOO_HIGH');
    check('consignment: a dispatcher cannot offer stock', (await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 10, unitPayoutRupees: 60 }, disp)).status === 403);
    const o1 = await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 10, unitPayoutRupees: 60, notes: 'Box of 10' }, t);
    check('consignment: the partner offers 10 at ₹60', o1.status === 201 && o1.body.data.status === 'proposed');
    // UniteFix also holds 5 of its own.
    await SparePartsService.receivePurchase({ sparePartId: part.id, quantity: 5, unitCostPaise: 7000, adminId: sa.id, notes: 'QA own stock' });
    const rc = await api.post(`/api/admin/hub/consignment/${o1.body.data.id}/receive`, { quantity: 8 }, staff);
    const wh = async () => (await db.select().from(sparePartStock).where(and(eq(sparePartStock.sparePartId, part.id), eq(sparePartStock.location, 'warehouse' as any))))[0]?.quantity;
    check('staff receive 8 of the 10 into the warehouse', rc.status === 200 && rc.body.data.received === 8 && (await wh()) === 13);
    const bal0 = await BusinessPartnerService.balancePaise(bp.id);
    await SparePartsService.issueToTechnician({ sparePartId: part.id, quantity: 3, employeeId: ctx.tech.id, adminId: sa.id });
    check('3 issued to a technician come from consignment: the partner is credited 3 × ₹60', (await BusinessPartnerService.balancePaise(bp.id)) - bal0 === -18000);
    await SparePartsService.issueToTechnician({ sparePartId: part.id, quantity: 7, employeeId: ctx.tech.id, adminId: sa.id });
    const [lot] = await db.select().from(consignmentLots).where(eq(consignmentLots.id, o1.body.data.id));
    check('7 more: the 5 consigned left go first, then UniteFix\'s own — the partner is paid for 8 in all', lot.quantitySold === 8 && (await BusinessPartnerService.balancePaise(bp.id)) - bal0 === -48000 && (await wh()) === 3, JSON.stringify([lot.quantitySold, (await BusinessPartnerService.balancePaise(bp.id)) - bal0]));
    const mine = await api.get('/api/hub/consignment', t);
    check('the partner sees the lot sold out and 30-day sales', mine.body?.data?.lots?.[0]?.sold === 8 && mine.body.data.lots[0].inStock === 0 && mine.body.data.last30.units === 8 && mine.body.data.last30.payout === 480);
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const doc = await ConsignmentService.issueMonthlyInvoice(bp.id, new Date(`${month}-01T00:00:00Z`));
    const lines = doc ? await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, doc.id)) : [];
    check('month end: the partner\'s invoice to UniteFix for 8 units, with its HSN and GST', !!doc && doc.purpose === 'consignment' && doc.issuerPartnerId === bp.id && lines.length === 1 && Number(lines[0].quantity) === 8 && lines[0].hsnSac === '8532' && Number(lines[0].gstRate) === 18, JSON.stringify(lines.map(l => [l.quantity, l.hsnSac, l.gstRate])));
    check('…its GST is credited to the partner, and it is issued once', (await BusinessPartnerService.balancePaise(bp.id)) - bal0 === -48000 - 8640 && (await ConsignmentService.issueMonthlyInvoice(bp.id, new Date(`${month}-01T00:00:00Z`))) === null);
    const sales = await api.get('/api/hub/invoices', t);
    check('it is not mixed into the partner\'s own sales invoices', !(sales.body?.data ?? []).some((r: any) => r.number === doc?.number));
    // A second lot goes back unsold; a third is rejected; a fourth withdrawn.
    const o2 = await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 4, unitPayoutRupees: 55 }, t);
    await api.post(`/api/admin/hub/consignment/${o2.body.data.id}/receive`, { quantity: 4 }, staff);
    const bal1 = await BusinessPartnerService.balancePaise(bp.id);
    const rt = await api.post(`/api/admin/hub/consignment/${o2.body.data.id}/return`, {}, staff);
    check('unsold stock goes back: lot closed, warehouse down 4, partner not paid for it', rt.status === 200 && rt.body.data.status === 'closed' && rt.body.data.returned === 4 && (await wh()) === 3 && (await BusinessPartnerService.balancePaise(bp.id)) === bal1);
    const o3 = await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 2, unitPayoutRupees: 50 }, t);
    check('staff reject an offer with a reason', (await api.post(`/api/admin/hub/consignment/${o3.body.data.id}/reject`, { note: 'Not needed now' }, staff)).body?.data?.status === 'rejected');
    const o4 = await api.post('/api/hub/consignment', { sparePartId: part.id, quantity: 2, unitPayoutRupees: 50 }, t);
    check('the partner withdraws an offer not yet received', (await api.post(`/api/hub/consignment/${o4.body.data.id}/withdraw`, {}, t)).body?.data?.status === 'withdrawn' && (await api.post(`/api/hub/consignment/${o1.body.data.id}/withdraw`, {}, t)).status === 409);
}

async function goLive(ctx: Record<string, any>) {
    const { api, staff, t } = ctx;
    const g = await api.get('/api/admin/hub/go-live', staff);
    const keys = (g.body?.data?.checks ?? []).map((c: any) => c.key);
    check('go-live: staff see every check', g.status === 200 && ['gstin', 'razorpay', 'razorpay_webhook', 'cashfree_payouts', 'smtp', 'sms', 'courier', 'weak_passwords', 'parts_hsn'].every(k => keys.includes(k)), keys.join(','));
    check('go-live: missing keys are flagged (the test server has no Razorpay or SMTP)', g.body.data.checks.find((c: any) => c.key === 'razorpay')?.status === 'action' && g.body.data.checks.find((c: any) => c.key === 'smtp')?.status === 'action');
    const raw = JSON.stringify(g.body);
    check('go-live: no secret value is ever returned', !!process.env.JWT_SECRET && !raw.includes(process.env.JWT_SECRET) && (!process.env.DATABASE_URL || !raw.includes(process.env.DATABASE_URL)));
    check('go-live: partners cannot see it', [401, 403].includes((await api.get('/api/admin/hub/go-live', t)).status));
}

// A 1×1 PNG — the test server has no Cloudinary, so uploads come back as data URIs.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photoForm = (extra: Record<string, string> = {}) => { const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'work.png'); Object.entries(extra).forEach(([k, v]) => fd.append(k, v)); return fd; };

async function eventsShowcase(ctx: Record<string, any>) {
    const { api, t, t2, bp } = ctx;
    // ── the page profile ──
    const pr = await api.put('/api/hub/events/showcase', { tagline: 'Birthdays and weddings across the coast', about: 'Ten years of happy events.', instagram: '@coastal.events' }, t);
    check('events page: tagline, about and Instagram handle (the @ is dropped)', pr.status === 200 && pr.body.data.instagram === 'coastal.events');
    check('events page: a made-up handle is refused', (await api.put('/api/hub/events/showcase', { instagram: 'not a handle!' }, t)).status === 400);
    const cover = await api.upload('/api/hub/events/showcase/cover', photoForm(), t);
    check('events page: a cover photo uploads', cover.status === 200 && /^data:image\//.test(cover.body.data.coverPhoto ?? ''));

    // ── the gallery: Instagram posts and photos ──
    const ig = await api.post('/api/hub/events/gallery', { kind: 'instagram', url: 'https://www.instagram.com/reel/Cx1Y2z3AbC/?igsh=abc123' }, t);
    check('gallery: an Instagram reel link is stored in its clean form with an embed', ig.status === 201 && ig.body.data.url === 'https://www.instagram.com/reel/Cx1Y2z3AbC/' && ig.body.data.embed === 'https://www.instagram.com/reel/Cx1Y2z3AbC/embed/captioned/');
    check('gallery: the same post twice is refused', (await api.post('/api/hub/events/gallery', { kind: 'instagram', url: 'https://instagram.com/reel/Cx1Y2z3AbC' }, t)).status === 409);
    check('gallery: a link that is not an Instagram post is refused', (await api.post('/api/hub/events/gallery', { kind: 'instagram', url: 'https://example.com/p/ABC123/' }, t)).status === 400);
    const ph = await api.upload('/api/hub/events/gallery/upload', photoForm({ caption: 'Ananya turns 5' }), t);
    check('gallery: a photo of past work uploads', ph.status === 201 && ph.body.data.kind === 'photo' && ph.body.data.caption === 'Ananya turns 5');

    // ── themes ──
    const th = await api.post('/api/hub/events/themes', { name: 'Jungle safari', suitableFor: "Kids' birthdays", description: 'Balloon arch, animal cut-outs, name board', priceRupees: 4000 }, t);
    const thp = await api.upload(`/api/hub/events/themes/${th.body.data.id}/photos`, photoForm(), t);
    check('themes: a theme with a price and photos', th.status === 201 && thp.status === 200 && thp.body.data.photos.length === 1);
    check('themes: another partner cannot edit it', (await api.patch(`/api/hub/events/themes/${th.body.data.id}`, { priceRupees: 1 }, t2)).status === 404);
    await api.patch(`/api/hub/events/gallery/${ph.body.data.id}`, { themeId: th.body.data.id }, t);

    // ── venues and add-ons (packages) ──
    const mk = async (b: any) => (await api.post('/api/hub/events/packages', b, t)).body.data;
    const lawn = await mk({ name: 'Garden lawn', category: 'venue', unit: 'event', priceRupees: 25000, capacity: 150, sac: '998596', gstRate: 18 });
    const photo = await mk({ name: 'Photography', category: 'photography', unit: 'event', priceRupees: 8000, description: 'Candid + 200 edited photos', sac: '998596', gstRate: 18 });
    const cake = await mk({ name: 'Designer cake (2 kg)', category: 'cake', unit: 'piece', priceRupees: 1200, maxQty: 3, sac: '998596', gstRate: 18 });
    const food = await mk({ name: 'Veg buffet', category: 'catering', unit: 'plate', priceRupees: 350, sac: '996337', gstRate: 5 });
    const hidden = await mk({ name: 'Bouncy castle (on request)', category: 'other', unit: 'event', priceRupees: 3000, showOnPage: false, sac: '998596', gstRate: 18 });
    const lp = await api.upload(`/api/hub/events/packages/${lawn.id}/photos`, photoForm(), t);
    check('venues: capacity and photos', lawn.capacity === 150 && lp.status === 200 && lp.body.data.photos.length === 1);

    // ── what the public sees ──
    const pub = await api.get(`/api/public/events/${bp.partnerCode}/showcase`);
    const d = pub.body?.data;
    check('public page: profile, gallery with the Instagram embed, venues, themes, add-ons',
        pub.status === 200 && d.profile.instagram === 'coastal.events' && d.gallery.some((g: any) => g.embed?.includes('/embed/')) && d.venues.some((v: any) => v.id === lawn.id && v.capacity === 150 && v.photos.length === 1)
        && d.themes.some((x: any) => x.name === 'Jungle safari') && d.addons.some((a: any) => a.id === cake.id && a.maxQty === 3) && d.addons.some((a: any) => a.id === photo.id));
    check('public page: an add-on hidden from the page is not shown, and not orderable', !d.addons.some((a: any) => a.id === hidden.id)
        && (await api.post(`/api/public/events/${bp.partnerCode}/estimate`, { addons: [{ packageId: hidden.id }] })).body?.code === 'NO_ADDON');
    check('public page: an unknown partner code is not found', (await api.get('/api/public/events/NOPE-0000/showcase')).status === 404);

    // ── building the event ──
    const sel = { guests: 100, venueId: lawn.id, themeId: th.body.data.id, addons: [{ packageId: photo.id }, { packageId: cake.id, quantity: 2 }, { packageId: food.id }] };
    const est = await api.post(`/api/public/events/${bp.partnerCode}/estimate`, sel);
    // 25,000 + 4,000 + 8,000 + 2 × 1,200 at 18%, and 100 × 350 catering at 5%
    check('estimate: venue + theme + photography + 2 cakes + catering for 100 guests, each at its GST rate', est.status === 200 && est.body.data.taxable === 74400 && est.body.data.gst === 8842 && est.body.data.total === 83242, JSON.stringify(est.body?.data && { t: est.body.data.taxable, g: est.body.data.gst }));
    check('estimate: more guests than the venue holds is refused', (await api.post(`/api/public/events/${bp.partnerCode}/estimate`, { ...sel, guests: 200 })).body?.code === 'TOO_MANY_GUESTS');
    check('estimate: more cakes than offered is refused', (await api.post(`/api/public/events/${bp.partnerCode}/estimate`, { ...sel, addons: [{ packageId: cake.id, quantity: 4 }] })).body?.code === 'BAD_QTY');
    check('estimate: catering needs the guest count', (await api.post(`/api/public/events/${bp.partnerCode}/estimate`, { addons: [{ packageId: food.id }] })).body?.code === 'NO_GUESTS');

    const day = new Date(Date.now() + 330 * 60_000 + 40 * 86_400_000).toISOString().slice(0, 10);
    const req = await api.post(`/api/public/events/${bp.partnerCode}/request`, { ...sel, name: 'QA Kavya', phone: '9876500123', eventType: '5th birthday', eventDate: day, customization: 'Name board: Ananya. Green and gold.' });
    check('request: sent — the client gets a link and their estimate', req.status === 201 && /^\/events\/e\//.test(req.body.data.link) && req.body.data.estimate.total === 83242, JSON.stringify(req.body));
    const enq = (await api.get('/api/hub/events/enquiries', t)).body.data.find((e: any) => e.eventType === '5th birthday');
    check('the partner sees what was built: items, their touches and the estimate', !!enq?.selection && enq.selection.items.length === 5 && enq.selection.customization?.includes('Ananya') && enq.selection.estimate.total === 83242 && enq.venue === 'Garden lawn');
    const qs = (await api.get('/api/hub/quotations?source=events', t)).body.data ?? [];
    const draft = qs.find((q: any) => q.customerName === 'QA Kavya' && q.status === 'draft');
    check('a quotation of exactly that is drafted (not yet sent)', !!draft && draft.status === 'draft' && Math.round(Number(draft.total)) === 83242, JSON.stringify(draft && { s: draft.status, t: draft.total }));
    const status = await api.get(`/api/public${req.body.data.link}`);
    check('the client\'s status page shows what they asked for; the quotation appears once sent', status.body?.data?.selection?.estimate?.total === 83242 && status.body.data.quotation === null);
    if (draft) await api.post(`/api/hub/events/quotations/${draft.id}/share`, {}, t);
    const status2 = await api.get(`/api/public${req.body.data.link}`);
    check('…and once the partner sends it, the client can open it', /^\/events\/q\//.test(status2.body?.data?.quotation ?? ''));
    check('requests need a date', (await api.post(`/api/public/events/${bp.partnerCode}/request`, { ...sel, name: 'QA X', phone: '9876500124', eventType: 'Party' })).body?.code === 'NO_DATE');
}
