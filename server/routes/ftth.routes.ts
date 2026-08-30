/**
 * FTTH — Phase 0: operator onboarding and identity.
 *
 * An ISP applies through a public form, a super_admin approves, and approval is
 * what mints the `admin_users` login. Nobody edits the database by hand to add
 * an operator, which is the whole point — at fifteen operators, manual account
 * creation is the bottleneck.
 *
 * TENANCY RULE, enforced in every operator handler below:
 *   the ONLY operator id a handler may trust is `req.operator.operatorId`,
 *   which `authenticateOperator` resolved from the token's account row.
 *   An `operatorId` arriving in a body or query string is ignored, always.
 *   This is what stops operator A reading operator B's customers.
 *
 * Phases 1-4 (plans, coverage editing, leads, connections, recharges) extend
 * this file — see FTTH_IMPLEMENTATION_PLAN.md.
 */

import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { eq, and, or, desc, asc, inArray, sql, isNull, lte, gte, ne } from "drizzle-orm";
import { db } from "../db";
import {
    ftthOperators,
    ftthOperatorPincodes,
    ftthPlans,
    ftthConnections,
    ftthIdRequests,
    ftthLeads,
    ftthRecharges,
    ftthOperatorLedger,
    serviceablePincodes,
    adminUsers,
    users,
} from "@shared/schema";
import {
    authenticateAdmin,
    authenticateOperator,
    authenticateToken,
    requireSuperAdmin,
} from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate";
import { withTransaction } from "../lib/transaction";
import { recordAudit } from "../lib/audit";
import { operatorApplyLimiter, mobileLimiter } from "../middleware/rate-limit";
import { FtthService, paiseToRupees } from "../services/ftth.service";
import { configService } from "../services/config.service";
import { NotificationService } from "../services/notification.service";
import logger from "../lib/logger";

/**
 * Public application form.
 *
 * Note what is NOT here: status, adminUserId, leadFeePaise, convenienceFeePaise.
 * An applicant must not be able to approve themselves or set their own
 * commercial terms by posting extra fields, and a `.strict()` object would only
 * error on them — leaving them out of the schema drops them silently, which is
 * the behaviour we want on a public endpoint.
 */
const applySchema = z.object({
    companyName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(160).optional(),
    gstin: z.string().trim().regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 characters").optional(),
    contactName: z.string().trim().min(2).max(120).optional(),
    contactEmail: z.string().trim().email().max(160),
    contactPhone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
    // Coverage is collected up front so an approved operator is immediately
    // discoverable. Editable later from the operator portal (Phase 1).
    pincodes: z.array(z.string().trim().regex(/^\d{6}$/)).min(1).max(200),
});

const approveSchema = z.object({
    username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/,
        "Username may contain letters, numbers, dot, underscore and hyphen only"),
    // Optional: a generated password is returned once if this is omitted.
    password: z.string().min(8).max(128).optional(),
    leadFeePaise: z.number().int().min(0).max(10_000_00).optional(),
    convenienceFeePaise: z.number().int().min(0).max(1_000_00).optional(),
});

const rejectSchema = z.object({
    reason: z.string().trim().min(3).max(500),
});

const statusSchema = z.object({
    status: z.enum(['active', 'paused', 'disabled']),
    reason: z.string().trim().max(500).optional(),
});

// --- plans ------------------------------------------------------------------
//
// speedMbps and durationMonths are FREE INTEGERS. There is deliberately no
// enum, no allowed-values list, and no ladder anywhere in this file: operator A
// sells 30/50/100 and operator B sells 40/60/200, and onboarding a third with
// 25/75 must not need a deploy. Prices arrive in RUPEES from the UI and are
// converted to paise here, once.
const planSchema = z.object({
    name: z.string().trim().min(2).max(120),
    speedMbps: z.number().int().min(1).max(10_000),
    durationMonths: z.number().int().min(1).max(60),
    priceRupees: z.number().min(0).max(1_000_000),
    discountRupees: z.number().min(0).max(1_000_000).optional().default(0),
    dataLimitGb: z.number().int().min(0).max(1_000_000).nullable().optional(),
    benefits: z.array(z.string().trim().max(80)).max(12).optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    isActive: z.boolean().optional(),
});

const planBulkSchema = z.object({
    plans: z.array(planSchema).min(1).max(200),
});

const coverageSchema = z.object({
    pincodes: z.array(z.string().trim().regex(/^\d{6}$/)).max(500),
});

// --- customer-facing --------------------------------------------------------
const leadSchema = z.object({
    operatorId: z.number().int().positive(),
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
    address: z.string().trim().min(5).max(500),
    pincode: z.string().trim().regex(/^\d{6}$/),
    notes: z.string().trim().max(500).optional(),
});

const idRequestSchema = z.object({
    operatorId: z.number().int().positive(),
    claimedName: z.string().trim().min(2).max(120),
    claimedPhone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
    claimedAddress: z.string().trim().max(500).optional(),
    claimedIspId: z.string().trim().max(80).optional(),
});

const initiateSchema = z.object({
    connectionId: z.number().int().positive(),
    planId: z.number().int().positive(),
});

const verifySchema = z.object({
    razorpay_order_id: z.string().trim().min(4),
    razorpay_payment_id: z.string().trim().min(4),
    razorpay_signature: z.string().trim().min(4),
});

const assignIdSchema = z.object({
    ispConnectionId: z.string().trim().min(1).max(80),
});

const rejectIdSchema = z.object({
    reason: z.string().trim().min(3).max(500),
});

const leadStatusSchema = z.object({
    status: z.enum(['new', 'contacted', 'closed']),
    notes: z.string().trim().max(500).optional(),
});

const convertLeadSchema = z.object({
    ispConnectionId: z.string().trim().max(80).optional(),
});

const connectionStatusSchema = z.object({
    action: z.enum(['suspend', 'reactivate']),
    reason: z.string().trim().max(500).optional(),
});

const settlementSchema = z.object({
    amountRupees: z.number().positive().max(10_000_000),
    reference: z.string().trim().min(2).max(120),
    note: z.string().trim().max(500).optional(),
});

// --- staff oversight --------------------------------------------------------
//
// Commercial terms are editable AFTER approval, not frozen at it. Terms get
// renegotiated, and "create a second operator row" is not an acceptable answer
// to "we agreed a lower lead fee in March".
const operatorEditSchema = z.object({
    companyName: z.string().trim().min(2).max(120).optional(),
    legalName: z.string().trim().max(160).nullable().optional(),
    gstin: z.string().trim().regex(/^[0-9A-Z]{15}$/, "GSTIN must be 15 characters").nullable().optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    contactEmail: z.string().trim().email().max(160).optional(),
    contactPhone: z.string().trim().regex(/^[6-9]\d{9}$/).optional(),
    logoUrl: z.string().trim().url().max(500).nullable().optional(),
    brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    // null explicitly means "fall back to the platform default", which is a
    // different intent from "leave unchanged" (omitting the field).
    leadFeeRupees: z.number().min(0).max(100_000).nullable().optional(),
    convenienceFeeRupees: z.number().min(0).max(10_000).nullable().optional(),
});

const resetPasswordSchema = z.object({
    password: z.string().min(8).max(128).optional(),
});

const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

/** Rupee view of a paise column, for a dashboard that should never show paise. */
const toRupees = (paise: number | null | undefined) =>
    paise === null || paise === undefined ? null : paise / 100;

