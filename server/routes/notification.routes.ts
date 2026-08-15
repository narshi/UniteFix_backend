/**
 * Notification Routes
 *
 * Mobile (authenticated user):
 *   POST   /api/notifications/register-token    → register FCM device token
 *   DELETE /api/notifications/unregister-token  → drop a device token (logout)
 *   GET    /api/notifications                   → in-app notification feed
 *   GET    /api/notifications/unread-count      → tab badge
 *   PUT    /api/notifications/:id/read          → mark one read
 *   PUT    /api/notifications/read-all          → mark all read
 *
 * Admin dashboard (guarded globally by the /api/admin authenticateAdmin gate
 * registered in routes.ts):
 *   GET  /api/admin/notifications/audience  → recipient counts for the composer
 *   POST /api/admin/notifications/broadcast → send a marketing push
 *   GET  /api/admin/notifications/campaigns → past campaigns
 *
 * NOTE ON RESPONSE SHAPE: the feed returns `{ success, data: [...] }`. The
 * mobile client reads `response.data.data`, so a bare `{ notifications: [...] }`
 * renders as an empty list — keep `data` populated.
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
// authenticateAny, NOT authenticateToken: authenticateToken rejects any token
// whose role is not 'user', so with it service experts (role='serviceman') got a
// 403 on every notification endpoint — token registration included. That alone
// guaranteed no expert could ever receive a push.
import { authenticateAny } from "../middleware/auth.middleware";
import {
    NotificationService,
    type BroadcastAudience,
} from "../services/notification.service";
import { db } from "../db";
import { desc, eq } from "drizzle-orm";
import { notificationCampaigns } from "@shared/schema";
import logger from "../lib/logger";

/**
 * Expo push tokens look like `ExponentPushToken[xxxxxxxx]`. They are routed by
 * Expo's own service, NOT by FCM, so sending one to firebase-admin fails for
 * every device. Rejecting them at the door turns a silent delivery failure into
 * an obvious 400 during app development.
 */
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[/i;

export function registerNotificationRoutes(app: Express) {

    // ==================== DEVICE TOKENS ====================

    /**
     * POST /api/notifications/register-token
     * Register a native FCM/APNS device token for push notifications.
     */
    app.post("/api/notifications/register-token", authenticateAny, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            const { token, platform } = req.body;

            if (!token || !platform) {
                return res.status(400).json({ success: false, message: "Token and platform are required" });
            }

            if (EXPO_TOKEN_PATTERN.test(token)) {
                logger.warn('[NOTIFICATIONS] Rejected an Expo push token', { userId, platform });
                return res.status(400).json({
                    success: false,
                    message:
                        "Expo push tokens are not supported. Register the native FCM token from " +
                        "Notifications.getDevicePushTokenAsync().",
                });
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
    app.delete("/api/notifications/unregister-token", authenticateAny, async (req: any, res, next) => {
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

    // ==================== IN-APP FEED ====================

    /**
     * GET /api/notifications
     * List the signed-in user's notifications.
     */
    app.get("/api/notifications", authenticateAny, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

            const result = await storage.getUserNotifications(userId, page, limit);
            const unreadCount = await storage.getUnreadNotificationCount(userId);

            res.json({
                success: true,
                // `data` is what the mobile client unwraps; the extra keys are
                // kept for any caller still reading the old shape.
                data: result.notifications,
                notifications: result.notifications,
                total: result.total,
                unreadCount,
                page,
                limit,
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/notifications/unread-count
     * Cheap poll for the bell badge.
     */
    app.get("/api/notifications/unread-count", authenticateAny, async (req: any, res, next) => {
        try {
            const count = await storage.getUnreadNotificationCount(req.user!.userId);
            res.json({ success: true, data: { unreadCount: count } });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /api/notifications/read-all
     * Registered BEFORE /:id/read — Express matches in order, and "read-all"
     * would otherwise be swallowed by the :id route as NaN.
     */
    app.put("/api/notifications/read-all", authenticateAny, async (req: any, res, next) => {
        try {
            const userId = req.user!.userId;
            await storage.markAllNotificationsRead(userId);
            res.json({ success: true, message: "All marked as read" });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /api/notifications/:id/read
     */
    app.put("/api/notifications/:id/read", authenticateAny, async (req: any, res, next) => {
        try {
            const notificationId = parseInt(req.params.id);
            if (!Number.isFinite(notificationId)) {
                return res.status(400).json({ success: false, message: "Invalid notification id" });
            }
            // Scoped to the caller so one user cannot mark another's rows read.
            await storage.markNotificationRead(notificationId, req.user!.userId);
            res.json({ success: true, message: "Marked as read" });
        } catch (error) {
            next(error);
        }
    });

    // ==================== ADMIN: MARKETING BROADCASTS ====================

    /**
     * GET /api/admin/notifications/audience
     * Recipient counts, split by audience. `reachable` is the subset with at
     * least one active device token — the number that will actually get a push
     * rather than only an in-app entry.
     */
    app.get("/api/admin/notifications/audience", async (_req: Request, res: Response, next) => {
        try {
            const stats = await NotificationService.getAudienceStats();
            res.json({ success: true, data: stats });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/notifications/broadcast
     * Body: { audience: 'customers' | 'experts' | 'all', title, body, deepLink? }
     *
     * Sends to customers and service experts SEPARATELY (or both at once) —
     * audience selection is the whole point of this endpoint.
     */
    app.post("/api/admin/notifications/broadcast", async (req: Request, res: Response, next) => {
        try {
            const { audience, title, body, deepLink } = req.body ?? {};
            const adminId = (req as any).user?.userId ?? (req as any).admin?.userId ?? null;

            const validAudiences: BroadcastAudience[] = ["customers", "experts", "all"];
            if (!validAudiences.includes(audience)) {
                return res.status(400).json({
                    success: false,
                    message: `audience must be one of: ${validAudiences.join(", ")}`,
                });
            }

            const cleanTitle = typeof title === "string" ? title.trim() : "";
            const cleanBody = typeof body === "string" ? body.trim() : "";

            if (!cleanTitle || !cleanBody) {
                return res.status(400).json({ success: false, message: "title and body are required" });
            }
            // Android truncates well before this; the cap is to stop a paste of a
            // whole article becoming one notification row per user.
            if (cleanTitle.length > 100 || cleanBody.length > 500) {
                return res.status(400).json({
                    success: false,
                    message: "title must be ≤100 characters and body ≤500 characters",
                });
            }

            const data: Record<string, any> = {};
            if (typeof deepLink === "string" && deepLink.trim()) {
                data.url = deepLink.trim();
            }

            const result = await NotificationService.broadcast(audience, cleanTitle, cleanBody, data);

            // Record the campaign so the dashboard can show what was sent, to whom,
            // and how many devices actually received it.
            let campaignId: number | null = null;
            try {
                const [campaign] = await db
                    .insert(notificationCampaigns)
                    .values({
                        audience,
                        title: cleanTitle,
                        body: cleanBody,
                        deepLink: data.url ?? null,
                        recipientCount: result.recipients,
                        deliveredCount: result.sent,
                        failedCount: result.failed,
                        sentBy: adminId,
                    })
                    .returning();
                campaignId = campaign?.id ?? null;
            } catch (err: any) {
                logger.error("[BROADCAST] Failed to record campaign", { error: err.message });
            }

            res.json({
                success: true,
                message:
                    `Sent to ${result.recipients} ${audience === "all" ? "user" : audience.slice(0, -1)}(s). ` +
                    `${result.sent} device(s) delivered.`,
                data: { ...result, campaignId },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/admin/notifications/campaigns
     * Recent broadcast history.
     */
    app.get("/api/admin/notifications/campaigns", async (req: Request, res: Response, next) => {
        try {
            const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
            const rows = await db
                .select()
                .from(notificationCampaigns)
                .orderBy(desc(notificationCampaigns.createdAt))
                .limit(limit);

            res.json({ success: true, data: rows });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/notifications/test
     * Send a single push to one user id — the fastest way to prove the whole
     * chain (credentials → token → device) works without spamming an audience.
     */
    app.post("/api/admin/notifications/test", async (req: Request, res: Response, next) => {
        try {
            const userId = parseInt(req.body?.userId);
            if (!Number.isFinite(userId)) {
                return res.status(400).json({ success: false, message: "userId is required" });
            }

            const result = await NotificationService.sendToUser(
                userId,
                req.body?.title || "UniteFix test notification",
                req.body?.body || "If you can see this, push notifications are working.",
                "system",
                { test: "true" },
            );

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    });
}
