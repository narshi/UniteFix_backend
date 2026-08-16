/**
 * Shared parsing for admin list endpoints.
 *
 * Every admin table speaks the same query contract, so one client hook can drive
 * all of them:
 *
 *   ?page&limit&sort&order&from&to&q  + per-resource filters
 *
 * and every endpoint answers with the same envelope:
 *
 *   { success, data: [...], pagination: { page, limit, total, totalPages, hasMore } }
 *
 * This mirrors what /api/admin/audit-logs already did by hand
 * (server/routes/admin.routes.ts) — that endpoint was the working prototype.
 *
 * SORT SAFETY: `sort` arrives from the client, so it is never interpolated into
 * SQL. Callers pass an allowlist mapping public field names to actual Drizzle
 * columns; anything not in the map falls back to a default. A column name that
 * reached the query string would otherwise be an injection point.
 */

import { asc, desc, gte, lte, and, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export interface ListParams {
    page: number;
    limit: number;
    offset: number;
    /** Public sort field name, already validated against the allowlist. */
    sort: string;
    order: "asc" | "desc";
    /** Free-text search term, lowercased and trimmed. Empty string when absent. */
    q: string;
    from?: Date;
    to?: Date;
}

export interface ListQueryOptions {
    /** Field name used when the client sends none, or sends an unknown one. */
    defaultSort: string;
    defaultOrder?: "asc" | "desc";
    defaultLimit?: number;
    maxLimit?: number;
    /** Public field name → column. Only these are sortable. */
    sortable: Record<string, PgColumn<any>>;
}

/** Parse and clamp the standard list params off an Express request query. */
export function parseListParams(query: any, options: ListQueryOptions): ListParams {
    const maxLimit = options.maxLimit ?? 100;
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit as string) || options.defaultLimit || 25));

    const requested = typeof query.sort === "string" ? query.sort : "";
    const sort = Object.prototype.hasOwnProperty.call(options.sortable, requested)
        ? requested
        : options.defaultSort;

    const order: "asc" | "desc" =
        query.order === "asc" || query.order === "desc"
            ? query.order
            : (options.defaultOrder ?? "desc");

    const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";

    // Invalid dates are dropped rather than passed through as NaN, which would
    // silently match nothing.
    const parseDate = (value: unknown): Date | undefined => {
        if (typeof value !== "string" || !value) return undefined;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
    };

    const from = parseDate(query.from);
    let to = parseDate(query.to);

    // A bare date like "2026-08-16" parses to midnight, which would exclude the
    // whole of that day. Treat a date-only `to` as end-of-day so an admin picking
    // "16th to 16th" sees the 16th.
    if (to && typeof query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
        to = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
    }

    return { page, limit, offset: (page - 1) * limit, sort, order, q, from, to };
}

/** The ORDER BY expression for the validated sort field. */
export function buildOrderBy(params: ListParams, options: ListQueryOptions): SQL {
    const column = options.sortable[params.sort] ?? options.sortable[options.defaultSort];
    return params.order === "asc" ? asc(column) : desc(column);
}

/** Date-range conditions for a timestamp column, ready to spread into and(). */
export function dateRangeConditions(params: ListParams, column: PgColumn<any>): SQL[] {
    const conditions: SQL[] = [];
    if (params.from) conditions.push(gte(column, params.from));
    if (params.to) conditions.push(lte(column, params.to));
    return conditions;
}

/** Combine conditions, or undefined when there are none (Drizzle wants undefined, not TRUE). */
export function combine(conditions: (SQL | undefined)[]): SQL | undefined {
    const present = conditions.filter((c): c is SQL => !!c);
    if (present.length === 0) return undefined;
    if (present.length === 1) return present[0];
    return and(...present);
}

/** The pagination envelope every admin list endpoint returns. */
export function paginationMeta(params: ListParams, total: number) {
    return {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
        hasMore: params.page * params.limit < total,
    };
}
