import { pgTable, text, serial, integer, boolean, timestamp, json, doublePrecision, decimal, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums for better data integrity
export const userRoleEnum = pgEnum('user_role', ['user', 'admin', 'serviceman']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected', 'suspended']);
// PHASE 2: Updated booking state machine - normalized states
export const serviceStatusEnum = pgEnum('service_status', [
  'created',      // User creates service request
  'assigned',     // Admin assigns partner  
  'accepted',     // Partner accepts the job
  'in_progress',  // Service work started
  'completed',    // Service finished (triggers wallet credit & inventory deduction)
  'cancelled',    // User/admin cancelled
  'disputed'      // Reserved for future dispute handling
]);
export const orderStatusEnum = pgEnum('order_status', ['placed', 'confirmed', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled']);
// PHASE 3: Wallet transaction types (ledger-based events)
export const walletTransactionTypeEnum = pgEnum('wallet_transaction_type', [
  'hold_credit',          // Earnings credited to HOLD on service completion
  'release',              // HOLD → AVAILABLE after dispute window
  'withdraw_bank',        // AVAILABLE → WITHDRAWN (bank transfer)
  'withdraw_upi',         // AVAILABLE → WITHDRAWN (UPI)
  'refund',               // Reverse hold_credit
  'adjustment',           // Manual admin adjustment
  'commission_deduction', // Platform commission
]);
// PHASE 3: Inventory transaction types
export const inventoryTransactionTypeEnum = pgEnum('inventory_transaction_type', [
  'consumption',  // Used during service
  'restock',      // New stock added
  'adjustment',   // Manual stock adjustment
  'return',       // Returned from service (refund scenario)
]);
export const transactionTypeEnum = pgEnum('transaction_type', ['credit', 'debit', 'commission', 'refund', 'topup']);
export const bookingFeeStatusEnum = pgEnum('booking_fee_status', ['pending', 'paid', 'refunded']);

// Users table - handles all user types
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  password: text("password").notNull(),
  username: text("username"),
  role: userRoleEnum("role").notNull().default('user'),
  referralCode: text("referral_code").unique(),
  referredById: integer("referred_by_id"),
  homeAddress: text("home_address"),
  pinCode: text("pin_code"),
  isVerified: boolean("is_verified").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  phoneIdx: index("users_phone_idx").on(table.phone),
  roleIdx: index("users_role_idx").on(table.role),
  referralCodeIdx: uniqueIndex("users_referral_code_idx").on(table.referralCode),
}));

// Service Providers table - dedicated for service partners
export const serviceProviders = pgTable("service_providers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  partnerId: text("partner_id").notNull().unique(),
  partnerName: text("partner_name").notNull(),
  businessName: text("business_name"),
  partnerType: text("partner_type").notNull().default('Individual'),
  walletBalance: decimal("wallet_balance", { precision: 10, scale: 2 }).notNull().default('0'),
  verificationStatus: verificationStatusEnum("verification_status").notNull().default('pending'),
  currentLat: doublePrecision("current_lat"),
  currentLong: doublePrecision("current_long"),
  skills: json("skills").$type<string[]>(),
  services: text("services").array(),
  location: text("location"),
  address: text("address"),
  isActive: boolean("is_active").default(true),
  lastLocationUpdate: timestamp("last_location_update"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("service_providers_user_id_idx").on(table.userId),
  verificationIdx: index("service_providers_verification_idx").on(table.verificationStatus),
  locationIdx: index("service_providers_location_idx").on(table.currentLat, table.currentLong),
}));

