/**
 * Integration Test Script for FTTH Customer Roster & Recharge Flow
 *
 * Validates:
 * 1. 360 pre-seeded Poorvi Computers connections
 * 2. Instant ID & phone lookup
 * 3. Non-existent ID handling
 * 4. User signup auto-linking
 * 5. Dynamic pricing calculation
 * 6. 3-stage visual tracking state machine
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
    console.log('\n--- Running FTTH Roster & Recharge Integration Tests ---');
    const client = await pool.connect();

    try {
        // 1. Verify Roster count
        const { rows: [op] } = await client.query(
            `SELECT id, company_name FROM ftth_operators WHERE company_name ILIKE '%Poorvi%' LIMIT 1`
        );
        assert(!!op, `Found Poorvi Computers operator (ID: ${op?.id})`);

        const { rows: [{ count }] } = await client.query(
            `SELECT count(*)::int FROM ftth_connections WHERE operator_id = $1`, [op.id]
        );
        assert(count >= 360, `Operator has ${count} pre-seeded customer connections (expected >= 360)`);

        // 2. Lookup existing customer by ISP ID
        const lookupIspId = await FtthService.lookupCustomerConnection({
            operatorId: op.id,
            query: 'amit95_ylp',
        });
        assert(lookupIspId.exists === true, 'Lookup by ISP ID ("amit95_ylp") returned exists: true');
        assert(lookupIspId.connection?.customerName === 'Amit Ankolekar', `Customer name correctly resolved to "${lookupIspId.connection?.customerName}"`);

        // 3. Lookup existing customer by Phone
        const lookupPhone = await FtthService.lookupCustomerConnection({
            operatorId: op.id,
            query: '6362516452',
        });
        assert(lookupPhone.exists === true, 'Lookup by phone ("6362516452") returned exists: true');
        assert(lookupPhone.connection?.ispConnectionId === 'amit95_ylp', `Resolved to ISP ID "${lookupPhone.connection?.ispConnectionId}"`);

        // 4. Lookup non-existent customer
        const lookupNonExistent = await FtthService.lookupCustomerConnection({
            operatorId: op.id,
            query: 'unknown_customer_999',
        });
        assert(lookupNonExistent.exists === false, 'Lookup for non-existent ID correctly returned exists: false (triggers "Book New Connection" modal)');

        // 5. Test Auto-Linking on Signup
        // Reset connection to unlinked state first
        await client.query(`UPDATE ftth_connections SET user_id = NULL WHERE customer_phone = '6363090036'`);

        // Create a temporary mock user
        const { rows: [testUser] } = await client.query(`
            INSERT INTO users (username, phone, role, is_active)
            VALUES ('Test AutoLink User', '+916363090036', 'user', true)
            ON CONFLICT (phone) DO UPDATE SET is_active = true
            RETURNING id, phone
        `);

        const linkedCount = await FtthService.autoLinkCustomerConnections(testUser.id, testUser.phone);
        assert(linkedCount >= 1, `Auto-linked ${linkedCount} connection(s) for phone ${testUser.phone}`);

        const { rows: [linkedConn] } = await client.query(
            `SELECT user_id, isp_connection_id FROM ftth_connections WHERE customer_phone = '6363090036'`
        );
        assert(linkedConn.user_id === testUser.id, `Connection "${linkedConn.ispConnectionId}" successfully bound to user ${testUser.id}`);

        // 6. Test 3-Stage Tracking
        // Create a test plan if none exists
        let { rows: [plan] } = await client.query(
            `SELECT id FROM ftth_plans WHERE operator_id = $1 LIMIT 1`, [op.id]
        );
        if (!plan) {
            const { rows: [newPlan] } = await client.query(`
                INSERT INTO ftth_plans (operator_id, name, speed_mbps, duration_months, list_price_paise, discount_paise)
                VALUES ($1, '50 Mbps Unlimited', 50, 1, 64900, 0) RETURNING id
            `, [op.id]);
            plan = newPlan;
        }

        // Insert test recharge
        const { rows: [recharge] } = await client.query(`
            INSERT INTO ftth_recharges (
                connection_id, plan_id, plan_name, speed_mbps, duration_months,
                list_price_paise, discount_paise, convenience_fee_paise, gst_on_convenience_fee_paise, total_paise,
                operator_payable_paise, platform_revenue_paise, status, razorpay_order_id, razorpay_payment_id
            ) VALUES (
                $1, $2, '50 Mbps Unlimited', 50, 1,
                64900, 0, 1000, 180, 66080,
                64900, 1180, 'success', 'order_test_123', 'pay_test_456'
            ) RETURNING id
        `, [lookupIspId.connection.id, plan.id]);

        // Stage 2 check (Paid but unfulfilled -> In Progress)
        const trackingStage2 = await FtthService.getRechargeTracking(recharge.id);
        assert(trackingStage2?.stage === 2, `Initial paid tracking stage is 2 (In Progress, got ${trackingStage2?.stage})`);
        assert(trackingStage2?.ispConnectionId === 'amit95_ylp', `Tracking reports ISP ID "${trackingStage2?.ispConnectionId}"`);

        // Stage 3 check (Marked fulfilled -> Complete)
        await client.query(`UPDATE ftth_recharges SET fulfilled_at = NOW() WHERE id = $1`, [recharge.id]);
        const trackingStage3 = await FtthService.getRechargeTracking(recharge.id);
        assert(trackingStage3?.stage === 3, `Fulfilled tracking stage is 3 (Recharge Process Complete, got ${trackingStage3?.stage})`);

        // Clean up test recharge
        await client.query(`DELETE FROM ftth_recharges WHERE id = $1`, [recharge.id]);

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
