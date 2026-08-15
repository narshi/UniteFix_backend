/**
 * Database Cleanup — clear test data while PRESERVING named real members.
 *
 * DEFAULT IS A DRY RUN. Nothing is committed unless you pass --confirm.
 *
 *   npx tsx server/scripts/cleanup-test-data.ts                     # preview only
 *   npx tsx server/scripts/cleanup-test-data.ts --confirm           # actually delete
 *   npx tsx server/scripts/cleanup-test-data.ts --confirm --firebase # + wipe Firebase Auth
 *   npx tsx server/scripts/cleanup-test-data.ts --keep "A,B,C"      # override the names
 *
 * ⚠ --firebase is separate on purpose: Firebase credentials are global, so that
 *   step deletes from the LIVE auth project even if you pointed this script at a
 *   local database.
 *
 * KEEPS (untouched): service_categories, services, inventory_items, platform_config,
 *   admin_users, product_categories, product_brands, products, product_variants,
 *   product_images
 *
 * KEEPS (selectively): the members named in KEEP_NAMES, everything that belongs to
 *   them, and — because service_requests.user_id / provider_id are NOT NULL foreign
 *   keys — the counterparty on each of their jobs. You cannot keep a job without
 *   keeping both people on it.
 *
 * DELETES: every other user, employee, booking, order, wallet and ledger row.
 *
 * ── The keep set is ONE HOP, not a transitive closure ─────────────────────────
 *   seed        : users.username / employees.full_name matching KEEP_NAMES
 *   → jobs      : every service_request a SEED member is personally on
 *   → people    : the other party on exactly those jobs — and stop
 *   → money     : invoices, payments, wallets, ledger rows hanging off the above
 *
 *   It deliberately does NOT follow a kept counterparty's other bookings. Doing
 *   so is transitive and keeps the whole database — real users sit two or three
 *   hops apart, so the wipe silently becomes a no-op. A kept customer's unrelated
 *   jobs are somebody else's service data and are deleted.
 *
 * ⚠ UNCHANGED BEHAVIOUR WORTH REVIEWING: this script still wipes `districts` and
 *   `serviceable_pincodes`. Those are operational config, not test data — after a
 *   run, no pincode is serviceable until you re-add them. Set WIPE_LOCATIONS=false
 *   below if you would rather keep them.
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

import { admin } from '../lib/firebase';

/** Members to preserve. Override with --keep "Name One,Name Two". */
const DEFAULT_KEEP_NAMES = [
  'Raghavendra Patil',
  'Mahabaleshwar Bhat',
  'Krishnamurti Hegde',
];

/** See the warning in the header. */
const WIPE_LOCATIONS = true;

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
/**
 * Firebase Auth deletion is opt-in. Its credentials are global, so it hits the
 * live project even when this script targets a local database.
 */
const FIREBASE_CLEANUP = argv.includes('--firebase');
const keepArgIndex = argv.findIndex((a) => a === '--keep');
const KEEP_NAMES =
  keepArgIndex >= 0 && argv[keepArgIndex + 1]
    ? argv[keepArgIndex + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_KEEP_NAMES;

const DATABASE_URL = process.env.RENDER_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL found');
  process.exit(1);
}

if (KEEP_NAMES.length === 0) {
  console.error('❌ --keep was given but resolved to no names. Refusing to run.');
  process.exit(1);
}

/**
 * Delete predicates, in FK-safe order (children before parents).
 *
 * Each entry deletes every row that is NOT positively linked to the keep set.
 * NOT EXISTS is used rather than NOT IN so that a NULL foreign key counts as
 * "unlinked" and is deleted — with NOT IN, `NULL NOT IN (...)` is NULL and the
 * orphan row would silently survive.
 */
