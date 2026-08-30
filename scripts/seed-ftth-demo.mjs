/**
 * Seed a working FTTH operator so the portal has something to show.
 *
 *   node -r dotenv/config scripts/seed-ftth-demo.mjs
 *   node -r dotenv/config scripts/seed-ftth-demo.mjs --clean    # remove it again
 *
 * Creates a serviceable pincode, an approved operator with a known password, a
 * deliberately SPARSE price grid, and coverage. Local development only — the
 * password is printed to the console on purpose.
 *
 * Idempotent: re-running updates rather than duplicating.
 */

import pg from 'pg';
import bcrypt from 'bcrypt';

const { Client } = pg;

const PIN = '581359';
const AREA = 'Yellapur';
const COMPANY = 'Poorvi Computers';
const USERNAME = 'poorvi';
const PASSWORD = 'poorvi@123';
const EMAIL = 'poorvi@demo.local';
const PHONE = '9876500011';

// A sparse matrix on purpose: 30 Mbps is sold at 1 and 6 months but NOT 3, and
// 100 Mbps has its own durations. This is what the app has to render correctly.
const PLANS = [
    { name: '30 Mbps Unlimited', speed: 30, months: 1, price: 47100, discount: 0, limit: null, benefits: null },
    { name: '30 Mbps Unlimited', speed: 30, months: 6, price: 265000, discount: 15000, limit: null, benefits: null },
    { name: '50 Mbps Unlimited', speed: 50, months: 1, price: 64900, discount: 0, limit: null, benefits: null },
    { name: '50 Mbps Unlimited', speed: 50, months: 3, price: 185000, discount: 5000, limit: null, benefits: null },
    { name: '50 Mbps Unlimited', speed: 50, months: 6, price: 355000, discount: 20000, limit: null, benefits: null },
    { name: '100 Mbps + OTT', speed: 100, months: 3, price: 250000, discount: 0, limit: 3300, benefits: ['OTT pack', 'Free installation'] },
    { name: '100 Mbps + OTT', speed: 100, months: 12, price: 890000, discount: 50000, limit: 3300, benefits: ['OTT pack', 'Free installation', 'Static IP'] },
];

const clean = process.argv.includes('--clean');

/**
 * LOCAL ONLY.
 *
 * This creates a working login whose password is written in plain sight a few
 * lines above, in a file that lives in the repository. Run against a real
 * database that is a live account with a published password, so refuse anywhere
 * that is not obviously a developer machine.
 */
const url = process.env.DATABASE_URL ?? '';
const isLocalDatabase = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
if (process.env.NODE_ENV === 'production' || !isLocalDatabase) {
    console.error(
        '\n  Refusing to run.\n' +
        '  This seed creates an account with a password committed to the repo,\n' +
        '  so it only runs against a database on localhost.\n' +
        `  DATABASE_URL host is not local${process.env.NODE_ENV === 'production' ? ' and NODE_ENV=production' : ''}.\n`,
    );
    process.exit(1);
}

const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
await c.connect();

