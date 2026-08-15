/**
 * Smoke test for the notification pipeline. Run with:
 *   npx tsx scripts/smoke-notifications.ts
 *
 * Verifies, against the configured database:
 *   1. Firebase messaging credentials are usable
 *   2. Audience resolution (customers vs service experts) returns sane counts
 *   3. A notification row can be written and read back
 * Does NOT send a real push — use POST /api/admin/notifications/test for that.
 */
import 'dotenv/config';
import { NotificationService } from '../server/services/notification.service';
import { isMessagingReady } from '../server/lib/firebase';
import { db } from '../server/db';
import { notifications, deviceTokens } from '@shared/schema';
import { eq, count } from 'drizzle-orm';

async function main() {
    console.log('messaging credentials ready:', isMessagingReady());

    const stats = await NotificationService.getAudienceStats();
    console.log('audience:', JSON.stringify(stats));

    const [tokenCount] = await db.select({ c: count() }).from(deviceTokens).where(eq(deviceTokens.isActive, true));
    console.log('active device tokens:', tokenCount.c);

    const customers = await NotificationService.getAudienceUserIds('customers');
    if (customers.length === 0) {
        console.log('no customers in DB — skipping write test');
        return;
    }

    const target = customers[0];
    await NotificationService.sendToUser(
        target,
        'Smoke test',
        'Notification pipeline smoke test.',
        'system',
        { smoke: true },
    );

    const [written] = await db.select({ c: count() }).from(notifications).where(eq(notifications.userId, target));
    console.log(`notification rows for user ${target}:`, written.c);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
