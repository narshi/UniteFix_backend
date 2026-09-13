/**
 * Parts access — the technician deposit that unlocks fitting from UniteFix stock.
 *
 * COLLATERAL, NOT EARNINGS. The deposit is money the technician can lose. It
 * must never enter partner_wallets: that table has twelve writers and two
 * ledgers already found disagreeing in production, and a balance that means
 * something different from every other one would be the hardest drift in the
 * system to diagnose. Own table, own ledger, own Razorpay order, own refund.
 *
 * WHAT IT CLOSES. routeCost() has returned 'technician' as a cost bearer since
 * the warranty work shipped — for a workmanship fault, or a failed local part
 * with no bill — and nothing collected it. This is what a technician verdict
 * draws against. The "parts reserve" deferred back then is this, in a cleaner
 * form.
 *
 * STATE
 *   unpaid → pending_payment → held → partially_drawn → (topped up) held
 *                                   → refund_requested → refunded
 *                                   → forfeited
 *   parts_access on employees: none → requested (paid) → active (approved)
 *                                                       → suspended (below floor)
 *
 * MONEY IN follows the FTTH recharge shape exactly: a Razorpay order whose
 * notes carry payment_type and the deposit id, and BOTH the webhook and the
 * SDK verify callback land on one idempotent applyCapture(). Kill the app
 * after paying and the webhook still applies it; the webhook is slow and
 * verify applies it; whichever arrives first wins and the other is a no-op.
 *
 * MONEY OUT goes through Cashfree, the same rail as withdrawals, to the same
 * beneficiary.
 */

import Razorpay from 'razorpay';
import { db } from '../db';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import {
    employees, users, partnerDeposits, partnerDepositLedger, warrantyClaims, serviceRequests, sparePartStock,
    type PartnerDeposit,
} from '@shared/schema';
import { withTransaction } from '../lib/transaction';
import { configService } from './config.service';
import logger from '../lib/logger';

export type DepositEntryType =
    | 'paid_in' | 'drawn_warranty' | 'drawn_shortage' | 'drawn_damage' | 'topped_up' | 'refunded' | 'adjustment';

export class PartsAccessError extends Error {
    constructor(message: string, public readonly code: string) { super(message); this.name = 'PartsAccessError'; }
}

export class PartsAccessService {

    private static razorpay: Razorpay | null = null;
    private static async rzp(): Promise<Razorpay> {
        if (this.razorpay) return this.razorpay;
        const keyId = process.env.RAZORPAY_KEY_ID || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_ID')) || '';
        const keySecret = process.env.RAZORPAY_KEY_SECRET || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_SECRET')) || '';
        if (!keyId || !keySecret || keyId.includes('xxxxx')) throw new Error('Razorpay credentials not configured');
        this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
        return this.razorpay;
    }
    static async razorpayKeyId(): Promise<string> {
        return process.env.RAZORPAY_KEY_ID || (await configService.get<string>('PAYMENT_CONFIG.RAZORPAY_KEY_ID')) || '';
    }

    // ──────────────────────────────────────────────────────────────────────
    // Configuration
    // ──────────────────────────────────────────────────────────────────────

