/**
 * Events for business partners (Partner Hub phase 6).
 *
 *   Packages     building blocks for quotes (venue, décor, catering per plate…)
 *   Enquiries    from the Hub, a public page, or the UniteFix customer app
 *   Quotations   the Sales module's versioned quotations (source 'events'),
 *                which the client opens and accepts or declines by link
 *   Bookings     an accepted quotation + a payment plan (advance, balance…)
 *   Advances     a paid milestone before the final invoice gets a GST
 *                RECEIPT VOUCHER (tax due on receipt of an advance for a
 *                service); the final invoice adjusts them (each voucher is
 *                linked to it) and counts them as payments. A cancellation
 *                with a refund issues a REFUND VOUCHER.
 *   Vendors      directory and per-event payables; a paid vendor bill with
 *                GST joins the purchase register (input tax credit)
 *   Event day    checklist and staff on the booking
 */

import crypto from 'crypto';
import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
    eventPackages, eventEnquiries, eventBookings, eventMilestones, eventVendors, eventVendorCosts,
    partnerQuotations, partnerCustomers, partnerInvoicePayments, partnerPurchaseBills, taxDocuments, taxDocumentLines,
    businessPartners, users, serviceablePincodes,
    type EventBooking,
} from '@shared/schema';
import { checkGstin } from '@shared/hub';
import { HubError, type HubContext } from './partner-hub.service';
import { PartnerSalesService, GST_RATES, type SaleLineInput } from './partner-sales.service';
import { TaxDocumentService, type DocLineInput, type Party } from './tax-documents.service';
import { BusinessPartnerService } from './business-partner.service';
import { withTransaction } from '../lib/transaction';

const token = () => crypto.randomBytes(18).toString('base64url');
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const CATEGORIES = ['venue', 'decor', 'catering', 'cake', 'av', 'photography', 'staff', 'other'];

type Ctx = HubContext | { businessPartnerId: number; adminUserId: number | null; plan?: any };

export class PartnerEventsService {

    // ══════════════════════════════════════════════════════════════════════
    // Packages
    // ══════════════════════════════════════════════════════════════════════

