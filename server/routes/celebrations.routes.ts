/**
 * Celebrations — halls, the client's booking page, reviews, and the staff
 * review of public listings.
 *
 *   Hub (venue module)
 *     GET    /api/hub/venue                         profile, spaces, listing status, readiness
 *     PUT    /api/hub/venue/profile                 page and policies
 *     POST   /api/hub/venue/cover                   cover photo (multipart "file")
 *     POST   /api/hub/venue/spaces, PATCH /api/hub/venue/spaces/:id, POST /api/hub/venue/spaces/:id/photos
 *     GET    /api/hub/venue/calendar?month=YYYY-MM
 *     POST   /api/hub/venue/calendar/block          { spaceId, from, to, slot, note }
 *     POST   /api/hub/venue/calendar/unblock        { ids }
 *     GET    /api/hub/venue/requests                confirm-first requests waiting for an answer
 *     POST   /api/hub/venue/requests/:id/answer     { decision: accept | decline, reason }
 *     POST   /api/hub/venue/bookings/:id/deposit    { status, note } — the hall's own record of the deposit
 *     GET    /api/hub/venue/preview                 the public page, before it is live
 *     POST   /api/hub/venue/listing/submit
 *   Hub (venue, portfolio or events)
 *     GET    /api/hub/reviews, POST /api/hub/reviews/:id/reply
 *   Public
 *     GET    /api/public/halls/:code                page (only when the listing is live)
 *     GET    /api/public/halls/:code/availability?spaceId=&month=
 *     POST   /api/public/halls/:code/estimate
 *     POST   /api/public/halls/:code/request
 *     GET    /api/public/celebrations/b/:token      the client's booking page
 *     POST   /api/public/celebrations/b/:token/cancel, /review
 *   Search and plans (Celebrations)
 *     GET    /api/public/celebrations/search?type=halls|photographers|planners&city=&pincode=&date=&slot=&guests=&maxPrice=&amenities=&style=&veg=&sort=
 *     GET    /api/public/celebrations/cities
 *     POST   /api/public/celebrations/plan        one client, several partners, one date (POST /api/celebrations/plan from the app)
 *     GET    /api/public/celebrations/plan/:token
 *   Hub (events)  GET /api/hub/events/listing, POST /api/hub/events/listing/submit — planners in Celebrations search
 *   Staff (/api/admin/hub/* → the partners capability)
 *     GET    /api/admin/hub/celebrations/listings?status=&kind=
 *     GET    /api/admin/hub/celebrations/listings/:bpId/:kind/preview
 *     POST   /api/admin/hub/celebrations/listings/:bpId/:kind/review | /feature | /commission
 *     GET    /api/admin/hub/celebrations/bookings, /reviews; POST /reviews/:id
 */

import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../db';
import { and, eq } from 'drizzle-orm';
import { eventBookings, businessPartners } from '@shared/schema';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { celebrationsSubmitLimiter } from '../middleware/rate-limit';
import { HubError } from '../services/partner-hub.service';
import { VenueService } from '../services/venue.service';
import { ListingService, LISTING_KINDS, type ListingKind } from '../services/listings.service';
import { CelebrationBookings } from '../services/celebration-bookings.service';
import { BookingCalendar, addDays, isDay, partsOf } from '../services/booking-calendar.service';
import { uploadImageBuffer } from '../services/cloudinary.service';
import { recordAudit } from '../lib/audit';
import { authenticateToken } from '../middleware/auth.middleware';
import { CelebrationsSearch } from '../services/celebrations-search.service';
import { CelebrationPlan } from '../services/celebration-plan.service';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};
export const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => (/^image\/(jpeg|png|webp)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Upload a JPG, PNG or WebP photo.'))),
});
export async function uploadPhotoFrom(req: any, folder: string, max = 2000) {
    if (!req.file) throw new HubError('Choose a photo.', 'NO_FILE');
    try { return await uploadImageBuffer(req.file.buffer, folder, { maxWidth: max, maxHeight: max }); }
    catch (e: any) { throw new HubError(`Upload failed: ${e?.message ?? 'storage unavailable'}`, 'UPLOAD_FAILED', 502); }
}
/** The business has any one of these modules. */
export const hubAnyModule = (mods: string[]) => (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as HubRequest).hub!;
    if (mods.some(m => (ctx.modules as string[]).includes(m))) return next();
    res.status(403).json({ success: false, code: 'MODULE_OFF', message: 'This module is not switched on for your business.' });
};

