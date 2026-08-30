/**
 * FTTH Phase 0 — operator identity and serviceability.
 *
 * Shipped as a script rather than a .sql file because `migrations/` is
 * gitignored, so SQL files never reach the deployed container. Run it from the
 * Render shell after a deploy:
 *
 *   npm run migrate:ftth
 *
 * Safe to run repeatedly — every statement is IF NOT EXISTS and only ever adds.
 * It never drops, alters or writes rows.
 *
 * Note what is NOT here: there is no `ALTER TYPE user_role ADD VALUE 'operator'`.
 * Operator logins live in `admin_users.role`, which is plain TEXT, so this needs
 * no enum surgery — and `authenticateAdmin` already refuses every role that is
 * not admin/super_admin, which is what keeps the existing /api/admin/* surface
 * closed to operators without a per-route allowlist.
 */

import pg from 'pg';

const { Pool } = pg;

const SQL = `
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_operator_status') THEN
        CREATE TYPE ftth_operator_status AS ENUM (
            'pending_approval', 'active', 'paused', 'disabled'
        );
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS ftth_operators (
    id                     SERIAL PRIMARY KEY,
    -- NULL until a super_admin approves and the login is minted, so an
    -- application exists with no way to sign in. That is the point.
    admin_user_id          INTEGER UNIQUE REFERENCES admin_users(id),
    company_name           TEXT NOT NULL,
    legal_name             TEXT,
    gstin                  TEXT,
    contact_name           TEXT,
    contact_email          TEXT NOT NULL,
    contact_phone          TEXT NOT NULL,
    logo_url               TEXT,
    brand_color            TEXT,
    status                 ftth_operator_status NOT NULL DEFAULT 'pending_approval',
    -- Commercial terms are per operator: you will not agree the same lead bounty
    -- with every ISP. NULL falls back to FTTH_CONFIG.DEFAULT_* platform config.
    lead_fee_paise         INTEGER,
    convenience_fee_paise  INTEGER,
    approved_by_admin_id   INTEGER REFERENCES admin_users(id),
    approved_at            TIMESTAMP,
    rejection_reason       TEXT,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ftth_operators_admin_user_idx
    ON ftth_operators (admin_user_id);
CREATE INDEX IF NOT EXISTS ftth_operators_status_idx
    ON ftth_operators (status);

-- Serviceability. With one operator you can list everyone; at fifteen across the
-- district, a customer in Yellapur must not be offered an ISP that only wires
-- Karwar. FKs to the existing coverage model rather than storing free text, so
-- an operator can only claim pincodes UniteFix actually operates in.
CREATE TABLE IF NOT EXISTS ftth_operator_pincodes (
    operator_id  INTEGER NOT NULL REFERENCES ftth_operators(id) ON DELETE CASCADE,
    pincode      TEXT    NOT NULL REFERENCES serviceable_pincodes(pincode),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (operator_id, pincode)
);

CREATE INDEX IF NOT EXISTS ftth_operator_pincodes_pincode_idx
    ON ftth_operator_pincodes (pincode);
`;

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=disable')
            ? false
            : { rejectUnauthorized: false },
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(SQL);
        await client.query('COMMIT');

        const { rows } = await client.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_name IN ('ftth_operators','ftth_operator_pincodes')
              ORDER BY table_name`,
        );
        console.log('FTTH Phase 0 applied. Tables present:', rows.map(r => r.table_name).join(', '));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('FTTH Phase 0 migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