    static async packages(bpId: number, activeOnly = false) {
        return db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), ...(activeOnly ? [eq(eventPackages.isActive, true)] : [])))
            .orderBy(asc(eventPackages.category), asc(eventPackages.name));
    }

    static async savePackage(ctx: HubContext, id: number | null, input: { name?: string; category?: string; description?: string | null; unit?: string; priceRupees?: number; sac?: string; gstRate?: number; isActive?: boolean; photos?: string[]; capacity?: number | null; showOnPage?: boolean; maxQty?: number | null }) {
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        if (input.name !== undefined && !input.name.trim()) throw new HubError('Name the package.', 'NO_NAME');
        if (input.category !== undefined && !CATEGORIES.includes(input.category)) throw new HubError(`Category is one of ${CATEGORIES.join(', ')}.`, 'BAD_CATEGORY');
        if (input.priceRupees !== undefined && !(input.priceRupees >= 0)) throw new HubError('Price cannot be negative.', 'BAD_PRICE');
        if (input.sac !== undefined && !/^99\d{2,4}$/.test(input.sac)) throw new HubError('A service SAC starts with 99 (998596 event management, 996337 outdoor catering).', 'BAD_SAC');
        if (input.gstRate !== undefined && bp?.gstin && !GST_RATES.includes(input.gstRate)) throw new HubError('Bad GST rate.', 'BAD_RATE');
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) v.name = input.name.trim().slice(0, 120);
        if (input.category !== undefined) v.category = input.category;
        if (input.description !== undefined) v.description = input.description?.trim() || null;
        if (input.unit !== undefined) v.unit = input.unit.trim().slice(0, 20) || 'event';
        if (input.priceRupees !== undefined) v.pricePaise = Math.round(input.priceRupees * 100);
        if (input.sac !== undefined) v.sac = input.sac;
        if (input.gstRate !== undefined) v.gstRate = String(bp?.gstin ? input.gstRate : 0);
        if (input.isActive !== undefined) v.isActive = input.isActive;
        // Shown on the public page: venue photos and capacity, whether it is offered as an add-on, and a count limit.
        if (input.photos !== undefined) v.photos = (input.photos ?? []).filter(u => typeof u === 'string' && (/^https:\/\/\S+$/i.test(u) || /^data:image\//i.test(u))).slice(0, 8);
        if (input.capacity !== undefined) { if (input.capacity != null && !(Number.isInteger(input.capacity) && input.capacity > 0 && input.capacity <= 100000)) throw new HubError('Capacity is a number of guests.', 'BAD_CAPACITY'); v.capacity = input.capacity; }
        if (input.showOnPage !== undefined) v.showOnPage = input.showOnPage;
        if (input.maxQty !== undefined) { if (input.maxQty != null && !(Number.isInteger(input.maxQty) && input.maxQty >= 1 && input.maxQty <= 500)) throw new HubError('Most a client can order: 1–500.', 'BAD_MAX'); v.maxQty = input.maxQty; }
        if (id) {
            const [u] = await db.update(eventPackages).set({ ...v, updatedAt: new Date() }).where(and(eq(eventPackages.id, id), eq(eventPackages.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
            return u;
        }
        if (!v.name || v.pricePaise === undefined) throw new HubError('Name and price are required.', 'MISSING');
        const [row] = await db.insert(eventPackages).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any), gstRate: v.gstRate ?? String(bp?.gstin ? 18 : 0) }).returning();
        return row;
    }

    /** Package picks → quotation lines. */
    static async linesFromPackages(bpId: number, picks: Array<{ packageId: number; quantity: number }>): Promise<SaleLineInput[]> {
        if (!picks.length) return [];
        const pk = await db.select().from(eventPackages).where(and(eq(eventPackages.businessPartnerId, bpId), inArray(eventPackages.id, picks.map(p => p.packageId))));
        const by = new Map(pk.map(p => [p.id, p]));
        return picks.map(p => {
            const x = by.get(p.packageId);
            if (!x) throw new HubError(`Package #${p.packageId} not found.`, 'NO_PACKAGE');
            return { description: x.name + (x.description ? ` — ${x.description}` : ''), hsnSac: x.sac, quantity: p.quantity, unit: x.unit, rateRupees: x.pricePaise / 100, gstRate: Number(x.gstRate) };
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // Enquiries
    // ══════════════════════════════════════════════════════════════════════

    /** Find the partner's customer by phone, or add them. */
    private static async customerFor(bpId: number, input: { name: string; phone: string; email?: string | null; tag: string }) {
        const phone = String(input.phone ?? '').replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) throw new HubError('A 10-digit mobile number, please.', 'BAD_PHONE');
        if (!input.name?.trim()) throw new HubError('A name, please.', 'NO_NAME');
        const [c] = await db.select().from(partnerCustomers).where(and(eq(partnerCustomers.businessPartnerId, bpId), eq(partnerCustomers.phone, phone), isNull(partnerCustomers.archivedAt))).limit(1);
        if (c) return c;
        const bp = await BusinessPartnerService.byId(bpId);
        const [n] = await db.insert(partnerCustomers).values({ businessPartnerId: bpId, name: input.name.trim().slice(0, 160), phone, email: input.email?.trim().toLowerCase() || null, stateCode: bp?.stateCode ?? null, stateName: bp?.stateName ?? null, tags: [input.tag] }).returning();
        return n;
    }

    static async createEnquiry(ctx: Ctx, input: {
        customerId?: number | null; name?: string; phone?: string; email?: string | null; userId?: number | null; source?: 'hub' | 'public' | 'app';
        eventType: string; eventDate?: string | null; guests?: number | null; venue?: string | null; budgetRupees?: number | null; message?: string | null;
    }) {
        if (!input.eventType?.trim()) throw new HubError('What kind of event?', 'NO_TYPE');
        if (input.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) throw new HubError('Event date is YYYY-MM-DD.', 'BAD_DATE');
        if (input.eventDate && input.eventDate < today()) throw new HubError('The event date has passed.', 'PAST_DATE');
        if (input.guests != null && !(input.guests > 0 && input.guests <= 100000)) throw new HubError('Guests must be a positive number.', 'BAD_GUESTS');
        const customer = input.customerId ? await PartnerSalesService.customer(ctx.businessPartnerId, input.customerId)
            : await this.customerFor(ctx.businessPartnerId, { name: input.name ?? '', phone: input.phone ?? '', email: input.email, tag: input.source === 'app' ? 'unitefix app' : 'events' });
        const [row] = await db.insert(eventEnquiries).values({
            businessPartnerId: ctx.businessPartnerId, customerId: customer.id, userId: input.userId ?? null, source: input.source ?? 'hub',
            eventType: input.eventType.trim().slice(0, 80), eventDate: input.eventDate ?? null, guests: input.guests ?? null, venue: input.venue?.trim() || null,
            budgetPaise: input.budgetRupees != null ? Math.round(input.budgetRupees * 100) : null, message: input.message?.trim() || null, publicToken: token(),
        }).returning();
        if (row.source !== 'hub') {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(ctx.businessPartnerId, 'enquiry_new', { title: `New enquiry: ${row.eventType}`, body: `${customer.name}${row.eventDate ? ` · ${row.eventDate}` : ''}${row.guests ? ` · ${row.guests} guests` : ''} — via ${row.source === 'app' ? 'the UniteFix app' : 'your enquiry page'}.`, link: '/partner/events/enquiries', refType: 'event_enquiry', refId: row.id });
        }
        return row;
    }

    static async enquiries(bpId: number, status?: string) {
        return db.select({ e: eventEnquiries, customerName: partnerCustomers.name, customerPhone: partnerCustomers.phone })
            .from(eventEnquiries).innerJoin(partnerCustomers, eq(partnerCustomers.id, eventEnquiries.customerId))
            .where(and(eq(eventEnquiries.businessPartnerId, bpId), ...(status ? [eq(eventEnquiries.status, status)] : []))).orderBy(desc(eventEnquiries.createdAt)).limit(500);
    }

    static async enquiry(bpId: number, id: number) {
        const [e] = await db.select().from(eventEnquiries).where(and(eq(eventEnquiries.id, id), eq(eventEnquiries.businessPartnerId, bpId))).limit(1);
        if (!e) throw new HubError('Enquiry not found', 'NOT_FOUND', 404);
        return e;
    }

    static async updateEnquiry(ctx: HubContext, id: number, patch: { status?: 'new' | 'contacted' | 'quoted' | 'lost'; lostReason?: string | null; eventDate?: string | null; guests?: number | null; venue?: string | null }) {
        const e = await this.enquiry(ctx.businessPartnerId, id);
        if (e.status === 'won' && patch.status) throw new HubError('This enquiry is already a booking.', 'WON', 409);
        const [u] = await db.update(eventEnquiries).set({
            ...(patch.status ? { status: patch.status } : {}), ...(patch.lostReason !== undefined ? { lostReason: patch.lostReason } : {}),
            ...(patch.eventDate !== undefined ? { eventDate: patch.eventDate } : {}), ...(patch.guests !== undefined ? { guests: patch.guests } : {}),
            ...(patch.venue !== undefined ? { venue: patch.venue } : {}), updatedAt: new Date(),
        }).where(eq(eventEnquiries.id, id)).returning();
        return u;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Quotations (Sales module, source 'events')
    // ══════════════════════════════════════════════════════════════════════

    static async quote(ctx: HubContext, enquiryId: number, input: { packages?: Array<{ packageId: number; quantity: number }>; lines?: SaleLineInput[]; validUntil?: string | null; notes?: string | null; terms?: string | null }) {
        const e = await this.enquiry(ctx.businessPartnerId, enquiryId);
        const lines = [...await this.linesFromPackages(ctx.businessPartnerId, input.packages ?? []), ...(input.lines ?? [])];
        if (!lines.length) throw new HubError('Add packages or lines.', 'NO_LINES');
        const q = await PartnerSalesService.createQuotation(ctx, {
            customerId: e.customerId, lines, validUntil: input.validUntil ?? (e.eventDate ? (addDays(today(), 14) < e.eventDate ? addDays(today(), 14) : e.eventDate) : addDays(today(), 14)),
            notes: input.notes ?? `${e.eventType}${e.eventDate ? ` on ${e.eventDate}` : ''}${e.guests ? `, ${e.guests} guests` : ''}${e.venue ? `, ${e.venue}` : ''}.`,
            terms: input.terms, source: 'events', sourceRefId: e.id,
        });
        await db.update(eventEnquiries).set({ status: 'quoted', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
        return q;
    }

    /** Give a quotation its client link (and mark it sent). Revisions get their own link. */
    static async share(ctx: HubContext, quotationId: number) {
        const q = await PartnerSalesService.quotation(ctx.businessPartnerId, quotationId);
        if (['superseded', 'invoiced'].includes(q.status)) throw new HubError(`This quotation is ${q.status}.`, 'BAD_STATE', 409);
        const t = q.publicToken ?? token();
        const [u] = await db.update(partnerQuotations).set({ publicToken: t, status: q.status === 'draft' ? 'sent' : q.status, updatedAt: new Date() }).where(eq(partnerQuotations.id, q.id)).returning();
        return u;
    }

    /** What the client sees. An old version's link shows the latest version. */
    static async publicQuote(t: string) {
        let [q] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.publicToken, t)).limit(1);
        if (!q) return null;
        let replaced = false;
        if (q.status === 'superseded') {
            const [latest] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.businessPartnerId, q.businessPartnerId), eq(partnerQuotations.number, q.number)))
                .orderBy(desc(partnerQuotations.version)).limit(1);
            if (latest && latest.id !== q.id) {
                if (!latest.publicToken) [q] = await db.update(partnerQuotations).set({ publicToken: token() }).where(eq(partnerQuotations.id, latest.id)).returning();
                else q = latest;
                replaced = true;
            }
        }
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, q.businessPartnerId)).limit(1);
        const [c] = await db.select().from(partnerCustomers).where(eq(partnerCustomers.id, q.customerId)).limit(1);
        return {
            token: q.publicToken, replaced, number: q.number, version: q.version, status: q.status, validUntil: q.validUntil, partner: bp?.displayName, partnerPhone: bp?.contactPhone,
            customer: c?.name, lines: (q.lines as any[]).map(l => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, rate: l.ratePaise / 100, gstRate: Number(l.gstRate), value: l.taxablePaise / 100 })),
            taxable: q.taxablePaise / 100, tax: q.taxPaise / 100, total: q.totalPaise / 100, notes: q.notes, terms: q.terms, respondedAt: q.respondedAt,
            expired: !!q.validUntil && q.validUntil < today(),
        };
    }

    static async respond(t: string, decision: 'accept' | 'decline', note?: string | null) {
        const [q] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.publicToken, t)).limit(1);
        if (!q) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (!['sent', 'draft'].includes(q.status)) throw new HubError(q.status === 'superseded' ? 'This quotation was revised — open the link again to see the latest.' : `This quotation is already ${q.status}.`, 'BAD_STATE', 409);
        if (q.validUntil && q.validUntil < today()) throw new HubError('This quotation has expired. Ask for a fresh one.', 'EXPIRED', 409);
        const [u] = await db.update(partnerQuotations).set({ status: decision === 'accept' ? 'accepted' : 'declined', respondedAt: new Date(), clientResponseNote: note?.trim() || null, updatedAt: new Date() })
            .where(and(eq(partnerQuotations.id, q.id), inArray(partnerQuotations.status, ['sent', 'draft']))).returning();
        if (!u) throw new HubError('Already answered.', 'BAD_STATE', 409);
        {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(q.businessPartnerId, decision === 'accept' ? 'quote_accepted' : 'quote_declined', { title: `Quotation ${q.number} ${decision === 'accept' ? 'accepted' : 'declined'}`, body: decision === 'accept' ? `The client accepted ₹${(q.totalPaise / 100).toLocaleString('en-IN')}. Confirm the booking and the advance.` : `The client declined${note?.trim() ? `: "${note.trim().slice(0, 140)}"` : '.'}`, link: q.source === 'events' ? '/partner/events/quotations' : `/partner/sales/quotations/${q.id}`, refType: 'quotation', refId: q.id });
        }
        if (decision === 'decline' && q.source === 'events' && q.sourceRefId) {
            await db.update(eventEnquiries).set({ status: 'lost', lostReason: note?.trim() || 'Client declined the quotation', updatedAt: new Date() }).where(and(eq(eventEnquiries.id, q.sourceRefId), ne(eventEnquiries.status, 'won')));
        }
        return u;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Bookings and the payment plan
    // ══════════════════════════════════════════════════════════════════════

    static async confirmBooking(ctx: HubContext, quotationId: number, input: {
        title?: string; eventDate?: string; venue?: string | null; guests?: number | null;
        milestones?: Array<{ label: string; amountRupees?: number; percent?: number; dueDate?: string | null }>;
    }) {
        const q = await PartnerSalesService.quotation(ctx.businessPartnerId, quotationId);
        if (q.status !== 'accepted') throw new HubError('Confirm a booking once the client has accepted the quotation (or mark it accepted).', 'NOT_ACCEPTED', 409);
        const e = q.source === 'events' && q.sourceRefId ? await this.enquiry(ctx.businessPartnerId, q.sourceRefId) : null;
        const eventDate = input.eventDate ?? e?.eventDate;
        if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new HubError('The event date is needed.', 'NO_DATE');
        const total = q.totalPaise;
        const plan = input.milestones?.length ? input.milestones : [
            { label: 'Advance on booking', percent: 30, dueDate: today() },
            { label: 'Balance before the event', percent: 70, dueDate: addDays(eventDate, -3) < today() ? today() : addDays(eventDate, -3) },
        ];
        let rows = plan.map((m, i) => ({ label: m.label?.trim() || `Payment ${i + 1}`, amountPaise: m.amountRupees != null ? Math.round(m.amountRupees * 100) : Math.round(total * (m.percent ?? 0) / 100), dueDate: m.dueDate ?? null, sortOrder: i }));
        // Percentages round; the last milestone takes the paise so the plan sums to the quote exactly.
        const diff = total - rows.reduce((a, r) => a + r.amountPaise, 0);
        if (input.milestones?.some(m => m.amountRupees != null)) { if (diff !== 0) throw new HubError(`The payments add up to ₹${(total - diff) / 100}, not the quoted ₹${total / 100}.`, 'PLAN_MISMATCH'); }
        else rows[rows.length - 1].amountPaise += diff;
        if (rows.some(r => r.amountPaise <= 0)) throw new HubError('Every payment must be more than zero.', 'BAD_PLAN');
        const dates = await db.select({ id: eventBookings.id }).from(eventBookings).where(and(eq(eventBookings.businessPartnerId, ctx.businessPartnerId), eq(eventBookings.eventDate, eventDate), ne(eventBookings.status, 'cancelled')));
        try {
            return await withTransaction(async (tx) => {
                const [b] = await tx.insert(eventBookings).values({
                    businessPartnerId: ctx.businessPartnerId, enquiryId: e?.id ?? null, customerId: q.customerId, quotationId: q.id,
                    title: (input.title?.trim() || (e ? `${e.eventType}` : `Event ${q.number}`)).slice(0, 120), eventDate, venue: input.venue ?? e?.venue ?? null, guests: input.guests ?? e?.guests ?? null,
                    totalPaise: total, createdByAdminUserId: ctx.adminUserId,
                    checklist: [{ text: 'Confirm venue access time', done: false }, { text: 'Final guest count', done: false }, { text: 'Vendors confirmed', done: false }] as any,
                }).returning();
                await tx.insert(eventMilestones).values(rows.map(r => ({ bookingId: b.id, ...r })));
                if (e) await tx.update(eventEnquiries).set({ status: 'won', updatedAt: new Date() }).where(eq(eventEnquiries.id, e.id));
                return { booking: b, sameDay: dates.length };
            });
        } catch (err: any) {
            if (err?.code === '23505') throw new HubError('This quotation is already a booking.', 'BOOKED', 409);
            throw err;
        }
    }

    static async bookings(bpId: number, opts: { from?: string; to?: string } = {}) {
        const conds: any[] = [eq(eventBookings.businessPartnerId, bpId)];
        if (opts.from) conds.push(gte(eventBookings.eventDate, opts.from));
        if (opts.to) conds.push(lt(eventBookings.eventDate, opts.to));
        const rows = await db.select({ b: eventBookings, customerName: partnerCustomers.name, customerPhone: partnerCustomers.phone })
            .from(eventBookings).innerJoin(partnerCustomers, eq(partnerCustomers.id, eventBookings.customerId))
            .where(and(...conds)).orderBy(asc(eventBookings.eventDate)).limit(500);
        const ids = rows.map(r => r.b.id);
        const paid = ids.length ? await db.select({ id: eventMilestones.bookingId, s: sql<number>`coalesce(sum(case when ${eventMilestones.status} = 'paid' then ${eventMilestones.amountPaise} else 0 end), 0)::int` })
            .from(eventMilestones).where(inArray(eventMilestones.bookingId, ids)).groupBy(eventMilestones.bookingId) : [];
        const costs = ids.length ? await db.select({ id: eventVendorCosts.bookingId, s: sql<number>`coalesce(sum(${eventVendorCosts.taxablePaise} + ${eventVendorCosts.gstPaise}), 0)::int` })
            .from(eventVendorCosts).where(inArray(eventVendorCosts.bookingId, ids)).groupBy(eventVendorCosts.bookingId) : [];
        const pm = new Map(paid.map(p => [p.id, p.s])), cm = new Map(costs.map(c => [c.id, c.s]));
        return rows.map(r => ({ ...r, paidPaise: pm.get(r.b.id) ?? 0, vendorCostPaise: cm.get(r.b.id) ?? 0 }));
    }

    static async booking(bpId: number, id: number) {
        const [b] = await db.select().from(eventBookings).where(and(eq(eventBookings.id, id), eq(eventBookings.businessPartnerId, bpId))).limit(1);
        if (!b) throw new HubError('Booking not found', 'NOT_FOUND', 404);
        return b;
    }

    static async bookingDetail(bpId: number, id: number) {
        const b = await this.booking(bpId, id);
        const [c] = await db.select().from(partnerCustomers).where(eq(partnerCustomers.id, b.customerId)).limit(1);
        const [q] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.id, b.quotationId)).limit(1);
        const milestones = await db.select({ m: eventMilestones, receiptNumber: taxDocuments.number }).from(eventMilestones)
            .leftJoin(taxDocuments, eq(taxDocuments.id, eventMilestones.receiptDocumentId)).where(eq(eventMilestones.bookingId, id)).orderBy(asc(eventMilestones.sortOrder));
        const costs = await db.select({ c: eventVendorCosts, vendorName: eventVendors.name }).from(eventVendorCosts)
            .innerJoin(eventVendors, eq(eventVendors.id, eventVendorCosts.vendorId)).where(eq(eventVendorCosts.bookingId, id)).orderBy(asc(eventVendorCosts.createdAt));
        const refunds = await db.select().from(taxDocuments).where(and(eq(taxDocuments.issuerPartnerId, bpId), eq(taxDocuments.docKind, 'refund_voucher'), sql`${taxDocuments.notes} LIKE ${`%Event booking #${id}.%`}`));
        return { booking: b, customer: c, quotation: q, milestones, costs, refunds };
    }

    static async updateBooking(ctx: HubContext, id: number, patch: { checklist?: Array<{ text: string; done: boolean; owner?: string | null }>; staff?: Array<{ name: string; role?: string | null; phone?: string | null }>; notes?: string | null; venue?: string | null; guests?: number | null; status?: 'completed' }) {
        const b = await this.booking(ctx.businessPartnerId, id);
        if (b.status === 'cancelled') throw new HubError('This booking is cancelled.', 'CANCELLED', 409);
        if (patch.status === 'completed' && b.eventDate > today()) throw new HubError('Mark it completed after the event.', 'TOO_EARLY', 409);
        const [u] = await db.update(eventBookings).set({
            ...(patch.checklist ? { checklist: patch.checklist.slice(0, 100).map(x => ({ text: String(x.text).slice(0, 200), done: !!x.done, owner: x.owner ?? null })) as any } : {}),
            ...(patch.staff ? { staff: patch.staff.slice(0, 100).map(x => ({ name: String(x.name).slice(0, 80), role: x.role ?? null, phone: x.phone ?? null })) as any } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.venue !== undefined ? { venue: patch.venue } : {}),
            ...(patch.guests !== undefined ? { guests: patch.guests } : {}), ...(patch.status ? { status: patch.status } : {}), updatedAt: new Date(),
        }).where(eq(eventBookings.id, id)).returning();
        return u;
    }

    /**
     * Split a GST-inclusive amount across the quotation's tax rates in
     * proportion to the quotation, and carve the tax out of each part.
     */
    private static async advanceLines(b: EventBooking, amountPaise: number, label: string): Promise<DocLineInput[]> {
        const [q] = await db.select().from(partnerQuotations).where(eq(partnerQuotations.id, b.quotationId)).limit(1);
        const byRate = new Map<number, { gross: number; sac: string | null }>();
        for (const l of q.lines as any[]) {
            const r = Number(l.gstRate), gross = l.taxablePaise + Math.round(l.taxablePaise * r / 100);
            const x = byRate.get(r) ?? { gross: 0, sac: l.hsnSac ?? null };
            x.gross += gross; byRate.set(r, x);
        }
        const totalGross = Array.from(byRate.values()).reduce((a, x) => a + x.gross, 0) || 1;
        const entries = Array.from(byRate.entries()).sort((a, b2) => b2[1].gross - a[1].gross);
        let left = amountPaise;
        return entries.map(([rate, x], i) => {
            const part = i === entries.length - 1 ? left : Math.round(amountPaise * x.gross / totalGross);
            left -= part;
            const taxable = Math.round(part * 100 / (100 + rate));
            return { description: `${label} — advance for ${b.title} on ${b.eventDate}`, hsnSac: x.sac, quantity: 1, unit: null, ratePaise: taxable, taxablePaise: taxable, gstRate: rate, taxPaise: part - taxable };
        }).filter(l => l.taxablePaise + (l.taxPaise ?? 0) > 0);
    }

    /**
     * A client paid a milestone. Before the final invoice it is an advance:
     * a receipt voucher is issued for it. After, it is a payment against the
     * final invoice.
     */
    static async payMilestone(ctx: HubContext, milestoneId: number, input: { method: string; reference?: string | null; paidOn?: string | null }) {
        const [m] = await db.select().from(eventMilestones).where(eq(eventMilestones.id, milestoneId)).limit(1);
        if (!m) throw new HubError('Not found', 'NOT_FOUND', 404);
        const b = await this.booking(ctx.businessPartnerId, m.bookingId);
        if (b.status === 'cancelled') throw new HubError('This booking is cancelled.', 'CANCELLED', 409);
        if (m.status === 'paid') throw new HubError('Already recorded as paid.', 'PAID', 409);
        if (!['cash', 'upi', 'bank', 'card', 'cheque', 'online', 'other'].includes(input.method)) throw new HubError('Unknown payment method.', 'BAD_METHOD');
        const paidOn = input.paidOn ?? today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > today()) throw new HubError('Paid on must be a date, not in the future.', 'BAD_DATE');
        if (b.finalInvoiceDocumentId) {
            await PartnerSalesService.recordPayment(ctx, b.finalInvoiceDocumentId, { amountRupees: m.amountPaise / 100, method: input.method, reference: input.reference ?? null, receivedOn: paidOn, notes: m.label });
            const [u] = await db.update(eventMilestones).set({ status: 'paid', paidOn, method: input.method, reference: input.reference ?? null }).where(eq(eventMilestones.id, m.id)).returning();
            return { milestone: u, voucher: null };
        }
        const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
        const [c] = await db.select().from(partnerCustomers).where(eq(partnerCustomers.id, b.customerId)).limit(1);
        const lines = await this.advanceLines(b, m.amountPaise, m.label);
        const prefix = await PartnerSalesService.prefixFor(ctx.businessPartnerId);
        return withTransaction(async (tx) => {
            const doc = await TaxDocumentService.create(tx as any, {
                docKind: 'receipt_voucher', issuer: 'partner', issuerPartnerId: ctx.businessPartnerId, seriesKey: `bp-${ctx.businessPartnerId}-rv`, prefix, letter: 'R', numberWidth: 4,
                purpose: 'event_advance', supplier: TaxDocumentService.partnerParty(bp!), recipient: PartnerSalesService.customerParty(c), lines, partnerCustomerId: c.id,
                notes: `Advance received by ${input.method}${input.reference ? ` (${input.reference})` : ''} on ${paidOn}. Event booking #${b.id}. Adjusted against the final invoice.${bp?.gstin ? '' : ' Supplier not registered under GST.'}`,
                createdByAdminId: ctx.adminUserId,
            });
            const [u] = await tx.update(eventMilestones).set({ status: 'paid', paidOn, method: input.method, reference: input.reference ?? null, receiptDocumentId: doc.id }).where(and(eq(eventMilestones.id, m.id), eq(eventMilestones.status, 'due'))).returning();
            if (!u) throw new HubError('Already recorded as paid.', 'PAID', 409);
            return { milestone: u, voucher: doc };
        });
    }

    /**
     * The final tax invoice, from the accepted quotation. Advances already
     * taxed on their receipt vouchers are adjusted: each voucher is linked to
     * this invoice (GST desk Table 11B) and counted as a payment on it.
     */
    static async finalInvoice(ctx: HubContext, bookingId: number, input: { dueDate?: string | null } = {}) {
        const b = await this.booking(ctx.businessPartnerId, bookingId);
        if (b.finalInvoiceDocumentId) throw new HubError('The final invoice is already issued.', 'INVOICED', 409);
        if (b.status === 'cancelled') throw new HubError('This booking is cancelled.', 'CANCELLED', 409);
        const paid = await db.select({ m: eventMilestones, rv: taxDocuments }).from(eventMilestones)
            .innerJoin(taxDocuments, eq(taxDocuments.id, eventMilestones.receiptDocumentId))
            .where(and(eq(eventMilestones.bookingId, b.id), eq(eventMilestones.status, 'paid')));
        const doc = await PartnerSalesService.invoiceFromQuotation(ctx, b.quotationId, { dueDate: input.dueDate ?? b.eventDate });
        const advance = paid.reduce((a, p) => a + p.m.amountPaise, 0);
        if (paid.length) {
            await db.update(taxDocuments).set({ originalDocumentId: doc.id }).where(inArray(taxDocuments.id, paid.map(p => p.rv.id)));
            const extra = ` Advances adjusted: ${paid.map(p => `${p.rv.number} ₹${(p.m.amountPaise / 100).toFixed(2)}`).join(', ')}. Balance ₹${(Math.max(0, doc.totalPaise - advance) / 100).toFixed(2)}.`;
            await db.update(taxDocuments).set({ notes: sql`coalesce(${taxDocuments.notes}, '') || ${extra}` }).where(eq(taxDocuments.id, doc.id));
            let left = doc.totalPaise;
            for (const p of paid) {
                const amt = Math.min(p.m.amountPaise, left);
                if (amt <= 0) break;
                await db.insert(partnerInvoicePayments).values({ businessPartnerId: ctx.businessPartnerId, documentId: doc.id, amountPaise: amt, method: 'advance', reference: p.rv.number, receivedOn: p.m.paidOn ?? today(), notes: p.m.label, createdByAdminUserId: ctx.adminUserId });
                left -= amt;
            }
        }
        await db.update(eventBookings).set({ finalInvoiceDocumentId: doc.id, updatedAt: new Date() }).where(eq(eventBookings.id, b.id));
        const [fresh] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, doc.id));
        return fresh;
    }

    /** Cancel; any refund of advances is a refund voucher (reverses the advance tax). */
    static async cancel(ctx: HubContext, bookingId: number, input: { reason: string; refundRupees?: number }) {
        const b = await this.booking(ctx.businessPartnerId, bookingId);
        if (b.status === 'cancelled') throw new HubError('Already cancelled.', 'CANCELLED', 409);
        if (b.finalInvoiceDocumentId) throw new HubError('The final invoice is issued — cancel it with a credit note in Sales.', 'INVOICED', 409);
        if (!input.reason?.trim()) throw new HubError('Say why.', 'NO_REASON');
        const refund = Math.round((input.refundRupees ?? 0) * 100);
        const paid = await db.select().from(eventMilestones).where(and(eq(eventMilestones.bookingId, b.id), eq(eventMilestones.status, 'paid')));
        const advance = paid.reduce((a, m) => a + m.amountPaise, 0);
        if (refund < 0 || refund > advance) throw new HubError(`The refund can be at most the ₹${advance / 100} received.`, 'OVER_REFUND');
        let voucher = null;
        if (refund > 0) {
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            const [c] = await db.select().from(partnerCustomers).where(eq(partnerCustomers.id, b.customerId)).limit(1);
            const lines = await this.advanceLines(b, refund, 'Refund');
            const prefix = await PartnerSalesService.prefixFor(ctx.businessPartnerId);
            const firstRv = paid.find(m => m.receiptDocumentId)?.receiptDocumentId ?? null;
            voucher = await withTransaction(async (tx) => TaxDocumentService.create(tx as any, {
                docKind: 'refund_voucher', issuer: 'partner', issuerPartnerId: ctx.businessPartnerId, seriesKey: `bp-${ctx.businessPartnerId}-rf`, prefix, letter: 'F', numberWidth: 4,
                purpose: 'event_advance', originalDocumentId: firstRv, supplier: TaxDocumentService.partnerParty(bp!), recipient: PartnerSalesService.customerParty(c), lines, partnerCustomerId: c.id,
                notes: `Refund of advance on cancellation. Event booking #${b.id}. ${input.reason.trim()}`, createdByAdminId: ctx.adminUserId,
            }));
        }
        await db.update(eventBookings).set({ status: 'cancelled', cancelledReason: input.reason.trim(), updatedAt: new Date() }).where(eq(eventBookings.id, b.id));
        return { voucher, kept: (advance - refund) / 100 };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Vendors and payables
    // ══════════════════════════════════════════════════════════════════════

    static async vendors(bpId: number) {
        return db.select().from(eventVendors).where(eq(eventVendors.businessPartnerId, bpId)).orderBy(desc(eventVendors.isActive), asc(eventVendors.name));
    }

    static async saveVendor(ctx: HubContext, id: number | null, input: { name?: string; category?: string; phone?: string | null; gstin?: string | null; notes?: string | null; isActive?: boolean }) {
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) { if (!input.name.trim()) throw new HubError('Name the vendor.', 'NO_NAME'); v.name = input.name.trim().slice(0, 120); }
        if (input.category !== undefined) { if (!CATEGORIES.includes(input.category)) throw new HubError('Unknown category.', 'BAD_CATEGORY'); v.category = input.category; }
        if (input.phone !== undefined) v.phone = input.phone ? String(input.phone).replace(/\D/g, '').slice(-10) || null : null;
        if (input.gstin !== undefined) {
            const g = input.gstin?.trim().toUpperCase() || null;
            if (g && !checkGstin(g).valid) throw new HubError(`GSTIN: ${checkGstin(g).reason}`, 'BAD_GSTIN');
            v.gstin = g;
        }
        if (input.notes !== undefined) v.notes = input.notes?.trim() || null;
        if (input.isActive !== undefined) v.isActive = input.isActive;
        if (id) {
            const [u] = await db.update(eventVendors).set(v).where(and(eq(eventVendors.id, id), eq(eventVendors.businessPartnerId, ctx.businessPartnerId))).returning();
            if (!u) throw new HubError('Not found', 'NOT_FOUND', 404);
            return u;
        }
        if (!v.name) throw new HubError('Name the vendor.', 'NO_NAME');
        const [row] = await db.insert(eventVendors).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any) }).returning();
        return row;
    }

    static async addCost(ctx: HubContext, bookingId: number, input: { vendorId: number; description: string; taxableRupees: number; gstRupees?: number; dueDate?: string | null }) {
        await this.booking(ctx.businessPartnerId, bookingId);
        const [v] = await db.select().from(eventVendors).where(and(eq(eventVendors.id, input.vendorId), eq(eventVendors.businessPartnerId, ctx.businessPartnerId))).limit(1);
        if (!v) throw new HubError('Vendor not found', 'NOT_FOUND', 404);
        if (!input.description?.trim()) throw new HubError('What is it for?', 'NO_DESC');
        if (!(input.taxableRupees > 0)) throw new HubError('Amount must be more than zero.', 'BAD_AMOUNT');
        const gst = Math.round((input.gstRupees ?? 0) * 100);
        if (gst > 0 && !v.gstin) throw new HubError('This vendor has no GSTIN on file, so they cannot charge GST.', 'NO_GSTIN');
        const [row] = await db.insert(eventVendorCosts).values({ bookingId, vendorId: v.id, description: input.description.trim().slice(0, 200), taxablePaise: Math.round(input.taxableRupees * 100), gstPaise: gst, dueDate: input.dueDate ?? null }).returning();
        return row;
    }

    /** Pay a vendor. With their GST bill number, the bill joins the purchase register for input tax credit. */
    static async payCost(ctx: HubContext, costId: number, input: { paidOn?: string | null; reference?: string | null; billNumber?: string | null }) {
        const [c] = await db.select({ c: eventVendorCosts, v: eventVendors, bpId: eventBookings.businessPartnerId }).from(eventVendorCosts)
            .innerJoin(eventVendors, eq(eventVendors.id, eventVendorCosts.vendorId)).innerJoin(eventBookings, eq(eventBookings.id, eventVendorCosts.bookingId))
            .where(eq(eventVendorCosts.id, costId)).limit(1);
        if (!c || c.bpId !== ctx.businessPartnerId) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (c.c.status === 'paid') throw new HubError('Already paid.', 'PAID', 409);
        const paidOn = input.paidOn ?? today();
        let billId: number | null = null;
        if (c.c.gstPaise > 0) {
            if (!input.billNumber?.trim()) throw new HubError('Enter the vendor\'s GST bill number — it goes to your purchase register.', 'NO_BILL');
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            const inter = !!bp?.stateCode && !!c.v.gstin && c.v.gstin.slice(0, 2) !== bp.stateCode;
            const cg = inter ? 0 : Math.round(c.c.gstPaise / 2);
            try {
                const [pb] = await db.insert(partnerPurchaseBills).values({
                    businessPartnerId: ctx.businessPartnerId, supplierName: c.v.name, supplierGstin: c.v.gstin, billNumber: input.billNumber.trim(), billDate: paidOn,
                    taxablePaise: c.c.taxablePaise, cgstPaise: cg, sgstPaise: inter ? 0 : c.c.gstPaise - cg, igstPaise: inter ? c.c.gstPaise : 0,
                    totalPaise: c.c.taxablePaise + c.c.gstPaise, notes: `Event vendor cost #${c.c.id}`, createdByAdminUserId: ctx.adminUserId,
                }).returning();
                billId = pb.id;
            } catch (e: any) {
                if (e?.code === '23505') throw new HubError('That bill number from this vendor is already in your purchase register.', 'DUP_BILL', 409);
                throw e;
            }
        }
        const [u] = await db.update(eventVendorCosts).set({ status: 'paid', paidOn, reference: input.reference ?? null, billNumber: input.billNumber?.trim() || null, purchaseBillId: billId }).where(eq(eventVendorCosts.id, costId)).returning();
        return u;
    }

    static async payables(bpId: number) {
        return db.select({ c: eventVendorCosts, vendorName: eventVendors.name, bookingTitle: eventBookings.title, eventDate: eventBookings.eventDate })
            .from(eventVendorCosts).innerJoin(eventVendors, eq(eventVendors.id, eventVendorCosts.vendorId)).innerJoin(eventBookings, eq(eventBookings.id, eventVendorCosts.bookingId))
            .where(and(eq(eventBookings.businessPartnerId, bpId), eq(eventVendorCosts.status, 'due'))).orderBy(asc(eventVendorCosts.dueDate));
    }

    // ══════════════════════════════════════════════════════════════════════
    // The channel: public page and the UniteFix app
    // ══════════════════════════════════════════════════════════════════════

    static async publicPartner(code: string) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.partnerCode, code)).limit(1);
        if (!bp || bp.status !== 'active') return null;
        const { PartnerHubService } = await import('./partner-hub.service');
        return (await PartnerHubService.modulesOf(bp)).includes('events') ? bp : null;
    }

    /** Events partners for a customer's pincode: coverage list, same district, or same 3-digit area. */
    static async partnersNear(pincode: string) {
        const { PartnerHubService } = await import('./partner-hub.service');
        const [sp] = await db.select({ district: serviceablePincodes.district }).from(serviceablePincodes).where(eq(serviceablePincodes.pincode, pincode)).limit(1);
        const bps = await db.select().from(businessPartners).where(eq(businessPartners.status, 'active'));
        const out = [];
        for (const bp of bps) {
            if (!(await PartnerHubService.modulesOf(bp)).includes('events')) continue;
            const near = (bp.coveragePincodes ?? []).includes(pincode) || (!!sp?.district && !!bp.district && sp.district.toLowerCase() === bp.district.toLowerCase()) || (!!bp.pincode && bp.pincode.slice(0, 3) === pincode.slice(0, 3));
            if (!near) continue;
            const pk = await this.packages(bp.id, true);
            out.push({ id: bp.id, code: bp.partnerCode, name: bp.displayName, city: bp.district, categories: Array.from(new Set(pk.map(p => p.category))), startingFrom: pk.length ? Math.min(...pk.map(p => p.pricePaise)) / 100 : null });
        }
        return out;
    }

    static async appEnquire(userId: number, input: { partnerId: number; eventType: string; eventDate?: string | null; guests?: number | null; venue?: string | null; budgetRupees?: number | null; message?: string | null }) {
        const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, input.partnerId)).limit(1);
        if (!bp || !(await this.publicPartner(bp.partnerCode))) throw new HubError('This planner is not taking enquiries.', 'NOT_FOUND', 404);
        const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!u?.phone) throw new HubError('Add your mobile number to your profile first.', 'NO_PHONE');
        const recent = await db.select({ id: eventEnquiries.id }).from(eventEnquiries).where(and(eq(eventEnquiries.userId, userId), eq(eventEnquiries.businessPartnerId, bp.id), gte(eventEnquiries.createdAt, new Date(Date.now() - 10 * 60_000))));
        if (recent.length) throw new HubError('You just sent this planner an enquiry. They will be in touch.', 'DUPLICATE', 429);
        return this.createEnquiry({ businessPartnerId: bp.id, adminUserId: null }, { ...input, name: u.username || 'UniteFix customer', phone: u.phone, email: u.email, userId, source: 'app' });
    }

    /** A UniteFix customer's enquiries, with each one's latest quotation link. */
    static async myEnquiries(userId: number) {
        const rows = await db.select({ e: eventEnquiries, partner: businessPartners.displayName, phone: businessPartners.contactPhone }).from(eventEnquiries)
            .innerJoin(businessPartners, eq(businessPartners.id, eventEnquiries.businessPartnerId))
            .where(eq(eventEnquiries.userId, userId)).orderBy(desc(eventEnquiries.createdAt)).limit(50);
        const out = [];
        for (const r of rows) {
            const [q] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.source, 'events'), eq(partnerQuotations.sourceRefId, r.e.id)))
                .orderBy(desc(partnerQuotations.version)).limit(1);
            out.push({
                id: r.e.id, partner: r.partner, partnerPhone: r.phone, eventType: r.e.eventType, eventDate: r.e.eventDate, guests: r.e.guests, status: r.e.status,
                quotation: q && q.publicToken ? { number: q.number, version: q.version, status: q.status, total: q.totalPaise / 100, link: `/events/q/${q.publicToken}` } : null,
                createdAt: r.e.createdAt,
            });
        }
        return out;
    }

    static async publicEnquiry(t: string) {
        const [r] = await db.select({ e: eventEnquiries, partner: businessPartners.displayName }).from(eventEnquiries).innerJoin(businessPartners, eq(businessPartners.id, eventEnquiries.businessPartnerId)).where(eq(eventEnquiries.publicToken, t)).limit(1);
        if (!r) return null;
        const [q] = await db.select().from(partnerQuotations).where(and(eq(partnerQuotations.source, 'events'), eq(partnerQuotations.sourceRefId, r.e.id))).orderBy(desc(partnerQuotations.version)).limit(1);
        return { partner: r.partner, eventType: r.e.eventType, eventDate: r.e.eventDate, guests: r.e.guests, status: r.e.status, selection: r.e.selection ?? null, quotation: q?.publicToken ? `/events/q/${q.publicToken}` : null };
    }
}
