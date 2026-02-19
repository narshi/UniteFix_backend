
import axios from "axios";

const BASE_URL = "http://localhost:5001"; // Using the verified port

async function verifyUsersAPI() {
    console.log("🔍 Verifying User Management API...");

    try {
        // 1. Login as Admin
        console.log("1. Logging in as Admin...");
        const loginRes = await axios.post(`${BASE_URL}/api/admin/auth/login`, {
            username: "admin",
            password: "admin123"
        });
        const token = loginRes.data.token;
        const headers = { Authorization: `Bearer ${token}` };
        console.log("✅ Admin logged in.");

        // 2. List Users
        console.log("2. Fetching Users...");
        const listRes = await axios.get(`${BASE_URL}/api/admin/users`, { headers });
        const users = listRes.data.data;
        console.log(`✅ Fetched ${users.length} users.`);

        if (users.length === 0) {
            console.warn("⚠️ No users found to test updates on.");
            return;
        }

        const testUser = users[0];
        console.log(`   Target User: ID ${testUser.id} (${testUser.username}) - Active: ${testUser.isActive}`);

        // 3. Toggle Status (Block)
        console.log(`3. Toggling status for User ${testUser.id}...`);
        const newStatus = !testUser.isActive;
        const updateRes = await axios.patch(
            `${BASE_URL}/api/admin/users/${testUser.id}/status`,
            { isActive: newStatus },
            { headers }
        );

        if (updateRes.data.isActive === newStatus) {
            console.log(`✅ Status updated to: ${newStatus}`);
        } else {
            console.error("❌ Status update failed!", updateRes.data);
        }

        // 4. Revert Status
        console.log("4. Reverting status...");
        await axios.patch(
            `${BASE_URL}/api/admin/users/${testUser.id}/status`,
            { isActive: testUser.isActive },
            { headers }
        );
        console.log("✅ Status reverted.");

    } catch (error: any) {
        console.error("❌ Verification Failed:", error.message);
        if (error.response) {
            console.error("   Status:", error.response.status);
            console.error("   Data:", error.response.data);
        }
    }
}

verifyUsersAPI();
