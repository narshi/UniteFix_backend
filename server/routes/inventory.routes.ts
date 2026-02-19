
import { Router } from "express";
import { storage } from "../storage";
import { insertProductSchema } from "@shared/schema";
import multer from "multer";
import * as xlsx from "xlsx";
import { z } from "zod";
import * as catalogService from "../services/product-catalog.service";

export const inventoryRouter = Router();

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// ==================== LEGACY ENDPOINTS (preserved for admin dashboard compat) ====================

// GET all products (Admin view)
inventoryRouter.get("/", async (req, res, next) => {
    try {
        const products = await storage.getAdminProducts();
        res.json(products);
    } catch (error) {
        next(error);
    }
});

// GET products by category
inventoryRouter.get("/category/:category", async (req, res, next) => {
    try {
        const products = await storage.getProductsByCategory(req.params.category);
        res.json(products);
    } catch (error) {
        next(error);
    }
});

// POST create new product
inventoryRouter.post("/", async (req, res, next) => {
    try {
        const productData = insertProductSchema.parse(req.body);
        const product = await storage.createProduct(productData);
        res.status(201).json(product);
    } catch (error) {
        next(error);
    }
});

// PATCH update product
inventoryRouter.patch("/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const updates = insertProductSchema.partial().parse(req.body);
        const updated = await storage.updateProduct(id, updates);
        if (!updated) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(updated);
    } catch (error) {
        next(error);
    }
});

// DELETE product (Soft delete)
inventoryRouter.delete("/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const success = await storage.deleteProduct(id);
        if (!success) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.sendStatus(204);
    } catch (error) {
        next(error);
    }
});

// ==================== CATEGORIES ====================

