/**
 * Book by call (admin → Book by call): a customer phones UniteFix and staff
 * book the service for them.
 *
 * The booking is the same as one made in the app — same catalogue price,
 * partner-territory routing, queue, notifications and bill — and is marked
 * booked_via = 'call', with the staff member and their note. Two ways to pay:
 *
 *   link (default)  — the booking fee, as in the app. A Razorpay payment link
 *                     goes to the customer by SMS (and email, when given) and
 *                     WhatsApp (whatsapp.service.ts); they can also pay from the
 *                     booking in the app. The booking waits, out of the queue,
 *                     until paid (webhook payment_link.paid → linkPaid). Unpaid
 *                     for 7 days, it is closed (task_queues.ts). Staff can resend
 *                     the link, or switch it to pay after the service.
 *   after_service   — nothing now: no booking fee, the full bill after the
 *                     service. In the queue at once.
 *
 * The customer is found by phone, or created (name and phone) when new; their
 * app shows the booking when they sign in with that number.
 *
 * Visit and consultation services only. Inspection bookings take their fee up
 * front in the app (it is the expert's visit pay if the quote is declined),
 * free-quote services are enquiries, and recharges are not booked.
 */

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { withTransaction } from '../lib/transaction';
import { serviceRequests, services as servicesCatalog, serviceCategories, users, customers, adminUsers, paymentTransactions } from '@shared/schema';
import { storage } from '../storage';
import { BillingEngine } from './billing-engine';
import { BookingBandService } from './booking-band.service';
import { PartnerFieldService } from './partner-field.service';
import { BookingNotifications } from './booking-notifications';
import { NotificationService } from './notification.service';
import { WhatsAppService } from './whatsapp.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class CallBookingError extends Error {
    constructor(message: string, public status = 400, public code = 'BAD_INPUT') { super(message); }
}

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
/** The last 10 digits: +91 98450 12345, 09845012345 and 9845012345 are one number. */
const phone10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const validPhone = (p: string) => /^[6-9]\d{9}$/.test(p);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10);
const BOOKABLE = new Set(['field_service', 'consultation']);
/** A payment link is valid this long; staff can send a fresh one any time in the 7 days. */
const LINK_DAYS = 3;

type Send = { channel: 'sms' | 'email' | 'whatsapp'; at: string; ok: boolean; detail?: string };
type Link = { id: string; url: string; expiresAt: Date };

/** Tests (and local runs) fake the link; never in production. */
const mockLinks = () => process.env.PAYMENT_LINKS_MOCK === '1' && process.env.NODE_ENV !== 'production';

export class CallBookingService {
    /** The customer with this phone, their addresses, and recent bookings; null when new. */
    static async lookup(rawPhone: unknown) {
        const phone = phone10(rawPhone);
        if (!validPhone(phone)) throw new CallBookingError('Enter the customer\'s 10-digit mobile number.');
        const user = await storage.getUserByPhone(phone);
        if (!user) return { phone, customer: null };
        if (user.role !== 'user') throw new CallBookingError('This number belongs to a UniteFix expert or partner account, not a customer.', 409, 'NOT_CUSTOMER');
        const [profile] = await db.select({ saved: customers.savedAddresses, fullName: customers.fullName }).from(customers).where(eq(customers.userId, user.id)).limit(1);
        const saved = Array.isArray(profile?.saved) ? (profile!.saved as any[]) : [];
        const addresses = [
            ...(user.homeAddress ? [{ label: 'Home', address: user.homeAddress, pinCode: user.pinCode ?? '' }] : []),
            ...saved.filter(a => a?.address).map(a => ({ label: text(a.label, 30) || 'Saved', address: text(a.address, 300), pinCode: text(a.pinCode, 6) })),
        ].filter((a, i, all) => all.findIndex(b => b.address === a.address) === i).slice(0, 6);
        const recent = await db.select({ id: serviceRequests.id, ref: serviceRequests.serviceId, serviceType: serviceRequests.serviceType, status: serviceRequests.status, createdAt: serviceRequests.createdAt })
            .from(serviceRequests).where(eq(serviceRequests.userId, user.id)).orderBy(desc(serviceRequests.createdAt)).limit(5);
        return { phone, customer: { id: user.id, name: profile?.fullName || user.username || '', email: user.email ?? null, isActive: user.isActive !== false, addresses, recent } };
    }