const slot = z.enum(['am', 'pm', 'full']);
const rates = z.record(z.enum(['weekday', 'weekend', 'peak']), z.record(slot, z.number().nullable())).optional();
const spaceSchema = z.object({
    name: z.string().max(80).optional(), kind: z.string().max(20).optional(), description: z.string().max(1000).nullable().optional(),
    seated: z.number().int().nullable().optional(), floating: z.number().int().nullable().optional(), areaSqft: z.number().nullable().optional(),
    photos: z.array(z.string()).max(12).optional(), videoUrl: z.string().max(500).nullable().optional(), features: z.array(z.string().max(60)).max(20).optional(),
    included: z.string().max(600).nullable().optional(), ratesRupees: rates, gstRate: z.number().optional(), sac: z.string().max(8).optional(),
    isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
});
const profileSchema = z.object({
    tagline: z.string().max(200).nullable().optional(), about: z.string().max(2000).nullable().optional(), address: z.string().max(300).nullable().optional(),
    mapUrl: z.string().max(500).nullable().optional(), coverPhoto: z.string().nullable().optional(), videoUrl: z.string().max(500).nullable().optional(),
    amenities: z.array(z.string().max(40)).max(40).optional(), rooms: z.number().int().nullable().optional(), parking: z.number().int().nullable().optional(),
    catering: z.enum(['in_house', 'outside', 'both']).nullable().optional(),
    rules: z.object({ vegOnly: z.boolean().optional(), alcohol: z.enum(['no', 'allowed', 'licensed']).optional(), outsideCaterers: z.boolean().optional(), outsideDecorators: z.boolean().optional(), musicUntil: z.string().max(5).nullable().optional(), notes: z.string().max(600).nullable().optional() }).optional(),
    slots: z.object({ am: z.object({ from: z.string(), to: z.string() }), pm: z.object({ from: z.string(), to: z.string() }) }).optional(),
    weekendDays: z.array(z.number().int()).max(7).optional(),
    peakDates: z.array(z.object({ date: z.string(), label: z.string().max(60).nullable().optional() })).max(400).optional(),
    advancePercent: z.number().optional(), balanceDueDays: z.number().optional(), depositRupees: z.number().optional(),
    cancellation: z.array(z.object({ daysBefore: z.number(), refundPercent: z.number() })).max(6).optional(),
    instantBooking: z.boolean().optional(), holdHours: z.number().optional(),
});
const hallPick = z.object({
    spaceId: z.number().int(), date: z.string().max(10), slot, guests: z.number().int().positive().max(100000).nullable().optional(),
    addons: z.array(z.object({ packageId: z.number().int(), quantity: z.number().int().optional() })).max(30).optional(),
});
export const contactSchema = z.object({
    name: z.string().trim().min(2, 'Your name, please').max(120), phone: z.string().max(20), email: z.string().email('That email does not look right').max(160).optional().nullable(),
});

