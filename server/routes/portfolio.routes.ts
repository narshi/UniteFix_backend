/**
 * Photographers — the portfolio in the Hub and on the public page.
 *
 *   Hub (portfolio module)
 *     GET    /api/hub/portfolio                    profile, albums, listing status, readiness
 *     PUT    /api/hub/portfolio/profile
 *     POST   /api/hub/portfolio/cover              cover photo (multipart "file")
 *     POST   /api/hub/portfolio/albums, PATCH/DELETE /api/hub/portfolio/albums/:id
 *     GET    /api/hub/portfolio/albums/:id/media
 *     POST   /api/hub/portfolio/albums/:id/photos  a photo (multipart "file", "caption")
 *     POST   /api/hub/portfolio/albums/:id/clips   a short clip, ≤ 60 s (multipart "file")
 *     POST   /api/hub/portfolio/albums/:id/films   { url } — YouTube / Vimeo / Instagram
 *     POST   /api/hub/portfolio/albums/:id/order   { ids }
 *     PATCH/DELETE /api/hub/portfolio/media/:id    { caption, featured, albumId }
 *     GET    /api/hub/portfolio/calendar?month=    crews' dates; POST /calendar/block, /calendar/unblock
 *     GET    /api/hub/portfolio/preview, POST /api/hub/portfolio/listing/submit
 *   Public (only when the listing is live)
 *     GET    /api/public/photographers/:code, /albums/:id, /availability?month=
 *     POST   /api/public/photographers/:code/estimate, /request
 */

import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { businessPartners } from '@shared/schema';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { celebrationsSubmitLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { PortfolioService } from '../services/portfolio.service';
import { ListingService } from '../services/listings.service';
import { CelebrationBookings } from '../services/celebration-bookings.service';
import { BookingCalendar, addDays, isDay, partsOf } from '../services/booking-calendar.service';
import { uploadVideoBuffer, deleteVideo, VideoStorageUnavailable } from '../services/cloudinary.service';
import { photoUpload, uploadPhotoFrom, contactSchema } from './celebrations.routes';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};
const clipUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 60 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => (/^video\/(mp4|quicktime|webm|x-m4v)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Upload an MP4, MOV or WebM clip.'))),
});
const slot = z.enum(['am', 'pm', 'full']);
const pick = z.object({
    packageId: z.number().int(), days: z.number().int().min(1).max(7).optional(), hours: z.number().int().min(1).max(24).optional(),
    addons: z.array(z.object({ packageId: z.number().int(), quantity: z.number().int().optional() })).max(20).optional(),
});

