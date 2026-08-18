import { pgTable, text, serial, integer, boolean, timestamp, json, jsonb, doublePrecision, decimal, index, uniqueIndex, pgEnum, varchar, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums for better data integrity
export const userRoleEnum = pgEnum('user_role', ['user', 'admin', 'serviceman']);
export const verificationStatusEnum = pgEnum('verification_status', ['pending', 'verified', 'rejected', 'suspended']);
export const withdrawalStatusEnum = pgEnum("withdrawal_status", ["pending", "processing", "completed", "failed", "rejected"]);
// PHASE 2: Updated booking state machine - normalized states
export const serviceStatusEnum = pgEnum('service_status', [
  'created',          // User creates service request, pays ₹99
  'assigned',         // Admin assigns employee
  'accepted',         // Employee accepts, backend generates 6-digit handshakeOtp
  'reached',          // Employee marked arrived, PostGIS validates < 200m
  'in_progress',      // Employee verified handshakeOtp from customer
  'pending_payment',  // Employee submitted bill, waiting on customer to pay
  'completed',        // Final Razorpay transaction successful
  'cancelled',        // Customer cancelled (only from CREATED)
  'disputed'          // Dispute raised (from IN_PROGRESS, PENDING_PAYMENT, or COMPLETED)
]);
export const serviceItemStatusEnum = pgEnum('service_item_status', [
  'ACTIVE',
  'COMING_SOON',
  'DISABLED',
  'MAINTENANCE'
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
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'in_progress', 'escalated', 'resolved', 'closed']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'urgent']);
export const ticketCategoryEnum = pgEnum('ticket_category', ['service', 'product', 'payment', 'general']);
// PHASE 5: Shipment status enum
export const shipmentStatusEnum = pgEnum('shipment_status', ['created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'returned']);
// PHASE 8: Payment method + service value tier
export const paymentMethodEnum = pgEnum('payment_method', ['online', 'cash', 'pending']);
export const serviceValueTierEnum = pgEnum('service_value_tier', ['standard', 'high_value']);

// Users table - handles all user types
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  phone: text("phone").unique(),
  email: text("email"),
  password: text("password"),              // Nullable: Truecaller users authenticate via phone
  username: text("username"),
  profilePicture: text("profile_picture"), // CDN URL for avatar
  role: userRoleEnum("role").notNull().default('user'),
  referralCode: text("referral_code").unique(),
  referredById: integer("referred_by_id"),
  homeAddress: text("home_address"),
  pinCode: text("pin_code"),
  // Auth verification fields
  truecallerId: text("truecaller_id").unique(),  // Truecaller OAuth identity
  phoneVerified: boolean("phone_verified").default(false),
  emailVerified: boolean("email_verified").default(false),
  isVerified: boolean("is_verified").default(false),
  isActive: boolean("is_active").default(true),
  deletedAt: timestamp("deleted_at"), // Soft delete
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  phoneIdx: index("users_phone_idx").on(table.phone),
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
  roleIdx: index("users_role_idx").on(table.role),
  referralCodeIdx: uniqueIndex("users_referral_code_idx").on(table.referralCode),
  truecallerIdx: uniqueIndex("users_truecaller_id_idx").on(table.truecallerId),
}));

// Customers table — role-specific profile for users (role = 'user')
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id),
  fullName: text("full_name"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),              // 'male', 'female', 'other'
  alternatePhone: text("alternate_phone"),
  preferredLanguage: text("preferred_language").default('en'),
  loyaltyPoints: integer("loyalty_points").default(0),
  totalBookings: integer("total_bookings").default(0),
  totalSpent: decimal("total_spent", { precision: 12, scale: 2 }).default('0.00'),
  savedAddresses: jsonb("saved_addresses"), // [{ label, address, lat, long, pinCode }]
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdx: uniqueIndex("customers_user_id_idx").on(table.userId),
}));

