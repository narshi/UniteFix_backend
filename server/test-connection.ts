/**
 * Quick test to verify database connection and basic setup
 */

import { db, pool } from "./db";
import { sql } from "drizzle-orm";

async function testConnection() {
  console.log("🔍 Testing database connection...");

  try {
    // Test database connection
    const result = await db.execute(sql`SELECT NOW() as current_time`) as any;
    console.log("✅ Database connected:", result?.[0]);

    // Check tables exist
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `) as any;
    console.log(`\n📋 Found ${tables?.length || 0} tables in database`);

    // Check platform config
    const configResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM platform_config
    `) as any;
    const configCount = configResult?.[0];
    console.log(`\n⚙️  Platform config entries: ${configCount?.count || 0}`);

    // Check Razorpay keys configured
    const razorpayResult = await db.execute(sql`
      SELECT value FROM platform_config 
      WHERE key = 'PAYMENT_CONFIG.RAZORPAY_KEY_ID'
    `) as any;
    const razorpayKey = razorpayResult?.[0];
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
