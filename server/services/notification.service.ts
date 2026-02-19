/**
 * PHASE 9: Notification Service
 * 
 * Handles push notifications via Firebase Cloud Messaging (FCM).
 * Integrates with storage for device tokens and notification history.
 * 
 * SETUP REQUIRED:
 * 1. Create Firebase project at https://console.firebase.google.com
 * 2. Generate a service account key (Settings → Service Accounts → Generate new private key)
 * 3. Set GOOGLE_APPLICATION_CREDENTIALS env var to the path of the JSON key file
 *    OR set FCM_SERVICE_ACCOUNT_JSON to the JSON content directly
 */

import { storage } from "../storage";
import type { InsertNotification } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { deviceTokens } from "@shared/schema";
import logger from "../lib/logger";

// Firebase Admin — conditionally imported
let firebaseAdmin: any = null;
let fcmInitialized = false;

async function initializeFirebase(): Promise<boolean> {
  if (fcmInitialized) return !!firebaseAdmin;

  try {
    // Check if Firebase credentials are available
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FCM_SERVICE_ACCOUNT_JSON) {
      const admin = await import("firebase-admin");

      if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
        const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
        admin.default.initializeApp({
          credential: admin.default.credential.cert(serviceAccount),
        });
      } else {
        admin.default.initializeApp({
          credential: admin.default.credential.applicationDefault(),
        });
      }

      firebaseAdmin = admin.default;
      fcmInitialized = true;
      logger.info('[FCM] Firebase Admin initialized successfully');
      return true;
    } else {
      logger.warn('[FCM] No Firebase credentials found. Push notifications will be logged only.');
      fcmInitialized = true;
      return false;
    }
  } catch (error: any) {
    logger.error('[FCM] Failed to initialize Firebase Admin', { error: error.message });
    fcmInitialized = true;
    return false;
  }
}

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
   * Get active device tokens for a user
   */
  private static async getUserDeviceTokens(userId: number): Promise<string[]> {
    const tokens = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, userId));
    return tokens.map(t => t.token);
  }

  /**
   * Send a notification to a specific user
   * - Saves to DB for history
   * - Sends via FCM if tokens exist and Firebase is configured
   */
  static async sendToUser(userId: number, title: string, body: string, type: string = "system", data: any = {}) {
    // 1. Save to database
    const notification = await storage.createNotification({
      userId,
      title,
      body,
      type,
      data,
    });

    // 2. Try to send via FCM
    const tokens = await this.getUserDeviceTokens(userId);

    if (tokens.length === 0) {
      logger.debug(`[NOTIFICATION] No device tokens for user ${userId}`, { title });
      return notification;
    }

    await initializeFirebase();

    if (firebaseAdmin) {
      try {
        const message = {
          notification: { title, body },
          data: {
            ...Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, String(v)])
            ),
            type,
            notificationId: String(notification.id),
          },
          tokens,
        };

        const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
        logger.info(`[FCM] Sent to user ${userId}`, {
          successCount: response.successCount,
          failureCount: response.failureCount,
        });

        // Remove invalid tokens
        if (response.failureCount > 0) {
          const failedTokens = response.responses
            .map((r: any, i: number) => (!r.success ? tokens[i] : null))
            .filter(Boolean);

          for (const failedToken of failedTokens) {
            if (failedToken) {
              await storage.removeDeviceToken(userId, failedToken);
              logger.warn(`[FCM] Removed invalid token for user ${userId}`);
            }
          }
        }
      } catch (error: any) {
        logger.error("[FCM] Error sending message", { error: error.message, userId });
      }
    } else {
      // Fallback: log notification
      logger.info(`[NOTIFICATION] To User ${userId}: ${title} - ${body}`);
    }

    return notification;
  }

  static async sendToAdmins(title: string, body: string, data: any = {}) {
    logger.info(`[NOTIFICATION] To ADMINS: ${title} - ${body}`);
  }

  /**
   * Send Email using Nodemailer
   */
  static async sendEmail(to: string, subject: string, html: string) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      logger.info(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
      return;
    }

    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const info = await transporter.sendMail({
        from: process.env.ADMIN_EMAIL || '"UniteFix Support" <support@unitefix.com>',
        to,
        subject,
        html,
      });

      logger.info(`[EMAIL] Message sent`, { messageId: info.messageId, to });
    } catch (error: any) {
      logger.error("[EMAIL] Error sending email", { error: error.message, to });
      logger.info(`[EMAIL FAILED] To: ${to}, Subject: ${subject}`);
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
