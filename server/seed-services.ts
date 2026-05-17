import { db } from './db';
import { serviceCategories, services } from '../shared/schema';

async function seedServices() {
  console.log('Seeding service categories and services...');

  const categories = [
    { name: 'Technology Services', icon: 'monitor', sortOrder: 1 },
    { name: 'Home Services', icon: 'home', sortOrder: 2 },
    { name: 'Repair Services', icon: 'tool', sortOrder: 3 },
  ];

  for (const cat of categories) {
    await db.insert(serviceCategories).values(cat).onConflictDoNothing();
  }

  const allCategories = await db.select().from(serviceCategories);
  const techCatId = allCategories.find((c) => c.name === 'Technology Services')?.id;
  const homeCatId = allCategories.find((c) => c.name === 'Home Services')?.id;
  const repairCatId = allCategories.find((c) => c.name === 'Repair Services')?.id;

  if (!techCatId || !homeCatId || !repairCatId) {
    throw new Error('Categories failed to seed.');
  }

  const servicesData = [
    // 1. Computers & Printers
    { categoryId: techCatId, name: 'Computers & Printers', subtitle: 'Repair & Setup', icon: 'laptop', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 1 },
    // 2. CCTV service
    { categoryId: techCatId, name: 'CCTV Installation', subtitle: 'Security & Surveillance', icon: 'video', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 2 },
    // 3. Biometric service
    { categoryId: techCatId, name: 'Biometric Systems', subtitle: 'Access Control', icon: 'fingerprint', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 3 },
    // 4. UPS & battery services
    { categoryId: repairCatId, name: 'UPS & Battery', subtitle: 'Power Backup', icon: 'battery-charging', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 4 },
    // 5. Water purifier Service
    { categoryId: homeCatId, name: 'Water Purifier', subtitle: 'RO Service & Repair', icon: 'droplet', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 5 },
    // 6. Solar services
    { categoryId: homeCatId, name: 'Solar Services', subtitle: 'Panel Installation', icon: 'sun', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 6 },
    // 7. Electric & plumbing services
    { categoryId: repairCatId, name: 'Electric & Plumbing', subtitle: 'Wiring & Pipes', icon: 'zap', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 7 },
    // 8. FTTH installation and service
    { categoryId: techCatId, name: 'FTTH Installation', subtitle: 'Fiber Broadband', icon: 'wifi', status: 'ACTIVE' as const, isHomeVisible: true, sortOrder: 8 },
    
    // Other services (Not home visible or coming soon)
    { categoryId: homeCatId, name: 'AC Service & Repair', subtitle: 'Cooling Solutions', icon: 'wind', status: 'COMING_SOON' as const, isHomeVisible: false, sortOrder: 9 },
    { categoryId: repairCatId, name: 'Refrigerator Repair', subtitle: 'Cooling Issues', icon: 'snowflake', status: 'COMING_SOON' as const, isHomeVisible: false, sortOrder: 10 },
  ];

  for (const srv of servicesData) {
    await db.insert(services).values(srv).onConflictDoNothing();
  }

  console.log('Seeding complete.');
  process.exit(0);
}

seedServices().catch(console.error);
