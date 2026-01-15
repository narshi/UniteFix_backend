/**
 * PHASE 2: Authentication Middleware
 * 
 * Separated auth middleware for mobile, partner, and admin audiences.
 * No shared middleware with role-based branching.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'unitefix-secret-key-2024';

// Extended Request types for each audience
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
export function authenticateMobile(req: MobileRequest, res: Response, next: NextFunction) {
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

        // Must be a regular user (not admin or serviceman)
        if (decoded.role !== 'user') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token for mobile client'
            });
        }

        req.user = {
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
export function authenticatePartner(req: PartnerRequest, res: Response, next: NextFunction) {
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

        // Must be a serviceman
        if (decoded.role !== 'serviceman') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token for partner'
            });
        }

        req.partner = {
            userId: decoded.userId,
            partnerId: decoded.partnerId,
            role: decoded.role,
            verificationStatus: decoded.verificationStatus,
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
export function authenticateAdmin(req: AdminRequest, res: Response, next: NextFunction) {
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

        // Must be admin or super_admin
        if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        req.admin = {
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
export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
        };
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
}
