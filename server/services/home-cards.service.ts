/**
 * Home screen cards — see shared/home-cards.ts for the model.
 *
 * Staff save sets (checked here, never written raw); the app asks which cards
 * are live today. Dates are India time. A card whose category or service is
 * switched off, removed or disabled simply drops out (the next live set, then
 * the app's built-in four, fill the gap), so a stale set never shows a dead card.
 */

import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { homeCardSets, serviceCategories, services, type HomeCardSet } from '@shared/schema';
import {
    MAX_HOME_CARDS, DEFAULT_HEADING, HOME_CARD_SCREENS, isLibraryPhoto, describeSchedule,
    type HomeCard, type HomeCardPhoto, type ResolvedHome, type ResolvedHomeCard,
} from '@shared/home-cards';
import { storage } from '../storage';
import { recordAudit } from '../lib/audit';
import { inWindow } from './category-showcase.service';

export class HomeCardsError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const validMmdd = (v: string) => MMDD.test(v) && Number(v.slice(3)) <= DAYS_IN[Number(v.slice(0, 2)) - 1];
const validIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const SCHEDULE_RANK: Record<string, number> = { dates: 2, yearly: 1, always: 0 };

/** Today in India, YYYY-MM-DD. */
export const todayIso = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Whether a set is live on this day (YYYY-MM-DD). */
export function liveOn(s: Pick<HomeCardSet, 'isActive' | 'schedule' | 'fromMmdd' | 'toMmdd' | 'startsOn' | 'endsOn'>, day: string): boolean {
    if (!s.isActive) return false;
    if (s.schedule === 'always') return true;
    if (s.schedule === 'yearly') return inWindow(s.fromMmdd, s.toMmdd, day.slice(5));
    if (s.schedule === 'dates') return !!s.startsOn && !!s.endsOn && day >= s.startsOn && day <= s.endsOn;
    return false;
}