    /**
     * What the booking costs, both ways: with a payment link (the category's
     * booking fee now — the full price when that fee is ₹0 — the rest after) and
     * paid after the service (nothing now).
     */
    static async quote(input: { catalogServiceId: unknown; pincode?: unknown; quantity?: unknown }) {
        const id = Number(input.catalogServiceId);
        if (!Number.isInteger(id) || id <= 0) throw new CallBookingError('Choose the service.');
        const [svc] = await db.select({ id: servicesCatalog.id, name: servicesCatalog.name, basePrice: servicesCatalog.basePrice, status: servicesCatalog.status, categoryName: serviceCategories.name })
            .from(servicesCatalog).leftJoin(serviceCategories, eq(serviceCategories.id, servicesCatalog.categoryId)).where(eq(servicesCatalog.id, id)).limit(1);
        if (!svc) throw new CallBookingError('That service no longer exists.', 404);
        if (svc.status === 'DISABLED') throw new CallBookingError('That service is switched off in the catalogue.', 409, 'DISABLED');
        const band = await BookingBandService.forCatalogService(id);
        if (!BOOKABLE.has(band.band)) {
            const why = band.band === 'inspect_quote' ? 'Inspection bookings take the inspection fee in the app. Ask the customer to book it in the app, or book a visit service instead.'
                : band.band === 'referral' ? 'This service takes a free-quote enquiry, not a booking.'
                : 'This is a recharge, done in the app, not a booking.';
            throw new CallBookingError(why, 409, 'NOT_BOOKABLE');
        }
        const quantity = Math.max(1, Math.min(50, Math.floor(Number(input.quantity)) || 1));
        const pincode = /^\d{6}$/.test(text(input.pincode, 6)) ? text(input.pincode, 6) : null;
        const routing = await PartnerFieldService.route({ catalogServiceId: id, pincode, urgency: null, quotedUnitPrice: null });
        const unitPrice = routing.unitPrice ?? svc.basePrice;
        const fee = await BillingEngine.resolveBookingFee(await BillingEngine.categoryOfService(id));

        const build = async (bookingFee: number, prepayIfZero: boolean) => {
            let snapshot = await BillingEngine.createBookingSnapshot({ bookingFee });
            let total: number | null = null, commission: number | null = null;
            if (unitPrice > 0) {
                snapshot = await BillingEngine.createCatalogSnapshotForQuantity(unitPrice, quantity, { bookingFee, ...(routing.platformFeePercent != null ? { platformFeePercent: routing.platformFeePercent } : {}) });
                if (routing.dispatchPartnerId) snapshot = { ...snapshot, payeeType: 'partner', payeePartnerId: routing.dispatchPartnerId, servicedBy: routing.partnerName ?? undefined, nationalUnitPrice: svc.basePrice };
                total = snapshot.grossTotal ?? unitPrice * quantity;
                commission = Math.round(snapshot.platformFee ?? 0);
            }
            if (prepayIfZero) snapshot = BillingEngine.applyPrepay(snapshot);
            return { snapshot, total, commission, dueNow: BillingEngine.amountDueAtBooking(snapshot) };
        };
        const link = await build(fee, true);
        const after = await build(0, false);
        return {
            service: { id: svc.id, name: svc.name, categoryName: svc.categoryName }, band: band.band, quantity, unitPrice: unitPrice > 0 ? unitPrice : null,
            total: after.total, partnerName: routing.partnerName ?? null,
            link: { payNow: link.dueNow, payAfter: link.total != null ? Math.max(0, link.total - link.dueNow) : null, prepaid: !!(link.snapshot as any).prepaid },
            afterService: { payNow: 0, payAfter: after.total },
            // Older admin builds read these.
            payNow: 0, payAfter: after.total,
            linksAvailable: this.linksAvailable(),
            _internal: { routing, link, after },
        };
    }

