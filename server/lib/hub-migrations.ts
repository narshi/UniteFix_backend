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
      DO $ BEGIN
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
      END $;
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

