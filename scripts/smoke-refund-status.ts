/**
 * The customer is told where their refund stands: the app's booking list
 * carries `refund` (not_paid / none / manual / initiated / processed /
 * failed), Razorpay's refund.processed and refund.failed webhooks are
 * recorded once each and notify the customer, and a redelivered webhook does
 * not notify twice. Never calls Razorpay: payment rows are seeded.
 *
 *   npm run smoke:refund-status
 */

import jwt from 'jsonwebtoken';
import { and, eq, sql } from 'drizzle-orm';
import { bootServer, client, check, summary, db } from './lib/hub-test-kit';
import { users, serviceRequests, paymentTransactions, notifications } from '../shared/schema';
import { PaymentService } from '../server/services/payment.service';

const stamp = Date.now().toString(36);
const srIds: number[] = [];
let custId = 0;

async function main() {
    const { base, close } = await bootServer();
    const api = client(base);
    try {
        const [cu] = await db.insert(users).values({ phone: `7${String(Date.now()).slice(-9)}`, username: 'QA Refund Customer', role: 'user', isActive: true } as any).returning();
        custId = cu.id;
        const T = jwt.sign({ userId: cu.id, role: 'user' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
        let n = 0;
        const booking = async (extra: Record<string, unknown>) => {
            const [r] = await db.insert(serviceRequests).values({ userId: cu.id, serviceId: `QA-RF-${stamp}-${++n}`, serviceType: 'Fan repair', brand: 'x', model: 'x', description: 'QA refund', address: 'QA Road', pincode: '577201', ...extra } as any).returning();
            srIds.push(r.id); return r;
        };
        const paidOnline = async (srId: number, paise: number) => {
            const order = `order_QA${stamp}${srId}`;
            await db.insert(paymentTransactions).values({ serviceRequestId: srId, razorpayOrderId: order, amount: paise, eventType: 'order_created', status: 'pending', metadata: { paymentType: 'booking_charge' } } as any);
            await db.insert(paymentTransactions).values({ razorpayOrderId: order, razorpayPaymentId: `pay_QA${stamp}${srId}`, amount: paise, eventType: 'payment_captured', status: 'captured' } as any);
        };
        const started = async (srId: number, refundId: string, paise: number) =>
            db.insert(paymentTransactions).values({ serviceRequestId: srId, razorpayPaymentId: `pay_QA${stamp}${srId}`, amount: paise, eventType: 'refund_initiated', status: 'refunded', metadata: { refundId } } as any);
        const notes = async (type = 'refund_update') => (await db.select().from(notifications).where(and(eq(notifications.userId, cu.id), eq(notifications.type as any, type))));
        const mine = async () => {
            const r = await api.get('/api/services/my-requests', T);
            return new Map<number, any>((r.body?.data ?? []).map((x: any) => [x.id, x]));
        };

        const a = await booking({ status: 'cancelled', bookingFeeStatus: 'pending' });                                  // never paid
        const b = await booking({ status: 'cancelled', bookingFeeStatus: 'paid' }); await paidOnline(b.id, 9900);        // paid, refund failed at cancel time
        const c = await booking({ status: 'cancelled', bookingFeeStatus: 'paid', cancelledByAdminId: 1, refundPaise: 0 }); await paidOnline(c.id, 9900); // UniteFix kept it
        const d = await booking({ status: 'cancelled', bookingFeeStatus: 'refunded' }); await paidOnline(d.id, 9900);
        const rfD = `rfnd_QA${stamp}d`; await started(d.id, rfD, 9900);                                              // refund on its way
        const e = await booking({ status: 'cancelled', bookingFeeStatus: 'refunded' }); await paidOnline(e.id, 19900);
        const rfE = `rfnd_QA${stamp}e`; await started(e.id, rfE, 19900);
        const f = await booking({ status: 'completed', bookingFeeStatus: 'paid' });                                       // invoice refund on a finished job
        const rfF = `rfnd_QA${stamp}f`; await started(f.id, rfF, 50000);
        const g = await booking({ status: 'in_progress', bookingFeeStatus: 'paid' });                                     // nothing to say

        let m = await mine();
        check('never paid: "no payment was taken"', m.get(a.id)?.refund?.state === 'not_paid', JSON.stringify(m.get(a.id)?.refund));
        check('paid but no refund went out: "being handled by our team"', m.get(b.id)?.refund?.state === 'manual', JSON.stringify(m.get(b.id)?.refund));
        check('UniteFix cancelled keeping the money: "no refund was made"', m.get(c.id)?.refund?.state === 'none', JSON.stringify(m.get(c.id)?.refund));
        check('refund started: on its way, with amount and date', m.get(d.id)?.refund?.state === 'initiated' && m.get(d.id)?.refund?.amount === 99 && !!m.get(d.id)?.refund?.startedAt, JSON.stringify(m.get(d.id)?.refund));
        check('a refund on a finished job shows too', m.get(f.id)?.refund?.state === 'initiated' && m.get(f.id)?.refund?.amount === 500);
        check('a booking with no refund to tell carries none', m.get(g.id) && m.get(g.id).refund === undefined);

        // Razorpay: refund.processed (with the bank's ARN), delivered twice.
        const processed = { refund: { entity: { id: rfD, payment_id: `pay_QA${stamp}${d.id}`, amount: 9900, status: 'processed', acquirer_data: { arn: `ARN${stamp}` }, notes: { service_request_id: String(d.id) } } } };
        await PaymentService.handleWebhook('refund.processed', processed);
        await new Promise(r => setTimeout(r, 400));
        m = await mine();
        check('refund.processed: the booking says refunded, with the bank reference', m.get(d.id)?.refund?.state === 'processed' && m.get(d.id)?.refund?.reference === `ARN${stamp}` && !!m.get(d.id)?.refund?.completedAt, JSON.stringify(m.get(d.id)?.refund));
        const n1 = await notes();
        check('…and the customer is told it arrived, with the reference', n1.length === 1 && /Refund completed/.test(n1[0].title) && n1[0].body.includes('₹99') && n1[0].body.includes(`ARN${stamp}`), JSON.stringify(n1.map(x => x.title + ": " + x.body)).slice(0, 240));
        await PaymentService.handleWebhook('refund.processed', processed);
        await new Promise(r => setTimeout(r, 400));
        const rows = await db.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(eq(paymentTransactions.eventType, 'refund_processed' as any), sql`${paymentTransactions.metadata}->>'refundId' = ${rfD}`));
        check('a redelivered webhook is recorded once and does not notify twice', rows.length === 1 && (await notes()).length === 1);

        // No notes on the refund (an older refund): found through the refund_initiated row.
        await PaymentService.handleWebhook('refund.failed', { refund: { entity: { id: rfE, payment_id: `pay_QA${stamp}${e.id}`, amount: 19900, status: 'failed' } } });
        await new Promise(r => setTimeout(r, 400));
        m = await mine();
        check('refund.failed: the booking says our team will refund it another way', m.get(e.id)?.refund?.state === 'failed', JSON.stringify(m.get(e.id)?.refund));
        const n2 = await notes();
        check('…the customer is told', n2.some(x => /Refund delayed/.test(x.title) && x.body.includes('₹199')));
        const [audit] = (await db.execute(sql`SELECT action FROM audit_logs WHERE entity_type = 'service_request' AND entity_id = ${e.id} AND action = 'refund_failed'`) as any).rows;
        check('…and staff have it in the audit log', !!audit);

        // A refund that is not for a booking (no notes, no initiated row): recorded, nobody notified.
        const before = (await notes()).length;
        await PaymentService.handleWebhook('refund.processed', { refund: { entity: { id: `rfnd_QA${stamp}x`, amount: 1000, status: 'processed' } } });
        check('a refund for something else is recorded without notifying a customer', (await notes()).length === before);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    const ids = srIds.join(',') || '0';
    await db.execute(sql.raw(`DELETE FROM payment_transactions WHERE service_request_id IN (${ids}) OR razorpay_order_id LIKE 'order_QA${stamp}%' OR metadata->>'refundId' LIKE 'rfnd_QA${stamp}%'`));
    await db.execute(sql.raw(`DELETE FROM audit_logs WHERE entity_type = 'service_request' AND entity_id IN (${ids})`));
    await db.execute(sql.raw(`DELETE FROM notifications WHERE user_id = ${custId || 0}`));
    await db.execute(sql.raw(`DELETE FROM service_requests WHERE id IN (${ids})`));
    await db.execute(sql.raw(`DELETE FROM users WHERE id = ${custId || 0}`));
    process.exit(summary());
});
