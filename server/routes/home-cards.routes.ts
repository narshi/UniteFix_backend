/**
 * Home screen cards (home-cards.service.ts).
 *
 *   App    GET    /api/home/cards                                  the cards live today (India time)
 *   Staff  GET    /api/admin/catalog/home-cards/sets               every set, with "live today" / "showing today"
 *          POST   /api/admin/catalog/home-cards/sets               { name, heading?, schedule, fromMmdd?, toMmdd?, startsOn?, endsOn?, priority?, isActive?, cards }
 *          PATCH  /api/admin/catalog/home-cards/sets/:id           any of the above
 *          DELETE /api/admin/catalog/home-cards/sets/:id
 *          GET    /api/admin/catalog/home-cards/preview?date=YYYY-MM-DD   what the app shows that day
 * Staff paths sit under /catalog, so they need the Service Catalog capability (capability-map.ts).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { HomeCardsService, HomeCardsError } from '../services/home-cards.service';

export function registerHomeCardRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof HomeCardsError) return res.status(e.status).json({ success: false, message: e.message });
        next(e);
    };
    const adminId = (req: Request) => (req as any).admin?.userId as number;
    const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new HomeCardsError('Unknown set.', 404); return n; };

    app.get('/api/home/cards', async (_req, res, next) => {
        try {
            res.set('Cache-Control', 'public, max-age=300');
            res.json({ success: true, data: await HomeCardsService.resolve() });
        } catch (e) { fail(e, res, next); }
    });

    const base = '/api/admin/catalog/home-cards';
    app.get(`${base}/sets`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await HomeCardsService.list(HomeCardsService.day(req.query.date)) }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/sets`, authenticateAdmin, async (req, res, next) => {
        try { res.status(201).json({ success: true, data: await HomeCardsService.create(adminId(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.patch(`${base}/sets/:id`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await HomeCardsService.update(adminId(req), id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.delete(`${base}/sets/:id`, authenticateAdmin, async (req, res, next) => {
        try { await HomeCardsService.remove(adminId(req), id(req)); res.json({ success: true }); } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/preview`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await HomeCardsService.resolve(HomeCardsService.day(req.query.date)) }); } catch (e) { fail(e, res, next); }
    });
}
