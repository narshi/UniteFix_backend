/**
 * Which experts are suitable for a booking.
 *
 * The assignment queue used to compare `employees.services` (trade names, e.g.
 * "Computer Technician") against `service_requests.service_type` (catalog
 * service names, e.g. "CCTV Installation"). Those are different vocabularies,
 * so the comparison never matched and every expert looked equally suitable.
 *
 * The real chain is:
 *
 *   service_request.catalog_service_id
 *     -> services.category_id
 *     -> service_category_technician_types
 *     -> employee_technician_types
 *     -> employees
 *
 * DELIBERATELY ADVISORY. This returns a set of "recommended" ids; it does not
 * decide who may be assigned. Admins must stay able to dispatch anyone — on the
 * night nobody with the right trade is free, a hard filter would leave the job
 * unassignable. The UI ranks on this and warns; the assign endpoint does not
 * reject.
 *
 * Two cases mean "no restriction known", and both keep EVERY expert eligible
 * rather than none:
 *   - the booking has no catalog_service_id (older bookings, manual entries)
 *   - the category has no trades mapped (Professional & Property, Transport,
 *     Events, Specialized — lawyers and caterers have no technician type)
 */

import { db } from "../db";
import { eq, inArray, sql } from "drizzle-orm";
import {
    services as servicesCatalog,
    serviceCategories,
    serviceCategoryTechnicianTypes,
    employeeTechnicianTypes,
    technicianTypes,
    serviceRequests,
} from "@shared/schema";

export interface ExpertiseMatch {
    /** Category the booking resolved to, when it could be resolved. */
    categoryId: number | null;
    categoryName: string | null;
    /** Trades that can work this category. Empty means unrestricted. */
    technicianTypeIds: number[];
    technicianTypeNames: string[];
    /**
     * employees.id considered a match. Null (not empty!) means "no restriction
     * applies" — callers must treat that as "everyone", never as "nobody".
     */
    recommendedEmployeeIds: number[] | null;
}

const UNRESTRICTED: ExpertiseMatch = {
    categoryId: null,
    categoryName: null,
    technicianTypeIds: [],
    technicianTypeNames: [],
    recommendedEmployeeIds: null,
};

/** Trades mapped to a category, in display order. */
export async function getCategoryTechnicianTypes(categoryId: number) {
    return db
        .select({
            id: technicianTypes.id,
            name: technicianTypes.name,
            isActive: technicianTypes.isActive,
        })
        .from(serviceCategoryTechnicianTypes)
        .innerJoin(
            technicianTypes,
            eq(technicianTypes.id, serviceCategoryTechnicianTypes.technicianTypeId),
        )
        .where(eq(serviceCategoryTechnicianTypes.categoryId, categoryId))
        .orderBy(technicianTypes.sortOrder, technicianTypes.name);
}

/**
 * Resolve the trades and matching experts for one booking.
 * `catalogServiceId` may be passed directly to save a lookup.
 */
export async function resolveExpertiseForRequest(
    serviceRequestId: number,
    catalogServiceId?: number | null,
): Promise<ExpertiseMatch> {
    let catalogId = catalogServiceId ?? null;

    if (catalogId == null) {
        const [row] = await db
            .select({ catalogServiceId: serviceRequests.catalogServiceId })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceRequestId))
            .limit(1);
        catalogId = row?.catalogServiceId ?? null;
    }

    if (catalogId == null) return UNRESTRICTED;

    const [cat] = await db
        .select({ id: serviceCategories.id, name: serviceCategories.name })
        .from(servicesCatalog)
        .innerJoin(serviceCategories, eq(serviceCategories.id, servicesCatalog.categoryId))
        .where(eq(servicesCatalog.id, catalogId))
        .limit(1);

    if (!cat) return UNRESTRICTED;

    const trades = await getCategoryTechnicianTypes(cat.id);
    if (trades.length === 0) {
        return { ...UNRESTRICTED, categoryId: cat.id, categoryName: cat.name };
    }

    const typeIds = trades.map((t) => t.id);

    const matches = await db
        .selectDistinct({ employeeId: employeeTechnicianTypes.employeeId })
        .from(employeeTechnicianTypes)
        .where(inArray(employeeTechnicianTypes.technicianTypeId, typeIds));

    return {
        categoryId: cat.id,
        categoryName: cat.name,
        technicianTypeIds: typeIds,
        technicianTypeNames: trades.map((t) => t.name),
        recommendedEmployeeIds: matches.map((m) => m.employeeId),
    };
}

/**
 * Replace a category's trade mapping wholesale.
 * Runs in a transaction so a failed write cannot leave the category half-mapped
 * — an empty mapping means "unrestricted", so a partial delete would silently
 * widen assignment rather than fail loudly.
 */
export async function setCategoryTechnicianTypes(
    categoryId: number,
    technicianTypeIds: number[],
): Promise<number[]> {
    const unique = Array.from(new Set(technicianTypeIds.filter((n) => Number.isInteger(n) && n > 0)));

    return db.transaction(async (tx) => {
        await tx
            .delete(serviceCategoryTechnicianTypes)
            .where(eq(serviceCategoryTechnicianTypes.categoryId, categoryId));

        if (unique.length > 0) {
            // Ignore ids that do not exist rather than failing the whole save on
            // one stale checkbox from a page open since before a trade was deleted.
            const valid = await tx
                .select({ id: technicianTypes.id })
                .from(technicianTypes)
                .where(inArray(technicianTypes.id, unique));

            if (valid.length > 0) {
                await tx.insert(serviceCategoryTechnicianTypes).values(
                    valid.map((t) => ({ categoryId, technicianTypeId: t.id })),
                );
                return valid.map((t) => t.id);
            }
        }
        return [];
    });
}

/**
 * Keep employee_technician_types in step with the trade NAMES an expert picked.
 *
 * employees.services remains the display copy every existing reader uses; this
 * mirrors it into ids so a later rename in the admin CRUD page cannot detach
 * the expert from their trade.
 */
export async function syncEmployeeTechnicianTypes(
    employeeId: number,
    tradeNames: string[],
): Promise<number[]> {
    const names = tradeNames.map((n) => n.trim()).filter(Boolean);

    return db.transaction(async (tx) => {
        await tx
            .delete(employeeTechnicianTypes)
            .where(eq(employeeTechnicianTypes.employeeId, employeeId));

        if (names.length === 0) return [];

        const rows = await tx
            .select({ id: technicianTypes.id })
            .from(technicianTypes)
            .where(inArray(sql`lower(${technicianTypes.name})`, names.map((n) => n.toLowerCase())));

        if (rows.length === 0) return [];

        await tx.insert(employeeTechnicianTypes).values(
            rows.map((t) => ({ employeeId, technicianTypeId: t.id })),
        );
        return rows.map((t) => t.id);
    });
}
