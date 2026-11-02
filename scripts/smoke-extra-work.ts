/**
 * Extra work at the end of a fixed-price job (the X+Y): the technician sends
 * what they did and what it costs, the customer approves it, and the bill,
 * the earning and the invoice carry it — GST and UniteFix's fee carved out of
 * the amount like a catalogue price.
 *
 *   npm run smoke:extra-work
 */

import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db, cleanupPartners } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services, partnerWallets, invoices } from '../shared/schema';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.011;
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Work ${stamp}`, bookingFee: 99 }).returning(); catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Pump visit ${stamp}`, basePrice: 349 }).returning(); svcIds.push(svc.id);
        const mkUser = async (role: string, name: string, lead: string) => {
            const [u] = await db.insert(users).values({ phone: `${lead}${String(Date.now()).slice(-9)}`, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning();
            userIds.push(u.id); await new Promise(r => setTimeout(r, 3));
            return { u, t: jwt.sign({ userId: u.id, role: role === 'serviceman' ? 'serviceman' : 'user' }, SECRET, { expiresIn: '1h' }) };
        };
        const cust = await mkUser('user', 'QA Work Customer', '8');
        const tech = await mkUser('serviceman', 'QA Work Tech', '9');
        const [emp] = await db.insert(employees).values({ userId: tech.u.id, fullName: 'QA Work Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const b = await api.post('/api/services/create', { serviceType: 'QA', description: 'Pump not lifting water', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svc.id }, cust.t);
        const job = b.body?.data?.id as number;
        await db.update(serviceRequests).set({ providerId: emp.id, status: 'in_progress' as any }).where(eq(serviceRequests.id, job));
        const [before] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, job));
        const s0: any = before.pricingSnapshot;
        check('the job is a ₹349 visit (X)', s0?.basePrice === 349 && s0.snapshotVersion === 2, JSON.stringify(s0 && { p: s0.basePrice, v: s0.snapshotVersion }));

        // ── validation ──
        check('extra work needs what it is', (await api.post(`/api/bookings/${job}/part-requests/preview`, { work: [{ description: 'x', amountRupees: 500 }] }, tech.t)).body?.code === 'NO_WORK_NOTE');
        check('…and an amount', (await api.post(`/api/bookings/${job}/part-requests/preview`, { work: [{ description: 'Rewound the motor', amountRupees: 0 }] }, tech.t)).body?.code === 'BAD_WORK_AMOUNT');
        check('…up to 5 lines', (await api.post(`/api/bookings/${job}/part-requests/preview`, { work: Array.from({ length: 6 }, (_, i) => ({ description: `Work ${i}`, amountRupees: 10 })) }, tech.t)).body?.code === 'TOO_MANY');
        check('an empty request is refused', (await api.post(`/api/bookings/${job}/part-requests/preview`, {}, tech.t)).body?.code === 'NO_ITEMS');

        // ── send Y = ₹500 ──
        const workGst = r2(500 * 18 / 118);
        const pv = await api.post(`/api/bookings/${job}/part-requests/preview`, { work: [{ description: 'Rewound the pump motor', amountRupees: 500 }] }, tech.t);
        check('preview: ₹500 all-in, ₹76.27 GST inside it', pv.status === 200 && pv.body.data.total === 500 && near(pv.body.data.gst, workGst) && pv.body.data.workTotal === 500, JSON.stringify(pv.body?.data && { t: pv.body.data.total, g: pv.body.data.gst }));
        const sent = await api.post(`/api/bookings/${job}/part-requests`, { work: [{ description: 'Rewound the pump motor', amountRupees: 500 }], reason: 'The motor winding was burnt.' }, tech.t);
        check('the technician sends extra work for the customer to approve', sent.status === 201 || sent.status === 200, JSON.stringify(sent.body).slice(0, 200));
        const reqId = sent.body?.data?.id;
        const seen = await api.get(`/api/bookings/${job}/part-requests`, cust.t);
        const r0 = (seen.body?.data ?? []).find((x: any) => x.id === reqId);
        check('the customer sees it as a line today’s app already lists: "Extra work: …" ₹500', !!r0 && r0.items.some((i: any) => i.partName === 'Extra work: Rewound the pump motor' && i.lineTotal === 500 && i.sourceType === 'work') && r0.total === 500, JSON.stringify(r0 ?? seen.body).slice(0, 300));
        check('a bill waits while the customer has not decided', (await api.post(`/api/bookings/${job}/request-payment`, {}, tech.t)).body?.code === 'PARTS_AWAITING_CUSTOMER');
        check('the customer approves', (await api.post(`/api/part-requests/${reqId}/approve`, {}, cust.t)).status === 200);

        // ── the bill ──
        const rp = await api.post(`/api/bookings/${job}/request-payment`, {}, tech.t);
        const [after] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, job));
        const s: any = after.pricingSnapshot;
        const fee = r2(500 * Number(s0.platformFeePercent) / 100);
        const value = r2(500 - workGst - fee);
        check('payment requested: the balance is X − advance + Y', rp.status === 200 && near(s.finalTotal, s0.finalTotal + 500) && near(s.grossTotal, 349 + 500), JSON.stringify({ st: rp.status, m: rp.body?.message, ft: s?.finalTotal }));
        check('…GST and UniteFix’s fee come out of Y; the rest is the technician’s', near(s.extraWorkGst, workGst) && near(s.extraWorkFee, fee) && near(s.extraWorkValue, value) && near(s.technicianEarning, s0.technicianEarning + value), JSON.stringify({ g: s.extraWorkGst, f: s.extraWorkFee, v: s.extraWorkValue, te: s.technicianEarning }));
        check('…and the invoice lines still add up to the taxable value (service + extra work + fee)', near(s.serviceLaborCost + s.extraWorkValue + s.platformFee, s.taxableAmount) && near(s.taxableAmount + s.cgst + s.sgst, s.grossTotal), JSON.stringify({ l: s.serviceLaborCost, v: s.extraWorkValue, f: s.platformFee, t: s.taxableAmount, c: s.cgst, sg: s.sgst, g: s.grossTotal }));

        // ── paid in cash ──
        const cash = await api.post(`/api/bookings/${job}/cash-collected`, { amountCollected: s.finalTotal }, tech.t);
        const [w] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id));
        const owed = r2(s.finalTotal - s.technicianEarning);
        check('cash collected: the wallet settles to exactly the earning, extra work included', cash.status === 200 && near(Number(w?.balanceAvailable ?? 0) + Number(w?.balanceHold ?? 0), -owed), JSON.stringify({ w, owed }));
        const [inv] = await db.select().from(invoices).where(eq(invoices.serviceRequestId, job));
        check('the invoice carries the whole amount, extra work included', !!inv && near(Number(inv.baseAmount) + Number(inv.cgst) + Number(inv.sgst), 849), JSON.stringify(inv && { b: inv.baseAmount, c: inv.cgst, s: inv.sgst }));
    } finally {
        const uids = userIds.join(',') || '0';
        const ids = `SELECT id FROM service_requests WHERE user_id IN (${uids})`;
        await cleanupPartners([], adminIds, [
            `DELETE FROM part_requests WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM wallet_transactions WHERE provider_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
            `DELETE FROM service_part_items WHERE service_request_id IN (${ids})`,
            `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE user_id IN (${uids})`,
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