    /** Whether payment links can be made here (Razorpay set up, or faked in a test). */
    static linksAvailable() {
        return mockLinks() || !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
    }

    /** Book it. Returns the new booking, and the payment link when one was sent. */
    static async create(adminId: number, input: Record<string, any>) {
        const phone = phone10(input.phone);
        if (!validPhone(phone)) throw new CallBookingError('Enter the customer\'s 10-digit mobile number.');
        const address = text(input.address, 300);
        const pincode = text(input.pincode, 6);
        if (!/^\d{6}$/.test(pincode)) throw new CallBookingError('Enter the 6-digit pincode of the address.');
        const mode: 'link' | 'after_service' = input.payment === 'after_service' ? 'after_service' : 'link';
        const email = text(input.email, 120).toLowerCase() || null;
        if (email && !validEmail(email)) throw new CallBookingError('That email address does not look right.');
        const q = await this.quote({ catalogServiceId: input.catalogServiceId, pincode, quantity: input.quantity });
        const consultation = q.band === 'consultation';
        if (!consultation && address.length < 8) throw new CallBookingError('Enter the address the expert should visit.');
        const preferredDate = text(input.preferredDate, 10) || null;
        const slot = text(input.preferredTimeSlot, 40) || null;
        if (preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || preferredDate < todayIst() || preferredDate > plusDays(60))) throw new CallBookingError('Choose a day from today to 60 days ahead.');
        if (consultation && (!preferredDate || !slot)) throw new CallBookingError('A consultation needs a day and a time for the call.');
        const urgency = input.urgency === 'urgent' ? 'urgent' : 'normal';
        const description = text(input.description, 1000) || `${q.service.name} (booked by call)`;
        const note = text(input.note, 500) || null;
        const priced = mode === 'link' ? q._internal.link : q._internal.after;
        const collect = mode === 'link' && priced.dueNow > 0;
        if (collect && !this.linksAvailable()) throw new CallBookingError('Payment links are not set up (Razorpay keys are missing). Choose "Pay after the service" for now.', 503, 'LINKS_UNAVAILABLE');

        // The customer: found by phone, or created with the name staff took down.
        const found = await this.lookup(phone);
        let userId: number, name: string;
        let createdCustomer = false;
        if (found.customer) {
            if (!found.customer.isActive) throw new CallBookingError('This customer\'s account is blocked. Check with an admin first.', 409, 'BLOCKED');
            userId = found.customer.id; name = found.customer.name;
        } else {
            name = text(input.name, 60);
            if (name.length < 2) throw new CallBookingError('New customer: enter their name.');
            const created = await storage.createUser({ username: name, phone, role: 'user', isActive: true, homeAddress: consultation ? null : address, pinCode: pincode } as any);
            userId = created.id;
            createdCustomer = true;
            logger.info(`[CALL_BOOKING] Created customer users.id=${created.id} for a call booking`);
        }

