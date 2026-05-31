import { db } from "../server/db";
import { services, serviceCategories } from "../shared/schema";
import { eq } from "drizzle-orm";

async function run() {
    console.log("Updating category icons...");
    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=150&q=80" })
        .where(eq(serviceCategories.name, "Repairs & Services"));

    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=150&q=80" })
        .where(eq(serviceCategories.name, "Plumbing"));

    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=150&q=80" })
        .where(eq(serviceCategories.name, "Electrician"));
        
    await db.update(serviceCategories)
        .set({ icon: "https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?w=150&q=80" })
        .where(eq(serviceCategories.name, "Cleaning"));

    console.log("Updating service banner images...");
    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=500&q=80" })
        .where(eq(services.name, "AC Repair"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=500&q=80" })
        .where(eq(services.name, "Refrigerator Repair"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1558227092-231362e557b4?w=500&q=80" })
        .where(eq(services.name, "Washing Machine Repair"));

    await db.update(services)
        .set({ bannerImage: "https://images.unsplash.com/photo-1585314062340-f1a5a7c9328d?w=500&q=80" })
        .where(eq(services.name, "Home Cleaning"));

    console.log("Done!");
    process.exit(0);
}

run().catch(console.error);
