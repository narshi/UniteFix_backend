/**
 * PHASE 7: Admin Service Management
 * 
 * Handles:
 * - View all service bookings with filters
 * - Assign/reassign technicians
 * - Force state transitions (admin override)
 * - Service lifecycle views
 * - Performance metrics
 * 
 * DOES NOT MODIFY: Wallet, billing, inventory, or state machine logic
 */

import { db } from "../db";
import { sql, eq, and, desc, gte, lte, inArray, count as sqlCount } from "drizzle-orm";
import { serviceRequests, employees, users, auditLogs, services as servicesCatalog, serviceCategories, serviceCategoryTechnicianTypes, employeeTechnicianTypes, technicianTypes } from "@shared/schema";
import { BookingNotifications } from "./booking-notifications";

interface ServiceFilters {
    status?: string;
    technicianId?: number;
    customerId?: number;
    startDate?: string;
    endDate?: string;
    pincode?: string;
}

export class AdminServiceManager {
    /**
     * Get all service bookings with pagination and filters
     */
    /** Columns the Service Requests table may be sorted by. */
    static readonly SORTABLE = {
        createdAt: serviceRequests.createdAt,
        serviceId: serviceRequests.serviceId,
        status: serviceRequests.status,
        totalAmount: serviceRequests.totalAmount,
        serviceType: serviceRequests.serviceType,
        updatedAt: serviceRequests.updatedAt,
        completedAt: serviceRequests.completedAt,
    };

    static async getServiceBookings(
        filters: ServiceFilters & { q?: string; from?: Date; to?: Date; orderBy?: any } = {},
        page: number = 1,
        limit: number = 20
    ): Promise<{ services: any[]; total: number; page: number; pages: number }> {
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions: any[] = [];

        if (filters.status) {
            conditions.push(eq(serviceRequests.status, filters.status as any));
        }

        if (filters.technicianId) {
            conditions.push(eq(serviceRequests.providerId, filters.technicianId));
        }

        if (filters.customerId) {
            conditions.push(eq(serviceRequests.userId, filters.customerId));
        }

        if (filters.pincode) {
            // Note: serviceRequests has 'address' but no 'pincode' column
            // Filter by address containing the pincode instead
            conditions.push(sql`${serviceRequests.address} ILIKE ${'%' + filters.pincode + '%'}`);
        }

        // Free text across the fields an admin actually searches by. Customer and
        // technician names live in joined tables, hence the subquery form — a
        // plain WHERE could not see them from the count query below.
        if (filters.q) {
            const term = `%${filters.q}%`;
            conditions.push(sql`(
                ${serviceRequests.serviceId} ILIKE ${term}
                OR ${serviceRequests.serviceType} ILIKE ${term}
                OR ${serviceRequests.brand} ILIKE ${term}
                OR ${serviceRequests.model} ILIKE ${term}
                OR ${serviceRequests.address} ILIKE ${term}
                OR EXISTS (SELECT 1 FROM users u WHERE u.id = ${serviceRequests.userId}
                           AND (u.username ILIKE ${term} OR u.phone ILIKE ${term}))
                OR EXISTS (SELECT 1 FROM employees e WHERE e.id = ${serviceRequests.providerId}
                           AND e.full_name ILIKE ${term})
            )`);
        }

        if (filters.from) conditions.push(gte(serviceRequests.createdAt, filters.from));
        if (filters.to) conditions.push(lte(serviceRequests.createdAt, filters.to));

        if (filters.startDate) {
            conditions.push(gte(serviceRequests.createdAt, new Date(filters.startDate)));
        }

        if (filters.endDate) {
            conditions.push(lte(serviceRequests.createdAt, new Date(filters.endDate)));
        }

        const [countRow] = await db
            .select({ c: sqlCount() })
            .from(serviceRequests)
            .where(conditions.length > 0 ? and(...conditions) : undefined);

        const total = Number(countRow?.c ?? 0);

        // Get services with customer and technician details
        const services = await db
            .select({
                id: serviceRequests.id,
                serviceId: serviceRequests.serviceId,
                customerName: users.username,
                customerPhone: users.phone,
                technicianName: employees.fullName,
                serviceType: serviceRequests.serviceType,
                brand: serviceRequests.brand,
                model: serviceRequests.model,
                description: serviceRequests.description,
                photos: serviceRequests.photos,
                status: serviceRequests.status,
                address: serviceRequests.address,
                // Financial fields — critical for billing accuracy
                bookingFee: serviceRequests.bookingFee,
                bookingFeeStatus: serviceRequests.bookingFeeStatus,
                totalAmount: serviceRequests.totalAmount,
                commissionAmount: serviceRequests.commissionAmount,
                pricingSnapshot: serviceRequests.pricingSnapshot,
                providerId: serviceRequests.providerId,
                createdAt: serviceRequests.createdAt,
                updatedAt: serviceRequests.updatedAt,
                assignedAt: serviceRequests.assignedAt,
                completedAt: serviceRequests.completedAt,
            })
            .from(serviceRequests)
            .leftJoin(users, eq(serviceRequests.userId, users.id))
            .leftJoin(employees, eq(serviceRequests.providerId, employees.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(filters.orderBy ?? desc(serviceRequests.createdAt))
            .limit(limit)
            .offset(offset);

        const pages = Math.ceil(total / limit);

        return { services, total, page, pages };
    }

    /**
     * Get service details with full history
     */
    static async getServiceDetails(serviceId: number): Promise<any> {
        const [service] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceId));

        if (!service) {
            throw new Error("Service not found");
        }

        // Get audit logs
        const logs = await db
            .select()
            .from(auditLogs)
            .where(
                and(
                    eq(auditLogs.entityType, "service_request"),
                    eq(auditLogs.entityId, serviceId)
                )
            )
            .orderBy(desc(auditLogs.createdAt));

        // Get customer details
        const [customer] = await db
            .select()
            .from(users)
            .where(eq(users.id, service.userId));

        // Get technician details if assigned
        let technician = null;
        if (service.providerId) {
            const [tech] = await db
                .select()
                .from(employees)
                .where(eq(employees.id, service.providerId));
            technician = tech;
        }

        return {
            service,
            customer,
            technician,
            history: logs,
        };
    }

