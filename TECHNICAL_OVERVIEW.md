# UniteFix — Comprehensive Technical Overview

> Generated 2026-07-26 from a full repository analysis. UniteFix is a home-services & product marketplace for the Uttara Kannada district (Karnataka, India). One monorepo contains the backend API, the admin dashboard, and the customer/partner mobile app.

---

## 1. Architecture

```
┌─────────────────────┐        ┌──────────────────────────┐
│  Mobile App (Expo)  │        │  Admin Dashboard (React) │
│  /mobile            │        │  /client (Vite + wouter) │
│  Customers+Partners │        │  served by same Express  │
└─────────┬───────────┘        └───────────┬──────────────┘
          │ REST (axios, JWT)              │ REST (JWT in localStorage)
          ▼                                ▼
┌─────────────────────────────────────────────────────────┐
│         Monolithic Express API  (/server, Node 20)      │
│  routes.ts (legacy mega-router) + /server/routes/*.ts   │
│  /server/services (business logic) /server/business     │
│  (state machine)  /server/repositories  /server/lib     │
│  Background jobs via setInterval (task_queues.ts)       │
└──────────┬───────────────┬──────────────┬───────────────┘
           ▼               ▼              ▼
   Neon Postgres      Razorpay /      Firebase (FCM push,
   + PostGIS          RazorpayX       Phone Auth verify),
   (Drizzle ORM)      (payments/      Truecaller OAuth,
                      payouts)        Cloudinary, Delhivery,
                                      SMTP, WhatsApp deep links
```

**Major components**

| Component | Path | Description |
|---|---|---|
| Backend API | `/server` | Express + TypeScript monolith. Serves REST API **and** the built admin dashboard (Vite dev middleware in dev, static `dist/` in prod). Entry: `server/index.ts`. |
| Shared schema | `/shared/schema.ts` | Single Drizzle ORM schema + Zod insert schemas + TS types, imported by server and admin client (`@shared/*` alias). |
| Mobile app | `/mobile` | React Native 0.81 / Expo SDK 54 app with two role-based experiences (Customer & Partner/serviceman) in one binary. |
| Admin dashboard | `/client` | React 18 SPA (wouter routing, shadcn/Radix UI, TanStack Query) for operations staff. |
| Migrations | `/migrations` + `drizzle.config.ts` | Drizzle-kit push workflow (`npm run db:push`) plus hand-written SQL migrations. |
| Scripts | `/scripts`, `/server/scripts` | Seeding (districts, pincodes, catalog, platform config, test data), DB reset, verification utilities. |
| E2E tests | `/e2e`, `playwright.config.ts` | Playwright tests against the admin dashboard/API. |

**Key architectural rules** (from `AI_CONTEXT.md`, enforced in code):
1. `serviceProviders` table is dead — all partners live in `employees`.
2. No WebSockets — geofencing is a REST + PostGIS `ST_DistanceSphere` check.
3. Truecaller SDK v3 is the primary auth (with Firebase Phone Auth fallback); no Twilio/MSG91 SMS.
4. **Trust no client math** — all billing computed server-side in `BillingEngine`.
5. Product ordering is **HALTED** — shop screens show "Coming Soon"; backend product routes remain but aren't exposed to end users.

---

## 2. Tech Stack

### Backend (`/package.json`, name `unitefix-backend`)
| Technology | Purpose |
|---|---|
| Node.js 20 + Express 4 + TypeScript (tsx dev, esbuild prod bundle) | HTTP API server |
| Drizzle ORM + drizzle-zod + drizzle-kit | Type-safe Postgres access, schema push, Zod validation |
| @neondatabase/serverless + pg pool | Neon serverless PostgreSQL (with PostGIS extension) |
| jsonwebtoken + bcrypt | JWT auth (access/refresh) and password hashing (admin + legacy password flows) |
| firebase-admin | Verifies Firebase Phone Auth ID tokens; sends FCM push notifications |
| razorpay SDK + raw axios | Payments (orders, dynamic UPI QR, refunds) and RazorpayX payouts |
| cloudinary + multer | Image upload pipeline (profile photos, service photos, KYC docs) |
| helmet, cors, express-rate-limit | Security headers, origin allowlist, per-audience rate limiting |
| zod + zod-validation-error | Request validation |
| pdfkit | PDF invoice generation (`invoice-generator.ts`) |
| nodemailer (SMTP) | Email (support tickets, email verification) |
| Winston-style custom logger (`lib/logger.ts`) | Structured logging with request IDs |