        const { routing } = q._internal;
        const sr = await storage.createServiceRequest({
            userId,
            serviceType: q.service.name,
            description,
            address: consultation && !address ? 'Phone consultation' : address,
            preferredDate, preferredTimeSlot: slot, urgency,
            catalogServiceId: q.service.id,
            bookingFee: priced.snapshot.bookingFee,
            // With a link, it waits (out of the queue) until paid. Otherwise nothing is due: ready at once.
            bookingFeeStatus: collect ? 'pending' : 'paid',
        } as any);
        await db.update(serviceRequests).set({
            pricingSnapshot: priced.snapshot as any,
            quantity: q.quantity,
            pincode,
            chosenProviderType: 'unitefix',
            bookingBand: q.band,
            bookedVia: 'call',
            bookedByAdminId: adminId,
            bookingNote: note,
            ...(routing.dispatchPartnerId ? { dispatchPartnerId: routing.dispatchPartnerId, dispatchMode: routing.dispatchMode, slaAssignBy: routing.slaAssignBy } : {}),
            ...(priced.total !== null ? { totalAmount: priced.total } : {}),
            ...(priced.commission !== null ? { commissionAmount: priced.commission } : {}),
        } as any).where(eq(serviceRequests.id, sr.id));

        let payment: { mode: string; amount: number; url: string | null; sends: Send[]; whatsappFallbackUrl: string | null } = { mode: collect ? 'link' : 'after_service', amount: collect ? priced.dueNow : 0, url: null, sends: [], whatsappFallbackUrl: null };
        if (collect) {
            let link: Link;
            try {
                link = await this.makeLink({ id: sr.id, ref: sr.serviceId, service: q.service.name }, priced.dueNow, { name, phone, email });
            } catch (e: any) {
                // No link, no booking: it would sit unpaid with nothing to pay it with.
                await db.delete(serviceRequests).where(eq(serviceRequests.id, sr.id)).catch(() => {});
                logger.error('[CALL_BOOKING] Payment link failed; booking withdrawn', { error: e?.message });
                throw new CallBookingError(`Razorpay could not make the payment link (${e?.error?.description ?? e?.message ?? 'unknown error'}). Nothing was booked; try again, or choose "Pay after the service".`, 502, 'LINK_FAILED');
            }
            payment = { ...payment, ...(await this.sendLink(sr.id, link, { name, phone, email, service: q.service.name, ref: sr.serviceId, amount: priced.dueNow }, ['sms', ...(email ? ['email' as const] : []), 'whatsapp'], true)) };
            NotificationService.notify(userId, 'Pay to confirm your booking',
                `UniteFix booked ${q.service.name} (${sr.serviceId}) for you. Pay ₹${priced.dueNow} to confirm it — open the booking, or use the link we sent.`,
                'payment_pending', { serviceId: sr.id, serviceRef: sr.serviceId });
        } else {
            // Same announcements as an app booking: the customer, staff, and the partner when it is theirs.
            void BookingNotifications.bookingCreated(sr.id);
        }

