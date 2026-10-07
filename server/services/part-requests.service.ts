/**
 * Spare parts the customer approves before they are fitted and billed.
 *
 * THE RULE: the technician REQUESTS, the CUSTOMER approves. A request is decided
 * only by the booking's owner, signed in as themselves — never by the
 * technician's login, even if a technician booked their own service.
 *
 *   pending ──customer──▶ approved ──request-payment──▶ billed (as part lines)
 *      │                     └─technician cancels─▶ cancelled
 *      ├──customer──▶ rejected (with their reason or question)
 *      ├──technician──▶ cancelled
 *      └──time──▶ expired (the technician can send it again)
 *
 * Prices are the server's: a UniteFix-stock part is priced from the catalogue,
 * a local purchase at what the technician paid. GST is added the same way the
 * bill adds it, so the amount the customer approves is the amount they pay.
 */

import { db } from '../db';
import { and, desc, eq, gt, inArray, lt, ne, or } from 'drizzle-orm';
import { partRequests, serviceRequests, servicePartItems, employees, type PartRequest } from '@shared/schema';
import { SparePartsService, SparePartsError } from './spare-parts.service';
import { resolvePartItem, WORKMANSHIP_WARRANTY_DAYS, type PartItemInput } from './warranty.service';
import { BillingEngine } from './billing-engine';
import { configService } from './config.service';
import { NotificationService } from './notification.service';
import logger from '../lib/logger';

export class PartRequestError extends Error {
    constructor(message: string, public code: string, public status = 400) { super(message); }
}

export interface PartRequestItemInput {
    sparePartId?: number | null;
    partName?: string;
    sourceType?: 'platform' | 'technician_local' | 'customer_supplied';
    quantity?: number;
    unitPriceRupees?: number;
    vendorName?: string | null;
    warrantyDays?: number;
    billPhotoUrl?: string | null;
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "6-month", "90-day", "1-year" — how people say warranty periods. */
export function periodLabel(days: number) {
    if (days >= 365 && days % 365 === 0) return `${days / 365}-year`;
    if (days >= 180 && days % 30 === 0) return `${days / 30}-month`;
    return `${days}-day`;
}

/** What the customer gets on this part, in one short line, and whether a part warranty exists. */
function warrantyOf(item: { sourceType: string; warrantyDays: number; warrantyBacker: string; vendorName: string | null }, audience: 'technician' | 'customer') {
    if (item.sourceType === 'customer_supplied') {
        return { covered: false, label: `Your own part · fitting guaranteed ${WORKMANSHIP_WARRANTY_DAYS} days` };
    }
    if (item.warrantyDays > 0 && item.warrantyBacker !== 'none') {
        const who = item.warrantyBacker === 'unitefix' ? 'UniteFix'
            : audience === 'technician' ? (item.vendorName ?? 'the shop') : null;
        return { covered: true, label: `${periodLabel(item.warrantyDays)} part warranty${who ? ` from ${who}` : ''}` };
    }
    return { covered: false, label: `No part warranty · fitting guaranteed ${WORKMANSHIP_WARRANTY_DAYS} days` };
}

const sourceText = (sourceType: string, audience: 'technician' | 'customer', vendorName?: string | null) =>
    sourceType === 'platform' ? 'UniteFix stock'
        : sourceType === 'customer_supplied' ? (audience === 'customer' ? 'Your own part' : "Customer's own part")
            : audience === 'customer' ? 'Bought locally by your technician' : (vendorName ? `Bought locally · ${vendorName}` : 'Bought locally');

export class PartRequestService {

    static async expiryMinutes() {
        return Math.max(5, Number(await configService.get<number>('BUSINESS_CONFIG.PART_APPROVAL_EXPIRY_MINUTES', 60)) || 60);
    }

