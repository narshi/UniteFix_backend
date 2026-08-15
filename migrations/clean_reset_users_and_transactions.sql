-- =========================================================================================
-- CLEAN HARD-DELETE: Customers, Employees, Transactions & Bookings
-- PRESERVED: Categories, Services, Pricing, Products, Location data, Admin accounts
-- =========================================================================================

BEGIN;

-- 1. Notifications & Device Tokens
TRUNCATE TABLE device_tokens, notifications, notification_campaigns CASCADE;

-- 2. Support Tickets & Audit Trail
TRUNCATE TABLE ticket_messages, support_tickets, audit_logs CASCADE;

-- 3. Invoices, Payments & Refunds
TRUNCATE TABLE refunds, payment_transactions, invoices CASCADE;

-- 4. Shop / Orders / Shipments
TRUNCATE TABLE shipments, return_requests, cart_items, product_orders CASCADE;

-- 5. Wallet & Partner Finances
TRUNCATE TABLE withdrawal_requests, wallet_transactions_v2, wallet_transactions, partner_wallets CASCADE;

-- 6. Inventory Transactions
TRUNCATE TABLE inventory_transactions CASCADE;

-- 7. Service Requests, OTPs & Ratings
TRUNCATE TABLE ratings, service_otps, service_requests CASCADE;

-- 8. Customer & Employee Profiles
TRUNCATE TABLE customers, employees CASCADE;

-- 9. Auth & Sessions
TRUNCATE TABLE otp_verifications, social_auth_providers, refresh_tokens CASCADE;

-- 10. Users
TRUNCATE TABLE users CASCADE;

-- 11. Reset Auto-Increment Sequences
ALTER SEQUENCE users_id_seq RESTART WITH 1;
ALTER SEQUENCE customers_id_seq RESTART WITH 1;
ALTER SEQUENCE employees_id_seq RESTART WITH 1;
ALTER SEQUENCE service_requests_id_seq RESTART WITH 1;
ALTER SEQUENCE product_orders_id_seq RESTART WITH 1;
ALTER SEQUENCE invoices_id_seq RESTART WITH 1;

COMMIT;
