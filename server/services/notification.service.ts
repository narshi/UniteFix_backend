/**
 * PHASE 9: Notification Service
 * 
 * Handles push notifications via Firebase Cloud Messaging (FCM).
 * Integrates with storage for device tokens and notification history.
 */

import { storage } from "../storage";
import type { InsertNotification } from "@shared/schema";
// import admin from "firebase-admin";

// Initialize Firebase Admin (Commented out until config is provided)
/*
if (process.env.FCM_SERVER_KEY) {
  // admin.initializeApp({
  //   credential: admin.credential.applicationDefault() 
  //   // or user service account JSON
  // });
}
*/

export class NotificationService {
    /**
     * Register a device token for a user
     */
    static async registerDevice(userId: number, token: string, platform: string) {
        if (!token) throw new Error("Token is required");
        return storage.addDeviceToken(userId, token, platform);
    }

    /**
     * Unregister a device token
     */
    static async unregisterDevice(userId: number, token: string) {
        if (!token) throw new Error("Token is required");
        return storage.removeDeviceToken(userId, token);
    }

    /**
     * Send a notification to a specific user
     * - Saves to DB for history
     * - Sends via FCM if tokens exist
     */
    static async sendToUser(userId: number, title: string, body: string, type: string = "system", data: any = {}) {
        // 1. Save to database
        const notification = await storage.createNotification({
            userId,
            title,
            body,
            type,
            data,
            isRead: false,
        });

        // 2. Get active device tokens
        // Note: We don't have a getDeviceTokens method in storage yet, but effectively we'd need one.
        // For now, let's just log it.
        console.log(`[NOTIFICATION] To User ${userId}: ${title} - ${body}`);

        // TODO: Fetch tokens and send via FCM
        /*
        const tokens = await storage.getUserDeviceTokens(userId);
        if (tokens.length > 0) {
          const message = {
            notification: { title, body },
            data: { ...data, type, notificationId: String(notification.id) },
            tokens: tokens.map(t => t.token),
          };
          
          try {
            const response = await admin.messaging().sendMulticast(message);
            console.log(`[FCM] Sent: ${response.successCount}, Failed: ${response.failureCount}`);
          } catch (error) {
            console.error("[FCM] Error sending message:", error);
          }
        }
        */

        return notification;
    }

    /**
     * Send notification to all admins (e.g. new higher-value order)
     */
    static async sendToAdmins(title: string, body: string, data: any = {}) {
        // This would require fetch all admin user IDs
        console.log(`[NOTIFICATION] To ADMINS: ${title} - ${body}`);
    }
}