// Employees table — UNIFIED partner profile (role = 'serviceman')
// PHASE 1: Consolidated from employees + serviceProviders (AI_CONTEXT §1.1)
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique().references(() => users.id),
  fullName: text("full_name"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  // KYC Documents
  aadhaarNumber: text("aadhaar_number"),
  panNumber: text("pan_number"),
  aadhaarDocUrl: text("aadhaar_doc_url"),
  panDocUrl: text("pan_doc_url"),
  profilePhotoUrl: text("profile_photo_url"),
  // Professional Info
  experienceYears: integer("experience_years").default(0),
  qualifications: text("qualifications"),
  emergencyContact: text("emergency_contact"),
  // Banking
  bankAccountNumber: text("bank_account_number"),
  bankIfsc: text("bank_ifsc"),
  bankName: text("bank_name"),
  upiId: text("upi_id"),
  // Verification
  documentVerificationStatus: verificationStatusEnum("document_verification_status").notNull().default('pending'),
  documentVerifiedAt: timestamp("document_verified_at"),
  documentVerifiedBy: integer("document_verified_by"),
  adminRemarks: text("admin_remarks"),
  // Razorpay Payouts
  razorpayContactId: text("razorpay_contact_id"),
  razorpayFundAccountId: text("razorpay_fund_account_id"),
  // Performance
  totalServicesCompleted: integer("total_services_completed").default(0),
  averageRating: decimal("average_rating", { precision: 3, scale: 2 }).default('0.00'),
  // === MERGED FROM serviceProviders (Phase 1) ===
  partnerId: text("partner_id").unique(),
  partnerType: text("partner_type").default('Individual'),
  businessName: text("business_name"),
  walletBalance: decimal("wallet_balance", { precision: 10, scale: 2 }).default('0'),
  skills: json("skills").$type<string[]>(),
  services: text("services").array(),
  // Location — stored as text for Drizzle compat; raw SQL uses geometry(Point, 4326)
  currentLocation: text("current_location"), // PostGIS geometry stored as WKT
  lastLocationUpdate: timestamp("last_location_update"),
  // Availability
  isActive: boolean("is_active").default(false),    // Admin-controlled
  isOnline: boolean("is_online").default(false),     // Employee self-toggle
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdx: uniqueIndex("employees_user_id_idx").on(table.userId),
  verificationIdx: index("employees_doc_verification_idx").on(table.documentVerificationStatus),
  partnerIdx: uniqueIndex("employees_partner_id_idx").on(table.partnerId),
  activeOnlineIdx: index("employees_active_online_idx").on(table.isActive, table.isOnline),
}));

// ========================================================================
// serviceProviders TABLE DELETED — AI_CONTEXT §1.1: "serviceProviders is dead"
// All partner data now lives in the `employees` table above.
// ========================================================================

