# UniteFix — Backend & Admin Dashboard Requirements Document
### For Emergent AI Development Reference

> **Version:** 2.0  
> **Date:** 2026-02-15  
> **Region:** Uttara Kannada, Karnataka, India  
> **Tech Stack:** Node.js · Express · PostgreSQL · Drizzle ORM · React · Radix UI · Razorpay

---

## 1. System Architecture

### 1.1 Stack Overview
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Server Runtime | Node.js + TypeScript | Backend API server |
| Framework | Express.js | REST API routing |
| Database | PostgreSQL (Neon Serverless) | Persistent storage |
| ORM | Drizzle ORM | Type-safe DB operations |
| Validation | Zod | Request/input validation |
| Auth | JWT (jsonwebtoken) + bcrypt | Authentication & password hashing |
| Payments | Razorpay SDK | Payment processing |
| Admin UI | React 18 + Radix UI + Tailwind CSS | Admin dashboard |
| Charts | Recharts | Analytics visualization |
| Routing (UI) | Wouter | Client-side routing |

### 1.2 Project Structure
```
UniteFix_backend/
├── server/
│   ├── index.ts                    # Server entry point
│   ├── routes.ts                   # All API routes (1297 lines)
│   ├── storage.ts                  # Database operations layer
│   ├── db.ts                       # Database connection
│   ├── business/
│   │   ├── booking-state-machine.ts  # Service booking state transitions
│   │   └── state-mapping.ts          # State display mappings
│   ├── config/
│   │   ├── default-config.ts         # Platform configuration defaults
│   │   └── rate-limit-config.ts      # Rate limiting configuration
│   ├── services/
│   │   ├── payment.service.ts        # Razorpay integration
│   │   ├── config.service.ts         # Platform config management
│   │   ├── otp.service.ts            # OTP generation & verification
│   │   ├── product.service.ts        # Product management
│   │   ├── support.service.ts        # Support system
│   │   ├── admin-service.manager.ts  # Admin service operations
│   │   └── admin-order.manager.ts    # Admin order operations
│   ├── routes/
│   │   ├── admin.routes.ts           # Admin-specific routes
│   │   ├── otp.routes.ts             # OTP endpoints
│   │   ├── payment.routes.ts         # Payment endpoints
│   │   └── product.routes.ts         # Product endpoints
│   └── middleware/                   # Express middleware
├── client/src/
│   ├── pages/                        # Admin dashboard pages
│   │   ├── admin-login.tsx
│   │   ├── dashboard.tsx
│   │   ├── users.tsx
│   │   ├── partners.tsx
│   │   ├── services.tsx
│   │   ├── orders.tsx
│   │   ├── payments.tsx
│   │   ├── locations.tsx
│   │   └── settings.tsx
│   ├── components/                   # Reusable UI components (Radix-based)
│   ├── hooks/                        # React hooks
│   └── lib/                          # Utility functions
├── shared/
│   └── schema.ts                     # Database schema & types (580 lines)
└── Figma/                            # App design references
```

---

## 2. Database Schema (Implemented)

### 2.1 Core Tables (14 tables — all implemented)

#### users
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | serial | PK | Auto-increment |
| phone | text | NOT NULL, UNIQUE | Primary login identifier |
| email | text | — | Optional |
| password | text | NOT NULL | bcrypt hashed |
| username | text | — | Display name |
| role | enum | NOT NULL, default 'user' | 'user' / 'admin' / 'serviceman' |
| referralCode | text | UNIQUE | Auto-generated UF-prefix |
| referredById | integer | FK → users.id | Referral tracking |
| homeAddress | text | — | |
| pinCode | text | — | Checked against serviceable pincodes |
| isVerified | boolean | default false | Phone/email verification |
| isActive | boolean | default true | Account status |
| createdAt | timestamp | default now() | |
| updatedAt | timestamp | default now() | |

**Indexes:** phone, role, referralCode (unique)

