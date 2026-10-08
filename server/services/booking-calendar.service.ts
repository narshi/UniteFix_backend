/**
 * Who has which date — halls' spaces and photographers' crews.
 *
 * One row per resource, day and half-day. A full day is two rows (am + pm),
 * so a morning booking and a full-day booking of the same space collide the
 * way they do in real life. A partial unique index over the live rows
 * (hold, booked, blocked) makes a double booking impossible: two clients
 * racing for the same evening both reach the INSERT, and one gets TAKEN.
 *
 *   hold      a client asked; theirs until hold_expires_at (advance or the
 *             partner's answer). Expired holds are released before anyone
 *             else takes the slot, so a lapsed hold never blocks a date.
 *   booked    confirmed
 *   blocked   the partner's own (an offline booking, maintenance)
 *   released  history; no longer holds the date
 *
 * hold_expires_at is written from JS and compared with JS Dates.
 */

import { db } from '../db';
import { and, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { bookingCalendar, type BookingCalendarRow } from '@shared/schema';
import { HubError } from './partner-hub.service';

export type Part = 'am' | 'pm';
export type Slot = 'am' | 'pm' | 'full';
export type ResourceKind = 'space' | 'crew';
const LIVE = ['hold', 'booked', 'blocked'];

export const partsOf = (slot: Slot): Part[] => (slot === 'full' ? ['am', 'pm'] : [slot]);
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
/** 0 = Sunday. */
export const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

type Tx = typeof db | any;

export class BookingCalendar {

    /** Free every hold whose time is up (optionally only these slots). Returns what was released. */
    static async releaseExpired(tx: Tx = db, only?: { bpId: number; resourceKind: ResourceKind; resourceIds: number[]; days: string[] }) {
        const conds: any[] = [eq(bookingCalendar.status, 'hold'), isNotNull(bookingCalendar.holdExpiresAt), lt(bookingCalendar.holdExpiresAt, new Date())];
        if (only) conds.push(eq(bookingCalendar.businessPartnerId, only.bpId), eq(bookingCalendar.resourceKind, only.resourceKind), inArray(bookingCalendar.resourceId, only.resourceIds), inArray(bookingCalendar.day, only.days));
        return tx.update(bookingCalendar).set({ status: 'released', releasedAt: new Date() }).where(and(...conds)).returning() as Promise<BookingCalendarRow[]>;
    }

    /**
     * Take these days and parts of one resource. Throws TAKEN (409) if any of
     * them is held, booked or blocked. Run inside the caller's transaction so
     * the rest of the booking rolls back with it.
     */
    static async take(tx: Tx, input: {
        bpId: number; resourceKind: ResourceKind; resourceId: number; days: string[]; parts: Part[];
        status: 'hold' | 'booked' | 'blocked'; holdExpiresAt?: Date | null; enquiryId?: number | null; bookingId?: number | null; note?: string | null; adminUserId?: number | null;
    }) {
        await this.releaseExpired(tx, { bpId: input.bpId, resourceKind: input.resourceKind, resourceIds: [input.resourceId], days: input.days });
        const rows = input.days.flatMap(day => input.parts.map(part => ({
            businessPartnerId: input.bpId, resourceKind: input.resourceKind, resourceId: input.resourceId, day, part, status: input.status,
            holdExpiresAt: input.status === 'hold' ? input.holdExpiresAt ?? null : null, enquiryId: input.enquiryId ?? null, bookingId: input.bookingId ?? null,
            note: input.note?.trim().slice(0, 200) || null, createdByAdminUserId: input.adminUserId ?? null,
        })));
        try {
            // A clash aborts the caller's transaction too — which is what we want: the whole booking fails.
            return await tx.insert(bookingCalendar).values(rows).returning() as BookingCalendarRow[];
        } catch (e: any) {
            if (e?.code === '23505' || e?.cause?.code === '23505') throw new HubError('That date was just taken. Please pick another date or time.', 'TAKEN', 409);
            throw e;
        }
    }

    /** The live rows of these resources between two days (inclusive). */
    static async occupancy(bpId: number, resourceKind: ResourceKind, from: string, to: string, resourceIds?: number[]) {
        await this.releaseExpired(db);
        const conds: any[] = [eq(bookingCalendar.businessPartnerId, bpId), eq(bookingCalendar.resourceKind, resourceKind), inArray(bookingCalendar.status, LIVE), gte(bookingCalendar.day, from), lte(bookingCalendar.day, to)];
        if (resourceIds?.length) conds.push(inArray(bookingCalendar.resourceId, resourceIds));
        return db.select().from(bookingCalendar).where(and(...conds));
    }

    /** Is every one of these slots free? (Expired holds count as free.) */
    static async isFree(bpId: number, resourceKind: ResourceKind, resourceId: number, days: string[], parts: Part[]) {
        const now = new Date();
        const rows = await db.select({ status: bookingCalendar.status, exp: bookingCalendar.holdExpiresAt }).from(bookingCalendar).where(and(
            eq(bookingCalendar.businessPartnerId, bpId), eq(bookingCalendar.resourceKind, resourceKind), eq(bookingCalendar.resourceId, resourceId),
            inArray(bookingCalendar.day, days), inArray(bookingCalendar.part, parts), inArray(bookingCalendar.status, LIVE)));
        return rows.every(r => r.status === 'hold' && r.exp != null && r.exp < now);
    }

    static async forEnquiry(enquiryId: number) {
        return db.select().from(bookingCalendar).where(and(eq(bookingCalendar.enquiryId, enquiryId), inArray(bookingCalendar.status, LIVE)));
    }

    static async forBooking(bookingId: number) {
        return db.select().from(bookingCalendar).where(and(eq(bookingCalendar.bookingId, bookingId), inArray(bookingCalendar.status, LIVE)));
    }

    /** Link an enquiry's held slots to the booking it became; optionally move the hold's end. */
    static async attach(tx: Tx, enquiryId: number, bookingId: number, holdExpiresAt?: Date | null) {
        return tx.update(bookingCalendar).set({ bookingId, ...(holdExpiresAt !== undefined ? { holdExpiresAt } : {}) })
            .where(and(eq(bookingCalendar.enquiryId, enquiryId), eq(bookingCalendar.status, 'hold'))).returning();
    }

    /** Held → booked (the advance arrived, or the partner confirmed). */
    static async confirm(tx: Tx, where: { bookingId?: number; enquiryId?: number }) {
        const cond = where.bookingId ? eq(bookingCalendar.bookingId, where.bookingId) : eq(bookingCalendar.enquiryId, where.enquiryId!);
        return tx.update(bookingCalendar).set({ status: 'booked', holdExpiresAt: null }).where(and(cond, eq(bookingCalendar.status, 'hold'))).returning();
    }

    /** Move a hold's end (a client is paying right now; a quotation was accepted). Never shortens. */
    static async extendHold(where: { bookingId?: number; enquiryId?: number }, until: Date) {
        const cond = where.bookingId ? eq(bookingCalendar.bookingId, where.bookingId) : eq(bookingCalendar.enquiryId, where.enquiryId!);
        return db.update(bookingCalendar).set({ holdExpiresAt: until })
            .where(and(cond, eq(bookingCalendar.status, 'hold'), lt(bookingCalendar.holdExpiresAt, until))).returning();
    }

    /** Give the dates back (cancelled, declined, lapsed). */
    static async release(tx: Tx, where: { bookingId?: number; enquiryId?: number }) {
        const cond = where.bookingId ? eq(bookingCalendar.bookingId, where.bookingId) : eq(bookingCalendar.enquiryId, where.enquiryId!);
        return tx.update(bookingCalendar).set({ status: 'released', releasedAt: new Date() }).where(and(cond, inArray(bookingCalendar.status, LIVE))).returning();
    }

    /** The partner blocks dates themselves. */
    static async block(input: { bpId: number; resourceKind: ResourceKind; resourceId: number; days: string[]; parts: Part[]; note?: string | null; adminUserId?: number | null }) {
        if (!input.days.length || input.days.length > 62) throw new HubError('Block 1 to 62 days at a time.', 'BAD_RANGE');
        if (input.days.some(d => !isDay(d))) throw new HubError('Dates are YYYY-MM-DD.', 'BAD_DATE');
        return this.take(db, { ...input, status: 'blocked' });
    }

    /** Remove the partner's own blocks (never a client's hold or booking). */
    static async unblock(bpId: number, ids: number[]) {
        if (!ids.length) return [];
        return db.update(bookingCalendar).set({ status: 'released', releasedAt: new Date() })
            .where(and(eq(bookingCalendar.businessPartnerId, bpId), inArray(bookingCalendar.id, ids), eq(bookingCalendar.status, 'blocked'))).returning();
    }

    /** Live rows count per day in a month — for the public availability grid. */
    static async monthMap(bpId: number, resourceKind: ResourceKind, month: string, resourceIds?: number[]) {
        const from = `${month}-01`;
        const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
        const rows = await this.occupancy(bpId, resourceKind, from, addDays(next, -1), resourceIds);
        return { from, to: addDays(next, -1), rows };
    }

    /** For the admin: how many live holds there are right now (sanity). */
    static async liveHolds() {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(bookingCalendar).where(eq(bookingCalendar.status, 'hold'));
        return r?.n ?? 0;
    }
}
