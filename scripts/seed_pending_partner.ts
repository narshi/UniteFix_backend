
import { db } from "../server/db";
import { users, serviceProviders } from "../shared/schema";
import * as bcrypt from "bcrypt";

async function main() {
    console.log("Seeding pending service provider...");

    try {
        // Check if user already exists
        const existingUser = await db.query.users.findFirst({
            where: (users, { eq }) => eq(users.email, "pending@example.com")
        });

        if (existingUser) {
            console.log("Pending user already exists.");
            process.exit(0);
        }

        // Create user
        const hashedPassword = await bcrypt.hash("Pending123!", 10);
        const [user] = await db.insert(users).values({
            username: "Pending Partner",
            email: "pending@example.com",
            phone: "9998887776",
            password: hashedPassword,
            role: "serviceman",
            isVerified: true,
            isActive: true,
            referralCode: `PEND${Date.now()}`
        }).returning();

        // Create provider
        await db.insert(serviceProviders).values({
            userId: user.id,
            partnerId: `SP${Math.floor(Math.random() * 10000).toString().padStart(5, '0')}`,
            partnerName: "Pending Partner",
            businessName: "Pending Services Ltd",
            partnerType: "Business",
            verificationStatus: "pending",
            isActive: true,
            walletBalance: "0.00",
            skills: ["Plumbing", "Electrical"],
            services: ["Pipe Repair", "Wiring"],
            location: "581301",
            address: "123 Pending St"
        });

        console.log("Successfully seeded pending partner!");
    } catch (error) {
        console.error("Error seeding:", error);
    }
    process.exit(0);
}

main();