#### serviceProviders
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | serial | PK | |
| userId | integer | NOT NULL, FK → users.id | Links to user account |
| partnerId | text | NOT NULL, UNIQUE | "SP00001" format |
| partnerName | text | NOT NULL | |
| businessName | text | — | Required for Business type |
| partnerType | text | NOT NULL, default 'Individual' | 'Individual' / 'Business' |
| walletBalance | decimal(10,2) | NOT NULL, default '0' | Legacy wallet |
| verificationStatus | enum | NOT NULL, default 'pending' | 'pending'/'verified'/'rejected'/'suspended' |
| currentLat / currentLong | double | — | Live location |
| skills | json | — | Skill tags |
| services | text[] | — | Service categories |
| location | text | — | Service area pincode |
| address | text | — | |
| isActive | boolean | default true | |
| lastLocationUpdate | timestamp | — | |

**Indexes:** userId, verificationStatus, (currentLat, currentLong)

#### serviceRequests
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | serial | PK | |
| serviceId | text | NOT NULL, UNIQUE | Human-readable ID |
| userId | integer | NOT NULL, FK → users.id | Customer |
| providerId | integer | FK → serviceProviders.id | Assigned partner |
| serviceType | text | NOT NULL | e.g. "AC Repair" |
| brand / model | text | — | Appliance details |
| description | text | NOT NULL | Problem description |
| photos | text[] | — | Image URLs |
| status | enum | NOT NULL, default 'placed' | See §3.1 State Machine |
| handshakeOtp | text | — | 4-digit verification |
| bookingFee | integer | default 250 | ₹250 base fee |
| bookingFeeStatus | enum | default 'pending' | 'pending'/'paid'/'refunded' |
| totalAmount | integer | — | Final service cost |
| commissionAmount | integer | — | Platform commission |
| locationLat/Long | double | — | Service location |
| address | text | NOT NULL | |
| assignedAt / startedAt / completedAt | timestamp | — | Lifecycle timestamps |

**Indexes:** userId, providerId, status, (locationLat, locationLong)

#### products
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| name | text | NOT NULL |
| description | text | |
| price | integer | NOT NULL, in INR |
| category | text | NOT NULL |
| stock | integer | default 0 |
| images | text[] | Image URLs |
| isActive | boolean | default true |

#### productOrders
| Column | Type | Notes |
|--------|------|-------|
| id | serial | PK |
| orderId | text | UNIQUE, human-readable |
| userId | integer | FK → users.id |
| products | json | Array of {productId, quantity} |
| status | enum | 'placed'→'confirmed'→'in_transit'→'out_for_delivery'→'delivered'/'cancelled' |
| totalAmount | integer | NOT NULL |
| address | text | NOT NULL |
| deliveryLat/Long | double | |

#### Other Core Tables
- **cartItems** — userId, productId, quantity
- **invoices** — Service/order invoices with CGST/SGST breakdown
- **otpVerifications** — phone/email, otp, purpose, expiresAt, isVerified
- **adminUsers** — username, email, password, role, lastLogin
- **walletTransactions** (v1) — Legacy provider wallet transactions
- **districts** — name, state, isActive
- **serviceablePincodes** — pincode (PK), area, district, districtId, isActive

### 2.2 Phase 2 Tables (Implemented in schema)
- **platformConfig** — Key-value configuration store with categories (BUSINESS_CONFIG / OPERATIONAL_CONFIG)
- **auditLogs** — Entity-based audit trail with state transitions

### 2.3 Phase 3 Tables (Schema ready, APIs pending)
- **partnerWallets** — Ledger-based wallet: balanceHold, balanceAvailable, totalEarned
- **walletTransactionsV2** — Enhanced transactions: hold_credit, release, withdraw_bank, withdraw_upi, refund, adjustment, commission_deduction
- **inventoryItems** — Platform-owned parts/items: itemCode, itemName, unit, unitCost, currentStock, minStockLevel
- **inventoryTransactions** — Consumption/restock audit trail with stock snapshots