// Service Requests table — PHASE 1 updated
export const serviceRequests = pgTable("service_requests", {
  id: serial("id").primaryKey(),
  serviceId: text("service_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id),
  providerId: integer("provider_id").references(() => employees.id), // PHASE 1: FK → employees (was serviceProviders)
  serviceType: text("service_type").notNull(),
  // The catalog service the customer selected — lets admin show its category and
  // exact service name (serviceType is only a free-text copy of the name).
  catalogServiceId: integer("catalog_service_id"),
  brand: text("brand"),
  model: text("model"),
  description: text("description").notNull(),
  photos: text("photos").array(),
  status: serviceStatusEnum("status").notNull().default('created'),
  handshakeOtp: text("handshake_otp"),          // 6-digit, generated on ACCEPTED
  bookingFee: integer("booking_fee").default(99), // PHASE 1: ₹99 (was ₹250)
  bookingFeeStatus: bookingFeeStatusEnum("booking_fee_status").default('pending'),
  totalAmount: integer("total_amount"),
  commissionAmount: integer("commission_amount"),
  // Location — stored as text for Drizzle compat; raw SQL uses geometry(Point, 4326)
  customerLocation: text("customer_location"), // PostGIS geometry as WKT
  address: text("address").notNull(),
  // Scheduling (AI_CONTEXT §3.I)
  preferredDate: text("preferred_date"),          // ISO date string
  preferredTimeSlot: text("preferred_time_slot"), // 'morning' | 'afternoon' | 'evening'
  // State timestamps
  assignedAt: timestamp("assigned_at"),
  reachedAt: timestamp("reached_at"),             // PHASE 1: When employee marked arrived
  reachedLat: doublePrecision("reached_lat"),     // GPS proof of arrival
  reachedLong: doublePrecision("reached_long"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  // PHASE 6: Admin audit trail
  adminNotes: text("admin_notes"),  // Override/dispute resolution log
  // BILLING: Frozen pricing snapshot — immutable once written
  // Phase 1 (booking creation): freezes bookingFee, platformFeePercent, gstPercent
  // Phase 2 (bill submission): freezes full billing breakdown
  pricingSnapshot: jsonb("pricing_snapshot"),
  // PHASE 8: Cash payment support
  paymentMethod: paymentMethodEnum("payment_method").default('pending'),
  serviceValueTier: serviceValueTierEnum("service_value_tier").default('standard'),
  cashCollectedBy: integer("cash_collected_by").references(() => employees.id),
  cashCollectedAt: timestamp("cash_collected_at"),
  // Urgency — set by customer when creating request
  urgency: text("urgency").default('normal'),  // 'normal' | 'urgent'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdIdx: index("service_requests_user_id_idx").on(table.userId),
  providerIdIdx: index("service_requests_provider_id_idx").on(table.providerId),
  statusIdx: index("service_requests_status_idx").on(table.status),
}));

// Wallet Transactions table - for audit trails
export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  providerId: integer("provider_id").notNull().references(() => employees.id), // PHASE 1: FK → employees
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

// PHASE 12: Service Catalog
export const serviceCategories = pgTable("service_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => serviceCategories.id),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  icon: text("icon"),
  bannerImage: text("banner_image"),
  // Fixed catalog price — the customer's all-in, GST-inclusive total (in ₹).
  // GST, platform fee and the booking charge are carved OUT of this; the
  // technician earns basePrice − gst − fee − bookingCharge. 0 = not yet priced.
  // See PRICING_ARCHITECTURE_PLAN.md.
  basePrice: integer("base_price").notNull().default(0),
  // Optional grouping within a category, shown as horizontal tabs in the app
  // (e.g. category "Computer" → sub-categories "Desktop" / "Laptop"). Null means
  // the service shows under the category's "All" tab only.
  subCategory: text("sub_category"),
  status: serviceItemStatusEnum("status").default('ACTIVE'),
  isHomeVisible: boolean("is_home_visible").default(true),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  categoryIdx: index("services_category_idx").on(table.categoryId),
  homeVisibleIdx: index("services_home_visible_idx").on(table.isHomeVisible),
}));

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
  providerId: integer("provider_id").references(() => employees.id), // PHASE 1: FK → employees
  // Money is decimal(10,2), not integer: v2 fixed-price bookings carve GST out
  // of the catalog price and land on paise (e.g. taxable 655.18, cgst 71.91).
  // As integers those were silently rounded, so the stored invoice disagreed
  // with the frozen snapshot and with what the customer actually paid.
  baseAmount: decimal("base_amount", { precision: 10, scale: 2 }).notNull(),
  cgst: decimal("cgst", { precision: 10, scale: 2 }).notNull(),
  sgst: decimal("sgst", { precision: 10, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 10, scale: 2 }).default('0'),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
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
  attempts: integer("attempts").default(0),
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
  partnerId: integer("partner_id").notNull().unique().references(() => employees.id), // PHASE 1: FK → employees
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
  partnerId: integer("partner_id").notNull().references(() => employees.id), // PHASE 1: FK → employees
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