### Mobile (`/mobile/package.json`)
| Technology | Purpose |
|---|---|
| Expo SDK 54 / React Native 0.81 / React 19 | App runtime (expo-dev-client, prebuild → `mobile/android` Gradle project) |
| React Navigation 7 (native-stack + bottom-tabs) | Navigation, deep linking (`unitefix` scheme) |
| Zustand + expo-secure-store | Auth/session state persisted securely |
| TanStack Query 5 + axios | Server state, auto token-refresh interceptor |
| @react-native-firebase/app + auth | Firebase Phone Auth OTP fallback login |
| Custom `plugins/withTruecaller` config plugin | Truecaller SDK v3 OAuth (1-tap login) |
| react-native-razorpay | Razorpay checkout for booking fee & final payment |
| react-native-qrcode-svg, react-native-svg | QR rendering (partner-side dynamic payment QR) |
| react-native-maps + expo-location | Map address picker, GPS capture for geofence |
| expo-notifications | FCM push registration & handling |
| i18next / react-i18next + expo-localization | i18n — English (`en.json`) and Kannada (`kn.json`) |
| react-hook-form + zod | Form validation |
| lucide-react-native | Icons |

### Admin client (`/client`)
React 18, Vite 5, wouter (routing), TanStack Query, shadcn/ui (full Radix primitive set), Tailwind CSS 3 + tailwindcss-animate, recharts (revenue chart), framer-motion, lucide-react.

### External services
Neon Postgres (PostGIS), Razorpay (payments + webhooks), RazorpayX (payouts), Truecaller OAuth v3, Firebase (Phone Auth + FCM), Cloudinary (media CDN), Delhivery (shipping — mock/live toggle), SMTP email, WhatsApp Business deep links (support), Google Maps API.

---

## 3. Database Schema (`shared/schema.ts`)

### Identity & profiles
| Table | Purpose | Key relations |
|---|---|---|
| `users` | Unified identity for all roles. `role` enum: `user \| admin \| serviceman`. Holds phone (unique), email, optional password, `truecallerId`, referral code/`referredById`, soft-delete `deletedAt`. | 1:1 → `customers` or `employees` |
| `customers` | Customer profile: fullName, DOB, gender, `savedAddresses` (jsonb array), loyalty points, totals. | `userId` → users |
| `employees` | **Unified partner profile** (merged from dead `serviceProviders`). KYC (Aadhaar/PAN + doc URLs), banking (account/IFSC/UPI), `documentVerificationStatus` (pending/verified/rejected/suspended), Razorpay contact/fund-account IDs, skills/services arrays, `currentLocation` (PostGIS point as WKT), `isActive` (admin-controlled) + `isOnline` (self toggle), performance stats, legacy `walletBalance`. | `userId` → users |
| `adminUsers` | Separate admin credential table (username/email/bcrypt password, role admin/super_admin). | — |
| `refreshTokens` | SHA-256-hashed refresh tokens, per-user, per-device, expiring (30d). | `userId` → users |
| `socialAuthProviders` | Google/Facebook OAuth links (schema present; flows mostly unused). | `userId` → users |

### Service bookings (core domain)
| Table | Purpose |
|---|---|
| `serviceRequests` | The booking. `serviceId` (text ID), customer `userId`, `providerId` → employees, serviceType/brand/model/description/photos, **`status`** (state machine below), `handshakeOtp` (6-digit), `bookingFee` (₹99) + `bookingFeeStatus`, `customerLocation` (PostGIS WKT), address, `preferredDate`/`preferredTimeSlot`, state timestamps (`assignedAt`, `reachedAt` + GPS proof lat/long, `startedAt`, `completedAt`), **`pricingSnapshot`** (immutable jsonb billing freeze), `paymentMethod` (online/cash/pending), `serviceValueTier` (standard/high_value ≥₹5k), cash-collection audit fields, urgency, `adminNotes`. |
| `serviceCharges` | Bill submitted by employee: `sparePartsCost` + `serviceLaborCost` (1:1 with booking). |
| `serviceOtps` | Handshake OTP records (generate/verify/expiry audit). |
| `ratings` | 1–5 stars + review, one per booking, customer → provider. |
| `serviceCategories` / `services` | Service catalog shown on the mobile home screen (status ACTIVE/COMING_SOON/DISABLED/MAINTENANCE, sortOrder, home visibility). |

### Booking state machine (`server/business/booking-state-machine.ts`)
```
created ──► assigned ──► accepted ──► reached ──► in_progress ──► pending_payment ──► completed
   │            (4h timeout auto-reverts to created)                      │                │
   └──► cancelled (ONLY from created; ₹99 refunded)                       └──► disputed ◄──┘
                                                     (disputed also reachable from in_progress)
```
Transition guards:
- `created → assigned`: admin assigns an eligible employee (`isOnline && isActive && verified`).
- `assigned → accepted`: employee accepts → backend generates 6-digit `handshakeOtp`. Not accepted in 4h (config `PARTNER_ACCEPT_TIMEOUT_HOURS`) → cron reverts to `created`.
- `accepted → reached`: **geofence** — PostGIS `ST_DistanceSphere` must be ≤ 200 m from `customerLocation`, else 403 with distance.
- `reached → in_progress`: employee enters the customer's handshake OTP.
- `in_progress → pending_payment`: employee submits bill (parts + labor) → BillingEngine freezes full snapshot.
- `pending_payment → completed`: gated by verified Razorpay payment (webhook / QR credit) **or** cash-collected flow.
- `completed` triggers: wallet hold-credit for employee earnings, invoice generation, rating prompt push.
- `cancelled` and `disputed` are terminal (disputes resolved by admin via override endpoints).

