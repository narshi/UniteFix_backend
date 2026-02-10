
import { db, pool } from "./db";
import { inventoryItems, platformConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("🌱 Starting Phase 3 Seeding...");

    // 1. Verify Platform Config (Essential keys)
    const configKeys = [
        'BUSINESS_CONFIG.BASE_SERVICE_FEE',
        'BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE',
        'BUSINESS_CONFIG.WALLET_HOLD_DAYS',
        'OPERATIONAL_CONFIG.INVENTORY_OWNER_PARTNER_ID'
    ];

    console.log("Checking platform configuration...");
    for (const key of configKeys) {
        const existing = await db.select().from(platformConfig).where(eq(platformConfig.key, key));
        if (existing.length === 0) {
            console.warn(`⚠️ Missing config key: ${key}. Ensure Phase 2 seeding was run or insert manually.`);
        } else {
            console.log(`✅ Config present: ${key}`);
        }
    }

    // 2. Insert Inventory Items
    const items = [
        {
            itemCode: 'SPARE_001',
            itemName: 'Replacement Battery',
            category: 'Spare Parts',
            unit: 'piece',
            unitCost: '50.00',
            currentStock: 5,
            minStockLevel: 3,
            ownerPartnerId: 'UNITEFIX_PLATFORM',
            isActive: true
        },
        {
            itemCode: 'SPARE_002',
            itemName: 'Display Screen',
            category: 'Spare Parts',
            unit: 'piece',
            unitCost: '200.00',
            currentStock: 3,
            minStockLevel: 2,
            ownerPartnerId: 'UNITEFIX_PLATFORM',
            isActive: true
        },
        {
            itemCode: 'TOOL_001',
            itemName: 'Screwdriver Set',
            category: 'Tools',
            unit: 'set',
            unitCost: '15.00',
            currentStock: 2,
            minStockLevel: 1,
            ownerPartnerId: 'UNITEFIX_PLATFORM',
            isActive: true
        }
    ];

    console.log("Seeding inventory items...");
    for (const item of items) {
        try {
            await db.insert(inventoryItems).values(item).onConflictDoNothing();
            console.log(`✅ Seeded item: ${item.itemCode}`);
        } catch (e) {
            console.error(`❌ Failed to seed ${item.itemCode}:`, e);
        }
    }

    console.log("✅ Seeding complete.");
    await pool.end();
}

main().catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
});
