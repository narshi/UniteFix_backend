/**
 * One-shot, idempotent migration for the push-notification feature.
 *
 * Creates `notification_campaigns` (marketing broadcast history) and the two
 * indexes that the notification feed and broadcast fan-out rely on.
 *
 * Safe to run repeatedly — every statement is IF NOT EXISTS, and it only ever
 * adds. It never drops, alters or writes rows.
 *
 * Run it wherever DATABASE_URL points at the target database:
 *   node scripts/apply-notification-migration.mjs
 *
 * Deliberately plain .mjs using `pg` (a production dependency) rather than
 * TypeScript: hosts prune devDependencies, so `tsx` is not available in a
 * deployed container.
 */

import pg from 'pg';

const { Pool } = pg;

const SQL = `
CREATE TABLE IF NOT EXISTS notification_campaigns (
    id              SERIAL PRIMARY KEY,
    audience        TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    body            TEXT    NOT NULL,
    deep_link       TEXT,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    sent_by         INTEGER,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_campaigns_created_idx
    ON notification_campaigns (created_at);

-- Push fan-out reads device_tokens filtered by is_active.
CREATE INDEX IF NOT EXISTS device_tokens_active_idx
    ON device_tokens (user_id, is_active);

-- The feed and the unread badge both filter on is_read.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, is_read);
`;

const url = process.env.DATABASE_URL;

if (!url) {
    console.error('DATABASE_URL is not set. Run this where the app runs, or export it first.');
    process.exit(1);
}

// Managed Postgres (Render, Neon) terminates TLS with a certificate this client
// has no root for. Local/internal connections need no SSL at all.
const needsSsl = /\.render\.com|\.neon\.tech|amazonaws\.com/.test(url);

const pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
});

try {
    const host = url.replace(/:[^:@]*@/, ':***@').split('@')[1] ?? '(unknown host)';
    console.log(`Applying notification migration to ${host}`);

    await pool.query(SQL);

    const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS c FROM notification_campaigns'
    );
    const idx = await pool.query(`
        SELECT indexname FROM pg_indexes
        WHERE indexname IN (
            'notification_campaigns_created_idx',
            'device_tokens_active_idx',
            'notifications_user_unread_idx'
        )
        ORDER BY indexname
    `);

    console.log(`OK — notification_campaigns present (${rows[0].c} rows)`);
    console.log(`OK — indexes: ${idx.rows.map((r) => r.indexname).join(', ')}`);
} catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
