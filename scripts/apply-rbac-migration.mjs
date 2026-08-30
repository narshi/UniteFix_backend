/**
 * Roles & capabilities — replaces the hardcoded admin / super_admin / operator
 * checks with real RBAC.
 *
 *   npm run migrate:rbac
 *
 * Shipped as a script rather than a .sql file because `migrations/` is
 * gitignored, so SQL files never reach the deployed container.
 *
 * Safe to run repeatedly. Every statement is IF NOT EXISTS / ON CONFLICT, and
 * the backfill only touches rows whose role_id is still NULL — re-running will
 * NOT reset capabilities you have since edited in the UI.
 *
 * ORDER MATTERS: the roles are seeded and every existing account is backfilled
 * in the same transaction as the schema change. An account left with role_id
 * NULL would fall back to its legacy slug (the middleware handles that), but a
 * custom role could not be assigned to it until it had one.
 */

import pg from 'pg';

const { Pool } = pg;

// Mirrors shared/capabilities.ts. Kept as literals here because this script runs
// as plain node against a deployed container and cannot import TypeScript.
// If you add an area there, add it here too — the seed is only a starting point,
// and anything missing can be ticked on in the UI afterwards.
const STAFF_AREAS = [
    'dashboard', 'bookings', 'support', 'orders', 'inventory',
    'customers', 'employees', 'payments', 'withdrawals', 'billing',
    'catalog', 'locations', 'marketing', 'ftth', 'settings', 'audit', 'accounts',
];
const MANAGE_ONLY = ['db_console'];

const SUPER_ADMIN_CAPS = [
    ...STAFF_AREAS.flatMap(a => [`${a}:view`, `${a}:manage`]),
    ...MANAGE_ONLY.map(a => `${a}:manage`),
];

// What a plain `admin` could actually do before this migration: everything
// except the Database Console, the Audit Trail, and account management. Seeded
// to match, so nobody's access silently changes on deploy.
const ADMIN_CAPS = [
    'dashboard:view',
    'bookings:manage', 'support:manage', 'orders:manage', 'inventory:manage',
    'customers:view', 'employees:manage',
    'payments:view', 'withdrawals:view', 'billing:manage',
    'catalog:manage', 'locations:manage',
    'marketing:view', 'ftth:view', 'settings:view',
];

const OPERATOR_CAPS = ['operator_portal:manage'];

const SQL = `
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role_scope') THEN
        CREATE TYPE admin_role_scope AS ENUM ('staff', 'operator');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS admin_roles (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    -- The hard boundary, deliberately NOT a capability: a staff role can never
    -- reach the operator portal and vice versa, whatever is ticked.
    scope       admin_role_scope NOT NULL DEFAULT 'staff',
    -- System roles cannot be deleted and their slug cannot change.
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_slug_idx ON admin_roles (slug);

CREATE TABLE IF NOT EXISTS admin_role_capabilities (
    role_id    INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    PRIMARY KEY (role_id, capability)
);

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES admin_roles(id);
-- Archive rather than delete: admin_users.id is referenced by audit_logs,
-- ftth_operators and recharge fulfilment. A hard delete strips the attribution
-- off that history.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
`;

const ROLES = [
    { slug: 'super_admin', name: 'Super Admin', scope: 'staff', isSystem: true, caps: SUPER_ADMIN_CAPS,
      description: 'Full access to everything, including roles and the database console. Always holds every capability.' },
    { slug: 'admin', name: 'Administrator', scope: 'staff', isSystem: true, caps: ADMIN_CAPS,
      description: 'Day-to-day operations. No database console, audit trail or account management.' },
    { slug: 'operator', name: 'FTTH Operator', scope: 'operator', isSystem: true, caps: OPERATOR_CAPS,
      description: 'A broadband partner. Sees only their own portal — never the staff console.' },
];

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

        for (const role of ROLES) {
            const { rows: [row] } = await client.query(
                `INSERT INTO admin_roles (slug, name, description, scope, is_system)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (slug) DO UPDATE SET is_system = TRUE, scope = EXCLUDED.scope
                 RETURNING id`,
                [role.slug, role.name, role.description, role.scope, role.isSystem],
            );

            // Only seed capabilities when the role has NONE. Re-running must not
            // wipe grants an admin has since edited in the UI.
            const { rows: [{ c }] } = await client.query(
                'SELECT COUNT(*)::int AS c FROM admin_role_capabilities WHERE role_id = $1', [row.id]);
            if (Number(c) === 0) {
                for (const cap of role.caps) {
                    await client.query(
                        `INSERT INTO admin_role_capabilities (role_id, capability) VALUES ($1,$2)
                         ON CONFLICT DO NOTHING`, [row.id, cap]);
                }
            }
        }

        // Backfill: point every existing account at the role matching its slug.
        // Only rows with role_id NULL, so a re-run cannot undo a role change.
        const { rowCount: backfilled } = await client.query(
            `UPDATE admin_users u
                SET role_id = r.id
               FROM admin_roles r
              WHERE u.role_id IS NULL AND r.slug = u.role`);

        // Any account whose legacy slug matches no role at all would otherwise be
        // left unable to sign in. Surface it rather than guessing.
        const { rows: orphans } = await client.query(
            `SELECT id, username, role FROM admin_users WHERE role_id IS NULL`);

        await client.query('COMMIT');

        const { rows: summary } = await client.query(
            `SELECT r.slug, r.name, r.scope,
                    (SELECT COUNT(*)::int FROM admin_role_capabilities WHERE role_id = r.id) AS capabilities,
                    (SELECT COUNT(*)::int FROM admin_users WHERE role_id = r.id) AS accounts
               FROM admin_roles r ORDER BY r.id`);

        console.log('\n  RBAC applied.\n');
        console.table(summary);
        console.log(`  ${backfilled} account(s) linked to a role.`);
        if (orphans.length) {
            console.log('\n  WARNING — these accounts have a role slug with no matching role:');
            console.table(orphans);
            console.log('  They fall back to their legacy slug and can still sign in, but');
            console.log('  assign them a real role from Roles & Access.');
        }
        console.log('');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('RBAC migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
