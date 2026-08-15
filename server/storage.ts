import {
  users,
  adminUsers,
  serviceRequests,
  productOrders,
  products,
  cartItems,
  invoices,
  otpVerifications,
  // serviceProviders, // PHASE 1: DELETED — merged into employees
  walletTransactions,
  serviceablePincodes,
  districts,
  // PHASE 2: New tables
  platformConfig,
  auditLogs,
  // PHASE 3: Wallet and Inventory
  partnerWallets,
  walletTransactionsV2,
  inventoryItems,
  inventoryTransactions,
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
  // type ServiceProvider, // PHASE 1: DELETED
  // type InsertServiceProvider, // PHASE 1: DELETED
  type WalletTransaction,
  type InsertWalletTransaction,
  type ServiceablePincode,
  type District,
  type InsertDistrict,
  type InsertServiceablePincode,
  // PHASE 2: New types
  type PlatformConfig,
  type InsertPlatformConfig,
  type AuditLog,
  type InsertAuditLog,
  // PHASE  3: Wallet and Inventory types
  type PartnerWallet,
  type WalletTransactionV2,
  type InsertWalletTransactionV2,
  type InventoryItem,
  type InsertInventoryItem,
  type InventoryTransaction,
  type InsertInventoryTransaction,
  // PHASE 12: Segregated Tables
  type Customer,
  type InsertCustomer,
  type Employee,
  type InsertEmployee,
  customers,
  employees,
  serviceCategories,
  services,
  type ServiceCategory,
  type ServiceItem,
  type InsertServiceCategory,
  type InsertServiceItem,
} from "@shared/schema";
import {
  InsertServiceOtp,
  ServiceOtp,
  ratings,
  InsertRating,
  Rating,
  socialAuthProviders,
  deviceTokens,
  notifications,
  InsertSocialAuth,
  SocialAuthProvider,
  InsertDeviceToken,
  DeviceToken,
  InsertNotification,
  Notification
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, count, sum, gte, lte, or, ilike, gt, inArray, ne, isNull } from "drizzle-orm";
import logger from "./lib/logger";
import crypto from "crypto";
// PHASE 2: State machine imports
import { BookingState, validateStateTransition, shouldTriggerWalletCredit, requiresOtpValidation, requiresPaymentVerification } from "./business/booking-state-machine";
import { normalizeState, canonicalToLegacy, legacyToCanonical } from "./business/state-mapping";
// PHASE 3: Config service for business values
import { configService } from "./services/config.service";