export function registerPortfolioRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('portfolio');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    const state = async (bpId: number, code: string) => {
        const [profile, albums, listing, readiness] = await Promise.all([PortfolioService.profile(bpId), PortfolioService.albums(bpId), ListingService.get(bpId, 'portfolio'), PortfolioService.readiness(bpId)]);
        const clips = (await PortfolioService.media(bpId)).filter(m => m.kind === 'video').map(m => PortfolioService.mediaView(m));
        return { profile, albums: albums.map(a => PortfolioService.albumView(a)), clips, listing: ListingService.view(listing, 'portfolio'), readiness, pageUrl: `/photographers/${code}`, commissionPercent: await ListingService.commissionPercent(bpId, 'portfolio') };
    };

    app.get('/api/hub/portfolio', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/portfolio/profile', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({
                tagline: z.string().max(200).nullable().optional(), about: z.string().max(2000).nullable().optional(), coverVideoId: z.number().int().nullable().optional(),
                styles: z.array(z.string().max(40)).max(12).optional(), travelAreas: z.array(z.string().max(60)).max(20).optional(), languages: z.array(z.string().max(30)).max(8).optional(),
                since: z.number().int().nullable().optional(), instagram: z.string().max(100).nullable().optional(), youtube: z.string().max(300).nullable().optional(),
                crews: z.number().int().optional(), deliveryDays: z.number().int().nullable().optional(), holdHours: z.number().optional(), advancePercent: z.number().optional(), balanceDueDays: z.number().optional(),
                cancellation: z.array(z.object({ daysBefore: z.number(), refundPercent: z.number() })).max(6).optional(),
            }), req.body ?? {});
            await PortfolioService.saveProfile(ctxOf(req), b);
            res.json({ success: true, message: 'Saved.', data: await state(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/cover', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const up = await uploadPhotoFrom(req, `portfolio/${ctxOf(req).partnerCode}/cover`, 2400);
            const p = await PortfolioService.saveProfile(ctxOf(req), { coverPhoto: up.url });
            res.json({ success: true, message: 'Cover photo updated.', data: { coverPhoto: p.coverPhoto } });
        } catch (e) { hubError(e, res, next); }
    });

    // ── albums ──
    const albumSchema = z.object({ title: z.string().max(100).optional(), story: z.string().max(3000).nullable().optional(), location: z.string().max(100).nullable().optional(), eventDate: z.string().max(10).nullable().optional(), category: z.string().max(20).optional(), coverUrl: z.string().nullable().optional(), isPublished: z.boolean().optional(), sortOrder: z.number().int().optional() });
    app.post('/api/hub/portfolio/albums', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { const a = await PortfolioService.saveAlbum(ctxOf(req), null, parse(albumSchema, req.body ?? {})); res.status(201).json({ success: true, message: 'Album created — now add photos.', data: PortfolioService.albumView(a) }); }
        catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/portfolio/albums/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { const a = await PortfolioService.saveAlbum(ctxOf(req), Number(req.params.id), parse(albumSchema, req.body ?? {})); res.json({ success: true, message: 'Saved.', data: PortfolioService.albumView(a) }); }
        catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/hub/portfolio/albums/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const media = await PortfolioService.deleteAlbum(ctxOf(req), Number(req.params.id));
            for (const m of media) if (m.kind === 'video' && m.url.includes('res.cloudinary.com')) { const id = m.url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i)?.[1]; if (id) void deleteVideo(id); }
            res.json({ success: true, message: 'Album deleted.' });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/portfolio/albums/:id/media', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const a = await PortfolioService.album(ctxOf(req).businessPartnerId, Number(req.params.id));
            res.json({ success: true, data: { album: PortfolioService.albumView(a as any), media: (await PortfolioService.media(ctxOf(req).businessPartnerId, a.id)).map(m => PortfolioService.mediaView(m)) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/albums/:id/photos', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const albumId = Number(req.params.id);
            await PortfolioService.album(ctxOf(req).businessPartnerId, albumId);
            const up = await uploadPhotoFrom(req, `portfolio/${ctxOf(req).partnerCode}/albums`, 2400);
            const m = await PortfolioService.addMedia(ctxOf(req), { albumId, kind: 'photo', url: up.url, width: up.width ?? null, height: up.height ?? null, caption: (req.body?.caption as string) ?? null });
            res.status(201).json({ success: true, data: PortfolioService.mediaView(m) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/albums/:id/clips', active, mod, hubCan('settings:manage'), clipUpload.single('file'), async (req, res, next) => {
        try {
            const albumId = Number(req.params.id);
            await PortfolioService.album(ctxOf(req).businessPartnerId, albumId);
            if (!req.file) throw new HubError('Choose a clip.', 'NO_FILE');
            let up;
            try { up = await uploadVideoBuffer(req.file.buffer, `portfolio/${ctxOf(req).partnerCode}/clips`); }
            catch (e: any) {
                if (e instanceof VideoStorageUnavailable) throw new HubError('Clips cannot be uploaded right now. Add the film as a YouTube, Vimeo or Instagram link instead.', 'NO_VIDEO_STORAGE', 503);
                throw new HubError(`Upload failed: ${e?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502);
            }
            if (up.durationSec != null && up.durationSec > 65) {
                void deleteVideo(up.publicId);
                throw new HubError(`That clip is ${up.durationSec} seconds. Upload clips up to a minute — put longer films on YouTube or Vimeo and add the link.`, 'TOO_LONG');
            }
            const m = await PortfolioService.addMedia(ctxOf(req), { albumId, kind: 'video', url: up.url, thumbUrl: up.posterUrl, width: up.width ?? null, height: up.height ?? null, durationSec: up.durationSec, caption: (req.body?.caption as string) ?? null });
            res.status(201).json({ success: true, data: PortfolioService.mediaView(m) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/albums/:id/films', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ url: z.string().max(500), caption: z.string().max(200).nullable().optional() }), req.body ?? {});
            const m = await PortfolioService.addMedia(ctxOf(req), { albumId: Number(req.params.id), kind: 'embed', url: b.url, caption: b.caption ?? null });
            res.status(201).json({ success: true, message: 'Film added.', data: PortfolioService.mediaView(m) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/albums/:id/order', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).max(200) }), req.body ?? {});
            await PortfolioService.album(ctxOf(req).businessPartnerId, Number(req.params.id));
            res.json({ success: true, data: (await PortfolioService.reorder(ctxOf(req), Number(req.params.id), b.ids)).map(m => PortfolioService.mediaView(m)) });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/portfolio/media/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ caption: z.string().max(200).nullable().optional(), featured: z.boolean().optional(), albumId: z.number().int().optional() }), req.body ?? {});
            res.json({ success: true, data: PortfolioService.mediaView(await PortfolioService.updateMedia(ctxOf(req), Number(req.params.id), b)) });
        } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/hub/portfolio/media/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const m = await PortfolioService.removeMedia(ctxOf(req), Number(req.params.id));
            if (m?.kind === 'video' && m.url.includes('res.cloudinary.com')) { const id = m.url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i)?.[1]; if (id) void deleteVideo(id); }
            const p = await PortfolioService.profile(ctxOf(req).businessPartnerId);
            if (m && p.coverVideoId === m.id) await PortfolioService.saveProfile(ctxOf(req), { coverVideoId: null });
            res.json({ success: true, message: 'Removed.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ── dates ──
    app.get('/api/hub/portfolio/calendar', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            const month = String(req.query.month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
            const a = await PortfolioService.availability(bpId, month);
            const { rows } = await BookingCalendar.monthMap(bpId, 'crew', month);
            res.json({ success: true, data: { ...a, entries: rows.map(r => ({ id: r.id, crew: r.resourceId, day: r.day, part: r.part, status: r.status, note: r.note, holdExpiresAt: r.holdExpiresAt, bookingId: r.bookingId, enquiryId: r.enquiryId })) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/calendar/block', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ from: z.string(), to: z.string().optional(), slot, crew: z.number().int().min(1).max(10).nullable().optional(), note: z.string().max(200).nullable().optional() }), req.body ?? {});
            const to = b.to || b.from;
            if (!isDay(b.from) || !isDay(to) || to < b.from) throw new HubError('Choose the dates.', 'BAD_DATE');
            const days: string[] = [];
            for (let d = b.from; d <= to && days.length <= 62; d = addDays(d, 1)) days.push(d);
            const p = await PortfolioService.profile(ctxOf(req).businessPartnerId);
            const crews = b.crew ? [b.crew] : Array.from({ length: p.crews }, (_, i) => i + 1);
            let n = 0;
            for (const c of crews) {
                try { n += (await BookingCalendar.block({ bpId: ctxOf(req).businessPartnerId, resourceKind: 'crew', resourceId: c, days, parts: partsOf(b.slot), note: b.note, adminUserId: ctxOf(req).adminUserId })).length; }
                catch (e: any) { if (e?.code !== 'TAKEN') throw e; }
            }
            if (!n) throw new HubError('Those dates are already taken by bookings or holds.', 'TAKEN', 409);
            res.status(201).json({ success: true, message: 'Blocked.', data: { blocked: n } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/calendar/unblock', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).min(1).max(200) }), req.body ?? {});
            const rows = await BookingCalendar.unblock(ctxOf(req).businessPartnerId, b.ids);
            res.json({ success: true, message: 'Unblocked.', data: { released: rows.length } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/portfolio/preview', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, ctxOf(req).businessPartnerId)).limit(1);
            res.json({ success: true, data: { ...(await PortfolioService.publicPage(bp)), preview: true } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/portfolio/listing/submit', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            await ListingService.submit(bpId, 'portfolio', await PortfolioService.readiness(bpId));
            res.json({ success: true, message: 'Sent to UniteFix for review. We check new portfolios within two working days.', data: await state(bpId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Public
    // ══════════════════════════════════════════════════════════════════════

    const live = async (code: string) => {
        const bp = await PortfolioService.publicPartner(code);
        if (!bp || !(await ListingService.isLive(bp.id, 'portfolio'))) return null;
        return bp;
    };
    app.get('/api/public/photographers/:code', async (req, res, next) => {
        try {
            const bp = await live(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: await PortfolioService.publicPage(bp) });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/photographers/:code/albums/:id', async (req, res, next) => {
        try {
            const bp = await live(req.params.code);
            const a = bp ? await PortfolioService.publicAlbum(bp, Number(req.params.id)) : null;
            if (!a) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: a });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/photographers/:code/availability', async (req, res, next) => {
        try {
            const bp = await live(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const month = String(req.query.month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
            const a = await PortfolioService.availability(bp.id, month);
            res.json({ success: true, data: { month: a.month, days: a.days.map(d => ({ day: d.day, closed: d.closed, am: d.am > 0, pm: d.pm > 0 })) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/photographers/:code/estimate', async (req, res, next) => {
        try {
            const bp = await live(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(pick.extend({ date: z.string().max(10).optional(), slot: slot.optional() }), req.body ?? {});
            const p = await PortfolioService.price(bp.id, b);
            let available: boolean | null = null;
            if (b.date && isDay(b.date) && b.slot) {
                const prof = await PortfolioService.profile(bp.id);
                const days = Array.from({ length: b.days ?? 1 }, (_, i) => addDays(b.date!, i));
                available = !!(await PortfolioService.freeCrew(bp.id, days, partsOf(b.slot), prof.crews));
            }
            res.json({ success: true, data: { items: p.picked, available, ...p.estimate } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/photographers/:code/request', celebrationsSubmitLimiter, async (req, res, next) => {
        try {
            const bp = await live(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(pick.merge(contactSchema).extend({
                date: z.string().max(10), slot, occasion: z.string().trim().min(2, 'What is the occasion?').max(80), location: z.string().trim().min(2, 'Where is the shoot?').max(200),
                guests: z.number().int().positive().max(100000).nullable().optional(), notes: z.string().max(1000).nullable().optional(),
            }), req.body ?? {});
            const r = await PortfolioService.request(bp, b as any);
            res.status(201).json({ success: true, message: `${bp.displayName} has your date held and will send your quotation.`, data: { link: CelebrationBookings.customerLink(r.enquiry.publicToken), heldUntil: r.heldUntil, estimate: r.estimate } });
        } catch (e) { hubError(e, res, next); }
    });
}
