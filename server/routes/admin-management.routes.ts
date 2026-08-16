/**
 * Administrator management — super_admin only.
 *
 *   GET   /api/admin/admins             list administrators
 *   PATCH /api/admin/admins/:id/role    promote / demote
 *   PATCH /api/admin/admins/:id/status  enable / disable
 *
 * Creation lives on the existing POST /api/admin/auth/login sibling
 * /api/admin/auth/register (server/routes.ts), which already enforces
 * super_admin and hashes the password.
 *
 * LOCKOUT GUARDS — every one of these is enforced here rather than in the UI,
 * because the UI is not a security boundary:
 *   - you cannot change your own role (no self-promotion, no accidental
 *     self-demotion that strands you outside the console)
 *   - you cannot deactivate yourself
 *   - you cannot demote or deactivate the LAST active super_admin; doing so
 *     would permanently lock everyone out of the Database Console, the audit
 *     trail, and admin management itself, with no in-app way back.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, and, ne, count } from "drizzle-orm";
import { adminUsers } from "@shared/schema";
import { requireSuperAdmin } from "../middleware/auth.middleware";
import { recordAudit } from "../lib/audit";
import logger from "../lib/logger";

const VALID_ROLES = ["admin", "super_admin"] as const;
type AdminRole = (typeof VALID_ROLES)[number];

/** Active super_admins other than `excludeId`. Zero means the caller is the last one. */
async function otherActiveSuperAdmins(excludeId: number): Promise<number> {
    const [row] = await db
        .select({ c: count() })
        .from(adminUsers)
        .where(
            and(
                eq(adminUsers.role, "super_admin"),
                eq(adminUsers.isActive, true),
                ne(adminUsers.id, excludeId),
            ),
        );
    return Number(row?.c ?? 0);
}

export function registerAdminManagementRoutes(app: Express) {

    /**
     * GET /api/admin/admins
     * Passwords are never selected — not even hashed.
     */
    app.get("/api/admin/admins", requireSuperAdmin, async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await db
                .select({
                    id: adminUsers.id,
                    username: adminUsers.username,
                    email: adminUsers.email,
                    role: adminUsers.role,
                    isActive: adminUsers.isActive,
                    lastLogin: adminUsers.lastLogin,
                    createdAt: adminUsers.createdAt,
                })
                .from(adminUsers)
                .orderBy(adminUsers.id);

            res.json({ success: true, data: rows });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/admin/admins/:id/role
     * Body: { role: 'admin' | 'super_admin' }
     */
    app.patch("/api/admin/admins/:id/role", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = parseInt(req.params.id);
            const role = req.body?.role as AdminRole;
            const actor = (req as any).admin as { userId: number; username: string };

            if (Number.isNaN(id)) {
                return res.status(400).json({ success: false, message: "Invalid admin id" });
            }
            if (!VALID_ROLES.includes(role)) {
                return res.status(400).json({
                    success: false,
                    message: `role must be one of: ${VALID_ROLES.join(", ")}`,
                });
            }
            if (id === actor.userId) {
                return res.status(400).json({
                    success: false,
                    message: "You cannot change your own role.",
                });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
            if (!target) {
                return res.status(404).json({ success: false, message: "Admin not found" });
            }
            if (target.role === role) {
                return res.json({ success: true, message: `Already a ${role}.`, data: { id, role } });
            }

            // Demoting the last active super_admin locks the platform's most
            // privileged capabilities away for good.
            if (target.role === "super_admin" && role === "admin") {
                if ((await otherActiveSuperAdmins(id)) === 0) {
                    return res.status(409).json({
                        success: false,
                        message: "Cannot demote the last active super_admin — promote another one first.",
                    });
                }
            }

            const [updated] = await db
                .update(adminUsers)
                .set({ role, updatedAt: new Date() })
                .where(eq(adminUsers.id, id))
                .returning({ id: adminUsers.id, username: adminUsers.username, role: adminUsers.role });

            logger.warn(`[ADMIN_MGMT] ${target.username} role ${target.role} -> ${role} by ${actor.username}`);

            await recordAudit({
                entityType: "admin_user",
                entityId: id,
                action: "admin_role_changed",
                changedBy: actor.userId,
                fromState: target.role,
                toState: role,
                metadata: { username: target.username, changedBy: actor.username },
            });

            res.json({ success: true, message: `${target.username} is now ${role}.`, data: updated });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/admin/admins/:id/status
     * Body: { isActive: boolean }
     *
     * A deactivated admin is refused by authenticateAdmin on their very next
     * request, so this takes effect immediately even with a valid token.
     */
    app.patch("/api/admin/admins/:id/status", requireSuperAdmin, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = parseInt(req.params.id);
            const isActive = req.body?.isActive;
            const actor = (req as any).admin as { userId: number; username: string };

            if (Number.isNaN(id)) {
                return res.status(400).json({ success: false, message: "Invalid admin id" });
            }
            if (typeof isActive !== "boolean") {
                return res.status(400).json({ success: false, message: "isActive must be a boolean" });
            }
            if (id === actor.userId) {
                return res.status(400).json({
                    success: false,
                    message: "You cannot deactivate your own account.",
                });
            }

            const [target] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
            if (!target) {
                return res.status(404).json({ success: false, message: "Admin not found" });
            }

            if (!isActive && target.role === "super_admin") {
                if ((await otherActiveSuperAdmins(id)) === 0) {
                    return res.status(409).json({
                        success: false,
                        message: "Cannot deactivate the last active super_admin — promote another one first.",
                    });
                }
            }

            const [updated] = await db
                .update(adminUsers)
                .set({ isActive, updatedAt: new Date() })
                .where(eq(adminUsers.id, id))
                .returning({ id: adminUsers.id, username: adminUsers.username, isActive: adminUsers.isActive });

            logger.warn(`[ADMIN_MGMT] ${target.username} ${isActive ? "activated" : "deactivated"} by ${actor.username}`);

            await recordAudit({
                entityType: "admin_user",
                entityId: id,
                action: isActive ? "admin_activated" : "admin_deactivated",
                changedBy: actor.userId,
                fromState: String(target.isActive),
                toState: String(isActive),
                metadata: { username: target.username, changedBy: actor.username },
            });

            res.json({
                success: true,
                message: `${target.username} ${isActive ? "activated" : "deactivated"}.`,
                data: updated,
            });
        } catch (error) {
            next(error);
        }
    });
}
