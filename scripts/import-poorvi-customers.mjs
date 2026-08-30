/**
 * Bulk Import Script for Poorvi Computers Customer Roster
 *
 * Reads: `Kumar Hegde User List.xlsx`
 * Targets: `ftth_connections`
 *
 * Maps:
 * - Username   -> isp_connection_id (e.g. 'amit95_ylp')
 * - Full Name  -> customer_name (e.g. 'Amit Ankolekar')
 * - MOBILE     -> customer_phone (clean 10-digit, e.g. '6362516452')
 * - EMAIL_ID   -> customer_email (e.g. 'amitankolekar96@gmail.com')
 * - user_id    -> matched with `users.id` if a user already exists with that phone number
 */

import pg from 'pg';
import XLSX from 'xlsx';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

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
    const filePath = path.resolve('Kumar Hegde User List.xlsx');
    console.log(`[IMPORT] Reading excel file: ${filePath}`);
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    console.log(`[IMPORT] Found ${rawRows.length} rows in sheet "${sheetName}".`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Find or verify Poorvi Computers operator
        let { rows: [operator] } = await client.query(
            `SELECT id, company_name FROM ftth_operators WHERE company_name ILIKE '%Poorvi%' OR contact_email = 'poorvi@demo.local' LIMIT 1`
        );

        if (!operator) {
            console.log('[IMPORT] Poorvi Computers operator not found. Creating active operator row...');
            const { rows: [newOp] } = await client.query(`
                INSERT INTO ftth_operators (
                    company_name, legal_name, contact_name, contact_email, contact_phone,
                    status, convenience_fee_paise, lead_fee_paise, approved_at, brand_color
                ) VALUES (
                    'Poorvi Computers', 'Poorvi Computers Pvt Ltd', 'Kumar Hegde', 'poorvi@unitefix.com', '9876500011',
                    'active', 1000, 40000, NOW(), '#0EA5E9'
                ) RETURNING id, company_name
            `);
            operator = newOp;

            // Ensure Yellapur pincode 581359 is attached
            await client.query(`
                INSERT INTO serviceable_pincodes (pincode, area, district, state, is_active)
                VALUES ('581359', 'Yellapur', 'Uttara Kannada', 'Karnataka', true)
                ON CONFLICT (pincode) DO UPDATE SET is_active = true
            `);
            await client.query(`
                INSERT INTO ftth_operator_pincodes (operator_id, pincode)
                VALUES ($1, '581359')
                ON CONFLICT (operator_id, pincode) DO NOTHING
            `, [operator.id]);
        }

        console.log(`[IMPORT] Using Operator: "${operator.company_name}" (ID: ${operator.id})`);

        // 2. Fetch all existing registered users for phone matching
        const { rows: registeredUsers } = await client.query(`SELECT id, phone FROM users WHERE phone IS NOT NULL`);
        const phoneToUserId = new Map();
        for (const u of registeredUsers) {
            const clean = u.phone.replace(/\D/g, '').slice(-10);
            if (clean.length === 10) phoneToUserId.set(clean, u.id);
        }

        console.log(`[IMPORT] Loaded ${phoneToUserId.size} registered users for auto-linking.`);

        let insertedCount = 0;
        let updatedCount = 0;

        for (const r of rawRows) {
            const username = String(r.Username || '').trim();
            const fullName = String(r['Full Name'] || '').trim();
            const rawPhone = String(r.MOBILE || '').trim();
            const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
            const email = String(r.EMAIL_ID || '').trim().toLowerCase();

            if (!username) continue;

            const matchedUserId = cleanPhone ? phoneToUserId.get(cleanPhone) ?? null : null;

            // Upsert into ftth_connections by (operator_id, isp_connection_id)
            const res = await client.query(`
                INSERT INTO ftth_connections (
                    operator_id, isp_connection_id, customer_name, customer_phone, customer_email,
                    user_id, status, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
                ON CONFLICT (operator_id, isp_connection_id) DO UPDATE SET
                    customer_name = EXCLUDED.customer_name,
                    customer_phone = EXCLUDED.customer_phone,
                    customer_email = EXCLUDED.customer_email,
                    user_id = COALESCE(ftth_connections.user_id, EXCLUDED.user_id),
                    status = 'active',
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_insert
            `, [operator.id, username, fullName || username, cleanPhone || null, email || null, matchedUserId]);

            if (res.rows[0]?.is_insert) {
                insertedCount++;
            } else {
                updatedCount++;
            }
        }

        await client.query('COMMIT');
        console.log(`[IMPORT] Completed successfully! Inserted: ${insertedCount}, Updated: ${updatedCount} connections.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[IMPORT] Error importing roster:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
