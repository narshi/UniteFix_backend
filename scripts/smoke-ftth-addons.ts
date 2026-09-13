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
import { ftthOperators, ftthPlans, ftthPlanAddons, ftthAddonCatalog } from '@shared/schema';
import { FtthService, AddonSelectionError, resolveAddon } from '../server/services/ftth.service';

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

            // Put the plan back to list price for the catalogue cases below.
            await db.update(ftthPlans).set({ discountPaise: 0 }).where(eq(ftthPlans.id, planId));
        }

        // ════════════════════════════════════════════════════════════════════
        // Phase 1: the catalogue. Price in one place, derived per plan.
        // ════════════════════════════════════════════════════════════════════

        // A 12-month plan on the same operator. Telephone rental is a monthly
        // figure; this is what the per_month basis exists for.
        const [annual] = await db.insert(ftthPlans).values({
            operatorId,
            name: `QA 30 Mbps annual ${stamp}`,
            speedMbps: 30,
            durationMonths: 12,
            listPricePaise: 4_23_600,           // Rs.4,236
            discountPaise: 0,
        }).returning();

        // ── a catalogue item, per_month, followed by two plans ──────────────
        const phoneName = `QA Telephone ${stamp}`;
        const [catPhone] = await db.insert(ftthAddonCatalog).values({
            operatorId,
            name: phoneName,
            kind: 'telephone',
            pricingBasis: 'per_month',
            defaultPricePaise: 11_800,          // Rs.118 a month
            defaultOptional: false,
        }).returning();

        // The legacy self-priced Telephone from earlier is still on the monthly
        // plan; retire it so the catalogue one is the only telephone line there.
        await db.update(ftthPlanAddons).set({ isActive: false }).where(eq(ftthPlanAddons.id, phone.id));

        const [linkMonthly] = await db.insert(ftthPlanAddons).values({
            planId, catalogId: catPhone.id, label: 'ignored', kind: 'telephone', amountPaise: 0,
            isOptional: false, sortOrder: 0,
        }).returning();
        const [linkAnnual] = await db.insert(ftthPlanAddons).values({
            planId: annual.id, catalogId: catPhone.id, label: 'ignored', kind: 'telephone', amountPaise: 0,
            isOptional: false, sortOrder: 0,
        }).returning();

        {
            const monthly = await FtthService.quote(plan, operatorId);
            const yearly = await FtthService.quote(annual, operatorId);
            const tm = monthly.addons.find(a => a.id === linkMonthly.id)!;
            const ta = yearly.addons.find(a => a.id === linkAnnual.id)!;

            check('a catalogue-linked add-on takes its name from the catalogue, not the link',
                tm.label === phoneName, tm.label);
            check('per_month on a 1-month plan is the monthly figure',
                tm.amountPaise === 11_800, R(tm.amountPaise));
            check('per_month on a 12-month plan is twelve times it — priced ONCE in the catalogue',
                ta.amountPaise === 11_800 * 12, R(ta.amountPaise));
            check('...and the derivation is carried for the receipt',
                ta.unitPaise === 11_800 && ta.months === 12 && ta.pricingBasis === 'per_month',
                R(ta.unitPaise) + ' x ' + ta.months);
            check('the annual bill adds up: 4,236 + 1,416 + 10',
                yearly.totalPaise === 4_23_600 + 1_41_600 + 1_000, R(yearly.totalPaise));
        }

        // ── change the catalogue once, every follower moves ─────────────────
        {
            await db.update(ftthAddonCatalog).set({ defaultPricePaise: 12_900 })   // Rs.129
                .where(eq(ftthAddonCatalog.id, catPhone.id));

            const monthly = await FtthService.quote(plan, operatorId);
            const yearly = await FtthService.quote(annual, operatorId);
            check('raising the catalogue price moves the monthly plan',
                monthly.addons.find(a => a.id === linkMonthly.id)!.amountPaise === 12_900);
            check('...and the annual plan, with no per-plan edit anywhere',
                yearly.addons.find(a => a.id === linkAnnual.id)!.amountPaise === 12_900 * 12,
                R(12_900 * 12));
        }

        // ── an override pins one plan and ignores the catalogue ─────────────
        {
            await db.update(ftthPlanAddons).set({ priceOverridePaise: 99_900 })   // Rs.999 negotiated
                .where(eq(ftthPlanAddons.id, linkAnnual.id));

            let yearly = await FtthService.quote(annual, operatorId);
            const ta = yearly.addons.find(a => a.id === linkAnnual.id)!;
            check('an override beats the catalogue for that plan alone',
                ta.amountPaise === 99_900 && ta.overridden, R(ta.amountPaise));
            check('...and is NOT multiplied by the term — it is the agreed figure',
                ta.months === 1 && ta.pricingBasis === 'flat');

            await db.update(ftthAddonCatalog).set({ defaultPricePaise: 15_000 })
                .where(eq(ftthAddonCatalog.id, catPhone.id));
            yearly = await FtthService.quote(annual, operatorId);
            const monthly = await FtthService.quote(plan, operatorId);
            check('a later catalogue change leaves the overridden plan alone',
                yearly.addons.find(a => a.id === linkAnnual.id)!.amountPaise === 99_900);
            check('...while the plan without an override still follows',
                monthly.addons.find(a => a.id === linkMonthly.id)!.amountPaise === 15_000);

            await db.update(ftthPlanAddons).set({ priceOverridePaise: null })
                .where(eq(ftthPlanAddons.id, linkAnnual.id));
            await db.update(ftthAddonCatalog).set({ defaultPricePaise: 11_800 })
                .where(eq(ftthAddonCatalog.id, catPhone.id));
        }

        // ── exclusive groups: Hotstar Basic OR Premium, never both ──────────
        const group = 'hotstar-' + stamp;
        const [basic] = await db.insert(ftthAddonCatalog).values({
            operatorId, name: 'QA Hotstar Basic ' + stamp, kind: 'ott',
            pricingBasis: 'flat', defaultPricePaise: 14_900, defaultOptional: true, exclusiveGroup: group,
        }).returning();
        const [premium] = await db.insert(ftthAddonCatalog).values({
            operatorId, name: 'QA Hotstar Premium ' + stamp, kind: 'ott',
            pricingBasis: 'flat', defaultPricePaise: 29_900, defaultOptional: true, exclusiveGroup: group,
        }).returning();
        const [lBasic] = await db.insert(ftthPlanAddons).values({
            planId, catalogId: basic.id, label: 'x', kind: 'ott', amountPaise: 0, isOptional: true, sortOrder: 1,
        }).returning();
        const [lPremium] = await db.insert(ftthPlanAddons).values({
            planId, catalogId: premium.id, label: 'x', kind: 'ott', amountPaise: 0, isOptional: true, sortOrder: 2,
        }).returning();

        {
            const one = await FtthService.quote(plan, operatorId, [lPremium.id]);
            check('one tier from an exclusive group is fine',
                one.addons.some(a => a.id === lPremium.id) && !one.addons.some(a => a.id === lBasic.id));
            check('...and the group name rides on the line for the app to render radios',
                one.addons.find(a => a.id === lPremium.id)!.exclusiveGroup === group);

            let refused: unknown = null;
            try { await FtthService.quote(plan, operatorId, [lBasic.id, lPremium.id]); }
            catch (e) { refused = e; }
            check('two tiers from one exclusive group are REFUSED, not summed',
                refused instanceof AddonSelectionError && refused.code === 'ADDON_EXCLUSIVE_GROUP',
                (refused as any)?.message);
            check('...with both names in the message so the customer knows what to drop',
                /Basic/.test((refused as any)?.message ?? '') && /Premium/.test((refused as any)?.message ?? ''));

            // A mandatory Basic plus an opted-in Premium is the same mistake:
            // the operator said "Basic unless you upgrade", not "Basic and Premium".
            await db.update(ftthPlanAddons).set({ isOptional: false }).where(eq(ftthPlanAddons.id, lBasic.id));
            let refused2: unknown = null;
            try { await FtthService.quote(plan, operatorId, [lPremium.id]); }
            catch (e) { refused2 = e; }
            check('a mandatory tier plus an optional one in the same group is also refused',
                refused2 instanceof AddonSelectionError);
            await db.update(ftthPlanAddons).set({ isOptional: true }).where(eq(ftthPlanAddons.id, lBasic.id));
        }

        // ── retiring a catalogue item pulls it from every plan ──────────────
        {
            await db.update(ftthAddonCatalog).set({ isActive: false }).where(eq(ftthAddonCatalog.id, premium.id));
            const q = await FtthService.quote(plan, operatorId, [lPremium.id]);
            check('a retired catalogue item is not for sale even when its link is active and selected',
                !q.addons.some(a => a.id === lPremium.id));
            await db.update(ftthAddonCatalog).set({ isActive: true }).where(eq(ftthAddonCatalog.id, premium.id));
        }

        // ── legacy and catalogue rows coexist on one plan ───────────────────
        {
            const [legacy] = await db.insert(ftthPlanAddons).values({
                planId, label: 'QA Legacy Static IP', kind: 'static_ip', amountPaise: 50_000,
                isOptional: false, sortOrder: 9,   // no catalogId: written before the catalogue existed
            }).returning();
            const q = await FtthService.quote(plan, operatorId);
            const l = q.addons.find(a => a.id === legacy.id)!;
            check('a pre-catalogue row still prices from its own amount',
                l.amountPaise === 50_000 && l.catalogId === null, R(l.amountPaise));
            check('...beside catalogue-linked rows on the same plan',
                q.addons.some(a => a.catalogId === catPhone.id));
            await db.delete(ftthPlanAddons).where(eq(ftthPlanAddons.id, legacy.id));
        }

        // ── the database refuses to orphan a link ───────────────────────────
        {
            let blocked = false;
            try { await db.delete(ftthAddonCatalog).where(eq(ftthAddonCatalog.id, catPhone.id)); }
            catch { blocked = true; }
            check('deleting a catalogue item that plans still link to is refused (ON DELETE RESTRICT)',
                blocked);
        }

        // ── the same resolver serves the plan listing ───────────────────────
        {
            const [link] = await db.select().from(ftthPlanAddons).where(eq(ftthPlanAddons.id, linkAnnual.id));
            const [cat] = await db.select().from(ftthAddonCatalog).where(eq(ftthAddonCatalog.id, catPhone.id));
            const viaResolver = resolveAddon(link, cat, annual.durationMonths).amountPaise;
            const viaQuote = (await FtthService.quote(annual, operatorId)).addons.find(a => a.id === linkAnnual.id)!.amountPaise;
            check('the card (resolveAddon) and the charge (quote) cannot disagree',
                viaResolver === viaQuote, R(viaResolver) + ' both ways');
        }

        // Annual plan and its links out before the finally runs.
        await db.delete(ftthPlanAddons).where(eq(ftthPlanAddons.planId, annual.id));
        await db.delete(ftthPlans).where(eq(ftthPlans.id, annual.id));

    } finally {
        // Fixtures out, in FK order. Add-ons cascade with the plan, but deleting
        // explicitly keeps this readable when a case above fails early.
        if (planId) {
            await db.delete(ftthPlanAddons).where(eq(ftthPlanAddons.planId, planId));
            await db.delete(ftthPlans).where(eq(ftthPlans.id, planId));
        }
        if (operatorId) {
            await db.delete(ftthPlans).where(eq(ftthPlans.operatorId, operatorId));
            await db.delete(ftthAddonCatalog).where(eq(ftthAddonCatalog.operatorId, operatorId));
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
