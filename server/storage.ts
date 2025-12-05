import {
  users,
  adminUsers,
  serviceRequests,
  productOrders,
  products,
  cartItems,
  invoices,
  otpVerifications,
  serviceProviders,
  walletTransactions,
  serviceablePincodes,
  type User,
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
  type ServiceRequest,
  type InsertServiceRequest,
  type ProductOrder,
  type InsertProductOrder,
  type Product,
  type InsertProduct,
  type CartItem,
  type InsertCartItem,
  type Invoice,
  type InsertInvoice,
  type OtpVerification,
  type InsertOtpVerification,
  type ServiceProvider,
  type InsertServiceProvider,
  type WalletTransaction,
  type InsertWalletTransaction,
  type ServiceablePincode,
  type InsertServiceablePincode,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, count, sum, gte, lte, or, ilike } from "drizzle-orm";

// Haversine formula for calculating distance between two points
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in meters
}

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  // Admin management
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminByUsername(username: string): Promise<AdminUser | undefined>;
  getAdminByEmail(email: string): Promise<AdminUser | undefined>;
  createAdminUser(admin: InsertAdminUser): Promise<AdminUser>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined>;

  // Service Providers
  createServiceProvider(provider: InsertServiceProvider): Promise<ServiceProvider>;
  getServiceProvider(id: number): Promise<ServiceProvider | undefined>;
  getServiceProviderByUserId(userId: number): Promise<ServiceProvider | undefined>;
  getServiceProviderByPartnerId(partnerId: string): Promise<ServiceProvider | undefined>;
  getAllServiceProviders(): Promise<ServiceProvider[]>;
  getVerifiedServiceProviders(): Promise<ServiceProvider[]>;
  getPendingServiceProviders(): Promise<ServiceProvider[]>;
  updateServiceProvider(id: number, updates: Partial<ServiceProvider>): Promise<ServiceProvider | undefined>;
  updateProviderLocation(id: number, lat: number, long: number): Promise<ServiceProvider | undefined>;
  getProvidersSortedByDistance(lat: number, long: number, status?: string): Promise<(ServiceProvider & { distance: number })[]>;
  deleteServiceProvider(id: number): Promise<boolean>;

  // Service requests
  createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest>;
  getServiceRequest(id: number): Promise<ServiceRequest | undefined>;
  getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined>;
  getUserServiceRequests(userId: number): Promise<ServiceRequest[]>;
  getProviderServiceRequests(providerId: number): Promise<ServiceRequest[]>;
  updateServiceRequest(id: number, updates: Partial<ServiceRequest>): Promise<ServiceRequest | undefined>;
  updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined>;
  assignProviderToService(serviceRequestId: number, providerId: number): Promise<ServiceRequest | undefined>;
  getPendingAssignments(): Promise<ServiceRequest[]>;
  getAllServiceRequests(): Promise<ServiceRequest[]>;

  // Wallet Transactions (ACID)
  completeServiceWithTransaction(
    serviceRequestId: number,
    totalAmount: number,
    commissionRate: number
  ): Promise<{ service: ServiceRequest; transaction: WalletTransaction }>;
  topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction>;
  getProviderWalletTransactions(providerId: number): Promise<WalletTransaction[]>;

  // Product orders
  createProductOrder(order: InsertProductOrder): Promise<ProductOrder>;
  getProductOrder(id: number): Promise<ProductOrder | undefined>;
  getUserProductOrders(userId: number): Promise<ProductOrder[]>;
  updateProductOrderStatus(id: number, status: string): Promise<ProductOrder | undefined>;
  getAllProductOrders(): Promise<ProductOrder[]>;

  // Products
  createProduct(product: InsertProduct): Promise<Product>;
  getProduct(id: number): Promise<Product | undefined>;
  getAllProducts(): Promise<Product[]>;
  getProductsByCategory(category: string): Promise<Product[]>;
  updateProductStock(id: number, stock: number): Promise<Product | undefined>;

  // Cart management
  addToCart(item: InsertCartItem): Promise<CartItem>;
  getCartItems(userId: number): Promise<CartItem[]>;
  updateCartItemQuantity(id: number, quantity: number): Promise<CartItem | undefined>;
  removeFromCart(id: number): Promise<boolean>;
  clearCart(userId: number): Promise<boolean>;

  // Invoices
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByInvoiceId(invoiceId: string): Promise<Invoice | undefined>;
  getUserInvoices(userId: number): Promise<Invoice[]>;
  getAllInvoices(): Promise<Invoice[]>;

  // OTP verification
  createOtpVerification(otp: InsertOtpVerification): Promise<OtpVerification>;
  verifyOtp(phone: string | undefined, email: string | undefined, otp: string, purpose: string): Promise<boolean>;

  // Serviceable Pincodes
  createServiceablePincode(pincode: InsertServiceablePincode): Promise<ServiceablePincode>;
  getServiceablePincode(pincode: string): Promise<ServiceablePincode | undefined>;
  getAllServiceablePincodes(): Promise<ServiceablePincode[]>;
  togglePincodeStatus(pincode: string): Promise<ServiceablePincode | undefined>;
  isPincodeServiceable(pincode: string): Promise<boolean>;

  // Statistics for admin dashboard (optimized SQL aggregations)
  getAdminStats(): Promise<{
    totalUsers: number;
    totalProviders: number;
    activeServices: number;
    completedServices: number;
    totalOrders: number;
    totalRevenue: number;
    pendingApprovals: number;
  }>;
  getRevenueByPeriod(days: number): Promise<{ date: string; revenue: number }[]>;
  getRecentServices(limit: number): Promise<ServiceRequest[]>;
  getRecentOrders(limit: number): Promise<ProductOrder[]>;
}

