/**
 * Partner Hub schema — additive DDL only, run at startup after the core
 * migrations.
 *
 * Kept out of runStartupMigrations on purpose: that function runs as one try
 * block, so a single failing statement silently skips every statement after
 * it. Here each phase's block is its own query with its own catch, and a
 * failure is logged loudly without taking anything else down. Every statement
 * is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) — no data is changed.
 */

import type { PoolClient } from 'pg';

const BLOCKS: Array<[string, string]> = [
    ['phase1: verticals', `
      INSERT INTO partner_verticals (code, name, description, sort_order) VALUES
        ('events', 'Event Management', 'Plans and runs weddings, corporate and private events', 60)
      ON CONFLICT (code) DO NOTHING;
    `],
    ['phase1: business_partners KYC + plan', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS state_code TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS state_name TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS gstin_status TEXT NOT NULL DEFAULT 'unchecked';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS gstin_checked_at TIMESTAMP;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS pan_status TEXT NOT NULL DEFAULT 'unchecked';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS bank_status TEXT NOT NULL DEFAULT 'unverified';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMP;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS bank_verification_ref TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS bank_holder_name_at_bank TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS hub_plan TEXT NOT NULL DEFAULT 'starter';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS hub_plan_since TIMESTAMP;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS aato_above_5cr BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS applied_via TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS coverage_pincodes TEXT[];
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
    `],
    ['phase1: partner_modules', `
      CREATE TABLE IF NOT EXISTS partner_modules (
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        module TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        set_by_admin_id INTEGER,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (business_partner_id, module)
      );
    `],
    ['phase1: partner_users', `
      CREATE TABLE IF NOT EXISTS partner_users (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        admin_user_id INTEGER NOT NULL UNIQUE REFERENCES admin_users(id),
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        display_name TEXT,
        phone TEXT,
        invited_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_users_bp_idx ON partner_users (business_partner_id);
    `],
    ['phase1: partner_documents', `
      CREATE TABLE IF NOT EXISTS partner_documents (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        doc_type TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_name TEXT,
        mime_type TEXT,
        expires_at DATE,
        status TEXT NOT NULL DEFAULT 'uploaded',
        review_note TEXT,
        reviewed_by_admin_id INTEGER,
        reviewed_at TIMESTAMP,
        uploaded_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_documents_bp_type_idx ON partner_documents (business_partner_id, doc_type);
    `],
    ['phase1: partner_agreements', `
      CREATE TABLE IF NOT EXISTS partner_agreements (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        agreement_code TEXT NOT NULL,
        version TEXT NOT NULL,
        accepted_by_admin_user_id INTEGER,
        accepted_at TIMESTAMP DEFAULT NOW(),
        ip TEXT,
        user_agent TEXT,
        UNIQUE (business_partner_id, agreement_code, version)
      );
    `],
    ['phase1: config', `
      INSERT INTO platform_config (key, value, value_type, category, description, is_editable) VALUES
        ('BUSINESS_CONFIG.HUB_PRO_FEE_PAISE', '49900', 'number', 'BUSINESS_CONFIG', 'Partner Hub Pro plan, per month (paise, before GST)', TRUE)
      ON CONFLICT (key) DO NOTHING;
    `],
];

export async function runHubMigrations(client: PoolClient): Promise<void> {
    let failed = 0;
    for (const [name, sql] of BLOCKS) {
        try {
            await client.query(sql);
        } catch (err: any) {
            failed++;
            console.error(`[DB] Hub migration "${name}" failed: ${err.message}`);
        }
    }
    console.log(failed ? `[DB] Hub migrations: ${failed} block(s) failed` : '[DB] Hub migrations verified');
}

