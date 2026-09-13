/**
 * Backfill: one business_partners row per ftth_operators row that has none.
 *
 *   npx tsx scripts/backfill-business-partners.ts --dry-run
 *   npx tsx scripts/backfill-business-partners.ts
 *
 * An ISP is one vertical of a business partner. Until this runs, existing
 * operators have no party row and cannot use anything under /api/b2b — FTTH
 * itself is unaffected either way, because every FTTH route still reads
 * ftth_operators directly.
 *
 * Copies the generic fields (name, GSTIN, contact, status, portal login,
 * approval) onto the party, attaches the 'isp' vertical, and points
 * ftth_operators.business_partner_id at it. FTTH-specific terms (lead fee,
 * convenience fee) stay where they are. Idempotent: a second run finds no
 * unlinked operators and does nothing.
 */

import 'dotenv/config';
import { BusinessPartnerService } from '../server/services/business-partner.service';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Backfilling business partners from FTTH operators…\n`);
    const done = await BusinessPartnerService.backfillFromFtthOperators(DRY_RUN);

    if (!done.length) {
        console.log('Nothing to do — every operator already has a business partner.');
        return;
    }
    for (const r of done) {
        console.log(`  operator #${r.operatorId}  ${r.companyName.padEnd(36)} → ${r.partnerCode ?? '(would create)'}`);
    }
    console.log(`\n${DRY_RUN ? 'Would create' : 'Created'} ${done.length} business partner(s), vertical 'isp', FTTH untouched.`);
}

main()
    .then(() => process.exit(0))
    .catch((err) => { console.error('\nBackfill failed:', err?.message ?? err); process.exit(1); });
