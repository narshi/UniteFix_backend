/**
 * Idempotent schema for the admin dashboard work: manual bills (counter sales)
 * and the indexes the new server-side list endpoints sort and filter on.
 *
 * Shipped as a script rather than a .sql file because `migrations/` is
 * gitignored, so SQL files never reach the deployed container. Run it from the
 * Render shell after a deploy:
 *
 *   npm run migrate:admin
 *
 * Safe to run repeatedly — every statement is IF NOT EXISTS and only ever adds.
 * It never drops, alters or writes rows.
 */

import pg from 'pg';

const { Pool } = pg;

const SQL = `
-- Counter-sale bills raised at the shop for in-house visits.
-- The invoice itself lives in `+"`invoices`"+` (shared numbering, GST and PDF path);
-- this table holds only the itemisation and who raised it. A manual bill is
-- recognised by its invoice having neither service_request_id nor
-- product_order_id — both are already nullable.
CREATE TABLE IF NOT EXISTS manual_bills (
    id         SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    items      JSONB   NOT NULL,
    notes      TEXT,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manual_bills_invoice_idx
    ON manual_bills (invoice_id);

-- The admin list pages page, sort and filter on these. Without them every
-- page load is a sequential scan once the tables grow.
CREATE INDEX IF NOT EXISTS users_role_created_idx
    ON users (role, created_at);

CREATE INDEX IF NOT EXISTS employees_verification_created_idx
    ON employees (document_verification_status, created_at);

CREATE INDEX IF NOT EXISTS service_requests_status_created_idx
    ON service_requests (status, created_at);

-- The trade list a service expert ticks during signup. Separate from
-- service_categories on purpose: those describe what the CUSTOMER buys, this
-- describes what the EXPERT does.
CREATE TABLE IF NOT EXISTS technician_types (
    id           SERIAL PRIMARY KEY,
    name         TEXT    NOT NULL,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    source       TEXT    NOT NULL DEFAULT 'admin',  -- 'admin' | 'expert'
    suggested_by INTEGER,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

-- Case-insensitive uniqueness. Experts can add missing trades from the signup
-- screen, so without this the list fills with "Electrician" / "electrician" /
-- "ELECTRICIAN". The API dedupes too, but two experts suggesting the same trade
-- simultaneously would both pass that check — this is what actually stops it.
CREATE UNIQUE INDEX IF NOT EXISTS technician_types_name_lower_idx
    ON technician_types (lower(name));

CREATE INDEX IF NOT EXISTS technician_types_active_sort_idx
    ON technician_types (is_active, sort_order);

-- Starting set: the trades implied by the current service catalogue, plus the
-- common home-services ones. Admins can rename, reorder, deactivate or delete
-- any of these. ON CONFLICT means re-running never duplicates or resets edits.
INSERT INTO technician_types (name, sort_order, source) VALUES
    ('Computer Technician',        10, 'admin'),
    ('Printer Technician',         20, 'admin'),
    ('CCTV Technician',            30, 'admin'),
    ('Biometric Device Technician',40, 'admin'),
    ('UPS & Battery Technician',   50, 'admin'),
    ('Solar Technician',           60, 'admin'),
    ('Water Purifier Technician',  70, 'admin'),
    ('Networking & Internet Technician', 80, 'admin'),
    ('Electrician',                90, 'admin'),
    ('Plumber',                   100, 'admin'),
    ('Carpenter',                 110, 'admin'),
    ('Painter',                   120, 'admin'),
    ('AC Technician',             130, 'admin'),
    ('Appliance Repair Technician',140, 'admin')
ON CONFLICT DO NOTHING;

-- Schema drift: shared/schema.ts declares withdrawal_requests.payment_proof_url
-- (the manual-payout proof screenshot) but the column was never added to some
-- databases, so ANY select of the table 500s with "column does not exist".
ALTER TABLE withdrawal_requests
    ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
`;

const url = process.env.DATABASE_URL;

if (!url) {
    console.error('DATABASE_URL is not set. Run this where the app runs, or export it first.');
    process.exit(1);
}

// Managed Postgres (Render, Neon) terminates TLS with a certificate this client
// has no root for. Local/internal connections need no SSL at all.
const needsSsl = /\.render\.com|\.neon\.tech|amazonaws\.com/.test(url);

const pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
});

try {
    const host = url.replace(/:[^:@]*@/, ':***@').split('@')[1] ?? '(unknown host)';
    console.log(`Applying admin migrations to ${host}`);

    await pool.query(SQL);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM manual_bills');
    const trades = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE source = 'expert')::int AS suggested
         FROM technician_types`
    );
    const proof = await pool.query(
        `SELECT COUNT(*)::int AS c FROM information_schema.columns
         WHERE table_name = 'withdrawal_requests' AND column_name = 'payment_proof_url'`
    );
    const idx = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE indexname IN (
            'manual_bills_invoice_idx',
            'users_role_created_idx',
            'employees_verification_created_idx',
            'service_requests_status_created_idx',
            'technician_types_name_lower_idx',
            'technician_types_active_sort_idx'
        )
        ORDER BY indexname
    `);

    console.log(`OK — manual_bills present (${rows[0].c} rows)`);
    console.log(`OK — technician_types present (${trades.rows[0].total} trades, ${trades.rows[0].suggested} expert-suggested)`);
    console.log(`OK — withdrawal_requests.payment_proof_url ${proof.rows[0].c ? 'present' : 'MISSING'}`);
    console.log(`OK — indexes: ${idx.rows.map((r) => r.indexname).join(', ')}`);
} catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
