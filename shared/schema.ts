import { pgTable, text, serial, integer, boolean, timestamp, json, jsonb, doublePrecision, decimal, index, uniqueIndex, pgEnum, varchar } from "drizzle-orm/pg-core";
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
export const orderStatusEnum = pgEnum('order_status', [
  'placed',              // Customer placed order
  'confirmed',           // Admin/system confirmed
  'shipped',             // Handed to Delhivery
  'in_transit',          // In transit
  'out_for_delivery',    // Out for delivery
  'delivered',           // Delivered to customer
  'return_requested',    // Customer requested return (within 1 day)
  'return_approved',     // Admin approved return
  'return_rejected',     // Admin rejected return
  'return_shipped',      // Customer shipped return
  'return_received',     // Warehouse received return
  'exchange_requested',  // Customer requested exchange (within 1 day)
  'exchange_approved',   // Admin approved exchange
  'exchange_shipped',    // Replacement shipped
  'refund_initiated',    // Razorpay refund initiated
  'refunded',            // Refund completed
  'completed',           // Final state (no action needed)
  'cancelled',           // Cancelled before delivery
]);
// PHASE 10: Return/Exchange enums
export const returnReasonEnum = pgEnum('return_reason', [
  'defective', 'wrong_item', 'not_as_described', 'size_issue', 'changed_mind', 'other'
]);
export const returnTypeEnum = pgEnum('return_type', ['return', 'exchange']);
export const returnStatusEnum = pgEnum('return_status', [
  'requested', 'approved', 'rejected', 'shipped', 'received', 'refund_initiated', 'refunded', 'exchanged', 'closed'
]);
// PHASE 10: Payment tracking enums
export const paymentEventTypeEnum = pgEnum('payment_event_type', [
  'order_created', 'payment_captured', 'payment_failed', 'refund_initiated', 'refund_processed', 'refund_failed'
]);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'captured', 'failed', 'refunded']);
export const refundStatusEnum = pgEnum('refund_status', ['initiated', 'processed', 'failed']);
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
// PHASE 7: Support ticket enums
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'in_progress', 'resolved', 'closed']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'urgent']);
export const ticketCategoryEnum = pgEnum('ticket_category', ['service', 'product', 'payment', 'general']);
// PHASE 5: Shipment status enum
export const shipmentStatusEnum = pgEnum('shipment_status', ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned']);

// Users table - handles all user types
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").unique(),
  email: text("email"),
  password: text("password").notNull(),
  username: text("username"),
  profilePicture: text("profile_picture"), // CDN URL for avatar
  role: userRoleEnum("role").notNull().default('user'),
  referralCode: text("referral_code").unique(),
  referredById: integer("referred_by_id"),
  homeAddress: text("home_address"),
  pinCode: text("pin_code"),
  isVerified: boolean("is_verified").default(false),
  isActive: boolean("is_active").default(true),
  deletedAt: timestamp("deleted_at"), // Soft delete
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
  status: serviceStatusEnum("status").notNull().default('created'),
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
  state: text("state").notNull().default('Karnataka'),
  pincodePrefix: text("pincode_prefix").notNull().default('581'), // Added prefix for validation
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDistrictSchema = createInsertSchema(districts).pick({
  name: true,
  state: true,
  pincodePrefix: true, // Included in insert schema
  isActive: true,
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

// PHASE 11: Product Catalog — Category → Brand → Product → Variant hierarchy
export const productCategories = pgTable("product_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(), // URL-safe: "laptops", "cc-cameras"
  description: text("description"),
  iconUrl: text("icon_url"), // Category thumbnail
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex("product_categories_slug_idx").on(table.slug),
}));

export const productBrands = pgTable("product_brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  categoryId: integer("category_id").references(() => productCategories.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  categoryIdx: index("product_brands_category_idx").on(table.categoryId),
  slugIdx: uniqueIndex("product_brands_slug_idx").on(table.slug),
}));

