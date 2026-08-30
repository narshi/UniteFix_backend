/**
 * FTTH business logic.
 *
 * Routes stay thin because the important part here — applying a paid recharge —
 * has to be callable from TWO places: the Razorpay webhook (the source of truth)
 * and /api/payments/verify (the mobile SDK's optimistic callback). If the app is
 * killed after checkout, only the webhook fires. If Razorpay's webhook is slow,
 * only verify fires. Both must land on the same idempotent function, or you get
 * the failure this codebase has already paid for once: money taken, nothing
 * extended, no record.
 *
 * MONEY IS INTEGER PAISE. Rupees appear only at the UI boundary.
 */

import Razorpay from "razorpay";
import { and, eq, sql, desc, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import {
    ftthOperators,
    ftthPlans,
    ftthConnections,
    ftthRecharges,
    ftthLeads,
    ftthOperatorLedger,
    paymentTransactions,
    users,
} from "@shared/schema";
import { withTransaction } from "../lib/transaction";
import { configService } from "./config.service";
import { PaymentTrackingService } from "./payment-tracking.service";
import logger from "../lib/logger";

/** Paise → rupees, for display only. */
export const paiseToRupees = (paise: number) => Math.round(paise) / 100;

export interface RechargeQuote {
    planId: number;
    planName: string;
    speedMbps: number;
    durationMonths: number;
    listPricePaise: number;
    discountPaise: number;
    convenienceFeePaise: number;
    gstOnConvenienceFeePaise: number;
    totalPaise: number;
    operatorPayablePaise: number;
    platformRevenuePaise: number;
}

export class FtthService {

    private static razorpay: Razorpay | null = null;

    private static async getRazorpay(): Promise<Razorpay> {
        if (this.razorpay) return this.razorpay;

        // Same precedence as PaymentService: env is authoritative for secrets,
        // platform_config is a fallback that may hold seed placeholders.
        let keyId = process.env.RAZORPAY_KEY_ID
            || (await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_ID")) || undefined;
        let keySecret = process.env.RAZORPAY_KEY_SECRET
            || (await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_SECRET")) || undefined;

        if (keyId?.includes('xxxxx')) keyId = process.env.RAZORPAY_KEY_ID;
        if (keySecret?.includes('xxxxx')) keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) throw new Error("Razorpay credentials not configured");

        this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
        return this.razorpay;
    }

    static async razorpayKeyId(): Promise<string> {
        return process.env.RAZORPAY_KEY_ID
            || (await configService.get<string>("PAYMENT_CONFIG.RAZORPAY_KEY_ID"))
            || '';
    }

    // ==================== PRICING ====================

    /**
     * Price one recharge, freezing every number onto the result.
     *
     * The convenience fee is UniteFix's own supply, so GST is CARVED OUT of it
     * the same way billing-engine.ts:164 carves it out of a list price:
     *
     *     gst = round(fee × pct / (100 + pct))
     *
     * ₹10 collected is ₹8.47 revenue and ₹1.53 GST — not ₹10 of margin. The plan
     * amount itself is the OPERATOR's supply to the customer and passes through
     * untouched; UniteFix invoices only its own fee.
     */
    static async quote(plan: typeof ftthPlans.$inferSelect, operatorId: number): Promise<RechargeQuote> {
        const [operator] = await db
            .select({ convenienceFeePaise: ftthOperators.convenienceFeePaise })
            .from(ftthOperators)
            .where(eq(ftthOperators.id, operatorId))
            .limit(1);

        // Per-operator term wins; platform default is only a fallback.
        const defaultFee = parseInt(
            (await configService.get<string>('FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE')) || '1000', 10,
        );
        const convenienceFeePaise = operator?.convenienceFeePaise ?? defaultFee;

        const gstPercent = parseFloat(
            (await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE')) || '18',
        );
        const gstOnConvenienceFeePaise = Math.round(
            convenienceFeePaise * gstPercent / (100 + gstPercent),
        );

        const operatorPayablePaise = plan.listPricePaise - plan.discountPaise;
        const totalPaise = operatorPayablePaise + convenienceFeePaise;

        return {
            planId: plan.id,
            planName: plan.name,
            speedMbps: plan.speedMbps,
            durationMonths: plan.durationMonths,
            listPricePaise: plan.listPricePaise,
            discountPaise: plan.discountPaise,
            convenienceFeePaise,
            gstOnConvenienceFeePaise,
            totalPaise,
            operatorPayablePaise,
            platformRevenuePaise: convenienceFeePaise - gstOnConvenienceFeePaise,
        };
    }

    // ==================== VALIDITY ARITHMETIC ====================

    /**
     * When does the new validity period start?
     *
     * Renewing EARLY extends from the current expiry, so a customer who tops up
     * a week before running out does not forfeit that week. Renewing after
     * expiry starts from today. The earlier plan's "update nextRenewalDate" hid
     * all of this.
     */
    static periodStartFor(validTill: Date | null, now = new Date()): Date {
        return validTill && validTill.getTime() > now.getTime() ? new Date(validTill) : new Date(now);
    }

    /**
     * Add months without the classic end-of-month bug: 31 Jan + 1 month must be
     * 28/29 Feb, not 3 March. setMonth alone rolls over.
     */
    static addMonths(from: Date, months: number): Date {
        const d = new Date(from);
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + months);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(day, lastDay));
        return d;
    }

    // ==================== LEDGER ====================

    /**
     * Append one ledger entry, carrying the running balance forward.
     *
     * Must be called INSIDE a transaction — the balance read and the insert have
     * to be atomic or two concurrent recharges both read the same "before" and
     * the running balance goes wrong.
     *
     * Returns null when the entry already exists: the unique indexes on
     * (entryType, rechargeId) and (entryType, leadId) make a replayed webhook a
     * no-op rather than a double credit.
     */
    private static async appendLedger(
        tx: typeof db,
        entry: {
            operatorId: number;
            entryType: 'recharge_collected' | 'platform_fee' | 'lead_fee' | 'settlement_paid' | 'adjustment';
            amountPaise: number;
            rechargeId?: number | null;
            leadId?: number | null;
            description?: string;
            createdByAdminId?: number | null;
            metadata?: Record<string, unknown>;
        },
    ): Promise<typeof ftthOperatorLedger.$inferSelect | null> {
        const [current] = await tx
            .select({ balance: ftthOperatorLedger.balanceAfterPaise })
            .from(ftthOperatorLedger)
            .where(eq(ftthOperatorLedger.operatorId, entry.operatorId))
            .orderBy(desc(ftthOperatorLedger.id))
            .limit(1);

        const before = current?.balance ?? 0;
        const after = before + entry.amountPaise;

        const rows = await tx.insert(ftthOperatorLedger).values({
            operatorId: entry.operatorId,
            entryType: entry.entryType,
            amountPaise: entry.amountPaise,
            rechargeId: entry.rechargeId ?? null,
            leadId: entry.leadId ?? null,
            balanceBeforePaise: before,
            balanceAfterPaise: after,
            description: entry.description ?? null,
            metadata: (entry.metadata ?? null) as any,
            createdByAdminId: entry.createdByAdminId ?? null,
        }).onConflictDoNothing().returning();

        return rows[0] ?? null;
    }

    /** Current balance owed to an operator, in paise. Positive = UniteFix owes them. */
    static async operatorBalancePaise(operatorId: number): Promise<number> {
        const [row] = await db
            .select({ balance: ftthOperatorLedger.balanceAfterPaise })
            .from(ftthOperatorLedger)
            .where(eq(ftthOperatorLedger.operatorId, operatorId))
            .orderBy(desc(ftthOperatorLedger.id))
            .limit(1);
        return row?.balance ?? 0;
    }

    /** Public wrapper for entries raised outside a recharge (settlements, adjustments). */
    static async recordLedgerEntry(entry: {
        operatorId: number;
        entryType: 'settlement_paid' | 'adjustment' | 'lead_fee';
        amountPaise: number;
        leadId?: number | null;
        description?: string;
        createdByAdminId?: number | null;
        metadata?: Record<string, unknown>;
    }) {
        return withTransaction(async (tx) => this.appendLedger(tx, entry));
    }

    // ==================== RECHARGE ====================

    /**
     * Raise a Razorpay order for a recharge.
     *
     * The `notes` are load-bearing, not decoration: Razorpay echoes them back on
     * the webhook, and that is how the capture finds its way home. This is the
     * same mechanism PaymentService.handleWebhook already uses for bookings
     * (payment.service.ts:419-427).
     */
    static async initiateRecharge(params: {
        connection: typeof ftthConnections.$inferSelect;
        plan: typeof ftthPlans.$inferSelect;
        customer: { name?: string | null; email?: string | null; phone?: string | null };
    }) {
        const { connection, plan, customer } = params;
        const quote = await this.quote(plan, connection.operatorId);

        const recharge = await withTransaction(async (tx) => {
            const [row] = await tx.insert(ftthRecharges).values({
                connectionId: connection.id,
                planId: plan.id,
                planName: quote.planName,
                speedMbps: quote.speedMbps,
                durationMonths: quote.durationMonths,
                listPricePaise: quote.listPricePaise,
                discountPaise: quote.discountPaise,
                convenienceFeePaise: quote.convenienceFeePaise,
                gstOnConvenienceFeePaise: quote.gstOnConvenienceFeePaise,
                totalPaise: quote.totalPaise,
                operatorPayablePaise: quote.operatorPayablePaise,
                platformRevenuePaise: quote.platformRevenuePaise,
                status: 'created',
            }).returning();
            return row;
        });

        const razorpay = await this.getRazorpay();
        const order = await razorpay.orders.create({
            amount: quote.totalPaise,
            currency: "INR",
            receipt: `ftth_${recharge.id}_${Date.now()}`.slice(0, 40),
            notes: {
                payment_type: "ftth_recharge",
                ftth_recharge_id: String(recharge.id),
                ftth_connection_id: String(connection.id),
            },
        });

        await db.update(ftthRecharges)
            .set({ razorpayOrderId: order.id, status: 'pending', updatedAt: new Date() })
            .where(eq(ftthRecharges.id, recharge.id));

        // Belt and braces: the order_created row carries the link too, so the
        // recharge is still resolvable if `notes` are ever absent.
        await PaymentTrackingService.recordPaymentEvent({
            ftthRechargeId: recharge.id,
            razorpayOrderId: order.id,
            amount: quote.totalPaise,
            currency: 'INR',
            eventType: 'order_created',
            status: 'pending',
            metadata: { paymentType: 'ftth_recharge', connectionId: connection.id, planId: plan.id },
        });

        return {
            rechargeId: recharge.id,
            razorpayOrderId: order.id,
            razorpayKeyId: await this.razorpayKeyId(),
            amountPaise: quote.totalPaise,
            quote,
            customer,
        };
    }

    /**
     * Apply a captured payment. THE idempotent entry point.
     *
     * Called by the webhook and by /api/payments/verify, in either order, any
     * number of times. Re-entry after success is a no-op — which is what makes a
     * replayed webhook safe and what stops a double-credit in the ledger.
     */
    static async applyCapture(params: {
        razorpayOrderId?: string | null;
        razorpayPaymentId: string;
        rechargeId?: number | null;
        amountPaise?: number;
        method?: string;
    }): Promise<{ applied: boolean; rechargeId?: number; reason?: string }> {
        const { razorpayOrderId, razorpayPaymentId, amountPaise, method } = params;

        return withTransaction(async (tx) => {
            // Lock the row: two callers arriving together must not both apply.
            const locator = params.rechargeId
                ? eq(ftthRecharges.id, params.rechargeId)
                : razorpayOrderId
                    ? eq(ftthRecharges.razorpayOrderId, razorpayOrderId)
                    : null;

            if (!locator) return { applied: false, reason: 'no_locator' };

            const [recharge] = await tx.select().from(ftthRecharges).where(locator).limit(1);
            if (!recharge) return { applied: false, reason: 'recharge_not_found' };

            if (recharge.status === 'success') {
                return { applied: false, rechargeId: recharge.id, reason: 'already_applied' };
            }
            if (recharge.status === 'refunded') {
                return { applied: false, rechargeId: recharge.id, reason: 'refunded' };
            }

            const [connection] = await tx.select().from(ftthConnections)
                .where(eq(ftthConnections.id, recharge.connectionId)).limit(1);
            if (!connection) return { applied: false, reason: 'connection_not_found' };

            const now = new Date();
            const periodStart = this.periodStartFor(connection.validTill, now);
            const periodEnd = this.addMonths(periodStart, recharge.durationMonths);

            await tx.update(ftthRecharges).set({
                status: 'success',
                razorpayPaymentId,
                razorpayOrderId: recharge.razorpayOrderId ?? razorpayOrderId ?? null,
                periodStart,
                periodEnd,
                updatedAt: now,
            }).where(eq(ftthRecharges.id, recharge.id));

            await tx.update(ftthConnections).set({
                validTill: periodEnd,
                currentPlanId: recharge.planId,
                // A paid recharge on a suspended connection reactivates it; a
                // connection still awaiting its ISP id stays pending_id, because
                // paying does not conjure an id out of the operator's system.
                status: connection.status === 'pending_id' ? 'pending_id' : 'active',
                updatedAt: now,
            }).where(eq(ftthConnections.id, connection.id));

            // Ledger, in the SAME transaction as the validity extension. If these
            // could diverge you would eventually owe an operator for a recharge
            // that never landed, or vice versa.
            await this.appendLedger(tx, {
                operatorId: connection.operatorId,
                entryType: 'recharge_collected',
                amountPaise: recharge.operatorPayablePaise,
                rechargeId: recharge.id,
                description: `Recharge #${recharge.id} — ${recharge.planName}`,
                metadata: { razorpayPaymentId, method: method ?? null },
            });

            if (recharge.platformRevenuePaise > 0 || recharge.convenienceFeePaise > 0) {
                await this.appendLedger(tx, {
                    operatorId: connection.operatorId,
                    entryType: 'platform_fee',
                    amountPaise: 0, // the fee is collected on top; it is not deducted from the operator
                    rechargeId: recharge.id,
                    description: `UniteFix convenience fee on recharge #${recharge.id}`,
                    metadata: {
                        convenienceFeePaise: recharge.convenienceFeePaise,
                        gstPaise: recharge.gstOnConvenienceFeePaise,
                        platformRevenuePaise: recharge.platformRevenuePaise,
                    },
                });
            }

            logger.info('[FTTH] Recharge applied', {
                rechargeId: recharge.id,
                connectionId: connection.id,
                validTill: periodEnd.toISOString(),
                amountPaise: amountPaise ?? recharge.totalPaise,
            });

            return { applied: true, rechargeId: recharge.id };
        });
    }

    /** Mark a recharge failed. Safe to call on an already-successful row (no-op). */
    static async markFailed(params: {
        razorpayOrderId?: string | null;
        rechargeId?: number | null;
        reason?: string;
    }): Promise<void> {
        const locator = params.rechargeId
            ? eq(ftthRecharges.id, params.rechargeId)
            : params.razorpayOrderId
                ? eq(ftthRecharges.razorpayOrderId, params.razorpayOrderId)
                : null;
        if (!locator) return;

        await db.update(ftthRecharges)
            .set({ status: 'failed', failureReason: params.reason ?? null, updatedAt: new Date() })
            .where(and(locator, inArray(ftthRecharges.status, ['created', 'pending'])));
    }

    /**
     * Resolve a recharge id from a Razorpay order, for callers that only have the
     * order id. Reads the order_created row rather than trusting `notes`.
     */
    static async rechargeIdForOrder(razorpayOrderId: string): Promise<number | null> {
        const [row] = await db
            .select({ id: ftthRecharges.id })
            .from(ftthRecharges)
            .where(eq(ftthRecharges.razorpayOrderId, razorpayOrderId))
            .limit(1);
        if (row) return row.id;

        const [tx] = await db
            .select({ id: paymentTransactions.ftthRechargeId })
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.razorpayOrderId, razorpayOrderId),
                sql`${paymentTransactions.ftthRechargeId} IS NOT NULL`,
            ))
            .limit(1);
        return tx?.id ?? null;
    }

    // ==================== LEADS ====================

    /**
     * Convert a lead: create the connection and accrue the lead fee.
     *
     * The fee is a NEGATIVE ledger entry — the operator owes UniteFix a bounty,
     * so it reduces what UniteFix owes them at settlement. Idempotent via the
     * (entryType, leadId) unique index.
     */
    static async convertLead(params: {
        leadId: number;
        operatorId: number;
        ispConnectionId?: string | null;
        adminUserId: number;
    }) {
        const { leadId, operatorId, ispConnectionId, adminUserId } = params;

        const defaultLeadFee = parseInt(
            (await configService.get<string>('FTTH_CONFIG.DEFAULT_LEAD_FEE_PAISE')) || '40000', 10,
        );

        return withTransaction(async (tx) => {
            const [lead] = await tx.select().from(ftthLeads)
                .where(and(eq(ftthLeads.id, leadId), eq(ftthLeads.operatorId, operatorId)))
                .limit(1);
            if (!lead) throw new Error('Lead not found');
            if (lead.status === 'converted') throw new Error('This lead is already converted');

            const [operator] = await tx.select({ leadFeePaise: ftthOperators.leadFeePaise })
                .from(ftthOperators).where(eq(ftthOperators.id, operatorId)).limit(1);
            const leadFeePaise = operator?.leadFeePaise ?? defaultLeadFee;

            // A customer may already hold a connection with this operator — the
            // unique index would reject a second one, so reuse it.
            const [existing] = await tx.select().from(ftthConnections)
                .where(and(
                    eq(ftthConnections.userId, lead.userId),
                    eq(ftthConnections.operatorId, operatorId),
                )).limit(1);

            let connection = existing;
            if (!connection) {
                const [created] = await tx.insert(ftthConnections).values({
                    userId: lead.userId,
                    operatorId,
                    ispConnectionId: ispConnectionId || null,
                    status: ispConnectionId ? 'active' : 'pending_id',
                    customerName: lead.name,
                    installationAddress: lead.address,
                }).returning();
                connection = created;
            } else if (ispConnectionId && !connection.ispConnectionId) {
                const [updated] = await tx.update(ftthConnections)
                    .set({ ispConnectionId, status: 'active', updatedAt: new Date() })
                    .where(eq(ftthConnections.id, connection.id))
                    .returning();
                connection = updated;
            }

            await tx.update(ftthLeads).set({
                status: 'converted',
                convertedConnectionId: connection.id,
                leadFeePaise,
                convertedAt: new Date(),
                updatedAt: new Date(),
            }).where(eq(ftthLeads.id, leadId));

            await this.appendLedger(tx, {
                operatorId,
                entryType: 'lead_fee',
                amountPaise: -leadFeePaise,
                leadId,
                description: `Lead acquisition fee — ${lead.name}`,
                createdByAdminId: adminUserId,
            });

            return { connection, leadFeePaise };
        });
    }

    // ==================== ROSTER AUTO-LINKING ====================

    /**
     * When a customer registers or logs in with their mobile number, claim any
     * pre-seeded operator connection matching their phone.
     */
    static async autoLinkCustomerConnections(userId: number, rawPhone?: string | null): Promise<number> {
        if (!rawPhone) return 0;
        const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
        if (cleanPhone.length !== 10) return 0;

        try {
            const result = await db.update(ftthConnections)
                .set({ userId, updatedAt: new Date() })
                .where(and(
                    eq(ftthConnections.customerPhone, cleanPhone),
                    isNull(ftthConnections.userId),
                ))
                .returning({ id: ftthConnections.id });

            if (result.length > 0) {
                logger.info('[FTTH] Auto-linked pre-seeded connections for user', {
                    userId,
                    phone: cleanPhone,
                    count: result.length,
                    connectionIds: result.map(c => c.id),
                });
            }
            return result.length;
        } catch (err: any) {
            logger.warn('[FTTH] Auto-linking skipped or failed', { userId, phone: cleanPhone, error: err?.message });
            return 0;
        }
    }

    // ==================== CUSTOMER LOOKUP ====================

    /**
     * Look up a connection under an operator by ISP Connection ID or Phone.
     */
    static async lookupCustomerConnection(params: {
        operatorId: number;
        query: string;
        authUserId?: number | null;
    }) {
        const { operatorId, query, authUserId } = params;
        const cleanQuery = query.trim();
        const cleanPhone = cleanQuery.replace(/\D/g, '').slice(-10);

        const conditions = [
            eq(ftthConnections.operatorId, operatorId),
            or(
                sql`LOWER(${ftthConnections.ispConnectionId}) = LOWER(${cleanQuery})`,
                cleanPhone.length === 10 ? eq(ftthConnections.customerPhone, cleanPhone) : sql`false`,
            ),
        ];

        const [connection] = await db.select({
            id: ftthConnections.id,
            operatorId: ftthConnections.operatorId,
            ispConnectionId: ftthConnections.ispConnectionId,
            customerName: ftthConnections.customerName,
            customerPhone: ftthConnections.customerPhone,
            customerEmail: ftthConnections.customerEmail,
            status: ftthConnections.status,
            validTill: ftthConnections.validTill,
            currentPlanId: ftthConnections.currentPlanId,
            userId: ftthConnections.userId,
        })
            .from(ftthConnections)
            .where(and(...conditions))
            .limit(1);

        if (!connection) {
            return { exists: false };
        }

        // If caller is authenticated and connection is unlinked, claim it automatically
        if (authUserId && !connection.userId) {
            await db.update(ftthConnections)
                .set({ userId: authUserId, updatedAt: new Date() })
                .where(eq(ftthConnections.id, connection.id));
            connection.userId = authUserId;
        }

        const now = Date.now();
        const daysRemaining = connection.validTill
            ? Math.ceil((connection.validTill.getTime() - now) / 86_400_000)
            : null;

        const [operator] = await db.select({
            id: ftthOperators.id,
            companyName: ftthOperators.companyName,
            logoUrl: ftthOperators.logoUrl,
            brandColor: ftthOperators.brandColor,
        }).from(ftthOperators).where(eq(ftthOperators.id, operatorId)).limit(1);

        return {
            exists: true,
            connection: {
                ...connection,
                operatorName: operator?.companyName ?? 'Broadband',
                daysRemaining,
                isExpired: connection.validTill ? connection.validTill.getTime() < now : false,
            },
        };
    }

    // ==================== RECHARGE TRACKING ====================

    /**
     * Detailed 3-stage tracking for a broadband recharge.
     */
    static async getRechargeTracking(rechargeId: number, userId?: number | null) {
        const [recharge] = await db.select({
            id: ftthRecharges.id,
            connectionId: ftthRecharges.connectionId,
            planId: ftthRecharges.planId,
            planName: ftthRecharges.planName,
            speedMbps: ftthRecharges.speedMbps,
            durationMonths: ftthRecharges.durationMonths,
            listPricePaise: ftthRecharges.listPricePaise,
            discountPaise: ftthRecharges.discountPaise,
            convenienceFeePaise: ftthRecharges.convenienceFeePaise,
            gstOnConvenienceFeePaise: ftthRecharges.gstOnConvenienceFeePaise,
            totalPaise: ftthRecharges.totalPaise,
            status: ftthRecharges.status,
            periodStart: ftthRecharges.periodStart,
            periodEnd: ftthRecharges.periodEnd,
            fulfilledAt: ftthRecharges.fulfilledAt,
            razorpayOrderId: ftthRecharges.razorpayOrderId,
            razorpayPaymentId: ftthRecharges.razorpayPaymentId,
            failureReason: ftthRecharges.failureReason,
            createdAt: ftthRecharges.createdAt,
            updatedAt: ftthRecharges.updatedAt,
            ispConnectionId: ftthConnections.ispConnectionId,
            customerName: ftthConnections.customerName,
            operatorId: ftthConnections.operatorId,
            connectionUserId: ftthConnections.userId,
        })
            .from(ftthRecharges)
            .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
            .where(eq(ftthRecharges.id, rechargeId))
            .limit(1);

        if (!recharge) return null;

        if (userId && recharge.connectionUserId && recharge.connectionUserId !== userId) {
            throw new Error('Unauthorized');
        }

        const [operator] = await db.select({
            id: ftthOperators.id,
            companyName: ftthOperators.companyName,
            contactPhone: ftthOperators.contactPhone,
            brandColor: ftthOperators.brandColor,
        }).from(ftthOperators).where(eq(ftthOperators.id, recharge.operatorId)).limit(1);

        let stage: 1 | 2 | 3 = 1;
        let stageTitle = 'Payment Successful';
        let stageDescription = 'Your payment has been received and verified.';

        if (recharge.status === 'success') {
            if (recharge.fulfilledAt) {
                stage = 3;
                stageTitle = 'Recharge Process Complete';
                stageDescription = 'Your broadband plan has been provisioned and is active.';
            } else {
                stage = 2;
                stageTitle = 'In Progress';
                stageDescription = `${operator?.companyName ?? 'Operator'} is configuring your broadband line.`;
            }
        } else if (recharge.status === 'failed') {
            stage = 1;
            stageTitle = 'Payment Failed';
            stageDescription = recharge.failureReason || 'Payment could not be completed.';
        }

        return {
            id: recharge.id,
            status: recharge.status,
            stage,
            stageTitle,
            stageDescription,
            ispConnectionId: recharge.ispConnectionId,
            customerName: recharge.customerName,
            operatorName: operator?.companyName ?? 'Broadband',
            operatorPhone: operator?.contactPhone ?? null,
            brandColor: operator?.brandColor ?? '#0EA5E9',
            plan: {
                name: recharge.planName,
                speedMbps: recharge.speedMbps,
                durationMonths: recharge.durationMonths,
                total: paiseToRupees(recharge.totalPaise),
                planPrice: paiseToRupees(recharge.listPricePaise),
                discount: paiseToRupees(recharge.discountPaise),
                convenienceFee: paiseToRupees(recharge.convenienceFeePaise),
            },
            validTill: recharge.periodEnd,
            periodStart: recharge.periodStart,
            paidAt: recharge.updatedAt,
            fulfilledAt: recharge.fulfilledAt,
            razorpayPaymentId: recharge.razorpayPaymentId,
            razorpayOrderId: recharge.razorpayOrderId,
            createdAt: recharge.createdAt,
        };
    }

    // ==================== BULK ROSTER IMPORT ====================

    /**
     * Bulk import customers with dynamic column mapping for an operator.
     */
    static async bulkImportCustomers(params: {
        operatorId: number;
        mappings: {
            ispConnectionId: string;
            customerName: string;
            customerPhone: string;
            customerEmail?: string | null;
            installationAddress?: string | null;
            validTill?: string | null;
        };
        rows: Array<Record<string, any>>;
    }) {
        const { operatorId, mappings, rows } = params;

        // Verify operator exists
        const [operator] = await db.select({ id: ftthOperators.id, companyName: ftthOperators.companyName })
            .from(ftthOperators)
            .where(eq(ftthOperators.id, operatorId))
            .limit(1);

        if (!operator) {
            throw new Error('Operator not found');
        }

        // Fetch all registered users with phones for auto-linking
        const registeredUsers = await db.select({ id: users.id, phone: users.phone }).from(users);
        const phoneToUserId = new Map<string, number>();
        for (const u of registeredUsers) {
            if (u.phone) {
                const clean = u.phone.replace(/\D/g, '').slice(-10);
                if (clean.length === 10) phoneToUserId.set(clean, u.id);
            }
        }

        let inserted = 0;
        let updated = 0;
        let autoLinkedUsers = 0;
        const errors: Array<{ row: number; error: string; data?: any }> = [];

        return await withTransaction(async (tx) => {
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const rawIspId = row[mappings.ispConnectionId];
                const rawName = row[mappings.customerName];
                const rawPhone = row[mappings.customerPhone];
                const rawEmail = mappings.customerEmail ? row[mappings.customerEmail] : null;
                const rawAddress = mappings.installationAddress ? row[mappings.installationAddress] : null;
                const rawValidTill = mappings.validTill ? row[mappings.validTill] : null;

                const ispConnectionId = String(rawIspId ?? '').trim();
                const customerName = String(rawName ?? '').trim();
                const cleanPhone = String(rawPhone ?? '').replace(/\D/g, '').slice(-10);
                const customerEmail = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
                const installationAddress = rawAddress ? String(rawAddress).trim() : null;

                if (!ispConnectionId) {
                    errors.push({ row: i + 1, error: 'Missing ISP Connection ID / Username' });
                    continue;
                }

                let parsedValidTill: Date | null = null;
                if (rawValidTill) {
                    const d = new Date(rawValidTill);
                    if (!isNaN(d.getTime())) parsedValidTill = d;
                }

                const matchedUserId = cleanPhone.length === 10 ? phoneToUserId.get(cleanPhone) ?? null : null;
                if (matchedUserId) autoLinkedUsers++;

                const [existing] = await tx.select({ id: ftthConnections.id, userId: ftthConnections.userId })
                    .from(ftthConnections)
                    .where(and(
                        eq(ftthConnections.operatorId, operatorId),
                        eq(ftthConnections.ispConnectionId, ispConnectionId),
                    ))
                    .limit(1);

                if (existing) {
                    await tx.update(ftthConnections)
                        .set({
                            customerName: customerName || undefined,
                            customerPhone: cleanPhone || undefined,
                            customerEmail: customerEmail || undefined,
                            installationAddress: installationAddress || undefined,
                            validTill: parsedValidTill || undefined,
                            userId: existing.userId ?? matchedUserId,
                            status: 'active',
                            updatedAt: new Date(),
                        })
                        .where(eq(ftthConnections.id, existing.id));
                    updated++;
                } else {
                    await tx.insert(ftthConnections).values({
                        operatorId,
                        ispConnectionId,
                        customerName: customerName || ispConnectionId,
                        customerPhone: cleanPhone || null,
                        customerEmail,
                        installationAddress,
                        validTill: parsedValidTill,
                        userId: matchedUserId,
                        status: 'active',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    inserted++;
                }
            }

            return {
                success: true,
                totalRows: rows.length,
                inserted,
                updated,
                autoLinkedUsers,
                errors,
            };
        });
    }
}
