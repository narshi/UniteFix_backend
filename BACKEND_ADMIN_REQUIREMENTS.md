# UniteFix — Backend & Admin Dashboard Requirements Document
### For Emergent AI Development Reference

> **Version:** 3.0 (Audited)  
> **Date:** 2026-02-15  
> **Overall Backend+Admin Completion: 58%**  
> **Tech Stack:** Node.js · Express · PostgreSQL · Drizzle ORM · React · Radix UI · Razorpay

---

## ⚠️ CRITICAL: Architecture Issue — Dead Route Files

The server entry point (`server/index.ts`) only calls `registerRoutes(app)` from `server/routes.ts`. **Four additional route files exist in `server/routes/` but are NEVER imported or registered:**

| Dead File | Contains | Impact |
|-----------|----------|--------|
| `server/routes/admin.routes.ts` | Advanced admin: reassign, force-transition, technician performance, support tickets, Delhivery shipping | All 15+ endpoints unreachable |
| `server/routes/payment.routes.ts` | Service charge entry, final payment, Razorpay webhook, customer invoice | Payment flow broken |
| `server/routes/product.routes.ts` | Enhanced product CRUD, checkout with row-locking, admin product mgmt | Advanced product features dead |
| `server/routes/otp.routes.ts` | OTP route enhancements | Not served |

**FIX REQUIRED:** Import and register these in `server/index.ts` or merge into `server/routes.ts`.

### Missing Database Tables

These tables are referenced in service code but **do not exist** in `shared/schema.ts`:

| Missing Table | Referenced By | SQL Will Crash |
|---------------|--------------|----------------|
| `support_tickets` | `server/services/support.service.ts` | ✅ Yes |
| `ticket_messages` | `server/services/support.service.ts` | ✅ Yes |
| `service_charges` | `server/routes/payment.routes.ts` | ✅ Yes |
| `shipments` | `server/services/admin-order.manager.ts` | ✅ Yes |

**FIX REQUIRED:** Add these tables to `shared/schema.ts` and run migrations.

---

## 1. System Architecture

### 1.1 Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| Database | PostgreSQL (Neon Serverless) |
| ORM | Drizzle ORM |
| Validation | Zod |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Payments | Razorpay SDK |
| Admin UI | React 18 + Radix UI + Tailwind CSS |
| Charts | Recharts |

### 1.2 Project Structure
```
UniteFix_backend/
├── server/
│   ├── index.ts                      # Entry point — ONLY registers routes.ts
│   ├── routes.ts                     # ✅ ACTIVE: Main API routes (1297 lines)
│   ├── storage.ts                    # ✅ ACTIVE: DB operations (1505 lines)
│   ├── db.ts                         # ✅ Database connection
│   ├── business/
│   │   ├── booking-state-machine.ts  # ✅ State transitions
│   │   └── state-mapping.ts          # ✅ Legacy ↔ canonical state mapping
│   ├── config/
│   │   ├── default-config.ts         # ✅ Platform config defaults
│   │   └── rate-limit-config.ts      # ⚠️ Config exists, not applied
│   ├── services/
│   │   ├── payment.service.ts        # ✅ Razorpay logic (works internally)
│   │   ├── config.service.ts         # ✅ Config with caching
│   │   ├── otp.service.ts            # ⚠️ Logic works, console-only delivery
│   │   ├── product.service.ts        # ⚠️ Full service, routes NOT registered
│   │   ├── support.service.ts        # ❌ Service exists, DB tables missing
│   │   ├── admin-service.manager.ts  # ⚠️ Full service, routes NOT registered
│   │   ├── admin-order.manager.ts    # ⚠️ Full service, routes NOT registered
│   │   └── task_queues.ts            # ❌ Dummy file (empty export)
│   └── routes/                       # ❌ NONE OF THESE ARE REGISTERED
│       ├── admin.routes.ts           # Dead code
│       ├── otp.routes.ts             # Dead code
│       ├── payment.routes.ts         # Dead code
│       └── product.routes.ts         # Dead code
├── client/src/pages/                 # Admin dashboard (React)
├── shared/schema.ts                  # DB schema (580 lines)
└── Figma/                            # App design references
```

---

## 2. Database Schema

