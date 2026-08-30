/**
 * Integration Test for Universal Dynamic Column Mapping Customer Importer
 *
 * Tests:
 * 1. Simulating an arbitrary Excel export with custom/foreign column names
 * 2. Mapping custom column headers to UniteFix target fields
 * 3. Batch upsert into ftth_connections
 * 4. Auto-linking to existing UniteFix users by phone number
 * 5. Verifying lookup works immediately for imported custom accounts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { FtthService } from '../server/services/ftth.service.js';
dotenv.config();

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

async function runTests() {
    console.log('\n--- Running Universal Column-Mapping Importer Tests ---');
    const client = await pool.connect();

    try {
        // 1. Get or create test operator
        const { rows: [operator] } = await client.query(
            `SELECT id, company_name FROM ftth_operators WHERE status = 'active' LIMIT 1`
        );
        assert(!!operator, `Using Operator "${operator.companyName}" (ID: ${operator.id})`);

        // 2. Prepare mock dataset with completely custom/arbitrary column headers
        // (as exported by an arbitrary third-party ISP billing software)
        const customSpreadsheetRows = [
            {
                "Client_Login_ID": "custom_broadband_001",
                "Subscriber_Full_Name": "Ramesh Kulkarni",
                "Phone_Number": "+91 98450 11223",
                "User_Mail": "ramesh.k@example.com",
                "Premises_Address": "Main Road, Near Temple, Yellapur",
                "Due_Date": "2026-12-31T00:00:00.000Z",
            },
            {
                "Client_Login_ID": "custom_broadband_002",
                "Subscriber_Full_Name": "Sangeeta Patil",
                "Phone_Number": "98450 99887",
                "User_Mail": "sangeeta.p@example.com",
                "Premises_Address": "Bazar Street, Yellapur",
                "Due_Date": "2026-11-15T00:00:00.000Z",
            },
            {
                "Client_Login_ID": "custom_broadband_003",
                "Subscriber_Full_Name": "Vinay Hegde",
                "Phone_Number": "98450 55443",
                "User_Mail": "vinay.h@example.com",
                "Premises_Address": "Bus Stand Cross, Yellapur",
                "Due_Date": "2026-10-30T00:00:00.000Z",
            },
        ];

        // 3. Define the dynamic column mappings configured by the user in the UI
        const userConfiguredMappings = {
            ispConnectionId: "Client_Login_ID",
            customerName: "Subscriber_Full_Name",
            customerPhone: "Phone_Number",
            customerEmail: "User_Mail",
            installationAddress: "Premises_Address",
            validTill: "Due_Date",
        };

        // 4. Pre-create a registered UniteFix user with Ramesh's phone to test auto-linking
        await client.query(`
            INSERT INTO users (username, phone, role, is_active)
            VALUES ('Ramesh Kulkarni', '+919845011223', 'user', true)
            ON CONFLICT (phone) DO NOTHING
        `);

        // 5. Execute Universal Importer
        const importResult = await FtthService.bulkImportCustomers({
            operatorId: operator.id,
            mappings: userConfiguredMappings,
            rows: customSpreadsheetRows,
        });

        assert(importResult.success === true, 'Bulk import executed successfully');
        assert(importResult.totalRows === 3, 'Processed 3 spreadsheet rows');
        assert(importResult.inserted >= 1 || importResult.updated >= 1, `Inserted/Updated ${importResult.inserted} new and ${importResult.updated} existing rows`);
        assert(importResult.autoLinkedUsers >= 1, `Auto-linked ${importResult.autoLinkedUsers} registered UniteFix account(s)`);

        // 6. Verify Customer Lookup immediately finds newly imported custom accounts
        const lookup = await FtthService.lookupCustomerConnection({
            operatorId: operator.id,
            query: "custom_broadband_001",
        });

        assert(lookup.exists === true, 'Lookup by custom ISP ID ("custom_broadband_001") returned exists: true');
        assert(lookup.connection?.customerName === 'Ramesh Kulkarni', `Customer name resolved to "${lookup.connection?.customerName}"`);
        assert(lookup.connection?.customerPhone === '9845011223', `Phone sanitized to "${lookup.connection?.customerPhone}"`);
        assert(!!lookup.connection?.userId, `Connection automatically claimed with userId ${lookup.connection?.userId}`);

        // Clean up test records
        await client.query(`
            DELETE FROM ftth_connections
            WHERE operator_id = $1 AND isp_connection_id IN ('custom_broadband_001', 'custom_broadband_002', 'custom_broadband_003')
        `, [operator.id]);

        console.log(`\n========================================`);
        console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
        console.log(`========================================\n`);

        if (failed > 0) process.exit(1);
    } catch (err) {
        console.error('Test execution error:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runTests();
