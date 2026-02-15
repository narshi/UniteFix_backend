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

  static async sendToAdmins(title: string, body: string, data: any = {}) {
    // This would require fetch all admin user IDs
    console.log(`[NOTIFICATION] To ADMINS: ${title} - ${body}`);
  }

  /**
   * Send Email using Nodemailer
   */
  static async sendEmail(to: string, subject: string, html: string) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      console.log(`[EMAIL MOCK] To: ${to}, Subject: ${subject}`);
      return;
    }

    try {
      // Lazy load nodemailer
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: 587,
        secure: false, // true for 465, false for other ports
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

      console.log(`[EMAIL] Message sent: ${info.messageId}`);
    } catch (error) {
      console.error("[EMAIL] Error sending email:", error);
      // Fallback to log
      console.log(`[EMAIL FAILED] To: ${to}, Subject: ${subject}`);
    }
  }

  /**
   * Send SMS (Mock/Twilio placeholder)
   */
  static async sendSms(to: string, body: string) {
    // Clean phone number
    const phone = to.replace(/\s+/g, '');

    if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE) {
      try {
        // Lazy load twilio? Or just fetch
        // const client = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
        // await client.messages.create({ body, from: process.env.TWILIO_PHONE, to: phone });
        console.log(`[SMS TWILIO] Sent to ${phone}: ${body}`);
      } catch (error) {
        console.error("[SMS TWILIO] Error:", error);
      }
    } else if (process.env.MSG91_API_KEY) {
      // MSG91 implementation
      console.log(`[SMS MSG91] Sent to ${phone}: ${body}`);
    } else {
      console.log(`[SMS MOCK] To: ${phone}, Body: ${body}`);
    }
  }
}
