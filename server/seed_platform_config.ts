
import { db, pool } from "./db";
import { platformConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
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

async function seedPlatformConfig() {
    console.log("🌱 Seeding Platform Configuration...");

    const configs = [
        // Billing & Business
        { key: 'BUSINESS_CONFIG.BASE_SERVICE_FEE', value: '250', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'Booking charge in INR', isEditable: true },
        { key: 'BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE', value: '50', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'Partner commission percentage', isEditable: true },
        { key: 'BUSINESS_CONFIG.GST_PERCENTAGE', value: '18', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'GST percentage', isEditable: false },
        { key: 'BUSINESS_CONFIG.WALLET_HOLD_DAYS', value: '7', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'Days to hold earnings before release', isEditable: true },
        { key: 'BUSINESS_CONFIG.MIN_WALLET_REDEMPTION', value: '500', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'Minimum withdrawal amount', isEditable: true },
        { key: 'BUSINESS_CONFIG.COMPANY_UPI_ID', value: 'yourmerchant@upi', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'Company UPI ID for QR Code', isEditable: true },

        // Invoice issuer block — printed on every tax invoice PDF
        { key: 'BUSINESS_CONFIG.COMPANY_NAME', value: 'UniteFix Solutions Pvt Ltd', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'Legal entity name printed on invoices', isEditable: true },
        { key: 'BUSINESS_CONFIG.COMPANY_ADDRESS', value: 'Yellapur, Uttara Kannada, Karnataka - 581359', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'Registered address printed on invoices', isEditable: true },
        { key: 'BUSINESS_CONFIG.COMPANY_GSTIN', value: '29ABCDE1234F1Z5', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'GSTIN printed on invoices', isEditable: true },
        { key: 'BUSINESS_CONFIG.PLACE_OF_SUPPLY', value: 'Yellapur, Karnataka', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'Place of supply printed on invoices', isEditable: true },

        // Operational
        // FTTH broadband. The two DEFAULT_ keys are FALLBACKS only — a populated
        // ftth_operators.convenience_fee_paise / .lead_fee_paise always wins, so
        // per-operator terms never require a config edit.
        { key: 'FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE', value: '1000', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'UniteFix convenience fee per recharge, in paise (1000 = ₹10)', isEditable: true },
        { key: 'FTTH_CONFIG.DEFAULT_LEAD_FEE_PAISE', value: '40000', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'Default operator bounty per converted lead, in paise (40000 = ₹400)', isEditable: true },
        { key: 'FTTH_CONFIG.EARLY_RENEWAL_WINDOW_DAYS', value: '15', valueType: 'number', category: 'BUSINESS_CONFIG', description: 'How early a customer may renew, in days. Stops recharges being stacked.', isEditable: true },
        { key: 'FTTH_CONFIG.RENEWAL_REMINDER_DAYS', value: '7,3,1', valueType: 'string', category: 'BUSINESS_CONFIG', description: 'Days before expiry to send a renewal reminder', isEditable: true },

        { key: 'OPERATIONAL_CONFIG.INVENTORY_OWNER_PARTNER_ID', value: 'UNITEFIX_PLATFORM', valueType: 'string', category: 'OPERATIONAL_CONFIG', description: 'Platform-owned inventory identifier', isEditable: false },
        { key: 'OPERATIONAL_CONFIG.OTP_EXPIRY_MINUTES', value: '10', valueType: 'number', category: 'OPERATIONAL_CONFIG', description: 'OTP validity duration', isEditable: true },
        { key: 'OPERATIONAL_CONFIG.OTP_LENGTH', value: '4', valueType: 'number', category: 'OPERATIONAL_CONFIG', description: 'OTP digit length', isEditable: false },

        // Service Categories (fixed per requirements)
        { key: 'SERVICE_CONFIG.CATEGORIES', value: 'Electronics,Appliances,Home Repair', valueType: 'string', category: 'SERVICE_CONFIG', description: 'Available service categories', isEditable: false },

        // Product Categories (3 fixed categories per requirements)
        { key: 'PRODUCT_CONFIG.CATEGORIES', value: 'Category1,Category2,Category3', valueType: 'string', category: 'PRODUCT_CONFIG', description: 'Fixed product categories', isEditable: false },

        // Payment
        { key: 'PAYMENT_CONFIG.RAZORPAY_KEY_ID', value: 'rzp_test_xxxxx', valueType: 'string', category: 'PAYMENT_CONFIG', description: 'Razorpay key ID', isEditable: true },
        { key: 'PAYMENT_CONFIG.RAZORPAY_KEY_SECRET', value: 'secret_xxxxx', valueType: 'string', category: 'PAYMENT_CONFIG', description: 'Razorpay secret key', isEditable: true },

        // Region
        { key: 'REGION_CONFIG.LAUNCH_REGION', value: 'Uttara Kannada', valueType: 'string', category: 'REGION_CONFIG', description: 'Phase 1 launch region', isEditable: false },
    ];

    for (const config of configs) {
        try {
            const existing = await db.select().from(platformConfig).where(eq(platformConfig.key, config.key));

            if (existing.length === 0) {
                await db.insert(platformConfig).values(config);
                console.log(`✅ Seeded config: ${config.key} = ${config.value}`);
            } else {
                console.log(`⏭️  Config exists: ${config.key}`);
            }
        } catch (e) {
            console.error(`❌ Failed to seed ${config.key}:`, e);
        }
    }

    console.log("✅ Platform config seeding complete.");
    await pool.end();
}

seedPlatformConfig().catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
});
