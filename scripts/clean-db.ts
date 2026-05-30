import "dotenv/config";
import pg from "pg";
import { execSync } from "child_process";
import bcrypt from "bcrypt";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is not set in environment");
  process.exit(1);
}

const { Pool } = pg;

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("    UniteFix — Full Render DB Reset & Seeding");
  console.log("═══════════════════════════════════════════════════\n");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Drop public schema
    console.log("🗑️  Step 1: Dropping all tables and types...");
    await pool.query("DROP SCHEMA public CASCADE;");
    await pool.query("CREATE SCHEMA public;");
    await pool.query("GRANT ALL ON SCHEMA public TO public;");
    
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS postgis;");
      console.log("   ✓ PostGIS extension enabled");
    } catch (e: any) {
      console.log("   ⚠ PostGIS extension could not be enabled:", e.message);
    }
    console.log("   ✓ Database schema cleared.\n");

    // Close pool so drizzle-kit can connect
    await pool.end();

    // 2. Recreate tables via drizzle-kit push
    console.log("🔧 Step 2: Re-creating tables via drizzle-kit push...");
    execSync("npx drizzle-kit push --config=drizzle.config.ts", {
      env: { ...process.env, DATABASE_URL },
      stdio: "inherit",
    });
    console.log("   ✓ Tables created successfully.\n");

    // 3. Connect via Drizzle to seed essential data
    console.log("🌱 Step 3: Seeding essential data...");
    const { db } = await import("../server/db");
    const { 
      adminUsers, 
      districts, 
      serviceablePincodes, 
      serviceCategories, 
      services, 
      platformConfig 
    } = await import("../shared/schema");

    // A. Seed Admin User
    const hashedAdminPassword = await bcrypt.hash("admin123", 10);
    await db.insert(adminUsers).values({
      username: "admin",
      email: "admin@unitefix.com",
      password: hashedAdminPassword,
      role: "admin",
      isActive: true,
    });
    console.log("   ✓ Admin user created (User: admin / Pass: admin123)");

    // B. Seed District
    const [district] = await db.insert(districts).values({
      name: "Uttara Kannada",
      state: "Karnataka",
      pincodePrefix: "581",
      isActive: true,
    }).returning();
    console.log("   ✓ District 'Uttara Kannada' created");

    // C. Seed Serviceable Pincodes
    const pincodes = [
      { pincode: "581301", area: "Sirsi", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
      { pincode: "581302", area: "Sirsi Town", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
      { pincode: "581320", area: "Karwar", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
      { pincode: "581343", area: "Kumta", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
      { pincode: "581355", area: "Ankola", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
      { pincode: "581360", area: "Honnavar", district: "Uttara Kannada", state: "Karnataka", isActive: true, districtId: district.id },
    ];
    await db.insert(serviceablePincodes).values(pincodes);
    console.log("   ✓ Serviceable pincodes seeded");

    // D. Seed Service Categories & Items
    const categories = [
      { name: 'Technology Services', icon: 'monitor', sortOrder: 1 },
      { name: 'Home Services', icon: 'home', sortOrder: 2 },
      { name: 'Repair Services', icon: 'tool', sortOrder: 3 },
    ];
    const seededCategories = await db.insert(serviceCategories).values(categories).returning();
    const techCatId = seededCategories.find((c) => c.name === 'Technology Services')?.id;
    const homeCatId = seededCategories.find((c) => c.name === 'Home Services')?.id;
    const repairCatId = seededCategories.find((c) => c.name === 'Repair Services')?.id;

    if (techCatId && homeCatId && repairCatId) {
      const servicesData = [
        { categoryId: techCatId, name: 'Computers & Printers', subtitle: 'Repair & Setup', icon: 'laptop', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 1 },
        { categoryId: techCatId, name: 'CCTV Installation', subtitle: 'Security & Surveillance', icon: 'video', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 2 },
        { categoryId: techCatId, name: 'Biometric Systems', subtitle: 'Access Control', icon: 'fingerprint', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 3 },
        { categoryId: repairCatId, name: 'UPS & Battery', subtitle: 'Power Backup', icon: 'battery-charging', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 4 },
        { categoryId: homeCatId, name: 'Water Purifier', subtitle: 'RO Service & Repair', icon: 'droplet', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 5 },
        { categoryId: homeCatId, name: 'Solar Services', subtitle: 'Panel Installation', icon: 'sun', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 6 },
        { categoryId: repairCatId, name: 'Electric & Plumbing', subtitle: 'Wiring & Pipes', icon: 'zap', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 7 },
        { categoryId: techCatId, name: 'FTTH Installation', subtitle: 'Fiber Broadband', icon: 'wifi', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 8 },
        { categoryId: homeCatId, name: 'AC Service & Repair', subtitle: 'Cooling Solutions', icon: 'wind', status: 'COMING_SOON' as const, isHomeVisible: false, sortOrder: 9 },
        { categoryId: repairCatId, name: 'Refrigerator Repair', subtitle: 'Cooling Issues', icon: 'snowflake', status: 'COMING_SOON' as const, isHomeVisible: false, sortOrder: 10 },
      ];
      await db.insert(services).values(servicesData);
      console.log("   ✓ Service categories and service items catalog seeded");
    }

    // E. Seed Platform Configs
    const configs = [
      { key: 'BUSINESS_CONFIG.BASE_SERVICE_FEE', value: '250', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Booking charge in INR', isEditable: true },
      { key: 'BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE', value: '50', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Partner commission percentage', isEditable: true },
      { key: 'BUSINESS_CONFIG.GST_PERCENTAGE', value: '18', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'GST percentage', isEditable: false },
      { key: 'BUSINESS_CONFIG.WALLET_HOLD_DAYS', value: '7', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Days to hold earnings before release', isEditable: true },
      { key: 'BUSINESS_CONFIG.MIN_WALLET_REDEMPTION', value: '500', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Minimum withdrawal amount', isEditable: true },
      { key: 'BUSINESS_CONFIG.CANCELLATION_FEE', value: '150', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Cancellation fee in INR', isEditable: true },
      { key: 'BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT', value: '15', valueType: 'number' as const, category: 'BUSINESS_CONFIG' as const, description: 'Platform fee percentage', isEditable: true },
      { key: 'OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE', value: '200', valueType: 'number' as const, category: 'OPERATIONAL_CONFIG' as const, description: 'Max geofence distance', isEditable: true },
      { key: 'OPERATIONAL_CONFIG.INVENTORY_OWNER_PARTNER_ID', value: 'UNITEFIX_PLATFORM', valueType: 'string' as const, category: 'OPERATIONAL_CONFIG' as const, description: 'Platform-owned inventory identifier', isEditable: false },
      { key: 'OPERATIONAL_CONFIG.OTP_EXPIRY_MINUTES', value: '10', valueType: 'number' as const, category: 'OPERATIONAL_CONFIG' as const, description: 'OTP validity duration', isEditable: true },
      { key: 'OPERATIONAL_CONFIG.OTP_LENGTH', value: '4', valueType: 'number' as const, category: 'OPERATIONAL_CONFIG' as const, description: 'OTP digit length', isEditable: false },
      { key: 'OPERATIONAL_CONFIG.ENABLE_AUTO_ASSIGNMENT', value: 'false', valueType: 'boolean' as const, category: 'OPERATIONAL_CONFIG' as const, description: 'Auto assignment toggle', isEditable: true },
      { key: 'SERVICE_CONFIG.CATEGORIES', value: 'Electronics,Appliances,Home Repair', valueType: 'string' as const, category: 'SERVICE_CONFIG' as const, description: 'Available service categories', isEditable: false },
      { key: 'PRODUCT_CONFIG.CATEGORIES', value: 'Category1,Category2,Category3', valueType: 'string' as const, category: 'PRODUCT_CONFIG' as const, description: 'Fixed product categories', isEditable: false },
      { key: 'PAYMENT_CONFIG.RAZORPAY_KEY_ID', value: 'rzp_test_S4tdycF8xSAo2L', valueType: 'string' as const, category: 'PAYMENT_CONFIG' as const, description: 'Razorpay key ID', isEditable: true },
      { key: 'PAYMENT_CONFIG.RAZORPAY_KEY_SECRET', value: 'OG9A8jFSJlW9wFEgv9OzrnHd', valueType: 'string' as const, category: 'PAYMENT_CONFIG' as const, description: 'Razorpay secret key', isEditable: true },
      { key: 'REGION_CONFIG.LAUNCH_REGION', value: 'Uttara Kannada', valueType: 'string' as const, category: 'REGION_CONFIG' as const, description: 'Phase 1 launch region', isEditable: false },
    ];
    await db.insert(platformConfig).values(configs);
    console.log("   ✓ Platform configuration seeded");

    console.log("\n═══════════════════════════════════════════════════");
    console.log("✅ Render DB Reset & Seeding Completed successfully!");
    console.log("═══════════════════════════════════════════════════");
  } catch (error: any) {
    console.error("❌ Error running clean script:", error.message);
    process.exit(1);
  }
  process.exit(0);
}

main();
