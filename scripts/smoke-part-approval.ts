/**
 * Spare parts the customer approves: the technician requests, only the
 * customer decides, and the bill carries exactly what was approved.
 *
 *   npm run smoke:part-approval
 */

import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, db, cleanupPartners } from './lib/hub-test-kit';
import { users, employees, serviceRequests, serviceCategories, services, servicePartItems, partRequests, spareParts, notifications } from '../shared/schema';
import { configService } from '../server/services/config.service';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], catIds: number[] = [], svcIds: number[] = [], partIds: number[] = [];

async function main() {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Parts ${stamp}`, bookingFee: 149 }).returning(); catIds.push(cat.id);
        const [svc] = await db.insert(services).values({ categoryId: cat.id, name: `QA Fan repair ${stamp}`, basePrice: 1000 }).returning(); svcIds.push(svc.id);
        const mkUser = async (role: string, name: string, lead: string) => {
            const [u] = await db.insert(users).values({ phone: `${lead}${String(Date.now()).slice(-9)}`, username: name, role, homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning();
            userIds.push(u.id); await new Promise(r => setTimeout(r, 3));
            return { u, t: jwt.sign({ userId: u.id, role: role === 'serviceman' ? 'serviceman' : 'user' }, SECRET, { expiresIn: '1h' }) };
        };
        const cust = await mkUser('user', 'QA Parts Customer', '8');
        const other = await mkUser('user', 'QA Other Customer', '7');
        const tech = await mkUser('serviceman', 'QA Parts Tech', '9');
        const [emp] = await db.insert(employees).values({ userId: tech.u.id, fullName: 'QA Parts Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const book = async (userToken: string) => {
            const b = await api.post('/api/services/create', { serviceType: 'QA', description: 'Fan not running', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svc.id }, userToken);
            await db.update(serviceRequests).set({ providerId: emp.id, status: 'in_progress' as any }).where(eq(serviceRequests.id, b.body.data.id));
            return b.body.data.id as number;
        };
        const job = await book(cust.t);
        const fanSwitch = { partName: 'Fan switch', sourceType: 'technician_local', quantity: 1, unitPriceRupees: 220, vendorName: 'Sri Ganesh Electricals' };

        // ── technician: preview and send ──────────────────────────────────
        const pv = await api.post(`/api/bookings/${job}/part-requests/preview`, { items: [fanSwitch] }, tech.t);
        check('preview: price, 18% GST and the customer total', pv.status === 200 && pv.body.data.parts === 220 && pv.body.data.gst === 39.6 && pv.body.data.total === 259.6, JSON.stringify(pv.body?.data && { p: pv.body.data.parts, g: pv.body.data.gst, t: pv.body.data.total }));
        check('preview: no bill and no warranty days → not covered, said plainly', pv.body.data.items[0].warranty.covered === false && /No part warranty/.test(pv.body.data.items[0].warranty.label));
        check('a local part needs its price', (await api.post(`/api/bookings/${job}/part-requests/preview`, { items: [{ ...fanSwitch, unitPriceRupees: 0 }] }, tech.t)).body?.code === 'NO_PRICE');
        check('the customer must be told why', (await api.post(`/api/bookings/${job}/part-requests`, { items: [fanSwitch] }, tech.t)).body?.code === 'NO_REASON');
        const sent = await api.post(`/api/bookings/${job}/part-requests`, { items: [fanSwitch], reason: 'The switch contacts are burnt.' }, tech.t);
        check('sent: pending, waiting for the customer', sent.status === 201 && sent.body.data.status === 'pending' && sent.body.data.total === 259.6);
        const reqId = sent.body.data.id;
        await new Promise(r => setTimeout(r, 600)); // notifications are fire-and-forget
        const pushed = await db.select().from(notifications).where(eq(notifications.userId, cust.u.id));
        check('the customer is notified', pushed.some(n => (n as any).type === 'part_approval_requested' || /spare part/i.test((n as any).title ?? '')), JSON.stringify(pushed.map(n => (n as any).title)));

        // ── nobody but the customer decides ───────────────────────────────
        check('the technician cannot approve (customer-only endpoint)', [401, 403].includes((await api.post(`/api/part-requests/${reqId}/approve`, {}, tech.t)).status));
        check('another customer cannot see or approve it', (await api.get(`/api/bookings/${job}/part-requests`, other.t)).status === 404 && (await api.post(`/api/part-requests/${reqId}/approve`, {}, other.t)).status === 404);
        const rpWait = await api.post(`/api/bookings/${job}/request-payment`, {}, tech.t);
        check('payment cannot be requested while the customer is deciding', rpWait.status === 409 && rpWait.body?.code === 'PARTS_AWAITING_CUSTOMER');

        // ── customer: what they see, and approving ────────────────────────
        const cl = await api.get(`/api/bookings/${job}/part-requests`, cust.t);
        const cv = cl.body?.data?.[0];
        check('the customer sees the part, the reason, the warranty and what they pay', cv?.items?.[0]?.partName === 'Fan switch' && cv.reason === 'The switch contacts are burnt.' && cv.total === 259.6 && !!cv.items[0].warranty.label);
        check('…but not the shop name (internal)', !JSON.stringify(cl.body).includes('Sri Ganesh') && cv.items[0].source === 'Bought locally by your technician');
        const ap = await api.post(`/api/part-requests/${reqId}/approve`, {}, cust.t);
        check('the customer approves', ap.status === 200 && ap.body.data.status === 'approved');
        check('a decision is final', (await api.post(`/api/part-requests/${reqId}/reject`, {}, cust.t)).body?.code === 'ALREADY_DECIDED');
        const tl = await api.get(`/api/partner/bookings/${job}/part-requests`, tech.t);
        check('the technician sees "approved" (and the shop they named)', tl.body?.data?.[0]?.status === 'approved' && JSON.stringify(tl.body).includes('Sri Ganesh'));
        await new Promise(r => setTimeout(r, 600));
        const techPush = await db.select().from(notifications).where(eq(notifications.userId, tech.u.id));
        check('the technician is notified of the decision', techPush.some(n => /approved/i.test((n as any).title ?? '')));

        // ── duplicate, reject with a question, expiry, cancel ─────────────
        const dup = await api.post(`/api/bookings/${job}/part-requests`, { items: [fanSwitch], reason: 'Second switch' }, tech.t);
        check('the same part again is flagged as a duplicate', dup.status === 409 && dup.body?.code === 'DUPLICATE_PART');
        const dup2 = await api.post(`/api/bookings/${job}/part-requests`, { items: [{ ...fanSwitch, partName: 'Fan switch' }], reason: 'Second switch for the other fan', confirmDuplicate: true }, tech.t);
        const rj = await api.post(`/api/part-requests/${dup2.body.data.id}/reject`, { note: 'Only one fan needs it' }, cust.t);
        const tl2 = await api.get(`/api/partner/bookings/${job}/part-requests`, tech.t);
        check('…sent anyway when confirmed; the customer rejects with a reason the technician sees', dup2.status === 201 && rj.body?.data?.status === 'rejected' && tl2.body.data.find((r: any) => r.id === dup2.body.data.id)?.customerNote === 'Only one fan needs it');
        const ex = await api.post(`/api/bookings/${job}/part-requests`, { items: [{ partName: 'Capacitor 2.5uF', sourceType: 'technician_local', quantity: 1, unitPriceRupees: 80 }], reason: 'Weak capacitor' }, tech.t);
        await db.update(partRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(partRequests.id, ex.body.data.id));
        const tl3 = await api.get(`/api/partner/bookings/${job}/part-requests`, tech.t);
        check('a request left too long expires', tl3.body.data.find((r: any) => r.id === ex.body.data.id)?.status === 'expired' && (await api.post(`/api/part-requests/${ex.body.data.id}/approve`, {}, cust.t)).body?.code === 'EXPIRED');
        const cx = await api.post(`/api/bookings/${job}/part-requests`, { items: [{ partName: 'Regulator', sourceType: 'technician_local', quantity: 1, unitPriceRupees: 300 }], reason: 'Regulator buzzing' }, tech.t);
        const cxd = await api.post(`/api/part-requests/${cx.body.data.id}/cancel`, {}, tech.t);
        check('the technician withdraws a request; the customer no longer sees it', cxd.body?.data?.status === 'cancelled' && !(await api.get(`/api/bookings/${job}/part-requests`, cust.t)).body.data.some((r: any) => r.id === cx.body.data.id));

        // ── the bill carries exactly what was approved ────────────────────
        const rp = await api.post(`/api/bookings/${job}/request-payment`, {}, tech.t);
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, job));
        const snap: any = sr.pricingSnapshot;
        const lines = await db.select().from(servicePartItems).where(eq(servicePartItems.serviceRequestId, job));
        check('payment requested: the approved part (with GST) is on the bill, nothing else', rp.status === 200 && snap.finalTotal === 851 + 259.6 && lines.length === 1 && lines[0].partName === 'Fan switch' && lines[0].unitPricePaise === 22000 && lines[0].vendorName === 'Sri Ganesh Electricals', JSON.stringify({ s: rp.status, m: rp.body?.message, ft: snap?.finalTotal, n: lines.length }));
        check('…and the technician is paid back what they spent', Math.abs(snap.extraPartsCost - 220) < 0.01);
        check('after the bill, a request can no longer be withdrawn', (await api.post(`/api/part-requests/${reqId}/cancel`, {}, tech.t)).status === 409);

        // ── stock parts, earlier warranty, self-approval, the switch ──────
        const [sp] = await db.insert(spareParts).values({ partCode: `QA-FSW-${stamp}`, name: `QA Fan switch ${stamp}`, unit: 'piece', unitPricePaise: 15000, gstPercent: '18', warrantyDays: 180, hsnCode: '8536', status: 'active' as any, isActive: true }).returning();
        partIds.push(sp.id);
        const job2 = await book(cust.t);
        const noAccess = await api.post(`/api/bookings/${job2}/part-requests/preview`, { items: [{ sparePartId: sp.id, quantity: 1 }] }, tech.t);
        check('UniteFix stock without parts access is refused with what to do instead', noAccess.status === 409 && noAccess.body?.code === 'STOCK_UNAVAILABLE' && /Buy locally/.test(noAccess.body.message));
        await db.update(employees).set({ partsAccess: 'active' as any }).where(eq(employees.id, emp.id));
        const stock = await api.post(`/api/bookings/${job2}/part-requests/preview`, { items: [{ sparePartId: sp.id, quantity: 2, unitPriceRupees: 1 }] }, tech.t);
        check('UniteFix stock: the catalogue sets the price and the warranty', stock.status === 200 && stock.body.data.parts === 300 && stock.body.data.items[0].warranty.covered === true && /6-month part warranty from UniteFix/.test(stock.body.data.items[0].warranty.label), JSON.stringify(stock.body?.data?.items?.[0]));
        check('…nothing earlier is under warranty yet', stock.body.data.earlierWarranty === null);
        // The switch fitted on the first job now carries a 90-day warranty.
        await db.update(servicePartItems).set({ warrantyDays: 90, warrantyExpiresAt: new Date(Date.now() + 90 * 86_400_000) }).where(eq(servicePartItems.id, lines[0].id));
        const local2 = await api.post(`/api/bookings/${job2}/part-requests/preview`, { items: [fanSwitch] }, tech.t);
        check('the same part fitted on an earlier job, still under warranty, is pointed out', local2.body.data.earlierWarranty?.partName === 'Fan switch' && !!local2.body.data.earlierWarranty.warrantyUntil, JSON.stringify(local2.body?.data?.earlierWarranty));

        const techAsCustomer = jwt.sign({ userId: tech.u.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const selfJob = await book(techAsCustomer);
        const selfReq = await api.post(`/api/bookings/${selfJob}/part-requests`, { items: [fanSwitch], reason: 'Burnt contacts' }, tech.t);
        const selfAp = await api.post(`/api/part-requests/${selfReq.body.data.id}/approve`, {}, techAsCustomer);
        check('a technician who booked the job themselves still cannot approve their own request', selfAp.status === 403 && selfAp.body?.code === 'SELF_APPROVAL');

        (configService as any).cache.set('BUSINESS_CONFIG.PARTS_REQUIRE_CUSTOMER_APPROVAL', 'true'); (configService as any).cacheExpiry.set('BUSINESS_CONFIG.PARTS_REQUIRE_CUSTOMER_APPROVAL', Date.now() + 3_600_000);
        const legacy = await api.post(`/api/bookings/${job2}/request-payment`, { partItems: [{ ...fanSwitch }] }, tech.t);
        check('with approval required, parts typed straight into the bill are refused', legacy.status === 400 && legacy.body?.code === 'PARTS_NEED_APPROVAL');
        configService.invalidate('BUSINESS_CONFIG.PARTS_REQUIRE_CUSTOMER_APPROVAL');
        const legacyOk = await api.post(`/api/bookings/${job2}/request-payment`, { partItems: [{ ...fanSwitch }] }, tech.t);
        check('switched off (old app builds), the old path still works', legacyOk.status === 200);
    } finally {
        const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
        const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
        await cleanupPartners([], adminIds, [
            `DELETE FROM part_requests WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${ids})`,
            `DELETE FROM wallet_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM spare_part_movements WHERE service_request_id IN (${ids})`,
            `DELETE FROM service_part_items WHERE service_request_id IN (${ids})`,
            `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
            `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
            `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
            `DELETE FROM notifications WHERE user_id IN (${uids})`,
            `DELETE FROM service_requests WHERE id IN (${ids})`,
            `DELETE FROM spare_part_stock WHERE spare_part_id IN (${partIds.join(',') || 0})`,
            `DELETE FROM spare_parts WHERE id IN (${partIds.join(',') || 0})`,
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