        await recordAudit({
            entityType: 'service_request', entityId: sr.id, action: 'booked_by_call', toState: 'created', changedBy: adminId,
            metadata: { catalogServiceId: q.service.id, quantity: q.quantity, total: priced.total, newCustomer: createdCustomer, note, payment: payment.mode, payNow: payment.amount },
        });
        return { id: sr.id, ref: sr.serviceId, userId, newCustomer: createdCustomer, total: priced.total, service: q.service.name, payment };
    }

    // ── Payment links ──────────────────────────────────────────────────────

    /** A Razorpay payment link for the booking fee. Razorpay texts it (and emails it when there is an email). */
    private static async makeLink(sr: { id: number; ref: string; service: string }, amount: number, who: { name: string; phone: string; email: string | null }): Promise<Link> {
        const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000);
        if (mockLinks()) return { id: `plink_test_${sr.id}_${Date.now().toString(36)}`, url: `https://rzp.io/i/test-${sr.ref}`, expiresAt };
        const { PaymentService } = await import('./payment.service');
        const rp: any = await PaymentService.client();
        const link = await rp.paymentLink.create({
            amount: Math.round(amount * 100),
            currency: 'INR',
            accept_partial: false,
            description: `UniteFix booking ${sr.ref}: ${sr.service}`.slice(0, 2000),
            reference_id: `${sr.ref}-${Date.now().toString(36)}`,   // unique per link (resends make new ones)
            customer: { name: who.name || 'Customer', contact: `+91${who.phone}`, ...(who.email ? { email: who.email } : {}) },
            notify: { sms: true, email: !!who.email },
            reminder_enable: true,
            expire_by: Math.floor(expiresAt.getTime() / 1000),
            notes: { service_request_id: String(sr.id), payment_type: 'booking_charge', booked_via: 'call' },
        });
        return { id: link.id, url: link.short_url, expiresAt };
    }

    /** Store a link on the booking and send it. Razorpay already texts/emails a new link; WhatsApp is ours. */
    private static async sendLink(id: number, link: Link, p: { name: string; phone: string; email: string | null; service: string; ref: string; amount: number }, channels: Send['channel'][], fresh: boolean) {
        const now = new Date().toISOString();
        const sends: Send[] = [];
        for (const ch of channels) {
            if (ch === 'whatsapp') {
                const w = await WhatsAppService.sendPaymentLink(p.phone, { name: p.name, service: p.service, ref: p.ref, amount: p.amount, url: link.url });
                sends.push({ channel: 'whatsapp', at: now, ok: w.sent, ...(w.sent ? {} : { detail: w.reason === 'not_configured' ? 'WhatsApp is not set up yet: send it from WhatsApp Web' : w.detail }) });
            } else if (fresh) {
                sends.push({ channel: ch, at: now, ok: true, detail: 'Sent by Razorpay' });
            } else {
                try {
                    if (!mockLinks()) {
                        const { PaymentService } = await import('./payment.service');
                        await ((await PaymentService.client()) as any).paymentLink.notifyBy(link.id, ch);
                    }
                    sends.push({ channel: ch, at: now, ok: true, detail: 'Sent by Razorpay' });
                } catch (e: any) {
                    sends.push({ channel: ch, at: now, ok: false, detail: e?.error?.description ?? e?.message ?? 'Razorpay refused it' });
                }
            }
        }
        const [row] = await db.select({ sends: serviceRequests.paymentLinkSends }).from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
        const history = [...(Array.isArray(row?.sends) ? (row!.sends as Send[]) : []), ...sends].slice(-30);
        await db.update(serviceRequests).set({
            paymentLinkId: link.id, paymentLinkUrl: link.url, paymentLinkStatus: 'created', paymentLinkExpiresAt: link.expiresAt, paymentLinkSends: history as any, updatedAt: new Date(),
        } as any).where(eq(serviceRequests.id, id));
        return { url: link.url, sends, whatsappFallbackUrl: WhatsAppService.manualLink(p.phone, WhatsAppService.paymentText({ name: p.name, service: p.service, ref: p.ref, amount: p.amount, url: link.url })) };
    }

    /** A call booking still waiting for its fee, with its customer. */
    private static async awaiting(id: number) {
        const [row] = await db.select({ sr: serviceRequests, name: users.username, phone: users.phone, email: users.email })
            .from(serviceRequests).leftJoin(users, eq(users.id, serviceRequests.userId)).where(eq(serviceRequests.id, id)).limit(1);
        if (!row || row.sr.bookedVia !== 'call') throw new CallBookingError('That call booking does not exist.', 404, 'NOT_FOUND');
        if (row.sr.status !== 'created' || row.sr.bookingFeeStatus !== 'pending') throw new CallBookingError('This booking is not waiting for payment any more.', 409, 'NOT_AWAITING');
        return row;
    }

    /** Send the link again (a fresh one when the last has expired, was cancelled, or a new email is given). */
    static async resend(adminId: number, id: number, input: { channels?: unknown; email?: unknown }) {
        const { sr, name, phone, email: userEmail } = await this.awaiting(id);
        const wanted = (Array.isArray(input.channels) ? input.channels : ['sms', 'whatsapp']).filter((c): c is Send['channel'] => c === 'sms' || c === 'email' || c === 'whatsapp');
        if (!wanted.length) throw new CallBookingError('Choose where to send it: SMS, email or WhatsApp.');
        const newEmail = text(input.email, 120).toLowerCase() || null;
        if (newEmail && !validEmail(newEmail)) throw new CallBookingError('That email address does not look right.');
        const email = newEmail ?? userEmail ?? null;
        if (wanted.includes('email') && !email) throw new CallBookingError('Enter the customer\'s email to send it by email.');
        const amount = BillingEngine.amountDueAtBooking(sr.pricingSnapshot as any, sr.bookingFee ?? 0);
        const p10 = phone10(phone);
        const stale = !sr.paymentLinkId || sr.paymentLinkStatus !== 'created' || (sr.paymentLinkExpiresAt && sr.paymentLinkExpiresAt.getTime() < Date.now() + 3_600_000) || !!newEmail;
        let link: Link, fresh = false;
        if (stale) {
            if (sr.paymentLinkId && sr.paymentLinkStatus === 'created') await this.cancelLink(sr.paymentLinkId);
            link = await this.makeLink({ id: sr.id, ref: sr.serviceId, service: sr.serviceType }, amount, { name: name ?? '', phone: p10, email });
            fresh = true;
        } else {
            link = { id: sr.paymentLinkId!, url: sr.paymentLinkUrl!, expiresAt: sr.paymentLinkExpiresAt! };
        }
        // A fresh link was already texted (and emailed) by Razorpay; only the channels asked for are reported.
        const r = await this.sendLink(sr.id, link, { name: name ?? '', phone: p10, email, service: sr.serviceType, ref: sr.serviceId, amount }, wanted, fresh);
        await recordAudit({ entityType: 'service_request', entityId: sr.id, action: 'payment_link_resent', changedBy: adminId, metadata: { channels: wanted, newLink: fresh } });
        return { ...r, amount, newLink: fresh };
    }

    /** The customer will pay at the end after all: no fee now, the full bill after the service; into the queue. */
    static async payAfterService(adminId: number, id: number) {
        const { sr } = await this.awaiting(id);
        const snap: any = sr.pricingSnapshot ?? {};
        let snapshot: any;
        if (Number(snap.unitPrice) > 0) {
            snapshot = await BillingEngine.createCatalogSnapshotForQuantity(Number(snap.unitPrice), sr.quantity ?? 1, { bookingFee: 0, ...(snap.platformFeePercent != null ? { platformFeePercent: Number(snap.platformFeePercent) } : {}) });
            for (const k of ['payeeType', 'payeePartnerId', 'servicedBy', 'nationalUnitPrice']) if (snap[k] !== undefined) snapshot[k] = snap[k];
        } else {
            snapshot = await BillingEngine.createBookingSnapshot({ bookingFee: 0 });
        }
        const [u] = await db.update(serviceRequests).set({
            pricingSnapshot: snapshot, bookingFee: 0, bookingFeeStatus: 'paid' as any, paymentLinkStatus: 'cancelled', updatedAt: new Date(),
            ...(snapshot.grossTotal != null ? { totalAmount: Math.round(snapshot.grossTotal), commissionAmount: Math.round(snapshot.platformFee ?? 0) } : {}),
        } as any).where(and(eq(serviceRequests.id, id), eq(serviceRequests.bookingFeeStatus, 'pending' as any), eq(serviceRequests.status, 'created' as any))).returning({ id: serviceRequests.id });
        if (!u) throw new CallBookingError('This booking just changed. Refresh it.', 409, 'CHANGED');
        if (sr.paymentLinkId && sr.paymentLinkStatus === 'created') await this.cancelLink(sr.paymentLinkId);
        await recordAudit({ entityType: 'service_request', entityId: id, action: 'switched_to_pay_after_service', changedBy: adminId, metadata: { cancelledLink: sr.paymentLinkId ?? null } });
        void BookingNotifications.bookingCreated(id);
        return { id, ref: sr.serviceId };
    }

    /** Cancel a link at Razorpay so it can no longer be paid. Never throws. */
    static async cancelLink(linkId: string) {
        if (mockLinks() || linkId.startsWith('plink_test_')) return;
        try {
            const { PaymentService } = await import('./payment.service');
            await ((await PaymentService.client()) as any).paymentLink.cancel(linkId);
        } catch (e: any) {
            logger.warn('[CALL_BOOKING] Could not cancel payment link', { linkId, error: e?.error?.description ?? e?.message });
        }
    }

    /**
     * The booking fee was paid another way (in the app): its link is cancelled
     * so it cannot be paid twice. Called after a booking-charge capture.
     */
    static async afterOtherPayment(serviceRequestId: number) {
        const [sr] = await db.select({ linkId: serviceRequests.paymentLinkId, status: serviceRequests.paymentLinkStatus }).from(serviceRequests).where(eq(serviceRequests.id, serviceRequestId)).limit(1);
        if (!sr?.linkId || sr.status !== 'created') return;
        await this.cancelLink(sr.linkId);
        await db.update(serviceRequests).set({ paymentLinkStatus: 'cancelled' } as any).where(and(eq(serviceRequests.id, serviceRequestId), eq(serviceRequests.paymentLinkStatus, 'created')));
    }

    /**
     * Webhook payment_link.paid: record the money (so a refund can find it, as
     * for an app payment), mark the fee paid, and announce the booking — once.
     */
    static async linkPaid(payload: any) {
        const link = payload?.payment_link?.entity;
        const pay = payload?.payment?.entity;
        const srId = Number(link?.notes?.service_request_id);
        if (!Number.isInteger(srId) || !pay?.id) return { handled: false };
        const [sr] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, srId)).limit(1);
        if (!sr) return { handled: false };

        // The money trail: an order row tagged as this booking's charge, and its capture (once per payment).
        await withTransaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'capture:' + pay.id}))`);
            if (pay.order_id) {
                const [order] = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions)
                    .where(and(eq(paymentTransactions.razorpayOrderId, pay.order_id), eq(paymentTransactions.eventType, 'order_created' as any))).limit(1);
                if (!order) await tx.insert(paymentTransactions).values({
                    serviceRequestId: srId, razorpayOrderId: pay.order_id, amount: pay.amount, currency: 'INR', eventType: 'order_created' as any, status: 'pending' as any,
                    metadata: { paymentType: 'booking_charge', via: 'payment_link', paymentLinkId: link.id },
                } as any);
            }
            const [seen] = await tx.select({ id: paymentTransactions.id }).from(paymentTransactions).where(and(
                eq(paymentTransactions.razorpayPaymentId, pay.id), eq(paymentTransactions.eventType, 'payment_captured' as any), sql`${paymentTransactions.amount} > 0`)).limit(1);
            if (!seen) await tx.insert(paymentTransactions).values({
                serviceRequestId: srId, razorpayOrderId: pay.order_id ?? null, razorpayPaymentId: pay.id, amount: pay.amount, currency: 'INR',
                eventType: 'payment_captured' as any, status: 'captured' as any, method: pay.method ?? null,
                metadata: { paymentType: 'booking_charge', via: 'payment_link', paymentLinkId: link.id },
            } as any);
        });

        if (sr.status === 'cancelled') {
            // Paid after the booking was closed: keep the money on record and ask staff to refund or rebook.
            await db.update(serviceRequests).set({ paymentLinkStatus: 'paid' } as any).where(eq(serviceRequests.id, srId));
            await recordAudit({ entityType: 'service_request', entityId: srId, action: 'payment_link_paid_after_cancel', metadata: { paymentId: pay.id, amountPaise: pay.amount } });
            void NotificationService.sendToAdmins('Payment for a closed booking', `${sr.serviceId} was paid by link after it was closed. Refund it or rebook.`, { serviceId: srId });
            return { handled: true, closed: true };
        }
        const [u] = await db.update(serviceRequests).set({ bookingFeeStatus: 'paid' as any, paymentLinkStatus: 'paid', updatedAt: new Date() } as any)
            .where(and(eq(serviceRequests.id, srId), sql`${serviceRequests.paymentLinkStatus} IS DISTINCT FROM 'paid'`)).returning({ id: serviceRequests.id });
        if (u) {
            await recordAudit({ entityType: 'service_request', entityId: srId, action: 'payment_link_paid', toState: 'created', metadata: { paymentId: pay.id, amountPaise: pay.amount, linkId: link.id } });
            const { ProviderChoiceService } = await import('./provider-choice.service');
            void ProviderChoiceService.applyAfterPayment(srId).catch(() => {});
            void BookingNotifications.bookingCreated(srId);
        }
        return { handled: true };
    }

    /** Webhook payment_link.expired / .cancelled. */
    static async linkEnded(payload: any, status: 'expired' | 'cancelled') {
        const id = payload?.payment_link?.entity?.id;
        if (!id) return;
        await db.update(serviceRequests).set({ paymentLinkStatus: status } as any).where(and(eq(serviceRequests.paymentLinkId, id), eq(serviceRequests.paymentLinkStatus, 'created')));
    }

    /** The latest bookings made by call, with who booked them and where payment stands. */
    static async recent(limit = 30) {
        const rows = await db.select({
            id: serviceRequests.id, ref: serviceRequests.serviceId, serviceType: serviceRequests.serviceType, status: serviceRequests.status,
            totalAmount: serviceRequests.totalAmount, createdAt: serviceRequests.createdAt, note: serviceRequests.bookingNote,
            bookingFee: serviceRequests.bookingFee, bookingFeeStatus: serviceRequests.bookingFeeStatus, pricingSnapshot: serviceRequests.pricingSnapshot,
            paymentLinkUrl: serviceRequests.paymentLinkUrl, paymentLinkStatus: serviceRequests.paymentLinkStatus, paymentLinkExpiresAt: serviceRequests.paymentLinkExpiresAt, paymentLinkSends: serviceRequests.paymentLinkSends,
            customerName: users.username, customerPhone: users.phone, customerEmail: users.email, bookedBy: adminUsers.username,
        }).from(serviceRequests)
            .leftJoin(users, eq(users.id, serviceRequests.userId))
            .leftJoin(adminUsers, eq(adminUsers.id, serviceRequests.bookedByAdminId))
            .where(and(isNotNull(serviceRequests.bookedVia), eq(serviceRequests.bookedVia, 'call')))
            .orderBy(desc(serviceRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
        return rows.map(({ pricingSnapshot, ...r }) => {
            const awaiting = r.status === 'created' && r.bookingFeeStatus === 'pending';
            const amount = awaiting ? BillingEngine.amountDueAtBooking(pricingSnapshot as any, r.bookingFee ?? 0) : null;
            return {
                ...r,
                payment: awaiting ? 'awaiting' : r.paymentLinkStatus === 'paid' ? 'paid_by_link' : (r.bookingFee ?? 0) === 0 ? 'after_service' : 'paid',
                amountDue: amount,
                whatsappFallbackUrl: awaiting && r.paymentLinkUrl && r.customerPhone
                    ? WhatsAppService.manualLink(phone10(r.customerPhone), WhatsAppService.paymentText({ name: r.customerName ?? '', service: r.serviceType, ref: r.ref, amount: amount ?? 0, url: r.paymentLinkUrl }))
                    : null,
            };
        });
    }
}

// Kept for callers that want only the public part of a quote.
export const publicQuote = (q: Awaited<ReturnType<typeof CallBookingService.quote>>) => {
    const { _internal, ...rest } = q;
    return rest;
};