const DELETE_STEPS: Array<{ table: string; sql: string }> = [
  {
    table: 'refunds',
    sql: `DELETE FROM refunds r
          WHERE NOT EXISTS (SELECT 1 FROM keep_payment_txns k WHERE k.id = r.payment_transaction_id)
            AND NOT EXISTS (SELECT 1 FROM keep_return_requests k WHERE k.id = r.return_request_id)`,
  },
  {
    table: 'return_requests',
    sql: `DELETE FROM return_requests t
          WHERE NOT EXISTS (SELECT 1 FROM keep_return_requests k WHERE k.id = t.id)`,
  },
  {
    table: 'payment_transactions',
    sql: `DELETE FROM payment_transactions t
          WHERE NOT EXISTS (SELECT 1 FROM keep_payment_txns k WHERE k.id = t.id)`,
  },
  {
    table: 'notifications',
    sql: `DELETE FROM notifications t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    table: 'device_tokens',
    sql: `DELETE FROM device_tokens t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    table: 'social_auth_providers',
    sql: `DELETE FROM social_auth_providers t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    // Ratings hang off a job, the rater, or the rated expert — any one is enough.
    table: 'ratings',
    sql: `DELETE FROM ratings t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)
            AND NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.from_user_id)
            AND NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.to_provider_id)`,
  },
  {
    table: 'service_otps',
    sql: `DELETE FROM service_otps t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)`,
  },
  {
    table: 'shipments',
    sql: `DELETE FROM shipments t
          WHERE NOT EXISTS (SELECT 1 FROM keep_orders k WHERE k.order_id = t.order_id)`,
  },
  {
    table: 'service_charges',
    sql: `DELETE FROM service_charges t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)`,
  },
  {
    table: 'ticket_messages',
    sql: `DELETE FROM ticket_messages t
          WHERE NOT EXISTS (SELECT 1 FROM keep_tickets k WHERE k.id = t.ticket_id)`,
  },
  {
    table: 'support_tickets',
    sql: `DELETE FROM support_tickets t
          WHERE NOT EXISTS (SELECT 1 FROM keep_tickets k WHERE k.id = t.id)`,
  },
  {
    table: 'inventory_transactions',
    sql: `DELETE FROM inventory_transactions t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)`,
  },
  {
    table: 'withdrawal_requests',
    sql: `DELETE FROM withdrawal_requests t
          WHERE NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.partner_id)`,
  },
  {
    table: 'wallet_transactions_v2',
    sql: `DELETE FROM wallet_transactions_v2 t
          WHERE NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.partner_id)
            AND NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)`,
  },
  {
    table: 'partner_wallets',
    sql: `DELETE FROM partner_wallets t
          WHERE NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.partner_id)`,
  },
  {
    // audit_logs has no foreign keys — entity_type/entity_id is a loose reference.
    // Keep the trail for anything we are keeping, drop the rest.
    table: 'audit_logs',
    sql: `DELETE FROM audit_logs t
          WHERE NOT (
            (t.entity_type = 'service_request' AND EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.entity_id))
         OR (t.entity_type = 'employee'        AND EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.entity_id))
         OR (t.entity_type = 'user'            AND EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.entity_id))
          )`,
  },
  {
    // Matched on phone/email rather than a key — these rows predate the user row.
    table: 'otp_verifications',
    sql: `DELETE FROM otp_verifications t
          WHERE NOT EXISTS (SELECT 1 FROM keep_contacts k WHERE k.phone IS NOT NULL AND k.phone = t.phone)
            AND NOT EXISTS (SELECT 1 FROM keep_contacts k WHERE k.email IS NOT NULL AND k.email = t.email)`,
  },
  {
    table: 'invoices',
    sql: `DELETE FROM invoices t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)
            AND NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)
            AND NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.provider_id)
            AND NOT EXISTS (SELECT 1 FROM keep_orders k WHERE k.id = t.product_order_id)`,
  },
  {
    table: 'cart_items',
    sql: `DELETE FROM cart_items t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    table: 'product_orders',
    sql: `DELETE FROM product_orders t
          WHERE NOT EXISTS (SELECT 1 FROM keep_orders k WHERE k.id = t.id)`,
  },
  {
    table: 'wallet_transactions',
    sql: `DELETE FROM wallet_transactions t
          WHERE NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.provider_id)
            AND NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)`,
  },
  {
    table: 'service_requests',
    sql: `DELETE FROM service_requests t
          WHERE NOT EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.id)`,
  },
  {
    table: 'refresh_tokens',
    sql: `DELETE FROM refresh_tokens t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    table: 'employees',
    sql: `DELETE FROM employees t
          WHERE NOT EXISTS (SELECT 1 FROM keep_employees k WHERE k.id = t.id)`,
  },
  {
    table: 'customers',
    sql: `DELETE FROM customers t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)`,
  },
  {
    table: 'users',
    sql: `DELETE FROM users t
          WHERE NOT EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.id)`,
  },
];

const LOCATION_STEPS: Array<{ table: string; sql: string }> = [
  { table: 'serviceable_pincodes', sql: 'DELETE FROM serviceable_pincodes' },
  { table: 'districts', sql: 'DELETE FROM districts' },
];

async function cleanupTestData() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL!.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  const host = DATABASE_URL!.replace(/:[^:@]*@/, ':***@').split('@')[1] ?? '(unknown)';

  try {
    await client.connect();
    console.log(`✅ Connected to ${host}`);
    console.log(`   Mode: ${CONFIRM ? '🔴 LIVE — CHANGES WILL BE COMMITTED' : '🟢 DRY RUN — will roll back'}`);
    console.log(`   Preserving: ${KEEP_NAMES.join(', ')}\n`);

    await client.query('BEGIN');

    // ── Build the keep set ────────────────────────────────────────────────
    // Temp tables, so every DELETE below can reference them cheaply and they
    // vanish with the transaction.
    await client.query(`
      CREATE TEMP TABLE keep_users            (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_employees        (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_requests         (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_orders           (id INT PRIMARY KEY, order_id TEXT) ON COMMIT DROP;
      CREATE TEMP TABLE keep_tickets          (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_payment_txns     (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_return_requests  (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE keep_contacts         (phone TEXT, email TEXT) ON COMMIT DROP;
    `);

    // Names are compared case-insensitively with runs of whitespace collapsed,
    // so "krishnamurti  hegde" matches "Krishnamurti Hegde".
    const norm = `lower(regexp_replace(trim(coalesce($COL$, '')), '\\s+', ' ', 'g'))`;
    const normalizedNames = KEEP_NAMES.map((n) => n.toLowerCase().replace(/\s+/g, ' ').trim());

    await client.query(
      `INSERT INTO keep_users (id)
       SELECT id FROM users WHERE ${norm.replace('$COL$', 'username')} = ANY($1::text[])
       ON CONFLICT DO NOTHING`,
      [normalizedNames],
    );
    await client.query(
      `INSERT INTO keep_users (id)
       SELECT user_id FROM employees WHERE ${norm.replace('$COL$', 'full_name')} = ANY($1::text[])
       ON CONFLICT DO NOTHING`,
      [normalizedNames],
    );

    const seedUsers = await client.query('SELECT COUNT(*)::int c FROM keep_users');
    if (seedUsers.rows[0].c === 0) {
      console.error('❌ None of the given names matched any user or employee.');
      console.error('   Refusing to run — this would have deleted everything.\n');
      await client.query('ROLLBACK');
      await showNameCandidates(client);
      return;
    }

    // ── The cascade is ONE HOP, deliberately not transitive ────────────────
    //
    // A full closure (follow the counterparty's other jobs, then THEIR
    // counterparties, and so on) keeps the entire database: in real data almost
    // everyone is two or three hops from everyone else, so the wipe becomes a
    // no-op. Verified against a fixture — a seed expert reached an unrelated
    // customer through one intermediate account in three steps.
    //
    // So: keep the named members, the jobs THEY are on, and only the person on
    // the other side of those jobs. A kept counterparty's unrelated bookings are
    // NOT preserved — those are somebody else's service data.

    // The named members are the only seeds. Snapshot them before the cascade
    // widens keep_users, so "jobs belonging to a seed" stays precise.
    await client.query(`
      CREATE TEMP TABLE seed_users     (id INT PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE seed_employees (id INT PRIMARY KEY) ON COMMIT DROP;
    `);
    await client.query('INSERT INTO seed_users (id) SELECT id FROM keep_users');
    await client.query(`
      INSERT INTO seed_employees (id)
      SELECT e.id FROM employees e
      WHERE EXISTS (SELECT 1 FROM seed_users k WHERE k.id = e.user_id)
      ON CONFLICT DO NOTHING`);
    await client.query(`
      INSERT INTO keep_employees (id) SELECT id FROM seed_employees
      ON CONFLICT DO NOTHING`);

    // Step 1 — jobs a seed member is personally on.
    await client.query(`
      INSERT INTO keep_requests (id)
      SELECT sr.id FROM service_requests sr
      WHERE EXISTS (SELECT 1 FROM seed_users k WHERE k.id = sr.user_id)
         OR EXISTS (SELECT 1 FROM seed_employees k WHERE k.id = sr.provider_id)
         OR EXISTS (SELECT 1 FROM seed_employees k WHERE k.id = sr.cash_collected_by)
      ON CONFLICT DO NOTHING`);

    // Step 2 — the other party on exactly those jobs. Stops here.
    await client.query(`
      INSERT INTO keep_users (id)
      SELECT sr.user_id FROM service_requests sr
      JOIN keep_requests k ON k.id = sr.id
      WHERE sr.user_id IS NOT NULL
      ON CONFLICT DO NOTHING`);

    await client.query(`
      INSERT INTO keep_employees (id)
      SELECT e.id FROM employees e
      WHERE EXISTS (
        SELECT 1 FROM service_requests sr JOIN keep_requests k ON k.id = sr.id
        WHERE sr.provider_id = e.id OR sr.cash_collected_by = e.id
      )
      ON CONFLICT DO NOTHING`);

    // Step 3 — a kept employee's own login row must survive with them (FK on
    // employees.user_id). This adds users but never re-widens keep_requests.
    await client.query(`
      INSERT INTO keep_users (id)
      SELECT e.user_id FROM employees e
      JOIN keep_employees k ON k.id = e.id
      WHERE e.user_id IS NOT NULL
      ON CONFLICT DO NOTHING`);

    const seedCount = await client.query('SELECT COUNT(*)::int c FROM seed_users');
    console.log(`🔗 ${seedCount.rows[0].c} seed member(s) → one-hop cascade complete`);

    // Everything else hangs off the people/jobs resolved above.
    await client.query(`
      INSERT INTO keep_orders (id, order_id)
      SELECT o.id, o.order_id FROM product_orders o
      WHERE EXISTS (SELECT 1 FROM keep_users k WHERE k.id = o.user_id)
      ON CONFLICT DO NOTHING`);

    await client.query(`
      INSERT INTO keep_tickets (id)
      SELECT t.id FROM support_tickets t
      WHERE EXISTS (SELECT 1 FROM keep_users k WHERE k.id = t.user_id)
         OR EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = t.service_request_id)
         OR EXISTS (SELECT 1 FROM keep_orders k WHERE k.id = t.product_order_id)
      ON CONFLICT DO NOTHING`);

    await client.query(`
      INSERT INTO keep_payment_txns (id)
      SELECT p.id FROM payment_transactions p
      WHERE EXISTS (SELECT 1 FROM keep_requests k WHERE k.id = p.service_request_id)
         OR EXISTS (SELECT 1 FROM keep_orders k WHERE k.order_id = p.order_id)
      ON CONFLICT DO NOTHING`);

    await client.query(`
      INSERT INTO keep_return_requests (id)
      SELECT r.id FROM return_requests r
      WHERE EXISTS (SELECT 1 FROM keep_users k WHERE k.id = r.user_id)
         OR EXISTS (SELECT 1 FROM keep_orders k WHERE k.order_id = r.order_id)
      ON CONFLICT DO NOTHING`);

    await client.query(`
      INSERT INTO keep_contacts (phone, email)
      SELECT u.phone, u.email FROM users u JOIN keep_users k ON k.id = u.id`);

    // ── Report what survives ──────────────────────────────────────────────
    const kept = await client.query(`
      SELECT u.id, u.username, u.phone, e.id AS employee_id, e.full_name
      FROM keep_users k
      JOIN users u ON u.id = k.id
      LEFT JOIN employees e ON e.user_id = u.id
      ORDER BY (e.id IS NULL), u.id`);

    const jobCount = await client.query('SELECT COUNT(*)::int c FROM keep_requests');
    console.log(`\n👥 Keeping ${kept.rows.length} user(s) and ${jobCount.rows[0].c} service request(s):`);
    for (const r of kept.rows) {
      const role = r.employee_id ? `expert #${r.employee_id} "${r.full_name}"` : 'customer';
      console.log(`   • users.id=${r.id} ${r.username ?? '(no name)'} [${r.phone ?? 'no phone'}] — ${role}`);
    }
    console.log('');

    // ── Delete ────────────────────────────────────────────────────────────
    const steps = WIPE_LOCATIONS ? [...DELETE_STEPS, ...LOCATION_STEPS] : DELETE_STEPS;

    const verb = CONFIRM ? 'deleted' : 'would be deleted';

    for (const step of steps) {
      // SAVEPOINT per step. In Postgres ANY failed statement aborts the whole
      // transaction — catching a "missing table" error and carrying on is not
      // enough, because every later statement then fails with 25P02 and the final
      // COMMIT silently degrades into a ROLLBACK. Rolling back to a savepoint is
      // what actually makes the error recoverable.
      await client.query('SAVEPOINT step');
      try {
        const result = await client.query(step.sql);
        await client.query('RELEASE SAVEPOINT step');
        console.log(`🗑️  ${step.table}: ${result.rowCount} row(s) ${verb}`);
      } catch (err: any) {
        await client.query('ROLLBACK TO SAVEPOINT step');
        if (err.code === '42P01') {
          console.log(`⚠️  Table ${step.table} does not exist, skipping`);
        } else {
          console.error(`❌ Error clearing ${step.table}: ${err.message}`);
          throw err;
        }
      }
    }

    // ── Sequences ─────────────────────────────────────────────────────────
    // setval to the SURVIVING max id, not "RESTART WITH 1". Restarting at 1 while
    // rows with higher ids survive makes the very next insert collide on the
    // primary key — and rows do survive now.
    //
    // One DO block rather than a loop of statements, for two reasons:
    //  - sequence names are derived with pg_get_serial_sequence instead of being
    //    hardcoded, so they cannot drift from the schema (the old hardcoded list
    //    named serviceable_pincodes_id_seq, which does not exist);
    //  - the existence checks happen inside PL/pgSQL, so a missing table or
    //    sequence never raises and never poisons the transaction.
    const sequenceTables = [
      'users', 'customers', 'employees', 'service_requests', 'wallet_transactions',
      'districts', 'serviceable_pincodes', 'product_orders', 'cart_items', 'invoices',
      'otp_verifications', 'audit_logs', 'partner_wallets', 'wallet_transactions_v2',
      'withdrawal_requests', 'inventory_transactions', 'support_tickets', 'ticket_messages',
      'service_charges', 'shipments', 'service_otps', 'ratings', 'social_auth_providers',
      'device_tokens', 'notifications', 'payment_transactions', 'return_requests',
      'refunds', 'refresh_tokens', 'notification_campaigns',
    ];

    // The list is inlined rather than bound: DO blocks accept no parameters, and
    // the driver would read a `$1` inside the body as a placeholder. These names
    // are a constant in this file, never user input, so there is nothing to inject.
    const tableArrayLiteral = sequenceTables.map((t) => `'${t}'`).join(', ');

    await client.query(`
      DO $do$
      DECLARE t text; s text;
      BEGIN
        FOREACH t IN ARRAY ARRAY[${tableArrayLiteral}] LOOP
          -- Both guards are required: pg_get_serial_sequence RAISES (rather than
          -- returning NULL) when the column does not exist, and not every table
          -- here is keyed on "id" — serviceable_pincodes is not.
          IF to_regclass(t) IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'id'
             ) THEN
            s := pg_get_serial_sequence(t, 'id');
            IF s IS NOT NULL THEN
              EXECUTE format(
                'SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id),0) FROM %I), 1), true)', s, t);
            END IF;
          END IF;
        END LOOP;
      END $do$;`);

    console.log('\n🔢 Sequences realigned to surviving max(id)');

    // ── Commit or roll back ───────────────────────────────────────────────
    const keepPhones = kept.rows.map((r) => r.phone).filter(Boolean) as string[];

    if (!CONFIRM) {
      await client.query('ROLLBACK');
      console.log('\n🟢 DRY RUN COMPLETE — everything above was rolled back. Nothing changed.');
      console.log('   Re-run with --confirm to apply.');
      console.log(`   Firebase Auth would keep ${keepPhones.length} phone number(s) and delete the rest.`);
      return;
    }

    await client.query('COMMIT');
    console.log('\n✅ Postgres cleanup committed. Catalogue, inventory and products preserved.');

    // ── Firebase Auth ─────────────────────────────────────────────────────
    // Firebase users are matched to our users by phone number (see the Truecaller
    // auth flow), so the kept members' logins must be skipped or they would be
    // locked out of accounts we just went to the trouble of preserving.
    //
    // SAFETY GATE: Firebase credentials are global — they always point at the one
    // live project, no matter which database this run targeted. Without this
    // check, a cleanup of a LOCAL database would happily delete every real user
    // from production Firebase Auth. Opt in explicitly with --firebase.
    if (!FIREBASE_CLEANUP) {
      console.log(
        '\n⏭️  Skipping Firebase Auth cleanup (pass --firebase to include it).' +
        '\n   Firebase credentials are global, so this would hit the live project' +
        `\n   regardless of the database you just cleaned (${host}).`
      );
      return;
    }

    console.log('\n🔥 Firebase Authentication cleanup...');
    const keepPhoneSet = new Set(
      keepPhones.map((p) => p.replace(/[^\d]/g, '').slice(-10)).filter(Boolean)
    );

    try {
      let page = await admin.auth().listUsers(1000);
      let deleted = 0;
      let skipped = 0;
      while (true) {
        const uids = page.users
          .filter((u) => {
            const last10 = (u.phoneNumber ?? '').replace(/[^\d]/g, '').slice(-10);
            if (last10 && keepPhoneSet.has(last10)) {
              skipped++;
              return false;
            }
            return true;
          })
          .map((u) => u.uid);

        if (uids.length > 0) {
          await admin.auth().deleteUsers(uids);
          deleted += uids.length;
          console.log(`🗑️  Deleted ${uids.length} Firebase user(s)`);
        }

        if (!page.pageToken) break;
        page = await admin.auth().listUsers(1000, page.pageToken);
      }
      console.log(`✅ Firebase cleanup complete — deleted ${deleted}, preserved ${skipped}`);
    } catch (firebaseErr: any) {
      console.error('❌ Firebase cleanup failed:', firebaseErr.message);
      // Postgres already committed; don't fail the run over this.
    }
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Already rolled back or the connection is gone.
    }
    console.error('❌ Cleanup failed, rolled back:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

/**
 * When a name matches nothing, spelling is the usual reason. Show anything
 * sharing a word with the requested names so the caller can correct it.
 */
async function showNameCandidates(client: pg.Client) {
  const tokens = KEEP_NAMES.flatMap((n) => n.split(/\s+/)).filter((t) => t.length > 2);
  if (tokens.length === 0) return;

  const patterns = tokens.map((t) => `%${t}%`);
  const res = await client.query(
    `SELECT 'user' AS kind, id, username AS name FROM users WHERE username ILIKE ANY($1::text[])
     UNION ALL
     SELECT 'employee', id, full_name FROM employees WHERE full_name ILIKE ANY($1::text[])
     ORDER BY 1, 2 LIMIT 40`,
    [patterns],
  );

  if (res.rows.length === 0) {
    console.error('   No similar names found either. Check the database is the one you expect.');
    return;
  }
  console.error('   Did you mean one of these?');
  for (const r of res.rows) console.error(`     ${r.kind} #${r.id}: ${r.name}`);
}

cleanupTestData();
