/**
 * Staff cancel or close a booking from the admin, and the completion credits
 * those rely on: an online-paid job credits the expert's earning once (held),
 * and a General booking credits the bill's earning, not a share of the fee.
 *
 * No Razorpay calls: refunds are exercised up to their validation only.
 *
 *   npm run smoke:booking-admin
 */

import { eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, cleanupPartners, db } from './lib/hub-test-kit';
import { users, employees, serviceRequests, partnerWallets, paymentTransactions, businessPartnerLedger, partnerJobEarnings } from '../shared/schema';
import { BillingEngine } from '../server/services/billing-engine';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { storage } from '../server/storage';

const stamp = Date.now().toString(36);
const userIds: number[] = [], adminIds: number[] = [], bpIds: number[] = [];
let n = 0;
const phone = () => `6${String(Date.now() + ++n).slice(-9)}`;
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.011;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const S = (await api.login(sa.username, sa.password))!;
        const [cu] = await db.insert(users).values({ phone: phone(), username: 'QA BA Customer', role: 'user', isActive: true } as any).returning(); userIds.push(cu.id);
        const expert = async (managedBy: number | null = null) => {
            const [u] = await db.insert(users).values({ phone: phone(), username: 'QA BA Expert', role: 'serviceman', isActive: true } as any).returning(); userIds.push(u.id);
            const [e] = await db.insert(employees).values({ userId: u.id, fullName: 'QA BA Expert', documentVerificationStatus: 'verified', isActive: true, managedByPartnerId: managedBy } as any).returning();
            return e;
        };
        const wallet = async (id: number) => (await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, id)))[0];
        const booking = async (extra: Record<string, unknown>) => (await db.insert(serviceRequests).values({
            userId: cu.id, serviceId: `QA-BA-${stamp}-${++n}`, serviceType: 'QA job', brand: 'x', model: 'x', description: 'QA', address: 'x', ...extra,
        } as any).returning())[0];
        const s799 = await BillingEngine.createCatalogSnapshot(799, { bookingFee: 99 });

        // ── Completion credits ──
        const e1 = await expert();
        const b1 = await booking({ status: 'pending_payment', providerId: e1.id, bookingFeeStatus: 'paid', pricingSnapshot: s799 });
        await storage.updateServiceRequestStatus(b1.id, 'completed');
        await storage.updateServiceRequest(b1.id, { paymentMethod: 'online' as any });
        const w1 = await wallet(e1.id);
        check('an online-paid fixed-price job credits the earning once, held', near(w1?.balanceHold, s799.technicianEarning!) && near(w1?.balanceAvailable, 0), JSON.stringify(w1));

        const v1 = BillingEngine.calculateFinalBill(300, 500, await BillingEngine.createBookingSnapshot({ bookingFee: 99 }));
        const e2 = await expert();
        const b2 = await booking({ status: 'pending_payment', providerId: e2.id, bookingFeeStatus: 'paid', pricingSnapshot: v1 });
        await storage.updateServiceRequestStatus(b2.id, 'completed');
        const w2 = await wallet(e2.id);
        check('an online-paid General booking credits the expert’s bill (₹800), not a share of the booking fee', near(w2?.balanceHold, 800), JSON.stringify(w2));

        // ── Cancel ──
        const unpaid = await booking({ status: 'created', bookingFeeStatus: 'pending' });
        check('a reason is required to cancel', (await api.post(`/api/admin/services/${unpaid.id}/cancel`, { reason: '' }, S)).body?.code === 'NO_REASON');
        const c1 = await api.post(`/api/admin/services/${unpaid.id}/cancel`, { reason: 'Customer asked on the phone' }, S);
        const [u1] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, unpaid.id));
        check('an unpaid booking cancels with no refund, reason kept', c1.status === 200 && u1.status === 'cancelled' && u1.cancelReason === 'Customer asked on the phone' && u1.cancelledByAdminId === sa.id && u1.refundPaise === 0, JSON.stringify(c1.body));
        check('a cancelled booking cannot be cancelled again', (await api.post(`/api/admin/services/${unpaid.id}/cancel`, { reason: 'again' }, S)).status === 409);

        // A paid advance with a captured payment: refund validation (no Razorpay call).
        const e3 = await expert();
        const inWork = await booking({ status: 'in_progress', providerId: e3.id, bookingFeeStatus: 'paid', pricingSnapshot: s799 });
        const order = `order_QA${stamp}`;
        await db.insert(paymentTransactions).values([
            { serviceRequestId: inWork.id, razorpayOrderId: order, amount: 9900, currency: 'INR', eventType: 'order_created', status: 'pending', metadata: { paymentType: 'booking_charge' } },
            { razorpayOrderId: order, razorpayPaymentId: `pay_QA${stamp}`, amount: 9900, currency: 'INR', eventType: 'payment_captured', status: 'captured' },
        ] as any);
        const pv = await api.get(`/api/admin/services/${inWork.id}/cancel-preview`, S);
        check('cancel preview shows what the customer paid online and that an expert is on it', pv.body?.data?.paidOnline === 99 && pv.body.data.hasExpert === true, JSON.stringify(pv.body));
        const tooMuch = await api.post(`/api/admin/services/${inWork.id}/cancel`, { reason: 'Test', refund: 'partial', refundRupees: 150 }, S);
        check('a part refund above what was paid is refused, and nothing is cancelled', tooMuch.body?.code === 'BAD_REFUND' && (await db.select().from(serviceRequests).where(eq(serviceRequests.id, inWork.id)))[0].status === 'in_progress');
        const c2 = await api.post(`/api/admin/services/${inWork.id}/cancel`, { reason: 'Part not available for weeks', refund: 'none', visitPayRupees: 150 }, S);
        const [u2] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, inWork.id));
        const w3 = await wallet(e3.id);
        check('a job in progress can be cancelled with no refund and visit pay for the expert', c2.status === 200 && u2.status === 'cancelled' && u2.visitPayPaise === 15000 && near(w3?.balanceHold, 150), JSON.stringify(c2.body));
        const audit = (await db.execute(sql`SELECT action, metadata FROM audit_logs WHERE entity_type = 'service_request' AND entity_id = ${inWork.id} AND action = 'admin_cancelled'`) as any).rows[0];
        check('…and it is in the audit trail with the reason and the money', audit?.metadata?.visitPayRupees === 150 && audit.metadata.reason === 'Part not available for weeks');

        // ── Close ──
        const e4 = await expert();
        const cash = await booking({ status: 'in_progress', providerId: e4.id, bookingFeeStatus: 'paid', pricingSnapshot: s799 });
        check('closing needs a note', (await api.post(`/api/admin/services/${cash.id}/close`, { method: 'expert_cash', amountRupees: 700, note: '' }, S)).body?.code === 'NO_NOTE');
        check('closing with an amount other than the bill’s balance is refused', (await api.post(`/api/admin/services/${cash.id}/close`, { method: 'expert_cash', amountRupees: 500, note: 'Phone died' }, S)).body?.code === 'AMOUNT_MISMATCH');
        const k1 = await api.post(`/api/admin/services/${cash.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'Expert phone died after the job' }, S);
        const [k1r] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, cash.id));
        const w4 = await wallet(e4.id);
        const debit = BillingEngine.calculateCashDebitAmount(s799);
        check('cash to the expert: completed, and the wallet is debited UniteFix’s share exactly as “Cash collected” does', k1.status === 200 && k1r.status === 'completed' && k1r.paymentMethod === 'cash' && k1r.closeMethod === 'expert_cash' && k1r.closedByAdminId === sa.id && near(w4?.balanceAvailable, -debit), JSON.stringify({ body: k1.body, w4, debit }));
        check('closing twice is refused', (await api.post(`/api/admin/services/${cash.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'again' }, S)).status === 409);

        const e5 = await expert();
        const upi = await booking({ status: 'pending_payment', providerId: e5.id, bookingFeeStatus: 'paid', pricingSnapshot: s799 });
        check('UPI to UniteFix needs the reference', (await api.post(`/api/admin/services/${upi.id}/close`, { method: 'upi', amountRupees: 700, note: 'Paid to office UPI' }, S)).body?.code === 'NO_REFERENCE');
        const k2 = await api.post(`/api/admin/services/${upi.id}/close`, { method: 'upi', amountRupees: 700, reference: '412345678901', note: 'Paid to office UPI' }, S);
        const w5 = await wallet(e5.id);
        check('paid to UniteFix: completed, and the expert’s earning is credited, held', k2.status === 200 && near(w5?.balanceHold, s799.technicianEarning!) && near(w5?.balanceAvailable, 0), JSON.stringify({ body: k2.body, w5 }));

        const unbilled = await booking({ status: 'in_progress', providerId: e5.id, bookingFeeStatus: 'paid', pricingSnapshot: await BillingEngine.createBookingSnapshot({ bookingFee: 99 }) });
        check('a General booking with no bill yet cannot be closed', (await api.post(`/api/admin/services/${unbilled.id}/close`, { method: 'expert_cash', amountRupees: 0, note: 'x x x' }, S)).body?.code === 'NO_BILL');
        const noExpert = await booking({ status: 'created', bookingFeeStatus: 'paid', pricingSnapshot: s799 });
        check('a job nobody is working on cannot be closed', (await api.post(`/api/admin/services/${noExpert.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'x x x' }, S)).status === 409);

        // A partner's technician: the partner is charged the cash and credited the job's value.
        const bp = await BusinessPartnerService.create({ legalName: `QA BA Partner ${stamp}`, contactPhone: phone(), contactEmail: `qa_ba_${stamp}@example.test`, verticalCodes: ['electrical'], approvedByAdminId: sa.id } as any);
        bpIds.push(bp.id);
        const pt = await expert(bp.id);
        const pjob = await booking({ status: 'in_progress', providerId: pt.id, bookingFeeStatus: 'paid', pricingSnapshot: s799, dispatchPartnerId: bp.id });
        const k3 = await api.post(`/api/admin/services/${pjob.id}/close`, { method: 'expert_cash', amountRupees: 700, note: 'Partner confirmed cash' }, S);
        const led = await db.select().from(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, bp.id));
        const held = await db.select().from(partnerJobEarnings).where(eq(partnerJobEarnings.serviceRequestId, pjob.id));
        check('a partner technician’s cash job closed by staff: the partner’s default 20% commission is held for them, and the partner is not charged the cash', k3.status === 200 && !led.some(l => l.entryType === 'cash_collected') && held.length === 1 && near(held[0].amountPaise / 100, Math.round(s799.technicianEarning! * 20) / 100), JSON.stringify({ body: k3.body, led: led.map(l => [l.entryType, l.amountPaise]), held }));
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const uids = userIds.join(',') || '0';
    const srs = `SELECT id FROM service_requests WHERE service_id LIKE 'QA-BA-${stamp}-%'`;
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM payment_transactions WHERE service_request_id IN (${srs}) OR razorpay_order_id = 'order_QA${stamp}'`,
        `DELETE FROM partner_job_earnings WHERE service_request_id IN (${srs})`,
        `DELETE FROM invoices WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions WHERE service_request_id IN (${srs})`,
        `DELETE FROM wallet_transactions_v2 WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM wallet_transactions WHERE provider_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${srs})`,
        `DELETE FROM part_requests WHERE service_request_id IN (${srs})`,
        `DELETE FROM service_requests WHERE service_id LIKE 'QA-BA-${stamp}-%'`,
        `DELETE FROM partner_wallets WHERE partner_id IN (SELECT id FROM employees WHERE user_id IN (${uids}))`,
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM employees WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