    /** The booking, if this technician is working on it now. */
    private static async workingBooking(employeeId: number, bookingId: number) {
        const [b] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, bookingId)).limit(1);
        if (!b) throw new PartRequestError('Job not found.', 'NOT_FOUND', 404);
        if (b.providerId !== employeeId) throw new PartRequestError('This job is not assigned to you.', 'FORBIDDEN', 403);
        if (b.status !== 'in_progress') throw new PartRequestError('Spare parts can be requested while the job is in progress.', 'BAD_STATE', 409);
        const snap = b.pricingSnapshot as any;
        if (snap?.snapshotVersion !== 2) throw new PartRequestError('Spare parts on this job are entered with the bill.', 'NOT_FIXED_PRICE', 409);
        return b;
    }

    /**
     * Price the items, work out their warranty, and look for the same part
     * still under warranty from an earlier job. No writes.
     */
    static async price(employeeId: number, booking: typeof serviceRequests.$inferSelect, input: PartRequestItemInput[]) {
        if (!Array.isArray(input) || !input.length) throw new PartRequestError('Add the part first.', 'NO_ITEMS');
        if (input.length > 10) throw new PartRequestError('Up to 10 parts in one request.', 'TOO_MANY');
        const raw: PartItemInput[] = input.map((i, n) => {
            const sourceType = i.sourceType === 'platform' || i.sparePartId ? 'platform' : i.sourceType === 'customer_supplied' ? 'customer_supplied' : 'technician_local';
            const name = String(i.partName ?? '').trim();
            const qty = Math.floor(Number(i.quantity ?? 1));
            if (!(qty >= 1 && qty <= 50)) throw new PartRequestError('Quantity is 1 to 50.', 'BAD_QTY');
            if (sourceType !== 'platform' && name.length < 2) throw new PartRequestError(`Name part ${n + 1}.`, 'NO_NAME');
            const price = Number(i.unitPriceRupees ?? 0);
            if (sourceType === 'technician_local' && !(price > 0)) throw new PartRequestError(`Enter what ${name || 'the part'} cost.`, 'NO_PRICE');
            return {
                sparePartId: sourceType === 'platform' ? Number(i.sparePartId) : null,
                partName: name, sourceType, quantity: qty,
                unitPriceRupees: sourceType === 'customer_supplied' ? 0 : Math.max(0, price),
                vendorName: sourceType === 'technician_local' ? (String(i.vendorName ?? '').trim() || null) : null,
                warrantyDays: sourceType === 'technician_local' ? Math.max(0, Math.floor(Number(i.warrantyDays ?? 0))) : 0,
                billPhotoUrl: sourceType === 'technician_local' ? (i.billPhotoUrl || null) : null,
                vendorBillDate: sourceType === 'technician_local' && i.billPhotoUrl ? new Date().toISOString() : null,
            };
        });
        // Catalogue pricing and the parts-access check, exactly as the bill does it.
        let enriched: { items: PartItemInput[]; warnings: string[] };
        try { enriched = await SparePartsService.enrichPlatformItems(raw, employeeId); }
        catch (e) { if (e instanceof SparePartsError) throw new PartRequestError(e.message, e.code); throw e; }
        // A stock part that could not stay stock (no parts access, or it left the
        // catalogue) has no price of its own. Say so instead of billing ₹0.
        const lost = raw.findIndex((r, n) => r.sourceType === 'platform' && enriched.items[n].sourceType !== 'platform');
        if (lost >= 0) {
            throw new PartRequestError(enriched.warnings[0]?.includes('access')
                ? 'UniteFix stock needs spare-parts access. Choose "Buy locally" and enter what you paid.'
                : 'That part is no longer in UniteFix stock. Choose "Buy locally" and enter what you paid.', 'STOCK_UNAVAILABLE', 409);
        }
        const gstPercent = Number((booking.pricingSnapshot as any)?.gstPercent) || 18;
        const resolved = enriched.items.map(r => resolvePartItem(r));
        // Store what the bill needs, already priced: the approved amount is the billed amount.
        const items: PartItemInput[] = resolved.map(r => ({
            sparePartId: r.sparePartId, partName: r.partName, brand: r.brand, sourceType: r.sourceType, vendorName: r.vendorName,
            unitPricePaise: r.unitPricePaise, quantity: r.quantity, gstPercent: r.gstPercent, warrantyDays: r.warrantyDays,
            billPhotoUrl: r.billPhotoUrl, vendorBillDate: r.vendorBillDate ? r.vendorBillDate.toISOString() : null,
        }));
        const tax = BillingEngine.partsTax(resolved, gstPercent);
        const partsPaise = Math.round(tax.partsTaxable * 100), gstPaise = Math.round(tax.partsGst * 100);
        const earlier = await this.earlierWarranty(booking, resolved);
        return { items, resolved, partsPaise, gstPaise, totalPaise: partsPaise + gstPaise, earlier, warnings: enriched.warnings, gstPercent };
    }

    /** The same part fitted for this customer on an earlier job and still under warranty. */
    private static async earlierWarranty(booking: typeof serviceRequests.$inferSelect, items: Array<{ sparePartId: number | null; partName: string }>) {
        const ids = items.map(i => i.sparePartId).filter((x): x is number => !!x);
        const names = items.map(i => norm(i.partName)).filter(Boolean);
        if (!ids.length && !names.length) return null;
        const rows = await db.select({ p: servicePartItems, ref: serviceRequests.serviceId }).from(servicePartItems)
            .innerJoin(serviceRequests, eq(serviceRequests.id, servicePartItems.serviceRequestId))
            .where(and(eq(serviceRequests.userId, booking.userId), ne(serviceRequests.id, booking.id), gt(servicePartItems.warrantyExpiresAt, new Date())))
            .orderBy(desc(servicePartItems.warrantyExpiresAt)).limit(50);
        const hit = rows.find(r => (r.p.sparePartId && ids.includes(r.p.sparePartId)) || names.includes(norm(r.p.partName)));
        if (!hit) return null;
        return { partName: hit.p.partName, jobRef: hit.ref, fittedAt: hit.p.installedAt, warrantyUntil: hit.p.warrantyExpiresAt };
    }

    static async preview(employeeId: number, bookingId: number, items: PartRequestItemInput[]) {
        const b = await this.workingBooking(employeeId, bookingId);
        const p = await this.price(employeeId, b, items);
        const dup = await this.duplicates(bookingId, p.resolved);
        return { ...this.pricedView(p, 'technician'), duplicates: dup };
    }

    private static pricedView(p: Awaited<ReturnType<typeof PartRequestService.price>>, audience: 'technician' | 'customer') {
        return {
            items: p.resolved.map(r => ({
                sparePartId: r.sparePartId, partName: r.partName, quantity: r.quantity, unitPrice: r.unitPricePaise / 100,
                lineTotal: (r.unitPricePaise * r.quantity) / 100, source: sourceText(r.sourceType, audience, r.vendorName),
                sourceType: r.sourceType, warranty: warrantyOf(r, audience), billAttached: !!r.billPhotoUrl,
            })),
            parts: p.partsPaise / 100, gst: p.gstPaise / 100, total: p.totalPaise / 100, gstPercent: p.gstPercent,
            earlierWarranty: p.earlier, warnings: p.warnings,
        };
    }

    /** Parts on this job already approved or waiting, with the same catalogue id or name. */
    private static async duplicates(bookingId: number, items: Array<{ sparePartId: number | null; partName: string }>) {
        const live = await db.select().from(partRequests).where(and(eq(partRequests.serviceRequestId, bookingId), inArray(partRequests.status, ['pending', 'approved'])));
        const out: string[] = [];
        for (const it of items) {
            for (const r of live) {
                if ((r.items as PartItemInput[]).some(x => (it.sparePartId && x.sparePartId === it.sparePartId) || norm(String(x.partName ?? '')) === norm(it.partName))) {
                    out.push(`${it.partName} is already ${r.status === 'approved' ? 'approved' : 'waiting for the customer'} on this job.`);
                    break;
                }
            }
        }
        return out;
    }

    static async create(employeeId: number, bookingId: number, input: { items: PartRequestItemInput[]; reason?: string | null; confirmDuplicate?: boolean }) {
        const b = await this.workingBooking(employeeId, bookingId);
        const reason = String(input.reason ?? '').trim().slice(0, 300);
        if (reason.length < 3) throw new PartRequestError('Say why the part is needed — the customer reads this.', 'NO_REASON');
        const p = await this.price(employeeId, b, input.items);
        const dup = await this.duplicates(bookingId, p.resolved);
        if (dup.length && !input.confirmDuplicate) throw new PartRequestError(dup.join(' '), 'DUPLICATE_PART', 409);
        const now = new Date();
        const [row] = await db.insert(partRequests).values({
            serviceRequestId: bookingId, employeeId, customerUserId: b.userId, status: 'pending', items: p.items as any, reason,
            partsPaise: p.partsPaise, gstPaise: p.gstPaise, totalPaise: p.totalPaise, earlierWarranty: p.earlier as any,
            sentAt: now, expiresAt: new Date(now.getTime() + (await this.expiryMinutes()) * 60_000),
        }).returning();
        const names = p.resolved.map(r => `${r.partName}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`).join(', ');
        NotificationService.notify(b.userId, 'Approve a spare part',
            `Your technician needs ${names} (${rs(p.totalPaise)} incl. GST) for ${b.serviceId}. Tap to approve or reject.`,
            'part_approval_requested', { serviceId: bookingId, partRequestId: row.id, serviceRef: b.serviceId });
        logger.info(`[PARTS] Approval requested on SR #${bookingId}: ${names} ${rs(p.totalPaise)} (request #${row.id})`);
        return { request: await this.view(row, 'technician'), warnings: p.warnings };
    }

    /** Pending requests past their time become expired. */
    private static async expireDue(bookingId: number) {
        await db.update(partRequests).set({ status: 'expired' })
            .where(and(eq(partRequests.serviceRequestId, bookingId), eq(partRequests.status, 'pending'), lt(partRequests.expiresAt, new Date())));
    }

    static async view(r: PartRequest, audience: 'technician' | 'customer') {
        const items = (r.items as PartItemInput[]).map(x => {
            // The same resolution the bill applies, so the promise shown is the one recorded.
            const res = resolvePartItem(x);
            const it = { sourceType: res.sourceType as string, warrantyDays: res.warrantyDays, warrantyBacker: res.warrantyBacker as string, vendorName: res.vendorName };
            return {
                sparePartId: x.sparePartId ?? null, partName: String(x.partName), quantity: Number(x.quantity ?? 1),
                unitPrice: Number(x.unitPricePaise ?? 0) / 100, lineTotal: (Number(x.unitPricePaise ?? 0) * Number(x.quantity ?? 1)) / 100,
                source: sourceText(it.sourceType, audience, it.vendorName), sourceType: it.sourceType, warranty: warrantyOf(it, audience),
                ...(audience === 'technician' ? { billAttached: !!x.billPhotoUrl } : {}),
            };
        });
        return {
            id: r.id, status: r.status, reason: r.reason, items,
            parts: r.partsPaise / 100, gst: r.gstPaise / 100, total: r.totalPaise / 100,
            earlierWarranty: r.earlierWarranty, customerNote: r.customerNote,
            sentAt: r.sentAt, expiresAt: r.expiresAt, decidedAt: r.decidedAt,
        };
    }

    static async listForTechnician(employeeId: number, bookingId: number) {
        const [b] = await db.select({ p: serviceRequests.providerId }).from(serviceRequests).where(eq(serviceRequests.id, bookingId)).limit(1);
        if (!b || b.p !== employeeId) throw new PartRequestError('Job not found.', 'NOT_FOUND', 404);
        await this.expireDue(bookingId);
        const rows = await db.select().from(partRequests).where(eq(partRequests.serviceRequestId, bookingId)).orderBy(desc(partRequests.sentAt));
        return Promise.all(rows.map(r => this.view(r, 'technician')));
    }

    static async listForCustomer(userId: number, bookingId: number) {
        const [b] = await db.select({ u: serviceRequests.userId }).from(serviceRequests).where(eq(serviceRequests.id, bookingId)).limit(1);
        if (!b || b.u !== userId) throw new PartRequestError('Booking not found.', 'NOT_FOUND', 404);
        await this.expireDue(bookingId);
        const rows = await db.select().from(partRequests).where(and(eq(partRequests.serviceRequestId, bookingId), ne(partRequests.status, 'cancelled'))).orderBy(desc(partRequests.sentAt));
        return Promise.all(rows.map(r => this.view(r, 'customer')));
    }

    static async cancel(employeeId: number, id: number) {
        const [r] = await db.select().from(partRequests).where(eq(partRequests.id, id)).limit(1);
        if (!r || r.employeeId !== employeeId) throw new PartRequestError('Request not found.', 'NOT_FOUND', 404);
        const [b] = await db.select({ status: serviceRequests.status }).from(serviceRequests).where(eq(serviceRequests.id, r.serviceRequestId)).limit(1);
        if (b?.status !== 'in_progress') throw new PartRequestError('The bill has gone to the customer; this part can no longer be withdrawn.', 'BAD_STATE', 409);
        const [u] = await db.update(partRequests).set({ status: 'cancelled', decidedAt: new Date() })
            .where(and(eq(partRequests.id, id), inArray(partRequests.status, ['pending', 'approved']))).returning();
        if (!u) throw new PartRequestError(`This request is already ${r.status}.`, 'BAD_STATE', 409);
        if (r.status === 'approved') {
            NotificationService.notify(r.customerUserId, 'Spare part withdrawn', 'Your technician no longer needs the part you approved. It will not be on your bill.', 'part_approval_requested', { serviceId: r.serviceRequestId });
        }
        return this.view(u, 'technician');
    }

    /** The customer's decision. Only the booking's owner, and never the technician's own login. */
    static async decide(userId: number, id: number, decision: 'approve' | 'reject', note?: string | null) {
        const [r] = await db.select().from(partRequests).where(eq(partRequests.id, id)).limit(1);
        if (!r) throw new PartRequestError('Request not found.', 'NOT_FOUND', 404);
        const [b] = await db.select({ u: serviceRequests.userId, status: serviceRequests.status, ref: serviceRequests.serviceId }).from(serviceRequests).where(eq(serviceRequests.id, r.serviceRequestId)).limit(1);
        if (!b || b.u !== userId || r.customerUserId !== userId) throw new PartRequestError('Request not found.', 'NOT_FOUND', 404);
        const [tech] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, r.employeeId)).limit(1);
        if (tech?.userId === userId) throw new PartRequestError('The technician cannot approve their own spare-part request.', 'SELF_APPROVAL', 403);
        await this.expireDue(r.serviceRequestId);
        const [fresh] = await db.select().from(partRequests).where(eq(partRequests.id, id)).limit(1);
        if (fresh.status === 'expired') throw new PartRequestError('This request has expired. Ask your technician to send it again.', 'EXPIRED', 409);
        if (fresh.status !== 'pending') throw new PartRequestError(`This request was already ${fresh.status}.`, 'ALREADY_DECIDED', 409);
        if (b.status !== 'in_progress') throw new PartRequestError('This job has moved on; the request can no longer be decided.', 'BAD_STATE', 409);
        const cleanNote = String(note ?? '').trim().slice(0, 300) || null;
        const [u] = await db.update(partRequests).set({
            status: decision === 'approve' ? 'approved' : 'rejected', decidedAt: new Date(), decidedByUserId: userId, customerNote: decision === 'reject' ? cleanNote : null,
        }).where(and(eq(partRequests.id, id), eq(partRequests.status, 'pending'))).returning();
        if (!u) throw new PartRequestError('This request was just decided.', 'ALREADY_DECIDED', 409);
        const names = (r.items as PartItemInput[]).map(x => String(x.partName)).join(', ');
        NotificationService.notify(tech?.userId ?? null,
            decision === 'approve' ? 'Customer approved the part' : 'Customer rejected the part',
            decision === 'approve' ? `${names} approved for ${b.ref}. Fit it and request payment when done.` : `${names} rejected for ${b.ref}${cleanNote ? `: "${cleanNote}"` : '.'}`,
            'part_approval_decided', { serviceId: r.serviceRequestId, partRequestId: id, role: 'expert' });
        return this.view(u, 'customer');
    }

    /** What request-payment bills: every approved request. Pending ones hold the bill back. */
    static async forBilling(bookingId: number) {
        await this.expireDue(bookingId);
        const rows = await db.select().from(partRequests).where(and(eq(partRequests.serviceRequestId, bookingId), or(eq(partRequests.status, 'approved'), eq(partRequests.status, 'pending'))));
        return {
            items: rows.filter(r => r.status === 'approved').flatMap(r => r.items as PartItemInput[]),
            pending: rows.filter(r => r.status === 'pending'),
        };
    }
}
