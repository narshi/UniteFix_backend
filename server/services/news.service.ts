/**
 * Newspapers — local media partners publish their daily editions to UniteFix
 * readers instead of (or as well as) PDFs in WhatsApp groups.
 *
 *   The paper     name, language, city, logo; reviewed by UniteFix before
 *                 readers see it (draft → submitted → live; paused by staff)
 *   Editions      a PDF per day (or per city edition). The PDF is private;
 *                 a preview — the top half of page 1, made in the partner's
 *                 browser at upload — is public, for shared links.
 *   Readers       anyone signed in to the app; they follow papers and are
 *                 notified of each new edition. Reading is free.
 *   Shared links  /news/e/<token>: the paper, the date, half of the first page
 *                 and "install the app to read the rest". The app opens the
 *                 full edition through a signed reader link that expires.
 *   Archive       3 days of editions free; a paid plan keeps 30 days —
 *                 ₹129 for 1 month, ₹249 for 3, ₹399 for 6, plus GST, paid
 *                 online, with a UniteFix tax invoice. Older editions are
 *                 removed by the clean-up job (file deleted, the row kept for
 *                 the paper's numbers).
 */

import crypto from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../db';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { newsPapers, newsEditions, newsFollows, newsReads, newsArchivePlans, businessPartners, type NewsPaper, type NewsEdition } from '@shared/schema';
import { HubError, type HubContext } from './partner-hub.service';
import { NewsStorage, NewsStorageUnavailable } from '../lib/news-storage';
import { configService } from './config.service';
import logger from '../lib/logger';

type Ctx = Pick<HubContext, 'businessPartnerId' | 'adminUserId'>;

export const LANGUAGES: Record<string, string> = {
    kannada: 'ಕನ್ನಡ Kannada', english: 'English', hindi: 'हिन्दी Hindi', marathi: 'मराठी Marathi', konkani: 'कोंकणी Konkani',
    tulu: 'ತುಳು Tulu', urdu: 'اردو Urdu', telugu: 'తెలుగు Telugu', tamil: 'தமிழ் Tamil', malayalam: 'മലയാളം Malayalam', other: 'Other',
};
export const FREQUENCIES = ['daily', 'weekly', 'fortnightly', 'monthly'] as const;
export const FREE_DAYS = 3;
export const ARCHIVE_DAYS = 30;
export const PLAN_MONTHS = [1, 3, 6] as const;
const DEFAULT_PRICE: Record<number, number> = { 1: 12900, 3: 24900, 6: 39900 };
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const token = () => crypto.randomBytes(12).toString('base64url');
const SECRET = () => process.env.JWT_SECRET || 'dev-news-secret';
/** Readers see a paper only while UniteFix has it live and its business is active (not paused or disabled). */
const readable = () => and(eq(newsPapers.status, 'live'), sql`exists (select 1 from business_partners bp where bp.id = ${newsPapers.businessPartnerId} and bp.status = 'active')`);

export class NewsService {

    // ══════════════════════════════════════════════════════════════════════
    // The paper
    // ══════════════════════════════════════════════════════════════════════

    static async paperOf(bpId: number) {
        const [p] = await db.select().from(newsPapers).where(eq(newsPapers.businessPartnerId, bpId)).limit(1);
        return p ?? null;
    }

    static async requirePaper(bpId: number) {
        const p = await this.paperOf(bpId);
        if (!p) throw new HubError('Set up your paper first — its name and language.', 'NO_PAPER', 409);
        return p;
    }

    static retentionDays(p: Pick<NewsPaper, 'archiveUntil'>) {
        return p.archiveUntil && p.archiveUntil > new Date() ? ARCHIVE_DAYS : FREE_DAYS;
    }
    /** The oldest edition date readers can still open. */
    static windowStart(p: Pick<NewsPaper, 'archiveUntil'>) {
        return addDays(istToday(), -(this.retentionDays(p) - 1));
    }

    static async saveProfile(ctx: Ctx, input: { name?: string; language?: string; city?: string | null; frequency?: string; description?: string | null }) {
        const cur = await this.paperOf(ctx.businessPartnerId);
        const v: Record<string, unknown> = {};
        if (input.name !== undefined) { if (input.name.trim().length < 2) throw new HubError('Your paper\'s name, as readers know it.', 'NO_NAME'); v.name = input.name.trim().slice(0, 80); }
        if (input.language !== undefined) { if (!LANGUAGES[input.language]) throw new HubError('Choose the language.', 'BAD_LANGUAGE'); v.language = input.language; }
        if (input.city !== undefined) v.city = input.city?.trim().slice(0, 60) || null;
        if (input.frequency !== undefined) { if (!(FREQUENCIES as readonly string[]).includes(input.frequency)) throw new HubError('How often does it come out?', 'BAD_FREQUENCY'); v.frequency = input.frequency; }
        if (input.description !== undefined) v.description = input.description?.trim().slice(0, 600) || null;
        if (cur) {
            const [u] = await db.update(newsPapers).set({ ...v, updatedAt: new Date() }).where(eq(newsPapers.id, cur.id)).returning();
            return u;
        }
        if (!v.name) throw new HubError('Your paper\'s name, as readers know it.', 'NO_NAME');
        const [row] = await db.insert(newsPapers).values({ businessPartnerId: ctx.businessPartnerId, ...(v as any) }).returning();
        return row;
    }

