import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Production-ready pool configuration
const isRemoteDb = process.env.DATABASE_URL.includes("render.com") || 
                   process.env.DATABASE_URL.includes("amazonaws.com") ||
                   process.env.DB_SSL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '50'),                // Maximum connections (up from 20)
  idleTimeoutMillis: 30000,                                       // Close idle clients after 30s
  connectionTimeoutMillis: 5000,                                  // Fail fast if DB unreachable
  allowExitOnIdle: process.env.NODE_ENV !== 'production',         // Allow clean exit in dev
  application_name: 'unitefix-backend',                           // Shows in pg_stat_activity
  options: '-c statement_timeout=30000',                          // 30s query timeout — prevents connection hogging
  ssl: isRemoteDb ? { rejectUnauthorized: false } : undefined,
});

// Log pool errors (don't crash the process)
pool.on('error', (err) => {
  console.error('[DB POOL] Unexpected error on idle client:', err.message);
});

export const db = drizzle(pool, { schema });

/**
 * Automatically applies non-destructive idempotent DDL migrations on server startup.
 */
export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Make ftth_connections.user_id nullable if not already
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'ftth_connections' 
          AND column_name = 'user_id' 
          AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE ftth_connections ALTER COLUMN user_id DROP NOT NULL;
        END IF;
      END $$;
    `);

    // 2. Add customer_phone and customer_email to ftth_connections
    await client.query(`
      ALTER TABLE ftth_connections 
      ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
      ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
    `);

    // 3. Create index for fast phone lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS ftth_conn_op_phone_idx 
      ON ftth_connections (operator_id, customer_phone);
    `);

    // 4. Drop legacy UNIQUE constraint/index on (user_id, operator_id) and recreate as standard index
    // so a customer/business can have multiple broadband lines under the same operator
    await client.query(`
      ALTER TABLE ftth_connections DROP CONSTRAINT IF EXISTS ftth_conn_user_operator_idx;
      DROP INDEX IF EXISTS ftth_conn_user_operator_idx;
      CREATE INDEX IF NOT EXISTS ftth_conn_user_operator_idx ON ftth_connections (user_id, operator_id);
    `);

    // 5. Quantity on a booking — 2 ACs, 4 CCTV cameras, 3 fan points.
    //
    // DEFAULT 1 NOT NULL, deliberately: every booking made before this column
    // existed was one unit, and backfilling them to that is the truth rather
    // than a guess. A nullable column would leave every invoice, job card and
    // admin row deciding for itself what null meant.
    //
    // The CHECK is not paranoia — the stepper is a client control, and nothing
    // else stops a crafted request booking 9,999 air conditioners and freezing
    // a five-lakh-rupee snapshot onto a job nobody can do.
    await client.query(`
      ALTER TABLE service_requests
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_quantity_sane'
        ) THEN
          ALTER TABLE service_requests
          ADD CONSTRAINT service_requests_quantity_sane
          CHECK (quantity >= 1 AND quantity <= 50);
        END IF;
      END $$;
    `);

    // 6. Plan recommendation badge for annual packs / best value push
    await client.query(`
      ALTER TABLE ftth_plans
      ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS badge_text TEXT;
    `);

    // 7. employees.negative_balance_flag
    //
    // NOT this feature's column — it was added to shared/schema.ts without a
    // matching migration, so the column did not exist while Drizzle selected it
    // on every employees query. That is not a narrow failure: db.select().from(
    // employees) names every mapped column, so partner profile, payouts, wallet
    // and assignment all returned 500 until this was added.
    //
    // Added here rather than left to whoever owns the feature because an
    // additive nullable boolean cannot conflict with their work, and the
    // alternative was shipping a schema that breaks on contact with the
    // database.
    await client.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS negative_balance_flag BOOLEAN DEFAULT FALSE;
    `);

    // 8. Spare parts provenance and warranty claims.
    //
    // The enums are created defensively: CREATE TYPE has no IF NOT EXISTS, and a
    // startup migration that throws on the second boot is worse than useless.
    const enums: Array<[string, string[]]> = [
      ['part_source_type', ['platform', 'approved_vendor', 'technician_local', 'customer_supplied']],
      ['warranty_backer', ['unitefix', 'vendor', 'manufacturer', 'none']],
      ['warranty_claim_status', ['open', 'inspecting', 'resolved', 'rejected']],
      ['warranty_verdict', ['workmanship_fault', 'part_failed', 'customer_damage', 'out_of_warranty', 'unrelated']],
      ['warranty_cost_bearer', ['unitefix', 'vendor', 'technician', 'customer']],
    ];
    for (const [name, values] of enums) {
      const labels = values.map(v => `'${v}'`).join(', ');
      await client.query(
        `DO ${'$do$'} BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
             CREATE TYPE ${name} AS ENUM (${labels});
           END IF;
         END ${'$do$'};`
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS service_part_items (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id),
        part_name TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        source_type part_source_type NOT NULL DEFAULT 'technician_local',
        vendor_name TEXT,
        vendor_id INTEGER,
        unit_price_paise INTEGER NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL DEFAULT 1,
        warranty_days INTEGER NOT NULL DEFAULT 0,
        warranty_backer warranty_backer NOT NULL DEFAULT 'none',
        vendor_bill_date TIMESTAMP,
        installed_at TIMESTAMP,
        warranty_starts_at TIMESTAMP,
        warranty_expires_at TIMESTAMP,
        bill_photo_url TEXT,
        serial_number TEXT,
        is_documented BOOLEAN NOT NULL DEFAULT FALSE,
        recorded_by INTEGER,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS service_part_items_service_idx ON service_part_items (service_request_id);
      CREATE INDEX IF NOT EXISTS service_part_items_expiry_idx  ON service_part_items (warranty_expires_at);
      CREATE INDEX IF NOT EXISTS service_part_items_source_idx  ON service_part_items (source_type);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS warranty_claims (
        id SERIAL PRIMARY KEY,
        claim_id TEXT NOT NULL UNIQUE,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id),
        part_item_id INTEGER REFERENCES service_part_items(id),
        raised_by_user_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        status warranty_claim_status NOT NULL DEFAULT 'open',
        verdict warranty_verdict,
        verdict_notes TEXT,
        cost_bearer warranty_cost_bearer,
        inspected_by INTEGER,
        inspected_at TIMESTAMP,
        resolution_service_request_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS warranty_claims_service_idx ON warranty_claims (service_request_id);
      CREATE INDEX IF NOT EXISTS warranty_claims_status_idx  ON warranty_claims (status);
    `);

    console.log('[DB] Startup schema migrations verified successfully');
  } catch (err: any) {
    console.error('[DB] Startup migration error:', err.message);
  } finally {
    client.release();
  }
}