---

## 3. Business Logic

### 3.1 Booking State Machine

```
CREATED → ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED
   ↓         ↓          ↓            ↓              ↓
CANCELLED CANCELLED  CANCELLED   DISPUTED       DISPUTED
```

| State | Description | Triggers |
|-------|-------------|----------|
| `created` | User submits service request | Booking fee charged (₹250) |
| `assigned` | Admin assigns a verified partner | Partner notified |
| `accepted` | Partner accepts the job | — |
| `in_progress` | Service work started | OTP verification required; geo-fence check (500m) |
| `completed` | Service finished | Wallet credit to partner; inventory deduction; invoice generated |
| `cancelled` | Cancelled by user/admin | Only before `in_progress`; cancellation fee applies |
| `disputed` | Under dispute | Terminal state; requires admin intervention |

**Locked Rules:**
- Cancel allowed only in: `created`, `assigned`, `accepted`
- OTP required for: `accepted` → `in_progress`
- Payment verification required for: `in_progress` → `completed`
- Wallet credit triggers ONLY on `completed`

### 3.2 Platform Configuration (Defaults)

| Key | Value | Category | Description |
|-----|-------|----------|-------------|
| BASE_SERVICE_FEE | ₹250 | BUSINESS | Booking fee |
| PARTNER_SHARE_PERCENTAGE | 50% | BUSINESS | Partner revenue share |
| MIN_WALLET_REDEMPTION | ₹500 | BUSINESS | Minimum withdrawal |
| WALLET_HOLD_DAYS | 7 | BUSINESS | Hold period before release |
| CANCELLATION_FEE_PERCENTAGE | 20% | BUSINESS | Cancellation penalty |
| MAX_SERVICE_START_DISTANCE | 500m | OPERATIONAL | Geo-fence radius |
| PARTNER_ACCEPT_TIMEOUT_HOURS | 24h | OPERATIONAL | Auto-reject timer |
| MAX_PHOTOS_PER_REQUEST | 5 | OPERATIONAL | Photo upload limit |
| ENABLE_AUTO_ASSIGNMENT | false | OPERATIONAL | Auto partner matching |

### 3.3 Commission & Payment Flow
1. **Booking Charge:** ₹250 collected upfront via Razorpay
2. **Service Charge:** Variable, entered by technician after service
3. **Invoice:** Subtotal = Booking + Service → GST 18% (9% CGST + 9% SGST) → Total
4. **Amount Due:** Total − Already Paid (₹250)
5. **Final Payment:** Via Razorpay, verified by webhook
6. **Partner Credit:** (Service Charge × Partner Share %) credited to wallet on HOLD
7. **Release:** After WALLET_HOLD_DAYS, HOLD → AVAILABLE
8. **Withdrawal:** Partner requests bank/UPI payout from AVAILABLE balance

---

## 4. API Endpoints (Implemented)

### 4.1 Authentication
| Method | Endpoint | Auth | Status |
|--------|----------|------|--------|
| POST | `/api/auth/signup` | — | ✅ |
| POST | `/api/auth/login` | — | ✅ |
| POST | `/api/admin/auth/login` | — | ✅ |
| POST | `/api/admin/auth/register` | — | ✅ |

### 4.2 Admin Dashboard
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/stats` | Dashboard statistics | ✅ |
| GET | `/api/admin/revenue/chart` | Revenue chart data | ✅ |
| GET | `/api/admin/users` | All users (paginated) | ✅ |
| PATCH | `/api/admin/users/:id/status` | Activate/deactivate user | ✅ |

### 4.3 Service Provider Management (Admin)
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/servicemen/list` | List providers (filter by status) | ✅ |
| GET | `/api/admin/servicemen/nearby` | Sort by distance | ✅ |
| POST | `/api/admin/servicemen/create` | Create partner (auto-verified) | ✅ |
| POST | `/api/admin/servicemen/:id/approve` | Verify partner | ✅ |
| POST | `/api/admin/servicemen/:id/suspend` | Suspend partner | ✅ |
| POST | `/api/admin/servicemen/:id/topup` | Top-up wallet | ✅ |
| GET | `/api/admin/servicemen/:id/transactions` | Wallet history | ✅ |

