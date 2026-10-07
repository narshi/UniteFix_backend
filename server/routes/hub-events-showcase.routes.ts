/**
 * Events showcase — the partner's public page, and booking from it.
 *
 *   Hub     GET/PUT  /api/hub/events/showcase           page profile (tagline, about, cover, Instagram handle) + what is on it
 *           POST     /api/hub/events/showcase/cover      upload the cover photo
 *           GET/POST /api/hub/events/themes, PATCH /api/hub/events/themes/:id, POST /api/hub/events/themes/:id/photos
 *           GET/POST /api/hub/events/gallery            { kind: instagram, url } or { kind: photo, url }
 *           POST     /api/hub/events/gallery/upload     a photo of past work (multipart "file")
 *           PATCH/DELETE /api/hub/events/gallery/:id, POST /api/hub/events/gallery/order { ids }
 *           POST     /api/hub/events/packages/:id/photos a venue / add-on photo
 *   Public  GET      /api/public/events/:code/showcase   gallery, venues, themes, add-ons
 *           POST     /api/public/events/:code/estimate   price a selection (nothing saved)
 *           POST     /api/public/events/:code/request    send it: enquiry + drafted quotation
 */

import type { Express } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { operatorApplyLimiter, publicLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { PartnerEventsService } from '../services/partner-events.service';
import { EventsShowcaseService } from '../services/events-showcase.service';
import { uploadImageBuffer } from '../services/cloudinary.service';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Upload a JPG, PNG or WebP photo.'))),
});
const selectionSchema = z.object({
    guests: z.number().int().positive().max(100000).optional().nullable(),
    venueId: z.number().int().optional().nullable(),
    themeId: z.number().int().optional().nullable(),
    addons: z.array(z.object({ packageId: z.number().int(), quantity: z.number().int().optional() })).max(40).optional(),
});

export function registerHubEventsShowcaseRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('events');
    const ctxOf = (req: any) => (req as HubRequest).hub!;
    const upload = async (req: any, folder: string) => {
        if (!req.file) throw new HubError('Choose a photo.', 'NO_FILE');
        try { return (await uploadImageBuffer(req.file.buffer, `events/${ctxOf(req).partnerCode}/${folder}`, { maxWidth: 1600, maxHeight: 1600 })).url; }
        catch (e: any) { throw new HubError(`Upload failed: ${e?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502); }
    };

    // ── profile ──
    app.get('/api/hub/events/showcase', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            const [profile, themes, gallery, packages] = await Promise.all([EventsShowcaseService.profile(bpId), EventsShowcaseService.themes(bpId), EventsShowcaseService.gallery(bpId), PartnerEventsService.packages(bpId, true)]);
            res.json({
                success: true, data: {
                    profile, pageUrl: `/events/${ctxOf(req).partnerCode}`,
                    counts: { photos: gallery.filter(g => g.kind === 'photo').length, instagram: gallery.filter(g => g.kind === 'instagram').length, themes: themes.filter(t => t.isActive).length, venues: packages.filter(p => p.category === 'venue' && p.showOnPage).length, addons: packages.filter(p => p.category !== 'venue' && p.showOnPage).length },
                },
            });
        } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/events/showcase', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ tagline: z.string().max(200).optional().nullable(), about: z.string().max(2000).optional().nullable(), coverPhoto: z.string().max(2_600_000).optional().nullable(), instagram: z.string().max(120).optional().nullable() }), req.body ?? {});
            res.json({ success: true, message: 'Saved.', data: await EventsShowcaseService.saveProfile(ctxOf(req), b) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/showcase/cover', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Cover photo updated.', data: await EventsShowcaseService.saveProfile(ctxOf(req), { coverPhoto: await upload(req, 'cover') }) }); } catch (e) { hubError(e, res, next); }
    });

    // ── themes ──
    const themeSchema = z.object({
        name: z.string().max(120).optional(), description: z.string().max(1000).optional().nullable(), suitableFor: z.string().max(200).optional().nullable(),
        photos: z.array(z.string().max(2_600_000)).max(8).optional(), priceRupees: z.coerce.number().min(0).max(1e8).optional(), gstRate: z.coerce.number().optional(),
        isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
    });
    app.get('/api/hub/events/themes', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await EventsShowcaseService.themes(ctxOf(req).businessPartnerId)).map(t => EventsShowcaseService.themeView(t)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/themes', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Theme added.', data: EventsShowcaseService.themeView(await EventsShowcaseService.saveTheme(ctxOf(req), null, parse(themeSchema, req.body))) }); } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/themes/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Saved.', data: EventsShowcaseService.themeView(await EventsShowcaseService.saveTheme(ctxOf(req), Number(req.params.id), parse(themeSchema, req.body))) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/themes/:id/photos', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Photo added.', data: EventsShowcaseService.themeView(await EventsShowcaseService.addThemePhoto(ctxOf(req), Number(req.params.id), await upload(req, 'themes'))) }); } catch (e) { hubError(e, res, next); }
    });

    // ── gallery ──
    app.get('/api/hub/events/gallery', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: (await EventsShowcaseService.gallery(ctxOf(req).businessPartnerId)).map(g => EventsShowcaseService.galleryView(g)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/gallery', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ kind: z.enum(['photo', 'instagram']), url: z.string().min(8).max(2_600_000), caption: z.string().max(300).optional().nullable(), themeId: z.number().int().optional().nullable() }), req.body ?? {});
            res.status(201).json({ success: true, message: b.kind === 'instagram' ? 'Instagram post added.' : 'Photo added.', data: EventsShowcaseService.galleryView(await EventsShowcaseService.addToGallery(ctxOf(req), b)) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/gallery/upload', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const url = await upload(req, 'gallery');
            const themeId = req.body?.themeId ? Number(req.body.themeId) : null;
            res.status(201).json({ success: true, message: 'Photo added.', data: EventsShowcaseService.galleryView(await EventsShowcaseService.addToGallery(ctxOf(req), { kind: 'photo', url, caption: req.body?.caption ?? null, themeId })) });
        } catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/events/gallery/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ caption: z.string().max(300).optional().nullable(), themeId: z.number().int().optional().nullable() }), req.body ?? {});
            res.json({ success: true, message: 'Saved.', data: EventsShowcaseService.galleryView(await EventsShowcaseService.updateGalleryItem(ctxOf(req), Number(req.params.id), b)) });
        } catch (e) { hubError(e, res, next); }
    });
    app.delete('/api/hub/events/gallery/:id', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { await EventsShowcaseService.removeFromGallery(ctxOf(req), Number(req.params.id)); res.json({ success: true, message: 'Removed.' }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/gallery/order', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).max(100) }), req.body ?? {});
            res.json({ success: true, data: (await EventsShowcaseService.reorderGallery(ctxOf(req), b.ids)).map(g => EventsShowcaseService.galleryView(g)) });
        } catch (e) { hubError(e, res, next); }
    });

    // ── package photos (venues, add-ons) ──
    app.post('/api/hub/events/packages/:id/photos', active, mod, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            const p = (await PartnerEventsService.packages(bpId)).find(x => x.id === Number(req.params.id));
            if (!p) throw new HubError('Package not found', 'NOT_FOUND', 404);
            if ((p.photos ?? []).length >= 8) throw new HubError('Up to 8 photos.', 'TOO_MANY');
            const url = await upload(req, 'packages');
            const u = await PartnerEventsService.savePackage(ctxOf(req), p.id, { photos: [...(p.photos ?? []), url] });
            res.json({ success: true, message: 'Photo added.', data: { id: u.id, photos: u.photos ?? [] } });
        } catch (e) { hubError(e, res, next); }
    });

    // ── public ──
    app.get('/api/public/events/:code/showcase', async (req, res, next) => {
        try {
            const bp = await PartnerEventsService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: await EventsShowcaseService.publicShowcase(bp) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/events/:code/estimate', publicLimiter, async (req, res, next) => {
        try {
            const bp = await PartnerEventsService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const p = await EventsShowcaseService.price(bp.id, parse(selectionSchema, req.body ?? {}));
            res.json({ success: true, data: { items: p.picked, ...p.estimate } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/events/:code/request', operatorApplyLimiter, async (req, res, next) => {
        try {
            const bp = await PartnerEventsService.publicPartner(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(selectionSchema.extend({
                name: z.string().trim().min(2, 'Your name, please').max(120), phone: z.string().max(20), email: z.string().email().max(160).optional().nullable(),
                eventType: z.string().trim().min(2, 'What is the occasion?').max(80), eventDate: z.string().optional().nullable(), ownVenue: z.string().max(200).optional().nullable(),
                customization: z.string().max(1000).optional().nullable(),
            }), req.body ?? {});
            const r = await EventsShowcaseService.request(bp, b);
            res.status(201).json({
                success: true, message: `${bp.displayName} will confirm the date and send your quotation.`,
                data: { link: `/events/e/${r.enquiry.publicToken}`, estimate: r.estimate },
            });
        } catch (e) { hubError(e, res, next); }
    });
}
