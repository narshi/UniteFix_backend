/**
 * FTTH Phase 1 — plans, connections, leads, recharges and the operator ledger.
 *
 * Shipped as a script rather than a .sql file because `migrations/` is
 * gitignored, so SQL files never reach the deployed container. Run it from the
 * Render shell after a deploy, AFTER `npm run migrate:ftth`:
 *
 *   npm run migrate:ftth1
 *
 * Safe to run repeatedly — every statement is IF NOT EXISTS and only ever adds.
 * It never drops, alters an existing column, or writes rows.
 *
 * Money is INTEGER PAISE throughout, matching payment_transactions.amount.
 * Decimals would have meant converting at every Razorpay boundary, which is
 * exactly where rounding errors turn into real money.
 */

import pg from 'pg';

const { Pool } = pg;

const SQL = `
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_connection_status') THEN
        CREATE TYPE ftth_connection_status AS ENUM ('pending_id','active','suspended','closed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_id_request_status') THEN
        CREATE TYPE ftth_id_request_status AS ENUM ('pending','approved','rejected');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_lead_status') THEN
        CREATE TYPE ftth_lead_status AS ENUM ('new','contacted','converted','closed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_recharge_status') THEN
        CREATE TYPE ftth_recharge_status AS ENUM ('created','pending','success','failed','refunded');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ftth_ledger_entry_type') THEN
        CREATE TYPE ftth_ledger_entry_type AS ENUM
            ('recharge_collected','platform_fee','lead_fee','settlement_paid','adjustment');
    END IF;
END$$;

-- Operator-authored catalogue. speed_mbps and duration_months are FREE
-- INTEGERS — no enum, no ladder. Operator A sells 30/50/100, operator B sells
-- 40/60/200; onboarding a third with 25/75 must not need a deploy.
CREATE TABLE IF NOT EXISTS ftth_plans (
    id               SERIAL PRIMARY KEY,
    operator_id      INTEGER NOT NULL REFERENCES ftth_operators(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    speed_mbps       INTEGER NOT NULL,
    duration_months  INTEGER NOT NULL,
    list_price_paise INTEGER NOT NULL,
    discount_paise   INTEGER NOT NULL DEFAULT 0,
    data_limit_gb    INTEGER,
    benefits         JSONB,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    -- Soft delete only: ftth_recharges holds an FK to these rows.
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMP DEFAULT NOW(),
    updated_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ftth_plans_operator_active_idx ON ftth_plans (operator_id, is_active);
CREATE INDEX IF NOT EXISTS ftth_plans_operator_speed_idx  ON ftth_plans (operator_id, speed_mbps);

-- valid_till is the SINGLE source of truth for expiry. Recharge rows keep
-- period_start/period_end as history only — duplicated expiry state drifts.
CREATE TABLE IF NOT EXISTS ftth_connections (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id),
    operator_id          INTEGER NOT NULL REFERENCES ftth_operators(id),
    isp_connection_id    TEXT,
    status               ftth_connection_status NOT NULL DEFAULT 'pending_id',
    current_plan_id      INTEGER REFERENCES ftth_plans(id),
    valid_till           TIMESTAMP,
    customer_name        TEXT,
    installation_address TEXT,
    created_at           TIMESTAMP DEFAULT NOW(),
    updated_at           TIMESTAMP DEFAULT NOW()
);
-- One connection per user PER OPERATOR, and one ISP id per operator.
CREATE UNIQUE INDEX IF NOT EXISTS ftth_conn_user_operator_idx ON ftth_connections (user_id, operator_id);
CREATE UNIQUE INDEX IF NOT EXISTS ftth_conn_isp_id_idx        ON ftth_connections (operator_id, isp_connection_id);
CREATE INDEX IF NOT EXISTS ftth_conn_operator_status_idx      ON ftth_connections (operator_id, status);
CREATE INDEX IF NOT EXISTS ftth_conn_valid_till_idx           ON ftth_connections (valid_till);

CREATE TABLE IF NOT EXISTS ftth_id_requests (
    id                   SERIAL PRIMARY KEY,
    user_id              INTEGER NOT NULL REFERENCES users(id),
    operator_id          INTEGER NOT NULL REFERENCES ftth_operators(id),
    connection_id        INTEGER REFERENCES ftth_connections(id),
    claimed_name         TEXT NOT NULL,
    claimed_phone        TEXT NOT NULL,
    claimed_address      TEXT,
    claimed_isp_id       TEXT,
    status               ftth_id_request_status NOT NULL DEFAULT 'pending',
    rejection_reason     TEXT,
    reviewed_by_admin_id INTEGER REFERENCES admin_users(id),
    reviewed_at          TIMESTAMP,
    created_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ftth_id_req_operator_status_idx ON ftth_id_requests (operator_id, status);
CREATE INDEX IF NOT EXISTS ftth_id_req_user_idx            ON ftth_id_requests (user_id);

CREATE TABLE IF NOT EXISTS ftth_leads (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER NOT NULL REFERENCES users(id),
    operator_id             INTEGER NOT NULL REFERENCES ftth_operators(id),
    name                    TEXT NOT NULL,
    phone                   TEXT NOT NULL,
    address                 TEXT NOT NULL,
    pincode                 TEXT NOT NULL,
    notes                   TEXT,
    status                  ftth_lead_status NOT NULL DEFAULT 'new',
    converted_connection_id INTEGER REFERENCES ftth_connections(id),
    -- Snapshot at conversion: renegotiating the bounty must not re-price history.
    lead_fee_paise          INTEGER,
    converted_at            TIMESTAMP,
    created_at              TIMESTAMP DEFAULT NOW(),
    updated_at              TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ftth_leads_operator_status_idx ON ftth_leads (operator_id, status);
CREATE INDEX IF NOT EXISTS ftth_leads_user_idx            ON ftth_leads (user_id);

-- Every priced field is SNAPSHOT here at initiate. Storing only plan_id means
-- editing a plan tomorrow silently re-prices every historic recharge.
CREATE TABLE IF NOT EXISTS ftth_recharges (
    id                            SERIAL PRIMARY KEY,
    connection_id                 INTEGER NOT NULL REFERENCES ftth_connections(id),
    plan_id                       INTEGER NOT NULL REFERENCES ftth_plans(id),
    plan_name                     TEXT NOT NULL,
    speed_mbps                    INTEGER NOT NULL,
    duration_months               INTEGER NOT NULL,
    list_price_paise              INTEGER NOT NULL,
    discount_paise                INTEGER NOT NULL DEFAULT 0,
    convenience_fee_paise         INTEGER NOT NULL DEFAULT 0,
    gst_on_convenience_fee_paise  INTEGER NOT NULL DEFAULT 0,
    total_paise                   INTEGER NOT NULL,
    operator_payable_paise        INTEGER NOT NULL,
    platform_revenue_paise        INTEGER NOT NULL,
    razorpay_order_id             TEXT,
    razorpay_payment_id           TEXT,
    status                        ftth_recharge_status NOT NULL DEFAULT 'created',
    period_start                  TIMESTAMP,
    period_end                    TIMESTAMP,
    failure_reason                TEXT,
    fulfilled_at                  TIMESTAMP,
    fulfilled_by_admin_id         INTEGER REFERENCES admin_users(id),
    created_at                    TIMESTAMP DEFAULT NOW(),
    updated_at                    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ftth_recharges_connection_idx  ON ftth_recharges (connection_id);
CREATE INDEX IF NOT EXISTS ftth_recharges_status_idx      ON ftth_recharges (status);
-- One recharge per Razorpay order: half of what stops a customer opening two
-- orders and paying both.
CREATE UNIQUE INDEX IF NOT EXISTS ftth_recharges_rzp_order_idx ON ftth_recharges (razorpay_order_id);
CREATE INDEX IF NOT EXISTS ftth_recharges_rzp_payment_idx      ON ftth_recharges (razorpay_payment_id);

-- Append-only. NOT wallet_transactions* — those are partner_id -> employees.id
-- NOT NULL, and an operator is not an employee. amount_paise is SIGNED:
-- positive is owed to the operator, negative is paid out or deducted.
CREATE TABLE IF NOT EXISTS ftth_operator_ledger (
    id                   SERIAL PRIMARY KEY,
    operator_id          INTEGER NOT NULL REFERENCES ftth_operators(id),
    entry_type           ftth_ledger_entry_type NOT NULL,
    amount_paise         INTEGER NOT NULL,
    recharge_id          INTEGER REFERENCES ftth_recharges(id),
    lead_id              INTEGER REFERENCES ftth_leads(id),
    balance_before_paise INTEGER NOT NULL DEFAULT 0,
    balance_after_paise  INTEGER NOT NULL DEFAULT 0,
    description          TEXT,
    metadata             JSONB,
    created_by_admin_id  INTEGER REFERENCES admin_users(id),
    created_at           TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ftth_ledger_operator_idx ON ftth_operator_ledger (operator_id, created_at);
-- Idempotency: a replayed webhook must not double-credit. NULLs do not collide
-- in Postgres, so manual adjustment/settlement rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS ftth_ledger_recharge_entry_idx ON ftth_operator_ledger (entry_type, recharge_id);
CREATE UNIQUE INDEX IF NOT EXISTS ftth_ledger_lead_entry_idx     ON ftth_operator_ledger (entry_type, lead_id);

-- Without this column FTTH money is invisible to /api/admin/payments/stuck,
-- /api/admin/payments/transactions and the reconcile endpoint — the exact tools
-- that exist because a payment with no entity link has gone wrong here before.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS ftth_recharge_id INTEGER REFERENCES ftth_recharges(id);
CREATE INDEX IF NOT EXISTS payment_tx_ftth_idx ON payment_transactions (ftth_recharge_id);
`;