export function registerFtthRoutes(app: Express) {

    // ==================== PUBLIC: APPLY ====================

    /**
     * POST /api/ftth/operators/apply
     *
     * Creates a `pending_approval` operator with NO login.
     *
     * Rate-limited on its OWN bucket, not `authLimiter`. express-rate-limit
     * counts per limiter instance, so sharing the auth limiter would let a
     * handful of applications from one office IP consume the five-per-15-minutes
     * budget that /api/admin/auth/login uses — an ISP filling in a form would
     * lock staff out of the dashboard.
     */
    app.post(
        "/api/ftth/operators/apply",
        operatorApplyLimiter,
        validateBody(applySchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const body = req.body as z.infer<typeof applySchema>;
                const pincodes = Array.from(new Set(body.pincodes));

                // Only pincodes UniteFix already serves. An operator covering an
                // area we do not operate in has nobody to sell to, and accepting
                // free-text pincodes would quietly poison the serviceability join.
                const known = await db
                    .select({ pincode: serviceablePincodes.pincode })
                    .from(serviceablePincodes)
                    .where(inArray(serviceablePincodes.pincode, pincodes));

                const knownSet = new Set(known.map(k => k.pincode));
                const unknown = pincodes.filter(p => !knownSet.has(p));
                if (unknown.length > 0) {
                    return res.status(400).json({
                        success: false,
                        message: `UniteFix does not currently operate in: ${unknown.join(', ')}`,
                        unserviceablePincodes: unknown,
                    });
                }

                // One live application or account per company+phone. Without this
                // an impatient applicant who submits three times becomes three
                // rows a super_admin has to reconcile by hand.
                const [existing] = await db
                    .select({ id: ftthOperators.id, status: ftthOperators.status })
                    .from(ftthOperators)
                    .where(and(
                        eq(ftthOperators.contactPhone, body.contactPhone),
                        inArray(ftthOperators.status, ['pending_approval', 'active', 'paused']),
                    ))
                    .limit(1);

                if (existing) {
                    return res.status(409).json({
                        success: false,
                        message: existing.status === 'pending_approval'
                            ? 'An application from this number is already under review.'
                            : 'An operator account already exists for this number.',
                    });
                }

                const operator = await withTransaction(async (tx) => {
                    const [row] = await tx.insert(ftthOperators).values({
                        companyName: body.companyName,
                        legalName: body.legalName ?? null,
                        gstin: body.gstin ?? null,
                        contactName: body.contactName ?? null,
                        contactEmail: body.contactEmail,
                        contactPhone: body.contactPhone,
                        status: 'pending_approval',
                    }).returning();

                    await tx.insert(ftthOperatorPincodes).values(
                        pincodes.map(pincode => ({ operatorId: row.id, pincode })),
                    );

                    return row;
                });

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: operator.id,
                    action: 'ftth_operator_applied',
                    toState: 'pending_approval',
                    changedBy: null, // public form — nobody is signed in
                    metadata: { companyName: operator.companyName, pincodes },
                });

                logger.info('[FTTH] Operator application received', {
                    operatorId: operator.id, companyName: operator.companyName,
                });

                // Deliberately thin: the response confirms receipt and nothing
                // about internal state.
                res.status(201).json({
                    success: true,
                    message: 'Application received. UniteFix will be in touch after review.',
                    data: { applicationId: operator.id },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    // ==================== SUPER_ADMIN: REVIEW ====================

    /**
     * GET /api/admin/ftth/operators?status=pending_approval
     * Staff-side list of applications and live operators.
     */
    app.get(
        "/api/admin/ftth/operators",
        authenticateAdmin,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const status = typeof req.query.status === 'string' ? req.query.status : undefined;
                const allowed = ['pending_approval', 'active', 'paused', 'disabled'] as const;
                const filter = allowed.includes(status as any) ? (status as typeof allowed[number]) : undefined;

                const rows = await db
                    .select({
                        id: ftthOperators.id,
                        companyName: ftthOperators.companyName,
                        legalName: ftthOperators.legalName,
                        gstin: ftthOperators.gstin,
                        contactName: ftthOperators.contactName,
                        contactEmail: ftthOperators.contactEmail,
                        contactPhone: ftthOperators.contactPhone,
                        status: ftthOperators.status,
                        leadFeePaise: ftthOperators.leadFeePaise,
                        convenienceFeePaise: ftthOperators.convenienceFeePaise,
                        adminUserId: ftthOperators.adminUserId,
                        username: adminUsers.username,
                        loginActive: adminUsers.isActive,
                        approvedAt: ftthOperators.approvedAt,
                        rejectionReason: ftthOperators.rejectionReason,
                        createdAt: ftthOperators.createdAt,
                        pincodeCount: sql<number>`(
                            SELECT COUNT(*)::int FROM ${ftthOperatorPincodes}
                            WHERE ${ftthOperatorPincodes.operatorId} = ${ftthOperators.id}
                        )`,
                    })
                    .from(ftthOperators)
                    .leftJoin(adminUsers, eq(adminUsers.id, ftthOperators.adminUserId))
                    .where(filter ? eq(ftthOperators.status, filter) : undefined)
                    .orderBy(desc(ftthOperators.createdAt));

                res.json({
                    success: true,
                    data: rows.map(r => ({
                        ...r,
                        leadFee: toRupees(r.leadFeePaise),
                        convenienceFee: toRupees(r.convenienceFeePaise),
                    })),
                });
            } catch (error) {
                next(error);
            }
        },
    );

    /**
     * GET /api/admin/ftth/operators/:id — full detail, including coverage.
     */
    app.get(
        "/api/admin/ftth/operators/:id",
        authenticateAdmin,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);

                if (!operator) {
                    return res.status(404).json({ success: false, message: 'Operator not found' });
                }

                const pincodes = await db
                    .select({ pincode: ftthOperatorPincodes.pincode, isActive: ftthOperatorPincodes.isActive })
                    .from(ftthOperatorPincodes)
                    .where(eq(ftthOperatorPincodes.operatorId, id));

                res.json({
                    success: true,
                    data: {
                        ...operator,
                        leadFee: toRupees(operator.leadFeePaise),
                        convenienceFee: toRupees(operator.convenienceFeePaise),
                        pincodes,
                    },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    /**
     * POST /api/admin/ftth/operators/:id/approve
     *
     * super_admin ONLY — this mints a dashboard login, which is exactly the
     * class of action `requireSuperAdmin` exists to gate.
     *
     * Creates the `admin_users` row with role 'operator' and links it, in one
     * transaction. A half-applied approval (login created, operator not linked)
     * would produce an account that can sign in but resolves to no tenant, which
     * `authenticateOperator` refuses — recoverable, but confusing at 2am.
     */
    app.post(
        "/api/admin/ftth/operators/:id/approve",
        authenticateAdmin,
        requireSuperAdmin,
        validateBody(approveSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const actor = (req as any).admin as { userId: number; username: string };
                const body = req.body as z.infer<typeof approveSchema>;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);

                if (!operator) {
                    return res.status(404).json({ success: false, message: 'Operator not found' });
                }
                if (operator.adminUserId) {
                    return res.status(409).json({
                        success: false,
                        message: 'This operator already has a login. Use the status controls instead.',
                    });
                }
                if (operator.status !== 'pending_approval') {
                    return res.status(409).json({
                        success: false,
                        message: `Only a pending application can be approved (this one is ${operator.status}).`,
                    });
                }

                // Username and email are unique across ALL admin accounts, staff
                // included, so collisions are checked before we start writing.
                const [clashUser] = await db.select({ id: adminUsers.id })
                    .from(adminUsers).where(eq(adminUsers.username, body.username)).limit(1);
                if (clashUser) {
                    return res.status(409).json({ success: false, message: 'That username is already taken.' });
                }
                const [clashEmail] = await db.select({ id: adminUsers.id })
                    .from(adminUsers).where(eq(adminUsers.email, operator.contactEmail)).limit(1);
                if (clashEmail) {
                    return res.status(409).json({
                        success: false,
                        message: 'An admin account already uses this operator\'s email address.',
                    });
                }

                // A generated password is shown to the approving super_admin ONCE
                // and never stored in plaintext. base64url of 12 random bytes —
                // readable enough to relay over a phone call.
                const generated = body.password
                    ? null
                    : crypto.randomBytes(12).toString('base64url');
                const plainPassword = body.password ?? generated!;
                const hashed = await bcrypt.hash(plainPassword, 10);

                const updated = await withTransaction(async (tx) => {
                    const [login] = await tx.insert(adminUsers).values({
                        username: body.username,
                        email: operator.contactEmail,
                        password: hashed,
                        role: 'operator',
                        isActive: true,
                    }).returning();

                    const [row] = await tx.update(ftthOperators)
                        .set({
                            adminUserId: login.id,
                            status: 'active',
                            leadFeePaise: body.leadFeePaise ?? operator.leadFeePaise,
                            convenienceFeePaise: body.convenienceFeePaise ?? operator.convenienceFeePaise,
                            approvedByAdminId: actor.userId,
                            approvedAt: new Date(),
                            rejectionReason: null,
                            updatedAt: new Date(),
                        })
                        .where(eq(ftthOperators.id, id))
                        .returning();

                    return row;
                });

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_operator_approved',
                    fromState: 'pending_approval',
                    toState: 'active',
                    changedBy: actor.userId,
                    metadata: {
                        companyName: operator.companyName,
                        username: body.username,
                        adminUserId: updated.adminUserId,
                        passwordGenerated: generated !== null,
                    },
                });

                logger.info('[FTTH] Operator approved', {
                    operatorId: id, companyName: operator.companyName, by: actor.username,
                });

                res.json({
                    success: true,
                    message: `${operator.companyName} can now sign in.`,
                    data: {
                        operatorId: id,
                        username: body.username,
                        // Present only when we generated it. Shown once.
                        temporaryPassword: generated,
                    },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    /**
     * POST /api/admin/ftth/operators/:id/reject
     */
    app.post(
        "/api/admin/ftth/operators/:id/reject",
        authenticateAdmin,
        requireSuperAdmin,
        validateBody(rejectSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const actor = (req as any).admin as { userId: number; username: string };
                const { reason } = req.body as z.infer<typeof rejectSchema>;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);

                if (!operator) {
                    return res.status(404).json({ success: false, message: 'Operator not found' });
                }
                if (operator.status !== 'pending_approval') {
                    return res.status(409).json({
                        success: false,
                        message: 'Only a pending application can be rejected.',
                    });
                }

                await db.update(ftthOperators)
                    .set({ status: 'disabled', rejectionReason: reason, updatedAt: new Date() })
                    .where(eq(ftthOperators.id, id));

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_operator_rejected',
                    fromState: 'pending_approval',
                    toState: 'disabled',
                    changedBy: actor.userId,
                    metadata: { companyName: operator.companyName, reason },
                });

                res.json({ success: true, message: 'Application rejected.' });
            } catch (error) {
                next(error);
            }
        },
    );

    /**
     * PATCH /api/admin/ftth/operators/:id/status  — pause / resume / disable.
     *
     * Operator status and the login's `isActive` flag are set TOGETHER. They are
     * two switches for one thing, and letting them disagree produces the worst
     * kind of bug: an operator who can sign in but whose every request 403s, or
     * one marked disabled who still holds a working session. This endpoint is
     * the single place either is changed — which is also why
     * /api/admin/admins/:id/status refuses to touch operator rows.
     */
    app.patch(
        "/api/admin/ftth/operators/:id/status",
        authenticateAdmin,
        requireSuperAdmin,
        validateBody(statusSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const actor = (req as any).admin as { userId: number; username: string };
                const { status, reason } = req.body as z.infer<typeof statusSchema>;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);

                if (!operator) {
                    return res.status(404).json({ success: false, message: 'Operator not found' });
                }
                if (operator.status === 'pending_approval') {
                    return res.status(409).json({
                        success: false,
                        message: 'Approve or reject this application first.',
                    });
                }
                if (status === 'active' && !operator.adminUserId) {
                    return res.status(409).json({
                        success: false,
                        message: 'This operator has no login. Approve the application first.',
                    });
                }

                await withTransaction(async (tx) => {
                    await tx.update(ftthOperators)
                        .set({ status, updatedAt: new Date() })
                        .where(eq(ftthOperators.id, id));

                    if (operator.adminUserId) {
                        await tx.update(adminUsers)
                            .set({ isActive: status === 'active', updatedAt: new Date() })
                            .where(eq(adminUsers.id, operator.adminUserId));
                    }
                });

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_operator_status_changed',
                    fromState: operator.status,
                    toState: status,
                    changedBy: actor.userId,
                    metadata: { companyName: operator.companyName, reason: reason ?? null },
                });

                logger.info('[FTTH] Operator status changed', {
                    operatorId: id, from: operator.status, to: status, by: actor.username,
                });

                res.json({ success: true, message: `${operator.companyName} is now ${status}.` });
            } catch (error) {
                next(error);
            }
        },
    );

    // ==================== OPERATOR PORTAL ====================

    /**
     * GET /api/ftth/admin/me
     *
     * The signed-in operator's own profile. Everything is scoped by
     * `req.operator.operatorId` — the id from the token's account row, never
     * from the request.
     */
    app.get(
        "/api/ftth/admin/me",
        authenticateOperator,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, username } = (req as any).operator;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, operatorId)).limit(1);

                if (!operator) {
                    // authenticateOperator resolved it a moment ago, so this means
                    // it was deleted mid-request.
                    return res.status(404).json({ success: false, message: 'Operator profile not found' });
                }

                const pincodes = await db
                    .select({ pincode: ftthOperatorPincodes.pincode })
                    .from(ftthOperatorPincodes)
                    .where(and(
                        eq(ftthOperatorPincodes.operatorId, operatorId),
                        eq(ftthOperatorPincodes.isActive, true),
                    ));

                res.json({
                    success: true,
                    data: {
                        id: operator.id,
                        username,
                        companyName: operator.companyName,
                        legalName: operator.legalName,
                        gstin: operator.gstin,
                        contactName: operator.contactName,
                        contactEmail: operator.contactEmail,
                        contactPhone: operator.contactPhone,
                        logoUrl: operator.logoUrl,
                        brandColor: operator.brandColor,
                        status: operator.status,
                        // Commercial terms are read-only to the operator: they are
                        // negotiated with UniteFix, not self-served.
                        convenienceFee: toRupees(operator.convenienceFeePaise),
                        pincodes: pincodes.map(p => p.pincode),
                    },
                });
            } catch (error) {
                next(error);
            }
        },
    );

    /** GET /api/ftth/admin/plans — this operator's catalogue. */
    app.get("/api/ftth/admin/plans", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const rows = await db.select().from(ftthPlans)
                .where(eq(ftthPlans.operatorId, operatorId))
                .orderBy(asc(ftthPlans.speedMbps), asc(ftthPlans.durationMonths));
            res.json({ success: true, data: rows.map(planView) });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/ftth/admin/plans
     *
     * The operator id comes from the TOKEN, never the body. A duplicate active
     * (speed, duration) is rejected in the handler rather than by a unique index:
     * an index would also block re-creating a plan that was previously
     * deactivated, and plans are soft-deleted because recharges FK to them.
     */
    app.post("/api/ftth/admin/plans", authenticateOperator, validateBody(planSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const body = req.body as z.infer<typeof planSchema>;

                const clash = await findActivePlanClash(operatorId, body.speedMbps, body.durationMonths, null);
                if (clash) {
                    return res.status(409).json({
                        success: false,
                        message: `You already sell ${body.speedMbps} Mbps for ${body.durationMonths} month(s).`,
                    });
                }

                const [row] = await db.insert(ftthPlans).values({
                    operatorId,
                    name: body.name,
                    speedMbps: body.speedMbps,
                    durationMonths: body.durationMonths,
                    listPricePaise: rupeesToPaise(body.priceRupees),
                    discountPaise: rupeesToPaise(body.discountRupees ?? 0),
                    dataLimitGb: body.dataLimitGb ?? null,
                    benefits: (body.benefits ?? null) as any,
                    sortOrder: body.sortOrder ?? 0,
                    isActive: body.isActive ?? true,
                }).returning();

                res.status(201).json({ success: true, data: planView(row) });
            } catch (error) { next(error); }
        });

    /** PATCH /api/ftth/admin/plans/:id */
    app.patch("/api/ftth/admin/plans/:id", authenticateOperator, validateBody(planSchema.partial()),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Invalid plan id' });

                // Scoped by operatorId — an operator cannot edit another's plan by
                // guessing an id.
                const [plan] = await db.select().from(ftthPlans)
                    .where(and(eq(ftthPlans.id, id), eq(ftthPlans.operatorId, operatorId))).limit(1);
                if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

                const body = req.body as Partial<z.infer<typeof planSchema>>;
                const nextSpeed = body.speedMbps ?? plan.speedMbps;
                const nextDuration = body.durationMonths ?? plan.durationMonths;

                if (body.isActive !== false) {
                    const clash = await findActivePlanClash(operatorId, nextSpeed, nextDuration, id);
                    if (clash) {
                        return res.status(409).json({
                            success: false,
                            message: `You already sell ${nextSpeed} Mbps for ${nextDuration} month(s).`,
                        });
                    }
                }

                const [row] = await db.update(ftthPlans).set({
                    ...(body.name !== undefined ? { name: body.name } : {}),
                    ...(body.speedMbps !== undefined ? { speedMbps: body.speedMbps } : {}),
                    ...(body.durationMonths !== undefined ? { durationMonths: body.durationMonths } : {}),
                    ...(body.priceRupees !== undefined ? { listPricePaise: rupeesToPaise(body.priceRupees) } : {}),
                    ...(body.discountRupees !== undefined ? { discountPaise: rupeesToPaise(body.discountRupees) } : {}),
                    ...(body.dataLimitGb !== undefined ? { dataLimitGb: body.dataLimitGb } : {}),
                    ...(body.benefits !== undefined ? { benefits: body.benefits as any } : {}),
                    ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
                    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
                    updatedAt: new Date(),
                }).where(eq(ftthPlans.id, id)).returning();

                res.json({ success: true, data: planView(row) });
            } catch (error) { next(error); }
        });

    /**
     * POST /api/ftth/admin/plans/bulk
     *
     * A real ISP arrives with 15-25 plans. Entering those one modal at a time is
     * how a feature gets abandoned during onboarding, so the grid and the CSV
     * import both land here. All-or-nothing: a batch with any invalid row is
     * rejected whole, with per-row errors, rather than half-importing a price
     * list.
     */
    app.post("/api/ftth/admin/plans/bulk", authenticateOperator, validateBody(planBulkSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const { plans } = req.body as z.infer<typeof planBulkSchema>;

                // Duplicates WITHIN the batch, before touching the database.
                const seen = new Map<string, number>();
                const errors: Array<{ row: number; message: string }> = [];
                plans.forEach((p, i) => {
                    const key = `${p.speedMbps}x${p.durationMonths}`;
                    if (seen.has(key)) {
                        errors.push({ row: i + 1, message: `Duplicate of row ${seen.get(key)! + 1} (${key})` });
                    } else {
                        seen.set(key, i);
                    }
                });
                if (errors.length) {
                    return res.status(400).json({ success: false, message: 'Duplicate rows in import', errors });
                }

                const result = await withTransaction(async (tx) => {
                    const existing = await tx.select().from(ftthPlans)
                        .where(eq(ftthPlans.operatorId, operatorId));
                    const byKey = new Map(existing.map(p => [`${p.speedMbps}x${p.durationMonths}`, p]));

                    let created = 0, updated = 0;
                    for (const p of plans) {
                        const key = `${p.speedMbps}x${p.durationMonths}`;
                        const match = byKey.get(key);
                        const values = {
                            name: p.name,
                            listPricePaise: rupeesToPaise(p.priceRupees),
                            discountPaise: rupeesToPaise(p.discountRupees ?? 0),
                            dataLimitGb: p.dataLimitGb ?? null,
                            benefits: (p.benefits ?? null) as any,
                            sortOrder: p.sortOrder ?? 0,
                            isActive: p.isActive ?? true,
                            updatedAt: new Date(),
                        };
                        if (match) {
                            // Re-importing a price list UPDATES rather than
                            // duplicating — the same spreadsheet uploaded twice
                            // must not produce two catalogues.
                            await tx.update(ftthPlans).set(values).where(eq(ftthPlans.id, match.id));
                            updated++;
                        } else {
                            await tx.insert(ftthPlans).values({
                                operatorId, speedMbps: p.speedMbps, durationMonths: p.durationMonths, ...values,
                            });
                            created++;
                        }
                    }
                    return { created, updated };
                });

                logger.info('[FTTH] Bulk plan import', { operatorId, ...result });
                res.json({ success: true, message: `${result.created} added, ${result.updated} updated.`, data: result });
            } catch (error) { next(error); }
        });

    /** POST /api/ftth/admin/plans/:id/duplicate — "same plan, next duration". */
    app.post("/api/ftth/admin/plans/:id/duplicate", authenticateOperator,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const id = Number(req.params.id);
                const durationMonths = Number(req.body?.durationMonths);
                if (!Number.isInteger(id) || !Number.isInteger(durationMonths) || durationMonths < 1) {
                    return res.status(400).json({ success: false, message: 'A target durationMonths is required' });
                }

                const [plan] = await db.select().from(ftthPlans)
                    .where(and(eq(ftthPlans.id, id), eq(ftthPlans.operatorId, operatorId))).limit(1);
                if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

                const clash = await findActivePlanClash(operatorId, plan.speedMbps, durationMonths, null);
                if (clash) {
                    return res.status(409).json({
                        success: false,
                        message: `You already sell ${plan.speedMbps} Mbps for ${durationMonths} month(s).`,
                    });
                }

                const ratio = durationMonths / plan.durationMonths;
                const [row] = await db.insert(ftthPlans).values({
                    operatorId,
                    name: plan.name.replace(/\d+\s*month/i, `${durationMonths} month`),
                    speedMbps: plan.speedMbps,
                    durationMonths,
                    // A starting point the operator will edit — pro-rated, not guessed.
                    listPricePaise: Math.round(plan.listPricePaise * ratio),
                    discountPaise: Math.round(plan.discountPaise * ratio),
                    dataLimitGb: plan.dataLimitGb,
                    benefits: plan.benefits as any,
                    sortOrder: plan.sortOrder,
                    isActive: false,   // inactive until the operator confirms the price
                }).returning();

                res.status(201).json({ success: true, data: planView(row) });
            } catch (error) { next(error); }
        });

    /** GET/PUT /api/ftth/admin/coverage — the operator's own pincode list. */
    app.get("/api/ftth/admin/coverage", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const mine = await db.select({ pincode: ftthOperatorPincodes.pincode })
                .from(ftthOperatorPincodes).where(eq(ftthOperatorPincodes.operatorId, operatorId));
            const available = await db.select({ pincode: serviceablePincodes.pincode, area: serviceablePincodes.area })
                .from(serviceablePincodes).where(eq(serviceablePincodes.isActive, true))
                .orderBy(asc(serviceablePincodes.pincode));
            res.json({ success: true, data: { selected: mine.map(m => m.pincode), available } });
        } catch (error) { next(error); }
    });

    app.put("/api/ftth/admin/coverage", authenticateOperator, validateBody(coverageSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const wanted = Array.from(new Set((req.body as z.infer<typeof coverageSchema>).pincodes));

                if (wanted.length) {
                    const known = await db.select({ pincode: serviceablePincodes.pincode })
                        .from(serviceablePincodes).where(inArray(serviceablePincodes.pincode, wanted));
                    const knownSet = new Set(known.map(k => k.pincode));
                    const unknown = wanted.filter(p => !knownSet.has(p));
                    if (unknown.length) {
                        return res.status(400).json({
                            success: false,
                            message: `UniteFix does not operate in: ${unknown.join(', ')}`,
                            unserviceablePincodes: unknown,
                        });
                    }
                }

                await withTransaction(async (tx) => {
                    await tx.delete(ftthOperatorPincodes).where(eq(ftthOperatorPincodes.operatorId, operatorId));
                    if (wanted.length) {
                        await tx.insert(ftthOperatorPincodes)
                            .values(wanted.map(pincode => ({ operatorId, pincode })));
                    }
                });

                res.json({ success: true, message: `Coverage saved (${wanted.length} pincode${wanted.length === 1 ? '' : 's'}).` });
            } catch (error) { next(error); }
        });

    /** GET /api/ftth/admin/connections?filter=active|pending|expiring */
    app.get("/api/ftth/admin/connections", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const filter = String(req.query.filter ?? 'all');

            const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const conditions = [eq(ftthConnections.operatorId, operatorId)];
            if (filter === 'active') conditions.push(eq(ftthConnections.status, 'active'));
            if (filter === 'pending') conditions.push(eq(ftthConnections.status, 'pending_id'));
            if (filter === 'suspended') conditions.push(eq(ftthConnections.status, 'suspended'));
            if (filter === 'expiring') {
                conditions.push(eq(ftthConnections.status, 'active'));
                conditions.push(lte(ftthConnections.validTill, soon));
            }

            const rows = await db.select({
                id: ftthConnections.id,
                ispConnectionId: ftthConnections.ispConnectionId,
                status: ftthConnections.status,
                validTill: ftthConnections.validTill,
                customerName: ftthConnections.customerName,
                installationAddress: ftthConnections.installationAddress,
                createdAt: ftthConnections.createdAt,
                planName: ftthPlans.name,
                speedMbps: ftthPlans.speedMbps,
                userPhone: users.phone,
                userName: users.username,
            })
                .from(ftthConnections)
                .leftJoin(ftthPlans, eq(ftthPlans.id, ftthConnections.currentPlanId))
                .leftJoin(users, eq(users.id, ftthConnections.userId))
                .where(and(...conditions))
                .orderBy(asc(ftthConnections.validTill));

            res.json({ success: true, data: rows });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/ftth/admin/connections/:id/status — suspend / reactivate.
     *
     * Suspending a customer inside a PAID validity window is a money question,
     * not a toggle, so the remaining days are recorded in the audit entry and
     * returned to the operator.
     */
    app.post("/api/ftth/admin/connections/:id/status", authenticateOperator, validateBody(connectionStatusSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, adminUserId } = (req as any).operator;
                const id = Number(req.params.id);
                const { action, reason } = req.body as z.infer<typeof connectionStatusSchema>;

                const [conn] = await db.select().from(ftthConnections)
                    .where(and(eq(ftthConnections.id, id), eq(ftthConnections.operatorId, operatorId))).limit(1);
                if (!conn) return res.status(404).json({ success: false, message: 'Connection not found' });

                const daysRemaining = conn.validTill
                    ? Math.max(0, Math.ceil((conn.validTill.getTime() - Date.now()) / 86_400_000))
                    : 0;

                const nextStatus = action === 'suspend'
                    ? 'suspended'
                    : (conn.ispConnectionId ? 'active' : 'pending_id');

                await db.update(ftthConnections)
                    .set({ status: nextStatus as any, updatedAt: new Date() })
                    .where(eq(ftthConnections.id, id));

                await recordAudit({
                    entityType: 'ftth_connection',
                    entityId: id,
                    action: action === 'suspend' ? 'ftth_connection_suspended' : 'ftth_connection_reactivated',
                    fromState: conn.status,
                    toState: nextStatus,
                    changedBy: adminUserId,
                    metadata: { operatorId, reason: reason ?? null, paidDaysRemaining: daysRemaining },
                });

                res.json({
                    success: true,
                    message: action === 'suspend'
                        ? (daysRemaining > 0
                            ? `Suspended with ${daysRemaining} paid day(s) remaining.`
                            : 'Connection suspended.')
                        : 'Connection reactivated.',
                    data: { paidDaysRemaining: daysRemaining },
                });
            } catch (error) { next(error); }
        });

    /** GET /api/ftth/admin/id-requests */
    app.get("/api/ftth/admin/id-requests", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const status = String(req.query.status ?? 'pending');
            const conditions = [eq(ftthIdRequests.operatorId, operatorId)];
            if (['pending', 'approved', 'rejected'].includes(status)) {
                conditions.push(eq(ftthIdRequests.status, status as any));
            }

            const rows = await db.select({
                id: ftthIdRequests.id,
                claimedName: ftthIdRequests.claimedName,
                claimedPhone: ftthIdRequests.claimedPhone,
                claimedAddress: ftthIdRequests.claimedAddress,
                claimedIspId: ftthIdRequests.claimedIspId,
                status: ftthIdRequests.status,
                rejectionReason: ftthIdRequests.rejectionReason,
                createdAt: ftthIdRequests.createdAt,
                userPhone: users.phone,
            })
                .from(ftthIdRequests)
                .leftJoin(users, eq(users.id, ftthIdRequests.userId))
                .where(and(...conditions))
                .orderBy(desc(ftthIdRequests.createdAt));

            res.json({ success: true, data: rows });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/ftth/admin/id-requests/:id/approve
     * Maps the customer to a real ISP id and activates the connection.
     */
    app.post("/api/ftth/admin/id-requests/:id/approve", authenticateOperator, validateBody(assignIdSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, adminUserId } = (req as any).operator;
                const id = Number(req.params.id);
                const { ispConnectionId } = req.body as z.infer<typeof assignIdSchema>;

                const [request] = await db.select().from(ftthIdRequests)
                    .where(and(eq(ftthIdRequests.id, id), eq(ftthIdRequests.operatorId, operatorId))).limit(1);
                if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
                if (request.status !== 'pending') {
                    return res.status(409).json({ success: false, message: `This request is already ${request.status}.` });
                }

                // The unique index on (operatorId, ispConnectionId) would catch
                // this, but a clear message beats a constraint violation.
                const [taken] = await db.select({ id: ftthConnections.id }).from(ftthConnections)
                    .where(and(
                        eq(ftthConnections.operatorId, operatorId),
                        eq(ftthConnections.ispConnectionId, ispConnectionId),
                    )).limit(1);
                if (taken) {
                    return res.status(409).json({
                        success: false,
                        message: `${ispConnectionId} is already mapped to another UniteFix account.`,
                    });
                }

                const connection = await withTransaction(async (tx) => {
                    const [existing] = await tx.select().from(ftthConnections)
                        .where(and(
                            eq(ftthConnections.userId, request.userId),
                            eq(ftthConnections.operatorId, operatorId),
                        )).limit(1);

                    let row;
                    if (existing) {
                        [row] = await tx.update(ftthConnections).set({
                            ispConnectionId,
                            status: 'active',
                            customerName: existing.customerName ?? request.claimedName,
                            updatedAt: new Date(),
                        }).where(eq(ftthConnections.id, existing.id)).returning();
                    } else {
                        [row] = await tx.insert(ftthConnections).values({
                            userId: request.userId,
                            operatorId,
                            ispConnectionId,
                            status: 'active',
                            customerName: request.claimedName,
                            installationAddress: request.claimedAddress,
                        }).returning();
                    }

                    await tx.update(ftthIdRequests).set({
                        status: 'approved',
                        connectionId: row.id,
                        reviewedByAdminId: adminUserId,
                        reviewedAt: new Date(),
                    }).where(eq(ftthIdRequests.id, id));

                    return row;
                });

                await recordAudit({
                    entityType: 'ftth_connection',
                    entityId: connection.id,
                    action: 'ftth_isp_id_assigned',
                    toState: 'active',
                    changedBy: adminUserId,
                    metadata: { operatorId, ispConnectionId, idRequestId: id },
                });

                void NotificationService.notify(
                    request.userId,
                    'Your broadband account is linked',
                    `You can now recharge ${ispConnectionId} from the UniteFix app.`,
                    'ftth_id_assigned',
                    { connectionId: connection.id },
                );

                res.json({ success: true, message: 'Connection activated.', data: { connectionId: connection.id } });
            } catch (error) { next(error); }
        });

    app.post("/api/ftth/admin/id-requests/:id/reject", authenticateOperator, validateBody(rejectIdSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, adminUserId } = (req as any).operator;
                const id = Number(req.params.id);
                const { reason } = req.body as z.infer<typeof rejectIdSchema>;

                const [request] = await db.select().from(ftthIdRequests)
                    .where(and(eq(ftthIdRequests.id, id), eq(ftthIdRequests.operatorId, operatorId))).limit(1);
                if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
                if (request.status !== 'pending') {
                    return res.status(409).json({ success: false, message: `This request is already ${request.status}.` });
                }

                await db.update(ftthIdRequests).set({
                    status: 'rejected',
                    rejectionReason: reason,
                    reviewedByAdminId: adminUserId,
                    reviewedAt: new Date(),
                }).where(eq(ftthIdRequests.id, id));

                void NotificationService.notify(
                    request.userId,
                    'Broadband account not linked',
                    reason,
                    'ftth_id_rejected',
                    {},
                );

                res.json({ success: true, message: 'Request rejected.' });
            } catch (error) { next(error); }
        });

    /** GET /api/ftth/admin/leads */
    app.get("/api/ftth/admin/leads", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const status = String(req.query.status ?? '');
            const conditions = [eq(ftthLeads.operatorId, operatorId)];
            if (['new', 'contacted', 'converted', 'closed'].includes(status)) {
                conditions.push(eq(ftthLeads.status, status as any));
            }

            const rows = await db.select().from(ftthLeads)
                .where(and(...conditions))
                .orderBy(desc(ftthLeads.createdAt));

            res.json({
                success: true,
                data: rows.map(r => ({ ...r, leadFee: r.leadFeePaise === null ? null : paiseToRupees(r.leadFeePaise) })),
            });
        } catch (error) { next(error); }
    });

    app.patch("/api/ftth/admin/leads/:id", authenticateOperator, validateBody(leadStatusSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId } = (req as any).operator;
                const id = Number(req.params.id);
                const { status, notes } = req.body as z.infer<typeof leadStatusSchema>;

                const [lead] = await db.select().from(ftthLeads)
                    .where(and(eq(ftthLeads.id, id), eq(ftthLeads.operatorId, operatorId))).limit(1);
                if (!lead) return res.status(404).json({ success: false, message: 'Lead not found' });
                if (lead.status === 'converted') {
                    return res.status(409).json({ success: false, message: 'A converted lead cannot be moved back.' });
                }

                await db.update(ftthLeads).set({
                    status,
                    ...(notes !== undefined ? { notes } : {}),
                    updatedAt: new Date(),
                }).where(eq(ftthLeads.id, id));

                res.json({ success: true, message: `Lead marked ${status}.` });
            } catch (error) { next(error); }
        });

    /**
     * POST /api/ftth/admin/leads/:id/convert
     *
     * Creates the connection AND accrues the lead fee in one transaction. This is
     * the revenue line the earlier plan had no implementation for at all.
     */
    app.post("/api/ftth/admin/leads/:id/convert", authenticateOperator, validateBody(convertLeadSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, adminUserId } = (req as any).operator;
                const id = Number(req.params.id);
                const { ispConnectionId } = req.body as z.infer<typeof convertLeadSchema>;

                const result = await FtthService.convertLead({
                    leadId: id, operatorId, ispConnectionId: ispConnectionId ?? null, adminUserId,
                });

                await recordAudit({
                    entityType: 'ftth_lead',
                    entityId: id,
                    action: 'ftth_lead_converted',
                    toState: 'converted',
                    changedBy: adminUserId,
                    metadata: {
                        operatorId,
                        connectionId: result.connection.id,
                        leadFeePaise: result.leadFeePaise,
                    },
                });

                res.json({
                    success: true,
                    message: `Lead converted. Acquisition fee ₹${paiseToRupees(result.leadFeePaise)} recorded.`,
                    data: { connectionId: result.connection.id },
                });
            } catch (error: any) {
                if (/already converted|not found/i.test(error?.message ?? '')) {
                    return res.status(409).json({ success: false, message: error.message });
                }
                next(error);
            }
        });

    /** GET /api/ftth/admin/recharges */
    app.get("/api/ftth/admin/recharges", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const rows = await db.select({
                id: ftthRecharges.id,
                planName: ftthRecharges.planName,
                speedMbps: ftthRecharges.speedMbps,
                durationMonths: ftthRecharges.durationMonths,
                operatorPayablePaise: ftthRecharges.operatorPayablePaise,
                totalPaise: ftthRecharges.totalPaise,
                status: ftthRecharges.status,
                periodStart: ftthRecharges.periodStart,
                periodEnd: ftthRecharges.periodEnd,
                fulfilledAt: ftthRecharges.fulfilledAt,
                createdAt: ftthRecharges.createdAt,
                ispConnectionId: ftthConnections.ispConnectionId,
                customerName: ftthConnections.customerName,
            })
                .from(ftthRecharges)
                .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
                .where(and(
                    eq(ftthConnections.operatorId, operatorId),
                    ne(ftthRecharges.status, 'created'),
                ))
                .orderBy(desc(ftthRecharges.createdAt))
                .limit(500);

            res.json({
                success: true,
                data: rows.map(r => ({
                    ...r,
                    youReceive: paiseToRupees(r.operatorPayablePaise),
                    customerPaid: paiseToRupees(r.totalPaise),
                })),
            });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/ftth/admin/recharges/:id/fulfil
     * The operator confirming they applied the recharge in their own portal.
     */
    app.post("/api/ftth/admin/recharges/:id/fulfil", authenticateOperator,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { operatorId, adminUserId } = (req as any).operator;
                const id = Number(req.params.id);

                const [row] = await db.select({ id: ftthRecharges.id, status: ftthRecharges.status })
                    .from(ftthRecharges)
                    .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
                    .where(and(eq(ftthRecharges.id, id), eq(ftthConnections.operatorId, operatorId)))
                    .limit(1);
                if (!row) return res.status(404).json({ success: false, message: 'Recharge not found' });
                if (row.status !== 'success') {
                    return res.status(409).json({ success: false, message: 'Only a paid recharge can be marked done.' });
                }

                await db.update(ftthRecharges)
                    .set({ fulfilledAt: new Date(), fulfilledByAdminId: adminUserId, updatedAt: new Date() })
                    .where(eq(ftthRecharges.id, id));

                res.json({ success: true, message: 'Marked as done.' });
            } catch (error) { next(error); }
        });

    /** GET /api/ftth/admin/ledger — running balance and entries. */
    app.get("/api/ftth/admin/ledger", authenticateOperator, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { operatorId } = (req as any).operator;
            const entries = await db.select().from(ftthOperatorLedger)
                .where(eq(ftthOperatorLedger.operatorId, operatorId))
                .orderBy(desc(ftthOperatorLedger.id))
                .limit(500);

            res.json({
                success: true,
                data: {
                    balance: paiseToRupees(await FtthService.operatorBalancePaise(operatorId)),
                    entries: entries.map(e => ({ ...e, amount: paiseToRupees(e.amountPaise) })),
                },
            });
        } catch (error) { next(error); }
    });

    // ==================== STAFF: SETTLEMENT ====================

    /**
     * POST /api/admin/ftth/operators/:id/settle
     * Records money actually remitted to an operator. Staff-side: the operator
     * cannot mark themselves paid.
     */
    app.post("/api/admin/ftth/operators/:id/settle", authenticateAdmin, requireSuperAdmin,
        validateBody(settlementSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const actor = (req as any).admin as { userId: number; username: string };
                const { amountRupees, reference, note } = req.body as z.infer<typeof settlementSchema>;

                const [operator] = await db.select().from(ftthOperators).where(eq(ftthOperators.id, id)).limit(1);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not found' });

                const entry = await FtthService.recordLedgerEntry({
                    operatorId: id,
                    entryType: 'settlement_paid',
                    amountPaise: -rupeesToPaise(amountRupees),
                    description: note || `Settlement — ${reference}`,
                    createdByAdminId: actor.userId,
                    metadata: { reference },
                });

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_settlement_recorded',
                    changedBy: actor.userId,
                    metadata: { amountRupees, reference },
                });

                res.json({
                    success: true,
                    message: `₹${amountRupees} settlement recorded.`,
                    data: { balance: paiseToRupees(entry?.balanceAfterPaise ?? 0) },
                });
            } catch (error) { next(error); }
        });

    /**
     * PATCH /api/admin/ftth/operators/:id
     *
     * Edit an operator's details and commercial terms AFTER approval. Terms get
     * renegotiated; freezing them at approval time would mean the only way to
     * change a lead fee is a database edit.
     *
     * Notably absent: `status` and `adminUserId`. Status moves through
     * /status so admin_users.is_active stays in step, and the login link is set
     * once at approval.
     */
    app.patch("/api/admin/ftth/operators/:id", authenticateAdmin, requireSuperAdmin,
        validateBody(operatorEditSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const actor = (req as any).admin as { userId: number; username: string };
                const body = req.body as z.infer<typeof operatorEditSchema>;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not found' });

                // The operator's email is also their login email, and admin_users
                // enforces uniqueness across ALL admin accounts.
                if (body.contactEmail && body.contactEmail !== operator.contactEmail && operator.adminUserId) {
                    const [clash] = await db.select({ id: adminUsers.id }).from(adminUsers)
                        .where(and(
                            eq(adminUsers.email, body.contactEmail),
                            ne(adminUsers.id, operator.adminUserId),
                        )).limit(1);
                    if (clash) {
                        return res.status(409).json({
                            success: false,
                            message: 'Another admin account already uses that email address.',
                        });
                    }
                }

                const changes: Record<string, unknown> = { updatedAt: new Date() };
                const audited: Record<string, unknown> = {};

                const set = (key: string, value: unknown, from: unknown) => {
                    changes[key] = value;
                    if (value !== from) audited[key] = { from, to: value };
                };

                if (body.companyName !== undefined) set('companyName', body.companyName, operator.companyName);
                if (body.legalName !== undefined) set('legalName', body.legalName, operator.legalName);
                if (body.gstin !== undefined) set('gstin', body.gstin, operator.gstin);
                if (body.contactName !== undefined) set('contactName', body.contactName, operator.contactName);
                if (body.contactEmail !== undefined) set('contactEmail', body.contactEmail, operator.contactEmail);
                if (body.contactPhone !== undefined) set('contactPhone', body.contactPhone, operator.contactPhone);
                if (body.logoUrl !== undefined) set('logoUrl', body.logoUrl, operator.logoUrl);
                if (body.brandColor !== undefined) set('brandColor', body.brandColor, operator.brandColor);
                if (body.leadFeeRupees !== undefined) {
                    set('leadFeePaise',
                        body.leadFeeRupees === null ? null : rupeesToPaise(body.leadFeeRupees),
                        operator.leadFeePaise);
                }
                if (body.convenienceFeeRupees !== undefined) {
                    set('convenienceFeePaise',
                        body.convenienceFeeRupees === null ? null : rupeesToPaise(body.convenienceFeeRupees),
                        operator.convenienceFeePaise);
                }

                const [updated] = await withTransaction(async (tx) => {
                    const rows = await tx.update(ftthOperators).set(changes as any)
                        .where(eq(ftthOperators.id, id)).returning();

                    // Keep the login email in step, or the operator's own
                    // /api/admin/me lookup and any password reset would target a
                    // stale address.
                    if (body.contactEmail && operator.adminUserId) {
                        await tx.update(adminUsers)
                            .set({ email: body.contactEmail, updatedAt: new Date() })
                            .where(eq(adminUsers.id, operator.adminUserId));
                    }
                    return rows;
                });

                if (Object.keys(audited).length) {
                    await recordAudit({
                        entityType: 'ftth_operator',
                        entityId: id,
                        action: 'ftth_operator_updated',
                        changedBy: actor.userId,
                        metadata: { companyName: operator.companyName, changes: audited },
                    });
                    logger.info('[FTTH] Operator updated', {
                        operatorId: id, by: actor.username, fields: Object.keys(audited),
                    });
                }

                res.json({
                    success: true,
                    message: 'Operator updated.',
                    data: {
                        ...updated,
                        leadFee: toRupees(updated.leadFeePaise),
                        convenienceFee: toRupees(updated.convenienceFeePaise),
                    },
                });
            } catch (error) { next(error); }
        });

    /**
     * POST /api/admin/ftth/operators/:id/reset-password
     *
     * Operators phone UniteFix when they are locked out — there is no self-serve
     * reset for them, and without this the only recovery is a DB edit. The new
     * password is shown once and never stored in plaintext.
     */
    app.post("/api/admin/ftth/operators/:id/reset-password", authenticateAdmin, requireSuperAdmin,
        validateBody(resetPasswordSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const actor = (req as any).admin as { userId: number; username: string };
                const { password } = req.body as z.infer<typeof resetPasswordSchema>;

                const [operator] = await db.select().from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not found' });
                if (!operator.adminUserId) {
                    return res.status(409).json({
                        success: false,
                        message: 'This operator has no login yet. Approve the application first.',
                    });
                }

                const generated = password ? null : crypto.randomBytes(12).toString('base64url');
                const plain = password ?? generated!;
                await db.update(adminUsers)
                    .set({ password: await bcrypt.hash(plain, 10), updatedAt: new Date() })
                    .where(eq(adminUsers.id, operator.adminUserId));

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_operator_password_reset',
                    changedBy: actor.userId,
                    metadata: { companyName: operator.companyName, generated: generated !== null },
                });

                logger.warn('[FTTH] Operator password reset', {
                    operatorId: id, companyName: operator.companyName, by: actor.username,
                });

                res.json({
                    success: true,
                    message: 'Password reset.',
                    data: { temporaryPassword: generated },
                });
            } catch (error) { next(error); }
        });

    /**
     * PUT /api/admin/ftth/operators/:id/coverage
     * Staff can edit coverage on an operator's behalf — most ISPs will phone
     * rather than open the portal.
     */
    app.put("/api/admin/ftth/operators/:id/coverage", authenticateAdmin, requireSuperAdmin,
        validateBody(coverageSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const actor = (req as any).admin as { userId: number };
                const wanted = Array.from(new Set((req.body as z.infer<typeof coverageSchema>).pincodes));

                const [operator] = await db.select({ id: ftthOperators.id, companyName: ftthOperators.companyName })
                    .from(ftthOperators).where(eq(ftthOperators.id, id)).limit(1);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not found' });

                if (wanted.length) {
                    const known = await db.select({ pincode: serviceablePincodes.pincode })
                        .from(serviceablePincodes).where(inArray(serviceablePincodes.pincode, wanted));
                    const knownSet = new Set(known.map(k => k.pincode));
                    const unknown = wanted.filter(p => !knownSet.has(p));
                    if (unknown.length) {
                        return res.status(400).json({
                            success: false,
                            message: `Not serviceable pincodes: ${unknown.join(', ')}`,
                            unserviceablePincodes: unknown,
                        });
                    }
                }

                await withTransaction(async (tx) => {
                    await tx.delete(ftthOperatorPincodes).where(eq(ftthOperatorPincodes.operatorId, id));
                    if (wanted.length) {
                        await tx.insert(ftthOperatorPincodes)
                            .values(wanted.map(pincode => ({ operatorId: id, pincode })));
                    }
                });

                await recordAudit({
                    entityType: 'ftth_operator',
                    entityId: id,
                    action: 'ftth_operator_coverage_updated',
                    changedBy: actor.userId,
                    metadata: { companyName: operator.companyName, pincodes: wanted },
                });

                res.json({ success: true, message: `Coverage saved (${wanted.length} pincode${wanted.length === 1 ? '' : 's'}).` });
            } catch (error) { next(error); }
        });

    /**
     * GET /api/admin/ftth/operators/:id/activity
     *
     * Staff oversight of one operator: catalogue, customers, leads, recharges
     * and statement in a single call.
     *
     * READ-ONLY on purpose. Staff can see an operator's prices but not edit them
     * — repricing someone else's product on their behalf is a liability, not a
     * convenience, and every plan edit must be attributable to the operator who
     * made it. Fixing a bad price is a phone call, not a button.
     */
    app.get("/api/admin/ftth/operators/:id/activity", authenticateAdmin,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                if (!Number.isInteger(id)) {
                    return res.status(400).json({ success: false, message: 'Invalid operator id' });
                }

                const [operator] = await db.select({ id: ftthOperators.id }).from(ftthOperators)
                    .where(eq(ftthOperators.id, id)).limit(1);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not found' });

                const [plans, connections, leads, recharges, ledger] = await Promise.all([
                    db.select().from(ftthPlans)
                        .where(eq(ftthPlans.operatorId, id))
                        .orderBy(asc(ftthPlans.speedMbps), asc(ftthPlans.durationMonths)),

                    db.select({
                        id: ftthConnections.id,
                        ispConnectionId: ftthConnections.ispConnectionId,
                        status: ftthConnections.status,
                        validTill: ftthConnections.validTill,
                        customerName: ftthConnections.customerName,
                        userPhone: users.phone,
                        planName: ftthPlans.name,
                    })
                        .from(ftthConnections)
                        .leftJoin(users, eq(users.id, ftthConnections.userId))
                        .leftJoin(ftthPlans, eq(ftthPlans.id, ftthConnections.currentPlanId))
                        .where(eq(ftthConnections.operatorId, id))
                        .orderBy(desc(ftthConnections.createdAt))
                        .limit(200),

                    db.select().from(ftthLeads)
                        .where(eq(ftthLeads.operatorId, id))
                        .orderBy(desc(ftthLeads.createdAt))
                        .limit(200),

                    db.select({
                        id: ftthRecharges.id,
                        planName: ftthRecharges.planName,
                        totalPaise: ftthRecharges.totalPaise,
                        operatorPayablePaise: ftthRecharges.operatorPayablePaise,
                        platformRevenuePaise: ftthRecharges.platformRevenuePaise,
                        status: ftthRecharges.status,
                        periodEnd: ftthRecharges.periodEnd,
                        fulfilledAt: ftthRecharges.fulfilledAt,
                        createdAt: ftthRecharges.createdAt,
                        ispConnectionId: ftthConnections.ispConnectionId,
                    })
                        .from(ftthRecharges)
                        .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
                        .where(and(eq(ftthConnections.operatorId, id), ne(ftthRecharges.status, 'created')))
                        .orderBy(desc(ftthRecharges.createdAt))
                        .limit(200),

                    db.select().from(ftthOperatorLedger)
                        .where(eq(ftthOperatorLedger.operatorId, id))
                        .orderBy(desc(ftthOperatorLedger.id))
                        .limit(200),
                ]);

                const successful = recharges.filter(r => r.status === 'success');

                res.json({
                    success: true,
                    data: {
                        plans: plans.map(planView),
                        connections,
                        leads: leads.map(l => ({
                            ...l, leadFee: l.leadFeePaise === null ? null : paiseToRupees(l.leadFeePaise),
                        })),
                        recharges: recharges.map(r => ({
                            ...r,
                            customerPaid: paiseToRupees(r.totalPaise),
                            operatorShare: paiseToRupees(r.operatorPayablePaise),
                            unitefixShare: paiseToRupees(r.platformRevenuePaise),
                        })),
                        ledger: ledger.map(e => ({ ...e, amount: paiseToRupees(e.amountPaise) })),
                        // What UniteFix has actually earned here, which is the
                        // number a super_admin is really looking for.
                        summary: {
                            balance: paiseToRupees(await FtthService.operatorBalancePaise(id)),
                            activePlans: plans.filter(p => p.isActive).length,
                            connections: connections.length,
                            activeConnections: connections.filter(cn => cn.status === 'active').length,
                            openLeads: leads.filter(l => l.status === 'new' || l.status === 'contacted').length,
                            convertedLeads: leads.filter(l => l.status === 'converted').length,
                            successfulRecharges: successful.length,
                            grossCollected: paiseToRupees(successful.reduce((s, r) => s + r.totalPaise, 0)),
                            unitefixRevenue: paiseToRupees(
                                successful.reduce((s, r) => s + r.platformRevenuePaise, 0)
                                + leads.filter(l => l.status === 'converted')
                                    .reduce((s, l) => s + (l.leadFeePaise ?? 0), 0),
                            ),
                            awaitingFulfilment: successful.filter(r => !r.fulfilledAt).length,
                        },
                    },
                });
            } catch (error) { next(error); }
        });

    /** GET /api/admin/ftth/ledger — every operator's balance, for UniteFix. */
    app.get("/api/admin/ftth/ledger", authenticateAdmin, async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await db.select({
                operatorId: ftthOperators.id,
                companyName: ftthOperators.companyName,
                status: ftthOperators.status,
                balancePaise: sql<number>`COALESCE((
                    SELECT balance_after_paise FROM ${ftthOperatorLedger} l
                    WHERE l.operator_id = ${ftthOperators.id}
                    ORDER BY l.id DESC LIMIT 1
                ), 0)::int`,
            }).from(ftthOperators).orderBy(asc(ftthOperators.companyName));

            res.json({
                success: true,
                data: rows.map(r => ({ ...r, balance: paiseToRupees(r.balancePaise) })),
            });
        } catch (error) { next(error); }
    });

    // ==================== CUSTOMER (MOBILE) ====================

    /**
     * GET /api/ftth/operators
     *
     * Only operators covering the CALLER'S pincode. With one operator you can
     * list everyone; at fifteen across the district, offering a customer in
     * Yellapur an ISP that only wires Karwar is worse than showing nothing.
     */
    app.get("/api/ftth/operators", authenticateToken as any, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.userId;
            const [user] = await db.select({ pinCode: users.pinCode }).from(users)
                .where(eq(users.id, userId)).limit(1);

            const pincode = (typeof req.query.pincode === 'string' && /^\d{6}$/.test(req.query.pincode))
                ? req.query.pincode
                : user?.pinCode ?? null;

            if (!pincode) {
                return res.json({ success: true, data: [], meta: { reason: 'NO_PINCODE' } });
            }

            const rows = await db.select({
                id: ftthOperators.id,
                companyName: ftthOperators.companyName,
                logoUrl: ftthOperators.logoUrl,
                brandColor: ftthOperators.brandColor,
                contactPhone: ftthOperators.contactPhone,
            })
                .from(ftthOperators)
                .innerJoin(ftthOperatorPincodes, eq(ftthOperatorPincodes.operatorId, ftthOperators.id))
                .where(and(
                    eq(ftthOperators.status, 'active'),
                    eq(ftthOperatorPincodes.pincode, pincode),
                    eq(ftthOperatorPincodes.isActive, true),
                ))
                .orderBy(asc(ftthOperators.companyName));

            res.json({ success: true, data: rows, meta: { pincode } });
        } catch (error) { next(error); }
    });

    /**
     * GET /api/ftth/operators/:id/plans
     *
     * Returned GROUPED BY SPEED, because that is how the app has to render it:
     * pick a speed, then pick from the durations that speed is actually sold at.
     * The matrix is sparse by design (§3.3) — a client that assumes every
     * duration exists at every speed will offer combinations nobody can buy.
     */
    app.get("/api/ftth/operators/:id/plans", authenticateToken as any, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const operatorId = Number(req.params.id);
            if (!Number.isInteger(operatorId)) {
                return res.status(400).json({ success: false, message: 'Invalid operator id' });
            }

            const [operator] = await db.select({ id: ftthOperators.id, status: ftthOperators.status })
                .from(ftthOperators).where(eq(ftthOperators.id, operatorId)).limit(1);
            if (!operator || operator.status !== 'active') {
                return res.status(404).json({ success: false, message: 'Operator not available' });
            }

            const rows = await db.select().from(ftthPlans)
                .where(and(eq(ftthPlans.operatorId, operatorId), eq(ftthPlans.isActive, true)))
                .orderBy(asc(ftthPlans.speedMbps), asc(ftthPlans.durationMonths));

            const convenienceFeePaise = await convenienceFeeFor(operatorId);

            const bySpeed = new Map<number, any[]>();
            for (const p of rows) {
                const list = bySpeed.get(p.speedMbps) ?? [];
                list.push({
                    ...planView(p),
                    convenienceFee: paiseToRupees(convenienceFeePaise),
                    payable: paiseToRupees(p.listPricePaise - p.discountPaise + convenienceFeePaise),
                });
                bySpeed.set(p.speedMbps, list);
            }

            res.json({
                success: true,
                data: {
                    speeds: Array.from(bySpeed.entries())
                        .sort((a, b) => a[0] - b[0])
                        .map(([speedMbps, plans]) => ({ speedMbps, plans })),
                },
            });
        } catch (error) { next(error); }
    });

    /** GET /api/ftth/connections — the caller's connections. Plural by design. */
    app.get("/api/ftth/connections", authenticateToken as any, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.userId;

            const rows = await db.select({
                id: ftthConnections.id,
                operatorId: ftthConnections.operatorId,
                operatorName: ftthOperators.companyName,
                logoUrl: ftthOperators.logoUrl,
                brandColor: ftthOperators.brandColor,
                ispConnectionId: ftthConnections.ispConnectionId,
                status: ftthConnections.status,
                validTill: ftthConnections.validTill,
                planName: ftthPlans.name,
                speedMbps: ftthPlans.speedMbps,
            })
                .from(ftthConnections)
                .innerJoin(ftthOperators, eq(ftthOperators.id, ftthConnections.operatorId))
                .leftJoin(ftthPlans, eq(ftthPlans.id, ftthConnections.currentPlanId))
                .where(eq(ftthConnections.userId, userId))
                .orderBy(desc(ftthConnections.createdAt));

            const pendingIdRequests = await db.select({
                id: ftthIdRequests.id,
                operatorId: ftthIdRequests.operatorId,
                operatorName: ftthOperators.companyName,
                status: ftthIdRequests.status,
                rejectionReason: ftthIdRequests.rejectionReason,
                createdAt: ftthIdRequests.createdAt,
            })
                .from(ftthIdRequests)
                .innerJoin(ftthOperators, eq(ftthOperators.id, ftthIdRequests.operatorId))
                .where(and(eq(ftthIdRequests.userId, userId), eq(ftthIdRequests.status, 'pending')));

            const pendingLeads = await db.select({
                id: ftthLeads.id,
                operatorId: ftthLeads.operatorId,
                operatorName: ftthOperators.companyName,
                status: ftthLeads.status,
                createdAt: ftthLeads.createdAt,
            })
                .from(ftthLeads)
                .innerJoin(ftthOperators, eq(ftthOperators.id, ftthLeads.operatorId))
                .where(and(eq(ftthLeads.userId, userId), ne(ftthLeads.status, 'converted')));

            const now = Date.now();
            res.json({
                success: true,
                data: {
                    connections: rows.map(r => ({
                        ...r,
                        daysRemaining: r.validTill
                            ? Math.ceil((r.validTill.getTime() - now) / 86_400_000)
                            : null,
                        isExpired: r.validTill ? r.validTill.getTime() < now : false,
                    })),
                    pendingIdRequests,
                    pendingLeads,
                },
            });
        } catch (error) { next(error); }
    });

    /** POST /api/ftth/leads — "I want a new connection". */
    app.post("/api/ftth/leads", mobileLimiter, authenticateToken as any, validateBody(leadSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const userId = (req as any).user.userId;
                const body = req.body as z.infer<typeof leadSchema>;

                const operator = await activeOperator(body.operatorId);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not available' });

                // One open lead per operator, so a customer tapping twice does not
                // create two rows the operator has to reconcile by phone.
                const [open] = await db.select({ id: ftthLeads.id }).from(ftthLeads)
                    .where(and(
                        eq(ftthLeads.userId, userId),
                        eq(ftthLeads.operatorId, body.operatorId),
                        inArray(ftthLeads.status, ['new', 'contacted']),
                    )).limit(1);
                if (open) {
                    return res.status(409).json({
                        success: false,
                        message: `${operator.companyName} already has your request and will call you.`,
                    });
                }

                const [lead] = await db.insert(ftthLeads).values({
                    userId,
                    operatorId: body.operatorId,
                    name: body.name,
                    phone: body.phone,
                    address: body.address,
                    pincode: body.pincode,
                    notes: body.notes ?? null,
                    status: 'new',
                }).returning();

                logger.info('[FTTH] New connection lead', { leadId: lead.id, operatorId: body.operatorId });

                res.status(201).json({
                    success: true,
                    message: `${operator.companyName} will contact you shortly.`,
                    data: { leadId: lead.id },
                });
            } catch (error) { next(error); }
        });

    /** POST /api/ftth/id-requests — "I'm already their customer". */
    app.post("/api/ftth/id-requests", mobileLimiter, authenticateToken as any, validateBody(idRequestSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const userId = (req as any).user.userId;
                const body = req.body as z.infer<typeof idRequestSchema>;

                const operator = await activeOperator(body.operatorId);
                if (!operator) return res.status(404).json({ success: false, message: 'Operator not available' });

                const [existing] = await db.select({ id: ftthConnections.id, ispConnectionId: ftthConnections.ispConnectionId })
                    .from(ftthConnections)
                    .where(and(eq(ftthConnections.userId, userId), eq(ftthConnections.operatorId, body.operatorId)))
                    .limit(1);
                if (existing?.ispConnectionId) {
                    return res.status(409).json({
                        success: false,
                        message: 'Your account with this operator is already linked.',
                    });
                }

                const [pending] = await db.select({ id: ftthIdRequests.id }).from(ftthIdRequests)
                    .where(and(
                        eq(ftthIdRequests.userId, userId),
                        eq(ftthIdRequests.operatorId, body.operatorId),
                        eq(ftthIdRequests.status, 'pending'),
                    )).limit(1);
                if (pending) {
                    return res.status(409).json({ success: false, message: 'Your request is already under review.' });
                }

                const [row] = await db.insert(ftthIdRequests).values({
                    userId,
                    operatorId: body.operatorId,
                    claimedName: body.claimedName,
                    claimedPhone: body.claimedPhone,
                    claimedAddress: body.claimedAddress ?? null,
                    claimedIspId: body.claimedIspId ?? null,
                    status: 'pending',
                }).returning();

                res.status(201).json({
                    success: true,
                    message: `${operator.companyName} will verify your details and link your account.`,
                    data: { requestId: row.id },
                });
            } catch (error) { next(error); }
        });

    /**
     * POST /api/ftth/recharges/initiate
     *
     * Guards, in order: the connection is the caller's and usable; the plan
     * belongs to the connection's operator; no order is already open; and the
     * early-renewal window is respected — without that last one a customer can
     * stack twelve recharges in a row.
     */
    app.post("/api/ftth/recharges/initiate", mobileLimiter, authenticateToken as any, validateBody(initiateSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const userId = (req as any).user.userId;
                const { connectionId, planId } = req.body as z.infer<typeof initiateSchema>;

                const [connection] = await db.select().from(ftthConnections)
                    .where(and(eq(ftthConnections.id, connectionId), eq(ftthConnections.userId, userId)))
                    .limit(1);
                if (!connection) return res.status(404).json({ success: false, message: 'Connection not found' });

                if (!connection.ispConnectionId) {
                    return res.status(409).json({
                        success: false,
                        code: 'AWAITING_ISP_ID',
                        message: 'Your operator has not linked your account yet. You can recharge once they do.',
                    });
                }
                if (connection.status === 'closed') {
                    return res.status(409).json({ success: false, message: 'This connection is closed.' });
                }

                const operator = await activeOperator(connection.operatorId);
                if (!operator) {
                    return res.status(409).json({ success: false, message: 'This operator is not accepting recharges right now.' });
                }

                // The plan must belong to THIS connection's operator. Without this
                // a customer could pay operator A's cheap price against operator
                // B's connection.
                const [plan] = await db.select().from(ftthPlans)
                    .where(and(
                        eq(ftthPlans.id, planId),
                        eq(ftthPlans.operatorId, connection.operatorId),
                        eq(ftthPlans.isActive, true),
                    )).limit(1);
                if (!plan) return res.status(404).json({ success: false, message: 'Plan not available' });

                const [open] = await db.select({ id: ftthRecharges.id }).from(ftthRecharges)
                    .where(and(
                        eq(ftthRecharges.connectionId, connectionId),
                        inArray(ftthRecharges.status, ['created', 'pending']),
                    ))
                    .orderBy(desc(ftthRecharges.id))
                    .limit(1);
                if (open) {
                    return res.status(409).json({
                        success: false,
                        code: 'RECHARGE_IN_PROGRESS',
                        message: 'A recharge is already in progress. Please wait a moment and try again.',
                    });
                }

                const windowDays = parseInt(
                    (await configService.get<string>('FTTH_CONFIG.EARLY_RENEWAL_WINDOW_DAYS')) || '15', 10,
                );
                if (connection.validTill) {
                    const daysLeft = Math.ceil((connection.validTill.getTime() - Date.now()) / 86_400_000);
                    if (daysLeft > windowDays) {
                        return res.status(409).json({
                            success: false,
                            code: 'TOO_EARLY',
                            message: `You still have ${daysLeft} days left. You can renew within ${windowDays} days of expiry.`,
                        });
                    }
                }

                const [user] = await db.select({
                    username: users.username, email: users.email, phone: users.phone,
                }).from(users).where(eq(users.id, userId)).limit(1);

                const order = await FtthService.initiateRecharge({
                    connection, plan,
                    customer: { name: user?.username, email: user?.email, phone: user?.phone },
                });

                res.json({
                    success: true,
                    data: {
                        rechargeId: order.rechargeId,
                        razorpayOrderId: order.razorpayOrderId,
                        razorpayKeyId: order.razorpayKeyId,
                        amount: paiseToRupees(order.amountPaise),
                        breakdown: {
                            planPrice: paiseToRupees(order.quote.listPricePaise),
                            discount: paiseToRupees(order.quote.discountPaise),
                            convenienceFee: paiseToRupees(order.quote.convenienceFeePaise),
                            total: paiseToRupees(order.quote.totalPaise),
                        },
                        customer: order.customer,
                    },
                });
            } catch (error: any) {
                if (/Razorpay credentials/i.test(error?.message ?? '')) {
                    return res.status(503).json({ success: false, message: 'Payments are unavailable right now.' });
                }
                next(error);
            }
        });

    /**
     * POST /api/ftth/recharges/verify
     *
     * The mobile SDK's optimistic callback. It is NOT the settlement path —
     * kill the app after paying and this never fires. The Razorpay webhook is,
     * and both land on the same idempotent FtthService.applyCapture.
     */
    app.post("/api/ftth/recharges/verify", authenticateToken as any, validateBody(verifySchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const userId = (req as any).user.userId;
                const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
                    req.body as z.infer<typeof verifySchema>;

                const secret = process.env.RAZORPAY_KEY_SECRET;
                if (!secret) {
                    return res.status(500).json({ success: false, message: 'Payment verification not configured' });
                }

                const expected = crypto.createHmac('sha256', secret)
                    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                    .digest('hex');

                // Constant-time compare — a plain === leaks how much of the
                // signature matched.
                const a = Buffer.from(expected, 'utf8');
                const b = Buffer.from(razorpay_signature, 'utf8');
                if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
                    logger.warn('[FTTH] Recharge signature mismatch', { razorpay_order_id });
                    return res.status(400).json({ success: false, message: 'Invalid payment signature' });
                }

                const [recharge] = await db.select({
                    id: ftthRecharges.id, userId: ftthConnections.userId,
                })
                    .from(ftthRecharges)
                    .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
                    .where(eq(ftthRecharges.razorpayOrderId, razorpay_order_id))
                    .limit(1);

                if (!recharge) return res.status(404).json({ success: false, message: 'Recharge not found' });
                if (recharge.userId !== userId) {
                    return res.status(403).json({ success: false, message: 'This recharge is not yours' });
                }

                await PaymentTrackingServiceRecord(recharge.id, razorpay_order_id, razorpay_payment_id, razorpay_signature);

                const result = await FtthService.applyCapture({
                    razorpayOrderId: razorpay_order_id,
                    razorpayPaymentId: razorpay_payment_id,
                    rechargeId: recharge.id,
                });

                const [updated] = await db.select({
                    periodEnd: ftthRecharges.periodEnd, status: ftthRecharges.status,
                }).from(ftthRecharges).where(eq(ftthRecharges.id, recharge.id)).limit(1);

                res.json({
                    success: true,
                    message: result.applied ? 'Recharge successful' : 'Payment already recorded',
                    data: { rechargeId: recharge.id, validTill: updated?.periodEnd, status: updated?.status },
                });
            } catch (error) { next(error); }
        });

    /** GET /api/ftth/recharges — the caller's own history. */
    app.get("/api/ftth/recharges", authenticateToken as any, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.userId;
            const rows = await db.select({
                id: ftthRecharges.id,
                planName: ftthRecharges.planName,
                speedMbps: ftthRecharges.speedMbps,
                durationMonths: ftthRecharges.durationMonths,
                totalPaise: ftthRecharges.totalPaise,
                convenienceFeePaise: ftthRecharges.convenienceFeePaise,
                status: ftthRecharges.status,
                periodStart: ftthRecharges.periodStart,
                periodEnd: ftthRecharges.periodEnd,
                createdAt: ftthRecharges.createdAt,
                operatorName: ftthOperators.companyName,
            })
                .from(ftthRecharges)
                .innerJoin(ftthConnections, eq(ftthConnections.id, ftthRecharges.connectionId))
                .innerJoin(ftthOperators, eq(ftthOperators.id, ftthConnections.operatorId))
                .where(and(
                    eq(ftthConnections.userId, userId),
                    ne(ftthRecharges.status, 'created'),
                ))
                .orderBy(desc(ftthRecharges.createdAt))
                .limit(100);

            res.json({
                success: true,
                data: rows.map(r => ({
                    ...r,
                    amount: paiseToRupees(r.totalPaise),
                    convenienceFee: paiseToRupees(r.convenienceFeePaise),
                })),
            });
        } catch (error) { next(error); }
    });
}

