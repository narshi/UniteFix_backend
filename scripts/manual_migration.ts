
import { pool } from "../server/db";

async function main() {
    console.log("Starting manual migration...");
    try {
        // 1. Create districts table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS districts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        state TEXT DEFAULT 'Karnataka',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log("✅ Table 'districts' ensured.");

        // 2. Add district_id to serviceable_pincodes
        try {
            await pool.query(`ALTER TABLE serviceable_pincodes ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(id);`);
            console.log("✅ Column 'district_id' added to serviceable_pincodes.");
        } catch (e: any) {
            console.log(`ℹ️ Note on column addition: ${e.message}`);
        }

        console.log("Migration complete.");
    } catch (err) {
        console.error("❌ Migration failed:", err);
    } finally {
        console.log("Exiting...");
        process.exit(0);
    }
}

main();
