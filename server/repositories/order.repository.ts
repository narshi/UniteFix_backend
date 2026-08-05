/**
 * Order & Invoice Repository
 * Extracted from storage.ts — product orders, invoices, OTP verification
 */

import { db } from "../db";
import {
    productOrders, invoices, otpVerifications,
    type ProductOrder, type InsertProductOrder,
    type Invoice, type InsertInvoice,
    type OtpVerification, type InsertOtpVerification,
} from "@shared/schema";
import { eq, and, desc, gte, count } from "drizzle-orm";
import { nextSequentialNumber } from "../lib/sequential-id";

// ==================== PRODUCT ORDERS ====================

export async function createProductOrder(insertOrder: InsertProductOrder): Promise<ProductOrder> {
    // Max-based id (not count) so deletions can't cause a unique collision.
    let next = await nextSequentialNumber('product_orders', 'order_id', 'ORD');
    for (let attempt = 0; attempt < 6; attempt++) {
        const orderId = `ORD${String(next).padStart(6, '0')}`;
        try {
            const [order] = await db.insert(productOrders).values({ ...insertOrder, orderId }).returning();
            return order;
        } catch (err: any) {
            if (err?.code === '23505') { next++; continue; }
            throw err;
        }
    }
    throw new Error('Could not allocate a unique order id after several attempts');
}

export async function getProductOrder(id: number): Promise<ProductOrder | undefined> {
    const [order] = await db.select().from(productOrders).where(eq(productOrders.id, id));
    return order || undefined;
}

export async function getUserProductOrders(userId: number): Promise<ProductOrder[]> {
    return await db
        .select()
        .from(productOrders)
        .where(eq(productOrders.userId, userId))
        .orderBy(desc(productOrders.createdAt));
}

export async function updateProductOrderStatus(id: number, status: string): Promise<ProductOrder | undefined> {
    const [order] = await db
        .update(productOrders)
        .set({ status: status as any, updatedAt: new Date() })
        .where(eq(productOrders.id, id))
        .returning();
    return order || undefined;
}

export async function getAllProductOrders(): Promise<ProductOrder[]> {
    return await db.select().from(productOrders).orderBy(desc(productOrders.createdAt));
}

// ==================== INVOICES ====================

export async function createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    let next = await nextSequentialNumber('invoices', 'invoice_id', 'INV');
    for (let attempt = 0; attempt < 6; attempt++) {
        const invoiceId = `INV${String(next).padStart(6, '0')}`;
        try {
            const [invoice] = await db.insert(invoices).values({ ...insertInvoice, invoiceId }).returning();
            return invoice;
        } catch (err: any) {
            if (err?.code === '23505') { next++; continue; }
            throw err;
        }
    }
    throw new Error('Could not allocate a unique invoice id after several attempts');
}

export async function getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
}

export async function getInvoiceByInvoiceId(invoiceId: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceId, invoiceId));
    return invoice || undefined;
}

export async function getUserInvoices(userId: number): Promise<Invoice[]> {
    return await db
        .select()
        .from(invoices)
        .where(eq(invoices.userId, userId))
        .orderBy(desc(invoices.createdAt));
}

export async function getAllInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
}

// ==================== OTP VERIFICATION ====================

export async function createOtpVerification(otp: InsertOtpVerification): Promise<OtpVerification> {
    const [verification] = await db.insert(otpVerifications).values(otp).returning();
    return verification;
}

export async function verifyOtp(
    phone: string | undefined,
    email: string | undefined,
    otp: string,
    purpose: string
): Promise<boolean> {
    const [verification] = await db
        .select()
        .from(otpVerifications)
        .where(
            and(
                phone ? eq(otpVerifications.phone, phone) : eq(otpVerifications.email, email || ''),
                eq(otpVerifications.otp, otp),
                eq(otpVerifications.purpose, purpose),
                eq(otpVerifications.isVerified, false),
                gte(otpVerifications.expiresAt, new Date())
            )
        );

    if (verification) {
        await db
            .update(otpVerifications)
            .set({ isVerified: true })
            .where(eq(otpVerifications.id, verification.id));
        return true;
    }
    return false;
}
