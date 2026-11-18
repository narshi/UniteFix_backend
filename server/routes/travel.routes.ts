/**
 * Travel planner (travel.service.ts).
 *
 *   App    GET    /api/travel/catalog               regions, places and pickup points on offer
 *          POST   /api/travel/plan                  { tripType, pace, pickupId|pickupText, dropId|dropText, placeIds, regionIds } → optimised plan
 *          POST   /api/travel/trips                 send a plan for a quotation (signed in)
 *          GET    /api/travel/trips/mine            the customer's trips and where each stands
 *          POST   /api/travel/trips/:id/cancel
 *          POST   /api/travel/trips/:id/advance    a payment link for the advance on the quotation
 *   Staff  GET    /api/admin/travel/catalog         every region, place and pickup, hidden ones too
 *          POST   /api/admin/travel/regions|places|pickups          PATCH/DELETE …/:id
 *          GET    /api/admin/travel/trips?status=open|new|…&search=&mine=1
 *          GET    /api/admin/travel/managers        staff who can take trips
 *          POST   /api/admin/travel/trips/:id/assign  { managerAdminId?, managerName, managerPhone }
 *          PATCH  /api/admin/travel/trips/:id       { status?, quoteAmount?, quoteNote?, staffNote?, validHours?, chosenQuoteId? }
 *          POST   /api/admin/travel/trips/:id/quotes   a supplier price { source: own|partner, partnerId?, covers?, amount?, status?, note? }
 *          PATCH/DELETE /api/admin/travel/trips/:id/quotes/:quoteId
 *          GET|POST /api/admin/travel/partners     PATCH/DELETE …/:id
 *          GET|PUT  /api/admin/travel/settings     default manager, advance %, how long a price is held
 * Staff paths need the Travel capability (capability-map.ts).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin, authenticateToken } from '../middleware/auth.middleware';
import { celebrationsBrowseLimiter, celebrationsSubmitLimiter } from '../middleware/rate-limit';
import { TravelService, TravelError } from '../services/travel.service';
import { TripLiveService, TripLiveError } from '../services/trip-live.service';

export function registerTravelRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof TravelError || e instanceof TripLiveError) return res.status(e.status).json({ success: false, message: e.message });
        next(e);
    };
    const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new TravelError('Not found.', 404); return n; };
    const adminId = (req: Request) => (req as any).admin?.userId as number;

    // ── App ──
    app.get('/api/travel/catalog', celebrationsBrowseLimiter, async (_req, res, next) => {
        try { res.set('Cache-Control', 'public, max-age=120'); res.json({ success: true, data: await TravelService.catalog() }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/plan', celebrationsBrowseLimiter, async (req, res, next) => {
        try { res.json({ success: true, data: await TravelService.plan(req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips', celebrationsSubmitLimiter, authenticateToken, async (req, res, next) => {
        try {
            const r = await TravelService.createTrip((req as any).user.userId, req.body ?? {});
            res.status(201).json({ success: true, message: r.message, data: r });
        } catch (e) { fail(e, res, next); }
    });
    app.get('/api/travel/trips/mine', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await TravelService.myTrips((req as any).user.userId) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips/:id/advance', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await TravelService.startAdvance((req as any).user.userId, id(req)) }); } catch (e) { fail(e, res, next); }
    });
    // Trip mode: the traveller's app sends its location while the trip is on.
    app.post('/api/travel/trips/:id/ping', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await TripLiveService.travellerPing((req as any).user.userId, id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips/:id/family-link', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await TripLiveService.familyLink((req as any).user.userId, id(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.get('/api/travel/follow/:token', async (req, res, next) => {
        try { res.set('Cache-Control', 'no-store').type('html').send(await TripLiveService.followPage(String(req.params.token))); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips/:id/ratings', authenticateToken, async (req, res, next) => {
        try { const r = await TripLiveService.rate((req as any).user.userId, id(req), req.body ?? {}); res.status(201).json({ success: true, message: r.message }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/driver/:token/accept', celebrationsSubmitLimiter, async (req, res, next) => {
        try { res.json({ success: true, ...(await TripLiveService.driverAccept(String(req.params.token))) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/driver/:token/ping', async (req, res, next) => {
        try { res.json({ success: true, data: await TripLiveService.driverPing(String(req.params.token), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips/:id/end', authenticateToken, async (req, res, next) => {
        try { await TravelService.endMine((req as any).user.userId, id(req)); res.json({ success: true, message: 'Welcome back! Tell us how it went.' }); } catch (e) { fail(e, res, next); }
    });
    // The driver's link: a page, the pickup code to start, a button to finish. No login: the link is the key.
    app.get('/api/travel/driver/:token', async (req, res, next) => {
        try { res.set('Cache-Control', 'no-store').type('html').send(await TravelService.driverPage(String(req.params.token))); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/driver/:token/start', celebrationsSubmitLimiter, async (req, res, next) => {
        try { res.json({ success: true, ...(await TravelService.driverStart(String(req.params.token), req.body ?? {})) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/driver/:token/end', celebrationsSubmitLimiter, async (req, res, next) => {
        try { res.json({ success: true, ...(await TravelService.driverEnd(String(req.params.token))) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/travel/trips/:id/cancel', authenticateToken, async (req, res, next) => {
        try { await TravelService.cancelMine((req as any).user.userId, id(req)); res.json({ success: true, message: 'Trip cancelled.' }); } catch (e) { fail(e, res, next); }
    });

    // ── Staff ──
    const base = '/api/admin/travel';
    app.get(`${base}/catalog`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TravelService.adminCatalog() }); } catch (e) { fail(e, res, next); }
    });
    const crud = (path: string, save: (a: number, id: number | null, body: unknown) => Promise<unknown>, remove: (a: number, id: number) => Promise<void>, label: string) => {
        app.post(`${base}/${path}`, authenticateAdmin, async (req, res, next) => {
            try { res.status(201).json({ success: true, message: `${label} added.`, data: await save.call(TravelService, adminId(req), null, req.body ?? {}) }); } catch (e) { fail(e, res, next); }
        });
        app.patch(`${base}/${path}/:id`, authenticateAdmin, async (req, res, next) => {
            try { res.json({ success: true, message: `${label} saved.`, data: await save.call(TravelService, adminId(req), id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
        });
        app.delete(`${base}/${path}/:id`, authenticateAdmin, async (req, res, next) => {
            try { await remove.call(TravelService, adminId(req), id(req)); res.json({ success: true, message: `${label} deleted.` }); } catch (e) { fail(e, res, next); }
        });
    };
    crud('regions', TravelService.saveRegion, TravelService.deleteRegion, 'Region');
    crud('places', TravelService.savePlace, TravelService.deletePlace, 'Place');
    crud('pickups', TravelService.savePickup, TravelService.deletePickup, 'Pickup point');
    crud('partners', TravelService.savePartner, TravelService.deletePartner, 'Travel partner');
    app.get(`${base}/partners`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TravelService.partners() }); } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/live`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TripLiveService.board() }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/trips/:id/payouts`, authenticateAdmin, async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Payment recorded.', data: await TripLiveService.addPayout(adminId(req), id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.delete(`${base}/trips/:id/payouts/:payoutId`, authenticateAdmin, async (req, res, next) => {
        try { const p = Number(req.params.payoutId); if (!Number.isInteger(p) || p <= 0) throw new TravelError('Not found.', 404); await TripLiveService.deletePayout(adminId(req), id(req), p); res.json({ success: true, message: 'Removed.' }); } catch (e) { fail(e, res, next); }
    });
    app.put(`${base}/trips/:id/balance`, authenticateAdmin, async (req, res, next) => {
        try { await TripLiveService.setBalance(adminId(req), id(req), req.body ?? {}); res.json({ success: true, message: 'Balance recorded.' }); } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/experts`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TravelService.experts() }); } catch (e) { fail(e, res, next); }
    });
    const mid = (req: Request) => { const n = Number(req.params.memberId); if (!Number.isInteger(n) || n <= 0) throw new TravelError('Not found.', 404); return n; };
    app.post(`${base}/trips/:id/team`, authenticateAdmin, async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Added to the trip team.', data: await TravelService.saveTeam(adminId(req), id(req), null, req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.patch(`${base}/trips/:id/team/:memberId`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Saved.', data: await TravelService.saveTeam(adminId(req), id(req), mid(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.delete(`${base}/trips/:id/team/:memberId`, authenticateAdmin, async (req, res, next) => {
        try { await TravelService.deleteTeam(adminId(req), id(req), mid(req)); res.json({ success: true, message: 'Removed from the team.' }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/trips/:id/start`, authenticateAdmin, async (req, res, next) => {
        try { await TravelService.staffStart(adminId(req), id(req)); res.json({ success: true, message: 'Trip started.' }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/trips/:id/end`, authenticateAdmin, async (req, res, next) => {
        try { await TravelService.staffEnd(adminId(req), id(req)); res.json({ success: true, message: 'Trip finished.' }); } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/settings`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TravelService.settings() }); } catch (e) { fail(e, res, next); }
    });
    app.put(`${base}/settings`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Travel settings saved.', data: await TravelService.saveSettings(adminId(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    const qid = (req: Request) => { const n = Number(req.params.quoteId); if (!Number.isInteger(n) || n <= 0) throw new TravelError('Not found.', 404); return n; };
    app.post(`${base}/trips/:id/quotes`, authenticateAdmin, async (req, res, next) => {
        try { res.status(201).json({ success: true, message: 'Supplier price added.', data: await TravelService.addQuote(adminId(req), id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.patch(`${base}/trips/:id/quotes/:quoteId`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Saved.', data: await TravelService.updateQuote(adminId(req), id(req), qid(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.delete(`${base}/trips/:id/quotes/:quoteId`, authenticateAdmin, async (req, res, next) => {
        try { await TravelService.deleteQuote(id(req), qid(req)); res.json({ success: true, message: 'Removed.' }); } catch (e) { fail(e, res, next); }
    });

    app.get(`${base}/trips`, authenticateAdmin, async (req, res, next) => {
        try {
            res.json({ success: true, data: await TravelService.trips({
                status: typeof req.query.status === 'string' ? req.query.status : undefined,
                search: typeof req.query.search === 'string' ? req.query.search : undefined,
                mine: req.query.mine === '1' ? adminId(req) : null,
            }) });
        } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/managers`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await TravelService.managers() }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/trips/:id/assign`, authenticateAdmin, async (req, res, next) => {
        try { await TravelService.assign(adminId(req), id(req), req.body ?? {}); res.json({ success: true, message: 'Travel manager assigned. The customer is told they will get a call.' }); } catch (e) { fail(e, res, next); }
    });
    app.patch(`${base}/trips/:id`, authenticateAdmin, async (req, res, next) => {
        try { const r = await TravelService.update(adminId(req), id(req), req.body ?? {}); res.json({ success: true, message: req.body?.quoteAmount != null && r.status === 'quoted' ? 'Quotation sent to the customer.' : 'Trip updated.' }); } catch (e) { fail(e, res, next); }
    });
}