### 4.4 Service Request Management (Admin)
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/services` | All requests (paginated, filterable) | ✅ |
| GET | `/api/admin/services/recent` | Recent requests | ✅ |
| GET | `/api/admin/services/pending` | Pending assignments | ✅ |
| POST | `/api/admin/requests/assign` | Assign partner | ✅ |
| PATCH | `/api/admin/services/:id/status` | Update status | ✅ |

### 4.5 Order Management (Admin)
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/orders` | All orders (paginated) | ✅ |
| GET | `/api/admin/orders/recent` | Recent orders | ✅ |
| PATCH | `/api/admin/orders/:id/status` | Update order status | ✅ |

### 4.6 Location & Pincode Management
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/pincodes` | All serviceable pincodes | ✅ |
| POST | `/api/admin/pincodes` | Add pincode | ✅ |
| POST | `/api/admin/pincodes/toggle` | Toggle pincode status | ✅ |
| POST | `/api/validate-pincode` | Validate pincode | ✅ |
| GET | `/api/admin/districts` | All districts | ✅ |
| POST | `/api/admin/districts` | Add district | ✅ |
| PATCH | `/api/admin/districts/:id/toggle` | Toggle district | ✅ |
| GET | `/api/admin/location-stats` | Location statistics | ✅ |

### 4.7 Invoice Management
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| GET | `/api/admin/invoices` | All invoices | ✅ |
| GET | `/api/admin/invoices/all` | All invoices (paginated) | ✅ |
| GET | `/api/admin/invoices/:id` | Invoice details | ✅ |

### 4.8 User-Facing APIs
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/services/create` | Create service request | ✅ |
| GET | `/api/services/my-requests` | User's service requests | ✅ |
| POST | `/api/services/:id/cancel` | Cancel service | ✅ |
| GET | `/api/products/list` | Browse products (filter by category) | ✅ |
| POST | `/api/orders/place` | Place order | ✅ |
| GET | `/api/cart` | Get cart items | ✅ |
| POST | `/api/cart/add` | Add to cart | ✅ |
| DELETE | `/api/cart/:id` | Remove from cart | ✅ |
| POST | `/api/utils/validate-pincode` | Validate pincode | ✅ |

### 4.9 Serviceman APIs
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/serviceman/location/update` | Update GPS location | ✅ |
| GET | `/api/serviceman/assignments` | Get assigned jobs | ✅ |
| POST | `/api/service/verify-handshake` | Verify OTP | ✅ |
| POST | `/api/service/start` | Start service (geo-fenced) | ✅ |
| POST | `/api/service/complete` | Complete service (ACID) | ✅ |

### 4.10 OTP & Utilities
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/otp/send` | Send OTP | ✅ |
| POST | `/api/otp/verify` | Verify OTP | ✅ |
| POST | `/api/utils/generate-code` | Generate verification code | ✅ |

### 4.11 Payment Routes (via Razorpay)
| Method | Endpoint | Purpose | Status |
|--------|----------|---------|--------|
| POST | `/api/payments/create-order` | Create Razorpay order | ✅ |
| POST | `/api/payments/verify` | Verify payment | ✅ |
| POST | `/api/payments/webhook` | Razorpay webhook handler | ✅ |

---

## 5. Admin Dashboard UI (Implemented)