### Product commerce (built, currently HALTED for end users)
`productCategories` → `productBrands` → `products` → `productVariants` (SKU price/stock/threshold) → `productImages`; `cartItems`; `productOrders` (17-state `orderStatusEnum` covering placed → delivered → return/exchange/refund lifecycle); `shipments` (Delhivery waybills); `returnRequests` (1-day window, return/exchange, RET-XXXX IDs); `refunds` (Razorpay refund lifecycle, REF-XXXX IDs).

### Money & inventory
| Table | Purpose |
|---|---|
| `partnerWallets` | Ledger balances per partner: `balanceHold`, `balanceAvailable`, `totalEarned`. |
| `walletTransactionsV2` | Ledger events: `hold_credit` (on completion, with `releaseDate`), `release`, `withdraw_bank/upi`, `refund`, `adjustment`, `commission_deduction`. Idempotency: unique (serviceRequestId, transactionType). |
| `walletTransactions` (v1) | Legacy audit trail (credit/debit/commission/refund/topup) still used by admin top-up/deduct. |
| `withdrawalRequests` | Partner payout requests (bank/UPI), status pending→processing→completed/failed/rejected, `razorpayPayoutId`. |
| `paymentTransactions` | Every Razorpay event (order_created, payment_captured, payment_failed, refund_*) with paise amounts + raw metadata. |
| `invoices` | Final invoices (base, CGST, SGST, discount=booking-fee credit, total) for services & orders. |
| `inventoryItems` / `inventoryTransactions` | Platform-owned spare-parts inventory with consumption/restock/adjustment audit (idempotent per booking+item). |

### Support & ops
`supportTickets` + `ticketMessages` (categories service/product/payment/general; priorities; admin assignment; internal notes), `notifications` + `deviceTokens` (FCM), `otpVerifications` (email/phone OTPs for fallback auth & password reset), `districts` + `serviceablePincodes` (581-prefix serviceability), `platformConfig` (key/value config store: BUSINESS_CONFIG / OPERATIONAL_CONFIG / PAYMENT_CONFIG), `auditLogs` (entity/action/from-state/to-state/changedBy).

---

## 4. API Routes

Route registration: `server/routes.ts` (`registerRoutes`) contains a large legacy router **plus** mounts modular files from `server/routes/`. Rate limiters are applied per audience (`authLimiter`, `adminLimiter`, `partnerLimiter`, `mobileLimiter`, `publicLimiter`). `GET /api/health` (DB ping) and `GET /delete-account` (Play Store requirement) are defined in `index.ts`.

### Auth (`routes.ts` + `auth-truecaller.routes.ts`, mounted under `/api/auth`)
| Endpoint | Purpose |
|---|---|
| `POST /api/auth/signup/initiate`, `/verify`, `/complete`, `/signup` | Legacy email/phone+password signup with OTP |
| `POST /api/auth/login` | Legacy password login |
| `POST /api/auth/refresh` | Rotate refresh token → new token pair |
| `POST /api/auth/logout` | Revoke refresh tokens |
| `POST /api/auth/forgot-password`, `/verify-reset-otp`, `/reset-password` | Password reset via OTP |
| `POST /api/auth/check-phone` | Does phone exist? (streamlines fallback UX) |
| `POST /api/auth/truecaller/verify` | Exchange Truecaller OAuth authorizationCode+codeVerifier → profile → JWT pair |
| `POST /api/auth/truecaller/verify-dropcall` | Truecaller drop-call verification flow |
| `POST /api/auth/fallback/request-otp`, `/verify-otp` | Email/phone OTP fallback |
| `POST /api/auth/fallback/firebase-verify` | Verify Firebase Phone Auth ID token → find/create user → JWT pair (`requiresProfile` for new users) |
| `POST /api/auth/email/verify-request`, `/confirm` | Email verification |
| `POST /api/admin/auth/login`, `/register` | Admin dashboard login (8h JWT) / create admin |

### Customer bookings & services
| Endpoint | Purpose |
|---|---|
| `POST /api/services/create` | Create service request (validates pincode serviceability, creates booking snapshot) |
| `POST /api/services/create-with-payment` (payment.routes) | Create booking + Razorpay ₹99 order in one call |
| `GET /api/services/my-requests` | Customer's bookings |
| `POST /api/services/:id/cancel` and `POST /api/bookings/:id/cancel` | Cancel (CREATED only) + ₹99 Razorpay refund |
| `GET /api/bookings/:id/billing` | Billing breakdown (customer or partner) |
| `GET /api/bookings/:id/support-link` | WhatsApp Business deep link (ASSIGNED+) |
| `GET /api/customer/check-serviceability`, `POST /api/validate-pincode`, `POST /api/utils/validate-pincode` | Pincode checks |
| `POST /api/ratings/service/:serviceId`, `GET /api/ratings/provider/:providerId[/average]` | Ratings |

