/**
 * Mobile-facing Product Catalog Routes
 * Exposes read-only catalog endpoints for the React Native app.
 * All routes are under /api/catalog/* (and aliased via /api/v1/catalog/*)
 */
import { Router, Request, Response, NextFunction } from "express";
import * as catalogService from "../services/product-catalog.service";

export const catalogRouter = Router();

// GET /api/catalog/categories — List all active categories
catalogRouter.get("/categories", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const categories = await catalogService.getCategories(true);
        res.json({ success: true, data: categories });
    } catch (error) {
        next(error);
    }
});

// GET /api/catalog/categories/:id — Category detail
catalogRouter.get("/categories/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id);
        const category = await catalogService.getCategoryById(id);
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        res.json({ success: true, data: category });
    } catch (error) {
        next(error);
    }
});

// GET /api/catalog/categories/:id/products — Products in a category (paginated)
catalogRouter.get("/categories/:id/products", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const categoryId = parseInt(req.params.id);
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

        const result = await catalogService.getProductsByCategoryId(categoryId, page, limit);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/catalog/products/:id — Product detail with variants and images
catalogRouter.get("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = parseInt(req.params.id);
        const product = await catalogService.getProductDetail(id);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found" });
        }
        res.json({ success: true, data: product });
    } catch (error) {
        next(error);
    }
});

// GET /api/catalog/search?q=dell — Search products
catalogRouter.get("/search", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const query = (req.query.q as string) || '';
        if (query.length < 2) {
            return res.status(400).json({ success: false, message: "Search query must be at least 2 characters" });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

        const result = await catalogService.searchProducts(query, page, limit);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
});

// GET /api/catalog/brands — List all active brands (optionally by category)
catalogRouter.get("/brands", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
        const brands = await catalogService.getBrands(categoryId);
        res.json({ success: true, data: brands });
    } catch (error) {
        next(error);
    }
});

export function registerCatalogRoutes(app: any) {
    app.use("/api/catalog", catalogRouter);
}
