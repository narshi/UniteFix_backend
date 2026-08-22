/**
 * PHASE 2: Authentication Middleware
 * 
 * Separated auth middleware for mobile, partner, and admin audiences.
 * No shared middleware with role-based branching.
 * 
 * All middleware functions accept standard Express Request type for compatibility.
 * Use the exported interface types (AuthRequest, etc.) in route handlers for type-safe access.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { employees, users, adminUsers } from '@shared/schema';
import { eq } from 'drizzle-orm';
import logger from '../lib/logger';

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.JWT_SECRET;

// Extended Request types for each audience — use in route handlers for type-safe access
export interface AuthRequest extends Request {
    user?: {
        userId: number;
        role: string;
    };
}

export interface MobileRequest extends Request {
    user?: {
        userId: number;
        role: 'user';
        phone: string;
    };
}

export interface PartnerRequest extends Request {
    partner?: {
        userId: number;
        partnerId: number;
        role: 'serviceman';
        verificationStatus: string;
    };
}

export interface AdminRequest extends Request {
    admin?: {
        userId: number;
        role: 'admin' | 'super_admin';
        username: string;
    };
}



/**
 * Partner/Serviceman authentication middleware
 * Validates JWT token for service partner users.
 *
 * IMPORTANT: partnerId and verificationStatus are fetched live from DB, not from JWT.
 * This ensures an admin suspension takes effect immediately, not after token expiry.
 */
export function authenticatePartner(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access token required for partner'
        });
    }

    let decoded: any;
    try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }

    if (decoded.role !== 'serviceman') {
        return res.status(403).json({
            success: false,
            message: 'This endpoint is restricted to service partner accounts'
        });
    }

    // Live DB lookup — fetch partnerId and verificationStatus (cannot trust JWT for these)
    db.select({
        id: employees.id,
        verificationStatus: employees.documentVerificationStatus,
        isActive: employees.isActive,
    })
    .from(employees)
    .where(eq(employees.userId, decoded.userId))
    .limit(1)
    .then(([provider]) => {
        if (!provider) {
            return res.status(403).json({
                success: false,
                message: 'Service provider account not found'
            });
        }

        // Block only genuine suspensions/rejections.
        //
        // `employees.isActive` is overloaded: it means "admin has approved" AND
        // "not suspended". Rejecting on isActive alone locked out every BRAND-NEW
        // partner, who is created with isActive:false while awaiting verification
        // — and told them they were "suspended". Worse, it also blocked
        // GET /api/partner/verification-status, the endpoint their pending screen
        // polls, so they could never see approval without logging out and back in.
        //
        // Gate on the verification status instead, which is the field that
        // actually distinguishes "not yet approved" from "access revoked".
        const revoked = provider.verificationStatus === 'suspended'
            || provider.verificationStatus === 'rejected';

        if (revoked) {
            return res.status(403).json({
                success: false,
                message: provider.verificationStatus === 'rejected'
                    ? 'Your partner application was not approved. Please contact support.'
                    : 'Your partner account has been suspended. Please contact support.',
            });
        }

        (req as any).partner = {
            userId: decoded.userId,
            partnerId: provider.id,           // ← live from DB (was always undefined from JWT)
            role: decoded.role,
            verificationStatus: provider.verificationStatus, // ← live from DB
            isActive: provider.isActive,
        };

        // Backward compat: set req.user as well
        (req as any).user = {
            userId: decoded.userId,
            role: decoded.role,
        };

        next();
    })
    .catch(() => {
        return res.status(500).json({
            success: false,
            message: 'Authentication lookup failed'
        });
    });
}

/**
 * Requires a partner whose documents have been VERIFIED by an admin.
 *
 * Runs after authenticatePartner. That middleware now only blocks suspended and
 * rejected accounts, so an unverified partner can read their own profile and
 * poll their verification status — but must not be able to take jobs, submit
 * bills, collect cash or withdraw money. This is that gate.
 */
