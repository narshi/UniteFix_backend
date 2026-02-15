import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../server/db";

async function main() {
    console.log("Starting migration process...");
    try {
        // This will create all tables defined in the schema
        await migrate(db, { migrationsFolder: "migrations" });
        console.log("✅ Database schema migrated successfully!");
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
