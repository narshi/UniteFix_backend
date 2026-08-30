/**
 * FTTH Roster Migration — allows pre-seeding operator customer rosters
 *
 * 1. Alter ftth_connections.user_id to be NULLABLE
 * 2. Add customer_phone and customer_email to ftth_connections
 * 3. Add index on (operator_id, customer_phone)
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const SQL = `
-- 1. Make user_id nullable in ftth_connections so pre-seeded operator rosters can exist
ALTER TABLE ftth_connections ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add customer_phone and customer_email columns if they do not exist
ALTER TABLE ftth_connections ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE ftth_connections ADD COLUMN IF NOT EXISTS customer_email TEXT;

-- 3. Replace unique index on (user_id, operator_id) with non-unique index since multiple pre-seeded rows may have user_id IS NULL
DROP INDEX IF EXISTS ftth_conn_user_operator_idx;
CREATE INDEX IF NOT EXISTS ftth_conn_user_operator_idx ON ftth_connections (user_id, operator_id);

-- 4. Create index on (operator_id, customer_phone) for rapid phone lookup on signup/login
CREATE INDEX IF NOT EXISTS ftth_conn_op_phone_idx ON ftth_connections (operator_id, customer_phone);
`;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

async function main() {
    const client = await pool.connect();
    try {
        console.log('[MIGRATION] Applying FTTH roster schema updates...');
        await client.query('BEGIN');
        await client.query(SQL);
        await client.query('COMMIT');
        console.log('[MIGRATION] Successfully updated ftth_connections schema.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[MIGRATION] Failed:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
