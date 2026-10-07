/**
 * Spare-part approval.
 *
 *   Technician  POST /api/bookings/:id/part-requests/preview   price, warranty, duplicates — nothing saved
 *               POST /api/bookings/:id/part-requests           send to the customer { items, reason, confirmDuplicate? }
 *               GET  /api/partner/bookings/:id/part-requests   every request on the job, newest first
 *               POST /api/part-requests/:id/cancel
 *   Customer    GET  /api/bookings/:id/part-requests           the requests waiting on them, and past decisions
 *               POST /api/part-requests/:id/approve
 *               POST /api/part-requests/:id/reject             { note? }
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticatePartner, requireVerifiedPartner, authenticateToken } from '../middleware/auth.middleware';
import { PartRequestService, PartRequestError } from '../services/part-requests.service';

const fail = (e: unknown, res: Response, next: NextFunction) => {
    if (e instanceof PartRequestError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
};

export function registerPartRequestRoutes(app: Express) {
    const tech = (req: Request) => (req as any).partner?.partnerId as number;
    const user = (req: Request) => (req as any).user?.userId as number;

    app.post('/api/bookings/:id/part-requests/preview', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try { res.json({ success: true, data: await PartRequestService.preview(tech(req), Number(req.params.id), req.body?.items) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/bookings/:id/part-requests', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try {
            const r = await PartRequestService.create(tech(req), Number(req.params.id), { items: req.body?.items, reason: req.body?.reason, confirmDuplicate: req.body?.confirmDuplicate === true });
            res.status(201).json({ success: true, message: 'Sent to the customer for approval.', warnings: r.warnings, data: r.request });
        } catch (e) { fail(e, res, next); }
    });
    app.get('/api/partner/bookings/:id/part-requests', authenticatePartner, async (req, res, next) => {
        try { res.json({ success: true, data: await PartRequestService.listForTechnician(tech(req), Number(req.params.id)) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/part-requests/:id/cancel', authenticatePartner, async (req, res, next) => {
        try { res.json({ success: true, message: 'Request withdrawn.', data: await PartRequestService.cancel(tech(req), Number(req.params.id)) }); } catch (e) { fail(e, res, next); }
    });

    app.get('/api/bookings/:id/part-requests', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await PartRequestService.listForCustomer(user(req), Number(req.params.id)) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/part-requests/:id/approve', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, message: 'Approved. It will be on your final bill.', data: await PartRequestService.decide(user(req), Number(req.params.id), 'approve') }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/part-requests/:id/reject', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, message: 'Rejected. Your technician has been told.', data: await PartRequestService.decide(user(req), Number(req.params.id), 'reject', req.body?.note) }); } catch (e) { fail(e, res, next); }
    });
}
