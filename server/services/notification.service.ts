/**
 * Notification Service
 *
 * One entry point for every outbound message the platform sends:
 *   - Push  → Firebase Cloud Messaging (native FCM device tokens)
 *   - Email → Nodemailer/SMTP
 *   - SMS   → MSG91 or Twilio
 *
 * Every push is ALSO persisted to the `notifications` table so the in-app
 * notification list survives a device that was offline, reinstalled, or had
 * notifications muted at the OS level.
 *
 * SETUP (push):
 * 1. Firebase project + Cloud Messaging API (V1) enabled.
 * 2. Service account key → GOOGLE_APPLICATION_CREDENTIALS (path) or
 *    FCM_SERVICE_ACCOUNT_JSON (inline JSON).
 * 3. Mobile app registers its NATIVE FCM token via POST /api/notifications/register.
 *    (Expo push tokens — `ExponentPushToken[...]` — are NOT FCM tokens and are
 *    rejected here; see mobile/src/services/notifications.ts.)
 */

import { storage } from "../storage";
import { db } from "../db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { deviceTokens, users, employees } from "@shared/schema";
import logger from "../lib/logger";
import { admin, isMessagingReady } from "../lib/firebase";

/** FCM caps a multicast at 500 tokens per request. */
const FCM_MULTICAST_LIMIT = 500;

/**
 * Max ids per `IN (...)` clause. Postgres allows 65535 bind parameters per
 * statement, and a broadcast can resolve to every user on the platform — so
 * every id list that reaches a query gets chunked.
 */
const ID_CHUNK = 5000;

function chunked<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

/**
 * Notification types. The mobile app switches on these for deep linking, and
 * Android routes them to the channel named below.
 */
export type NotificationType =
    // Customer — service lifecycle
    | "service_created"
    | "service_assigned"
    | "service_accepted"
    | "service_reached"
    | "service_started"
    | "service_bill_ready"
    | "service_completed"
    | "service_cancelled"
    | "service_disputed"
    // Partner — assignment lifecycle
    | "assignment_new"
    | "assignment_reassigned"
    | "assignment_cancelled"
    | "assignment_reminder"
    // Money
    | "payment_received"
    | "payment_failed"
    | "wallet_credited"
    | "wallet_released"
    | "withdrawal_approved"
    | "withdrawal_rejected"
    // Account
    | "verification_approved"
    | "verification_rejected"
    | "account_suspended"
    // Orders
    | "order_update"
    // Broadcast
    | "marketing"
    | "system";

/**
 * Android notification channels. These IDs must exist on the device — the app
 * creates them in mobile/src/services/notifications.ts. An unknown channel ID
 * makes Android drop the notification silently, so keep the two lists in sync.
 */
const CHANNEL_BY_TYPE: Record<string, string> = {
    service_created: "service-updates",
    service_assigned: "service-updates",
    service_accepted: "service-updates",
    service_reached: "service-updates",
    service_started: "service-updates",
    service_bill_ready: "service-updates",
    service_completed: "service-updates",
    service_cancelled: "service-updates",
    service_disputed: "service-updates",
    assignment_new: "assignments",
    assignment_reassigned: "assignments",
    assignment_cancelled: "assignments",
    assignment_reminder: "assignments",
    payment_received: "payments",
    payment_failed: "payments",
    wallet_credited: "payments",
    wallet_released: "payments",
    withdrawal_approved: "payments",
    withdrawal_rejected: "payments",
    verification_approved: "default",
    verification_rejected: "default",
    account_suspended: "default",
    order_update: "orders",
    marketing: "marketing",
    system: "default",
};

/** Audiences an admin can broadcast to. */
export type BroadcastAudience = "customers" | "experts" | "all";

/**
 * FCM error codes that mean "this token is dead, stop using it".
 * Anything else (quota, network, internal) is transient — keep the token.
 */
const DEAD_TOKEN_ERRORS = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
]);

