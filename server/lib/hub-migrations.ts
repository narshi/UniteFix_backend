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
        expires_at TEXT,
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
        period_from TEXT,
        period_to TEXT,
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
        bill_date TEXT NOT NULL,
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
      ALTER TABLE tax_documents ADD COLUMN IF NOT EXISTS due_date TEXT;
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
        valid_until TEXT,
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
        received_on TEXT NOT NULL,
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

    // ── Phase 5: consulting — services, availability, appointments, retainers
    ['phase5: consult_services', `
      CREATE TABLE IF NOT EXISTS consult_services (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        kind TEXT NOT NULL DEFAULT 'fixed',
        price_paise INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        mode TEXT NOT NULL DEFAULT 'online',
        sac TEXT NOT NULL DEFAULT '998311',
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
        sessions_included INTEGER,
        hours_included NUMERIC(6,2),
        is_public BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS consult_services_bp_idx ON consult_services (business_partner_id);
    `],
    ['phase5: consult_availability', `
      CREATE TABLE IF NOT EXISTS consult_availability (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        weekday INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS consult_availability_bp_idx ON consult_availability (business_partner_id, weekday);
      CREATE TABLE IF NOT EXISTS consult_time_off (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        reason TEXT,
        UNIQUE (business_partner_id, day)
      );
    `],
    ['phase5: consult_appointments', `
      CREATE TABLE IF NOT EXISTS consult_appointments (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES partner_customers(id),
        service_id INTEGER NOT NULL REFERENCES consult_services(id),
        retainer_id INTEGER,
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        mode TEXT NOT NULL DEFAULT 'online',
        location TEXT,
        meeting_link TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        source TEXT NOT NULL DEFAULT 'hub',
        client_message TEXT,
        private_notes TEXT,
        client_notes TEXT,
        price_paise INTEGER NOT NULL DEFAULT 0,
        invoice_document_id INTEGER REFERENCES tax_documents(id),
        public_token TEXT NOT NULL UNIQUE,
        cancelled_reason TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS consult_appointments_bp_time ON consult_appointments (business_partner_id, starts_at);
    `],
    ['phase5: consult_retainers', `
      CREATE TABLE IF NOT EXISTS consult_retainers (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES partner_customers(id),
        service_id INTEGER REFERENCES consult_services(id),
        title TEXT NOT NULL,
        monthly_fee_paise INTEGER NOT NULL,
        sac TEXT NOT NULL DEFAULT '998311',
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
        hours_included NUMERIC(6,2),
        billing_day INTEGER NOT NULL DEFAULT 1,
        start_date TEXT NOT NULL,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_billed_period TEXT,
        last_bill_error TEXT,
        notes TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS consult_retainers_bp_idx ON consult_retainers (business_partner_id, status);
      CREATE TABLE IF NOT EXISTS consult_retainer_bills (
        retainer_id INTEGER NOT NULL REFERENCES consult_retainers(id) ON DELETE CASCADE,
        period TEXT NOT NULL,
        document_id INTEGER REFERENCES tax_documents(id),
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (retainer_id, period)
      );
    `],
    // Day values are kept as 'YYYY-MM-DD' text: the driver turns DATE into a
    // local-midnight Date, which shifts a day across time zones.
    ['phase5: day columns as text', `
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'partner_documents' AND column_name = 'expires_at') = 'date' THEN
          ALTER TABLE partner_documents ALTER COLUMN expires_at TYPE TEXT USING to_char(expires_at, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'tax_documents' AND column_name = 'period_from') = 'date' THEN
          ALTER TABLE tax_documents ALTER COLUMN period_from TYPE TEXT USING to_char(period_from, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'tax_documents' AND column_name = 'period_to') = 'date' THEN
          ALTER TABLE tax_documents ALTER COLUMN period_to TYPE TEXT USING to_char(period_to, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'tax_documents' AND column_name = 'due_date') = 'date' THEN
          ALTER TABLE tax_documents ALTER COLUMN due_date TYPE TEXT USING to_char(due_date, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'partner_purchase_bills' AND column_name = 'bill_date') = 'date' THEN
          ALTER TABLE partner_purchase_bills ALTER COLUMN bill_date TYPE TEXT USING to_char(bill_date, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'partner_quotations' AND column_name = 'valid_until') = 'date' THEN
          ALTER TABLE partner_quotations ALTER COLUMN valid_until TYPE TEXT USING to_char(valid_until, 'YYYY-MM-DD');
        END IF;
        IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'partner_invoice_payments' AND column_name = 'received_on') = 'date' THEN
          ALTER TABLE partner_invoice_payments ALTER COLUMN received_on TYPE TEXT USING to_char(received_on, 'YYYY-MM-DD');
        END IF;
      END $$;
    `],

    // ── Phase 6: events — packages, enquiries, bookings, milestones, vendors
    ['phase6: quotation client link', `
      ALTER TABLE partner_quotations ADD COLUMN IF NOT EXISTS public_token TEXT;
      ALTER TABLE partner_quotations ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP;
      ALTER TABLE partner_quotations ADD COLUMN IF NOT EXISTS client_response_note TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS partner_quotations_token ON partner_quotations (public_token) WHERE public_token IS NOT NULL;
    `],
    ['phase6: event_packages', `
      CREATE TABLE IF NOT EXISTS event_packages (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        description TEXT,
        unit TEXT NOT NULL DEFAULT 'event',
        price_paise INTEGER NOT NULL,
        sac TEXT NOT NULL DEFAULT '998596',
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_packages_bp_idx ON event_packages (business_partner_id);
    `],
    ['phase6: event_enquiries', `
      CREATE TABLE IF NOT EXISTS event_enquiries (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES partner_customers(id),
        user_id INTEGER REFERENCES users(id),
        source TEXT NOT NULL DEFAULT 'hub',
        event_type TEXT NOT NULL,
        event_date TEXT,
        guests INTEGER,
        venue TEXT,
        budget_paise INTEGER,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        lost_reason TEXT,
        public_token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_enquiries_bp_idx ON event_enquiries (business_partner_id, created_at);
      CREATE INDEX IF NOT EXISTS event_enquiries_user_idx ON event_enquiries (user_id) WHERE user_id IS NOT NULL;
    `],
    ['phase6: event_bookings', `
      CREATE TABLE IF NOT EXISTS event_bookings (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        enquiry_id INTEGER REFERENCES event_enquiries(id),
        customer_id INTEGER NOT NULL REFERENCES partner_customers(id),
        quotation_id INTEGER NOT NULL REFERENCES partner_quotations(id),
        title TEXT NOT NULL,
        event_date TEXT NOT NULL,
        venue TEXT,
        guests INTEGER,
        status TEXT NOT NULL DEFAULT 'confirmed',
        total_paise INTEGER NOT NULL,
        checklist JSONB NOT NULL DEFAULT '[]',
        staff JSONB NOT NULL DEFAULT '[]',
        notes TEXT,
        final_invoice_document_id INTEGER REFERENCES tax_documents(id),
        cancelled_reason TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS event_bookings_one_per_quote ON event_bookings (quotation_id);
      CREATE INDEX IF NOT EXISTS event_bookings_bp_date ON event_bookings (business_partner_id, event_date);
      CREATE TABLE IF NOT EXISTS event_milestones (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES event_bookings(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        due_date TEXT,
        amount_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'due',
        paid_on TEXT,
        method TEXT,
        reference TEXT,
        receipt_document_id INTEGER REFERENCES tax_documents(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_milestones_booking_idx ON event_milestones (booking_id);
    `],
    ['phase6: event_vendors', `
      CREATE TABLE IF NOT EXISTS event_vendors (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        phone TEXT,
        gstin TEXT,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS event_vendor_costs (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES event_bookings(id) ON DELETE CASCADE,
        vendor_id INTEGER NOT NULL REFERENCES event_vendors(id),
        description TEXT NOT NULL,
        taxable_paise INTEGER NOT NULL,
        gst_paise INTEGER NOT NULL DEFAULT 0,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'due',
        paid_on TEXT,
        reference TEXT,
        bill_number TEXT,
        purchase_bill_id INTEGER REFERENCES partner_purchase_bills(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_vendor_costs_booking_idx ON event_vendor_costs (booking_id);
    `],

    // ── Phase 4 follow-up: partner-first warranty
    ['phase4: ledger types warranty_draw', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'warranty_draw';`],
    ['phase4: warranty partner fields', `
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES business_partners(id);
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_respond_by TIMESTAMP;
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_taken_at TIMESTAMP;
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_technician_id INTEGER REFERENCES employees(id);
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_note TEXT;
      ALTER TABLE warranty_claims ADD COLUMN IF NOT EXISTS partner_charge_paise INTEGER;
      CREATE INDEX IF NOT EXISTS warranty_claims_partner_idx ON warranty_claims (partner_id, status) WHERE partner_id IS NOT NULL;
    `],

    // ── Phase 7: sell products — listings, split orders, settlement, reviews
    ['phase7: ledger types marketplace_sale', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'marketplace_sale';`],
    ['phase7: ledger types marketplace_commission', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'marketplace_commission';`],
    ['phase7: ledger types tcs', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'tcs';`],
    ['phase7: ledger types tds', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'tds';`],
    ['phase7: products listing columns', `
      ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_partner_id INTEGER REFERENCES business_partners(id);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS listing_status TEXT NOT NULL DEFAULT 'live';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp INTEGER;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2);
      ALTER TABLE products ADD COLUMN IF NOT EXISTS country_of_origin TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS manufacturer TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS net_quantity TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS return_window_days INTEGER NOT NULL DEFAULT 7;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_months INTEGER;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_by TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS bis_number TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS wpc_eta TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_sku TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS products_seller_idx ON products (seller_partner_id) WHERE seller_partner_id IS NOT NULL;
    `],
    ['phase7: business_partners seller columns', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS seller_tier TEXT NOT NULL DEFAULT 'new';
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS seller_tier_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS seller_score INTEGER;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS grievance_name TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS grievance_phone TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS grievance_email TEXT;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS return_policy TEXT;
    `],
    ['phase7: marketplace_commission', `
      CREATE TABLE IF NOT EXISTS marketplace_commission (
        product_category_id INTEGER PRIMARY KEY REFERENCES product_categories(id),
        percent NUMERIC(5,2) NOT NULL,
        min_paise INTEGER NOT NULL DEFAULT 0,
        updated_by INTEGER,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `],
    ['phase7: seller_orders', `
      CREATE TABLE IF NOT EXISTS market_checkouts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        product_order_id INTEGER REFERENCES product_orders(id),
        razorpay_order_id TEXT UNIQUE,
        razorpay_payment_id TEXT,
        amount_paise INTEGER NOT NULL,
        lines JSONB NOT NULL,
        address TEXT NOT NULL,
        pincode TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS seller_orders (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        checkout_id INTEGER NOT NULL REFERENCES market_checkouts(id),
        product_order_id INTEGER REFERENCES product_orders(id),
        seller_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'placed',
        taxable_paise INTEGER NOT NULL,
        gst_paise INTEGER NOT NULL,
        total_paise INTEGER NOT NULL,
        commission_paise INTEGER NOT NULL DEFAULT 0,
        commission_gst_paise INTEGER NOT NULL DEFAULT 0,
        tcs_paise INTEGER NOT NULL DEFAULT 0,
        tds_paise INTEGER NOT NULL DEFAULT 0,
        ship_name TEXT, ship_phone TEXT, ship_address TEXT, ship_pincode TEXT,
        courier TEXT, tracking_id TEXT,
        confirmed_at TIMESTAMP, dispatched_at TIMESTAMP, delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP, cancel_reason TEXT, cancelled_by TEXT,
        refund_paise INTEGER NOT NULL DEFAULT 0, refund_status TEXT, refund_reference TEXT,
        return_window_days INTEGER NOT NULL DEFAULT 7,
        settle_after TIMESTAMP, settled_at TIMESTAMP,
        invoice_document_id INTEGER REFERENCES tax_documents(id),
        credit_note_document_id INTEGER REFERENCES tax_documents(id),
        return_reason TEXT, return_requested_at TIMESTAMP, return_status TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (checkout_id, seller_partner_id)
      );
      CREATE INDEX IF NOT EXISTS seller_orders_seller_idx ON seller_orders (seller_partner_id, status);
      CREATE INDEX IF NOT EXISTS seller_orders_user_idx ON seller_orders (user_id);
      CREATE INDEX IF NOT EXISTS seller_orders_settle_idx ON seller_orders (settle_after) WHERE settled_at IS NULL;
      CREATE TABLE IF NOT EXISTS seller_order_items (
        id SERIAL PRIMARY KEY,
        seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price_paise INTEGER NOT NULL,
        mrp_paise INTEGER,
        gst_rate NUMERIC(5,2) NOT NULL,
        hsn_code TEXT,
        taxable_paise INTEGER NOT NULL,
        tax_paise INTEGER NOT NULL,
        commission_paise INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS seller_order_events (
        id SERIAL PRIMARY KEY,
        seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id) ON DELETE CASCADE,
        from_status TEXT, to_status TEXT NOT NULL,
        actor_type TEXT NOT NULL, actor_id INTEGER,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS seller_order_events_idx ON seller_order_events (seller_order_id, created_at);
    `],
    ['phase7: product_reviews', `
      CREATE TABLE IF NOT EXISTS product_reviews (
        id SERIAL PRIMARY KEY,
        seller_order_item_id INTEGER NOT NULL UNIQUE REFERENCES seller_order_items(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        seller_partner_id INTEGER NOT NULL REFERENCES business_partners(id),
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        review TEXT,
        seller_reply TEXT,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS product_reviews_product_idx ON product_reviews (product_id) WHERE is_visible;
      CREATE INDEX IF NOT EXISTS product_reviews_seller_idx ON product_reviews (seller_partner_id);
    `],
    ['phase7: config', `
      INSERT INTO platform_config (key, value, value_type, category, description, is_editable) VALUES
        ('BUSINESS_CONFIG.MARKETPLACE_COMMISSION_PERCENT', '10', 'number', 'BUSINESS_CONFIG', 'Default marketplace commission % on the pre-tax item price (per-category rates override)', TRUE),
        ('BUSINESS_CONFIG.MARKETPLACE_TCS_PERCENT', '0.5', 'number', 'BUSINESS_CONFIG', 'GST TCS (CGST s.52) on net taxable value of goods sold through the platform — confirm with the CA', TRUE),
        ('BUSINESS_CONFIG.MARKETPLACE_TDS_PERCENT', '0.1', 'number', 'BUSINESS_CONFIG', 'Income-tax TDS s.194-O on gross sales through the platform — confirm with the CA', TRUE),
        ('BUSINESS_CONFIG.MARKETPLACE_DISPATCH_SLA_HOURS', '48', 'number', 'BUSINESS_CONFIG', 'Hours a seller has to dispatch an order', TRUE)
      ON CONFLICT (key) DO NOTHING;
    `],

    // ── Follow-up: partner alerts
    ['alerts: hub_alerts', `
      CREATE TABLE IF NOT EXISTS hub_alerts (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link TEXT,
        ref_type TEXT,
        ref_id INTEGER,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS hub_alerts_bp_idx ON hub_alerts (business_partner_id, created_at DESC);
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS alert_prefs JSONB;
    `],
    ['pay links: ledger types online_collection', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'online_collection';`],
    ['pay links: ledger types gateway_fee', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'gateway_fee';`],
    ['store: ledger types store_penalty', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'store_penalty';`],
    ['store: fees, penalties, courier', `
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS gateway_fee_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS gateway_fee_gst_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS penalty_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS penalty_reason TEXT;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS penalty_waived_at TIMESTAMP;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS shipment_ref TEXT;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS parcel JSONB;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS courier_charge_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS courier_charge_gst_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS delhivery_pickup_name TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS installation_price_paise INTEGER;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS installation_sac TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS installation_note TEXT;
      ALTER TABLE seller_order_items ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'goods';
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS installation_status TEXT;
      ALTER TABLE seller_orders ADD COLUMN IF NOT EXISTS installed_at TIMESTAMP;
    `],
    ['field: hours, holidays, auto-assign', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_hours JSONB;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_auto_assign BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS field_auto_assign_minutes INTEGER NOT NULL DEFAULT 15;
      CREATE TABLE IF NOT EXISTS partner_holidays (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS partner_holidays_bp_day_idx ON partner_holidays (business_partner_id, day);
    `],
    ['consignment: ledger type', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'consignment_sale';`],
    ['consignment: lots and draws', `
      CREATE TABLE IF NOT EXISTS consignment_lots (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        spare_part_id INTEGER NOT NULL REFERENCES spare_parts(id),
        quantity_offered INTEGER NOT NULL,
        quantity_received INTEGER NOT NULL DEFAULT 0,
        quantity_sold INTEGER NOT NULL DEFAULT 0,
        quantity_returned INTEGER NOT NULL DEFAULT 0,
        unit_payout_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        notes TEXT,
        review_note TEXT,
        received_at TIMESTAMP,
        received_by_admin_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS consignment_lots_bp_idx ON consignment_lots (business_partner_id);
      CREATE INDEX IF NOT EXISTS consignment_lots_part_idx ON consignment_lots (spare_part_id, status);
      CREATE TABLE IF NOT EXISTS consignment_draws (
        id SERIAL PRIMARY KEY,
        lot_id INTEGER NOT NULL REFERENCES consignment_lots(id) ON DELETE CASCADE,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        spare_part_id INTEGER NOT NULL,
        movement_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_payout_paise INTEGER NOT NULL,
        amount_paise INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS consignment_draws_lot_move_idx ON consignment_draws (lot_id, movement_id);
      CREATE INDEX IF NOT EXISTS consignment_draws_bp_idx ON consignment_draws (business_partner_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS tax_documents_one_consignment ON tax_documents (issuer_partner_id, period_from) WHERE purpose = 'consignment' AND doc_kind <> 'credit_note';
    `],
    ['parts: customer approval requests', `
      CREATE TABLE IF NOT EXISTS part_requests (
        id SERIAL PRIMARY KEY,
        service_request_id INTEGER NOT NULL REFERENCES service_requests(id),
        employee_id INTEGER NOT NULL,
        customer_user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        items JSONB NOT NULL,
        reason TEXT,
        parts_paise INTEGER NOT NULL DEFAULT 0,
        gst_paise INTEGER NOT NULL DEFAULT 0,
        total_paise INTEGER NOT NULL DEFAULT 0,
        earlier_warranty JSONB,
        customer_note TEXT,
        sent_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        decided_at TIMESTAMP,
        decided_by_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS part_requests_sr_idx ON part_requests (service_request_id, status);
    `],
    ['events: showcase (themes, gallery, page fields)', `
      ALTER TABLE event_packages ADD COLUMN IF NOT EXISTS photos JSONB;
      ALTER TABLE event_packages ADD COLUMN IF NOT EXISTS capacity INTEGER;
      ALTER TABLE event_packages ADD COLUMN IF NOT EXISTS show_on_page BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE event_packages ADD COLUMN IF NOT EXISTS max_qty INTEGER;
      ALTER TABLE event_enquiries ADD COLUMN IF NOT EXISTS selection JSONB;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS events_profile JSONB;
      CREATE TABLE IF NOT EXISTS event_themes (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        suitable_for TEXT,
        photos JSONB,
        price_paise INTEGER NOT NULL DEFAULT 0,
        sac TEXT NOT NULL DEFAULT '998596',
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_themes_bp_idx ON event_themes (business_partner_id);
      CREATE TABLE IF NOT EXISTS event_gallery (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        caption TEXT,
        theme_id INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS event_gallery_bp_idx ON event_gallery (business_partner_id, sort_order);
    `],
    ['pay links: partner_pay_links', `
      CREATE TABLE IF NOT EXISTS partner_pay_links (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        ref_id INTEGER NOT NULL,
        customer_id INTEGER,
        description TEXT NOT NULL,
        amount_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        method TEXT,
        paid_at TIMESTAMP,
        fee_paise INTEGER NOT NULL DEFAULT 0,
        fee_gst_paise INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_by_admin_user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_pay_links_ref_idx ON partner_pay_links (kind, ref_id);
      CREATE INDEX IF NOT EXISTS partner_pay_links_bp_idx ON partner_pay_links (business_partner_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS partner_pay_links_order_idx ON partner_pay_links (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
    `],
    ['celebrations: verticals', `
      INSERT INTO partner_verticals (code, name, description, sort_order) VALUES
        ('hall', 'Halls & Venues', 'Marriage halls, party halls, banquet spaces and lawns', 70),
        ('photography', 'Photography & Films', 'Wedding, event and portrait photographers and studios', 80)
      ON CONFLICT (code) DO NOTHING;
    `],
    ['celebrations: columns', `
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS venue_profile JSONB;
      ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS portfolio_profile JSONB;
      ALTER TABLE event_packages ADD COLUMN IF NOT EXISTS is_addon BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE event_enquiries ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'event';
      ALTER TABLE event_enquiries ADD COLUMN IF NOT EXISTS basket_id INTEGER;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'event';
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'hub';
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS space_id INTEGER;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS slot TEXT;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMP;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS deposit_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS deposit_note TEXT;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancellation_policy JSONB;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS commission_paise INTEGER;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS commission_gst_paise INTEGER;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS commission_charged_at TIMESTAMP;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMP;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS cancel_request_note TEXT;
      ALTER TABLE event_bookings ADD COLUMN IF NOT EXISTS review_prompted_at TIMESTAMP;
    `],
    ['celebrations: venue_spaces', `
      CREATE TABLE IF NOT EXISTS venue_spaces (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'hall',
        description TEXT,
        seated INTEGER,
        floating INTEGER,
        area_sqft INTEGER,
        photos JSONB,
        video_url TEXT,
        features JSONB,
        included TEXT,
        rates JSONB,
        sac TEXT NOT NULL DEFAULT '997212',
        gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS venue_spaces_bp_idx ON venue_spaces (business_partner_id);
    `],
    ['celebrations: booking_calendar', `
      CREATE TABLE IF NOT EXISTS booking_calendar (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        resource_kind TEXT NOT NULL,
        resource_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        part TEXT NOT NULL,
        status TEXT NOT NULL,
        hold_expires_at TIMESTAMP,
        enquiry_id INTEGER,
        booking_id INTEGER,
        note TEXT,
        created_by_admin_user_id INTEGER,
        released_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS booking_calendar_bp_day_idx ON booking_calendar (business_partner_id, day);
      CREATE UNIQUE INDEX IF NOT EXISTS booking_calendar_live_slot_idx ON booking_calendar (business_partner_id, resource_kind, resource_id, day, part)
        WHERE status IN ('hold', 'booked', 'blocked');
      CREATE INDEX IF NOT EXISTS booking_calendar_hold_idx ON booking_calendar (hold_expires_at) WHERE status = 'hold';
    `],
    ['celebrations: partner_listings', `
      CREATE TABLE IF NOT EXISTS partner_listings (
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        review_note TEXT,
        submitted_at TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by_admin_id INTEGER,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        commission_percent NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (business_partner_id, kind)
      );
    `],
    ['celebrations: portfolio', `
      CREATE TABLE IF NOT EXISTS portfolio_albums (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        story TEXT,
        location TEXT,
        event_date TEXT,
        category TEXT NOT NULL DEFAULT 'wedding',
        cover_url TEXT,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portfolio_albums_bp_idx ON portfolio_albums (business_partner_id, sort_order);
      CREATE TABLE IF NOT EXISTS portfolio_media (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        album_id INTEGER REFERENCES portfolio_albums(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        thumb_url TEXT,
        provider TEXT,
        width INTEGER,
        height INTEGER,
        duration_sec INTEGER,
        caption TEXT,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS portfolio_media_bp_idx ON portfolio_media (business_partner_id, album_id, sort_order);
    `],
    ['celebrations: partner_reviews', `
      CREATE TABLE IF NOT EXISTS partner_reviews (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL REFERENCES business_partners(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        booking_id INTEGER NOT NULL UNIQUE,
        reviewer_name TEXT NOT NULL,
        occasion TEXT,
        event_date TEXT,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        body TEXT,
        reply TEXT,
        replied_at TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'published',
        hidden_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS partner_reviews_bp_idx ON partner_reviews (business_partner_id, status);
    `],
    ['celebrations: celebration_baskets', `
      CREATE TABLE IF NOT EXISTS celebration_baskets (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        user_id INTEGER,
        occasion TEXT,
        event_date TEXT NOT NULL,
        guests INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `],
    ['celebrations: ledger types booking_commission', `ALTER TYPE bp_ledger_entry_type ADD VALUE IF NOT EXISTS 'booking_commission';`],
    ['news: vertical', `
      INSERT INTO partner_verticals (code, name, description, sort_order) VALUES
        ('media', 'Newspapers & Media', 'Local newspapers and news publishers', 90)
      ON CONFLICT (code) DO NOTHING;
    `],
    ['news: tables', `
      CREATE TABLE IF NOT EXISTS news_papers (
        id SERIAL PRIMARY KEY,
        business_partner_id INTEGER NOT NULL UNIQUE REFERENCES business_partners(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'kannada',
        city TEXT,
        frequency TEXT NOT NULL DEFAULT 'daily',
        description TEXT,
        logo_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        review_note TEXT,
        archive_until TIMESTAMP,
        plan_reminded_for TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS news_editions (
        id SERIAL PRIMARY KEY,
        paper_id INTEGER NOT NULL REFERENCES news_papers(id) ON DELETE CASCADE,
        edition_date TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Main edition',
        headline TEXT,
        page_count INTEGER NOT NULL DEFAULT 1,
        file_key TEXT,
        file_size INTEGER NOT NULL DEFAULT 0,
        preview_url TEXT,
        public_token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'live',
        removed_reason TEXT,
        reads INTEGER NOT NULL DEFAULT 0,
        link_views INTEGER NOT NULL DEFAULT 0,
        notified_at TIMESTAMP,
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS news_editions_paper_idx ON news_editions (paper_id, edition_date);
      CREATE UNIQUE INDEX IF NOT EXISTS news_editions_live_title_idx ON news_editions (paper_id, edition_date, lower(title)) WHERE status = 'live';
      CREATE TABLE IF NOT EXISTS news_follows (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        paper_id INTEGER NOT NULL REFERENCES news_papers(id) ON DELETE CASCADE,
        source TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, paper_id)
      );
      CREATE INDEX IF NOT EXISTS news_follows_paper_idx ON news_follows (paper_id);
      CREATE TABLE IF NOT EXISTS news_reads (
        user_id INTEGER NOT NULL,
        edition_id INTEGER NOT NULL REFERENCES news_editions(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, edition_id)
      );
      CREATE TABLE IF NOT EXISTS news_archive_plans (
        id SERIAL PRIMARY KEY,
        paper_id INTEGER NOT NULL REFERENCES news_papers(id) ON DELETE CASCADE,
        months INTEGER NOT NULL,
        amount_paise INTEGER NOT NULL,
        gst_paise INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        starts_at TIMESTAMP,
        ends_at TIMESTAMP,
        invoice_document_id INTEGER,
        created_by_admin_user_id INTEGER,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS news_archive_plans_order_idx ON news_archive_plans (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
    `],
    ['accounts: deletion requests', `
      CREATE TABLE IF NOT EXISTS account_deletion_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        role TEXT NOT NULL,
        reason_category TEXT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT,
        decided_by_admin_id INTEGER,
        decided_at TIMESTAMP,
        source TEXT NOT NULL DEFAULT 'app',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS account_deletion_requests_user_idx ON account_deletion_requests (user_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_open_idx ON account_deletion_requests (user_id) WHERE status = 'pending';
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

