/**
 * FTTH plan add-ons: itemisation and the money that follows from it.
 *
 *   npm run smoke:ftth-addons
 *
 * Run with tsx so it prices through the REAL FtthService.quote() rather than a
 * copy of its arithmetic — a test that reimplements the rule it checks proves
 * only that the author was consistent twice.
 *
 * What matters here is that add-ons are ADDITIVE and settle to the operator:
 *   - a plan with no add-ons must price exactly as it did before this feature
 *     existed, because every live plan is one of those;
 *   - mandatory add-ons are always billed, optional ones only when chosen;
 *   - an id the customer made up cannot conjure a line onto the bill, and a
 *     mandatory add-on cannot be declined by omitting it;
 *   - the convenience fee does NOT scale with the number of lines; and
 *   - every rupee of add-on flows to operatorPayable, none to platformRevenue.
 *
 * Creates its own operator/plan/add-on fixtures and deletes them in a finally.
 */

import 'dotenv/config';
import { db } from '../server/db';
import { eq } from 'drizzle-orm';
import { ftthOperators, ftthPlans, ftthPlanAddons } from '@shared/schema';
import { FtthService } from '../server/services/ftth.service';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const R = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;

async function main() {
    const stamp = Date.now().toString(36).toUpperCase();
    let operatorId = 0;
    let planId = 0;

    try {
        // ── fixtures ────────────────────────────────────────────────────────
        // A fixed convenience fee so the assertions do not depend on whatever
        // platform config happens to hold on this machine.
        const [operator] = await db.insert(ftthOperators).values({
            companyName: `QA Addons ${stamp}`,
            contactEmail: `qa-addons-${stamp}@example.invalid`,
            contactPhone: '9000000000',
            status: 'active',
            convenienceFeePaise: 1000,          // Rs.10
        }).returning();
        operatorId = operator.id;

        // The user's own example: 30 Mbps at Rs.471.
        const [plan] = await db.insert(ftthPlans).values({
            operatorId,
            name: `QA 30 Mbps ${stamp}`,
            speedMbps: 30,
            durationMonths: 1,
            listPricePaise: 47_100,             // Rs.471
            discountPaise: 0,
        }).returning();
        planId = plan.id;

        // ── a plan with no add-ons must be untouched ────────────────────────
        // Every plan in production today is this case. If it moves by a paisa,
        // the feature has repriced live plans.
        {
            const q = await FtthService.quote(plan, operatorId);
            check('a plan with no add-ons prices exactly as before',
                q.totalPaise === 47_100 + 1_000, R(q.totalPaise));
            check('...with no add-on lines and a zero add-on total',
                q.addons.length === 0 && q.addonsTotalPaise === 0);
            check('...and the operator is owed the plan, nothing more',
                q.operatorPayablePaise === 47_100, R(q.operatorPayablePaise));
        }

        // ── a mandatory add-on: telephone at Rs.118 ─────────────────────────
        const [phone] = await db.insert(ftthPlanAddons).values({
            planId,
            label: 'Telephone',
            kind: 'telephone',
            amountPaise: 11_800,                // Rs.118
            isOptional: false,
            sortOrder: 0,
        }).returning();

        {
            const q = await FtthService.quote(plan, operatorId);
            check('a mandatory add-on is billed without being asked for',
                q.addons.length === 1 && q.addons[0].label === 'Telephone');
            check('30 Mbps Rs.471 + Telephone Rs.118 totals Rs.589 before the fee',
                q.listPricePaise + q.addonsTotalPaise === 58_900,
                R(q.listPricePaise + q.addonsTotalPaise));
            check('...and Rs.599 with the convenience fee',
                q.totalPaise === 59_900, R(q.totalPaise));
            check('the add-on is the operator\'s supply — every paisa settles to them',
                q.operatorPayablePaise === 58_900, R(q.operatorPayablePaise));
            check('...and UniteFix takes nothing from it',
                q.platformRevenuePaise === 1_000 - q.gstOnConvenienceFeePaise,
                R(q.platformRevenuePaise));
        }

        // ── an optional add-on: OTT at Rs.149 ───────────────────────────────
        const [ott] = await db.insert(ftthPlanAddons).values({
            planId,
            label: 'OTT Pack',
            kind: 'ott',
            amountPaise: 14_900,                // Rs.149
            isOptional: true,
            sortOrder: 1,
        }).returning();

        {
            const q = await FtthService.quote(plan, operatorId);
            check('an optional add-on is NOT billed unless it is chosen',
                q.addons.length === 1 && q.addonsTotalPaise === 11_800, R(q.addonsTotalPaise));

            const picked = await FtthService.quote(plan, operatorId, [ott.id]);
            check('...and IS billed once it is',
                picked.addons.length === 2 && picked.addonsTotalPaise === 26_700,
                R(picked.addonsTotalPaise));
            check('the whole bill adds up: 471 + 118 + 149 + 10',
                picked.totalPaise === 47_100 + 11_800 + 14_900 + 1_000,
                R(picked.totalPaise));
            check('the convenience fee does NOT multiply with the lines',
                picked.convenienceFeePaise === 1_000, R(picked.convenienceFeePaise));
        }

        // ── what a crafted request cannot do ────────────────────────────────
        {
            const q = await FtthService.quote(plan, operatorId, [999_999_999]);
            check('an unknown add-on id adds nothing to the bill',
                q.addonsTotalPaise === 11_800, R(q.addonsTotalPaise));

            // Naming a mandatory add-on changes nothing; NOT naming it must also
            // change nothing, or "mandatory" would mean "on by default".
            const named = await FtthService.quote(plan, operatorId, [phone.id]);
            check('naming a mandatory add-on does not bill it twice',
                named.addonsTotalPaise === 11_800, R(named.addonsTotalPaise));
            check('omitting a mandatory add-on does not decline it',
                q.addons.some(a => a.label === 'Telephone'));
        }

        // ── add-ons from another plan ───────────────────────────────────────
        {
            const [other] = await db.insert(ftthPlans).values({
                operatorId,
                name: `QA 100 Mbps ${stamp}`,
                speedMbps: 100,
                durationMonths: 1,
                listPricePaise: 99_900,
                discountPaise: 0,
            }).returning();

            const q = await FtthService.quote(other, operatorId, [ott.id]);
            check('an add-on belonging to a different plan cannot be bought here',
                q.addons.length === 0 && q.addonsTotalPaise === 0,
                `${q.addons.length} line(s)`);

            await db.delete(ftthPlans).where(eq(ftthPlans.id, other.id));
        }

        // ── retiring an add-on ──────────────────────────────────────────────
        {
            await db.update(ftthPlanAddons).set({ isActive: false })
                .where(eq(ftthPlanAddons.id, phone.id));

            const q = await FtthService.quote(plan, operatorId, [ott.id]);
            check('a retired add-on stops being billed',
                !q.addons.some(a => a.label === 'Telephone'));
            check('...and the total falls by exactly its amount',
                q.totalPaise === 47_100 + 14_900 + 1_000, R(q.totalPaise));
        }

        // ── discount interacts correctly ────────────────────────────────────
        {
            await db.update(ftthPlanAddons).set({ isActive: true })
                .where(eq(ftthPlanAddons.id, phone.id));
            const [discounted] = await db.update(ftthPlans)
                .set({ discountPaise: 5_000 })   // Rs.50 off the broadband line
                .where(eq(ftthPlans.id, planId)).returning();

            const q = await FtthService.quote(discounted, operatorId);
            check('a plan discount reduces the broadband line, not the add-ons',
                q.operatorPayablePaise === 47_100 - 5_000 + 11_800,
                R(q.operatorPayablePaise));
            check('...and the add-on total is untouched by it',
                q.addonsTotalPaise === 11_800, R(q.addonsTotalPaise));
        }

    } finally {
        // Fixtures out, in FK order. Add-ons cascade with the plan, but deleting
        // explicitly keeps this readable when a case above fails early.
        if (planId) {
            await db.delete(ftthPlanAddons).where(eq(ftthPlanAddons.planId, planId));
            await db.delete(ftthPlans).where(eq(ftthPlans.id, planId));
        }
        if (operatorId) {
            await db.delete(ftthPlans).where(eq(ftthPlans.operatorId, operatorId));
            await db.delete(ftthOperators).where(eq(ftthOperators.id, operatorId));
        }
    }
}

main()
    .then(() => {
        const passed = results.filter(r => r.pass).length;
        console.log(`\n${passed}/${results.length} passed`);
        process.exit(passed === results.length ? 0 : 1);
    })
    .catch((err) => {
        console.error('\nSmoke run failed:', err?.message ?? err);
        process.exit(1);
    });
