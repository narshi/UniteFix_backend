/**
 * Referral band: free enquiries (travel, hotels, catering, loans, real estate,
 * driving school...). No booking, no payment.
 *
 *  1. The customer sends it. It goes to partner businesses that list the
 *     service and have an active territory for the customer's pincode (no
 *     technicians needed — a travel agent or a loan agent has none).
 *  2. The first partner to take it gets the customer's name and number, and
 *     the customer is told who will call. Others see it as taken.
 *  3. Not taken within BUSINESS_CONFIG.ENQUIRY_PARTNER_HOURS (3), or nobody to
 *     send it to, it shows for UniteFix staff, who call back or forward it.
 *
 * A partner sees a customer's number only once the enquiry is theirs.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { serviceEnquiries, services, users, partnerServices, partnerTerritories, businessPartners } from '@shared/schema';
import { configService } from './config.service';
import { recordAudit } from '../lib/audit';
import { NotificationService } from './notification.service';
import logger from '../lib/logger';

export class EnquiryError extends Error {
    constructor(message: string, public status = 400, public code = 'BAD_REQUEST') { super(message); }
}

type Row = typeof serviceEnquiries.$inferSelect;
const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const pinOf = (...vals: unknown[]) => { for (const v of vals) { const m = String(v ?? '').match(/\b(\d{6})\b/); if (m) return m[1]; } return null; };

export class EnquiryService {
    /** Partners who take this service in this pincode. */
    static async partnersFor(catalogServiceId: number, pincode: string | null): Promise<number[]> {
        if (!pincode) return [];
        const rows = await db.selectDistinct({ id: businessPartners.id }).from(businessPartners)
            .innerJoin(partnerServices, and(eq(partnerServices.businessPartnerId, businessPartners.id), eq(partnerServices.catalogServiceId, catalogServiceId), eq(partnerServices.isActive, true)))
            .innerJoin(partnerTerritories, and(eq(partnerTerritories.businessPartnerId, businessPartners.id), eq(partnerTerritories.pincode, pincode), eq(partnerTerritories.status, 'active')))
            .where(eq(businessPartners.status, 'active'));
        return rows.map(r => r.id);
    }

    static async create(userId: number, input: { catalogServiceId?: unknown; details?: unknown; preferredDate?: unknown; budget?: unknown; address?: unknown; pincode?: unknown }) {
        const catalogServiceId = Number(input.catalogServiceId);
        if (!Number.isInteger(catalogServiceId) || catalogServiceId <= 0) throw new EnquiryError('Choose a service.', 400, 'NO_SERVICE');
        const { BookingBandService } = await import('./booking-band.service');
        const band = await BookingBandService.forCatalogService(catalogServiceId);
        if (band.band !== 'referral') throw new EnquiryError('This service is booked, not enquired about. Book it from the service page.', 409, 'NOT_REFERRAL');
        const [svc] = await db.select({ name: services.name, categoryId: services.categoryId }).from(services).where(eq(services.id, catalogServiceId)).limit(1);
        const details = clean(input.details, 1000);
        if (details.length < 10) throw new EnquiryError('Tell us a little more about what you need (at least a sentence).', 400, 'NO_DETAILS');
        const date = clean(input.preferredDate, 10);
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new EnquiryError('Choose a valid date, or leave it empty.', 400, 'BAD_DATE');
        const address = clean(input.address, 300) || null;
        const pincode = pinOf(input.pincode, address);
        // Not more than five open enquiries at once from one customer.
        const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceEnquiries)
            .where(and(eq(serviceEnquiries.userId, userId), inArray(serviceEnquiries.status, ['new', 'taken', 'forwarded'])));
        if ((open?.n ?? 0) >= 5) throw new EnquiryError('You have five enquiries open. Close one, or wait for a reply.', 429, 'TOO_MANY');

        const partners = await this.partnersFor(catalogServiceId, pincode);
        const hours = Number(await configService.get<number>('BUSINESS_CONFIG.ENQUIRY_PARTNER_HOURS', 3)) || 3;
        const staffDueAt = partners.length ? new Date(Date.now() + hours * 3_600_000) : new Date();
        const [next] = await db.select({ n: sql<number>`coalesce(max(id), 0) + 1` }).from(serviceEnquiries);
        let row: Row | undefined;
        for (let i = 0; i < 5 && !row; i++) {
            try {
                [row] = await db.insert(serviceEnquiries).values({
                    ref: `EQ${String(Number(next?.n ?? 1) + i).padStart(6, '0')}`, userId, catalogServiceId, categoryId: svc?.categoryId ?? null,
                    serviceName: svc?.name ?? 'Service', pincode, address, details, preferredDate: date || null, budget: clean(input.budget, 60) || null,
                    notifiedPartnerIds: partners as any, staffDueAt,
                } as any).returning();
            } catch (e: any) { if (e?.code !== '23505') throw e; }
        }
        if (!row) throw new EnquiryError('Could not save the enquiry. Try again.', 500, 'SAVE_FAILED');

        const { HubAlerts } = await import('./hub-alerts.service');
        for (const bp of partners) {
            await HubAlerts.send(bp, 'job_new', { title: `New enquiry ${row.ref}: ${row.serviceName}`, body: `A customer${pincode ? ` in ${pincode}` : ''} is asking: "${details.slice(0, 140)}". Take it to get their number.`, link: '/partner/field/enquiries', refType: 'service_enquiry', refId: row.id }).catch(() => {});
        }
        if (!partners.length) {
            void NotificationService.sendToAdmins(`New enquiry ${row.ref}: ${row.serviceName}`, `No partner takes it${pincode ? ` in ${pincode}` : ''}; call the customer back.`, { enquiryId: row.id });
        }
        logger.info(`[ENQUIRY] ${row.ref} from user ${userId} for ${row.serviceName}: sent to ${partners.length} partner(s)`);
        return { enquiry: this.forCustomer(row, null), partners: partners.length };
    }

    private static forCustomer(r: Row, partnerName: string | null) {
        return { id: r.id, ref: r.ref, serviceName: r.serviceName, details: r.details, preferredDate: r.preferredDate, budget: r.budget, status: r.status, partnerName, createdAt: r.createdAt, closedReason: r.closedReason };
    }

    static async mine(userId: number) {
        const rows = await db.select({ e: serviceEnquiries, partnerName: businessPartners.displayName }).from(serviceEnquiries)
            .leftJoin(businessPartners, eq(businessPartners.id, serviceEnquiries.partnerId))
            .where(eq(serviceEnquiries.userId, userId)).orderBy(desc(serviceEnquiries.createdAt)).limit(50);
        return rows.map(r => this.forCustomer(r.e, r.partnerName));
    }

    /** A partner's inbox: what was sent to them, and what is theirs. The customer's number only on their own. */
    static async forPartner(bpId: number) {
        const rows = await db.select({ e: serviceEnquiries, name: users.username, phone: users.phone }).from(serviceEnquiries)
            .leftJoin(users, eq(users.id, serviceEnquiries.userId))
            .where(sql`(${serviceEnquiries.partnerId} = ${bpId} OR ${serviceEnquiries.notifiedPartnerIds} @> ${JSON.stringify([bpId])}::jsonb)`)
            .orderBy(desc(serviceEnquiries.createdAt)).limit(200);
        return rows.map(({ e, name, phone }) => {
            const mineNow = e.partnerId === bpId;
            return {
                id: e.id, ref: e.ref, serviceName: e.serviceName, details: e.details, preferredDate: e.preferredDate, budget: e.budget, pincode: e.pincode,
                status: mineNow ? e.status : e.partnerId ? 'taken_by_other' : e.status === 'closed' ? 'closed' : 'open',
                createdAt: e.createdAt,
                customer: mineNow ? { name, phone, address: e.address } : null,
            };
        });
    }

    /** First partner to take it gets it. */
    static async take(bpId: number, id: number) {
        const [row] = await db.update(serviceEnquiries).set({ status: 'taken', partnerId: bpId, takenAt: new Date(), updatedAt: new Date() }).where(and(
            eq(serviceEnquiries.id, id), eq(serviceEnquiries.status, 'new'), sql`${serviceEnquiries.partnerId} IS NULL`,
            sql`${serviceEnquiries.notifiedPartnerIds} @> ${JSON.stringify([bpId])}::jsonb`,
        )).returning();
        if (!row) throw new EnquiryError('Another partner has taken it, or it was closed.', 409, 'GONE');
        await this.tellCustomer(row, bpId);
        await recordAudit({ entityType: 'service_enquiry', entityId: id, action: 'enquiry_taken', metadata: { businessPartnerId: bpId } });
        return this.forPartner(bpId).then(list => list.find(e => e.id === id));
    }

    /** The partner who has it marks it contacted or closed. */
    static async partnerUpdate(bpId: number, id: number, input: { status?: unknown; note?: unknown }) {
        const status = input.status === 'contacted' || input.status === 'closed' ? input.status : null;
        if (!status) throw new EnquiryError('Mark it contacted or closed.', 400, 'BAD_STATUS');
        const [row] = await db.update(serviceEnquiries).set({
            status, updatedAt: new Date(), ...(status === 'closed' ? { closedAt: new Date(), closedReason: clean(input.note, 300) || 'Closed by the partner' } : {}),
        }).where(and(eq(serviceEnquiries.id, id), eq(serviceEnquiries.partnerId, bpId), inArray(serviceEnquiries.status, ['taken', 'forwarded', 'contacted']))).returning();
        if (!row) throw new EnquiryError('This enquiry is not yours, or it is already closed.', 409, 'NOT_YOURS');
        return row;
    }

    /** Staff: everything, newest first; "needs staff" = nobody took it in time, or nobody to send it to. */
    static async forStaff(filter: 'needs_staff' | 'open' | 'all' = 'open') {
        const now = new Date();
        const cond = filter === 'all' ? undefined
            : filter === 'needs_staff' ? and(eq(serviceEnquiries.status, 'new'), sql`${serviceEnquiries.staffDueAt} <= ${now}`)
                : inArray(serviceEnquiries.status, ['new', 'taken', 'forwarded', 'contacted']);
        const rows = await db.select({ e: serviceEnquiries, name: users.username, phone: users.phone, partnerName: businessPartners.displayName }).from(serviceEnquiries)
            .leftJoin(users, eq(users.id, serviceEnquiries.userId))
            .leftJoin(businessPartners, eq(businessPartners.id, serviceEnquiries.partnerId))
            .where(cond).orderBy(desc(serviceEnquiries.createdAt)).limit(300);
        return rows.map(({ e, name, phone, partnerName }) => ({
            ...e, customerName: name, customerPhone: phone, partnerName,
            needsStaff: e.status === 'new' && !!e.staffDueAt && e.staffDueAt <= now,
            notifiedCount: Array.isArray(e.notifiedPartnerIds) ? (e.notifiedPartnerIds as unknown[]).length : 0,
        }));
    }

    /** Staff hand it to a partner (any active one). */
    static async forward(adminId: number, id: number, bpId: number) {
        const [bp] = await db.select({ id: businessPartners.id, status: businessPartners.status }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        if (!bp || bp.status !== 'active') throw new EnquiryError('Choose an active partner.', 400, 'BAD_PARTNER');
        const [row] = await db.update(serviceEnquiries).set({ status: 'forwarded', partnerId: bpId, takenAt: new Date(), updatedAt: new Date() })
            .where(and(eq(serviceEnquiries.id, id), inArray(serviceEnquiries.status, ['new', 'taken', 'forwarded', 'contacted']))).returning();
        if (!row) throw new EnquiryError('Enquiry not found, or already closed.', 404, 'NOT_FOUND');
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(bpId, 'job_new', { title: `Enquiry ${row.ref} for you: ${row.serviceName}`, body: `UniteFix sent you a customer's enquiry: "${row.details.slice(0, 140)}". Call them.`, link: '/partner/field/enquiries', refType: 'service_enquiry', refId: row.id }).catch(() => {});
        await this.tellCustomer(row, bpId);
        await recordAudit({ entityType: 'service_enquiry', entityId: id, action: 'enquiry_forwarded', changedBy: adminId, metadata: { businessPartnerId: bpId } });
        return row;
    }

    /** Staff called the customer, or closed it. */
    static async staffUpdate(adminId: number, id: number, input: { status?: unknown; note?: unknown }) {
        const status = input.status === 'contacted' || input.status === 'closed' ? input.status : null;
        if (!status) throw new EnquiryError('Mark it contacted or closed.', 400, 'BAD_STATUS');
        const note = clean(input.note, 300) || null;
        const [row] = await db.update(serviceEnquiries).set({
            status, staffNote: note, updatedAt: new Date(), ...(status === 'closed' ? { closedAt: new Date(), closedReason: note ?? 'Closed by UniteFix' } : {}),
        }).where(and(eq(serviceEnquiries.id, id), inArray(serviceEnquiries.status, ['new', 'taken', 'forwarded', 'contacted']))).returning();
        if (!row) throw new EnquiryError('Enquiry not found, or already closed.', 404, 'NOT_FOUND');
        await recordAudit({ entityType: 'service_enquiry', entityId: id, action: `enquiry_${status}`, changedBy: adminId, metadata: { note } });
        return row;
    }

    private static async tellCustomer(row: Row, bpId: number) {
        const [bp] = await db.select({ name: businessPartners.displayName }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        NotificationService.notify(row.userId, 'Your enquiry was picked up',
            `${bp?.name ?? 'A UniteFix partner'} will call you about ${row.serviceName} (${row.ref}).`, 'system', { enquiryId: row.id });
    }
}
