import { db } from "./db";
import { 
  users, 
  adminUsers, 
  serviceProviders, 
  products, 
  serviceablePincodes,
  serviceRequests,
  productOrders
} from "@shared/schema";
import bcrypt from "bcrypt";

async function seed() {
  console.log("Seeding database...");

  try {
    // Create admin user
    const hashedAdminPassword = await bcrypt.hash("admin123", 10);
    await db.insert(adminUsers).values({
      username: "admin",
      email: "admin@unitefix.com",
      password: hashedAdminPassword,
      role: "admin",
      isActive: true,
    }).onConflictDoNothing();
    console.log("Admin user created");

    // Create sample users
    const hashedUserPassword = await bcrypt.hash("password123", 10);
    const userInserts = [
      {
        phone: "9876543210",
        email: "john@example.com",
        password: hashedUserPassword,
        username: "john_doe",
        role: "user" as const,
        homeAddress: "123 Main St, Sirsi",
        pinCode: "581301",
        isVerified: true,
        isActive: true,
      },
      {
        phone: "9876543211",
        email: "priya@example.com",
        password: hashedUserPassword,
        username: "priya_sharma",
        role: "user" as const,
        homeAddress: "456 Market Rd, Kumta",
        pinCode: "581343",
        isVerified: true,
        isActive: true,
      },
      {
        phone: "9876543212",
        email: "serviceman@unitefix.com",
        password: hashedUserPassword,
        username: "rajesh_serviceman",
        role: "serviceman" as const,
        homeAddress: "789 Service St, Karwar",
        pinCode: "581301",
        isVerified: true,
        isActive: true,
      },
    ];

    for (const user of userInserts) {
      await db.insert(users).values(user).onConflictDoNothing();
    }
    console.log("Sample users created");

    // Create service providers
    const providerInserts = [
      {
        userId: 3,
        partnerId: "SP00001",
        partnerName: "Rajesh Kumar",
        partnerType: "Individual",
        walletBalance: "5000.00",
        verificationStatus: "verified" as const,
        currentLat: 14.5892,
        currentLong: 74.6783,
        services: ["AC Repair", "Refrigerator"],
        location: "581301",
        address: "MG Road, Sirsi, Karnataka",
        isActive: true,
      },
      {
        userId: 3,
        partnerId: "SP00002",
        partnerName: "ServicePro Solutions",
        businessName: "ServicePro Solutions Pvt Ltd",
        partnerType: "Business",
        walletBalance: "15000.00",
        verificationStatus: "verified" as const,
        currentLat: 14.4264,
        currentLong: 74.4131,
        services: ["Laptop Repair", "Mobile Phone", "TV Repair"],
        location: "581343",
        address: "Market Road, Kumta, Karnataka",
        isActive: true,
      },
      {
        userId: 3,
        partnerId: "SP00003",
        partnerName: "TechFix Services",
        businessName: "TechFix Services",
        partnerType: "Business",
        walletBalance: "0.00",
        verificationStatus: "pending" as const,
        currentLat: 14.8015,
        currentLong: 74.1296,
        services: ["AC Repair", "Laptop Repair", "Washing Machine"],
        location: "581320",
        address: "Station Road, Karwar, Karnataka",
        isActive: true,
      },
    ];

    for (const provider of providerInserts) {
      await db.insert(serviceProviders).values(provider as any).onConflictDoNothing();
    }
    console.log("Service providers created");

    // Create products
    const productInserts = [
      { name: "Universal AC Remote", description: "Compatible with all major AC brands", price: 299, category: "AC", stock: 50, isActive: true },
      { name: "AC Gas Refill Kit", description: "R32 refrigerant gas cylinder", price: 1500, category: "AC", stock: 30, isActive: true },
      { name: "Laptop SSD 256GB", description: "High-speed solid state drive", price: 3500, category: "Laptop", stock: 40, isActive: true },
      { name: "Laptop Charger Universal", description: "Multi-voltage laptop adapter", price: 899, category: "Laptop", stock: 60, isActive: true },
      { name: "Water Heater Element", description: "1500W heating element", price: 650, category: "Water Heater", stock: 25, isActive: true },
      { name: "Thermostat Digital", description: "Digital thermostat for refrigerators", price: 850, category: "Refrigerator", stock: 35, isActive: true },
      { name: "Washing Machine Pump", description: "Drain pump motor replacement", price: 1200, category: "Washing Machine", stock: 20, isActive: true },
      { name: "TV LED Panel 32\"", description: "Replacement LED panel", price: 8500, category: "Television", stock: 10, isActive: true },
      { name: "Mobile Phone Battery", description: "Universal Li-ion battery", price: 450, category: "Mobile Phone", stock: 100, isActive: true },
      { name: "Microwave Magnetron", description: "Replacement magnetron tube", price: 2200, category: "Microwave", stock: 15, isActive: true },
    ];

    for (const product of productInserts) {
      await db.insert(products).values(product).onConflictDoNothing();
    }
    console.log("Products created");

    // Create serviceable pincodes
    const pincodeInserts = [
      { pincode: "581301", area: "Sirsi", district: "Uttara Kannada", state: "Karnataka", isActive: true },
      { pincode: "581302", area: "Sirsi Town", district: "Uttara Kannada", state: "Karnataka", isActive: true },
      { pincode: "581320", area: "Karwar", district: "Uttara Kannada", state: "Karnataka", isActive: true },
      { pincode: "581343", area: "Kumta", district: "Uttara Kannada", state: "Karnataka", isActive: true },
      { pincode: "581355", area: "Ankola", district: "Uttara Kannada", state: "Karnataka", isActive: true },
      { pincode: "581360", area: "Honnavar", district: "Uttara Kannada", state: "Karnataka", isActive: true },
    ];

    for (const pincode of pincodeInserts) {
      await db.insert(serviceablePincodes).values(pincode).onConflictDoNothing();
    }
    console.log("Serviceable pincodes created");

    // Create sample service requests
    const serviceInserts = [
      {
        serviceId: "SR000001",
        userId: 1,
        providerId: 1,
        serviceType: "AC Repair",
        brand: "LG",
        model: "LSA3AU3D",
        description: "AC not cooling properly",
        status: "service_completed" as const,
        handshakeOtp: "1234",
        bookingFee: 250,
        totalAmount: 2500,
        commissionAmount: 250,
        locationLat: 14.5892,
        locationLong: 74.6783,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        serviceId: "SR000002",
        userId: 1,
        providerId: 2,
        serviceType: "Laptop Repair",
        brand: "Dell",
        model: "Inspiron 15",
        description: "Screen flickering issue",
        status: "partner_assigned" as const,
        handshakeOtp: "5678",
        bookingFee: 250,
        locationLat: 14.5892,
        locationLong: 74.6783,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        serviceId: "SR000003",
        userId: 2,
        serviceType: "Washing Machine",
        brand: "Samsung",
        model: "WA70H4200SW",
        description: "Not draining water properly",
        status: "placed" as const,
        handshakeOtp: "9012",
        bookingFee: 250,
        locationLat: 14.4264,
        locationLong: 74.4131,
        address: "456 Market Rd, Kumta, Karnataka",
      },
    ];

    for (const service of serviceInserts) {
      await db.insert(serviceRequests).values(service as any).onConflictDoNothing();
    }
    console.log("Service requests created");

    // Create sample product orders
    const orderInserts = [
      {
        orderId: "ORD000001",
        userId: 1,
        products: [
          { productId: 1, name: "Universal AC Remote", quantity: 2, price: 299 },
          { productId: 6, name: "Thermostat Digital", quantity: 1, price: 850 }
        ],
        status: "delivered" as const,
        totalAmount: 1448,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        orderId: "ORD000002",
        userId: 2,
        products: [
          { productId: 3, name: "Laptop SSD 256GB", quantity: 1, price: 3500 }
        ],
        status: "in_transit" as const,
        totalAmount: 3500,
        address: "456 Market Rd, Kumta, Karnataka",
      },
    ];

    for (const order of orderInserts) {
      await db.insert(productOrders).values(order as any).onConflictDoNothing();
    }
    console.log("Product orders created");

    console.log("Database seeding completed!");
  } catch (error) {
    console.error("Seeding error:", error);
    throw error;
  }
}

seed().then(() => process.exit(0)).catch(() => process.exit(1));
