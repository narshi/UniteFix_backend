/**
 * Partner Hub authentication.
 *
 * Accepts a dashboard token whose role is 'partner' (Hub login) or 'operator'
 * (an FTTH operator's original owner login), checks the login is live, and
 * resolves the business, team role, modules and plan into `req.hub`.
 *
 * A business still under review may sign in — it has to, to upload documents
 * and accept the agreement — but only routes registered with `allowPending`
 * answer it. Everything else waits for approval.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { adminUsers } from '@shared/schema';
import { PartnerHubService, HubContext, HubError } from '../services/partner-hub.service';
import type { HubPermission, HubModule } from '@shared/hub';
import logger from '../lib/logger';

const JWT_SECRET = process.env.JWT_SECRET as string;

export interface HubRequest extends Request { hub?: HubContext }

export function authenticateHub(opts: { allowPending?: boolean } = {}) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Sign in to the Partner Hub.' });

        let decoded: any;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (error: any) {
            return res.status(401).json({
                success: false, code: 'SESSION_EXPIRED',
                message: error?.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid session. Please sign in again.',
            });
        }
        if (decoded.role !== 'partner' && decoded.role !== 'operator') {
            return res.status(403).json({ success: false, message: 'Partner Hub access required' });
        }

        try {
            const [login] = await db.select({ isActive: adminUsers.isActive, deletedAt: adminUsers.deletedAt, username: adminUsers.username })
                .from(adminUsers).where(eq(adminUsers.id, decoded.userId)).limit(1);
            if (!login || login.deletedAt || login.isActive === false) {
                return res.status(403).json({ success: false, code: 'LOGIN_DISABLED', message: 'This login has been switched off. Ask the business owner.' });
            }

            const ctx = await PartnerHubService.context(decoded.userId, login.username);
            if (!ctx) {
                return res.status(403).json({ success: false, message: 'This login is not linked to a partner business. Contact UniteFix.' });
            }
            if (ctx.status !== 'active' && !opts.allowPending) {
                return res.status(403).json({
                    success: false, code: 'PARTNER_NOT_ACTIVE',
                    message: ctx.status === 'pending_approval'
                        ? 'Your application is under review. This opens once UniteFix approves it.'
                        : 'Your partner account is paused. Contact UniteFix.',
                });
            }
            (req as HubRequest).hub = ctx;
            next();
        } catch (err: any) {
            logger.error('[HUB] Authentication lookup failed', { error: err?.message });
            res.status(500).json({ success: false, message: 'Authentication lookup failed' });
        }
    };
}

/** Role gate for a route. */
export function hubCan(perm: HubPermission) {
    return (req: Request, res: Response, next: NextFunction) => {
        const ctx = (req as HubRequest).hub!;
        try { PartnerHubService.require(ctx, perm); next(); }
        catch (e) { const h = e as HubError; res.status(h.status).json({ success: false, code: h.code, message: h.message }); }
    };
}

/** Module gate for a route. */
export function hubModule(mod: HubModule) {
    return (req: Request, res: Response, next: NextFunction) => {
        const ctx = (req as HubRequest).hub!;
        try { PartnerHubService.requireModule(ctx, mod); next(); }
        catch (e) { const h = e as HubError; res.status(h.status).json({ success: false, code: h.code, message: h.message }); }
    };
}

/** Turn a HubError into its response; anything else to the error handler. */
export function hubError(error: any, res: Response, next: NextFunction) {
    if (error instanceof HubError) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    next(error);
}