// Products table (enhanced with category/brand/variant support)
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price").notNull(), // Base price (min variant price)
  category: text("category").notNull(), // Legacy text category (kept for backward compat)
  categoryId: integer("category_id").references(() => productCategories.id),
  brandId: integer("brand_id").references(() => productBrands.id),
  stock: integer("stock").default(0), // Computed sum of variant stocks
  images: text("images").array(), // Legacy image array (kept for backward compat)
  thumbnailUrl: text("thumbnail_url"), // Primary display image URL
  specifications: jsonb("specifications"), // { display: "15.6 FHD", processor: "AMD Ryzen 5" }
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  categoryIdx: index("products_category_idx").on(table.category),
  categoryIdIdx: index("products_category_id_idx").on(table.categoryId),
  brandIdIdx: index("products_brand_id_idx").on(table.brandId),
}));

// Product Variants — SKU-level pricing and stock
export const productVariants = pgTable("product_variants", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  sku: text("sku").notNull().unique(), // e.g. "DELL-INS15-8G-256SSD"
  variantLabel: text("variant_label").notNull(), // e.g. "8GB RAM / 256GB SSD"
  attributes: jsonb("attributes"), // { ram: "8GB", ssd: "256GB", color: "Silver" }
  price: integer("price").notNull(), // Variant-specific price in paise
  mrp: integer("mrp"), // Maximum retail price (for showing discounts)
  stock: integer("stock").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").default(3),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  productIdx: index("product_variants_product_idx").on(table.productId),
  skuIdx: uniqueIndex("product_variants_sku_idx").on(table.sku),
  stockIdx: index("product_variants_stock_idx").on(table.stock),
}));

// Product Images — supports both external URLs and uploaded images
export const productImages = pgTable("product_images", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  variantId: integer("variant_id").references(() => productVariants.id), // null = shared across all variants
  imageUrl: text("image_url").notNull(), // External URL or Cloudinary URL
  source: text("source").notNull().default('external'), // 'external' | 'cloudinary' | 'upload'
  sortOrder: integer("sort_order").default(0),
  isPrimary: boolean("is_primary").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  productIdx: index("product_images_product_idx").on(table.productId),
  variantIdx: index("product_images_variant_idx").on(table.variantId),
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

// PHASE 7: Support Tickets table
export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  ticketId: text("ticket_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  category: ticketCategoryEnum("category").notNull().default('general'),
  status: ticketStatusEnum("status").notNull().default('open'),
  priority: ticketPriorityEnum("priority").notNull().default('medium'),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  productOrderId: integer("product_order_id").references(() => productOrders.id),
  assignedTo: integer("assigned_to"), // Admin user ID
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("support_tickets_user_id_idx").on(table.userId),
  statusIdx: index("support_tickets_status_idx").on(table.status),
  categoryIdx: index("support_tickets_category_idx").on(table.category),
}));

// PHASE 7: Ticket Messages table
export const ticketMessages = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  senderType: text("sender_type").notNull(), // 'customer', 'admin', 'system'
  senderId: integer("sender_id"),
  message: text("message").notNull(),
  isInternal: boolean("is_internal").default(false), // Internal admin notes
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ticketIdIdx: index("ticket_messages_ticket_id_idx").on(table.ticketId),
}));

// PHASE 5: Service Charges table (technician enters after service)
export const serviceCharges = pgTable("service_charges", {
  id: serial("id").primaryKey(),
  serviceRequestId: integer("service_request_id").notNull().unique().references(() => serviceRequests.id),
  serviceAmount: decimal("service_amount", { precision: 10, scale: 2 }).notNull(),
  partsUsed: text("parts_used"),
  technicianNotes: text("technician_notes"),
  enteredBy: integer("entered_by").notNull(), // Provider ID
  enteredAt: timestamp("entered_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  serviceRequestIdx: uniqueIndex("service_charges_service_request_idx").on(table.serviceRequestId),
}));

// PHASE 5: Shipments table (Delhivery integration)
export const shipments = pgTable("shipments", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => productOrders.orderId),
  waybill: text("waybill").notNull().unique(),
  shipmentId: text("shipment_id"),
  carrier: text("carrier").notNull().default('delhivery'),
  status: shipmentStatusEnum("status").notNull().default('created'),
  trackingUrl: text("tracking_url"),
  estimatedDelivery: timestamp("estimated_delivery"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orderIdIdx: index("shipments_order_id_idx").on(table.orderId),
  waybillIdx: uniqueIndex("shipments_waybill_idx").on(table.waybill),
}));

