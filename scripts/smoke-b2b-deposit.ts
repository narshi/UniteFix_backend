/**
 * The technician deposit and B2B ordering — the two money paths.
 *
 *   npm run smoke:b2b-deposit
 *
 * Razorpay is not called: orders and deposits are inserted as if the order
 * had been created, and applyCapture() is driven directly with a fake payment
 * id — which is exactly what the webhook does. What is under test is the
 * state machine, the idempotency, the ledgers, and the stock movements.
 *
 * Creates its own fixtures and deletes them in a finally.
 */

import 'dotenv/config';
import { db } from '../server/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
    users, employees, serviceRequests, servicePartItems, warrantyClaims,
    partnerDeposits, partnerDepositLedger, spareParts, sparePartStock, sparePartMovements,
    businessPartners, businessPartnerVerticals, businessPartnerLedger, b2bOrders, b2bOrderItems, b2bOrderEvents,
} from '@shared/schema';
import { PartsAccessService, PartsAccessError } from '../server/services/parts-access.service';
import { B2bOrderService, B2bOrderError } from '../server/services/b2b-order.service';
import { BusinessPartnerService } from '../server/services/business-partner.service';
import { SparePartsService } from '../server/services/spare-parts.service';

const results: Array<{ name: string; pass: boolean }> = [];
const check = (name: string, pass: boolean, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const R = (paise: number) => `Rs.${(paise / 100).toFixed(2)}`;

async function main() {
    const stamp = Date.now().toString(36).toUpperCase();
    let userId = 0, employeeId = 0, srId = 0, claimId = 0, bpId = 0;
    const partIds: number[] = [];
    const orderIds: number[] = [];

    try {
        // ── fixtures ────────────────────────────────────────────────────────
        const [u] = await db.insert(users).values({ phone: `+919100${stamp.slice(-6).replace(/[^0-9]/g, '2').padStart(6, '2')}`, username: `QA Dep ${stamp}`, role: 'serviceman', isActive: true, password: null as any } as any).returning();
        userId = u.id;
        const [e] = await db.insert(employees).values({ userId, fullName: `QA Dep ${stamp}`, partnerType: 'Individual', services: [], isActive: true, documentVerificationStatus: 'verified' } as any).returning();
        employeeId = e.id;

        // ════════════════════════════════════════════════════════════════════
        // DEPOSIT
        // ════════════════════════════════════════════════════════════════════
        const required = await PartsAccessService.requiredPaise();
        const floorPct = await PartsAccessService.floorPercent();
        check('deposit amount comes from config', required === 500_000, R(required));

        // The row initiatePayment() would have created, with a fake Razorpay order.
        const [dep] = await db.insert(partnerDeposits).values({
            employeeId, purpose: 'parts_access', requiredPaise: required, status: 'pending_payment', razorpayOrderId: `order_QA${stamp}`,
        }).returning();

        {
            const r1 = await PartsAccessService.applyCapture({ razorpayOrderId: dep.razorpayOrderId, razorpayPaymentId: `pay_QA${stamp}`, amountPaise: required });
            const st1 = await PartsAccessService.status(employeeId);
            check('paying the deposit holds it in full', r1.applied && st1.deposit?.status === 'held' && st1.deposit.remainingPaise === required);
            check('...and moves the technician to REQUESTED — not active; a person still approves', st1.partsAccess === 'requested');
            check('...with a paid_in ledger entry', st1.ledger.some(l => l.entryType === 'paid_in' && l.amountPaise === required));

            const r2 = await PartsAccessService.applyCapture({ razorpayOrderId: dep.razorpayOrderId, razorpayPaymentId: `pay_QA${stamp}`, amountPaise: required });
            const st2 = await PartsAccessService.status(employeeId);
            check('the same payment applied twice (webhook + verify) counts once', !r2.applied && st2.deposit?.paidPaise === required);

            let early: unknown = null;
            try { await PartsAccessService.draw({ employeeId: 999_999_999, amountPaise: 100, entryType: 'adjustment', adminId: 1 }); } catch (err) { early = err; }
            check('drawing on a technician with no deposit is refused', early instanceof PartsAccessError);

            await PartsAccessService.approve(employeeId, 1);
            check('approval makes access ACTIVE', (await PartsAccessService.status(employeeId)).partsAccess === 'active');
        }

        // ── a warranty verdict draws from it ────────────────────────────────
        {
            const [sr] = await db.insert(serviceRequests).values({
                serviceId: `SR-QA-DEP-${stamp}`, userId, providerId: employeeId, serviceType: 'QA', description: 'qa', address: 'qa', status: 'completed',
            } as any).returning();
            srId = sr.id;
            const [line] = await db.insert(servicePartItems).values({
                serviceRequestId: srId, partName: 'Bad capacitor', sourceType: 'technician_local', unitPricePaise: 120_000, quantity: 1,
                warrantyDays: 0, warrantyBacker: 'none', isDocumented: false, recordedBy: employeeId,
            } as any).returning();
            const [claim] = await db.insert(warrantyClaims).values({
                claimId: `WC-QA-${stamp}`, serviceRequestId: srId, partItemId: line.id, raisedByUserId: userId, description: 'failed',
                status: 'resolved', verdict: 'part_failed', costBearer: 'technician', inspectedBy: 1, inspectedAt: new Date(), resolvedAt: new Date(),
            } as any).returning();
            claimId = claim.id;

            const d1 = await PartsAccessService.drawForClaim(claimId, 1);
            check('a technician verdict draws the part\'s line total from the deposit', d1?.drawn === 120_000, R(d1?.drawn ?? 0));
            check('...leaving the remainder above the floor, so access stays active',
                d1?.remainingPaise === required - 120_000 && !d1.suspended && (await PartsAccessService.status(employeeId)).partsAccess === 'active');

            const d2 = await PartsAccessService.drawForClaim(claimId, 1);
            check('drawing the same claim twice takes nothing the second time', d2?.duplicate === true && d2.drawn === 0);

            // A big shortage pushes it under the floor.
            const floor = Math.round(required * floorPct / 100);
            const d3 = await PartsAccessService.draw({ employeeId, amountPaise: required - 120_000 - floor + 1, entryType: 'drawn_shortage', adminId: 1, notes: 'QA count shortage' });
            check('a draw that takes the remainder below the floor SUSPENDS access', d3.suspended && (await PartsAccessService.status(employeeId)).partsAccess === 'suspended',
                `remaining ${R(d3.remainingPaise)} < floor ${R(floor)}`);

            const st = await PartsAccessService.status(employeeId);
            check('the status says how much to top up', st.deposit!.topUpNeededPaise === required - st.deposit!.remainingPaise);

            // Top up: the app opens a Razorpay order for the shortfall; capture it.
            await db.update(partnerDeposits).set({ razorpayOrderId: `order_QA_TOP${stamp}` }).where(eq(partnerDeposits.id, dep.id));
            const top = await PartsAccessService.applyCapture({ razorpayOrderId: `order_QA_TOP${stamp}`, razorpayPaymentId: `pay_QA_TOP${stamp}`, amountPaise: st.deposit!.topUpNeededPaise });
            const after = await PartsAccessService.status(employeeId);
            check('a top-up restores the full deposit', top.applied && after.deposit!.remainingPaise === required && after.deposit!.status === 'held', R(after.deposit!.remainingPaise));
            check('...and lifts the suspension automatically — the floor was the only cause', after.partsAccess === 'active');
            check('...recorded as topped_up, not paid_in', after.ledger[0].entryType === 'topped_up');

            const chained = [...after.ledger].reverse().every((l, i, arr) => i === 0 || l.balanceBeforePaise === arr[i - 1].balanceAfterPaise);
            check('every deposit entry carries the balance forward', chained, `${after.ledger.length} entries`);

            let over: unknown = null;
            try { await PartsAccessService.draw({ employeeId, amountPaise: 99_999_999, entryType: 'adjustment', adminId: 1, notes: 'x' }); } catch (err) { over = err; }
            const capped = await PartsAccessService.status(employeeId);
            check('a draw larger than the deposit takes what is there and reports the shortfall — never a negative balance',
                over === null && capped.deposit!.remainingPaise === 0 && capped.deposit!.status === 'forfeited');
        }

        // ── refund is gated ─────────────────────────────────────────────────
        {
            await db.insert(warrantyClaims).values({
                claimId: `WC-QA-OPEN-${stamp}`, serviceRequestId: srId, raisedByUserId: userId, description: 'open', status: 'open',
            } as any);
            const blockers = await PartsAccessService.refundBlockers(employeeId);
            check('a refund is blocked while a warranty claim on their job is open', blockers.some(b => /open warranty claim/.test(b)), blockers.join('; '));
        }

        // ════════════════════════════════════════════════════════════════════
        // B2B
        // ════════════════════════════════════════════════════════════════════
        const bp = await BusinessPartnerService.create({
            legalName: `QA CCTV ${stamp}`, contactPhone: '9000000004', verticalCodes: ['cctv'], gstin: '29QACCTV1234F1Z5', approvedByAdminId: 1, creditLimitPaise: 0,
        });
        bpId = bp.id;

        const cam = await SparePartsService.create({ name: `QA Camera ${stamp}`, unitPricePaise: 250_000, tradePricePaise: 180_000, costPricePaise: 150_000, gstPercent: 18, createdByAdminId: 1 });
        const cable = await SparePartsService.create({ name: `QA Cable ${stamp}`, unitPricePaise: 2_000, tradePricePaise: 1_200, unit: 'meter', createdByAdminId: 1 });
        const noTrade = await SparePartsService.create({ name: `QA Internal ${stamp}`, unitPricePaise: 5_000, createdByAdminId: 1 });
        partIds.push(cam.id, cable.id, noTrade.id);
        await SparePartsService.receivePurchase({ sparePartId: cam.id, quantity: 5, adminId: 1 });

        // ── quote ───────────────────────────────────────────────────────────
        {
            const q = await B2bOrderService.quote([{ sparePartId: cam.id, quantity: 2 }, { sparePartId: cable.id, quantity: 100 }]);
            const camLine = q.lines.find(l => l.sparePartId === cam.id)!;
            check('a B2B quote uses the TRADE price, not the customer price', camLine.unitPricePaise === 180_000, R(camLine.unitPricePaise));
            check('...with GST added per line at the part\'s rate', camLine.gstPaise === Math.round(360_000 * 0.18) && camLine.lineTotalPaise === 360_000 + 64_800);
            check('a line the warehouse cannot cover is flagged backordered, not refused',
                q.lines.find(l => l.sparePartId === cable.id)!.backordered && !camLine.backordered);

            let nt: unknown = null;
            try { await B2bOrderService.quote([{ sparePartId: noTrade.id, quantity: 1 }]); } catch (err) { nt = err; }
            check('a part with no trade price is not for sale B2B', nt instanceof B2bOrderError && nt.code === 'NOT_FOR_TRADE');
        }

        // ── credit ──────────────────────────────────────────────────────────
        {
            let prepaidOnly: unknown = null;
            try { await B2bOrderService.place({ businessPartnerId: bpId, items: [{ sparePartId: cam.id, quantity: 1 }], paymentMode: 'credit' }); } catch (err) { prepaidOnly = err; }
            check('a prepaid-only partner cannot order on credit', prepaidOnly instanceof B2bOrderError && prepaidOnly.code === 'PREPAID_ONLY');

            await db.update(businessPartners).set({ creditLimitPaise: 300_000 }).where(eq(businessPartners.id, bpId));
            let exceeded: unknown = null;
            try { await B2bOrderService.place({ businessPartnerId: bpId, items: [{ sparePartId: cam.id, quantity: 2 }], paymentMode: 'credit' }); } catch (err) { exceeded = err; }
            check('over the limit is refused WITH the shortfall named',
                exceeded instanceof B2bOrderError && exceeded.code === 'CREDIT_EXCEEDED' && /short/.test(exceeded.message), (exceeded as any)?.message);

            const placed = await B2bOrderService.place({ businessPartnerId: bpId, items: [{ sparePartId: cam.id, quantity: 1 }], paymentMode: 'credit' });
            orderIds.push(placed.order.id);
            check('within the limit, a credit order is placed', placed.order.status === 'placed' && placed.razorpay === null, placed.order.orderCode);
            const pos = await BusinessPartnerService.creditPosition(bpId);
            check('...and the invoice is on the ledger immediately: they owe us', pos.outstandingPaise === placed.order.totalPaise, R(pos.outstandingPaise));

            const events = await db.select().from(b2bOrderEvents).where(eq(b2bOrderEvents.orderId, placed.order.id));
            check('placement writes the first tracking event', events.length === 1 && events[0].eventType === 'placed');

            // Cancel by the partner while still 'placed'.
            await B2bOrderService.partnerCancel(placed.order.id, bpId, 'ordered wrong model');
            const pos2 = await BusinessPartnerService.creditPosition(bpId);
            check('cancelling a credit order writes a credit note and frees the credit', pos2.outstandingPaise === 0, R(pos2.outstandingPaise));
        }

        // ── prepaid lifecycle ───────────────────────────────────────────────
        {
            // The row place(prepaid) would have created, with a fake Razorpay order.
            const q = await B2bOrderService.quote([{ sparePartId: cam.id, quantity: 2 }]);
            const [order] = await db.insert(b2bOrders).values({
                orderCode: `B2B-QA-${stamp}`, businessPartnerId: bpId, status: 'placed', paymentMode: 'prepaid', paymentStatus: 'unpaid',
                subtotalPaise: q.subtotalPaise, gstPaise: q.gstPaise, totalPaise: q.totalPaise, razorpayOrderId: `order_B2B${stamp}`,
            }).returning();
            orderIds.push(order.id);
            const [item] = await db.insert(b2bOrderItems).values({
                orderId: order.id, sparePartId: cam.id, partCode: cam.partCode, name: cam.name, quantity: 2, unitPricePaise: 180_000, gstPercent: '18', lineTotalPaise: q.lines[0].lineTotalPaise,
            }).returning();

            let unpaid: unknown = null;
            try { await B2bOrderService.transition(order.id, 'confirmed', { type: 'admin', id: 1 }); } catch (err) { unpaid = err; }
            check('a prepaid order cannot be confirmed before it is paid', unpaid instanceof B2bOrderError && unpaid.code === 'UNPAID');

            const c1 = await B2bOrderService.applyCapture({ razorpayOrderId: order.razorpayOrderId, razorpayPaymentId: `pay_B2B${stamp}`, amountPaise: q.totalPaise });
            const c2 = await B2bOrderService.applyCapture({ razorpayOrderId: order.razorpayOrderId, razorpayPaymentId: `pay_B2B${stamp}`, amountPaise: q.totalPaise });
            check('payment applies once however many times it arrives', c1.applied && !c2.applied);
            const paid = (await B2bOrderService.detail(order.id))!;
            check('...moving the order to PAID with a payment event', paid.order.status === 'paid' && paid.events.some(ev => ev.eventType === 'payment_received'));
            const pos = await BusinessPartnerService.creditPosition(bpId);
            check('a prepaid order nets to zero on the ledger (invoice + payment)', pos.balancePaise === 0);

            await B2bOrderService.transition(order.id, 'confirmed', { type: 'admin', id: 1 });
            let skip: unknown = null;
            try { await B2bOrderService.transition(order.id, 'delivered', { type: 'admin', id: 1 }); } catch (err) { skip = err; }
            check('confirmed cannot jump straight to delivered', skip instanceof B2bOrderError && skip.code === 'BAD_TRANSITION');

            const before = (await SparePartsService.stockFor(cam.id)).find(s => s.location === 'warehouse')!.quantity;
            await B2bOrderService.transition(order.id, 'dispatched', { type: 'admin', id: 1 }, { courier: 'DTDC', trackingId: 'QA123' });
            const afterOnce = (await SparePartsService.stockFor(cam.id)).find(s => s.location === 'warehouse')!.quantity;
            check('DISPATCH is when stock leaves the warehouse', before - afterOnce === 2, `${before} → ${afterOnce}`);
            const [it] = await db.select().from(b2bOrderItems).where(eq(b2bOrderItems.id, item.id));
            check('...and the line records what was fulfilled', it.quantityFulfilled === 2);

            const movesForLine = await db.select().from(sparePartMovements).where(eq(sparePartMovements.b2bOrderItemId, item.id));
            check('one sold_to_partner movement per line, however dispatch is retried', movesForLine.length === 1 && movesForLine[0].movementType === 'sold_to_partner');

            const stages = B2bOrderService.stages((await B2bOrderService.detail(order.id))!.order);
            check('the tracking stages follow the status', stages.steps.find(s => s.key === 'dispatched')!.current && !stages.steps.find(s => s.key === 'delivered')!.done,
                stages.steps.map(s => `${s.key}${s.done ? '✓' : ''}`).join(' '));

            await B2bOrderService.transition(order.id, 'delivered', { type: 'admin', id: 1 });
            let tooLate: unknown = null;
            try { await B2bOrderService.partnerCancel(order.id, bpId, 'changed mind'); } catch (err) { tooLate = err; }
            check('a partner cannot cancel after UniteFix has committed', tooLate instanceof B2bOrderError && tooLate.code === 'TOO_LATE');

            await B2bOrderService.partnerRequestReturn(order.id, bpId, 'one camera dead on arrival');
            await B2bOrderService.transition(order.id, 'returned', { type: 'admin', id: 1 });
            const afterReturn = (await SparePartsService.stockFor(cam.id)).find(s => s.location === 'warehouse')!.quantity;
            check('an accepted return puts the stock back', afterReturn === before, `${afterReturn}`);
            const posR = await BusinessPartnerService.creditPosition(bpId);
            check('...and credits the partner for what they paid', posR.balancePaise === -q.totalPaise, R(posR.balancePaise));

            const st = await BusinessPartnerService.statement(bpId);
            check('the statement shows the whole story on one page', st.lines.length >= 5 && st.lines.every(l => l.source === 'b2b'), `${st.lines.length} lines`);
        }
    } finally {
        // Ledger first — it references orders.
        if (bpId) await db.delete(businessPartnerLedger).where(eq(businessPartnerLedger.businessPartnerId, bpId));
        if (orderIds.length) {
            await db.delete(sparePartMovements).where(inArray(sparePartMovements.b2bOrderItemId,
                (await db.select({ id: b2bOrderItems.id }).from(b2bOrderItems).where(inArray(b2bOrderItems.orderId, orderIds))).map(r => r.id).concat([-1])));
            await db.delete(b2bOrders).where(inArray(b2bOrders.id, orderIds));   // items/events cascade
        }
        if (bpId) {
            await db.delete(businessPartnerVerticals).where(eq(businessPartnerVerticals.businessPartnerId, bpId));
            await db.delete(businessPartners).where(eq(businessPartners.id, bpId));
        }
        if (partIds.length) {
            await db.delete(sparePartMovements).where(inArray(sparePartMovements.sparePartId, partIds));
            await db.delete(sparePartStock).where(inArray(sparePartStock.sparePartId, partIds));
            await db.delete(spareParts).where(inArray(spareParts.id, partIds));
        }
        if (employeeId) {
            const deps = await db.select({ id: partnerDeposits.id }).from(partnerDeposits).where(eq(partnerDeposits.employeeId, employeeId));
            if (deps.length) await db.delete(partnerDepositLedger).where(inArray(partnerDepositLedger.depositId, deps.map(d => d.id)));
            await db.delete(partnerDeposits).where(eq(partnerDeposits.employeeId, employeeId));
        }
        if (srId) {
            await db.delete(warrantyClaims).where(eq(warrantyClaims.serviceRequestId, srId));
            await db.delete(servicePartItems).where(eq(servicePartItems.serviceRequestId, srId));
            await db.delete(serviceRequests).where(eq(serviceRequests.id, srId));
        }
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
