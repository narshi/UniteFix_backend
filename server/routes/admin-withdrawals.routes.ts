import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";
import { withdrawalRequests, partnerWallets, walletTransactionsV2, employees, users } from "@shared/schema";
import { RazorpayXService } from "../services/razorpayx.service";
import logger from "../lib/logger";
import { authenticateAdmin } from "../middleware/auth.middleware";

export function registerAdminWithdrawalRoutes(app: Express) {
    
    /**
     * GET /api/admin/withdrawals
     * Fetch all withdrawal requests
     */
    app.get("/api/admin/withdrawals", authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const statusFilter = req.query.status as string;
            
            let query = db.select({
                request: withdrawalRequests,
                employee: {
                    id: employees.id,
                    fullName: employees.fullName,
                    bankAccountNumber: employees.bankAccountNumber,
                    upiId: employees.upiId,
                },
                user: {
                    phone: users.phone,
                    email: users.email
                }
            })
            .from(withdrawalRequests)
            .innerJoin(employees, eq(withdrawalRequests.partnerId, employees.id))
            .innerJoin(users, eq(employees.userId, users.id))
            .orderBy(desc(withdrawalRequests.createdAt));
            
            const results = await query;
            
            // Filter in memory for simplicity if status provided
            const finalResults = statusFilter 
                ? results.filter(r => r.request.status === statusFilter)
                : results;
                
            res.json({ success: true, data: finalResults });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/withdrawals/:id/approve
     * Approves a withdrawal and triggers RazorpayX Payout
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

            // Ensure employee has RazorpayX contacts/fund accounts setup
            let fundAccountId: string;
            try {
                fundAccountId = await RazorpayXService.syncEmployeeForPayouts(employee);
            } catch (syncError: any) {
                // No payout was attempted — release the claim so it can be retried.
                await db.update(withdrawalRequests)
                    .set({ status: 'pending', updatedAt: new Date() })
                    .where(eq(withdrawalRequests.id, requestId));
                return res.status(400).json({ error: "Razorpay setup failed: " + syncError.message });
            }

            // Create Payout
            try {
                const amountFloat = parseFloat(withdrawal.amount as any);
                const payoutData = await RazorpayXService.createPayout(
                    fundAccountId,
                    amountFloat,
                    `WDRW-${withdrawal.id}`,
                    'payout',
                    // Second layer: even if a retry slipped past the claim, RazorpayX
                    // returns the original payout for a repeated idempotency key
                    // instead of sending money twice.
                    `wdrw-${withdrawal.id}`,
                );

                // Status is already 'processing' from the claim above; record the
                // payout id so the webhook and the status poll can find it.
                await db.update(withdrawalRequests).set({
                    razorpayPayoutId: payoutData.id,
                    updatedAt: new Date()
                }).where(eq(withdrawalRequests.id, requestId));

                res.json({ success: true, message: "Payout processing via RazorpayX", payout: payoutData });
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

                return res.status(500).json({ error: "Payout failed immediately: " + payoutError.message });
            }

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

            res.json({ success: true, message: "Withdrawal rejected and refunded to partner." });
        } catch (error) {
            next(error);
        }
    });
}
