/**
 * The app's Home showcase: categories, in the admin's sort order, with a
 * yearly highlight a category can carry — Tax, ITR & Legal every March,
 * Travel & Tourism every December. Set once (from/to as month-day); it comes
 * back on its own each year. A window may run across the new year (15 Dec →
 * 10 Jan). Dates are India time.
 *
 * Also: moving many services into another category at once, for staff
 * reorganising the catalogue (no script touches live rows; staff do it here).
 */

import { inArray, eq } from 'drizzle-orm';
import { db } from '../db';
import { services, serviceCategories } from '@shared/schema';
import { recordAudit } from '../lib/audit';

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validMmdd = (v: string) => MMDD.test(v) && Number(v.slice(3)) <= DAYS_IN[Number(v.slice(0, 2)) - 1];
const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Today's month-day in India. */
export const todayMmdd = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(5, 10);

/** Whether a category's yearly window includes this day (MM-DD). */
export function inWindow(from: string | null | undefined, to: string | null | undefined, day: string): boolean {
    if (!from || !to) return false;
    return from <= to ? day >= from && day <= to : day >= from || day <= to;   // a window across the new year
}

export class ShowcaseError extends Error {}

export class CategoryShowcaseService {
    static isFeaturedNow(c: { featureOn?: boolean | null; featureFrom?: string | null; featureTo?: string | null }, now = new Date()) {
        return !!c.featureOn && inWindow(c.featureFrom, c.featureTo, todayMmdd(now));
    }

    /** Check admin input for the showcase fields. Throws a plain message. */
    static clean(input: Record<string, unknown>) {
        const out: Record<string, unknown> = {};
        if (input.tagline !== undefined) out.tagline = clean(input.tagline, 80) || null;
        if (input.featureTitle !== undefined) out.featureTitle = clean(input.featureTitle, 60) || null;
        if (input.featureSubtitle !== undefined) out.featureSubtitle = clean(input.featureSubtitle, 120) || null;
        for (const k of ['featureFrom', 'featureTo'] as const) {
            if (input[k] === undefined) continue;
            const v = clean(input[k], 5);
            if (v && !validMmdd(v)) throw new ShowcaseError('Highlight dates: choose a month and a day.');
            out[k] = v || null;
        }
        if (input.featureOn !== undefined) out.featureOn = input.featureOn === true || input.featureOn === 'true';
        if (out.featureOn === true) {
            const from = (out.featureFrom ?? input.featureFrom) as string | null, to = (out.featureTo ?? input.featureTo) as string | null;
            const title = (out.featureTitle ?? input.featureTitle) as string | null;
            if (!from || !to) throw new ShowcaseError('To highlight this category on Home, choose when: from and to.');
            if (!title) throw new ShowcaseError('Give the highlight a title, e.g. "ITR season is here".');
        }
        return out;
    }

    /** Move services into another category (staff reorganising). */
    static async moveServices(adminId: number, serviceIds: unknown, categoryId: unknown) {
        const ids = Array.isArray(serviceIds) ? Array.from(new Set(serviceIds.map(Number).filter(n => Number.isInteger(n) && n > 0))).slice(0, 500) : [];
        const to = Number(categoryId);
        if (!ids.length) throw new ShowcaseError('Choose the services to move.');
        if (!Number.isInteger(to) || to <= 0) throw new ShowcaseError('Choose the category to move them to.');
        const [cat] = await db.select({ id: serviceCategories.id, name: serviceCategories.name }).from(serviceCategories).where(eq(serviceCategories.id, to)).limit(1);
        if (!cat) throw new ShowcaseError('That category does not exist.');
        const before = await db.select({ id: services.id, from: services.categoryId }).from(services).where(inArray(services.id, ids));
        if (!before.length) throw new ShowcaseError('None of those services exist.');
        const moved = await db.update(services).set({ categoryId: to, updatedAt: new Date() }).where(inArray(services.id, before.map(b => b.id))).returning({ id: services.id });
        await recordAudit({ entityType: 'service_category', entityId: to, action: 'services_moved', changedBy: adminId, metadata: { moved: before.map(b => ({ serviceId: b.id, fromCategoryId: b.from })) } });
        return { moved: moved.length, categoryName: cat.name };
    }
}
