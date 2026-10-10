/**
 * What happens to a hall, photography or event booking made through
 * UniteFix, from the client's request to their review.
 *
 *   pending     a hall booked instantly; the date is held until the advance
 *               is paid (hold_expires_at)
 *   confirmed   the advance arrived (or the partner confirmed) — the date is
 *               booked on the calendar
 *   completed   the event took place (the partner marks it, or two days after
 *               the date it is marked for them)
 *   cancelled   by the partner (with any refund), by the client before paying,
 *               or because the hold lapsed unpaid
 *
 * Commission (bookings that came through UniteFix — public page, app,
 * Celebrations — never the partner's own walk-ins): a percentage of the
 * booking, charged once on the partner's statement when the event is
 * completed, or on what the partner keeps when it is cancelled. Invoiced on
 * the monthly UniteFix fee invoice.
 *
 * The client's page (/celebrations/b/<enquiry token>) shows the request, the
 * booking, what is paid and due (with payment links), the cancellation terms,
 * and — after the event — a review form.
 */

import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import {
    eventBookings, eventEnquiries, eventMilestones, partnerQuotations, partnerCustomers, partnerPayLinks, partnerReviews, businessPartners, venueSpaces,
    type EventBooking,
} from '@shared/schema';
import { refundPercentFor, cancellationText, SLOT_LABEL } from '@shared/celebrations';
import { HubError } from './partner-hub.service';
import { BookingCalendar, istToday, addDays } from './booking-calendar.service';
import { ListingService, listingKindOf } from './listings.service';
import { BusinessPartnerService } from './business-partner.service';
import { configService } from './config.service';
import logger from '../lib/logger';
import { publicAppUrl } from '../lib/public-url';

const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const publicBase = () => publicAppUrl();

export class CelebrationBookings {

    static customerLink(enquiryToken: string) { return `/celebrations/b/${enquiryToken}`; }

    // ══════════════════════════════════════════════════════════════════════
    // Lifecycle hooks (called by PartnerEventsService)
    // ══════════════════════════════════════════════════════════════════════

    /**
     * A booking was just created from an accepted quotation. Carry over where
     * the client came from and what kind of booking it is; for photography,
     * the crew's date is booked now (the photographer confirmed it).
     */
    static async afterConfirm(bookingId: number, enquiryId: number | null) {
        if (!enquiryId) return;
        const [e] = await db.select().from(eventEnquiries).where(eq(eventEnquiries.id, enquiryId)).limit(1);
        if (!e) return;
        const kind = e.kind ?? 'event';
        const pct = e.source !== 'hub' ? await ListingService.commissionPercent(e.businessPartnerId, listingKindOf(kind)) : null;
        await db.update(eventBookings).set({ kind, origin: e.source, commissionPercent: pct != null ? String(pct) : null, updatedAt: new Date() }).where(eq(eventBookings.id, bookingId));
        // Photography and events: the client pays from their page (halls get theirs in VenueService.bookRequest).
        if (kind !== 'hall') await this.ensurePayLinks(bookingId);
        if (kind === 'shoot') {
            const held = await db.transaction(async (tx) => {
                const rows = await BookingCalendar.attach(tx, e.id, bookingId);
                await BookingCalendar.confirm(tx, { bookingId });
                return rows.length;
            });
            if (!held) {
                // The hold lapsed before the booking: take a free crew now if there is one.
                const { PortfolioService } = await import('./portfolio.service');
                if (!(await PortfolioService.bookCrewFor(e.businessPartnerId, bookingId, e.id))) {
                    const { HubAlerts } = await import('./hub-alerts.service');
                    await HubAlerts.send(e.businessPartnerId, 'booking_request', { title: 'Check this date', body: `Every team is already booked on ${e.eventDate}. The booking is confirmed, but your calendar has no free team for it — rearrange or call the client.`, link: `/partner/events/bookings/${bookingId}`, refType: 'event_booking', refId: bookingId });
                }
            }
        }
    }

