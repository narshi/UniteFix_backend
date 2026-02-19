
import axios from "axios";

const BASE_URL = "http://localhost:5001";

async function verifyInventory() {
    console.log("Verifying Inventory API...");

    try {
        // 1. Login Logic
        console.log("Logging in as admin...");
        // Assuming login route is /api/admin/auth/login based on routes.ts structure
        // If this fails, we might need to check exact route
        let token = "";
        try {
            const loginRes = await axios.post(`${BASE_URL}/api/admin/auth/login`, {
                username: "admin",
                password: "admin123"
            });
            token = loginRes.data.token;
            console.log("Login successful.");
        } catch (e: any) {
            console.error("Login failed:", e.response?.data || e.message);
            // Fallback: maybe route is different?
            // But for now let's assume it works or we need to find the route.
            return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        // 2. Create Product
        console.log("Creating product...");
        const productData = {
            name: "Test Inventory Item " + Date.now(),
            description: "Test Description",
            price: 5000, // Number
            category: "Computer",
            stock: 10,
            images: ["http://example.com/img1.jpg"],
            isActive: true
        };

        const createRes = await axios.post(`${BASE_URL}/api/admin/inventory`, productData, { headers });
        const productId = createRes.data.id;
        console.log("Product created:", productId);

        // 3. List Products (Admin)
        console.log("Listing products for admin...");
        const listRes = await axios.get(`${BASE_URL}/api/admin/inventory`, { headers });
        const found = listRes.data.find((p: any) => p.id === productId);
        if (found) {
            console.log("Product found in admin list.");
        } else {
            console.error("Product NOT found in admin list.");
        }

        // 4. Update Product
        console.log("Updating product...");
        const updateRes = await axios.patch(`${BASE_URL}/api/admin/inventory/${productId}`, {
            price: 6000,
            stock: 5
        }, { headers });

        if (updateRes.data.price === 6000) {
            console.log("Product updated successfully.");
        } else {
            console.error("Product update verification failed.");
        }

        // 5. Delete Product
        console.log("Deleting product...");
        await axios.delete(`${BASE_URL}/api/admin/inventory/${productId}`, { headers });

        // Verify deletion (isActive should be false)
        try {
            const checkRes = await axios.get(`${BASE_URL}/api/admin/inventory`, { headers });
            const checkFound = checkRes.data.find((p: any) => p.id === productId);
            if (checkFound && !checkFound.isActive) {
                console.log("Product marked inactive (soft deleted).");
            } else if (!checkFound) {
                console.log("Product removed from list (if logic filters it out).");
            } else {
                console.error("Product still active after delete!", checkFound);
            }
        } catch (e) {
            console.log("Error checking deletion:", e);
        }

        console.log("Inventory Verification Complete.");

    } catch (error: any) {
        console.error("Test Error:", error.response?.data || error.message);
    }
}

verifyInventory();
