/**
 * Consignment stock and the go-live checklist.
 *
 *   Hub    GET  /api/hub/consignment                 my lots, last 30 days sold, my invoices to UniteFix
 *          POST /api/hub/consignment                 offer stock { sparePartId, quantity, unitPayoutRupees, notes? }
 *          POST /api/hub/consignment/:id/withdraw    before UniteFix receives it
 *   Staff  GET  /api/admin/hub/consignment           offers and lots in the warehouse (?status=)
 *          POST /api/admin/hub/consignment/:id/receive  { quantity }
 *          POST /api/admin/hub/consignment/:id/reject   { note }
 *          POST /api/admin/hub/consignment/:id/return   { note? } — unsold units back to the partner
 *          GET  /api/admin/hub/go-live               every key and setting, checked live
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubModule, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { ConsignmentService } from '../services/consignment.service';
import { GoLiveService } from '../services/go-live.service';
import { recordAudit } from '../lib/audit';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};

export function registerHubConsignmentRoutes(app: Express) {
    const active = authenticateHub();
    const parts = hubModule('parts');
    const ctxOf = (req: any) => (req as HubRequest).hub!;
    const adminId = (req: any) => (req as any).admin.userId as number;

    app.get('/api/hub/consignment', active, parts, hubCan('sales:manage'), async (req, res, next) => {
        try { res.json({ success: true, data: await ConsignmentService.forPartner(ctxOf(req).businessPartnerId) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consignment', active, parts, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ sparePartId: z.number().int(), quantity: z.number().int(), unitPayoutRupees: z.number().positive(), notes: z.string().max(300).optional().nullable() }), req.body ?? {});
            res.status(201).json({ success: true, message: 'Offer sent. Send the stock to the UniteFix warehouse; it counts once it is received.', data: await ConsignmentService.propose(ctxOf(req), b) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/consignment/:id/withdraw', active, parts, hubCan('sales:manage'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Withdrawn.', data: await ConsignmentService.withdraw(ctxOf(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/admin/hub/consignment', authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await ConsignmentService.queue(typeof req.query.status === 'string' ? req.query.status : undefined) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/consignment/:id/receive', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ quantity: z.number().int() }), req.body ?? {});
            const lot = await ConsignmentService.receive(Number(req.params.id), b.quantity, adminId(req));
            await recordAudit({ entityType: 'spare_part', entityId: lot.sparePartId, action: 'consignment_received', changedBy: adminId(req), metadata: { lotId: lot.id, quantity: b.quantity } });
            res.json({ success: true, message: `${b.quantity} received into the warehouse.`, data: lot });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/consignment/:id/reject', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ note: z.string().min(3).max(300) }), req.body ?? {});
            res.json({ success: true, message: 'Rejected.', data: await ConsignmentService.reject(Number(req.params.id), b.note, adminId(req)) });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/admin/hub/consignment/:id/return', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const b = parse(z.object({ note: z.string().max(300).optional().nullable() }), req.body ?? {});
            const lot = await ConsignmentService.returnUnsold(Number(req.params.id), adminId(req), b.note);
            await recordAudit({ entityType: 'spare_part', entityId: lot.sparePartId, action: 'consignment_returned', changedBy: adminId(req), metadata: { lotId: lot.id, returned: lot.returned } });
            res.json({ success: true, message: 'Unsold stock returned; the lot is closed.', data: lot });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/admin/hub/go-live', authenticateAdmin, requireSuperAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await GoLiveService.run() }); } catch (e) { next(e); }
    });
}