export function requireVerifiedPartner(req: Request, res: Response, next: NextFunction) {
    const partner = (req as any).partner;

    if (!partner) {
        return res.status(401).json({ success: false, message: 'Partner authentication required' });
    }

    if (partner.verificationStatus !== 'verified') {
        return res.status(403).json({
            success: false,
            code: 'VERIFICATION_PENDING',
            message: 'Your account is pending verification. You can start working once an admin approves your documents.',
        });
    }

    next();
}

/**
 * Admin authentication middleware
 * Validates JWT token for admin dashboard users
 */
export function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Admin access token required'
        });
    }

    let decoded: any;
    try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error: any) {
        // 401, not 403, when the token has simply EXPIRED.
        //
        // 403 means "we know who you are and you may not do this", which is not
        // what an 8-hour-old admin token is. The dashboard only treats 401 as
        // "session over", so returning 403 left an expired admin looking at a
        // page of errors with a dead token still in localStorage, instead of
        // being sent to the login screen.
        //
        // Deliberately NOT changed for the customer/partner middleware: the
        // mobile client refreshes on 403, so moving those to 401 would break
        // token refresh entirely.
        if (error?.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Admin session expired. Please sign in again.',
                code: 'SESSION_EXPIRED',
            });
        }
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired admin token'
        });
    }

    if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    // Defence in depth: confirm the token maps to a real, active row in
    // `adminUsers`. Previously the role claim alone was sufficient, so ANY token
    // carrying role:'admin' was accepted — which is what turned the signup
    // escalation into full admin access. Admin tokens are minted only by
    // /api/admin/auth/login, where userId is an adminUsers.id.
    db.select({
        id: adminUsers.id,
        isActive: adminUsers.isActive,
        username: adminUsers.username,
        role: adminUsers.role,
    })
        .from(adminUsers)
        .where(eq(adminUsers.id, decoded.userId))
        .limit(1)
        .then(([admin]) => {
            if (!admin) {
                logger.warn('[AUTH] Admin token rejected — no matching admin account', {
                    claimedUserId: decoded.userId,
                    claimedRole: decoded.role,
                });
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }

            if (!admin.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'This admin account has been deactivated.',
                });
            }

            // The ROW's role wins, never the token claim. Tokens are long-lived,
            // so trusting the claim meant demoting a super_admin changed nothing
            // until their token expired — they kept Database Console and delete
            // access the whole time. Reading it here makes a demotion effective
            // on the admin's very next request.
            if (admin.role !== 'admin' && admin.role !== 'super_admin') {
                logger.warn('[AUTH] Admin row carries an unrecognised role', {
                    adminId: admin.id,
                    role: admin.role,
                });
                return res.status(403).json({ success: false, message: 'Admin access required' });
            }

            (req as any).admin = {
                userId: admin.id,
                role: admin.role,
                username: admin.username ?? decoded.username,
            };

            next();
        })
        .catch(() => {
            return res.status(500).json({ success: false, message: 'Admin authentication lookup failed' });
        });
}


/**
 * Refuse anything that needs an address until the account actually has one.
 *
 * WHY THIS EXISTS
 * Onboarding collects the address and pin code, but that was enforced ONLY by
 * the mobile navigator: the server reported `pendingOnboardingSteps` in the
 * auth response and then trusted the client to honour it. A rule the client
 * enforces is not a rule — anyone on an app build from before the onboarding
 * stack existed, or any client that ignores the field, signed up and went
 * straight past it. That is why accounts with no address exist.
 *
 * Deliberately applied ONLY to endpoints where acting without an address is
 * meaningless — placing a booking, placing an order. It must never cover auth,
 * profile read/update or config, or the user would be locked out of the very
 * screens that fix the problem.
 *
 * Answers with a specific code so the app can send them to the right screen
 * rather than showing a generic failure.
 */