### Partner (serviceman) workflow
| Endpoint | Purpose |
|---|---|
| `GET /api/serviceman/assignments` | Assigned/incoming jobs |
| `POST /api/serviceman/requests/:id/accept` / `/deny` | Accept (generates handshake OTP) or deny assignment |
| `POST /api/serviceman/location/update` | Update partner's `currentLocation` (PostGIS) |
| `PATCH /api/bookings/:id/arrive` (geofence.routes) | GPS check ≤200 m → REACHED (403 with distance if outside) |
| `PATCH /api/bookings/:id/start` (geofence.routes) | Verify handshake OTP → IN_PROGRESS |
| `POST /api/service/verify-handshake`, `/api/service/start`, `/api/service/complete` | Legacy equivalents in routes.ts |
| `POST /api/bookings/:id/submit-bill` (billing.routes) | Submit parts+labor → BillingEngine freezes final snapshot → PENDING_PAYMENT |
| `POST /api/bookings/:id/cash-collected` (billing.routes) | Cash flow: validate amount (±₹1), debit UniteFix share (platformFee+GST) from wallet, → COMPLETED, invoice |
| `POST /api/partner/services/:id/generate-qr` (payment.routes) | Dynamic Razorpay UPI QR for `finalTotal` (single-use, ~12 min close_by) |
| `GET /api/partner/wallet/balance`, `/transactions`; `POST /api/partner/wallet/withdraw` | Wallet + withdrawal request |
| `GET /api/partner/earnings/summary`, `GET /api/partner/verification-status`, `PATCH /api/partner/availability` | Dashboard data, verification gate polling, online/offline toggle |
| `/api/partner/profile` router: `GET /`, `PUT /upi`, `PATCH /expertise` | Partner profile management |

### Payments & webhooks (`payment.routes.ts`)
| Endpoint | Purpose |
|---|---|
| `POST /api/customer/services/:id/create-booking-payment` | Razorpay order for ₹99 booking fee |
| `POST /api/customer/services/:id/create-final-payment` / `/cancel-final-payment` | Razorpay order for finalTotal |
| `POST /api/payments/verify` | Client-side payment signature verification |
| `POST /api/webhooks/razorpay` | HMAC-verified webhook: `payment.captured` (booking fee → `paid`; final payment → COMPLETED), `qr_code.credited` (QR payment → COMPLETED), `payment.failed` |
| `POST /api/webhooks/razorpayx` | Payout status webhook (withdrawal completed/failed) |
| `GET /api/customer/services/:id/invoice` | Invoice for a service |
| `POST /api/shop/create-order` | Razorpay order for product checkout (halted feature) |
| `GET /api/payments/order/:orderId`, `/service/:serviceId` (return.routes) | Payment history per entity |

### Client features (`client-features.routes.ts`)
Profile (`GET/PATCH /api/client/profile`, `/api/client/auth/profile`), profile picture upload/delete (Cloudinary), account deletion (`DELETE /api/client/account`, soft delete), invoices (`GET /api/client/invoices[/:id][/download]` — PDF), support tickets (`POST/GET /api/client/tickets`, `POST .../reply`).

### Uploads & notifications
`POST /api/upload/*` (upload.routes: multer → Cloudinary; profile + service photos). Notifications: `POST /api/notifications/register-token`, `DELETE /unregister-token`, `GET /api/notifications`, `PUT /:id/read`, `PUT /read-all` (plus legacy `/register`, `/unregister`).

### Products / cart / catalog (feature-flagged "Coming Soon")
`GET /api/products[/:id]`, cart CRUD (`/api/cart`, `/add`, `/checkout`), `GET /api/catalog/*` (categories, brands, products, search — mounted `catalog.routes.ts`), `POST /api/orders/place`, returns (`POST /api/orders/:orderId/return`, `GET .../return-status`, `PATCH /api/returns/:id/ship`).

