import { db } from "../server/db";
import { customers } from "../shared/schema";
import "dotenv/config";

async function main() {
  const allCustomers = await db.select().from(customers);
  console.log("Customers in DB:", JSON.stringify(allCustomers, null, 2));
  process.exit(0);
}
main().catch(console.error);
