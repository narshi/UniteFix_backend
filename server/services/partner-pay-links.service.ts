/**
 * Online payment links for a partner's own customers.
 *
 * A partner sends a link for an invoice's balance (a sale, a consulting
 * session, an event's final invoice) or for an event milestone (an advance).
 * The customer pays on a UniteFix page through UniteFix's gateway. When the
 * money is captured:
 *
 *   invoice    → a payment is recorded against the invoice
 *   milestone  → the milestone is marked paid; before the final invoice that
 *                issues the receipt voucher, exactly as a hand-recorded one
 *   ledger     → online_collection −amount (UniteFix owes the partner) and
 *                gateway_fee +fee+GST; the next settlement pays the net
 *
 * The fee is invoiced on the monthly UniteFix fee invoice (already charged
 * here, so it is invoiced there, not charged again).
 *
 * Capture is idempotent: the signed callback from the page and Razorpay's
 * webhook both land on applyCapture, and whichever arrives second is a no-op.
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../db';
import { and, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import {
    partnerPayLinks, partnerInvoicePayments, partnerCustomers, eventMilestones, eventBookings, businessPartners, consultAppointments,
    type PartnerPayLink,
} from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { PartnerSalesService } from './partner-sales.service';
import { BusinessPartnerService } from './business-partner.service';
import { withTransaction } from '../lib/transaction';
import { configService } from './config.service';
import logger from '../lib/logger';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export class PartnerPayLinkService {
    private static razorpay: Razorpay | null = null;

    private static rzp(): Razorpay | null {
        if (this.razorpay) return this.razorpay;
        const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
        if (!id || !secret || id.includes('xxxxx')) return null;
        this.razorpay = new Razorpay({ key_id: id, key_secret: secret });
        return this.razorpay;
    }

    static gatewayReady() { return !!this.rzp(); }

    /** UniteFix's collection fee: a percentage of what was paid, GST on top. */
    static async fee(amountPaise: number) {
        const pct = Number(await configService.get<number>('BUSINESS_CONFIG.PARTNER_COLLECTION_FEE_PERCENT', 2));
        const gst = parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18');
        const fee = Math.round(amountPaise * Math.max(0, pct) / 100);
        return { percent: pct, feePaise: fee, feeGstPaise: Math.round(fee * gst / 100) };
    }

    static url(token: string) {
        return `/pay/${token}`;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Partner side
    // ══════════════════════════════════════════════════════════════════════

    /**
     * The open link for an invoice or a milestone — the same one again if it
     * is still right, a fresh one if the amount due changed.
     */
    static async create(ctx: Pick<HubContext, 'businessPartnerId' | 'adminUserId'>, input: { kind: 'invoice' | 'milestone'; refId: number; amountRupees?: number | null }) {
        const bpId = ctx.businessPartnerId;
        let amount: number, description: string, customerId: number | null;
        if (input.kind === 'invoice') {
            const inv = await PartnerSalesService.invoice(bpId, input.refId);
            if (!['tax_invoice', 'bill_of_supply'].includes(inv.doc.docKind) || inv.doc.status !== 'issued') throw new HubError('Only an issued invoice can be paid online.', 'BAD_DOC', 409);
            if (inv.outstandingPaise <= 0) throw new HubError('Nothing is outstanding on this invoice.', 'PAID', 409);
            amount = input.amountRupees != null ? Math.round(Number(input.amountRupees) * 100) : inv.outstandingPaise;
            if (!(amount >= 100)) throw new HubError('The smallest online payment is ₹1.', 'BAD_AMOUNT');
            if (amount > inv.outstandingPaise) throw new HubError(`Only ${rs(inv.outstandingPaise)} is outstanding on this invoice.`, 'OVERPAY');
            description = `Invoice ${inv.doc.number}`;
            customerId = inv.doc.partnerCustomerId ?? null;
        } else {
            const [m] = await db.select({ m: eventMilestones, b: eventBookings }).from(eventMilestones)
                .innerJoin(eventBookings, eq(eventBookings.id, eventMilestones.bookingId))
                .where(and(eq(eventMilestones.id, input.refId), eq(eventBookings.businessPartnerId, bpId))).limit(1);
            if (!m) throw new HubError('Not found', 'NOT_FOUND', 404);
            if (m.b.status === 'cancelled') throw new HubError('This booking is cancelled.', 'CANCELLED', 409);
            if (m.m.status === 'paid') throw new HubError('Already recorded as paid.', 'PAID', 409);
            amount = m.m.amountPaise;
            description = `${m.m.label} — ${m.b.title} on ${m.b.eventDate}`;
            customerId = m.b.customerId;
        }
        const [open] = await db.select().from(partnerPayLinks).where(and(
            eq(partnerPayLinks.businessPartnerId, bpId), eq(partnerPayLinks.kind, input.kind), eq(partnerPayLinks.refId, input.refId), eq(partnerPayLinks.status, 'open'))).limit(1);
        if (open && open.amountPaise === amount) return this.view(open);
        if (open) await db.update(partnerPayLinks).set({ status: 'cancelled', note: 'Replaced by a link for a different amount' }).where(and(eq(partnerPayLinks.id, open.id), eq(partnerPayLinks.status, 'open')));
        const [row] = await db.insert(partnerPayLinks).values({
            businessPartnerId: bpId, token: crypto.randomBytes(18).toString('base64url'), kind: input.kind, refId: input.refId, customerId,
            description, amountPaise: amount, createdByAdminUserId: ctx.adminUserId,
        }).returning();
        return this.view(row);
    }

    static async cancel(ctx: Pick<HubContext, 'businessPartnerId'>, id: number) {
        const [u] = await db.update(partnerPayLinks).set({ status: 'cancelled', note: 'Cancelled by the business' })
            .where(and(eq(partnerPayLinks.id, id), eq(partnerPayLinks.businessPartnerId, ctx.businessPartnerId), eq(partnerPayLinks.status, 'open'))).returning();
        if (!u) throw new HubError('Only an unpaid link can be cancelled.', 'BAD_STATE', 409);
        return this.view(u);
    }

    static async list(bpId: number, opts: { kind?: string; refId?: number; limit?: number } = {}) {
        const conds: any[] = [eq(partnerPayLinks.businessPartnerId, bpId)];
        if (opts.kind) conds.push(eq(partnerPayLinks.kind, opts.kind));
        if (opts.refId) conds.push(eq(partnerPayLinks.refId, opts.refId));
        const rows = await db.select({ l: partnerPayLinks, customer: partnerCustomers.name }).from(partnerPayLinks)
            .leftJoin(partnerCustomers, eq(partnerCustomers.id, partnerPayLinks.customerId))
            .where(and(...conds)).orderBy(desc(partnerPayLinks.createdAt)).limit(Math.min(500, opts.limit ?? 200));
        return rows.map(r => ({ ...this.view(r.l), customer: r.customer }));
    }

    static view(l: PartnerPayLink) {
        return {
            id: l.id, kind: l.kind, refId: l.refId, description: l.description, amount: l.amountPaise / 100, status: l.status,
            url: this.url(l.token), paidAt: l.paidAt, method: l.method, paymentId: l.razorpayPaymentId,
            fee: (l.feePaise + l.feeGstPaise) / 100, net: (l.amountPaise - l.feePaise - l.feeGstPaise) / 100, note: l.note, createdAt: l.createdAt,
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Customer side (no login — the token is the key)
    // ══════════════════════════════════════════════════════════════════════

    private static async byToken(token: string) {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HubError('This link is not valid.', 'NOT_FOUND', 404);
        const [row] = await db.select({ l: partnerPayLinks, partner: businessPartners.displayName, partnerPhone: businessPartners.contactPhone, customer: partnerCustomers })
            .from(partnerPayLinks)
            .innerJoin(businessPartners, eq(businessPartners.id, partnerPayLinks.businessPartnerId))
            .leftJoin(partnerCustomers, eq(partnerCustomers.id, partnerPayLinks.customerId))
            .where(eq(partnerPayLinks.token, token)).limit(1);
        if (!row) throw new HubError('This link is not valid.', 'NOT_FOUND', 404);
        return row;
    }

    static async publicView(token: string) {
        const r = await this.byToken(token);
        return {
            business: r.partner, businessPhone: r.partnerPhone, description: r.l.description, amount: r.l.amountPaise / 100, status: r.l.status,
            paidAt: r.l.paidAt, paymentId: r.l.status === 'paid' ? r.l.razorpayPaymentId : null,
            customerName: r.customer?.name ?? null, gateway: this.gatewayReady(),
        };
    }

    /** Start (or restart) a payment. The amount is checked against what is still due. */
    static async startPayment(token: string) {
        const r = await this.byToken(token);
        const l = r.l;
        if (l.status === 'paid') throw new HubError('This has already been paid. Thank you.', 'PAID', 409);
        if (l.status !== 'open') throw new HubError('This link is no longer active. Please ask the business for a new one.', 'CLOSED', 410);
        if (l.kind === 'invoice') {
            const inv = await PartnerSalesService.invoice(l.businessPartnerId, l.refId);
            if (inv.outstandingPaise < l.amountPaise) {
                await db.update(partnerPayLinks).set({ status: 'cancelled', note: 'The invoice was paid another way' }).where(eq(partnerPayLinks.id, l.id));
                throw new HubError('This invoice has been paid another way since the link was sent. Please ask the business for a new link if anything is still due.', 'CLOSED', 410);
            }
        } else {
            const [m] = await db.select().from(eventMilestones).where(eq(eventMilestones.id, l.refId)).limit(1);
            if (!m || m.status === 'paid') {
                await db.update(partnerPayLinks).set({ status: 'cancelled', note: 'The milestone was paid another way' }).where(eq(partnerPayLinks.id, l.id));
                throw new HubError('This has already been paid. Thank you.', 'PAID', 409);
            }
        }
        const rzp = this.rzp();
        if (!rzp) throw new HubError('Online payment is not available right now. Please pay the business directly.', 'NO_GATEWAY', 503);
        const ro = await rzp.orders.create({
            amount: l.amountPaise, currency: 'INR', receipt: `pl_${l.id}`,
            notes: { payment_type: 'partner_collection', pay_link_id: String(l.id), business_partner_id: String(l.businessPartnerId) },
        });
        await db.update(partnerPayLinks).set({ razorpayOrderId: ro.id }).where(eq(partnerPayLinks.id, l.id));
        return {
            orderId: ro.id, keyId: process.env.RAZORPAY_KEY_ID!, amount: l.amountPaise / 100, description: `${r.partner} — ${l.description}`,
            prefill: { name: r.customer?.name ?? '', email: r.customer?.email ?? '', phone: r.customer?.phone ?? '' },
        };
    }

    static verifySignature(orderId: string, paymentId: string, signature: string) {
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (!secret || !orderId || !paymentId || !signature) return false;
        const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
        return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    }

    /** The signed callback from the pay page. */
    static async confirm(token: string, b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
        const r = await this.byToken(token);
        if (!this.verifySignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new HubError('Payment could not be verified.', 'BAD_SIGNATURE', 400);
        if (r.l.razorpayOrderId !== b.razorpay_order_id) throw new HubError('Payment does not match this link.', 'MISMATCH', 400);
        await this.applyCapture({ linkId: r.l.id, razorpayOrderId: b.razorpay_order_id, razorpayPaymentId: b.razorpay_payment_id });
        return this.publicView(token);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Capture
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Money captured. Idempotent per link. The link, the ledger and (for an
     * invoice) the invoice payment are one transaction; a milestone is then
     * applied through the events service, which issues the receipt voucher.
     */
    static async applyCapture(params: { linkId?: number | null; razorpayOrderId?: string | null; razorpayPaymentId: string; amountPaise?: number; method?: string | null }) {
        const done = await withTransaction(async (tx) => {
            const cond = params.linkId ? eq(partnerPayLinks.id, params.linkId) : params.razorpayOrderId ? eq(partnerPayLinks.razorpayOrderId, params.razorpayOrderId) : null;
            if (!cond) throw new Error('No pay link to apply');
            const [l] = await tx.select().from(partnerPayLinks).where(cond).for('update');
            if (!l) throw new Error('Pay link not found');
            if (l.status === 'paid') return { link: l, applied: false };
            if (params.amountPaise != null && params.amountPaise < l.amountPaise) throw new Error(`Paid ${rs(params.amountPaise)}, expected ${rs(l.amountPaise)}`);
            const fee = await this.fee(l.amountPaise);
            let note: string | null = l.status === 'cancelled' ? 'Paid after the link was cancelled' : null;
            const meta = { payLinkId: l.id, razorpayPaymentId: params.razorpayPaymentId };
            await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: l.businessPartnerId, entryType: 'online_collection', amountPaise: -l.amountPaise, description: `Paid online — ${l.description}`, metadata: meta });
            if (fee.feePaise > 0) await BusinessPartnerService.appendLedger(tx as any, { businessPartnerId: l.businessPartnerId, entryType: 'gateway_fee', amountPaise: fee.feePaise + fee.feeGstPaise, description: `Online collection fee ${fee.percent}% + GST — ${l.description}`, metadata: meta });
            if (l.kind === 'invoice') {
                const inv = await PartnerSalesService.invoice(l.businessPartnerId, l.refId);
                if (inv.outstandingPaise < l.amountPaise) note = `${rs(l.amountPaise - inv.outstandingPaise)} more than was outstanding — refund it to the customer or adjust it on a later invoice`;
                await tx.insert(partnerInvoicePayments).values({
                    businessPartnerId: l.businessPartnerId, documentId: l.refId, amountPaise: l.amountPaise, method: 'online',
                    reference: params.razorpayPaymentId, receivedOn: today(), notes: 'Paid through the UniteFix payment link',
                });
            }
            const [u] = await tx.update(partnerPayLinks).set({
                status: 'paid', paidAt: new Date(), razorpayPaymentId: params.razorpayPaymentId, razorpayOrderId: params.razorpayOrderId ?? l.razorpayOrderId,
                method: params.method ?? null, feePaise: fee.feePaise, feeGstPaise: fee.feeGstPaise, note,
            }).where(eq(partnerPayLinks.id, l.id)).returning();
            return { link: u, applied: true };
        });
        if (!done.applied) return done;
        const l = done.link;
        if (l.kind === 'milestone') {
            try {
                const { PartnerEventsService } = await import('./partner-events.service');
                await PartnerEventsService.payMilestone({ businessPartnerId: l.businessPartnerId, adminUserId: null } as any, l.refId, { method: 'online', reference: l.razorpayPaymentId });
            } catch (e: any) {
                // The money is safe on the ledger; the business records it by hand.
                const note = e?.code === 'PAID' ? 'The milestone had already been recorded as paid — refund the customer or adjust the final invoice' : `Not recorded on the milestone (${e?.message}) — record it by hand`;
                await db.update(partnerPayLinks).set({ note }).where(eq(partnerPayLinks.id, l.id));
                logger.error(`[PAY-LINK] #${l.id} paid but milestone #${l.refId} not updated: ${e?.message}`);
            }
        }
        const { HubAlerts } = await import('./hub-alerts.service');
        const net = l.amountPaise - l.feePaise - l.feeGstPaise;
        void HubAlerts.send(l.businessPartnerId, 'payment_received', {
            title: `${rs(l.amountPaise)} paid online`, body: `${l.description}. ${rs(net)} comes to you in the next settlement, after the ${rs(l.feePaise + l.feeGstPaise)} collection fee.`,
            link: l.kind === 'invoice' ? `/partner/sales/invoices/${l.refId}` : '/partner/sales/payments', refType: 'pay_link', refId: l.id,
        });
        logger.info(`[PAY-LINK] #${l.id} paid ${rs(l.amountPaise)} — partner #${l.businessPartnerId}`);
        return done;
    }

    /** Fee totals for links paid in [from, to) — the monthly UniteFix fee invoice. */
    static async feesPaid(bpId: number, from: Date, to: Date) {
        const inRange = await db.select().from(partnerPayLinks).where(and(eq(partnerPayLinks.businessPartnerId, bpId), eq(partnerPayLinks.status, 'paid'),
            gte(partnerPayLinks.paidAt, from), lt(partnerPayLinks.paidAt, to), gt(partnerPayLinks.feePaise, 0)));
        return { n: inRange.length, feePaise: inRange.reduce((a, r) => a + r.feePaise, 0), gstPaise: inRange.reduce((a, r) => a + r.feeGstPaise, 0) };
    }

    /** The open invoice link for a consulting appointment, for its public page. */
    static async openForAppointment(appointmentId: number) {
        const [a] = await db.select({ inv: consultAppointments.invoiceDocumentId }).from(consultAppointments).where(eq(consultAppointments.id, appointmentId)).limit(1);
        if (!a?.inv) return null;
        const [l] = await db.select().from(partnerPayLinks).where(and(eq(partnerPayLinks.kind, 'invoice'), eq(partnerPayLinks.refId, a.inv), inArray(partnerPayLinks.status, ['open', 'paid']))).orderBy(desc(partnerPayLinks.createdAt)).limit(1);
        return l ? { url: this.url(l.token), amount: l.amountPaise / 100, status: l.status } : null;
    }
}