    /**
     * Assign technician to service
     */
    static async assignTechnician(
        serviceId: number,
        technicianId: number,
        adminId: number
    ): Promise<any> {
        // Validate service exists
        const [service] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceId));

        if (!service) {
            throw new Error("Service not found");
        }

        // Validate technician exists and is active
        const [technician] = await db
            .select()
            .from(employees)
            .where(eq(employees.id, technicianId));

        if (!technician || !technician.isActive) {
            throw new Error("Service expert not found or inactive");
        }

        // Update service
        const [updated] = await db
            .update(serviceRequests)
            .set({
                providerId: technicianId,
                status: "assigned",
                assignedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(serviceRequests.id, serviceId))
            .returning();

        // Audit log
        await db.insert(auditLogs).values({
            entityType: "service_request",
            entityId: serviceId,
            action: "technician_assigned",
            fromState: service.status,
            toState: "assigned",
            changedBy: adminId,
            metadata: {
                technicianId,
                technicianName: technician.fullName,
                assignedBy: "admin",
            },
        });

        // Tell the expert they have a job and the customer who is coming.
        // Fire-and-forget: a push failure must not fail the assignment.
        void BookingNotifications.expertAssigned(serviceId, false);

        return updated;
    }

    /**
     * Reassign technician (admin override)
     */
    static async reassignTechnician(
        serviceId: number,
        newTechnicianId: number,
        reason: string,
        adminId: number
    ): Promise<any> {
        const [service] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceId));

        if (!service) {
            throw new Error("Service not found");
        }

        const oldTechnicianId = service.providerId;

        // Validate new technician
        const [newTech] = await db
            .select()
            .from(employees)
            .where(eq(employees.id, newTechnicianId));

        if (!newTech || !newTech.isActive) {
            throw new Error("New service expert not found or inactive");
        }

        // Update service
        const [updated] = await db
            .update(serviceRequests)
            .set({
                providerId: newTechnicianId,
                updatedAt: new Date(),
            })
            .where(eq(serviceRequests.id, serviceId))
            .returning();

        // Audit log
        await db.insert(auditLogs).values({
            entityType: "service_request",
            entityId: serviceId,
            action: "technician_reassigned",
            changedBy: adminId,
            metadata: {
                oldTechnicianId,
                newTechnicianId,
                reason,
                reassignedBy: "admin",
            },
        });

        // New expert + customer get the assignment notice; the outgoing expert
        // is told the job is no longer theirs so they don't travel to it.
        void BookingNotifications.expertAssigned(serviceId, true);
        if (oldTechnicianId && oldTechnicianId !== newTechnicianId) {
            void BookingNotifications.assignmentRevoked(oldTechnicianId, serviceId, reason);
        }

        return updated;
    }

    /**
     * Force state transition (admin override with reason)
     */
    static async forceStateTransition(
        serviceId: number,
        newState: string,
        reason: string,
        adminId: number
    ): Promise<any> {
        const [service] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceId));

        if (!service) {
            throw new Error("Service not found");
        }

        const oldState = service.status;

        // Update service
        const [updated] = await db
            .update(serviceRequests)
            .set({
                status: newState as any,
                updatedAt: new Date(),
            })
            .where(eq(serviceRequests.id, serviceId))
            .returning();

        // Audit log with admin override flag
        await db.insert(auditLogs).values({
            entityType: "service_request",
            entityId: serviceId,
            action: "admin_state_override",
            fromState: oldState,
            toState: newState,
            changedBy: adminId,
            metadata: {
                reason,
                override: true,
                bypassedGates: true,
            },
        });

        // An override is invisible to the app otherwise — the user's screen would
        // silently jump states on next refresh with no explanation.
        void BookingNotifications.forState(serviceId, newState, reason);

        return updated;
    }

    /**
     * Get service statistics
     */
    static async getServiceStats(startDate?: string, endDate?: string): Promise<any> {
        const conditions: any[] = [];

        if (startDate) {
            conditions.push(gte(serviceRequests.createdAt, new Date(startDate)));
        }

        if (endDate) {
            conditions.push(lte(serviceRequests.createdAt, new Date(endDate)));
        }

        const statsResult = await db.execute(sql`
      SELECT
        COUNT(*) as total_services,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'created' THEN 1 END) as pending,
        AVG(
          CASE WHEN status = 'completed' 
          THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600 
          END
        ) as avg_completion_hours
      FROM service_requests
      ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    `) as any;

        const statsRaw = Array.isArray(statsResult) ? statsResult : (statsResult?.rows || []);
        const stats = statsRaw?.[0];
        return stats;
    }

    /**
     * Get technician performance metrics
     */
    static async getTechnicianPerformance(technicianId: number): Promise<any> {
        const metricsResult = await db.execute(sql`
      SELECT
        COUNT(*) as total_services,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_services,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_services,
        AVG(
          CASE WHEN status = 'completed'
          THEN EXTRACT(EPOCH FROM (completed_at - assigned_at)) / 3600
          END
        ) as avg_service_hours
      FROM service_requests
      WHERE provider_id = ${technicianId}
    `) as any;
        const metricsRaw = Array.isArray(metricsResult) ? metricsResult : (metricsResult?.rows || []);
        const metrics = metricsRaw?.[0];

        // Get wallet balance
        const walletResult = await db.execute(sql`
      SELECT balance_hold, balance_available, total_earned
      FROM partner_wallets
      WHERE partner_id = ${technicianId}
    `) as any;
        const walletRaw = Array.isArray(walletResult) ? walletResult : (walletResult?.rows || []);
        const wallet = walletRaw?.[0];

        return {
            ...metrics,
            wallet: wallet || { balance_hold: 0, balance_available: 0, total_earned: 0 },
        };
    }

    /**
     * Get the full assignment queue payload for the admin Assignment Queue page.
     * Returns pending requests (with customer info), available employees (with workload), and stats.
     */
    static async getAssignmentQueue(): Promise<{
        queue: any[];
        employees: any[];
        stats: { totalPending: number; urgentCount: number; avgWaitHours: number; oldestHours: number };
    }> {
        const now = new Date();

        // 1. Get all unassigned service requests with customer info
        const pendingRequests = await db
            .select({
                id: serviceRequests.id,
                serviceId: serviceRequests.serviceId,
                serviceType: serviceRequests.serviceType,
                brand: serviceRequests.brand,
                model: serviceRequests.model,
                description: serviceRequests.description,
                photos: serviceRequests.photos,
                urgency: serviceRequests.urgency,
                address: serviceRequests.address,
                bookingFeeStatus: serviceRequests.bookingFeeStatus,
                createdAt: serviceRequests.createdAt,
                customerName: users.username,
                customerPhone: users.phone,
                categoryId: serviceCategories.id,
                categoryName: serviceCategories.name,
                serviceName: servicesCatalog.name,
            })
            .from(serviceRequests)
            .leftJoin(users, eq(serviceRequests.userId, users.id))
            .leftJoin(servicesCatalog, eq(servicesCatalog.id, serviceRequests.catalogServiceId))
            .leftJoin(serviceCategories, eq(serviceCategories.id, servicesCatalog.categoryId))
            .where(
                and(
                    eq(serviceRequests.status, 'created'),
                    eq(serviceRequests.bookingFeeStatus, 'paid')
                )
            )
            .orderBy(desc(serviceRequests.createdAt));

        // Calculate waiting hours for each request
        const queue = pendingRequests.map((req) => {
            const createdMs = req.createdAt ? new Date(req.createdAt).getTime() : now.getTime();
            const waitingHours = Math.round(((now.getTime() - createdMs) / (1000 * 60 * 60)) * 10) / 10;
            return { ...req, waitingHours };
        });

        // 2. Get all verified + active employees with active job counts
        const employeeRows = await db
            .select({
                id: employees.id,
                fullName: employees.fullName,
                partnerId: employees.partnerId,
                services: employees.services,
                isOnline: employees.isOnline,
                isActive: employees.isActive,
                totalServicesCompleted: employees.totalServicesCompleted,
                averageRating: employees.averageRating,
                userId: employees.userId,
            })
            .from(employees)
            .where(
                and(
                    eq(employees.documentVerificationStatus, 'verified'),
                    eq(employees.isActive, true),
                )
            );

        // Get active job counts per employee in a single query
        const activeJobCountsResult = await db.execute(sql`
            SELECT provider_id, COUNT(*) as active_count
            FROM service_requests
            WHERE provider_id IS NOT NULL
              AND status IN ('assigned', 'accepted', 'reached', 'in_progress')
            GROUP BY provider_id
        `) as any;

        const jobCountMap = new Map<number, number>();
        // db.execute returns { rows: [...] } in Drizzle/node-postgres
        const rows = Array.isArray(activeJobCountsResult) ? activeJobCountsResult : (activeJobCountsResult?.rows || []);
        for (const row of rows) {
            jobCountMap.set(row.provider_id, parseInt(row.active_count));
        }

        // Enrich employees with phone and active job count
        const enrichedEmployees = await Promise.all(
            employeeRows.map(async (emp) => {
                // Get phone from users table
                const [user] = await db
                    .select({ phone: users.phone })
                    .from(users)
                    .where(eq(users.id, emp.userId));

                return {
                    id: emp.id,
                    fullName: emp.fullName,
                    partnerId: emp.partnerId,
                    phone: user?.phone || '',
                    services: emp.services || [],
                    isOnline: emp.isOnline,
                    activeJobCount: jobCountMap.get(emp.id) || 0,
                    completedJobCount: emp.totalServicesCompleted || 0,
                    averageRating: emp.averageRating || '0.00',
                };
            })
        );

        // 2b. Attach expertise matching.
        //
        // The queue UI used to compare an employee’s trade names against the
        // booking’s serviceType (a catalog SERVICE name), which are different
        // vocabularies, so nothing ever matched. Both sides are now resolved
        // through technician type IDS via the category mapping.
        //
        // Two small lookups for the whole page rather than one per row — both
        // tables are tiny (a handful of trades per category).
        const categoryTypeRows = await db
            .select({
                categoryId: serviceCategoryTechnicianTypes.categoryId,
                typeId: serviceCategoryTechnicianTypes.technicianTypeId,
                typeName: technicianTypes.name,
            })
            .from(serviceCategoryTechnicianTypes)
            .innerJoin(technicianTypes, eq(technicianTypes.id, serviceCategoryTechnicianTypes.technicianTypeId));

        const employeeTypeRows = await db
            .select({
                employeeId: employeeTechnicianTypes.employeeId,
                typeId: employeeTechnicianTypes.technicianTypeId,
            })
            .from(employeeTechnicianTypes);

        const typesByCategory = new Map<number, { ids: number[]; names: string[] }>();
        for (const r of categoryTypeRows) {
            const entry = typesByCategory.get(r.categoryId) ?? { ids: [], names: [] };
            entry.ids.push(r.typeId);
            entry.names.push(r.typeName);
            typesByCategory.set(r.categoryId, entry);
        }

        const typesByEmployee = new Map<number, number[]>();
        for (const r of employeeTypeRows) {
            typesByEmployee.set(r.employeeId, [...(typesByEmployee.get(r.employeeId) ?? []), r.typeId]);
        }

        const queueWithExpertise = queue.map((r) => {
            const mapped = r.categoryId != null ? typesByCategory.get(r.categoryId) : undefined;
            return {
                ...r,
                // Empty means unrestricted — either the booking carries no catalog
                // service, or the category has no trades mapped. The client must
                // treat that as “everyone qualifies”, never “nobody does”.
                requiredTechnicianTypeIds: mapped?.ids ?? [],
                requiredTechnicianTypeNames: mapped?.names ?? [],
            };
        });

        const employeesWithTypes = enrichedEmployees.map((e) => ({
            ...e,
            technicianTypeIds: typesByEmployee.get(e.id) ?? [],
        }));

        // 3. Compute stats
        const totalPending = queue.length;
        const urgentCount = queue.filter((r) => r.urgency === 'urgent').length;
        const avgWaitHours = totalPending > 0
            ? Math.round((queue.reduce((sum, r) => sum + r.waitingHours, 0) / totalPending) * 10) / 10
            : 0;
        const oldestHours = totalPending > 0
            ? Math.max(...queue.map((r) => r.waitingHours))
            : 0;

        return {
            queue: queueWithExpertise,
            employees: employeesWithTypes,
            stats: { totalPending, urgentCount, avgWaitHours, oldestHours },
        };
    }
}