### Admin
| Group | Endpoints |
|---|---|
| Dashboard | `GET /api/admin/stats`, `/revenue/chart`, `/services/recent`, `/services/pending`, `/orders/recent` |
| Users | `GET /api/admin/users`, `PATCH /api/admin/users/:id/status` |
| Partners (legacy + business) | `GET /api/admin/servicemen/list`, `/nearby` (PostGIS), `POST /create`, `PATCH /:id`, approve/suspend/activate/delete, wallet `topup`/`deduct`, `GET /:id/transactions`; `/api/business/partners*` CRUD + verify/suspend/deactivate |
| Verification & overrides (`admin-verification.routes.ts`) | `GET /api/admin/employees/pending`, `PATCH /api/admin/employees/:id/verify` (verify/reject + remarks), `GET /api/admin/bookings/:id/billing` (full financial audit), `POST /api/admin/bookings/:id/override` (force state), `POST /api/admin/bookings/:id/resolve-dispute` (refund customer / release funds) |
| Service ops (`admin.routes.ts`) | `GET /api/admin/services[/:id]`, `GET /api/admin/assignment-queue`, `POST /api/admin/services/:id/assign` / `/reassign` / `/force-transition`, `GET /api/admin/reports/services`, `GET /api/admin/technicians/:id/performance` |
| Service catalog | `GET/POST/PATCH/DELETE /api/admin/catalog/categories[/:id]`, `POST/PATCH /api/admin/catalog/services[/:id]` |
| Orders & shipping | `GET /api/admin/orders[/:orderId]`, `PATCH /api/admin/orders/:id/status`, `POST /api/admin/orders/:orderId/create-shipment` (Delhivery) |
| Returns & refunds (`return.routes.ts`) | `GET /api/admin/returns[/:id]`, approve/reject/received, `POST /:id/refund` (Razorpay), `POST /:id/exchange`; `GET /api/admin/payments/transactions`, `/refunds` |
| Withdrawals (`admin-withdrawals.routes.ts`) | `GET /api/admin/withdrawals`, `POST /:id/approve` (RazorpayX payout), `POST /:id/reject` (refund to wallet) |
| Support | `GET /api/admin/tickets[/:ticketId]`, `POST .../reply`, `PUT .../status` |
| Locations | districts CRUD + toggle, pincodes CRUD + toggle, `GET /api/admin/locations`, `/location-stats` |
| Config | `GET /api/admin/config`, `PATCH /api/admin/config/:key` (platformConfig editor) |
| Inventory/product admin | `/api/admin/products*` (CRUD, stock), `inventoryRouter` (product catalog admin: categories, brands, variants, images, stock, CSV import/export, low-stock) |

---

## 5. Mobile App — Screens & Navigation

**Root branching** (`RootNavigator.tsx`): after Zustand hydration from SecureStore —
1. Not authenticated → **AuthStack**
2. `role === 'serviceman'` and `documentVerificationStatus !== 'verified'` → **EmployeePendingScreen** (locked holding screen, polls verification status)
3. `role === 'serviceman'` verified → **PartnerStack**
4. `role === 'user'` → **CustomerStack**

Deep linking (`unitefix://` scheme, `linking.ts`) + push-notification tap navigation are wired at the root. `GlobalAlertProvider` renders app-wide premium alerts.

### AuthStack
`Splash` → `RoleSelection` (customer vs partner) → `TruecallerAuth` (1-tap Truecaller; falls back to Firebase Phone OTP; collects name/email for new users) → `ExpertiseSelection` (partner: pick skills/services) → `EmployeePending` → `Legal`.

### CustomerStack (tabs + stack screens)
**CustomerTabs**: `HomeTab` (HomeScreen — service catalog grid, banners, pincode check) · `BookingsTab` (MyRequestsScreen — booking list w/ status) · `ShopTab` (ShopScreen — **Coming Soon overlay**) · `ProfileTab` (ProfileScreen).

Stack screens: `AllServices` (full catalog) · `ServiceRequest` (create booking: type, brand/model, description, photos, schedule, urgency) · `LocationSelection` / `MapAddressPicker` / `SavedAddresses` (address flows) · `RequestDetail` (status timeline, cancel-if-CREATED, WhatsApp support if ASSIGNED+, rating prompt on COMPLETED) · `OtpDisplay` (shows 6-digit handshake OTP to give the technician) · `FinalPayment` (Razorpay checkout for finalTotal) · `Notifications` · `SupportTicket` · shop screens (ProductDetail, Cart, Checkout, OrderConfirmation, OrderDetail — halted) · `Legal`.

### PartnerStack (tabs + stack screens)
**PartnerTabs**: `IncomingTab` (IncomingServicesScreen — new assignments, accept/deny, online/offline toggle) · `HistoryTab` (PastServicesScreen) · `StartTab` (placeholder center button) · `WalletTab` (WalletScreen — hold/available balances, transactions, withdraw via bank/UPI) · `ProfileTab` (PartnerProfileScreen — profile, UPI, expertise, availability).

Stack screens: `AssignmentDetail` (job info, customer address/schedule) · `StartService` ("I've Arrived" GPS geofence call → OTP entry → start work) · `SubmitBill` (parts + labor inputs with live billing preview from frozen rates) — then collect payment via **dynamic Razorpay QR full-screen modal with 5-minute POS-style countdown** or record **cash collected** · `InvoiceView` · `ServiceHistoryDetail` · `Legal`.

