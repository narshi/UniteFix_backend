
import { db } from "../server/db";
import { districts } from "../shared/schema";
import { storage } from "../server/storage";
import { eq } from "drizzle-orm";

async function verifyDistricts() {
    console.log("Verifying Districts...");

    try {
        // Wait for storage constructor to finish ensures
        await new Promise(resolve => setTimeout(resolve, 2000));

        const allDistricts = await db.select().from(districts);
        console.log("Found districts:", allDistricts.length);

        const uttaraKannada = allDistricts.find(d => d.name === 'Uttara Kannada');

        if (uttaraKannada) {
            console.log("Default District 'Uttara Kannada' found.");
            console.log(`Pincode Prefix: ${uttaraKannada.pincodePrefix}`);

            if (uttaraKannada.pincodePrefix === '581') {
                console.log("SUCCESS: Default district has correct prefix.");
            } else {
                console.error("FAILURE: Default district has incorrect prefix.");
            }
        } else {
            console.error("FAILURE: Default district 'Uttara Kannada' NOT found.");
        }

        console.log("All Districts:", JSON.stringify(allDistricts, null, 2));

    } catch (error) {
        console.error("Error verifying districts:", error);
    } finally {
        process.exit(0);
    }
}

verifyDistricts();