export interface PushResult {
    /** Rows written to the `notifications` table. */
    persisted: number;
    /** Devices FCM accepted. */
    sent: number;
    /** Devices FCM rejected. */
    failed: number;
    /** Tokens deactivated because FCM said they are permanently invalid. */
    pruned: number;
    /** Set when push could not be attempted at all (missing credentials). */
    skippedReason?: string;
}

export class NotificationService {
    // ==================== DEVICE TOKENS ====================

    static async registerDevice(userId: number, token: string, platform: string) {
        if (!token) throw new Error("Token is required");
        return storage.addDeviceToken(userId, token, platform);
    }

    static async unregisterDevice(userId: number, token: string) {
        if (!token) throw new Error("Token is required");
        return storage.removeDeviceToken(userId, token);
    }

    /**
     * Active device tokens for a set of users, as a userId → tokens map.
     * `isActive` matters: removeDeviceToken() soft-deletes by flipping the flag,
     * and FCM prunes tokens the same way, so an unfiltered read would keep
     * pushing to devices that logged out months ago.
     */
    private static async getDeviceTokensFor(
        userIds: number[]
    ): Promise<Map<number, string[]>> {
        const map = new Map<number, string[]>();
        if (userIds.length === 0) return map;

        for (const idChunk of chunked(userIds, ID_CHUNK)) {
            const rows = await db
                .select({ userId: deviceTokens.userId, token: deviceTokens.token })
                .from(deviceTokens)
                .where(
                    and(
                        inArray(deviceTokens.userId, idChunk),
                        eq(deviceTokens.isActive, true)
                    )
                );

            for (const row of rows) {
                const list = map.get(row.userId) ?? [];
                list.push(row.token);
                map.set(row.userId, list);
            }
        }
        return map;
    }

    /** Soft-delete tokens FCM reported as permanently invalid. */
    private static async pruneTokens(tokens: string[]): Promise<void> {
        if (tokens.length === 0) return;
        for (const chunk of chunked(tokens, ID_CHUNK)) {
            await db
                .update(deviceTokens)
                .set({ isActive: false })
                .where(inArray(deviceTokens.token, chunk));
        }
        logger.warn(`[FCM] Deactivated ${tokens.length} invalid device token(s)`);
    }

    // ==================== SENDING ====================

    /**
     * Send to one user. Persists to the notification feed first, then pushes.
     * Never throws — a failed push must not roll back the business action that
     * triggered it.
     */
    static async sendToUser(
        userId: number,
        title: string,
        body: string,
        type: NotificationType | string = "system",
        data: Record<string, any> = {}
    ): Promise<PushResult> {
        return this.sendToUsers([userId], title, body, type, data);
    }

