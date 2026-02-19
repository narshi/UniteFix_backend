/**
 * Product Catalog Service
 * Handles CRUD for categories, brands, products, variants, images, and bulk import.
 */
import { db } from "../db";
import {
    productCategories, productBrands, products, productVariants, productImages,
    inventoryTransactions, inventoryItems,
    type InsertProductCategory, type InsertProductBrand, type InsertProduct,
    type InsertProductVariant, type InsertProductImage,
} from "@shared/schema";
import { eq, and, ilike, sql, desc, asc, inArray, lte } from "drizzle-orm";
import logger from "../lib/logger";

// ==================== CATEGORIES ====================

export async function getCategories(activeOnly = true) {
    const conditions = activeOnly ? eq(productCategories.isActive, true) : undefined;
    return db.select().from(productCategories)
        .where(conditions)
        .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
}

export async function getCategoryById(id: number) {
    const [category] = await db.select().from(productCategories)
        .where(eq(productCategories.id, id));
    return category;
}

export async function createCategory(data: InsertProductCategory) {
    const [category] = await db.insert(productCategories).values(data).returning();
    return category;
}

export async function updateCategory(id: number, data: Partial<InsertProductCategory>) {
    const [updated] = await db.update(productCategories)
        .set(data)
        .where(eq(productCategories.id, id))
        .returning();
    return updated;
}

// ==================== BRANDS ====================

export async function getBrands(categoryId?: number) {
    if (categoryId) {
        return db.select().from(productBrands)
            .where(and(eq(productBrands.categoryId, categoryId), eq(productBrands.isActive, true)))
            .orderBy(asc(productBrands.name));
    }
    return db.select().from(productBrands)
        .where(eq(productBrands.isActive, true))
        .orderBy(asc(productBrands.name));
}

export async function createBrand(data: InsertProductBrand) {
    const [brand] = await db.insert(productBrands).values(data).returning();
    return brand;
}

export async function updateBrand(id: number, data: Partial<InsertProductBrand>) {
    const [updated] = await db.update(productBrands)
        .set(data)
        .where(eq(productBrands.id, id))
        .returning();
    return updated;
}

// ==================== PRODUCTS ====================

export async function getProductsByCategoryId(categoryId: number, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [items, countResult] = await Promise.all([
        db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            category: products.category,
            thumbnailUrl: products.thumbnailUrl,
            isActive: products.isActive,
            brandName: productBrands.name,
            variantCount: sql<number>`(SELECT COUNT(*) FROM product_variants WHERE product_id = ${products.id} AND is_active = true)::int`,
            minPrice: sql<number>`COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id = ${products.id} AND is_active = true), ${products.price})`,
        })
            .from(products)
            .leftJoin(productBrands, eq(products.brandId, productBrands.id))
            .where(and(eq(products.categoryId, categoryId), eq(products.isActive, true)))
            .orderBy(desc(products.createdAt))
            .limit(limit)
            .offset(offset),

        db.select({ count: sql<number>`count(*)::int` })
            .from(products)
            .where(and(eq(products.categoryId, categoryId), eq(products.isActive, true))),
    ]);

    const total = countResult[0]?.count || 0;
    return {
        data: items,
        pagination: {
            page, limit, total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1,
        },
    };
}

export async function getProductDetail(productId: number) {
    // Get product with brand and category
    const [product] = await db.select({
        id: products.id,
        name: products.name,
        description: products.description,
        price: products.price,
        category: products.category,
        thumbnailUrl: products.thumbnailUrl,
        specifications: products.specifications,
        isActive: products.isActive,
        categoryId: products.categoryId,
        brandId: products.brandId,
        createdAt: products.createdAt,
        categoryName: productCategories.name,
        brandName: productBrands.name,
        brandLogo: productBrands.logoUrl,
    })
        .from(products)
        .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
        .leftJoin(productBrands, eq(products.brandId, productBrands.id))
        .where(eq(products.id, productId));

    if (!product) return null;

    // Get variants
    const variants = await db.select().from(productVariants)
        .where(and(eq(productVariants.productId, productId), eq(productVariants.isActive, true)))
        .orderBy(asc(productVariants.price));

    // Get images (shared + variant-specific)
    const images = await db.select().from(productImages)
        .where(eq(productImages.productId, productId))
        .orderBy(asc(productImages.sortOrder));

    return { ...product, variants, images };
}

