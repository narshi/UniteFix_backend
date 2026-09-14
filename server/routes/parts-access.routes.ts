/**
 * Parts access — the technician deposit that unlocks fitting from UniteFix stock.
 *
 * Technician side under /api/partner/parts-access ("partner" = technician).
 * Admin side under /api/admin/parts-access → `inventory` capability area;
 * executing a refund additionally needs withdrawals:manage, because it is a
 * payout, and is guarded in the handler.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { employees, partnerDeposits } from '@shared/schema';
import { authenticateAdmin, authenticatePartner, requireSuperAdmin } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate';
import { PartsAccessService, PartsAccessError } from '../services/parts-access.service';
import { PaymentTrackingService } from '../services/payment-tracking.service';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

const paiseToRupees = (p: number) => Math.round(p) / 100;
const rupeesToPaise = (r: number) => Math.round(r * 100);

const verifySchema = z.object({
    razorpay_order_id: z.string().trim().min(4),
    razorpay_payment_id: z.string().trim().min(4),
    razorpay_signature: z.string().trim().min(4),
});
const drawSchema = z.object({
    amountRupees: z.number().positive().max(100_000),
    entryType: z.enum(['drawn_warranty', 'drawn_shortage', 'drawn_damage', 'adjustment']),
    warrantyClaimId: z.number().int().positive().optional().nullable(),
    sparePartMovementId: z.number().int().positive().optional().nullable(),
    notes: z.string().trim().min(3).max(300),
});

const mapErr = (error: any, res: Response, next: NextFunction) => {
    if (error instanceof PartsAccessError) return res.status(400).json({ success: false, code: error.code, message: error.message });
    if (/Razorpay credentials/i.test(error?.message ?? '')) return res.status(503).json({ success: false, message: 'Payments are unavailable right now.' });
    next(error);
};

function statusView(st: Awaited<ReturnType<typeof PartsAccessService.status>>) {
    return {
        employeeId: st.employeeId,
        name: st.name,
        partsAccess: st.partsAccess,
        grantedAt: st.grantedAt,
        depositWaived: st.depositWaived,
        depositWaivedReason: st.depositWaivedReason,
        required: paiseToRupees(st.requiredPaise),
        floor: paiseToRupees(st.floorPaise),
        deposit: st.deposit ? {
            id: st.deposit.id, status: st.deposit.status,
            paid: paiseToRupees(st.deposit.paidPaise), drawn: paiseToRupees(st.deposit.drawnPaise),
            remaining: paiseToRupees(st.deposit.remainingPaise), belowFloor: st.deposit.belowFloor,
            topUpNeeded: paiseToRupees(st.deposit.topUpNeededPaise),
            paidAt: st.deposit.paidAt, refundedAt: st.deposit.refundedAt,
        } : null,
        // Every draw with its reason — the technician sees exactly what cost them.
        ledger: st.ledger.map(l => ({
            id: l.id, type: l.entryType, amount: paiseToRupees(l.amountPaise),
            balanceAfter: paiseToRupees(l.balanceAfterPaise), warrantyClaimId: l.warrantyClaimId, notes: l.notes, at: l.createdAt,
        })),
    };
}

export function registerPartsAccessRoutes(app: Express) {

    // ═══════════════════════════════════════════════════════════════════════
    // Technician
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/partner/parts-access', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).partner?.partnerId as number;
            res.json({ success: true, data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { next(error); }
    });

    /** Start paying the deposit (or topping it up). Returns a Razorpay order. */
    app.post('/api/partner/parts-access/request', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).partner?.partnerId as number;
            const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
            if (!emp) return res.status(404).json({ success: false, message: 'Technician not found' });
            const order = await PartsAccessService.initiatePayment(emp);
            res.json({
                success: true,
                message: order.isTopUp
                    ? `Top up ₹${paiseToRupees(order.amountPaise)} to restore your full deposit.`
                    : `Pay the refundable ₹${paiseToRupees(order.amountPaise)} deposit. UniteFix reviews and enables spare-parts access after payment.`,
                data: { ...order, amount: paiseToRupees(order.amountPaise) },
            });
        } catch (error) { mapErr(error, res, next); }
    });

    /**
     * The SDK's optimistic callback. Not the settlement path — the webhook is —
     * but both land on the same idempotent applyCapture.
     */
    app.post('/api/partner/parts-access/verify-payment', authenticatePartner, validateBody(verifySchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const employeeId = (req as any).partner?.partnerId as number;
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as z.infer<typeof verifySchema>;

                const secret = process.env.RAZORPAY_KEY_SECRET;
                if (!secret) return res.status(500).json({ success: false, message: 'Payment verification not configured' });
                const expected = crypto.createHmac('sha256', secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
                const a = Buffer.from(expected, 'utf8'); const b = Buffer.from(razorpay_signature, 'utf8');
                if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
                    logger.warn('[DEPOSIT] signature mismatch', { razorpay_order_id });
                    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
                }

                const [dep] = await db.select().from(partnerDeposits).where(eq(partnerDeposits.razorpayOrderId, razorpay_order_id)).limit(1);
                if (!dep) return res.status(404).json({ success: false, message: 'Deposit not found' });
                if (dep.employeeId !== employeeId) return res.status(403).json({ success: false, message: 'This deposit is not yours' });

                try {
                    await PaymentTrackingService.recordPaymentEvent({
                        partnerDepositId: dep.id, razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id,
                        amount: Math.max(0, dep.requiredPaise - Math.max(0, dep.paidPaise - dep.drawnPaise)), currency: 'INR',
                        eventType: 'payment_captured', status: 'captured', metadata: { source: 'sdk_verify', paymentType: 'parts_deposit' },
                    } as any);
                } catch (e: any) { logger.warn(`[DEPOSIT] tracking record failed: ${e?.message}`); }

                const result = await PartsAccessService.applyCapture({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, depositId: dep.id });
                res.json({
                    success: true,
                    message: result.applied
                        ? 'Deposit received. UniteFix will review and enable your spare-parts access shortly.'
                        : 'Deposit already recorded.',
                    data: statusView(await PartsAccessService.status(employeeId)),
                });
            } catch (error) { mapErr(error, res, next); }
        });

    app.post('/api/partner/parts-access/refund-request', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const employeeId = (req as any).partner?.partnerId as number;
            const r = await PartsAccessService.requestRefund(employeeId);
            res.json({
                success: true,
                message: `Refund of ₹${paiseToRupees(r.refundablePaise)} requested. Spare-parts access is switched off; UniteFix will transfer it to your registered account.`,
                data: { ...r, refundable: paiseToRupees(r.refundablePaise) },
            });
        } catch (error) { mapErr(error, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/parts-access', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await PartsAccessService.listForAdmin({ access: typeof req.query.access === 'string' ? req.query.access : undefined });
            res.json({
                success: true,
                data: rows.map(r => ({
                    employeeId: r.employeeId, name: r.name, partsAccess: r.access, grantedAt: r.grantedAt, depositWaived: r.depositWaived,
                    deposit: r.deposit ? {
                        status: r.deposit.status, paid: paiseToRupees(r.deposit.paidPaise), drawn: paiseToRupees(r.deposit.drawnPaise),
                        remaining: paiseToRupees(Math.max(0, r.deposit.paidPaise - r.deposit.drawnPaise)), paidAt: r.deposit.paidAt,
                    } : null,
                })),
            });
        } catch (error) { next(error); }
    });

    app.get('/api/admin/parts-access/:employeeId', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const st = await PartsAccessService.status(Number(req.params.employeeId));
            const blockers = await PartsAccessService.refundBlockers(Number(req.params.employeeId));
            res.json({ success: true, data: { ...statusView(st), refundBlockers: blockers } });
        } catch (error) { next(error); }
    });

    app.post('/api/admin/parts-access/:employeeId/approve', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const employeeId = Number(req.params.employeeId);
            const row = await PartsAccessService.approve(employeeId, admin.userId);
            if (!row) return res.status(404).json({ success: false, message: 'Technician not found' });
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'parts_access_approved', changedBy: admin.userId });
            res.json({ success: true, message: 'Spare-parts access enabled.', data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { mapErr(error, res, next); }
    });

    /** In-house staff: enable spare parts with no deposit. Super-admin, with a reason on record. */
    app.post('/api/admin/parts-access/:employeeId/grant', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const employeeId = Number(req.params.employeeId);
            const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
            if (reason.length < 3) return res.status(400).json({ success: false, message: 'Say why the deposit is waived (e.g. "in-house employee").' });
            const row = await PartsAccessService.grantWithoutDeposit(employeeId, admin.userId, reason);
            if (!row) return res.status(404).json({ success: false, message: 'Technician not found' });
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'parts_access_granted_no_deposit', changedBy: admin.userId, metadata: { reason } });
            res.json({ success: true, message: 'Spare-parts access enabled without a deposit.', data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/parts-access/:employeeId/revoke-waiver', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const employeeId = Number(req.params.employeeId);
            const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
            if (reason.length < 3) return res.status(400).json({ success: false, message: 'Give a reason.' });
            const row = await PartsAccessService.revokeWaiver(employeeId, admin.userId, reason);
            if (!row) return res.status(404).json({ success: false, message: 'No waiver on this technician.' });
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'parts_deposit_waiver_revoked', changedBy: admin.userId, metadata: { reason } });
            res.json({ success: true, message: 'Waiver removed. Access is off until a deposit is paid.', data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/parts-access/:employeeId/suspend', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const employeeId = Number(req.params.employeeId);
            const reason = String(req.body?.reason ?? '').trim();
            if (reason.length < 3) return res.status(400).json({ success: false, message: 'Give a reason the technician will read.' });
            await PartsAccessService.suspend(employeeId, admin.userId, reason);
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'parts_access_suspended', changedBy: admin.userId, metadata: { reason } });
            res.json({ success: true, data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { mapErr(error, res, next); }
    });

    app.post('/api/admin/parts-access/:employeeId/reinstate', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const employeeId = Number(req.params.employeeId);
            await PartsAccessService.reinstate(employeeId, admin.userId);
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'parts_access_reinstated', changedBy: admin.userId });
            res.json({ success: true, data: statusView(await PartsAccessService.status(employeeId)) });
        } catch (error) { mapErr(error, res, next); }
    });

    /** Draw against the deposit. Every draw names its cause. */
    app.post('/api/admin/parts-access/:employeeId/draw', authenticateAdmin, requireSuperAdmin, validateBody(drawSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const admin = (req as any).admin as { userId: number };
                const employeeId = Number(req.params.employeeId);
                const b = req.body as z.infer<typeof drawSchema>;
                const r = await PartsAccessService.draw({
                    employeeId, amountPaise: rupeesToPaise(b.amountRupees), entryType: b.entryType,
                    warrantyClaimId: b.warrantyClaimId ?? null, sparePartMovementId: b.sparePartMovementId ?? null,
                    adminId: admin.userId, notes: b.notes,
                });
                await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: `deposit_${b.entryType}`, changedBy: admin.userId, metadata: { ...b, drawn: paiseToRupees(r.drawn) } });
                res.json({
                    success: true,
                    message: r.duplicate ? 'Already drawn for this claim.'
                        : `Drew ₹${paiseToRupees(r.drawn)}.${r.shortfall ? ` ₹${paiseToRupees(r.shortfall)} could not be covered — the deposit is exhausted.` : ''}${r.suspended ? ' Parts access suspended until topped up.' : ''}`,
                    data: { ...r, drawn: paiseToRupees(r.drawn), remaining: paiseToRupees(r.remainingPaise) },
                });
            } catch (error) { mapErr(error, res, next); }
        });

    /** The warranty desk's button: a technician verdict, drawn from the deposit once. */
    app.post('/api/admin/warranty-claims/:id/draw-deposit', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const r = await PartsAccessService.drawForClaim(Number(req.params.id), admin.userId);
            if (!r) return res.status(404).json({ success: false, message: 'Claim not found' });
            await recordAudit({ entityType: 'partner_deposit', entityId: Number(req.params.id), action: 'deposit_drawn_for_claim', changedBy: admin.userId, metadata: { drawn: paiseToRupees(r.drawn) } });
            res.json({
                success: true,
                message: r.duplicate ? 'This claim has already been drawn.' : `Drew ₹${paiseToRupees(r.drawn)} from the technician's deposit.${r.suspended ? ' Their parts access is suspended until topped up.' : ''}`,
                data: { ...r, drawn: paiseToRupees(r.drawn), remaining: paiseToRupees(r.remainingPaise) },
            });
        } catch (error) { mapErr(error, res, next); }
    });

    /** Execute a pending refund — a payout, so it needs the withdrawals capability too. */
    app.post('/api/admin/parts-access/:employeeId/refund', authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const admin = (req as any).admin as { userId: number; capabilities?: Set<string> };
            if (admin.capabilities && !admin.capabilities.has('withdrawals:manage')) {
                return res.status(403).json({ success: false, message: 'Refunding a deposit is a payout and needs the Withdrawals capability.' });
            }
            const employeeId = Number(req.params.employeeId);
            const manualReference = typeof req.body?.manualReference === 'string' ? req.body.manualReference.trim() : undefined;
            const r = await PartsAccessService.executeRefund(employeeId, admin.userId, { manualReference: manualReference || undefined });
            await recordAudit({ entityType: 'partner_deposit', entityId: employeeId, action: 'deposit_refunded', changedBy: admin.userId, metadata: { refunded: paiseToRupees(r.refundedPaise), reference: r.reference } });
            res.json({ success: true, message: `Refunded ₹${paiseToRupees(r.refundedPaise)} (${r.reference}).`, data: { ...r, refunded: paiseToRupees(r.refundedPaise) } });
        } catch (error) { mapErr(error, res, next); }
    });
}
