
import { db } from "../server/db";
import { districts, serviceablePincodes } from "../shared/schema";
import { storage } from "../server/storage";
import { eq } from "drizzle-orm";

async function reproLocationError() {
    console.log("Starting reproduction...");

    const districtName = "Repro_District_" + Date.now();
    const prefix = "999";
    const pincode = "999001";

    try {
        // 1. Create a new district
        console.log(`Creating district ${districtName}...`);
        const newDistrict = await storage.createDistrict({
            name: districtName,
            state: "Karnataka",
            pincodePrefix: prefix,
            isActive: true
        });
        console.log("District created:", newDistrict.id);

        // 2. Try adding a location
        console.log(`Attempting to add location ${pincode} for ${districtName}...`);
        try {
            await storage.createServiceablePincode({
                pincode: pincode,
                area: "Test Area",
                district: districtName,
                state: "Karnataka",
                isActive: true
            });
            console.log("SUCCESS: Location added.");
        } catch (e: any) {
            console.error("FAILURE: Error adding location:", e);
        }

    } catch (error) {
        console.error("Setup Error:", error);
    } finally {
        console.log("Cleaning up...");
        // Cleanup
        try {
            await db.delete(serviceablePincodes).where(eq(serviceablePincodes.pincode, pincode));
            await db.delete(districts).where(eq(districts.name, districtName));
        } catch (cleanupErr) {
            console.error("Cleanup Error:", cleanupErr);
        }
        process.exit(0);
    }
}

reproLocationError();