    /**
     * Send the same notification to many users. Used by lifecycle events
     * (1–2 recipients) and by admin marketing broadcasts (thousands).
     */
    static async sendToUsers(
        userIds: number[],
        title: string,
        body: string,
        type: NotificationType | string = "system",
        data: Record<string, any> = {}
    ): Promise<PushResult> {
        const result: PushResult = { persisted: 0, sent: 0, failed: 0, pruned: 0 };

        const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
        if (uniqueIds.length === 0) return result;

        // 1. Persist to the in-app feed. This is the durable record — it must
        //    succeed even when push is unavailable.
        try {
            const rows = uniqueIds.map((userId) => ({
                userId,
                title,
                body,
                type: String(type),
                data,
            }));
            await storage.createNotifications(rows);
            result.persisted = rows.length;
        } catch (error: any) {
            logger.error("[NOTIFICATION] Failed to persist notifications", {
                error: error.message,
                count: uniqueIds.length,
                title,
            });
        }

        // 2. Push.
        const tokenMap = await this.getDeviceTokensFor(uniqueIds);
        const allTokens = Array.from(tokenMap.values()).flat();

        if (allTokens.length === 0) {
            logger.debug("[NOTIFICATION] No active device tokens for recipients", {
                recipients: uniqueIds.length,
                title,
            });
            return result;
        }

        if (!isMessagingReady()) {
            result.skippedReason =
                "Firebase messaging credentials are not configured — push skipped (saved to in-app feed only)";
            logger.warn(`[FCM] ${result.skippedReason}`, { title, tokens: allTokens.length });
            return result;
        }

        const channelId = CHANNEL_BY_TYPE[String(type)] ?? "default";

        // FCM data values must all be strings.
        const stringData: Record<string, string> = { type: String(type) };
        for (const [key, value] of Object.entries(data)) {
            if (value === null || value === undefined) continue;
            stringData[key] = typeof value === "string" ? value : JSON.stringify(value);
        }

        const deadTokens: string[] = [];

        // Collapse repeat updates about the same booking into one notification
        // instead of stacking six of them through a job's lifecycle. Built
        // conditionally — firebase-admin rejects an explicit `tag: undefined`.
        const androidNotification: Record<string, any> = { channelId, sound: "default" };
        if (data.serviceId) {
            androidNotification.tag = `service-${data.serviceId}`;
        }

        for (let i = 0; i < allTokens.length; i += FCM_MULTICAST_LIMIT) {
            const chunk = allTokens.slice(i, i + FCM_MULTICAST_LIMIT);

            try {
                const response = await admin.messaging().sendEachForMulticast({
                    tokens: chunk,
                    notification: { title, body },
                    data: stringData,
                    android: {
                        priority: "high",
                        notification: androidNotification,
                    },
                    apns: {
                        payload: {
                            aps: { sound: "default", badge: 1, "content-available": 1 },
                        },
                    },
                });

                result.sent += response.successCount;
                result.failed += response.failureCount;

                response.responses.forEach((r, idx) => {
                    if (r.success) return;
                    const code = (r.error as any)?.code;
                    if (code && DEAD_TOKEN_ERRORS.has(code)) {
                        deadTokens.push(chunk[idx]);
                    } else {
                        logger.warn("[FCM] Transient send failure", {
                            code,
                            message: (r.error as any)?.message,
                        });
                    }
                });
            } catch (error: any) {
                result.failed += chunk.length;
                logger.error("[FCM] Multicast failed", { error: error.message, title });
            }
        }

        if (deadTokens.length > 0) {
            await this.pruneTokens(deadTokens);
            result.pruned = deadTokens.length;
        }

        logger.info("[FCM] Push dispatched", {
            title,
            type,
            recipients: uniqueIds.length,
            sent: result.sent,
            failed: result.failed,
            pruned: result.pruned,
        });

        return result;
    }

    /**
     * Fire-and-forget wrapper. Lifecycle hooks use this so a slow or failing
     * FCM call can never delay or break the API response that triggered it.
     */
    static notify(
        userId: number | null | undefined,
        title: string,
        body: string,
        type: NotificationType | string = "system",
        data: Record<string, any> = {}
    ): void {
        if (!userId) return;
        void this.sendToUser(userId, title, body, type, data).catch((error: any) => {
            logger.error("[NOTIFICATION] Background send failed", {
                error: error?.message,
                userId,
                title,
            });
        });
    }

    // ==================== AUDIENCES ====================

