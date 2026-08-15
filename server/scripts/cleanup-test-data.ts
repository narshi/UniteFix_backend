/**
 * Database Cleanup Script — Clear test data from production
 * 
 * KEEPS: service_categories, services, inventory_items, platform_config, admin_users,
 *        product_categories, product_brands, products, product_variants, product_images
 * 
 * DELETES: users, customers, employees, service_requests, wallet data, 
 *          pincodes, districts, orders, cart, OTPs, notifications, etc.
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

import { admin } from '../lib/firebase';

const DATABASE_URL = process.env.RENDER_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ No DATABASE_URL found');
  process.exit(1);
}

async function cleanupTestData() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL!.includes('render.com') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    await client.query('BEGIN');

    // Delete in correct order to respect foreign key constraints
    // (children first, parents last)

    const tablesToClear = [
      // Dependent tables first
      'refunds',
      'return_requests',
      'payment_transactions',
      'notifications',
      'device_tokens',
      'social_auth_providers',
      'ratings',
      'service_otps',
      'shipments',
      'service_charges',
      'ticket_messages',
      'support_tickets',
      'inventory_transactions',
      'withdrawal_requests',
      'wallet_transactions_v2',
      'partner_wallets',
      'audit_logs',
      'otp_verifications',
      'invoices',
      'cart_items',
      'product_orders',
      'wallet_transactions',
      'service_requests',
      'refresh_tokens',
      // Parent tables
      'employees',
      'customers',
      'users',
      // Location tables
      'serviceable_pincodes',
      'districts',
    ];

    for (const table of tablesToClear) {
      try {
        const result = await client.query(`DELETE FROM ${table}`);
        console.log(`🗑️  Cleared ${table}: ${result.rowCount} rows deleted`);
      } catch (err: any) {
        // Table might not exist yet, that's ok
        if (err.code === '42P01') {
          console.log(`⚠️  Table ${table} does not exist, skipping`);
        } else {
          console.error(`❌ Error clearing ${table}: ${err.message}`);
          throw err; // Rollback on unexpected errors
        }
      }
    }

    // Reset sequences for the cleared tables
    const sequences = [
      'users_id_seq',
      'customers_id_seq',
      'employees_id_seq',
      'service_requests_id_seq',
      'wallet_transactions_id_seq',
      'districts_id_seq',
      'serviceable_pincodes_id_seq',
      'product_orders_id_seq',
      'cart_items_id_seq',
      'invoices_id_seq',
      'otp_verifications_id_seq',
      'audit_logs_id_seq',
      'partner_wallets_id_seq',
      'wallet_transactions_v2_id_seq',
      'withdrawal_requests_id_seq',
      'inventory_transactions_id_seq',
      'support_tickets_id_seq',
      'ticket_messages_id_seq',
      'service_charges_id_seq',
      'shipments_id_seq',
      'service_otps_id_seq',
      'ratings_id_seq',
      'social_auth_providers_id_seq',
      'device_tokens_id_seq',
      'notifications_id_seq',
      'payment_transactions_id_seq',
      'return_requests_id_seq',
      'refunds_id_seq',
      'refresh_tokens_id_seq',
    ];

    for (const seq of sequences) {
      try {
        await client.query(`ALTER SEQUENCE ${seq} RESTART WITH 1`);
      } catch (err: any) {
        // Sequence might not exist
      }
    }

    await client.query('COMMIT');
    console.log('\n✅ Postgres cleanup complete! Service catalogue, inventory, and products preserved.');

    console.log('\n🔥 Starting Firebase Authentication cleanup...');
    try {
      let users = await admin.auth().listUsers(1000);
      let deleteCount = 0;
      while (true) {
        if (users.users.length > 0) {
          const uids = users.users.map(u => u.uid);
          await admin.auth().deleteUsers(uids);
          deleteCount += uids.length;
          console.log(`🗑️  Deleted ${uids.length} users from Firebase Auth`);
        }
        if (users.pageToken) {
          users = await admin.auth().listUsers(1000, users.pageToken);
        } else {
          break;
        }
      }
      console.log(`✅ Firebase cleanup complete! Total users deleted: ${deleteCount}`);
    } catch (firebaseErr: any) {
      console.error('❌ Firebase cleanup failed:', firebaseErr.message);
      // Don't fail the whole script if Postgres succeeded
    }

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed, rolled back:', error.message);
  } finally {
    await client.end();
  }
}

cleanupTestData();
