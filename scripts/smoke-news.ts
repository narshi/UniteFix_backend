/**
 * Newspapers end to end.
 *
 *   A media partner sets up the paper, uploads the day's PDF (the real sample
 *   edition) with its half-page preview, and asks to go live; staff approve.
 *   Readers find, follow and read it (signed, expiring reader links; the PDF
 *   is never public), are notified once a day, and share links that show only
 *   the preview. Storage keeps 3 days free and 30 days on a paid archive plan
 *   (₹129 / ₹249 / ₹399 + GST, with a UniteFix invoice); the clean-up job
 *   removes the rest and warns before a plan ends. Staff take down editions
 *   and pause papers.
 *
 *   npm run smoke:news
 */

import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { bootServer, client, check, summary, makeSuperAdmin, gstinFor, cleanupPartners, db } from './lib/hub-test-kit';
import { adminUsers, businessPartners, users, notifications, hubAlerts, newsPapers, newsEditions, newsArchivePlans, taxDocuments, taxDocumentLines } from '../shared/schema';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { PartnerHubService } from '../server/services/partner-hub.service';
import { NewsService } from '../server/services/news.service';

const stamp = Date.now().toString(36);
const adminIds: number[] = [], bpIds: number[] = [], userIds: number[] = [];
const ist = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAAASUVORK5CYII=', 'base64');
const SAMPLE = 'L:/UF/ತತ್ತ್ವನಿಷ್ಠ 01-09-2026_261010_000215.pdf';
const pdfBytes = fs.existsSync(SAMPLE) ? fs.readFileSync(SAMPLE) : Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const edition = (f: Record<string, string>, pdf: Buffer = pdfBytes, withPreview = true) => {
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'edition.pdf');
    if (withPreview) fd.append('preview', new Blob([PNG], { type: 'image/png' }), 'preview.png');
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    return fd;
};

