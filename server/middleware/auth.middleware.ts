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
import { employees, users } from '@shared/schema';
import { eq } from 'drizzle-orm';

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

        // Enforce active status — admin suspension takes effect immediately
        if (!provider.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your partner account has been suspended. Please contact support.'
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

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        (req as any).admin = {
            userId: decoded.userId,
            role: decoded.role,
            username: decoded.username,
        };

        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired admin token'
        });
    }
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
