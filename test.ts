import { storage } from './server/storage';
import { config } from 'dotenv';
import { db } from './server/db';
import { serviceRequests } from './shared/schema';

config();

async function main() {
    const allReqs = await db.select().from(serviceRequests).limit(10);
    console.log("All Service Requests:", allReqs.length);
    for (const req of allReqs) {
        console.log(`Req ${req.id} - status: ${req.status}, providerId: ${req.providerId}`);
        if (req.providerId) {
            const data = await storage.getUserServiceRequests(req.userId);
            const found = data.find(d => d.id === req.id);
            console.log(`  -> Joined Tech Name: ${found?.servicemanName}, Phone: ${found?.servicemanPhone}`);
        }
    }
    process.exit(0);
}

main();
