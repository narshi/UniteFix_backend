import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../server/db';
import { serviceCategories, services } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Service Catalog Seeder — Phase 1 of the fixed-price pricing model.
 *
 * Reads scripts/catalog-data.json (generated from CATALOG-1.xlsx) and upserts the
 * categories and services with their base prices. Unlike the test-data seeder,
 * this is REAL production catalog data, so it is safe to run against prod.
 *
 * Safety:
 *   - Dry run by default. Prints what it WOULD do; writes nothing without --confirm.
 *   - Seeds DORMANT by default (is_active/is_home_visible = false) so the live app
 *     does not show the new catalog until the cut-over. Pass --activate to publish.
 *   - Idempotent: categories matched by unique name; services matched by
 *     (category, name). Re-running only updates prices, never duplicates.
 *
 * Usage:
 *   tsx scripts/seed-catalog.ts                     # dry run
 *   tsx scripts/seed-catalog.ts --confirm           # write, dormant (hidden)
 *   tsx scripts/seed-catalog.ts --confirm --activate# write and publish
 */

interface CatalogSvc { name: string; basePrice: number; sortOrder: number; }
interface CatalogCat { name: string; sortOrder: number; services: CatalogSvc[]; }

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const ACTIVATE = args.includes('--activate');

async function main() {
    const catalog: { categories: CatalogCat[] } = JSON.parse(
        readFileSync(join(process.cwd(), 'scripts', 'catalog-data.json'), 'utf8')
    );

    console.log('');
    console.log(`Catalog seed — ${CONFIRM ? 'LIVE (--confirm)' : 'DRY RUN'} — new rows are ` +
        `${ACTIVATE ? 'ACTIVE / VISIBLE (--activate)' : 'DORMANT / hidden'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    let catsNew = 0, svcInserted = 0, svcUpdated = 0;

    for (const cat of catalog.categories) {
        let [row] = await db.select().from(serviceCategories)
            .where(eq(serviceCategories.name, cat.name)).limit(1);

        if (!row) {
            catsNew++;
            console.log(`+ category  ${cat.name}`);
            if (CONFIRM) {
                [row] = await db.insert(serviceCategories)
                    .values({ name: cat.name, sortOrder: cat.sortOrder, isActive: ACTIVATE })
                    .returning();
            }
        }

        const categoryId = row?.id;

        for (const svc of cat.services) {
            let existing: { id: number } | undefined;
            if (categoryId) {
                [existing] = await db.select({ id: services.id }).from(services)
                    .where(and(eq(services.categoryId, categoryId), eq(services.name, svc.name)))
                    .limit(1);
            }

            if (existing) {
                svcUpdated++;
                if (CONFIRM) {
                    await db.update(services)
                        .set({ basePrice: svc.basePrice, updatedAt: new Date() })
                        .where(eq(services.id, existing.id));
                }
            } else {
                svcInserted++;
                console.log(`    + ${cat.name} › ${svc.name}  ₹${svc.basePrice}`);
                if (CONFIRM && categoryId) {
                    await db.insert(services).values({
                        categoryId,
                        name: svc.name,
                        basePrice: svc.basePrice,
                        sortOrder: svc.sortOrder,
                        isActive: ACTIVATE,
                        isHomeVisible: ACTIVATE,
                    });
                }
            }
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Categories: ${catsNew} new · Services: ${svcInserted} inserted, ${svcUpdated} price-updated`);
    if (!CONFIRM) {
        console.log('\nDRY RUN — nothing written. Re-run with --confirm to apply.');
        console.log('Add --activate to publish the catalog (default is hidden).');
    }
    process.exit(0);
}

main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });
