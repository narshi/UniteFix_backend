/**
 * Book by call: staff book for a customer on the phone (admin → Book by call).
 * The booking goes into the same queue as an app booking, with nothing to pay
 * at booking (no booking fee; the full bill after the service), marked as
 * booked by call with who booked it.
 *
 *   npx tsx scripts/smoke-call-booking.ts
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { serviceCategories, services, serviceRequests, users } from '../shared/schema';

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

        // ── look up by phone ──
        let phone = '6' + rnd();
        while ((await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length) phone = '6' + rnd();
        check('a bad number is refused', (await api.get(`${P}/customer?phone=12345`, S)).status === 400);
        const none = await api.get(`${P}/customer?phone=+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, S);
        check('an unknown number is a new customer (spaces and +91 ignored)', none.status === 200 && none.body.data.customer === null && none.body.data.phone === phone, JSON.stringify(none.body));

        // ── the price ──
        const q = await api.get(`${P}/quote?catalogServiceId=${tap.id}&pincode=560001&quantity=2`, S);
        check('the quote is the catalogue price for two, nothing to pay now', q.status === 200 && q.body.data.total === 698 && q.body.data.payNow === 0 && q.body.data.payAfter === 698 && !('_internal' in q.body.data), JSON.stringify(q.body.data));
        check('an inspection service cannot be booked by call (its fee is paid in the app)', (await api.get(`${P}/quote?catalogServiceId=${inspect.id}`, S)).body.code === 'NOT_BOOKABLE');
        check('a disabled service cannot be booked', (await api.get(`${P}/quote?catalogServiceId=${off.id}`, S)).status === 409);

        // ── book for a new customer ──
        const body = { phone, catalogServiceId: tap.id, quantity: 2, address: '12, 3rd Cross, Jayanagar', pincode: '560011', preferredDate: today, preferredTimeSlot: 'Morning (9–12)', description: 'Kitchen tap leaking', note: 'Called at 10:15, prefers morning' };
        check('a new customer needs a name', (await api.post(P, body, S)).status === 400);
        check('a visit needs an address', (await api.post(P, { ...body, name: 'QA Caller', address: '' }, S)).status === 400);
        check('a pincode is required', (await api.post(P, { ...body, name: 'QA Caller', pincode: '56' }, S)).status === 400);
        const made = await api.post(P, { ...body, name: `QA Caller ${stamp}` }, S);
        if (made.body?.data?.id) { srIds.push(made.body.data.id); userIds.push(made.body.data.userId); }
        check('staff book it: a reference comes back and a customer is created', made.status === 201 && /^SR\d+/.test(made.body.data.ref) && made.body.data.newCustomer === true, JSON.stringify(made.body));
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, made.body.data.id));
        check('…marked booked by call, by this staff member, with the note', sr.bookedVia === 'call' && sr.bookedByAdminId === sa.id && sr.bookingNote === body.note);
        check('…ready for the queue: nothing due at booking, no booking fee', sr.bookingFeeStatus === 'paid' && sr.bookingFee === 0 && sr.status === 'created');
        check('…priced like the app: two units, full bill after the service', sr.quantity === 2 && sr.totalAmount === 698 && (sr.pricingSnapshot as any)?.bookingFee === 0 && !(sr.pricingSnapshot as any)?.prepaid && Number((sr.pricingSnapshot as any)?.finalTotal) === 698, JSON.stringify(sr.pricingSnapshot));
        check('…with the address, pincode, day and slot', sr.address === body.address && sr.pincode === '560011' && sr.preferredDate === today && sr.preferredTimeSlot === body.preferredTimeSlot && sr.description === body.description);
        const [u] = await db.select().from(users).where(eq(users.id, sr.userId));
        check('the new customer has the name, phone and address', u.username === `QA Caller ${stamp}` && u.phone === phone && u.role === 'user' && u.pinCode === '560011');

        // ── the same caller again: found, not duplicated ──
        const again = await api.get(`${P}/customer?phone=0${phone}`, S);
        check('the caller is found next time, with the address and the booking', again.body.data.customer?.id === u.id && again.body.data.customer.addresses.some((a: any) => a.pinCode === '560011') && again.body.data.customer.recent[0]?.id === sr.id, JSON.stringify(again.body.data));
        const consult = await api.post(P, { phone, catalogServiceId: lawyer.id, pincode: '560011', address: '' }, S);
        check('a consultation needs a day and a time', consult.status === 400);
        const consult2 = await api.post(P, { phone, catalogServiceId: lawyer.id, pincode: '560011', preferredDate: today, preferredTimeSlot: '4 pm' }, S);
        if (consult2.body?.data?.id) srIds.push(consult2.body.data.id);
        check('…and books with no address, for the same customer', consult2.status === 201 && consult2.body.data.newCustomer === false && consult2.body.data.userId === u.id);

        const list = await api.get(P, S);
        const mine = (list.body.data ?? []).filter((r: any) => srIds.includes(r.id));
        check('the list of call bookings shows both, with who booked them', mine.length === 2 && mine.every((r: any) => r.bookedBy === sa.username && r.customerPhone === phone), JSON.stringify(mine));

        // ── access ──
        check('only staff can book', (await api.post(P, { ...body, name: 'x' })).status === 401);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    // The booking notification is sent in the background; let it land before cleaning up.
    await new Promise(r => setTimeout(r, 2500));
    const ids = srIds.join(',') || '0';
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id IN (${userIds.join(',') || '0'})`)).catch(() => {});
    if (srIds.length) await db.delete(serviceRequests).where(inArray(serviceRequests.id, srIds)).catch(e => console.error('cleanup sr', e.message));
    await db.execute(sql.raw(`DELETE FROM customers WHERE user_id IN (${userIds.join(',') || '0'})`)).catch(() => {});
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds)).catch(e => console.error('cleanup users', e.message));
    if (svcIds.length) await db.delete(services).where(inArray(services.id, svcIds));
    if (catIds.length) await db.delete(serviceCategories).where(inArray(serviceCategories.id, catIds));
    await db.execute(sql.raw(`DELETE FROM admin_users WHERE id IN (${adminIds.join(',') || '0'})`)).catch(() => {});
    process.exit(summary());
});
