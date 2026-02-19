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
 * Mobile client authentication middleware
 * Validates JWT token for mobile/customer users
 */
export function authenticateMobile(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access token required for mobile client'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        if (decoded.role !== 'user') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token for mobile client'
            });
        }

        (req as any).user = {
            userId: decoded.userId,
            role: decoded.role,
            phone: decoded.phone,
        };

        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
}

/**
 * Partner/Serviceman authentication middleware
 * Validates JWT token for service partner users
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

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        if (decoded.role !== 'serviceman') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token for partner'
            });
        }

        (req as any).partner = {
            userId: decoded.userId,
            partnerId: decoded.partnerId,
            role: decoded.role,
            verificationStatus: decoded.verificationStatus,
        };

        // Also set user for backward compat
        (req as any).user = {
            userId: decoded.userId,
            role: decoded.role,
        };

        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
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
 * General purpose auth middleware (for backward compatibility during migration)
 * @deprecated Use specific middleware instead
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        (req as any).user = {
            userId: decoded.userId,
            role: decoded.role,
        };
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
}