export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => employees.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  method: text("method").notNull(), // 'bank' or 'upi'
  status: withdrawalStatusEnum("status").notNull().default("pending"),
  razorpayPayoutId: text("razorpay_payout_id"),
  failureReason: text("failure_reason"),
  paymentProofUrl: text("payment_proof_url"), // screenshot proof for manual payouts
  walletTransactionId: integer("wallet_transaction_id").references((): any => walletTransactionsV2.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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

// PHASE 5: Service Charges table (employee enters after service)
// PHASE 1: Updated with sparePartsCost + serviceLaborCost per AI_CONTEXT §3.C
export const serviceCharges = pgTable("service_charges", {
  id: serial("id").primaryKey(),
  serviceRequestId: integer("service_request_id").notNull().unique().references(() => serviceRequests.id),
  sparePartsCost: decimal("spare_parts_cost", { precision: 10, scale: 2 }).notNull().default('0'),
  serviceLaborCost: decimal("service_labor_cost", { precision: 10, scale: 2 }).notNull().default('0'),
  serviceAmount: decimal("service_amount", { precision: 10, scale: 2 }), // Legacy — computed: parts + labor
  partsUsed: text("parts_used"),
  technicianNotes: text("technician_notes"),
  enteredBy: integer("entered_by").notNull(), // Employee ID
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
  toProviderId: integer("to_provider_id").notNull().references(() => employees.id), // PHASE 1: FK → employees
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

// The trade list a service expert ticks during signup — "Electrician",
// "Computer Technician", "CCTV Technician" and so on.
//
// Deliberately NOT derived from service_categories. Those describe what the
// CUSTOMER is buying (Computer, PRINTER, CCTV…); this describes what the EXPERT
// does, in the words an expert would use about themselves. Keeping them apart
// means the customer-facing catalogue can be reorganised without disturbing how
// technicians describe their trade, and vice versa.
//
// `source` records who introduced the row. An expert who cannot find their trade
// adds it from the signup screen, and it lands here flagged 'expert' so an admin
// can rename, merge or remove it later rather than the list quietly filling with
// near-duplicates.
export const technicianTypes = pgTable("technician_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  source: text("source").notNull().default('admin'), // 'admin' | 'expert'
  /** employees.id of the expert who suggested it; null for admin-created rows. */
  suggestedBy: integer("suggested_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // Case-insensitive uniqueness is enforced by a lower(name) index in the
  // migration — Drizzle cannot express a functional index here, and without it
  // "Electrician" and "electrician" would both be creatable.
  activeSortIdx: index("technician_types_active_sort_idx").on(table.isActive, table.sortOrder),
}));

/**
 * Which trades can take work from a service category.
 *
 * Assignment needs to answer "who can do this job?", and until now the queue
 * compared employees.services (trade names, "Computer Technician") against
 * service_requests.service_type (catalog service names, "CCTV Installation").
 * Those are different vocabularies, so the match never fired and every expert
 * looked equally suitable.
 *
 * Mapped at CATEGORY level, not per service: services inside a category are
 * done by the same trades, so per-service rows would be admin busywork with no
 * extra signal. A category with no rows here means "no trade restriction known"
 * and every expert stays eligible — see resolveEligibleEmployeeIds.
 */
export const serviceCategoryTechnicianTypes = pgTable("service_category_technician_types", {
  categoryId: integer("category_id").notNull().references(() => serviceCategories.id, { onDelete: "cascade" }),
  technicianTypeId: integer("technician_type_id").notNull().references(() => technicianTypes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.categoryId, table.technicianTypeId] }),
  typeIdx: index("sctt_technician_type_idx").on(table.technicianTypeId),
}));

/**
 * An expert's trades, by id.
 *
 * employees.services stores trade NAMES, so renaming a type in the admin CRUD
 * page silently detached every expert holding it. This table is the durable
 * link; employees.services is kept in step as a display copy so existing
 * readers (admin table, CSV export, the app's profile screen) keep working.
 */
export const employeeTechnicianTypes = pgTable("employee_technician_types", {
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  technicianTypeId: integer("technician_type_id").notNull().references(() => technicianTypes.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.employeeId, table.technicianTypeId] }),
  typeIdx: index("ett_technician_type_idx").on(table.technicianTypeId),
}));