export class DatabaseStorage implements IStorage {
  
  // User management
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, code));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const referralCode = `UF${Date.now().toString(36).toUpperCase()}`;
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, referralCode })
      .returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  // Admin management
  async getAdminUser(id: number): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id));
    return admin || undefined;
  }

  async getAdminByUsername(username: string): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    return admin || undefined;
  }

  async getAdminByEmail(email: string): Promise<AdminUser | undefined> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    return admin || undefined;
  }

  async createAdminUser(insertAdmin: InsertAdminUser): Promise<AdminUser> {
    const [admin] = await db
      .insert(adminUsers)
      .values(insertAdmin)
      .returning();
    return admin;
  }

  async updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined> {
    const [admin] = await db
      .update(adminUsers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(adminUsers.id, id))
      .returning();
    return admin || undefined;
  }

  // Service Providers
  async createServiceProvider(insertProvider: InsertServiceProvider): Promise<ServiceProvider> {
    const countResult = await db.select({ count: count() }).from(serviceProviders);
    const partnerId = `SP${String((countResult[0]?.count || 0) + 1).padStart(5, '0')}`;
    
    const [provider] = await db
      .insert(serviceProviders)
      .values({ ...insertProvider, partnerId })
      .returning();
    return provider;
  }

  async getServiceProvider(id: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    return provider || undefined;
  }

  async getServiceProviderByUserId(userId: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.userId, userId));
    return provider || undefined;
  }

  async getServiceProviderByPartnerId(partnerId: string): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.partnerId, partnerId));
    return provider || undefined;
  }

  async getAllServiceProviders(): Promise<ServiceProvider[]> {
    return await db.select().from(serviceProviders).orderBy(desc(serviceProviders.createdAt));
  }

  async getVerifiedServiceProviders(): Promise<ServiceProvider[]> {
    return await db
      .select()
      .from(serviceProviders)
      .where(eq(serviceProviders.verificationStatus, 'verified'))
      .orderBy(desc(serviceProviders.createdAt));
  }

  async getPendingServiceProviders(): Promise<ServiceProvider[]> {
    return await db
      .select()
      .from(serviceProviders)
      .where(eq(serviceProviders.verificationStatus, 'pending'))
      .orderBy(desc(serviceProviders.createdAt));
  }

  async updateServiceProvider(id: number, updates: Partial<ServiceProvider>): Promise<ServiceProvider | undefined> {
    const [provider] = await db
      .update(serviceProviders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(serviceProviders.id, id))
      .returning();
    return provider || undefined;
  }

  async updateProviderLocation(id: number, lat: number, long: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db
      .update(serviceProviders)
      .set({ 
        currentLat: lat, 
        currentLong: long, 
        lastLocationUpdate: new Date() 
      })
      .where(eq(serviceProviders.id, id))
      .returning();
    return provider || undefined;
  }

  // Geo-spatial sorting using Haversine formula
  async getProvidersSortedByDistance(
    lat: number, 
    long: number, 
    status?: string
  ): Promise<(ServiceProvider & { distance: number })[]> {
    const providers = await db
      .select()
      .from(serviceProviders)
      .where(
        and(
          eq(serviceProviders.isActive, true),
          status ? eq(serviceProviders.verificationStatus, status as any) : undefined
        )
      );

    // Calculate distance for each provider and sort
    const providersWithDistance = providers
      .filter(p => p.currentLat !== null && p.currentLong !== null)
      .map(provider => ({
        ...provider,
        distance: calculateHaversineDistance(
          lat,
          long,
          provider.currentLat!,
          provider.currentLong!
        )
      }))
      .sort((a, b) => a.distance - b.distance);

    return providersWithDistance;
  }

  async deleteServiceProvider(id: number): Promise<boolean> {
    const result = await db.delete(serviceProviders).where(eq(serviceProviders.id, id));
    return true;
  }

  // Service Requests
  async createServiceRequest(insertRequest: InsertServiceRequest): Promise<ServiceRequest> {
    const countResult = await db.select({ count: count() }).from(serviceRequests);
    const serviceId = `SR${String((countResult[0]?.count || 0) + 1).padStart(6, '0')}`;
    const handshakeOtp = Math.floor(1000 + Math.random() * 9000).toString();
    
    const [request] = await db
      .insert(serviceRequests)
      .values({ ...insertRequest, serviceId, handshakeOtp })
      .returning();
    return request;
  }

  async getServiceRequest(id: number): Promise<ServiceRequest | undefined> {
    const [request] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id));
    return request || undefined;
  }

  async getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined> {
    const [request] = await db.select().from(serviceRequests).where(eq(serviceRequests.serviceId, serviceId));
    return request || undefined;
  }

  async getUserServiceRequests(userId: number): Promise<ServiceRequest[]> {
    return await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.userId, userId))
      .orderBy(desc(serviceRequests.createdAt));
  }

  async getProviderServiceRequests(providerId: number): Promise<ServiceRequest[]> {
    return await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.providerId, providerId))
      .orderBy(desc(serviceRequests.createdAt));
  }

  async updateServiceRequest(id: number, updates: Partial<ServiceRequest>): Promise<ServiceRequest | undefined> {
    const [request] = await db
      .update(serviceRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(serviceRequests.id, id))
      .returning();
    return request || undefined;
  }

  async updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined> {
    const [request] = await db
      .update(serviceRequests)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(serviceRequests.id, id))
      .returning();
    return request || undefined;
  }

  async assignProviderToService(serviceRequestId: number, providerId: number): Promise<ServiceRequest | undefined> {
    const [request] = await db
      .update(serviceRequests)
      .set({ 
        providerId, 
        status: 'partner_assigned',
        assignedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(serviceRequests.id, serviceRequestId))
      .returning();
    return request || undefined;
  }

  async getPendingAssignments(): Promise<ServiceRequest[]> {
    return await db
      .select()
      .from(serviceRequests)
      .where(
        or(
          eq(serviceRequests.status, 'placed'),
          eq(serviceRequests.status, 'confirmed')
        )
      )
      .orderBy(desc(serviceRequests.createdAt));
  }

  async getAllServiceRequests(): Promise<ServiceRequest[]> {
    return await db.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt));
  }

  // Wallet Transactions with ACID compliance
  async completeServiceWithTransaction(
    serviceRequestId: number,
    totalAmount: number,
    commissionRate: number = 0.10
  ): Promise<{ service: ServiceRequest; transaction: WalletTransaction }> {
    const commissionAmount = Math.round(totalAmount * commissionRate);

    // Use database transaction for ACID compliance
    const result = await db.transaction(async (tx) => {
      // 1. Get the service request
      const [service] = await tx
        .select()
        .from(serviceRequests)
        .where(eq(serviceRequests.id, serviceRequestId));
      
      if (!service || !service.providerId) {
        throw new Error('Service request or provider not found');
      }

      // 2. Get the provider
      const [provider] = await tx
        .select()
        .from(serviceProviders)
        .where(eq(serviceProviders.id, service.providerId));

      if (!provider) {
        throw new Error('Provider not found');
      }

      const currentBalance = parseFloat(provider.walletBalance || '0');
      const newBalance = currentBalance - commissionAmount;

      // 3. Update service request status
      const [updatedService] = await tx
        .update(serviceRequests)
        .set({
          status: 'service_completed',
          totalAmount,
          commissionAmount,
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(serviceRequests.id, serviceRequestId))
        .returning();

      // 4. Deduct commission from provider wallet
      await tx
        .update(serviceProviders)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(serviceProviders.id, service.providerId));

      // 5. Create wallet transaction record
      const [transaction] = await tx
        .insert(walletTransactions)
        .values({
          providerId: service.providerId,
          serviceRequestId,
          amount: (-commissionAmount).toFixed(2),
          type: 'commission',
          description: `Commission for service ${service.serviceId}`,
          balanceBefore: currentBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2)
        })
        .returning();

      return { service: updatedService, transaction };
    });

    return result;
  }

  async topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
      const [provider] = await tx
        .select()
        .from(serviceProviders)
        .where(eq(serviceProviders.id, providerId));

      if (!provider) {
        throw new Error('Provider not found');
      }

      const currentBalance = parseFloat(provider.walletBalance || '0');
      const newBalance = currentBalance + amount;

      await tx
        .update(serviceProviders)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(serviceProviders.id, providerId));

      const [transaction] = await tx
        .insert(walletTransactions)
        .values({
          providerId,
          amount: amount.toFixed(2),
          type: 'topup',
          description,
          balanceBefore: currentBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2)
        })
        .returning();

      return transaction;
    });

    return result;
  }

  async getProviderWalletTransactions(providerId: number): Promise<WalletTransaction[]> {
    return await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.providerId, providerId))
      .orderBy(desc(walletTransactions.createdAt));
  }

  // Product Orders
  async createProductOrder(insertOrder: InsertProductOrder): Promise<ProductOrder> {
    const countResult = await db.select({ count: count() }).from(productOrders);
    const orderId = `ORD${String((countResult[0]?.count || 0) + 1).padStart(6, '0')}`;
    
    const [order] = await db
      .insert(productOrders)
      .values({ ...insertOrder, orderId })
      .returning();
    return order;
  }

  async getProductOrder(id: number): Promise<ProductOrder | undefined> {
    const [order] = await db.select().from(productOrders).where(eq(productOrders.id, id));
    return order || undefined;
  }

  async getUserProductOrders(userId: number): Promise<ProductOrder[]> {
    return await db
      .select()
      .from(productOrders)
      .where(eq(productOrders.userId, userId))
      .orderBy(desc(productOrders.createdAt));
  }

  async updateProductOrderStatus(id: number, status: string): Promise<ProductOrder | undefined> {
    const [order] = await db
      .update(productOrders)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(productOrders.id, id))
      .returning();
    return order || undefined;
  }

  async getAllProductOrders(): Promise<ProductOrder[]> {
    return await db.select().from(productOrders).orderBy(desc(productOrders.createdAt));
  }

  // Products
  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db
      .insert(products)
      .values(insertProduct)
      .returning();
    return product;
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product || undefined;
  }

  async getAllProducts(): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.isActive, true));
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return await db
      .select()
      .from(products)
      .where(and(eq(products.category, category), eq(products.isActive, true)));
  }

  async updateProductStock(id: number, stock: number): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set({ stock })
      .where(eq(products.id, id))
      .returning();
    return product || undefined;
  }

  // Cart management
  async addToCart(item: InsertCartItem): Promise<CartItem> {
    // Check if item already exists in cart
    const [existing] = await db
      .select()
      .from(cartItems)
      .where(
        and(
          eq(cartItems.userId, item.userId),
          eq(cartItems.productId, item.productId)
        )
      );

    if (existing) {
      const [updated] = await db
        .update(cartItems)
        .set({ quantity: existing.quantity + (item.quantity || 1) })
        .where(eq(cartItems.id, existing.id))
        .returning();
      return updated;
    }

    const [cartItem] = await db.insert(cartItems).values(item).returning();
    return cartItem;
  }

  async getCartItems(userId: number): Promise<CartItem[]> {
    return await db.select().from(cartItems).where(eq(cartItems.userId, userId));
  }

  async updateCartItemQuantity(id: number, quantity: number): Promise<CartItem | undefined> {
    const [item] = await db
      .update(cartItems)
      .set({ quantity })
      .where(eq(cartItems.id, id))
      .returning();
    return item || undefined;
  }

  async removeFromCart(id: number): Promise<boolean> {
    await db.delete(cartItems).where(eq(cartItems.id, id));
    return true;
  }

  async clearCart(userId: number): Promise<boolean> {
    await db.delete(cartItems).where(eq(cartItems.userId, userId));
    return true;
  }

  // Invoices
  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const countResult = await db.select({ count: count() }).from(invoices);
    const invoiceId = `INV${String((countResult[0]?.count || 0) + 1).padStart(6, '0')}`;
    
    const [invoice] = await db
      .insert(invoices)
      .values({ ...insertInvoice, invoiceId })
      .returning();
    return invoice;
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoiceByInvoiceId(invoiceId: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.invoiceId, invoiceId));
    return invoice || undefined;
  }

  async getUserInvoices(userId: number): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, userId))
      .orderBy(desc(invoices.createdAt));
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  // OTP verification
  async createOtpVerification(otp: InsertOtpVerification): Promise<OtpVerification> {
    const [verification] = await db.insert(otpVerifications).values(otp).returning();
    return verification;
  }

  async verifyOtp(
    phone: string | undefined,
    email: string | undefined,
    otp: string,
    purpose: string
  ): Promise<boolean> {
    const [verification] = await db
      .select()
      .from(otpVerifications)
      .where(
        and(
          phone ? eq(otpVerifications.phone, phone) : eq(otpVerifications.email, email || ''),
          eq(otpVerifications.otp, otp),
          eq(otpVerifications.purpose, purpose),
          eq(otpVerifications.isVerified, false),
          gte(otpVerifications.expiresAt, new Date())
        )
      );

    if (verification) {
      await db
        .update(otpVerifications)
        .set({ isVerified: true })
        .where(eq(otpVerifications.id, verification.id));
      return true;
    }
    return false;
  }

  // Serviceable Pincodes
  async createServiceablePincode(pincode: InsertServiceablePincode): Promise<ServiceablePincode> {
    const [result] = await db
      .insert(serviceablePincodes)
      .values(pincode)
      .returning();
    return result;
  }

  async getServiceablePincode(pincode: string): Promise<ServiceablePincode | undefined> {
    const [result] = await db
      .select()
      .from(serviceablePincodes)
      .where(eq(serviceablePincodes.pincode, pincode));
    return result || undefined;
  }

  async getAllServiceablePincodes(): Promise<ServiceablePincode[]> {
    return await db.select().from(serviceablePincodes);
  }

  async togglePincodeStatus(pincode: string): Promise<ServiceablePincode | undefined> {
    const existing = await this.getServiceablePincode(pincode);
    if (!existing) return undefined;

    const [result] = await db
      .update(serviceablePincodes)
      .set({ isActive: !existing.isActive })
      .where(eq(serviceablePincodes.pincode, pincode))
      .returning();
    return result || undefined;
  }

  async isPincodeServiceable(pincode: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(serviceablePincodes)
      .where(
        and(
          eq(serviceablePincodes.pincode, pincode),
          eq(serviceablePincodes.isActive, true)
        )
      );
    return !!result;
  }

  // Admin Statistics (optimized SQL aggregations)
  async getAdminStats(): Promise<{
    totalUsers: number;
    totalProviders: number;
    activeServices: number;
    completedServices: number;
    totalOrders: number;
    totalRevenue: number;
    pendingApprovals: number;
  }> {
    const [userCount] = await db.select({ count: count() }).from(users);
    const [providerCount] = await db.select({ count: count() }).from(serviceProviders);
    
    const [activeServiceCount] = await db
      .select({ count: count() })
      .from(serviceRequests)
      .where(
        or(
          eq(serviceRequests.status, 'placed'),
          eq(serviceRequests.status, 'confirmed'),
          eq(serviceRequests.status, 'partner_assigned'),
          eq(serviceRequests.status, 'service_started')
        )
      );
    
    const [completedServiceCount] = await db
      .select({ count: count() })
      .from(serviceRequests)
      .where(eq(serviceRequests.status, 'service_completed'));

    const [orderCount] = await db.select({ count: count() }).from(productOrders);
    
    const [revenueResult] = await db
      .select({ total: sum(invoices.totalAmount) })
      .from(invoices);

    const [pendingCount] = await db
      .select({ count: count() })
      .from(serviceProviders)
      .where(eq(serviceProviders.verificationStatus, 'pending'));

    return {
      totalUsers: userCount?.count || 0,
      totalProviders: providerCount?.count || 0,
      activeServices: activeServiceCount?.count || 0,
      completedServices: completedServiceCount?.count || 0,
      totalOrders: orderCount?.count || 0,
      totalRevenue: Number(revenueResult?.total || 0),
      pendingApprovals: pendingCount?.count || 0
    };
  }

  async getRevenueByPeriod(days: number): Promise<{ date: string; revenue: number }[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await db
      .select({
        date: sql<string>`DATE(${invoices.createdAt})`,
        revenue: sum(invoices.totalAmount)
      })
      .from(invoices)
      .where(gte(invoices.createdAt, startDate))
      .groupBy(sql`DATE(${invoices.createdAt})`)
      .orderBy(sql`DATE(${invoices.createdAt})`);

    return results.map(r => ({
      date: r.date,
      revenue: Number(r.revenue || 0)
    }));
  }

  async getRecentServices(limit: number): Promise<ServiceRequest[]> {
    return await db
      .select()
      .from(serviceRequests)
      .orderBy(desc(serviceRequests.createdAt))
      .limit(limit);
  }

  async getRecentOrders(limit: number): Promise<ProductOrder[]> {
    return await db
      .select()
      .from(productOrders)
      .orderBy(desc(productOrders.createdAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
