/**
 * PHASE 10: Payment Tracking Service
 * 
 * Records every payment event (Razorpay order creation, capture, failure, refund)
 * into the paymentTransactions table for complete financial audit trail.
 * 
 * Also handles Razorpay refund initiation and status checking.
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { paymentTransactions, refunds, returnRequests, productOrders } from "@shared/schema";
import type { InsertPaymentTransaction, PaymentTransaction, InsertRefund, Refund } from "@shared/schema";
import Razorpay from "razorpay";
import { configService } from "./config.service";
import crypto from "crypto";

function generateRefundId(): string {
    return `REF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export class PaymentTrackingService {

    private static async getRazorpayInstance(): Promise<Razorpay> {
        const keyId = await configService.get('RAZORPAY_KEY_ID') || process.env.RAZORPAY_KEY_ID || '';
        const keySecret = await configService.get('RAZORPAY_KEY_SECRET') || process.env.RAZORPAY_KEY_SECRET || '';
        return new Razorpay({ key_id: keyId, key_secret: keySecret });
    }

    /**
     * Record a payment event (order_created, payment_captured, payment_failed, etc.)
     */
    static async recordPaymentEvent(data: {
        orderId?: string;
        serviceRequestId?: number;
        razorpayOrderId?: string;
        razorpayPaymentId?: string;
        amount: number;
        currency?: string;
        eventType: 'order_created' | 'payment_captured' | 'payment_failed' | 'refund_initiated' | 'refund_processed' | 'refund_failed';
        status: 'pending' | 'captured' | 'failed' | 'refunded';
        method?: string;
        metadata?: any;
    }): Promise<PaymentTransaction> {
        const [tx] = await db.insert(paymentTransactions).values({
            orderId: data.orderId || null,
            serviceRequestId: data.serviceRequestId || null,
            razorpayOrderId: data.razorpayOrderId || null,
            razorpayPaymentId: data.razorpayPaymentId || null,
            amount: data.amount,
            currency: data.currency || 'INR',
            eventType: data.eventType,
            status: data.status,
            method: data.method || null,
            metadata: data.metadata || null,
        }).returning();
        return tx;
    }

    /**
     * Get all payment transactions for a product order
     */
    static async getTransactionsByOrder(orderId: string): Promise<PaymentTransaction[]> {
        return db.select()
            .from(paymentTransactions)
            .where(eq(paymentTransactions.orderId, orderId))
            .orderBy(desc(paymentTransactions.createdAt));
    }

    /**
     * Get all payment transactions for a service request
     */
    static async getTransactionsByService(serviceRequestId: number): Promise<PaymentTransaction[]> {
        return db.select()
            .from(paymentTransactions)
            .where(eq(paymentTransactions.serviceRequestId, serviceRequestId))
            .orderBy(desc(paymentTransactions.createdAt));
    }

    /**
     * Get paginated transaction list for admin dashboard
     */
    static async getTransactions(
        filters: {
            status?: string;
            eventType?: string;
            page?: number;
            limit?: number;
        } = {}
    ): Promise<{ transactions: PaymentTransaction[]; total: number; page: number; pages: number }> {
        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const offset = (page - 1) * limit;

        // Build conditions
        const conditions: any[] = [];
        if (filters.status) {
            conditions.push(eq(paymentTransactions.status, filters.status as any));
        }
        if (filters.eventType) {
            conditions.push(eq(paymentTransactions.eventType, filters.eventType as any));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [transactions, countResult] = await Promise.all([
            db.select()
                .from(paymentTransactions)
                .where(whereClause)
                .orderBy(desc(paymentTransactions.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(paymentTransactions)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count || 0;

        return {
            transactions,
            total,
            page,
            pages: Math.ceil(total / limit),
        };
    }

    /**
     * Initiate a Razorpay refund for a return request
     * Records the refund in both Razorpay and local database
     */
    static async initiateRefund(data: {
        returnRequestId: number;
        razorpayPaymentId: string;
        amount: number; // In paise
        reason?: string;
        adminId: number;
    }): Promise<Refund> {
        const razorpay = await this.getRazorpayInstance();

        try {
            // Create refund in Razorpay
            const razorpayRefund = await razorpay.payments.refund(data.razorpayPaymentId, {
                amount: data.amount,
                notes: {
                    reason: data.reason || 'Customer return approved',
                    return_request_id: data.returnRequestId.toString(),
                },
            });

            // Find the original payment transaction
            const [originalTx] = await db.select()
                .from(paymentTransactions)
                .where(eq(paymentTransactions.razorpayPaymentId, data.razorpayPaymentId))
                .limit(1);

            // Record refund event in payment transactions
            await this.recordPaymentEvent({
                orderId: originalTx?.orderId || undefined,
                serviceRequestId: originalTx?.serviceRequestId || undefined,
                razorpayOrderId: originalTx?.razorpayOrderId || undefined,
                razorpayPaymentId: data.razorpayPaymentId,
                amount: data.amount,
                eventType: 'refund_initiated',
                status: 'refunded',
                metadata: razorpayRefund,
            });

            // Create refund record
            const [refund] = await db.insert(refunds).values({
                refundId: generateRefundId(),
                paymentTransactionId: originalTx?.id || null,
                returnRequestId: data.returnRequestId,
                razorpayRefundId: razorpayRefund.id,
                razorpayPaymentId: data.razorpayPaymentId,
                amount: data.amount,
                status: razorpayRefund.status === 'processed' ? 'processed' : 'initiated',
                reason: data.reason || 'Customer return approved',
                initiatedBy: data.adminId,
                processedAt: razorpayRefund.status === 'processed' ? new Date() : null,
                metadata: razorpayRefund,
            }).returning();

            return refund;
        } catch (error: any) {
            // Record failed refund event
            await this.recordPaymentEvent({
                razorpayPaymentId: data.razorpayPaymentId,
                amount: data.amount,
                eventType: 'refund_failed',
                status: 'failed',
                metadata: { error: error.message },
            });

            throw new Error(`Refund failed: ${error.message}`);
        }
    }

    /**
     * Get refund status from Razorpay and update local record
     */
    static async checkRefundStatus(refundId: number): Promise<Refund> {
        const [refund] = await db.select()
            .from(refunds)
            .where(eq(refunds.id, refundId))
            .limit(1);

        if (!refund) {
            throw new Error("Refund not found");
        }

        if (refund.status === 'processed') {
            return refund; // Already processed
        }

        if (!refund.razorpayRefundId || !refund.razorpayPaymentId) {
            return refund;
        }

        try {
            const razorpay = await this.getRazorpayInstance();
            const razorpayRefund = await razorpay.payments.fetchRefund(
                refund.razorpayPaymentId,
                refund.razorpayRefundId
            );

            if (razorpayRefund.status === 'processed' && (refund.status as string) !== 'processed') {
                const [updated] = await db.update(refunds)
                    .set({
                        status: 'processed',
                        processedAt: new Date(),
                        metadata: razorpayRefund,
                        updatedAt: new Date(),
                    })
                    .where(eq(refunds.id, refundId))
                    .returning();

                // Record refund processed event
                await this.recordPaymentEvent({
                    razorpayPaymentId: refund.razorpayPaymentId,
                    amount: refund.amount,
                    eventType: 'refund_processed',
                    status: 'refunded',
                    metadata: razorpayRefund,
                });

                return updated;
            }

            return refund;
        } catch (error: any) {
            throw new Error(`Failed to check refund status: ${error.message}`);
        }
    }

    /**
     * Get all refunds for a return request
     */
    static async getRefundsByReturnRequest(returnRequestId: number): Promise<Refund[]> {
        return db.select()
            .from(refunds)
            .where(eq(refunds.returnRequestId, returnRequestId))
            .orderBy(desc(refunds.createdAt));
    }

    /**
     * Get all refunds (admin paginated)
     */
    static async getRefunds(
        page: number = 1,
        limit: number = 20,
        status?: string
    ): Promise<{ refunds: Refund[]; total: number; page: number; pages: number }> {
        const offset = (page - 1) * limit;
        const whereClause = status ? eq(refunds.status, status as any) : undefined;

        const [refundsList, countResult] = await Promise.all([
            db.select()
                .from(refunds)
                .where(whereClause)
                .orderBy(desc(refunds.createdAt))
                .limit(limit)
                .offset(offset),
            db.select({ count: sql<number>`count(*)::int` })
                .from(refunds)
                .where(whereClause),
        ]);

        const total = countResult[0]?.count || 0;

        return {
            refunds: refundsList,
            total,
            page,
            pages: Math.ceil(total / limit),
        };
    }
}