    static async setLogo(ctx: Ctx, url: string) {
        const p = await this.requirePaper(ctx.businessPartnerId);
        const [u] = await db.update(newsPapers).set({ logoUrl: url, updatedAt: new Date() }).where(eq(newsPapers.id, p.id)).returning();
        return u;
    }

    static async readiness(bpId: number) {
        const [bp] = await db.select({ status: businessPartners.status }).from(businessPartners).where(eq(businessPartners.id, bpId)).limit(1);
        const p = await this.paperOf(bpId);
        const [ed] = p ? await db.select({ n: sql<number>`count(*)::int` }).from(newsEditions).where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.status, 'live'))) : [{ n: 0 }];
        const checks = [
            { label: 'Your business is approved by UniteFix', done: bp?.status === 'active' },
            { label: 'The paper\'s name, language and city', done: !!p?.name && !!p.language && !!p.city },
            { label: 'Your masthead or logo', done: !!p?.logoUrl },
            { label: 'At least one edition uploaded', done: ed.n > 0 },
        ];
        return { ready: checks.every(c => c.done), checks };
    }

    static async submit(ctx: Ctx) {
        const p = await this.requirePaper(ctx.businessPartnerId);
        const r = await this.readiness(ctx.businessPartnerId);
        if (!r.ready) throw new HubError(`Finish first: ${r.checks.filter(c => !c.done).map(c => c.label.toLowerCase()).join('; ')}.`, 'NOT_READY', 409);
        if (p.status === 'live') throw new HubError('Your paper is already live.', 'LIVE', 409);
        if (p.status === 'paused') throw new HubError('UniteFix paused your paper — reply to their note and they will turn it back on.', 'PAUSED', 409);
        const [u] = await db.update(newsPapers).set({ status: 'submitted', updatedAt: new Date() }).where(eq(newsPapers.id, p.id)).returning();
        try {
            const { NotificationService } = await import('./notification.service');
            void NotificationService.sendToAdmins('Newspaper to review', `${p.name} asked to go live on UniteFix.`, { type: 'news_review', paperId: p.id });
        } catch { /* best effort */ }
        return u;
    }

    static async stats(paperId: number) {
        const since = addDays(istToday(), -6);
        const [f] = await db.select({ n: sql<number>`count(*)::int` }).from(newsFollows).where(eq(newsFollows.paperId, paperId));
        const [w] = await db.select({ reads: sql<number>`coalesce(sum(${newsEditions.reads}), 0)::int`, views: sql<number>`coalesce(sum(${newsEditions.linkViews}), 0)::int` })
            .from(newsEditions).where(and(eq(newsEditions.paperId, paperId), gte(newsEditions.editionDate, since)));
        return { followers: f?.n ?? 0, readsThisWeek: w?.reads ?? 0, linkViewsThisWeek: w?.views ?? 0 };
    }

    // ══════════════════════════════════════════════════════════════════════
    // Editions
    // ══════════════════════════════════════════════════════════════════════

    static async publish(ctx: Ctx, input: { editionDate: string; title?: string | null; headline?: string | null; pageCount?: number | null; pdf: Buffer; preview?: () => Promise<string | null> }) {
        const p = await this.requirePaper(ctx.businessPartnerId);
        if (p.status === 'paused') throw new HubError('Your paper is paused by UniteFix. New editions cannot be published until it is turned back on.', 'PAUSED', 409);
        if (!isDay(input.editionDate)) throw new HubError('Choose the edition date.', 'NO_DATE');
        if (input.editionDate > addDays(istToday(), 1)) throw new HubError('An edition cannot be dated more than a day ahead.', 'FUTURE');
        if (input.editionDate < this.windowStart(p)) throw new HubError(`Your plan keeps ${this.retentionDays(p)} days of editions — this date is older than that.`, 'TOO_OLD');
        if (!input.pdf?.length || input.pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HubError('Upload the edition as a PDF.', 'NOT_PDF');
        if (input.pdf.length > MAX_PDF_BYTES) throw new HubError(`The PDF is ${(input.pdf.length / 1048576).toFixed(1)} MB. Up to ${MAX_PDF_BYTES / 1048576} MB — export it at a lower image quality.`, 'TOO_BIG');
        const pages = Math.floor(Number(input.pageCount ?? 1));
        if (!(pages >= 1 && pages <= 200)) throw new HubError('Page count must be 1 to 200.', 'BAD_PAGES');
        const title = input.title?.trim().slice(0, 60) || 'Main edition';
        const [dupe] = await db.select({ id: newsEditions.id }).from(newsEditions).where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.editionDate, input.editionDate), eq(newsEditions.status, 'live'), sql`lower(${newsEditions.title}) = ${title.toLowerCase()}`)).limit(1);
        if (dupe) throw new HubError(`The ${title} for ${input.editionDate} is already up. Remove it first to upload a corrected one.`, 'DUPLICATE', 409);

        // The preview is stored only once the edition itself is accepted.
        const previewUrl = input.preview ? await input.preview() : null;
        let fileKey: string;
        try { fileKey = await NewsStorage.put(input.pdf, `${p.id}/${input.editionDate}-${crypto.randomBytes(6).toString('hex')}`); }
        catch (e: any) {
            if (e instanceof NewsStorageUnavailable) throw new HubError('Edition storage is not set up yet. Please contact UniteFix.', 'NO_STORAGE', 503);
            throw new HubError(`Upload failed: ${e?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502);
        }
        try {
            const [row] = await db.insert(newsEditions).values({
                paperId: p.id, editionDate: input.editionDate, title, headline: input.headline?.trim().slice(0, 200) || null, pageCount: pages,
                fileKey, fileSize: input.pdf.length, previewUrl, publicToken: token(), status: 'live', publishedAt: new Date(),
            }).returning();
            // Today's paper (or tomorrow's, put up overnight) — not a back-dated upload.
            if (p.status === 'live' && input.editionDate >= addDays(istToday(), -1)) void this.notifyFollowers(p, row).catch(e => logger.warn(`[NEWS] notify failed: ${e?.message}`));
            return row;
        } catch (e: any) {
            await NewsStorage.remove(fileKey);
            if (e?.code === '23505' || e?.cause?.code === '23505') throw new HubError('That edition was just uploaded.', 'DUPLICATE', 409);
            throw e;
        }
    }

    /** One notification per paper per day, to everyone who follows it. */
    static async notifyFollowers(p: NewsPaper, e: NewsEdition) {
        const [already] = await db.select({ id: newsEditions.id }).from(newsEditions)
            .where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.editionDate, e.editionDate), ne(newsEditions.id, e.id), sql`${newsEditions.notifiedAt} is not null`)).limit(1);
        if (already) return 0;
        const followers = await db.select({ u: newsFollows.userId }).from(newsFollows).where(eq(newsFollows.paperId, p.id));
        await db.update(newsEditions).set({ notifiedAt: new Date() }).where(eq(newsEditions.id, e.id));
        if (!followers.length) return 0;
        const { NotificationService } = await import('./notification.service');
        const date = new Date(`${e.editionDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        await NotificationService.sendToUsers(followers.map(f => f.u), `${p.name} — ${date}`, e.headline ?? `Today's ${p.name} is here. Tap to read.`, 'news_edition', { screen: 'NewsReader', editionId: e.id });
        return followers.length;
    }

    static async hubEditions(bpId: number) {
        const p = await this.paperOf(bpId);
        if (!p) return [];
        return db.select().from(newsEditions).where(and(eq(newsEditions.paperId, p.id), gte(newsEditions.editionDate, addDays(istToday(), -60))))
            .orderBy(desc(newsEditions.editionDate), asc(newsEditions.title));
    }

    static async removeEdition(ctx: Ctx, id: number, reason = 'Removed by the paper') {
        const p = await this.requirePaper(ctx.businessPartnerId);
        const [cur] = await db.select({ key: newsEditions.fileKey }).from(newsEditions)
            .where(and(eq(newsEditions.id, id), eq(newsEditions.paperId, p.id), eq(newsEditions.status, 'live'))).limit(1);
        if (!cur) throw new HubError('Edition not found', 'NOT_FOUND', 404);
        const [e] = await db.update(newsEditions).set({ status: 'removed', removedReason: reason, fileKey: null })
            .where(and(eq(newsEditions.id, id), eq(newsEditions.status, 'live'))).returning({ id: newsEditions.id });
        if (!e) throw new HubError('Edition not found', 'NOT_FOUND', 404);
        await NewsStorage.remove(cur.key);
        return e;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Readers
    // ══════════════════════════════════════════════════════════════════════

    private static editionView(e: NewsEdition, p: Pick<NewsPaper, 'id' | 'name' | 'logoUrl' | 'language'>) {
        return { id: e.id, paperId: p.id, paper: p.name, logoUrl: p.logoUrl, language: p.language, editionDate: e.editionDate, title: e.title, headline: e.headline, pageCount: e.pageCount, previewUrl: e.previewUrl, shareUrl: `/news/e/${e.publicToken}` };
    }

    /** Live papers, with the reader's follows and each paper's latest edition. */
    static async papers(userId: number | null, filter: { language?: string; q?: string } = {}) {
        const rows = await db.select().from(newsPapers).where(readable()).orderBy(asc(newsPapers.name));
        const list = rows.filter(p => (!filter.language || p.language === filter.language) && (!filter.q || p.name.toLowerCase().includes(filter.q.toLowerCase()) || (p.city ?? '').toLowerCase().includes(filter.q.toLowerCase())));
        if (!list.length) return [];
        const ids = list.map(p => p.id);
        const follows = userId ? new Set((await db.select({ p: newsFollows.paperId }).from(newsFollows).where(and(eq(newsFollows.userId, userId), inArray(newsFollows.paperId, ids)))).map(f => f.p)) : new Set<number>();
        const counts = new Map((await db.select({ p: newsFollows.paperId, n: sql<number>`count(*)::int` }).from(newsFollows).where(inArray(newsFollows.paperId, ids)).groupBy(newsFollows.paperId)).map(c => [c.p, c.n]));
        const latest = await db.selectDistinctOn([newsEditions.paperId]).from(newsEditions).where(and(inArray(newsEditions.paperId, ids), eq(newsEditions.status, 'live')))
            .orderBy(newsEditions.paperId, desc(newsEditions.editionDate), desc(newsEditions.publishedAt));
        const lm = new Map(latest.map(e => [e.paperId, e]));
        return list.map(p => {
            const e = lm.get(p.id);
            return {
                id: p.id, name: p.name, language: p.language, languageLabel: LANGUAGES[p.language] ?? p.language, city: p.city, frequency: p.frequency, description: p.description, logoUrl: p.logoUrl,
                followers: counts.get(p.id) ?? 0, following: follows.has(p.id),
                latest: e && e.editionDate >= this.windowStart(p) ? this.editionView(e, p) : null,
            };
        });
    }

    /** Today's reading: the latest editions of the papers this reader follows. */
    static async feed(userId: number) {
        const followed = await db.select({ p: newsPapers }).from(newsFollows).innerJoin(newsPapers, eq(newsPapers.id, newsFollows.paperId))
            .where(and(eq(newsFollows.userId, userId), readable()));
        const out = [];
        for (const { p } of followed) {
            const eds = await db.select().from(newsEditions).where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.status, 'live'), gte(newsEditions.editionDate, this.windowStart(p))))
                .orderBy(desc(newsEditions.editionDate), asc(newsEditions.title)).limit(3);
            out.push(...eds.map(e => this.editionView(e, p)));
        }
        const readSet = out.length ? new Set((await db.select({ e: newsReads.editionId }).from(newsReads).where(and(eq(newsReads.userId, userId), inArray(newsReads.editionId, out.map(o => o.id))))).map(r => r.e)) : new Set<number>();
        return out.map(o => ({ ...o, read: readSet.has(o.id) })).sort((a, b) => b.editionDate.localeCompare(a.editionDate) || a.paper.localeCompare(b.paper));
    }

    static async paper(userId: number | null, paperId: number) {
        const [p] = await db.select().from(newsPapers).where(and(eq(newsPapers.id, paperId), readable())).limit(1);
        if (!p) throw new HubError('This paper is not available.', 'NOT_FOUND', 404);
        const eds = await db.select().from(newsEditions).where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.status, 'live'), gte(newsEditions.editionDate, this.windowStart(p))))
            .orderBy(desc(newsEditions.editionDate), asc(newsEditions.title));
        const following = userId ? !!(await db.select().from(newsFollows).where(and(eq(newsFollows.userId, userId), eq(newsFollows.paperId, p.id))).limit(1))[0] : false;
        const { followers } = await this.stats(p.id);
        const [bp] = await db.select({ code: businessPartners.partnerCode }).from(businessPartners).where(eq(businessPartners.id, p.businessPartnerId)).limit(1);
        return {
            id: p.id, code: bp?.code ?? null, name: p.name, language: p.language, languageLabel: LANGUAGES[p.language] ?? p.language, city: p.city, frequency: p.frequency, description: p.description,
            logoUrl: p.logoUrl, followers, following, keepsDays: this.retentionDays(p), shareUrl: bp ? `/news/p/${bp.code}` : null,
            editions: eds.map(e => this.editionView(e, p)),
        };
    }

    static async follow(userId: number, paperId: number, on: boolean, source = 'app') {
        const [p] = await db.select({ id: newsPapers.id }).from(newsPapers).where(and(eq(newsPapers.id, paperId), readable())).limit(1);
        if (!p) throw new HubError('This paper is not available.', 'NOT_FOUND', 404);
        if (on) await db.insert(newsFollows).values({ userId, paperId, source: ['app', 'link', 'qr'].includes(source) ? source : 'app' }).onConflictDoNothing();
        else await db.delete(newsFollows).where(and(eq(newsFollows.userId, userId), eq(newsFollows.paperId, paperId)));
        return { following: on };
    }

    /** Open an edition in the app: counts the read and returns a signed reader link (30 minutes). */
    static async readLink(userId: number, editionId: number) {
        const [r] = await db.select({ e: newsEditions, p: newsPapers }).from(newsEditions).innerJoin(newsPapers, eq(newsPapers.id, newsEditions.paperId))
            .where(and(eq(newsEditions.id, editionId), readable())).limit(1);
        if (!r || r.e.status !== 'live' || r.e.editionDate < this.windowStart(r.p) || !r.e.fileKey) throw new HubError('This edition is no longer available.', 'GONE', 410);
        const [first] = await db.insert(newsReads).values({ userId, editionId }).onConflictDoNothing().returning();
        if (first) await db.update(newsEditions).set({ reads: sql`${newsEditions.reads} + 1` }).where(eq(newsEditions.id, editionId));
        const exp = Math.floor(Date.now() / 1000) + 30 * 60;
        return { url: `/news/read/${editionId}?exp=${exp}&sig=${this.sign(editionId, exp)}`, edition: this.editionView(r.e, r.p) };
    }

    static sign(editionId: number, exp: number) {
        return crypto.createHmac('sha256', SECRET()).update(`news:${editionId}:${exp}`).digest('base64url');
    }
    static verify(editionId: number, exp: number, sig: string) {
        if (!(exp > Date.now() / 1000)) return false;
        const want = this.sign(editionId, exp);
        return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
    }

    /** The PDF, for a valid signed reader link. */
    static async openFile(editionId: number) {
        const [r] = await db.select({ e: newsEditions, p: newsPapers }).from(newsEditions).innerJoin(newsPapers, eq(newsPapers.id, newsEditions.paperId)).where(eq(newsEditions.id, editionId)).limit(1);
        if (!r || r.e.status !== 'live' || !r.e.fileKey) throw new HubError('This edition is no longer available.', 'GONE', 410);
        return { ...(await NewsStorage.open(r.e.fileKey)), edition: this.editionView(r.e, r.p) };
    }

    /** What a shared link shows: the paper, the date, the preview — never the PDF. */
    static async publicEdition(tok: string) { return this.lookupShared(tok, true); }
    /** The same, without counting a view (chat-preview fetches, the preview image). */
    static async publicEditionQuiet(tok: string) { return this.lookupShared(tok, false); }

    private static async lookupShared(tok: string, count: boolean) {
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) return null;
        const [r] = await db.select({ e: newsEditions, p: newsPapers, code: businessPartners.partnerCode }).from(newsEditions)
            .innerJoin(newsPapers, eq(newsPapers.id, newsEditions.paperId)).innerJoin(businessPartners, eq(businessPartners.id, newsPapers.businessPartnerId))
            .where(and(eq(newsEditions.publicToken, tok), readable())).limit(1);
        if (!r) return null;
        const available = r.e.status === 'live' && r.e.editionDate >= this.windowStart(r.p);
        if (available && count) await db.update(newsEditions).set({ linkViews: sql`${newsEditions.linkViews} + 1` }).where(eq(newsEditions.id, r.e.id));
        return { ...this.editionView(r.e, r.p), available, paperCode: r.code, city: r.p.city, languageLabel: LANGUAGES[r.p.language] ?? r.p.language, editionId: r.e.id };
    }

    static async publicPaper(code: string) {
        const [r] = await db.select({ p: newsPapers }).from(newsPapers).innerJoin(businessPartners, eq(businessPartners.id, newsPapers.businessPartnerId))
            .where(and(eq(businessPartners.partnerCode, code), readable())).limit(1);
        if (!r) return null;
        return this.paper(null, r.p.id);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Archive plans
    // ══════════════════════════════════════════════════════════════════════

    static async prices() {
        const gst = parseFloat((await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18');
        const out = [];
        for (const m of PLAN_MONTHS) {
            const p = Number(await configService.get<number>(`BUSINESS_CONFIG.NEWS_ARCHIVE_${m}M_PAISE`, DEFAULT_PRICE[m])) || DEFAULT_PRICE[m];
            const tax = Math.round(p * gst / 100);
            out.push({ months: m, pricePaise: p, gstPaise: tax, totalPaise: p + tax, gstRate: gst, perMonthPaise: Math.round(p / m) });
        }
        return out;
    }

    private static razorpay: Razorpay | null = null;
    private static rzp() {
        if (this.razorpay) return this.razorpay;
        const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
        if (!id || !secret || id.includes('xxxxx')) return null;
        this.razorpay = new Razorpay({ key_id: id, key_secret: secret });
        return this.razorpay;
    }

    /** Start buying a plan. Without a gateway, development activates it at once. */
    static async startPlan(ctx: Ctx, months: number) {
        const p = await this.requirePaper(ctx.businessPartnerId);
        const price = (await this.prices()).find(x => x.months === months);
        if (!price) throw new HubError('Choose 1, 3 or 6 months.', 'BAD_PLAN');
        const [plan] = await db.insert(newsArchivePlans).values({ paperId: p.id, months, amountPaise: price.pricePaise, gstPaise: price.gstPaise, createdByAdminUserId: ctx.adminUserId }).returning();
        const rzp = this.rzp();
        if (!rzp) {
            if (process.env.NODE_ENV === 'production') throw new HubError('Online payment is not available right now. Please try again later.', 'NO_GATEWAY', 503);
            await this.applyPayment({ planId: plan.id, paymentId: `dev_${plan.id}` });
            return { planId: plan.id, devActivated: true };
        }
        const order = await rzp.orders.create({ amount: price.totalPaise, currency: 'INR', receipt: `news_${plan.id}`, notes: { payment_type: 'news_archive', news_plan_id: String(plan.id), business_partner_id: String(ctx.businessPartnerId) } });
        await db.update(newsArchivePlans).set({ razorpayOrderId: order.id }).where(eq(newsArchivePlans.id, plan.id));
        return { planId: plan.id, orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID!, amount: price.totalPaise / 100, description: `${p.name} — 30-day archive, ${months} month${months === 1 ? '' : 's'}` };
    }

    static async confirmPlan(ctx: Ctx, planId: number, b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
        const p = await this.requirePaper(ctx.businessPartnerId);
        const [plan] = await db.select().from(newsArchivePlans).where(and(eq(newsArchivePlans.id, planId), eq(newsArchivePlans.paperId, p.id))).limit(1);
        if (!plan) throw new HubError('Not found', 'NOT_FOUND', 404);
        const secret = process.env.RAZORPAY_KEY_SECRET ?? '';
        const want = crypto.createHmac('sha256', secret).update(`${b.razorpay_order_id}|${b.razorpay_payment_id}`).digest('hex');
        if (!secret || plan.razorpayOrderId !== b.razorpay_order_id || want.length !== String(b.razorpay_signature).length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(b.razorpay_signature)))) {
            throw new HubError('Payment could not be verified.', 'BAD_SIGNATURE');
        }
        return this.applyPayment({ planId, paymentId: b.razorpay_payment_id });
    }

    /**
     * Money received (the page's callback or Razorpay's webhook — whichever
     * comes second is a no-op): the archive runs from now, or from the end of
     * the current plan, for the months bought; UniteFix issues its invoice.
     */
    static async applyPayment(params: { planId?: number; orderId?: string; paymentId: string }) {
        const done = await db.transaction(async (tx) => {
            const cond = params.planId ? eq(newsArchivePlans.id, params.planId) : eq(newsArchivePlans.razorpayOrderId, params.orderId!);
            const [plan] = await tx.select().from(newsArchivePlans).where(cond).for('update');
            if (!plan) throw new Error('News plan not found');
            if (plan.status === 'paid') return { plan, applied: false };
            const [paper] = await tx.select().from(newsPapers).where(eq(newsPapers.id, plan.paperId)).for('update');
            const now = new Date();
            const start = paper.archiveUntil && paper.archiveUntil > now ? paper.archiveUntil : now;
            const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + plan.months);
            const [u] = await tx.update(newsArchivePlans).set({ status: 'paid', paidAt: now, razorpayPaymentId: params.paymentId, startsAt: start, endsAt: end }).where(eq(newsArchivePlans.id, plan.id)).returning();
            await tx.update(newsPapers).set({ archiveUntil: end, planRemindedFor: null, updatedAt: now }).where(eq(newsPapers.id, paper.id));

            const { TaxDocumentService } = await import('./tax-documents.service');
            const [bp] = await tx.select().from(businessPartners).where(eq(businessPartners.id, paper.businessPartnerId));
            const sac = ((await configService.get<string>('BUSINESS_CONFIG.NEWS_ARCHIVE_SAC')) || '998315').trim();
            const gstRate = plan.amountPaise ? Math.round(plan.gstPaise * 10000 / plan.amountPaise) / 100 : 18;
            const fmt = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
            const doc = await TaxDocumentService.create(tx as any, {
                docKind: 'tax_invoice', issuer: 'unitefix', seriesKey: 'uf-news', prefix: 'UF', letter: 'N', purpose: 'news_archive',
                recipientPartnerId: bp.id, supplier: await TaxDocumentService.unitefixParty(), recipient: TaxDocumentService.partnerParty(bp),
                lines: [{ description: `UniteFix newspaper archive — ${paper.name}: 30 days of editions kept, ${plan.months} month${plan.months === 1 ? '' : 's'} (${fmt(start)} to ${fmt(end)})`, hsnSac: sac, quantity: 1, unit: 'plan', ratePaise: plan.amountPaise, taxablePaise: plan.amountPaise, gstRate, taxPaise: plan.gstPaise }],
                periodFrom: fmt(start), periodTo: fmt(end), notes: `Paid online (${params.paymentId}).`, createdByAdminId: null, issuedAt: now,
            });
            await tx.update(newsArchivePlans).set({ invoiceDocumentId: doc.id }).where(eq(newsArchivePlans.id, plan.id));
            return { plan: u, applied: true, paper, end };
        });
        if (done.applied) {
            const { HubAlerts } = await import('./hub-alerts.service');
            void HubAlerts.send(done.paper!.businessPartnerId, 'payment_received', { title: 'Archive plan active', body: `Readers can now open ${ARCHIVE_DAYS} days of ${done.paper!.name} editions, until ${done.end!.toLocaleDateString('en-IN', { dateStyle: 'medium' })}.`, link: '/partner/news/plan', refType: 'news_plan', refId: done.plan.id });
            logger.info(`[NEWS] archive plan #${done.plan.id} paid (${done.plan.months} months) for paper #${done.plan.paperId}`);
        }
        return done.plan;
    }

    static async plans(bpId: number) {
        const p = await this.paperOf(bpId);
        if (!p) return [];
        return db.select().from(newsArchivePlans).where(and(eq(newsArchivePlans.paperId, p.id), eq(newsArchivePlans.status, 'paid'))).orderBy(desc(newsArchivePlans.paidAt));
    }

    // ══════════════════════════════════════════════════════════════════════
    // The clock: remove what is past each paper's window; warn before a plan ends
    // ══════════════════════════════════════════════════════════════════════

    static async tick() {
        const out = { expired: 0, reminded: 0 };
        const papers = await db.select().from(newsPapers);
        for (const p of papers) {
            const cutoff = this.windowStart(p);
            const old = await db.select({ id: newsEditions.id, key: newsEditions.fileKey }).from(newsEditions)
                .where(and(eq(newsEditions.paperId, p.id), eq(newsEditions.status, 'live'), lt(newsEditions.editionDate, cutoff))).limit(500);
            for (const e of old) {
                const [u] = await db.update(newsEditions).set({ status: 'expired', fileKey: null }).where(and(eq(newsEditions.id, e.id), eq(newsEditions.status, 'live'))).returning({ id: newsEditions.id });
                if (u) { await NewsStorage.remove(e.key); out.expired++; }
            }
            // Three days before a paid archive ends, once per plan end.
            if (p.archiveUntil && p.archiveUntil > new Date() && p.archiveUntil.getTime() - Date.now() < 3 * 86_400_000
                && (!p.planRemindedFor || p.planRemindedFor.getTime() !== p.archiveUntil.getTime())) {
                await db.update(newsPapers).set({ planRemindedFor: p.archiveUntil }).where(eq(newsPapers.id, p.id));
                const { HubAlerts } = await import('./hub-alerts.service');
                await HubAlerts.send(p.businessPartnerId, 'news_plan', { title: 'Your 30-day archive ends soon', body: `On ${p.archiveUntil.toLocaleDateString('en-IN', { dateStyle: 'medium' })} readers go back to the last ${FREE_DAYS} days of ${p.name}, and older editions are removed. Renew to keep 30 days.`, link: '/partner/news/plan', refType: 'news_paper', refId: p.id });
                out.reminded++;
            }
        }
        if (out.expired || out.reminded) logger.info(`[NEWS] tick ${JSON.stringify(out)}`);
        return out;
    }

    // ══════════════════════════════════════════════════════════════════════
    // Staff
    // ══════════════════════════════════════════════════════════════════════

    static async adminPapers() {
        const rows = await db.select({ p: newsPapers, partner: businessPartners.displayName, code: businessPartners.partnerCode, bpStatus: businessPartners.status })
            .from(newsPapers).innerJoin(businessPartners, eq(businessPartners.id, newsPapers.businessPartnerId)).orderBy(desc(newsPapers.updatedAt));
        const out = [];
        for (const r of rows) {
            const [e] = await db.select({ n: sql<number>`count(*) filter (where ${newsEditions.status} = 'live')::int`, last: sql<string | null>`max(${newsEditions.editionDate})` }).from(newsEditions).where(eq(newsEditions.paperId, r.p.id));
            out.push({ id: r.p.id, name: r.p.name, language: LANGUAGES[r.p.language] ?? r.p.language, city: r.p.city, logoUrl: r.p.logoUrl, status: r.p.status, reviewNote: r.p.reviewNote, partner: r.partner, code: r.code, partnerStatus: r.bpStatus,
                archiveUntil: r.p.archiveUntil, keepsDays: this.retentionDays(r.p), liveEditions: e?.n ?? 0, lastEdition: e?.last ?? null, ...(await this.stats(r.p.id)) });
        }
        return out;
    }

    static async adminEditions(paperId: number) {
        return db.select().from(newsEditions).where(eq(newsEditions.paperId, paperId)).orderBy(desc(newsEditions.editionDate)).limit(60);
    }

    static async review(adminId: number, paperId: number, input: { decision: 'approve' | 'changes' | 'pause' | 'resume'; note?: string | null }) {
        const [p] = await db.select().from(newsPapers).where(eq(newsPapers.id, paperId)).limit(1);
        if (!p) throw new HubError('Not found', 'NOT_FOUND', 404);
        const note = input.note?.trim().slice(0, 500) || null;
        const next = ({ approve: 'live', changes: 'changes_requested', pause: 'paused', resume: 'live' } as const)[input.decision];
        if (input.decision === 'approve' && !['submitted', 'changes_requested', 'draft'].includes(p.status)) throw new HubError(`It is ${p.status}.`, 'BAD_STATE', 409);
        if (input.decision === 'resume' && p.status !== 'paused') throw new HubError('Only a paused paper can be resumed.', 'BAD_STATE', 409);
        if (input.decision === 'pause' && p.status !== 'live') throw new HubError('Only a live paper can be paused.', 'BAD_STATE', 409);
        if ((input.decision === 'changes' || input.decision === 'pause') && !note) throw new HubError('Tell the paper why.', 'NO_NOTE');
        const [u] = await db.update(newsPapers).set({ status: next, reviewNote: note, updatedAt: new Date() }).where(eq(newsPapers.id, paperId)).returning();
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(p.businessPartnerId, 'listing_reviewed', { title: next === 'live' ? `${p.name} is live on UniteFix` : next === 'paused' ? `${p.name} is paused` : 'Changes needed before going live', body: next === 'live' ? 'Readers can now find, follow and read your paper. Share your follow link in your WhatsApp groups.' : note ?? '', link: '/partner/news', refType: 'news_paper', refId: p.id });
        const { recordAudit } = await import('../lib/audit');
        await recordAudit({ entityType: 'business_partner', entityId: p.businessPartnerId, action: `news_paper_${input.decision}`, changedBy: adminId, metadata: { paperId, note } });
        return u;
    }

    static async takedown(adminId: number, editionId: number, reason: string) {
        if (!reason?.trim()) throw new HubError('Say why — the paper is told.', 'NO_REASON');
        const [e] = await db.select({ e: newsEditions, p: newsPapers }).from(newsEditions).innerJoin(newsPapers, eq(newsPapers.id, newsEditions.paperId)).where(eq(newsEditions.id, editionId)).limit(1);
        if (!e || e.e.status !== 'live') throw new HubError('Edition not found or already gone.', 'NOT_FOUND', 404);
        await db.update(newsEditions).set({ status: 'removed', removedReason: `Taken down by UniteFix: ${reason.trim().slice(0, 300)}`, fileKey: null }).where(eq(newsEditions.id, editionId));
        await NewsStorage.remove(e.e.fileKey);
        const { HubAlerts } = await import('./hub-alerts.service');
        await HubAlerts.send(e.p.businessPartnerId, 'listing_reviewed', { title: `Edition of ${e.e.editionDate} taken down`, body: reason.trim().slice(0, 300), link: '/partner/news/editions', refType: 'news_edition', refId: editionId });
        const { recordAudit } = await import('../lib/audit');
        await recordAudit({ entityType: 'business_partner', entityId: e.p.businessPartnerId, action: 'news_edition_taken_down', changedBy: adminId, metadata: { editionId, reason } });
    }

    static async adminPlans() {
        return db.select({ plan: newsArchivePlans, paper: newsPapers.name }).from(newsArchivePlans).innerJoin(newsPapers, eq(newsPapers.id, newsArchivePlans.paperId))
            .where(eq(newsArchivePlans.status, 'paid')).orderBy(desc(newsArchivePlans.paidAt)).limit(300);
    }
}
