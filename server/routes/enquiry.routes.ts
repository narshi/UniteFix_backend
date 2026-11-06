/**
 * Referral enquiries (enquiry.service.ts).
 *
 *   Customer  POST /api/enquiries                      { catalogServiceId, details, preferredDate?, budget?, address?, pincode? }
 *             GET  /api/enquiries/mine
 *   Partner   GET  /api/hub/enquiries
 *             POST /api/hub/enquiries/:id/take
 *             PATCH /api/hub/enquiries/:id             { status: contacted | closed, note? }
 *   Staff     GET  /api/admin/enquiries?filter=needs_staff|open|all
 *             POST /api/admin/enquiries/:id/forward    { businessPartnerId }
 *             PATCH /api/admin/enquiries/:id           { status: contacted | closed, note? }
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateToken, authenticateAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, HubRequest } from '../middleware/hub-auth';
import { EnquiryService, EnquiryError } from '../services/enquiry.service';

export function registerEnquiryRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof EnquiryError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
        next(e);
    };
    const userId = (req: Request) => (req as any).user.userId as number;
    const bpId = (req: Request) => (req as HubRequest).hub!.businessPartnerId;
    const adminId = (req: Request) => (req as any).admin?.userId as number;

    app.post('/api/enquiries', authenticateToken, async (req, res, next) => {
        try {
            const r = await EnquiryService.create(userId(req), req.body ?? {});
            res.status(201).json({ success: true, message: r.partners ? `Sent to ${r.partners} partner${r.partners === 1 ? '' : 's'} near you. You will get a call.` : 'Sent to UniteFix. We will call you back.', data: r.enquiry });
        } catch (e) { fail(e, res, next); }
    });
    app.get('/api/enquiries/mine', authenticateToken, async (req, res, next) => {
        try { res.json({ success: true, data: await EnquiryService.mine(userId(req)) }); } catch (e) { fail(e, res, next); }
    });

    const active = authenticateHub();
    app.get('/api/hub/enquiries', active, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await EnquiryService.forPartner(bpId(req)) }); } catch (e) { fail(e, res, next); }
    });
    app.post('/api/hub/enquiries/:id/take', active, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, message: 'It is yours. Call the customer.', data: await EnquiryService.take(bpId(req), Number(req.params.id)) }); } catch (e) { fail(e, res, next); }
    });
    app.patch('/api/hub/enquiries/:id', active, hubCan('ops:view'), async (req, res, next) => {
        try { res.json({ success: true, data: await EnquiryService.partnerUpdate(bpId(req), Number(req.params.id), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });

    app.get('/api/admin/enquiries', authenticateAdmin, async (req, res, next) => {
        try {
            const f = req.query.filter === 'needs_staff' || req.query.filter === 'all' ? req.query.filter : 'open';
            res.json({ success: true, data: await EnquiryService.forStaff(f as any) });
        } catch (e) { fail(e, res, next); }
    });
    app.post('/api/admin/enquiries/:id/forward', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, message: 'Forwarded. The partner and the customer are told.', data: await EnquiryService.forward(adminId(req), Number(req.params.id), Number(req.body?.businessPartnerId)) }); } catch (e) { fail(e, res, next); }
    });
    app.patch('/api/admin/enquiries/:id', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await EnquiryService.staffUpdate(adminId(req), Number(req.params.id), req.body ?? {}) }); } catch (e) { fail(e, res, next); }
    });
}
