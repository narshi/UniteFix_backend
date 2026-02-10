import 'dotenv/config';
import { db } from '../server/db';
import {
    users,
    serviceProviders,
    partnerWallets,
    products,
    inventoryItems,
    serviceablePincodes,
    platformConfig,
    adminUsers
} from '../shared/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';

/**
 * IDEMPOTENT TEST DATA SEEDER
 * Can be run multiple times safely using onConflictDoNothing()
 */

async function seedTestData() {
    console.log('🌱 Starting UniteFix Test Data Seeder...\n');

    try {
        // ============================================================================
        // 1. ADMIN USER
        // ============================================================================
        console.log('1️⃣  Seeding Admin User...');
        const existingAdmin = await db.select().from(adminUsers).where(eq(adminUsers.username, 'admin')).limit(1);

        if (existingAdmin.length === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.insert(adminUsers).values({
                username: 'admin',
                password: hashedPassword,
                email: 'admin@unitefix.com',
                role: 'super_admin',
                isActive: true
            }).onConflictDoNothing();
            console.log('   ✅ Admin user created (admin/admin123)');
        } else {
            console.log('   ⏭️  Admin user already exists');
        }

        // ============================================================================
        // 2. TEST USERS (5)
        // ============================================================================
        console.log('\n2️⃣  Seeding Test Users...');
        const testUsers = [
            { phone: '9876543210', email: 'user1@test.com', username: 'test_user_1', password: 'password123', pinCode: '581320' },
            { phone: '9876543211', email: 'user2@test.com', username: 'test_user_2', password: 'password123', pinCode: '581301' },
            { phone: '9876543212', email: 'user3@test.com', username: 'test_user_3', password: 'password123', pinCode: '581325' },
            { phone: '9876543213', email: 'user4@test.com', username: 'test_user_4', password: 'password123', pinCode: '581326' },
            { phone: '9876543214', email: 'user5@test.com', username: 'test_user_5', password: 'password123', pinCode: '581343' },
        ];

        for (const userData of testUsers) {
            const hashedPassword = await bcrypt.hash(userData.password, 10);
            await db.insert(users).values({
                phone: userData.phone,
                email: userData.email,
                username: userData.username,
                password: hashedPassword,
                role: 'user',
                pinCode: userData.pinCode,
                isVerified: true,
                isActive: true
            }).onConflictDoNothing();
        }

        const userCount = await db.select().from(users);
        console.log(`   ✅ Users in database: ${userCount.length}`);

        // ============================================================================
        // 3. TECHNICIANS (Service Providers) with Wallets
        // ============================================================================
        console.log('\n3️⃣  Seeding Technicians (Service Providers)...');
        const technicians = [
            {
                phone: '9988776655',
                email: 'tech1@unitefix.com',
                username: 'tech_ravi',
                password: 'tech123',
                partnerName: 'Ravi Kumar',
                partnerId: 'TECH001',
                skills: ['Electronics', 'Mobile Repair'],
                location: 'Karwar'
            },
            {
                phone: '9988776656',
                email: 'tech2@unitefix.com',
                username: 'tech_suresh',
                password: 'tech123',
                partnerName: 'Suresh Patil',
                partnerId: 'TECH002',
                skills: ['Appliances', 'AC Repair'],
                location: 'Dandeli'
            },
            {
                phone: '9988776657',
                email: 'tech3@unitefix.com',
                username: 'tech_amit',
                password: 'tech123',
                partnerName: 'Amit Naik',
                partnerId: 'TECH003',
                skills: ['Electronics', 'Computer Repair'],
                location: 'Sirsi'
            },
        ];

        for (const techData of technicians) {
            // Insert user with conflict handling
            const hashedPassword = await bcrypt.hash(techData.password, 10);
            const [newUser] = await db.insert(users).values({
                phone: techData.phone,
                email: techData.email,
                username: techData.username,
                password: hashedPassword,
                role: 'serviceman',
                isVerified: true,
                isActive: true
            }).onConflictDoNothing().returning({ id: users.id });

            // If user was just created, create provider and wallet
            if (newUser) {
                const [newProvider] = await db.insert(serviceProviders).values({
                    userId: newUser.id,
                    partnerId: techData.partnerId,
                    partnerName: techData.partnerName,
                    partnerType: 'Individual',
                    verificationStatus: 'verified',
                    skills: techData.skills,
                    location: techData.location,
                    isActive: true,
                    walletBalance: '0'
                }).onConflictDoNothing().returning({ id: serviceProviders.id });

                if (newProvider) {
                    await db.insert(partnerWallets).values({
                        partnerId: newProvider.id,
                        balanceHold: '0',
                        balanceAvailable: '0',
                        totalEarned: '0'
                    }).onConflictDoNothing();
                }
            }
        }

        const providerCount = await db.select().from(serviceProviders);
        const walletCount = await db.select().from(partnerWallets);
        console.log(`   ✅ Service Providers: ${providerCount.length}, Wallets: ${walletCount.length}`);

        // ============================================================================
        // 4. PRODUCTS (20 across 3 categories)
        // ============================================================================
        console.log('\n4️⃣  Seeding Products...');
        const testProducts = [
            // Electronics (8 products)
            { name: 'Screwdriver Set (20 pcs)', category: 'Electronics', price: 350, stock: 50 },
            { name: 'Soldering Iron Kit', category: 'Electronics', price: 650, stock: 30 },
            { name: 'Digital Multimeter', category: 'Electronics', price: 800, stock: 25 },
            { name: 'Wire Stripper Tool', category: 'Electronics', price: 250, stock: 40 },
            { name: 'Heat Shrink Tubes (100 pcs)', category: 'Electronics', price: 150, stock: 60 },
            { name: 'IC Chip Extractor', category: 'Electronics', price: 200, stock: 35 },
            { name: 'Precision Tweezers Set', category: 'Electronics', price: 450, stock: 20 },
            { name: 'Component Tester', category: 'Electronics', price: 1200, stock: 15 },

            // Appliances (7 products)
            { name: 'AC Gas R22 (1kg)', category: 'Appliances', price: 2500, stock: 20 },
            { name: 'AC Gas R410A (1kg)', category: 'Appliances', price: 3000, stock: 15 },
            { name: 'Washing Machine Belt', category: 'Appliances', price: 350, stock: 30 },
            { name: 'Refrigerator Thermostat', category: 'Appliances', price: 800, stock: 25 },
            { name: 'Microwave Magnetron', category: 'Appliances', price: 1500, stock: 10 },
            { name: 'Water Filter Cartridge', category: 'Appliances', price: 600, stock: 40 },
            { name: 'Induction Coil Element', category: 'Appliances', price: 1200, stock: 12 },

            // General Tools (5 products)
            { name: 'Adjustable Wrench', category: 'General', price: 400, stock: 45 },
            { name: 'Pliers Set (3 pcs)', category: 'General', price: 550, stock: 35 },
            { name: 'Allen Key Set', category: 'General', price: 180, stock: 50 },
            { name: 'Measuring Tape (5m)', category: 'General', price: 250, stock: 40 },
            { name: 'Portable Toolbox', category: 'General', price: 850, stock: 20 },
        ];

        for (const productData of testProducts) {
            const [newProduct] = await db.insert(products).values({
                name: productData.name,
                description: `Professional quality ${productData.name.toLowerCase()} for service technicians`,
                category: productData.category,
                price: productData.price,
                stock: productData.stock,
                isActive: true
            }).onConflictDoNothing().returning({ id: products.id });

            // Create inventory item only if product was just created
            if (newProduct) {
                await db.insert(inventoryItems).values({
                    itemCode: `INV-${String(newProduct.id).padStart(5, '0')}`,
                    itemName: productData.name,
                    category: productData.category,
                    unit: 'piece',
                    unitCost: productData.price.toString(),
                    currentStock: productData.stock,
                    minStockLevel: Math.floor(productData.stock * 0.2),
                    ownerPartnerId: 'UNITEFIX_PLATFORM',
                    isActive: true
                }).onConflictDoNothing();
            }
        }

        const productCount = await db.select().from(products);
        const inventoryCount = await db.select().from(inventoryItems);
        console.log(`   ✅ Products: ${productCount.length}, Inventory Items: ${inventoryCount.length}`);

        // ============================================================================
        // 5. SERVICEABLE PINCODES
        // ============================================================================
        console.log('\n5️⃣  Seeding Serviceable Pincodes...');
        const pincodes = [
            { pincode: '581320', area: 'Uttara Kannada', district: 'Uttara Kannada', state: 'Karnataka' },
            { pincode: '581301', area: 'Karwar', district: 'Uttara Kannada', state: 'Karnataka' },
            { pincode: '581325', area: 'Dandeli', district: 'Uttara Kannada', state: 'Karnataka' },
            { pincode: '581326', area: 'Haliyal', district: 'Uttara Kannada', state: 'Karnataka' },
            { pincode: '581343', area: 'Sirsi', district: 'Uttara Kannada', state: 'Karnataka' },
        ];

        for (const pincode of pincodes) {
            await db.insert(serviceablePincodes).values({
                pincode: pincode.pincode,
                area: pincode.area,
                district: pincode.district,
                state: pincode.state,
                isActive: true
            }).onConflictDoNothing();
        }

        const pincodeCount = await db.select().from(serviceablePincodes);
        console.log(`   ✅ Serviceable Pincodes: ${pincodeCount.length}`);

        // ============================================================================
        // 6. PLATFORM CONFIG
        // ============================================================================
        console.log('\n6️⃣  Seeding Platform Config...');
        const configs = [
            { key: 'BOOKING_FEE', value: '250', category: 'BUSINESS_CONFIG', valueType: 'number', description: 'Standard booking fee in INR' },
            { key: 'GST_RATE', value: '18', category: 'BUSINESS_CONFIG', valueType: 'number', description: 'GST percentage' },
            { key: 'PARTNER_COMMISSION', value: '50', category: 'BUSINESS_CONFIG', valueType: 'number', description: 'Partner share percentage' },
            { key: 'WALLET_HOLD_DAYS', value: '7', category: 'OPERATIONAL_CONFIG', valueType: 'number', description: 'Days to hold wallet balance' },
            { key: 'OTP_EXPIRY_MINUTES', value: '10', category: 'OPERATIONAL_CONFIG', valueType: 'number', description: 'OTP validity in minutes' },
        ];

        for (const config of configs) {
            await db.insert(platformConfig).values({
                key: config.key,
                value: config.value,
                category: config.category,
                valueType: config.valueType,
                description: config.description,
                isEditable: true
            }).onConflictDoNothing();
        }

        const configCount = await db.select().from(platformConfig);
        console.log(`   ✅ Platform Configs: ${configCount.length}`);

        // ============================================================================
        // FINAL VERIFICATION
        // ============================================================================
        console.log('\n📊 FINAL SEED VERIFICATION:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const finalAdminCount = await db.select().from(adminUsers);
        const finalUserCount = await db.select().from(users);
        const finalProviderCount = await db.select().from(serviceProviders);
        const finalWalletCount = await db.select().from(partnerWallets);
        const finalProductCount = await db.select().from(products);
        const finalInventoryCount = await db.select().from(inventoryItems);
        const finalPincodeCount = await db.select().from(serviceablePincodes);
        const finalConfigCount = await db.select().from(platformConfig);

        console.log(`Admin Users:          ${finalAdminCount.length}`);
        console.log(`Regular Users:        ${finalUserCount.length}`);
        console.log(`Service Providers:    ${finalProviderCount.length}`);
        console.log(`Partner Wallets:      ${finalWalletCount.length}`);
        console.log(`Products:             ${finalProductCount.length}`);
        console.log(`Inventory Items:      ${finalInventoryCount.length}`);
        console.log(`Serviceable Pincodes: ${finalPincodeCount.length}`);
        console.log(`Platform Configs:     ${finalConfigCount.length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        console.log('\n✅ TEST DATA SEEDING COMPLETE!\n');
        console.log('🔐 TEST CREDENTIALS:');
        console.log('   Admin:  admin / admin123');
        console.log('   User:   9876543210 / password123');
        console.log('   Tech:   9988776655 / tech123');
        console.log('');

    } catch (error) {
        console.error('\n❌ SEEDING FAILED:');
        console.error(error);
        process.exit(1);
    }

    process.exit(0);
}

// Run seeder
seedTestData();
