/**
 * Maps service categories to the trades that can work them, so admin assignment
 * can tell who is actually suitable for a booking.
 *
 * Shipped as a script rather than a .sql file because `migrations/` is
 * gitignored and never reaches the deployed container. Run from the Render
 * shell after a deploy:
 *
 *   npm run migrate:expertise
 *
 * Safe to run repeatedly. Every statement is IF NOT EXISTS / ON CONFLICT DO
 * NOTHING; it only ever adds rows and never drops, alters or deletes. Re-running
 * will NOT undo edits made in the admin UI - the seed only fills categories that
 * have no mapping at all.
 */

// Loads .env when running locally; a no-op on Render, where the environment is
// already populated and no .env file exists.
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS service_category_technician_types (
    category_id        INTEGER NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    technician_type_id INTEGER NOT NULL REFERENCES technician_types(id)   ON DELETE CASCADE,
    created_at         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (category_id, technician_type_id)
);

CREATE INDEX IF NOT EXISTS sctt_technician_type_idx
    ON service_category_technician_types (technician_type_id);

CREATE TABLE IF NOT EXISTS employee_technician_types (
    employee_id        INTEGER NOT NULL REFERENCES employees(id)        ON DELETE CASCADE,
    technician_type_id INTEGER NOT NULL REFERENCES technician_types(id) ON DELETE CASCADE,
    created_at         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (employee_id, technician_type_id)
);

CREATE INDEX IF NOT EXISTS ett_technician_type_idx
    ON employee_technician_types (technician_type_id);
`;

/**
 * First-pass mapping, by NAME on both sides - ids differ between local and
 * production, so nothing here may hardcode one.
 *
 * Professional & Property, Transport & Logistics, Events and Specialized are
 * deliberately absent: lawyers, caterers and driving schools have no technician
 * type, and inventing one would be worse than leaving the category unrestricted.
 * An unmapped category keeps every expert eligible.
 */
const SEED = {
    'Technology Services': [
        'Computer Technician', 'Printer Technician', 'CCTV Technician',
        'Biometric Device Technician', 'Networking & Internet Technician',
    ],
    'IT & Security': [
        'Computer Technician', 'Printer Technician', 'CCTV Technician',
        'Biometric Device Technician', 'Networking & Internet Technician',
    ],
    'Home Services': [
        'AC Technician', 'Solar Technician', 'Water Purifier Technician',
    ],
    'Repair Services': [
        'Electrician', 'Plumber', 'Appliance Repair Technician',
        'UPS & Battery Technician',
    ],
    'Appliances & Utilities': [
        'Appliance Repair Technician', 'UPS & Battery Technician',
        'Solar Technician', 'Water Purifier Technician', 'Electrician', 'Plumber',
    ],
    'Repairs & Maintenance': [
        'Electrician', 'Plumber', 'Carpenter', 'Painter',
        'Appliance Repair Technician', 'Computer Technician',
    ],
};

const url = process.env.RENDER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
    console.error('FAILED: set DATABASE_URL (or RENDER_DATABASE_URL) first.');
    process.exit(1);
}
const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);

const pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
});

try {
    const host = url.replace(/:[^:@]*@/, ':***@').split('@')[1] ?? '(unknown host)';
    console.log(`Applying expertise-mapping migration to ${host}`);

    await pool.query(SCHEMA);
    console.log('OK - tables and indexes present');

    let linked = 0;
    let skippedExisting = 0;
    const unknownCategories = [];
    const unknownTrades = new Set();

    for (const [categoryName, tradeNames] of Object.entries(SEED)) {
        const { rows: cat } = await pool.query(
            'SELECT id FROM service_categories WHERE lower(name) = lower($1) LIMIT 1',
            [categoryName],
        );
        if (!cat.length) { unknownCategories.push(categoryName); continue; }
        const categoryId = cat[0].id;

        // Only seed categories with NO mapping, so re-running never resurrects a
        // pairing that was deliberately removed in the admin UI.
        const { rows: existing } = await pool.query(
            'SELECT COUNT(*)::int AS c FROM service_category_technician_types WHERE category_id = $1',
            [categoryId],
        );
        if (existing[0].c > 0) { skippedExisting++; continue; }

        for (const tradeName of tradeNames) {
            const { rows: t } = await pool.query(
                'SELECT id FROM technician_types WHERE lower(name) = lower($1) LIMIT 1',
                [tradeName],
            );
            if (!t.length) { unknownTrades.add(tradeName); continue; }

            const res = await pool.query(
                `INSERT INTO service_category_technician_types (category_id, technician_type_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [categoryId, t[0].id],
            );
            linked += res.rowCount;
        }
    }

    console.log(`OK - seeded ${linked} category/trade link(s); ${skippedExisting} category(ies) already mapped, left untouched`);
    if (unknownCategories.length) console.log(`   note: category not found, skipped: ${unknownCategories.join(', ')}`);
    if (unknownTrades.size) console.log(`   note: trade not found, skipped: ${[...unknownTrades].join(', ')}`);

    // Backfill expert trades from the existing name array, so a later rename
    // cannot detach the expert from the trade.
    const backfill = await pool.query(`
        INSERT INTO employee_technician_types (employee_id, technician_type_id)
        SELECT e.id, t.id
        FROM employees e
        CROSS JOIN LATERAL unnest(COALESCE(e.services, ARRAY[]::text[])) AS s(name)
        JOIN technician_types t
          ON lower(t.name) = lower(btrim(s.name))
        ON CONFLICT DO NOTHING
    `);
    console.log(`OK - backfilled ${backfill.rowCount} expert/trade link(s) from employees.services`);

    const summary = await pool.query(`
        SELECT c.name AS category,
               COALESCE(string_agg(t.name, ', ' ORDER BY t.name), '(unrestricted)') AS trades
        FROM service_categories c
        LEFT JOIN service_category_technician_types m ON m.category_id = c.id
        LEFT JOIN technician_types t ON t.id = m.technician_type_id
        GROUP BY c.id, c.name
        ORDER BY c.id
    `);
    console.log('\nCategory -> trades');
    for (const r of summary.rows) console.log(`   ${r.category}: ${r.trades}`);

    const orphan = await pool.query(`
        SELECT COUNT(*)::int AS c FROM employees e
        WHERE COALESCE(array_length(e.services, 1), 0) > 0
          AND NOT EXISTS (SELECT 1 FROM employee_technician_types x WHERE x.employee_id = e.id)
    `);
    if (orphan.rows[0].c > 0) {
        console.log(`\n   warning: ${orphan.rows[0].c} expert(s) have services matching no technician_types row.`);
        console.log('   They stay assignable, but will not be flagged as recommended until the trade exists.');
    }
} catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