    static async requiredPaise(): Promise<number> {
        const v = Number(await configService.get('BUSINESS_CONFIG.PARTS_DEPOSIT_PAISE', 500_000));
        return Number.isFinite(v) && v > 0 ? Math.round(v) : 500_000;
    }
    static async floorPercent(): Promise<number> {
        const v = Number(await configService.get('BUSINESS_CONFIG.PARTS_DEPOSIT_FLOOR_PERCENT', 40));
        return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 40;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reads
    // ──────────────────────────────────────────────────────────────────────

    static async depositOf(employeeId: number, tx: typeof db = db): Promise<PartnerDeposit | null> {
        const [row] = await tx.select().from(partnerDeposits)
            .where(and(eq(partnerDeposits.employeeId, employeeId), eq(partnerDeposits.purpose, 'parts_access'))).limit(1);
        return row ?? null;
    }

    static remainingPaise(d: PartnerDeposit) { return Math.max(0, d.paidPaise - d.drawnPaise); }

    /** Everything the technician's screen and the admin tab need. */
    static async status(employeeId: number) {
        const [e] = await db.select({ access: employees.partsAccess, grantedAt: employees.partsAccessGrantedAt, name: employees.fullName })
            .from(employees).where(eq(employees.id, employeeId)).limit(1);
        const deposit = await this.depositOf(employeeId);
        const required = await this.requiredPaise();
        const floorPct = await this.floorPercent();
        const ledger = deposit
            ? await db.select().from(partnerDepositLedger).where(eq(partnerDepositLedger.depositId, deposit.id)).orderBy(desc(partnerDepositLedger.id)).limit(100)
            : [];
        const remaining = deposit ? this.remainingPaise(deposit) : 0;
        const floorPaise = Math.round(required * floorPct / 100);
        return {
            employeeId,
            name: e?.name ?? null,
            partsAccess: e?.access ?? 'none',
            grantedAt: e?.grantedAt ?? null,
            requiredPaise: required,
            floorPaise,
            deposit: deposit ? {
                id: deposit.id, status: deposit.status, paidPaise: deposit.paidPaise, drawnPaise: deposit.drawnPaise,
                remainingPaise: remaining, belowFloor: remaining < floorPaise, topUpNeededPaise: Math.max(0, required - remaining),
                paidAt: deposit.paidAt, refundedAt: deposit.refundedAt,
            } : null,
            ledger,
        };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Money in
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Start paying the deposit (or topping it back up). Returns a Razorpay order
     * the app opens. The amount is what is MISSING — required minus what is
     * still held — so a partially drawn deposit tops up to full, never over.
     */
    static async initiatePayment(employee: typeof employees.$inferSelect) {
        if (employee.documentVerificationStatus !== 'verified') {
            throw new PartsAccessError('Complete document verification before enabling spare parts.', 'NOT_VERIFIED');
        }
        const required = await this.requiredPaise();

        return withTransaction(async (tx) => {
            let deposit = await this.depositOf(employee.id, tx as any);
            if (!deposit) {
                [deposit] = await tx.insert(partnerDeposits).values({
                    employeeId: employee.id, purpose: 'parts_access', requiredPaise: required, status: 'unpaid',
                }).returning();
            }
            if (deposit.status === 'refund_requested' || deposit.status === 'refunded') {
                throw new PartsAccessError('A refund is in progress on this deposit. Contact UniteFix to re-enable.', 'REFUND_IN_PROGRESS');
            }
            if (deposit.status === 'forfeited') {
                throw new PartsAccessError('This deposit was forfeited. Contact UniteFix.', 'FORFEITED');
            }

            const amountPaise = Math.max(0, deposit.requiredPaise - this.remainingPaise(deposit));
            if (amountPaise <= 0) {
                throw new PartsAccessError('Your deposit is already fully held.', 'ALREADY_HELD');
            }

            const [user] = await tx.select({ username: users.username, email: users.email, phone: users.phone })
                .from(users).where(eq(users.id, employee.userId)).limit(1);

            const razorpay = await this.rzp();
            const order = await razorpay.orders.create({
                amount: amountPaise,
                currency: 'INR',
                receipt: `dep_${deposit.id}_${Date.now()}`.slice(0, 40),
                notes: {
                    payment_type: 'parts_deposit',
                    partner_deposit_id: String(deposit.id),
                    employee_id: String(employee.id),
                },
            });

            await tx.update(partnerDeposits).set({
                razorpayOrderId: order.id, status: deposit.paidPaise > 0 ? deposit.status : 'pending_payment', updatedAt: new Date(),
            }).where(eq(partnerDeposits.id, deposit.id));

            logger.info(`[DEPOSIT] Order ${order.id} for employee #${employee.id}: ${amountPaise} paise`);
            return {
                depositId: deposit.id,
                razorpayOrderId: order.id,
                razorpayKeyId: await this.razorpayKeyId(),
                amountPaise,
                isTopUp: deposit.paidPaise > 0,
                customer: { name: employee.fullName ?? user?.username ?? null, email: user?.email ?? null, phone: user?.phone ?? null },
            };
        });
    }

    /**
     * Money arrived. Idempotent: the deposit row is locked and a payment id
     * already recorded is a no-op, so webhook and verify can both call this.
     */
    static async applyCapture(params: { razorpayOrderId?: string | null; razorpayPaymentId: string; depositId?: number | null; amountPaise?: number }) {
        return withTransaction(async (tx) => {
            const locator = params.depositId ? eq(partnerDeposits.id, params.depositId)
                : params.razorpayOrderId ? eq(partnerDeposits.razorpayOrderId, params.razorpayOrderId) : null;
            if (!locator) return { applied: false, reason: 'no locator' };

            const [row] = await tx.select().from(partnerDeposits).where(locator).for('update').limit(1);
            if (!row) return { applied: false, reason: 'deposit not found' };
            if (row.razorpayPaymentId === params.razorpayPaymentId) return { applied: false, depositId: row.id, reason: 'already applied' };

            // Trust the captured amount if Razorpay gave one; otherwise what the order asked for.
            const paidNow = params.amountPaise && params.amountPaise > 0
                ? params.amountPaise : Math.max(0, row.requiredPaise - this.remainingPaise(row));
            const isTopUp = row.paidPaise > 0;

            const before = this.remainingPaise(row);
            const after = before + paidNow;
            await tx.insert(partnerDepositLedger).values({
                depositId: row.id, entryType: isTopUp ? 'topped_up' : 'paid_in', amountPaise: paidNow,
                balanceBeforePaise: before, balanceAfterPaise: after, notes: `Razorpay ${params.razorpayPaymentId}`,
            });

            const newPaid = row.paidPaise + paidNow;
            const remaining = Math.max(0, newPaid - row.drawnPaise);
            const floor = Math.round(row.requiredPaise * (await this.floorPercent()) / 100);
            await tx.update(partnerDeposits).set({
                paidPaise: newPaid,
                status: remaining >= row.requiredPaise ? 'held' : 'partially_drawn',
                razorpayPaymentId: params.razorpayPaymentId,
                paidAt: row.paidAt ?? new Date(),
                updatedAt: new Date(),
            }).where(eq(partnerDeposits.id, row.id));

            // Access: first payment → requested (admin still approves). A top-up that
            // lifts a suspended technician back above the floor → active again —
            // suspension only ever came from the floor, so clearing it clears the cause.
            const [emp] = await tx.select({ access: employees.partsAccess }).from(employees).where(eq(employees.id, row.employeeId)).limit(1);
            if (emp?.access === 'none') {
                await tx.update(employees).set({ partsAccess: 'requested', updatedAt: new Date() }).where(eq(employees.id, row.employeeId));
            } else if (emp?.access === 'suspended' && remaining >= floor) {
                await tx.update(employees).set({ partsAccess: 'active', updatedAt: new Date() }).where(eq(employees.id, row.employeeId));
                logger.info(`[DEPOSIT] Employee #${row.employeeId} topped up above the floor — parts access restored`);
            }

            logger.info(`[DEPOSIT] Applied ${paidNow} paise to deposit #${row.id} (employee #${row.employeeId}); remaining ${remaining}`);
            return { applied: true, depositId: row.id, remainingPaise: remaining };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Admin decisions
    // ──────────────────────────────────────────────────────────────────────

    /** The deposit proves commitment; this is where a person decides. */
    static async approve(employeeId: number, adminId: number) {
        const d = await this.depositOf(employeeId);
        if (!d || !['held', 'partially_drawn'].includes(d.status) || d.paidPaise <= 0) {
            throw new PartsAccessError('The deposit has not been paid yet.', 'DEPOSIT_UNPAID');
        }
        const [row] = await db.update(employees).set({
            partsAccess: 'active', partsAccessGrantedAt: new Date(), partsAccessGrantedBy: adminId, updatedAt: new Date(),
        }).where(eq(employees.id, employeeId)).returning({ id: employees.id, access: employees.partsAccess });
        logger.info(`[DEPOSIT] Parts access approved for employee #${employeeId} by admin #${adminId}`);
        return row ?? null;
    }

    static async suspend(employeeId: number, adminId: number, reason: string) {
        const [row] = await db.update(employees).set({ partsAccess: 'suspended', updatedAt: new Date() })
            .where(eq(employees.id, employeeId)).returning({ id: employees.id, access: employees.partsAccess });
        logger.warn(`[DEPOSIT] Parts access suspended for employee #${employeeId} by admin #${adminId}: ${reason}`);
        return row ?? null;
    }

    static async reinstate(employeeId: number, adminId: number) {
        const st = await this.status(employeeId);
        if (!st.deposit || st.deposit.belowFloor) {
            throw new PartsAccessError('The deposit is below the floor; it must be topped up before access is restored.', 'BELOW_FLOOR');
        }
        const [row] = await db.update(employees).set({ partsAccess: 'active', partsAccessGrantedBy: adminId, updatedAt: new Date() })
            .where(eq(employees.id, employeeId)).returning({ id: employees.id, access: employees.partsAccess });
        return row ?? null;
    }

    /**
     * Draw against the deposit. Every draw names what caused it. When the
     * remainder falls below the floor, access is suspended until topped up —
     * said to the technician with the reason, not just switched off.
     */
    static async draw(input: {
        employeeId: number; amountPaise: number; entryType: 'drawn_warranty' | 'drawn_shortage' | 'drawn_damage' | 'adjustment';
        warrantyClaimId?: number | null; sparePartMovementId?: number | null; adminId: number; notes?: string | null;
    }) {
        if (!(input.amountPaise > 0)) throw new PartsAccessError('Amount must be positive', 'BAD_AMOUNT');
        return withTransaction(async (tx) => {
            const d = await this.depositOf(input.employeeId, tx as any);
            if (!d || d.paidPaise <= 0) throw new PartsAccessError('No deposit held for this technician.', 'DEPOSIT_UNPAID');

            const before = this.remainingPaise(d);
            // Never draw more than is held. The excess is a debt the ledger cannot
            // express — record what can be taken and say so.
            const amount = Math.min(input.amountPaise, before);
            if (amount <= 0) throw new PartsAccessError('The deposit is already exhausted.', 'EXHAUSTED');

            const rows = await tx.insert(partnerDepositLedger).values({
                depositId: d.id, entryType: input.entryType, amountPaise: -amount,
                warrantyClaimId: input.warrantyClaimId ?? null, sparePartMovementId: input.sparePartMovementId ?? null,
                balanceBeforePaise: before, balanceAfterPaise: before - amount,
                createdByAdminId: input.adminId, notes: input.notes ?? null,
            }).onConflictDoNothing().returning();
            if (!rows.length) return { drawn: 0, remainingPaise: before, suspended: false, duplicate: true };

            const drawn = d.drawnPaise + amount;
            const remaining = Math.max(0, d.paidPaise - drawn);
            const floor = Math.round(d.requiredPaise * (await this.floorPercent()) / 100);
            await tx.update(partnerDeposits).set({
                drawnPaise: drawn, status: remaining <= 0 ? 'forfeited' : 'partially_drawn', updatedAt: new Date(),
            }).where(eq(partnerDeposits.id, d.id));

            let suspended = false;
            if (remaining < floor) {
                await tx.update(employees).set({ partsAccess: 'suspended', updatedAt: new Date() })
                    .where(and(eq(employees.id, input.employeeId), eq(employees.partsAccess, 'active')));
                suspended = true;
                logger.warn(`[DEPOSIT] Employee #${input.employeeId} below floor (${remaining} < ${floor}) — parts access suspended`);
            }
            logger.info(`[DEPOSIT] Drew ${amount} paise (${input.entryType}) from employee #${input.employeeId}; remaining ${remaining}`);
            return { drawn: amount, shortfall: input.amountPaise - amount, remainingPaise: remaining, suspended, duplicate: false };
        });
    }

    /** A warranty verdict that fell on the technician: the part's line total, drawn once per claim. */
    static async drawForClaim(claimId: number, adminId: number) {
        const [claim] = await db.select().from(warrantyClaims).where(eq(warrantyClaims.id, claimId)).limit(1);
        if (!claim) return null;
        if (claim.costBearer !== 'technician') {
            throw new PartsAccessError(`This claim's cost is borne by ${claim.costBearer ?? 'nobody yet'}, not the technician.`, 'NOT_TECHNICIAN_BEARER');
        }
        const [booking] = await db.select({ providerId: serviceRequests.providerId }).from(serviceRequests)
            .where(eq(serviceRequests.id, claim.serviceRequestId)).limit(1);
        if (!booking?.providerId) throw new PartsAccessError('No technician on this booking.', 'NO_TECHNICIAN');

        let amountPaise = 0;
        if (claim.partItemId) {
            const { servicePartItems } = await import('@shared/schema');
            const [line] = await db.select().from(servicePartItems).where(eq(servicePartItems.id, claim.partItemId)).limit(1);
            amountPaise = line ? line.unitPricePaise * line.quantity : 0;
        }
        if (amountPaise <= 0) throw new PartsAccessError('No part amount to draw for this claim; use a manual draw with an amount.', 'NO_AMOUNT');

        return this.draw({
            employeeId: booking.providerId, amountPaise, entryType: 'drawn_warranty', warrantyClaimId: claimId, adminId,
            notes: `Warranty claim ${claim.claimId}: ${claim.verdict}`,
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Money out
    // ──────────────────────────────────────────────────────────────────────

    /** Can this technician have their deposit back? Every reason, not just the first. */
    static async refundBlockers(employeeId: number): Promise<string[]> {
        const blockers: string[] = [];
        const kit = await db.select({ q: sql<number>`coalesce(sum(${sparePartStock.quantity}), 0)` }).from(sparePartStock)
            .where(and(eq(sparePartStock.location, 'technician'), eq(sparePartStock.holderEmployeeId, employeeId)));
        if (Number(kit[0]?.q ?? 0) > 0) blockers.push(`${kit[0].q} part(s) still in their kit — return them first`);

        const open = await db.select({ id: warrantyClaims.id }).from(warrantyClaims)
            .innerJoin(serviceRequests, eq(serviceRequests.id, warrantyClaims.serviceRequestId))
            .where(and(eq(serviceRequests.providerId, employeeId), inArray(warrantyClaims.status, ['open', 'inspecting'])));
        if (open.length) blockers.push(`${open.length} open warranty claim(s) on their jobs`);
        return blockers;
    }

    static async requestRefund(employeeId: number) {
        const d = await this.depositOf(employeeId);
        if (!d || d.paidPaise <= 0) throw new PartsAccessError('No deposit to refund.', 'DEPOSIT_UNPAID');
        const blockers = await this.refundBlockers(employeeId);
        if (blockers.length) throw new PartsAccessError(`Cannot refund yet: ${blockers.join('; ')}.`, 'REFUND_BLOCKED');
        await db.update(partnerDeposits).set({ status: 'refund_requested', updatedAt: new Date() }).where(eq(partnerDeposits.id, d.id));
        await db.update(employees).set({ partsAccess: 'none', updatedAt: new Date() }).where(eq(employees.id, employeeId));
        return { depositId: d.id, refundablePaise: this.remainingPaise(d) };
    }

    /**
     * Pay the remainder back through Cashfree. On success the ledger closes to
     * zero; on failure the deposit stays refund_requested for a manual transfer.
     */
    static async executeRefund(employeeId: number, adminId: number, opts?: { manualReference?: string }) {
        const d = await this.depositOf(employeeId);
        if (!d || d.status !== 'refund_requested') throw new PartsAccessError('No refund is pending for this technician.', 'NO_REFUND_PENDING');
        const amount = this.remainingPaise(d);
        if (amount <= 0) throw new PartsAccessError('Nothing left to refund.', 'EXHAUSTED');

        let reference = opts?.manualReference ?? null;
        if (!reference) {
            const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
            const { CashfreeService } = await import('./cashfree.service');
            const beneId = await CashfreeService.syncEmployeeForPayouts(emp);
            const payout = await CashfreeService.createPayout(beneId, amount / 100, `DEP-REF-${d.id}`, 'deposit refund');
            reference = payout.transferId;
        }

        return withTransaction(async (tx) => {
            await tx.insert(partnerDepositLedger).values({
                depositId: d.id, entryType: 'refunded', amountPaise: -amount,
                balanceBeforePaise: amount, balanceAfterPaise: 0, createdByAdminId: adminId, notes: `Refund ${reference}`,
            });
            await tx.update(partnerDeposits).set({
                drawnPaise: d.paidPaise, status: 'refunded', refundedAt: new Date(), refundReference: reference, updatedAt: new Date(),
            }).where(eq(partnerDeposits.id, d.id));
            logger.info(`[DEPOSIT] Refunded ${amount} paise to employee #${employeeId} (${reference})`);
            return { refundedPaise: amount, reference };
        });
    }

    /** For the admin tab: everyone with a deposit or a non-default access state. */
    static async listForAdmin(filter?: { access?: string }) {
        const rows = await db.select({
            employeeId: employees.id, name: employees.fullName, access: employees.partsAccess, grantedAt: employees.partsAccessGrantedAt,
            deposit: partnerDeposits,
        }).from(employees)
            .leftJoin(partnerDeposits, and(eq(partnerDeposits.employeeId, employees.id), eq(partnerDeposits.purpose, 'parts_access')))
            .where(filter?.access && filter.access !== 'all'
                ? eq(employees.partsAccess, filter.access as any)
                : sql`${employees.partsAccess} <> 'none' OR ${partnerDeposits.id} IS NOT NULL`)
            .orderBy(desc(partnerDeposits.updatedAt));
        return rows;
    }
}
