/**
 * reset-render-db.ts
 *
 * Fully resets the Render database:
 *  1. DROP SCHEMA public CASCADE + CREATE SCHEMA public
 *  2. Re-create PostGIS extension if needed
 *  3. Done — drizzle-kit push or app startup will recreate tables
 *
 * Usage:
 *   npx tsx scripts/reset-render-db.ts
 */

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.RENDER_DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ RENDER_DATABASE_URL is not set in .env");
  process.exit(1);
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  UniteFix — Full Render DB Reset (Development)");
  console.log("═══════════════════════════════════════════════════");
  console.log("");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Verify connection
    const connResult = await pool.query("SELECT current_database() as db");
    console.log(`✅ Connected to: ${connResult.rows[0].db}`);
    console.log("");

    // Step 1: Drop everything
    console.log("🗑️  Step 1: Dropping all tables and types...");
    await pool.query("DROP SCHEMA public CASCADE;");
    await pool.query("CREATE SCHEMA public;");
    await pool.query("GRANT ALL ON SCHEMA public TO public;");
    console.log("   ✓ Schema dropped and recreated");

    // Step 2: Re-enable extensions
    console.log("");
    console.log("🔧 Step 2: Re-enabling extensions...");
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS postgis;");
      console.log("   ✓ PostGIS extension enabled");
    } catch (e: any) {
      console.log("   ⚠ PostGIS not available (non-critical):", e.message);
    }

    console.log("");
    console.log("═══════════════════════════════════════════════════");
    console.log("✅ Render database reset complete!");
    console.log("");
    console.log("Next steps:");
    console.log("  1. Run drizzle-kit push to recreate tables:");
    console.log('     $env:DATABASE_URL="<your RENDER_DATABASE_URL>"; npx drizzle-kit push');
    console.log("");
    console.log("  2. Or just redeploy on Render — the app startup");
    console.log("     will auto-run migrations if configured.");
    console.log("═══════════════════════════════════════════════════");
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }

  process.exit(0);
}

main();