Support code: `api/` (auth/customer/partner/shop API modules over a shared axios `client.ts` with auto refresh-on-403 queueing), `stores/` (auth, app, bookingDraft, language), `hooks/` (useCustomerData, usePartnerData, useShopData, useTruecallerAuth), `services/` (notifications, razorpay), `i18n/` (en + Kannada).

---

## 6. Authentication Flow

**Primary — Truecaller OAuth (SDK v3, PKCE):**
1. Mobile invokes Truecaller SDK → gets `authorizationCode` + `codeVerifier`.
2. `POST /api/auth/truecaller/verify` — backend exchanges the code at `oauth-account-noneu.truecaller.com/v1/token`, fetches `/v1/userinfo`, finds-or-creates the `users` row (stores `truecallerId`, `phoneVerified=true`), creates the role profile (`customers` or `employees`).
3. Backend returns `{ accessToken, refreshToken, user, profile }`.

**Fallback — Firebase Phone Auth:** `@react-native-firebase/auth` sends the SMS OTP client-side; backend `POST /api/auth/fallback/firebase-verify` verifies the ID token with `firebase-admin`, matches the phone number, finds/creates the user (new users must supply name + email → `requiresProfile: true` round-trip). There are also email-OTP fallback and Truecaller drop-call variants, plus a legacy password signup/login.

**Tokens (`token.service.ts`):**
- Access JWT: 15 min, payload `{ userId, role, phone?, partnerId?, username? }`, signed with `JWT_SECRET`.
- Refresh token: 64 random bytes, stored **SHA-256-hashed** in the `refreshTokens` table, 30-day expiry, **rotated** on every `POST /api/auth/refresh`.
- Admin JWT: 8 h, no refresh (dashboard keeps it in localStorage and self-checks expiry).
- Mobile stores tokens in **expo-secure-store**; axios interceptor auto-refreshes on 403 with a request queue and force-logout on refresh failure.

**Role-based middleware (`auth.middleware.ts`):**
- `authenticateToken` — customers only (`role='user'`), with live DB check that the account is active and not soft-deleted.
- `authenticatePartner` — servicemen only; fetches `partnerId`, `documentVerificationStatus`, `isActive` **live from DB** so admin suspension takes effect immediately.
- `authenticateAdmin` — admin/super_admin JWTs.
- `authenticateAny` — customer or partner (shared endpoints like billing preview).

**Verification gate:** partners with `documentVerificationStatus !== 'verified'` are locked into `EmployeePendingScreen` until an admin approves their KYC via `PATCH /api/admin/employees/:id/verify`.

---

## 7. Payment System (End-to-End)

All money math lives in **`BillingEngine`** (`billing-engine.ts`) — whole rupees, paise only at the Razorpay boundary, frozen snapshots:

```
subtotal        = sparePartsCost + serviceLaborCost
platformFee     = round(subtotal × 15%)              (UNITEFIX_FEE_PERCENT, frozen at booking)
taxableAmount   = subtotal + platformFee
GST             = round(taxableAmount × 18%)          (cgst = round(GST/2), sgst = remainder)
grossTotal      = taxableAmount + GST
finalTotal      = max(0, grossTotal − ₹99 bookingFeeCredit)
employeeEarnings= subtotal (partner keeps parts + labor)
```
Snapshot freezes twice: at **booking creation** (bookingFee, fee %, GST %) and at **bill submission** (full breakdown). Never recalculated; `buildLegacySnapshot` wraps pre-refactor bookings.

**1. Booking fee (₹99):** customer pays via Razorpay order (`create-booking-payment` / `create-with-payment`) through react-native-razorpay checkout. Webhook `payment.captured` with `notes.payment_type='booking_charge'` marks `bookingFeeStatus='paid'`. Amount comes from config `BUSINESS_CONFIG.BASE_SERVICE_FEE` (0 ⇒ free booking short-circuit).

**2. Final payment — three paths from PENDING_PAYMENT:**
- **Customer online:** `create-final-payment` → Razorpay order for `finalTotal` → checkout in `FinalPaymentScreen` → webhook `payment.captured` (`payment_type='final_payment'`) transitions the booking to COMPLETED.
- **Partner dynamic QR:** `POST /api/partner/services/:id/generate-qr` → `razorpay.qrCode.create` (single-use UPI QR, fixed amount, `close_by` ≈12 min; mobile shows a full-screen modal with 5-min countdown). Webhook **`qr_code.credited`** (matched via `notes.service_request_id`) → COMPLETED.
- **Cash:** `POST /api/bookings/:id/cash-collected` — validates amount vs `finalTotal` (±₹1), **debits UniteFix's share (platformFee + CGST + SGST) from the partner's wallet**, sets `paymentMethod='cash'`, → COMPLETED, generates invoice. Idempotent.

**3. Webhooks (`/api/webhooks/razorpay`):** HMAC-SHA256 verified against `RAZORPAY_WEBHOOK_SECRET`. Every event is recorded in `paymentTransactions` via `PaymentTrackingService` (full audit trail in paise). Handles `payment.captured`, `qr_code.credited`, `payment.failed`.

