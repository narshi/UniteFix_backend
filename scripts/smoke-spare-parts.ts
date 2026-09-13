/**
 * Spare parts — catalogue, the integrity rule, price authority, proposals, stock.
 *
 *   npm run smoke:spare-parts
 *
 * The cases that matter most:
 *   - a 'platform' line with no catalogue reference is NOT a platform line;
 *   - for a real platform line the catalogue says how much, not the technician;
 *   - platform parts money never reaches the technician's earning;
 *   - a technician without parts access cannot fit from stock;
 *   - approving a proposal re-points the lines that carried it;
 *   - stock is a ledger: consumption is idempotent, oversold is written down
 *     rather than thrown, and the cache rebuilds from the movements.
 *
 * Creates its own fixtures and deletes them in a finally.
 */

import 'dotenv/config';
import { db } from '../server/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
    users, employees, serviceCategories, serviceRequests, servicePartItems,
    spareParts, sparePartCategories, sparePartStock, sparePartMovements, sparePartProposals,
} from '@shared/schema';
import { SparePartsService, SparePartsError } from '../server/services/spare-parts.service';
import { resolvePartItem, splitPartsMoney, partsTotalPaise, recordPartItems } from '../server/services/warranty.service';
import { BillingEngine } from '../server/services/billing-engine';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const R = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;

