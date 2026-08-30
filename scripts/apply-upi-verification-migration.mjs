/**
 * Record whether a partner's UPI id was ever actually checked.
 *
 *   npm run migrate:upi
 *
 * Shipped as a script because migrations/ is gitignored and never reaches the
 * deployed container. Additive and idempotent: two nullable columns, nothing
 * dropped, no rows written.
 *
 * Existing partners keep upi_verified_at NULL, which reads as "nobody checked"
 * — the truth. It must not be backfilled to a date, because that would claim a
 * verification that never happened and is exactly the confusion these columns
 * exist to remove.
 */

import pg from 'pg';

const { Pool } = pg;

const SQL = `
ALTER TABLE employees ADD COLUMN IF NOT EXISTS upi_verified_at   TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS upi_verified_name TEXT;
`;

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(SQL);
        await client.query('COMMIT');

        const { rows: [summary] } = await client.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(upi_id)::int AS with_upi,
                    COUNT(upi_verified_at)::int AS verified
               FROM employees`);

        console.log('\n  UPI verification columns added.');
        console.log(`  ${summary.total} partner(s); ${summary.with_upi} have a UPI id; ${summary.verified} verified.`);
        console.log('  Existing ids stay unverified until the partner re-saves them — deliberately,');
        console.log('  since nobody has actually checked them.\n');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('UPI verification migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