// PHASE 4: Service OTPs table (handshake verification)
export const serviceOtps = pgTable("service_otps", {
  id: serial("id").primaryKey(),
  serviceRequestId: integer("service_request_id").notNull().references(() => serviceRequests.id),
  otp: text("otp").notNull(),
  generatedBy: integer("generated_by").notNull(), // Customer user ID
  isVerified: boolean("is_verified").default(false),
  verifiedBy: integer("verified_by"), // Technician provider ID
  verifiedAt: timestamp("verified_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  serviceRequestIdx: index("service_otps_service_request_idx").on(table.serviceRequestId),
}));

// PHASE 8: Ratings table
export const ratings = pgTable("ratings", {
  id: serial("id").primaryKey(),
  serviceRequestId: integer("service_request_id").notNull().references(() => serviceRequests.id),
  fromUserId: integer("from_user_id").notNull().references(() => users.id),
  toProviderId: integer("to_provider_id").notNull().references(() => serviceProviders.id),
  rating: integer("rating").notNull(), // 1-5 stars
  review: text("review"),
  isVisible: boolean("is_visible").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  serviceRequestIdx: uniqueIndex("ratings_service_request_idx").on(table.serviceRequestId), // One rating per service
  providerIdx: index("ratings_provider_idx").on(table.toProviderId),
  userIdx: index("ratings_user_idx").on(table.fromUserId),
}));

// PHASE 9: Social Auth
export const socialAuthProviders = pgTable("social_auth_providers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(), // google, facebook
  providerId: text("provider_id").notNull(),
  email: text("email"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  providerUnique: uniqueIndex("social_auth_provider_unique").on(table.provider, table.providerId),
  userIdx: index("social_auth_user_idx").on(table.userId),
}));

// PHASE 9: Notifications & Device Tokens
export const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  token: text("token").notNull(), // FCM/APNS token
  platform: text("platform").notNull(), // android, ios, web
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userTokenUnique: uniqueIndex("device_tokens_unique").on(table.userId, table.token),
}));

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull(), // order_update, promo, system
  data: jsonb("data"), // Deep link or extra data
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdx: index("notifications_user_idx").on(table.userId),
}));

// PHASE 10: Payment Transactions table (tracks every Razorpay event)
export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").references(() => productOrders.orderId),
  serviceRequestId: integer("service_request_id").references(() => serviceRequests.id),
  razorpayOrderId: text("razorpay_order_id"),
  razorpayPaymentId: text("razorpay_payment_id"),
  amount: integer("amount").notNull(), // In paise
  currency: text("currency").notNull().default('INR'),
  eventType: paymentEventTypeEnum("event_type").notNull(),
  status: paymentStatusEnum("status").notNull().default('pending'),
  method: text("method"), // upi, card, netbanking, wallet
  metadata: jsonb("metadata"), // Raw Razorpay response
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orderIdx: index("payment_tx_order_idx").on(table.orderId),
  serviceIdx: index("payment_tx_service_idx").on(table.serviceRequestId),
  razorpayOrderIdx: index("payment_tx_razorpay_order_idx").on(table.razorpayOrderId),
  razorpayPaymentIdx: index("payment_tx_razorpay_payment_idx").on(table.razorpayPaymentId),
  statusIdx: index("payment_tx_status_idx").on(table.status),
}));

// PHASE 10: Return Requests table
export const returnRequests = pgTable("return_requests", {
  id: serial("id").primaryKey(),
  requestId: text("request_id").notNull().unique(), // RET-XXXXXXXX format
  orderId: text("order_id").notNull().references(() => productOrders.orderId),
  userId: integer("user_id").notNull().references(() => users.id),
  type: returnTypeEnum("type").notNull(), // return or exchange
  reason: returnReasonEnum("reason").notNull(),
  description: text("description"),
  photos: jsonb("photos"), // Array of photo URLs
  status: returnStatusEnum("status").notNull().default('requested'),
  refundAmount: integer("refund_amount"), // In paise, set by admin on approval
  adminRemarks: text("admin_remarks"),
  approvedBy: integer("approved_by"), // Admin user ID
  returnWaybill: text("return_waybill"), // Delhivery waybill for return shipment
  replacementOrderId: text("replacement_order_id"), // For exchanges
  deliveredAt: timestamp("delivered_at"), // When original order was delivered
  returnWindowExpiresAt: timestamp("return_window_expires_at"), // deliveredAt + 1 day
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  orderIdx: index("return_requests_order_idx").on(table.orderId),
  userIdx: index("return_requests_user_idx").on(table.userId),
  statusIdx: index("return_requests_status_idx").on(table.status),
  typeIdx: index("return_requests_type_idx").on(table.type),
}));