    /**
     * A booking made through UniteFix: every unpaid instalment gets its own
     * payment link, so the client can pay each one from their page. (Paying
     * the business directly and recording it in the Hub still works.)
     */
    static async ensurePayLinks(bookingId: number) {
        try {
            const [b] = await db.select().from(eventBookings).where(eq(eventBookings.id, bookingId)).limit(1);
            if (!b || b.origin === 'hub' || b.status === 'cancelled' || b.status === 'completed') return;
            const due = await db.select({ id: eventMilestones.id }).from(eventMilestones).where(and(eq(eventMilestones.bookingId, b.id), eq(eventMilestones.status, 'due')));
            const { PartnerPayLinkService } = await import('./partner-pay-links.service');
            for (const m of due) await PartnerPayLinkService.create({ businessPartnerId: b.businessPartnerId, adminUserId: null as any }, { kind: 'milestone', refId: m.id });
        } catch (e: any) { logger.warn(`[CELEBRATIONS] pay links for booking #${bookingId}: ${e?.message}`); }
    }

    /** A milestone was paid (online or recorded by hand). The first payment on a pending booking confirms it. */
    static async onMilestonePaid(bookingId: number) {
        await this.ensurePayLinks(bookingId);
        const confirmed = await db.transaction(async (tx) => {
            const [b] = await tx.update(eventBookings).set({ status: 'confirmed', holdExpiresAt: null, updatedAt: new Date() })
                .where(and(eq(eventBookings.id, bookingId), eq(eventBookings.status, 'pending'))).returning();
            if (!b) return null;
            const rows = await BookingCalendar.confirm(tx, { bookingId });
            return { b, rows: rows.length };
        });
        if (!confirmed) return;
        const b = confirmed.b;
        if (!confirmed.rows && b.spaceId && b.slot) {
            // The hold had lapsed but the money came: book the date if it is still free.
            try {
                await db.transaction(async (tx) => BookingCalendar.take(tx, { bpId: b.businessPartnerId, resourceKind: 'space', resourceId: b.spaceId!, days: [b.eventDate], parts: b.slot === 'full' ? ['am', 'pm'] : [b.slot as 'am' | 'pm'], status: 'booked', bookingId: b.id, enquiryId: b.enquiryId }));
            } catch (err: any) {
                const { HubAlerts } = await import('./hub-alerts.service');
                await HubAlerts.send(b.businessPartnerId, 'booking_request', { title: 'Paid, but the date was taken', body: `${b.title} on ${b.eventDate}: the advance arrived after the hold ended and the date has since gone to someone else. Call the client — offer another date or refund them.`, link: `/partner/events/bookings/${b.id}`, refType: 'event_booking', refId: b.id });
                logger.warn(`[CELEBRATIONS] booking #${b.id} paid after its hold lapsed and the slot is taken`);
            }
        }
        await this.notifyClient(b, `Booking confirmed — ${b.title}`, `Your booking for ${b.eventDate} is confirmed. Thank you!`);
    }

    /** The event took place. Commission on the booking value. */
    static async onCompleted(bookingId: number) {
        const [b] = await db.select().from(eventBookings).where(eq(eventBookings.id, bookingId)).limit(1);
        if (!b) return;
        await this.chargeCommission(b, b.totalPaise, 'completed');
    }

