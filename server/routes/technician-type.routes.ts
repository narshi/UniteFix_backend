/**
 * Technician types — the trade list an expert ticks during signup.
 *
 *   GET    /api/technician-types              public; the signup list
 *   POST   /api/technician-types/suggest      expert adds a missing trade
 *   GET    /api/admin/technician-types        admin list (standard contract)
 *   POST   /api/admin/technician-types        create
 *   PATCH  /api/admin/technician-types/:id    rename / describe / activate
 *   DELETE /api/admin/technician-types/:id    remove
 *
 * WHY EXPERTS CAN CREATE ROWS
 * An expert whose trade is missing would otherwise either abandon signup or tick
 * something inaccurate, which is worse than an untidy list. They add it, it is
 * flagged `source='expert'`, and an admin curates later.
 *
 * The guard against that becoming a mess is case-insensitive dedupe: suggesting
 * "electrician" when "Electrician" exists returns the existing row rather than
 * creating a second one. A unique index on lower(name) enforces the same thing
 * at the database level, so two experts suggesting the same trade at the same
 * moment cannot both win.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, asc, sql, or, ilike, count } from "drizzle-orm";
import { technicianTypes } from "@shared/schema";
import { authenticateAny } from "../middleware/auth.middleware";
import { recordAudit } from "../lib/audit";
import {
    parseListParams, buildOrderBy, dateRangeConditions, combine, paginationMeta,
} from "../lib/list-query";
import logger from "../lib/logger";

/** Trim, collapse whitespace, cap length. */
function cleanName(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Existing row whose name matches case-insensitively, if any. */
async function findByName(name: string) {
    const [row] = await db
        .select()
        .from(technicianTypes)
        .where(sql`lower(${technicianTypes.name}) = lower(${name})`)
        .limit(1);
    return row;
}

export function registerTechnicianTypeRoutes(app: Express) {

    // ==================== PUBLIC / MOBILE ====================

    /**
     * GET /api/technician-types
     * The list shown during expert signup. Public, because it is needed before
     * an expert's account is verified and it contains nothing sensitive.
     */
    app.get("/api/technician-types", async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const rows = await db
                .select({
                    id: technicianTypes.id,
                    name: technicianTypes.name,
                    description: technicianTypes.description,
                })
                .from(technicianTypes)
                .where(eq(technicianTypes.isActive, true))
                .orderBy(asc(technicianTypes.sortOrder), asc(technicianTypes.name));

            res.json({ success: true, data: rows });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/technician-types/suggest
     * Body: { name }
     * Adds a trade the expert could not find. Returns the row either way, so the
     * client can select it immediately whether it was created or already existed.
     */
    app.post("/api/technician-types/suggest", authenticateAny, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const name = cleanName(req.body?.name);

            if (name.length < 3) {
                return res.status(400).json({
                    success: false,
                    message: "Please enter at least 3 characters.",
                });
            }

            const existing = await findByName(name);
            if (existing) {
                // Reactivate rather than leaving the expert unable to pick a trade
                // an admin had previously hidden.
                if (!existing.isActive) {
                    await db.update(technicianTypes)
                        .set({ isActive: true, updatedAt: new Date() })
                        .where(eq(technicianTypes.id, existing.id));
                }
                return res.json({
                    success: true,
                    created: false,
                    data: { id: existing.id, name: existing.name },
                });
            }

            const [created] = await db
                .insert(technicianTypes)
                .values({
                    name,
                    source: 'expert',
                    suggestedBy: (req as any).user?.userId ?? null,
                    // New trades sort after the curated ones until an admin orders them.
                    sortOrder: 1000,
                })
                .returning({ id: technicianTypes.id, name: technicianTypes.name });

            logger.info(`[TECH_TYPE] Expert suggested new trade "${name}" (id=${created.id})`);

            res.status(201).json({ success: true, created: true, data: created });
        } catch (error: any) {
            // Lost the race against another expert suggesting the same trade —
            // the unique index fired, so return theirs.
            if (error?.code === '23505') {
                const existing = await findByName(cleanName(req.body?.name));
                if (existing) {
                    return res.json({
                        success: true,
                        created: false,
                        data: { id: existing.id, name: existing.name },
                    });
                }
            }
            next(error);
        }
    });

    // ==================== ADMIN CRUD ====================

    const SORTABLE = {
        name: technicianTypes.name,
        sortOrder: technicianTypes.sortOrder,
        createdAt: technicianTypes.createdAt,
        isActive: technicianTypes.isActive,
        source: technicianTypes.source,
    };

    app.get("/api/admin/technician-types", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const listOptions = { defaultSort: 'sortOrder', defaultOrder: 'asc' as const, sortable: SORTABLE };
            const params = parseListParams(req.query, listOptions);

            const conditions: any[] = [];
            const status = req.query.status as string | undefined;
            if (status === 'active') conditions.push(eq(technicianTypes.isActive, true));
            if (status === 'inactive') conditions.push(eq(technicianTypes.isActive, false));

            const source = req.query.source as string | undefined;
            if (source === 'admin' || source === 'expert') {
                conditions.push(eq(technicianTypes.source, source));
            }

            if (params.q) {
                const term = `%${params.q}%`;
                conditions.push(or(
                    ilike(technicianTypes.name, term),
                    ilike(technicianTypes.description, term),
                ));
            }

            conditions.push(...dateRangeConditions(params, technicianTypes.createdAt));
            const where = combine(conditions);

            const [{ total }] = await db
                .select({ total: count() })
                .from(technicianTypes)
                .where(where as any);

            const rows = await db
                .select()
                .from(technicianTypes)
                .where(where as any)
                .orderBy(buildOrderBy(params, listOptions))
                .limit(params.limit)
                .offset(params.offset);

            res.json({ success: true, data: rows, pagination: paginationMeta(params, Number(total)) });
        } catch (error) {
            next(error);
        }
    });

    app.post("/api/admin/technician-types", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const name = cleanName(req.body?.name);
            if (name.length < 2) {
                return res.status(400).json({ success: false, message: "Name is required." });
            }

            if (await findByName(name)) {
                return res.status(409).json({ success: false, message: `"${name}" already exists.` });
            }

            const [created] = await db
                .insert(technicianTypes)
                .values({
                    name,
                    description: cleanName(req.body?.description) || null,
                    sortOrder: Number.isFinite(Number(req.body?.sortOrder)) ? Number(req.body.sortOrder) : 0,
                    isActive: req.body?.isActive !== false,
                    source: 'admin',
                })
                .returning();

            await recordAudit({
                entityType: 'config',
                entityId: created.id,
                action: 'technician_type_created',
                changedBy: (req as any).admin?.userId,
                metadata: { name },
            });

            res.status(201).json({ success: true, message: `"${name}" added.`, data: created });
        } catch (error) {
            next(error);
        }
    });

    app.patch("/api/admin/technician-types/:id", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = parseInt(req.params.id);
            if (Number.isNaN(id)) {
                return res.status(400).json({ success: false, message: "Invalid id" });
            }

            const [existing] = await db.select().from(technicianTypes).where(eq(technicianTypes.id, id));
            if (!existing) {
                return res.status(404).json({ success: false, message: "Technician type not found" });
            }

            const updates: any = { updatedAt: new Date() };

            if (req.body?.name !== undefined) {
                const name = cleanName(req.body.name);
                if (name.length < 2) {
                    return res.status(400).json({ success: false, message: "Name is required." });
                }
                const clash = await findByName(name);
                if (clash && clash.id !== id) {
                    return res.status(409).json({ success: false, message: `"${name}" already exists.` });
                }
                updates.name = name;
            }

            if (req.body?.description !== undefined) updates.description = cleanName(req.body.description) || null;
            if (typeof req.body?.isActive === 'boolean') updates.isActive = req.body.isActive;
            if (Number.isFinite(Number(req.body?.sortOrder))) updates.sortOrder = Number(req.body.sortOrder);
            // An admin editing an expert suggestion adopts it as curated.
            if (req.body?.name !== undefined && existing.source === 'expert') updates.source = 'admin';

            const [updated] = await db
                .update(technicianTypes)
                .set(updates)
                .where(eq(technicianTypes.id, id))
                .returning();

            await recordAudit({
                entityType: 'config',
                entityId: id,
                action: 'technician_type_updated',
                changedBy: (req as any).admin?.userId,
                metadata: { before: existing.name, after: updated.name, updates },
            });

            res.json({ success: true, message: "Updated.", data: updated });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /api/admin/technician-types/:id
     *
     * Experts store the trade NAME on employees.services, not this id, so
     * deleting a row does not corrupt anyone's profile — it only removes the
     * option from future signups. Deactivating is usually the better move and
     * the UI says so, but a genuine typo should be removable.
     */
    app.delete("/api/admin/technician-types/:id", async (req: Request, res: Response, next: NextFunction) => {
        try {
            const id = parseInt(req.params.id);
            if (Number.isNaN(id)) {
                return res.status(400).json({ success: false, message: "Invalid id" });
            }

            const [existing] = await db.select().from(technicianTypes).where(eq(technicianTypes.id, id));
            if (!existing) {
                return res.status(404).json({ success: false, message: "Technician type not found" });
            }

            // How many experts already list this trade, so the admin is told
            // before the option disappears from signup.
            const [{ inUse }] = await db.execute(sql`
                SELECT COUNT(*)::int AS "inUse" FROM employees WHERE ${existing.name} = ANY(services)
            `).then((r: any) => (r.rows ?? r)) as any;

            await db.delete(technicianTypes).where(eq(technicianTypes.id, id));

            await recordAudit({
                entityType: 'config',
                entityId: id,
                action: 'technician_type_deleted',
                changedBy: (req as any).admin?.userId,
                metadata: { name: existing.name, expertsListingIt: Number(inUse) },
            });

            res.json({
                success: true,
                message: `"${existing.name}" removed.`
                    + (Number(inUse) > 0
                        ? ` ${inUse} expert(s) still list it on their profile — their profiles are unchanged.`
                        : ''),
            });
        } catch (error) {
            next(error);
        }
    });
}
