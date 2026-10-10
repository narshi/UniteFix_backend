/**
 * Newspapers.
 *
 *   Hub (newsroom module)
 *     GET    /api/hub/news                     paper, readiness, stats, plan, prices
 *     PUT    /api/hub/news/paper               { name, language, city, frequency, description }
 *     POST   /api/hub/news/logo                multipart "file"
 *     POST   /api/hub/news/submit              ask UniteFix to put the paper live
 *     GET    /api/hub/news/editions
 *     POST   /api/hub/news/editions            multipart "file" (PDF) + "preview" (image) + editionDate, title, headline, pageCount
 *     DELETE /api/hub/news/editions/:id
 *     GET    /api/hub/news/plans, POST /api/hub/news/plans { months }, POST /api/hub/news/plans/:id/confirm
 *   App (signed in)
 *     GET    /api/news/papers?language=&q=     live papers, with follows and the latest edition
 *     GET    /api/news/feed                    the latest editions of the papers followed
 *     GET    /api/news/papers/:id              a paper and its editions
 *     POST   /api/news/papers/:id/follow       { on, source }
 *     POST   /api/news/editions/:id/open       counts the read; a signed reader link
 *     GET    /api/news/e/:token                a shared link, resolved to the edition (the app's deep link)
 *   Public
 *     GET    /api/public/news/e/:token         what a shared link shows — never the PDF
 *     GET    /api/public/news/e/:token/preview the preview image (for chat previews)
 *     GET    /api/public/news/p/:code          a paper's public page
 *     GET    /api/public/news/file/:id?exp=&sig=  the PDF, for a signed reader link only
 *   Staff (/api/admin/hub/* → the partners capability)
 *     GET    /api/admin/hub/news/papers, /papers/:id/editions, /plans
 *     POST   /api/admin/hub/news/papers/:id/review { decision, note }
 *     POST   /api/admin/hub/news/editions/:id/takedown { reason }
 *   Pages
 *     /news/e/:token and /news/p/:code get their title and preview image in the
 *     HTML itself, so WhatsApp and others show them when the link is pasted.
 */

import express, { type Express, type Request } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { z } from 'zod';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { authenticateAdmin, authenticateAny } from '../middleware/auth.middleware';
import { HubError } from '../services/partner-hub.service';
import { NewsService, LANGUAGES, FREQUENCIES, MAX_PDF_BYTES, FREE_DAYS, ARCHIVE_DAYS } from '../services/news.service';
import { NewsStorage } from '../lib/news-storage';
import { photoUpload, uploadPhotoFrom } from './celebrations.routes';
import { uploadImageBuffer } from '../services/cloudinary.service';
import logger from '../lib/logger';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};

const editionUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES, files: 2 },
    fileFilter: (_req, file, cb) => {
        if (file.fieldname === 'file') return file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Upload the edition as a PDF.'));
        if (file.fieldname === 'preview') return /^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('The preview must be an image.'));
        cb(new Error('Unexpected file'));
    },
}).fields([{ name: 'file', maxCount: 1 }, { name: 'preview', maxCount: 1 }]);

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const absBase = (req: Request) => (process.env.HUB_BASE_URL || process.env.CLIENT_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The built client's index.html (production); in development Vite serves the page and the tags are skipped. */
function indexHtml(): string | null {
    for (const p of [path.resolve(import.meta.dirname ?? '.', 'public', 'index.html'), path.resolve(process.cwd(), 'dist', 'public', 'index.html')]) {
        try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8'); } catch { /* next */ }
    }
    return null;
}
function withMeta(html: string, m: { title: string; description: string; image?: string | null; url: string }) {
    const tags = [
        `<meta property="og:type" content="article" />`, `<meta property="og:site_name" content="UniteFix" />`,
        `<meta property="og:title" content="${esc(m.title)}" />`, `<meta property="og:description" content="${esc(m.description)}" />`,
        `<meta property="og:url" content="${esc(m.url)}" />`, `<meta name="description" content="${esc(m.description)}" />`,
        m.image ? `<meta property="og:image" content="${esc(m.image)}" />` : '', m.image ? `<meta name="twitter:card" content="summary_large_image" />` : '',
    ].filter(Boolean).join('\n    ');
    return html.replace(/\s*<meta name="description"[^>]*>/, '').replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>\n    ${tags}`);
}

export function registerNewsRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('newsroom');
    const ctxOf = (req: any) => (req as HubRequest).hub!;
    const me = (req: any) => req.user!.userId as number;
    const adminId = (req: any) => req.admin.userId as number;

    // pdf.js's character maps and standard fonts, for the browser reader and the upload preview.
    const pdfjsDir = path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist');
    app.use('/pdfjs/cmaps', express.static(path.join(pdfjsDir, 'cmaps'), { maxAge: '30d', immutable: true }));
    app.use('/pdfjs/standard_fonts', express.static(path.join(pdfjsDir, 'standard_fonts'), { maxAge: '30d', immutable: true }));

    const state = async (bpId: number, code: string) => {
        const paper = await NewsService.paperOf(bpId);
        const [readiness, stats, prices] = await Promise.all([NewsService.readiness(bpId), paper ? NewsService.stats(paper.id) : null, NewsService.prices()]);
        return {
            paper, readiness, stats, prices,
            keepsDays: paper ? NewsService.retentionDays(paper) : FREE_DAYS, freeDays: FREE_DAYS, archiveDays: ARCHIVE_DAYS,
            archiveUntil: paper?.archiveUntil && paper.archiveUntil > new Date() ? paper.archiveUntil : null,
            followUrl: `/news/p/${code}`, languages: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })), frequencies: FREQUENCIES,
            storage: NewsStorage.mode(), maxMb: MAX_PDF_BYTES / 1048576,
        };
    };

    // ── Hub ──
    app.get('/api/hub/news', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/news/paper', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                name: z.string().max(80).optional(), language: z.string().max(20).optional(), city: z.string().max(60).nullable().optional(),
                frequency: z.string().max(20).optional(), description: z.string().max(600).nullable().optional(),
            }), req.body ?? {});
            await NewsService.saveProfile(ctxOf(req), b);
            res.json({ success: true, message: 'Saved.', data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/news/logo', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            await NewsService.requirePaper(ctxOf(req).businessPartnerId);
            const up = await uploadPhotoFrom(req, `news/${ctxOf(req).partnerCode}/logo`, 800);
            const p = await NewsService.setLogo(ctxOf(req), up.url);
            res.json({ success: true, message: 'Masthead updated.', data: { logoUrl: p.logoUrl } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/news/submit', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            await NewsService.submit(ctxOf(req));
            res.json({ success: true, message: 'Sent to UniteFix. We usually review a paper within a working day.', data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/news/editions', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.hubEditions(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/news/editions', active, mod, hubCan('ops:manage'), (req, res, next) => {
        editionUpload(req, res, (err: any) => {
            if (err) {
                const msg = err?.code === 'LIMIT_FILE_SIZE' ? `The PDF is larger than ${MAX_PDF_BYTES / 1048576} MB — export it at a lower image quality.` : err?.message ?? 'Upload failed';
                return res.status(400).json({ success: false, code: 'BAD_UPLOAD', message: msg });
            }
            next();
        });
    }, async (req, res, next) => {
        try {
            const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
            const pdf = files?.file?.[0];
            if (!pdf) throw new HubError('Choose the edition PDF.', 'NO_FILE');
            const b = parse(z.object({
                editionDate: z.string().max(10), title: z.string().max(60).optional(), headline: z.string().max(200).optional(),
                pageCount: z.coerce.number().int().min(1).max(200).optional(),
            }), req.body ?? {});
            const pv = files?.preview?.[0];
            const preview = pv ? async () => {
                try { return (await uploadImageBuffer(pv.buffer, `news/${ctxOf(req).partnerCode}/previews`, { maxWidth: 1400, maxHeight: 1400 })).url; }
                catch (e: any) { logger.warn(`[NEWS] preview upload failed: ${e?.message}`); return null; }
            } : undefined;
            const row = await NewsService.publish(ctxOf(req), { ...b, pdf: pdf.buffer, preview });
            const paper = await NewsService.paperOf(ctxOf(req).businessPartnerId);
            res.status(201).json({
                success: true,
                message: paper?.status === 'live' ? 'Published. Your followers have been told.' : 'Uploaded. Readers will see it once UniteFix puts your paper live.',
                data: row,
            });
        } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/hub/news/editions/:id', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { await NewsService.removeEdition(ctxOf(req), Number(req.params.id)); res.json({ success: true, message: 'Edition removed.' }); } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/news/plans', active, mod, hubCan('money:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.plans(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/news/plans', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ months: z.number().int() }), req.body ?? {});
            const r = await NewsService.startPlan(ctxOf(req), b.months);
            res.status(201).json({ success: true, message: r.devActivated ? 'Plan activated (test mode — no payment taken).' : undefined, data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/news/plans/:id/confirm', active, mod, hubCan('purchases:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() }), req.body ?? {});
            await NewsService.confirmPlan(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: 'Payment received. Your 30-day archive is on.', data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });

    // ── App ──
    app.get('/api/news/papers', authenticateAny, async (req, res, next) => {
        try {
            const papers = await NewsService.papers(me(req), { language: req.query.language ? String(req.query.language) : undefined, q: req.query.q ? String(req.query.q).slice(0, 60) : undefined });
            res.json({ success: true, data: { papers, languages: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/news/feed', authenticateAny, async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.feed(me(req)) }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/news/papers/:id', authenticateAny, async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.paper(me(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/news/papers/:id/follow', authenticateAny, async (req, res, next) => {
        try {
            const b = parse(z.object({ on: z.boolean(), source: z.string().max(10).optional() }), req.body ?? {});
            res.json({ success: true, data: await NewsService.follow(me(req), Number(req.params.id), b.on, b.source) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/news/editions/:id/open', authenticateAny, async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.readLink(me(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/news/e/:token', authenticateAny, async (req, res, next) => {
        try {
            const e = await NewsService.publicEdition(String(req.params.token));
            if (!e) return res.status(404).json({ success: false, message: 'This link is not valid.' });
            res.json({ success: true, data: e });
        } catch (err) { hubError(err, res, next); }
    });

    // ── Public ──
    app.get('/api/public/news/e/:token', async (req, res, next) => {
        try {
            const e = await NewsService.publicEdition(String(req.params.token));
            if (!e) return res.status(404).json({ success: false, message: 'This link is not valid.' });
            res.json({ success: true, data: e });
        } catch (err) { hubError(err, res, next); }
    });
    app.get('/api/public/news/e/:token/preview', async (req, res, next) => {
        try {
            const e = await NewsService.publicEditionQuiet(String(req.params.token));
            if (!e?.previewUrl) return res.status(404).end();
            if (e.previewUrl.startsWith('data:')) {
                const m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(e.previewUrl);
                if (!m) return res.status(404).end();
                res.setHeader('Content-Type', m[1]);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                return res.end(Buffer.from(m[2], 'base64'));
            }
            res.redirect(302, e.previewUrl);
        } catch (err) { next(err); }
    });
    app.get('/api/public/news/p/:code', async (req, res, next) => {
        try {
            const p = await NewsService.publicPaper(String(req.params.code));
            if (!p) return res.status(404).json({ success: false, message: 'This paper is not on UniteFix.' });
            res.json({ success: true, data: { ...p, following: undefined } });
        } catch (err) { hubError(err, res, next); }
    });
    app.get('/api/public/news/file/:id', async (req, res, next) => {
        const id = Number(req.params.id);
        if (!NewsService.verify(id, Number(req.query.exp), String(req.query.sig ?? ''))) return res.status(403).json({ success: false, message: 'This reading link has expired. Open the edition again in the app.' });
        try {
            const f = await NewsService.openFile(id);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline');
            res.setHeader('Cache-Control', 'private, max-age=1800');
            if (f.size) res.setHeader('Content-Length', String(f.size));
            f.stream.on('error', (e) => { logger.warn(`[NEWS] stream failed: ${e.message}`); res.destroy(e); });
            f.stream.pipe(res);
        } catch (err) { hubError(err, res, next); }
    });

    // ── Staff ──
    app.get('/api/admin/hub/news/papers', authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: { papers: await NewsService.adminPapers(), storage: NewsStorage.mode() } }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/news/papers/:id/editions', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await NewsService.adminEditions(Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/news/plans', authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await NewsService.adminPlans() }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/news/papers/:id/review', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ decision: z.enum(['approve', 'changes', 'pause', 'resume']), note: z.string().max(500).nullable().optional() }), req.body ?? {});
            const p = await NewsService.review(adminId(req), Number(req.params.id), b);
            res.json({ success: true, message: { approve: 'The paper is live.', resume: 'The paper is live again.', changes: 'Sent back with your note.', pause: 'Paused — readers no longer see it.' }[b.decision], data: p });
        } catch (e) { hubError(e, res, next); }
    });
    // Staff read an edition to review it — a signed reader link, not counted as a read.
    app.post('/api/admin/hub/news/editions/:id/read', authenticateAdmin, async (req, res) => {
        const id = Number(req.params.id);
        const exp = Math.floor(Date.now() / 1000) + 30 * 60;
        res.json({ success: true, data: { url: `/news/read/${id}?exp=${exp}&sig=${NewsService.sign(id, exp)}` } });
    });
    app.post('/api/admin/hub/news/editions/:id/takedown', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ reason: z.string().max(300) }), req.body ?? {});
            await NewsService.takedown(adminId(req), Number(req.params.id), b.reason);
            res.json({ success: true, message: 'Edition taken down. The paper has been told why.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ── Pages: the link preview a chat app shows ──
    app.get('/news/e/:token', async (req, res, next) => {
        const html = indexHtml();
        if (!html) return next();
        try {
            const e = await NewsService.publicEditionQuiet(String(req.params.token));
            if (!e) return next();
            const base = absBase(req);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(withMeta(html, {
                title: `${e.paper} — ${dayLabel(e.editionDate)}`,
                description: e.headline ?? `Read today's ${e.paper} free on the UniteFix app.`,
                image: e.previewUrl ? `${base}/api/public/news/e/${req.params.token}/preview` : null,
                url: `${base}/news/e/${req.params.token}`,
            }));
        } catch { next(); }
    });
    app.get('/news/p/:code', async (req, res, next) => {
        const html = indexHtml();
        if (!html) return next();
        try {
            const p = await NewsService.publicPaper(String(req.params.code));
            if (!p) return next();
            const base = absBase(req);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(withMeta(html, {
                title: `${p.name} on UniteFix`,
                description: p.description ?? `Follow ${p.name} on the UniteFix app and read every edition free.`,
                image: p.logoUrl && !p.logoUrl.startsWith('data:') ? p.logoUrl : null,
                url: `${base}/news/p/${req.params.code}`,
            }));
        } catch { next(); }
    });
}
