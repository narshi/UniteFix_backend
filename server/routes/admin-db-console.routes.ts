/**
 * Admin Database Console
 *
 * A raw SQL console over the production database, exposed only to super_admins.
 * Two capabilities:
 *   GET  /api/admin/db/schema  — every table and its columns (+ primary keys)
 *   POST /api/admin/db/query   — run arbitrary SQL (CRUD), with guard rails
 *
 * This is a deliberately powerful, dangerous tool. Guard rails:
 *   - super_admin only (a plain admin token is rejected)
 *   - write statements (anything that is not a pure read) require confirm:true,
 *     so the UI can force a second, explicit confirmation
 *   - a small hard blocklist refuses whole-database/schema destruction, which is
 *     not "CRUD" and has no undo
 *   - every write is written to the audit log with the SQL text and row count
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
// Shared with the audit trail and the account-purge routes, so all three enforce
// super_admin identically and a fix in one place covers every gated capability.
import { authenticateAdmin, requireSuperAdmin } from "../middleware/auth.middleware";
import { recordAudit } from "../lib/audit";
import logger from "../lib/logger";

// Catastrophic, non-CRUD statements with no undo — refused outright.
const HARD_BLOCK = /\b(drop\s+database|drop\s+schema|create\s+database)\b/i;

// First keyword → is this a pure read? Everything else is treated as a write and
// needs explicit confirmation.
const READ_KEYWORDS = new Set(["select", "with", "explain", "show", "table", "values"]);

function classify(sqlText: string): { first: string; readOnly: boolean } {
    // Strip leading line/block comments so "/* note */ delete ..." is not seen as a read.
    const cleaned = sqlText
        .replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, "")
        .trim();
    const first = (cleaned.split(/[\s(;]+/)[0] || "").toLowerCase();
    return { first, readOnly: READ_KEYWORDS.has(first) };
}

export function registerAdminDbConsoleRoutes(app: Express) {

    /**
     * GET /api/admin/db/schema
     * Every public table with its columns and primary keys.
     */
    app.get("/api/admin/db/schema", authenticateAdmin, requireSuperAdmin, async (_req: Request, res: Response) => {
        try {
            const colsResult = await db.execute(sql`
                SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
                FROM information_schema.columns
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position
            `);
            const cols = (colsResult as any).rows ?? [];

            const pkResult = await db.execute(sql`
                SELECT tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = 'public'
            `);
            const pks = new Set<string>(
                ((pkResult as any).rows ?? []).map((r: any) => `${r.table_name}.${r.column_name}`)
            );

            // Approximate row counts from the planner statistics — instant, and
            // exact enough for a "how big is this table" glance without scanning.
            const countResult = await db.execute(sql`
                SELECT relname AS table_name, n_live_tup AS row_estimate
                FROM pg_stat_user_tables
                WHERE schemaname = 'public'
            `);
            const counts = new Map<string, number>(
                ((countResult as any).rows ?? []).map((r: any) => [r.table_name, Number(r.row_estimate)])
            );

            const tableMap = new Map<string, any>();
            for (const c of cols) {
                if (!tableMap.has(c.table_name)) {
                    tableMap.set(c.table_name, {
                        name: c.table_name,
                        rowEstimate: counts.get(c.table_name) ?? null,
                        columns: [],
                    });
                }
                tableMap.get(c.table_name).columns.push({
                    name: c.column_name,
                    type: c.data_type,
                    nullable: c.is_nullable === "YES",
                    default: c.column_default,
                    isPrimaryKey: pks.has(`${c.table_name}.${c.column_name}`),
                });
            }

            const tables = Array.from(tableMap.values());
            res.json({ success: true, data: { tables } });
        } catch (error: any) {
            logger.error(`[DB_CONSOLE] schema fetch failed: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    });

    /**
     * POST /api/admin/db/query
     * Body: { sql: string, confirm?: boolean }
     * Runs the SQL and returns rows/rowCount. Writes require confirm:true.
     */
    app.post("/api/admin/db/query", authenticateAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
        const sqlText: string = req.body?.sql;
        const confirm: boolean = req.body?.confirm === true;

        if (!sqlText || typeof sqlText !== "string" || !sqlText.trim()) {
            return res.status(400).json({ success: false, message: "SQL statement is required." });
        }

        if (HARD_BLOCK.test(sqlText)) {
            return res.status(400).json({
                success: false,
                message: "Refused: dropping or creating whole databases/schemas is not allowed from the console.",
            });
        }

        const { first, readOnly } = classify(sqlText);

        // A write needs a second, explicit confirmation from the caller.
        if (!readOnly && !confirm) {
            return res.status(428).json({
                success: false,
                requiresConfirmation: true,
                operation: (first || "statement").toUpperCase(),
                message: `This ${(first || "statement").toUpperCase()} will modify the database. Confirm to run it.`,
            });
        }

        const admin = (req as any).admin as { userId: number; username?: string };
        const startedAt = Date.now();

        try {
            const result: any = await db.execute(sql.raw(sqlText));
            const rows: any[] = result.rows ?? [];
            const fields: string[] = (result.fields ?? []).map((f: any) => f.name);
            const durationMs = Date.now() - startedAt;
            // pg reports affected rows in rowCount for writes; for reads use rows.length.
            const rowCount = readOnly ? rows.length : (result.rowCount ?? 0);

            if (!readOnly) {
                logger.warn(`[DB_CONSOLE] ${admin?.username || admin?.userId} ran ${first.toUpperCase()} (${rowCount} rows)`);
                await recordAudit({
                    entityType: "db_console",
                    entityId: 0,
                    action: `db_console_${first}`,
                    changedBy: admin?.userId,
                    metadata: {
                        sql: sqlText.slice(0, 2000),
                        operation: first.toUpperCase(),
                        rowCount,
                        durationMs,
                    },
                });
            }

            res.json({
                success: true,
                data: {
                    rows,
                    // Prefer real field order from the driver; fall back to row keys.
                    fields: fields.length > 0 ? fields : (rows[0] ? Object.keys(rows[0]) : []),
                    rowCount,
                    command: result.command,
                    readOnly,
                    durationMs,
                },
            });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });
}
