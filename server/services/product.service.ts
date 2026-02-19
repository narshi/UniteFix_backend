/**
 * PHASE 6: Product & Cart Service
 * 
 * Handles:
 * - Product catalog management
 * - Cart operations (intent-only, no reservation)
 * - Order checkout with row-level locking
 * - Inventory validation at add-to-cart and checkout
 * 
 * LOCKED REQUIREMENTS:
 * - 3 fixed categories
 * - Cart is intent only (no inventory hold)
 * - Inventory checked on add + checkout
 * - Inventory deducted ONLY at checkout with SELECT FOR UPDATE
 * - Overselling must be impossible
 */

import { db } from "../db";
import { sql, eq, and, inArray } from "drizzle-orm";
import { products, cartItems, productOrders, inventoryItems, inventoryTransactions } from "@shared/schema";

interface CartItemWithProduct {
    cartItemId: number;
    productId: number;
    productName: string;
    price: number;
    quantity: number;
    stock: number;
    imageUrl: string | null;
}

export class ProductService {
    /**
     * Get all products (with optional category filter)
     */
    static async getProducts(category?: string): Promise<any[]> {
        if (category) {
            return await db.select().from(products).where(
                and(eq(products.isActive, true), eq(products.category, category))
            );
        }
        return await db.select().from(products).where(eq(products.isActive, true));
    }

    /**
     * Get product by ID
     */
    static async getProductById(productId: number): Promise<any | null> {
        const [product] = await db
            .select()
            .from(products)
            .where(and(eq(products.id, productId), eq(products.isActive, true)));

        return product || null;
    }

    /**
     * Add item to cart (with stock validation)
     * Cart is INTENT ONLY - no reservation
     */
    static async addToCart(
        userId: number,
        productId: number,
        quantity: number
    ): Promise<{ success: boolean; message: string }> {
        // Validate product exists and is active
        const product = await this.getProductById(productId);
        if (!product) {
            return { success: false, message: "Product not found or inactive" };
        }

        // Check current stock (advisory only, no lock)
        if (product.stock < quantity) {
            return {
                success: false,
                message: `Insufficient stock. Available: ${product.stock}`,
            };
        }

        // Check if item already in cart
        const [existingCartItem] = await db
            .select()
            .from(cartItems)
            .where(and(eq(cartItems.userId, userId), eq(cartItems.productId, productId)));

        if (existingCartItem) {
            // Update quantity
            const newQuantity = existingCartItem.quantity + quantity;

            if (product.stock < newQuantity) {
                return {
                    success: false,
                    message: `Cannot add ${quantity} more. Only ${product.stock - existingCartItem.quantity} available.`,
                };
            }

            await db
                .update(cartItems)
                .set({ quantity: newQuantity })
                .where(eq(cartItems.id, existingCartItem.id));

            return { success: true, message: "Cart updated" };
        }

        // Add new cart item
        await db.insert(cartItems).values({
            userId,
            productId,
            quantity,
        });

        return { success: true, message: "Added to cart" };
    }

    /**
     * Get user's cart with product details
     */
    static async getCart(userId: number): Promise<CartItemWithProduct[]> {
        const cart = await db
            .select({
                cartItemId: cartItems.id,
                productId: products.id,
                productName: products.name,
                price: products.price,
                quantity: cartItems.quantity,
                stock: products.stock,
                imageUrl: products.images,
            })
            .from(cartItems)
            .innerJoin(products, eq(cartItems.productId, products.id))
            .where(and(eq(cartItems.userId, userId), eq(products.isActive, true)));

        return cart as CartItemWithProduct[];
    }

    /**
     * Update cart item quantity
     */
    static async updateCartItem(
        userId: number,
        cartItemId: number,
        quantity: number
    ): Promise<{ success: boolean; message: string }> {
        if (quantity <= 0) {
            return await this.removeFromCart(userId, cartItemId);
        }

        const [cartItem] = await db
            .select()
            .from(cartItems)
            .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

        if (!cartItem) {
            return { success: false, message: "Cart item not found" };
        }

        const product = await this.getProductById(cartItem.productId);
        if (!product) {
            return { success: false, message: "Product not available" };
        }

        if (product.stock < quantity) {
            return {
                success: false,
                message: `Insufficient stock. Available: ${product.stock}`,
            };
        }

        await db.update(cartItems).set({ quantity }).where(eq(cartItems.id, cartItemId));

        return { success: true, message: "Cart updated" };
    }

    /**
     * Remove item from cart
     */
    static async removeFromCart(
        userId: number,
        cartItemId: number
    ): Promise<{ success: boolean; message: string }> {
        await db
            .delete(cartItems)
            .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

        return { success: true, message: "Item removed from cart" };
    }

    /**
     * Clear user's cart
     */
    static async clearCart(userId: number): Promise<void> {
        await db.delete(cartItems).where(eq(cartItems.userId, userId));
    }