### 2.1 Tables That EXIST in Schema (20 tables)
| Table | Status | Notes |
|-------|--------|-------|
| `users` | ✅ Working | phone, email, password, role, referralCode |
| `adminUsers` | ✅ Working | username, email, password, role |
| `serviceProviders` | ✅ Working | userId FK, partnerId, walletBalance, GPS |
| `serviceRequests` | ✅ Working | Full booking model with state machine |
| `products` | ✅ Working | name, price, category, stock |
| `productOrders` | ✅ Working | orderId, products JSON, status |
| `cartItems` | ✅ Working | userId, productId, quantity |
| `invoices` | ✅ Working | GST breakdown, amounts |
| `otpVerifications` | ✅ Working | phone/email, otp, purpose, expiry |
| `serviceablePincodes` | ✅ Working | 581xxx validation |
| `districts` | ✅ Working | name, state, isActive |
| `walletTransactions` | ✅ Working | Legacy v1 wallet |
| `platformConfig` | ✅ Working | Key-value config store |
| `auditLogs` | ✅ Working | Entity-based audit trail |
| `partnerWallets` | ✅ Schema + Storage | balanceHold, balanceAvailable, totalEarned |
| `walletTransactionsV2` | ✅ Schema + Storage | hold_credit, release, withdraw types |
| `inventoryItems` | ✅ Schema + Storage | itemCode, currentStock, minStockLevel |
| `inventoryTransactions` | ✅ Schema + Storage | consumption tracking with snapshots |

### 2.2 Tables MISSING from Schema (Referenced in Dead Code)
| Table | Needed By | Priority |
|-------|-----------|----------|
| `support_tickets` | support.service.ts | 🔴 High |
| `ticket_messages` | support.service.ts | 🔴 High |
| `service_charges` | payment.routes.ts | 🔴 High |
| `shipments` | admin-order.manager.ts | 🟡 Medium |

### 2.3 Tables NOT YET Created (From App Requirements)
| Table | Purpose | Priority |
|-------|---------|----------|
| `ratings` | Service ratings 1-5 stars | 🔴 Critical |
| `deviceTokens` | Push notification FCM/APNS tokens | 🟡 Medium |
| `notifications` | In-app notification store | 🟡 Medium |
| `userPreferences` | App settings per user | 🟢 Low |
| `socialAuthProviders` | Google/Facebook OAuth links | 🔴 Critical |

---

## 3. API Endpoints — HONEST Status

### 3.1 WORKING (In `routes.ts` — Actually Registered & Functional)

#### Authentication (5 endpoints)
| Method | Endpoint | Status |
|--------|----------|--------|
| POST | `/api/auth/signup` | ✅ Working |
| POST | `/api/auth/login` | ✅ Working |
| POST | `/api/admin/auth/login` | ✅ Working |
| POST | `/api/admin/auth/register` | ✅ Working |
| POST | `/api/auth/serviceman/login` | ✅ Working |

**NOT Built:** Forgot password, social login, token refresh

#### Admin Dashboard (20 endpoints)
| Method | Endpoint | Status |
|--------|----------|--------|
| GET | `/api/admin/stats` | ✅ Working |
| GET | `/api/admin/revenue/chart` | ✅ Working |
| GET | `/api/admin/users` | ✅ Working |
| PATCH | `/api/admin/users/:id/status` | ✅ Working |
| GET | `/api/admin/servicemen/list` | ✅ Working |
| GET | `/api/admin/servicemen/nearby` | ✅ Working |
| POST | `/api/admin/servicemen/create` | ✅ Working |
| POST | `/api/admin/servicemen/:id/approve` | ✅ Working |
| POST | `/api/admin/servicemen/:id/suspend` | ✅ Working |
| POST | `/api/admin/servicemen/:id/topup` | ✅ Working |
| GET | `/api/admin/servicemen/:id/transactions` | ✅ Working |
| GET | `/api/admin/services` | ✅ Working (basic) |
| GET | `/api/admin/services/recent` | ✅ Working |
| GET | `/api/admin/services/pending` | ✅ Working |
| POST | `/api/admin/requests/assign` | ✅ Working |
| PATCH | `/api/admin/services/:id/status` | ✅ Working |
| GET | `/api/admin/orders` | ✅ Working |
| GET/POST | `/api/admin/pincodes/*` | ✅ Working (4 endpoints) |
| GET/POST | `/api/admin/districts/*` | ✅ Working (3 endpoints) |
| GET | `/api/admin/invoices/*` | ✅ Working (3 endpoints) |

#### Client/User APIs (10 endpoints)
| Method | Endpoint | Status |
|--------|----------|--------|
| POST | `/api/services/create` | ✅ Working |
| GET | `/api/services/my-requests` | ✅ Working |
| POST | `/api/services/:id/cancel` | ✅ Working |
| GET | `/api/products/list` | ✅ Working (basic) |
| POST | `/api/orders/place` | ✅ Working |
| GET | `/api/cart` | ✅ Working |
| POST | `/api/cart/add` | ✅ Working |
| DELETE | `/api/cart/:id` | ✅ Working |
| POST | `/api/validate-pincode` | ✅ Working |
| POST | `/api/otp/send` & `/verify` | ✅ Works (console only) |