export function registerCelebrationsRoutes(app: Express) {
    const active = authenticateHub();
    const venue = hubModule('venue');
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    // ══════════════════════════════════════════════════════════════════════
    // Hub — the hall
    // ══════════════════════════════════════════════════════════════════════

    const venueState = async (bpId: number, code: string) => {
        const [profile, spaces, listing, readiness] = await Promise.all([VenueService.profile(bpId), VenueService.spaces(bpId), ListingService.get(bpId, 'venue'), VenueService.readiness(bpId)]);
        return {
            profile, pageUrl: `/halls/${code}`, listing: ListingService.view(listing, 'venue'), readiness, commissionPercent: await ListingService.commissionPercent(bpId, 'venue'),
            spaces: spaces.map(s => ({
                id: s.id, name: s.name, kind: s.kind, description: s.description, seated: s.seated, floating: s.floating, areaSqft: s.areaSqft, photos: s.photos ?? [], videoUrl: s.videoUrl,
                features: s.features ?? [], included: s.included, sac: s.sac, gstRate: Number(s.gstRate), isActive: s.isActive, offered: VenueService.offered(s), from: VenueService.fromPrice(s),
                ratesRupees: Object.fromEntries(Object.entries(s.rates ?? {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).map(([a, b]) => [a, (b as number) / 100]))])),
            })),
        };
    };

    app.get('/api/hub/venue', active, venue, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await venueState(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/venue/profile', active, venue, hubCan('settings:manage'), async (req, res, next) => {
        try {
            await VenueService.saveProfile(ctxOf(req), parse(profileSchema, req.body ?? {}) as any);
            res.json({ success: true, message: 'Saved.', data: await venueState(ctxOf(req).businessPartnerId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/cover', active, venue, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const up = await uploadPhotoFrom(req, `halls/${ctxOf(req).partnerCode}/cover`, 2400);
            const p = await VenueService.saveProfile(ctxOf(req), { coverPhoto: up.url });
            res.json({ success: true, message: 'Cover photo updated.', data: { coverPhoto: p.coverPhoto } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/spaces', active, venue, hubCan('settings:manage'), async (req, res, next) => {
        try { const s = await VenueService.saveSpace(ctxOf(req), null, parse(spaceSchema, req.body ?? {}) as any); res.status(201).json({ success: true, message: 'Space added.', data: { id: s.id } }); }
        catch (e) { hubError(e, res, next); }
    });
    app.patch('/api/hub/venue/spaces/:id', active, venue, hubCan('settings:manage'), async (req, res, next) => {
        try { const s = await VenueService.saveSpace(ctxOf(req), Number(req.params.id), parse(spaceSchema, req.body ?? {}) as any); res.json({ success: true, message: 'Saved.', data: { id: s.id, photos: s.photos ?? [] } }); }
        catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/spaces/:id/photos', active, venue, hubCan('settings:manage'), photoUpload.single('file'), async (req, res, next) => {
        try {
            const s0 = await VenueService.space(ctxOf(req).businessPartnerId, Number(req.params.id));
            if ((s0.photos ?? []).length >= 12) throw new HubError('Up to 12 photos per space.', 'TOO_MANY');
            const up = await uploadPhotoFrom(req, `halls/${ctxOf(req).partnerCode}/spaces`);
            const s = await VenueService.addSpacePhoto(ctxOf(req), s0.id, up.url);
            res.json({ success: true, message: 'Photo added.', data: { id: s.id, photos: s.photos ?? [] } });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/venue/calendar', active, venue, hubCan('ops:view'), async (req, res, next) => {
        try {
            const month = String(req.query.month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
            res.json({ success: true, data: await VenueService.calendar(ctxOf(req).businessPartnerId, month) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/calendar/block', active, venue, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ spaceId: z.number().int(), from: z.string(), to: z.string().optional(), slot, note: z.string().max(200).nullable().optional() }), req.body ?? {});
            await VenueService.space(ctxOf(req).businessPartnerId, b.spaceId);
            const to = b.to ?? b.from;
            if (!isDay(b.from) || !isDay(to) || to < b.from) throw new HubError('Choose the dates to block.', 'BAD_DATE');
            const days: string[] = [];
            for (let d = b.from; d <= to && days.length <= 62; d = addDays(d, 1)) days.push(d);
            const rows = await BookingCalendar.block({ bpId: ctxOf(req).businessPartnerId, resourceKind: 'space', resourceId: b.spaceId, days, parts: partsOf(b.slot), note: b.note, adminUserId: ctxOf(req).adminUserId });
            res.status(201).json({ success: true, message: `Blocked ${days.length} day${days.length === 1 ? '' : 's'}.`, data: { blocked: rows.length } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/calendar/unblock', active, venue, hubCan('ops:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ ids: z.array(z.number().int()).min(1).max(200) }), req.body ?? {});
            const rows = await BookingCalendar.unblock(ctxOf(req).businessPartnerId, b.ids);
            res.json({ success: true, message: rows.length ? 'Unblocked.' : 'Nothing to unblock — client holds and bookings are changed from the booking.', data: { released: rows.length } });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/venue/requests', active, venue, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await VenueService.pendingRequests(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/requests/:id/answer', active, venue, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ decision: z.enum(['accept', 'decline']), reason: z.string().max(300).nullable().optional() }), req.body ?? {});
            const r = await VenueService.answer(ctxOf(req), Number(req.params.id), b);
            res.json({ success: true, message: b.decision === 'accept' ? 'Accepted — the client has been sent the advance to pay.' : 'Declined — the date is free again.', data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/bookings/:id/deposit', active, venue, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ status: z.enum(['due', 'collected', 'refunded', 'withheld']), note: z.string().max(300).nullable().optional() }), req.body ?? {});
            if (b.status === 'withheld' && !b.note?.trim()) throw new HubError('Say what the deposit was kept for (damage, overtime…).', 'NO_NOTE');
            const [u] = await db.update(eventBookings).set({ depositStatus: b.status, depositNote: b.note?.trim() || null, updatedAt: new Date() })
                .where(and(eq(eventBookings.id, Number(req.params.id)), eq(eventBookings.businessPartnerId, ctxOf(req).businessPartnerId))).returning();
            if (!u) throw new HubError('Booking not found', 'NOT_FOUND', 404);
            if (!u.depositPaise) throw new HubError('This booking has no deposit.', 'NO_DEPOSIT', 409);
            res.json({ success: true, message: 'Deposit updated.', data: { depositStatus: u.depositStatus } });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/venue/preview', active, venue, hubCan('ops:view'), async (req, res, next) => {
        try {
            const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, ctxOf(req).businessPartnerId)).limit(1);
            res.json({ success: true, data: { ...(await VenueService.publicPage(bp)), preview: true } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/venue/listing/submit', active, venue, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            await ListingService.submit(bpId, 'venue', await VenueService.readiness(bpId));
            res.json({ success: true, message: 'Sent to UniteFix for review. We check new pages within two working days.', data: await venueState(bpId, ctxOf(req).partnerCode) });
        } catch (e) { hubError(e, res, next); }
    });

    // ── reviews (any listing) ──
    const listed = hubAnyModule(['venue', 'portfolio', 'events']);
    app.get('/api/hub/reviews', active, listed, hubCan('ops:view'), async (req, res, next) => {
        try {
            const rows = await ListingService.partnerReviews(ctxOf(req).businessPartnerId);
            res.json({ success: true, data: rows.map(r => ({ id: r.id, kind: r.kind, name: r.reviewerName, occasion: r.occasion, eventDate: r.eventDate, rating: r.rating, body: r.body, reply: r.reply, status: r.status, hiddenReason: r.hiddenReason, createdAt: r.createdAt })) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/reviews/:id/reply', active, listed, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ reply: z.string().max(1000) }), req.body ?? {});
            await ListingService.reply(ctxOf(req).businessPartnerId, Number(req.params.id), b.reply);
            res.json({ success: true, message: 'Reply posted.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Public — halls
    // ══════════════════════════════════════════════════════════════════════

    const liveHall = async (code: string) => {
        const bp = await VenueService.publicPartner(code);
        if (!bp || !(await ListingService.isLive(bp.id, 'venue'))) return null;
        return bp;
    };
    app.get('/api/public/halls/:code', async (req, res, next) => {
        try {
            const bp = await liveHall(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: await VenueService.publicPage(bp) });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/halls/:code/availability', async (req, res, next) => {
        try {
            const bp = await liveHall(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const month = String(req.query.month ?? new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7));
            res.json({ success: true, data: await VenueService.availability(bp.id, Number(req.query.spaceId), month) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/halls/:code/estimate', async (req, res, next) => {
        try {
            const bp = await liveHall(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(hallPick, req.body ?? {});
            const p = await VenueService.price(bp.id, b);
            const free = await BookingCalendar.isFree(bp.id, 'space', b.spaceId, [b.date], partsOf(b.slot));
            res.json({ success: true, data: { items: p.picked, dayType: p.dayType, dayLabel: p.dayLabel, slotName: p.slotName, slotTimes: p.slotTimes, available: free, ...p.estimate } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/halls/:code/request', celebrationsSubmitLimiter, async (req, res, next) => {
        try {
            const bp = await liveHall(req.params.code);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const b = parse(hallPick.merge(contactSchema).extend({ occasion: z.string().trim().min(2, 'What is the occasion?').max(80), notes: z.string().max(1000).nullable().optional() }), req.body ?? {});
            const r = await VenueService.request(bp, b as any);
            res.status(201).json({
                success: true,
                message: r.instant ? 'Your date is held. Pay the advance to confirm it.' : `${bp.displayName} will confirm within a few hours. Your date is held until then.`,
                data: { link: CelebrationBookings.customerLink(r.enquiry.publicToken), payUrl: r.payUrl, heldUntil: r.holdUntil, instant: r.instant, estimate: r.estimate },
            });
        } catch (e) { hubError(e, res, next); }
    });

    // ── the client's booking page ──
    app.get('/api/public/celebrations/b/:token', async (req, res, next) => {
        try {
            const v = await CelebrationBookings.publicView(req.params.token);
            if (!v) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: v });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/celebrations/b/:token/cancel', celebrationsSubmitLimiter, async (req, res, next) => {
        try {
            const b = parse(z.object({ note: z.string().max(500).nullable().optional() }), req.body ?? {});
            const r = await CelebrationBookings.requestCancel(req.params.token, b.note);
            res.json({ success: true, message: 'withdrawn' in r ? 'Your request is withdrawn.' : 'cancelled' in r ? 'Cancelled. Nothing was paid, so nothing is due.' : 'The business has your cancellation request and will process the refund under the terms.', data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/celebrations/b/:token/review', celebrationsSubmitLimiter, async (req, res, next) => {
        try {
            const b = parse(z.object({ rating: z.number().int(), body: z.string().max(1500).nullable().optional() }), req.body ?? {});
            await CelebrationBookings.submitReview(req.params.token, b);
            res.status(201).json({ success: true, message: 'Thank you — your review is published.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Search and plans
    // ══════════════════════════════════════════════════════════════════════

    app.get('/api/public/celebrations/search', async (req, res, next) => {
        try {
            const q = req.query as Record<string, string | undefined>;
            const type = (q.type ?? 'halls') as 'halls';
            const r = await CelebrationsSearch.search({
                type, city: q.city || null, pincode: q.pincode || null, date: q.date || null, slot: (['am', 'pm', 'full'].includes(q.slot ?? '') ? q.slot : null) as any,
                guests: q.guests ? Math.max(1, Math.min(100000, Number(q.guests) || 0)) : null, q: q.q || null, maxPrice: q.maxPrice ? Number(q.maxPrice) || null : null,
                amenities: q.amenities ? String(q.amenities).split(',').map(x => x.trim()).filter(Boolean).slice(0, 10) : [], style: q.style || null, vegOnly: q.veg === '1',
                sort: (['recommended', 'price', 'rating'].includes(q.sort ?? '') ? q.sort : 'recommended') as any,
            });
            res.json({ success: true, data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/public/celebrations/cities', async (_req, res, next) => {
        try { res.json({ success: true, data: await CelebrationsSearch.cities() }); } catch (e) { hubError(e, res, next); }
    });
    const planSchema = contactSchema.extend({
        date: z.string().max(10), guests: z.number().int().positive().max(100000).nullable().optional(), occasion: z.string().trim().min(2, 'What is the occasion?').max(80),
        notes: z.string().max(1000).nullable().optional(), location: z.string().max(200).nullable().optional(),
        items: z.array(z.object({
            type: z.enum(['hall', 'photographer', 'planner']), code: z.string().max(40),
            spaceId: z.number().int().optional(), slot: slot.optional(), packageId: z.number().int().optional(), days: z.number().int().min(1).max(7).optional(), hours: z.number().int().min(1).max(24).optional(),
            location: z.string().max(200).nullable().optional(), venueId: z.number().int().nullable().optional(), themeId: z.number().int().nullable().optional(),
            ownVenue: z.string().max(200).nullable().optional(), customization: z.string().max(1000).nullable().optional(),
            addons: z.array(z.object({ packageId: z.number().int(), quantity: z.number().int().optional() })).max(30).optional(),
        })).min(1).max(6),
    });
    const sendPlan = async (req: any, res: any, next: any, channel: { source: 'public' | 'app'; userId?: number | null }) => {
        try {
            const b = parse(planSchema, req.body ?? {});
            for (const i of b.items) {
                if (i.type === 'hall' && (!i.spaceId || !i.slot)) throw new HubError('Choose the hall space and time.', 'BAD_PLAN');
                if (i.type === 'photographer' && (!i.packageId || !i.slot)) throw new HubError('Choose the photographer\'s package and time.', 'BAD_PLAN');
            }
            const r = await CelebrationPlan.send(b as any, channel);
            res.status(201).json({ success: true, message: r.results.every(x => x.ok) ? 'Sent to everyone in your plan.' : 'Sent — but not every partner could take it. See your plan.', data: r });
        } catch (e: any) {
            if (e?.code === 'PLAN_PROBLEMS') return res.status(409).json({ success: false, code: e.code, message: e.message, problems: e.problems });
            hubError(e, res, next);
        }
    };
    app.post('/api/public/celebrations/plan', celebrationsSubmitLimiter, (req, res, next) => sendPlan(req, res, next, { source: 'public' }));
    app.post('/api/celebrations/plan', authenticateToken, (req, res, next) => sendPlan(req, res, next, { source: 'app', userId: (req as any).user?.userId ?? null }));
    app.get('/api/public/celebrations/plan/:token', async (req, res, next) => {
        try {
            const v = await CelebrationPlan.view(req.params.token);
            if (!v) return res.status(404).json({ success: false, message: 'Not found' });
            res.json({ success: true, data: v });
        } catch (e) { hubError(e, res, next); }
    });

    // ── planners: their listing in Celebrations ──
    const events = hubModule('events');
    app.get('/api/hub/events/listing', active, events, hubCan('ops:view'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            res.json({ success: true, data: { listing: ListingService.view(await ListingService.get(bpId, 'events'), 'events'), readiness: await CelebrationsSearch.eventsReadiness(bpId), commissionPercent: await ListingService.commissionPercent(bpId, 'events') } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/events/listing/submit', active, events, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const bpId = ctxOf(req).businessPartnerId;
            await ListingService.submit(bpId, 'events', await CelebrationsSearch.eventsReadiness(bpId));
            res.json({ success: true, message: 'Sent to UniteFix. Once approved you appear in Celebrations search.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ══════════════════════════════════════════════════════════════════════
    // Staff
    // ══════════════════════════════════════════════════════════════════════

    const kindParam = (k: string): ListingKind => { if (!(LISTING_KINDS as string[]).includes(k)) throw new HubError('Unknown listing', 'NOT_FOUND', 404); return k as ListingKind; };
    const adminId = (req: any) => (req as any).admin.userId as number;

    app.get('/api/admin/hub/celebrations/listings', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: { listings: await ListingService.all({ status: req.query.status ? String(req.query.status) : undefined, kind: req.query.kind ? String(req.query.kind) : undefined }), defaults: await ListingService.defaultCommissions() } }); }
        catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/celebrations/listings/:bpId/:kind/preview', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = kindParam(req.params.kind);
            const [bp] = await db.select().from(businessPartners).where(eq(businessPartners.id, Number(req.params.bpId))).limit(1);
            if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
            let page: any;
            if (kind === 'venue') page = { ...(await VenueService.publicPage(bp)), readiness: await VenueService.readiness(bp.id) };
            else if (kind === 'portfolio') { const { PortfolioService } = await import('../services/portfolio.service'); page = { ...(await PortfolioService.publicPage(bp)), readiness: await PortfolioService.readiness(bp.id) }; }
            else { const { EventsShowcaseService } = await import('../services/events-showcase.service'); page = await EventsShowcaseService.publicShowcase(bp); }
            res.json({ success: true, data: { kind, page, url: kind === 'venue' ? `/halls/${bp.partnerCode}` : kind === 'portfolio' ? `/photographers/${bp.partnerCode}` : `/events/${bp.partnerCode}` } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/celebrations/listings/:bpId/:kind/review', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = kindParam(req.params.kind);
            const b = parse(z.object({ decision: z.enum(['approve', 'changes', 'pause', 'resume']), note: z.string().max(1000).nullable().optional() }), req.body ?? {});
            const u = await ListingService.review(adminId(req), Number(req.params.bpId), kind, b);
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.bpId), action: `listing_${b.decision}`, changedBy: adminId(req), toState: u.status, metadata: { kind, note: b.note ?? null } });
            res.json({ success: true, message: { approve: 'Live in Celebrations.', changes: 'Sent back with your note.', pause: 'Paused.', resume: 'Live again.' }[b.decision], data: ListingService.view(u, kind) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/celebrations/listings/:bpId/:kind/feature', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = kindParam(req.params.kind);
            const b = parse(z.object({ featured: z.boolean() }), req.body ?? {});
            res.json({ success: true, message: b.featured ? 'Featured at the top of search.' : 'No longer featured.', data: ListingService.view(await ListingService.setFeatured(Number(req.params.bpId), kind, b.featured), kind) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/celebrations/listings/:bpId/:kind/commission', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = kindParam(req.params.kind);
            const b = parse(z.object({ percent: z.number().nullable() }), req.body ?? {});
            const u = await ListingService.setCommission(Number(req.params.bpId), kind, b.percent);
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.bpId), action: 'listing_commission', changedBy: adminId(req), metadata: { kind, percent: b.percent } });
            res.json({ success: true, message: 'Commission saved — it applies to new bookings.', data: ListingService.view(u, kind) });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/celebrations/bookings', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await CelebrationBookings.adminBookings({ kind: req.query.kind ? String(req.query.kind) : undefined, status: req.query.status ? String(req.query.status) : undefined }) }); }
        catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/hub/celebrations/reviews', authenticateAdmin, async (req, res, next) => {
        try {
            const rows = await ListingService.allReviews({ status: req.query.status ? String(req.query.status) : undefined });
            res.json({ success: true, data: rows.map(x => ({ id: x.r.id, partner: x.partner, kind: x.r.kind, name: x.r.reviewerName, rating: x.r.rating, body: x.r.body, reply: x.r.reply, status: x.r.status, hiddenReason: x.r.hiddenReason, eventDate: x.r.eventDate, createdAt: x.r.createdAt })) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/celebrations/reviews/:id', authenticateAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ status: z.enum(['published', 'hidden']), reason: z.string().max(300).nullable().optional() }), req.body ?? {});
            const rv = await ListingService.moderate(Number(req.params.id), b);
            await recordAudit({ entityType: 'business_partner', entityId: rv.businessPartnerId, action: `review_${b.status}`, changedBy: adminId(req), metadata: { reviewId: Number(req.params.id), reason: b.reason ?? null } });
            res.json({ success: true, message: b.status === 'hidden' ? 'Hidden from the public page.' : 'Published.' });
        } catch (e) { hubError(e, res, next); }
    });
}
