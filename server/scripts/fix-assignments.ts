import { db } from "../db";
import { serviceRequests } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

async function run() {
  console.log("Looking for corrupted assignments (status='assigned' but providerId is null)...");
  
  const corrupted = await db
    .select()
    .from(serviceRequests)
    .where(
      and(
        eq(serviceRequests.status, "assigned"),
        isNull(serviceRequests.providerId)
      )
    );
    
  console.log(`Found ${corrupted.length} corrupted assignments.`);
  
  if (corrupted.length > 0) {
    const ids = corrupted.map(r => r.id);
    console.log(`Fixing IDs: ${ids.join(", ")}`);
    
    await db
      .update(serviceRequests)
      .set({
        status: "created",
        assignedAt: null
      })
      .where(
        and(
          eq(serviceRequests.status, "assigned"),
          isNull(serviceRequests.providerId)
        )
      );
      
    console.log("Successfully reverted corrupted assignments back to 'created' state.");
    console.log("They will now appear in the Assignment Queue again.");
  }
  
  process.exit(0);
}

run().catch(console.error);