async function main() {
    const stamp = Date.now().toString(36).toUpperCase();
    let userId = 0, employeeId = 0, categoryId = 0, otherCategoryId = 0, srId = 0;
    const partIds: number[] = [];
    const proposalIds: number[] = [];

    try {
        // ── fixtures ────────────────────────────────────────────────────────
        const [u] = await db.insert(users).values({
            phone: `+9190000${stamp.slice(-5).replace(/[^0-9]/g, '1').padStart(5, '1')}`,
            username: `QA Tech ${stamp}`, role: 'serviceman', isActive: true, password: null as any,
        } as any).returning();
        userId = u.id;
        const [e] = await db.insert(employees).values({ userId, fullName: `QA Tech ${stamp}`, partnerType: 'Individual', services: [], isActive: true } as any).returning();
        employeeId = e.id;
        const [cat] = await db.insert(serviceCategories).values({ name: `QA AC ${stamp}` }).returning();
        categoryId = cat.id;
        const [cat2] = await db.insert(serviceCategories).values({ name: `QA Fan ${stamp}` }).returning();
        otherCategoryId = cat2.id;
        const [sr] = await db.insert(serviceRequests).values({
            serviceId: `SR-QA-SP-${stamp}`, userId, providerId: employeeId, serviceType: 'QA AC Repair', description: 'qa',
            address: 'qa', status: 'in_progress',
        } as any).returning();
        srId = sr.id;

        // ── catalogue ───────────────────────────────────────────────────────
        const cap = await SparePartsService.create({
            name: 'Capacitor 2.5uF', brand: 'Havells', unitPricePaise: 45_000, tradePricePaise: 32_000, costPricePaise: 25_000,
            warrantyDays: 180, categoryIds: [categoryId, otherCategoryId], createdByAdminId: 1,
        });
        partIds.push(cap.id);
        check('a part gets a readable code from its category and name', /^QA-AC-.*CAPACITOR/.test(cap.partCode), cap.partCode);
        check('a part can belong to two categories (AC and fan)', (await SparePartsService.categoriesOf(cap.id)).length === 2);

        const gas = await SparePartsService.create({ name: 'R32 gas top-up', unitPricePaise: 180_000, categoryIds: [categoryId], createdByAdminId: 1 });
        partIds.push(gas.id);

        let refused: string | null = null;
        try { await SparePartsService.setCategories(cap.id, [999_999_999]); } catch (err: any) { refused = err.message; }
        check('an unknown category is refused', /Unknown category/.test(refused ?? ''));

        // ── search: the job's category first ────────────────────────────────
        {
            const mcb = await SparePartsService.create({ name: 'MCB 32A', unitPricePaise: 30_000, categoryIds: [], createdByAdminId: 1 });
            partIds.push(mcb.id);
            const rows = await SparePartsService.search({ categoryId, q: `` });
            const mine = rows.filter(r => partIds.includes(r.id));
            check('search puts the job-category parts before the rest',
                mine[0].inJobCategory && mine[mine.length - 1].id === mcb.id && !mine[mine.length - 1].inJobCategory,
                mine.map(r => `${r.name}${r.inJobCategory ? '*' : ''}`).join(' > '));
        }

        // ── THE INTEGRITY RULE ──────────────────────────────────────────────
        {
            const bare = resolvePartItem({ partName: 'Mystery capacitor', sourceType: 'platform', unitPricePaise: 99_900 });
            check('a "platform" line with no catalogue reference is downgraded to a local purchase',
                bare.sourceType === 'technician_local' && bare.sparePartId === null);
            check('...undocumented and backed by nobody', !bare.isDocumented && bare.warrantyBacker === 'none');
            check('...and says why', /no catalogue part/i.test(bare.downgradeReason ?? ''), bare.downgradeReason ?? '');

            const real = resolvePartItem({ partName: 'x', sourceType: 'platform', sparePartId: cap.id, unitPricePaise: 45_000, warrantyDays: 180 });
            check('a platform line WITH a reference stays platform, backed by UniteFix',
                real.sourceType === 'platform' && real.sparePartId === cap.id && real.warrantyBacker === 'unitefix');
        }

        // ── price authority + access gate ───────────────────────────────────
        {
            // No access yet: enrichment downgrades (strict gate off by default).
            const { items, warnings } = await SparePartsService.enrichPlatformItems(
                [{ sourceType: 'platform', sparePartId: cap.id, partName: 'cheap', unitPricePaise: 100 }], employeeId);
            check('without parts access a platform line is downgraded, not refused (gate off)',
                items[0].sourceType === 'technician_local' && items[0].sparePartId === null && warnings.length === 1, warnings[0]);

            await db.update(employees).set({ partsAccess: 'active' }).where(eq(employees.id, employeeId));

            const enriched = await SparePartsService.enrichPlatformItems(
                [{ sourceType: 'platform', sparePartId: cap.id, partName: 'whatever the app said', unitPricePaise: 100, quantity: 2 },
                 { sourceType: 'technician_local', partName: 'Local wire', unitPricePaise: 5_000, vendorName: 'Sirsi Electricals' }],
                employeeId);
            const p0 = enriched.items[0];
            check('with access, the CATALOGUE says the price — the technician\'s Rs.1 is ignored',
                p0.unitPricePaise === 45_000, R(p0.unitPricePaise!));
            check('...and the name, brand and warranty come from the catalogue too',
                p0.partName === 'Capacitor 2.5uF' && p0.brand === 'Havells' && p0.warrantyDays === 180);
            check('a local line beside it is untouched', enriched.items[1].unitPricePaise === 5_000 && enriched.items[1].sourceType === 'technician_local');

            const ghost = await SparePartsService.enrichPlatformItems([{ sourceType: 'platform', sparePartId: 999_999_999, partName: 'ghost' }], employeeId);
            check('a reference to a part that does not exist is downgraded with a reason',
                ghost.items[0].sourceType === 'technician_local' && ghost.warnings.length === 1);

            // ── the money split ─────────────────────────────────────────────
            const resolved = enriched.items.map(r => resolvePartItem(r));
            const money = splitPartsMoney(resolved);
            check('platform parts and technician parts are two buckets',
                money.platformPartsPaise === 90_000 && money.technicianPartsPaise === 5_000,
                `${R(money.platformPartsPaise)} UniteFix / ${R(money.technicianPartsPaise)} technician`);
            check('...that sum to the whole parts bill', money.platformPartsPaise + money.technicianPartsPaise === partsTotalPaise(resolved));

            const legacy = BillingEngine.buildLegacySnapshot({ bookingFee: 99, totalAmount: null, commissionAmount: null });
            const bill = BillingEngine.calculateFinalBill(950, 500, legacy, 900);
            check('v1 bill: the customer is charged for every part', bill.subtotal === 1450, `subtotal Rs.${bill.subtotal}`);
            check('v1 bill: the technician earns labour + THEIR parts only — not UniteFix\'s capacitor',
                bill.employeeEarnings === 550, `earning Rs.${bill.employeeEarnings}`);
            check('v1 bill: the platform parts figure is frozen on the snapshot', bill.platformPartsCost === 900);
            const untouched = BillingEngine.calculateFinalBill(950, 500, legacy);
            check('a bill with no platform parts earns exactly as before', untouched.employeeEarnings === 1450);
        }

        // ── record + consume ────────────────────────────────────────────────
        {
            await SparePartsService.receivePurchase({ sparePartId: cap.id, quantity: 10, unitCostPaise: 25_000, adminId: 1 });
            await SparePartsService.issueToTechnician({ sparePartId: cap.id, quantity: 3, employeeId, adminId: 1 });
            const wh = (await SparePartsService.stockFor(cap.id)).find(s => s.location === 'warehouse')!;
            const kit = (await SparePartsService.kitOf(employeeId)).find(k => k.part.id === cap.id)!;
            check('issuing to a technician moves stock from the warehouse to their kit', wh.quantity === 7 && kit.stock.quantity === 3);

            let insufficient = false;
            try { await SparePartsService.issueToTechnician({ sparePartId: cap.id, quantity: 50, employeeId, adminId: 1 }); } catch (err) { insufficient = err instanceof SparePartsError; }
            check('issuing more than the warehouse holds is refused', insufficient);

            const enriched = await SparePartsService.enrichPlatformItems(
                [{ sourceType: 'platform', sparePartId: cap.id, quantity: 2 }, { sourceType: 'platform', sparePartId: gas.id, quantity: 1 }], employeeId);
            await recordPartItems(srId, enriched.items, employeeId);
            const lines = await db.select().from(servicePartItems).where(eq(servicePartItems.serviceRequestId, srId));
            check('recorded lines carry the catalogue reference', lines.every(l => l.sparePartId !== null) && lines.length === 2);

            const consumed = await db.transaction(async (tx) => SparePartsService.consumeForJob(tx as any, srId, employeeId));
            const kitAfter = (await SparePartsService.kitOf(employeeId)).find(k => k.part.id === cap.id);
            check('consumption takes from the technician\'s kit when they hold the part', kitAfter?.stock.quantity === 1, `kit now ${kitAfter?.stock.quantity}`);
            check('...and from the warehouse when they do not', consumed.find(c => c.lineId === lines.find(l => l.sparePartId === gas.id)!.id)?.from === 'warehouse');
            check('a part with no stock anywhere is OVERSOLD, not refused — the job completes',
                consumed.some(c => c.oversold), consumed.map(c => `${c.from}${c.oversold ? '!' : ''}`).join(','));

            const again = await db.transaction(async (tx) => SparePartsService.consumeForJob(tx as any, srId, employeeId));
            const kitAgain = (await SparePartsService.kitOf(employeeId)).find(k => k.part.id === cap.id);
            check('consuming the same job twice moves nothing the second time', again.length === 0 && kitAgain?.stock.quantity === 1);

            // ── the cache is only a cache ───────────────────────────────────
            await db.update(sparePartStock).set({ quantity: 999 }).where(and(eq(sparePartStock.sparePartId, cap.id), eq(sparePartStock.location, 'warehouse')));
            await SparePartsService.rebuildStockCache(cap.id);
            const rebuilt = (await SparePartsService.stockFor(cap.id));
            check('a corrupted quantity is rebuilt from the movement ledger',
                rebuilt.find(s => s.location === 'warehouse')!.quantity === 7 && rebuilt.find(s => s.location === 'technician')!.quantity === 1,
                rebuilt.map(s => `${s.location}=${s.quantity}`).join(' '));

            const count = await SparePartsService.adjust({ sparePartId: cap.id, location: 'technician', holderEmployeeId: employeeId, actualQuantity: 0, adminId: 1 });
            check('a count that finds a kit short records the shortage for the deposit to answer', count.shortage === 1);
        }

        // ── proposals ───────────────────────────────────────────────────────
        {
            const prop = await SparePartsService.propose({ employeeId, serviceRequestId: srId, name: 'Fan regulator', categoryId: otherCategoryId, indicativePricePaise: 22_000, vendorName: 'Sirsi Electricals' });
            proposalIds.push(prop.id);
            check('a parts-enabled technician can propose a part', prop.status === 'pending');

            // The line they fitted meanwhile, as a local purchase carrying the proposal.
            const [line] = await db.insert(servicePartItems).values({
                serviceRequestId: srId, partName: 'Fan regulator', sourceType: 'technician_local', unitPricePaise: 22_000, quantity: 1,
                warrantyDays: 0, warrantyBacker: 'none', proposalId: prop.id, isDocumented: false, recordedBy: employeeId,
            } as any).returning();

            const approved = await SparePartsService.approveProposal(prop.id, 1, { unitPricePaise: 24_000, tradePricePaise: 18_000, warrantyDays: 90 });
            partIds.push(approved!.part.id);
            check('approving creates the catalogue row from the proposal', approved!.part.name === 'Fan regulator' && approved!.part.createdFromProposalId === prop.id);
            check('...and re-points the fitted line at it', approved!.repointed === 1
                && (await db.select().from(servicePartItems).where(eq(servicePartItems.id, line.id)))[0].sparePartId === approved!.part.id);
            check('...without changing the price the customer already agreed', (await db.select().from(servicePartItems).where(eq(servicePartItems.id, line.id)))[0].unitPricePaise === 22_000);

            let twice: unknown = null;
            try { await SparePartsService.approveProposal(prop.id, 1, { unitPricePaise: 1 }); } catch (err) { twice = err; }
            check('a proposal cannot be approved twice', twice instanceof SparePartsError);

            const dup = await SparePartsService.propose({ employeeId, name: 'Capacitor 2.5 uF (Havells)', categoryId });
            proposalIds.push(dup.id);
            const merged = await SparePartsService.mergeProposal(dup.id, cap.id, 1, 'same as AC-CAP');
            check('a duplicate proposal merges into the existing part', merged!.part.id === cap.id
                && (await db.select().from(sparePartProposals).where(eq(sparePartProposals.id, dup.id)))[0].status === 'merged');

            await db.update(employees).set({ partsAccess: 'none' }).where(eq(employees.id, employeeId));
            let noAccess = false;
            try { await SparePartsService.propose({ employeeId, name: 'x' }); } catch (err) { noAccess = err instanceof SparePartsError && err.code === 'PARTS_ACCESS_REQUIRED'; }
            check('a technician without parts access cannot propose', noAccess);
        }
    } finally {
        if (srId) {
            await db.delete(sparePartMovements).where(eq(sparePartMovements.serviceRequestId, srId));
            await db.delete(servicePartItems).where(eq(servicePartItems.serviceRequestId, srId));
        }
        if (partIds.length) {
            await db.delete(sparePartMovements).where(inArray(sparePartMovements.sparePartId, partIds));
            await db.delete(sparePartStock).where(inArray(sparePartStock.sparePartId, partIds));
            await db.delete(sparePartCategories).where(inArray(sparePartCategories.sparePartId, partIds));
        }
        if (proposalIds.length) await db.update(sparePartProposals).set({ resolvedSparePartId: null }).where(inArray(sparePartProposals.id, proposalIds));
        if (partIds.length) await db.update(spareParts).set({ createdFromProposalId: null }).where(inArray(spareParts.id, partIds));
        if (proposalIds.length) await db.delete(sparePartProposals).where(inArray(sparePartProposals.id, proposalIds));
        if (partIds.length) await db.delete(spareParts).where(inArray(spareParts.id, partIds));
        if (srId) await db.delete(serviceRequests).where(eq(serviceRequests.id, srId));
        if (categoryId) await db.delete(serviceCategories).where(inArray(serviceCategories.id, [categoryId, otherCategoryId].filter(Boolean)));
        if (employeeId) await db.delete(employees).where(eq(employees.id, employeeId));
        if (userId) await db.delete(users).where(eq(users.id, userId));
    }
}

main()
    .then(() => {
        const passed = results.filter(r => r.pass).length;
        console.log(`\n${passed}/${results.length} passed`);
        process.exit(passed === results.length ? 0 : 1);
    })
    .catch((err) => { console.error('\nSmoke run failed:', err?.message ?? err); process.exit(1); });
