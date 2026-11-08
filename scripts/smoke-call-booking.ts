/**
 * Book by call: staff book for a customer on the phone (admin → Book by call),
 * marked as booked by call with who booked it. Two ways to pay:
 *   - a payment link for the booking fee (SMS / email by Razorpay, WhatsApp):
 *     the booking waits out of the queue until paid (webhook payment_link.paid);
 *   - pay after the service: nothing now, in the queue at once.
 * Payment links are faked here (PAYMENT_LINKS_MOCK); nothing reaches Razorpay,
 * WhatsApp, SMS or email.
 *
 *   npx tsx scripts/smoke-call-booking.ts
 */

process.env.PAYMENT_LINKS_MOCK = '1';
for (const k of ['WHATSAPP_CLOUD_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_PAYMENT_TEMPLATE']) delete process.env[k];

import { and, eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services, serviceRequests, users, paymentTransactions } from '../shared/schema';
import { CallBookingService } from '../server/services/call-booking.service';
import { PaymentService } from '../server/services/payment.service';
import { abandonedUnpaidBooking } from '../server/services/task_queues';

const stamp = Date.now().toString(36);
const catIds: number[] = [], svcIds: number[] = [], srIds: number[] = [], userIds: number[] = [], adminIds: number[] = [];
const rnd = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = await api.login(sa.username, sa.password);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Plumbing ${stamp}`, sortOrder: -900, isActive: true } as any).returning(); catIds.push(cat.id);
        const [consultCat] = await db.insert(serviceCategories).values({ name: `QA Legal ${stamp}`, sortOrder: -901, isActive: true, bookingBand: 'consultation' } as any).returning(); catIds.push(consultCat.id);
        const [inspectCat] = await db.insert(serviceCategories).values({ name: `QA Inspect ${stamp}`, sortOrder: -902, isActive: true, bookingBand: 'inspect_quote', inspectionFee: 199 } as any).returning(); catIds.push(inspectCat.id);
        const mk = async (categoryId: number, name: string, basePrice: number, status = 'ACTIVE') => { const [s] = await db.insert(services).values({ categoryId, name: `QA ${name} ${stamp}`, basePrice, isActive: true, status } as any).returning(); svcIds.push(s.id); return s; };
        const tap = await mk(cat.id, 'Tap repair', 349), lawyer = await mk(consultCat.id, 'Lawyer call', 499), inspect = await mk(inspectCat.id, 'Leak inspection', 0), off = await mk(cat.id, 'Old', 100, 'DISABLED');
        const P = '/api/admin/call-bookings';
        const keep = (r: any) => { if (r.body?.data?.id) { srIds.push(r.body.data.id); if (r.body.data.userId && !userIds.includes(r.body.data.userId)) userIds.push(r.body.data.userId); } return r; };
        const row = async (id: number) => (await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)))[0];
        const inQueue = async (id: number) => ((await api.get('/api/admin/assignment-queue', S)).body?.data ?? (await api.get('/api/admin/assignment-queue', S)).body?.queue ?? []).some?.((r: any) => r.id === id);

        // ── look up by phone ──
        let phone = '6' + rnd();
        while ((await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length) phone = '6' + rnd();
        check('a bad number is refused', (await api.get(`${P}/customer?phone=12345`, S)).status === 400);
        const none = await api.get(`${P}/customer?phone=+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, S);
        check('an unknown number is a new customer (spaces and +91 ignored)', none.status === 200 && none.body.data.customer === null && none.body.data.phone === phone, JSON.stringify(none.body));

        // ── the price, both ways ──
        const q = await api.get(`${P}/quote?catalogServiceId=${tap.id}&pincode=560001&quantity=2`, S);
        const fee = q.body.data?.link?.payNow;
        check('the quote: ₹698 for two; by link the booking fee now and the rest after; or nothing now', q.status === 200 && q.body.data.total === 698 && fee > 0 && q.body.data.link.payAfter === 698 - fee && q.body.data.afterService.payNow === 0 && q.body.data.afterService.payAfter === 698 && q.body.data.linksAvailable === true && !('_internal' in q.body.data), JSON.stringify(q.body.data));
        check('an inspection service cannot be booked by call (its fee is paid in the app)', (await api.get(`${P}/quote?catalogServiceId=${inspect.id}`, S)).body.code === 'NOT_BOOKABLE');
        check('a disabled service cannot be booked', (await api.get(`${P}/quote?catalogServiceId=${off.id}`, S)).status === 409);

        // ── pay after the service, for a new customer ──
        const body = { phone, catalogServiceId: tap.id, quantity: 2, address: '12, 3rd Cross, Jayanagar', pincode: '560011', preferredDate: today, preferredTimeSlot: 'Morning (9–12)', description: 'Kitchen tap leaking', note: 'Called at 10:15, prefers morning', payment: 'after_service' };
        check('a new customer needs a name', (await api.post(P, body, S)).status === 400);
        check('a visit needs an address', (await api.post(P, { ...body, name: 'QA Caller', address: '' }, S)).status === 400);
        check('a pincode is required', (await api.post(P, { ...body, name: 'QA Caller', pincode: '56' }, S)).status === 400);
        check('a bad email is refused', (await api.post(P, { ...body, name: 'QA Caller', email: 'not-an-email' }, S)).status === 400);
        const made = keep(await api.post(P, { ...body, name: `QA Caller ${stamp}` }, S));
        check('pay after the service: booked, customer created', made.status === 201 && /^SR\d+/.test(made.body.data.ref) && made.body.data.newCustomer === true && made.body.data.payment.mode === 'after_service', JSON.stringify(made.body));
        const sr = await row(made.body.data.id);
        check('…marked booked by call, by this staff member, with the note', sr.bookedVia === 'call' && sr.bookedByAdminId === sa.id && sr.bookingNote === body.note);
        check('…no fee, nothing due: in the queue at once; full bill after the service', sr.bookingFeeStatus === 'paid' && sr.bookingFee === 0 && sr.status === 'created' && sr.totalAmount === 698 && Number((sr.pricingSnapshot as any)?.finalTotal) === 698 && !sr.paymentLinkId);
        check('…in the assignment queue', await inQueue(sr.id));
        const [u] = await db.select().from(users).where(eq(users.id, sr.userId));
        check('the new customer has the name, phone and address', u.username === `QA Caller ${stamp}` && u.phone === phone && u.role === 'user' && u.pinCode === '560011');

        // ── a payment link (the default) ──
        const linked = keep(await api.post(P, { ...body, payment: undefined, email: 'qa.caller@example.com', note: null }, S));
        check('by link: booked, and a link comes back', linked.status === 201 && linked.body.data.payment.mode === 'link' && linked.body.data.payment.amount === fee && /^https:\/\/rzp\.io\//.test(linked.body.data.payment.url), JSON.stringify(linked.body.data?.payment));
        const sends = linked.body.data.payment.sends as any[];
        check('…sent by SMS and email (Razorpay), and WhatsApp says it is not set up, with a WhatsApp Web link instead',
            sends.some(s => s.channel === 'sms' && s.ok) && sends.some(s => s.channel === 'email' && s.ok) && sends.some(s => s.channel === 'whatsapp' && !s.ok && /not set up/.test(s.detail)) && /^https:\/\/wa\.me\/91\d{10}\?text=/.test(linked.body.data.payment.whatsappFallbackUrl), JSON.stringify(sends));
        const L = await row(linked.body.data.id);
        check('…it waits: fee pending, link stored, not in the queue', L.bookingFeeStatus === 'pending' && L.bookingFee === fee && L.paymentLinkStatus === 'created' && !!L.paymentLinkExpiresAt && !(await inQueue(L.id)));
        await db.execute(sql`UPDATE service_requests SET created_at = NOW() - INTERVAL '2 hours' WHERE id = ${L.id}`);
        const [swept] = await db.select({ id: serviceRequests.id }).from(serviceRequests).where(and(abandonedUnpaidBooking(), eq(serviceRequests.id, L.id)));
        check('…two hours later the 30-minute clean-up of abandoned app bookings leaves it alone', !swept);
        const listed = await api.get(`/api/admin/services?limit=50&search=${L.serviceId}`, S);
        check('…staff see it in Service Requests while it waits', JSON.stringify(listed.body).includes(L.serviceId));

        // ── resend ──
        const again = await api.post(`${P}/${L.id}/resend-link`, { channels: ['sms', 'whatsapp'] }, S);
        check('resending a live link sends the same one again', again.status === 200 && again.body.data.newLink === false && again.body.data.url === L.paymentLinkUrl);
        const withEmail = await api.post(`${P}/${L.id}/resend-link`, { channels: ['email'], email: 'qa.other@example.com' }, S);
        check('…a new email makes a fresh link', withEmail.status === 200 && withEmail.body.data.newLink === true);
        const L2 = await row(L.id);
        check('…and the sends are logged on the booking', Array.isArray(L2.paymentLinkSends) && (L2.paymentLinkSends as any[]).length >= 5);

        // ── the customer pays the link (Razorpay's webhook) ──
        const payload = {
            payment_link: { entity: { id: L2.paymentLinkId, notes: { service_request_id: String(L.id), payment_type: 'booking_charge', booked_via: 'call' } } },
            payment: { entity: { id: `pay_qa_${stamp}`, order_id: `order_qa_${stamp}`, amount: fee * 100, method: 'upi' } },
        };
        const paid = await PaymentService.handleWebhook('payment_link.paid', payload);
        const P1 = await row(L.id);
        check('webhook payment_link.paid: the fee is paid, the link is paid', paid.success && P1.bookingFeeStatus === 'paid' && P1.paymentLinkStatus === 'paid', JSON.stringify(paid));
        check('…and it joins the queue', await inQueue(L.id));
        check('…the money is on record for a refund, like an app payment', (await PaymentService.capturedBookingChargePaise(L.id)) === fee * 100);
        await PaymentService.handleWebhook('payment_link.paid', payload);
        const caps = await db.select().from(paymentTransactions).where(and(eq(paymentTransactions.razorpayPaymentId, `pay_qa_${stamp}`), eq(paymentTransactions.eventType, 'payment_captured' as any)));
        check('…a repeated webhook adds nothing', caps.length === 1);

        // ── switch to pay after the service ──
        const third = keep(await api.post(P, { ...body, payment: 'link', note: null }, S));
        const sw = await api.post(`${P}/${third.body.data.id}/pay-after-service`, {}, S);
        const T = await row(third.body.data.id);
        check('staff switch a waiting booking to pay after the service: no fee, in the queue, link cancelled', sw.status === 200 && T.bookingFee === 0 && T.bookingFeeStatus === 'paid' && T.paymentLinkStatus === 'cancelled' && T.totalAmount === 698 && Number((T.pricingSnapshot as any).finalTotal) === 698 && await inQueue(T.id), JSON.stringify(sw.body));
        check('…and it cannot be switched or resent again', (await api.post(`${P}/${T.id}/pay-after-service`, {}, S)).status === 409 && (await api.post(`${P}/${T.id}/resend-link`, { channels: ['sms'] }, S)).status === 409);

        // ── paid in the app instead ──
        const fourth = keep(await api.post(P, { ...body, payment: 'link', note: null }, S));
        await db.update(serviceRequests).set({ bookingFeeStatus: 'paid' as any }).where(eq(serviceRequests.id, fourth.body.data.id));
        await CallBookingService.afterOtherPayment(fourth.body.data.id);
        check('paid in the app: the link is cancelled so it cannot be paid twice', (await row(fourth.body.data.id)).paymentLinkStatus === 'cancelled');

        // ── consultation, same customer ──
        check('a consultation needs a day and a time', (await api.post(P, { phone, catalogServiceId: lawyer.id, pincode: '560011', address: '', payment: 'after_service' }, S)).status === 400);
        const consult = keep(await api.post(P, { phone, catalogServiceId: lawyer.id, pincode: '560011', preferredDate: today, preferredTimeSlot: '4 pm', payment: 'after_service' }, S));
        check('…books with no address, for the same customer', consult.status === 201 && consult.body.data.newCustomer === false && consult.body.data.userId === u.id);

        // ── the list ──
        const list = await api.get(P, S);
        const mine = (list.body.data ?? []).filter((r: any) => srIds.includes(r.id));
        const by = (id: number) => mine.find((r: any) => r.id === id);
        check('the list shows each call booking\'s payment: after service / paid by link', mine.length === 5 && by(made.body.data.id)?.payment === 'after_service' && by(L.id)?.payment === 'paid_by_link' && by(T.id)?.payment === 'after_service' && mine.every((r: any) => r.bookedBy === sa.username), JSON.stringify(mine.map((r: any) => [r.ref, r.payment])));

        check('only staff can book or resend', (await api.post(P, { ...body, name: 'x' })).status === 401 && (await api.post(`${P}/${L.id}/resend-link`, {})).status === 401);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    // Notifications are sent in the background; let them land before cleaning up.
    await new Promise(r => setTimeout(r, 2500));
    const ids = srIds.join(',') || '0';
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM payment_transactions WHERE service_request_id IN (${ids}) OR razorpay_payment_id = 'pay_qa_${stamp}'`)).catch(e => console.error('cleanup tx', e.message));
    await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',') || '0'})`)).catch(() => {});
    if (srIds.length) await db.delete(serviceRequests).where(inArray(serviceRequests.id, srIds)).catch(e => console.error('cleanup sr', e.message));
    await db.execute(sql.raw(`DELETE FROM customers WHERE user_id IN (${userIds.join(',') || '0'})`)).catch(() => {});
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)).catch(e => console.error('cleanup users', e.message));
    if (svcIds.length) await db.delete(services).where(inArray(services.id, svcIds));
    if (catIds.length) await db.delete(serviceCategories).where(inArray(serviceCategories.id, catIds));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`)).catch(() => {});
    process.exit(summary());
});
