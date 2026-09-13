/**
 * Backfill: turn self-priced plan add-ons into catalogue links.
 *
 *   npx tsx scripts/backfill-addon-catalog.ts --dry-run
 *   npx tsx scripts/backfill-addon-catalog.ts
 *   npx tsx scripts/backfill-addon-catalog.ts --operator=3
 *
 * Before the catalogue existed every add-on row carried its own price. This
 * walks those rows — and ONLY those rows, the ones with catalog_id IS NULL —
 * and for each operator:
 *
 *   1. creates one catalogue item per distinct (label, kind), priced at the
 *      most common amount across the plans that carry it;
 *   2. points each row at its item;
 *   3. sets price_override_paise ONLY where the row's amount differs from the
 *      catalogue default.
 *
 * Step 3 is the whole guarantee: after this runs, every plan prices to the
 * paisa as it did before. Rows that matched the default now follow the
 * catalogue; rows that did not keep their own figure as an override, visibly.
 * Nothing is repriced by this script. Ever.
 *
 * pricing_basis is always 'flat' here, because the row does not record whether
 * ₹1,416 on a 12-month plan meant "₹118 a month" or "₹1,416 once". The operator
 * flips the basis in the catalogue page afterwards, and can see what it does to
 * each plan before saving.
 *
 * Idempotent: a second run finds no NULL catalog_id rows and does nothing.
 * Per-operator transaction: an operator either migrates whole or not at all.
 */

import 'dotenv/config';
import { db } from '../server/db';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import { ftthOperators, ftthPlans, ftthPlanAddons, ftthAddonCatalog } from '@shared/schema';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_OPERATOR = (() => {
    const arg = process.argv.find(a => a.startsWith('--operator='));
    return arg ? parseInt(arg.split('=')[1], 10) : null;
})();

const rupees = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;

/** The most common value; ties go to the smallest, so a guess never rounds up. */
function mode<T extends number | boolean>(values: T[]): T {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0];
}

async function main() {
    const operators = await db.select({ id: ftthOperators.id, companyName: ftthOperators.companyName })
        .from(ftthOperators)
        .where(ONLY_OPERATOR ? eq(ftthOperators.id, ONLY_OPERATOR) : sql`true`)
        .orderBy(ftthOperators.id);

    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Backfilling add-on catalogue for ${operators.length} operator(s)\n`);

    let totalItems = 0, totalLinks = 0, totalOverrides = 0;

    for (const op of operators) {
        // Legacy rows on this operator's plans.
        const legacy = await db.select({
            id: ftthPlanAddons.id,
            planId: ftthPlanAddons.planId,
            label: ftthPlanAddons.label,
            kind: ftthPlanAddons.kind,
            amountPaise: ftthPlanAddons.amountPaise,
            isOptional: ftthPlanAddons.isOptional,
            description: ftthPlanAddons.description,
            durationMonths: ftthPlans.durationMonths,
        })
            .from(ftthPlanAddons)
            .innerJoin(ftthPlans, eq(ftthPlans.id, ftthPlanAddons.planId))
            .where(and(eq(ftthPlans.operatorId, op.id), isNull(ftthPlanAddons.catalogId)));

        if (!legacy.length) {
            console.log(`— ${op.companyName} (#${op.id}): nothing to migrate`);
            continue;
        }

        // Group by what the operator called it and what kind it is.
        const groups = new Map<string, typeof legacy>();
        for (const row of legacy) {
            const key = `${row.kind}::${row.label.trim().toLowerCase()}`;
            groups.set(key, [...(groups.get(key) ?? []), row]);
        }

        console.log(`— ${op.companyName} (#${op.id}): ${legacy.length} legacy row(s) → ${groups.size} catalogue item(s)`);

        let items = 0, links = 0, overrides = 0;

        const work = async (tx: typeof db) => {
            for (const rows of groups.values()) {
                const name = rows[0].label.trim();
                const kind = rows[0].kind;
                const defaultPrice = mode(rows.map(r => r.amountPaise));
                const defaultOptional = mode(rows.map(r => r.isOptional));
                const description = rows.find(r => r.description)?.description ?? null;

                // Reuse an item the operator has already created by hand with the
                // same name; the unique index would refuse a duplicate anyway.
                const [existing] = await tx.select().from(ftthAddonCatalog)
                    .where(and(eq(ftthAddonCatalog.operatorId, op.id), eq(ftthAddonCatalog.name, name)))
                    .limit(1);

                let catalogId: number;
                if (existing) {
                    catalogId = existing.id;
                    console.log(`    reuse   "${name}" (#${existing.id}) at ${rupees(existing.defaultPricePaise)}`);
                } else {
                    items += 1;
                    if (DRY_RUN) {
                        catalogId = -1;
                        console.log(`    create  "${name}" [${kind}] flat ${rupees(defaultPrice)}, ${defaultOptional ? 'optional' : 'always billed'}`);
                    } else {
                        const [created] = await tx.insert(ftthAddonCatalog).values({
                            operatorId: op.id,
                            name,
                            kind: kind as any,
                            description,
                            pricingBasis: 'flat',
                            defaultPricePaise: defaultPrice,
                            defaultOptional,
                        }).returning();
                        catalogId = created.id;
                        console.log(`    create  "${name}" (#${catalogId}) [${kind}] flat ${rupees(defaultPrice)}, ${defaultOptional ? 'optional' : 'always billed'}`);
                    }
                }

                const catalogueDefault = existing?.defaultPricePaise ?? defaultPrice;

                for (const row of rows) {
                    const override = row.amountPaise !== catalogueDefault ? row.amountPaise : null;
                    links += 1;
                    if (override !== null) overrides += 1;

                    console.log(
                        `      link  row #${row.id} (plan #${row.planId}, ${row.durationMonths}mo) `
                        + (override !== null
                            ? `OVERRIDE ${rupees(override)} (catalogue ${rupees(catalogueDefault)})`
                            : `follows catalogue ${rupees(catalogueDefault)}`),
                    );

                    if (!DRY_RUN) {
                        await tx.update(ftthPlanAddons)
                            .set({ catalogId, priceOverridePaise: override, updatedAt: new Date() })
                            .where(eq(ftthPlanAddons.id, row.id));
                    }
                }
            }
        };

        if (DRY_RUN) {
            await work(db);
        } else {
            await db.transaction(async (tx) => work(tx as unknown as typeof db));
        }

        console.log(`    ⇒ ${items} item(s) created, ${links} link(s) pointed, ${overrides} override(s) kept\n`);
        totalItems += items; totalLinks += links; totalOverrides += overrides;
    }

    console.log(`${DRY_RUN ? '[DRY RUN] would have: ' : 'Done: '}${totalItems} catalogue item(s), ${totalLinks} link(s), ${totalOverrides} override(s).`);
    if (totalOverrides > 0) {
        console.log(
            `\n${totalOverrides} row(s) kept their own price as an override because it differed from the\n`
            + `most common figure for that add-on. Nothing was repriced. Review them in the catalogue page.`,
        );
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('\nBackfill failed — nothing partially applied (per-operator transactions):', err?.message ?? err);
        process.exit(1);
    });