inventoryRouter.get("/categories", async (req, res, next) => {
    try {
        const activeOnly = req.query.active !== 'false';
        const categories = await catalogService.getCategories(activeOnly);
        res.json({ success: true, data: categories });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.post("/categories", async (req, res, next) => {
    try {
        const { name, description, iconUrl, sortOrder } = req.body;
        if (!name) return res.status(400).json({ success: false, message: "Category name is required" });

        const slug = name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
        const category = await catalogService.createCategory({ name, slug, description, iconUrl, sortOrder });
        res.status(201).json({ success: true, data: category });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.patch("/categories/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const updated = await catalogService.updateCategory(id, req.body);
        if (!updated) return res.status(404).json({ success: false, message: "Category not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// ==================== BRANDS ====================

inventoryRouter.get("/brands", async (req, res, next) => {
    try {
        const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;
        const brands = await catalogService.getBrands(categoryId);
        res.json({ success: true, data: brands });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.post("/brands", async (req, res, next) => {
    try {
        const { name, categoryId, logoUrl } = req.body;
        if (!name) return res.status(400).json({ success: false, message: "Brand name is required" });

        const slug = name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
        const brand = await catalogService.createBrand({ name, slug, categoryId, logoUrl });
        res.status(201).json({ success: true, data: brand });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.patch("/brands/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const updated = await catalogService.updateBrand(id, req.body);
        if (!updated) return res.status(404).json({ success: false, message: "Brand not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// ==================== VARIANTS ====================

inventoryRouter.get("/:productId/variants", async (req, res, next) => {
    try {
        const productId = parseInt(req.params.productId);
        const variants = await catalogService.getVariantsByProductId(productId);
        res.json({ success: true, data: variants });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.post("/:productId/variants", async (req, res, next) => {
    try {
        const productId = parseInt(req.params.productId);
        const { sku, variantLabel, price, stock, mrp, attributes, lowStockThreshold } = req.body;

        if (!sku || !variantLabel || !price) {
            return res.status(400).json({ success: false, message: "sku, variantLabel, and price are required" });
        }

        const variant = await catalogService.createVariant({
            productId, sku, variantLabel,
            price: Number(price),
            stock: Number(stock || 0),
            mrp: mrp ? Number(mrp) : undefined,
            attributes: attributes || null,
            lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : undefined,
        });
        res.status(201).json({ success: true, data: variant });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.patch("/variants/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const updated = await catalogService.updateVariant(id, req.body);
        if (!updated) return res.status(404).json({ success: false, message: "Variant not found" });
        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// Stock update: PATCH /api/admin/inventory/variants/:id/stock
inventoryRouter.patch("/variants/:id/stock", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const { quantity } = req.body; // positive = add stock, negative = remove

        if (quantity === undefined || isNaN(Number(quantity))) {
            return res.status(400).json({ success: false, message: "quantity is required (positive to add, negative to remove)" });
        }

        const updated = await catalogService.updateVariantStock(id, Number(quantity), "admin");
        res.json({ success: true, data: updated });
    } catch (error: any) {
        if (error.message === "Variant not found") {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error.message === "Insufficient stock") {
            return res.status(400).json({ success: false, message: error.message });
        }
        next(error);
    }
});

// ==================== IMAGES ====================

inventoryRouter.post("/:productId/images", async (req, res, next) => {
    try {
        const productId = parseInt(req.params.productId);
        const { imageUrl, variantId, source, sortOrder, isPrimary } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ success: false, message: "imageUrl is required" });
        }

        const image = await catalogService.addProductImage({
            productId,
            variantId: variantId ? Number(variantId) : null,
            imageUrl,
            source: source || 'external',
            sortOrder: sortOrder ? Number(sortOrder) : 0,
            isPrimary: isPrimary || false,
        });
        res.status(201).json({ success: true, data: image });
    } catch (error) {
        next(error);
    }
});

inventoryRouter.delete("/images/:id", async (req, res, next) => {
    try {
        const id = parseInt(req.params.id);
        const deleted = await catalogService.deleteProductImage(id);
        if (!deleted) return res.status(404).json({ success: false, message: "Image not found" });
        res.json({ success: true, message: "Image deleted" });
    } catch (error) {
        next(error);
    }
});

// ==================== LOW STOCK ALERTS ====================

inventoryRouter.get("/low-stock", async (req, res, next) => {
    try {
        const lowStockItems = await catalogService.getLowStockVariants();
        res.json({ success: true, data: lowStockItems, count: lowStockItems.length });
    } catch (error) {
        next(error);
    }
});

// ==================== TEMPLATE & BULK IMPORT ====================

// GET template — new 3-sheet format for catalog import
inventoryRouter.get("/template", (req, res) => {
    const wb = xlsx.utils.book_new();

    // Sheet 1: Products
    const productsTemplate = [
        {
            product_ref: "PROD-001",
            category: "Laptops",
            brand: "Dell",
            name: "Dell Inspiron 15 R6565",
            description: "15.6 inch FHD AMD Ryzen 5 laptop",
            specifications: "Display:15.6 FHD,Processor:AMD Ryzen 5,OS:Windows 11",
            thumbnail_url: "https://example.com/dell-inspiron.jpg"
        },
        {
            product_ref: "PROD-002",
            category: "CC Cameras",
            brand: "Hikvision",
            name: "Hikvision DS-2CE1AD0T",
            description: "2MP Turbo HD Indoor Camera",
            specifications: "Resolution:2MP,Night Vision:20m,Type:Dome",
            thumbnail_url: "https://example.com/hikvision-cam.jpg"
        },
    ];

    // Sheet 2: Variants
    const variantsTemplate = [
        {
            product_ref: "PROD-001",
            sku: "DELL-INS15-8G-256S",
            variant_label: "8GB RAM / 256GB SSD",
            price: 45999,
            mrp: 52999,
            stock: 12,
            attributes: "RAM:8GB,SSD:256GB",
        },
        {
            product_ref: "PROD-001",
            sku: "DELL-INS15-16G-512S",
            variant_label: "16GB RAM / 512GB SSD",
            price: 55999,
            mrp: 64999,
            stock: 5,
            attributes: "RAM:16GB,SSD:512GB",
        },
        {
            product_ref: "PROD-002",
            sku: "HIK-2CE1AD-2MP",
            variant_label: "2MP Standard",
            price: 2499,
            mrp: 3200,
            stock: 12,
            attributes: "Resolution:2MP",
        },
    ];

    // Sheet 3: Images
    const imagesTemplate = [
        {
            product_ref: "PROD-001",
            variant_sku: "",
            image_url: "https://m.media-amazon.com/images/dell-front.jpg",
            is_primary: "Yes",
        },
        {
            product_ref: "PROD-001",
            variant_sku: "",
            image_url: "https://m.media-amazon.com/images/dell-side.jpg",
            is_primary: "No",
        },
        {
            product_ref: "PROD-002",
            variant_sku: "HIK-2CE1AD-2MP",
            image_url: "https://www.hikvision.com/camera-box.jpg",
            is_primary: "Yes",
        },
    ];

    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(productsTemplate), "Products");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(variantsTemplate), "Variants");
    xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(imagesTemplate), "Images");

    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", 'attachment; filename="product_catalog_template.xlsx"');
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
});

// GET stock update template
inventoryRouter.get("/stock-template", (req, res) => {
    const template = [
        { sku: "DELL-INS15-8G-256S", add_quantity: 12 },
        { sku: "HIK-2CE1AD-2MP", add_quantity: 10 },
    ];

    const ws = xlsx.utils.json_to_sheet(template);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Stock Update");
    const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Disposition", 'attachment; filename="stock_update_template.xlsx"');
    res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
});

// POST Export Selected Products
inventoryRouter.post("/export", async (req, res, next) => {
    try {
        const { ids } = req.body; // Array of product IDs
        let products = await storage.getAdminProducts();

        if (ids && Array.isArray(ids) && ids.length > 0) {
            products = products.filter(p => ids.includes(p.id));
        }

        const data = products.map(p => ({
            "ID": p.id,
            "Name": p.name,
            "Category": p.category,
            "Price": p.price,
            "Stock": p.stock,
            "Active": p.isActive ? "Yes" : "No",
            "Images": Array.isArray(p.images) ? p.images.join(", ") : p.images
        }));

        const ws = xlsx.utils.json_to_sheet(data);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Inventory");
        const buffer = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

        res.setHeader("Content-Disposition", 'attachment; filename="inventory_export.xlsx"');
        res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buffer);
    } catch (error) {
        next(error);
    }
});

// POST Bulk Import (NEW: 3-sheet catalog import)
inventoryRouter.post("/import", upload.single("file"), async (req, res, next) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const workbook = xlsx.read(file.buffer, { type: "buffer" });

        // Check if this is the new 3-sheet format or legacy single-sheet
        if (workbook.SheetNames.includes("Products") && workbook.SheetNames.includes("Variants")) {
            // New catalog import
            const productRows = xlsx.utils.sheet_to_json(workbook.Sheets["Products"]) as any[];
            const variantRows = xlsx.utils.sheet_to_json(workbook.Sheets["Variants"]) as any[];
            const imageRows = workbook.Sheets["Images"]
                ? xlsx.utils.sheet_to_json(workbook.Sheets["Images"]) as any[]
                : [];

            const result = await catalogService.bulkImportProducts(productRows, variantRows, imageRows);

            res.json({
                success: true,
                message: `Import completed. Products: ${result.products_created}, Variants: ${result.variants_created}, Images: ${result.images_linked}`,
                details: result,
            });
        } else {
            // Legacy single-sheet import (backward compat)
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = xlsx.utils.sheet_to_json(sheet);

            const results = {
                success: 0,
                failed: 0,
                errors: [] as string[]
            };

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                try {
                    const rowData = row as any;
                    const images = rowData.images ? rowData.images.split(",").map((s: string) => s.trim()) : [];

                    const product = insertProductSchema.parse({
                        name: rowData.name,
                        description: rowData.description,
                        price: Number(rowData.price),
                        category: rowData.category,
                        stock: Number(rowData.stock || 0),
                        images: images,
                        isActive: true
                    });

                    await storage.createProduct(product);
                    results.success++;
                } catch (error: any) {
                    results.failed++;
                    results.errors.push(`Row ${i + 2}: ${error.message}`);
                }
            }

            res.json({
                success: true,
                message: `Import completed. Success: ${results.success}, Failed: ${results.failed}`,
                details: results
            });
        }

    } catch (error) {
        next(error);
    }
});

// POST Bulk Stock Update
inventoryRouter.post("/stock-update", upload.single("file"), async (req, res, next) => {
    try {
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const workbook = xlsx.read(file.buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet) as any[];

        const updates = data.map(row => ({
            sku: String(row.sku),
            addQuantity: Number(row.add_quantity || 0),
        }));

        const result = await catalogService.bulkUpdateStock(updates, "admin-bulk");

        res.json({
            success: true,
            message: `Stock update completed. Success: ${result.success}, Failed: ${result.failed}`,
            details: result,
        });
    } catch (error) {
        next(error);
    }
});

export function registerInventoryRoutes(app: any) {
    app.use("/api/admin/inventory", inventoryRouter);
}
