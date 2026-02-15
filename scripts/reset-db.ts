import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    console.log("WARNING: This will DROP ALL DATA in the database.");
    console.log("Executing: DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

    try {
        await db.execute(sql`DROP SCHEMA public CASCADE;`);
        await db.execute(sql`CREATE SCHEMA public;`);
        // Add back standard extensions if needed? usually pgcrypto or uuid-ossp
        // But drizzle handles UUIDs or serials usually without extensions.
        // If we use PostGIS? server/storage.ts has updated location logic.
        // It uses float lat/long so no PostGIS extension required.

        console.log("Database reset successfully.");
    } catch (error) {
        console.error("Failed to reset database:", error);
        process.exit(1);
    }
    process.exit(0);
}

main();
