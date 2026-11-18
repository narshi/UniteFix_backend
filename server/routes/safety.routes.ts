/**
 * Safety desk (safety.service.ts).
 *
 *   App    GET|PUT /api/safety/contacts              emergency contacts { contacts: [{ name, phone }] } (at most 2)
 *          POST    /api/safety/sos                   { context: trip|service, tripId|serviceRequestId, lat?, lng?, accuracy? }
 *          POST    /api/safety/sos/:id/ping          { lat, lng, accuracy? } every 30 s while sharing
 *          POST    /api/safety/sos/:id/stop          "I'm safe": stop sharing
 *          POST    /api/safety/report                { context, tripId|serviceRequestId, category, teamMemberId?, about?, description? }
 *          POST    /api/safety/help                  { context, tripId, category, description?, lat?, lng? }
 *          GET     /api/safety/live/:token           the page an SOS link opens (family, staff)
 *   Staff  GET     /api/admin/safety/incidents?status=open|acknowledged|resolved&kind=sos|report|help
 *          GET     /api/admin/safety/alarm           critical cases nobody has picked up (every admin page polls it)
 *          POST    /api/admin/safety/incidents/:id/acknowledge
 *          POST    /api/admin/safety/incidents/:id/resolve   { action, note }
 * Staff paths need the Safety desk capability (capability-map.ts).
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin, authenticateToken } from '../middleware/auth.middleware';
import { SafetyService, SafetyError } from '../services/safety.service';

export function registerSafetyRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof SafetyError) return res.status(e.status).json({ success: false, message: e.message });
        next(e);
    };
    const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new SafetyError('Not found.', 404); return n; };
    const uid = (req: Request) => (req as any).user.userId as number;
    const aid = (req: Request) => (req as any).admin?.userId as number;

    app.get('/api/safety/contacts', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await SafetyService.contacts(uid(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.put('/api/safety/contacts', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, message: 'Emergency contacts saved.', data: await SafetyService.saveContacts(uid(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/safety/sos', authenticateToken, async (req, res, next) => {
        try { res.status(201).json({ success: true, data: await SafetyService.sos(uid(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/safety/sos/:id/ping', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await SafetyService.ping(uid(req), id(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/safety/sos/:id/stop', authenticateToken, async (req, res, next) => {
        try { await SafetyService.stopSharing(uid(req), id(req)); res.json({ success: true, message: 'Stopped sharing your location.' }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/safety/report', authenticateToken, async (req, res, next) => {
        try { const r = await SafetyService.report(uid(req), req.body ?? {}); res.status(201).json({ success: true, message: r.message, data: r }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/safety/help', authenticateToken, async (req, res, next) => {
        try { const r = await SafetyService.help(uid(req), req.body ?? {}); res.status(201).json({ success: true, message: r.message, data: r }); } catch (e) { fail(e, res, next); }
    });
    app.get('/api/safety/live/:token', async (req, res, next) => {
        try { res.set('Cache-Control', 'no-store').type('html').send(await SafetyService.livePage(String(req.params.token))); } catch (e) { fail(e, res, next); }
    });

    const base = '/api/admin/safety';
    app.get(`${base}/incidents`, authenticateAdmin, async (req, res, next) => {
        try {
            res.json({ success: true, data: await SafetyService.list({
                status: typeof req.query.status === 'string' ? req.query.status : undefined,
                kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
            }) });
        } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/alarm`, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await SafetyService.alarm() }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/incidents/:id/acknowledge`, authenticateAdmin, async (req, res, next) => {
        try { await SafetyService.acknowledge(aid(req), id(req)); res.json({ success: true, message: 'Picked up. Call them now.' }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${base}/incidents/:id/resolve`, authenticateAdmin, async (req, res, next) => {
        try {
            const r = await SafetyService.resolve(aid(req), id(req), req.body ?? {});
            res.json({ success: true, message: r.outcome !== req.body?.action ? 'Closed. That was their third strike, so they are suspended.' : 'Case closed.', data: r });
        } catch (e) { fail(e, res, next); }
    });
}
