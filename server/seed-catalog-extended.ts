import { db } from "./db";
import { serviceCategories, services } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seedExtendedCatalog() {
  console.log("Seeding extended services catalog...");

  try {
    // 1. Categories
    // Icons are Lucide icon names (kebab-case), rendered natively by the
    // mobile app — unique per category, unlike the stock photos they replace.
    const categoriesData = [
      { name: "IT & Security", icon: "shield-check", sortOrder: 1 },
      { name: "Appliances & Utilities", icon: "plug", sortOrder: 2 },
      { name: "Repairs & Maintenance", icon: "wrench", sortOrder: 3 },
      { name: "Professional & Property", icon: "briefcase", sortOrder: 4 },
      { name: "Transport & Logistics", icon: "truck", sortOrder: 5 },
      { name: "Events, Travel & Lifestyle", icon: "compass", sortOrder: 6 },
      { name: "Specialized Services", icon: "sparkles", sortOrder: 7 },
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
      { category: "IT & Security", name: "Computer & Printer", subtitle: "Repair & maintenance for PCs, laptops, and printers", icon: "printer", sortOrder: 1 },
      { category: "IT & Security", name: "CCTV Camera", subtitle: "Security camera installation and troubleshooting", icon: "cctv", sortOrder: 2 },
      { category: "IT & Security", name: "Biometric Device", subtitle: "Access control and attendance system setup", icon: "fingerprint-pattern", sortOrder: 3 },
      { category: "IT & Security", name: "Internet & Broadband Services (FTTH)", subtitle: "Fiber optic installation and router configuration", icon: "router", sortOrder: 4 },
      { category: "IT & Security", name: "DTH Services", subtitle: "Satellite TV dish installation and signal alignment", icon: "satellite-dish", sortOrder: 5 },

      // Appliances & Utilities
      { category: "Appliances & Utilities", name: "Home Appliances", subtitle: "Repairs for TV, fridge, washing machine, and more", icon: "washing-machine", sortOrder: 1 },
      { category: "Appliances & Utilities", name: "UPS & Batteries", subtitle: "Inverter and battery backup solutions", icon: "battery-charging", sortOrder: 2 },
      { category: "Appliances & Utilities", name: "Water Purifiers (Domestic & Commercial)", subtitle: "RO installation, filter change, and servicing", icon: "glass-water", sortOrder: 3 },
      { category: "Appliances & Utilities", name: "Solar & Heat Pumps", subtitle: "Solar panel and heat pump installation & repair", icon: "sun", sortOrder: 4 },
      { category: "Appliances & Utilities", name: "WTP & STP", subtitle: "Water & Sewage Treatment Plant maintenance", icon: "waves", sortOrder: 5 },
      { category: "Appliances & Utilities", name: "Generators, Water Pumps, Water Cutoff Sensors", subtitle: "Heavy utility and pump maintenance", icon: "plug-zap", sortOrder: 6 },

      // Repairs & Maintenance
      { category: "Repairs & Maintenance", name: "Household Repairs", subtitle: "General handyman services for home", icon: "hammer", sortOrder: 1 },
      { category: "Repairs & Maintenance", name: "Electrical & Plumbing", subtitle: "Wiring, fixtures, pipes, and leaks", icon: "zap", sortOrder: 2 },
      { category: "Repairs & Maintenance", name: "Mobile Repairs", subtitle: "Screen replacement, battery, and software issues", icon: "smartphone", sortOrder: 3 },
      { category: "Repairs & Maintenance", name: "Digital Camera Services", subtitle: "DSLR and digital camera servicing", icon: "camera", sortOrder: 4 },
      { category: "Repairs & Maintenance", name: "Hardware & Painting", subtitle: "Interior/exterior painting and hardware fixes", icon: "paint-roller", sortOrder: 5 },
      { category: "Repairs & Maintenance", name: "Welding", subtitle: "Professional metal welding and fabrication", icon: "flame", sortOrder: 6 },

      // Professional & Property
      { category: "Professional & Property", name: "Architecture", subtitle: "Building design and architectural planning", icon: "drafting-compass", sortOrder: 1 },
      { category: "Professional & Property", name: "Interior Design", subtitle: "Home and office interior decoration", icon: "sofa", sortOrder: 2 },
      { category: "Professional & Property", name: "Real Estate", subtitle: "Property buying, selling, and renting", icon: "building-2", sortOrder: 3 },
      { category: "Professional & Property", name: "Tax & Audit (For All Types of Firms)", subtitle: "Financial auditing and tax filing services", icon: "calculator", sortOrder: 4 },
      { category: "Professional & Property", name: "Lawyers & Advocates", subtitle: "Legal consultation and documentation", icon: "scale", sortOrder: 5 },

      // Transport & Logistics
      { category: "Transport & Logistics", name: "Vehicle Service (2 & 4 Wheeler)", subtitle: "Car and bike servicing and repair", icon: "car", sortOrder: 1 },
      { category: "Transport & Logistics", name: "Earth Movers (JCB / Cranes)", subtitle: "Heavy machinery rental and operation", icon: "forklift", sortOrder: 2 },
      { category: "Transport & Logistics", name: "Packers & Movers", subtitle: "Safe relocation of household and office goods", icon: "package", sortOrder: 3 },
      { category: "Transport & Logistics", name: "Driving School", subtitle: "Professional driving lessons for 2 & 4 wheelers", icon: "car-front", sortOrder: 4 },

      // Events, Travel & Lifestyle
      { category: "Events, Travel & Lifestyle", name: "Travel & Tourism", subtitle: "Tour packages, bookings, and guides", icon: "plane", sortOrder: 1 },
      { category: "Events, Travel & Lifestyle", name: "Hotels, Homestay, Lodge, Restaurant & Resorts", subtitle: "Accommodation and dining bookings", icon: "hotel", sortOrder: 2 },
      { category: "Events, Travel & Lifestyle", name: "Event Management (Auditorium Services)", subtitle: "Planning for weddings, corporate events, and parties", icon: "party-popper", sortOrder: 3 },
      { category: "Events, Travel & Lifestyle", name: "Catering Services", subtitle: "Food and catering for small to large events", icon: "chef-hat", sortOrder: 4 },
      { category: "Events, Travel & Lifestyle", name: "Astrology Services", subtitle: "Horoscope, vastu, and astrological consultation", icon: "moon-star", sortOrder: 5 },

      // Specialized Services
      { category: "Specialized Services", name: "Agriculture Product Services", subtitle: "Farming equipment repair and maintenance", icon: "tractor", sortOrder: 1 },
      { category: "Specialized Services", name: "Pest Controlling System", subtitle: "Termite, rodent, and general pest control", icon: "bug", sortOrder: 2 },
      { category: "Specialized Services", name: "Loans & All types of insurance", subtitle: "Financial consultation and policy assistance", icon: "hand-coins", sortOrder: 3 },
      { category: "Specialized Services", name: "Education", subtitle: "Tuition, coaching, and educational consulting", icon: "graduation-cap", sortOrder: 4 },
      { category: "Specialized Services", name: "Health", subtitle: "Home nursing, physiotherapy, and wellness", icon: "heart-pulse", sortOrder: 5 },
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
                // Icons are Lucide names now, not photos — clear the old
                // duplicated stock-photo banners so the app renders glyphs.
                bannerImage: null,
                sortOrder: service.sortOrder
            })
            .where(eq(services.id, existingService[0].id));
      } else {
        await db.insert(services).values({
          categoryId,
          name: service.name,
          subtitle: service.subtitle,
          icon: service.icon,
          bannerImage: null,
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