export async function searchProducts(query: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const searchPattern = `%${query}%`;

    const [items, countResult] = await Promise.all([
        db.select({
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            category: products.category,
            thumbnailUrl: products.thumbnailUrl,
            brandName: productBrands.name,
            minPrice: sql<number>`COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id = ${products.id} AND is_active = true), ${products.price})`,
        })
            .from(products)
            .leftJoin(productBrands, eq(products.brandId, productBrands.id))
            .where(and(
                eq(products.isActive, true),
                sql`(${products.name} ILIKE ${searchPattern} OR ${products.description} ILIKE ${searchPattern} OR ${productBrands.name} ILIKE ${searchPattern})`
            ))
            .limit(limit)
            .offset(offset),

        db.select({ count: sql<number>`count(*)::int` })
            .from(products)
            .leftJoin(productBrands, eq(products.brandId, productBrands.id))
            .where(and(
                eq(products.isActive, true),
                sql`(${products.name} ILIKE ${searchPattern} OR ${products.description} ILIKE ${searchPattern} OR ${productBrands.name} ILIKE ${searchPattern})`
            )),
    ]);

    const total = countResult[0]?.count || 0;
    return {
        data: items,
        pagination: {
            page, limit, total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1,
        },
    };
}

export async function createProduct(data: InsertProduct) {
    const [product] = await db.insert(products).values(data).returning();
    return product;
}

export async function updateProduct(id: number, data: Partial<InsertProduct>) {
    const [updated] = await db.update(products)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();
    return updated;
}

// ==================== VARIANTS ====================

export async function getVariantsByProductId(productId: number) {
    return db.select().from(productVariants)
        .where(eq(productVariants.productId, productId))
        .orderBy(asc(productVariants.price));
}

export async function createVariant(data: InsertProductVariant) {
    const [variant] = await db.insert(productVariants).values(data).returning();

    // Update parent product's stock (sum of all variant stocks) and base price (min variant price)
    await syncProductStockAndPrice(data.productId);

    return variant;
}

export async function updateVariant(id: number, data: Partial<InsertProductVariant>) {
    const [updated] = await db.update(productVariants)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(productVariants.id, id))
        .returning();

    if (updated) {
        await syncProductStockAndPrice(updated.productId);
    }
    return updated;
}

export async function updateVariantStock(
    variantId: number,
    quantityChange: number,
    performedBy?: string
) {
    return db.transaction(async (tx) => {
        // Get current variant
        const [variant] = await tx.select().from(productVariants)
            .where(eq(productVariants.id, variantId));

        if (!variant) throw new Error("Variant not found");

        const newStock = variant.stock + quantityChange;
        if (newStock < 0) throw new Error("Insufficient stock");

        // Update variant stock
        const [updated] = await tx.update(productVariants)
            .set({ stock: newStock, updatedAt: new Date() })
            .where(eq(productVariants.id, variantId))
            .returning();

        logger.info(`Stock updated: variant ${variant.sku} ${variant.stock} → ${newStock} (${quantityChange > 0 ? '+' : ''}${quantityChange})`, {
            variantId, sku: variant.sku, oldStock: variant.stock, newStock, change: quantityChange, performedBy,
        });

        // Sync parent product total stock
        await tx.update(products)
            .set({
                stock: sql`(SELECT COALESCE(SUM(stock), 0) FROM product_variants WHERE product_id = ${variant.productId} AND is_active = true)`,
                updatedAt: new Date(),
            })
            .where(eq(products.id, variant.productId));

        return updated;
    });
}