#### Serviceman APIs (5 endpoints)
| Method | Endpoint | Status |
|--------|----------|--------|
| POST | `/api/serviceman/location/update` | ✅ Working |
| GET | `/api/serviceman/assignments` | ✅ Working |
| POST | `/api/service/verify-handshake` | ✅ Working |
| POST | `/api/service/start` | ✅ Working (geo-fenced) |
| POST | `/api/service/complete` | ✅ Working (ACID) |

**TOTAL WORKING: ~40 endpoints**

### 3.2 DEAD CODE (Routes exist but NOT registered)

#### From `routes/admin.routes.ts` (10 endpoints — dead)
- `GET /api/admin/services/:id` — Service details with history
- `POST /api/admin/services/:id/assign` — Enhanced assign
- `POST /api/admin/services/:id/reassign` — Reassign technician
- `POST /api/admin/services/:id/force-transition` — Admin override
- `GET /api/admin/reports/services` — Service statistics
- `GET /api/admin/technicians/:id/performance` — Performance metrics
- `GET /api/admin/tickets` — Support ticket list
- `GET /api/admin/tickets/:ticketId` — Ticket details
- `POST /api/admin/tickets/:ticketId/reply` — Reply to ticket
- `PUT /api/admin/tickets/:ticketId/status` — Update ticket status
- `POST /api/customer/tickets` — Create ticket
- `POST /api/admin/orders/:orderId/create-shipment` — Delhivery
- `GET /api/customer/orders/:orderId/tracking` — Order tracking

#### From `routes/payment.routes.ts` (5 endpoints — dead)
- `POST /api/services/create-with-payment` — Service + Razorpay order
- `POST /api/technician/services/:id/enter-service-charge` — Enter charge
- `POST /api/customer/services/:id/create-final-payment` — Final payment
- `POST /api/webhooks/razorpay` — Webhook handler
- `GET /api/customer/services/:id/invoice` — Get invoice

#### From `routes/product.routes.ts` (10+ endpoints — dead)
- Enhanced product CRUD with row-locking checkout
- Admin product management (create, update, delete, stock)
- Category management

### 3.3 NOT Built At All
| Feature | Endpoints Needed | Priority |
|---------|-----------------|----------|
| Password reset | 3 endpoints | 🔴 Critical |
| Social auth (Google/FB) | 4 endpoints | 🔴 Critical |
| Partner accept/deny | 2 endpoints | 🔴 Critical |
| Rating system | 5 endpoints | 🔴 Critical |
| Profile picture upload | 3 endpoints | 🟡 High |
| Account deletion | 1 endpoint | 🟡 High |
| Wallet V2 user APIs | 4 endpoints (balance, history, withdraw) | 🟡 High |
| Inventory admin APIs | 4 endpoints (list, restock, alerts) | 🟡 High |
| Push notifications | 5 endpoints | 🟡 Medium |

---

## 4. Business Logic (Implemented & Working)

### 4.1 Booking State Machine ✅
```
CREATED → ASSIGNED → ACCEPTED → IN_PROGRESS → COMPLETED
   ↓         ↓          ↓            ↓              ↓
CANCELLED CANCELLED  CANCELLED   DISPUTED       DISPUTED
```
- `validateStateTransition()` enforces allowed transitions
- OTP required for ACCEPTED → IN_PROGRESS
- Payment verification required for IN_PROGRESS → COMPLETED
- Wallet credit on COMPLETED (hold → release after 7 days)
- Inventory deduction on COMPLETED (if items provided)
- Full audit logging on every transition

### 4.2 Platform Configuration ✅
| Key | Default | Category |
|-----|---------|----------|
| BASE_SERVICE_FEE | ₹250 | BUSINESS |
| PARTNER_SHARE_PERCENTAGE | 50% | BUSINESS |
| MIN_WALLET_REDEMPTION | ₹500 | BUSINESS |
| WALLET_HOLD_DAYS | 7 days | BUSINESS |
| CANCELLATION_FEE_PERCENTAGE | 20% | BUSINESS |
| MAX_SERVICE_START_DISTANCE | 500m | OPERATIONAL |
| PARTNER_ACCEPT_TIMEOUT_HOURS | 24h | OPERATIONAL |
| MAX_PHOTOS_PER_REQUEST | 5 | OPERATIONAL |
| ENABLE_AUTO_ASSIGNMENT | false | OPERATIONAL |

Config service has in-memory caching (5-min TTL) and DB persistence.

### 4.3 Wallet V2 Storage Layer ✅ (No API Exposure)
- `getOrCreatePartnerWallet()` — Auto-create on first use
- `creditWalletOnHold()` — With idempotency check
- `releaseHeldBalance()` — HOLD → AVAILABLE transfer
- `releaseAllExpiredHolds()` — Cron-ready batch release
- **Missing:** No API endpoints for partner to view balance or request withdrawal