// Service Requests table
export const serviceRequests = pgTable("service_requests", {
  id: serial("id").primaryKey(),
  serviceId: text("service_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  providerId: integer("provider_id").references(() => serviceProviders.id),
  serviceType: text("service_type").notNull(),
  brand: text("brand"),
  model: text("model"),
  description: text("description").notNull(),
  photos: text("photos").array(),
  status: serviceStatusEnum("status").notNull().default('placed'),
  handshakeOtp: text("handshake_otp"),
  bookingFee: integer("booking_fee").default(250),
  bookingFeeStatus: bookingFeeStatusEnum("booking_fee_status").default('pending'),
  totalAmount: integer("total_amount"),
  commissionAmount: integer("commission_amount"),
  locationLat: doublePrecision("location_lat"),
  locationLong: doublePrecision("location_long"),
  address: text("address").notNull(),
  assignedAt: timestamp("assigned_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("service_requests_user_id_idx").on(table.userId),
  providerIdIdx: index("service_requests_provider_id_idx").on(table.providerId),
  statusIdx: index("service_requests_status_idx").on(table.status),
  locationIdx: index("service_requests_location_idx").on(table.locationLat, table.locationLong),
}));

// Wallet Transactions table - for audit trails
export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => serviceProviders.id),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  type: transactionTypeEnum("type").notNull(),
  description: text("description"),
  balanceBefore: decimal("balance_before", { precision: 10, scale: 2 }),
  balanceAfter: decimal("balance_after", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  providerIdIdx: index("wallet_transactions_provider_id_idx").on(table.providerId),
  typeIdx: index("wallet_transactions_type_idx").on(table.type),
}));

// Districts management
export const districts = pgTable("districts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // e.g., "Uttara Kannada"
  state: text("state").default('Karnataka'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Serviceable Pincodes table
export const serviceablePincodes = pgTable("serviceable_pincodes", {
  pincode: text("pincode").primaryKey(),
  area: text("area"),
  district: text("district"), // Keeping text for backward compat, ideally redundant with districtId
  districtId: integer("district_id").references(() => districts.id), // New FK
  state: text("state").default('Karnataka'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Products table
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(),
  category: text("category").notNull(),
  stock: integer("stock").default(0),
  images: text("images").array(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  categoryIdx: index("products_category_idx").on(table.category),
}));

// Product Orders table
export const productOrders = pgTable("product_orders", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  products: json("products"),
  status: orderStatusEnum("status").notNull().default('placed'),
  totalAmount: integer("total_amount").notNull(),
  address: text("address").notNull(),
  deliveryLat: doublePrecision("delivery_lat"),
  deliveryLong: doublePrecision("delivery_long"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("product_orders_user_id_idx").on(table.userId),
  statusIdx: index("product_orders_status_idx").on(table.status),
}));

// Cart items table
export const cartItems = pgTable("cart_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  productId: integer("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("cart_items_user_id_idx").on(table.userId),
}));

// Invoices table
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().unique(),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  productOrderId: integer("product_order_id").references(() => productOrders.id),
  userId: integer("user_id").notNull().references(() => users.id),
  providerId: integer("provider_id").references(() => serviceProviders.id),
  baseAmount: integer("base_amount").notNull(),
  cgst: integer("cgst").notNull(),
  sgst: integer("sgst").notNull(),
  discount: integer("discount").default(0),
  totalAmount: integer("total_amount").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("invoices_user_id_idx").on(table.userId),
}));

// OTP verifications table
export const otpVerifications = pgTable("otp_verifications", {
  id: serial("id").primaryKey(),
  phone: text("phone"),
  email: text("email"),
  otp: text("otp").notNull(),
  purpose: text("purpose").notNull(),
  isVerified: boolean("is_verified").default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// PHASE 2: Platform configuration table
export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  valueType: text("value_type").notNull(), // 'string', 'number', 'boolean', 'json'
  category: text("category").notNull(), // 'BUSINESS_CONFIG' or 'OPERATIONAL_CONFIG'
  description: text("description"),
  isEditable: boolean("is_editable").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedBy: integer("updated_by"), // Admin user ID
}, (table) => ({
  categoryIdx: index("platform_config_category_idx").on(table.category),
}));

// PHASE 2: Audit logs table for state transitions and admin actions
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // 'service_request', 'user', 'config', etc.
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // 'state_change', 'update', 'delete', 'config_update'
  fromState: text("from_state"),
  toState: text("to_state"),
  changedBy: integer("changed_by"), // User/Admin ID
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  entityIdx: index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  createdIdx: index("audit_logs_created_idx").on(table.createdAt),
}));

