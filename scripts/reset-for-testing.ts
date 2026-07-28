/**
 * Reset for a clean test run.
 *
 * Hard-deletes all user and transactional data while preserving the Service
 * Catalog and the reference/config rows the app cannot start without.
 *
 * SAFETY
 *  - Dry run by default. Nothing is written without --confirm.
 *  - Prints the target host/database (credentials masked) so you can see which
 *    database you are about to wipe BEFORE it happens.
 *  - Never hardcodes a connection string; reads it from an env var you name.
 *
 * USAGE
 *   # 1. See what would happen (safe, read-only)
 *   npx tsx scripts/reset-for-testing.ts
 *
 *   # 2. Target a specific database by env var name (default: DATABASE_URL)
 *   npx tsx scripts/reset-for-testing.ts --url-env=RENDER_DATABASE_URL
 *
 *   # 3. Actually execute
 *   npx tsx scripts/reset-for-testing.ts --url-env=RENDER_DATABASE_URL --confirm
 *
 * OPTIONAL SCOPE FLAGS
 *   --include-product-catalog   also wipe products/brands/variants/images
 *   --include-inventory         also wipe inventory_items (platform stock)
 */

import 'dotenv/config';
import { Pool } from 'pg';

// ── Tables that survive ───────────────────────────────────────────────
// Service Catalog (explicitly requested to keep) plus the reference data the
// app needs in order to function at all after the wipe.
const PRESERVED = [
    'service_categories',      // Service Catalog
    'services',                // Service Catalog
    'admin_users',             // without this you cannot log into the admin dashboard
    'platform_config',         // booking fee, platform %, GST, timeouts
    'districts',               // serviceability lookup
    'serviceable_pincodes',    // isPincodeServiceable() returns false when empty,
    //                            which makes the app tell every user
    //                            "we do not service your area"
] as const;

// ── Tables that get wiped ─────────────────────────────────────────────
// All user identity + transactional history. Order does not matter because the
// statement uses CASCADE, but they are grouped for reviewability.
const WIPE_CORE = [
    // identity
    'users', 'customers', 'employees',
    'refresh_tokens', 'otp_verifications', 'social_auth_providers',
    // bookings
    'service_requests', 'service_charges', 'service_otps', 'ratings',
    // money
    'partner_wallets', 'wallet_transactions', 'wallet_transactions_v2',
    'withdrawal_requests', 'invoices', 'payment_transactions', 'refunds',
    // commerce
    'product_orders', 'cart_items', 'return_requests', 'shipments',
    // support + comms
    'support_tickets', 'ticket_messages', 'notifications', 'device_tokens',
    // audit + stock movements (the item definitions themselves are optional, below)
    'audit_logs', 'inventory_transactions',
];

const WIPE_PRODUCT_CATALOG = [
    'product_categories', 'product_brands', 'products',
    'product_variants', 'product_images',
];

const WIPE_INVENTORY = ['inventory_items'];

// ── Arg parsing ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const urlEnvArg = args.find((a) => a.startsWith('--url-env='));
const URL_ENV = urlEnvArg ? urlEnvArg.split('=')[1] : 'DATABASE_URL';

const confirm = has('--confirm');
const includeProducts = has('--include-product-catalog');
const includeInventory = has('--include-inventory');

const tables = [
    ...WIPE_CORE,
    ...(includeProducts ? WIPE_PRODUCT_CATALOG : []),
    ...(includeInventory ? WIPE_INVENTORY : []),
];

function describeTarget(url: string): string {
    try {
        const u = new URL(url);
        return `${u.hostname}${u.port ? ':' + u.port : ''}/${u.pathname.replace(/^\//, '')}`;
    } catch {
        return '<unparseable connection string>';
    }
}

async function main() {
    const connectionString = process.env[URL_ENV];
    if (!connectionString) {
        console.error(`✖ Env var ${URL_ENV} is not set. Nothing to connect to.`);
        process.exit(1);
    }

    const target = describeTarget(connectionString);
    const isRemote = /render\.com|amazonaws\.com|neon\.tech/.test(connectionString);

    console.log('─'.repeat(64));
    console.log(`TARGET      ${target}`);
    console.log(`SOURCE      ${URL_ENV}`);
    console.log(`KIND        ${isRemote ? '*** REMOTE / LIKELY PRODUCTION ***' : 'local'}`);
    console.log(`MODE        ${confirm ? 'EXECUTE (destructive)' : 'DRY RUN (no writes)'}`);
    console.log('─'.repeat(64));

    const pool = new Pool({
        connectionString,
        ssl: isRemote ? { rejectUnauthorized: false } : undefined,
    });

    try {
        // Report current row counts so you can confirm you are pointed at the
        // database you think you are before anything is destroyed.
        console.log('\nCurrent row counts:\n');

        const countOf = async (t: string): Promise<string> => {
            try {
                const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
                return String(rows[0].c);
            } catch {
                return 'missing';
            }
        };

        console.log('  WILL DELETE');
        for (const t of tables) {
            console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
        }

        console.log('\n  WILL PRESERVE');
        for (const t of PRESERVED) {
            console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
        }

        if (!includeProducts) {
            console.log('\n  WILL PRESERVE (product catalog — pass --include-product-catalog to wipe)');
            for (const t of WIPE_PRODUCT_CATALOG) {
                console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
            }
        }
        if (!includeInventory) {
            console.log('\n  WILL PRESERVE (pass --include-inventory to wipe)');
            for (const t of WIPE_INVENTORY) {
                console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
            }
        }

        if (!confirm) {
            console.log('\n' + '─'.repeat(64));
            console.log('DRY RUN — nothing was changed.');
            console.log('Re-run with --confirm to execute.');
            console.log('─'.repeat(64));
            return;
        }

        // RESTART IDENTITY resets serial PKs so the fresh test run starts at 1.
        // CASCADE covers any dependent table not listed explicitly.
        const list = tables.map((t) => `"${t}"`).join(', ');
        const stmt = `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`;

        console.log('\nExecuting:\n  ' + stmt + '\n');
        await pool.query(stmt);
        console.log('✔ Wipe complete.\n');

        console.log('Row counts after:\n');
        for (const t of tables) {
            console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
        }
        console.log('\n  Preserved:');
        for (const t of PRESERVED) {
            console.log(`    ${t.padEnd(26)} ${(await countOf(t)).padStart(8)}`);
        }

        console.log(
            '\nNOTE: if admin_users came back 0, recreate an admin before testing —\n' +
            'the dashboard has no other way in.',
        );
    } catch (err: any) {
        console.error('\n✖ Failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