    /** Cancelled: free the dates, close open payment links, commission on what the partner keeps. */
    static async onCancelled(bookingId: number, keptPaise: number) {
        const [b] = await db.select().from(eventBookings).where(eq(eventBookings.id, bookingId)).limit(1);
        if (!b) return;
        await db.transaction(async (tx) => {
            await BookingCalendar.release(tx, { bookingId });
            if (b.enquiryId) await BookingCalendar.release(tx, { enquiryId: b.enquiryId });
            const ms = await tx.select({ id: eventMilestones.id }).from(eventMilestones).where(eq(eventMilestones.bookingId, bookingId));
            if (ms.length) await tx.update(partnerPayLinks).set({ status: 'cancelled', note: 'The booking was cancelled' })
                .where(and(eq(partnerPayLinks.kind, 'milestone'), inArray(partnerPayLinks.refId, ms.map(m => m.id)), eq(partnerPayLinks.status, 'open')));
        });
        if (keptPaise > 0) await this.chargeCommission(b, keptPaise, 'cancelled');
    }

    /** Idempotent: one commission per booking, ever. */
    static async chargeCommission(b: EventBooking, basePaise: number, why: 'completed' | 'cancelled') {
        const pct = b.commissionPercent != null ? Number(b.commissionPercent) : 0;
        if (b.origin === 'hub' || !(pct > 0) || b.commissionChargedAt || basePaise <= 0) return null;
        const gstRate = parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18');
        const fee = Math.round(basePaise * pct / 100);
        const gst = Math.round(fee * gstRate / 100);
        if (fee <= 0) return null;
        return db.transaction(async (tx) => {
            const [u] = await tx.update(eventBookings).set({ commissionPaise: fee, commissionGstPaise: gst, commissionChargedAt: new Date(), updatedAt: new Date() })
                .where(and(eq(eventBookings.id, b.id), isNull(eventBookings.commissionChargedAt))).returning();
            if (!u) return null;
            const label = b.kind === 'hall' ? 'Hall booking' : b.kind === 'shoot' ? 'Photography booking' : 'Event booking';
            await BusinessPartnerService.appendLedger(tx as any, {
                businessPartnerId: b.businessPartnerId, entryType: 'booking_commission', amountPaise: fee + gst,
                description: `${label} commission ${pct}% + GST — ${b.title} on ${b.eventDate}${why === 'cancelled' ? ` (cancelled; on ${rs(basePaise)} kept)` : ''}`,
                metadata: { bookingId: b.id, basePaise, percent: pct, why },
            });
            return u;
        });
    }

    /** Commission charged in [from, to) — the monthly UniteFix fee invoice. */
    static async commissionsCharged(bpId: number, from: Date, to: Date) {
        const rows = await db.select({ fee: eventBookings.commissionPaise, gst: eventBookings.commissionGstPaise }).from(eventBookings)
            .where(and(eq(eventBookings.businessPartnerId, bpId), gte(eventBookings.commissionChargedAt, from), lt(eventBookings.commissionChargedAt, to)));
        return { n: rows.length, feePaise: rows.reduce((a, r) => a + (r.fee ?? 0), 0), gstPaise: rows.reduce((a, r) => a + (r.gst ?? 0), 0) };
    }

    // ══════════════════════════════════════════════════════════════════════
    // The clock
    // ══════════════════════════════════════════════════════════════════════