export async function requireCompleteProfile(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.userId ?? (req as any).partner?.userId;
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
        const [row] = await db
            .select({ homeAddress: users.homeAddress, pinCode: users.pinCode })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        const missingAddress = !row?.homeAddress || !String(row.homeAddress).trim();
        const missingPinCode = !row?.pinCode || !String(row.pinCode).trim();

        if (missingAddress || missingPinCode) {
            // A service expert's address is their BASE LOCATION - where they
            // work from - so it is named that way for them, matching the app.
            const isExpert = ((req as any).user?.role ?? (req as any).partner?.role) === 'serviceman';
            const missing = [
                missingAddress ? (isExpert ? 'address (base location)' : 'address') : null,
                missingPinCode ? 'pin code' : null,
            ].filter(Boolean).join(' and ');

            logger.info('[PROFILE_GATE] Blocked request from an incomplete profile', {
                userId, path: req.path, missingAddress, missingPinCode,
            });

            // 422, not 403. The mobile client treats a 403 as "the access token
            // may have expired" and fires a token refresh before retrying — which
            // would rotate a refresh token on every blocked booking, for a
            // condition that has nothing to do with authentication. 422 says
            // "you are who you say you are, but the account is not in a state
            // that allows this", which is exactly the situation.
            return res.status(422).json({
                success: false,
                code: 'PROFILE_INCOMPLETE',
                message: `Please add your ${missing} to your profile before continuing.`,
                missing: { address: missingAddress, pinCode: missingPinCode },
            });
        }

        return next();
    } catch (error: any) {
        logger.error('[PROFILE_GATE] Lookup failed', { userId, error: error.message });
        // Fail CLOSED here, unlike most guards: letting a booking through on a
        // database hiccup is what produced the unaddressed accounts to begin with.
        return res.status(503).json({
            success: false,
            message: 'Could not verify your profile just now. Please try again.',
        });
    }
}

/**
 * Restrict a route to super_admins. Must run AFTER authenticateAdmin, which is
 * what populates `req.admin` with the role read from the database.
 *
 * Gates the capabilities that can destroy data or expose everything: the raw SQL
 * console, the audit trail, and permanent account deletion.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    const admin = (req as any).admin as { userId: number; role: string; username?: string } | undefined;

    if (!admin) {
        return res.status(401).json({ success: false, message: 'Admin authentication required' });
    }

    if (admin.role !== 'super_admin') {
        logger.warn('[AUTH] super_admin route refused', {
            adminId: admin.userId,
            role: admin.role,
            path: req.originalUrl,
        });
        return res.status(403).json({
            success: false,
            message: 'This action requires a super_admin account.',
        });
    }

    next();
}

/**
 * Mobile client authentication middleware
 * @deprecated authenticateToken now enforces role='user' — use that instead.
 * Kept here only so any lingering imports don't cause compile errors.
 */
export function authenticateMobile(req: Request, res: Response, next: NextFunction) {
    return authenticateToken(req, res, next);
}

/**
 * General purpose customer auth middleware.
 * Accepts ONLY role='user' tokens.
 * Returns 403 if token belongs to a serviceman, admin, or super_admin.
 * Returns 403 if the user account has been deactivated.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    let decoded: any;
    try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }

    // Enforce customer-only: block serviceman and admin tokens from customer routes
    if (decoded.role !== 'user') {
        return res.status(403).json({
            success: false,
            message: 'This endpoint is restricted to customer accounts',
        });
    }

    // Live DB check: verify account is still active
    db.select({ isActive: users.isActive, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1)
        .then(([user]) => {
            if (!user || !user.isActive || user.deletedAt) {
                return res.status(403).json({
                    success: false,
                    message: 'Account is deactivated. Please contact support.',
                });
            }
            (req as any).user = {
                userId: decoded.userId,
                role: decoded.role,
            };
            next();
        })
        .catch(() => {
            return res.status(500).json({ success: false, message: 'Authentication check failed' });
        });
}

/**
 * Multi-role auth middleware — accepts BOTH customer ('user') and partner ('serviceman') tokens.
 * Use for shared endpoints accessed by both roles (e.g., billing preview).
 * Sets req.user with { userId, role } regardless of role.
 */
export function authenticateAny(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    let decoded: any;
    try {
        decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }

    // Accept user and serviceman, block admin tokens
    if (decoded.role !== 'user' && decoded.role !== 'serviceman') {
        return res.status(403).json({
            success: false,
            message: 'This endpoint requires a customer or partner account',
        });
    }

    (req as any).user = {
        userId: decoded.userId,
        role: decoded.role,
    };
    next();
}

