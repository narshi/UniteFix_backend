/**
 * Book by call (admin → Book by call): a customer phones UniteFix and staff
 * book the service for them.
 *
 * The booking is the same as one made in the app — same catalogue price,
 * partner-territory routing, queue, notifications and bill — with two
 * differences:
 *   - nothing is paid at booking: there is no booking fee, and the customer
 *     pays the whole bill after the service (the bill is the full price, as no
 *     advance was taken);
 *   - it is marked booked_via = 'call', with the staff member and their note.
 * The customer is found by phone, or created (name and phone) when new; their
 * app then shows the booking when they sign in with that number.
 *
 * Visit and consultation services only. Inspection bookings take their fee up
 * front (it is the expert's visit pay if the quote is declined), free-quote
 * services are enquiries, and recharges are not booked.
 */

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { serviceRequests, services as servicesCatalog, serviceCategories, users, customers, adminUsers } from '@shared/schema';
import { storage } from '../storage';
import { BillingEngine } from './billing-engine';
import { BookingBandService } from './booking-band.service';
import { PartnerFieldService } from './partner-field.service';
import { BookingNotifications } from './booking-notifications';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

export class CallBookingError extends Error {
    constructor(message: string, public status = 400, public code = 'BAD_INPUT') { super(message); }
}

const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
/** The last 10 digits: +91 98450 12345, 09845012345 and 9845012345 are one number. */
const phone10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const validPhone = (p: string) => /^[6-9]\d{9}$/.test(p);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10);
const BOOKABLE = new Set(['field_service', 'consultation']);

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
        return { phone, customer: { id: user.id, name: profile?.fullName || user.username || '', isActive: user.isActive !== false, addresses, recent } };
    }

    /** What the booking costs: the catalogue price for the pincode, nothing now, the rest after the service. */
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
        let snapshot = await BillingEngine.createBookingSnapshot({ bookingFee: 0 });
        let total: number | null = null, commission: number | null = null;
        if (unitPrice > 0) {
            snapshot = await BillingEngine.createCatalogSnapshotForQuantity(unitPrice, quantity, { bookingFee: 0, ...(routing.platformFeePercent != null ? { platformFeePercent: routing.platformFeePercent } : {}) });
            if (routing.dispatchPartnerId) snapshot = { ...snapshot, payeeType: 'partner', payeePartnerId: routing.dispatchPartnerId, servicedBy: routing.partnerName ?? undefined, nationalUnitPrice: svc.basePrice };
            total = snapshot.grossTotal ?? unitPrice * quantity;
            commission = Math.round(snapshot.platformFee ?? 0);
        }
        return {
            service: { id: svc.id, name: svc.name, categoryName: svc.categoryName }, band: band.band, quantity, unitPrice: unitPrice > 0 ? unitPrice : null,
            total, payNow: 0, payAfter: total, partnerName: routing.partnerName ?? null,
            _internal: { snapshot, routing, commission },
        };
    }

    /** Book it. Returns the new booking's id and reference. */
    static async create(adminId: number, input: Record<string, any>) {
        const phone = phone10(input.phone);
        if (!validPhone(phone)) throw new CallBookingError('Enter the customer\'s 10-digit mobile number.');
        const address = text(input.address, 300);
        const pincode = text(input.pincode, 6);
        if (!/^\d{6}$/.test(pincode)) throw new CallBookingError('Enter the 6-digit pincode of the address.');
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

        // The customer: found by phone, or created with the name staff took down.
        let found = await this.lookup(phone);
        let userId: number;
        let createdCustomer = false;
        if (found.customer) {
            if (!found.customer.isActive) throw new CallBookingError('This customer\'s account is blocked. Check with an admin first.', 409, 'BLOCKED');
            userId = found.customer.id;
        } else {
            const name = text(input.name, 60);
            if (name.length < 2) throw new CallBookingError('New customer: enter their name.');
            const created = await storage.createUser({ username: name, phone, role: 'user', isActive: true, homeAddress: consultation ? null : address, pinCode: pincode } as any);
            userId = created.id;
            createdCustomer = true;
            logger.info(`[CALL_BOOKING] Created customer users.id=${created.id} for a call booking`);
        }

        const { snapshot, routing, commission } = q._internal;
        const sr = await storage.createServiceRequest({
            userId,
            serviceType: q.service.name,
            description,
            address: consultation && !address ? 'Phone consultation' : address,
            preferredDate, preferredTimeSlot: slot, urgency,
            catalogServiceId: q.service.id,
            bookingFee: 0,
            // Nothing is due at booking, so it is ready for the queue at once (as a ₹0-fee booking is in the app).
            bookingFeeStatus: 'paid',
        } as any);
        await db.update(serviceRequests).set({
            pricingSnapshot: snapshot as any,
            quantity: q.quantity,
            pincode,
            chosenProviderType: 'unitefix',
            bookingBand: q.band,
            bookedVia: 'call',
            bookedByAdminId: adminId,
            bookingNote: note,
            ...(routing.dispatchPartnerId ? { dispatchPartnerId: routing.dispatchPartnerId, dispatchMode: routing.dispatchMode, slaAssignBy: routing.slaAssignBy } : {}),
            ...(q.total !== null ? { totalAmount: q.total } : {}),
            ...(commission !== null ? { commissionAmount: commission } : {}),
        } as any).where(eq(serviceRequests.id, sr.id));

        await recordAudit({
            entityType: 'service_request', entityId: sr.id, action: 'booked_by_call', toState: 'created', changedBy: adminId,
            metadata: { catalogServiceId: q.service.id, quantity: q.quantity, total: q.total, newCustomer: createdCustomer, note },
        });
        // Same announcements as an app booking: the customer, staff, and the partner when it is theirs.
        void BookingNotifications.bookingCreated(sr.id);
        return { id: sr.id, ref: sr.serviceId, userId, newCustomer: createdCustomer, total: q.total, service: q.service.name };
    }

    /** The latest bookings made by call, with who booked them. */
    static async recent(limit = 30) {
        const rows = await db.select({
            id: serviceRequests.id, ref: serviceRequests.serviceId, serviceType: serviceRequests.serviceType, status: serviceRequests.status,
            totalAmount: serviceRequests.totalAmount, createdAt: serviceRequests.createdAt, note: serviceRequests.bookingNote,
            customerName: users.username, customerPhone: users.phone, bookedBy: adminUsers.username,
        }).from(serviceRequests)
            .leftJoin(users, eq(users.id, serviceRequests.userId))
            .leftJoin(adminUsers, eq(adminUsers.id, serviceRequests.bookedByAdminId))
            .where(and(isNotNull(serviceRequests.bookedVia), eq(serviceRequests.bookedVia, 'call')))
            .orderBy(desc(serviceRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
        return rows;
    }
}

// Kept for callers that want only the public part of a quote.
export const publicQuote = (q: Awaited<ReturnType<typeof CallBookingService.quote>>) => {
    const { _internal, ...rest } = q;
    return rest;
};