    /**
     * Every few minutes: lapse unpaid holds, give back dates of hall requests
     * nobody answered, close past bookings, ask for reviews.
     */
    static async tick() {
        const out = { lapsed: 0, unanswered: 0, completed: 0, prompted: 0 };
        await BookingCalendar.releaseExpired(db);
        const { HubAlerts } = await import('./hub-alerts.service');

        // Pending bookings whose advance did not come in time.
        const due = await db.select().from(eventBookings).where(and(eq(eventBookings.status, 'pending'), lt(eventBookings.holdExpiresAt, new Date()))).limit(200);
        for (const b of due) {
            const [paid] = await db.select({ id: eventMilestones.id }).from(eventMilestones).where(and(eq(eventMilestones.bookingId, b.id), eq(eventMilestones.status, 'paid'))).limit(1);
            if (paid) { await this.onMilestonePaid(b.id); continue; }
            const [u] = await db.update(eventBookings).set({ status: 'cancelled', cancelledReason: 'The advance was not paid in time', updatedAt: new Date() })
                .where(and(eq(eventBookings.id, b.id), eq(eventBookings.status, 'pending'))).returning();
            if (!u) continue;
            await this.onCancelled(b.id, 0);
            if (b.enquiryId) await db.update(eventEnquiries).set({ status: 'lost', lostReason: 'The advance was not paid in time', updatedAt: new Date() }).where(eq(eventEnquiries.id, b.enquiryId));
            await HubAlerts.send(b.businessPartnerId, 'booking_request', { title: `Hold lapsed: ${b.title}`, body: `The advance for ${b.eventDate} was not paid in time. The date is free again.`, link: `/partner/events/bookings/${b.id}`, refType: 'event_booking', refId: b.id });
            await this.notifyClient(b, 'Your hold has ended', `The date ${b.eventDate} was held for you, but the advance did not arrive in time, so it has been released. You can book again if it is still free.`);
            out.lapsed++;
        }

        // Confirm-first hall requests nobody answered while the date was held.
        const open = await db.select({ id: eventEnquiries.id, bp: eventEnquiries.businessPartnerId, type: eventEnquiries.eventType, date: eventEnquiries.eventDate }).from(eventEnquiries)
            .where(and(eq(eventEnquiries.kind, 'hall'), inArray(eventEnquiries.status, ['new', 'contacted']), gte(eventEnquiries.createdAt, new Date(Date.now() - 30 * 86_400_000)))).limit(500);
        for (const e of open) {
            const live = await BookingCalendar.forEnquiry(e.id);
            if (live.length) continue;
            const [u] = await db.update(eventEnquiries).set({ status: 'lost', lostReason: 'Not answered while the date was held', updatedAt: new Date() })
                .where(and(eq(eventEnquiries.id, e.id), inArray(eventEnquiries.status, ['new', 'contacted']))).returning();
            if (!u) continue;
            await HubAlerts.send(e.bp, 'booking_request', { title: `Request lapsed: ${e.type}, ${e.date}`, body: 'You did not answer while the date was held, so it has been released and the client told.', link: '/partner/venue/requests', refType: 'event_enquiry', refId: e.id });
            out.unanswered++;
        }

        // Two days after the event, a confirmed UniteFix booking is completed.
        const past = await db.select().from(eventBookings).where(and(eq(eventBookings.status, 'confirmed'), lt(eventBookings.eventDate, addDays(istToday(), -2)), or(ne(eventBookings.origin, 'hub'), ne(eventBookings.kind, 'event')))).limit(200);
        for (const b of past) {
            const [u] = await db.update(eventBookings).set({ status: 'completed', updatedAt: new Date() }).where(and(eq(eventBookings.id, b.id), eq(eventBookings.status, 'confirmed'))).returning();
            if (u) { await this.onCompleted(b.id); out.completed++; }
        }

        out.prompted = await this.promptReviews();
        if (out.lapsed || out.unanswered || out.completed || out.prompted) logger.info(`[CELEBRATIONS] tick ${JSON.stringify(out)}`);
        return out;
    }

