import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
    const categories = await db.execute(sql`SELECT * FROM service_categories`);
    const srvs = await db.execute(sql`SELECT * FROM services`);
    
    console.log("=== Categories ===");
    for (const c of categories.rows || categories) {
        console.log(`[${c.id}] ${c.name} (active: ${c.is_active})`);
    }

    console.log("\n=== Services ===");
    const cats = categories.rows || categories;
    for (const s of srvs.rows || srvs) {
        const cat = cats.find((c: any) => c.id === s.category_id);
        console.log(`[${s.id}] [${cat?.name || 'NoCat'}] [${s.sub_category || 'NoSub'}] ${s.name} (active: ${s.is_active})`);
    }
    
    process.exit(0);
}

main().catch(console.error);
