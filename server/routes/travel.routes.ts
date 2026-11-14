/**
 * Travel planner (travel.service.ts).
 *
 *   App    GET    /api/travel/catalog               regions, places and pickup points on offer
 *          POST   /api/travel/plan                  { tripType, pace, pickupId|pickupText, dropId|dropText, placeIds, regionIds } → optimised plan
 *          POST   /api/travel/trips                 send a plan for a quotation (signed in)
 *          GET    /api/travel/trips/mine            the customer's trips and where each stands
 *          POST   /api/travel/trips/:id/cancel
 *   Staff  GET    /api/admin/travel/catalog         every region, place and pickup, hidden ones too
 *          POST   /api/admin/travel/regions|places|pickups          PATCH/DELETE …/:id
 *          GET    /api/admin/travel/trips?status=open|new|…&search=&mine=1
 *          GET    /api/admin/travel/managers        staff who can take trips
 *          POST   /api/admin/travel/trips/:id/assign  { managerAdminId?, managerName, managerPhone }
 *          PATCH  /api/admin/travel/trips/:id       { status?, quoteAmount?, quoteNote?, staffNote? }
 * Staff paths need the Travel capability (capability-map.ts).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin, authenticateToken } from '../middleware/auth.middleware';
import { celebrationsBrowseLimiter, celebrationsSubmitLimiter } from '../middleware/rate-limit';
import { TravelService, TravelError } from '../services/travel.service';

export function registerTravelRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof TravelError) return res.status(e.status).json({ success: false, message: e.message });
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
        try { await TravelService.update(adminId(req), id(req), req.body ?? {}); res.json({ success: true, message: 'Trip updated.' }); } catch (e) { fail(e, res, next); }
    });
}