**4. On COMPLETED:** invoice row created (base/CGST/SGST/discount=₹99/total, `UF-INV-…` ID, PDF downloadable via pdfkit), employee earnings credited to wallet as `hold_credit` with a `releaseDate` (dispute window); an hourly cron moves hold → available.

**5. Refunds:** cancellation from CREATED triggers `refundBookingCharge` (finds the captured booking payment, `razorpay.payments.refund`, records `refund_initiated`). Product returns use `refunds` table + PaymentTrackingService. Disputes let admin refund customer or release partner funds.

**6. Partner payouts (RazorpayX, `razorpayx.service.ts`):** partner requests withdrawal (bank or UPI) → funds moved out of `balanceAvailable` → admin approves in dashboard → `syncEmployeeForPayouts` lazily creates a RazorpayX **Contact** and **Fund Account** (bank_account or VPA) stored on the employee row → `createPayout` (IMPS, paise, `queue_if_low_balance`) against `RAZORPAYX_ACCOUNT_NUMBER` → `/api/webhooks/razorpayx` updates withdrawal status (completed/failed; failures refund the wallet).

---

## 8. Key Services (`/server/services/`)

| Service | Responsibility |
|---|---|
| `billing-engine.ts` | **Single source of truth for all financial math.** Two-phase frozen pricing snapshots, bill preview, cash-debit amount, service value tier (≥₹5k = high_value), legacy snapshot synthesis. |
| `payment.service.ts` | Razorpay integration: booking/final orders, dynamic UPI QR, webhook signature verification & event handling, invoice persistence, booking-fee refund. Credentials from env with DB-config fallback. |
| `payment-tracking.service.ts` | Writes every payment event to `paymentTransactions`; initiates/tracks Razorpay refunds. |
| `razorpayx.service.ts` | RazorpayX payouts: contact + fund-account creation, IMPS payout, employee sync. |
| `token.service.ts` | JWT access/refresh lifecycle, hashed DB-persisted refresh tokens with rotation, admin tokens, expired-token cleanup. |
| `otp.service.ts` | Service handshake OTP generation/validation (guards start-of-work transition; no financial side effects). |
| `notification.service.ts` | FCM push via firebase-admin (service-account via `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON`); persists to `notifications`, manages `deviceTokens`. |
| `config.service.ts` | Cached, typed reads of `platformConfig` (e.g. `BUSINESS_CONFIG.BASE_SERVICE_FEE`, `UNITEFIX_FEE_PERCENT`, `GST_PERCENTAGE`, `OPERATIONAL_CONFIG.PARTNER_ACCEPT_TIMEOUT_HOURS`). |
| `admin-service.manager.ts` | Admin booking ops: filtered lists, assign/reassign technicians, force transitions, performance metrics. Explicitly does **not** touch wallet/billing/inventory. |
| `admin-order.manager.ts` | Product-order admin + Delhivery shipments (mock/live via `DELHIVERY_MODE`), tracking, reverse shipments for returns, audit trail. |
| `return.service.ts` | Return/exchange lifecycle: 1-day window, admin approve/reject, return shipping, refund initiation, exchange order creation. |
| `support.service.ts` | Ticket CRUD, conversation threads, email notifications. |
| `product.service.ts` / `product-catalog.service.ts` | Shop domain: catalog CRUD (category→brand→product→variant→images), cart (intent-only), checkout with row-level stock locking, CSV bulk import/export, low-stock queries. (Feature halted for end users.) |
| `invoice-generator.ts` | PDF invoice rendering (pdfkit). |
| `cloudinary.service.ts` | Image uploads to Cloudinary; dev fallback stores base64 data-URIs when creds missing. |
| `task_queues.ts` | Background jobs (plain `setInterval`, all idempotent): wallet hold release (1 h), return-window expiry (1 h), OTP cleanup (24 h), notification cleanup (7 d), low-stock alerts (6 h), refresh-token cleanup (24 h), **assignment timeout revert (15 min)**. |

Also: `server/business/booking-state-machine.ts` (+ `state-mapping.ts` for UI label mapping), `server/repositories/*` (user/partner/order/product/location/notification data access), `server/lib/` (logger, firebase init, geo helpers, pagination, transaction helper), `server/storage.ts` (large legacy storage facade used by routes.ts).

---

## 9. Admin Dashboard (`/client`)

React SPA served by the same Express server. Login (`admin-login.tsx`) → JWT in localStorage (auto-expiry checks every 60 s). Sidebar navigation to:

