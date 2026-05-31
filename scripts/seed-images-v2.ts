import { db } from "../server/db";
import { services, serviceCategories } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
    console.log("Updating category icons...");
    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=150&q=80" }) // Tech
        .where(eq(serviceCategories.name, "Technology Services"));

    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=150&q=80" }) // Home cleaning/services
        .where(eq(serviceCategories.name, "Home Services"));

    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=150&q=80" }) // Repair
        .where(eq(serviceCategories.name, "Repair Services"));
        
    console.log("Updating service banner images...");
    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1558227092-231362e557b4?w=500&q=80" })
        .where(eq(services.name, "Computers & Printers"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=500&q=80" })
        .where(eq(services.name, "CCTV Installation"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1558227092-231362e557b4?w=500&q=80" }) // using general electronics
        .where(eq(services.name, "Biometric Systems"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=500&q=80" })
        .where(eq(services.name, "UPS & Battery"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&q=80" })
        .where(eq(services.name, "Water Purifier"));
        
    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=500&q=80" })
        .where(eq(services.name, "Solar Services"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=500&q=80" })
        .where(eq(services.name, "Electric & Plumbing"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=500&q=80" })
        .where(eq(services.name, "FTTH Installation"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=500&q=80" })
        .where(eq(services.name, "AC Service & Repair"));

    console.log("Done!");
    process.exit(0);
}

run().catch(console.error);