    /**
     * Resolve a broadcast audience to `users.id` values.
     *
     * "experts" means service experts (technicians). Their app login is a row in
     * `users` with role='serviceman'; `employees` holds the profile. Only
     * verified + active experts are targeted so rejected applicants and
     * suspended accounts do not receive campaigns.
     */
    static async getAudienceUserIds(
        audience: BroadcastAudience,
        options: { onlyWithDevice?: boolean } = {}
    ): Promise<number[]> {
        const ids = new Set<number>();

        if (audience === "customers" || audience === "all") {
            const rows = await db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(users.role, "user"),
                        eq(users.isActive, true),
                        isNull(users.deletedAt)
                    )
                );
            rows.forEach((r) => ids.add(r.id));
        }

        if (audience === "experts" || audience === "all") {
            // Deliberately NOT filtered on users.isActive.
            //
            // Experts are created with users.is_active = false ("employees need
            // admin approval"), and approving one only flips employees.is_active
            // — the user row is never updated. Requiring it here meant every
            // service expert resolved to zero, however many were verified and
            // had devices registered.
            //
            // employees.isActive + documentVerificationStatus IS the activation
            // state for an expert; users.deletedAt is what distinguishes a
            // deleted account from an unapproved one.
            const rows = await db
                .select({ id: users.id })
                .from(users)
                .innerJoin(employees, eq(employees.userId, users.id))
                .where(
                    and(
                        eq(users.role, "serviceman"),
                        isNull(users.deletedAt),
                        eq(employees.isActive, true),
                        eq(employees.documentVerificationStatus, "verified")
                    )
                );
            rows.forEach((r) => ids.add(r.id));
        }

        let userIds = Array.from(ids);

        if (options.onlyWithDevice && userIds.length > 0) {
            const reachable = new Set<number>();
            for (const idChunk of chunked(userIds, ID_CHUNK)) {
                const withDevice = await db
                    .selectDistinct({ userId: deviceTokens.userId })
                    .from(deviceTokens)
                    .where(
                        and(
                            inArray(deviceTokens.userId, idChunk),
                            eq(deviceTokens.isActive, true)
                        )
                    );
                withDevice.forEach((r) => reachable.add(r.userId));
            }
            userIds = userIds.filter((id) => reachable.has(id));
        }

        return userIds;
    }

    /** Headline counts for the admin broadcast composer. */
    static async getAudienceStats(): Promise<{
        customers: { total: number; reachable: number };
        experts: { total: number; reachable: number };
    }> {
        const [customers, customersReachable, experts, expertsReachable] = await Promise.all([
            this.getAudienceUserIds("customers"),
            this.getAudienceUserIds("customers", { onlyWithDevice: true }),
            this.getAudienceUserIds("experts"),
            this.getAudienceUserIds("experts", { onlyWithDevice: true }),
        ]);

        return {
            customers: { total: customers.length, reachable: customersReachable.length },
            experts: { total: experts.length, reachable: expertsReachable.length },
        };
    }

    /**
     * Admin marketing broadcast. Persists to every recipient's in-app feed and
     * pushes to every device they have registered.
     */
    static async broadcast(
        audience: BroadcastAudience,
        title: string,
        body: string,
        data: Record<string, any> = {}
    ): Promise<PushResult & { audience: BroadcastAudience; recipients: number }> {
        const userIds = await this.getAudienceUserIds(audience);

        logger.info("[BROADCAST] Starting", { audience, recipients: userIds.length, title });

        const result = await this.sendToUsers(userIds, title, body, "marketing", {
            ...data,
            audience,
        });

        return { ...result, audience, recipients: userIds.length };
    }

    /**
     * Operational alert for the ops team. Admins sign in on the web dashboard
     * (adminUsers table) and have no device tokens, so this logs and — when
     * ADMIN_ALERT_EMAIL is configured — emails.
     */
    static async sendToAdmins(title: string, body: string, data: any = {}) {
        logger.info(`[NOTIFICATION] To ADMINS: ${title} - ${body}`, { data });

        const alertEmail = process.env.ADMIN_ALERT_EMAIL;
        if (!alertEmail) return;

        try {
            await this.sendEmail(
                alertEmail,
                `[UniteFix Alert] ${title}`,
                `<p>${body}</p><pre>${JSON.stringify(data, null, 2)}</pre>`
            );
        } catch (error: any) {
            logger.error("[NOTIFICATION] Admin alert email failed", { error: error.message });
        }
    }

    /**
     * Send Email using Nodemailer
     */
    static async sendEmail(to: string, subject: string, html: string) {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
            logger.warn(`[EMAIL MOCK] SMTP not configured — email NOT sent`, { to, subject });
            // Dev convenience only. Explicitly gated on NODE_ENV so a missing SMTP
            // config in production can never dump live OTP codes into the logs.
            if (process.env.NODE_ENV !== 'production') {
                const otpMatch = html.match(/>([0-9]{4,6})<\/span>/);
                if (otpMatch) {
                    logger.info(`[EMAIL MOCK OTP] Code for ${to}: ${otpMatch[1]}`);
                }
            }
            return;
        }

        try {
            const nodemailer = await import("nodemailer");
            const smtpPort = parseInt(process.env.SMTP_PORT || '587');

            // Port 465 = implicit TLS (Zoho India), 587 = STARTTLS (Gmail)
            const isSecure = smtpPort === 465;

            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: smtpPort,
                secure: isSecure,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
                connectionTimeout: 15000,
                greetingTimeout: 10000,
                socketTimeout: 15000,
                // Zoho may need this for TLS negotiation
                tls: {
                    rejectUnauthorized: false,
                },
            });

            logger.info(`[EMAIL] Connecting to ${process.env.SMTP_HOST}:${smtpPort} (secure: ${isSecure})`);

            // Verify SMTP connection is valid before sending
            try {
                await transporter.verify();
                logger.info(`[EMAIL] SMTP connection verified successfully`);
            } catch (verifyErr: any) {
                logger.error(`[EMAIL] SMTP connection FAILED`, {
                    error: verifyErr.message,
                    code: verifyErr.code,
                    host: process.env.SMTP_HOST,
                    port: smtpPort,
                    user: process.env.SMTP_USER,
                });
                throw verifyErr;
            }

            // IMPORTANT: Zoho requires the `from` address to EXACTLY match SMTP_USER
            const fromAddress = `"UniteFix" <${process.env.SMTP_USER}>`;

            const info = await transporter.sendMail({
                from: fromAddress,
                to,
                subject,
                html,
            });

            logger.info(`[EMAIL] Message sent`, { messageId: info.messageId, to });
        } catch (error: any) {
            logger.error("[EMAIL] Error sending email", {
                error: error.message,
                code: error.code,
                command: error.command,
                responseCode: error.responseCode,
                response: error.response,
                to,
            });
            throw new Error(`Email delivery failed: ${error.message}`);
        }
    }

    /**
     * Send SMS via MSG91 or Twilio
     */
    static async sendSms(to: string, body: string) {
        const phone = to.replace(/\s+/g, '');

        if (process.env.MSG91_API_KEY) {
            try {
                // MSG91 HTTP API integration
                const response = await fetch('https://api.msg91.com/api/v5/flow/', {
                    method: 'POST',
                    headers: {
                        'authkey': process.env.MSG91_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        flow_id: process.env.MSG91_FLOW_ID || '',
                        recipients: [{ mobiles: phone }],
                    }),
                });

                if (response.ok) {
                    logger.info(`[SMS MSG91] Sent to ${phone}`);
                } else {
                    const errorBody = await response.text();
                    logger.error(`[SMS MSG91] Failed`, { phone, status: response.status, body: errorBody });
                }
            } catch (error: any) {
                logger.error("[SMS MSG91] Error", { error: error.message, phone });
            }
        } else if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE) {
            try {
                // Twilio HTTP API (no SDK dependency)
                const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
                const response = await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${auth}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: new URLSearchParams({
                            From: process.env.TWILIO_PHONE,
                            To: phone,
                            Body: body,
                        }),
                    }
                );

                if (response.ok) {
                    logger.info(`[SMS TWILIO] Sent to ${phone}`);
                } else {
                    const errorBody = await response.text();
                    logger.error(`[SMS TWILIO] Failed`, { phone, status: response.status, body: errorBody });
                }
            } catch (error: any) {
                logger.error("[SMS TWILIO] Error", { error: error.message, phone });
            }
        } else {
            logger.info(`[SMS MOCK] To: ${phone}, Body: ${body}`);
        }
    }
}
