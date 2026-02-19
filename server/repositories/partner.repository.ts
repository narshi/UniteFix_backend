/**
 * Partner (Service Provider) Repository
 * Extracted from storage.ts — partner CRUD + legacy wallet operations
 */

import { db } from "../db";
import {
    serviceProviders, walletTransactions,
    type ServiceProvider, type InsertServiceProvider,
    type WalletTransaction,
} from "@shared/schema";
import { eq, desc, count } from "drizzle-orm";
import { calculateHaversineDistance } from "../lib/geo";

// ==================== SERVICE PROVIDER CRUD ====================

export async function createServiceProvider(insertProvider: InsertServiceProvider): Promise<ServiceProvider> {
    const countResult = await db.select({ count: count() }).from(serviceProviders);
    const partnerId = `SP${String((countResult[0]?.count || 0) + 1).padStart(5, '0')}`;

    const [provider] = await db
        .insert(serviceProviders)
        .values({
            ...insertProvider,
            partnerId,
            skills: insertProvider.skills || null
        } as any)
        .returning();
    return provider;
}

export async function getServiceProvider(id: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    return provider || undefined;
}

export async function getServiceProviderByUserId(userId: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.userId, userId));
    return provider || undefined;
}

export async function getServiceProviderByPartnerId(partnerId: string): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.partnerId, partnerId));
    return provider || undefined;
}

export async function getAllServiceProviders(limit: number = 100, offset: number = 0): Promise<ServiceProvider[]> {
    return await db.select().from(serviceProviders).orderBy(desc(serviceProviders.createdAt)).limit(limit).offset(offset);
}

export async function getVerifiedServiceProviders(limit: number = 100, offset: number = 0): Promise<ServiceProvider[]> {
    return await db
        .select()
        .from(serviceProviders)
        .where(eq(serviceProviders.verificationStatus, 'verified'))
        .orderBy(desc(serviceProviders.createdAt))
        .limit(limit)
        .offset(offset);
}

export async function getPendingServiceProviders(limit: number = 100, offset: number = 0): Promise<ServiceProvider[]> {
    return await db
        .select()
        .from(serviceProviders)
        .where(eq(serviceProviders.verificationStatus, 'pending'))
        .orderBy(desc(serviceProviders.createdAt))
        .limit(limit)
        .offset(offset);
}

export async function countServiceProviders(status?: string): Promise<number> {
    let query = db.select({ count: count() }).from(serviceProviders);
    if (status) {
        query = query.where(eq(serviceProviders.verificationStatus, status as any)) as any;
    }
    const [result] = await query;
    return result?.count ?? 0;
}

export async function updateServiceProvider(id: number, updates: Partial<ServiceProvider>): Promise<ServiceProvider | undefined> {
    const [provider] = await db
        .update(serviceProviders)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(serviceProviders.id, id))
        .returning();
    return provider || undefined;
}

export async function updateProviderLocation(id: number, lat: number, long: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db
        .update(serviceProviders)
        .set({
            currentLat: lat,
            currentLong: long,
            updatedAt: new Date()
        })
        .where(eq(serviceProviders.id, id))
        .returning();
    return provider || undefined;
}

export async function getProvidersSortedByDistance(
    lat: number,
    long: number,
    status?: string
): Promise<(ServiceProvider & { distance: number })[]> {
    let providers: ServiceProvider[];

    if (status) {
        providers = await db
            .select()
            .from(serviceProviders)
            .where(eq(serviceProviders.verificationStatus, status as any));
    } else {
        providers = await db.select().from(serviceProviders);
    }

    return providers
        .filter(p => p.currentLat && p.currentLong)
        .map(p => ({
            ...p,
            distance: calculateHaversineDistance(
                lat,
                long,
                p.currentLat!,
                p.currentLong!
            ),
        }))
        .sort((a, b) => a.distance - b.distance);
}

export async function deleteServiceProvider(id: number): Promise<boolean> {
    const result = await db.delete(serviceProviders).where(eq(serviceProviders.id, id));
    return true;
}

// ==================== LEGACY WALLET V1 ====================

export async function topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
        const [provider] = await tx
            .select()
            .from(serviceProviders)
            .where(eq(serviceProviders.id, providerId));

        if (!provider) throw new Error('Provider not found');

        const currentBalance = parseFloat(provider.walletBalance || '0');
        const newBalance = currentBalance + amount;

        await tx
            .update(serviceProviders)
            .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(serviceProviders.id, providerId));

        const [transaction] = await tx
            .insert(walletTransactions)
            .values({
                providerId,
                amount: amount.toFixed(2),
                type: 'credit',
                description,
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: newBalance.toFixed(2)
            })
            .returning();

        return transaction;
    });
    return result;
}

export async function deductProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
        const [provider] = await tx
            .select()
            .from(serviceProviders)
            .where(eq(serviceProviders.id, providerId));

        if (!provider) throw new Error('Provider not found');

        const currentBalance = parseFloat(provider.walletBalance || '0');
        if (currentBalance < amount) throw new Error('Insufficient wallet balance');

        const newBalance = currentBalance - amount;

        await tx
            .update(serviceProviders)
            .set({ walletBalance: newBalance.toFixed(2), updatedAt: new Date() })
            .where(eq(serviceProviders.id, providerId));

        const [transaction] = await tx
            .insert(walletTransactions)
            .values({
                providerId,
                amount: (-amount).toFixed(2),
                type: 'debit',
                description,
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: newBalance.toFixed(2)
            })
            .returning();

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
