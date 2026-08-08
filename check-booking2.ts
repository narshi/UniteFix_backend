import { db } from './server/db.js';
import { serviceRequests } from './shared/schema.js';
import { desc } from 'drizzle-orm';

async function check() {
  const rows = await db
    .select({
      id: serviceRequests.id,
      serviceId: serviceRequests.serviceId,
      serviceType: serviceRequests.serviceType,
      description: serviceRequests.description,
    })
    .from(serviceRequests)
    .orderBy(desc(serviceRequests.createdAt))
    .limit(1);

  console.log('Latest Booking:', JSON.stringify(rows[0], null, 2));
  process.exit(0);
}
check().catch(e => { console.error(e); process.exit(1); });