// ==================== helpers ====================

/** Paise columns are internal; the UI never sees them. */
function planView(p: typeof ftthPlans.$inferSelect) {
    return {
        id: p.id,
        name: p.name,
        speedMbps: p.speedMbps,
        durationMonths: p.durationMonths,
        price: paiseToRupees(p.listPricePaise),
        discount: paiseToRupees(p.discountPaise),
        finalPrice: paiseToRupees(p.listPricePaise - p.discountPaise),
        dataLimitGb: p.dataLimitGb,
        benefits: (p.benefits as string[] | null) ?? [],
        sortOrder: p.sortOrder,
        isActive: p.isActive,
    };
}

async function findActivePlanClash(
    operatorId: number, speedMbps: number, durationMonths: number, excludeId: number | null,
) {
    const conditions = [
        eq(ftthPlans.operatorId, operatorId),
        eq(ftthPlans.speedMbps, speedMbps),
        eq(ftthPlans.durationMonths, durationMonths),
        eq(ftthPlans.isActive, true),
    ];
    if (excludeId !== null) conditions.push(ne(ftthPlans.id, excludeId));
    const [row] = await db.select({ id: ftthPlans.id }).from(ftthPlans).where(and(...conditions)).limit(1);
    return row ?? null;
}

async function activeOperator(operatorId: number) {
    const [row] = await db
        .select({ id: ftthOperators.id, companyName: ftthOperators.companyName, status: ftthOperators.status })
        .from(ftthOperators)
        .where(eq(ftthOperators.id, operatorId))
        .limit(1);
    return row && row.status === 'active' ? row : null;
}

async function convenienceFeeFor(operatorId: number): Promise<number> {
    const [op] = await db.select({ fee: ftthOperators.convenienceFeePaise })
        .from(ftthOperators).where(eq(ftthOperators.id, operatorId)).limit(1);
    if (op?.fee !== null && op?.fee !== undefined) return op.fee;
    return parseInt(
        (await configService.get<string>('FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE')) || '1000', 10,
    );
}

async function PaymentTrackingServiceRecord(
    rechargeId: number, orderId: string, paymentId: string, signature: string,
) {
    const { PaymentTrackingService } = await import("../services/payment-tracking.service");
    await PaymentTrackingService.recordPaymentEvent({
        ftthRechargeId: rechargeId,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        amount: 0, // authoritative amount arrives on the webhook
        eventType: 'payment_captured',
        status: 'captured',
        metadata: { verifiedVia: 'mobile_sdk', razorpay_signature: signature },
    });
}
