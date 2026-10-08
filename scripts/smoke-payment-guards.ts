/**
 * Payments can only be completed by the customer who owes them, for what the
 * server says is due.
 *
 *   - "zero amount" completion: refused for someone else's booking, for a
 *     booking that still owes money, and for a booking not awaiting payment;
 *     allowed only when nothing is due
 *   - the final-payment order and its cancel: the booking's own customer only
 *   - the bill: the booking's customer or its assigned technician only
 *
 *   npm run smoke:payment-guards
 */

import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, db, cleanupPartners } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services } from '../shared/schema';

const stamp = Date.now().toString(36);
const userIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const n = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
    try {
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Guard ${stamp}`, bookingFee: 149 }).returning();
        catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Guard fan ${stamp}`, basePrice: 1000 }).returning();
        svcIds.push(svc.id);
        const mkUser = async (role: 'user' | 'serviceman', name: string) => {
            const [u] = await db.insert(users).values({ phone: `${role === 'user' ? 8 : 9}${n()}`, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning();
            userIds.push(u.id);
            return { u, t: jwt.sign({ userId: u.id, role }, SECRET, { expiresIn: '1h' }) };
        };
        const A = await mkUser('user', 'QA Guard Owner');
        const B = await mkUser('user', 'QA Guard Stranger');
        const T = await mkUser('serviceman', 'QA Guard Tech');
        const T2 = await mkUser('serviceman', 'QA Guard Other Tech');
        const [emp] = await db.insert(employees).values({ userId: T.u.id, fullName: 'QA Guard Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        await db.insert(employees).values({ userId: T2.u.id, fullName: 'QA Guard Other Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any);

        const book = async () => {
            const r = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA guard booking', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svc.id }, A.t);
            const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, r.body?.data?.id ?? 0));
            return sr;
        };
        const zero = (id: number, t: string) => api.post('/api/payments/verify', { razorpay_payment_id: 'zero_amount', razorpay_order_id: `order_${id}`, razorpay_signature: 'zero_amount_sig' }, t);
        const status = async (id: number) => (await db.select({ s: serviceRequests.status, f: serviceRequests.bookingFeeStatus }).from(serviceRequests).where(eq(serviceRequests.id, id)))[0];

        // A booking awaiting its final ₹851.
        const owed = await book();
        await db.update(serviceRequests).set({ status: 'pending_payment' as any, providerId: emp.id }).where(eq(serviceRequests.id, owed.id));
        const r1 = await zero(owed.id, B.t);
        check('someone else cannot mark my booking paid with "zero amount"', r1.status === 404 && (await status(owed.id)).s === 'pending_payment', `${r1.status}`);
        const r2 = await zero(owed.id, A.t);
        check('…nor can I while ₹851 is still due', r2.status === 402 && /₹851/.test(r2.body?.message ?? '') && (await status(owed.id)).s === 'pending_payment', `${r2.status} ${r2.body?.message}`);

        // A fresh booking whose booking fee is not paid yet.
        const fresh = await book();
        const before = await status(fresh.id);
        const r3 = await zero(fresh.id, A.t);
        const after = await status(fresh.id);
        check('a booking fee cannot be skipped with "zero amount"', r3.status === 409 && after.f === before.f && after.s === before.s, `${r3.status} ${before.f}→${after.f}`);

        // Nothing due (e.g. everything covered by the booking fee): allowed, for the owner.
        const covered = await book();
        await db.update(serviceRequests).set({ status: 'pending_payment' as any, pricingSnapshot: { ...(covered.pricingSnapshot as any), finalTotal: 0 } as any }).where(eq(serviceRequests.id, covered.id));
        const r4 = await zero(covered.id, A.t);
        check('when nothing is due, the customer completes the booking', r4.status === 200 && (await status(covered.id)).s === 'completed', `${r4.status} ${r4.body?.message}`);

        // The final-payment order and its cancel.
        const r5 = await api.post(`/api/customer/services/${owed.id}/create-final-payment`, {}, B.t);
        check('someone else cannot start the final payment on my booking', r5.status === 404);
        const r6 = await api.post(`/api/customer/services/${owed.id}/cancel-final-payment`, {}, B.t);
        check('…or reset its payment method', r6.status === 404);
        const r7 = await api.post(`/api/customer/services/${owed.id}/cancel-final-payment`, {}, A.t);
        check('the customer can', r7.status === 200);

        // The bill.
        check('a stranger cannot read my bill', (await api.get(`/api/bookings/${owed.id}/billing`, B.t)).status === 404);
        check('another technician cannot either', (await api.get(`/api/bookings/${owed.id}/billing`, T2.t)).status === 404);
        const mine = await api.get(`/api/v1/bookings/${owed.id}/billing`, A.t);
        check('the customer reads it — the server\'s own figures', mine.status === 200 && Number(mine.body?.data?.billing?.finalTotal) === 851, JSON.stringify(mine.body?.data?.billing?.finalTotal));
        check('the assigned technician reads it', (await api.get(`/api/bookings/${owed.id}/billing`, T.t)).status === 200);
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
        await cleanupPartners([], [], [
            `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM service_part_items WHERE service_request_id IN (${ids})`,
            `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM employees WHERE user_id IN (${uids})`,
            `DELETE FROM refresh_tokens WHERE user_id IN (${uids})`,
            `DELETE FROM users WHERE id IN (${uids})`,
            `DELETE FROM services WHERE id IN (${svcIds.join(',') || 0})`,
            `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || 0})`,
        ]);
        await close();
    }
    process.exit(summary());
}

main().catch(e => { console.error(e); process.exit(1); });
