/**
 * Travel partners in the Partner Hub (module 'travel').
 *
 *   Partner  /api/hub/travel/*        profile, fleet (drivers, vehicles), price
 *                                     requests, assignments (accept, driver and
 *                                     vehicle, contact for a stay or guide)
 *   Staff    /api/admin/travel/partners/:id/link     link a card to a Hub partner
 *            /api/admin/travel/partners/:id/fleet    their fleet
 *            /api/admin/travel/fleet/:kind/:id/*     check (Cashfree) or decide by hand
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { TravelPartnerHub } from '../services/travel-partner.service';
import { registerSummaryContributor } from '../services/hub-summary';

const ctxOf = (req: any) => (req as HubRequest).hub!;
const num = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HubError('Not found', 'NOT_FOUND', 404); return n; };

export function registerHubTravelRoutes(app: Express) {
    const active = authenticateHub();
    const mod = hubModule('travel');

    registerSummaryContributor('travel', async (ctx) => {
        if (!ctx.modules.includes('travel') || !ctx.permissions.includes('ops:view')) return null;
        const [reqs, jobs, fleet] = await Promise.all([TravelPartnerHub.priceRequests(ctx.businessPartnerId), TravelPartnerHub.assignments(ctx.businessPartnerId), TravelPartnerHub.fleet(ctx.businessPartnerId)]);
        const toAnswer = reqs.filter(r => r.open).length, toAccept = jobs.filter(j => j.status === 'offered').length;
        const needsDriver = jobs.filter(j => j.role === 'driver' && j.status !== 'declined' && !j.driver && ['confirmed', 'quoted', 'assigned', 'contacted', 'new'].includes(j.trip.status)).length;
        return {
            stats: [
                { label: 'Trips to accept', value: toAccept, hint: needsDriver ? `${needsDriver} need a driver and vehicle` : undefined },
                { label: 'Prices asked', value: toAnswer },
            ],
            checklist: [
                { label: 'Add at least one checked driver and vehicle', done: fleet.drivers.some(d => d.ready) && fleet.vehicles.some(v => v.ready), href: '/partner/travel/fleet' },
            ],
        };
    });

    // ── Partner ──────────────────────────────────────────────────────────

    app.get('/api/hub/travel/profile', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await TravelPartnerHub.profile(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/travel/profile', active, mod, hubCan('settings:manage'), async (req, res, next) => {
        try { await TravelPartnerHub.saveProfile(ctxOf(req).businessPartnerId, req.body); res.json({ success: true, message: 'Saved. UniteFix\'s travel managers see what you provide and where.' }); } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/travel/fleet', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await TravelPartnerHub.fleet(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    for (const kind of ['drivers', 'vehicles'] as const) {
        const save = kind === 'drivers' ? TravelPartnerHub.saveDriver.bind(TravelPartnerHub) : TravelPartnerHub.saveVehicle.bind(TravelPartnerHub);
        const check = kind === 'drivers' ? TravelPartnerHub.checkDriver.bind(TravelPartnerHub) : TravelPartnerHub.checkVehicle.bind(TravelPartnerHub);
        app.post(`/api/hub/travel/fleet/${kind}`, active, mod, hubCan('ops:manage'), async (req, res, next) => {
            try { res.status(201).json({ success: true, data: await save(ctxOf(req).businessPartnerId, null, req.body) }); } catch (e) { hubError(e, res, next); }
        });
        app.patch(`/api/hub/travel/fleet/${kind}/:id`, active, mod, hubCan('ops:manage'), async (req, res, next) => {
            try {
                const bp = ctxOf(req).businessPartnerId, id = num(req.params.id);
                if (typeof req.body?.isActive === 'boolean') { await TravelPartnerHub.setActive(bp, kind === 'drivers' ? 'driver' : 'vehicle', id, req.body.isActive); return res.json({ success: true }); }
                res.json({ success: true, data: await save(bp, id, req.body) });
            } catch (e) { hubError(e, res, next); }
        });
        app.post(`/api/hub/travel/fleet/${kind}/:id/check`, active, mod, hubCan('ops:manage'), async (req, res, next) => {
            try { res.json({ success: true, data: await check(ctxOf(req).businessPartnerId, num(req.params.id), null) }); } catch (e) { hubError(e, res, next); }
        });
    }

    app.get('/api/hub/travel/requests', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await TravelPartnerHub.priceRequests(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/travel/requests/:id', active, mod, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const ctx = ctxOf(req);
            const q = await TravelPartnerHub.answerPrice(ctx.businessPartnerId, ctx.adminUserId ?? null, num(req.params.id), req.body);
            res.json({ success: true, message: q.status === 'declined' ? 'Declined. The travel manager is told.' : 'Price sent to the travel manager.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/travel/assignments', active, mod, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await TravelPartnerHub.assignments(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/travel/assignments/:id/respond', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { const u = await TravelPartnerHub.respond(ctxOf(req).businessPartnerId, num(req.params.id), req.body); res.json({ success: true, message: u.partnerStatus === 'accepted' ? 'Accepted.' : 'Declined. The travel manager is told.' }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/travel/assignments/:id/fleet', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { await TravelPartnerHub.assignFleet(ctxOf(req).businessPartnerId, num(req.params.id), req.body); res.json({ success: true, message: 'Driver and vehicle set. Send the driver the trip link.' }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/travel/assignments/:id/details', active, mod, hubCan('ops:manage'), async (req, res, next) => {
        try { await TravelPartnerHub.setDetails(ctxOf(req).businessPartnerId, num(req.params.id), req.body); res.json({ success: true, message: 'Saved. The traveller sees who to meet once the trip is booked.' }); } catch (e) { hubError(e, res, next); }
    });

    // ── Staff ────────────────────────────────────────────────────────────

    app.post('/api/admin/travel/partners/:id/link', authenticateAdmin, async (req, res, next) => {
        try {
            const b = z.object({ partnerCode: z.string().trim().min(3).max(20) }).safeParse(req.body);
            if (!b.success) throw new HubError('Give the Hub partner code, like BP-0042.', 'BAD_INPUT');
            const u = await TravelPartnerHub.linkCard((req as any).admin.userId, num(req.params.id), b.data.partnerCode);
            res.json({ success: true, message: 'Linked: price requests and assignments now reach their Hub, and they are paid through Partner Settlements.', data: u });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/admin/travel/partners/:id/fleet', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await TravelPartnerHub.fleetOfCard(num(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/travel/fleet/:kind/:id/check', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = req.params.kind === 'drivers' ? 'driver' : req.params.kind === 'vehicles' ? 'vehicle' : null;
            if (!kind) throw new HubError('Not found', 'NOT_FOUND', 404);
            const r = kind === 'driver' ? await TravelPartnerHub.checkDriver(null, num(req.params.id), (req as any).admin.userId) : await TravelPartnerHub.checkVehicle(null, num(req.params.id), (req as any).admin.userId);
            res.json({ success: true, data: r });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/travel/fleet/:kind/:id/review', authenticateAdmin, async (req, res, next) => {
        try {
            const kind = req.params.kind === 'drivers' ? 'driver' : req.params.kind === 'vehicles' ? 'vehicle' : null;
            if (!kind) throw new HubError('Not found', 'NOT_FOUND', 404);
            res.json({ success: true, message: 'Recorded.', data: await TravelPartnerHub.staffReview((req as any).admin.userId, kind, num(req.params.id), req.body) });
        } catch (e) { hubError(e, res, next); }
    });
}