const CONFIG_ROWS = [
    ['FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE', '1000', 'number', 'BUSINESS_CONFIG', 'UniteFix convenience fee per recharge, in paise (1000 = Rs.10)'],
    ['FTTH_CONFIG.DEFAULT_LEAD_FEE_PAISE', '40000', 'number', 'BUSINESS_CONFIG', 'Default operator bounty per converted lead, in paise (40000 = Rs.400)'],
    ['FTTH_CONFIG.EARLY_RENEWAL_WINDOW_DAYS', '15', 'number', 'BUSINESS_CONFIG', 'How early a customer may renew, in days'],
    ['FTTH_CONFIG.RENEWAL_REMINDER_DAYS', '7,3,1', 'string', 'BUSINESS_CONFIG', 'Days before expiry to send a renewal reminder'],
];

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('sslmode=disable')
            ? false
            : { rejectUnauthorized: false },
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(SQL);

        // The DEFAULT_ keys are fallbacks only — a populated
        // ftth_operators.convenience_fee_paise / .lead_fee_paise always wins.
        for (const [key, value, valueType, category, description] of CONFIG_ROWS) {
            await client.query(
                `INSERT INTO platform_config (key, value, value_type, category, description, is_editable)
                 VALUES ($1,$2,$3,$4,$5,true)
                 ON CONFLICT (key) DO NOTHING`,
                [key, value, valueType, category, description],
            );
        }

        await client.query('COMMIT');

        const { rows } = await client.query(
            `SELECT table_name FROM information_schema.tables
              WHERE table_name LIKE 'ftth%' ORDER BY table_name`,
        );
        console.log('FTTH Phase 1 applied. Tables:', rows.map(r => r.table_name).join(', '));
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('FTTH Phase 1 migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

main();
