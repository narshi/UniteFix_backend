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
    ['phase2: ledger types fee_charge', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'fee_charge';`],
    ['phase2: ledger types settlement_offset', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'settlement_offset';`],
    ['phase2: hsn + series', `
      ALTER TABLE spare_parts ADD COLUMN IF NOT EXISTS hsn_code TEXT;
      CREATE TABLE IF NOT EXISTS document_series (
        series_key TEXT NOT NULL,
        fy TEXT NOT NULL,
        next_no INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (series_key, fy)
      );
    `],
    ['phase2: tax_documents', `
      CREATE TABLE IF NOT EXISTS tax_documents (
        id SERIAL PRIMARY KEY,
        doc_kind TEXT NOT NULL,
        issuer TEXT NOT NULL,
        issuer_partner_id INTEGER REFERENCES business_partners(id),
        series_key TEXT NOT NULL,
        fy TEXT NOT NULL,
        number TEXT NOT NULL,
        purpose TEXT NOT NULL,
        b2b_order_id INTEGER REFERENCES b2b_orders(id),
        recipient_partner_id INTEGER REFERENCES business_partners(id),
        original_document_id INTEGER REFERENCES tax_documents(id),
        supplier JSONB NOT NULL,
        recipient JSONB NOT NULL,
        place_of_supply_code TEXT,
        place_of_supply_name TEXT,
        is_interstate BOOLEAN NOT NULL DEFAULT FALSE,
        taxable_paise INTEGER NOT NULL,
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL,
        period_from DATE,
        period_to DATE,
        status TEXT NOT NULL DEFAULT 'issued',
        irn TEXT,
        irn_status TEXT,
        notes TEXT,
        issued_at TIMESTAMP DEFAULT NOW(),
        created_by_admin_id INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_uf_number_uq ON tax_documents (number) WHERE issuer = 'unitefix';
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_partner_number_uq ON tax_documents (issuer_partner_id, number) WHERE issuer = 'partner';
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_b2b_invoice_uq ON tax_documents (b2b_order_id) WHERE doc_kind = 'tax_invoice' AND purpose = 'b2b_order' AND status = 'issued';
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_b2b_return_uq ON tax_documents (b2b_order_id) WHERE doc_kind = 'credit_note' AND purpose = 'b2b_order' AND status = 'issued';
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_fee_period_uq ON tax_documents (recipient_partner_id, period_from) WHERE purpose = 'fee' AND status = 'issued';
      CREATE INDEX IF NOT EXISTS tax_documents_recipient_idx ON tax_documents (recipient_partner_id, issued_at);
      CREATE INDEX IF NOT EXISTS tax_documents_issuer_idx ON tax_documents (issuer_partner_id, issued_at);
      CREATE TABLE IF NOT EXISTS tax_document_lines (
        id SERIAL PRIMARY KEY,
        document_id INTEGER NOT NULL REFERENCES tax_documents(id) ON DELETE CASCADE,
        line_no INTEGER NOT NULL,
        description TEXT NOT NULL,
        hsn_sac TEXT,
        quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
        unit TEXT,
        rate_paise INTEGER NOT NULL,
        taxable_paise INTEGER NOT NULL,
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tax_document_lines_doc_idx ON tax_document_lines (document_id);
    `],
    ['phase2: purchase bills', `
      CREATE TABLE IF NOT EXISTS partner_purchase_bills (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        supplier_name TEXT NOT NULL,
        supplier_gstin TEXT,
        bill_number TEXT NOT NULL,
        bill_date DATE NOT NULL,
        taxable_paise INTEGER NOT NULL,
        cgst_paise INTEGER NOT NULL DEFAULT 0,
        sgst_paise INTEGER NOT NULL DEFAULT 0,
        igst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL,
        file_url TEXT,
        notes TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (business_partner_id, supplier_gstin, bill_number)
      );
    `],
    ['phase2: settlement runs', `
      CREATE TABLE IF NOT EXISTS settlement_runs (
        id SERIAL PRIMARY KEY,
        run_code TEXT NOT NULL UNIQUE,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        status TEXT NOT NULL DEFAULT 'draft',
        ftth_owed_paise INTEGER NOT NULL DEFAULT 0,
        b2b_balance_paise INTEGER NOT NULL DEFAULT 0,
        offset_paise INTEGER NOT NULL DEFAULT 0,
        payout_paise INTEGER NOT NULL DEFAULT 0,
        method TEXT,
        payout_reference TEXT,
        cashfree_transfer_id TEXT,
        failure_reason TEXT,
        notes TEXT,
        created_by_admin_id INTEGER,
        paid_by_admin_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS settlement_runs_bp_idx ON settlement_runs (business_partner_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_one_open_uq ON settlement_runs (business_partner_id) WHERE status IN ('draft', 'processing');
    `],
    ['phase2: config', `
      INSERT INTO platform_config (key, value, value_type, category, description, is_editable) VALUES
        ('BUSINESS_CONFIG.FEE_SAC_CODE', '998599', 'string', 'BUSINESS_CONFIG', 'SAC printed on UniteFix fee invoices to partners (confirm with the CA)', TRUE),
        ('BUSINESS_CONFIG.DEFAULT_PART_HSN', '', 'string', 'BUSINESS_CONFIG', 'HSN printed for a part that has none. Leave blank: a wrong HSN is worse than a missing one — set it on the part instead', TRUE)
      ON CONFLICT (key) DO NOTHING;
    `],
    ['phase3: partner columns', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS invoice_prefix TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS gst_filing_frequency TEXT NOT NULL DEFAULT 'monthly';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS invoice_terms TEXT;
      ALTER TABLE tax_documents ADD COLUMN IF NOT EXISTS partner_customer_id INTEGER;
      ALTER TABLE tax_documents ADD COLUMN IF NOT EXISTS due_date DATE;
      CREATE INDEX IF NOT EXISTS tax_documents_customer_idx ON tax_documents (partner_customer_id);
    `],
    ['phase3: partner_customers', `
      CREATE TABLE IF NOT EXISTS partner_customers (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        gstin TEXT,
        state_code TEXT,
        state_name TEXT,
        address TEXT,
        pincode TEXT,
        tags TEXT[] NOT NULL DEFAULT '{}',
        notes TEXT,
        linked_user_id INTEGER REFERENCES users(id),
        ftth_connection_id INTEGER REFERENCES ftth_connections(id),
        created_by_admin_user_id INTEGER,
        archived_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_customers_bp_idx ON partner_customers (business_partner_id, name);
      CREATE UNIQUE INDEX IF NOT EXISTS partner_customers_bp_phone_uq ON partner_customers (business_partner_id, phone) WHERE phone IS NOT NULL AND archived_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS partner_customers_bp_conn_uq ON partner_customers (business_partner_id, ftth_connection_id) WHERE ftth_connection_id IS NOT NULL;
    `],
    ['phase3: quotations', `
      CREATE TABLE IF NOT EXISTS partner_quotations (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES partner_customers(id),
        number TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'draft',
        valid_until DATE,
        lines JSONB NOT NULL,
        taxable_paise INTEGER NOT NULL,
        tax_paise INTEGER NOT NULL,
        total_paise INTEGER NOT NULL,
        notes TEXT,
        terms TEXT,
        source TEXT,
        source_ref_id INTEGER,
        invoice_document_id INTEGER REFERENCES tax_documents(id),
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (business_partner_id, number, version)
      );
      CREATE INDEX IF NOT EXISTS partner_quotations_bp_idx ON partner_quotations (business_partner_id, created_at);
    `],
    ['phase3: invoice payments', `
      CREATE TABLE IF NOT EXISTS partner_invoice_payments (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES tax_documents(id),
        amount_paise INTEGER NOT NULL,
        method TEXT NOT NULL,
        reference TEXT,
        received_on DATE NOT NULL,
        notes TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_invoice_payments_doc_idx ON partner_invoice_payments (document_id);
    `],

    // ── Phase 4: field service — territories, partner technicians, rates, dispatch, earnings
    ['phase4: ledger types service_value', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'service_value';`],
    ['phase4: ledger types cash_collected', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'cash_collected';`],
    ['phase4: partner_territories', `
      CREATE TABLE IF NOT EXISTS partner_territories (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        pincode TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'exclusive',
        status TEXT NOT NULL DEFAULT 'proposed',
        proposed_area TEXT,
        proposed_district TEXT,
        proposed_at TIMESTAMP DEFAULT NOW(),
        activated_at TIMESTAMP,
        activated_by_admin_id INTEGER,
        paused_reason TEXT,
        review_note TEXT,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (business_partner_id, pincode)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_territories_one_exclusive ON partner_territories (pincode) WHERE status = 'active' AND mode = 'exclusive';
      CREATE INDEX IF NOT EXISTS partner_territories_pincode_idx ON partner_territories (pincode, status);
    `],
    ['phase4: employees.managed_by_partner_id', `
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS managed_by_partner_id INTEGER REFERENCES business_partners(id);
      CREATE INDEX IF NOT EXISTS employees_managed_by_partner_idx ON employees (managed_by_partner_id) WHERE managed_by_partner_id IS NOT NULL;
    `],
    ['phase4: partner_service_rates', `
      CREATE TABLE IF NOT EXISTS partner_service_rates (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        catalog_service_id INTEGER NOT NULL REFERENCES services(id),
        base_price INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        effective_from TIMESTAMP NOT NULL,
        submitted_at TIMESTAMP DEFAULT NOW(),
        submitted_by_admin_user_id INTEGER,
        reviewed_by_admin_id INTEGER,
        reviewed_at TIMESTAMP,
        review_note TEXT,
        UNIQUE (business_partner_id, catalog_service_id, effective_from)
      );
      CREATE INDEX IF NOT EXISTS partner_service_rates_lookup ON partner_service_rates (business_partner_id, catalog_service_id, status, effective_from);
    `],
    ['phase4: business_partners field settings', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_fee_percent NUMERIC(5,2);
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_tier TEXT NOT NULL DEFAULT 'new';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_support_phone TEXT;
    `],
    ['phase4: service_requests dispatch', `
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS pincode TEXT;
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS dispatch_partner_id INTEGER REFERENCES business_partners(id);
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS dispatch_mode TEXT;
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS sla_assign_by TIMESTAMP;
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP;
      ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
      CREATE INDEX IF NOT EXISTS service_requests_dispatch_partner_idx ON service_requests (dispatch_partner_id, status) WHERE dispatch_partner_id IS NOT NULL;
    `],
    ['phase4: partner_job_earnings', `
      CREATE TABLE IF NOT EXISTS partner_job_earnings (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        service_request_id INTEGER NOT NULL UNIQUE REFERENCES service_requests(id),
        employee_id INTEGER REFERENCES employees(id),
        amount_paise INTEGER NOT NULL,
        release_at TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'held',
        ledger_entry_id INTEGER,
        released_at TIMESTAMP,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_job_earnings_release_idx ON partner_job_earnings (status, release_at);
      CREATE INDEX IF NOT EXISTS partner_job_earnings_bp_idx ON partner_job_earnings (business_partner_id, created_at);
    `],
    ['phase4: one subcontract invoice per partner per month', `
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_one_subcontract ON tax_documents (issuer_partner_id, period_from) WHERE purpose = 'subcontract' AND doc_kind <> 'credit_note';
    `],
    ['phase4: config', `
      INSERT INTO platform_config (key, value, value_type, category, description, is_editable) VALUES
        ('BUSINESS_CONFIG.PARTNER_RATE_GUARDRAIL_PERCENT', '25', 'number', 'BUSINESS_CONFIG', 'Partner service rates may differ from the national price by at most this %', TRUE),
        ('BUSINESS_CONFIG.PARTNER_FIELD_FEE_PERCENT', '15', 'number', 'BUSINESS_CONFIG', 'UniteFix platform fee % on partner-territory jobs (per-partner override on the partner)', TRUE),
        ('BUSINESS_CONFIG.PARTNER_ASSIGN_SLA_HOURS', '2', 'number', 'BUSINESS_CONFIG', 'Hours a partner has to assign a technician before UniteFix escalates', TRUE),
        ('BUSINESS_CONFIG.PARTNER_ASSIGN_SLA_URGENT_HOURS', '1', 'number', 'BUSINESS_CONFIG', 'Same, for urgent bookings', TRUE),
        ('BUSINESS_CONFIG.PARTNER_SUBCONTRACT_SAC', '9987', 'string', 'BUSINESS_CONFIG', 'SAC on partners'' monthly invoices to UniteFix for field work', TRUE)
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

