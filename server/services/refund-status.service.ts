/**
 * Where a customer's refund stands, and the bank's word that it landed.
 *
 * A refund has two moments: UniteFix asks Razorpay for it ("refund_initiated",
 * written by PaymentService), and the bank actually returns the money, days
 * later. Razorpay reports the second with the refund.processed webhook (or
 * refund.failed); until this service, nothing listened, so the customer was
 * never told the money arrived — and the app told every cancelled booking
 * "your booking fee has been refunded", paid or not.
 *
 * Nothing here moves money. It records Razorpay's events (once each) and
 * reads the payment_transactions rows to say, per booking:
 *   not_paid   — nothing was ever taken online
 *   none       — paid, and UniteFix cancelled it keeping the money (no refund chosen)
 *   manual     — paid and cancelled, but no refund went out (it failed at the
 *                time): staff refund it by hand
 *   initiated  — Razorpay accepted the refund; the bank has not confirmed yet
 *   processed  — the bank returned it (with its reference, when Razorpay gives one)
 *   failed     — the bank could not return it; staff take over
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { paymentTransactions, serviceRequests } from '@shared/schema';
import { withTransaction } from '../lib/transaction';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export type RefundState = 'not_paid' | 'none' | 'manual' | 'initiated' | 'processed' | 'failed';

export interface RefundStatus {
    state: RefundState;
    /** Rupees asked back (initiated / processed / failed); null when unknown. */
    amount: number | null;
    startedAt: string | null;
    completedAt: string | null;
    /** The bank's reference (ARN / RRN / UTR) once Razorpay has one. */
    reference: string | null;
}

type BookingRow = { id: number; status: string | null; bookingFeeStatus?: string | null; cancelledByAdminId?: number | null };

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const refundIdOf = (m: any): string | null => (m && typeof m === 'object' && typeof m.refundId === 'string' ? m.refundId : null);

export class RefundStatusService {
    /**
     * Refund status for each booking that has one to show: every cancelled
     * booking, and any other booking money was refunded on (an invoice refund or
     * a dispute settled for the customer). Three small queries for the whole list.
     */
    static async forBookings(rows: BookingRow[]): Promise<Map<number, RefundStatus>> {
        const out = new Map<number, RefundStatus>();
        const ids = rows.map(r => r.id).filter(n => Number.isInteger(n));
        if (!ids.length) return out;

        // 1. Every refund event on these bookings.
        const refundRows = await db.select({
            serviceRequestId: paymentTransactions.serviceRequestId, eventType: paymentTransactions.eventType,
            amount: paymentTransactions.amount, metadata: paymentTransactions.metadata, createdAt: paymentTransactions.createdAt,
        }).from(paymentTransactions).where(and(
            inArray(paymentTransactions.serviceRequestId, ids),
            inArray(paymentTransactions.eventType, ['refund_initiated', 'refund_processed', 'refund_failed'] as any),
        ));
        const bySr = new Map<number, typeof refundRows>();
        for (const r of refundRows) {
            if (r.serviceRequestId == null) continue;
            if (!bySr.has(r.serviceRequestId)) bySr.set(r.serviceRequestId, []);
            bySr.get(r.serviceRequestId)!.push(r);
        }

        // 2. For cancelled bookings with no refund: was anything paid online?
        const needPaid = rows.filter(r => r.status === 'cancelled' && !bySr.has(r.id)).map(r => r.id);
        const paid = new Set<number>();
        // Read from the booking itself: a caller's list may not carry these columns.
        const facts = new Map<number, { bookingFeeStatus: string | null; cancelledByAdminId: number | null }>();
        if (needPaid.length) {
            const own = await db.select({ id: serviceRequests.id, bookingFeeStatus: serviceRequests.bookingFeeStatus, cancelledByAdminId: serviceRequests.cancelledByAdminId })
                .from(serviceRequests).where(inArray(serviceRequests.id, needPaid));
            for (const o of own) facts.set(o.id, { bookingFeeStatus: (o.bookingFeeStatus as string | null) ?? null, cancelledByAdminId: o.cancelledByAdminId ?? null });
            const orders = await db.select({ serviceRequestId: paymentTransactions.serviceRequestId, razorpayOrderId: paymentTransactions.razorpayOrderId })
                .from(paymentTransactions).where(and(inArray(paymentTransactions.serviceRequestId, needPaid), eq(paymentTransactions.eventType, 'order_created' as any)));
            const orderToSr = new Map<string, number>();
            for (const o of orders) if (o.razorpayOrderId && o.serviceRequestId != null) orderToSr.set(o.razorpayOrderId, o.serviceRequestId);
            const orderIds = Array.from(orderToSr.keys());
            const caps = await db.select({ serviceRequestId: paymentTransactions.serviceRequestId, razorpayOrderId: paymentTransactions.razorpayOrderId })
                .from(paymentTransactions).where(and(
                    eq(paymentTransactions.eventType, 'payment_captured' as any),
                    orderIds.length
                        ? or(inArray(paymentTransactions.serviceRequestId, needPaid), inArray(paymentTransactions.razorpayOrderId, orderIds))
                        : inArray(paymentTransactions.serviceRequestId, needPaid),
                ));
            for (const c of caps) {
                const sr = c.serviceRequestId ?? (c.razorpayOrderId ? orderToSr.get(c.razorpayOrderId) : undefined);
                if (sr != null) paid.add(sr);
            }
        }

        for (const b of rows) {
            const events = bySr.get(b.id);
            if (events?.length) {
                const started = events.filter(e => e.eventType === 'refund_initiated');
                const done = events.filter(e => e.eventType === 'refund_processed');
                const failed = events.filter(e => e.eventType === 'refund_failed');
                const doneIds = new Set(done.map(e => refundIdOf(e.metadata)).filter(Boolean));
                const startedIds = started.map(e => refundIdOf(e.metadata)).filter(Boolean) as string[];
                const openFailure = failed.some(f => { const id = refundIdOf(f.metadata); return !id || !doneIds.has(id); });
                const amountPaise = (started.length ? started : done).reduce((s, e) => s + (e.amount ?? 0), 0);
                const allDone = startedIds.length > 0 ? startedIds.every(id => doneIds.has(id)) : done.length > 0;
                const last = (list: typeof events) => list.reduce<Date | null>((m, e) => (e.createdAt && (!m || e.createdAt > m) ? e.createdAt : m), null);
                const first = started.reduce<Date | null>((m, e) => (e.createdAt && (!m || e.createdAt < m) ? e.createdAt : m), null);
                const reference = done.map(e => (e.metadata as any)?.reference).find((x: any) => typeof x === 'string' && x) ?? null;
                out.set(b.id, {
                    state: openFailure ? 'failed' : allDone ? 'processed' : 'initiated',
                    amount: amountPaise > 0 ? amountPaise / 100 : null,
                    startedAt: iso(first), completedAt: allDone && !openFailure ? iso(last(done)) : null, reference,
                });
                continue;
            }
            if (b.status !== 'cancelled') continue;
            const fact = facts.get(b.id);
            const feeStatus = fact?.bookingFeeStatus ?? b.bookingFeeStatus ?? null;
            if (feeStatus === 'refunded') {
                // Marked refunded before refund events were kept: Razorpay accepted it, no more is known.
                out.set(b.id, { state: 'initiated', amount: null, startedAt: null, completedAt: null, reference: null });
            } else if (!paid.has(b.id)) {
                out.set(b.id, { state: 'not_paid', amount: null, startedAt: null, completedAt: null, reference: null });
            } else {
                out.set(b.id, { state: (fact?.cancelledByAdminId ?? b.cancelledByAdminId) ? 'none' : 'manual', amount: null, startedAt: null, completedAt: null, reference: null });
            }
        }
        return out;
    }

