/**
 * Notification & Social Auth Repository
 * Extracted from storage.ts — device tokens, notifications, social providers
 */

import { db } from "../db";
import {
    socialAuthProviders, deviceTokens, notifications,
    type SocialAuthProvider, type InsertSocialAuth,
    type DeviceToken, type InsertDeviceToken,
    type Notification, type InsertNotification,
} from "@shared/schema";
import { eq, and, desc, count } from "drizzle-orm";

// ==================== SOCIAL AUTH ====================

export async function findSocialProvider(provider: string, providerId: string): Promise<SocialAuthProvider | undefined> {
    const [result] = await db.select()
        .from(socialAuthProviders)
        .where(and(
            eq(socialAuthProviders.provider, provider),
            eq(socialAuthProviders.providerId, providerId)
        ))
        .limit(1);
    return result || undefined;
}

export async function linkSocialProvider(data: InsertSocialAuth): Promise<SocialAuthProvider> {
    const [result] = await db
        .insert(socialAuthProviders)
        .values(data)
        .returning();
    return result;
}

// ==================== DEVICE TOKENS ====================

export async function addDeviceToken(userId: number, token: string, platform: string): Promise<DeviceToken> {
    const [result] = await db.insert(deviceTokens)
        .values({ userId, token, platform })
        .onConflictDoUpdate({
            target: [deviceTokens.userId, deviceTokens.token],
            set: {
                isActive: true,
                lastUsedAt: new Date(),
                platform
            }
        })
        .returning();
    return result;
}

export async function removeDeviceToken(userId: number, token: string): Promise<void> {
    await db.update(deviceTokens)
        .set({ isActive: false })
        .where(and(
            eq(deviceTokens.userId, userId),
            eq(deviceTokens.token, token)
        ));
}

// ==================== NOTIFICATIONS ====================

export async function createNotification(data: InsertNotification): Promise<Notification> {
    const [result] = await db
        .insert(notifications)
        .values(data)
        .returning();
    return result;
}

export async function getUserNotifications(
    userId: number,
    page: number = 1,
    limit: number = 20
): Promise<{ notifications: Notification[], total: number }> {
    const offset = (page - 1) * limit;

    const data = await db.select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

    const [countResult] = await db
        .select({ count: count() })
        .from(notifications)
        .where(eq(notifications.userId, userId));

    return {
        notifications: data,
        total: Number(countResult?.count || 0)
    };
}

export async function markNotificationRead(id: number): Promise<void> {
    await db.update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, userId));
}
