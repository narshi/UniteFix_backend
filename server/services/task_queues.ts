/**
 * Background Job Scheduler
 * 
 * Handles periodic background tasks using node-cron:
 * 1. WALLET HOLD RELEASE — Release held funds after hold period expires
 * 2. RETURN WINDOW EXPIRY — Auto-expire return requests after window closes
 * 3. OTP CLEANUP — Purge expired unverified OTPs
 * 4. NOTIFICATION CLEANUP — Archive old read notifications
 * 
 * All jobs are idempotent (safe to re-run).
 * Uses simple setInterval for zero external dependencies.
 */

import { db } from "../db";
import { sql, eq, and, lt, lte } from "drizzle-orm";
import {
    partnerWallets,
    walletTransactionsV2,
    serviceOtps,
    notifications,
} from "@shared/schema";
import logger from "../lib/logger";

// ==================== JOB 1: WALLET HOLD RELEASE ====================
/**
 * Release held wallet funds where releaseDate has passed.
 * Moves funds from balanceHold → balanceAvailable.
 * Runs every hour.
 */
async function releaseHeldWalletFunds(): Promise<void> {
    try {
        // Find unreleased transactions past their release date
        const pendingReleases = await db
            .select()
            .from(walletTransactionsV2)
            .where(
                and(
                    eq(walletTransactionsV2.isReleased, false),
                    eq(walletTransactionsV2.transactionType, 'hold_credit'),
                    lte(walletTransactionsV2.releaseDate, new Date())
                )
            );

        if (pendingReleases.length === 0) return;

        logger.info(`[CRON] Releasing ${pendingReleases.length} held wallet transactions`);

        for (const txn of pendingReleases) {
            try {
                await db.transaction(async (tx) => {
                    // Mark transaction as released
                    await tx
                        .update(walletTransactionsV2)
                        .set({ isReleased: true })
                        .where(eq(walletTransactionsV2.id, txn.id));

                    // Move funds: hold → available
                    await tx
                        .update(partnerWallets)
                        .set({
                            balanceHold: sql`${partnerWallets.balanceHold} - ${txn.amount}`,
                            balanceAvailable: sql`${partnerWallets.balanceAvailable} + ${txn.amount}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(partnerWallets.partnerId, txn.partnerId));

                    logger.info(`[CRON] Released ₹${txn.amount} for partner ${txn.partnerId}, service ${txn.serviceRequestId}`);
                });
            } catch (err: any) {
                logger.error(`[CRON] Failed to release txn ${txn.id}`, { error: err.message });
                // Continue with next — don't block other releases
            }
        }
    } catch (err: any) {
        logger.error('[CRON] Wallet release job failed', { error: err.message });
    }
}

// ==================== JOB 2: RETURN WINDOW EXPIRY ====================
/**
 * Auto-expire return requests that have passed their window.
 * Runs every hour.
 */
async function expireReturnWindows(): Promise<void> {
    try {
        // Use raw SQL since returnRequests may not be imported
        const result = await db.execute(sql`
      UPDATE return_requests
      SET status = 'rejected',
          admin_remarks = 'Auto-expired: return window closed',
          updated_at = NOW()
      WHERE status = 'requested'
        AND return_window_expires_at IS NOT NULL
        AND return_window_expires_at <= NOW()
    `);

        const count = (result as any).rowCount || 0;
        if (count > 0) {
            logger.info(`[CRON] Auto-expired ${count} return request(s)`);
        }
    } catch (err: any) {
        logger.error('[CRON] Return window expiry job failed', { error: err.message });
    }
}

// ==================== JOB 3: OTP CLEANUP ====================
/**
 * Purge expired, unverified OTPs older than 24 hours.
 * Runs daily.
 */
async function cleanupExpiredOtps(): Promise<void> {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

        const result = await db
            .delete(serviceOtps)
            .where(
                and(
                    eq(serviceOtps.isVerified, false),
                    lt(serviceOtps.expiresAt, cutoff)
                )
            );

        const count = (result as any).rowCount || 0;
        if (count > 0) {
            logger.info(`[CRON] Cleaned up ${count} expired OTP(s)`);
        }
    } catch (err: any) {
        logger.error('[CRON] OTP cleanup job failed', { error: err.message });
    }
}

// ==================== JOB 4: NOTIFICATION CLEANUP ====================
/**
 * Delete read notifications older than 30 days.
 * Runs weekly.
 */
async function cleanupOldNotifications(): Promise<void> {
    try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

        const result = await db
            .delete(notifications)
            .where(
                and(
                    eq(notifications.isRead, true),
                    lt(notifications.createdAt, cutoff)
                )
            );

        const count = (result as any).rowCount || 0;
        if (count > 0) {
            logger.info(`[CRON] Cleaned up ${count} old notification(s)`);
        }
    } catch (err: any) {
        logger.error('[CRON] Notification cleanup job failed', { error: err.message });
    }
}

// ==================== JOB 5: LOW STOCK ALERTS ====================
/**
 * Check for product variants with stock at or below their threshold.
 * Logs warnings for admin review. Runs every 6 hours.
 */
async function checkLowStockAlerts(): Promise<void> {
    try {
        // Dynamic import to avoid circular dependencies
        const { getLowStockVariants } = await import("./product-catalog.service");
        const lowStockItems = await getLowStockVariants();

        if (lowStockItems.length === 0) return;

        logger.warn(`[CRON] ${lowStockItems.length} product variant(s) below stock threshold`, {
            items: lowStockItems.map(item => ({
                product: item.productName,
                brand: item.brandName,
                variant: item.variantLabel,
                sku: item.sku,
                stock: item.stock,
                threshold: item.lowStockThreshold,
            })),
        });

        // TODO: Send admin notification via NotificationService when admin device tokens are available
    } catch (err: any) {
        logger.error('[CRON] Low stock alert job failed', { error: err.message });
    }
}

// ==================== JOB 6: REFRESH TOKEN CLEANUP ====================
/**
 * Clean up expired refresh tokens from the database.
 * Runs daily to prevent table bloat.
 */
async function cleanupExpiredRefreshTokens(): Promise<void> {
    try {
        const { TokenService } = await import("./token.service");
        const count = await TokenService.cleanupExpiredTokens();
        if (count > 0) {
            logger.info(`[CRON] Cleaned up ${count} expired refresh token(s)`);
        }
    } catch (err: any) {
        logger.error('[CRON] Refresh token cleanup job failed', { error: err.message });
    }
}

// ==================== SCHEDULER ====================

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SIX_HOURS = 6 * HOUR;

let intervals: NodeJS.Timeout[] = [];

/**
 * Start all background jobs.
 * Call this from server startup after DB is ready.
 */
export function startBackgroundJobs(): void {
    logger.info('[CRON] Starting background job scheduler');

    // Run wallet release every hour
    intervals.push(setInterval(releaseHeldWalletFunds, HOUR));
    // Run initial check after 30 seconds (give server time to start)
    setTimeout(releaseHeldWalletFunds, 30000);

    // Run return window expiry every hour
    intervals.push(setInterval(expireReturnWindows, HOUR));
    setTimeout(expireReturnWindows, 35000);

    // Run OTP cleanup daily
    intervals.push(setInterval(cleanupExpiredOtps, DAY));
    setTimeout(cleanupExpiredOtps, 40000);

    // Run notification cleanup weekly
    intervals.push(setInterval(cleanupOldNotifications, WEEK));
    setTimeout(cleanupOldNotifications, 45000);

    // Run low stock alerts every 6 hours
    intervals.push(setInterval(checkLowStockAlerts, SIX_HOURS));
    setTimeout(checkLowStockAlerts, 50000);

    // Run refresh token cleanup daily
    intervals.push(setInterval(cleanupExpiredRefreshTokens, DAY));
    setTimeout(cleanupExpiredRefreshTokens, 55000);

    logger.info('[CRON] Background jobs scheduled: wallet-release(1h), return-expiry(1h), otp-cleanup(24h), notification-cleanup(7d), low-stock-alerts(6h), refresh-token-cleanup(24h)');
}

/**
 * Stop all background jobs.
 * Call this during graceful shutdown.
 */
export function stopBackgroundJobs(): void {
    logger.info('[CRON] Stopping background jobs');
    for (const interval of intervals) {
        clearInterval(interval);
    }
    intervals = [];
}
