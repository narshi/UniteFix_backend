/**
 * Refuses to continue unless DATABASE_URL points at this machine.
 *
 * `npm run db:push` runs `drizzle-kit push --force`, which applies whatever
 * differs between shared/schema.ts and the database WITHOUT asking — including
 * dropping a column or a table it no longer finds in the schema. That is a
 * convenience on a local database and a disaster on production, and nothing
 * stopped it: the script used whatever DATABASE_URL was set, and `seed:test`
 * ran it first (the seeder's own "local only" check came after the push).
 *
 * Production's schema changes are the additive statements the server applies
 * at startup (server/db.ts, server/lib/hub-migrations.ts). To compare a remote
 * database by hand, run `npx drizzle-kit push` yourself, without --force: it
 * shows each statement and asks before running anything that loses data.
 *
 *   node scripts/require-local-db.mjs && <command>
 */

import 'dotenv/config';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', 'postgres', 'db']);

const url = process.env.DATABASE_URL;
if (!url) {
    console.error('✋ DATABASE_URL is not set. Nothing was changed.');
    process.exit(1);
}

let host;
try {
    host = new URL(url).hostname;
} catch {
    console.error('✋ DATABASE_URL is not a valid connection string. Nothing was changed.');
    process.exit(1);
}

if (!LOCAL_HOSTS.has(host.toLowerCase())) {
    console.error(
        `✋ Refusing to run against "${host}".\n` +
        '   This command changes the schema without asking (drizzle-kit push --force) and is for a LOCAL database only.\n' +
        '   Nothing was changed. See scripts/require-local-db.mjs for what to use instead.',
    );
    process.exit(1);
}

console.log(`Local database (${host}) — continuing.`);
