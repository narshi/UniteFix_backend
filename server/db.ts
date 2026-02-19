import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Production-ready pool configuration
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '50'),                // Maximum connections (up from 20)
  idleTimeoutMillis: 30000,                                       // Close idle clients after 30s
  connectionTimeoutMillis: 5000,                                  // Fail fast if DB unreachable
  allowExitOnIdle: process.env.NODE_ENV !== 'production',         // Allow clean exit in dev
  application_name: 'unitefix-backend',                           // Shows in pg_stat_activity
  options: '-c statement_timeout=30000',                          // 30s query timeout — prevents connection hogging
});

// Log pool errors (don't crash the process)
pool.on('error', (err) => {
  console.error('[DB POOL] Unexpected error on idle client:', err.message);
});

export const db = drizzle(pool, { schema });