// PHASE 3: Partner Wallets (Ledger-Based)
export const partnerWallets = pgTable("partner_wallets", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().unique().references(() => serviceProviders.id),
  balanceHold: decimal("balance_hold", { precision: 10, scale: 2 }).notNull().default('0.00'),
  balanceAvailable: decimal("balance_available", { precision: 10, scale: 2 }).notNull().default('0.00'),
  totalEarned: decimal("total_earned", { precision: 10, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  partnerIdx: uniqueIndex("partner_wallets_partner_idx").on(table.partnerId),
}));

// PHASE 3: Wallet Transactions (Ledger Events)
export const walletTransactionsV2 = pgTable("wallet_transactions_v2", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  partnerId: integer("partner_id").notNull().references(() => serviceProviders.id),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  transactionType: walletTransactionTypeEnum("transaction_type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  balanceHoldBefore: decimal("balance_hold_before", { precision: 10, scale: 2 }),
  balanceHoldAfter: decimal("balance_hold_after", { precision: 10, scale: 2 }),
  balanceAvailableBefore: decimal("balance_available_before", { precision: 10, scale: 2 }),
  balanceAvailableAfter: decimal("balance_available_after", { precision: 10, scale: 2 }),
  releaseDate: timestamp("release_date"), // For hold_credit transactions
  isReleased: boolean("is_released").default(false),
  releasedAt: timestamp("released_at"),
  parentTransactionId: integer("parent_transaction_id").references((): any => walletTransactionsV2.id),
  description: text("description"),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  partnerIdx: index("wallet_trans_v2_partner_idx").on(table.partnerId),
  serviceIdx: index("wallet_trans_v2_service_idx").on(table.serviceRequestId),
  typeIdx: index("wallet_trans_v2_type_idx").on(table.transactionType),
  releaseIdx: index("wallet_trans_v2_release_idx").on(table.isReleased, table.releaseDate),
  // IDEMPOTENCY: Unique constraint on service_request_id + transaction_type for hold_credit
  uniqueHoldCredit: uniqueIndex("wallet_trans_v2_unique_hold_credit").on(table.serviceRequestId, table.transactionType),
}));

// PHASE 3: Inventory Items (Platform-Owned)
export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  itemCode: text("item_code").notNull().unique(),
  itemName: text("item_name").notNull(),
  category: text("category"),
  unit: text("unit").notNull(), // 'piece', 'meter', 'liter', etc.
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).notNull(),
  currentStock: integer("current_stock").notNull().default(0),
  minStockLevel: integer("min_stock_level").default(10),
  ownerPartnerId: text("owner_partner_id").notNull().default('UNITEFIX_PLATFORM'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  codeIdx: uniqueIndex("inventory_items_code_idx").on(table.itemCode),
  ownerIdx: index("inventory_items_owner_idx").on(table.ownerPartnerId),
  stockIdx: index("inventory_items_stock_idx").on(table.currentStock),
}));

// PHASE 3: Inventory Transactions (Audit Trail)
export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  transactionId: text("transaction_id").notNull().unique(),
  itemId: integer("item_id").notNull().references(() => inventoryItems.id),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  transactionType: inventoryTransactionTypeEnum("transaction_type").notNull(),
  quantity: integer("quantity").notNull(), // Negative for consumption
  unitCostSnapshot: decimal("unit_cost_snapshot", { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }).notNull(),
  performedBy: integer("performed_by"), // Partner ID who consumed/restocked
  stockBefore: integer("stock_before").notNull(),
  stockAfter: integer("stock_after").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  itemIdx: index("inventory_trans_item_idx").on(table.itemId),
  serviceIdx: index("inventory_trans_service_idx").on(table.serviceRequestId),
  typeIdx: index("inventory_trans_type_idx").on(table.transactionType),
  // IDEMPOTENCY: Unique constraint on service_request_id + item_id for consumption
  uniqueConsumption: uniqueIndex("inventory_trans_unique_consumption").on(table.serviceRequestId, table.itemId, table.transactionType),
}));

// Admin users table
export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("admin"),
  isActive: boolean("is_active").default(true),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  serviceRequests: many(serviceRequests),
  productOrders: many(productOrders),
  cartItems: many(cartItems),
  serviceProvider: one(serviceProviders, {
    fields: [users.id],
    references: [serviceProviders.userId],
  }),
  referredBy: one(users, {
    fields: [users.referredById],
    references: [users.id],
  }),
}));

