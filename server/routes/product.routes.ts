/**
 * PHASE 6: Product & Cart API Routes
 * Customer: Browse products, manage cart, checkout
 * Admin: Manage products and inventory
 */

import type { Express, Request, Response } from "express";
import { ProductService, AdminProductService } from "../services/product.service";

export function registerProductRoutes(app: Express) {
    // ==================== CUSTOMER APIs ====================

    /**
     * GET /api/products
     * Get all active products (optional category filter)
     */
    app.get("/api/products", async (req: Request, res: Response) => {
        try {
            const { category } = req.query;

            const products = await ProductService.getProducts(category as string);

            res.json({ products });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/products/:id
     * Get product details
     */
    app.get("/api/products/:id", async (req: Request, res: Response) => {
        try {
            const productId = parseInt(req.params.id);

            const product = await ProductService.getProductById(productId);

            if (!product) {
                return res.status(404).json({ error: "Product not found" });
            }

            res.json({ product });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/cart/add
     * Add product to cart
     */
    app.post("/api/cart/add", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            const { productId, quantity } = req.body;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!productId || !quantity || quantity <= 0) {
                return res.status(400).json({ error: "Invalid product or quantity" });
            }

            const result = await ProductService.addToCart(userId, productId, quantity);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            res.json({ message: result.message });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/cart
     * Get user's cart
     */
    app.get("/api/cart", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const cart = await ProductService.getCart(userId);

            const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

            res.json({ cart, totalAmount });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * PUT /api/cart/:id
     * Update cart item quantity
     */
    app.put("/api/cart/:id", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            const cartItemId = parseInt(req.params.id);
            const { quantity } = req.body;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const result = await ProductService.updateCartItem(userId, cartItemId, quantity);

            if (!result.success) {
                return res.status(400).json({ error: result.message });
            }

            res.json({ message: result.message });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * DELETE /api/cart/:id
     * Remove item from cart
     */
    app.delete("/api/cart/:id", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            const cartItemId = parseInt(req.params.id);

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const result = await ProductService.removeFromCart(userId, cartItemId);

            res.json({ message: result.message });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST /api/cart/checkout
     * Checkout and create order
     */
    app.post("/api/cart/checkout", async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            const { shippingAddress, pincode } = req.body;

            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            if (!shippingAddress || !pincode) {
                return res.status(400).json({ error: "Shipping address and pincode required" });
            }

            const result = await ProductService.checkout(userId, shippingAddress, pincode);

            res.json({
                message: "Order placed successfully",
                orderId: result.orderId,
                totalAmount: result.totalAmount,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    // ==================== ADMIN APIs ====================

    /**
     * POST /api/admin/products
     * Create new product
     */
    app.post("/api/admin/products", async (req: Request, res: Response) => {
        try {
            const { name, description, category, price, stock, images } = req.body;

            // Validate admin role
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const product = await AdminProductService.createProduct({
                name,
                description,
                category,
                price,
                stock,
                images,
            });

            res.json({ product });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * PUT /api/admin/products/:id
     * Update product
     */
    app.put("/api/admin/products/:id", async (req: Request, res: Response) => {
        try {
            const productId = parseInt(req.params.id);

            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const product = await AdminProductService.updateProduct(productId, req.body);

            res.json({ product });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * PUT /api/admin/products/:id/stock
     * Update product stock
     */
    app.put("/api/admin/products/:id/stock", async (req: Request, res: Response) => {
        try {
            const productId = parseInt(req.params.id);
            const { stock } = req.body;

            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            if (typeof stock !== "number" || stock < 0) {
                return res.status(400).json({ error: "Invalid stock quantity" });
            }

            const product = await AdminProductService.updateStock(productId, stock);

            res.json({ product });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * DELETE /api/admin/products/:id
     * Delete product (soft delete)
     */
    app.delete("/api/admin/products/:id", async (req: Request, res: Response) => {
        try {
            const productId = parseInt(req.params.id);

            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            await AdminProductService.deleteProduct(productId);

            res.json({ message: "Product deleted successfully" });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/products
     * Get all products (including inactive)
     */
    app.get("/api/admin/products", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const includeInactive = req.query.includeInactive === "true";

            const products = await AdminProductService.getAllProducts(includeInactive);

            res.json({ products });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/admin/categories
     * Get fixed product categories
     */
    app.get("/api/admin/categories", async (req: Request, res: Response) => {
        try {
            if (!(req as any).user?.isAdmin) {
                return res.status(403).json({ error: "Admin access required" });
            }

            const categories = await AdminProductService.getCategories();

            res.json({ categories });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
}
