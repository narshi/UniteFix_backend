/**
 * Partner (Employee) Repository
 * PHASE 1: All methods now use the unified `employees` table.
 * The `serviceProviders` table has been deleted.
 */

import { db } from "../db";
import {
    employees, walletTransactions, users,
    type Employee, type InsertEmployee,
    type WalletTransaction,
} from "@shared/schema";
import { eq, desc, count, and } from "drizzle-orm";
import { calculateHaversineDistance } from "../lib/geo";

// ==================== PARTNER CRUD (→ employees table) ====================

export async function createServiceProvider(insertProvider: any): Promise<Employee> {
    const countResult = await db.select({ count: count() }).from(employees);
    const partnerId = `SP${String((countResult[0]?.count || 0) + 1).padStart(5, '0')}`;

    const [employee] = await db
        .insert(employees)
        .values({
            ...insertProvider,
            partnerId,
            skills: insertProvider.skills || null
        } as any)
        .returning();
    return employee;
}

export async function getServiceProvider(id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee || undefined;
}

export async function getServiceProviderByUserId(userId: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.userId, userId));
    return employee || undefined;
}

export async function getServiceProviderByPartnerId(partnerId: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.partnerId, partnerId));
    return employee || undefined;
}

export async function getAllServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    return await db.select().from(employees).orderBy(desc(employees.createdAt)).limit(limit).offset(offset);
}

export async function getVerifiedServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    return await db
        .select()
        .from(employees)
        .where(eq(employees.documentVerificationStatus, 'verified'))
        .orderBy(desc(employees.createdAt))
        .limit(limit)
        .offset(offset);
}

export async function getPendingServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    return await db
        .select()
        .from(employees)
        .where(eq(employees.documentVerificationStatus, 'pending'))
        .orderBy(desc(employees.createdAt))
        .limit(limit)
        .offset(offset);
}

export async function countServiceProviders(status?: string): Promise<number> {
    let query = db.select({ count: count() }).from(employees);
    if (status) {
        query = query.where(eq(employees.documentVerificationStatus, status as any)) as any;
    }
    const [result] = await query;
    return result?.count ?? 0;
}

export async function updateServiceProvider(id: number, updates: Partial<Employee>): Promise<Employee | undefined> {
    const [employee] = await db
        .update(employees)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(employees.id, id))
        .returning();
    return employee || undefined;
}

export async function updateProviderLocation(id: number, lat: number, long: number): Promise<Employee | undefined> {
    const [employee] = await db
        .update(employees)
        .set({
            currentLocation: `POINT(${long} ${lat})`,
            lastLocationUpdate: new Date()
        })
        .where(eq(employees.id, id))
        .returning();
    return employee || undefined;
}

export async function getProvidersSortedByDistance(
    lat: number,
    long: number,
    status?: string
): Promise<(Employee & { distance: number })[]> {
    const allEmployees = await db
        .select()
        .from(employees)
        .where(
            and(
                eq(employees.isActive, true),
                status ? eq(employees.documentVerificationStatus, status as any) : undefined
            )
        );

    return allEmployees
        .filter(e => e.currentLocation !== null)
        .map(employee => {
            const match = employee.currentLocation?.match(/POINT\(([\d.-]+) ([\d.-]+)\)/);
            if (!match) return null;
            return {
                ...employee,
                distance: calculateHaversineDistance(lat, long, parseFloat(match[2]), parseFloat(match[1]))
            };
        })
        .filter(Boolean) as (Employee & { distance: number })[]
        ;
}

/**
 * Soft delete — see StorageService.deleteServiceProvider for the full rationale.
 * A hard DELETE here violates the eight foreign keys pointing at employees.id
 * and would destroy the wallet/invoice audit trail.
 */
export async function deleteServiceProvider(id: number): Promise<boolean> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!employee) return false;

    await db.transaction(async (tx) => {
        await tx
            .update(users)
            .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(users.id, employee.userId));

        await tx
            .update(employees)
            .set({
                isActive: false,
                isOnline: false,
                documentVerificationStatus: 'suspended',
                updatedAt: new Date(),
            })
            .where(eq(employees.id, id));
    });

    return true;
}

// ==================== LEGACY WALLET V1 ====================

export async function topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
        const [employee] = await tx.select().from(employees).where(eq(employees.id, providerId));
        if (!employee) throw new Error('Employee not found');

        const currentBalance = parseFloat(employee.walletBalance || '0');
        const newBalance = currentBalance + amount;

        await tx.update(employees)
            .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(employees.id, providerId));

        const [transaction] = await tx.insert(walletTransactions).values({
            providerId,
            amount: amount.toFixed(2),
            type: 'credit',
            description,
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2)
        }).returning();

        return transaction;
    });
    return result;
}

export async function deductProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
        const [employee] = await tx.select().from(employees).where(eq(employees.id, providerId));
        if (!employee) throw new Error('Employee not found');

        const currentBalance = parseFloat(employee.walletBalance || '0');
        if (currentBalance < amount) throw new Error('Insufficient wallet balance');
        const newBalance = currentBalance - amount;

        await tx.update(employees)
            .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(employees.id, providerId));

        const [transaction] = await tx.insert(walletTransactions).values({
            providerId,
            amount: (-amount).toFixed(2),
            type: 'debit',
            description,
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2)
        }).returning();

        return transaction;
    });
    return result;
}

export async function getProviderWalletTransactions(providerId: number): Promise<WalletTransaction[]> {
    return await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.providerId, providerId))
        .orderBy(desc(walletTransactions.createdAt));
}