    /** The day after the event, ask the client how it went (app notification and email). */
    static async promptReviews() {
        const rows = await db.select({ b: eventBookings, e: eventEnquiries, c: partnerCustomers, partner: businessPartners.displayName }).from(eventBookings)
            .innerJoin(eventEnquiries, eq(eventEnquiries.id, eventBookings.enquiryId))
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, eventBookings.customerId))
            .innerJoin(businessPartners, eq(businessPartners.id, eventBookings.businessPartnerId))
            .where(and(inArray(eventBookings.status, ['confirmed', 'completed']), ne(eventBookings.origin, 'hub'), isNull(eventBookings.reviewPromptedAt),
                lt(eventBookings.eventDate, istToday()), gte(eventBookings.eventDate, addDays(istToday(), -30)))).limit(100);
        let n = 0;
        for (const r of rows) {
            const [u] = await db.update(eventBookings).set({ reviewPromptedAt: new Date() }).where(and(eq(eventBookings.id, r.b.id), isNull(eventBookings.reviewPromptedAt))).returning();
            if (!u) continue;
            const link = `${publicBase()}${this.customerLink(r.e.publicToken)}#review`;
            const title = `How was ${r.partner}?`;
            const body = `Your ${r.e.eventType.toLowerCase()} on ${r.b.eventDate} — rate ${r.partner} and help others choose.`;
            const { NotificationService } = await import('./notification.service');
            if (r.e.userId) void NotificationService.sendToUser(r.e.userId, title, body, 'celebration_review', { link: this.customerLink(r.e.publicToken) }).catch(() => undefined);
            if (r.c.email) void NotificationService.sendEmail(r.c.email, title, `<p>Hi ${escapeHtml(r.c.name)},</p><p>${escapeHtml(body)}</p><p><a href="${link}">Write a review</a> — it takes a minute.</p><p>— UniteFix Celebrations</p>`).catch(() => undefined);
            n++;
        }
        return n;
    }

    private static async notifyClient(b: EventBooking, title: string, body: string) {
        try {
            if (!b.enquiryId) return;
            const [r] = await db.select({ e: eventEnquiries, c: partnerCustomers }).from(eventEnquiries).innerJoin(partnerCustomers, eq(partnerCustomers.id, eventEnquiries.customerId)).where(eq(eventEnquiries.id, b.enquiryId)).limit(1);
            if (!r || r.e.source === 'hub') return;
            const { NotificationService } = await import('./notification.service');
            const link = this.customerLink(r.e.publicToken);
            if (r.e.userId) void NotificationService.sendToUser(r.e.userId, title, body, 'celebration_booking', { link }).catch(() => undefined);
            if (r.c.email) void NotificationService.sendEmail(r.c.email, title, `<p>Hi ${escapeHtml(r.c.name)},</p><p>${escapeHtml(body)}</p><p><a href="${publicBase()}${link}">See your booking</a></p><p>— UniteFix Celebrations</p>`).catch(() => undefined);
        } catch (e: any) { logger.warn(`[CELEBRATIONS] client notice failed: ${e?.message}`); }
    }

    // ══════════════════════════════════════════════════════════════════════
    // The client's page
    // ══════════════════════════════════════════════════════════════════════

    private static async byToken(t: string) {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
        const [r] = await db.select({ e: eventEnquiries, partner: businessPartners, c: partnerCustomers }).from(eventEnquiries)
            .innerJoin(businessPartners, eq(businessPartners.id, eventEnquiries.businessPartnerId))
            .innerJoin(partnerCustomers, eq(partnerCustomers.id, eventEnquiries.customerId))
            .where(eq(eventEnquiries.publicToken, t)).limit(1);
        if (!r) return null;
        const [b] = await db.select().from(eventBookings).where(eq(eventBookings.enquiryId, r.e.id)).orderBy(desc(eventBookings.createdAt)).limit(1);
        return { ...r, b: b ?? null };
    }

    static async publicView(t: string) {
        const r = await this.byToken(t);
        if (!r) return null;
        const { e, partner, b } = r;
        const [q] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.source, 'events'), eq(partnerQuotations.sourceRefId, e.id))).orderBy(desc(partnerQuotations.version)).limit(1);
        const held = await BookingCalendar.forEnquiry(e.id);
        const pagePath = e.kind === 'hall' ? `/halls/${partner.partnerCode}` : e.kind === 'shoot' ? `/photographers/${partner.partnerCode}` : `/events/${partner.partnerCode}`;
        let booking = null;
        if (b) {
            const ms = await db.select().from(eventMilestones).where(eq(eventMilestones.bookingId, b.id)).orderBy(asc(eventMilestones.sortOrder));
            const links = ms.length ? await db.select().from(partnerPayLinks).where(and(eq(partnerPayLinks.kind, 'milestone'), inArray(partnerPayLinks.refId, ms.map(m => m.id)), inArray(partnerPayLinks.status, ['open', 'paid']))).orderBy(desc(partnerPayLinks.createdAt)) : [];
            const linkFor = (id: number) => links.find(l => l.refId === id && l.status === 'open');
            const paid = ms.filter(m => m.status === 'paid').reduce((a, m) => a + m.amountPaise, 0);
            const space = b.spaceId ? (await db.select({ name: venueSpaces.name }).from(venueSpaces).where(eq(venueSpaces.id, b.spaceId)).limit(1))[0]?.name ?? null : null;
            const daysLeft = daysBetween(istToday(), b.eventDate);
            const refundPct = refundPercentFor(b.cancellationPolicy as any, daysLeft);
            const [review] = await db.select().from(partnerReviews).where(eq(partnerReviews.bookingId, b.id)).limit(1);
            booking = {
                id: b.id, status: b.status, title: b.title, eventDate: b.eventDate, slot: b.slot, slotName: b.slot ? SLOT_LABEL[b.slot as 'am'] : null, space, guests: b.guests,
                total: b.totalPaise / 100, paid: paid / 100, holdExpiresAt: b.holdExpiresAt,
                deposit: b.depositPaise ? { amount: b.depositPaise / 100, status: b.depositStatus } : null,
                cancellation: b.cancellationPolicy ? cancellationText(b.cancellationPolicy as any) : null,
                milestones: ms.map(m => { const l = linkFor(m.id); return { label: m.label, amount: m.amountPaise / 100, dueDate: m.dueDate, status: m.status, paidOn: m.paidOn, payUrl: m.status === 'due' && l && b.status !== 'cancelled' ? `/pay/${l.token}` : null }; }),
                cancelRequestedAt: b.cancelRequestedAt, cancelledReason: b.status === 'cancelled' ? b.cancelledReason : null,
                canCancel: ['pending', 'confirmed'].includes(b.status) && b.eventDate > istToday() && !b.cancelRequestedAt,
                refundIfCancelledNow: b.status === 'confirmed' && b.cancellationPolicy ? { percent: refundPct, amount: Math.round(paid * refundPct / 100) / 100 } : null,
                canReview: this.reviewable(b) && !review,
                review: review ? { rating: review.rating, body: review.body, reply: review.reply, status: review.status } : null,
            };
        }
        return {
            kind: e.kind, partner: { name: partner.displayName, phone: partner.contactPhone, page: pagePath, city: partner.district },
            occasion: e.eventType, eventDate: e.eventDate, guests: e.guests, status: e.status, lostReason: e.status === 'lost' ? e.lostReason : null,
            selection: e.selection ?? null, heldUntil: !b && held.length ? held[0].holdExpiresAt : null,
            quotation: q?.publicToken && q.status !== 'draft' ? `/events/q/${q.publicToken}` : null, quotationStatus: q?.status ?? null,
            booking, basketToken: e.basketId ? await this.basketToken(e.basketId) : null,
        };
    }

    private static async basketToken(id: number) {
        const { celebrationBaskets } = await import('@shared/schema');
        const [x] = await db.select({ t: celebrationBaskets.token }).from(celebrationBaskets).where(eq(celebrationBaskets.id, id)).limit(1);
        return x?.t ?? null;
    }

    static reviewable(b: EventBooking) {
        return b.origin !== 'hub' && (b.status === 'completed' || (b.status === 'confirmed' && b.eventDate < istToday()));
    }

    /**
     * The client cancels. Before any payment, the booking is simply released.
     * After, the partner is asked to cancel it with the refund the terms give
     * (they hold the money and issue the refund voucher).
     */
    static async requestCancel(t: string, note?: string | null) {
        const r = await this.byToken(t);
        if (!r) throw new HubError('Not found', 'NOT_FOUND', 404);
        const { HubAlerts } = await import('./hub-alerts.service');
        if (!r.b) {
            // Only a request so far: withdraw it.
            if (!['new', 'contacted', 'quoted'].includes(r.e.status)) throw new HubError('There is nothing to cancel.', 'BAD_STATE', 409);
            await db.transaction(async (tx) => {
                await BookingCalendar.release(tx, { enquiryId: r.e.id });
                await tx.update(eventEnquiries).set({ status: 'lost', lostReason: `Withdrawn by the client${note?.trim() ? `: ${note.trim().slice(0, 200)}` : ''}`, updatedAt: new Date() }).where(eq(eventEnquiries.id, r.e.id));
            });
            await HubAlerts.send(r.e.businessPartnerId, 'quote_declined', { title: `Request withdrawn: ${r.e.eventType}`, body: `${r.c.name} withdrew their request for ${r.e.eventDate}.`, link: '/partner/events/enquiries', refType: 'event_enquiry', refId: r.e.id });
            return { withdrawn: true };
        }
        const b = r.b;
        if (!['pending', 'confirmed'].includes(b.status)) throw new HubError(`This booking is ${b.status}.`, 'BAD_STATE', 409);
        if (b.eventDate <= istToday()) throw new HubError('The event date has arrived — please call the business.', 'TOO_LATE', 409);
        const paid = (await db.select({ a: eventMilestones.amountPaise }).from(eventMilestones).where(and(eq(eventMilestones.bookingId, b.id), eq(eventMilestones.status, 'paid')))).reduce((a, m) => a + m.a, 0);
        if (b.status === 'pending' && paid === 0) {
            const [u] = await db.update(eventBookings).set({ status: 'cancelled', cancelledReason: `Cancelled by the client before paying${note?.trim() ? `: ${note.trim().slice(0, 200)}` : ''}`, updatedAt: new Date() })
                .where(and(eq(eventBookings.id, b.id), eq(eventBookings.status, 'pending'))).returning();
            if (u) {
                await this.onCancelled(b.id, 0);
                if (b.enquiryId) await db.update(eventEnquiries).set({ status: 'lost', lostReason: 'Cancelled by the client before paying', updatedAt: new Date() }).where(eq(eventEnquiries.id, b.enquiryId));
                await HubAlerts.send(b.businessPartnerId, 'booking_request', { title: `Cancelled by the client: ${b.title}`, body: `${r.c.name} cancelled ${b.eventDate} before paying. The date is free again.`, link: `/partner/events/bookings/${b.id}`, refType: 'event_booking', refId: b.id });
            }
            return { cancelled: true };
        }
        if (b.cancelRequestedAt) throw new HubError('You have already asked to cancel. The business will be in touch.', 'REQUESTED', 409);
        const pct = refundPercentFor(b.cancellationPolicy as any, daysBetween(istToday(), b.eventDate));
        await db.update(eventBookings).set({ cancelRequestedAt: new Date(), cancelRequestNote: note?.trim().slice(0, 500) || null, updatedAt: new Date() }).where(eq(eventBookings.id, b.id));
        await HubAlerts.send(b.businessPartnerId, 'booking_request', {
            title: `Cancellation asked: ${b.title}`,
            body: `${r.c.name} wants to cancel ${b.eventDate}. Under your terms the refund is ${pct}% of the ${rs(paid)} paid = ${rs(Math.round(paid * pct / 100))}. Cancel it from the booking with that refund.${note?.trim() ? ` Their note: "${note.trim().slice(0, 140)}"` : ''}`,
            link: `/partner/events/bookings/${b.id}`, refType: 'event_booking', refId: b.id,
        });
        return { requested: true, refundPercent: pct, refund: Math.round(paid * pct / 100) / 100 };
    }

    /** A verified review: only the client of a UniteFix booking, after the event, once. */
    static async submitReview(t: string, input: { rating: number; body?: string | null }) {
        const r = await this.byToken(t);
        if (!r?.b) throw new HubError('Not found', 'NOT_FOUND', 404);
        const b = r.b;
        if (!this.reviewable(b)) throw new HubError(b.status === 'cancelled' ? 'This booking was cancelled.' : 'You can review once the event has taken place.', 'NOT_YET', 409);
        if (!(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)) throw new HubError('Choose 1 to 5 stars.', 'BAD_RATING');
        const body = input.body?.trim().slice(0, 1500) || null;
        if (input.rating <= 2 && (!body || body.length < 10)) throw new HubError('Tell us a little about what went wrong — it helps the business improve.', 'NEED_TEXT');
        const parts = r.c.name.trim().split(/\s+/);
        const reviewerName = `${parts[0]}${parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : ''}`.slice(0, 40);
        try {
            const [row] = await db.insert(partnerReviews).values({
                businessPartnerId: b.businessPartnerId, kind: listingKindOf(b.kind), bookingId: b.id, reviewerName, occasion: r.e.eventType, eventDate: b.eventDate, rating: input.rating, body,
            }).returning();
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(b.businessPartnerId, 'review_new', { title: `${'★'.repeat(input.rating)}${'☆'.repeat(5 - input.rating)} from ${reviewerName}`, body: body ? `"${body.slice(0, 200)}"` : `${b.title} on ${b.eventDate}.`, link: '/partner/reviews', refType: 'review', refId: row.id });
            return row;
        } catch (e: any) {
            if (e?.code === '23505') throw new HubError('You have already reviewed this booking. Thank you!', 'DONE', 409);
            throw e;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Staff view
    // ══════════════════════════════════════════════════════════════════════

    static async adminBookings(filter: { kind?: string; status?: string; from?: string; to?: string } = {}) {
        const conds: any[] = [ne(eventBookings.origin, 'hub')];
        if (filter.kind) conds.push(eq(eventBookings.kind, filter.kind));
        if (filter.status) conds.push(eq(eventBookings.status, filter.status));
        if (filter.from) conds.push(gte(eventBookings.eventDate, filter.from));
        if (filter.to) conds.push(lte(eventBookings.eventDate, filter.to));
        const rows = await db.select({ b: eventBookings, partner: businessPartners.displayName, code: businessPartners.partnerCode }).from(eventBookings)
            .innerJoin(businessPartners, eq(businessPartners.id, eventBookings.businessPartnerId))
            .where(and(...conds)).orderBy(desc(eventBookings.createdAt)).limit(500);
        const ids = rows.map(r => r.b.id);
        const paid = ids.length ? await db.select({ id: eventMilestones.bookingId, s: sql<number>`coalesce(sum(${eventMilestones.amountPaise}) filter (where ${eventMilestones.status} = 'paid'), 0)::int` })
            .from(eventMilestones).where(inArray(eventMilestones.bookingId, ids)).groupBy(eventMilestones.bookingId) : [];
        const pm = new Map(paid.map(p => [p.id, p.s]));
        // No client names or phone numbers here: staff see the business side.
        return rows.map(r => ({
            id: r.b.id, kind: r.b.kind, origin: r.b.origin, partner: r.partner, partnerCode: r.code, title: r.b.title, eventDate: r.b.eventDate, status: r.b.status,
            total: r.b.totalPaise / 100, paid: (pm.get(r.b.id) ?? 0) / 100, commissionPercent: r.b.commissionPercent != null ? Number(r.b.commissionPercent) : null,
            commission: r.b.commissionPaise != null ? (r.b.commissionPaise + (r.b.commissionGstPaise ?? 0)) / 100 : null, commissionChargedAt: r.b.commissionChargedAt,
            cancelRequested: !!r.b.cancelRequestedAt, createdAt: r.b.createdAt,
        }));
    }
}

function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
