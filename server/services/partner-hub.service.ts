/**
 * Partner Hub — the one back office every business partner signs in to.
 *
 * A Hub login is an admin_users row with role 'partner' (or a legacy FTTH
 * 'operator' owner login), tied to a business partner through partner_users
 * with a team role. This service answers "who is this, for which business,
 * allowed to do what, with which modules", and owns the phase-1 lifecycle:
 * apply → KYC → documents → agreements → submit → approval → modules on.
 *
 * Money, invoicing and the vertical modules live in their own services and
 * read the context built here.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { db } from '../db';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
    adminUsers, businessPartners, businessPartnerVerticals, partnerVerticals, partnerModules, partnerUsers,
    partnerDocuments, partnerAgreements, ftthOperators, ftthOperatorPincodes, serviceablePincodes,
} from '@shared/schema';
import {
    HubModule, HubRole, HubPlan, HUB_ROLES, PLAN_LIMITS, ROLE_PERMISSIONS, can, HubPermission,
    modulesForVerticals, docsFor, agreementsFor, checkGstin, checkPan,
} from '@shared/hub';
import { withTransaction } from '../lib/transaction';
import { BusinessPartnerService } from './business-partner.service';
import { verifyBankAccount } from './kyc.service';
import logger from '../lib/logger';

type BusinessPartner = typeof businessPartners.$inferSelect;

export class HubError extends Error {
    constructor(message: string, public code: string, public status = 400) { super(message); }
}

export interface HubContext {
    businessPartnerId: number;
    partnerCode: string;
    displayName: string;
    status: string;
    adminUserId: number;
    username: string;
    role: HubRole;
    permissions: string[];
    verticals: string[];
    modules: HubModule[];
    plan: HubPlan;
    ftthOperatorId: number | null;
}

export class PartnerHubService {

    // ──────────────────────────────────────────────────────────────────────
    // Who is signed in
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Resolve a Hub login to its business and role. Order:
     *   1. an active partner_users membership
     *   2. the business's own adminUserId (the owner) — membership row created
     *   3. an FTTH operator owner login with no business partner yet — one is
     *      created and linked, exactly as the backfill does
     */
    static async resolve(adminUserId: number): Promise<{ bp: BusinessPartner; role: HubRole } | null> {
        const [m] = await db.select().from(partnerUsers).where(eq(partnerUsers.adminUserId, adminUserId)).limit(1);
        if (m) {
            if (m.status !== 'active') return null;
            const bp = await BusinessPartnerService.byId(m.businessPartnerId);
            return bp ? { bp, role: (HUB_ROLES as string[]).includes(m.role) ? m.role as HubRole : 'technician' } : null;
        }

        let bp = await BusinessPartnerService.byAdminUserId(adminUserId);
        if (!bp) bp = await this.linkUnbackfilledOperator(adminUserId);
        if (!bp) return null;

        // The owner, seen for the first time through the Hub: record the membership
        // so team management has a complete list.
        await db.insert(partnerUsers).values({ businessPartnerId: bp.id, adminUserId, role: 'owner' })
            .onConflictDoNothing();
        return { bp, role: 'owner' };
    }

    /** An FTTH operator approved after the backfill ran has no business partner. Create and link one. */
    private static async linkUnbackfilledOperator(adminUserId: number): Promise<BusinessPartner | null> {
        const [op] = await db.select().from(ftthOperators).where(eq(ftthOperators.adminUserId, adminUserId)).limit(1);
        if (!op) return null;
        if (op.businessPartnerId) return BusinessPartnerService.byId(op.businessPartnerId);
        const [isp] = await db.select().from(partnerVerticals).where(eq(partnerVerticals.code, 'isp')).limit(1);
        return withTransaction(async (tx) => {
            const partnerCode = await BusinessPartnerService.nextPartnerCode(tx as any);
            const g = checkGstin(op.gstin);
            const [bp] = await tx.insert(businessPartners).values({
                partnerCode,
                legalName: op.legalName ?? op.companyName,
                displayName: op.companyName,
                gstin: op.gstin,
                contactName: op.contactName,
                contactPhone: op.contactPhone,
                contactEmail: op.contactEmail,
                status: op.status as any,
                adminUserId: op.adminUserId,
                approvedByAdminId: op.approvedByAdminId,
                approvedAt: op.approvedAt,
                stateCode: g.valid ? g.stateCode : null,
                stateName: g.valid ? g.stateName : null,
                gstinStatus: op.gstin ? (g.valid ? 'format_ok' : 'invalid') : 'unchecked',
                appliedVia: 'ftth',
                notes: `Linked from ftth_operators #${op.id} on first Hub sign-in`,
            }).returning();
            if (isp) await tx.insert(businessPartnerVerticals).values({ businessPartnerId: bp.id, verticalId: isp.id }).onConflictDoNothing();
            await tx.update(ftthOperators).set({ businessPartnerId: bp.id, updatedAt: new Date() }).where(eq(ftthOperators.id, op.id));
            logger.info(`[HUB] Linked FTTH operator #${op.id} to new business partner ${partnerCode}`);
            return bp;
        });
    }

    static async modulesOf(bp: BusinessPartner, verticals?: string[]): Promise<HubModule[]> {
        const v = verticals ?? await BusinessPartnerService.verticalCodesOf(bp.id);
        const overrides = await db.select({ module: partnerModules.module, enabled: partnerModules.enabled })
            .from(partnerModules).where(eq(partnerModules.businessPartnerId, bp.id));
        return modulesForVerticals(v, overrides);
    }

    static async context(adminUserId: number, username: string): Promise<HubContext | null> {
        const r = await this.resolve(adminUserId);
        if (!r) return null;
        const verticals = await BusinessPartnerService.verticalCodesOf(r.bp.id);
        const [op] = await db.select({ id: ftthOperators.id }).from(ftthOperators)
            .where(eq(ftthOperators.businessPartnerId, r.bp.id)).limit(1);
        return {
            businessPartnerId: r.bp.id,
            partnerCode: r.bp.partnerCode,
            displayName: r.bp.displayName,
            status: r.bp.status,
            adminUserId,
            username,
            role: r.role,
            permissions: ROLE_PERMISSIONS[r.role],
            verticals,
            modules: await this.modulesOf(r.bp, verticals),
            plan: (r.bp.hubPlan === 'pro' ? 'pro' : 'starter'),
            ftthOperatorId: op?.id ?? null,
        };
    }

    static require(ctx: HubContext, perm: HubPermission) {
        if (!can(ctx.role, perm)) throw new HubError(`Your role (${ctx.role}) cannot do this. Ask the owner.`, 'FORBIDDEN', 403);
    }

    static requireModule(ctx: HubContext, mod: HubModule) {
        if (!ctx.modules.includes(mod)) throw new HubError('This module is not switched on for your business.', 'MODULE_OFF', 403);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Apply (public)
    // ──────────────────────────────────────────────────────────────────────

    static async apply(input: {
        businessName: string; legalName?: string | null; gstin?: string | null; pan?: string | null;
        contactName: string; phone: string; email: string; address?: string | null; pincode?: string | null; district?: string | null;
        verticals: string[]; coveragePincodes?: string[]; password: string;
    }) {
        const email = input.email.trim().toLowerCase();
        const phone = input.phone.trim();
        const gstin = input.gstin?.trim().toUpperCase() || null;
        const pan = (input.pan?.trim().toUpperCase() || (gstin ? gstin.slice(2, 12) : null)) || null;

        if (gstin) {
            const g = checkGstin(gstin);
            if (!g.valid) throw new HubError(`GSTIN: ${g.reason}`, 'BAD_GSTIN');
        }
        if (pan) {
            const p = checkPan(pan);
            if (!p.valid) throw new HubError(`PAN: ${p.reason}`, 'BAD_PAN');
            if (gstin && gstin.slice(2, 12) !== pan) throw new HubError('The PAN does not match the PAN inside the GSTIN.', 'PAN_MISMATCH');
        }

        const verticals = Array.from(new Set(input.verticals.map(v => v.trim().toLowerCase()).filter(Boolean)));
        if (!verticals.length) throw new HubError('Choose at least one thing your business does.', 'NO_VERTICAL');

        const [emailTaken] = await db.select({ id: adminUsers.id }).from(adminUsers)
            .where(sql`lower(${adminUsers.email}) = ${email} OR lower(${adminUsers.username}) = ${email}`).limit(1);
        if (emailTaken) throw new HubError('An account already uses this email. Sign in instead, or use another email.', 'EMAIL_TAKEN', 409);

        const [live] = await db.select({ id: businessPartners.id, status: businessPartners.status }).from(businessPartners)
            .where(and(eq(businessPartners.contactPhone, phone), inArray(businessPartners.status, ['pending_approval', 'active', 'paused'])))
            .limit(1);
        if (live) {
            throw new HubError(live.status === 'pending_approval'
                ? 'An application from this phone number is already under review.'
                : 'A partner account already exists for this phone number.', 'PHONE_TAKEN', 409);
        }

        // Coverage is only meaningful for broadband; unknown pincodes are kept as a
        // proposal and reviewed with the application, not silently dropped.
        const coverage = verticals.includes('isp')
            ? Array.from(new Set((input.coveragePincodes ?? []).map(p => p.trim()).filter(p => /^\d{6}$/.test(p))))
            : [];
        if (verticals.includes('isp') && !coverage.length) {
            throw new HubError('Add the pincodes where you provide broadband.', 'NO_COVERAGE');
        }

        const g = checkGstin(gstin);
        const hashed = await bcrypt.hash(input.password, 10);

        return withTransaction(async (tx) => {
            const [login] = await tx.insert(adminUsers).values({
                username: email, email, password: hashed, role: 'partner', isActive: true,
            }).returning();

            const partnerCode = await BusinessPartnerService.nextPartnerCode(tx as any);
            const [bp] = await tx.insert(businessPartners).values({
                partnerCode,
                legalName: (input.legalName || input.businessName).trim(),
                displayName: input.businessName.trim(),
                gstin, pan,
                contactName: input.contactName.trim(),
                contactPhone: phone,
                contactEmail: email,
                address: input.address ?? null,
                pincode: input.pincode ?? null,
                district: input.district ?? null,
                status: 'pending_approval',
                adminUserId: login.id,
                stateCode: g.valid ? g.stateCode : null,
                stateName: g.valid ? g.stateName : null,
                gstinStatus: gstin ? 'format_ok' : 'unchecked',
                gstinCheckedAt: gstin ? new Date() : null,
                panStatus: pan ? 'format_ok' : 'unchecked',
                appliedVia: 'self',
                coveragePincodes: coverage.length ? coverage : null,
            }).returning();

            await BusinessPartnerService.setVerticals(bp.id, verticals, tx as any);
            await tx.insert(partnerUsers).values({
                businessPartnerId: bp.id, adminUserId: login.id, role: 'owner',
                displayName: input.contactName.trim(), phone,
            });

            logger.info(`[HUB] Application ${partnerCode} (${bp.displayName}) — verticals ${verticals.join(',')}`);
            return { bp, login };
        });
    }

    // ──────────────────────────────────────────────────────────────────────
    // Onboarding status — what is done, what is missing
    // ──────────────────────────────────────────────────────────────────────

    static async onboarding(bpId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        const docs = await db.select().from(partnerDocuments).where(eq(partnerDocuments.businessPartnerId, bpId)).orderBy(desc(partnerDocuments.id));
        const accepted = await db.select().from(partnerAgreements).where(eq(partnerAgreements.businessPartnerId, bpId));

        const required = docsFor(verticals, !!bp.gstin);
        const docStatus = required.map(d => {
            const latest = docs.find(x => x.docType === d.code && x.status !== 'superseded');
            return { ...d, document: latest ?? null, done: !!latest && latest.status !== 'rejected' };
        });
        const agreements = agreementsFor(verticals).map(a => ({
            code: a.code, version: a.version, title: a.title, sections: a.sections,
            accepted: accepted.some(x => x.agreementCode === a.code && x.version === a.version),
            acceptedAt: accepted.find(x => x.agreementCode === a.code && x.version === a.version)?.acceptedAt ?? null,
        }));

        const steps = [
            { key: 'details', label: 'Business details', done: !!(bp.legalName && bp.contactPhone && bp.contactEmail), detail: bp.displayName },
            { key: 'gstin', label: 'GSTIN', done: !bp.gstin || bp.gstinStatus === 'format_ok' || bp.gstinStatus === 'verified',
              detail: bp.gstin ? `${bp.gstin} · ${bp.stateName ?? ''} · ${bp.gstinStatus === 'verified' ? 'verified' : 'format and check digit OK'}` : 'Not registered — goods and B2B credit need a GSTIN' },
            { key: 'pan', label: 'PAN', done: bp.panStatus === 'format_ok' || bp.panStatus === 'verified', detail: bp.pan ?? 'Missing' },
            { key: 'bank', label: 'Bank account', done: bp.bankStatus === 'verified',
              detail: bp.bankAccountNumber ? `A/c ending ${bp.bankAccountNumber.slice(-4)} · ${bp.bankStatus}` : 'Not added' },
            { key: 'documents', label: 'Documents', done: docStatus.filter(d => d.required).every(d => d.done),
              detail: `${docStatus.filter(d => d.required && d.done).length} of ${docStatus.filter(d => d.required).length} required uploaded` },
            { key: 'agreements', label: 'Agreement', done: agreements.every(a => a.accepted),
              detail: `${agreements.filter(a => a.accepted).length} of ${agreements.length} accepted` },
        ];
        const readyToSubmit = steps.every(s => s.key === 'bank' || s.done) && !!bp.bankAccountNumber;
        return {
            status: bp.status, submittedAt: bp.submittedAt, rejectionReason: bp.rejectionReason,
            verticals, steps, documents: docStatus, agreements, readyToSubmit,
            bank: { beneficiaryName: bp.beneficiaryName, last4: bp.bankAccountNumber?.slice(-4) ?? null, ifsc: bp.bankIfsc, status: bp.bankStatus, nameAtBank: bp.bankHolderNameAtBank },
        };
    }

    /**
     * Bank details. Editable by the partner ONLY while their application is
     * open — after approval, an account-number change is an admin action, so a
     * stolen Hub password cannot redirect a settlement.
     */
    static async setBank(bpId: number, input: { beneficiaryName: string; accountNumber: string; ifsc: string }) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (bp.status === 'active' && bp.bankStatus === 'verified') {
            throw new HubError('Your verified bank account can only be changed by UniteFix. Raise a support request.', 'BANK_LOCKED', 409);
        }
        const acct = input.accountNumber.replace(/\s+/g, '');
        if (!/^\d{9,18}$/.test(acct)) throw new HubError('Account number must be 9 to 18 digits.', 'BAD_ACCOUNT');
        const ifsc = input.ifsc.trim().toUpperCase();
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new HubError('IFSC must be 4 letters, a zero, then 6 letters or digits.', 'BAD_IFSC');

        const check = await verifyBankAccount({ accountNumber: acct, ifsc, name: input.beneficiaryName });
        const [updated] = await db.update(businessPartners).set({
            beneficiaryName: input.beneficiaryName.trim(),
            bankAccountNumber: acct,
            bankIfsc: ifsc,
            bankStatus: check.status === 'verified' ? 'verified' : check.status === 'failed' ? 'failed' : 'pending',
            bankVerifiedAt: check.status === 'verified' ? new Date() : null,
            bankVerificationRef: 'reference' in check ? check.reference : null,
            bankHolderNameAtBank: check.status === 'verified' ? check.nameAtBank : null,
            cashfreeBeneId: null, // re-register with Payouts on the next settlement
            updatedAt: new Date(),
        }).where(eq(businessPartners.id, bpId)).returning();
        return { partner: updated, check };
    }

    static async addDocument(bpId: number, input: { docType: string; fileUrl: string; fileName?: string | null; mimeType?: string | null; expiresAt?: string | null; uploadedBy: number }) {
        // A new upload of the same type supersedes the previous one rather than deleting it.
        await db.update(partnerDocuments).set({ status: 'superseded' })
            .where(and(eq(partnerDocuments.businessPartnerId, bpId), eq(partnerDocuments.docType, input.docType), ne(partnerDocuments.status, 'superseded')));
        const [row] = await db.insert(partnerDocuments).values({
            businessPartnerId: bpId, docType: input.docType, fileUrl: input.fileUrl, fileName: input.fileName ?? null,
            mimeType: input.mimeType ?? null, expiresAt: input.expiresAt ?? null, uploadedByAdminUserId: input.uploadedBy,
        }).returning();
        return row;
    }

    static async acceptAgreements(bpId: number, adminUserId: number, ip: string | null, userAgent: string | null) {
        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        const list = agreementsFor(verticals);
        for (const a of list) {
            await db.insert(partnerAgreements).values({
                businessPartnerId: bpId, agreementCode: a.code, version: a.version,
                acceptedByAdminUserId: adminUserId, ip, userAgent: userAgent?.slice(0, 300) ?? null,
            }).onConflictDoNothing();
        }
        return list.map(a => `${a.code}@${a.version}`);
    }

    static async submit(bpId: number) {
        const o = await this.onboarding(bpId);
        if (!o.readyToSubmit) {
            const missing = o.steps.filter(s => !s.done && s.key !== 'bank').map(s => s.label);
            if (!o.bank.last4) missing.push('Bank account');
            throw new HubError(`Not ready yet — still needed: ${missing.join(', ')}.`, 'INCOMPLETE');
        }
        await db.update(businessPartners).set({ submittedAt: new Date(), updatedAt: new Date() }).where(eq(businessPartners.id, bpId));
        return this.onboarding(bpId);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Team
    // ──────────────────────────────────────────────────────────────────────

    static async team(bpId: number) {
        return db.select({
            id: partnerUsers.id, adminUserId: partnerUsers.adminUserId, role: partnerUsers.role, status: partnerUsers.status,
            displayName: partnerUsers.displayName, phone: partnerUsers.phone, createdAt: partnerUsers.createdAt,
            username: adminUsers.username, email: adminUsers.email, lastLogin: adminUsers.lastLogin,
        }).from(partnerUsers).innerJoin(adminUsers, eq(adminUsers.id, partnerUsers.adminUserId))
            .where(eq(partnerUsers.businessPartnerId, bpId)).orderBy(asc(partnerUsers.id));
    }

    static async invite(ctx: HubContext, input: { name: string; email: string; phone?: string | null; role: HubRole }) {
        if (input.role === 'owner') throw new HubError('There is one owner. Invite as manager instead.', 'BAD_ROLE');
        const limit = PLAN_LIMITS[ctx.plan].teamMembers;
        if (limit !== null) {
            const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerUsers)
                .where(and(eq(partnerUsers.businessPartnerId, ctx.businessPartnerId), eq(partnerUsers.status, 'active')));
            if (n >= limit) throw new HubError(`The Starter plan allows ${limit} people. Upgrade to Pro for more.`, 'PLAN_LIMIT', 402);
        }
        const email = input.email.trim().toLowerCase();
        const [taken] = await db.select({ id: adminUsers.id }).from(adminUsers)
            .where(sql`lower(${adminUsers.email}) = ${email} OR lower(${adminUsers.username}) = ${email}`).limit(1);
        if (taken) throw new HubError('This email already has a UniteFix login.', 'EMAIL_TAKEN', 409);

        // Shown once to the person inviting, to pass on; never stored in plain text.
        const temporaryPassword = crypto.randomBytes(9).toString('base64url');
        const member = await withTransaction(async (tx) => {
            const [login] = await tx.insert(adminUsers).values({
                username: email, email, password: await bcrypt.hash(temporaryPassword, 10), role: 'partner', isActive: true,
            }).returning();
            const [m] = await tx.insert(partnerUsers).values({
                businessPartnerId: ctx.businessPartnerId, adminUserId: login.id, role: input.role,
                displayName: input.name.trim(), phone: input.phone?.trim() || null, invitedByAdminUserId: ctx.adminUserId,
            }).returning();
            return m;
        });
        return { member, temporaryPassword };
    }

    static async updateMember(ctx: HubContext, memberId: number, patch: { role?: HubRole; status?: 'active' | 'revoked' }) {
        const [m] = await db.select().from(partnerUsers)
            .where(and(eq(partnerUsers.id, memberId), eq(partnerUsers.businessPartnerId, ctx.businessPartnerId))).limit(1);
        if (!m) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (m.role === 'owner') throw new HubError('The owner cannot be changed or removed here. Contact UniteFix to transfer ownership.', 'OWNER_LOCKED', 409);
        if (patch.role === 'owner') throw new HubError('There is one owner.', 'BAD_ROLE');
        const [updated] = await db.update(partnerUsers).set({
            ...(patch.role ? { role: patch.role } : {}),
            ...(patch.status ? { status: patch.status } : {}),
            updatedAt: new Date(),
        }).where(eq(partnerUsers.id, memberId)).returning();
        if (patch.status) {
            // Revocation takes effect on the next request: the login itself is switched off.
            await db.update(adminUsers).set({ isActive: patch.status === 'active', updatedAt: new Date() }).where(eq(adminUsers.id, m.adminUserId));
        }
        return updated;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Admin side
    // ──────────────────────────────────────────────────────────────────────

    /** A partner an admin created by hand gets a Hub login (owner). */
    static async createOwnerLogin(bpId: number, input: { email?: string | null }) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) throw new HubError('Not found', 'NOT_FOUND', 404);
        if (bp.adminUserId) throw new HubError('This partner already has a Hub login.', 'HAS_LOGIN', 409);
        const email = (input.email || bp.contactEmail || '').trim().toLowerCase();
        if (!email) throw new HubError('Add a contact email to the partner first.', 'NO_EMAIL');
        const [taken] = await db.select({ id: adminUsers.id }).from(adminUsers)
            .where(sql`lower(${adminUsers.email}) = ${email} OR lower(${adminUsers.username}) = ${email}`).limit(1);
        if (taken) throw new HubError('This email already has a UniteFix login.', 'EMAIL_TAKEN', 409);
        const temporaryPassword = crypto.randomBytes(9).toString('base64url');
        await withTransaction(async (tx) => {
            const [login] = await tx.insert(adminUsers).values({
                username: email, email, password: await bcrypt.hash(temporaryPassword, 10), role: 'partner', isActive: true,
            }).returning();
            await tx.update(businessPartners).set({ adminUserId: login.id, contactEmail: bp.contactEmail ?? email, updatedAt: new Date() })
                .where(eq(businessPartners.id, bpId));
            await tx.insert(partnerUsers).values({ businessPartnerId: bpId, adminUserId: login.id, role: 'owner', displayName: bp.contactName, phone: bp.contactPhone });
        });
        return { username: email, temporaryPassword };
    }

    /**
     * After approval: switch the owner login on and, for broadband, create the
     * FTTH operator the Broadband module runs on (coverage limited to pincodes
     * UniteFix serves; the rest stay on the partner record as a proposal).
     */
    static async afterApproval(bpId: number, adminId: number) {
        const bp = await BusinessPartnerService.byId(bpId);
        if (!bp) return null;
        {
            const { HubAlerts } = await import('./hub-alerts.service');
            await HubAlerts.send(bpId, 'application_approved', { title: 'Welcome to UniteFix', body: `${bp.displayName} is approved. Your Partner Hub is open — start with the checklist on the home page.`, link: '/partner' });
        }
        if (bp.adminUserId) {
            await db.update(adminUsers).set({ isActive: true, updatedAt: new Date() }).where(eq(adminUsers.id, bp.adminUserId));
        }
        const verticals = await BusinessPartnerService.verticalCodesOf(bpId);
        let ftthOperatorId: number | null = null;
        if (verticals.includes('isp')) {
            const [existing] = await db.select({ id: ftthOperators.id }).from(ftthOperators).where(eq(ftthOperators.businessPartnerId, bpId)).limit(1);
            if (existing) {
                ftthOperatorId = existing.id;
                await db.update(ftthOperators).set({ status: 'active', updatedAt: new Date() }).where(eq(ftthOperators.id, existing.id));
            } else {
                const wanted = bp.coveragePincodes ?? [];
                const known = wanted.length
                    ? (await db.select({ p: serviceablePincodes.pincode }).from(serviceablePincodes).where(inArray(serviceablePincodes.pincode, wanted))).map(r => r.p)
                    : [];
                const [op] = await db.insert(ftthOperators).values({
                    companyName: bp.displayName, legalName: bp.legalName, gstin: bp.gstin,
                    contactName: bp.contactName, contactEmail: bp.contactEmail ?? `${bp.partnerCode.toLowerCase()}@partners.unitefix.local`,
                    contactPhone: bp.contactPhone, status: 'active',
                    // The owner's login IS the operator login — FTTH routes resolve by it.
                    adminUserId: bp.adminUserId, approvedByAdminId: adminId, approvedAt: new Date(),
                    businessPartnerId: bpId,
                } as any).returning();
                ftthOperatorId = op.id;
                if (known.length) await db.insert(ftthOperatorPincodes).values(known.map(pincode => ({ operatorId: op.id, pincode }))).onConflictDoNothing();
                logger.info(`[HUB] ${bp.partnerCode}: FTTH operator #${op.id} created with ${known.length}/${wanted.length} pincodes`);
            }
        }
        return { ftthOperatorId };
    }

    static async setModule(bpId: number, module: string, enabled: boolean | null, adminId: number) {
        if (enabled === null) {
            await db.delete(partnerModules).where(and(eq(partnerModules.businessPartnerId, bpId), eq(partnerModules.module, module)));
            return;
        }
        await db.insert(partnerModules).values({ businessPartnerId: bpId, module, enabled, setByAdminId: adminId })
            .onConflictDoUpdate({ target: [partnerModules.businessPartnerId, partnerModules.module], set: { enabled, setByAdminId: adminId, updatedAt: new Date() } });
    }

    static async setPlan(bpId: number, plan: HubPlan) {
        const [row] = await db.update(businessPartners).set({ hubPlan: plan, hubPlanSince: new Date(), updatedAt: new Date() })
            .where(eq(businessPartners.id, bpId)).returning();
        return row;
    }

    static async reviewDocument(docId: number, status: 'verified' | 'rejected', note: string | null, adminId: number) {
        const [row] = await db.update(partnerDocuments).set({ status, reviewNote: note, reviewedByAdminId: adminId, reviewedAt: new Date() })
            .where(eq(partnerDocuments.id, docId)).returning();
        return row ?? null;
    }

    static async markBankVerified(bpId: number, adminId: number, reference: string) {
        const [row] = await db.update(businessPartners).set({
            bankStatus: 'verified', bankVerifiedAt: new Date(), bankVerificationRef: `manual:${reference}`.slice(0, 120), updatedAt: new Date(),
        }).where(eq(businessPartners.id, bpId)).returning();
        logger.info(`[HUB] Bank for partner #${bpId} verified by admin #${adminId} (${reference})`);
        return row;
    }
}
