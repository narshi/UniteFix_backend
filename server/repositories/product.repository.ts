/**
 * Product & Cart Repository
 * Extracted from storage.ts — product CRUD + cart management
 */

import { db } from "../db";
import {
    products, cartItems,
    type Product, type InsertProduct,
    type CartItem, type InsertCartItem,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

// ==================== PRODUCTS ====================

export async function createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db
        .insert(products)
        .values(insertProduct)
        .returning();
    return product;
}

export async function getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
}

export async function getAllProducts(): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.isActive, true));
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
    return await db
        .select()
        .from(products)
        .where(and(eq(products.category, category), eq(products.isActive, true)));
}

export async function updateProductStock(id: number, stock: number): Promise<Product | undefined> {
    const [product] = await db
        .update(products)
        .set({ stock })
        .where(eq(products.id, id))
        .returning();
    return product || undefined;
}

export async function getAdminProducts(): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.isActive, true)).orderBy(desc(products.id));
}

export async function updateProduct(id: number, updates: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db
        .update(products)
        .set({ ...updates, updatedAt: new Date() } as any)
        .where(eq(products.id, id))
        .returning();
    return product || undefined;
}

export async function deleteProduct(id: number): Promise<boolean> {
    const [product] = await db
        .update(products)
        .set({ isActive: false })
        .where(eq(products.id, id))
        .returning();
    return !!product;
}

// ==================== CART MANAGEMENT ====================

export async function addToCart(item: InsertCartItem): Promise<CartItem> {
    const [existing] = await db
        .select()
        .from(cartItems)
        .where(
            and(
                eq(cartItems.userId, item.userId),
                eq(cartItems.productId, item.productId)
            )
        );

    if (existing) {
        const [updated] = await db
            .update(cartItems)
            .set({ quantity: existing.quantity + (item.quantity || 1) })
            .where(eq(cartItems.id, existing.id))
            .returning();
        return updated;
    }

    const [cartItem] = await db.insert(cartItems).values(item).returning();
    return cartItem;
}

export async function getCartItems(userId: number): Promise<CartItem[]> {
    return await db.select().from(cartItems).where(eq(cartItems.userId, userId));
}

export async function updateCartItemQuantity(id: number, quantity: number): Promise<CartItem | undefined> {
    const [item] = await db
        .update(cartItems)
        .set({ quantity })
        .where(eq(cartItems.id, id))
        .returning();
    return item || undefined;
}

export async function removeFromCart(id: number): Promise<boolean> {
    await db.delete(cartItems).where(eq(cartItems.id, id));
    return true;
}

export async function clearCart(userId: number): Promise<boolean> {
    await db.delete(cartItems).where(eq(cartItems.userId, userId));
    return true;
}
