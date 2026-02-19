/**
 * User & Admin Repository
 * Extracted from storage.ts — all user/admin CRUD operations
 */

import { db } from "../db";
import {
    users, adminUsers,
    type User, type InsertUser, type AdminUser, type InsertAdminUser,
} from "@shared/schema";
import { eq, desc, and, or, ilike, count } from "drizzle-orm";
import crypto from "crypto";

// ==================== USER METHODS ====================

export async function getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
}

export async function getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user || undefined;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
}

export async function getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, code));
    return user || undefined;
}

export async function createUser(insertUser: InsertUser): Promise<User> {
    const referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const [user] = await db
        .insert(users)
        .values({ ...insertUser, referralCode })
        .returning();
    return user;
}

export async function updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
    return user || undefined;
}

export async function getAllUsers(limit: number = 100, offset: number = 0): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
}

export async function countUsers(filters?: { role?: string; search?: string }): Promise<number> {
    const conditions = [];
    if (filters?.role) {
        conditions.push(eq(users.role, filters.role as any));
    }
    if (filters?.search) {
        conditions.push(
            or(
                ilike(users.username, `%${filters.search}%`),
                ilike(users.email, `%${filters.search}%`),
                ilike(users.phone, `%${filters.search}%`)
            )
        );
    }
    let query = db.select({ count: count() }).from(users);
    if (conditions.length > 0) {
        const condition = conditions.length === 1 ? conditions[0]! : and(...conditions);
        if (condition) query = query.where(condition) as any;
    }
    const [result] = await query;
    return result?.count ?? 0;
}

export async function getUsers(
    filters?: { role?: string; search?: string },
    limit: number = 100,
    offset: number = 0
): Promise<User[]> {
    let query = db.select().from(users);
    const conditions = [];

    if (filters?.role) {
        conditions.push(eq(users.role, filters.role as any));
    }
    if (filters?.search) {
        conditions.push(
            or(
                ilike(users.username, `%${filters.search}%`),
                ilike(users.email, `%${filters.search}%`),
                ilike(users.phone, `%${filters.search}%`)
            )
        );
    }

    if (conditions.length > 0) {
        const condition = conditions.length === 1 ? conditions[0]! : and(...conditions);
        if (condition) query = query.where(condition) as any;
    }

    return await (query as any).orderBy(desc(users.id)).limit(limit).offset(offset);
}

// ==================== ADMIN METHODS ====================

export async function getAdminUser(id: number): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
    return admin || undefined;
}

export async function getAdminByUsername(username: string): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return admin || undefined;
}

export async function getAdminByEmail(email: string): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    return admin || undefined;
}

export async function createAdminUser(insertAdmin: InsertAdminUser): Promise<AdminUser> {
    const [admin] = await db
        .insert(adminUsers)
        .values(insertAdmin)
        .returning();
    return admin;
}

export async function updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined> {
    const [admin] = await db
        .update(adminUsers)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(adminUsers.id, id))
        .returning();
    return admin || undefined;
}
