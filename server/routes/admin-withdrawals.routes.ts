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

            const [withdrawal] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
            
            if (!withdrawal) return res.status(404).json({ error: "Withdrawal request not found" });
            if (withdrawal.status !== 'pending') return res.status(400).json({ error: `Withdrawal is ${withdrawal.status}, cannot approve.` });

            const [employee] = await db.select().from(employees).where(eq(employees.id, withdrawal.partnerId)).limit(1);
            if (!employee) return res.status(404).json({ error: "Employee not found" });

            // Ensure employee has RazorpayX contacts/fund accounts setup
            let fundAccountId: string;
            try {
                fundAccountId = await RazorpayXService.syncEmployeeForPayouts(employee);
            } catch (syncError: any) {
                return res.status(400).json({ error: "Razorpay setup failed: " + syncError.message });
            }

            // Create Payout
            try {
                const amountFloat = parseFloat(withdrawal.amount as any);
                const payoutData = await RazorpayXService.createPayout(
                    fundAccountId,
                    amountFloat,
                    `WDRW-${withdrawal.id}`,
                    'payout'
                );

                await db.update(withdrawalRequests).set({
                    status: 'processing',
                    razorpayPayoutId: payoutData.id,
                    updatedAt: new Date()
                }).where(eq(withdrawalRequests.id, requestId));

                res.json({ success: true, message: "Payout processing via RazorpayX", payout: payoutData });
            } catch (payoutError: any) {
                // If it fails immediately, we can mark it failed and refund.
                logger.error(`Immediate Payout Failure: ${payoutError.message}`);
                
                await db.update(withdrawalRequests).set({
                    status: 'failed',
                    failureReason: payoutError.message,
                    updatedAt: new Date()
                }).where(eq(withdrawalRequests.id, requestId));
                
                // Refund wallet logic (abbreviated for now, would restore balanceAvailable)
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
