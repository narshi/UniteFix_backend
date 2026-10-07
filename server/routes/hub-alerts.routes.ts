/**
 * Partner Hub alerts — the bell, and how the business wants to be told.
 *
 *   GET  /api/hub/alerts            latest alerts + unread count
 *   POST /api/hub/alerts/read       mark one ({ id }) or all read
 *   GET  /api/hub/alerts/prefs      email / push / SMS, and which the platform can send
 *   PUT  /api/hub/alerts/prefs      change them (owner / manager)
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { HubAlerts } from '../services/hub-alerts.service';

export function registerHubAlertsRoutes(app: Express) {
    // Open while under review too: "your application is approved" lands here.
    const any = authenticateHub({ allowPending: true });
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    app.get('/api/hub/alerts', any, async (req, res, next) => {
        try {
            const bp = ctxOf(req).businessPartnerId;
            const [items, unread] = await Promise.all([HubAlerts.list(bp, Number(req.query.limit) || 50), HubAlerts.unread(bp)]);
            res.json({ success: true, data: { unread, items } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/alerts/read', any, async (req, res, next) => {
        try {
            const id = req.body?.id != null ? Number(req.body.id) : undefined;
            await HubAlerts.markRead(ctxOf(req).businessPartnerId, Number.isFinite(id as number) ? id : undefined);
            res.json({ success: true });
        } catch (e) { hubError(e, res, next); }
    });
    app.get('/api/hub/alerts/prefs', any, async (req, res, next) => {
        try { res.json({ success: true, data: { prefs: await HubAlerts.prefs(ctxOf(req).businessPartnerId), available: HubAlerts.channels() } }); } catch (e) { hubError(e, res, next); }
    });
    app.put('/api/hub/alerts/prefs', any, hubCan('settings:manage'), async (req, res, next) => {
        try {
            const b = z.object({ email: z.boolean().optional(), push: z.boolean().optional(), sms: z.boolean().optional() }).parse(req.body ?? {});
            res.json({ success: true, message: 'Saved.', data: await HubAlerts.setPrefs(ctxOf(req).businessPartnerId, b) });
        } catch (e) { hubError(e, res, next); }
    });
}
