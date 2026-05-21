/**
 * BACKFILL SCRIPT: Populate pricing_snapshot for existing bookings
 * 
 * This script:
 * 1. Finds all service_requests where pricing_snapshot IS NULL
 * 2. Uses BillingEngine.buildLegacySnapshot() to wrap existing DB values
 * 3. Writes the synthetic snapshot back — NO financial values change
 * 
 * Safe to run multiple times (idempotent — only updates NULL snapshots).
 * 
 * Usage: npx tsx server/scripts/backfill-pricing-snapshots.ts
 */

import { db } from '../db';
import { serviceRequests } from '@shared/schema';
import { eq, isNull } from 'drizzle-orm';
import { BillingEngine } from '../services/billing-engine';

async function backfillPricingSnapshots() {
    console.log('[BACKFILL] Starting pricing snapshot backfill...');

    // Find all bookings without a snapshot
    const bookingsWithoutSnapshot = await db
        .select({
            id: serviceRequests.id,
            serviceId: serviceRequests.serviceId,
            bookingFee: serviceRequests.bookingFee,
            totalAmount: serviceRequests.totalAmount,
            commissionAmount: serviceRequests.commissionAmount,
            status: serviceRequests.status,
        })
        .from(serviceRequests)
        .where(isNull(serviceRequests.pricingSnapshot));

    console.log(`[BACKFILL] Found ${bookingsWithoutSnapshot.length} bookings without pricing snapshot`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const booking of bookingsWithoutSnapshot) {
        try {
            const snapshot = BillingEngine.buildLegacySnapshot({
                bookingFee: booking.bookingFee,
                totalAmount: booking.totalAmount,
                commissionAmount: booking.commissionAmount,
            });

            await db.update(serviceRequests)
                .set({ pricingSnapshot: snapshot as any })
                .where(eq(serviceRequests.id, booking.id));

            updated++;
            console.log(`  [OK] ${booking.serviceId} (status: ${booking.status}, totalAmount: ₹${booking.totalAmount ?? 'N/A'})`);
        } catch (err: any) {
            errors++;
            console.error(`  [ERR] ${booking.serviceId}: ${err.message}`);
        }
    }

    console.log(`\n[BACKFILL] Complete.`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Errors:  ${errors}`);
    console.log(`  Total:   ${bookingsWithoutSnapshot.length}`);

    process.exit(errors > 0 ? 1 : 0);
}

backfillPricingSnapshots().catch((err) => {
    console.error('[BACKFILL] Fatal error:', err);
    process.exit(1);
});