export const serviceProvidersRelations = relations(serviceProviders, ({ one, many }) => ({
  user: one(users, {
    fields: [serviceProviders.userId],
    references: [users.id],
  }),
  serviceRequests: many(serviceRequests),
  walletTransactions: many(walletTransactions),
}));

export const serviceRequestsRelations = relations(serviceRequests, ({ one }) => ({
  user: one(users, {
    fields: [serviceRequests.userId],
    references: [users.id],
  }),
  provider: one(serviceProviders, {
    fields: [serviceRequests.providerId],
    references: [serviceProviders.id],
  }),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  provider: one(serviceProviders, {
    fields: [walletTransactions.providerId],
    references: [serviceProviders.id],
  }),
  serviceRequest: one(serviceRequests, {
    fields: [walletTransactions.serviceRequestId],
    references: [serviceRequests.id],
  }),
}));

export const productOrdersRelations = relations(productOrders, ({ one }) => ({
  user: one(users, {
    fields: [productOrders.userId],
    references: [users.id],
  }),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, {
    fields: [cartItems.userId],
    references: [users.id],
  }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

// Zod schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceProviderSchema = createInsertSchema(serviceProviders).omit({
  id: true,
  partnerId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceRequestSchema = createInsertSchema(serviceRequests).omit({
  id: true,
  serviceId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductOrderSchema = createInsertSchema(productOrders).omit({
  id: true,
  orderId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export const insertCartItemSchema = createInsertSchema(cartItems).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  invoiceId: true,
  createdAt: true,
});

export const insertOtpVerificationSchema = createInsertSchema(otpVerifications).omit({
  id: true,
  createdAt: true,
});

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({
  id: true,
  createdAt: true,
});


export const insertServiceablePincodeSchema = createInsertSchema(serviceablePincodes).omit({
  createdAt: true,
});

export const insertDistrictSchema = createInsertSchema(districts).omit({
  id: true,
  createdAt: true,
});

// PHASE 2: Platform config and audit logs schemas
export const insertPlatformConfigSchema = createInsertSchema(platformConfig).omit({
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertServiceProvider = z.infer<typeof insertServiceProviderSchema>;
export type ServiceProvider = typeof serviceProviders.$inferSelect;

export type InsertServiceRequest = z.infer<typeof insertServiceRequestSchema>;
export type ServiceRequest = typeof serviceRequests.$inferSelect;

export type InsertProductOrder = z.infer<typeof insertProductOrderSchema>;
export type ProductOrder = typeof productOrders.$inferSelect;

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type CartItem = typeof cartItems.$inferSelect;

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export type InsertOtpVerification = z.infer<typeof insertOtpVerificationSchema>;
export type OtpVerification = typeof otpVerifications.$inferSelect;

export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsers.$inferSelect;

export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;

export type InsertServiceablePincode = z.infer<typeof insertServiceablePincodeSchema>;
export type ServiceablePincode = typeof serviceablePincodes.$inferSelect;

export type InsertDistrict = z.infer<typeof insertDistrictSchema>;
export type District = typeof districts.$inferSelect;

// PHASE 2: New types
export type InsertPlatformConfig = z.infer<typeof insertPlatformConfigSchema>;
export type PlatformConfig = typeof platformConfig.$inferSelect;

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// PHASE 3: Wallet and Inventory schemas
export const insertPartnerWalletSchema = createInsertSchema(partnerWallets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWalletTransactionV2Schema = createInsertSchema(walletTransactionsV2).omit({
  id: true,
  createdAt: true,
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInventoryTransactionSchema = createInsertSchema(inventoryTransactions).omit({
  id: true,
  createdAt: true,
});

// PHASE 3: Types
export type PartnerWallet = typeof partnerWallets.$inferSelect;
export type InsertPartnerWallet = z.infer<typeof insertPartnerWalletSchema>;

export type WalletTransactionV2 = typeof walletTransactionsV2.$inferSelect;
export type InsertWalletTransactionV2 = z.infer<typeof insertWalletTransactionV2Schema>;

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = z.infer<typeof insertInventoryTransactionSchema>;
