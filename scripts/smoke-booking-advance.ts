/**
 * The ₹99 booking fee is the customer's ADVANCE towards a catalog price, not
 * a deduction from the technician.
 *
 *   technicianEarning = P − GST − platform fee      (GST + fee + earning = P)
 *   customer pays     = ₹99 when booking + (P − 99) after the service
 *   cash collected    → wallet settled by net = finalTotal − technicianEarning:
 *                       debit when positive, CREDIT when negative (₹349 → +₹3.88)
 *
 * Bookings frozen before the change keep their old split and settle as before.
 *
 *   npm run smoke:booking-advance
 */

import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, serviceCategories, services, serviceRequests, partnerWallets, walletTransactionsV2 } from '../shared/schema';
import { BillingEngine, type PricingSnapshot } from '../server/services/billing-engine';

const stamp = Date.now().toString(36);
const userIds: number[] = [], catIds: number[] = [], svcIds: number[] = [];
const r2 = (x: number) => Math.round(x * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function main() {
    // ── the split ──
    const s799 = await BillingEngine.createCatalogSnapshot(799, { bookingFee: 99, platformFeePercent: 12 });
    const exact = s799.gstPercent === 18 && (s799.discountPercent ?? 0) === 0;
    check('₹799: GST 121.88 (inside the price), fee 95.88, technician 581.24 — the ₹99 is not taken from them',
        !exact || (s799.gst === 121.88 && s799.platformFee === 95.88 && s799.technicianEarning === 581.24), JSON.stringify({ gst: s799.gst, fee: s799.platformFee, tech: s799.technicianEarning, gstPct: s799.gstPercent, disc: s799.discountPercent }));
    check('…GST + platform fee + technician = the price, exactly', near(s799.gst! + s799.platformFee! + s799.technicianEarning!, s799.basePrice!));
    check('…customer pays ₹99 now and the rest after (finalTotal = P − 99)', s799.bookingFee === 99 && s799.finalTotal === r2(s799.basePrice! - 99) && s799.bookingFeeCredit === 99);
    check('…and the snapshot is marked as the advance model', s799.bookingFeeModel === 'advance' && s799.snapshotVersion === 2);
    check('cash on ₹799: the technician owes UniteFix fee + GST − ₹99 (debit 118.76)', !exact || BillingEngine.calculateCashDebitAmount(s799) === 118.76, String(BillingEngine.calculateCashDebitAmount(s799)));

    const s349 = await BillingEngine.createCatalogSnapshot(349, { bookingFee: 99, platformFeePercent: 12 });
    const net349 = BillingEngine.calculateCashDebitAmount(s349);
    check('₹349 inspection: fee + GST (95.12) is less than the ₹99 advance → UniteFix owes the technician 3.88',
        !exact || (s349.technicianEarning === 253.88 && s349.finalTotal === 250 && net349 === -3.88), JSON.stringify({ tech: s349.technicianEarning, final: s349.finalTotal, net349 }));
    check('…in general: net = (fee + GST) − ₹99 = finalTotal − earning', near(net349, r2(s349.platformFee! + s349.gst! - 99)) && near(net349, r2(s349.finalTotal! - s349.technicianEarning!)));

    const q2 = await BillingEngine.createCatalogSnapshotForQuantity(499, 2, { bookingFee: 99, platformFeePercent: 12 });
    check('two units: the earning doubles with the price, and one ₹99 advance covers the visit', near(q2.technicianEarning!, r2(998 - q2.gst! - q2.platformFee!)) && q2.finalTotal === 899);

    // A booking frozen before the change: its ₹99 was UniteFix's and was taken from the earning.
    const old: PricingSnapshot = { ...s799, bookingFeeModel: undefined, technicianEarning: r2(s799.technicianEarning! - 99), employeeEarnings: r2(s799.technicianEarning! - 99) };
    check('a booking frozen before the change settles exactly as before (debit fee + GST)', near(BillingEngine.calculateCashDebitAmount(old), r2(old.platformFee! + old.cgst! + old.sgst!)));

    const v1 = BillingEngine.calculateFinalBill(500, 300, await BillingEngine.createBookingSnapshot({ bookingFee: 99 }));
    check('bill-submission bookings keep their own rule (fee + GST)', near(BillingEngine.calculateCashDebitAmount(v1), v1.platformFee! + v1.cgst! + v1.sgst!));

    // ── cash collected, end to end ──
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const n = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
    try {
        const [cat] = await db.insert(serviceCategories).values({ name: `QA Adv ${stamp}`, bookingFee: 99 }).returning(); catIds.push(cat.id);
        const [cheap] = await db.insert(services).values({ categoryId: cat.id, name: `QA Adv inspect ${stamp}`, basePrice: 299 }).returning(); svcIds.push(cheap.id);
        const [dear] = await db.insert(services).values({ categoryId: cat.id, name: `QA Adv AC ${stamp}`, basePrice: 1499 }).returning(); svcIds.push(dear.id);
        const [cu] = await db.insert(users).values({ phone: `8${n()}`, username: 'QA Adv Customer', role: 'user', homeAddress: 'Sirsi 581401', pinCode: '581401' } as any).returning(); userIds.push(cu.id);
        const ct = jwt.sign({ userId: cu.id, role: 'user' }, SECRET, { expiresIn: '1h' });
        const [tu] = await db.insert(users).values({ phone: `9${n()}`, username: 'QA Adv Tech', role: 'serviceman', homeAddress: 'Sirsi', pinCode: '581401' } as any).returning(); userIds.push(tu.id);
        const [emp] = await db.insert(employees).values({ userId: tu.id, fullName: 'QA Adv Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const tt = jwt.sign({ userId: tu.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        await db.insert(partnerWallets).values({ partnerId: emp.id, balanceAvailable: '0.00', balanceHold: '0.00', totalEarned: '0.00' } as any);

        const book = async (svcId: number) => {
            const b = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: svcId }, ct);
            const id = b.body?.data?.id;
            await db.update(serviceRequests).set({ providerId: emp.id, status: 'pending_payment' as any }).where(eq(serviceRequests.id, id));
            const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id));
            return { id, snap: sr.pricingSnapshot as PricingSnapshot };
        };
        const wallet = async () => (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp.id)))[0];

        // ₹299: the advance more than covers UniteFix's fee + GST at either 12% or 15% —
        // the technician is credited the difference.
        const a = await book(cheap.id);
        check('a ₹299 booking is frozen on the advance model', a.snap?.bookingFeeModel === 'advance' && a.snap.finalTotal === r2(a.snap.basePrice! - 99), JSON.stringify(a.snap ?? null).slice(0, 160));
        const owed = r2(a.snap.technicianEarning! - a.snap.finalTotal!);
        const c1 = await api.post(`/api/bookings/${a.id}/cash-collected`, { amountCollected: a.snap.finalTotal }, tt);
        const w1 = await wallet();
        const hold1 = await db.select().from(walletTransactionsV2).where(and(eq(walletTransactionsV2.serviceRequestId, a.id), eq(walletTransactionsV2.transactionType, 'hold_credit')));
        check('…its fee + GST is less than the ₹99 advance', a.snap.platformFee! + a.snap.gst! < 99);
        check(`₹299 cash: nothing debited, ₹${owed} credited so the technician ends with their full ₹${a.snap.technicianEarning}`,
            c1.status === 200 && c1.body.data.platformFeeDeducted === 0 && near(c1.body.data.walletCredited, owed) && hold1.length === 1 && near(Number(hold1[0].amount), owed) && near(Number(w1.balanceHold), owed),
            JSON.stringify({ status: c1.status, body: c1.body?.data, hold: hold1.map(h => h.amount), w: w1 && [w1.balanceAvailable, w1.balanceHold] }));
        check('…cash in hand + credit = the technician\'s earning', near(a.snap.finalTotal! + owed, a.snap.technicianEarning!));
        check('…the credit is held like other earnings and does not count as an extra completed job', !!hold1[0]?.releaseDate && /booking advance/i.test(hold1[0]?.description ?? '') && Number((await db.select().from(employees).where(eq(employees.id, emp.id)))[0].totalServicesCompleted ?? 0) === 0);
        const again = await api.post(`/api/bookings/${a.id}/cash-collected`, { amountCollected: a.snap.finalTotal }, tt);
        check('…recording the cash twice credits once', again.status === 200 && (await db.select().from(walletTransactionsV2).where(eq(walletTransactionsV2.serviceRequestId, a.id))).length === 1);

        // ₹1,499: UniteFix's share is more than the advance — the technician is debited the difference.
        const b = await book(dear.id);
        const dues = r2(b.snap.finalTotal! - b.snap.technicianEarning!);
        const before = Number((await wallet()).balanceAvailable);
        const c2 = await api.post(`/api/bookings/${b.id}/cash-collected`, { amountCollected: b.snap.finalTotal }, tt);
        const after = Number((await wallet()).balanceAvailable);
        check(`₹1,499 cash: debited ₹${dues} = fee + GST − ₹99, nothing credited`,
            c2.status === 200 && near(c2.body.data.platformFeeDeducted, dues) && c2.body.data.walletCredited === 0 && near(before - after, dues) && near(dues, r2(b.snap.platformFee! + b.snap.gst! - 99)),
            JSON.stringify({ status: c2.status, body: c2.body?.data, before, after }));
        check('…cash in hand − debit = the technician\'s earning', near(b.snap.finalTotal! - dues, b.snap.technicianEarning!));

        // ── a technician with no wallet record yet ──
        const [tu2] = await db.insert(users).values({ phone: `9${n()}`, username: 'QA Adv New Tech', role: 'serviceman', homeAddress: 'Sirsi', pinCode: '581401' } as any).returning(); userIds.push(tu2.id);
        const [emp2] = await db.insert(employees).values({ userId: tu2.id, fullName: 'QA Adv New Tech', isActive: true, documentVerificationStatus: 'verified' as any } as any).returning();
        const tt2 = jwt.sign({ userId: tu2.id, role: 'serviceman' }, SECRET, { expiresIn: '1h' });
        check('the new technician has no wallet record yet', (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp2.id))).length === 0);
        const bk = await api.post('/api/services/create', { serviceType: 'QA', description: 'QA', address: 'Main road, Sirsi 581401', pinCode: '581401', catalogServiceId: dear.id }, ct);
        await db.update(serviceRequests).set({ providerId: emp2.id, status: 'pending_payment' as any }).where(eq(serviceRequests.id, bk.body.data.id));
        const [sr3] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, bk.body.data.id));
        const snap3 = sr3.pricingSnapshot as PricingSnapshot;
        const dues3 = r2(snap3.finalTotal! - snap3.technicianEarning!);
        const c3 = await api.post(`/api/bookings/${sr3.id}/cash-collected`, { amountCollected: snap3.finalTotal }, tt2);
        const [w3] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp2.id));
        const tx3 = await db.select().from(walletTransactionsV2).where(eq(walletTransactionsV2.partnerId, emp2.id));
        const [e3] = await db.select().from(employees).where(eq(employees.id, emp2.id));
        check('their first cash job creates the wallet payouts read, and the dues are in it', c3.status === 200 && !!w3 && near(Number(w3.balanceAvailable), -dues3), JSON.stringify({ status: c3.status, w3 }));
        check('…recorded as platform dues (commission_deduction), not a bank withdrawal', tx3.length === 1 && tx3[0].transactionType === 'commission_deduction' && near(Number(tx3[0].amount), dues3));
        check('…and the older balance column is kept in step', near(Number(e3.walletBalance), -dues3));

        // Manual admin deduction: checked against the wallet payouts read.
        const { storage } = await import('../server/storage');
        check('an admin deduction larger than the wallet is refused', await storage.deductProviderWallet(emp2.id, 5, 'QA manual').then(() => false, (e: any) => /Insufficient wallet balance/.test(e.message)));
        await db.update(partnerWallets).set({ balanceAvailable: '50.00' }).where(eq(partnerWallets.partnerId, emp2.id));
        await storage.deductProviderWallet(emp2.id, 20, 'QA manual');
        const [w4] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, emp2.id));
        const tx4 = await db.select().from(walletTransactionsV2).where(and(eq(walletTransactionsV2.partnerId, emp2.id), eq(walletTransactionsV2.transactionType, 'adjustment')));
        check('…one within it is taken from the wallet and recorded as an adjustment', near(Number(w4.balanceAvailable), 30) && tx4.length === 1);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const srs = userIds.length ? await db.select({ id: serviceRequests.id }).from(serviceRequests).where(inArray(serviceRequests.userId, userIds)) : [];
    const ids = srs.map(s => s.id).join(',') || '0', uids = userIds.join(',') || '0';
    await cleanupPartners([], [], [
        `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${ids}) OR partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM invoices WHERE service_request_id IN (${ids})`,
        `DELETE FROM payment_transactions WHERE service_request_id IN (${ids})`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM service_requests WHERE id IN (${ids})`,
        `DELETE FROM services WHERE id IN (${svcIds.join(',') || 0})`,
        `DELETE FROM service_categories WHERE id IN (${catIds.join(',') || 0})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