    /**
   * Checkout - Create order with row-level locking
   * CRITICAL: This is where inventory is actually deducted
   * 
   * HARDENING:
   * - Idempotency: Prevents duplicate orders
   * - Stock floor: Prevents negative stock
   * - Cart drift: Clear errors on stock changes
   * - Audit logs: All operations logged
   */
    static async checkout(
        userId: number,
        shippingAddress: string,
        pincode: string
    ): Promise<{ orderId: string; totalAmount: number }> {
        // Get cart items
        const cart = await this.getCart(userId);

        if (cart.length === 0) {
            throw new Error("Cart is empty");
        }

        // HARDENING 1: Idempotency check
        // Prevent duplicate checkout within 60 seconds
        const recentOrder = await db.execute(sql`
      SELECT id, order_id FROM product_orders
      WHERE user_id = ${userId}
        AND created_at > NOW() - INTERVAL '60 seconds'
      ORDER BY created_at DESC
      LIMIT 1
    `) as any;

        if (recentOrder && recentOrder.length > 0) {
            throw new Error(
                `Duplicate checkout detected. Order ${(recentOrder as any)[0].order_id} was just created. Please wait before placing another order.`
            );
        }

        // Execute in transaction with row-level locking
        const result = await db.transaction(async (tx: any) => {
            let totalAmount = 0;
            const orderItems: any[] = [];
            const stockErrors: string[] = [];

            // Lock and validate inventory for ALL items
            for (const item of cart) {
                // CRITICAL: SELECT FOR UPDATE locks the product row
                const [product] = await tx.execute(sql`
          SELECT id, stock_quantity, price, name
          FROM products
          WHERE id = ${item.productId}
          FOR UPDATE
        `);

                if (!product) {
                    stockErrors.push(`${item.productName} is no longer available`);
                    continue;
                }

                // HARDENING 2 & 3: Stock floor guard + Cart drift handling
                if (product.stock_quantity < item.quantity) {
                    // Cart drift detected - stock changed since add-to-cart
                    stockErrors.push(
                        `${product.name}: Requested ${item.quantity}, but only ${product.stock_quantity} available`
                    );
                    continue;
                }

                // HARDENING 2: Prevent negative stock (belt and suspenders)
                const newStock = product.stock_quantity - item.quantity;
                if (newStock < 0) {
                    throw new Error(
                        `Stock validation failed for ${product.name}. This should never happen.`
                    );
                }

                // Deduct inventory
                await tx.execute(sql`
          UPDATE products
          SET stock_quantity = stock_quantity - ${item.quantity}
          WHERE id = ${item.productId}
        `);

                const itemTotal = parseFloat(product.price) * item.quantity;
                totalAmount += itemTotal;

                orderItems.push({
                    productId: item.productId,
                    productName: product.name,
                    quantity: item.quantity,
                    price: product.price,
                });
            }

            // If any stock errors, abort transaction
            if (stockErrors.length > 0) {
                throw new Error(
                    `Checkout failed due to stock issues:\n${stockErrors.join("\n")}\n\nPlease refresh your cart and try again.`
                );
            }

            // Create order
            const orderId = `ORD-${userId}-${Date.now()}`;

            const [order] = await tx.insert(productOrders).values({
                orderId,
                userId,
                totalAmount: totalAmount.toFixed(2),
                status: "placed",
                shippingAddress,
                pincode,
            }).returning();

            // HARDENING 4: Audit log
            await tx.execute(sql`
        INSERT INTO audit_logs (
          entity_type, entity_id, action, changed_by, metadata
        ) VALUES (
          'product_order',
          ${order.id},
          'order_created',
          ${userId},
          ${JSON.stringify({
                orderId,
                totalAmount,
                itemCount: orderItems.length,
                items: orderItems,
            })}
        )
      `);

            // Clear cart
            await tx.delete(cartItems).where(eq(cartItems.userId, userId));

            return { orderId, totalAmount };
        });

        return result;
    }
}

/**
 * ADMIN: Product Management Service
 */
export class AdminProductService {
    /**
     * Create new product
     */
    static async createProduct(data: {
        name: string;
        description?: string;
        category: string;
        price: number;
        stock: number;
        images?: string[];
    }): Promise<any> {
        // Validate category (must be one of 3 fixed)
        const validCategories = await this.getCategories();
        if (!validCategories.includes(data.category)) {
            throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
        }

        const [product] = await db.insert(products).values(data).returning();

        return product;
    }

    /**
     * Update product
     */
    static async updateProduct(
        productId: number,
        data: Partial<{
            name: string;
            description: string;
            category: string;
            price: number;
            imageUrl: string;
            isActive: boolean;
        }>
    ): Promise<any> {
        if (data.category) {
            const validCategories = await this.getCategories();
            if (!validCategories.includes(data.category)) {
                throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
            }
        }

        const [product] = await db
            .update(products)
            .set(data)
            .where(eq(products.id, productId))
            .returning();

        return product;
    }

    /**
     * Update stock quantity
     */
    static async updateStock(productId: number, newStock: number): Promise<any> {
        const [product] = await db
            .update(products)
            .set({ stock: newStock })
            .where(eq(products.id, productId))
            .returning();

        return product;
    }

    /**
     * Delete product (soft delete)
     */
    static async deleteProduct(productId: number): Promise<void> {
        await db.update(products).set({ isActive: false }).where(eq(products.id, productId));
    }

    /**
     * Get all products (including inactive for admin)
     */
    static async getAllProducts(includeInactive: boolean = false): Promise<any[]> {
        if (includeInactive) {
            return await db.select().from(products);
        }

        return await db.select().from(products).where(eq(products.isActive, true));
    }

    /**
     * Get fixed categories from platform config
     */
    static async getCategories(): Promise<string[]> {
        const configResult = await db.execute(sql`
      SELECT value FROM platform_config
      WHERE key = 'PRODUCT_CONFIG.CATEGORIES'
    `) as any;
        const config = configResult?.[0];

        if (!config) {
            // Default 3 categories
            return ["Electronics", "Appliances", "Home Essentials"];
        }

        return config.value.split(",");
    }
}