// Geo utilities: single source of truth
import { calculateHaversineDistance } from "./lib/geo";
import { nextSequentialNumber } from "./lib/sequential-id";

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  getAllUsers(limit?: number, offset?: number, roleFilter?: string): Promise<User[]>;
  countUsers(filters?: { role?: string; search?: string }): Promise<number>;
  getUsers(filters?: { role?: string; search?: string }, limit?: number, offset?: number): Promise<User[]>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;

  // Admin management
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminByUsername(username: string): Promise<AdminUser | undefined>;
  getAdminByEmail(email: string): Promise<AdminUser | undefined>;
  createAdminUser(admin: InsertAdminUser): Promise<AdminUser>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined>;

  // Customer Management
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  getCustomerByUserId(userId: number): Promise<Customer | undefined>;
  updateCustomer(userId: number, updates: Partial<Customer>): Promise<Customer | undefined>;

  // Employee Management
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  getEmployeeByUserId(userId: number): Promise<Employee | undefined>;
  updateEmployee(userId: number, updates: Partial<Employee>): Promise<Employee | undefined>;

  // Service Providers → PHASE 1: All methods now delegate to employees table
  createServiceProvider(provider: any): Promise<Employee>;
  getServiceProvider(id: number): Promise<Employee | undefined>;
  getServiceProviderByUserId(userId: number): Promise<Employee | undefined>;
  getServiceProviderByPartnerId(partnerId: string): Promise<Employee | undefined>;
  getAllServiceProviders(limit?: number, offset?: number): Promise<Employee[]>;
  getVerifiedServiceProviders(limit?: number, offset?: number): Promise<Employee[]>;
  getPendingServiceProviders(limit?: number, offset?: number): Promise<Employee[]>;
  countServiceProviders(status?: string): Promise<number>;
  updateServiceProvider(id: number, updates: Partial<Employee>): Promise<Employee | undefined>;
  updateProviderLocation(id: number, lat: number, long: number): Promise<Employee | undefined>;
  getProvidersSortedByDistance(lat: number, long: number, status?: string): Promise<(Employee & { distance: number })[]>;
  deleteServiceProvider(id: number): Promise<boolean>;

  // Service requests
  createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest>;
  getServiceRequest(id: number): Promise<ServiceRequest | undefined>;
  getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined>;
  getUserServiceRequests(userId: number): Promise<ServiceRequest[]>;
  getProviderServiceRequests(providerId: number): Promise<any[]>;
  getUserServiceRequestsPaginated(userId: number, statusFilter?: 'active' | 'past' | 'all', page?: number, limit?: number): Promise<{ data: any[]; total: number }>;
  getProviderServiceRequestsPaginated(providerId: number, statusFilter?: 'active' | 'past' | 'all', page?: number, limit?: number): Promise<{ data: any[]; total: number }>;
  updateServiceRequest(id: number, updates: Partial<ServiceRequest>): Promise<ServiceRequest | undefined>;
  updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined>;
  assignProviderToService(serviceRequestId: number, providerId: number): Promise<ServiceRequest | undefined>;
  getPendingAssignments(): Promise<ServiceRequest[]>;
  getAllServiceRequests(): Promise<ServiceRequest[]>;

  // Service Catalog
  getHomeVisibleServices(): Promise<ServiceItem[]>;
  getAllServiceCategoriesWithServices(): Promise<(ServiceCategory & { items: ServiceItem[] })[]>;
  getAdminServiceCatalog(): Promise<(ServiceCategory & { items: ServiceItem[] })[]>;
  createServiceCategory(category: InsertServiceCategory): Promise<ServiceCategory>;
  updateServiceCategory(id: number, updates: Partial<ServiceCategory>): Promise<ServiceCategory | undefined>;
  deleteServiceCategory(id: number): Promise<boolean>;
  createService(service: InsertServiceItem): Promise<ServiceItem>;
  updateService(id: number, updates: Partial<ServiceItem>): Promise<ServiceItem | undefined>;
  deleteService(id: number): Promise<boolean>;

  // Wallet Transactions (ACID)
  completeServiceWithTransaction(
    serviceRequestId: number,
    totalAmount: number,
    commissionRate: number
  ): Promise<{ service: ServiceRequest; transaction: WalletTransaction }>;
  creditProviderWalletForOnlinePayment(
    serviceRequestId: number
  ): Promise<{ transaction: WalletTransaction | null }>;
  topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction>;
  deductProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction>;
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
  getAdminProducts(): Promise<Product[]>; // For admin inventory
  getProductsByCategory(category: string): Promise<Product[]>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  updateProductStock(id: number, stock: number): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;

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

  // Districts
  getAllDistricts(): Promise<District[]>;
  createDistrict(district: InsertDistrict): Promise<District>;
  toggleDistrictStatus(id: number, isActive: boolean): Promise<District | undefined>;
  deleteDistrict(id: number): Promise<void>;

  // Serviceable Pincodes
  createServiceablePincode(pincode: InsertServiceablePincode): Promise<ServiceablePincode>;
  getServiceablePincode(pincode: string): Promise<ServiceablePincode | undefined>;
  getAllServiceablePincodes(): Promise<ServiceablePincode[]>;
  togglePincodeStatus(pincode: string): Promise<ServiceablePincode | undefined>;
  updateServiceablePincode(originalPincode: string, data: Partial<InsertServiceablePincode>): Promise<ServiceablePincode | undefined>;
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

  // PHASE 2: Platform Configuration
  getPlatformConfig(key: string): Promise<PlatformConfig | undefined>;
  getPlatformConfigByCategory(category: string): Promise<PlatformConfig[]>;
  getAllPlatformConfigs(): Promise<PlatformConfig[]>;
  updatePlatformConfig(key: string, value: string, updatedBy: number): Promise<void>;
  seedDefaultConfig(): Promise<void>;

  // PHASE 2: Audit Logging
  logAuditEvent(event: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(entityType: string, entityId: number): Promise<AuditLog[]>;

  // PHASE 2: Centralized State Transitions (CRITICAL)
  transitionBookingState(
    serviceRequestId: number,
    newState: BookingState,
    changedBy: number,
    metadata?: any
  ): Promise<ServiceRequest>;

  // PHASE 3: Wallet Management
  getOrCreatePartnerWallet(partnerId: number, tx?: any): Promise<PartnerWallet>;
  creditWalletOnHold(
    partnerId: number,
    serviceRequestId: number,
    amount: number,
    releaseDate: Date,
    tx?: any
  ): Promise<WalletTransactionV2>;
  releaseHeldBalance(transactionId: number): Promise<void>;
  releaseAllExpiredHolds(): Promise<number>;

  // PHASE 3: Inventory Management
  getInventoryItemByCode(itemCode: string): Promise<InventoryItem | undefined>;
  deductInventoryForBooking(
    serviceRequestId: number,
    items: Array<{ itemCode: string; quantity: number }>,
    performedBy: number,
    tx?: any
  ): Promise<InventoryTransaction[]>;

  // PHASE 9: Social Auth
  findSocialProvider(provider: string, providerId: string): Promise<SocialAuthProvider | undefined>;
  linkSocialProvider(data: InsertSocialAuth): Promise<SocialAuthProvider>;

  // PHASE 9: Notifications
  addDeviceToken(userId: number, token: string, platform: string): Promise<DeviceToken>;
  removeDeviceToken(userId: number, token: string): Promise<void>;
  createNotification(data: InsertNotification): Promise<Notification>;
  createNotifications(rows: InsertNotification[]): Promise<number>;
  getUserNotifications(userId: number, page?: number, limit?: number): Promise<{ notifications: Notification[], total: number }>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  markNotificationRead(id: number, userId: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;
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

  async getAllUsers(limit: number = 100, offset: number = 0, roleFilter?: string): Promise<User[]> {
    let query = db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);
    if (roleFilter) {
      query = query.where(eq(users.role, roleFilter as any)) as any;
    }
    return await query;
  }

  async countUsers(filters?: { role?: string; search?: string }): Promise<number> {
    const conditions = [];
    if (filters?.role) {
      conditions.push(eq(users.role, filters.role as any));
    }
    if (filters?.search) {
      conditions.push(
        or(
          ilike(users.username, `%${filters.search}%`),
          ilike(users.email, `%${filters.search}%`),
          ilike(users.phone, `%${filters.search}%`)
        )
      );
    }
    let query = db.select({ count: count() }).from(users);
    if (conditions.length > 0) {
      const condition = conditions.length === 1 ? conditions[0]! : and(...conditions);
      if (condition) query = query.where(condition) as any;
    }
    const [result] = await query;
    return result?.count ?? 0;
  }

  async getUsers(filters?: { role?: string; search?: string; status?: string }, limit: number = 100, offset: number = 0): Promise<User[]> {
    let query = db.select().from(users);
    const conditions = [];

    if (filters?.role) {
      conditions.push(eq(users.role, filters.role as any));
    }

    if (filters?.search) {
      conditions.push(
        or(
          ilike(users.username, `%${filters.search}%`),
          ilike(users.email, `%${filters.search}%`),
          ilike(users.phone, `%${filters.search}%`)
        )
      );
    }

    if (filters?.status === 'active') {
      conditions.push(eq(users.isActive, true));
    } else if (filters?.status === 'deactivated') {
      conditions.push(eq(users.isActive, false));
    }

    if (conditions.length > 0) {
      const condition = conditions.length === 1 ? conditions[0]! : and(...conditions);
      if (condition) query = query.where(condition) as any;
    }

    return await (query as any).orderBy(desc(users.id)).limit(limit).offset(offset);
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

  // Customer Management
  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const [customer] = await db
      .insert(customers)
      .values(insertCustomer)
      .returning();
    return customer;
  }

  async getCustomerByUserId(userId: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.userId, userId));
    return customer || undefined;
  }

  async updateCustomer(userId: number, updates: Partial<Customer>): Promise<Customer | undefined> {
    const [customer] = await db
      .update(customers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(customers.userId, userId))
      .returning();
    return customer || undefined;
  }

  // Employee Management
  async createEmployee(insertEmployee: InsertEmployee): Promise<Employee> {
    const [employee] = await db
      .insert(employees)
      .values(insertEmployee)
      .returning();
    return employee;
  }

  async getEmployeeByUserId(userId: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.userId, userId));
    return employee || undefined;
  }

  async updateEmployee(userId: number, updates: Partial<Employee>): Promise<Employee | undefined> {
    const [employee] = await db
      .update(employees)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(employees.userId, userId))
      .returning();
    return employee || undefined;
  }

  // Service Providers → PHASE 1: All methods now use employees table
  async createServiceProvider(insertProvider: any): Promise<Employee> {
    let next = await nextSequentialNumber('employees', 'partner_id', 'SP');

    for (let attempt = 0; attempt < 6; attempt++) {
      const partnerId = `SP${String(next).padStart(5, '0')}`;
      try {
        const [employee] = await db
          .insert(employees)
          .values({ ...insertProvider, partnerId, skills: insertProvider.skills || null } as any)
          .returning();
        return employee;
      } catch (err: any) {
        if (err?.code === '23505') { next++; continue; }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique partner id after several attempts');
  }

  async getServiceProvider(id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee || undefined;
  }

  async getServiceProviderByUserId(userId: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.userId, userId));
    return employee || undefined;
  }

  async getServiceProviderByPartnerId(partnerId: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.partnerId, partnerId));
    return employee || undefined;
  }

  /**
   * Admin-facing employee listings exclude soft-deleted accounts (the linked
   * user row carries `deletedAt`). Without this an employee the admin just
   * deleted would still be listed, making the delete look like it failed.
   */
  async getAllServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    const rows = await db
      .select()
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(isNull(users.deletedAt))
      .orderBy(desc(employees.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => r.employees);
  }

  async getVerifiedServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    const rows = await db
      .select()
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(
        eq(employees.documentVerificationStatus, 'verified'),
        isNull(users.deletedAt),
      ))
      .orderBy(desc(employees.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => r.employees);
  }

  async getPendingServiceProviders(limit: number = 100, offset: number = 0): Promise<Employee[]> {
    const rows = await db
      .select()
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(
        eq(employees.documentVerificationStatus, 'pending'),
        isNull(users.deletedAt),
      ))
      .orderBy(desc(employees.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => r.employees);
  }

  /** Counts must apply the same soft-delete filter or pagination totals drift. */
  async countServiceProviders(status?: string): Promise<number> {
    const conditions = [isNull(users.deletedAt)];
    if (status) {
      conditions.push(eq(employees.documentVerificationStatus, status as any));
    }
    const [result] = await db
      .select({ count: count() })
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(...conditions));
    return result?.count ?? 0;
  }

  async updateServiceProvider(id: number, updates: Partial<Employee>): Promise<Employee | undefined> {
    const [employee] = await db
      .update(employees)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
      
    if (employee && updates.fullName) {
      await db.update(users).set({ username: updates.fullName }).where(eq(users.id, employee.userId));
    }
    
    return employee || undefined;
  }

  async updateProviderLocation(id: number, lat: number, long: number): Promise<Employee | undefined> {
    // PHASE 1: Store as WKT text for now. PostGIS raw SQL in Phase 4.
    const [employee] = await db
      .update(employees)
      .set({
        currentLocation: `POINT(${long} ${lat})`,
        lastLocationUpdate: new Date()
      })
      .where(eq(employees.id, id))
      .returning();
    return employee || undefined;
  }

  // Geo-spatial sorting — PHASE 1: Uses WKT text parsing. PostGIS ST_DistanceSphere in Phase 4.
  async getProvidersSortedByDistance(
    lat: number,
    long: number,
    status?: string
  ): Promise<(Employee & { distance: number })[]> {
    const allEmployees = await db
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.isActive, true),
          status ? eq(employees.documentVerificationStatus, status as any) : undefined
        )
      );

    // Parse WKT POINT and calculate distance
    const employeesWithDistance = allEmployees
      .filter(e => e.currentLocation !== null)
      .map(employee => {
        // Parse WKT: "POINT(lng lat)"
        const match = employee.currentLocation?.match(/POINT\(([\d.-]+) ([\d.-]+)\)/);
        if (!match) return null;
        const eLng = parseFloat(match[1]);
        const eLat = parseFloat(match[2]);
        return {
          ...employee,
          distance: calculateHaversineDistance(lat, long, eLat, eLng)
        };
      })
      .filter(Boolean) as (Employee & { distance: number })[];

    return employeesWithDistance.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Deactivate an employee. This is a SOFT delete by design.
   *
   * `employees.id` is referenced by service_requests (providerId,
   * cashCollectedBy), invoices, ratings, partner_wallets, withdrawal_requests
   * and both wallet ledgers. None of those foreign keys declare ON DELETE
   * behaviour, so Postgres defaults to NO ACTION and a hard DELETE raises a
   * foreign-key violation (23503) for any partner who has ever been assigned a
   * job, rated, or paid — which is effectively all of them, since
   * partner_wallets holds exactly one row per partner.
   *
   * Removing the row would also destroy the financial audit trail (wallet
   * ledger, invoices) that the payout and dispute flows depend on.
   *
   * Both updates run in one transaction: previously the user was deactivated
   * first and the employee delete then failed, leaving the partner locked out
   * of an account the admin had been told was NOT deleted.
   */
  async deleteServiceProvider(id: number): Promise<boolean> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!employee) return false;

    await db.transaction(async (tx) => {
      // Block re-login and stop a fresh profile being auto-created on next auth.
      await tx
        .update(users)
        .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, employee.userId));

      // Take them out of assignment eligibility (isOnline && isActive && verified).
      await tx
        .update(employees)
        .set({
          isActive: false,
          isOnline: false,
          documentVerificationStatus: 'suspended',
          updatedAt: new Date(),
        })
        .where(eq(employees.id, id));
    });

    return true;
  }

  // Service Requests
  async createServiceRequest(insertRequest: InsertServiceRequest): Promise<ServiceRequest> {
    const handshakeOtp = crypto.randomInt(100000, 999999).toString();
    let next = await nextSequentialNumber('service_requests', 'service_id', 'SR');

    // Retry on the rare chance a concurrent insert grabbed the same number.
    for (let attempt = 0; attempt < 6; attempt++) {
      const serviceId = `SR${String(next).padStart(6, '0')}`;
      try {
        const [request] = await db
          .insert(serviceRequests)
          .values({ ...insertRequest, serviceId, handshakeOtp })
          .returning();
        return request;
      } catch (err: any) {
        if (err?.code === '23505') { next++; continue; } // unique_violation → try next
        throw err;
      }
    }
    throw new Error('Could not allocate a unique service id after several attempts');
  }

  async getServiceRequest(id: number): Promise<ServiceRequest | undefined> {
    const [request] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id));
    return request || undefined;
  }

  async getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined> {
    const [request] = await db.select().from(serviceRequests).where(eq(serviceRequests.serviceId, serviceId));
    return request || undefined;
  }

  async getUserServiceRequests(userId: number): Promise<any[]> {
    return await db
      .select({
        id: serviceRequests.id,
        serviceId: serviceRequests.serviceId,
        userId: serviceRequests.userId,
        providerId: serviceRequests.providerId,
        serviceType: serviceRequests.serviceType,
        brand: serviceRequests.brand,
        model: serviceRequests.model,
        description: serviceRequests.description,
        photos: serviceRequests.photos,
        status: serviceRequests.status,
        handshakeOtp: serviceRequests.handshakeOtp,
        bookingFee: serviceRequests.bookingFee,
        bookingFeeStatus: serviceRequests.bookingFeeStatus,
        totalAmount: serviceRequests.totalAmount,
        commissionAmount: serviceRequests.commissionAmount,
        customerLocation: serviceRequests.customerLocation,
        address: serviceRequests.address,
        preferredDate: serviceRequests.preferredDate,
        preferredTimeSlot: serviceRequests.preferredTimeSlot,
        assignedAt: serviceRequests.assignedAt,
        reachedAt: serviceRequests.reachedAt,
        reachedLat: serviceRequests.reachedLat,
        reachedLong: serviceRequests.reachedLong,
        startedAt: serviceRequests.startedAt,
        completedAt: serviceRequests.completedAt,
        adminNotes: serviceRequests.adminNotes,
        pricingSnapshot: serviceRequests.pricingSnapshot,
        paymentMethod: serviceRequests.paymentMethod,
        serviceValueTier: serviceRequests.serviceValueTier,
        cashCollectedBy: serviceRequests.cashCollectedBy,
        cashCollectedAt: serviceRequests.cashCollectedAt,
        urgency: serviceRequests.urgency,
        createdAt: serviceRequests.createdAt,
        updatedAt: serviceRequests.updatedAt,
        // Employee join fields
        servicemanName: employees.fullName,
        servicemanPhone: users.phone,
        // Rating join fields
        rating: ratings.rating,
        feedback: ratings.review,
      })
      .from(serviceRequests)
      .leftJoin(employees, eq(serviceRequests.providerId, employees.id))
      .leftJoin(users, eq(employees.userId, users.id))
      .leftJoin(ratings, eq(ratings.serviceRequestId, serviceRequests.id))
      .where(eq(serviceRequests.userId, userId))
      .orderBy(desc(serviceRequests.createdAt));
  }

  async getProviderServiceRequests(providerId: number): Promise<any[]> {
    return await db
      .select({
        id: serviceRequests.id,
        serviceId: serviceRequests.serviceId,
        userId: serviceRequests.userId,
        providerId: serviceRequests.providerId,
        serviceType: serviceRequests.serviceType,
        brand: serviceRequests.brand,
        model: serviceRequests.model,
        description: serviceRequests.description,
        photos: serviceRequests.photos,
        status: serviceRequests.status,
        handshakeOtp: serviceRequests.handshakeOtp,
        bookingFee: serviceRequests.bookingFee,
        bookingFeeStatus: serviceRequests.bookingFeeStatus,
        totalAmount: serviceRequests.totalAmount,
        commissionAmount: serviceRequests.commissionAmount,
        customerLocation: serviceRequests.customerLocation,
        address: serviceRequests.address,
        preferredDate: serviceRequests.preferredDate,
        preferredTimeSlot: serviceRequests.preferredTimeSlot,
        assignedAt: serviceRequests.assignedAt,
        reachedAt: serviceRequests.reachedAt,
        reachedLat: serviceRequests.reachedLat,
        reachedLong: serviceRequests.reachedLong,
        startedAt: serviceRequests.startedAt,
        completedAt: serviceRequests.completedAt,
        adminNotes: serviceRequests.adminNotes,
        pricingSnapshot: serviceRequests.pricingSnapshot,
        paymentMethod: serviceRequests.paymentMethod,
        serviceValueTier: serviceRequests.serviceValueTier,
        cashCollectedBy: serviceRequests.cashCollectedBy,
        cashCollectedAt: serviceRequests.cashCollectedAt,
        urgency: serviceRequests.urgency,
        createdAt: serviceRequests.createdAt,
        updatedAt: serviceRequests.updatedAt,
        customerName: users.username,
        customerPhone: users.phone,
      })
      .from(serviceRequests)
      .leftJoin(users, eq(serviceRequests.userId, users.id))
      .where(eq(serviceRequests.providerId, providerId))
      .orderBy(desc(serviceRequests.createdAt));
  }

  // ── Paginated Service History (with privacy filtering) ──────────────

  private static readonly TERMINAL_STATES = ['completed', 'cancelled', 'disputed'];
  private static readonly ACTIVE_STATES = ['created', 'assigned', 'accepted', 'reached', 'in_progress', 'pending_payment'];

  /**
   * Customer-facing paginated service requests.
   * Joins with employees table to get serviceman name/phone.
   * Privacy: Strips serviceman phone for terminal states.
   */
  async getUserServiceRequestsPaginated(
    userId: number,
    statusFilter: 'active' | 'past' | 'all' = 'all',
    page: number = 1,
    limit: number = 15,
  ): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;

    // Build status condition
    let statusCondition;
    if (statusFilter === 'past') {
      statusCondition = inArray(serviceRequests.status, DatabaseStorage.TERMINAL_STATES as any);
    } else if (statusFilter === 'active') {
      statusCondition = inArray(serviceRequests.status, DatabaseStorage.ACTIVE_STATES as any);
    }

    const whereCondition = statusCondition
      ? and(eq(serviceRequests.userId, userId), statusCondition)
      : eq(serviceRequests.userId, userId);

    // Count total
    const [countResult] = await db
      .select({ total: count() })
      .from(serviceRequests)
      .where(whereCondition!);
    const total = countResult?.total || 0;

    // Fetch page with employee join for serviceman info
    const rows = await db
      .select({
        id: serviceRequests.id,
        serviceId: serviceRequests.serviceId,
        userId: serviceRequests.userId,
        providerId: serviceRequests.providerId,
        serviceType: serviceRequests.serviceType,
        brand: serviceRequests.brand,
        model: serviceRequests.model,
        description: serviceRequests.description,
        photos: serviceRequests.photos,
        status: serviceRequests.status,
        handshakeOtp: serviceRequests.handshakeOtp,
        bookingFee: serviceRequests.bookingFee,
        bookingFeeStatus: serviceRequests.bookingFeeStatus,
        totalAmount: serviceRequests.totalAmount,
        commissionAmount: serviceRequests.commissionAmount,
        address: serviceRequests.address,
        preferredDate: serviceRequests.preferredDate,
        preferredTimeSlot: serviceRequests.preferredTimeSlot,
        assignedAt: serviceRequests.assignedAt,
        reachedAt: serviceRequests.reachedAt,
        startedAt: serviceRequests.startedAt,
        completedAt: serviceRequests.completedAt,
        pricingSnapshot: serviceRequests.pricingSnapshot,
        paymentMethod: serviceRequests.paymentMethod,
        urgency: serviceRequests.urgency,
        createdAt: serviceRequests.createdAt,
        updatedAt: serviceRequests.updatedAt,
        // Employee join fields
        servicemanName: employees.fullName,
        // Phone lives on users table, linked via employees.userId
        servicemanPhone: users.phone,
        // Rating join fields
        rating: ratings.rating,
        feedback: ratings.review,
      })
      .from(serviceRequests)
      .leftJoin(employees, eq(serviceRequests.providerId, employees.id))
      .leftJoin(users, eq(employees.userId, users.id))
      .leftJoin(ratings, eq(ratings.serviceRequestId, serviceRequests.id))
      .where(whereCondition!)
      .orderBy(desc(serviceRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Privacy: strip serviceman phone for terminal states
    const data = rows.map(row => ({
      ...row,
      servicemanPhone: DatabaseStorage.TERMINAL_STATES.includes(row.status)
        ? null
        : row.servicemanPhone,
    }));

    return { data, total };
  }

  /**
   * Partner-facing paginated assignments.
   * Joins with users table to get customer name/phone.
   * Privacy: Strips customer phone for terminal states.
   */
  async getProviderServiceRequestsPaginated(
    providerId: number,
    statusFilter: 'active' | 'past' | 'all' = 'all',
    page: number = 1,
    limit: number = 15,
  ): Promise<{ data: any[]; total: number }> {
    const offset = (page - 1) * limit;

    let statusCondition;
    if (statusFilter === 'past') {
      statusCondition = inArray(serviceRequests.status, DatabaseStorage.TERMINAL_STATES as any);
    } else if (statusFilter === 'active') {
      statusCondition = inArray(serviceRequests.status, DatabaseStorage.ACTIVE_STATES as any);
    }

    const whereCondition = statusCondition
      ? and(eq(serviceRequests.providerId, providerId), statusCondition)
      : eq(serviceRequests.providerId, providerId);

    const [countResult] = await db
      .select({ total: count() })
      .from(serviceRequests)
      .where(whereCondition!);
    const total = countResult?.total || 0;

    const rows = await db
      .select({
        id: serviceRequests.id,
        serviceId: serviceRequests.serviceId,
        userId: serviceRequests.userId,
        providerId: serviceRequests.providerId,
        serviceType: serviceRequests.serviceType,
        brand: serviceRequests.brand,
        model: serviceRequests.model,
        description: serviceRequests.description,
        photos: serviceRequests.photos,
        status: serviceRequests.status,
        handshakeOtp: serviceRequests.handshakeOtp,
        bookingFee: serviceRequests.bookingFee,
        bookingFeeStatus: serviceRequests.bookingFeeStatus,
        totalAmount: serviceRequests.totalAmount,
        commissionAmount: serviceRequests.commissionAmount,
        customerLocation: serviceRequests.customerLocation,
        address: serviceRequests.address,
        preferredDate: serviceRequests.preferredDate,
        preferredTimeSlot: serviceRequests.preferredTimeSlot,
        assignedAt: serviceRequests.assignedAt,
        reachedAt: serviceRequests.reachedAt,
        reachedLat: serviceRequests.reachedLat,
        reachedLong: serviceRequests.reachedLong,
        startedAt: serviceRequests.startedAt,
        completedAt: serviceRequests.completedAt,
        adminNotes: serviceRequests.adminNotes,
        pricingSnapshot: serviceRequests.pricingSnapshot,
        paymentMethod: serviceRequests.paymentMethod,
        serviceValueTier: serviceRequests.serviceValueTier,
        cashCollectedBy: serviceRequests.cashCollectedBy,
        cashCollectedAt: serviceRequests.cashCollectedAt,
        urgency: serviceRequests.urgency,
        createdAt: serviceRequests.createdAt,
        updatedAt: serviceRequests.updatedAt,
        customerName: users.username,
        customerPhone: users.phone,
      })
      .from(serviceRequests)
      .leftJoin(users, eq(serviceRequests.userId, users.id))
      .where(whereCondition!)
      .orderBy(desc(serviceRequests.createdAt))
      .limit(limit)
      .offset(offset);

    // Privacy: strip customer phone for terminal states
    const data = rows.map(row => ({
      ...row,
      customerPhone: DatabaseStorage.TERMINAL_STATES.includes(row.status)
        ? null
        : row.customerPhone,
    }));

    return { data, total };
  }

  async updateServiceRequest(id: number, updates: Partial<ServiceRequest>): Promise<ServiceRequest | undefined> {
    const [request] = await db
      .update(serviceRequests)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(serviceRequests.id, id))
      .returning();
    return request || undefined;
  }

  /**
   * The technician's payout for a completed booking, credited to the wallet HOLD.
   * v2 fixed-price → the exact frozen technicianEarning; v1/legacy → the historical
   * share-of-booking-fee. Idempotent: creditWalletOnHold dedupes by serviceRequestId.
   */
  private async creditTechnicianOnCompletion(service: any, completedAt: Date | string, tx?: any): Promise<void> {
    if (!service.providerId) {
      logger.warn(`[WALLET] Skipping completion credit for SR ${service.id}: no provider assigned`);
      return;
    }
    const defaultFee = await configService.get<number>('BUSINESS_CONFIG.BASE_SERVICE_FEE', 99);
    const baseFee = service.bookingFee !== null && service.bookingFee !== undefined ? Number(service.bookingFee) : defaultFee;
    const partnerSharePct = await configService.get<number>('BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE', 50);
    const holdDays = await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7);

    const snapshot: any = service.pricingSnapshot;
    const partnerAmount = (snapshot && snapshot.snapshotVersion === 2 && snapshot.technicianEarning != null)
      ? Number(snapshot.technicianEarning)
      : (baseFee * partnerSharePct) / 100;

    const releaseDate = new Date(completedAt);
    releaseDate.setDate(releaseDate.getDate() + holdDays);

    await this.creditWalletOnHold(service.providerId, service.id, partnerAmount, releaseDate, tx);
    logger.info(`[WALLET] Credited ₹${partnerAmount} to HOLD for partner ${service.providerId} (SR ${service.id})`);
  }

  async updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined> {
    const isCompleting = status === 'completed';
    const [request] = await db
      .update(serviceRequests)
      .set({ status: status as any, updatedAt: new Date(), ...(isCompleting ? { completedAt: new Date() } : {}) })
      .where(eq(serviceRequests.id, id))
      .returning();

    // Credit the technician on completion. Online/QR payments finish through this
    // path (not transitionBookingState), so without this the wallet was never
    // credited. Non-fatal + idempotent, so a hiccup can't un-complete a paid job.
    if (request && isCompleting) {
      try {
        await this.creditTechnicianOnCompletion(request, request.completedAt ?? new Date());
      } catch (err) {
        logger.error(`[WALLET] Completion credit failed for SR ${id}`, { error: (err as any)?.message });
      }
    }
    return request || undefined;
  }

  async assignProviderToService(serviceRequestId: number, providerId: number): Promise<ServiceRequest | undefined> {
    const [request] = await db
      .update(serviceRequests)
      .set({
        providerId,
        status: 'assigned',
        assignedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(serviceRequests.id, serviceRequestId))
      .returning();
    return request || undefined;
  }

  async getPendingAssignments(): Promise<any[]> {
    // Join the catalog so admin sees the selected category + exact service name
    // (serviceType is just a free-text copy). Left joins so bookings without a
    // catalog link (old/free-text) still appear.
    // Also join users so we get the customer's name, phone, and address.
    const rows = await db
      .select({
        sr: serviceRequests,
        categoryName: serviceCategories.name,
        catalogServiceName: services.name,
        userName: users.username,
        userPhone: users.phone,
        userAddress: users.homeAddress,
      })
      .from(serviceRequests)
      .leftJoin(services, eq(services.id, serviceRequests.catalogServiceId))
      .leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId))
      .leftJoin(users, eq(users.id, serviceRequests.userId))
      .where(
        and(
          eq(serviceRequests.status, 'created'),
          eq(serviceRequests.bookingFeeStatus, 'paid')
        )
      )
      .orderBy(desc(serviceRequests.createdAt));

    return rows.map((r) => ({
      ...r.sr,
      categoryName: r.categoryName,
      // Use catalog service name if available, otherwise fall back to the
      // free-text serviceType the customer typed / the app sent.
      serviceName: r.catalogServiceName || r.sr.serviceType,
      user: {
        username: r.userName,
        phone: r.userPhone,
        homeAddress: r.userAddress,
      },
    }));
  }

  async getAllServiceRequests(): Promise<ServiceRequest[]> {
    return await db.select().from(serviceRequests).orderBy(desc(serviceRequests.createdAt));
  }

  // Service Catalog
  async getHomeVisibleServices(): Promise<ServiceItem[]> {
    return await db
      .select()
      .from(services)
      .where(and(eq(services.isActive, true), eq(services.isHomeVisible, true)))
      .orderBy(asc(services.sortOrder));
  }

  async getAllServiceCategoriesWithServices(): Promise<(ServiceCategory & { items: ServiceItem[] })[]> {
    const cats = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.isActive, true))
      .orderBy(asc(serviceCategories.sortOrder));
      
    const allItems = await db
      .select()
      .from(services)
      .where(eq(services.isActive, true))
      .orderBy(asc(services.sortOrder));
      
    return cats.map(cat => ({
      ...cat,
      items: allItems.filter(item => item.categoryId === cat.id)
    }));
  }

  async getAdminServiceCatalog(): Promise<(ServiceCategory & { items: ServiceItem[] })[]> {
    const cats = await db
      .select()
      .from(serviceCategories)
      .orderBy(asc(serviceCategories.sortOrder));
      
    const allItems = await db
      .select()
      .from(services)
      .orderBy(asc(services.sortOrder));
      
    return cats.map(cat => ({
      ...cat,
      items: allItems.filter(item => item.categoryId === cat.id)
    }));
  }

  async createServiceCategory(category: InsertServiceCategory): Promise<ServiceCategory> {
    const existing = await db
      .select()
      .from(serviceCategories)
      .where(ilike(serviceCategories.name, category.name));
    
    if (existing.length > 0) {
      throw new Error(`Category with name "${category.name}" already exists`);
    }

    const [result] = await db.insert(serviceCategories).values(category).returning();
    return result;
  }

  async updateServiceCategory(id: number, updates: Partial<ServiceCategory>): Promise<ServiceCategory | undefined> {
    if (updates.name) {
      const existing = await db
        .select()
        .from(serviceCategories)
        .where(
          and(
            ilike(serviceCategories.name, updates.name),
            ne(serviceCategories.id, id)
          )
        );
      
      if (existing.length > 0) {
        throw new Error(`Category with name "${updates.name}" already exists`);
      }
    }

    const [result] = await db
      .update(serviceCategories)
      .set(updates)
      .where(eq(serviceCategories.id, id))
      .returning();
    return result || undefined;
  }

  async createService(service: InsertServiceItem): Promise<ServiceItem> {
    const [result] = await db.insert(services).values(service).returning();
    return result;
  }

  async updateService(id: number, updates: Partial<ServiceItem>): Promise<ServiceItem | undefined> {
    const [result] = await db
      .update(services)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning();
    return result || undefined;
  }

  async deleteService(id: number): Promise<boolean> {
    const [result] = await db
      .delete(services)
      .where(eq(services.id, id))
      .returning();
    return !!result;
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

      // 2. Get the employee (was provider)
      const [employee] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, service.providerId));

      if (!employee) {
        throw new Error('Employee not found');
      }

      const currentBalance = parseFloat(employee.walletBalance || '0');
      const newBalance = currentBalance - commissionAmount;

      // 3. Update service request status
      const [updatedService] = await tx
        .update(serviceRequests)
        .set({
          status: 'completed',
          paymentMethod: 'online',
          totalAmount,
          commissionAmount,
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(serviceRequests.id, serviceRequestId))
        .returning();

      // 4. Deduct commission from employee wallet
      await tx
        .update(employees)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(employees.id, service.providerId));

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

  async creditProviderWalletForOnlinePayment(
    serviceRequestId: number
  ): Promise<{ transaction: WalletTransaction | null }> {
    const result = await db.transaction(async (tx) => {
      // 1. Get the service request
      const [service] = await tx
        .select()
        .from(serviceRequests)
        .where(eq(serviceRequests.id, serviceRequestId));

      if (!service || !service.providerId) {
        throw new Error('Service request or provider not found');
      }
      
      const snapshot = service.pricingSnapshot as any;
      if (!snapshot || !snapshot.technicianEarning) {
          // If there is no technicianEarning, we can't credit.
          // V1 bookings might not have this, but they rely on cash/manual entry
          return { transaction: null };
      }
      
      const earningAmount = Number(snapshot.technicianEarning);
      if (earningAmount <= 0) {
          return { transaction: null };
      }

      // Check if we already credited this to prevent double-crediting
      const [existingTx] = await tx
        .select()
        .from(walletTransactions)
        .where(and(
            eq(walletTransactions.serviceRequestId, serviceRequestId),
            eq(walletTransactions.type, 'credit')
        ));
        
      if (existingTx) {
          return { transaction: existingTx };
      }

      // 2. Get the employee (was provider)
      const [employee] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, service.providerId));

      if (!employee) {
        throw new Error('Employee not found');
      }

      const currentBalance = parseFloat(employee.walletBalance || '0');
      const newBalance = currentBalance + earningAmount;

      // 3. Add earning to employee wallet
      await tx
        .update(employees)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(employees.id, service.providerId));

      // 4. Create wallet transaction record
      const [transaction] = await tx
        .insert(walletTransactions)
        .values({
          providerId: service.providerId,
          serviceRequestId,
          amount: earningAmount.toFixed(2),
          type: 'credit',
          description: `Earnings for online payment of service ${service.serviceId}`,
          balanceBefore: currentBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2)
        })
        .returning();

      // Update V2 Wallet (partner_wallets)
      const [wallet] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, service.providerId));
      if (wallet) {
         const newV2Balance = parseFloat(wallet.balanceAvailable) + earningAmount;
         const newTotalEarned = parseFloat(wallet.totalEarned) + earningAmount;
         await tx.update(partnerWallets).set({ 
             balanceAvailable: newV2Balance.toString(),
             totalEarned: newTotalEarned.toString()
         }).where(eq(partnerWallets.id, wallet.id));
      }

      return { transaction };
    });

    return result;
  }

  async topUpProviderWallet(providerId: number, amount: number, description: string): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
      const [employee] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, providerId));

      if (!employee) {
        throw new Error('Employee not found');
      }

      // Update V1 Wallet
      const currentBalance = parseFloat(employee.walletBalance || '0');
      const newBalance = currentBalance + amount;

      await tx
        .update(employees)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(employees.id, providerId));

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

      // Update V2 Wallet (partner_wallets)
      const [wallet] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, providerId));
      if (wallet) {
        const v2CurrentAvailable = parseFloat(wallet.balanceAvailable);
        const v2NewAvailable = v2CurrentAvailable + amount;
        const v2CurrentTotalEarned = parseFloat(wallet.totalEarned);
        
        await tx.update(partnerWallets).set({
          balanceAvailable: v2NewAvailable.toFixed(2),
          totalEarned: (v2CurrentTotalEarned + amount).toFixed(2), // Topups count as earnings/available
          updatedAt: new Date()
        }).where(eq(partnerWallets.partnerId, providerId));

        await tx.insert(walletTransactionsV2).values({
          transactionId: `WTOP-${providerId}-${Date.now()}`,
          partnerId: providerId,
          transactionType: 'release', 
          amount: amount.toFixed(2),
          balanceAvailableBefore: wallet.balanceAvailable,
          balanceAvailableAfter: v2NewAvailable.toFixed(2),
          balanceHoldBefore: wallet.balanceHold,
          balanceHoldAfter: wallet.balanceHold,
          description: description || 'Admin Top-up',
        });
      }

      return transaction;
    });

    return result;
  }

  async deductProviderWallet(providerId: number, amount: number, description: string, allowNegative: boolean = false): Promise<WalletTransaction> {
    const result = await db.transaction(async (tx) => {
      const [employee] = await tx
        .select()
        .from(employees)
        .where(eq(employees.id, providerId));

      if (!employee) {
        throw new Error('Employee not found');
      }

      // Read V2 Wallet for actual balance check if available
      const [wallet] = await tx.select().from(partnerWallets).where(eq(partnerWallets.partnerId, providerId));
      const v2Balance = wallet ? parseFloat(wallet.balanceAvailable) : 0;
      
      const currentBalance = parseFloat(employee.walletBalance || '0');

      // Block negative balance for regular deductions (withdrawals).
      // Check V2 balance instead of V1 if wallet exists, otherwise fallback to V1
      const effectiveBalance = wallet ? v2Balance : currentBalance;
      if (!allowNegative && effectiveBalance < amount) {
        throw new Error(`Insufficient wallet balance. Available: ₹${effectiveBalance.toFixed(2)}`);
      }

      const newBalance = currentBalance - amount;

      // Update V1
      await tx
        .update(employees)
        .set({
          walletBalance: newBalance.toFixed(2),
          updatedAt: new Date()
        })
        .where(eq(employees.id, providerId));

      const [transaction] = await tx
        .insert(walletTransactions)
        .values({
          providerId,
          amount: (-amount).toFixed(2), // Negative amount for deduction record
          type: 'commission',
          description,
          balanceBefore: currentBalance.toFixed(2),
          balanceAfter: newBalance.toFixed(2)
        })
        .returning();

      // Update V2
      if (wallet) {
        const v2NewAvailable = v2Balance - amount;
        await tx.update(partnerWallets).set({
          balanceAvailable: v2NewAvailable.toFixed(2),
          updatedAt: new Date()
        }).where(eq(partnerWallets.partnerId, providerId));

        await tx.insert(walletTransactionsV2).values({
          transactionId: `WDED-${providerId}-${Date.now()}`,
          partnerId: providerId,
          transactionType: 'withdraw_bank', // Best fit for generic deduction
          amount: amount.toFixed(2),
          balanceAvailableBefore: wallet.balanceAvailable,
          balanceAvailableAfter: v2NewAvailable.toFixed(2),
          balanceHoldBefore: wallet.balanceHold,
          balanceHoldAfter: wallet.balanceHold,
          description: description || 'Admin Deduction / Platform Fee',
        });
      }

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
    let next = await nextSequentialNumber('product_orders', 'order_id', 'ORD');

    for (let attempt = 0; attempt < 6; attempt++) {
      const orderId = `ORD${String(next).padStart(6, '0')}`;
      try {
        const [order] = await db.insert(productOrders).values({ ...insertOrder, orderId }).returning();
        return order;
      } catch (err: any) {
        if (err?.code === '23505') { next++; continue; }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique order id after several attempts');
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

  async getAdminProducts(): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.isActive, true)).orderBy(desc(products.id));
  }

  async updateProduct(id: number, updates: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set({ ...updates, updatedAt: new Date() } as any) // Cast to any to handle type mismatch with defaults if needed
      .where(eq(products.id, id))
      .returning();
    return product || undefined;
  }

  async deleteProduct(id: number): Promise<boolean> {
    // Soft delete by default
    const [product] = await db
      .update(products)
      .set({ isActive: false })
      .where(eq(products.id, id))
      .returning();
    return !!product;
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

  async deleteServiceCategory(id: number): Promise<boolean> {
    try {
      await db.delete(services).where(eq(services.categoryId, id));
      const [deleted] = await db.delete(serviceCategories).where(eq(serviceCategories.id, id)).returning();
      return !!deleted;
    } catch (e) {
      console.error('Error deleting category:', e);
      return false;
    }
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
    // Only INV-format ids are counted; the main invoice path uses UF-INV-* ids,
    // which this regexp deliberately ignores so the two schemes never collide.
    let next = await nextSequentialNumber('invoices', 'invoice_id', 'INV');

    for (let attempt = 0; attempt < 6; attempt++) {
      const invoiceId = `INV${String(next).padStart(6, '0')}`;
      try {
        const [invoice] = await db.insert(invoices).values({ ...insertInvoice, invoiceId }).returning();
        return invoice;
      } catch (err: any) {
        if (err?.code === '23505') { next++; continue; }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique invoice id after several attempts');
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
    const MAX_OTP_ATTEMPTS = 5;

    // Build the contact filter — if both are provided, match on BOTH
    const conditions = [
      eq(otpVerifications.purpose, purpose),
      eq(otpVerifications.isVerified, false),
      gte(otpVerifications.expiresAt, new Date()),
    ];

    if (phone && email) {
      // Fallback login stores both — match on both for precision
      conditions.push(eq(otpVerifications.phone, phone));
      conditions.push(eq(otpVerifications.email, email));
    } else if (phone) {
      conditions.push(eq(otpVerifications.phone, phone));
    } else if (email) {
      conditions.push(eq(otpVerifications.email, email));
    } else {
      return false; // No contact info
    }

    // Find the LATEST unverified, unexpired OTP record
    const [verification] = await db
      .select()
      .from(otpVerifications)
      .where(and(...conditions))
      .orderBy(desc(otpVerifications.createdAt)) // newest first (was incorrectly ASC!)
      .limit(1);

    if (!verification) {
      // Never log the contact details or the code itself — these lines used
      // console.log, which bypasses LOG_LEVEL and therefore ran in production,
      // putting live login codes into the Render logs.
      logger.warn('[OTP] No matching unexpired OTP found', { purpose });
      return false;
    }

    logger.debug('[OTP] Verifying submitted code', {
      recordId: verification.id,
      purpose,
      attempts: verification.attempts,
      expiresAt: verification.expiresAt,
    });

    const currentAttempts = (verification.attempts ?? 0);

    // Backend-enforced max-attempts lockout
    if (currentAttempts >= MAX_OTP_ATTEMPTS) {
      throw Object.assign(new Error('Too many incorrect attempts. Please request a new code.'), {
        statusCode: 429,
      });
    }

    if (verification.otp !== otp) {
      // Increment attempt counter on wrong code
      await db
        .update(otpVerifications)
        .set({ attempts: currentAttempts + 1 })
        .where(eq(otpVerifications.id, verification.id));
      return false;
    }

    // Correct OTP — mark as used
    await db
      .update(otpVerifications)
      .set({ isVerified: true })
      .where(eq(otpVerifications.id, verification.id));
    return true;
  }



  async getDistrict(id: number): Promise<District | undefined> {
    const [district] = await db
      .select()
      .from(districts)
      .where(eq(districts.id, id));
    return district;
  }

  async deleteDistrict(id: number): Promise<void> {
    const district = await this.getDistrict(id);
    if (!district) throw new Error("District not found");

    // Protection for default district
    if (district.name === 'Uttara Kannada') {
      throw new Error("Cannot delete default district 'Uttara Kannada'");
    }

    // Cascade delete locations (serviceable pincodes)
    // Delete by districtId OR district name to cover legacy data
    await db.delete(serviceablePincodes).where(
      or(
        eq(serviceablePincodes.districtId, id),
        eq(serviceablePincodes.district, district.name)
      )
    );

    // Delete the district
    await db
      .delete(districts)
      .where(eq(districts.id, id));
  }

  // Serviceable Pincodes
  async createServiceablePincode(pincode: InsertServiceablePincode): Promise<ServiceablePincode> {
    // Dynamic validation: check pincode against district
    let districtId: number | undefined;

    if (pincode.district) {
      const districtRecord = await db.query.districts.findFirst({
        where: eq(districts.name, pincode.district)
      });

      if (districtRecord) {
        districtId = districtRecord.id;

        if (districtRecord.pincodePrefix && !pincode.pincode.startsWith(districtRecord.pincodePrefix)) {
          throw new Error(`Validation Error: Pincode must start with ${districtRecord.pincodePrefix} for ${pincode.district} region.`);
        }
      }
    }

    const [result] = await db
      .insert(serviceablePincodes)
      .values({ ...pincode, districtId })
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

  async togglePincodeStatus(pincode: string, explicitStatus?: boolean): Promise<ServiceablePincode | undefined> {
    const existing = await this.getServiceablePincode(pincode);
    if (!existing) return undefined;

    const newStatus = explicitStatus !== undefined ? explicitStatus : !existing.isActive;

    const [result] = await db
      .update(serviceablePincodes)
      .set({ isActive: newStatus })
      .where(eq(serviceablePincodes.pincode, pincode))
      .returning();
    return result || undefined;
  }

  async updateServiceablePincode(originalPincode: string, data: Partial<InsertServiceablePincode>): Promise<ServiceablePincode | undefined> {
    const existing = await this.getServiceablePincode(originalPincode);
    if (!existing) return undefined;

    // Resolve districtId if district name is provided and changed
    let districtId = existing.districtId;
    if (data.district && data.district !== existing.district) {
      const districtRecord = await db.query.districts.findFirst({
        where: eq(districts.name, data.district)
      });
      if (districtRecord) {
        districtId = districtRecord.id;
        if (districtRecord.pincodePrefix && data.pincode && !data.pincode.startsWith(districtRecord.pincodePrefix)) {
          throw new Error(`Validation Error: Pincode must start with ${districtRecord.pincodePrefix} for ${data.district} region.`);
        }
      }
    }

    const [result] = await db
      .update(serviceablePincodes)
      .set({ ...data, districtId })
      .where(eq(serviceablePincodes.pincode, originalPincode))
      .returning();
    return result || undefined;
  }

  async isPincodeServiceable(pincode: string): Promise<boolean> {
    // 1. Direct check in database
    const [result] = await db
      .select({ count: count() })
      .from(serviceablePincodes)
      .where(and(eq(serviceablePincodes.pincode, pincode), eq(serviceablePincodes.isActive, true)));

    if (result.count > 0) return true;

    return false;
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
    const [userCount] = await db.select({ count: count() }).from(users).where(eq(users.role, 'user'));
    const [providerCount] = await db.select({ count: count() }).from(employees);

    const [activeServiceCount] = await db
      .select({ count: count() })
      .from(serviceRequests)
      .where(
        or(
          eq(serviceRequests.status, 'created'),
          eq(serviceRequests.status, 'assigned'),
          eq(serviceRequests.status, 'accepted'),
          eq(serviceRequests.status, 'reached'),
          eq(serviceRequests.status, 'in_progress'),
          eq(serviceRequests.status, 'pending_payment')
        )
      );

    const [completedServiceCount] = await db
      .select({ count: count() })
      .from(serviceRequests)
      .where(eq(serviceRequests.status, 'completed'));

    const [orderCount] = await db.select({ count: count() }).from(productOrders);

    const [revenueResult] = await db
      .select({ total: sum(invoices.totalAmount) })
      .from(invoices);

    const [pendingCount] = await db
      .select({ count: count() })
      .from(employees)
      .where(eq(employees.documentVerificationStatus, 'pending'));

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

  async getRecentServices(limit: number): Promise<any[]> {
    return await db
      .select({
        id: serviceRequests.id,
        serviceId: serviceRequests.serviceId,
        userId: serviceRequests.userId,
        providerId: serviceRequests.providerId,
        serviceType: serviceRequests.serviceType,
        description: serviceRequests.description,
        status: serviceRequests.status,
        bookingFee: serviceRequests.bookingFee,
        bookingFeeStatus: serviceRequests.bookingFeeStatus,
        totalAmount: serviceRequests.totalAmount,
        address: serviceRequests.address,
        createdAt: serviceRequests.createdAt,
        // Joined fields
        customerName: users.username,
        customerPhone: users.phone,
        technicianName: employees.fullName,
      })
      .from(serviceRequests)
      .leftJoin(users, eq(serviceRequests.userId, users.id))
      .leftJoin(employees, eq(serviceRequests.providerId, employees.id))
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

  // ==================== PHASE 2: PLATFORM CONFIGURATION ====================

  async getPlatformConfig(key: string): Promise<PlatformConfig | undefined> {
    const [config] = await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.key, key));
    return config || undefined;
  }

  async getPlatformConfigByCategory(category: string): Promise<PlatformConfig[]> {
    return await db
      .select()
      .from(platformConfig)
      .where(eq(platformConfig.category, category))
      .orderBy(platformConfig.key);
  }

  async getAllPlatformConfigs(): Promise<PlatformConfig[]> {
    return await db.select().from(platformConfig).orderBy(platformConfig.category, platformConfig.key);
  }

  async updatePlatformConfig(key: string, value: string, updatedBy: number): Promise<void> {
    await db
      .update(platformConfig)
      .set({ value, updatedBy })
      .where(eq(platformConfig.key, key));

    // Log config change
    await this.logAuditEvent({
      entityType: 'platform_config',
      entityId: 0, // Config doesn't have numeric ID
      action: 'config_update',
      toState: value,
      changedBy: updatedBy,
      metadata: { key, newValue: value },
    });
  }

  async seedDefaultConfig(): Promise<void> {
    const { DEFAULT_PLATFORM_CONFIG } = await import('./config/default-config');

    for (const config of DEFAULT_PLATFORM_CONFIG) {
      const existing = await this.getPlatformConfig(config.key);
      if (!existing) {
        await db.insert(platformConfig).values({
          key: config.key,
          value: config.value,
          valueType: config.valueType,
          category: config.category,
          description: config.description,
          isEditable: config.isEditable ?? true,
        });
      } else if (existing.isEditable !== (config.isEditable ?? true)) {
        await db.update(platformConfig)
          .set({ isEditable: config.isEditable ?? true })
          .where(eq(platformConfig.key, config.key));
      }
    }

    // Clean up stale legacy keys
    const legacyKeys = ['BOOKING_FEE', 'GST_RATE', 'PARTNER_COMMISSION', 'OTP_EXPIRY_MINUTES'];
    await db.delete(platformConfig).where(inArray(platformConfig.key, legacyKeys)).catch(() => {});
  }

  // ==================== PHASE 2: AUDIT LOGGING ====================

  async logAuditEvent(event: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db
      .insert(auditLogs)
      .values(event)
      .returning();
    return log;
  }

  async getAuditLogs(entityType: string, entityId: number): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, entityType),
          eq(auditLogs.entityId, entityId)
        )
      )
      .orderBy(desc(auditLogs.createdAt));
  }

  // ==================== PHASE 2: CENTRALIZED STATE TRANSITIONS (CRITICAL) ====================

  /**
   * PHASE 2: Centralized booking state transition function
   * 
   * THIS IS THE ONLY FUNCTION THAT SHOULD UPDATE BOOKING STATUS
   * 
   * Responsibilities:
   * 1. Validate state transitions using state machine
   * 2. Apply backward-compatible state mapping (canonical ↔ legacy)
   * 3. Log audit trail
   * 4. Check wallet trigger (placeholder for Phase 3)
   * 5. Update database within transaction
   */
  async transitionBookingState(
    serviceRequestId: number,
    newState: BookingState,
    changedBy: number,
    metadata?: any
  ): Promise<ServiceRequest> {
    // Get current service request
    const service = await this.getServiceRequest(serviceRequestId);
    if (!service) {
      throw new Error(`Service request ${serviceRequestId} not found`);
    }

    // Normalize current state from DB (legacy → canonical)
    const currentState = legacyToCanonical(service.status);

    // PHASE 4: OTP Guard - Check if OTP validation is required
    if (requiresOtpValidation(currentState, newState)) {
      const { OtpService } = await import('./services/otp.service');
      const hasValidOtp = await OtpService.hasValidOtp(serviceRequestId);

      if (!hasValidOtp) {
        throw new Error(
          `OTP verification required. Service cannot be started without valid OTP. ` +
          `Customer must generate OTP and technician must validate it before starting service.`
        );
      }
    }

    // PHASE 5: Payment Verification Gate
    if (requiresPaymentVerification(currentState, newState)) {
      const { PaymentService } = await import('./services/payment.service');
      const isPaymentVerified = await PaymentService.isFinalPaymentVerified(serviceRequestId);
      if (!isPaymentVerified) {
        throw new Error(
          `Payment verification required. Service cannot be marked as COMPLETED without verified final payment.`
        );
      }
      if (service.providerId && service.userId) {
        await PaymentService.generateInvoice(serviceRequestId, service.userId, service.providerId);
      }
    }

    // Validate state transition
    if (!validateStateTransition(currentState, newState)) {
      throw new Error(
        `Invalid state transition: ${currentState} → ${newState} for service ${service.serviceId}`
      );
    }

    // Convert canonical state to legacy format for DB storage
    const legacyState = canonicalToLegacy(newState);

    // Execute within transaction to ensure atomicity
    const result = await db.transaction(async (tx: any) => {
      // 1. Update service request status
      const statusUpdate: any = {
        status: newState,
        updatedAt: new Date(),
      };

      // Update timestamps based on state
      if (newState === BookingState.ASSIGNED) {
        statusUpdate.assignedAt = new Date();
      } else if (newState === BookingState.IN_PROGRESS) {
        statusUpdate.startedAt = new Date();
      } else if (newState === BookingState.COMPLETED) {
        statusUpdate.completedAt = new Date();
      } else if (newState === BookingState.ACCEPTED && !service.handshakeOtp) {
        // Fallback: Generate OTP if missing for older bookings
        const crypto = require('crypto');
        statusUpdate.handshakeOtp = crypto.randomInt(100000, 999999).toString();
      }

      const [updatedService] = await tx
        .update(serviceRequests)
        .set(statusUpdate)
        .where(eq(serviceRequests.id, serviceRequestId))
        .returning();

      // 2. Log audit event
      await tx.insert(auditLogs).values({
        entityType: 'service_request',
        entityId: serviceRequestId,
        action: 'state_change',
        fromState: service.status, // Log legacy state for debugging
        toState: newState,       // Log legacy state for debugging  
        changedBy,
        metadata: {
          canonicalFromState: currentState,
          canonicalToState: newState,
          serviceId: service.serviceId,
          ...metadata,
        },
      });

      // ==================== PHASE 3 HOOK ====================
      // 3. Check if wallet credit should be triggered
      if (shouldTriggerWalletCredit(newState)) {
        console.log(`[PHASE 3] Triggering wallet and inventory for service ${service.serviceId}`);

        if (!service.providerId) {
          throw new Error(`Cannot credit wallet: No provider assigned to service ${serviceRequestId}`);
        }

        // 3a. WALLET CREDIT (HOLD state)
        try {
          const defaultFee = await configService.get<number>('BUSINESS_CONFIG.BASE_SERVICE_FEE', 99);
          const baseFee = service.bookingFee !== null && service.bookingFee !== undefined ? Number(service.bookingFee) : defaultFee;
          const partnerSharePct = await configService.get<number>('BUSINESS_CONFIG.PARTNER_SHARE_PERCENTAGE', 50);
          const holdDays = await configService.get<number>('BUSINESS_CONFIG.WALLET_HOLD_DAYS', 7);

          // v2 fixed-price booking → credit the exact technician earning frozen at
          // booking creation (P − gst − fee − booking). v1/legacy bookings keep the
          // existing behaviour (a share of the booking fee) so their payouts are
          // untouched.
          const snapshot: any = service.pricingSnapshot;
          const partnerAmount = (snapshot && snapshot.snapshotVersion === 2 && snapshot.technicianEarning != null)
            ? Number(snapshot.technicianEarning)
            : (baseFee * partnerSharePct) / 100;

          const releaseDate = new Date(statusUpdate.completedAt);
          releaseDate.setDate(releaseDate.getDate() + holdDays);

          await this.creditWalletOnHold(
            service.providerId,
            serviceRequestId,
            partnerAmount,
            releaseDate,
            tx
          );

          console.log(`[WALLET] Credited ₹${partnerAmount} to HOLD for partner ${service.providerId}`);
        } catch (walletError) {
          console.error(`[WALLET ERROR]`, walletError);
          throw walletError; // Rollback entire transaction
        }

        // 3b. INVENTORY DEDUCTION (if items used)
        if (metadata?.inventoryItems && Array.isArray(metadata.inventoryItems)) {
          try {
            await this.deductInventoryForBooking(
              serviceRequestId,
              metadata.inventoryItems,
              service.providerId,
              tx
            );

            console.log(`[INVENTORY] Deducted items:`, metadata.inventoryItems);
          } catch (inventoryError) {
            console.error(`[INVENTORY ERROR]`, inventoryError);
            throw inventoryError; // Rollback entire transaction (including wallet credit)
          }
        }
      }
      // ==================== END PHASE 3 HOOK ====================

      return updatedService;
    });

    return result;
  }

  // ==================== PHASE 3: WALLET MANAGEMENT ====================

  async getOrCreatePartnerWallet(partnerId: number, tx?: any): Promise<PartnerWallet> {
    const dbCtx = tx || db;

    const [wallet] = await dbCtx
      .select()
      .from(partnerWallets)
      .where(eq(partnerWallets.partnerId, partnerId));

    if (wallet) return wallet;

    const [newWallet] = await dbCtx
      .insert(partnerWallets)
      .values({
        partnerId,
        balanceHold: '0.00',
        balanceAvailable: '0.00',
        totalEarned: '0.00',
      })
      .returning();

    return newWallet;
  }

  async creditWalletOnHold(
    partnerId: number,
    serviceRequestId: number,
    amount: number,
    releaseDate: Date,
    tx?: any
  ): Promise<WalletTransactionV2> {
    const dbCtx = tx || db;

    // IDEMPOTENCY CHECK
    const [existing] = await dbCtx
      .select()
      .from(walletTransactionsV2)
      .where(
        and(
          eq(walletTransactionsV2.serviceRequestId, serviceRequestId),
          eq(walletTransactionsV2.transactionType, 'hold_credit')
        )
      );

    if (existing) {
      console.log(`[IDEMPOTENCY] Wallet already credited for service ${serviceRequestId}`);
      return existing;
    }

    // Get wallet
    const wallet = await this.getOrCreatePartnerWallet(partnerId, dbCtx);

    const currentHold = parseFloat(wallet.balanceHold);
    const currentEarned = parseFloat(wallet.totalEarned);
    const newHold = currentHold + amount;
    const newEarned = currentEarned + amount;

    const transactionId = `WHLD-${serviceRequestId}-${Date.now()}`;

    const [transaction] = await dbCtx
      .insert(walletTransactionsV2)
      .values({
        transactionId,
        partnerId,
        serviceRequestId,
        transactionType: 'hold_credit',
        amount: amount.toFixed(2),
        balanceHoldBefore: wallet.balanceHold,
        balanceHoldAfter: newHold.toFixed(2),
        balanceAvailableBefore: wallet.balanceAvailable,
        balanceAvailableAfter: wallet.balanceAvailable,
        releaseDate,
        isReleased: false,
        description: `Earnings held for service completion`,
        metadata: { serviceRequestId, releaseDate: releaseDate.toISOString() },
      })
      .returning();

    await dbCtx
      .update(partnerWallets)
      .set({
        balanceHold: newHold.toFixed(2),
        totalEarned: newEarned.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(partnerWallets.partnerId, partnerId));

    return transaction;
  }

  async releaseHeldBalance(transactionId: number): Promise<void> {
    await db.transaction(async (tx: any) => {
      const [holdTx] = await tx
        .select()
        .from(walletTransactionsV2)
        .where(eq(walletTransactionsV2.id, transactionId));

      if (!holdTx || holdTx.isReleased || holdTx.transactionType !== 'hold_credit') {
        return;
      }

      const amount = parseFloat(holdTx.amount);

      const [wallet] = await tx
        .select()
        .from(partnerWallets)
        .where(eq(partnerWallets.partnerId, holdTx.partnerId));

      const currentHold = parseFloat(wallet.balanceHold);
      const currentAvailable = parseFloat(wallet.balanceAvailable);
      const newHold = currentHold - amount;
      const newAvailable = currentAvailable + amount;

      await tx.insert(walletTransactionsV2).values({
        transactionId: `WREL-${holdTx.id}-${Date.now()}`,
        partnerId: holdTx.partnerId,
        serviceRequestId: holdTx.serviceRequestId,
        transactionType: 'release',
        amount: '0.00',
        balanceHoldBefore: wallet.balanceHold,
        balanceHoldAfter: newHold.toFixed(2),
        balanceAvailableBefore: wallet.balanceAvailable,
        balanceAvailableAfter: newAvailable.toFixed(2),
        parentTransactionId: holdTx.id,
        description: `Released held earnings to available`,
      });

      await tx
        .update(partnerWallets)
        .set({
          balanceHold: newHold.toFixed(2),
          balanceAvailable: newAvailable.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(partnerWallets.partnerId, holdTx.partnerId));

      await tx
        .update(walletTransactionsV2)
        .set({ isReleased: true, releasedAt: new Date() })
        .where(eq(walletTransactionsV2.id, transactionId));
    });
  }

  async releaseAllExpiredHolds(): Promise<number> {
    const now = new Date();
    const expiredHolds = await db
      .select()
      .from(walletTransactionsV2)
      .where(
        and(
          eq(walletTransactionsV2.transactionType, 'hold_credit'),
          eq(walletTransactionsV2.isReleased, false),
          lte(walletTransactionsV2.releaseDate, now)
        )
      );

    let count = 0;
    for (const hold of expiredHolds) {
      try {
        await this.releaseHeldBalance(hold.id);
        count++;
      } catch (error) {
        console.error(`Failed to release hold ${hold.id}:`, error);
      }
    }

    console.log(`[CRON] Released ${count} expired holds`);
    return count;
  }

  // ==================== PHASE 3: INVENTORY MANAGEMENT ====================

  async getInventoryItemByCode(itemCode: string): Promise<InventoryItem | undefined> {
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.itemCode, itemCode));

    return item || undefined;
  }

  async deductInventoryForBooking(
    serviceRequestId: number,
    items: Array<{ itemCode: string; quantity: number }>,
    performedBy: number,
    tx?: any
  ): Promise<InventoryTransaction[]> {
    const dbCtx = tx || db;
    const transactions: InventoryTransaction[] = [];

    for (const item of items) {
      const [inventoryItem] = await dbCtx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.itemCode, item.itemCode));

      if (!inventoryItem) {
        throw new Error(`Inventory item ${item.itemCode} not found`);
      }

      // IDEMPOTENCY CHECK
      const [existing] = await dbCtx
        .select()
        .from(inventoryTransactions)
        .where(
          and(
            eq(inventoryTransactions.serviceRequestId, serviceRequestId),
            eq(inventoryTransactions.itemId, inventoryItem.id),
            eq(inventoryTransactions.transactionType, 'consumption')
          )
        );

      if (existing) {
        console.log(`[IDEMPOTENCY] Inventory ${item.itemCode} already deducted for service ${serviceRequestId}`);
        transactions.push(existing);
        continue;
      }

      if (inventoryItem.currentStock < item.quantity) {
        throw new Error(
          `Insufficient stock for ${item.itemCode}. ` +
          `Available: ${inventoryItem.currentStock}, Required: ${item.quantity}`
        );
      }

      const stockBefore = inventoryItem.currentStock;
      const stockAfter = stockBefore - item.quantity;
      const totalCost = parseFloat(inventoryItem.unitCost) * item.quantity;

      const [transaction] = await dbCtx
        .insert(inventoryTransactions)
        .values({
          transactionId: `ICONS-${serviceRequestId}-${inventoryItem.id}-${Date.now()}`,
          itemId: inventoryItem.id,
          serviceRequestId,
          transactionType: 'consumption',
          quantity: -item.quantity,
          unitCostSnapshot: inventoryItem.unitCost,
          totalCost: totalCost.toFixed(2),
          performedBy,
          stockBefore,
          stockAfter,
          notes: `Consumed during service ${serviceRequestId}`,
        })
        .returning();

      await dbCtx
        .update(inventoryItems)
        .set({
          currentStock: stockAfter,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, inventoryItem.id));

      transactions.push(transaction);

      if (stockAfter < (inventoryItem.minStockLevel || 10)) {
        console.warn(`[LOW STOCK] ${item.itemCode} is low: ${stockAfter}`);
      }
    }

    return transactions;
  }

  // PHASE 9: Social Auth
  async findSocialProvider(provider: string, providerId: string): Promise<SocialAuthProvider | undefined> {
    const [result] = await db.select()
      .from(socialAuthProviders)
      .where(and(
        eq(socialAuthProviders.provider, provider),
        eq(socialAuthProviders.providerId, providerId)
      ))
      .limit(1);
    return result || undefined;
  }


  // PHASE 9: Notifications
  async addDeviceToken(userId: number, token: string, platform: string): Promise<DeviceToken> {
    const [result] = await db.insert(deviceTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: [deviceTokens.userId, deviceTokens.token],
        set: {
          isActive: true,
          lastUsedAt: new Date(),
          platform // Update platform matching token
        }
      })
      .returning();
    return result;
  }

  async removeDeviceToken(userId: number, token: string): Promise<void> {
    await db.update(deviceTokens)
      .set({ isActive: false })
      .where(and(
        eq(deviceTokens.userId, userId),
        eq(deviceTokens.token, token)
      ));
  }

  async getUserNotifications(userId: number, page: number = 1, limit: number = 20): Promise<{ notifications: Notification[], total: number }> {
    const offset = (page - 1) * limit;

    const data = await db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: count() })
      .from(notifications)
      .where(eq(notifications.userId, userId));

    return {
      notifications: data,
      total: Number(countResult?.count || 0)
    };
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const [row] = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    return Number(row?.count || 0);
  }

  /**
   * Scoped by userId as well as id — without it any authenticated user could
   * mark another user's notification as read by guessing a serial id.
   */
  async markNotificationRead(id: number, userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(
        eq(notifications.id, id),
        eq(notifications.userId, userId)
      ));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }


  async linkSocialProvider(data: InsertSocialAuth): Promise<SocialAuthProvider> {
    const [result] = await db
      .insert(socialAuthProviders)
      .values(data)
      .returning();
    return result;
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [result] = await db
      .insert(notifications)
      .values(data)
      .returning();
    return result;
  }

  /**
   * Bulk insert for broadcasts. Chunked because a marketing campaign can target
   * tens of thousands of users and Postgres caps a statement's bind parameters
   * at 65535 (5 columns per row here).
   */
  async createNotifications(rows: InsertNotification[]): Promise<number> {
    if (rows.length === 0) return 0;

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await db.insert(notifications).values(chunk);
      inserted += chunk.length;
    }
    return inserted;
  }

  // Districts Implementation
  async getAllDistricts(): Promise<District[]> {
    return await db.select().from(districts);
  }

  async createDistrict(district: InsertDistrict): Promise<District> {
    const [result] = await db
      .insert(districts)
      .values(district)
      .returning();
    return result;
  }

  async toggleDistrictStatus(id: number, isActive: boolean): Promise<District> {
    const [result] = await db
      .update(districts)
      .set({ isActive })
      .where(eq(districts.id, id))
      .returning();
    return result;
  }

  // Helper to ensure default district exists
  async ensureDefaultDistrict(): Promise<void> {
    const existing = await db.query.districts.findFirst({
      where: (districts, { eq }) => eq(districts.name, 'Uttara Kannada')
    });

    if (!existing) {
      await this.createDistrict({
        name: 'Uttara Kannada',
        state: 'Karnataka',
        pincodePrefix: '581',
        isActive: true
      });
      console.log('Default district "Uttara Kannada" created.');
    }
  }

  constructor() {
    this.ensureDefaultDistrict().catch(console.error);
    this.seedDefaultConfig().catch(console.error);
  }
}

export const storage = new DatabaseStorage();