### 4.4 Inventory Storage Layer ✅ (No Admin CRUD)
- `getInventoryItemByCode()` — Lookup
- `deductInventoryForBooking()` — With idempotency + stock floor check + low-stock warnings
- **Missing:** No restock endpoint, no admin CRUD, no list/search

### 4.5 Payment Service ✅ (Routes Not Registered)
- `createBookingOrder()` — ₹250 Razorpay order
- `createFinalPaymentOrder()` — Variable amount
- `calculateInvoice()` — Booking + Service + GST (18%)
- `verifyWebhookSignature()` — HMAC verification
- `handleWebhook()` — Payment status updates
- `isFinalPaymentVerified()` — COMPLETED gate check
- `generateInvoice()` — Creates invoice record
- **Missing:** Routes not registered; `service_charges` table not in schema

---

## 5. Admin Dashboard UI (React)

| Page | Route | Status |
|------|-------|--------|
| Admin Login | `/admin-login` | ✅ Working |
| Dashboard | `/dashboard` | ✅ Working |
| Users | `/users` | ✅ Working |
| Service Partners | `/partners` | ✅ Working |
| Services | `/services` | ✅ Working |
| Orders | `/orders` | ✅ Working |
| Payments | `/payments` | ✅ Working |
| Locations | `/locations` | ✅ Working |
| Settings | `/settings` | ✅ Working |
| Developer | `/developer` | ✅ Working |

**Dashboard UI is ~90% complete.** Main gaps are support ticket management page and advanced analytics views.

---

## 6. What Must Be Built — Priority Order

### 🔴 P0: Fix Broken Infrastructure (Week 1)
| # | Task | Effort | Details |
|---|------|--------|---------|
| 1 | **Register dead route files** | 1 day | Import `admin.routes.ts`, `payment.routes.ts`, `product.routes.ts`, `otp.routes.ts` in index.ts |
| 2 | **Add missing DB tables** | 1-2 days | `support_tickets`, `ticket_messages`, `service_charges`, `shipments` in schema.ts + migration |
| 3 | **OTP delivery provider** | 1-2 days | Replace console.log with Twilio/MSG91 for actual SMS/email delivery |

### 🔴 P1: Critical Features (Weeks 2-3)
| # | Task | Effort | Details |
|---|------|--------|---------|
| 4 | **Password reset flow** | 2-3 days | forgot-password → verify-otp → reset-password endpoints |
| 5 | **Social login (Google/FB)** | 4-5 days | OAuth2 integration, socialAuthProviders table |
| 6 | **Partner accept/deny** | 2 days | Accept/deny assigned service requests |
| 7 | **Rating system** | 3-4 days | New ratings table + CRUD + average calculation |
| 8 | **Profile picture upload** | 2 days | File upload + cloud storage (S3/Cloudinary) |

### 🟡 P2: Important (Weeks 3-5)
| # | Task | Effort | Details |
|---|------|--------|---------|
| 9 | **Wallet V2 API endpoints** | 2-3 days | Partner balance view, withdrawal request, history |
| 10 | **Inventory admin CRUD** | 2-3 days | List, restock, search, low-stock alerts |
| 11 | **Invoice PDF generation** | 2 days | PDF rendering + download endpoint |
| 12 | **Account deletion** | 1 day | Soft-delete + 30-day purge |
| 13 | **Push notifications** | 5-7 days | FCM/APNS + deviceTokens + notifications tables |

### 🟢 P3: Post-Launch (Weeks 5+)
| # | Task | Effort |
|---|------|--------|
| 14 | Rate limiting | 2 days |
| 15 | WebSocket real-time | 5+ days |
| 16 | Chat messaging | 5+ days |
| 17 | Testing suite | 7-10 days |
| 18 | CI/CD pipeline | 2-3 days |

---

## 7. Security Status

| Measure | Status |
|---------|--------|
| Password hashing (bcrypt) | ✅ |
| JWT with expiry | ✅ (8h admin, 30d user) |
| Role-based middleware | ✅ |
| Input validation (Zod) | ✅ |
| SQL injection prevention (ORM) | ✅ |
| Error handler (JSON-only) | ✅ |
| Rate limiting | ❌ Config exists, not applied |
| HTTPS enforcement | ❌ |
| CSRF/XSS protection | ❌ |
| Security headers (Helmet) | ❌ |
| File upload validation | ❌ |
| OAuth token encryption | ❌ |

---

## 8. Environment Variables
```env
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
RAZORPAY_KEY_ID=rzp_...
RAZORPAY_KEY_SECRET=...
SMTP_HOST=smtp.gmail.com  # For support ticket emails
SMTP_USER=...
SMTP_PASS=...
ADMIN_EMAIL=admin@unitefix.com
NODE_ENV=development
PORT=3000
```

---

*Version 3.0 — Audited. Route registration gaps and missing tables identified.*