    /**
     * Razorpay's refund.processed / refund.failed. Recorded once per refund (a
     * redelivered webhook is a no-op), linked to its booking through the notes
     * UniteFix set on the refund, or the refund_initiated row. Returns what to
     * tell the customer, or null when there is nothing new or no booking.
     */
    static async applyWebhook(kind: 'processed' | 'failed', r: any): Promise<null | { serviceRequestId: number; amountRupees: number; reference: string | null }> {
        const refundId = typeof r?.id === 'string' ? r.id : null;
        if (!refundId) return null;
        const eventType = kind === 'processed' ? 'refund_processed' : 'refund_failed';
        const reference: string | null = r?.acquirer_data?.arn || r?.acquirer_data?.rrn || r?.acquirer_data?.utr || null;
        const amountPaise = Number(r?.amount) || 0;

        const result = await withTransaction(async (tx) => {
            // Two deliveries of the same event cannot both record (and both notify).
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'refund:' + refundId}))`);
            const [dup] = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(
                eq(paymentTransactions.eventType, eventType as any), sql`${paymentTransactions.metadata}->>'refundId' = ${refundId}`,
            )).limit(1);
            if (dup) return { duplicate: true as const };

            let srId = Number.parseInt(String(r?.notes?.service_request_id ?? ''), 10);
            if (!Number.isFinite(srId)) {
                const [init] = await tx.select({ serviceRequestId: paymentTransactions.serviceRequestId }).from(paymentTransactions).where(and(
                    eq(paymentTransactions.eventType, 'refund_initiated' as any), sql`${paymentTransactions.metadata}->>'refundId' = ${refundId}`,
                )).limit(1);
                srId = init?.serviceRequestId ?? NaN;
            }
            await tx.insert(paymentTransactions).values({
                serviceRequestId: Number.isFinite(srId) ? srId : null,
                razorpayPaymentId: typeof r?.payment_id === 'string' ? r.payment_id : null,
                amount: amountPaise, currency: 'INR',
                eventType: eventType as any, status: (kind === 'processed' ? 'refunded' : 'failed') as any,
                metadata: { refundId, reference, refundStatus: r?.status ?? null, speed: r?.speed_processed ?? null, notes: r?.notes ?? null },
            });
            return { duplicate: false as const, srId: Number.isFinite(srId) ? srId : null };
        });

        if (result.duplicate) { logger.info(`[REFUND] ${eventType} for ${refundId} already recorded`); return null; }
        if (result.srId == null) { logger.info(`[REFUND] ${eventType} for ${refundId} recorded (not a booking refund)`); return null; }
        if (kind === 'failed') {
            logger.error(`[REFUND] Refund ${refundId} FAILED at the bank for SR ${result.srId} — refund the customer by hand`, { amountRupees: amountPaise / 100 });
            await recordAudit({ entityType: 'service_request', entityId: result.srId, action: 'refund_failed', metadata: { refundId, amountRupees: amountPaise / 100, refundStatus: r?.status ?? null } }).catch(() => {});
        } else {
            logger.info(`[REFUND] Refund ${refundId} processed for SR ${result.srId}: ₹${amountPaise / 100}${reference ? ` (ref ${reference})` : ''}`);
        }
        return { serviceRequestId: result.srId, amountRupees: amountPaise / 100, reference };
    }
}
