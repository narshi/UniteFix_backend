/**
 * Partner Hub — phase 1 routes.
 *
 *   Public      POST /api/hub/apply, GET /api/hub/verticals
 *   Partner     /api/hub/*        (authenticateHub; pending partners reach onboarding only)
 *   Staff       /api/admin/hub/*  (authenticateAdmin; 'partners' capability via the /api/admin guard)
 */

import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { partnerVerticals, partnerDocuments, partnerModules, businessPartners, adminUsers } from '@shared/schema';
import bcrypt from 'bcrypt';
import { HUB_ROLES, DOC_TYPES, VERTICAL_MODULES, PLAN_LIMITS, MODULE_LABEL, checkGstin } from '@shared/hub';
import { validateBody } from '../middleware/validate';
import { operatorApplyLimiter } from '../middleware/rate-limit';
import { authenticateAdmin, requireSuperAdmin } from '../middleware/auth.middleware';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { PartnerHubService, HubError } from '../services/partner-hub.service';
import { BusinessPartnerService } from '../services/business-partner.service';
import { uploadDocumentBuffer } from '../services/cloudinary.service';
import { recordAudit } from '../lib/audit';
import { hubSummary } from '../services/hub-summary';

const applySchema = z.object({
    businessName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(160).optional().nullable(),
    gstin: z.string().trim().max(15).optional().nullable(),
    pan: z.string().trim().max(10).optional().nullable(),
    contactName: z.string().trim().min(2).max(120),
    phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    email: z.string().trim().email().max(160),
    address: z.string().trim().max(300).optional().nullable(),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode is 6 digits').optional().nullable(),
    district: z.string().trim().max(80).optional().nullable(),
    verticals: z.array(z.string().trim().min(2).max(30)).min(1).max(6),
    coveragePincodes: z.array(z.string().trim()).max(300).optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
const bankSchema = z.object({
    beneficiaryName: z.string().trim().min(2).max(120),
    accountNumber: z.string().trim().min(6).max(24),
    ifsc: z.string().trim().length(11),
});
const profileSchema = z.object({
    displayName: z.string().trim().min(2).max(120).optional(),
    contactName: z.string().trim().min(2).max(120).optional(),
    address: z.string().trim().max(300).optional().nullable(),
    pincode: z.string().trim().regex(/^\d{6}$/).optional().nullable(),
    district: z.string().trim().max(80).optional().nullable(),
    gstin: z.string().trim().max(15).optional().nullable(),
});
const inviteSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().max(15).optional().nullable(),
    role: z.enum(HUB_ROLES as [string, ...string[]]),
});

const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Upload a PDF or an image (JPG, PNG).'));
    },
});

