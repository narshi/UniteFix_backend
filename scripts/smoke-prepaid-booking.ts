/**
 * Booking fee 0 → the customer pays the full price when booking; a normal
 * fee still works as before; staff can change their own password and a
 * well-known password is flagged at sign-in.
 *
 *   npm run smoke:prepaid-booking
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db } from './lib/hub-test-kit';
import { adminUsers, users, employees, serviceRequests, serviceCategories, services, walletTransactionsV2 } from '../shared/schema';
import { BillingEngine } from '../server/services/billing-engine';
import { cleanupPartners } from './lib/hub-test-kit';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        // ── password ──────────────────────────────────────────────────────
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        await db.update(adminUsers).set({ password: await bcrypt.hash('admin123', 10) }).where(eq(adminUsers.id, sa.id));
        const weak = await fetch(`${base}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: 'admin123' }) }).then(r => r.json());
        check('signing in with a well-known password is flagged', weak.success === true && weak.passwordIsWeak === true);
        const tk = weak.token;
        const bad = await api.post('/api/admin/me/password', { currentPassword: 'admin123', newPassword: 'password123' }, tk);
        check('a well-known new password is refused', bad.status === 400);
        const wrong = await api.post('/api/admin/me/password', { currentPassword: 'nope', newPassword: 'Str0ng-and-long!' }, tk);
        check('the current password must be right', wrong.status === 400);
        const ok = await api.post('/api/admin/me/password', { currentPassword: 'admin123', newPassword: 'Str0ng-and-long!' }, tk);
        check('staff change their own password', ok.status === 200, ok.body?.message);
        const strong = await fetch(`${base}/api/admin/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sa.username, password: 'Str0ng-and-long!' }) }).then(r => r.json());
        check('…and sign in with it, no longer flagged', strong.success === true && strong.passwordIsWeak === false);

        // ── catalogue: one category with no fee, one with ₹149 ───────────
        const [free] = await db.insert(serviceCategories).values({ name: `QA Prepaid ${stamp}`, bookingFee: 0 }).returning();
        const [paid] = await db.insert(serviceCategories).values({ name: `QA Fee ${stamp}`, bookingFee: 149 }).returning();
        catIds.push(free.id, paid.id);
        const [s0] = await db.insert(services).values({ categoryId: free.id, name: `QA AC service ${stamp}`, basePrice: 1000 }).returning();
        const [s1] = await db.insert(services).values({ categoryId: paid.id, name: `QA Fan repair ${stamp}`, basePrice: 1000 }).returning();
        svcIds.push(s0.id, s1.id);

        const [cust] = await db.insert(users).values({ phone: `8${String(Date.now()).slice(-9)}`, username: 'QA Prepay Customer', role: 'user', homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning();
        userIds.push(cust.id);
        const ct = jwt.sign({ userId: cust.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const book = (svcId: number) => api.post('/api/services/create', { serviceType: 'QA', description: 'QA booking', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svcId }, ct);

        const b0 = await book(s0.id);
        const [sr0] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b0.body?.data?.id ?? 0));
        const snap0: any = sr0?.pricingSnapshot;
        check('fee 0: the booking is marked prepaid for the full price', b0.status === 201 && snap0?.prepaid === true && snap0.prepaidAmount === 1000 && snap0.bookingFee === 0 && snap0.finalTotal === 0, JSON.stringify(snap0 && { p: snap0.prepaid, a: snap0.prepaidAmount, f: snap0.bookingFee, ft: snap0.finalTotal }));
        check('…what is due at booking is the full price', BillingEngine.amountDueAtBooking(snap0) === 1000);
        check('…and no booking charge comes out of the technician\'s share', Math.abs(snap0.technicianEarning - (1000 - snap0.gst - snap0.platformFee)) < 0.02);

        const b1 = await book(s1.id);
        const [sr1] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, b1.body?.data?.id ?? 0));
        const snap1: any = sr1?.pricingSnapshot;
        check('fee ₹149: unchanged — ₹149 now, ₹851 after the service', !snap1.prepaid && snap1.bookingFee === 149 && snap1.finalTotal === 851 && BillingEngine.amountDueAtBooking(snap1) === 149);

        // ── the technician finishes the prepaid job ───────────────────────
        const [tu] = await db.insert(users).values({ phone: `9${String(Date.now()).slice(-9)}`, username: 'QA Prepay Tech', role: 'serviceman', homeAddress: 'Sirsi', pinCode: '581401' } as any).returning();
        userIds.push(tu.id);
        const [emp] = await db.insert(employees).values({ userId: tu.id, fullName: 'QA Prepay Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const tt = jwt.sign({ userId: tu.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        await db.update(serviceRequests).set({ providerId: emp.id, status: 'in_progress' as any }).where(inArray(serviceRequests.id, [sr0.id]));
        const rp = await api.post(`/api/bookings/${sr0.id}/request-payment`, {}, tt);
        const [sr0b] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, sr0.id));
        check('paid in full: finishing the job completes it — nothing to collect', rp.status === 200 && rp.body?.data?.status === 'completed' && rp.body.data.amountDue === 0 && sr0b.status === 'completed', `${rp.status} ${rp.body?.message}`);
        const holds = await db.select().from(walletTransactionsV2).where(eq(walletTransactionsV2.serviceRequestId, sr0.id));
        check('…and the technician is credited their share', holds.some(h => h.transactionType === 'hold_credit' && Math.abs(Number(h.amount) - snap0.technicianEarning) < 0.02));

        // Prepaid, but parts were needed: only the parts are due after.
        const b2 = await book(s0.id);
        const sr2id = b2.body?.data?.id;
        await db.update(serviceRequests).set({ providerId: emp.id, status: 'in_progress' as any }).where(eq(serviceRequests.id, sr2id));
        const rp2 = await api.post(`/api/bookings/${sr2id}/request-payment`, { extraPartsCost: 200, partsNote: 'Capacitor' }, tt);
        const [sr2] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, sr2id));
        const s2: any = sr2.pricingSnapshot;
        check('paid in full but parts needed: only the parts (with GST) are due', rp2.status === 200 && sr2.status === 'pending_payment' && s2.finalTotal > 200 && s2.finalTotal < 300, `${rp2.status} ${s2?.finalTotal}`);
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
        await cleanupPartners([], adminIds, [
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
