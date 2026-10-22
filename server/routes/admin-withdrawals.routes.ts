import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { db } from "../db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import { withdrawalRequests, partnerWallets, walletTransactionsV2, employees, users } from "@shared/schema";
import { CashfreeService } from "../services/cashfree.service";
import { uploadImageBuffer } from "../services/cloudinary.service";
import logger from "../lib/logger";
import { authenticateAdmin } from "../middleware/auth.middleware";
import { recordAudit } from "../lib/audit";
import { BookingNotifications } from "../services/booking-notifications";
import {
    parseListParams, buildOrderBy, dateRangeConditions, combine, paginationMeta,
} from "../lib/list-query";

// Payment-proof screenshot for manual payouts: one image, max 5MB.
const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, WebP) are allowed'));
        }
    },
});

export function registerAdminWithdrawalRoutes(app: Express) {
    
    /**
     * GET /api/admin/withdrawals
     * Fetch all withdrawal requests
     */
    const WITHDRAWAL_SORTABLE = {
        createdAt: withdrawalRequests.createdAt,
        amount: withdrawalRequests.amount,
        status: withdrawalRequests.status,
        fullName: employees.fullName,
    };

    /**
     * Is Cashfree Payouts connected? Signs in and reads the account balance —
     * moves no money, so it is safe to run on production after changing keys.
     */
    app.get("/api/admin/withdrawals/cashfree-check", authenticateAdmin, async (_req: Request, res: Response) => {
        try {
            res.json({ success: true, data: await CashfreeService.check() });
        } catch (e: any) {
            res.status(502).json({ success: false, message: e?.message ?? 'Cashfree check failed' });
        }
    });

    /**
     * A real test payout of ₹1–₹10 to a UPI ID or bank account a super admin
     * names — through the same Cashfree calls a withdrawal uses (register the
     * beneficiary, send the transfer, read its status), without touching any
     * wallet or withdrawal record. For proving payouts work on production.
     */
    app.post("/api/admin/withdrawals/cashfree-test-payout", authenticateAdmin, async (req: Request, res: Response) => {
        const admin = (req as any).admin;
        if (!admin?.isSuperAdmin) return res.status(403).json({ success: false, message: "Only a super admin can send a test payout." });
        const b = req.body ?? {};
        const amount = Number(b.amount ?? 1);
        if (!(amount >= 1 && amount <= 10) || Math.round(amount * 100) !== amount * 100) {
            return res.status(400).json({ success: false, message: "A test payout is ₹1 to ₹10." });
        }
        const name = String(b.name ?? '').trim();
        if (name.length < 2) return res.status(400).json({ success: false, message: "Enter the account holder's name." });
        const vpa = String(b.upiId ?? '').trim().toLowerCase();
        const bankAccount = String(b.bankAccount ?? '').replace(/\s+/g, '');
        const ifsc = String(b.ifsc ?? '').trim().toUpperCase();
        const toBank = !!(bankAccount || ifsc);
        if (toBank) {
            if (!/^\d{9,18}$/.test(bankAccount)) return res.status(400).json({ success: false, message: "Bank account number: 9 to 18 digits." });
            if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return res.status(400).json({ success: false, message: "That IFSC is not valid — 4 letters, a zero, then 6 letters or digits." });
        } else if (!/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(vpa)) {
            return res.status(400).json({ success: false, message: "Enter a UPI ID like name@okhdfcbank, or a bank account and IFSC." });
        }
        const transferId = `UFTEST_${Date.now().toString(36).toUpperCase()}`;
        try {
            // The same destination always reuses its beneficiary.
            const beneId = await CashfreeService.addBeneficiary({
                name, email: 'payouts-test@unitefix.com', phone: String(b.phone ?? '9999999999'),
                ...(toBank ? { bankAccount, ifsc } : { vpa }),
            });
            const p = await CashfreeService.createPayout(beneId, amount, transferId, 'UniteFix test payout');
            let status: any = null;
            try { status = await CashfreeService.fetchPayoutStatus(p.transferId); } catch { /* checked again below */ }
            await recordAudit({ entityType: 'config', entityId: 0, action: 'cashfree_test_payout', changedBy: admin.userId, metadata: { amount, mode: toBank ? 'bank' : 'upi', transferId: p.transferId, beneId } });
            logger.info(`[CASHFREE] test payout ${p.transferId} ₹${amount} via ${toBank ? 'bank' : 'upi'} by admin ${admin.userId}`);
            res.json({ success: true, message: `Sent ₹${amount} to Cashfree.`, data: { transferId: p.transferId, status: status?.status ?? 'processing', providerStatus: status?.providerStatus ?? null, utr: status?.utr ?? p.utr ?? null, reason: status?.failureReason ?? null } });
        } catch (e: any) {
            logger.error(`[CASHFREE] test payout failed: ${e?.message}`);
            res.status(502).json({ success: false, message: e?.message ?? 'Test payout failed' });
        }
    });

    app.get("/api/admin/withdrawals/cashfree-test-payout/:transferId", authenticateAdmin, async (req: Request, res: Response) => {
        if (!(req as any).admin?.isSuperAdmin) return res.status(403).json({ success: false, message: "Only a super admin can check a test payout." });
        const id = String(req.params.transferId);
        if (!/^UFTEST_[A-Z0-9]+$/.test(id)) return res.status(400).json({ success: false, message: "Not a test payout." });
        try {
            const s = await CashfreeService.fetchPayoutStatus(id);
            res.json({ success: true, data: { transferId: id, status: s.status, providerStatus: s.providerStatus, utr: s.utr, reason: s.failureReason ?? null } });
        } catch (e: any) {
            res.status(502).json({ success: false, message: e?.message ?? 'Status check failed' });
        }
    });

    app.get("/api/admin/withdrawals", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const listOptions = { defaultSort: 'createdAt', sortable: WITHDRAWAL_SORTABLE };
            const params = parseListParams(req.query, listOptions);

            const conditions: any[] = [];

            // Filtered and paged in SQL. This previously selected every payout
            // request ever made and filtered the array in memory.
            const statusFilter = req.query.status as string;
            if (statusFilter && statusFilter !== 'all') {
                conditions.push(eq(withdrawalRequests.status, statusFilter as any));
            }

            if (params.q) {
                const term = `%${params.q}%`;
                conditions.push(or(
                    ilike(employees.fullName, term),
                    ilike(employees.upiId, term),
                    ilike(employees.bankAccountNumber, term),
                    ilike(users.phone, term),
                    ilike(withdrawalRequests.razorpayPayoutId, term),
                ));
            }

            conditions.push(...dateRangeConditions(params, withdrawalRequests.createdAt));
            const where = combine(conditions);

            const [{ total }] = await db
                .select({ total: count() })
                .from(withdrawalRequests)
                .innerJoin(employees, eq(withdrawalRequests.partnerId, employees.id))
                .innerJoin(users, eq(employees.userId, users.id))
                .where(where as any);

            const results = await db.select({
                request: withdrawalRequests,
                employee: {
                    id: employees.id,
                    fullName: employees.fullName,
                    bankAccountNumber: employees.bankAccountNumber,
                    // The rest of what a manual bank transfer needs.
                    bankIfsc: employees.bankIfsc,
                    bankName: employees.bankName,
                    upiId: employees.upiId,
                    // So the approval dialog can warn before money is sent to a
                    // UPI id nobody ever checked exists. Null means unchecked,
                    // not invalid.
                    upiVerifiedAt: employees.upiVerifiedAt,
                    upiVerifiedName: employees.upiVerifiedName,
                },
                user: {
                    phone: users.phone,
                    email: users.email
                }
            })
            .from(withdrawalRequests)
            .innerJoin(employees, eq(withdrawalRequests.partnerId, employees.id))
            .innerJoin(users, eq(employees.userId, users.id))
            .where(where as any)
            .orderBy(buildOrderBy(params, listOptions))
            .limit(params.limit)
            .offset(params.offset);

            res.json({ success: true, data: results, pagination: paginationMeta(params, Number(total)) });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/approve
     * Approves a withdrawal and triggers a Cashfree payout
     */
    app.post("/api/admin/withdrawals/:id/approve", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            if (isNaN(requestId)) return res.status(400).json({ error: "Invalid ID" });

            const [existing] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
            if (!existing) return res.status(404).json({ error: "Withdrawal request not found" });
            if (existing.status !== 'pending') {
                return res.status(400).json({ error: `Withdrawal is ${existing.status}, cannot approve.` });
            }

            // Staff choose where it goes (the expert's bank account or UPI ID —
            // by default what they asked for) and, for a bank, IMPS / NEFT / RTGS.
            const payTo = req.body?.to === 'bank' || req.body?.to === 'upi' ? req.body.to as 'bank' | 'upi' : (existing.method === 'bank' ? 'bank' : 'upi');
            const rawMode = String(req.body?.mode ?? '').toLowerCase();
            if (rawMode && !['imps', 'neft', 'rtgs'].includes(rawMode)) {
                return res.status(400).json({ error: "Choose IMPS, NEFT or RTGS for a bank transfer." });
            }
            const bankMode = payTo === 'bank' ? ((rawMode || 'imps') as 'imps' | 'neft' | 'rtgs') : null;
            if (bankMode === 'rtgs' && parseFloat(existing.amount as any) < 200000) {
                return res.status(400).json({ error: "RTGS is for ₹2 lakh and above. Send this by IMPS or NEFT." });
            }

            // ATOMIC CLAIM — flip pending -> processing in a single statement and
            // only proceed if THIS request won the row. The previous read-then-write
            // had no lock, so a double-click or two admins could both observe
            // 'pending' and both fire a real IMPS payout: the partner was paid twice
            // while the wallet was debited once.
            //
            // Claiming before the payout (rather than locking across it) means the
            // network call happens outside any held lock.
            const [withdrawal] = await db.update(withdrawalRequests)
                .set({ status: 'processing', updatedAt: new Date() })
                .where(and(
                    eq(withdrawalRequests.id, requestId),
                    eq(withdrawalRequests.status, 'pending'),
                ))
                .returning();

            if (!withdrawal) {
                logger.warn(`[WITHDRAWAL] Concurrent approval blocked for request ${requestId}`);
                return res.status(409).json({
                    error: "This withdrawal is already being processed. Refresh to see its current status.",
                });
            }

            const [employee] = await db.select().from(employees).where(eq(employees.id, withdrawal.partnerId)).limit(1);
            if (!employee) {
                // Release the claim so the request is not stranded in 'processing'.
                await db.update(withdrawalRequests)
                    .set({ status: 'pending', updatedAt: new Date() })
                    .where(eq(withdrawalRequests.id, requestId));
                return res.status(404).json({ error: "Employee not found" });
            }

            // Ensure the partner is registered as a Cashfree beneficiary, with
            // details matching their profile as it stands now.
            let beneId: string;
            try {
                // To the bank account or UPI ID staff chose (default: what the expert asked for).
                beneId = await CashfreeService.syncEmployeeForPayouts(employee, payTo);
            } catch (syncError: any) {
                // No payout was attempted — release the claim so it can be retried.
                await db.update(withdrawalRequests)
                    .set({ status: 'pending', updatedAt: new Date() })
                    .where(eq(withdrawalRequests.id, requestId));
                return res.status(400).json({ error: "Payout setup failed: " + syncError.message });
            }

            // Create Payout
            try {
                const amountFloat = parseFloat(withdrawal.amount as any);
                // The transferId doubles as the idempotency key: even if a retry
                // slipped past the claim above, Cashfree refuses a repeated id and
                // the service hands back the ORIGINAL transfer instead of paying
                // twice.
                // A retried request gets a new transfer id: Cashfree refuses one
                // it has seen, and createPayout would read that as "already sent".
                const attempt = withdrawal.payoutAttempt ?? 1;
                const payoutData = await CashfreeService.createPayout(
                    beneId,
                    amountFloat,
                    attempt > 1 ? `WDRW-${withdrawal.id}-${attempt}` : `WDRW-${withdrawal.id}`,
                    'payout',
                    bankMode,
                );

                // Status is already 'processing' from the claim above. The column
                // is still named for RazorpayX; it now holds the Cashfree transferId,
                // which is what the status poll needs. Renaming it is a separate,
                // non-additive migration and not part of this cut-over.
                await db.update(withdrawalRequests).set({
                    razorpayPayoutId: payoutData.id,
                    // How Cashfree is sending it: imps / neft / rtgs, or upi.
                    payoutMode: bankMode ?? 'upi',
                    updatedAt: new Date()
                }).where(eq(withdrawalRequests.id, requestId));

                await recordAudit({
                    entityType: 'withdrawal',
                    entityId: requestId,
                    action: 'withdrawal_approved',
                    changedBy: (req as any).admin?.userId,
                    fromState: 'pending',
                    toState: 'processing',
                    metadata: {
                        amount: amountFloat,
                        method: withdrawal.method,
                        partnerId: withdrawal.partnerId,
                        partnerName: employee.fullName,
                        razorpayPayoutId: payoutData.id,
                        payTo, mode: bankMode ?? 'upi',
                    },
                });

                void BookingNotifications.withdrawalApproved(
                    withdrawal.partnerId,
                    amountFloat,
                    payoutData.id,
                );

                res.json({
                    success: true,
                    message: payoutData.alreadyExisted
                        ? "This payout had already been sent — no second transfer was made."
                        : "Payout processing via Cashfree",
                    payout: payoutData,
                });
            } catch (payoutError: any) {
                // If it fails immediately, mark failed and refund the wallet.
                logger.error(`Immediate Payout Failure: ${payoutError.message}`);
                
                await db.update(withdrawalRequests).set({
                    status: 'failed',
                    failureReason: payoutError.message,
                    updatedAt: new Date()
                }).where(eq(withdrawalRequests.id, requestId));
                
                // Refund wallet: restore the deducted balanceAvailable
                const [wallet] = await db.select().from(partnerWallets)
                    .where(eq(partnerWallets.partnerId, withdrawal.partnerId)).limit(1);
                
                if (wallet) {
                    const amount = parseFloat(withdrawal.amount as any);
                    const currentAvail = parseFloat(wallet.balanceAvailable as any);
                    const newAvail = (currentAvail + amount).toFixed(2);

                    await db.update(partnerWallets).set({
                        balanceAvailable: newAvail,
                        updatedAt: new Date(),
                    }).where(eq(partnerWallets.partnerId, withdrawal.partnerId));

                    await db.insert(walletTransactionsV2).values({
                        transactionId: `PAYOUT-FAIL-REFUND-${withdrawal.id}-${Date.now()}`,
                        partnerId: withdrawal.partnerId,
                        transactionType: 'refund',
                        amount: amount.toFixed(2),
                        balanceAvailableBefore: wallet.balanceAvailable,
                        balanceAvailableAfter: newAvail,
                        balanceHoldBefore: wallet.balanceHold,
                        balanceHoldAfter: wallet.balanceHold,
                        description: `Payout failed — funds returned: ${payoutError.message}`,
                    });

                    logger.info(`[WITHDRAWAL] Refunded ₹${amount} to partner ${withdrawal.partnerId} after payout failure`);
                }

                await recordAudit({
                    entityType: 'withdrawal',
                    entityId: requestId,
                    action: 'withdrawal_payout_failed',
                    changedBy: (req as any).admin?.userId,
                    fromState: 'processing',
                    toState: 'failed',
                    metadata: {
                        amount: parseFloat(withdrawal.amount as any),
                        partnerId: withdrawal.partnerId,
                        error: payoutError.message,
                        walletRefunded: !!wallet,
                    },
                });

                return res.status(500).json({ error: "Payout failed immediately: " + payoutError.message });
            }

        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/retry
     *
     * A failed payout put the money back in the expert's wallet and ended the
     * request — leaving staff no way to pay it. Retry takes the amount from
     * the wallet again (only if it is still there: they may have spent it or
     * asked for it again) and puts the request back to pending, where it is
     * paid through Cashfree, paid manually or rejected as usual. One
     * transaction, rows locked, so a double click cannot debit twice.
     */
    app.post("/api/admin/withdrawals/:id/retry", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            if (isNaN(requestId)) return res.status(400).json({ error: "Invalid ID" });

            const result = await db.transaction(async (tx) => {
                await tx.execute(sql`SELECT id FROM withdrawal_requests WHERE id = ${requestId} FOR UPDATE`);
                const [w] = await tx.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
                if (!w) return { status: 404, body: { error: "Withdrawal request not found" } };
                if (w.status !== 'failed') return { status: 409, body: { error: `Only a failed withdrawal can be retried; this one is ${w.status}.` } };

                await tx.execute(sql`SELECT id FROM partner_wallets WHERE partner_id = ${w.partnerId} FOR UPDATE`);
                const [wallet] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, w.partnerId)).limit(1);
                const amount = parseFloat(w.amount as any);
                const available = parseFloat((wallet?.balanceAvailable as any) ?? '0');
                if (!wallet || available + 1e-9 < amount) {
                    return { status: 409, body: { error: `The expert has ₹${available.toFixed(2)} available now, less than this ₹${amount.toFixed(2)} request — the refunded money was used or withdrawn again. Ask them to make a new request instead.` } };
                }
                const after = (available - amount).toFixed(2);
                const [txn] = await tx.insert(walletTransactionsV2).values({
                    transactionId: `WDRW-RETRY-${w.id}-${Date.now()}`,
                    partnerId: w.partnerId,
                    transactionType: (w.method === 'bank' ? 'withdraw_bank' : 'withdraw_upi') as any,
                    amount: amount.toFixed(2),
                    balanceAvailableBefore: wallet.balanceAvailable,
                    balanceAvailableAfter: after,
                    balanceHoldBefore: wallet.balanceHold,
                    balanceHoldAfter: wallet.balanceHold,
                    description: `Withdrawal #${w.id} retried after a failed payout`,
                    metadata: { method: w.method, retryOf: w.id, previousFailure: w.failureReason },
                }).returning();
                await tx.update(partnerWallets).set({ balanceAvailable: after, updatedAt: new Date() }).where(eq(partnerWallets.partnerId, w.partnerId));
                await tx.update(withdrawalRequests).set({
                    status: 'pending',
                    failureReason: null,
                    razorpayPayoutId: null,
                    walletTransactionId: txn.id,
                    payoutAttempt: (w.payoutAttempt ?? 1) + 1,
                    updatedAt: new Date(),
                }).where(eq(withdrawalRequests.id, w.id));
                return { status: 200, w, amount };
            });
            if (result.status !== 200) return res.status(result.status).json(result.body);

            await recordAudit({
                entityType: 'withdrawal',
                entityId: requestId,
                action: 'withdrawal_retried',
                changedBy: (req as any).admin?.userId,
                fromState: 'failed',
                toState: 'pending',
                metadata: { amount: result.amount, partnerId: result.w!.partnerId, previousFailure: result.w!.failureReason, previousPayoutId: result.w!.razorpayPayoutId, attempt: (result.w!.payoutAttempt ?? 1) + 1 },
            });
            res.json({ success: true, message: `₹${result.amount!.toFixed(2)} taken from the wallet again. The request is pending — pay it through Cashfree or manually.` });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/approve-manual
     * Approves a withdrawal the admin has already paid via UPI/bank outside
     * the platform. A payment-proof screenshot is REQUIRED — it is stored on
     * the withdrawal so the payout is always auditable.
     *
     * Body: multipart/form-data with a single "proof" image, plus
     *   mode       imps | neft | rtgs (a bank transfer) or upi — how staff paid.
     *   reference  the bank's UTR, or the UPI transaction id. Required for a
     *              bank transfer; a reference already recorded on another
     *              request is refused, so one transfer cannot settle two.
     * Without `mode` (older clients) it behaves as before: proof only.
     */
    app.post("/api/admin/withdrawals/:id/approve-manual", authenticateAdmin, proofUpload.single('proof'), async (req: Request, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            if (isNaN(requestId)) return res.status(400).json({ error: "Invalid ID" });

            if (!req.file) {
                return res.status(400).json({ error: "A payment proof photo is required. Attach a screenshot of the UPI/bank transfer." });
            }

            const [existing] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
            if (!existing) return res.status(404).json({ error: "Withdrawal request not found" });
            if (existing.status !== 'pending') {
                return res.status(400).json({ error: `Withdrawal is ${existing.status}, cannot approve manually.` });
            }

            const mode = String(req.body?.mode ?? '').trim().toLowerCase() || null;
            if (mode && !['imps', 'neft', 'rtgs', 'upi'].includes(mode)) {
                return res.status(400).json({ error: "Choose how you paid: IMPS, NEFT, RTGS or UPI." });
            }
            const reference = String(req.body?.reference ?? '').replace(/\s+/g, '').toUpperCase() || null;
            const toBank = !!mode && mode !== 'upi';
            if (toBank && !reference) {
                return res.status(400).json({ error: "Enter the UTR (bank reference) of the transfer." });
            }
            if (reference && !/^[A-Z0-9]{6,30}$/.test(reference)) {
                return res.status(400).json({ error: "The reference should be 6 to 30 letters and digits, as your bank shows it (e.g. a 12-digit IMPS UTR)." });
            }
            if (mode) {
                const [emp] = await db.select({ bankAccountNumber: employees.bankAccountNumber, bankIfsc: employees.bankIfsc, upiId: employees.upiId })
                    .from(employees).where(eq(employees.id, existing.partnerId)).limit(1);
                if (toBank && !(emp?.bankAccountNumber && emp?.bankIfsc)) {
                    return res.status(400).json({ error: "This partner has no bank account and IFSC on file, so a bank transfer cannot be recorded." });
                }
                if (!toBank && !emp?.upiId) {
                    return res.status(400).json({ error: "This partner has no UPI ID on file, so a UPI payment cannot be recorded." });
                }
            }
            if (reference) {
                const [used] = await db.select({ id: withdrawalRequests.id }).from(withdrawalRequests)
                    .where(sql`upper(${withdrawalRequests.payoutReference}) = ${reference}`).limit(1);
                if (used) {
                    return res.status(409).json({ error: `Reference ${reference} is already recorded on withdrawal #${used.id}. Check the UTR: one transfer cannot settle two requests.` });
                }
            }

            // Store the proof BEFORE flipping any state: an upload failure here
            // leaves the request untouched and retryable.
            let proofUrl: string;
            try {
                const uploaded = await uploadImageBuffer(req.file.buffer, 'payment_proofs', {
                    maxWidth: 1200,
                    maxHeight: 1200,
                });
                proofUrl = uploaded.url;
            } catch (uploadError: any) {
                logger.error(`[WITHDRAWAL] Proof upload failed for request ${requestId}: ${uploadError.message}`);
                return res.status(500).json({ error: "Failed to store the payment proof photo. Please try again." });
            }

            // ATOMIC CLAIM — same guard as the automated path: flip pending ->
            // completed in one conditional statement so a double-click or two
            // admins can't both mark (and pay) the same request.
            let withdrawal: typeof withdrawalRequests.$inferSelect | undefined;
            try {
                [withdrawal] = await db.update(withdrawalRequests)
                    .set({
                        status: 'completed',
                        paymentProofUrl: proofUrl,
                        razorpayPayoutId: `manual_txn_${Date.now()}`,
                        payoutMode: mode,
                        payoutReference: reference,
                        paidByAdminId: (req as any).admin?.userId ?? null,
                        paidAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(and(
                        eq(withdrawalRequests.id, requestId),
                        eq(withdrawalRequests.status, 'pending'),
                    ))
                    .returning();
            } catch (e: any) {
                // The same reference recorded at the same moment on another request.
                if (e?.code === '23505') {
                    return res.status(409).json({ error: `Reference ${reference} is already recorded on another withdrawal. Check the UTR: one transfer cannot settle two requests.` });
                }
                throw e;
            }

            if (!withdrawal) {
                logger.warn(`[WITHDRAWAL] Concurrent manual approval blocked for request ${requestId}`);
                return res.status(409).json({
                    error: "This withdrawal was already processed. Refresh to see its current status.",
                });
            }

            await recordAudit({
                entityType: 'withdrawal',
                entityId: requestId,
                action: 'withdrawal_manual_payout',
                changedBy: (req as any).admin?.userId,
                fromState: 'pending',
                toState: 'completed',
                metadata: {
                    amount: parseFloat(withdrawal.amount as any),
                    partnerId: withdrawal.partnerId,
                    method: 'manual',
                    payoutMode: mode,
                    payoutReference: reference,
                    paymentProofUrl: proofUrl,
                },
            });

            logger.info(`[WITHDRAWAL] Request ${requestId} manually paid with proof ${proofUrl.substring(0, 60)}`);
            void BookingNotifications.withdrawalApproved(
                withdrawal.partnerId,
                parseFloat(withdrawal.amount as any),
                reference ?? undefined,
                mode ? (toBank ? 'bank' : 'upi') : (withdrawal.method === 'upi' ? 'upi' : 'bank'),
            );

            res.json({ success: true, message: reference ? `Marked as paid (${mode!.toUpperCase()}, ref ${reference}).` : "Withdrawal marked as manually paid successfully." });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/sync
     *
     * Asks Cashfree for the real state of a payout and reconciles our record.
     * Fallback for the payout.processed / payout.failed webhook — while that
     * webhook fails, successful payouts sit at 'processing' forever and reversed
     * payouts never return the money to the partner's wallet.
     */
    app.post("/api/admin/withdrawals/:id/sync", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            if (isNaN(requestId)) return res.status(400).json({ error: "Invalid ID" });

            const [withdrawal] = await db.select().from(withdrawalRequests)
                .where(eq(withdrawalRequests.id, requestId)).limit(1);

            if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
            if (!withdrawal.razorpayPayoutId) {
                return res.status(400).json({ error: "No payout has been issued for this request yet." });
            }

            const { status, providerStatus, failureReason, utr } =
                await CashfreeService.fetchPayoutStatus(withdrawal.razorpayPayoutId);

            // Already normalised by the service: processed | processing | failed | reversed.
            if (status === 'processed') {
                await db.update(withdrawalRequests)
                    .set({ status: 'completed', updatedAt: new Date() })
                    .where(eq(withdrawalRequests.id, requestId));

                await recordAudit({
                    entityType: 'withdrawal',
                    entityId: requestId,
                    action: 'withdrawal_completed',
                    changedBy: (req as any).admin?.userId,
                    fromState: withdrawal.status,
                    toState: 'completed',
                    metadata: {
                        amount: parseFloat(withdrawal.amount as any),
                        partnerId: withdrawal.partnerId,
                        transferId: withdrawal.razorpayPayoutId,
                        utr,
                        providerStatus,
                        reconciledVia: 'admin_sync',
                    },
                });

                return res.json({
                    success: true,
                    data: { payoutStatus: status, localStatus: 'completed', message: "Payout confirmed as paid." },
                });
            }

            if (status === 'reversed' || status === 'failed') {
                // Guard: only refund once, however many times sync is pressed.
                if (withdrawal.status === 'failed') {
                    return res.json({
                        success: true,
                        data: { payoutStatus: status, localStatus: 'failed', message: "Already reconciled — wallet was refunded." },
                    });
                }

                await db.transaction(async (tx) => {
                    await tx.update(withdrawalRequests)
                        .set({
                            status: 'failed',
                            failureReason: failureReason || `Payout ${status}`,
                            updatedAt: new Date(),
                        })
                        .where(eq(withdrawalRequests.id, requestId));

                    const [wallet] = await tx.select().from(partnerWallets)
                        .where(eq(partnerWallets.partnerId, withdrawal.partnerId)).limit(1);
                    if (!wallet) return;

                    const amount = parseFloat(withdrawal.amount as any);
                    const currentAvail = parseFloat(wallet.balanceAvailable as any);
                    const newAvail = (currentAvail + amount).toFixed(2);

                    await tx.update(partnerWallets)
                        .set({ balanceAvailable: newAvail, updatedAt: new Date() })
                        .where(eq(partnerWallets.partnerId, withdrawal.partnerId));

                    await tx.insert(walletTransactionsV2).values({
                        transactionId: `PAYOUT-${status.toUpperCase()}-${withdrawal.id}-${Date.now()}`,
                        partnerId: withdrawal.partnerId,
                        transactionType: 'refund',
                        amount: amount.toFixed(2),
                        balanceAvailableBefore: wallet.balanceAvailable,
                        balanceAvailableAfter: newAvail,
                        balanceHoldBefore: wallet.balanceHold,
                        balanceHoldAfter: wallet.balanceHold,
                        description: `Payout ${status} — funds returned: ${failureReason || 'no reason given'}`,
                    });
                });

                logger.warn(`[WITHDRAWAL] Payout ${withdrawal.razorpayPayoutId} ${status} — wallet refunded`);

                await recordAudit({
                    entityType: 'withdrawal',
                    entityId: requestId,
                    action: 'withdrawal_payout_reversed',
                    changedBy: (req as any).admin?.userId,
                    fromState: withdrawal.status,
                    toState: 'failed',
                    metadata: {
                        amount: parseFloat(withdrawal.amount as any),
                        partnerId: withdrawal.partnerId,
                        razorpayPayoutId: withdrawal.razorpayPayoutId,
                        payoutStatus: status,
                        failureReason: failureReason || null,
                        walletRefunded: true,
                    },
                });

                return res.json({
                    success: true,
                    data: {
                        payoutStatus: status,
                        localStatus: 'failed',
                        message: `Payout ${status}. Funds returned to the partner's wallet.`,
                    },
                });
            }

            // queued / pending / processing — still in flight
            res.json({
                success: true,
                data: { payoutStatus: status, localStatus: withdrawal.status, message: "Payout is still in progress." },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/reject
     * Rejects a withdrawal and refunds the partner's wallet
     */
    app.post("/api/admin/withdrawals/:id/reject", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const requestId = parseInt(req.params.id);
            const { reason } = req.body;
            if (isNaN(requestId)) return res.status(400).json({ error: "Invalid ID" });

            const [withdrawal] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
            
            if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
            if (withdrawal.status !== 'pending') return res.status(400).json({ error: `Withdrawal is ${withdrawal.status}, cannot reject.` });

            // Refund logic
            const [wallet] = await db.select().from(partnerWallets).where(eq(partnerWallets.partnerId, withdrawal.partnerId)).limit(1);
            
            if (wallet) {
                const amount = parseFloat(withdrawal.amount as any);
                const currentAvail = parseFloat(wallet.balanceAvailable as any);
                
                await db.update(partnerWallets)
                    .set({ balanceAvailable: (currentAvail + amount).toFixed(2) })
                    .where(eq(partnerWallets.partnerId, withdrawal.partnerId));
                
                await db.insert(walletTransactionsV2).values({
                    transactionId: `REFUND-${withdrawal.id}-${Date.now()}`,
                    partnerId: withdrawal.partnerId,
                    transactionType: 'refund', // Withdrawal rejected → funds returned
                    amount: amount.toFixed(2),
                    balanceAvailableBefore: wallet.balanceAvailable,
                    balanceAvailableAfter: (currentAvail + amount).toFixed(2),
                    balanceHoldBefore: wallet.balanceHold,
                    balanceHoldAfter: wallet.balanceHold,
                    description: `Withdrawal Rejected Refund: ${reason || 'Admin action'}`,
                });
            }

            await db.update(withdrawalRequests).set({
                status: 'rejected',
                failureReason: reason || 'Rejected by Admin',
                updatedAt: new Date()
            }).where(eq(withdrawalRequests.id, requestId));

            await recordAudit({
                entityType: 'withdrawal',
                entityId: requestId,
                action: 'withdrawal_rejected',
                changedBy: (req as any).admin?.userId,
                fromState: 'pending',
                toState: 'rejected',
                metadata: {
                    amount: parseFloat(withdrawal.amount as any),
                    partnerId: withdrawal.partnerId,
                    reason: reason || 'Rejected by Admin',
                    walletRefunded: true,
                },
            });

            void BookingNotifications.withdrawalRejected(
                withdrawal.partnerId,
                parseFloat(withdrawal.amount as any),
                reason,
            );

            res.json({ success: true, message: "Withdrawal rejected and refunded to partner." });
        } catch (error) {
            next(error);
        }
    });
}
