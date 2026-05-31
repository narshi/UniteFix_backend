import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { users, customers } from "../shared/schema";
import "dotenv/config";

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.RENDER_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const db = drizzle(pool);

  // create dummy user
  const [user] = await db.insert(users).values({
    username: "Test Address",
    phone: Date.now().toString().slice(-10),
    role: "user"
  }).returning();
  
  console.log("User created:", user.id);

  const savedAddresses = [{ label: "Home", address: "123 Test", lat: 10, long: 20 }];
  
  await db.insert(customers).values({
    userId: user.id,
    savedAddresses
  });
  
  const [cust] = await db.select().from(customers).where(sql`user_id = ${user.id}`);
  console.log("Customer savedAddresses:", cust.savedAddresses);
  console.log("Type of savedAddresses:", typeof cust.savedAddresses);
  
  await db.update(customers).set({ savedAddresses: [{ label: "Work", address: "456 Work St", lat: 50, long: 60 }] }).where(sql`user_id = ${user.id}`);
  
  const [cust2] = await db.select().from(customers).where(sql`user_id = ${user.id}`);
  console.log("Customer savedAddresses after update:", cust2.savedAddresses);
  
  await pool.end();
}
main().catch(console.error);