const ip = (req: Request) => (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || null;

export function registerPartnerHubRoutes(app: Express) {

    // ═══════════════════════════════════════════════════════════════════════
    // Public
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/verticals', async (_req, res, next) => {
        try {
            const rows = await db.select({ code: partnerVerticals.code, name: partnerVerticals.name, description: partnerVerticals.description })
                .from(partnerVerticals).where(eq(partnerVerticals.isActive, true)).orderBy(asc(partnerVerticals.sortOrder));
            res.json({ success: true, data: rows });
        } catch (e) { next(e); }
    });

    /** Self-serve application for any vertical. Creates the owner login (usable for onboarding only until approval). */
    app.post('/api/hub/apply', operatorApplyLimiter, validateBody(applySchema), async (req, res, next) => {
        try {
            const { bp } = await PartnerHubService.apply(req.body);
            await recordAudit({ entityType: 'business_partner', entityId: bp.id, action: 'hub_applied', toState: 'pending_approval', changedBy: null, metadata: { partnerCode: bp.partnerCode } });
            res.status(201).json({
                success: true,
                message: 'Application received. Sign in with your email and password to upload documents and accept the agreement — then UniteFix reviews it within 48 hours.',
                data: { partnerCode: bp.partnerCode, username: bp.contactEmail },
            });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Partner — onboarding (reachable while pending)
    // ═══════════════════════════════════════════════════════════════════════

    const pending = authenticateHub({ allowPending: true });
    const active = authenticateHub();

    app.get('/api/hub/me', pending, async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const bp = await BusinessPartnerService.byId(ctx.businessPartnerId);
            const onboarding = await PartnerHubService.onboarding(ctx.businessPartnerId);
            res.json({
                success: true,
                data: {
                    ...ctx,
                    moduleLabels: MODULE_LABEL,
                    planLimits: PLAN_LIMITS[ctx.plan],
                    business: bp && {
                        legalName: bp.legalName, displayName: bp.displayName, gstin: bp.gstin, pan: bp.pan,
                        stateName: bp.stateName, stateCode: bp.stateCode, contactName: bp.contactName, contactPhone: bp.contactPhone,
                        contactEmail: bp.contactEmail, address: bp.address, pincode: bp.pincode, district: bp.district,
                        aatoAbove5cr: bp.aatoAbove5cr, approvedAt: bp.approvedAt,
                    },
                    onboarding: { steps: onboarding.steps, readyToSubmit: onboarding.readyToSubmit, submittedAt: onboarding.submittedAt, rejectionReason: onboarding.rejectionReason },
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/onboarding', pending, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerHubService.onboarding((req as HubRequest).hub!.businessPartnerId) }); }
        catch (e) { hubError(e, res, next); }
    });

    app.put('/api/hub/onboarding/bank', pending, hubCan('team:manage'), validateBody(bankSchema), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const r = await PartnerHubService.setBank(ctx.businessPartnerId, req.body);
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_bank_set', changedBy: ctx.adminUserId, metadata: { status: r.check.status, last4: r.partner.bankAccountNumber?.slice(-4) } });
            res.json({
                success: true,
                message: r.check.status === 'verified' ? 'Bank account verified.' : r.check.status === 'failed' ? r.check.reason : r.check.reason,
                data: { status: r.partner.bankStatus },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/hub/profile', pending, hubCan('settings:manage'), validateBody(profileSchema), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const b = req.body as z.infer<typeof profileSchema>;
            const patch: Record<string, unknown> = { updatedAt: new Date() };
            for (const k of ['displayName', 'contactName', 'address', 'pincode', 'district'] as const) if (b[k] !== undefined) patch[k] = b[k];
            if (b.gstin !== undefined) {
                // The tax identity is fixed once approved — every invoice depends on it.
                if (ctx.status === 'active') throw new HubError('Your GSTIN can only be changed by UniteFix once approved.', 'GSTIN_LOCKED', 409);
                const g = checkGstin(b.gstin);
                if (b.gstin && !g.valid) throw new HubError(`GSTIN: ${g.reason}`, 'BAD_GSTIN');
                Object.assign(patch, b.gstin
                    ? { gstin: b.gstin.toUpperCase(), stateCode: g.stateCode, stateName: g.stateName, gstinStatus: 'format_ok', gstinCheckedAt: new Date(), pan: g.pan, panStatus: 'format_ok' }
                    : { gstin: null, gstinStatus: 'unchecked' });
            }
            const [row] = await db.update(businessPartners).set(patch as any).where(eq(businessPartners.id, ctx.businessPartnerId)).returning();
            res.json({ success: true, message: 'Saved.', data: { displayName: row.displayName } });
        } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/documents', pending, async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const rows = await db.select().from(partnerDocuments)
                .where(eq(partnerDocuments.businessPartnerId, ctx.businessPartnerId)).orderBy(desc(partnerDocuments.id));
            res.json({ success: true, data: rows.map(d => ({ ...d, label: DOC_TYPES.find(t => t.code === d.docType)?.label ?? d.docType })) });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/documents', pending, hubCan('docs:manage'), docUpload.single('file'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const docType = String(req.body?.docType ?? '');
            if (!DOC_TYPES.some(t => t.code === docType) && docType !== 'other') throw new HubError('Unknown document type.', 'BAD_DOC_TYPE');
            if (!req.file) throw new HubError('Attach the file.', 'NO_FILE');
            const expiresAt = req.body?.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(req.body.expiresAt) ? req.body.expiresAt : null;
            const up = await uploadDocumentBuffer(req.file.buffer, `partner_docs/${ctx.partnerCode}`, req.file.mimetype)
                .catch((err: Error) => { throw new HubError(`The file could not be stored (${err.message.replace(/^Document upload failed: /, '')}). Try again, or try a different file.`, 'UPLOAD_FAILED', 502); });
            const row = await PartnerHubService.addDocument(ctx.businessPartnerId, {
                docType, fileUrl: up.url, fileName: req.file.originalname?.slice(0, 160), mimeType: req.file.mimetype, expiresAt, uploadedBy: ctx.adminUserId,
            });
            res.status(201).json({ success: true, message: 'Uploaded.', data: row });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/agreements/accept', pending, hubCan('team:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const accepted = await PartnerHubService.acceptAgreements(ctx.businessPartnerId, ctx.adminUserId, ip(req), req.headers['user-agent'] ?? null);
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_agreements_accepted', changedBy: ctx.adminUserId, metadata: { accepted } });
            res.json({ success: true, message: 'Accepted.', data: { accepted } });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/onboarding/submit', pending, hubCan('team:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const o = await PartnerHubService.submit(ctx.businessPartnerId);
            res.json({ success: true, message: 'Submitted. UniteFix reviews applications within 48 hours.', data: o });
        } catch (e) { hubError(e, res, next); }
    });

    /** Anyone signed in can change their own password (invited people start with a temporary one). */
    app.post('/api/hub/password', pending, async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const current = String(req.body?.currentPassword ?? '');
            const next_ = String(req.body?.newPassword ?? '');
            if (next_.length < 8) throw new HubError('Use at least 8 characters.', 'WEAK_PASSWORD');
            const [login] = await db.select().from(adminUsers).where(eq(adminUsers.id, ctx.adminUserId)).limit(1);
            if (!login || !(await bcrypt.compare(current, login.password))) throw new HubError('Your current password is not right.', 'BAD_PASSWORD', 401);
            await db.update(adminUsers).set({ password: await bcrypt.hash(next_, 10), updatedAt: new Date() }).where(eq(adminUsers.id, ctx.adminUserId));
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_password_changed', changedBy: ctx.adminUserId });
            res.json({ success: true, message: 'Password changed.' });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Partner — team (approved partners)
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/hub/summary', active, async (req, res, next) => {
        try { res.json({ success: true, data: await hubSummary((req as HubRequest).hub!) }); }
        catch (e) { hubError(e, res, next); }
    });

    app.get('/api/hub/team', active, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerHubService.team((req as HubRequest).hub!.businessPartnerId) }); }
        catch (e) { hubError(e, res, next); }
    });

    app.post('/api/hub/team', active, hubCan('team:manage'), validateBody(inviteSchema), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const r = await PartnerHubService.invite(ctx, req.body);
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_member_invited', changedBy: ctx.adminUserId, metadata: { memberId: r.member.id, role: r.member.role } });
            res.status(201).json({
                success: true,
                message: `Invited. They sign in at the Partner Hub with ${req.body.email} and the temporary password shown once below.`,
                data: { member: r.member, username: req.body.email.toLowerCase(), temporaryPassword: r.temporaryPassword },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/hub/team/:id', active, hubCan('team:manage'), async (req, res, next) => {
        try {
            const ctx = (req as HubRequest).hub!;
            const role = req.body?.role && (HUB_ROLES as string[]).includes(req.body.role) ? req.body.role : undefined;
            const status = req.body?.status === 'active' || req.body?.status === 'revoked' ? req.body.status : undefined;
            const updated = await PartnerHubService.updateMember(ctx, Number(req.params.id), { role, status });
            await recordAudit({ entityType: 'business_partner', entityId: ctx.businessPartnerId, action: 'hub_member_updated', changedBy: ctx.adminUserId, metadata: { memberId: updated.id, role, status } });
            res.json({ success: true, message: status === 'revoked' ? 'Access removed.' : 'Updated.', data: updated });
        } catch (e) { hubError(e, res, next); }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Staff
    // ═══════════════════════════════════════════════════════════════════════

    app.get('/api/admin/hub/partners/:id', authenticateAdmin, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const bp = await BusinessPartnerService.byId(id);
            if (!bp) return res.status(404).json({ success: false, message: 'Not found' });
            const [onboarding, team, overrides] = await Promise.all([
                PartnerHubService.onboarding(id),
                PartnerHubService.team(id),
                db.select().from(partnerModules).where(eq(partnerModules.businessPartnerId, id)),
            ]);
            res.json({
                success: true,
                data: {
                    id: bp.id, partnerCode: bp.partnerCode, displayName: bp.displayName, status: bp.status,
                    appliedVia: bp.appliedVia, submittedAt: bp.submittedAt, hubPlan: bp.hubPlan, aatoAbove5cr: bp.aatoAbove5cr,
                    fieldFeePercent: bp.fieldFeePercent == null ? null : Number(bp.fieldFeePercent), fieldTier: bp.fieldTier,
                    gstin: bp.gstin, gstinStatus: bp.gstinStatus, stateName: bp.stateName, pan: bp.pan, panStatus: bp.panStatus,
                    coveragePincodes: bp.coveragePincodes ?? [],
                    hasHubLogin: !!bp.adminUserId,
                    modules: await PartnerHubService.modulesOf(bp),
                    moduleOverrides: overrides.map(o => ({ module: o.module, enabled: o.enabled })),
                    verticalModules: VERTICAL_MODULES,
                    onboarding, team,
                },
            });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/admin/hub/partners/:id/documents/:docId/review', authenticateAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const status = req.body?.status === 'verified' ? 'verified' : req.body?.status === 'rejected' ? 'rejected' : null;
            if (!status) throw new HubError('status must be verified or rejected', 'BAD_STATUS');
            const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : null;
            if (status === 'rejected' && !note) throw new HubError('Say why, so the partner can fix it.', 'NOTE_REQUIRED');
            const [doc] = await db.select().from(partnerDocuments)
                .where(and(eq(partnerDocuments.id, Number(req.params.docId)), eq(partnerDocuments.businessPartnerId, Number(req.params.id)))).limit(1);
            if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });
            const row = await PartnerHubService.reviewDocument(doc.id, status, note, admin.userId);
            await recordAudit({ entityType: 'business_partner', entityId: doc.businessPartnerId, action: `hub_document_${status}`, changedBy: admin.userId, metadata: { docId: doc.id, docType: doc.docType, note } });
            res.json({ success: true, data: row });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/admin/hub/partners/:id/bank-verified', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const reference = String(req.body?.reference ?? '').trim();
            if (reference.length < 3) throw new HubError('Note how it was checked (e.g. "cancelled cheque matched").', 'NOTE_REQUIRED');
            const row = await PartnerHubService.markBankVerified(Number(req.params.id), admin.userId, reference);
            await recordAudit({ entityType: 'business_partner', entityId: row.id, action: 'hub_bank_verified_manual', changedBy: admin.userId, metadata: { reference } });
            res.json({ success: true, message: 'Bank marked verified.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/admin/hub/partners/:id/modules', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const module = String(req.body?.module ?? '');
            if (!(VERTICAL_MODULES as string[]).includes(module)) throw new HubError('Only vertical modules can be overridden.', 'BAD_MODULE');
            const enabled = req.body?.enabled === true ? true : req.body?.enabled === false ? false : null;
            await PartnerHubService.setModule(Number(req.params.id), module, enabled, admin.userId);
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.id), action: 'hub_module_override', changedBy: admin.userId, metadata: { module, enabled } });
            res.json({ success: true, message: enabled === null ? 'Back to the vertical default.' : enabled ? 'Module switched on.' : 'Module switched off.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.put('/api/admin/hub/partners/:id/plan', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const plan = req.body?.plan === 'pro' ? 'pro' : req.body?.plan === 'starter' ? 'starter' : null;
            if (!plan) throw new HubError('plan must be starter or pro', 'BAD_PLAN');
            await PartnerHubService.setPlan(Number(req.params.id), plan);
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.id), action: 'hub_plan_changed', changedBy: admin.userId, metadata: { plan } });
            res.json({ success: true, message: `Plan set to ${plan}.` });
        } catch (e) { hubError(e, res, next); }
    });

    app.patch('/api/admin/hub/partners/:id/flags', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            if (typeof req.body?.aatoAbove5cr !== 'boolean') throw new HubError('aatoAbove5cr must be true or false', 'BAD_FLAG');
            await db.update(businessPartners).set({ aatoAbove5cr: req.body.aatoAbove5cr, updatedAt: new Date() }).where(eq(businessPartners.id, Number(req.params.id)));
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.id), action: 'hub_flags_changed', changedBy: admin.userId, metadata: req.body });
            res.json({ success: true, message: 'Saved.' });
        } catch (e) { hubError(e, res, next); }
    });

    app.post('/api/admin/hub/partners/:id/owner-login', authenticateAdmin, requireSuperAdmin, async (req, res, next) => {
        try {
            const admin = (req as any).admin as { userId: number };
            const r = await PartnerHubService.createOwnerLogin(Number(req.params.id), { email: req.body?.email ?? null });
            await recordAudit({ entityType: 'business_partner', entityId: Number(req.params.id), action: 'hub_owner_login_created', changedBy: admin.userId, metadata: { username: r.username } });
            res.status(201).json({ success: true, message: 'Hub login created. Share the temporary password — it is shown once.', data: r });
        } catch (e) { hubError(e, res, next); }
    });
}
