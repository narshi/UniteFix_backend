/**
 * Business partners — admin management and the partner's own /api/b2b surface.
 *
 * "business partner" = a company that does commerce with UniteFix (ISP, CCTV
 * installer, computer shop, consultant). NOT a technician — that is "partner"
 * elsewhere, and /api/business/partners (already taken) returns technicians.
 * Everything partner-facing here lives under /api/b2b.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { and, eq, desc, ilike, or } from 'drizzle-orm';
import {
    businessPartners, partnerVerticals, users, ftthOperators,
} from '@shared/schema';
import { authenticateAdmin, requireSuperAdmin, authenticateBusinessPartner } from '../middleware/auth.middleware';
import { BusinessPartnerService } from '../services/business-partner.service';
import { recordAudit } from '../lib/audit';
import { validateBody } from '../middleware/validate';
import logger from '../lib/logger';

const phone = z.string().trim().regex(/^\+?\d{10,13}$/, 'Enter a valid phone number');

const createSchema = z.object({
    legalName: z.string().trim().min(2).max(160),
    displayName: z.string().trim().min(2).max(120).optional(),
    gstin: z.string().trim().regex(/^[0-9A-Z]{15}$/i, 'GSTIN is 15 characters').optional().nullable(),
    pan: z.string().trim().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, 'PAN is 10 characters').optional().nullable(),
    contactName: z.string().trim().max(120).optional().nullable(),
    contactPhone: phone,
    contactEmail: z.string().trim().email().optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    pincode: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    district: z.string().trim().max(80).optional().nullable(),
    verticalCodes: z.array(z.string().trim().min(2).max(40)).min(1).max(10),
    creditLimitRupees: z.number().min(0).max(10_000_000).optional(),
    paymentTermsDays: z.number().int().min(0).max(180).optional(),
    notes: z.string().trim().max(1000).optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
    // Payout account. Admin-only by design — see business_partners schema note.
    beneficiaryName: z.string().trim().max(120).optional().nullable(),
    bankAccountNumber: z.string().trim().regex(/^\d{9,18}$/).optional().nullable(),
    bankIfsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i).optional().nullable(),
    upiId: z.string().trim().regex(/^[\w.\-]{2,}@[a-zA-Z]{2,}$/).optional().nullable(),
});

const approveSchema = z.object({
    verticalCodes: z.array(z.string().trim()).min(1).max(10).optional(),
    creditLimitRupees: z.number().min(0).max(10_000_000).optional(),
    paymentTermsDays: z.number().int().min(0).max(180).optional(),
});

const statusSchema = z.object({
    status: z.enum(['active', 'paused', 'disabled']),
    reason: z.string().trim().max(500).optional(),
});

const ledgerEntrySchema = z.object({
    entryType: z.enum(['payment_received', 'adjustment', 'settlement_paid', 'settlement_received', 'credit_note']),
    amountRupees: z.number().positive().max(10_000_000),
    description: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(120).optional(),
});

const verticalSchema = z.object({
    code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscores'),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional().nullable(),
    sortOrder: z.number().int().min(0).max(999).optional(),
});

const rupeesToPaise = (r: number) => Math.round(r * 100);
const paiseToRupees = (p: number) => Math.round(p) / 100;

/** The shape every admin screen and the partner's own /me get. */
async function view(bp: typeof businessPartners.$inferSelect) {
    const verticals = await BusinessPartnerService.verticalCodesOf(bp.id);
    const credit = await BusinessPartnerService.creditPosition(bp.id);
    const [op] = await db.select({ id: ftthOperators.id, companyName: ftthOperators.companyName })
        .from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bp.id)).limit(1);
    return {
        id: bp.id,
        partnerCode: bp.partnerCode,
        legalName: bp.legalName,
        displayName: bp.displayName,
        gstin: bp.gstin,
        pan: bp.pan,
        contactName: bp.contactName,
        contactPhone: bp.contactPhone,
        contactEmail: bp.contactEmail,
        address: bp.address,
        pincode: bp.pincode,
        district: bp.district,
        status: bp.status,
        verticals,
        hasPortalLogin: !!bp.adminUserId,
        hasMobileLogin: !!bp.userId,
        ftthOperatorId: op?.id ?? null,
        credit: {
            limit: paiseToRupees(credit.limitPaise),
            outstanding: paiseToRupees(credit.outstandingPaise),
            available: paiseToRupees(credit.availablePaise),
            paymentTermsDays: bp.paymentTermsDays,
        },
        payout: {
            beneficiaryName: bp.beneficiaryName,
            bankLast4: bp.bankAccountNumber ? bp.bankAccountNumber.slice(-4) : null,
            bankIfsc: bp.bankIfsc,
            upiId: bp.upiId,
            automationReady: !!bp.cashfreeBeneId,
        },
        approvedAt: bp.approvedAt,
        rejectionReason: bp.rejectionReason,
        notes: bp.notes,
        createdAt: bp.createdAt,
    };
}

