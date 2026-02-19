/**
 * PHASE 10: Return & Exchange Service
 * 
 * Handles:
 * - Customer return/exchange requests (1-day window from delivery)
 * - Admin approval/rejection
 * - Return shipment tracking
 * - Refund initiation via PaymentTrackingService
 * - Exchange order creation
 * 
 * Business Rules:
 * - Return/exchange window: 1 day from delivery
 * - Full refund on approved returns (admin can set partial amount)
 * - Exchanges create new order at no extra cost
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import {
    returnRequests,
    productOrders,
    paymentTransactions,
    auditLogs,
} from "@shared/schema";
import type { ReturnRequest, InsertReturnRequest } from "@shared/schema";
import { PaymentTrackingService } from "./payment-tracking.service";

const RETURN_WINDOW_HOURS = 24; // 1 day

function generateRequestId(): string {
    return `RET-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export class ReturnService {

    /**
     * Create a return or exchange request
     * Validates: order exists, belongs to user, is delivered, within 1-day window
     */
    static async createReturnRequest(data: {
        orderId: string;
        userId: number;
        type: 'return' | 'exchange';
        reason: 'defective' | 'wrong_item' | 'not_as_described' | 'size_issue' | 'changed_mind' | 'other';
        description?: string;
        photos?: string[];
    }): Promise<ReturnRequest> {
        // 1. Check order exists and belongs to user
        const [order] = await db.select()
            .from(productOrders)
            .where(and(
                eq(productOrders.orderId, data.orderId),
                eq(productOrders.userId, data.userId)
            ))
            .limit(1);

        if (!order) {
            throw new Error("Order not found or does not belong to you");
        }

        // 2. Check order is in delivered status
        if (order.status !== 'delivered') {
            throw new Error(`Cannot request ${data.type} for order in '${order.status}' status. Order must be 'delivered'.`);
        }

        // 3. Check return window (1 day from delivery/updatedAt)
        const deliveredAt = order.updatedAt || order.createdAt;
        if (!deliveredAt) {
            throw new Error("Unable to determine delivery date");
        }

        const returnWindowEnd = new Date(deliveredAt.getTime() + RETURN_WINDOW_HOURS * 60 * 60 * 1000);
        const now = new Date();

        if (now > returnWindowEnd) {
            throw new Error(`${data.type === 'return' ? 'Return' : 'Exchange'} window has expired. Requests must be made within ${RETURN_WINDOW_HOURS} hours of delivery.`);
        }

        // 4. Check no existing active return request for this order
        const [existing] = await db.select()
            .from(returnRequests)
            .where(and(
                eq(returnRequests.orderId, data.orderId),
                sql`${returnRequests.status} NOT IN ('rejected', 'closed')`
            ))
            .limit(1);

        if (existing) {
            throw new Error(`An active ${existing.type} request (${existing.requestId}) already exists for this order`);
        }

        // 5. Create return request
        const [request] = await db.insert(returnRequests).values({
            requestId: generateRequestId(),
            orderId: data.orderId,
            userId: data.userId,
            type: data.type,
            reason: data.reason,
            description: data.description || null,
            photos: data.photos || null,
            status: 'requested',
            deliveredAt: deliveredAt,
            returnWindowExpiresAt: returnWindowEnd,
        }).returning();

        // 6. Update order status
        const newStatus = data.type === 'return' ? 'return_requested' : 'exchange_requested';
        await db.update(productOrders)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(productOrders.orderId, data.orderId));

        // 7. Audit log
        await db.insert(auditLogs).values({
            entityType: 'product_order',
            entityId: order.id,
            action: `${data.type}_requested`,
            fromState: 'delivered',
            toState: newStatus,
            changedBy: data.userId,
            metadata: { requestId: request.requestId, reason: data.reason },
        });

        return request;
    }

    /**
     * Admin approves a return/exchange request
     */
    static async approveReturn(requestId: number, adminId: number, refundAmount?: number): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, requestId))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        if (request.status !== 'requested') {
            throw new Error(`Cannot approve request in '${request.status}' status`);
        }

        // Get order for the total amount (default refund = full order amount)
        const [order] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, request.orderId))
            .limit(1);

        const finalRefundAmount = refundAmount || order?.totalAmount || 0;

        const [updated] = await db.update(returnRequests)
            .set({
                status: 'approved',
                refundAmount: finalRefundAmount,
                approvedBy: adminId,
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Update order status
        const newStatus = request.type === 'return' ? 'return_approved' : 'exchange_approved';
        await db.update(productOrders)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        // Audit log
        if (order) {
            await db.insert(auditLogs).values({
                entityType: 'product_order',
                entityId: order.id,
                action: `${request.type}_approved`,
                fromState: request.type === 'return' ? 'return_requested' : 'exchange_requested',
                toState: newStatus,
                changedBy: adminId,
                metadata: { requestId: request.requestId, refundAmount: finalRefundAmount },
            });
        }

        return updated;
    }

    /**
     * Admin rejects a return/exchange request
     */
    static async rejectReturn(requestId: number, adminId: number, remarks: string): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, requestId))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        if (request.status !== 'requested') {
            throw new Error(`Cannot reject request in '${request.status}' status`);
        }

        const [updated] = await db.update(returnRequests)
            .set({
                status: 'rejected',
                adminRemarks: remarks,
                approvedBy: adminId,
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Revert order status back to delivered
        await db.update(productOrders)
            .set({ status: 'return_rejected', updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        // Audit log
        const [order] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, request.orderId))
            .limit(1);

        if (order) {
            await db.insert(auditLogs).values({
                entityType: 'product_order',
                entityId: order.id,
                action: `${request.type}_rejected`,
                fromState: request.type === 'return' ? 'return_requested' : 'exchange_requested',
                toState: 'return_rejected',
                changedBy: adminId,
                metadata: { requestId: request.requestId, remarks },
            });
        }

        return updated;
    }

    /**
     * Customer marks return as shipped (provides waybill)
     */
    static async markReturnShipped(requestId: number, userId: number, waybill: string): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(and(
                eq(returnRequests.id, requestId),
                eq(returnRequests.userId, userId)
            ))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found or does not belong to you");
        }

        if (request.status !== 'approved') {
            throw new Error(`Cannot mark as shipped in '${request.status}' status. Must be 'approved'.`);
        }

        const [updated] = await db.update(returnRequests)
            .set({
                status: 'shipped',
                returnWaybill: waybill,
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Update order status
        await db.update(productOrders)
            .set({ status: 'return_shipped', updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        return updated;
    }

    /**
     * Admin marks return as received at warehouse
     */
    static async markReturnReceived(requestId: number, adminId: number): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, requestId))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        if (request.status !== 'shipped') {
            throw new Error(`Cannot mark as received in '${request.status}' status. Must be 'shipped'.`);
        }

        const [updated] = await db.update(returnRequests)
            .set({
                status: 'received',
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Update order status
        await db.update(productOrders)
            .set({ status: 'return_received', updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        // Audit log
        const [order] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, request.orderId))
            .limit(1);

        if (order) {
            await db.insert(auditLogs).values({
                entityType: 'product_order',
                entityId: order.id,
                action: 'return_received',
                fromState: 'return_shipped',
                toState: 'return_received',
                changedBy: adminId,
                metadata: { requestId: request.requestId, waybill: request.returnWaybill },
            });
        }

        return updated;
    }

    /**
     * Admin initiates refund for a return request
     * Calls Razorpay refund API via PaymentTrackingService
     */
    static async initiateRefund(requestId: number, adminId: number): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, requestId))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        if (request.status !== 'received' && request.status !== 'approved') {
            throw new Error(`Cannot initiate refund in '${request.status}' status. Must be 'received' or 'approved'.`);
        }

        if (!request.refundAmount) {
            throw new Error("Refund amount not set. Approve the return first and set a refund amount.");
        }

        // Find the original payment for this order
        const [originalPayment] = await db.select()
            .from(paymentTransactions)
            .where(and(
                eq(paymentTransactions.orderId, request.orderId),
                eq(paymentTransactions.status, 'captured')
            ))
            .limit(1);

        if (!originalPayment || !originalPayment.razorpayPaymentId) {
            throw new Error("Original payment not found for this order. Cannot process refund.");
        }

        // Initiate Razorpay refund
        const refund = await PaymentTrackingService.initiateRefund({
            returnRequestId: requestId,
            razorpayPaymentId: originalPayment.razorpayPaymentId,
            amount: request.refundAmount,
            reason: `Return request ${request.requestId}: ${request.reason}`,
            adminId,
        });

        // Update return request status
        const [updated] = await db.update(returnRequests)
            .set({
                status: 'refund_initiated',
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Update order status
        await db.update(productOrders)
            .set({ status: 'refund_initiated', updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        // Audit log
        const [order] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, request.orderId))
            .limit(1);

        if (order) {
            await db.insert(auditLogs).values({
                entityType: 'product_order',
                entityId: order.id,
                action: 'refund_initiated',
                fromState: request.status,
                toState: 'refund_initiated',
                changedBy: adminId,
                metadata: {
                    requestId: request.requestId,
                    refundAmount: request.refundAmount,
                    refundId: refund.refundId,
                },
            });
        }

        return updated;
    }

    /**
     * Admin processes an exchange — creates replacement order
     */
    static async processExchange(requestId: number, adminId: number, replacementOrderId?: string): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, requestId))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        if (request.type !== 'exchange') {
            throw new Error("This is not an exchange request");
        }

        if (request.status !== 'received' && request.status !== 'approved') {
            throw new Error(`Cannot process exchange in '${request.status}' status`);
        }

        const [updated] = await db.update(returnRequests)
            .set({
                status: 'exchanged',
                replacementOrderId: replacementOrderId || null,
                updatedAt: new Date(),
            })
            .where(eq(returnRequests.id, requestId))
            .returning();

        // Update order status
        await db.update(productOrders)
            .set({ status: 'exchange_shipped', updatedAt: new Date() })
            .where(eq(productOrders.orderId, request.orderId));

        // Audit log
        const [order] = await db.select()
            .from(productOrders)
            .where(eq(productOrders.orderId, request.orderId))
            .limit(1);

        if (order) {
            await db.insert(auditLogs).values({
                entityType: 'product_order',
                entityId: order.id,
                action: 'exchange_processed',
                fromState: request.status,
                toState: 'exchange_shipped',
                changedBy: adminId,
                metadata: { requestId: request.requestId, replacementOrderId },
            });
        }

        return updated;
    }

    /**
     * Get return request status (for customer)
     */
    static async getReturnStatus(orderId: string, userId: number): Promise<ReturnRequest | null> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(and(
                eq(returnRequests.orderId, orderId),
                eq(returnRequests.userId, userId)
            ))
            .orderBy(desc(returnRequests.createdAt))
            .limit(1);

        return request || null;
    }

    /**
     * Get all return requests (admin, paginated)
     */
    static async getReturnRequests(
        filters: {
            status?: string;
            type?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ requests: ReturnRequest[]; total: number; page: number; pages: number }> {
        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const offset = (page - 1) * limit;

        const conditions: any[] = [];
        if (filters.status) {
            conditions.push(eq(returnRequests.status, filters.status as any));
        }
        if (filters.type) {
            conditions.push(eq(returnRequests.type, filters.type as any));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [requests, countResult] = await Promise.all([
            db.select()
                .from(returnRequests)
                .where(whereClause)
                .orderBy(desc(returnRequests.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(returnRequests)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count || 0;

        return {
            requests,
            total,
            page,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Get return request details (admin)
     */
    static async getReturnRequestById(id: number): Promise<ReturnRequest> {
        const [request] = await db.select()
            .from(returnRequests)
            .where(eq(returnRequests.id, id))
            .limit(1);

        if (!request) {
            throw new Error("Return request not found");
        }

        return request;
    }
}
