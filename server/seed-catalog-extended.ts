import { db } from "./db";
import { serviceCategories, services } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seedExtendedCatalog() {
  console.log("Seeding extended services catalog...");

  try {
    // 1. Categories
    const categoriesData = [
      { name: "IT & Security", icon: "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=200&q=80", sortOrder: 1 },
      { name: "Appliances & Utilities", icon: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=200&q=80", sortOrder: 2 },
      { name: "Repairs & Maintenance", icon: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=200&q=80", sortOrder: 3 },
      { name: "Professional & Property", icon: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=200&q=80", sortOrder: 4 },
      { name: "Transport & Logistics", icon: "https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?w=200&q=80", sortOrder: 5 },
      { name: "Events, Travel & Lifestyle", icon: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&q=80", sortOrder: 6 },
      { name: "Specialized Services", icon: "https://images.unsplash.com/photo-1530533718754-001d2668365a?w=200&q=80", sortOrder: 7 },
    ];

    console.log("Inserting categories...");
    const categoryMap = new Map();
    for (const cat of categoriesData) {
      const existing = await db.select().from(serviceCategories).where(eq(serviceCategories.name, cat.name));
      if (existing.length > 0) {
        await db.update(serviceCategories)
            .set({ icon: cat.icon, sortOrder: cat.sortOrder })
            .where(eq(serviceCategories.id, existing[0].id));
        categoryMap.set(cat.name, existing[0].id);
      } else {
        const [inserted] = await db.insert(serviceCategories)
            .values({ ...cat, isActive: true })
            .returning();
        categoryMap.set(inserted.name, inserted.id);
      }
    }

    const servicesData = [
      // IT & Security
      { category: "IT & Security", name: "Computer & Printer", subtitle: "Repair & maintenance for PCs, laptops, and printers", icon: "https://images.unsplash.com/photo-1558227092-231362e557b4?w=500&q=80", sortOrder: 1 },
      { category: "IT & Security", name: "CCTV Camera", subtitle: "Security camera installation and troubleshooting", icon: "https://images.unsplash.com/photo-1557597774-9d273605dfa9?w=500&q=80", sortOrder: 2 },
      { category: "IT & Security", name: "Biometric Device", subtitle: "Access control and attendance system setup", icon: "https://images.unsplash.com/photo-1558227092-231362e557b4?w=500&q=80", sortOrder: 3 },
      { category: "IT & Security", name: "Internet & Broadband Services (FTTH)", subtitle: "Fiber optic installation and router configuration", icon: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=500&q=80", sortOrder: 4 },
      { category: "IT & Security", name: "DTH Services", subtitle: "Satellite TV dish installation and signal alignment", icon: "https://images.unsplash.com/photo-1593784991095-a205069470b6?w=500&q=80", sortOrder: 5 },

      // Appliances & Utilities
      { category: "Appliances & Utilities", name: "Home Appliances", subtitle: "Repairs for TV, fridge, washing machine, and more", icon: "https://images.unsplash.com/photo-1626222839958-868dd895ccb8?w=500&q=80", sortOrder: 1 },
      { category: "Appliances & Utilities", name: "UPS & Batteries", subtitle: "Inverter and battery backup solutions", icon: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=500&q=80", sortOrder: 2 },
      { category: "Appliances & Utilities", name: "Water Purifiers (Domestic & Commercial)", subtitle: "RO installation, filter change, and servicing", icon: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&q=80", sortOrder: 3 },
      { category: "Appliances & Utilities", name: "Solar & Heat Pumps", subtitle: "Solar panel and heat pump installation & repair", icon: "https://images.unsplash.com/photo-1508514177221-188b1cf16e9d?w=500&q=80", sortOrder: 4 },
      { category: "Appliances & Utilities", name: "WTP & STP", subtitle: "Water & Sewage Treatment Plant maintenance", icon: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&q=80", sortOrder: 5 },
      { category: "Appliances & Utilities", name: "Generators, Water Pumps, Water Cutoff Sensors", subtitle: "Heavy utility and pump maintenance", icon: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=500&q=80", sortOrder: 6 },

      // Repairs & Maintenance
      { category: "Repairs & Maintenance", name: "Household Repairs", subtitle: "General handyman services for home", icon: "https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=500&q=80", sortOrder: 1 },
      { category: "Repairs & Maintenance", name: "Electrical & Plumbing", subtitle: "Wiring, fixtures, pipes, and leaks", icon: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=500&q=80", sortOrder: 2 },
      { category: "Repairs & Maintenance", name: "Mobile Repairs", subtitle: "Screen replacement, battery, and software issues", icon: "https://images.unsplash.com/photo-1512499617640-c74ae3a79d37?w=500&q=80", sortOrder: 3 },
      { category: "Repairs & Maintenance", name: "Digital Camera Services", subtitle: "DSLR and digital camera servicing", icon: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=500&q=80", sortOrder: 4 },
      { category: "Repairs & Maintenance", name: "Hardware & Painting", subtitle: "Interior/exterior painting and hardware fixes", icon: "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=500&q=80", sortOrder: 5 },
      { category: "Repairs & Maintenance", name: "Welding", subtitle: "Professional metal welding and fabrication", icon: "https://images.unsplash.com/photo-1504917595217-d4bffc269b04?w=500&q=80", sortOrder: 6 },

      // Professional & Property
      { category: "Professional & Property", name: "Architecture", subtitle: "Building design and architectural planning", icon: "https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=500&q=80", sortOrder: 1 },
      { category: "Professional & Property", name: "Interior Design", subtitle: "Home and office interior decoration", icon: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=500&q=80", sortOrder: 2 },
      { category: "Professional & Property", name: "Real Estate", subtitle: "Property buying, selling, and renting", icon: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=500&q=80", sortOrder: 3 },
      { category: "Professional & Property", name: "Tax & Audit (For All Types of Firms)", subtitle: "Financial auditing and tax filing services", icon: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=500&q=80", sortOrder: 4 },
      { category: "Professional & Property", name: "Lawyers & Advocates", subtitle: "Legal consultation and documentation", icon: "https://images.unsplash.com/photo-1589829085413-56de8ae18c73?w=500&q=80", sortOrder: 5 },

      // Transport & Logistics
      { category: "Transport & Logistics", name: "Vehicle Service (2 & 4 Wheeler)", subtitle: "Car and bike servicing and repair", icon: "https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?w=500&q=80", sortOrder: 1 },
      { category: "Transport & Logistics", name: "Earth Movers (JCB / Cranes)", subtitle: "Heavy machinery rental and operation", icon: "https://images.unsplash.com/photo-1572005080922-38379430c5e7?w=500&q=80", sortOrder: 2 },
      { category: "Transport & Logistics", name: "Packers & Movers", subtitle: "Safe relocation of household and office goods", icon: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&q=80", sortOrder: 3 },
      { category: "Transport & Logistics", name: "Driving School", subtitle: "Professional driving lessons for 2 & 4 wheelers", icon: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=500&q=80", sortOrder: 4 },

      // Events, Travel & Lifestyle
      { category: "Events, Travel & Lifestyle", name: "Travel & Tourism", subtitle: "Tour packages, bookings, and guides", icon: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=500&q=80", sortOrder: 1 },
      { category: "Events, Travel & Lifestyle", name: "Hotels, Homestay, Lodge, Restaurant & Resorts", subtitle: "Accommodation and dining bookings", icon: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500&q=80", sortOrder: 2 },
      { category: "Events, Travel & Lifestyle", name: "Event Management (Auditorium Services)", subtitle: "Planning for weddings, corporate events, and parties", icon: "https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=500&q=80", sortOrder: 3 },
      { category: "Events, Travel & Lifestyle", name: "Catering Services", subtitle: "Food and catering for small to large events", icon: "https://images.unsplash.com/photo-1555244162-803834f70033?w=500&q=80", sortOrder: 4 },
      { category: "Events, Travel & Lifestyle", name: "Astrology Services", subtitle: "Horoscope, vastu, and astrological consultation", icon: "https://images.unsplash.com/photo-1532012197267-da84d127e765?w=500&q=80", sortOrder: 5 },

      // Specialized Services
      { category: "Specialized Services", name: "Agriculture Product Services", subtitle: "Farming equipment repair and maintenance", icon: "https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=500&q=80", sortOrder: 1 },
      { category: "Specialized Services", name: "Pest Controlling System", subtitle: "Termite, rodent, and general pest control", icon: "https://images.unsplash.com/photo-1618641986557-1dece00f14e9?w=500&q=80", sortOrder: 2 },
      { category: "Specialized Services", name: "Loans & All types of insurance", subtitle: "Financial consultation and policy assistance", icon: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=500&q=80", sortOrder: 3 },
      { category: "Specialized Services", name: "Education", subtitle: "Tuition, coaching, and educational consulting", icon: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=500&q=80", sortOrder: 4 },
      { category: "Specialized Services", name: "Health", subtitle: "Home nursing, physiotherapy, and wellness", icon: "https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=500&q=80", sortOrder: 5 },
    ];

    console.log("Inserting services...");
    for (const service of servicesData) {
      const categoryId = categoryMap.get(service.category);
      if (!categoryId) {
        console.warn(`Category not found for ${service.name}`);
        continue;
      }

      const existingService = await db.select().from(services).where(eq(services.name, service.name));
      if (existingService.length > 0) {
        await db.update(services)
            .set({
                categoryId,
                subtitle: service.subtitle,
                icon: service.icon,
                bannerImage: service.icon,
                sortOrder: service.sortOrder
            })
            .where(eq(services.id, existingService[0].id));
      } else {
        await db.insert(services).values({
          categoryId,
          name: service.name,
          subtitle: service.subtitle,
          icon: service.icon,
          bannerImage: service.icon,
          status: 'ACTIVE',
          isHomeVisible: true,
          sortOrder: service.sortOrder,
          isActive: true
        });
      }
    }

    console.log("Extended catalog seeded successfully!");
  } catch (error) {
    console.error("Error seeding extended catalog:", error);
  }
}

seedExtendedCatalog().then(() => process.exit(0)).catch(() => process.exit(1));