export function registerBusinessPartnerRoutes(app: Express) {

    // ═══════════════════════════════════════════════════════════════════════
    // Admin — /api/admin/business-partners  (capability area: partners)
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/business-partners', authenticateAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const status = typeof req.query.status === 'string' ? req.query.status : undefined;
            const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const where = [] as any[];
            if (status && status !== 'all') where.push(eq(businessPartners.status, status as any));
            if (q) {
                const term = `%${q}%`;
                where.push(or(
                    ilike(businessPartners.displayName, term),
                    ilike(businessPartners.legalName, term),
                    ilike(businessPartners.partnerCode, term),
                    ilike(businessPartners.contactPhone, term),
                    ilike(businessPartners.gstin, term),
                ));
            }
            const rows = await db.select().from(businessPartners)
                .where(where.length ? and(...where) : undefined)
                .orderBy(desc(businessPartners.createdAt)).limit(300);
            res.json({ success: true, data: await Promise.all(rows.map(view)) });
        } catch (error) { next(error); }
    });

    app.get('/api/admin/business-partners/verticals', authenticateAdmin, async (_req, res, next) => {
        try {
            const rows = await db.select().from(partnerVerticals)
                .orderBy(partnerVerticals.sortOrder, partnerVerticals.name);
            res.json({ success: true, data: rows });
        } catch (error) { next(error); }
    });

    /** Add a vertical. Admins extend this the way they add trades — no deploy. */
    app.post('/api/admin/business-partners/verticals', authenticateAdmin, requireSuperAdmin, validateBody(verticalSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const body = req.body as z.infer<typeof verticalSchema>;
                const [row] = await db.insert(partnerVerticals).values({
                    code: body.code, name: body.name, description: body.description ?? null, sortOrder: body.sortOrder ?? 50,
                }).onConflictDoNothing().returning();
                if (!row) return res.status(409).json({ success: false, message: `Vertical "${body.code}" already exists.` });
                res.status(201).json({ success: true, data: row });
            } catch (error) { next(error); }
        });

    app.get('/api/admin/business-partners/:id', authenticateAdmin, async (req, res, next) => {
        try {
            const bp = await BusinessPartnerService.byId(Number(req.params.id));
            if (!bp) return res.status(404).json({ success: false, message: 'Business partner not found' });
            res.json({ success: true, data: await view(bp) });
        } catch (error) { next(error); }
    });

    /** Admin-created partners are approved on creation — the admin IS the approval. */
    app.post('/api/admin/business-partners', authenticateAdmin, requireSuperAdmin, validateBody(createSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const admin = (req as any).admin as { userId: number };
                const body = req.body as z.infer<typeof createSchema>;
                const bp = await BusinessPartnerService.create({
                    ...body,
                    creditLimitPaise: body.creditLimitRupees !== undefined ? rupeesToPaise(body.creditLimitRupees) : 0,
                    approvedByAdminId: admin.userId,
                });
                await recordAudit({
                    entityType: 'business_partner', entityId: bp.id, action: 'business_partner_created',
                    changedBy: admin.userId, metadata: { partnerCode: bp.partnerCode, verticals: body.verticalCodes },
                });
                res.status(201).json({ success: true, message: `${bp.partnerCode} created and active.`, data: await view(bp) });
            } catch (error: any) {
                if (/Unknown vertical/.test(error?.message)) {
                    return res.status(400).json({ success: false, message: error.message });
                }
                next(error);
            }
        });

    app.patch('/api/admin/business-partners/:id', authenticateAdmin, requireSuperAdmin, validateBody(updateSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const bp = await BusinessPartnerService.byId(id);
                if (!bp) return res.status(404).json({ success: false, message: 'Business partner not found' });
                const body = req.body as z.infer<typeof updateSchema>;

                const payoutChanged = ['beneficiaryName', 'bankAccountNumber', 'bankIfsc', 'upiId']
                    .some(k => (body as any)[k] !== undefined);

                const [updated] = await db.update(businessPartners).set({
                    ...(body.legalName !== undefined ? { legalName: body.legalName } : {}),
                    ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
                    ...(body.gstin !== undefined ? { gstin: body.gstin?.toUpperCase() ?? null } : {}),
                    ...(body.pan !== undefined ? { pan: body.pan?.toUpperCase() ?? null } : {}),
                    ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
                    ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone } : {}),
                    ...(body.contactEmail !== undefined ? { contactEmail: body.contactEmail?.toLowerCase() ?? null } : {}),
                    ...(body.address !== undefined ? { address: body.address } : {}),
                    ...(body.pincode !== undefined ? { pincode: body.pincode } : {}),
                    ...(body.district !== undefined ? { district: body.district } : {}),
                    ...(body.creditLimitRupees !== undefined ? { creditLimitPaise: rupeesToPaise(body.creditLimitRupees) } : {}),
                    ...(body.paymentTermsDays !== undefined ? { paymentTermsDays: body.paymentTermsDays } : {}),
                    ...(body.notes !== undefined ? { notes: body.notes } : {}),
                    ...(body.beneficiaryName !== undefined ? { beneficiaryName: body.beneficiaryName } : {}),
                    ...(body.bankAccountNumber !== undefined ? { bankAccountNumber: body.bankAccountNumber } : {}),
                    ...(body.bankIfsc !== undefined ? { bankIfsc: body.bankIfsc?.toUpperCase() ?? null } : {}),
                    ...(body.upiId !== undefined ? { upiId: body.upiId?.toLowerCase() ?? null } : {}),
                    // Changed payout details invalidate the registered beneficiary;
                    // the next payout re-syncs against the new account.
                    ...(payoutChanged ? { cashfreeBeneId: null } : {}),
                    updatedAt: new Date(),
                }).where(eq(businessPartners.id, id)).returning();

                if (body.verticalCodes) await BusinessPartnerService.setVerticals(id, body.verticalCodes);

                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: 'business_partner_updated',
                    changedBy: admin.userId,
                    metadata: { fields: Object.keys(body), payoutChanged },
                });
                res.json({ success: true, data: await view(updated) });
            } catch (error: any) {
                if (/Unknown vertical/.test(error?.message)) {
                    return res.status(400).json({ success: false, message: error.message });
                }
                next(error);
            }
        });

    app.post('/api/admin/business-partners/:id/approve', authenticateAdmin, requireSuperAdmin, validateBody(approveSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const body = req.body as z.infer<typeof approveSchema>;
                const updated = await BusinessPartnerService.approve(id, admin.userId, {
                    verticalCodes: body.verticalCodes,
                    creditLimitPaise: body.creditLimitRupees !== undefined ? rupeesToPaise(body.creditLimitRupees) : undefined,
                    paymentTermsDays: body.paymentTermsDays,
                });
                if (!updated) return res.status(404).json({ success: false, message: 'Business partner not found' });
                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: 'business_partner_approved',
                    changedBy: admin.userId, metadata: body,
                });
                res.json({ success: true, message: `${updated.partnerCode} is now active.`, data: await view(updated) });
            } catch (error: any) {
                if (/Cannot approve yet|Unknown vertical/.test(error?.message)) {
                    return res.status(400).json({ success: false, message: error.message });
                }
                next(error);
            }
        });

    app.post('/api/admin/business-partners/:id/reject', authenticateAdmin, requireSuperAdmin,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const reason = String(req.body?.reason ?? '').trim();
                if (reason.length < 3) return res.status(400).json({ success: false, message: 'Give a reason the applicant will read.' });
                const updated = await BusinessPartnerService.reject(id, admin.userId, reason);
                if (!updated) return res.status(404).json({ success: false, message: 'No pending application with that id' });
                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: 'business_partner_rejected',
                    changedBy: admin.userId, metadata: { reason },
                });
                res.json({ success: true, data: await view(updated) });
            } catch (error) { next(error); }
        });

    app.patch('/api/admin/business-partners/:id/status', authenticateAdmin, requireSuperAdmin, validateBody(statusSchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const { status, reason } = req.body as z.infer<typeof statusSchema>;
                const updated = await BusinessPartnerService.setStatus(id, status, reason);
                if (!updated) return res.status(404).json({ success: false, message: 'Business partner not found' });
                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: 'business_partner_status',
                    changedBy: admin.userId, toState: status, metadata: { reason },
                });
                res.json({ success: true, data: await view(updated) });
            } catch (error) { next(error); }
        });

    /**
     * Give the partner a mobile login: a users row with role business_partner on
     * their contact phone. The Truecaller flow mints tokens from users.role, so
     * once this exists they sign into the app like anyone else.
     *
     * A phone that is already a CUSTOMER account is refused unless ?convert=true —
     * users.phone is unique, so linking means changing that account's role, which
     * ends its customer access. Said plainly rather than done quietly.
     */
    app.post('/api/admin/business-partners/:id/mobile-login', authenticateAdmin, requireSuperAdmin,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const bp = await BusinessPartnerService.byId(id);
                if (!bp) return res.status(404).json({ success: false, message: 'Business partner not found' });
                if (bp.userId) return res.status(409).json({ success: false, message: 'This partner already has a mobile login.' });

                const digits = bp.contactPhone.replace(/\D/g, '');
                const normalised = digits.length === 10 ? `+91${digits}` : `+${digits.replace(/^0+/, '')}`;
                const convert = String(req.query.convert) === 'true';

                const [existing] = await db.select().from(users).where(eq(users.phone, normalised)).limit(1);
                let userId: number;

                if (existing) {
                    if (existing.role !== 'business_partner' && !convert) {
                        return res.status(409).json({
                            success: false,
                            code: 'PHONE_IN_USE',
                            message: `${normalised} is already a ${existing.role} account. Use a different number, or pass ?convert=true to turn that account into a business partner login (it loses ${existing.role} access).`,
                        });
                    }
                    const [linkedBp] = await db.select({ id: businessPartners.id }).from(businessPartners)
                        .where(eq(businessPartners.userId, existing.id)).limit(1);
                    if (linkedBp && linkedBp.id !== id) {
                        return res.status(409).json({ success: false, message: 'That phone is already the login for another business partner.' });
                    }
                    await db.update(users).set({ role: 'business_partner' as any, isActive: true, updatedAt: new Date() } as any)
                        .where(eq(users.id, existing.id));
                    userId = existing.id;
                } else {
                    const [created] = await db.insert(users).values({
                        phone: normalised,
                        email: bp.contactEmail ?? null,
                        username: bp.displayName,
                        password: null as any,
                        role: 'business_partner' as any,
                        phoneVerified: true,
                        isVerified: true,
                        isActive: true,
                    } as any).returning();
                    userId = created.id;
                }

                const [updated] = await db.update(businessPartners).set({ userId, updatedAt: new Date() })
                    .where(eq(businessPartners.id, id)).returning();

                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: 'business_partner_mobile_login',
                    changedBy: admin.userId, metadata: { userId, converted: !!existing },
                });
                logger.info(`[BP] Mobile login ${existing ? 'linked' : 'created'} for ${bp.partnerCode} → user #${userId}`);
                res.json({
                    success: true,
                    message: `${bp.displayName} can now sign into the app with ${normalised}.`,
                    data: await view(updated),
                });
            } catch (error) { next(error); }
        });

    app.get('/api/admin/business-partners/:id/ledger', authenticateAdmin, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const bp = await BusinessPartnerService.byId(id);
            if (!bp) return res.status(404).json({ success: false, message: 'Business partner not found' });
            const st = await BusinessPartnerService.statement(id, {
                from: req.query.from ? new Date(String(req.query.from)) : undefined,
                to: req.query.to ? new Date(String(req.query.to)) : undefined,
            });
            res.json({
                success: true,
                data: {
                    ...st,
                    b2bBalance: paiseToRupees(st.b2bBalancePaise),
                    ftthBalance: paiseToRupees(st.ftthBalancePaise),
                    lines: st.lines.map(l => ({ ...l, amount: paiseToRupees(l.amountPaise) })),
                },
            });
        } catch (error) { next(error); }
    });

    /**
     * Record money that moved outside an order — a payment received against
     * credit, a settlement, a correction. Signed per the ledger convention:
     * payment_received / settlement_paid / credit_note reduce what they owe (−),
     * settlement_received increases it (+), adjustment takes the sign given.
     */
    app.post('/api/admin/business-partners/:id/ledger', authenticateAdmin, requireSuperAdmin, validateBody(ledgerEntrySchema),
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const id = Number(req.params.id);
                const admin = (req as any).admin as { userId: number };
                const bp = await BusinessPartnerService.byId(id);
                if (!bp) return res.status(404).json({ success: false, message: 'Business partner not found' });
                const body = req.body as z.infer<typeof ledgerEntrySchema>;

                const magnitude = rupeesToPaise(body.amountRupees);
                const sign = body.entryType === 'settlement_received' ? 1
                    : body.entryType === 'adjustment' ? (String(req.body?.direction) === 'owes_more' ? 1 : -1)
                    : -1;

                const entry = await BusinessPartnerService.recordLedgerEntry({
                    businessPartnerId: id,
                    entryType: body.entryType,
                    amountPaise: sign * magnitude,
                    description: body.description,
                    metadata: body.reference ? { reference: body.reference } : undefined,
                    createdByAdminId: admin.userId,
                });
                await recordAudit({
                    entityType: 'business_partner', entityId: id, action: `bp_ledger_${body.entryType}`,
                    changedBy: admin.userId, metadata: { amountRupees: body.amountRupees, reference: body.reference },
                });
                res.status(201).json({
                    success: true,
                    data: { ...entry, balanceAfter: paiseToRupees(entry?.balanceAfterPaise ?? 0) },
                });
            } catch (error) { next(error); }
        });

    // ═══════════════════════════════════════════════════════════════════════
    // Business partner's own surface — /api/b2b  (mobile + portal)
    // Catalogue and orders arrive in the B2B ordering phase; this is the party.
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/b2b/me', authenticateBusinessPartner, async (req, res, next) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const bp = await BusinessPartnerService.byId(ctx.id);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const v = await view(bp);
            // Cost-side and internal fields stay inside; the partner sees their own account.
            res.json({
                success: true,
                data: {
                    partnerCode: v.partnerCode, displayName: v.displayName, legalName: v.legalName,
                    gstin: v.gstin, contactName: v.contactName, contactPhone: v.contactPhone, contactEmail: v.contactEmail,
                    address: v.address, pincode: v.pincode, district: v.district,
                    status: v.status, verticals: v.verticals, credit: v.credit,
                    payout: { beneficiaryName: v.payout.beneficiaryName, bankLast4: v.payout.bankLast4, upiId: v.payout.upiId },
                },
            });
        } catch (error) { next(error); }
    });

    app.get('/api/b2b/ledger', authenticateBusinessPartner, async (req, res, next) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const st = await BusinessPartnerService.statement(ctx.id, {
                from: req.query.from ? new Date(String(req.query.from)) : undefined,
                to: req.query.to ? new Date(String(req.query.to)) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
            });
            res.json({
                success: true,
                data: {
                    convention: st.convention,
                    youOwe: paiseToRupees(Math.max(0, st.b2bBalancePaise)),
                    owedToYou: paiseToRupees(Math.max(0, -st.b2bBalancePaise) + Math.max(0, -st.ftthBalancePaise)),
                    b2bBalance: paiseToRupees(st.b2bBalancePaise),
                    ftthBalance: paiseToRupees(st.ftthBalancePaise),
                    lines: st.lines.map(l => ({
                        id: l.id, source: l.source, entryType: l.entryType,
                        amount: paiseToRupees(l.amountPaise), description: l.description,
                        b2bOrderId: l.b2bOrderId, createdAt: l.createdAt,
                    })),
                },
            });
        } catch (error) { next(error); }
    });

    app.get('/api/b2b/ledger/summary', authenticateBusinessPartner, async (req, res, next) => {
        try {
            const ctx = (req as any).businessPartner as { id: number };
            const credit = await BusinessPartnerService.creditPosition(ctx.id);
            res.json({
                success: true,
                data: {
                    creditLimit: paiseToRupees(credit.limitPaise),
                    outstanding: paiseToRupees(credit.outstandingPaise),
                    creditAvailable: paiseToRupees(credit.availablePaise),
                    prepaidOnly: credit.limitPaise === 0,
                },
            });
        } catch (error) { next(error); }
    });

}
