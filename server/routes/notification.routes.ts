/**
 * PHASE 9: Notification Routes
 * 
 * Routes for:
 * - Registering device tokens (FCM/APNS) for push notifications
 * - Listing in-app notifications
 * - Marking notifications as read
 */

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "unitefix-secret-key-2024";

interface AuthenticatedRequest extends Request {
    user?: { userId: number; role: string };
}

function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Access token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
}

export function registerNotificationRoutes(app: Express) {

    /**
     * POST /api/notifications/register-token
     * Register a device token for push notifications
     */
    app.post("/api/notifications/register-token", authenticateToken, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            const { token, platform } = req.body;

            if (!token || !platform) {
                return res.status(400).json({ success: false, message: "Token and platform are required" });
            }

            await storage.addDeviceToken(userId, token, platform);

            res.json({ success: true, message: "Device token registered" });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /api/notifications/unregister-token
     * Unregister a device token
     */
    app.delete("/api/notifications/unregister-token", authenticateToken, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({ success: false, message: "Token is required" });
            }

            await storage.removeDeviceToken(userId, token);

            res.json({ success: true, message: "Device token unregistered" });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/notifications
     * List user's notifications
     */
    app.get("/api/notifications", authenticateToken, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await storage.getUserNotifications(userId, page, limit);

            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /api/notifications/:id/read
     * Mark a notification as read
     */
    app.put("/api/notifications/:id/read", authenticateToken, async (req: any, res, next) => {
        try {
            const notificationId = parseInt(req.params.id);
            await storage.markNotificationRead(notificationId);
            res.json({ success: true, message: "Marked as read" });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /api/notifications/read-all
     * Mark all notifications as read
     */
    app.put("/api/notifications/read-all", authenticateToken, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            await storage.markAllNotificationsRead(userId);
            res.json({ success: true, message: "All marked as read" });
        } catch (error) {
            next(error);
        }
    });
}
