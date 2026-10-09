/**
 * Account deletion requests.
 *
 *   App (any signed-in customer or expert)
 *     GET    /api/client/account/deletion-request     the latest request and its state
 *     POST   /api/client/account/deletion-request     { reasonCategory, reason }
 *     DELETE /api/client/account/deletion-request     withdraw a pending request
 *     DELETE /api/client/account                      older app versions' one-tap delete —
 *                                                     now files a request instead of deleting
 *   Staff (customers capability)
 *     GET    /api/admin/accounts/deletion-requests?status=pending|approved|denied|cancelled
 *     POST   /api/admin/accounts/deletion-requests/:id/approve   { note?, force? }
 *     POST   /api/admin/accounts/deletion-requests/:id/deny      { note }
 */

import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { users } from '@shared/schema';
import { authenticateAdmin, authenticateAny } from '../middleware/auth.middleware';
import { AccountDeletionService, DeletionError, REASON_CATEGORIES } from '../services/account-deletion.service';

const fail = (e: any, res: Response, next: NextFunction) => {
    if (e instanceof DeletionError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
    next(e);
};

export function registerAccountDeletionRoutes(app: Express) {
    const me = (req: Request) => (req as any).user!.userId as number;

    app.get('/api/client/account/deletion-request', authenticateAny, async (req, res, next) => {
        try {
            const r = await AccountDeletionService.latest(me(req));
            res.json({ success: true, data: { request: r ? AccountDeletionService.view(r) : null, reasons: Object.entries(REASON_CATEGORIES).map(([value, label]) => ({ value, label })) } });
        } catch (e) { fail(e, res, next); }
    });

    app.post('/api/client/account/deletion-request', authenticateAny, async (req, res, next) => {
        try {
            const b = z.object({ reasonCategory: z.string().max(40), reason: z.string().max(1000) }).safeParse(req.body ?? {});
            if (!b.success) return res.status(400).json({ success: false, message: 'Tell us why you are leaving.' });
            const r = await AccountDeletionService.request(me(req), b.data);
            res.status(201).json({ success: true, message: 'Your request has been sent. UniteFix reviews requests within 2 working days and will let you know.', data: AccountDeletionService.view(r) });
        } catch (e) { fail(e, res, next); }
    });

    app.delete('/api/client/account/deletion-request', authenticateAny, async (req, res, next) => {
        try {
            const r = await AccountDeletionService.cancel(me(req));
            res.json({ success: true, message: 'Your request is withdrawn. Your account stays as it is.', data: AccountDeletionService.view(r) });
        } catch (e) { fail(e, res, next); }
    });

    /**
     * Older app versions delete in one tap. Deleting is now UniteFix's decision,
     * so the same call files a request (after the same confirmation it always
     * asked for) and the old app shows the server's message.
     */
    app.delete('/api/client/account', authenticateAny, async (req, res, next) => {
        try {
            const userId = me(req);
            const { password, confirmDelete } = req.body ?? {};
            const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            if (user.password) {
                if (!password) return res.status(400).json({ success: false, message: 'Password required to delete account' });
                const bcrypt = await import('bcrypt');
                if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ success: false, message: 'Incorrect password' });
            } else if (!confirmDelete) {
                return res.status(400).json({ success: false, message: 'Please confirm deletion by sending { confirmDelete: true }' });
            }
            try { await AccountDeletionService.request(userId, { source: 'legacy_app' }); }
            catch (e) { if (!(e instanceof DeletionError && e.code === 'PENDING')) throw e; }
            res.json({ success: true, message: 'Your request to delete your account has been sent to UniteFix. We review requests within 2 working days and will let you know.' });
        } catch (e) { fail(e, res, next); }
    });

    // ── staff ──
    const adminId = (req: Request) => (req as any).admin.userId as number;
    app.get('/api/admin/accounts/deletion-requests', authenticateAdmin, async (req, res, next) => {
        try {
            const status = typeof req.query.status === 'string' && ['pending', 'approved', 'denied', 'cancelled'].includes(req.query.status) ? req.query.status : undefined;
            res.json({ success: true, data: { requests: await AccountDeletionService.list(status), pending: await AccountDeletionService.pendingCount() } });
        } catch (e) { fail(e, res, next); }
    });
    app.post('/api/admin/accounts/deletion-requests/:id/approve', authenticateAdmin, async (req, res, next) => {
        try {
            const b = z.object({ note: z.string().max(500).nullable().optional(), force: z.boolean().optional() }).parse(req.body ?? {});
            await AccountDeletionService.approve(adminId(req), Number(req.params.id), b);
            res.json({ success: true, message: 'Approved. The account is closed and its devices are signed out.' });
        } catch (e) { fail(e, res, next); }
    });
    app.post('/api/admin/accounts/deletion-requests/:id/deny', authenticateAdmin, async (req, res, next) => {
        try {
            const b = z.object({ note: z.string().max(500) }).safeParse(req.body ?? {});
            if (!b.success) return res.status(400).json({ success: false, message: 'Tell them why — they will see this note.' });
            await AccountDeletionService.deny(adminId(req), Number(req.params.id), b.data);
            res.json({ success: true, message: 'Denied. They have been told why.' });
        } catch (e) { fail(e, res, next); }
    });
}
