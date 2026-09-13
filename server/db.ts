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

    // Cashfree payout beneficiary. Payouts moved off RazorpayX in September 2026;
    // the razorpay_* columns stay as they are, this sits beside them. Nullable and
    // additive — a partner is simply "not yet set up" until the first sync.
    await client.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS cashfree_bene_id TEXT;
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

    // ── FTTH plan add-ons ───────────────────────────────────────────────────
    // Telephone rental, OTT packs and the like, billed as their own lines
    // alongside the broadband plan. Entirely additive: a plan with no add-on
    // rows prices exactly as it did before this existed.
    await client.query(
      `DO ${'$do$'} BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_addon_kind') THEN
           CREATE TYPE ftth_addon_kind AS ENUM ('telephone', 'ott', 'iptv', 'static_ip', 'installation', 'other');
         END IF;
       END ${'$do$'};`
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS ftth_plan_addons (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES ftth_plans(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        kind ftth_addon_kind NOT NULL DEFAULT 'other',
        amount_paise INTEGER NOT NULL,
        is_optional BOOLEAN NOT NULL DEFAULT FALSE,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ftth_plan_addons_plan_idx ON ftth_plan_addons (plan_id, is_active);
    `);
    // What was actually bought, frozen onto the recharge. Existing rows default
    // to no add-ons and zero, which is exactly what they were.
    await client.query(`
      ALTER TABLE ftth_recharges ADD COLUMN IF NOT EXISTS addons_snapshot JSONB;
      ALTER TABLE ftth_recharges ADD COLUMN IF NOT EXISTS addons_total_paise INTEGER NOT NULL DEFAULT 0;
    `);

    // ── FTTH add-on catalogue (Phase 1 of the modular-packages plan) ─────────
    // The price moves off the per-plan row into a per-operator catalogue;
    // ftth_plan_addons becomes a link with an optional override. Everything
    // here is additive: a link row with catalog_id NULL prices exactly as it
    // did before this existed, so nothing changes on deploy until the backfill
    // is run and reviewed.
    await client.query(
      `DO ${'$do$'} BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_pricing_basis') THEN
           CREATE TYPE ftth_pricing_basis AS ENUM ('flat', 'per_month');
         END IF;
       END ${'$do$'};`
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS ftth_addon_catalog (
        id SERIAL PRIMARY KEY,
        operator_id INTEGER NOT NULL REFERENCES ftth_operators(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind ftth_addon_kind NOT NULL DEFAULT 'other',
        description TEXT,
        pricing_basis ftth_pricing_basis NOT NULL DEFAULT 'flat',
        default_price_paise INTEGER NOT NULL,
        default_optional BOOLEAN NOT NULL DEFAULT TRUE,
        exclusive_group TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ftth_addon_catalog_operator_idx ON ftth_addon_catalog (operator_id, is_active);
      CREATE UNIQUE INDEX IF NOT EXISTS ftth_addon_catalog_operator_name_idx ON ftth_addon_catalog (operator_id, name);
    `);
    // RESTRICT rather than CASCADE: deleting a catalogue item that plans still
    // link to must fail loudly, not silently un-bill a line from every plan.
    await client.query(`
      ALTER TABLE ftth_plan_addons ADD COLUMN IF NOT EXISTS catalog_id INTEGER REFERENCES ftth_addon_catalog(id) ON DELETE RESTRICT;
      ALTER TABLE ftth_plan_addons ADD COLUMN IF NOT EXISTS price_override_paise INTEGER;
      CREATE INDEX IF NOT EXISTS ftth_plan_addons_catalog_idx ON ftth_plan_addons (catalog_id);
    `);

    // Who keyed the claim in, when it did not come from the customer's own app.
    // Most warranty calls in Uttara Kannada arrive by telephone, and a claim the
    // office logged on someone's behalf must not be indistinguishable from one
    // the customer raised themselves — the claim stays attributed to the
    // customer, this records who took the call. Additive and nullable: existing
    // rows keep meaning exactly what they meant.
    await client.query(`
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS logged_by_admin_id INTEGER;
    `);

    // ═══════════════════════════════════════════════════════════════════════
    // Business partners, spare parts, deposits, B2B ordering.
    // See spare_parts_inventory_plan.md. Every statement is additive; nothing
    // existing is altered or dropped. Enums via DO blocks because CREATE TYPE
    // has no IF NOT EXISTS.
    // ═══════════════════════════════════════════════════════════════════════
    const bpEnums: Array<[string, string[]]> = [
      ['parts_access', ['none', 'requested', 'active', 'suspended']],
      ['business_partner_status', ['pending_approval', 'active', 'paused', 'disabled']],
      ['spare_part_status', ['active', 'discontinued', 'pending_review']],
      ['spare_part_proposal_status', ['pending', 'approved', 'rejected', 'merged']],
      ['stock_location', ['warehouse', 'technician']],
      ['stock_movement_type', ['purchase_in', 'transfer_to_technician', 'return_to_warehouse',
        'consumed', 'sold_to_partner', 'partner_return', 'adjustment', 'write_off']],
      ['deposit_status', ['unpaid', 'pending_payment', 'held', 'partially_drawn', 'refund_requested', 'refunded', 'forfeited']],
      ['deposit_entry_type', ['paid_in', 'drawn_warranty', 'drawn_shortage', 'drawn_damage', 'topped_up', 'refunded', 'adjustment']],
      ['b2b_order_status', ['draft', 'placed', 'paid', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned']],
      ['b2b_payment_mode', ['prepaid', 'credit']],
      ['b2b_payment_status', ['unpaid', 'paid', 'partially_paid', 'refunded']],
      ['b2b_event_type', ['placed', 'payment_received', 'confirmed', 'packed', 'dispatched', 'out_for_delivery',
        'delivered', 'cancelled', 'return_requested', 'returned', 'note']],
      ['b2b_actor_type', ['partner', 'admin', 'system']],
      ['bp_ledger_entry_type', ['order_invoice', 'payment_received', 'credit_note', 'refund', 'adjustment',
        'settlement_paid', 'settlement_received']],
    ];
    for (const [name, values] of bpEnums) {
      const labels = values.map(v => `'${v}'`).join(', ');
      await client.query(
        `DO ${'$do$'} BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
             CREATE TYPE ${name} AS ENUM (${labels});
           END IF;
         END ${'$do$'};`
      );
    }
    // A business partner signs into the mobile app like everyone else.
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'business_partner';`);

    // ── party model ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS partner_verticals (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Seeded, not hardcoded: admins add verticals the same way they add trades.
    await client.query(`
      INSERT INTO partner_verticals (code, name, description, sort_order) VALUES
        ('isp',          'Internet Service Provider', 'Sells broadband plans; settled through FTTH recharges', 10),
        ('computer',     'Computer Sales & Service',  'Sells and repairs computers and peripherals',            20),
        ('cctv',         'CCTV Installer',            'Installs and maintains surveillance systems',            30),
        ('electronics',  'Electronics Dealer',        'Retails appliances and electronics',                     40),
        ('consultation', 'Consultant',                'Advisory and design services',                           50),
        ('other',        'Other',                     'Anything not covered above',                             90)
      ON CONFLICT (code) DO NOTHING;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_partners (
        id SERIAL PRIMARY KEY,
        partner_code TEXT NOT NULL UNIQUE,
        legal_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        gstin TEXT, pan TEXT,
        contact_name TEXT,
        contact_phone TEXT NOT NULL,
        contact_email TEXT,
        address TEXT, pincode TEXT, district TEXT,
        status business_partner_status NOT NULL DEFAULT 'pending_approval',
        admin_user_id INTEGER REFERENCES admin_users(id),
        user_id INTEGER REFERENCES users(id),
        credit_limit_paise INTEGER NOT NULL DEFAULT 0,
        payment_terms_days INTEGER NOT NULL DEFAULT 0,
        beneficiary_name TEXT, bank_account_number TEXT, bank_ifsc TEXT, upi_id TEXT, cashfree_bene_id TEXT,
        approved_by_admin_id INTEGER REFERENCES admin_users(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS business_partners_status_idx ON business_partners (status);
      CREATE UNIQUE INDEX IF NOT EXISTS business_partners_admin_user_idx ON business_partners (admin_user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS business_partners_user_idx ON business_partners (user_id);
      CREATE TABLE IF NOT EXISTS business_partner_verticals (
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        vertical_id INTEGER NOT NULL REFERENCES partner_verticals(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (business_partner_id, vertical_id)
      );
      ALTER TABLE ftth_operators ADD COLUMN IF NOT EXISTS business_partner_id INTEGER REFERENCES business_partners(id);
      CREATE UNIQUE INDEX IF NOT EXISTS ftth_operators_business_partner_idx ON ftth_operators (business_partner_id);
    `);

    // ── spare parts ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_part_proposals (
        id SERIAL PRIMARY KEY,
        proposed_by_employee_id INTEGER NOT NULL REFERENCES employees(id),
        service_request_id INTEGER REFERENCES service_requests(id),
        name TEXT NOT NULL, brand TEXT, specification TEXT,
        category_id INTEGER REFERENCES service_categories(id),
        unit TEXT NOT NULL DEFAULT 'piece',
        indicative_price_paise INTEGER,
        vendor_name TEXT, photo_url TEXT,
        status spare_part_proposal_status NOT NULL DEFAULT 'pending',
        resolved_spare_part_id INTEGER,
        reviewed_by_admin_id INTEGER, reviewed_at TIMESTAMP, review_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS spare_part_proposals_status_idx ON spare_part_proposals (status);
      CREATE INDEX IF NOT EXISTS spare_part_proposals_proposer_idx ON spare_part_proposals (proposed_by_employee_id);

      CREATE TABLE IF NOT EXISTS spare_parts (
        id SERIAL PRIMARY KEY,
        part_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL, brand TEXT, specification TEXT,
        unit TEXT NOT NULL DEFAULT 'piece',
        unit_price_paise INTEGER NOT NULL,
        trade_price_paise INTEGER,
        cost_price_paise INTEGER,
        warranty_days INTEGER NOT NULL DEFAULT 0,
        gst_percent NUMERIC(4,2),
        photo_url TEXT,
        status spare_part_status NOT NULL DEFAULT 'active',
        created_from_proposal_id INTEGER REFERENCES spare_part_proposals(id),
        created_by_admin_id INTEGER,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS spare_parts_status_idx ON spare_parts (status, is_active);
      CREATE INDEX IF NOT EXISTS spare_parts_name_idx ON spare_parts (name);
      -- Proposals resolve to a part; the part may have come from a proposal.
      DO $fk$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spare_part_proposals_resolved_fk') THEN
          ALTER TABLE spare_part_proposals
            ADD CONSTRAINT spare_part_proposals_resolved_fk
            FOREIGN KEY (resolved_spare_part_id) REFERENCES spare_parts(id);
        END IF;
      END $fk$;

      CREATE TABLE IF NOT EXISTS spare_part_categories (
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (spare_part_id, category_id)
      );
      CREATE INDEX IF NOT EXISTS spare_part_categories_category_idx ON spare_part_categories (category_id);

      CREATE TABLE IF NOT EXISTS spare_part_stock (
        id SERIAL PRIMARY KEY,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
        location stock_location NOT NULL,
        holder_employee_id INTEGER REFERENCES employees(id),
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        reorder_level INTEGER NOT NULL DEFAULT 5,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS spare_part_stock_part_loc_holder_idx ON spare_part_stock (spare_part_id, location, holder_employee_id);
      -- One warehouse row per part (holder NULL), one kit row per (part, technician).
      CREATE UNIQUE INDEX IF NOT EXISTS spare_part_stock_warehouse_uq ON spare_part_stock (spare_part_id) WHERE location = 'warehouse';
      CREATE UNIQUE INDEX IF NOT EXISTS spare_part_stock_kit_uq ON spare_part_stock (spare_part_id, holder_employee_id) WHERE location = 'technician';

      ALTER TABLE service_part_items ADD COLUMN IF NOT EXISTS spare_part_id INTEGER REFERENCES spare_parts(id);
      ALTER TABLE service_part_items ADD COLUMN IF NOT EXISTS proposal_id INTEGER REFERENCES spare_part_proposals(id);
    `);

    // ── deposits ─────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS parts_access parts_access NOT NULL DEFAULT 'none';
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS parts_access_granted_at TIMESTAMP;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS parts_access_granted_by INTEGER;

      CREATE TABLE IF NOT EXISTS partner_deposits (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        purpose TEXT NOT NULL DEFAULT 'parts_access',
        required_paise INTEGER NOT NULL,
        paid_paise INTEGER NOT NULL DEFAULT 0,
        drawn_paise INTEGER NOT NULL DEFAULT 0,
        status deposit_status NOT NULL DEFAULT 'unpaid',
        razorpay_order_id TEXT, razorpay_payment_id TEXT,
        paid_at TIMESTAMP, refunded_at TIMESTAMP, refund_reference TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_deposits_employee_purpose_idx ON partner_deposits (employee_id, purpose);
      CREATE UNIQUE INDEX IF NOT EXISTS partner_deposits_rzp_order_idx ON partner_deposits (razorpay_order_id);
    `);

    // ── B2B orders (before movements and deposit ledger, which reference them) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS b2b_orders (
        id SERIAL PRIMARY KEY,
        order_code TEXT NOT NULL UNIQUE,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        status b2b_order_status NOT NULL DEFAULT 'placed',
        payment_mode b2b_payment_mode NOT NULL DEFAULT 'prepaid',
        payment_status b2b_payment_status NOT NULL DEFAULT 'unpaid',
        subtotal_paise INTEGER NOT NULL,
        gst_paise INTEGER NOT NULL DEFAULT 0,
        shipping_paise INTEGER NOT NULL DEFAULT 0,
        discount_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL,
        delivery_address JSONB, delivery_contact JSONB,
        razorpay_order_id TEXT, razorpay_payment_id TEXT,
        notes TEXT, cancel_reason TEXT,
        placed_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP, confirmed_at TIMESTAMP, dispatched_at TIMESTAMP, delivered_at TIMESTAMP, cancelled_at TIMESTAMP,
        confirmed_by_admin_id INTEGER, dispatched_by_admin_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS b2b_orders_partner_idx ON b2b_orders (business_partner_id, created_at);
      CREATE INDEX IF NOT EXISTS b2b_orders_status_idx ON b2b_orders (status);
      CREATE UNIQUE INDEX IF NOT EXISTS b2b_orders_rzp_order_idx ON b2b_orders (razorpay_order_id);

      CREATE TABLE IF NOT EXISTS b2b_order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES b2b_orders(id) ON DELETE CASCADE,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id),
        part_code TEXT NOT NULL, name TEXT NOT NULL, specification TEXT,
        quantity INTEGER NOT NULL,
        unit_price_paise INTEGER NOT NULL,
        gst_percent NUMERIC(4,2),
        line_total_paise INTEGER NOT NULL,
        quantity_fulfilled INTEGER NOT NULL DEFAULT 0,
        backordered BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE INDEX IF NOT EXISTS b2b_order_items_order_idx ON b2b_order_items (order_id);

      CREATE TABLE IF NOT EXISTS b2b_order_events (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES b2b_orders(id) ON DELETE CASCADE,
        event_type b2b_event_type NOT NULL,
        from_status TEXT, to_status TEXT,
        actor_type b2b_actor_type NOT NULL,
        actor_id INTEGER,
        payload JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS b2b_order_events_order_idx ON b2b_order_events (order_id, created_at);

      CREATE TABLE IF NOT EXISTS business_partner_ledger (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        entry_type bp_ledger_entry_type NOT NULL,
        amount_paise INTEGER NOT NULL,
        b2b_order_id INTEGER REFERENCES b2b_orders(id),
        payment_transaction_id INTEGER,
        balance_before_paise INTEGER NOT NULL,
        balance_after_paise INTEGER NOT NULL,
        description TEXT, metadata JSONB,
        created_by_admin_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS bp_ledger_partner_idx ON business_partner_ledger (business_partner_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS bp_ledger_order_entry_idx ON business_partner_ledger (entry_type, b2b_order_id);

      ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS b2b_order_id INTEGER REFERENCES b2b_orders(id);
      ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS partner_deposit_id INTEGER REFERENCES partner_deposits(id);
    `);

    // ── movements + deposit ledger (reference the tables above) ─────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS spare_part_movements (
        id SERIAL PRIMARY KEY,
        movement_id TEXT NOT NULL UNIQUE,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id),
        movement_type stock_movement_type NOT NULL,
        quantity INTEGER NOT NULL,
        from_location stock_location, to_location stock_location,
        from_holder_employee_id INTEGER, to_holder_employee_id INTEGER,
        service_request_id INTEGER REFERENCES service_requests(id),
        service_part_item_id INTEGER REFERENCES service_part_items(id),
        b2b_order_item_id INTEGER REFERENCES b2b_order_items(id),
        unit_cost_paise INTEGER,
        performed_by_employee_id INTEGER, performed_by_admin_id INTEGER,
        stock_before INTEGER NOT NULL, stock_after INTEGER NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS spare_part_movements_part_idx ON spare_part_movements (spare_part_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS spare_part_movements_line_idx ON spare_part_movements (service_part_item_id, movement_type);
      CREATE UNIQUE INDEX IF NOT EXISTS spare_part_movements_b2b_line_idx ON spare_part_movements (b2b_order_item_id, movement_type);

      CREATE TABLE IF NOT EXISTS partner_deposit_ledger (
        id SERIAL PRIMARY KEY,
        deposit_id INTEGER NOT NULL REFERENCES partner_deposits(id),
        entry_type deposit_entry_type NOT NULL,
        amount_paise INTEGER NOT NULL,
        warranty_claim_id INTEGER REFERENCES warranty_claims(id),
        spare_part_movement_id INTEGER REFERENCES spare_part_movements(id),
        balance_before_paise INTEGER NOT NULL,
        balance_after_paise INTEGER NOT NULL,
        created_by_admin_id INTEGER,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_deposit_ledger_deposit_idx ON partner_deposit_ledger (deposit_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS partner_deposit_ledger_claim_idx ON partner_deposit_ledger (warranty_claim_id, entry_type);
    `);

    // Config the deposit reads. Editable on the Settings page.
    await client.query(`
      INSERT INTO platform_config (key, value, value_type, category, description, is_editable) VALUES
        ('BUSINESS_CONFIG.PARTS_DEPOSIT_PAISE',        '500000', 'number', 'BUSINESS_CONFIG', 'Deposit a technician pays to fit parts from UniteFix stock (paise)', TRUE),
        ('BUSINESS_CONFIG.PARTS_DEPOSIT_FLOOR_PERCENT', '40',     'number', 'BUSINESS_CONFIG', 'Parts access is suspended when the remaining deposit falls below this % of the required amount', TRUE)
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log('[DB] Startup schema migrations verified successfully');
  } catch (err: any) {
    console.error('[DB] Startup migration error:', err.message);
  } finally {
    client.release();
  }
}
