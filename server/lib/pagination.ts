/**
 * Database-Level Pagination Utility
 * 
 * Provides SQL-level LIMIT/OFFSET pagination rather than loading all records
 * into memory and slicing. Critical for mobile app performance.
 * 
 * Usage:
 *   const result = await paginateQuery(
 *     db.select().from(users).where(eq(users.isActive, true)),
 *     db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isActive, true)),
 *     { page: 1, limit: 20 }
 *   );
 */

export interface PaginationParams {
    page: number;
    limit: number;
}

export interface PaginatedResult<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}

/**
 * Parse pagination params from query string with defaults and bounds.
 */
export function parsePaginationParams(query: Record<string, any>): PaginationParams {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 20));
    return { page, limit };
}

/**
 * Build a paginated result from data array and total count.
 * Use this when the query has already been executed with LIMIT/OFFSET.
 */
export function buildPaginatedResult<T>(
    data: T[],
    total: number,
    params: PaginationParams
): PaginatedResult<T> {
    const pages = Math.ceil(total / params.limit);
    return {
        data,
        pagination: {
            page: params.page,
            limit: params.limit,
            total,
            pages,
            hasNext: params.page < pages,
            hasPrev: params.page > 1,
        },
    };
}

/**
 * Calculate SQL OFFSET from page and limit.
 */
export function getOffset(params: PaginationParams): number {
    return (params.page - 1) * params.limit;
}