// PHASE 10: Refunds table (tracks Razorpay refund lifecycle)
export const refunds = pgTable("refunds", {
  id: serial("id").primaryKey(),
  refundId: text("refund_id").notNull().unique(), // REF-XXXXXXXX format
  paymentTransactionId: integer("payment_transaction_id").references(() => paymentTransactions.id),
  returnRequestId: integer("return_request_id").references(() => returnRequests.id),
  razorpayRefundId: text("razorpay_refund_id"),
  razorpayPaymentId: text("razorpay_payment_id"), // Original payment to refund against
  amount: integer("amount").notNull(), // In paise
  status: refundStatusEnum("status").notNull().default('initiated'),
  reason: text("reason"),
  initiatedBy: integer("initiated_by"), // Admin user ID
  processedAt: timestamp("processed_at"),
  metadata: jsonb("metadata"), // Raw Razorpay refund response
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  paymentTxIdx: index("refunds_payment_tx_idx").on(table.paymentTransactionId),
  returnRequestIdx: index("refunds_return_request_idx").on(table.returnRequestId),
  razorpayRefundIdx: uniqueIndex("refunds_razorpay_refund_idx").on(table.razorpayRefundId),
  statusIdx: index("refunds_status_idx").on(table.status),
}))

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

export const productOrdersRelations = relations(productOrders, ({ one, many }) => ({
  user: one(users, {
    fields: [productOrders.userId],
    references: [users.id],
  }),
  returnRequests: many(returnRequests),
  paymentTransactions: many(paymentTransactions),
}));

// PHASE 10: Payment transaction relations
export const paymentTransactionsRelations = relations(paymentTransactions, ({ one, many }) => ({
  order: one(productOrders, {
    fields: [paymentTransactions.orderId],
    references: [productOrders.orderId],
  }),
  serviceRequest: one(serviceRequests, {
    fields: [paymentTransactions.serviceRequestId],
    references: [serviceRequests.id],
  }),
  refunds: many(refunds),
}));

// PHASE 10: Return request relations
export const returnRequestsRelations = relations(returnRequests, ({ one }) => ({
  order: one(productOrders, {
    fields: [returnRequests.orderId],
    references: [productOrders.orderId],
  }),
  user: one(users, {
    fields: [returnRequests.userId],
    references: [users.id],
  }),
}));

