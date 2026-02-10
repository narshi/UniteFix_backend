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
import { sql, eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { serviceRequests, serviceProviders, users, auditLogs } from "@shared/schema";

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
    static async getServiceBookings(
        filters: ServiceFilters = {},
        page: number = 1,
        limit: number = 20
    ): Promise<{ services: any[]; total: number; page: number; pages: number }> {
        const offset = (page - 1) * limit;

        // Build where conditions
        const conditions: any[] = [];

        if (filters.status) {
            conditions.push(eq(serviceRequests.status, filters.status));
        }

        if (filters.technicianId) {
            conditions.push(eq(serviceRequests.providerId, filters.technicianId));
        }

        if (filters.customerId) {
            conditions.push(eq(serviceRequests.userId, filters.customerId));
        }

        if (filters.pincode) {
            conditions.push(eq(serviceRequests.pincode, filters.pincode));
        }

        if (filters.startDate) {
            conditions.push(gte(serviceRequests.createdAt, new Date(filters.startDate)));
        }

        if (filters.endDate) {
            conditions.push(lte(serviceRequests.createdAt, new Date(filters.endDate)));
        }

        // Get total count
        const [countResult] = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM service_requests
      ${conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``}
    `);

        const total = parseInt(countResult?.count || "0");

        // Get services with customer and technician details
        const services = await db
            .select({
                id: serviceRequests.id,
                serviceId: serviceRequests.serviceId,
                customerName: users.name,
                customerPhone: users.phone,
                technicianName: sql`sp.user_id`, // Will join to get technician name
                serviceType: serviceRequests.serviceType,
                status: serviceRequests.status,
                address: serviceRequests.address,
                pincode: serviceRequests.pincode,
                createdAt: serviceRequests.createdAt,
                assignedAt: serviceRequests.assignedAt,
                completedAt: serviceRequests.completedAt,
            })
            .from(serviceRequests)
            .leftJoin(users, eq(serviceRequests.userId, users.id))
            .leftJoin(serviceProviders, eq(serviceRequests.providerId, serviceProviders.id))
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(serviceRequests.createdAt))
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
                .from(serviceProviders)
                .where(eq(serviceProviders.id, service.providerId));
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
            .from(serviceProviders)
            .where(eq(serviceProviders.id, technicianId));

        if (!technician || !technician.isActive) {
            throw new Error("Technician not found or inactive");
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
                technicianName: technician.userId, // Would need to join to get name
                assignedBy: "admin",
            },
        });

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
            .from(serviceProviders)
            .where(eq(serviceProviders.id, newTechnicianId));

        if (!newTech || !newTech.isActive) {
            throw new Error("New technician not found or inactive");
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
                status: newState,
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

        const [stats] = await db.execute(sql`
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
    `);

        return stats;
    }

    /**
     * Get technician performance metrics
     */
    static async getTechnicianPerformance(technicianId: number): Promise<any> {
        const [metrics] = await db.execute(sql`
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
    `);

        // Get wallet balance
        const [wallet] = await db.execute(sql`
      SELECT balance_hold, balance_available, total_earned
      FROM partner_wallets
      WHERE partner_id = ${technicianId}
    `);

        return {
            ...metrics,
            wallet: wallet || { balance_hold: 0, balance_available: 0, total_earned: 0 },
        };
    }
}