/** Sync product-level stock (sum) and price (min) from its variants */
async function syncProductStockAndPrice(productId: number) {
    await db.update(products)
        .set({
            stock: sql`(SELECT COALESCE(SUM(stock), 0)::int FROM product_variants WHERE product_id = ${productId} AND is_active = true)`,
            price: sql`COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id = ${productId} AND is_active = true), ${products.price})`,
            updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
}

// ==================== IMAGES ====================

export async function addProductImage(data: InsertProductImage) {
    const [image] = await db.insert(productImages).values(data).returning();

    // If this is primary, update the product's thumbnailUrl
    if (data.isPrimary) {
        await db.update(products)
            .set({ thumbnailUrl: data.imageUrl })
            .where(eq(products.id, data.productId));
    }
    return image;
}

export async function deleteProductImage(imageId: number) {
    const [deleted] = await db.delete(productImages)
        .where(eq(productImages.id, imageId))
        .returning();
    return deleted;
}

export async function reorderImages(productId: number, imageIds: number[]) {
    // Update sort_order based on position in the array
    for (let i = 0; i < imageIds.length; i++) {
        await db.update(productImages)
            .set({ sortOrder: i })
            .where(and(eq(productImages.id, imageIds[i]), eq(productImages.productId, productId)));
    }
}

// ==================== BULK IMPORT ====================

interface BulkImportRow {
    product_ref: string;
    category: string;
    brand: string;
    name: string;
    description?: string;
    specifications?: string; // "key1:val1,key2:val2"
    thumbnail_url?: string;
}

interface BulkVariantRow {
    product_ref: string;
    sku: string;
    variant_label: string;
    price: number;
    stock: number;
    mrp?: number;
    attributes?: string; // "key1:val1,key2:val2"
}

interface BulkImageRow {
    product_ref: string;
    variant_sku?: string;
    image_url: string;
    is_primary?: string; // "Yes" | "No"
}

interface BulkImportResult {
    products_created: number;
    variants_created: number;
    images_linked: number;
    products_failed: number;
    variants_failed: number;
    images_failed: number;
    errors: string[];
}

function parseKeyValueString(str: string | undefined): Record<string, string> | undefined {
    if (!str || str.trim() === '') return undefined;
    const result: Record<string, string> = {};
    const pairs = str.split(',');
    for (const pair of pairs) {
        const [key, ...valParts] = pair.split(':');
        if (key && valParts.length > 0) {
            result[key.trim()] = valParts.join(':').trim();
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function slugify(text: string): string {
    return text.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

export async function bulkImportProducts(
    productRows: BulkImportRow[],
    variantRows: BulkVariantRow[],
    imageRows: BulkImageRow[]
): Promise<BulkImportResult> {
    const result: BulkImportResult = {
        products_created: 0, variants_created: 0, images_linked: 0,
        products_failed: 0, variants_failed: 0, images_failed: 0,
        errors: [],
    };

    // Map of product_ref → created product ID
    const productRefMap = new Map<string, number>();

    // Cache for categories and brands to avoid duplicate inserts
    const categoryCache = new Map<string, number>();
    const brandCache = new Map<string, number>();

    // Pre-load existing categories and brands
    const existingCategories = await db.select().from(productCategories);
    for (const cat of existingCategories) {
        categoryCache.set(cat.name.toLowerCase(), cat.id);
    }
    const existingBrands = await db.select().from(productBrands);
    for (const brand of existingBrands) {
        brandCache.set(brand.name.toLowerCase(), brand.id);
    }

    // Step 1: Create products
    for (let i = 0; i < productRows.length; i++) {
        const row = productRows[i];
        try {
            if (!row.product_ref || !row.name || !row.category) {
                result.errors.push(`Products row ${i + 2}: Missing required fields (product_ref, name, category)`);
                result.products_failed++;
                continue;
            }

            // Get or create category
            let categoryId = categoryCache.get(row.category.toLowerCase());
            if (!categoryId) {
                const [newCat] = await db.insert(productCategories)
                    .values({ name: row.category, slug: slugify(row.category) })
                    .onConflictDoNothing()
                    .returning();
                if (newCat) {
                    categoryId = newCat.id;
                    categoryCache.set(row.category.toLowerCase(), newCat.id);
                } else {
                    // Already exists, fetch it
                    const [existing] = await db.select().from(productCategories)
                        .where(eq(productCategories.slug, slugify(row.category)));
                    categoryId = existing?.id;
                    if (categoryId) categoryCache.set(row.category.toLowerCase(), categoryId);
                }
            }

            // Get or create brand
            let brandId: number | undefined;
            if (row.brand) {
                brandId = brandCache.get(row.brand.toLowerCase());
                if (!brandId) {
                    const [newBrand] = await db.insert(productBrands)
                        .values({ name: row.brand, slug: slugify(row.brand), categoryId: categoryId })
                        .onConflictDoNothing()
                        .returning();
                    if (newBrand) {
                        brandId = newBrand.id;
                        brandCache.set(row.brand.toLowerCase(), newBrand.id);
                    } else {
                        const [existing] = await db.select().from(productBrands)
                            .where(eq(productBrands.slug, slugify(row.brand)));
                        brandId = existing?.id;
                        if (brandId) brandCache.set(row.brand.toLowerCase(), brandId);
                    }
                }
            }

            const specs = parseKeyValueString(row.specifications);

            const [product] = await db.insert(products).values({
                name: row.name,
                description: row.description || '',
                price: 0, // Will be updated by variant sync
                category: row.category,
                categoryId: categoryId,
                brandId: brandId,
                thumbnailUrl: row.thumbnail_url || null,
                specifications: specs || null,
                stock: 0,
            }).returning();

            productRefMap.set(row.product_ref, product.id);
            result.products_created++;
        } catch (error: any) {
            result.products_failed++;
            result.errors.push(`Products row ${i + 2}: ${error.message}`);
        }
    }

    // Step 2: Create variants
    const skuToVariantId = new Map<string, number>();
    for (let i = 0; i < variantRows.length; i++) {
        const row = variantRows[i];
        try {
            const productId = productRefMap.get(row.product_ref);
            if (!productId) {
                result.errors.push(`Variants row ${i + 2}: product_ref "${row.product_ref}" not found in Products sheet`);
                result.variants_failed++;
                continue;
            }

            if (!row.sku || !row.variant_label || !row.price) {
                result.errors.push(`Variants row ${i + 2}: Missing required fields (sku, variant_label, price)`);
                result.variants_failed++;
                continue;
            }

            const price = Number(row.price);
            const stock = Number(row.stock || 0);
            const mrp = row.mrp ? Number(row.mrp) : undefined;

            if (isNaN(price) || price <= 0) {
                result.errors.push(`Variants row ${i + 2}: Invalid price "${row.price}"`);
                result.variants_failed++;
                continue;
            }

            const attrs = parseKeyValueString(row.attributes);

            const [variant] = await db.insert(productVariants).values({
                productId,
                sku: row.sku,
                variantLabel: row.variant_label,
                price,
                mrp,
                stock: Math.max(0, stock),
                attributes: attrs || null,
            }).returning();

            skuToVariantId.set(row.sku, variant.id);
            result.variants_created++;

            // Sync parent product
            await syncProductStockAndPrice(productId);
        } catch (error: any) {
            result.variants_failed++;
            result.errors.push(`Variants row ${i + 2}: ${error.message}`);
        }
    }

    // Step 3: Link images
    for (let i = 0; i < imageRows.length; i++) {
        const row = imageRows[i];
        try {
            const productId = productRefMap.get(row.product_ref);
            if (!productId) {
                result.errors.push(`Images row ${i + 2}: product_ref "${row.product_ref}" not found`);
                result.images_failed++;
                continue;
            }

            if (!row.image_url) {
                result.errors.push(`Images row ${i + 2}: Missing image_url`);
                result.images_failed++;
                continue;
            }

            let variantId: number | undefined;
            if (row.variant_sku) {
                variantId = skuToVariantId.get(row.variant_sku);
                if (!variantId) {
                    result.errors.push(`Images row ${i + 2}: variant_sku "${row.variant_sku}" not found`);
                    result.images_failed++;
                    continue;
                }
            }

            const isPrimary = row.is_primary?.toLowerCase() === 'yes';

            await db.insert(productImages).values({
                productId,
                variantId: variantId || null,
                imageUrl: row.image_url,
                source: 'external',
                sortOrder: i,
                isPrimary,
            });

            // Set as product thumbnail if primary
            if (isPrimary) {
                await db.update(products)
                    .set({ thumbnailUrl: row.image_url })
                    .where(eq(products.id, productId));
            }

            result.images_linked++;
        } catch (error: any) {
            result.images_failed++;
            result.errors.push(`Images row ${i + 2}: ${error.message}`);
        }
    }

    logger.info('Bulk import completed', result);
    return result;
}

// ==================== BULK STOCK UPDATE ====================

export async function bulkUpdateStock(
    updates: Array<{ sku: string; addQuantity: number }>,
    performedBy?: string
): Promise<{ success: number; failed: number; errors: string[] }> {
    const result = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < updates.length; i++) {
        const { sku, addQuantity } = updates[i];
        try {
            const [variant] = await db.select().from(productVariants)
                .where(eq(productVariants.sku, sku));

            if (!variant) {
                result.errors.push(`Row ${i + 2}: SKU "${sku}" not found`);
                result.failed++;
                continue;
            }

            await updateVariantStock(variant.id, addQuantity, performedBy);
            result.success++;
        } catch (error: any) {
            result.failed++;
            result.errors.push(`Row ${i + 2}: ${error.message}`);
        }
    }

    return result;
}

// ==================== LOW STOCK ALERTS ====================

export async function getLowStockVariants() {
    return db.select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        variantLabel: productVariants.variantLabel,
        stock: productVariants.stock,
        lowStockThreshold: productVariants.lowStockThreshold,
        productName: products.name,
        brandName: productBrands.name,
    })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .leftJoin(productBrands, eq(products.brandId, productBrands.id))
        .where(and(
            eq(productVariants.isActive, true),
            sql`${productVariants.stock} <= ${productVariants.lowStockThreshold}`
        ))
        .orderBy(asc(productVariants.stock));
}
