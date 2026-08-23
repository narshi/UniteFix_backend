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
    serviceRequests,
} from "@shared/schema";
import logger from "../lib/logger";
import { BookingNotifications } from "./booking-notifications";
import { NotificationService } from "./notification.service";

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

                // Sent after the transaction commits — the expert should only be
                // told the money is withdrawable once it actually is.
                void BookingNotifications.walletReleased(txn.partnerId, txn.amount);
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

        void NotificationService.sendToAdmins(
            `${lowStockItems.length} item(s) low on stock`,
            lowStockItems
                .slice(0, 10)
                .map((item) => `${item.productName} (${item.variantLabel}) — ${item.stock} left`)
                .join('\n'),
            { count: lowStockItems.length },
        );
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

// ==================== JOB 7: ASSIGNMENT TIMEOUT ====================
/**
 * PHASE 6: Auto-revert stale ASSIGNED bookings to CREATED.
 * If an employee doesn't accept within PARTNER_ACCEPT_TIMEOUT_HOURS (default: 4h),
 * the assignment is reverted so admin can reassign.
 * Runs every 15 minutes.
 */
async function revertStaleAssignments(): Promise<void> {
    try {
        // Get timeout from config (default 4 hours)
        const { configService } = await import("./config.service");
        const timeoutHoursStr = await configService.get<string>('OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS');
        const timeoutHours = parseInt(timeoutHoursStr || '4');
        const cutoffMs = timeoutHours * 60 * 60 * 1000;
        const cutoff = new Date(Date.now() - cutoffMs);

        // Read the affected rows first: the UPDATE nulls provider_id, so
        // RETURNING would hand back the already-cleared value and there would be
        // no way to tell the expert their job was taken back.
        const staleRows = await db.execute(sql`
            SELECT id, provider_id
            FROM service_requests
            WHERE status = 'assigned'
              AND assigned_at IS NOT NULL
              AND assigned_at <= ${cutoff}
        `) as any;
        const stale = (Array.isArray(staleRows) ? staleRows : staleRows?.rows || []) as Array<{
            id: number;
            provider_id: number | null;
        }>;

        if (stale.length === 0) return;

        const result = await db.execute(sql`
            UPDATE service_requests
            SET status = 'created',
                provider_id = NULL,
                assigned_at = NULL,
                admin_notes = COALESCE(admin_notes, '') || ${`\n[AUTO_REVERT ${new Date().toISOString()}] Assignment expired after ${timeoutHours}h — reverted to CREATED`},
                updated_at = NOW()
            WHERE status = 'assigned'
              AND assigned_at IS NOT NULL
              AND assigned_at <= ${cutoff}
        `);

        const count = (result as any).rowCount || stale.length;
        logger.warn(`[CRON] Auto-reverted ${count} stale ASSIGNED booking(s) (>${timeoutHours}h)`);

        for (const row of stale) {
            if (row.provider_id) {
                void BookingNotifications.assignmentRevoked(
                    row.provider_id,
                    row.id,
                    `not accepted within ${timeoutHours}h`,
                );
            }
        }

        void NotificationService.sendToAdmins(
            `${count} assignment(s) timed out`,
            `Bookings ${stale.map((r) => r.id).join(', ')} were not accepted within ${timeoutHours}h and are back in the queue.`,
            { bookingIds: stale.map((r) => r.id) },
        );
    } catch (err: any) {
        logger.error('[CRON] Assignment timeout job failed', { error: err.message });
    }
}

// ==================== JOB 8: ASSIGNMENT ACCEPTANCE REMINDER ====================
/**
 * Nudge experts sitting on an unaccepted assignment.
 *
 * Without this, the only assignment push an expert ever gets is the one at the
 * moment of assignment — if their phone was off or the app had no token yet,
 * the job silently ages out via revertStaleAssignments() and the customer waits
 * hours for nothing. Reminders go out once per interval between 30 minutes old
 * and the timeout, so a job is never both reminded and expired in the same tick.
 * Runs every 15 minutes.
 */