try {
    if (clean) {
        const { rows } = await c.query('SELECT id, admin_user_id FROM ftth_operators WHERE contact_email = $1', [EMAIL]);
        for (const op of rows) {
            await c.query(`DELETE FROM payment_transactions WHERE ftth_recharge_id IN (
                SELECT r.id FROM ftth_recharges r JOIN ftth_connections cn ON cn.id = r.connection_id
                WHERE cn.operator_id = $1)`, [op.id]);
            await c.query('DELETE FROM ftth_operator_ledger WHERE operator_id = $1', [op.id]);
            await c.query(`DELETE FROM ftth_recharges WHERE connection_id IN
                (SELECT id FROM ftth_connections WHERE operator_id = $1)`, [op.id]);
            await c.query('DELETE FROM ftth_leads WHERE operator_id = $1', [op.id]);
            await c.query('DELETE FROM ftth_id_requests WHERE operator_id = $1', [op.id]);
            await c.query('DELETE FROM ftth_connections WHERE operator_id = $1', [op.id]);
            await c.query('DELETE FROM ftth_plans WHERE operator_id = $1', [op.id]);
            await c.query('DELETE FROM ftth_operator_pincodes WHERE operator_id = $1', [op.id]);
            await c.query(`DELETE FROM audit_logs WHERE entity_type = 'ftth_operator' AND entity_id = $1`, [op.id]);
            await c.query('DELETE FROM ftth_operators WHERE id = $1', [op.id]);
            if (op.admin_user_id) await c.query('DELETE FROM admin_users WHERE id = $1', [op.admin_user_id]);
        }
        console.log(`Removed the demo operator${rows.length ? '' : ' (nothing to remove)'}.`);
        console.log(`Left ${PIN} in serviceable_pincodes — delete it yourself if you don't want it.`);
        process.exit(0);
    }

    await c.query('BEGIN');

    // 1. A serviceable pincode. Operators can only claim areas UniteFix serves,
    //    so with an empty table every application and coverage save is refused.
    await c.query(
        `INSERT INTO serviceable_pincodes (pincode, area, district, state, is_active)
         VALUES ($1, $2, 'Uttara Kannada', 'Karnataka', true)
         ON CONFLICT (pincode) DO UPDATE SET is_active = true`,
        [PIN, AREA],
    );

    // 2. The login. Role 'operator' means authenticateAdmin rejects it on every
    //    staff route, and only /api/ftth/admin/* answers it.
    const hashed = await bcrypt.hash(PASSWORD, 10);
    let { rows: [admin] } = await c.query('SELECT id FROM admin_users WHERE username = $1', [USERNAME]);
    if (admin) {
        await c.query(
            `UPDATE admin_users SET password = $1, role = 'operator', is_active = true, email = $2 WHERE id = $3`,
            [hashed, EMAIL, admin.id],
        );
    } else {
        ({ rows: [admin] } = await c.query(
            `INSERT INTO admin_users (username, email, password, role, is_active)
             VALUES ($1, $2, $3, 'operator', true) RETURNING id`,
            [USERNAME, EMAIL, hashed],
        ));
    }

    // 3. The operator profile, already approved.
    let { rows: [operator] } = await c.query('SELECT id FROM ftth_operators WHERE contact_email = $1', [EMAIL]);
    if (operator) {
        await c.query(
            `UPDATE ftth_operators
             SET admin_user_id = $1, status = 'active', company_name = $2,
                 convenience_fee_paise = 1000, lead_fee_paise = 40000, updated_at = NOW()
             WHERE id = $3`,
            [admin.id, COMPANY, operator.id],
        );
    } else {
        ({ rows: [operator] } = await c.query(
            `INSERT INTO ftth_operators
                (admin_user_id, company_name, legal_name, gstin, contact_name, contact_email, contact_phone,
                 status, convenience_fee_paise, lead_fee_paise, approved_at, brand_color)
             VALUES ($1, $2, 'Poorvi Computers Pvt Ltd', '29ABCDE1234F1Z5', 'Poorvi Desk',
                     $3, $4, 'active', 1000, 40000, NOW(), '#0EA5E9')
             RETURNING id`,
            [admin.id, COMPANY, EMAIL, PHONE],
        ));
    }

    // 4. Coverage.
    await c.query(
        `INSERT INTO ftth_operator_pincodes (operator_id, pincode) VALUES ($1, $2)
         ON CONFLICT (operator_id, pincode) DO NOTHING`,
        [operator.id, PIN],
    );

    // 5. The catalogue.
    for (const p of PLANS) {
        const { rows: [existing] } = await c.query(
            `SELECT id FROM ftth_plans WHERE operator_id = $1 AND speed_mbps = $2 AND duration_months = $3`,
            [operator.id, p.speed, p.months],
        );
        if (existing) {
            await c.query(
                `UPDATE ftth_plans SET name = $1, list_price_paise = $2, discount_paise = $3,
                        data_limit_gb = $4, benefits = $5, is_active = true, updated_at = NOW()
                 WHERE id = $6`,
                [p.name, p.price, p.discount, p.limit, p.benefits ? JSON.stringify(p.benefits) : null, existing.id],
            );
        } else {
            await c.query(
                `INSERT INTO ftth_plans
                    (operator_id, name, speed_mbps, duration_months, list_price_paise, discount_paise,
                     data_limit_gb, benefits, is_active)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
                [operator.id, p.name, p.speed, p.months, p.price, p.discount, p.limit,
                 p.benefits ? JSON.stringify(p.benefits) : null],
            );
        }
    }

    await c.query('COMMIT');

    console.log('');
    console.log('  FTTH demo ready');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  Operator portal   http://localhost:3000`);
    console.log(`  Username          ${USERNAME}`);
    console.log(`  Password          ${PASSWORD}`);
    console.log('');
    console.log(`  Company           ${COMPANY} (operator id ${operator.id})`);
    console.log(`  Coverage          ${PIN} (${AREA})`);
    console.log(`  Plans             30 / 50 / 100 Mbps — deliberately sparse`);
    console.log('');
    console.log('  For the mobile app: set the customer\'s pincode to ' + PIN + ',');
    console.log('  or the operator will not appear in their list.');
    console.log('');
} catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
} finally {
    await c.end();
}
