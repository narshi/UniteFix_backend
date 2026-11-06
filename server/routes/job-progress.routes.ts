/**
 * Jobs that do not finish in one visit (job-progress.service.ts).
 *
 *   Expert  POST /api/bookings/:id/continue-later   { date: 'YYYY-MM-DD', note }
 *           POST /api/bookings/:id/resume
 *           POST /api/bookings/:id/cannot-fix       { reason }
 *           POST /api/bookings/:id/start-call       (consultation band: no visit, no code)
 *   Customer POST /api/services/:id/decline-quote    (inspect & quote band: close; the fee is the visit pay)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticatePartner, requireVerifiedPartner, authenticateToken } from '../middleware/auth.middleware';
import { JobProgressService, JobProgressError } from '../services/job-progress.service';

export function registerJobProgressRoutes(app: Express) {
    const tech = (req: Request) => (req as any).partner?.partnerId as number;
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof JobProgressError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
        next(e);
    };

    app.post('/api/bookings/:id/continue-later', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try {
            const r = await JobProgressService.continueLater(tech(req), Number(req.params.id), { date: req.body?.date, note: req.body?.note });
            res.json({ success: true, message: r.message, data: r.booking });
        } catch (e) { fail(e, res, next); }
    });

    app.post('/api/bookings/:id/resume', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try {
            const r = await JobProgressService.resume(tech(req), Number(req.params.id));
            res.json({ success: true, message: r.message, data: r.booking });
        } catch (e) { fail(e, res, next); }
    });

    app.post('/api/bookings/:id/start-call', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try {
            const r = await JobProgressService.startCall(tech(req), Number(req.params.id));
            res.json({ success: true, message: r.message, data: r.booking });
        } catch (e) { fail(e, res, next); }
    });

    app.post('/api/services/:id/decline-quote', authenticateToken, async (req, res, next) => {
        try {
            const r = await JobProgressService.declineQuote((req as any).user.userId, Number(req.params.id));
            res.json({ success: true, message: r.message, data: { visitPayRupees: r.visitPayRupees } });
        } catch (e) { fail(e, res, next); }
    });

    app.post('/api/bookings/:id/cannot-fix', authenticatePartner, requireVerifiedPartner, async (req, res, next) => {
        try {
            const r = await JobProgressService.cannotFix(tech(req), Number(req.params.id), { reason: req.body?.reason });
            res.json({ success: true, message: r.message, data: { visitPayRupees: r.visitPayRupees } });
        } catch (e) { fail(e, res, next); }
    });
}