async function remindPendingAssignments(): Promise<void> {
    try {
        const { configService } = await import("./config.service");
        const timeoutHoursStr = await configService.get<string>('OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS');
        const timeoutHours = parseInt(timeoutHoursStr || '4');

        const olderThan = new Date(Date.now() - 30 * 60 * 1000);              // assigned >30m ago
        const notYetExpired = new Date(Date.now() - timeoutHours * 60 * 60 * 1000);

        const rows = await db.execute(sql`
            SELECT sr.id, sr.service_id, sr.service_type, e.user_id AS expert_user_id
            FROM service_requests sr
            JOIN employees e ON e.id = sr.provider_id
            WHERE sr.status = 'assigned'
              AND sr.assigned_at IS NOT NULL
              AND sr.assigned_at <= ${olderThan}
              AND sr.assigned_at > ${notYetExpired}
        `) as any;

        const pending = (Array.isArray(rows) ? rows : rows?.rows || []) as Array<{
            id: number;
            service_id: string;
            service_type: string | null;
            expert_user_id: number;
        }>;

        if (pending.length === 0) return;

        logger.info(`[CRON] Reminding ${pending.length} expert(s) about unaccepted assignments`);

        for (const row of pending) {
            NotificationService.notify(
                row.expert_user_id,
                'Job still waiting for you',
                `${row.service_type || 'A job'} — ${row.service_id} is still unaccepted. It will be reassigned if you don't accept it.`,
                'assignment_reminder',
                { serviceId: row.id, serviceRef: row.service_id, role: 'expert' },
            );
        }
    } catch (err: any) {
        logger.error('[CRON] Assignment reminder job failed', { error: err.message });
    }
}

// ==================== SCHEDULER ====================

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SIX_HOURS = 6 * HOUR;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

let intervals: NodeJS.Timeout[] = [];

/**
 * Start all background jobs.
 * Call this from server startup after DB is ready.
 */

/**
 * Remove bookings whose fee was never paid.
 *
 * The service_requests row has to exist before payment — the Razorpay order is
 * raised against it — so a customer who dismisses the payment sheet leaves a
 * created/pending row behind. The app tries to clean that up itself, but only
 * if it is still alive to do it: kill the app on the payment screen, or lose
 * signal, and the row survives. It then sits in the customer's list as a
 * booking they cannot pay for and cannot cancel.
 *
 * Thirty minutes is deliberately generous — a Razorpay payment resolves in
 * seconds, so anything still unpaid after half an hour was abandoned. Only
 * created/pending rows are touched: once a booking is assigned, or the fee is
 * paid, or the fee was zero, it is out of scope.
 */
async function expireAbandonedBookings(): Promise<void> {
    try {
        /**
         * The cutoff is computed by POSTGRES, not by Node.
         *
         * created_at is `timestamp without time zone` and is written by the
         * database default, so it holds server-local wall clock. Drizzle
         * serialises a JS Date as UTC, so passing `new Date(Date.now() - 30m)`
         * compared IST against UTC and the job silently deleted nothing —
         * the effective cutoff drifted by the whole timezone offset.
         */
        const result = await db
            .delete(serviceRequests)
            .where(
                and(
                    eq(serviceRequests.status, 'created' as any),
                    eq(serviceRequests.bookingFeeStatus, 'pending' as any),
                    sql`${serviceRequests.createdAt} < NOW() - INTERVAL '30 minutes'`,
                )
            );

        const removed = (result as any).rowCount || 0;
        if (removed > 0) {
            logger.info(`[CRON] Removed ${removed} abandoned unpaid booking(s)`);
        }
    } catch (error: any) {
        logger.error('[CRON] Abandoned-booking cleanup failed', { error: error.message });
    }
}

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

    // Runs on the same cadence as the assignment sweeps; abandoned payments are
    // discovered quickly enough that a customer retrying is not blocked by one.
    void expireAbandonedBookings();
    intervals.push(setInterval(expireAbandonedBookings, FIFTEEN_MINUTES));
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

    // PHASE 6: Revert stale assignments every 15 minutes
    intervals.push(setInterval(revertStaleAssignments, FIFTEEN_MINUTES));
    setTimeout(revertStaleAssignments, 60000);

    // Nudge experts on unaccepted assignments every 15 minutes. Offset from the
    // revert job so a booking is reverted before it can be reminded again.
    intervals.push(setInterval(remindPendingAssignments, FIFTEEN_MINUTES));
    setTimeout(remindPendingAssignments, 90000);

    logger.info('[CRON] Background jobs scheduled: wallet-release(1h), return-expiry(1h), otp-cleanup(24h), notification-cleanup(7d), low-stock-alerts(6h), refresh-token-cleanup(24h), assignment-timeout(15m), assignment-reminder(15m), abandoned-bookings(15m)');
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