| Page | Capabilities |
|---|---|
| **Dashboard** | Stats cards, revenue chart (recharts), recent activity, pending assignments, quick actions |
| **Users** | Customer list, activate/deactivate |
| **Services** | All bookings with status filters, detail view, force state transitions, dispute resolution, financial/billing audit per booking |
| **Assignment Queue** | Unassigned (CREATED) bookings; assign nearby eligible partners (PostGIS nearby query, partner-assignment-modal) |
| **Partners** | Partner onboarding/CRUD, KYC document verification (approve/reject with remarks), suspend/activate, wallet top-up/deduct, transaction history, performance |
| **Payments** | Payment transactions, refunds, invoices |
| **Withdrawals** (`/admin/withdrawals`) | Approve (triggers RazorpayX payout) / reject partner withdrawal requests |
| **Orders** | Product orders, status updates, Delhivery shipment creation, returns/exchanges/refund approval |
| **Inventory** (`/admin/inventory`) | Product catalog admin: categories, brands, products, variants, stock, images, CSV import/export, low-stock |
| **Service Catalog** (`/admin/catalog`) | Home-screen service categories & services (status, visibility, ordering) |
| **Locations** + **Districts** | Serviceable pincodes & districts CRUD/toggles, location stats |
| **Settings** | `platformConfig` editor (fees, GST %, timeouts, feature flags) |
| **Developer** | Diagnostics/dev utilities |

---

## 10. Environment & Deployment

### Environment variables (`.env.example`)
| Group | Vars |
|---|---|
| Database | `DATABASE_URL` (Neon Postgres + PostGIS), `DB_POOL_MAX` |
| Auth | `JWT_SECRET` (required — server refuses to boot without it), `JWT_REFRESH_SECRET` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` |
| Truecaller | `TRUECALLER_CLIENT_ID`, `TRUECALLER_APP_KEY` |
| Firebase/FCM | `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON` (+ legacy `FCM_SERVER_KEY`); mobile uses `google-services.json` |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| Email | `SMTP_HOST/PORT/USER/PASS`, `ADMIN_EMAIL` |
| Shipping | `DELHIVERY_MODE` (mock/live), `DELHIVERY_API_KEY`, `DELHIVERY_BASE_URL`, warehouse address vars, `GST_NUMBER` |
| Misc | `WHATSAPP_BUSINESS_NUMBER` (support deep link), `GOOGLE_MAPS_API_KEY`, `NODE_ENV`, `PORT` (3000), `CLIENT_URL` (CORS), `LOG_LEVEL`; social OAuth vars (schema-ready, unused) |

### Server build & deployment (Render)
- Dev: `npm run dev` → tsx runs `server/index.ts`; Vite middleware serves the admin client with HMR.
- Build: `npm run build` → `vite build` (admin client → `dist/`) + `esbuild server/index.ts` (ESM bundle → `dist/index.js`); start with `node dist/index.js`.
- Deployed to **Render** at `https://unitefix-backend.onrender.com` (hardcoded as the mobile production base URL; no render.yaml — configured in the Render dashboard). Node 20 pinned via `engines`. Health check `GET /api/health`; graceful SIGTERM shutdown drains HTTP + DB pool; helmet CSP enabled in production; CORS allowlist via `CLIENT_URL`.
- DB workflow: `npm run db:push` (drizzle-kit push, PostGIS tables excluded via `extensionsFilters`), seed scripts in `/scripts` (districts, pincodes, platform config, catalog, admin user, test data), plus manual SQL in `/migrations`.

### Mobile build (Expo prebuild + Gradle)
- Expo SDK 54 dev-client workflow: `npx expo run:android` uses the checked-in `mobile/android/` Gradle project (prebuild output). App id `com.unitefix.app`, version 1.0.10 / versionCode 11, deep-link scheme `unitefix`.
- Config plugins: expo-notifications, expo-secure-store, expo-location, expo-font, expo-localization, and the **custom `plugins/withTruecaller`** plugin (injects Truecaller client ID into the Android manifest).
- Firebase: `mobile/google-services.json`; Maps API key slots in `app.json`. EAS project id present in `expo.extra` but no `eas.json` — current builds are local Gradle (`assembleRelease`/`bundleRelease`) rather than EAS cloud builds.
- Dev networking: API base URL auto-derives the Metro host IP from expo-constants (`http://<lan-ip>:3000`), falling back to localhost; production uses the Render URL.

### Testing
Playwright e2e suite (`/e2e`, `npm run test:e2e`, seeded via `npm run seed:test`); assorted manual verification scripts under `/scripts` and root-level `test-*.ts` scratch files.

---

## Appendix: Repo hygiene notes
- Untracked scratch files at root (`fix.py`, `test-*.ts`, `scrape-output.html`, JVM `hs_err_*.log`/`replay_*.log` crash logs, `unitefix/` folder, `withTruecaller_history.patch`) are working debris, not part of the build.
- `google-services.json` exists at both root and `mobile/` (mobile one is the live copy referenced by `app.json`).
- Current branch: `feature/react-native-app`; recent work focuses on the dynamic QR flow (full-screen modal, 5-min countdown) and partner payment fixes.
