/**
 * PHASE 8: Inventory Management Routes (Admin)
 * 
 * Provides admin CRUD for platform-owned inventory:
 * - List inventory items with stock alerts
 * - Create/update items
 * - Restock items
 * - View consumption history
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { eq, and, desc, asc, lte, sql, count } from "drizzle-orm";
import { inventoryItems, inventoryTransactions, serviceRequests } from "@shared/schema";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "unitefix-secret-key-2024";

interface AuthenticatedRequest extends Request {
    user?: { userId: number; role: string };
}

function authenticateAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Admin token required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Invalid admin token' });
    }
}

export function registerInventoryRoutes(app: Express) {

    /**
     * GET /api/admin/inventory
     * List all inventory items with optional filters
     */
    app.get("/api/admin/inventory", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = (page - 1) * limit;
            const category = req.query.category as string;
            const lowStockOnly = req.query.lowStock === 'true';

            const conditions: any[] = [eq(inventoryItems.isActive, true)];
            if (category) conditions.push(eq(inventoryItems.category, category));
            if (lowStockOnly) {
                conditions.push(sql`${inventoryItems.currentStock} <= ${inventoryItems.minStockLevel}`);
            }

            const items = await db.select()
                .from(inventoryItems)
                .where(and(...conditions))
                .orderBy(asc(inventoryItems.itemName))
                .limit(limit)
                .offset(offset);

            const [countResult] = await db
                .select({ count: count() })
                .from(inventoryItems)
                .where(and(...conditions));

            const total = Number(countResult?.count || 0);

            // Count low stock items
            const [lowStockCount] = await db
                .select({ count: count() })
                .from(inventoryItems)
                .where(and(
                    eq(inventoryItems.isActive, true),
                    sql`${inventoryItems.currentStock} <= ${inventoryItems.minStockLevel}`
                ));

            res.json({
                success: true,
                data: items,
                lowStockAlert: Number(lowStockCount?.count || 0),
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/inventory
     * Create a new inventory item
     */
    app.post("/api/admin/inventory", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const { itemCode, itemName, category, unit, unitCost, currentStock, minStockLevel } = req.body;

            if (!itemCode || !itemName || !unit || unitCost === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "itemCode, itemName, unit, and unitCost are required",
                });
            }

            const [item] = await db.insert(inventoryItems).values({
                itemCode,
                itemName,
                category: category || null,
                unit,
                unitCost: unitCost.toString(),
                currentStock: currentStock || 0,
                minStockLevel: minStockLevel || 10,
            }).returning();

            res.status(201).json({ success: true, message: "Inventory item created", data: item });
        } catch (error: any) {
            if (error.code === '23505') {
                return res.status(400).json({ success: false, message: "Item code already exists" });
            }
            next(error);
        }
    });

    /**
     * PATCH /api/admin/inventory/:itemId
     * Update inventory item details
     */
    app.patch("/api/admin/inventory/:itemId", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const itemId = parseInt(req.params.itemId);
            const { itemName, category, unit, unitCost, minStockLevel, isActive } = req.body;

            const updates: any = { updatedAt: new Date() };
            if (itemName !== undefined) updates.itemName = itemName;
            if (category !== undefined) updates.category = category;
            if (unit !== undefined) updates.unit = unit;
            if (unitCost !== undefined) updates.unitCost = unitCost.toString();
            if (minStockLevel !== undefined) updates.minStockLevel = minStockLevel;
            if (isActive !== undefined) updates.isActive = isActive;

            const [item] = await db.update(inventoryItems)
                .set(updates)
                .where(eq(inventoryItems.id, itemId))
                .returning();

            if (!item) {
                return res.status(404).json({ success: false, message: "Item not found" });
            }

            res.json({ success: true, message: "Item updated", data: item });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /api/admin/inventory/:itemId/restock
     * Restock an inventory item
     */
    app.post("/api/admin/inventory/:itemId/restock", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const itemId = parseInt(req.params.itemId);
            const { quantity, notes } = req.body;

            if (!quantity || quantity <= 0) {
                return res.status(400).json({ success: false, message: "Quantity must be positive" });
            }

            // Get current item
            const [item] = await db.select().from(inventoryItems)
                .where(eq(inventoryItems.id, itemId)).limit(1);

            if (!item) {
                return res.status(404).json({ success: false, message: "Item not found" });
            }

            const stockBefore = item.currentStock;
            const stockAfter = stockBefore + quantity;
            const totalCost = parseFloat(item.unitCost) * quantity;

            // Create restock transaction
            const [transaction] = await db.insert(inventoryTransactions).values({
                transactionId: `RSTK-${itemId}-${Date.now()}`,
                itemId,
                transactionType: 'restock',
                quantity,
                unitCostSnapshot: item.unitCost,
                totalCost: totalCost.toFixed(2),
                performedBy: req.user!.userId,
                stockBefore,
                stockAfter,
                notes: notes || `Restocked ${quantity} units`,
            }).returning();

            // Update current stock
            await db.update(inventoryItems)
                .set({ currentStock: stockAfter, updatedAt: new Date() })
                .where(eq(inventoryItems.id, itemId));

            res.json({
                success: true,
                message: `Restocked ${quantity} units of ${item.itemName}`,
                data: { transaction, newStock: stockAfter },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/admin/inventory/:itemId/history
     * Get transaction history for an inventory item
     */
    app.get("/api/admin/inventory/:itemId/history", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const itemId = parseInt(req.params.itemId);
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = (page - 1) * limit;

            const transactions = await db.select()
                .from(inventoryTransactions)
                .where(eq(inventoryTransactions.itemId, itemId))
                .orderBy(desc(inventoryTransactions.createdAt))
                .limit(limit)
                .offset(offset);

            const [countResult] = await db
                .select({ count: count() })
                .from(inventoryTransactions)
                .where(eq(inventoryTransactions.itemId, itemId));

            const total = Number(countResult?.count || 0);

            res.json({
                success: true,
                data: transactions,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/admin/inventory/alerts
     * Get all items with low stock
     */
    app.get("/api/admin/inventory/alerts", authenticateAdmin, async (req: AuthenticatedRequest, res, next) => {
        try {
            const lowStockItems = await db.select()
                .from(inventoryItems)
                .where(and(
                    eq(inventoryItems.isActive, true),
                    sql`${inventoryItems.currentStock} <= ${inventoryItems.minStockLevel}`
                ))
                .orderBy(asc(inventoryItems.currentStock));

            res.json({
                success: true,
                data: lowStockItems,
                meta: { totalAlerts: lowStockItems.length },
            });
        } catch (error) {
            next(error);
        }
    });
}
