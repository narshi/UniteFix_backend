/**
 * PHASE 6: Admin Verification & Operations API
 *
 * Endpoints:
 * - GET /api/admin/employees/pending       → List employees with pending verification
 * - PATCH /api/admin/employees/:id/verify  → Approve/reject employee verification
 * - GET /api/admin/bookings/:id/billing    → Full billing audit trail
 * - POST /api/admin/bookings/:id/override  → Force booking state change (admin override)
 * - POST /api/admin/bookings/:id/resolve-dispute → Resolve dispute (refund or release)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, sql, and, desc, count } from 'drizzle-orm';
import {
    employees, users, serviceRequests, invoices,
    partnerWallets, walletTransactionsV2,
} from '@shared/schema';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { BookingState } from '../business/booking-state-machine';
import { PaymentService } from '../services/payment.service';
import logger from '../lib/logger';

export function registerAdminVerificationRoutes(app: Express) {

    // ==================== TASK 6.1: EMPLOYEE VERIFICATION ====================

    /**
     * GET /api/admin/employees/pending
     * List employees awaiting document verification.
     * Supports filter: ?status=pending|verified|rejected|suspended
     */
    app.get('/api/admin/employees/pending', authenticateAdmin, async (req, res, next) => {
        try {
            const statusFilter = (req.query.status as string) || 'pending';
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = (page - 1) * limit;

            // Count total
            const [totalResult] = await db
                .select({ count: count() })
                .from(employees)
                .where(eq(employees.documentVerificationStatus, statusFilter as any));

            // Fetch with user join
            const rows = await db
                .select({
                    id: employees.id,
                    userId: employees.userId,
                    fullName: employees.fullName,
                    partnerId: employees.partnerId,
                    documentVerificationStatus: employees.documentVerificationStatus,
                    documentVerifiedAt: employees.documentVerifiedAt,
                    adminRemarks: employees.adminRemarks,
                    aadhaarDocUrl: employees.aadhaarDocUrl,
                    panDocUrl: employees.panDocUrl,
                    profilePhotoUrl: employees.profilePhotoUrl,
                    experienceYears: employees.experienceYears,
                    qualifications: employees.qualifications,
                    isActive: employees.isActive,
                    isOnline: employees.isOnline,
                    createdAt: employees.createdAt,
                    // Join user data
                    phone: users.phone,
                    email: users.email,
                })
                .from(employees)
                .leftJoin(users, eq(employees.userId, users.id))
                .where(eq(employees.documentVerificationStatus, statusFilter as any))
                .orderBy(desc(employees.createdAt))
                .limit(limit)
                .offset(offset);

            res.json({
                success: true,
                data: rows,
                pagination: {
                    page,
                    limit,
                    total: Number(totalResult?.count || 0),
                    totalPages: Math.ceil(Number(totalResult?.count || 0) / limit),
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/admin/employees/:id/verify
     * Update employee document verification status.
     *
     * Body: { status: 'verified' | 'rejected' | 'suspended', remarks?: string }
     */
    app.patch('/api/admin/employees/:id/verify', authenticateAdmin, async (req, res, next) => {
        try {
            const employeeId = parseInt(req.params.id);
            const { status, remarks } = req.body;
            const adminId = (req as any).user!.userId;

            const validStatuses = ['verified', 'rejected', 'suspended'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Status must be one of: ${validStatuses.join(', ')}`,
                });
            }

            const [employee] = await db.select().from(employees)
                .where(eq(employees.id, employeeId)).limit(1);

            if (!employee) {
                return res.status(404).json({ success: false, message: 'Employee not found' });
            }

            const updateData: any = {
                documentVerificationStatus: status,
                documentVerifiedAt: new Date(),
                documentVerifiedBy: adminId,
                updatedAt: new Date(),
            };

            if (remarks) updateData.adminRemarks = remarks;

            // If verifying, also activate the account
            if (status === 'verified') {
                updateData.isActive = true;
            } else if (status === 'suspended') {
                updateData.isActive = false;
                updateData.isOnline = false;
            }

            const [updated] = await db.update(employees)
                .set(updateData)
                .where(eq(employees.id, employeeId))
                .returning();

            logger.info(`[ADMIN] Employee ${employeeId} verification → ${status} by admin ${adminId}`);

            res.json({
                success: true,
                message: `Employee verification status updated to '${status}'`,
                data: updated,
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== TASK 6.2: FINANCIAL AUDIT ====================

    /**
     * GET /api/admin/bookings/:id/billing
     * Full billing audit trail for a booking.
     * Returns: billing breakdown, payment transactions, invoice, wallet credits.
     */
    app.get('/api/admin/bookings/:id/billing', authenticateAdmin, async (req, res, next) => {
        try {
            const bookingId = parseInt(req.params.id);

            // Fetch booking
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            // Fetch payment transactions
            const payments = await db.execute(sql`
                SELECT * FROM payment_transactions
                WHERE service_request_id = ${bookingId}
                ORDER BY created_at ASC
            `) as any;

            // Fetch invoice if exists
            const [invoice] = await db.select().from(invoices)
                .where(eq(invoices.serviceRequestId, bookingId)).limit(1);

            // Fetch wallet transactions for the provider
            let walletTxns: any[] = [];
            if (booking.providerId) {
                walletTxns = await db.select().from(walletTransactionsV2)
                    .where(
                        and(
                            eq(walletTransactionsV2.partnerId, booking.providerId),
                            eq(walletTransactionsV2.serviceRequestId, bookingId)
                        )
                    );
            }

            res.json({
                success: true,
                data: {
                    booking: {
                        id: booking.id,
                        serviceId: booking.serviceId,
                        status: booking.status,
                        bookingFee: booking.bookingFee,
                        bookingFeeStatus: booking.bookingFeeStatus,
                        totalAmount: booking.totalAmount,
                        commissionAmount: booking.commissionAmount,
                        createdAt: booking.createdAt,
                    },
                    payments: payments || [],
                    invoice: invoice || null,
                    walletTransactions: walletTxns,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== TASK 6.3: ADMIN OVERRIDE ====================

    /**
     * POST /api/admin/bookings/:id/override
     * Force a booking state change. Bypasses normal transition rules.
     * Use case: Failed geofence, stuck in wrong state, etc.
     *
     * Body: { newState: BookingState, reason: string }
     */
    app.post('/api/admin/bookings/:id/override', authenticateAdmin, async (req, res, next) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { newState, reason } = req.body;
            const adminId = (req as any).user!.userId;

            if (!newState || !reason) {
                return res.status(400).json({
                    success: false,
                    message: 'newState and reason are required',
                });
            }

            // Validate newState is a valid BookingState
            const validStates = Object.values(BookingState);
            if (!validStates.includes(newState as BookingState)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid state. Must be one of: ${validStates.join(', ')}`,
                });
            }

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            const previousState = booking.status;

            const [updated] = await db.update(serviceRequests)
                .set({
                    status: newState as any,
                    adminNotes: sql`COALESCE(${serviceRequests.adminNotes}, '') || ${`\n[OVERRIDE ${new Date().toISOString()}] ${previousState} → ${newState}: ${reason} (by admin #${adminId})`}`,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            logger.warn(`[ADMIN_OVERRIDE] Booking ${bookingId}: ${previousState} → ${newState} — ${reason} (admin ${adminId})`);

            res.json({
                success: true,
                message: `Booking state overridden: ${previousState} → ${newState}`,
                data: {
                    bookingId: updated.id,
                    previousState,
                    newState: updated.status,
                    reason,
                    adminId,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // ==================== TASK 6.4: DISPUTE RESOLUTION ====================

    /**
     * POST /api/admin/bookings/:id/resolve-dispute
     * Resolve a disputed booking. Options:
     * - refund_customer: Full refund to customer
     * - release_employee: Release employee earnings to wallet
     * - split: Partial refund + partial release
     *
     * Body: { resolution: 'refund_customer' | 'release_employee' | 'split', remarks: string, refundAmount?: number }
     */
    app.post('/api/admin/bookings/:id/resolve-dispute', authenticateAdmin, async (req, res, next) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { resolution, remarks, refundAmount } = req.body;
            const adminId = (req as any).user!.userId;

            if (!resolution || !remarks) {
                return res.status(400).json({
                    success: false,
                    message: 'resolution and remarks are required',
                });
            }

            const validResolutions = ['refund_customer', 'release_employee', 'split'];
            if (!validResolutions.includes(resolution)) {
                return res.status(400).json({
                    success: false,
                    message: `Resolution must be one of: ${validResolutions.join(', ')}`,
                });
            }

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.status !== 'disputed') {
                return res.status(409).json({
                    success: false,
                    message: `Booking must be in 'disputed' state. Current: '${booking.status}'.`,
                });
            }

            let actionsTaken: string[] = [];

            if (resolution === 'refund_customer' || resolution === 'split') {
                // Initiate refund (best-effort via Razorpay)
                try {
                    await PaymentService.refundBookingCharge(bookingId);
                    actionsTaken.push('Booking fee refund initiated');
                } catch (err: any) {
                    actionsTaken.push(`Refund failed: ${err.message}`);
                }
            }

            if (resolution === 'release_employee' || resolution === 'split') {
                // Release held funds to employee wallet
                if (booking.providerId) {
                    const heldTxns = await db.select().from(walletTransactionsV2)
                        .where(
                            and(
                                eq(walletTransactionsV2.partnerId, booking.providerId),
                                eq(walletTransactionsV2.serviceRequestId, bookingId),
                                eq(walletTransactionsV2.isReleased, false)
                            )
                        );

                    for (const txn of heldTxns) {
                        await db.update(walletTransactionsV2)
                            .set({ isReleased: true })
                            .where(eq(walletTransactionsV2.id, txn.id));

                        await db.update(partnerWallets)
                            .set({
                                balanceHold: sql`${partnerWallets.balanceHold} - ${txn.amount}`,
                                balanceAvailable: sql`${partnerWallets.balanceAvailable} + ${txn.amount}`,
                                updatedAt: new Date(),
                            })
                            .where(eq(partnerWallets.partnerId, booking.providerId));
                    }

                    actionsTaken.push(`Released ${heldTxns.length} held wallet transaction(s)`);
                }
            }

            // Mark booking as completed (dispute resolved)
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: 'completed' as any,
                    adminNotes: sql`COALESCE(${serviceRequests.adminNotes}, '') || ${`\n[DISPUTE_RESOLVED ${new Date().toISOString()}] Resolution: ${resolution} — ${remarks} (by admin #${adminId})`}`,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            logger.info(`[ADMIN] Dispute resolved for booking ${bookingId}: ${resolution} (admin ${adminId})`);

            res.json({
                success: true,
                message: `Dispute resolved: ${resolution}`,
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    resolution,
                    actionsTaken,
                    remarks,
                },
            });
        } catch (error) {
            next(error);
        }
    });
}