### 5.1 Pages
| Page | Route | Status | Features |
|------|-------|--------|----------|
| Admin Login | `/admin-login` | ✅ | Username/password authentication |
| Dashboard | `/dashboard` | ✅ | Stats cards, revenue chart, recent activity |
| Users | `/users` | ✅ | User list, search, activate/deactivate |
| Service Partners | `/partners` | ✅ | Partner list, verify/suspend, create new, wallet |
| Services | `/services` | ✅ | Service requests list, assign partner, status updates |
| Orders | `/orders` | ✅ | Product orders list, status management |
| Payments | `/payments` | ✅ | Transaction history |
| Locations | `/locations` | ✅ | Pincode/district management, toggle active |
| Settings | `/settings` | ✅ | Platform configuration |
| Developer | `/developer` | ✅ | Internal tools |

---

## 6. What Still Needs to Be Built

### 6.1 Critical (Blocks App Launch)

| # | Feature | Effort | Description |
|---|---------|--------|-------------|
| 1 | **Password Reset Flow** | 2-3 days | Send OTP → verify → reset password endpoints |
| 2 | **Social Login (Google/Facebook)** | 4-5 days | OAuth2 integration for mobile app |
| 3 | **Partner Accept/Deny APIs** | 2 days | Serviceman can accept or deny assigned requests |
| 4 | **Rating & Review System** | 3-4 days | New `ratings` table + CRUD APIs |
| 5 | **Profile Picture Upload** | 2 days | Image upload, cloud storage, CDN |
| 6 | **Invoice PDF Generation** | 2 days | Generate downloadable PDF invoices |
| 7 | **Account Deletion** | 1 day | GDPR-compliant account removal |

### 6.2 Important (Pre-Launch)

| # | Feature | Effort | Description |
|---|---------|--------|-------------|
| 8 | **Wallet V2 APIs** | 3-4 days | Full wallet transaction endpoints (schema exists) |
| 9 | **Inventory Consumption APIs** | 2-3 days | Auto-deduct on service completion (schema exists) |
| 10 | **Push Notifications** | 5-7 days | FCM/APNS + device token management + notification table |
| 11 | **Support Ticket System** | 3-4 days | Ticket creation, messaging, admin panel |
| 12 | **SMS/Email OTP Delivery** | 2-3 days | Integrate Twilio/MSG91 for actual delivery |

### 6.3 Post-Launch Enhancements

| # | Feature | Effort | Description |
|---|---------|--------|-------------|
| 13 | WebSocket real-time updates | 5+ days | Live tracking, status push |
| 14 | Chat between user & partner | 5+ days | Messaging infrastructure |
| 15 | Advanced analytics & exports | 3-4 days | CSV/PDF reports |
| 16 | Rate limiting | 2 days | Per-IP and per-user throttling |
| 17 | API versioning | 1-2 days | /api/v1/ prefix |
| 18 | CI/CD pipeline | 2-3 days | Automated testing & deployment |
| 19 | Testing suite | 7-10 days | Unit + integration + E2E tests |

---

## 7. Security Measures

### Implemented
- ✅ Password hashing (bcrypt, 10 rounds)
- ✅ JWT authentication with expiry (8h admin / 30d client)
- ✅ Role-based middleware (user / admin / serviceman)
- ✅ Input validation (Zod schemas)
- ✅ SQL injection prevention (Drizzle ORM)
- ✅ Error handling middleware
- ✅ Environment variable management (.env)

### Needs Implementation
- ❌ Rate limiting per IP/user
- ❌ HTTPS enforcement
- ❌ CSRF protection
- ❌ XSS sanitization
- ❌ Secure file upload validation
- ❌ OAuth token encryption at rest
- ❌ Security headers (Helmet.js)
- ❌ Audit logging for admin actions

---

## 8. Environment Configuration

```env
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
RAZORPAY_KEY_ID=rzp_...
RAZORPAY_KEY_SECRET=...
NODE_ENV=development
PORT=5000
```

---

*This document serves as the complete reference for the UniteFix Backend & Admin Dashboard system for the Emergent AI development team.*
