/**
 * Admin → WhatsApp (whatsapp.service.ts). Settings capability (capability-map.ts:
 * /integrations → settings): view to see the status, manage to change it.
 *
 *   GET    /api/admin/integrations/whatsapp                 status (never the token)
 *   PUT    /api/admin/integrations/whatsapp                 { token?, phoneNumberId, businessAccountId?, template?, lang?, enabled? } — checked with Meta, then saved
 *   PATCH  /api/admin/integrations/whatsapp                 { enabled }
 *   DELETE /api/admin/integrations/whatsapp
 *   POST   /api/admin/integrations/whatsapp/template        submit the payment template for approval
 *   POST   /api/admin/integrations/whatsapp/template/refresh  ask Meta for its status
 *   POST   /api/admin/integrations/whatsapp/test            { phone } — the template with sample values
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { WhatsAppService, WhatsAppError } from '../services/whatsapp.service';

export function registerIntegrationRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof WhatsAppError) return res.status(e.status).json({ success: false, message: e.message });
        next(e);
    };
    const adminId = (req: Request) => (req as any).admin?.userId as number;
    const P = '/api/admin/integrations/whatsapp';
    app.get(P, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await WhatsAppService.status() }); } catch (e) { fail(e, res, next); }
    });
    app.put(P, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Connected. WhatsApp checked the number.', data: await WhatsAppService.connect(adminId(req), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
    app.patch(P, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await WhatsAppService.setEnabled(adminId(req), req.body?.enabled === true) }); } catch (e) { fail(e, res, next); }
    });
    app.delete(P, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Disconnected.', data: await WhatsAppService.disconnect(adminId(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${P}/template`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Sent to Meta for approval. It usually takes minutes, sometimes a day.', data: await WhatsAppService.submitTemplate(adminId(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${P}/template/refresh`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await WhatsAppService.refreshTemplate(adminId(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.post(`${P}/test`, authenticateAdmin, async (req, res, next) => {
        try { const r = await WhatsAppService.sendTest(req.body?.phone); res.json({ success: true, message: `Test sent to ${r.to}.`, data: r }); } catch (e) { fail(e, res, next); }
    });
}
