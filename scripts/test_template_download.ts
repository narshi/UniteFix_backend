
import axios from "axios";
import fs from "fs";

const BASE_URL = "http://localhost:5001"; // Using 5001 as verified previously

async function testDownload() {
    console.log("Testing Template Download...");

    // 1. Try without Auth (Expect Failure)
    try {
        console.log("Attempting download WITHOUT auth...");
        await axios.get(`${BASE_URL}/api/admin/inventory/template`);
        console.error("❌ Unexpected Success: Downloaded without auth!");
    } catch (error: any) {
        console.log(`✅ Expected Failure: ${error.response?.status} ${error.response?.statusText}`);
    }

    // 2. Try with Auth (Expect Success)
    try {
        console.log("Logging in...");
        const loginRes = await axios.post(`${BASE_URL}/api/admin/auth/login`, {
            username: "admin",
            password: "admin123"
        });
        const token = loginRes.data.token;

        console.log("Attempting download WITH auth...");
        const res = await axios.get(`${BASE_URL}/api/admin/inventory/template`, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'arraybuffer'
        });

        if (res.status === 200 && res.headers['content-type']?.includes('spreadsheetml')) {
            console.log("✅ Success: Downloaded template with auth.");
            fs.writeFileSync("test_template.xlsx", res.data);
            console.log("Saved to test_template.xlsx");
        } else {
            console.error("❌ Failed: Valid auth but unexpected response", res.status, res.headers);
        }

    } catch (error: any) {
        console.error("❌ Failed with Auth:", error.message);
        if (error.response) console.error("Response:", error.response.data);
    }
}

testDownload();
