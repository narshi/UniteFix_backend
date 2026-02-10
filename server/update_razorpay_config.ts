/**
 * Update Platform Config with Razorpay Test Credentials
 * Run: npx tsx server/update_razorpay_config.ts
 */

import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import fs from 'fs';
import path from 'path';

// Load .env manually
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        for (const line of envFile.split('\n')) {
            const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)$/);
            if (match) {
                const key = match[1];
                let val = match[2].trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                process.env[key] = val;
            }
        }
    }
} catch (e) {
    console.log("Could not read .env file", e);
}

async function updateRazorpayConfig() {
    console.log("🔄 Updating Razorpay configuration in database...");

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        console.error("❌ Razorpay credentials not found in .env");
        process.exit(1);
    }

    try {
        // Update Key ID
        await db.execute(sql`
      UPDATE platform_config
      SET value = ${keyId}
      WHERE key = 'PAYMENT_CONFIG.RAZORPAY_KEY_ID'
    `);

        // Update Key Secret
        await db.execute(sql`
      UPDATE platform_config
      SET value = ${keySecret}
      WHERE key = 'PAYMENT_CONFIG.RAZORPAY_KEY_SECRET'
    `);

        console.log("✅ Razorpay Key ID updated:", keyId);
        console.log("✅ Razorpay Key Secret updated:", keySecret.substring(0, 10) + '...');
        console.log("\n⚠️  REMINDER: This is TEST MODE. Replace with live keys before production.");

        await pool.end();
    } catch (error) {
        console.error("❌ Failed to update config:", error);
        process.exit(1);
    }
}

updateRazorpayConfig();
