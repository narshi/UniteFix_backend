
// Automated Verification Script
// Uses native fetch to simulate browser actions
// We will use native fetch.

async function verifyAdminDashboard() {
    const BASE_URL = 'http://localhost:3000';
    console.log('🚀 Starting Automated Admin Dashboard Verification...');

    try {
        // 1. Login
        console.log('\n🔐 Step 1: Admin Login...');
        const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' })
        });

        if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.statusText}`);
        const loginData = await loginRes.json();
        const token = loginData.token;
        console.log('   ✅ Login Successful. Token obtained.');

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };

        // 2. Check Stats
        console.log('\n📊 Step 2: Checking Location Stats...');
        const statsRes = await fetch(`${BASE_URL}/api/admin/location-stats`, { headers });
        if (!statsRes.ok) throw new Error(`Get Stats failed: ${statsRes.statusText}`);
        const stats = await statsRes.json();
        console.log('   ✅ Stats Received:', JSON.stringify(stats));
        if (stats.totalLocations === 0) console.warn('   ⚠️ Warning: Total Locations is 0 (Unexpected if seeded)');

        // 3. Add Location
        console.log('\n📍 Step 3: Adding New Location (Kumta)...');
        const newLocation = {
            pincode: '581342', // Kumta
            area: 'Kumta Town',
            district: 'Uttara Kannada',
            state: 'Karnataka',
            isActive: true
        };
        const addRes = await fetch(`${BASE_URL}/api/admin/locations`, {
            method: 'POST',
            headers,
            body: JSON.stringify(newLocation)
        });

        if (addRes.status === 409) {
            console.log('   ℹ️ Location already exists (Skipping add).');
        } else if (!addRes.ok) {
            throw new Error(`Add Location failed: ${addRes.statusText}`);
        } else {
            console.log('   ✅ Location Added Successfully.');
        }

        // 4. Validate Pincode
        console.log('\n✅ Step 4: Validating Pincode (581341)...');
        const validateRes = await fetch(`${BASE_URL}/api/validate-pincode`, {
            method: 'POST',
            headers, // Code uses global, but let's send auth anyway
            body: JSON.stringify({ pinCode: '581341' })
        });
        const validateData = await validateRes.json();
        console.log(`   Result: ${validateData.message}`);
        if (!validateData.valid) throw new Error('Validation failed for valid pincode');
        console.log('   ✅ Pincode Validation Passed.');

        console.log('\n✨ ALL CHECKS PASSED. Admin Dashboard Location Management is FUNCTIONAL.');

    } catch (error) {
        console.error('\n❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyAdminDashboard();