/** Live sets for a day, the winner first. */
function ranked(sets: HomeCardSet[], day: string) {
    return sets.filter(s => liveOn(s, day)).sort((a, b) =>
        (b.priority - a.priority)
        || ((SCHEDULE_RANK[b.schedule] ?? 0) - (SCHEDULE_RANK[a.schedule] ?? 0))
        || ((b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
        || (b.id - a.id));
}

function cleanPhoto(p: any): HomeCardPhoto {
    if (!p || p.kind === 'auto' || p.kind == null) return { kind: 'auto' };
    if (p.kind === 'library') {
        if (!isLibraryPhoto(p.key)) throw new HomeCardsError('Choose one of the app\'s photos for that card.');
        return { kind: 'library', key: p.key };
    }
    if (p.kind === 'link') {
        const url = text(p.url, 500);
        if (!/^https:\/\/[^\s]+$/i.test(url)) throw new HomeCardsError('An image link must start with https://');
        return { kind: 'link', url };
    }
    throw new HomeCardsError('Choose how the card gets its photo.');
}

export class HomeCardsService {
    /** Check a set from the admin form. Throws a plain message. Cards' targets must exist. */
    static async clean(input: Record<string, any>, existing?: HomeCardSet) {
        const name = text(input.name ?? existing?.name, 60);
        if (!name) throw new HomeCardsError('Give the set a name staff will recognise, e.g. "Monsoon".');
        const heading = text(input.heading !== undefined ? input.heading : existing?.heading, 40) || null;
        const schedule = String(input.schedule ?? existing?.schedule ?? 'yearly');
        if (!['always', 'yearly', 'dates'].includes(schedule)) throw new HomeCardsError('Choose when the set shows: always, every year, or on dates.');
        let fromMmdd: string | null = null, toMmdd: string | null = null, startsOn: string | null = null, endsOn: string | null = null;
        if (schedule === 'yearly') {
            fromMmdd = text(input.fromMmdd ?? existing?.fromMmdd, 5); toMmdd = text(input.toMmdd ?? existing?.toMmdd, 5);
            if (!validMmdd(fromMmdd) || !validMmdd(toMmdd)) throw new HomeCardsError('Every year: choose the month and day it starts and ends.');
        }
        if (schedule === 'dates') {
            startsOn = text(input.startsOn ?? existing?.startsOn, 10); endsOn = text(input.endsOn ?? existing?.endsOn, 10);
            if (!validIso(startsOn) || !validIso(endsOn)) throw new HomeCardsError('On dates: choose the first and last day.');
            if (endsOn < startsOn) throw new HomeCardsError('The last day is before the first day.');
        }
        const pr = Number(input.priority ?? existing?.priority ?? 0);
        if (!Number.isInteger(pr) || pr < -100 || pr > 100) throw new HomeCardsError('Priority is a whole number from -100 to 100.');
        const isActive = input.isActive === undefined ? (existing?.isActive ?? true) : input.isActive === true || input.isActive === 'true';

        const rawCards: any[] = Array.isArray(input.cards) ? input.cards : (existing?.cards as any[]) ?? [];
        if (rawCards.length > MAX_HOME_CARDS) throw new HomeCardsError(`A set has at most ${MAX_HOME_CARDS} cards (the Home row shows four).`);
        const cards: HomeCard[] = rawCards.map((c, i) => {
            const label = text(c?.label, 16) || null;   // four cards across: keep it short
            const photo = cleanPhoto(c?.photo);
            if (c?.target === 'screen') {
                if (!HOME_CARD_SCREENS.some(s => s.key === c.screen)) throw new HomeCardsError(`Card ${i + 1}: choose which screen it opens.`);
                return { target: 'screen', screen: c.screen, label, photo };
            }
            if (c?.target === 'category' || c?.target === 'service') {
                const id = Number(c.id);
                if (!Number.isInteger(id) || id <= 0) throw new HomeCardsError(`Card ${i + 1}: choose the ${c.target}.`);
                return { target: c.target, id, label, photo };
            }
            throw new HomeCardsError(`Card ${i + 1}: choose what it opens (a category, a service or a screen).`);
        });
        const keys = cards.map(c => (c.target === 'screen' ? `screen:${c.screen}` : `${c.target}:${c.id}`));
        if (new Set(keys).size !== keys.length) throw new HomeCardsError('The same thing is on two cards. Each card should open something different.');
        const catIds = cards.filter(c => c.target === 'category').map(c => (c as any).id as number);
        const svcIds = cards.filter(c => c.target === 'service').map(c => (c as any).id as number);
        if (catIds.length) {
            const found = await db.select({ id: serviceCategories.id }).from(serviceCategories).where(inArray(serviceCategories.id, catIds));
            if (found.length !== new Set(catIds).size) throw new HomeCardsError('One of the categories no longer exists.');
        }
        if (svcIds.length) {
            const found = await db.select({ id: services.id }).from(services).where(inArray(services.id, svcIds));
            if (found.length !== new Set(svcIds).size) throw new HomeCardsError('One of the services no longer exists.');
        }
        return { name, heading, schedule, fromMmdd, toMmdd, startsOn, endsOn, priority: pr, isActive, cards };
    }

    static async list(day = todayIso()) {
        const sets = await db.select().from(homeCardSets).orderBy(desc(homeCardSets.priority), desc(homeCardSets.updatedAt));
        const winner = ranked(sets, day)[0]?.id ?? null;
        return sets.map(s => ({ ...s, when: describeSchedule(s), liveToday: liveOn(s, day), showingToday: s.id === winner }));
    }

    static async create(adminId: number, input: Record<string, any>) {
        const v = await this.clean(input);
        const [row] = await db.insert(homeCardSets).values({ ...v, createdBy: adminId, updatedBy: adminId } as any).returning();
        await recordAudit({ entityType: 'home_card_set', entityId: row.id, action: 'created', changedBy: adminId, metadata: { name: row.name, when: describeSchedule(row), cards: v.cards.length } });
        return row;
    }

    static async update(adminId: number, id: number, input: Record<string, any>) {
        const [existing] = await db.select().from(homeCardSets).where(eq(homeCardSets.id, id)).limit(1);
        if (!existing) throw new HomeCardsError('That set no longer exists.', 404);
        const v = await this.clean(input, existing);
        const [row] = await db.update(homeCardSets).set({ ...v, updatedBy: adminId, updatedAt: new Date() } as any).where(eq(homeCardSets.id, id)).returning();
        await recordAudit({ entityType: 'home_card_set', entityId: id, action: 'updated', changedBy: adminId, metadata: { name: row.name, when: describeSchedule(row), isActive: row.isActive, cards: v.cards.length } });
        return row;
    }

    static async remove(adminId: number, id: number) {
        const [row] = await db.delete(homeCardSets).where(eq(homeCardSets.id, id)).returning();
        if (!row) throw new HomeCardsError('That set no longer exists.', 404);
        await recordAudit({ entityType: 'home_card_set', entityId: id, action: 'deleted', changedBy: adminId, metadata: { name: row.name, when: describeSchedule(row) } });
    }

    /** The cards the app shows on a day: the winning set's, then the next live sets' to fill four. */
    static async resolve(day = todayIso()): Promise<ResolvedHome> {
        const sets = ranked(await db.select().from(homeCardSets), day);
        if (!sets.length) return { date: day, heading: DEFAULT_HEADING, setId: null, setName: null, cards: [] };
        // Only what the app's catalogue shows (active categories and their services).
        const catalogue = await storage.getAllServiceCategoriesWithServices();
        const cats = new Map(catalogue.map(c => [c.id, c]));
        const svcs = new Map(catalogue.flatMap(c => (c.items ?? []).filter((s: any) => s.status !== 'DISABLED').map(s => [s.id, s] as const)));
        const out: ResolvedHomeCard[] = [];
        const seen = new Set<string>();
        for (const set of sets) {
            for (const c of (set.cards as HomeCard[]) ?? []) {
                if (out.length >= MAX_HOME_CARDS) break;
                let card: ResolvedHomeCard | null = null;
                if (c.target === 'category') {
                    const cat = cats.get(c.id);
                    if (cat && (cat.items ?? []).some((s: any) => s.status !== 'DISABLED')) card = { key: `category:${cat.id}`, target: 'category', id: cat.id, categoryId: cat.id, screen: null, label: c.label || cat.name, name: cat.name, photo: c.photo ?? { kind: 'auto' }, fromSetId: set.id };
                } else if (c.target === 'service') {
                    const s = svcs.get(c.id);
                    if (s) card = { key: `service:${s.id}`, target: 'service', id: s.id, categoryId: s.categoryId, screen: null, label: c.label || s.name, name: s.name, photo: c.photo ?? { kind: 'auto' }, fromSetId: set.id };
                } else if (c.target === 'screen') {
                    const sc = HOME_CARD_SCREENS.find(x => x.key === c.screen);
                    if (sc) card = { key: `screen:${sc.key}`, target: 'screen', id: null, categoryId: null, screen: sc.key, label: c.label || sc.label.replace(/ \(.*\)$/, ''), name: sc.label, photo: c.photo ?? { kind: 'auto' }, fromSetId: set.id };
                }
                if (card && !seen.has(card.key)) { seen.add(card.key); out.push(card); }
            }
            if (out.length >= MAX_HOME_CARDS) break;
        }
        return { date: day, heading: sets[0].heading || DEFAULT_HEADING, setId: sets[0].id, setName: sets[0].name, cards: out };
    }

    /** For the admin preview: a YYYY-MM-DD, or today. */
    static day(v: unknown) {
        const s = text(v, 10);
        if (!s) return todayIso();
        if (!validIso(s)) throw new HomeCardsError('Choose a date to preview.');
        return s;
    }
}