// Counter-sale bills raised at the shop for in-house visits.
//
// The invoice itself lives in `invoices` (so numbering, GST and the PDF path are
// shared with every other invoice); this table holds what `invoices` has no room
// for — the itemisation and who raised it. `invoices.service_request_id` and
// `product_order_id` are both null for these, which is how the PDF generator
// recognises a manual bill.
export const manualBills = pgTable("manual_bills", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  // [{ description, quantity, unitPrice, total }]
  items: jsonb("items").notNull(),
  notes: text("notes"),
  createdBy: integer("created_by"), // admin_users.id
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  invoiceIdx: index("manual_bills_invoice_idx").on(table.invoiceId),
}));

// Marketing broadcast history — one row per admin-sent campaign.
// `recipientCount` is how many users the audience resolved to; `deliveredCount`
// is how many DEVICES FCM accepted. They differ because a user can have zero
// devices (in-app only) or several.
export const notificationCampaigns = pgTable("notification_campaigns", {
  id: serial("id").primaryKey(),
  audience: text("audience").notNull(), // customers | experts | all
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link"),
  recipientCount: integer("recipient_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  sentBy: integer("sent_by"), // admin_users.id
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  createdIdx: index("notification_campaigns_created_idx").on(table.createdAt),
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
// Relations — PHASE 1: All serviceProviders references replaced with employees
export const usersRelations = relations(users, ({ many, one }) => ({
  serviceRequests: many(serviceRequests),
  productOrders: many(productOrders),
  cartItems: many(cartItems),
  customer: one(customers, {
    fields: [users.id],
    references: [customers.userId],
  }),
  employee: one(employees, {
    fields: [users.id],
    references: [employees.userId],
  }),
  referredBy: one(users, {
    fields: [users.referredById],
    references: [users.id],
  }),
}));

export const customersRelations = relations(customers, ({ one }) => ({
  user: one(users, {
    fields: [customers.userId],
    references: [users.id],
  }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  user: one(users, {
    fields: [employees.userId],
    references: [users.id],
  }),
  serviceRequests: many(serviceRequests),
  walletTransactions: many(walletTransactions),
}));

// serviceProvidersRelations DELETED — table no longer exists

export const serviceRequestsRelations = relations(serviceRequests, ({ one }) => ({
  user: one(users, {
    fields: [serviceRequests.userId],
    references: [users.id],
  }),
  employee: one(employees, {
    fields: [serviceRequests.providerId],
    references: [employees.id],
  }),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  employee: one(employees, {
    fields: [walletTransactions.providerId],
    references: [employees.id],
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

export const invoiceRelations = relations(invoices, ({ one }) => ({
  user: one(users, {
    fields: [invoices.userId],
    references: [users.id],
  }),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ many }) => ({
  services: many(services),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  category: one(serviceCategories, {
    fields: [services.categoryId],
    references: [serviceCategories.id],
  }),
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

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// insertServiceProviderSchema DELETED — serviceProviders table removed (Phase 1)

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

export const insertServiceCategorySchema = createInsertSchema(serviceCategories).omit({
  id: true,
  createdAt: true,
});

export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customers.$inferSelect;

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

// InsertServiceProvider and ServiceProvider types DELETED — serviceProviders table removed (Phase 1)

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

export const insertWithdrawalRequestSchema = createInsertSchema(withdrawalRequests).omit({
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
export type WalletTransactionV2 = typeof walletTransactionsV2.$inferSelect;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
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

export type NotificationCampaign = typeof notificationCampaigns.$inferSelect;
export type InsertNotificationCampaign = typeof notificationCampaigns.$inferInsert;

export type TechnicianType = typeof technicianTypes.$inferSelect;
export type InsertTechnicianType = typeof technicianTypes.$inferInsert;

export type ManualBill = typeof manualBills.$inferSelect;
export type InsertManualBill = typeof manualBills.$inferInsert;

/** One line on a counter-sale bill. */
export interface ManualBillItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

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

export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type InsertServiceCategory = z.infer<typeof insertServiceCategorySchema>;

export type ServiceItem = typeof services.$inferSelect;
export type InsertServiceItem = z.infer<typeof insertServiceSchema>;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