// PHASE 10: Refund relations
export const refundsRelations = relations(refunds, ({ one }) => ({
  paymentTransaction: one(paymentTransactions, {
    fields: [refunds.paymentTransactionId],
    references: [paymentTransactions.id],
  }),
  returnRequest: one(returnRequests, {
    fields: [refunds.returnRequestId],
    references: [returnRequests.id],
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

// PHASE 11: Product Catalog relations
export const productCategoriesRelations = relations(productCategories, ({ many }) => ({
  brands: many(productBrands),
  products: many(products),
}));

export const productBrandsRelations = relations(productBrands, ({ one, many }) => ({
  category: one(productCategories, {
    fields: [productBrands.categoryId],
    references: [productCategories.id],
  }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  productCategory: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  brand: one(productBrands, {
    fields: [products.brandId],
    references: [productBrands.id],
  }),
  variants: many(productVariants),
  productImages: many(productImages),
  cartItems: many(cartItems),
  productOrders: many(productOrders),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  images: many(productImages),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [productImages.variantId],
    references: [productVariants.id],
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
  updatedAt: true,
});

// PHASE 11: Product Catalog schemas
export const insertProductCategorySchema = createInsertSchema(productCategories).omit({
  id: true,
  createdAt: true,
});

export const insertProductBrandSchema = createInsertSchema(productBrands).omit({
  id: true,
  createdAt: true,
});

export const insertProductVariantSchema = createInsertSchema(productVariants).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProductImageSchema = createInsertSchema(productImages).omit({
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



// PHASE 2: Platform config and audit logs schemas
export const insertPlatformConfigSchema = createInsertSchema(platformConfig);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

// PHASE 7: Support ticket schemas
export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  ticketId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTicketMessageSchema = createInsertSchema(ticketMessages).omit({
  id: true,
  createdAt: true,
});

// PHASE 5: Service charge and shipment schemas
export const insertServiceChargeSchema = createInsertSchema(serviceCharges).omit({
  id: true,
  createdAt: true,
});

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertServiceOtpSchema = createInsertSchema(serviceOtps).omit({
  id: true,
  createdAt: true,
});

// PHASE 8: Rating schema
export const insertRatingSchema = createInsertSchema(ratings).omit({
  id: true,
  createdAt: true,
});

// PHASE 9: Social Auth & Notifications schemas
export const insertSocialAuthSchema = createInsertSchema(socialAuthProviders).omit({
  id: true,
  createdAt: true,
});

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
  isRead: true,
});

// PHASE 10: Payment transaction, return request, refund schemas
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReturnRequestSchema = createInsertSchema(returnRequests).omit({
  id: true,
  requestId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRefundSchema = createInsertSchema(refunds).omit({
  id: true,
  refundId: true,
  createdAt: true,
  updatedAt: true,
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

// PHASE 11: Product Catalog types
export type ProductCategory = typeof productCategories.$inferSelect;
export type InsertProductCategory = z.infer<typeof insertProductCategorySchema>;

export type ProductBrand = typeof productBrands.$inferSelect;
export type InsertProductBrand = z.infer<typeof insertProductBrandSchema>;

export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = z.infer<typeof insertProductVariantSchema>;

export type ProductImage = typeof productImages.$inferSelect;
export type InsertProductImage = z.infer<typeof insertProductImageSchema>;

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

// PHASE 7: Support types
export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;

export type TicketMessage = typeof ticketMessages.$inferSelect;
export type InsertTicketMessage = z.infer<typeof insertTicketMessageSchema>;

// PHASE 5: Service charge and shipment types
export type ServiceCharge = typeof serviceCharges.$inferSelect;
export type InsertServiceCharge = z.infer<typeof insertServiceChargeSchema>;

export type Shipment = typeof shipments.$inferSelect;
export type InsertShipment = z.infer<typeof insertShipmentSchema>;

export type ServiceOtp = typeof serviceOtps.$inferSelect;
export type InsertServiceOtp = z.infer<typeof insertServiceOtpSchema>;

// PHASE 8: Rating types
export type Rating = typeof ratings.$inferSelect;
export type InsertRating = z.infer<typeof insertRatingSchema>;

// PHASE 9: Social Auth & Notification types
export type SocialAuthProvider = typeof socialAuthProviders.$inferSelect;
export type InsertSocialAuth = z.infer<typeof insertSocialAuthSchema>;

export type DeviceToken = typeof deviceTokens.$inferSelect;
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

// PHASE 10: Payment, Return, Refund types
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;

export type ReturnRequest = typeof returnRequests.$inferSelect;
export type InsertReturnRequest = z.infer<typeof insertReturnRequestSchema>;

export type Refund = typeof refunds.$inferSelect;
export type InsertRefund = z.infer<typeof insertRefundSchema>;

// PHASE 12: Refresh Tokens — persisted in DB instead of in-memory Map
export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of the refresh token
  userRole: text("user_role").notNull(), // 'user', 'serviceman', 'admin'
  deviceInfo: text("device_info"), // Optional: device identifier for multi-device support
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  tokenHashIdx: uniqueIndex("refresh_tokens_hash_idx").on(table.tokenHash),
  userIdx: index("refresh_tokens_user_idx").on(table.userId),
  expiresIdx: index("refresh_tokens_expires_idx").on(table.expiresAt),
}));

export const insertRefreshTokenSchema = createInsertSchema(refreshTokens).omit({
  id: true,
  createdAt: true,
});

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
