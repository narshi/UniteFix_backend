import { db } from "./db";
import { serviceCategories, services } from "@shared/schema";
import { inArray, eq } from "drizzle-orm";

async function updateActiveServices() {
  console.log("Updating active services...");

  try {
    // 1. Set ALL services to inactive
    await db.update(services).set({ isActive: false, isHomeVisible: false });

    // 2. The exact names we want to activate based on the DB seeded data
    const activeNames = [
      "Computer & Printer",
      "CCTV Camera",
      "Internet & Broadband Services (FTTH)",
      "UPS & Batteries",
      "Water Purifiers (Domestic & Commercial)",
      "Solar & Heat Pumps",
      "Electrical & Plumbing",
      "Biometric Device"
    ];

    // Images that don't block mobile apps (LoremFlickr / Picsum)
    const activeServicesData = [
      { name: "Computer & Printer", img: "https://loremflickr.com/400/400/computer,laptop" },
      { name: "CCTV Camera", img: "https://loremflickr.com/400/400/cctv,camera" },
      { name: "Internet & Broadband Services (FTTH)", img: "https://loremflickr.com/400/400/router,internet" },
      { name: "UPS & Batteries", img: "https://loremflickr.com/400/400/battery,power" },
      { name: "Water Purifiers (Domestic & Commercial)", img: "https://loremflickr.com/400/400/water,purifier" },
      { name: "Solar & Heat Pumps", img: "https://loremflickr.com/400/400/solar,panel" },
      { name: "Electrical & Plumbing", img: "https://loremflickr.com/400/400/plumbing,pipes" },
      { name: "Biometric Device", img: "https://loremflickr.com/400/400/fingerprint,security" },
    ];

    // 3. Activate the specific services and update their images to stable ones
    for (const data of activeServicesData) {
      await db.update(services)
        .set({ 
          isActive: true, 
          isHomeVisible: true,
          icon: data.img,
          bannerImage: data.img
        })
        .where(eq(services.name, data.name));
    }

    console.log("Active services updated successfully.");

  } catch (error) {
    console.error("Error updating services:", error);
  }
}

updateActiveServices().then(() => process.exit(0)).catch(() => process.exit(1));
