/**
 * Roles & Access — one system for every dashboard account.
 *
 *   GET    /api/admin/roles                  list roles with their grants
 *   POST   /api/admin/roles                  create a role
 *   PATCH  /api/admin/roles/:id              rename / re-grant capabilities
 *   DELETE /api/admin/roles/:id              delete an unused, non-system role
 *   GET    /api/admin/roles/capabilities     the catalogue the UI renders
 *
 *   GET    /api/admin/admins                 every account, any role
 *   POST   /api/admin/admins                 create one (operators included)
 *   PATCH  /api/admin/admins/:id             role / details
 *   PATCH  /api/admin/admins/:id/status      activate / deactivate
 *   POST   /api/admin/admins/:id/password    reset
 *   GET    /api/admin/admins/:id/delete-impact
 *   DELETE /api/admin/admins/:id             archive, or purge if unreferenced
 *
 * ROLES ARE USER-CREATED; capability KEYS are not — a capability only means
 * something if code checks it, so the catalogue lives in shared/capabilities.ts
 * and this file only composes it.
 *
 * LOCKOUT GUARDS, all enforced here rather than in the UI because the UI is not
 * a security boundary:
 *   - you cannot change your own role, or deactivate/delete yourself
 *   - you cannot remove the LAST account able to manage roles and access; doing
 *     so locks everyone out of this screen with no in-app way back
 *   - super_admin's grants are computed, never stored, so they cannot be edited
 *     down to nothing
 *   - an operator-scope account always moves together with its ftth_operators
 *     row, so the two can never disagree about whether it is active
 */

import type { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { db } from "../db";
import { eq, and, ne, or, count, inArray, isNull, sql } from "drizzle-orm";
import {
    adminUsers, adminRoles, adminRoleCapabilities,
    ftthOperators, ftthOperatorPincodes, serviceablePincodes,
    auditLogs, ftthRecharges,
} from "@shared/schema";
import {
    CAPABILITY_AREAS, ALL_CAPABILITIES, isValidCapability, expandCapabilities,
    capabilitiesForScope, SYSTEM_ROLES, isSystemRole, superAdminCapabilities,
} from "@shared/capabilities";
import { requireSuperAdmin } from "../middleware/auth.middleware";
import { withTransaction } from "../lib/transaction";
import { recordAudit } from "../lib/audit";
import logger from "../lib/logger";

const slugify = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

const roleSchema = z.object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).nullable().optional(),
    scope: z.enum(['staff', 'operator']).optional(),
    capabilities: z.array(z.string().trim()).max(ALL_CAPABILITIES.length + 10).optional(),
});

const accountSchema = z.object({
    username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/,
        "Username may contain letters, numbers, dot, underscore and hyphen only"),
    email: z.string().trim().email().max(160),
    password: z.string().min(8).max(128).optional(),
    roleId: z.number().int().positive(),
    // Only for operator-scope roles — an operator account is meaningless without
    // the company it belongs to.
    operator: z.object({
        companyName: z.string().trim().min(2).max(120),
        contactPhone: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number"),
        contactName: z.string().trim().max(120).optional(),
        gstin: z.string().trim().regex(/^[0-9A-Z]{15}$/).optional(),
        pincodes: z.array(z.string().trim().regex(/^\d{6}$/)).max(500).optional(),
    }).optional(),
});

const accountEditSchema = z.object({
    email: z.string().trim().email().max(160).optional(),
    roleId: z.number().int().positive().optional(),
});

/**
 * How many OTHER active, non-archived accounts can still manage roles and
 * access? Zero means the caller is the last one and must not be removed.
 *
 * Counts super_admins (whose grants are computed) plus anyone whose role
 * explicitly holds accounts:manage.
 */
async function otherAccountManagers(excludeId: number): Promise<number> {
    const [row] = await db
        .select({ c: count() })
        .from(adminUsers)
        .leftJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
        .leftJoin(adminRoleCapabilities, and(
            eq(adminRoleCapabilities.roleId, adminUsers.roleId),
            eq(adminRoleCapabilities.capability, 'accounts:manage'),
        ))
        .where(and(
            eq(adminUsers.isActive, true),
            isNull(adminUsers.deletedAt),
            ne(adminUsers.id, excludeId),
            or(
                eq(adminUsers.role, SYSTEM_ROLES.SUPER_ADMIN),
                sql`${adminRoleCapabilities.capability} IS NOT NULL`,
            ),
        ));
    return Number(row?.c ?? 0);
}

