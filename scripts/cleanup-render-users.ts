/**
 * cleanup-render-users.ts
 * 
 * Deletes ALL customer/user and employee registration data from the Render database.
 * PRESERVES: admin_users, platform_config, service catalog, districts, pincodes, inventory.
 * 
 * Usage:
 *   1. Add RENDER_DATABASE_URL=postgresql://... to your .env
 *   2. Run: npx tsx scripts/cleanup-render-users.ts
 */

import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const { Pool } = pg;

const DATABASE_URL = process.env.RENDER_DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ RENDER_DATABASE_URL is not set in .env");
  console.error("   Add it like: RENDER_DATABASE_URL=postgresql://user:pass@host:5432/dbname");
  process.exit(1);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  UniteFix — Render DB Cleanup (Customer + Employee Data)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("🔗 Connecting to Render database...");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: false }, // Render requires SSL
  });

  const db = drizzle(pool);

  try {
    // Verify connection
    const result = await db.execute(sql`SELECT current_database() as db, now() as time`);
    console.log(`✅ Connected to database: ${(result as any).rows?.[0]?.db || 'unknown'}`);
    console.log("");

    // Count records before deletion
    console.log("📊 Current record counts:");
    const counts = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM users WHERE role != 'admin'`),
      db.execute(sql`SELECT COUNT(*) as count FROM customers`),
      db.execute(sql`SELECT COUNT(*) as count FROM employees`),
      db.execute(sql`SELECT COUNT(*) as count FROM service_requests`),
      db.execute(sql`SELECT COUNT(*) as count FROM product_orders`),
      db.execute(sql`SELECT COUNT(*) as count FROM notifications`),
      db.execute(sql`SELECT COUNT(*) as count FROM otp_verifications`),
    ]);
    console.log(`   Users (non-admin):    ${(counts[0] as any).rows[0].count}`);
    console.log(`   Customers:            ${(counts[1] as any).rows[0].count}`);
    console.log(`   Employees:            ${(counts[2] as any).rows[0].count}`);
    console.log(`   Service Requests:     ${(counts[3] as any).rows[0].count}`);
    console.log(`   Product Orders:       ${(counts[4] as any).rows[0].count}`);
    console.log(`   Notifications:        ${(counts[5] as any).rows[0].count}`);
    console.log(`   OTP Verifications:    ${(counts[6] as any).rows[0].count}`);
    console.log("");

    console.log("🗑️  Deleting data (in dependency order — child tables first)...");
    console.log("");

    // ────────────────────────────────────────────────
    // DELETE in reverse-dependency order (children first)
    // ────────────────────────────────────────────────

    // 1. Refunds (depends on payment_transactions, return_requests)
    const r1 = await db.execute(sql`DELETE FROM refunds`);
    console.log(`   ✓ refunds:                  ${(r1 as any).rowCount ?? 0} rows deleted`);

    // 2. Return Requests (depends on product_orders, users)
    const r2 = await db.execute(sql`DELETE FROM return_requests`);
    console.log(`   ✓ return_requests:           ${(r2 as any).rowCount ?? 0} rows deleted`);

    // 3. Payment Transactions (depends on product_orders, service_requests)
    const r3 = await db.execute(sql`DELETE FROM payment_transactions`);
    console.log(`   ✓ payment_transactions:      ${(r3 as any).rowCount ?? 0} rows deleted`);

    // 4. Shipments (depends on product_orders)
    const r4 = await db.execute(sql`DELETE FROM shipments`);
    console.log(`   ✓ shipments:                 ${(r4 as any).rowCount ?? 0} rows deleted`);

    // 5. Cart Items (depends on users, products)
    const r5 = await db.execute(sql`DELETE FROM cart_items`);
    console.log(`   ✓ cart_items:                ${(r5 as any).rowCount ?? 0} rows deleted`);

    // 6. Product Orders (depends on users)
    const r6 = await db.execute(sql`DELETE FROM product_orders`);
    console.log(`   ✓ product_orders:            ${(r6 as any).rowCount ?? 0} rows deleted`);

    // 7. Ticket Messages (depends on support_tickets)
    const r7 = await db.execute(sql`DELETE FROM ticket_messages`);
    console.log(`   ✓ ticket_messages:           ${(r7 as any).rowCount ?? 0} rows deleted`);

    // 8. Support Tickets (depends on users, service_requests)
    const r8 = await db.execute(sql`DELETE FROM support_tickets`);
    console.log(`   ✓ support_tickets:           ${(r8 as any).rowCount ?? 0} rows deleted`);

    // 9. Ratings (depends on service_requests, users, employees)
    const r9 = await db.execute(sql`DELETE FROM ratings`);
    console.log(`   ✓ ratings:                   ${(r9 as any).rowCount ?? 0} rows deleted`);

    // 10. Service OTPs (depends on service_requests)
    const r10 = await db.execute(sql`DELETE FROM service_otps`);
    console.log(`   ✓ service_otps:              ${(r10 as any).rowCount ?? 0} rows deleted`);

    // 11. Service Charges (depends on service_requests)
    const r11 = await db.execute(sql`DELETE FROM service_charges`);
    console.log(`   ✓ service_charges:           ${(r11 as any).rowCount ?? 0} rows deleted`);

    // 12. Inventory Transactions (depends on inventory_items, service_requests)
    const r12 = await db.execute(sql`DELETE FROM inventory_transactions`);
    console.log(`   ✓ inventory_transactions:    ${(r12 as any).rowCount ?? 0} rows deleted`);

    // 13. Wallet Transactions V2 (depends on employees, service_requests)
    const r13 = await db.execute(sql`DELETE FROM wallet_transactions_v2`);
    console.log(`   ✓ wallet_transactions_v2:    ${(r13 as any).rowCount ?? 0} rows deleted`);

    // 14. Wallet Transactions (legacy) (depends on employees, service_requests)
    const r14 = await db.execute(sql`DELETE FROM wallet_transactions`);
    console.log(`   ✓ wallet_transactions:       ${(r14 as any).rowCount ?? 0} rows deleted`);

    // 15. Partner Wallets (depends on employees)
    const r15 = await db.execute(sql`DELETE FROM partner_wallets`);
    console.log(`   ✓ partner_wallets:           ${(r15 as any).rowCount ?? 0} rows deleted`);

    // 16. Invoices (depends on service_requests, product_orders, users, employees)
    const r16 = await db.execute(sql`DELETE FROM invoices`);
    console.log(`   ✓ invoices:                  ${(r16 as any).rowCount ?? 0} rows deleted`);

    // 17. Service Requests (depends on users, employees)
    const r17 = await db.execute(sql`DELETE FROM service_requests`);
    console.log(`   ✓ service_requests:          ${(r17 as any).rowCount ?? 0} rows deleted`);

    // 18. Audit Logs (no strict FK, but clean up user-related entries)
    const r18 = await db.execute(sql`DELETE FROM audit_logs`);
    console.log(`   ✓ audit_logs:                ${(r18 as any).rowCount ?? 0} rows deleted`);

    // 19. Notifications (depends on users)
    const r19 = await db.execute(sql`DELETE FROM notifications`);
    console.log(`   ✓ notifications:             ${(r19 as any).rowCount ?? 0} rows deleted`);

    // 20. Device Tokens (depends on users)
    const r20 = await db.execute(sql`DELETE FROM device_tokens`);
    console.log(`   ✓ device_tokens:             ${(r20 as any).rowCount ?? 0} rows deleted`);

    // 21. Social Auth Providers (depends on users)
    const r21 = await db.execute(sql`DELETE FROM social_auth_providers`);
    console.log(`   ✓ social_auth_providers:     ${(r21 as any).rowCount ?? 0} rows deleted`);

    // 22. OTP Verifications (standalone)
    const r22 = await db.execute(sql`DELETE FROM otp_verifications`);
    console.log(`   ✓ otp_verifications:         ${(r22 as any).rowCount ?? 0} rows deleted`);

    // 23. Employees (depends on users)
    const r23 = await db.execute(sql`DELETE FROM employees`);
    console.log(`   ✓ employees:                 ${(r23 as any).rowCount ?? 0} rows deleted`);

    // 24. Customers (depends on users)
    const r24 = await db.execute(sql`DELETE FROM customers`);
    console.log(`   ✓ customers:                 ${(r24 as any).rowCount ?? 0} rows deleted`);

    // 25. Users (ONLY non-admin users) — admin accounts stay
    const r25 = await db.execute(sql`DELETE FROM users WHERE role != 'admin'`);
    console.log(`   ✓ users (non-admin):         ${(r25 as any).rowCount ?? 0} rows deleted`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✅ Cleanup complete!");
    console.log("");
    console.log("🛡️  PRESERVED tables:");
    console.log("   • admin_users (separate admin table)");
    console.log("   • users with role='admin' (auth table admin entries)");
    console.log("   • platform_config");
    console.log("   • service_categories, services (service catalog)");
    console.log("   • product_categories, product_brands, products, product_variants, product_images");
    console.log("   • districts, serviceable_pincodes");
    console.log("   • inventory_items");
    console.log("═══════════════════════════════════════════════════════════");

  } catch (error: any) {
    console.error("");
    console.error("❌ Error during cleanup:", error.message);
    if (error.detail) console.error("   Detail:", error.detail);
    if (error.table) console.error("   Table:", error.table);
    process.exit(1);
  } finally {
    await pool.end();
  }

  process.exit(0);
}

main();
