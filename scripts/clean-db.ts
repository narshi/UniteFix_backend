import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function clean() {
    console.log("Wiping all user and employee data for a fresh start...");
    
    try {
        // TRUNCATE with CASCADE will safely delete all users and automatically
        // clear out any dependent rows in customers, employees, service_requests,
        // wallet_transactions, reviews, support_tickets, etc.
        // It will NOT touch catalog data like services or categories.
        await db.execute(sql`TRUNCATE TABLE users CASCADE`);
        console.log("✅ Successfully wiped users and employee data.");
    } catch (e) {
        console.error("Error wiping data:", e);
    }
    
    process.exit(0);
}

clean().catch(console.error);