/** Effective grants for a role — super_admin's are computed, never stored. */
async function capabilitiesForRole(role: { id: number; slug: string }): Promise<string[]> {
    if (role.slug === SYSTEM_ROLES.SUPER_ADMIN) return superAdminCapabilities();
    const rows = await db.select({ capability: adminRoleCapabilities.capability })
        .from(adminRoleCapabilities).where(eq(adminRoleCapabilities.roleId, role.id));
    return rows.map(r => r.capability);
}

export function registerAdminManagementRoutes(app: Express) {

    // ==================== CAPABILITY CATALOGUE ====================

    /**
     * The areas the Roles screen renders. Served from the server so the UI can
     * never offer a capability the middleware does not understand.
     */
    app.get("/api/admin/roles/capabilities", async (_req: Request, res: Response) => {
        res.json({
            success: true,
            data: {
                areas: CAPABILITY_AREAS,
                all: ALL_CAPABILITIES,
            },
        });
    });

    // ==================== ROLES ====================

    app.get("/api/admin/roles", async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const roles = await db.select().from(adminRoles).orderBy(adminRoles.id);
            const grants = await db.select().from(adminRoleCapabilities);
            const counts = await db
                .select({ roleId: adminUsers.roleId, c: count() })
                .from(adminUsers)
                .where(isNull(adminUsers.deletedAt))
                .groupBy(adminUsers.roleId);

            const byRole = new Map<number, string[]>();
            for (const g of grants) {
                byRole.set(g.roleId, [...(byRole.get(g.roleId) ?? []), g.capability]);
            }
            const countByRole = new Map(counts.map(c => [c.roleId, Number(c.c)]));

            res.json({
                success: true,
                data: roles.map(r => ({
                    ...r,
                    // super_admin's grants are computed so the UI shows the truth
                    // rather than an empty list.
                    capabilities: r.slug === SYSTEM_ROLES.SUPER_ADMIN
                        ? superAdminCapabilities()
                        : (byRole.get(r.id) ?? []),
                    accountCount: countByRole.get(r.id) ?? 0,
                    // The UI disables editing for these; the server enforces it.
                    capabilitiesLocked: r.slug === SYSTEM_ROLES.SUPER_ADMIN,
                })),
            });
        } catch (error) { next(error); }
    });

    app.post("/api/admin/roles", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsed = roleSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    success: false, message: "Validation failed",
                    errors: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
                });
            }
            const actor = (req as any).admin as { userId: number; username: string };
            const { name, description, scope = 'staff', capabilities = [] } = parsed.data;

            const slug = slugify(name);
            if (!slug) return res.status(400).json({ success: false, message: "Role name must contain letters or numbers." });
            if (isSystemRole(slug)) {
                return res.status(409).json({ success: false, message: `"${slug}" is a reserved role name.` });
            }

            const [clash] = await db.select({ id: adminRoles.id }).from(adminRoles)
                .where(eq(adminRoles.slug, slug)).limit(1);
            if (clash) return res.status(409).json({ success: false, message: "A role with that name already exists." });

            // A capability from the wrong side of the boundary is rejected rather
            // than silently dropped — a staff role must never appear to grant
            // operator-portal access, or vice versa.
            const allowed = new Set(capabilitiesForScope(scope));
            const invalid = capabilities.filter(c => !isValidCapability(c) || !allowed.has(c));
            if (invalid.length) {
                return res.status(400).json({
                    success: false,
                    message: `Not valid for a ${scope} role: ${invalid.join(', ')}`,
                });
            }

            const role = await withTransaction(async (tx) => {
                const [row] = await tx.insert(adminRoles)
                    .values({ slug, name, description: description ?? null, scope, isSystem: false })
                    .returning();
                if (capabilities.length) {
                    await tx.insert(adminRoleCapabilities)
                        .values(capabilities.map(capability => ({ roleId: row.id, capability })));
                }
                return row;
            });

            await recordAudit({
                entityType: 'admin_role', entityId: role.id, action: 'role_created',
                changedBy: actor.userId, metadata: { slug, name, scope, capabilities },
            });
            logger.warn(`[ACCESS] Role '${slug}' created by ${actor.username}`);

            res.status(201).json({ success: true, message: `Role "${name}" created.`, data: { ...role, capabilities } });
        } catch (error) { next(error); }
    });

    app.patch("/api/admin/roles/:id", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const parsed = roleSchema.partial().safeParse(req.body);
            if (!Number.isInteger(id) || !parsed.success) {
                return res.status(400).json({ success: false, message: "Invalid role update" });
            }
            const actor = (req as any).admin as { userId: number; username: string };

            const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, id)).limit(1);
            if (!role) return res.status(404).json({ success: false, message: "Role not found" });

            // super_admin's grants are computed at read time. Storing an editable
            // set would eventually let someone untick "Roles & Access" on the only
            // super admin and lock the company out permanently.
            if (role.slug === SYSTEM_ROLES.SUPER_ADMIN && parsed.data.capabilities) {
                return res.status(409).json({
                    success: false,
                    message: "Super Admin always holds every capability — that is what makes it the recovery account.",
                });
            }

            const { name, description, capabilities } = parsed.data;

            if (capabilities) {
                const allowed = new Set(capabilitiesForScope(role.scope as 'staff' | 'operator'));
                const invalid = capabilities.filter(c => !isValidCapability(c) || !allowed.has(c));
                if (invalid.length) {
                    return res.status(400).json({
                        success: false,
                        message: `Not valid for a ${role.scope} role: ${invalid.join(', ')}`,
                    });
                }

                // Removing accounts:manage from a role can strand the platform if
                // that role holds the last people who can reach this screen.
                const losingAccountsManage =
                    !capabilities.includes('accounts:manage')
                    && role.slug !== SYSTEM_ROLES.SUPER_ADMIN;
                if (losingAccountsManage) {
                    const holders = await db.select({ id: adminUsers.id }).from(adminUsers)
                        .where(and(
                            eq(adminUsers.roleId, id),
                            eq(adminUsers.isActive, true),
                            isNull(adminUsers.deletedAt),
                        ));
                    for (const h of holders) {
                        if ((await otherAccountManagers(h.id)) === 0) {
                            return res.status(409).json({
                                success: false,
                                message: "This would remove the last account able to manage roles and access.",
                            });
                        }
                    }
                }
            }

            await withTransaction(async (tx) => {
                if (name !== undefined || description !== undefined) {
                    await tx.update(adminRoles).set({
                        // A system role's SLUG is fixed — too much code keys off it
                        // — but its display name can still be changed.
                        ...(name !== undefined ? { name } : {}),
                        ...(description !== undefined ? { description } : {}),
                        updatedAt: new Date(),
                    }).where(eq(adminRoles.id, id));
                }
                if (capabilities) {
                    await tx.delete(adminRoleCapabilities).where(eq(adminRoleCapabilities.roleId, id));
                    if (capabilities.length) {
                        await tx.insert(adminRoleCapabilities)
                            .values(capabilities.map(capability => ({ roleId: id, capability })));
                    }
                }
            });

            await recordAudit({
                entityType: 'admin_role', entityId: id, action: 'role_updated',
                changedBy: actor.userId, metadata: { slug: role.slug, name, capabilities },
            });
            logger.warn(`[ACCESS] Role '${role.slug}' updated by ${actor.username}`);

            res.json({ success: true, message: "Role updated. It takes effect on each user's next request." });
        } catch (error) { next(error); }
    });

    app.delete("/api/admin/roles/:id", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const actor = (req as any).admin as { userId: number; username: string };

            const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, id)).limit(1);
            if (!role) return res.status(404).json({ success: false, message: "Role not found" });
            if (role.isSystem) {
                return res.status(409).json({ success: false, message: `"${role.name}" is a built-in role and cannot be deleted.` });
            }

            const [{ c }] = await db.select({ c: count() }).from(adminUsers)
                .where(and(eq(adminUsers.roleId, id), isNull(adminUsers.deletedAt)));
            if (Number(c) > 0) {
                return res.status(409).json({
                    success: false,
                    message: `${c} account${Number(c) === 1 ? '' : 's'} still use this role. Move them first.`,
                });
            }

            await db.delete(adminRoles).where(eq(adminRoles.id, id));

            await recordAudit({
                entityType: 'admin_role', entityId: id, action: 'role_deleted',
                changedBy: actor.userId, metadata: { slug: role.slug, name: role.name },
            });
            logger.warn(`[ACCESS] Role '${role.slug}' deleted by ${actor.username}`);

            res.json({ success: true, message: `Role "${role.name}" deleted.` });
        } catch (error) { next(error); }
    });

    // ==================== ACCOUNTS ====================

    /** Passwords are never selected — not even hashed. */
    app.get("/api/admin/admins", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const includeArchived = req.query.archived === 'true';
            const rows = await db
                .select({
                    id: adminUsers.id,
                    username: adminUsers.username,
                    email: adminUsers.email,
                    role: adminUsers.role,
                    roleId: adminUsers.roleId,
                    roleName: adminRoles.name,
                    roleScope: adminRoles.scope,
                    isActive: adminUsers.isActive,
                    deletedAt: adminUsers.deletedAt,
                    lastLogin: adminUsers.lastLogin,
                    createdAt: adminUsers.createdAt,
                    operatorId: ftthOperators.id,
                    operatorCompany: ftthOperators.companyName,
                    operatorStatus: ftthOperators.status,
                })
                .from(adminUsers)
                .leftJoin(adminRoles, eq(adminRoles.id, adminUsers.roleId))
                .leftJoin(ftthOperators, eq(ftthOperators.adminUserId, adminUsers.id))
                .where(includeArchived ? undefined : isNull(adminUsers.deletedAt))
                .orderBy(adminUsers.id);

            res.json({ success: true, data: rows });
        } catch (error) { next(error); }
    });

    /**
     * Create any kind of account. An operator-scope role also creates the
     * ftth_operators profile in the SAME transaction — an operator login with no
     * company is an account that signs in and can reach nothing, which
     * authenticateOperator refuses anyway.
     */
    app.post("/api/admin/admins", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parsed = accountSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({
                    success: false, message: "Validation failed",
                    errors: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
                });
            }
            const actor = (req as any).admin as { userId: number; username: string };
            const { username, email, password, roleId, operator } = parsed.data;

            const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
            if (!role) return res.status(400).json({ success: false, message: "Unknown role" });

            if (role.scope === 'operator' && !operator) {
                return res.status(400).json({
                    success: false,
                    message: "An operator account needs a company name and contact number.",
                });
            }

            const [clash] = await db.select({ id: adminUsers.id }).from(adminUsers)
                .where(or(eq(adminUsers.username, username), eq(adminUsers.email, email))).limit(1);
            if (clash) {
                return res.status(409).json({ success: false, message: "That username or email is already in use." });
            }

            if (operator?.pincodes?.length) {
                const known = await db.select({ pincode: serviceablePincodes.pincode })
                    .from(serviceablePincodes).where(inArray(serviceablePincodes.pincode, operator.pincodes));
                const knownSet = new Set(known.map(k => k.pincode));
                const unknown = operator.pincodes.filter(p => !knownSet.has(p));
                if (unknown.length) {
                    return res.status(400).json({
                        success: false,
                        message: `UniteFix does not operate in: ${unknown.join(', ')}`,
                    });
                }
            }

            // Shown to the creator once and never stored in plaintext.
            const generated = password ? null : crypto.randomBytes(12).toString('base64url');
            const plain = password ?? generated!;

            const created = await withTransaction(async (tx) => {
                const [account] = await tx.insert(adminUsers).values({
                    username, email,
                    password: await bcrypt.hash(plain, 10),
                    role: role.slug,       // mirrors roleId; roleId is the authority
                    roleId: role.id,
                    isActive: true,
                }).returning();

                let operatorId: number | null = null;
                if (role.scope === 'operator' && operator) {
                    const [op] = await tx.insert(ftthOperators).values({
                        adminUserId: account.id,
                        companyName: operator.companyName,
                        contactName: operator.contactName ?? null,
                        contactEmail: email,
                        contactPhone: operator.contactPhone,
                        gstin: operator.gstin ?? null,
                        status: 'active',
                        approvedByAdminId: actor.userId,
                        approvedAt: new Date(),
                    }).returning();
                    operatorId = op.id;

                    if (operator.pincodes?.length) {
                        await tx.insert(ftthOperatorPincodes)
                            .values(operator.pincodes.map(pincode => ({ operatorId: op.id, pincode })));
                    }
                }

                return { account, operatorId };
            });

            await recordAudit({
                entityType: 'admin_user', entityId: created.account.id, action: 'account_created',
                changedBy: actor.userId,
                metadata: { username, role: role.slug, roleName: role.name, operatorId: created.operatorId },
            });
            logger.warn(`[ACCESS] Account '${username}' (${role.slug}) created by ${actor.username}`);

            res.status(201).json({
                success: true,
                message: `${username} can now sign in.`,
                data: {
                    id: created.account.id,
                    username,
                    operatorId: created.operatorId,
                    temporaryPassword: generated,
                },
            });
        } catch (error) { next(error); }
    });

    /** Change an account's role or email. */
    app.patch("/api/admin/admins/:id", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const parsed = accountEditSchema.safeParse(req.body);
            if (!Number.isInteger(id) || !parsed.success) {
                return res.status(400).json({ success: false, message: "Invalid update" });
            }
            const actor = (req as any).admin as { userId: number; username: string };
            const { email, roleId } = parsed.data;

            if (id === actor.userId && roleId !== undefined) {
                return res.status(400).json({ success: false, message: "You cannot change your own role." });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
            if (!target) return res.status(404).json({ success: false, message: "Account not found" });
            if (target.deletedAt) return res.status(409).json({ success: false, message: "This account is archived." });

            let nextRole = null;
            if (roleId !== undefined && roleId !== target.roleId) {
                [nextRole] = await db.select().from(adminRoles).where(eq(adminRoles.id, roleId)).limit(1);
                if (!nextRole) return res.status(400).json({ success: false, message: "Unknown role" });

                const [currentRole] = target.roleId
                    ? await db.select().from(adminRoles).where(eq(adminRoles.id, target.roleId)).limit(1)
                    : [null];
                const currentScope = currentRole?.scope
                    ?? (target.role === SYSTEM_ROLES.FTTH_OPERATOR ? 'operator' : 'staff');

                // Moving an account ACROSS the staff/operator boundary is refused.
                // Promoting an ISP's login into staff would hand a third party the
                // whole console off one dropdown; demoting staff into an operator
                // role would strand them with no company profile.
                if (nextRole.scope !== currentScope) {
                    return res.status(409).json({
                        success: false,
                        message: currentScope === 'operator'
                            ? "An operator account cannot be turned into a staff account."
                            : "A staff account cannot be turned into an operator account. Create a separate operator login instead.",
                    });
                }

                if ((await otherAccountManagers(id)) === 0) {
                    // The target is the last account manager — only allow a move to
                    // a role that keeps that power.
                    const keeps = nextRole.slug === SYSTEM_ROLES.SUPER_ADMIN
                        || (await db.select({ c: count() }).from(adminRoleCapabilities)
                            .where(and(
                                eq(adminRoleCapabilities.roleId, nextRole.id),
                                eq(adminRoleCapabilities.capability, 'accounts:manage'),
                            )))[0].c > 0;
                    if (!keeps) {
                        return res.status(409).json({
                            success: false,
                            message: "This is the last account able to manage roles and access.",
                        });
                    }
                }
            }

            await withTransaction(async (tx) => {
                await tx.update(adminUsers).set({
                    ...(email !== undefined ? { email } : {}),
                    ...(nextRole ? { roleId: nextRole.id, role: nextRole.slug } : {}),
                    updatedAt: new Date(),
                }).where(eq(adminUsers.id, id));

                // Keep the operator's contact email in step with the login email.
                if (email !== undefined) {
                    await tx.update(ftthOperators)
                        .set({ contactEmail: email, updatedAt: new Date() })
                        .where(eq(ftthOperators.adminUserId, id));
                }
            });

            if (nextRole) {
                await recordAudit({
                    entityType: 'admin_user', entityId: id, action: 'account_role_changed',
                    changedBy: actor.userId, fromState: target.role, toState: nextRole.slug,
                    metadata: { username: target.username, changedBy: actor.username },
                });
                logger.warn(`[ACCESS] ${target.username} role ${target.role} -> ${nextRole.slug} by ${actor.username}`);
            }

            res.json({ success: true, message: "Account updated." });
        } catch (error) { next(error); }
    });

    /**
     * Activate / deactivate.
     *
     * An operator account moves ftth_operators.status at the same time — the two
     * flags are one switch, and letting them disagree produces either a
     * "disabled" operator holding a working session or an "active" one whose
     * every request 403s.
     */
    app.patch("/api/admin/admins/:id/status", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const isActive = req.body?.isActive;
            const actor = (req as any).admin as { userId: number; username: string };

            if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid account id" });
            if (typeof isActive !== "boolean") {
                return res.status(400).json({ success: false, message: "isActive must be a boolean" });
            }
            if (id === actor.userId) {
                return res.status(400).json({ success: false, message: "You cannot deactivate your own account." });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
            if (!target) return res.status(404).json({ success: false, message: "Account not found" });

            if (!isActive && (await otherAccountManagers(id)) === 0) {
                return res.status(409).json({
                    success: false,
                    message: "Cannot deactivate the last account able to manage roles and access.",
                });
            }

            await withTransaction(async (tx) => {
                await tx.update(adminUsers)
                    .set({ isActive, updatedAt: new Date() })
                    .where(eq(adminUsers.id, id));
                await tx.update(ftthOperators)
                    .set({ status: isActive ? 'active' : 'paused', updatedAt: new Date() })
                    .where(eq(ftthOperators.adminUserId, id));
            });

            await recordAudit({
                entityType: "admin_user", entityId: id,
                action: isActive ? "account_activated" : "account_deactivated",
                changedBy: actor.userId,
                fromState: String(target.isActive), toState: String(isActive),
                metadata: { username: target.username, changedBy: actor.username },
            });
            logger.warn(`[ACCESS] ${target.username} ${isActive ? "activated" : "deactivated"} by ${actor.username}`);

            res.json({ success: true, message: `${target.username} ${isActive ? "activated" : "deactivated"}.` });
        } catch (error) { next(error); }
    });

    /** Reset a password. Shown once, never stored in plaintext. */
    app.post("/api/admin/admins/:id/password", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const actor = (req as any).admin as { userId: number; username: string };
            const supplied = typeof req.body?.password === 'string' ? req.body.password : undefined;
            if (supplied !== undefined && (supplied.length < 8 || supplied.length > 128)) {
                return res.status(400).json({ success: false, message: "Password must be 8-128 characters." });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
            if (!target) return res.status(404).json({ success: false, message: "Account not found" });

            const generated = supplied ? null : crypto.randomBytes(12).toString('base64url');
            await db.update(adminUsers)
                .set({ password: await bcrypt.hash(supplied ?? generated!, 10), updatedAt: new Date() })
                .where(eq(adminUsers.id, id));

            await recordAudit({
                entityType: 'admin_user', entityId: id, action: 'account_password_reset',
                changedBy: actor.userId, metadata: { username: target.username, generated: generated !== null },
            });
            logger.warn(`[ACCESS] Password reset for ${target.username} by ${actor.username}`);

            res.json({ success: true, message: "Password reset.", data: { temporaryPassword: generated } });
        } catch (error) { next(error); }
    });

    /**
     * What would deleting this account destroy?
     *
     * admin_users.id is referenced by audit entries, FTTH operator profiles and
     * recharge fulfilment records. A hard delete strips the attribution off that
     * history, so anything referenced is archived instead.
     */
    app.get("/api/admin/admins/:id/delete-impact", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
            if (!target) return res.status(404).json({ success: false, message: "Account not found" });

            const [[auditCount], [operatorCount], [approvedCount], [fulfilledCount]] = await Promise.all([
                db.select({ c: count() }).from(auditLogs).where(eq(auditLogs.changedBy, id)),
                db.select({ c: count() }).from(ftthOperators).where(eq(ftthOperators.adminUserId, id)),
                db.select({ c: count() }).from(ftthOperators).where(eq(ftthOperators.approvedByAdminId, id)),
                db.select({ c: count() }).from(ftthRecharges).where(eq(ftthRecharges.fulfilledByAdminId, id)),
            ]);

            const references = {
                auditEntries: Number(auditCount.c),
                operatorProfiles: Number(operatorCount.c),
                operatorsApproved: Number(approvedCount.c),
                rechargesFulfilled: Number(fulfilledCount.c),
            };
            const total = Object.values(references).reduce((a, b) => a + b, 0);

            res.json({
                success: true,
                data: {
                    username: target.username,
                    references,
                    canPurge: total === 0,
                    // What the button will actually do.
                    action: total === 0 ? 'purge' : 'archive',
                    isLastAccountManager: (await otherAccountManagers(id)) === 0,
                },
            });
        } catch (error) { next(error); }
    });

    /**
     * Archive, or permanently purge when nothing references the account.
     *
     * Archiving keeps history attributable and blocks sign-in immediately —
     * authenticateAdmin and authenticateOperator both refuse a row with
     * deletedAt set, so it takes effect on the very next request rather than at
     * token expiry.
     */
    app.delete("/api/admin/admins/:id", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = Number(req.params.id);
            const actor = (req as any).admin as { userId: number; username: string };

            if (id === actor.userId) {
                return res.status(400).json({ success: false, message: "You cannot delete your own account." });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
            if (!target) return res.status(404).json({ success: false, message: "Account not found" });

            if ((await otherAccountManagers(id)) === 0) {
                return res.status(409).json({
                    success: false,
                    message: "Cannot remove the last account able to manage roles and access.",
                });
            }

            const [[auditCount], [operatorCount], [approvedCount], [fulfilledCount]] = await Promise.all([
                db.select({ c: count() }).from(auditLogs).where(eq(auditLogs.changedBy, id)),
                db.select({ c: count() }).from(ftthOperators).where(eq(ftthOperators.adminUserId, id)),
                db.select({ c: count() }).from(ftthOperators).where(eq(ftthOperators.approvedByAdminId, id)),
                db.select({ c: count() }).from(ftthRecharges).where(eq(ftthRecharges.fulfilledByAdminId, id)),
            ]);
            const total = Number(auditCount.c) + Number(operatorCount.c)
                + Number(approvedCount.c) + Number(fulfilledCount.c);

            if (total === 0) {
                await db.delete(adminUsers).where(eq(adminUsers.id, id));
                await recordAudit({
                    entityType: 'admin_user', entityId: id, action: 'account_purged',
                    changedBy: actor.userId, metadata: { username: target.username, role: target.role },
                });
                logger.warn(`[ACCESS] Account '${target.username}' PURGED by ${actor.username}`);
                return res.json({
                    success: true,
                    message: `${target.username} permanently deleted.`,
                    data: { action: 'purged' },
                });
            }

            await withTransaction(async (tx) => {
                await tx.update(adminUsers)
                    .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
                    .where(eq(adminUsers.id, id));
                await tx.update(ftthOperators)
                    .set({ status: 'disabled', updatedAt: new Date() })
                    .where(eq(ftthOperators.adminUserId, id));
            });

            await recordAudit({
                entityType: 'admin_user', entityId: id, action: 'account_archived',
                changedBy: actor.userId,
                metadata: { username: target.username, role: target.role, references: total },
            });
            logger.warn(`[ACCESS] Account '${target.username}' archived by ${actor.username}`);

            res.json({
                success: true,
                message: `${target.username} archived — their history stays attributable.`,
                data: { action: 'archived' },
            });
        } catch (error) { next(error); }
    });
}
