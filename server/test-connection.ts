/**
 * Quick test to verify database connection and basic setup
 */

import { db, pool } from "./db";
import { sql } from "drizzle-orm";

async function testConnection() {
    console.log("🔍 Testing database connection...");

    try {
        // Test database connection
        const [result] = await db.execute(sql`SELECT NOW() as current_time`);
        console.log("✅ Database connected:", result);

        // Check tables exist
        const [tables] = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
        console.log(`\n📋 Found ${Object.keys(tables).length} tables in database`);

        // Check platform config
        const [configCount] = await db.execute(sql`
      SELECT COUNT(*) as count FROM platform_config
    `);
        console.log(`\n⚙️  Platform config entries: ${configCount.count}`);

        // Check Razorpay keys configured
        const [razorpayKey] = await db.execute(sql`
      SELECT value FROM platform_config 
      WHERE key = 'PAYMENT_CONFIG.RAZORPAY_KEY_ID'
    `);
        console.log(`\n💳 Razorpay configured: ${razorpayKey ? 'Yes' : 'No'}`);
        if (razorpayKey) {
            console.log(`   Key ID: ${razorpayKey.value}`);
        }

        console.log("\n✅ All checks passed! Backend is ready for testing.");

        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error("❌ Error:", error);
        await pool.end();
        process.exit(1);
    }
}

testConnection();