async function main() {
    // No real payment gateway from a test: plans activate in test mode, and the
    // signed-callback path is checked with a throwaway secret.
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    const { base, close } = await bootServer();
    const api = client(base);
    const SECRET = process.env.JWT_SECRET as string;
    const n = () => String(Date.now() + Math.floor(Math.random() * 1e6)).slice(-9);
    try {
        const sa = await makeSuperAdmin(stamp); adminIds.push(sa.id);
        const st = (await api.login(sa.username, sa.password))!;
        const mk = async (name: string, verticals: string[], p: string, ph: string) => {
            const bp = await BusinessPartnerService.create({ legalName: `QA ${name} ${stamp}`, displayName: name, gstin: await gstinFor('29', `${p}1234K`), contactPhone: `${ph}${n()}`, contactEmail: `qa_news_${p}_${stamp}@example.test`, verticalCodes: verticals, approvedByAdminId: sa.id, pincode: '581301', district: 'Uttara Kannada' });
            bpIds.push(bp.id);
            await db.update(businessPartners).set({ stateCode: '29', stateName: 'Karnataka' }).where(eq(businessPartners.id, bp.id));
            const l = await PartnerHubService.createOwnerLogin(bp.id, {});
            const [r] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, l.username)); if (r) adminIds.push(r.id);
            return { bp, t: (await api.login(l.username, l.temporaryPassword))! };
        };
        const reader = async (name: string) => {
            const [u] = await db.insert(users).values({ phone: `8${n()}`, username: name, role: 'user', isActive: true } as any).returning();
            userIds.push(u.id);
            return { u, t: jwt.sign({ userId: u.id, role: 'user' }, SECRET, { expiresIn: '1h' }) };
        };
        const paperP = await mk('Tattvanishtha', ['media'], 'TTVNS', '7');
        await new Promise(r => setTimeout(r, 5));
        const other = await mk('QA Consultant', ['consultation'], 'CNSLN', '6');
        const T = paperP.t;
        const today = ist();

        // ── the paper ──
        const me = await api.get('/api/hub/me', T);
        check('a media partner gets the Newsroom', me.body?.data?.modules?.includes('newsroom'));
        check('others cannot open the Newsroom', (await api.get('/api/hub/news', other.t)).status === 403);
        const s0 = await api.get('/api/hub/news', T);
        check('no paper yet; the checklist and prices (₹129 / ₹249 / ₹399 + 18% GST)', s0.status === 200 && s0.body.data.paper === null && !s0.body.data.readiness.ready
            && s0.body.data.prices.map((p: any) => `${p.months}:${p.pricePaise}:${p.totalPaise}`).join() === '1:12900:15222,3:24900:29382,6:39900:47082', JSON.stringify(s0.body?.data?.prices));
        check('an edition cannot be uploaded before the paper is set up', (await api.upload('/api/hub/news/editions', edition({ editionDate: today }), T)).body?.code === 'NO_PAPER');
        check('the language must be one of the list', (await api.put('/api/hub/news/paper', { name: 'Tattvanishtha', language: 'klingon' }, T)).body?.code === 'BAD_LANGUAGE');
        const sv = await api.put('/api/hub/news/paper', { name: 'ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha', language: 'kannada', city: 'Karwar', frequency: 'daily', description: 'Karwar\'s Kannada daily since 1998.' }, T);
        check('the paper is saved (a draft)', sv.status === 200 && sv.body.data.paper.status === 'draft' && sv.body.data.keepsDays === 3);
        const lf = new FormData(); lf.append('file', new Blob([PNG], { type: 'image/png' }), 'logo.png');
        check('masthead uploaded', (await api.upload('/api/hub/news/logo', lf, T)).status === 200);
        check('cannot ask to go live without an edition', (await api.post('/api/hub/news/submit', {}, T)).body?.code === 'NOT_READY');

        // ── editions ──
        check('a file that is not a PDF is refused', (await api.upload('/api/hub/news/editions', edition({ editionDate: today }, PNG), T)).body?.code === 'NOT_PDF');
        check('a date more than a day ahead is refused', (await api.upload('/api/hub/news/editions', edition({ editionDate: add(today, 3) }), T)).body?.code === 'FUTURE');
        check('a date older than the 3 free days is refused', (await api.upload('/api/hub/news/editions', edition({ editionDate: add(today, -3) }), T)).body?.code === 'TOO_OLD');
        const e1 = await api.upload('/api/hub/news/editions', edition({ editionDate: today, headline: 'ಕಾರವಾರ ಬಂದರು ವಿಸ್ತರಣೆಗೆ ಅನುಮೋದನೆ', pageCount: '6' }), T);
        check(`the day's PDF (${(pdfBytes.length / 1048576).toFixed(1)} MB, 6 pages) and its preview are uploaded`, e1.status === 201 && e1.body.data.pageCount === 6 && e1.body.data.fileSize === pdfBytes.length && !!e1.body.data.previewUrl, JSON.stringify(e1.body?.message));
        check('…and the partner is told readers see it only once the paper is live', /once UniteFix puts your paper live/.test(e1.body?.message ?? ''));
        check('the same edition twice is refused', (await api.upload('/api/hub/news/editions', edition({ editionDate: today }), T)).body?.code === 'DUPLICATE');
        const tok1 = e1.body.data.publicToken as string;
        check('a shared link shows nothing while the paper is not live', (await api.get(`/api/public/news/e/${tok1}`)).status === 404);

        // ── review ──
        const sub = await api.post('/api/hub/news/submit', {}, T);
        check('the paper asks to go live', sub.status === 200 && sub.body.data.paper.status === 'submitted', JSON.stringify(sub.body?.message));
        const ov = await api.get('/api/admin/reports/overview?range=7d', st);
        check('the admin dashboard flags papers to review', ov.body?.data?.attention?.some((x: any) => x.key === 'newspapers' && x.count >= 1), JSON.stringify(ov.body?.data?.attention?.map((x: any) => x.key)));
        const al = await api.get('/api/admin/hub/news/papers', st);
        const row = al.body?.data?.papers?.find((p: any) => p.id === sub.body.data.paper.id);
        check('staff see it with its editions', row?.status === 'submitted' && row.liveEditions === 1 && row.code === paperP.bp.partnerCode);
        const paperId = row.id as number;
        check('asking for changes needs a note', (await api.post(`/api/admin/hub/news/papers/${paperId}/review`, { decision: 'changes' }, st)).body?.code === 'NO_NOTE');
        const ok = await api.post(`/api/admin/hub/news/papers/${paperId}/review`, { decision: 'approve' }, st);
        check('staff approve: the paper is live', ok.status === 200 && ok.body.data.status === 'live');
        const [la] = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, paperP.bp.id), eq(hubAlerts.kind, 'listing_reviewed')));
        check('the paper is told', !!la);

        // ── readers ──
        check('reading needs sign-in', (await api.get('/api/news/papers')).status === 401);
        const R1 = await reader('QA Reader One'), R2 = await reader('QA Reader Two');
        const list = await api.get('/api/news/papers?language=kannada', R1.t);
        const lp = list.body?.data?.papers?.find((p: any) => p.id === paperId);
        check('readers find the paper, with today\'s edition', lp?.following === false && lp.latest?.editionDate === today && lp.latest.pageCount === 6);
        check('search by name or city', (await api.get('/api/news/papers?q=karwar', R1.t)).body?.data?.papers?.some((p: any) => p.id === paperId) && !(await api.get('/api/news/papers?q=zzqq', R1.t)).body?.data?.papers?.length);
        check('follow', (await api.post(`/api/news/papers/${paperId}/follow`, { on: true, source: 'qr' }, R1.t)).body?.data?.following === true);
        await api.post(`/api/news/papers/${paperId}/follow`, { on: true }, R1.t);
        const feed = await api.get('/api/news/feed', R1.t);
        check('the reader\'s feed has today\'s edition, unread', feed.body?.data?.length === 1 && feed.body.data[0].read === false && feed.body.data[0].paper.startsWith('ತತ್ತ್ವನಿಷ್ಠ'));
        const pd = await api.get(`/api/news/papers/${paperId}`, R1.t);
        check('the paper page: followers, editions, its follow link', pd.body?.data?.followers === 1 && pd.body.data.following && pd.body.data.editions.length === 1 && pd.body.data.shareUrl === `/news/p/${paperP.bp.partnerCode}`);

        const op = await api.post(`/api/news/editions/${e1.body.data.id}/open`, {}, R1.t);
        check('opening an edition gives a signed reader link', op.status === 200 && /^\/news\/read\/\d+\?exp=\d+&sig=/.test(op.body.data.url));
        const fileUrl = op.body.data.url.replace('/news/read/', '/api/public/news/file/');
        const fr = await fetch(base + fileUrl);
        const got = Buffer.from(await fr.arrayBuffer());
        check('the signed link streams the whole PDF', fr.status === 200 && fr.headers.get('content-type') === 'application/pdf' && got.equals(pdfBytes));
        check('a tampered link is refused', (await fetch(base + fileUrl.replace(/sig=./, 'sig=x'))).status === 403);
        check('an expired link is refused', (await fetch(`${base}/api/public/news/file/${e1.body.data.id}?exp=${Math.floor(Date.now() / 1000) - 5}&sig=${NewsService.sign(e1.body.data.id, Math.floor(Date.now() / 1000) - 5)}`)).status === 403);
        await api.post(`/api/news/editions/${e1.body.data.id}/open`, {}, R1.t);
        await api.post(`/api/news/editions/${e1.body.data.id}/open`, {}, R2.t);
        const [c1] = await db.select().from(newsEditions).where(eq(newsEditions.id, e1.body.data.id));
        check('each reader counts once', c1.reads === 2);
        check('…and the feed marks it read', (await api.get('/api/news/feed', R1.t)).body?.data?.[0]?.read === true);

        // ── a shared link ──
        const sh = await api.get(`/api/public/news/e/${tok1}`);
        const raw = JSON.stringify(sh.body);
        check('a shared link shows the paper, the date and the preview', sh.status === 200 && sh.body.data.available && sh.body.data.previewUrl && sh.body.data.paperCode === paperP.bp.partnerCode);
        check('…and never the PDF or where it is stored', !/fileKey|local:|cld:|\.pdf|\/api\/public\/news\/file/.test(raw));
        await api.get(`/api/public/news/e/${tok1}`);
        const [c2] = await db.select().from(newsEditions).where(eq(newsEditions.id, e1.body.data.id));
        check('link views are counted', c2.linkViews === 2);
        const pv = await fetch(`${base}/api/public/news/e/${tok1}/preview`);
        check('the preview image is served for chat previews (without counting a view)', pv.status === 200 && /^image\//.test(pv.headers.get('content-type') ?? '') && (await db.select().from(newsEditions).where(eq(newsEditions.id, e1.body.data.id)))[0].linkViews === 2);
        check('the app resolves a shared link to the edition', (await api.get(`/api/news/e/${tok1}`, R2.t)).body?.data?.id === e1.body.data.id);
        check('a made-up link is not found', (await api.get('/api/public/news/e/notARealToken123')).status === 404);
        const pp = await api.get(`/api/public/news/p/${paperP.bp.partnerCode}`);
        check('the paper\'s public follow page', pp.status === 200 && pp.body.data.name.includes('Tattvanishtha') && pp.body.data.editions.length === 1);
        const og = await fetch(`${base}/news/e/${tok1}`);
        const ogHtml = og.status === 200 ? await og.text() : '';
        check('the shared page carries its title and preview for WhatsApp', !ogHtml || (/og:title" content="ತತ್ತ್ವನಿಷ್ಠ Tattvanishtha — /.test(ogHtml) && ogHtml.includes(`/api/public/news/e/${tok1}/preview`)));

        // ── notifications: once per paper per day ──
        const e2 = await api.upload('/api/hub/news/editions', edition({ editionDate: today, title: 'Sirsi edition', pageCount: '4' }), T);
        check('a second edition the same day (a city edition)', e2.status === 201 && /followers have been told/.test(e2.body.message));
        await new Promise(r => setTimeout(r, 400));
        const e3 = await api.upload('/api/hub/news/editions', edition({ editionDate: today, title: 'Ankola edition' }), T);
        await new Promise(r => setTimeout(r, 400));
        const ns = await db.select().from(notifications).where(and(eq(notifications.userId, R1.u.id), eq(notifications.type, 'news_edition')));
        check('followers are notified once that day, not per edition', ns.length === 1 && (ns[0].data as any)?.editionId === e2.body.data.id, `${ns.length}`);
        check('non-followers are not', !(await db.select().from(notifications).where(and(eq(notifications.userId, R2.u.id), eq(notifications.type, 'news_edition')))).length);

        // ── archive plans ──
        check('only 1, 3 or 6 months', (await api.post('/api/hub/news/plans', { months: 2 }, T)).body?.code === 'BAD_PLAN');
        const b1 = await api.post('/api/hub/news/plans', { months: 1 }, T);
        check('buying a month (test mode: activated without a gateway)', b1.status === 201 && b1.body.data.devActivated);
        const [pl1] = await db.select().from(newsArchivePlans).where(eq(newsArchivePlans.id, b1.body.data.planId));
        const [pp1] = await db.select().from(newsPapers).where(eq(newsPapers.id, paperId));
        const days1 = (pl1.endsAt!.getTime() - pl1.startsAt!.getTime()) / 86_400_000;
        check('the archive runs one calendar month from now', pl1.status === 'paid' && days1 >= 28 && days1 <= 31 && pp1.archiveUntil!.getTime() === pl1.endsAt!.getTime());
        const [doc] = await db.select().from(taxDocuments).where(eq(taxDocuments.id, pl1.invoiceDocumentId!));
        const lines = await db.select().from(taxDocumentLines).where(eq(taxDocumentLines.documentId, doc.id));
        check('UniteFix invoices it: ₹129 + 18% GST, SAC 998315', doc.issuer === 'unitefix' && doc.recipientPartnerId === paperP.bp.id && doc.purpose === 'news_archive' && doc.totalPaise === 15222
            && lines[0]?.hsnSac === '998315', JSON.stringify({ t: doc.totalPaise, sac: lines[0]?.hsnSac }));
        const st1 = await api.get('/api/hub/news', T);
        check('the paper now keeps 30 days', st1.body?.data?.keepsDays === 30 && !!st1.body.data.archiveUntil);
        check('…so an edition from last week can be uploaded', (await api.upload('/api/hub/news/editions', edition({ editionDate: add(today, -8) }), T)).status === 201);
        const b3 = await api.post('/api/hub/news/plans', { months: 3 }, T);
        const [pl3] = await db.select().from(newsArchivePlans).where(eq(newsArchivePlans.id, b3.body.data.planId));
        check('buying 3 more months adds on after the current plan', pl3.startsAt!.getTime() === pl1.endsAt!.getTime() && pl3.amountPaise === 24900 && pl3.gstPaise === 4482);
        const again = await NewsService.applyPayment({ planId: pl3.id, paymentId: 'pay_again' });
        const docs3 = await db.select().from(taxDocuments).where(and(eq(taxDocuments.recipientPartnerId, paperP.bp.id), eq(taxDocuments.purpose, 'news_archive')));
        check('a payment applied twice (callback and webhook) counts once', again.razorpayPaymentId !== 'pay_again' && docs3.length === 2);
        check('a back-dated edition does not notify followers', (await db.select().from(notifications).where(and(eq(notifications.userId, R1.u.id), eq(notifications.type, 'news_edition')))).length === 1);
        check('the plan history', (await api.get('/api/hub/news/plans', T)).body?.data?.length === 2);

        // Paid online: the page's callback is checked against Razorpay's signature; the webhook finds it by order id.
        process.env.RAZORPAY_KEY_SECRET = `qa_secret_${stamp}`;
        const [pending] = await db.insert(newsArchivePlans).values({ paperId, months: 6, amountPaise: 39900, gstPaise: 7182, razorpayOrderId: `order_qa_${stamp}` }).returning();
        check('a forged payment callback is refused', (await api.post(`/api/hub/news/plans/${pending.id}/confirm`, { razorpay_order_id: `order_qa_${stamp}`, razorpay_payment_id: 'pay_x', razorpay_signature: 'nope' }, T)).body?.code === 'BAD_SIGNATURE');
        const sig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`order_qa_${stamp}|pay_qa_${stamp}`).digest('hex');
        const cf = await api.post(`/api/hub/news/plans/${pending.id}/confirm`, { razorpay_order_id: `order_qa_${stamp}`, razorpay_payment_id: `pay_qa_${stamp}`, razorpay_signature: sig }, T);
        check('a genuine callback activates the plan', cf.status === 200);
        const viaHook = await NewsService.applyPayment({ orderId: `order_qa_${stamp}`, paymentId: `pay_qa_${stamp}` });
        check('…and the webhook arriving after it changes nothing', viaHook.id === pending.id && viaHook.status === 'paid');
        delete process.env.RAZORPAY_KEY_SECRET;
        check('staff see paid plans', (await api.get('/api/admin/hub/news/plans', st)).body?.data?.some((r: any) => r.plan.id === pending.id));

        // ── the clean-up job ──
        const [ed8] = await db.select().from(newsEditions).where(and(eq(newsEditions.paperId, paperId), eq(newsEditions.editionDate, add(today, -8))));
        await db.update(newsEditions).set({ editionDate: add(today, -31) }).where(eq(newsEditions.id, ed8.id));
        const keyOld = ed8.fileKey!;
        await NewsService.tick();
        const [ed8b] = await db.select().from(newsEditions).where(eq(newsEditions.id, ed8.id));
        check('editions older than 30 days are removed, file and all', ed8b.status === 'expired' && ed8b.fileKey === null && !fs.existsSync(`.data/news/${keyOld.slice(6)}`));
        const [e1now] = await db.select().from(newsEditions).where(eq(newsEditions.id, e1.body.data.id));
        check('…today\'s stay', e1now.status === 'live' && !!e1now.fileKey);

        // The archive ends: back to 3 days.
        await db.update(newsEditions).set({ editionDate: add(today, -5) }).where(eq(newsEditions.id, e3.body.data.id));
        await db.update(newsPapers).set({ archiveUntil: new Date(Date.now() + 2 * 86_400_000), planRemindedFor: null }).where(eq(newsPapers.id, paperId));
        await NewsService.tick(); await NewsService.tick();
        const rem = await db.select().from(hubAlerts).where(and(eq(hubAlerts.businessPartnerId, paperP.bp.id), eq(hubAlerts.kind, 'news_plan')));
        check('the paper is warned once, 3 days before the archive ends', rem.length === 1, `${rem.length}`);
        check('…while the plan runs, a 5-day-old edition stays', (await db.select().from(newsEditions).where(eq(newsEditions.id, e3.body.data.id)))[0].status === 'live');
        await db.update(newsPapers).set({ archiveUntil: new Date(Date.now() - 60_000) }).where(eq(newsPapers.id, paperId));
        await NewsService.tick();
        check('once it has ended, editions older than 3 days go', (await db.select().from(newsEditions).where(eq(newsEditions.id, e3.body.data.id)))[0].status === 'expired');
        check('a reader opening a removed edition is told it is gone', (await api.post(`/api/news/editions/${e3.body.data.id}/open`, {}, R1.t)).status === 410);
        const sh3 = await api.get(`/api/public/news/e/${e3.body.data.publicToken}`);
        check('its shared link still shows the paper, marked no longer available', sh3.status === 200 && sh3.body.data.available === false);

        // ── staff ──
        check('a takedown needs a reason', (await api.post(`/api/admin/hub/news/editions/${e2.body.data.id}/takedown`, { reason: ' ' }, st)).body?.code === 'NO_REASON');
        const td = await api.post(`/api/admin/hub/news/editions/${e2.body.data.id}/takedown`, { reason: 'A court order covers the story on page 3.' }, st);
        const [e2b] = await db.select().from(newsEditions).where(eq(newsEditions.id, e2.body.data.id));
        check('staff take an edition down; the file is deleted', td.status === 200 && e2b.status === 'removed' && !e2b.fileKey && /court order/.test(e2b.removedReason ?? ''));
        check('readers can no longer open it', (await api.post(`/api/news/editions/${e2.body.data.id}/open`, {}, R1.t)).status === 410);
        check('pausing needs a note', (await api.post(`/api/admin/hub/news/papers/${paperId}/review`, { decision: 'pause' }, st)).body?.code === 'NO_NOTE');
        await api.post(`/api/admin/hub/news/papers/${paperId}/review`, { decision: 'pause', note: 'Please send your PRGI registration.' }, st);
        check('a paused paper disappears for readers', !(await api.get('/api/news/papers', R1.t)).body?.data?.papers?.some((p: any) => p.id === paperId) && (await api.get(`/api/news/papers/${paperId}`, R1.t)).status === 404);
        check('…and cannot publish', (await api.upload('/api/hub/news/editions', edition({ editionDate: today, title: 'Late edition' }), T)).body?.code === 'PAUSED');
        check('staff resume it', (await api.post(`/api/admin/hub/news/papers/${paperId}/review`, { decision: 'resume' }, st)).body?.data?.status === 'live');

        await db.update(businessPartners).set({ status: 'paused' }).where(eq(businessPartners.id, paperP.bp.id));
        check('a paper whose business UniteFix paused is hidden from readers too', !(await api.get('/api/news/papers', R1.t)).body?.data?.papers?.some((p: any) => p.id === paperId) && (await api.get(`/api/public/news/e/${tok1}`)).status === 404);
        await db.update(businessPartners).set({ status: 'active' }).where(eq(businessPartners.id, paperP.bp.id));

        // ── the paper removes its own edition; a reader unfollows ──
        const k1 = e1now.fileKey!;
        check('the paper removes an edition (to upload a corrected one)', (await api.del(`/api/hub/news/editions/${e1.body.data.id}`, T)).status === 200 && !fs.existsSync(`.data/news/${k1.slice(6)}`));
        check('…then the corrected one goes up', (await api.upload('/api/hub/news/editions', edition({ editionDate: today }), T)).status === 201);
        check('another paper\'s edition cannot be removed', (await api.del(`/api/hub/news/editions/${e1.body.data.id}`, other.t)).status === 403);
        check('unfollow', (await api.post(`/api/news/papers/${paperId}/follow`, { on: false }, R1.t)).body?.data?.following === false && (await api.get('/api/news/feed', R1.t)).body?.data?.length === 0);
    } finally {
        await close();
    }
}

main().catch(e => { console.error(e); check('no crash', false, e?.message); }).finally(async () => {
    try {
        if (bpIds.length) {
            const papers = await db.select({ id: newsPapers.id }).from(newsPapers).where(inArray(newsPapers.businessPartnerId, bpIds));
            if (papers.length) {
                const left = await db.select({ k: newsEditions.fileKey }).from(newsEditions).where(inArray(newsEditions.paperId, papers.map(p => p.id)));
                const { NewsStorage } = await import('../server/lib/news-storage');
                for (const l of left) await NewsStorage.remove(l.k);
            }
        }
    } catch (e) { console.error('file cleanup', e); }
    const uids = userIds.join(',') || '0';
    await cleanupPartners(bpIds, adminIds, [
        `DELETE FROM notifications WHERE user_id IN (${uids})`,
        `DELETE FROM news_reads WHERE user_id IN (${uids})`,
        `DELETE FROM news_follows WHERE user_id IN (${uids})`,
        `DELETE FROM users WHERE id IN (${uids})`,
    ]);
    process.exit(summary());
});
