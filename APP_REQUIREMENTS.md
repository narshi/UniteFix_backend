# UniteFix — Mobile App Requirements Document
### For Emergent AI Development Reference

> **Version:** 3.0 (Audited)  
> **Date:** 2026-02-15  
> **Platforms:** Android & iOS  
> **Design Source:** Figma (3 design files, 15+ screens)  
> **Backend Coordination:** See `BACKEND_ADMIN_REQUIREMENTS.md`  
> **Design-to-Backend Alignment: 53%** (corrected from 67%)

---

## ⚠️ CRITICAL: Backend Issues Affecting App

Before app development begins, these backend issues must be resolved:

1. **4 route files are dead code** — Payment, advanced admin, product, and OTP routes exist but are never registered. See `BACKEND_ADMIN_REQUIREMENTS.md` §1.
2. **4 database tables missing** — `support_tickets`, `ticket_messages`, `service_charges`, `shipments` referenced in code but not in schema.
3. **OTP sends to console only** — No SMS/email provider integrated. App OTP flows will fail in production.

---

## 1. App Overview

UniteFix is a home services and product ordering app for Uttara Kannada, Karnataka. Two user types share one app with role-based UI:

- **Customer (User):** Books repair/maintenance services, orders products
- **Service Partner:** Receives and completes service assignments, earns via wallet

---

## 2. Screen-by-Screen Requirements

### 2.1 Splash Screen
| Element | Backend API | Status |
|---------|-------------|--------|
| UniteFix logo + branding | None (static) | ✅ Ready |
| User type selection (User / Partner) | None (stored locally) | ✅ Ready |

---

### 2.2 Login Screen
| Element | Backend API | Status |
|---------|-------------|--------|
| Email input | `POST /api/auth/login` | ✅ Working |
| Phone input | `POST /api/auth/login` | ✅ Working |
| Password (show/hide toggle) | `POST /api/auth/login` | ✅ Working |
| Remember me checkbox | Extend JWT expiry | ⚠️ Not implemented |
| **Forgot password** | `POST /api/auth/forgot-password` | ❌ NOT BUILT |
| Login button | `POST /api/auth/login` | ✅ Working |
| **Facebook login** | `POST /api/auth/social/facebook` | ❌ NOT BUILT |
| **Google login** | `POST /api/auth/social/google` | ❌ NOT BUILT |
| Sign Up link | Navigation only | ✅ Ready |

**Login response:**
```json
{
  "success": true,
  "user": { "id": 123, "phone": "+91...", "role": "user", ... },
  "token": "eyJ..."
}
```
Token: Store in Keychain (iOS) / Keystore (Android). Expires 30 days.

**Completion: 55%**

---

### 2.3 Sign Up Screen
| Element | Backend API | Status |
|---------|-------------|--------|
| Full name | `username` field | ✅ Working |
| Email | `email` field | ✅ Working |
| Phone (with country code) | `phone` field (unique) | ✅ Working |
| Partnership type (Individual/Business) | `partnerType` field | ✅ Working (partner signup) |
| Password (show/hide) | bcrypt hashed server-side | ✅ Working |
| Privacy Policy checkbox | — | ⚠️ No timestamp field in schema |
| Sign Up button | `POST /api/auth/signup` | ✅ Working |
| Social signup | — | ❌ NOT BUILT |

**Completion: 70%**

---

### 2.4 Home Screen (User)
| Element | Backend API | Status |
|---------|-------------|--------|
| "Welcome {name}" greeting | Token → user profile | ✅ Working |
| Service category grid (AC, Refrigerator, TV, Laptop, Water Filter, Mobile, Others) | Service types API | ✅ Working |
| Category icons | — | ⚠️ No `iconUrl` field in schema |
| Notification bell | `GET /api/notifications` | ❌ NOT BUILT |
| Bottom navigation (5 tabs) | App-side | ✅ Ready |

**Completion: 60%**

---

### 2.5 Service Request Form
| Element | Backend API | Status |
|---------|-------------|--------|
| Service type (pre-selected) | `serviceType` | ✅ Working |
| Brand input | `brand` | ✅ Working |
| Model input | `model` | ✅ Working |
| Description textarea | `description` | ✅ Working |
| Photo upload (max 5) | `photos[]` — expects URLs | ⚠️ No file upload endpoint |
| Preferred date | `preferredDate` | ✅ Working |
| Preferred time | `preferredTime` | ✅ Working |
| Address + GPS coordinates | `address` + `locationLat/Long` | ✅ Working |
| ₹250 booking fee display | `bookingFee` | ✅ Working |
| Submit button | `POST /api/services/create` | ✅ Working |

**API: `POST /api/services/create`** — Requires auth token.

**Issue:** Photos field expects URL strings, but there's no file upload API. Need `POST /api/uploads/image` returning CDN URL.

**Completion: 80%**

---

### 2.6 My Service Requests (User)
| Element | Backend API | Status |
|---------|-------------|--------|
| Request list | `GET /api/services/my-requests` | ✅ Working |
| Status badge (color-coded) | `status` field | ✅ Working |
| Request details | Service request object | ✅ Working |
| Cancel button | `POST /api/services/:id/cancel` | ✅ Working |
| **Rate service** | `POST /api/ratings/service/:id` | ❌ NOT BUILT |

**Status colors:**
| Status | Color | Label |
|--------|-------|-------|
| created | Blue | Request Placed |
| assigned | Orange | Partner Assigned |
| accepted | Green | Partner Accepted |
| in_progress | Yellow | In Progress |
| completed | Green | Completed |
| cancelled | Red | Cancelled |

**Completion: 75%**

---

### 2.7 Incoming Services (Partner) — CRITICAL GAPS
| Element | Backend API | Status |
|---------|-------------|--------|
| Assigned request cards | `GET /api/serviceman/assignments` | ✅ Working |
| Customer info | Included in assignment data | ⚠️ No profile picture |
| Request title | `serviceType` | ✅ Working |
| Request ID | `serviceId` | ✅ Working |
| Date | `assignedAt` | ✅ Working |
| Price per hour | — | ⚠️ No hourly rate field |
| **Accept button** | `POST /api/serviceman/requests/:id/accept` | ❌ NOT BUILT |
| **Deny button** | `POST /api/serviceman/requests/:id/deny` | ❌ NOT BUILT |

**This is the biggest gap.** The Figma design prominently shows Accept/Deny buttons, but no backend endpoints exist.

**Required new endpoints:**
```
POST /api/serviceman/requests/:id/accept
  → assigned → accepted (state machine supports this)

POST /api/serviceman/requests/:id/deny
  → assigned → created (back to pool)
  → Body: { reason: "string" }
```

**Completion: 40%**

---

### 2.8 Service Execution (Partner)
| Element | Backend API | Status |
|---------|-------------|--------|
| OTP verification | `POST /api/service/verify-handshake` | ✅ Working |
| Start service (geo-fenced 500m) | `POST /api/service/start` | ✅ Working |
| Enter charges | `POST /api/technician/services/:id/enter-service-charge` | ⚠️ Route exists but NOT REGISTERED |
| Complete service | `POST /api/service/complete` | ✅ Working |

**Completion: 65%**

---

### 2.9 Past Services (Partner)
| Element | Backend API | Status |
|---------|-------------|--------|
| Completed services list | `GET /api/serviceman/assignments` (filter) | ⚠️ No status filter |
| Service name + ID | `serviceType`, `serviceId` | ✅ Working |
| Date | `completedAt` | ✅ Working |
| Price earned | `totalAmount` | ✅ Working |
| **Star rating** | `GET /api/ratings/provider/:id` | ❌ NOT BUILT |

**Completion: 45%**

---

### 2.10 Service Details (Partner)
| Element | Backend API | Status |
|---------|-------------|--------|
| Service info | Service request object | ✅ Working |
| Customer name | via userId join | ✅ Working |
| Amount earned | `totalAmount` | ✅ Working |
| **Download invoice (PDF)** | `GET /api/invoices/:id/download` | ❌ NOT BUILT |

**Completion: 60%**

---

### 2.11 Profile Screen
| Element | Backend API | Status |
|---------|-------------|--------|
| **Profile picture** | `POST /api/client/profile/picture` | ❌ NOT BUILT |
| User name | `username` | ✅ Working |
| User ID (UFID format) | — | ⚠️ No UFID generation |
| Email | `email` | ✅ Working |
| Edit profile | `PATCH /api/client/auth/profile` | ✅ Working |
| **Contact Support** | `POST /api/customer/tickets` | ❌ Route exists but NOT REGISTERED + No DB table |
| Log Out | Client-side token clear | ✅ Ready |
| **Delete Account** | `DELETE /api/client/account` | ❌ NOT BUILT |

**Completion: 40%**

---

## 3. Features Not in Figma But Needed

### 3.1 Password Reset
```
Forgot Password → Enter Phone/Email → OTP → Verify → New Password → Login
```
**APIs needed:**
- `POST /api/auth/forgot-password` → Send OTP
- `POST /api/auth/verify-reset-otp` → Return reset token
- `POST /api/auth/reset-password` → Update password

### 3.2 Rating & Review System
**Database table needed:**
```sql
CREATE TABLE ratings (
  id SERIAL PRIMARY KEY,
  service_request_id INTEGER REFERENCES service_requests(id),
  from_user_id INTEGER NOT NULL,
  to_user_id INTEGER NOT NULL,
  provider_id INTEGER REFERENCES service_providers(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```
**APIs needed:**
- `POST /api/ratings/service/:serviceId` — Submit rating
- `GET /api/ratings/provider/:providerId` — Provider's ratings
- `GET /api/ratings/provider/:providerId/average` — Average score

### 3.3 Push Notifications
**Trigger events:**
| Event | Notify | Content |
|-------|--------|---------|
| Partner assigned | User | "A partner has been assigned" |
| Partner accepts | User | "{name} accepted your request" |
| Service started | User | "Your service has started" |
| Service completed | User | "Rate your experience" |
| New assignment | Partner | "New job: {type} at {location}" |
| Payment received | Partner | "₹{amount} credited to wallet" |

**Tables needed:** `deviceTokens`, `notifications`
**Infrastructure:** Firebase Cloud Messaging (Android) + APNS (iOS)

### 3.4 Profile Picture Upload
**Implementation:** Multipart upload → Cloud storage (S3/Cloudinary) → CDN URL → Save to user record
**APIs needed:**
- `POST /api/client/profile/picture` — Upload
- `DELETE /api/client/profile/picture` — Remove

---

## 4. API Quick Reference for App

### Working — Use Immediately
```
Auth:
  POST /api/auth/signup
  POST /api/auth/login

Services:
  POST /api/services/create
  GET  /api/services/my-requests
  POST /api/services/:id/cancel

Serviceman:
  POST /api/serviceman/location/update
  GET  /api/serviceman/assignments
  POST /api/service/verify-handshake
  POST /api/service/start
  POST /api/service/complete

Products:
  GET  /api/products/list?category=X
  POST /api/cart/add
  GET  /api/cart
  DELETE /api/cart/:id
  POST /api/orders/place

Utils:
  POST /api/validate-pincode
  POST /api/otp/send
  POST /api/otp/verify
```

### Must Build Before App Launch
```
🔴 CRITICAL:
  POST /api/auth/forgot-password
  POST /api/auth/reset-password
  POST /api/auth/social/google
  POST /api/auth/social/facebook
  POST /api/serviceman/requests/:id/accept
  POST /api/serviceman/requests/:id/deny
  POST /api/ratings/service/:id
  GET  /api/ratings/provider/:id

🟡 HIGH:
  POST /api/client/profile/picture
  DELETE /api/client/account
  GET  /api/invoices/:id/download
  POST /api/notifications/register-device
  GET  /api/notifications
  
⚠️ FIX (exists but broken):
  Register payment.routes.ts
  Register product.routes.ts  
  Register admin.routes.ts
  Add missing DB tables to schema
```

---

## 5. Data Contracts

### Auth Header
```
Authorization: Bearer <jwt_token>
```

### Standard Success Response
```json
{ "success": true, "data": {...} }
```

### Standard Error Response
```json
{ "success": false, "message": "Error description" }
```

### Paginated Response
```json
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 150, "pages": 8 }
}
```

### Status Enums
```typescript
// Service
type ServiceStatus = 'created' | 'assigned' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';

// Order
type OrderStatus = 'placed' | 'confirmed' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'cancelled';
```

---

## 6. Technical Notes for App Team

### Location
- Partner GPS updates: `POST /api/serviceman/location/update` — call periodically
- Service start geo-fence: Must be within 500m of service location
- Pincode validation: Only 581xxx (Uttara Kannada) accepted

### Payments
- Razorpay SDK integration required in mobile app
- Flow: Create order (server) → Razorpay checkout (app) → Webhook verifies (server)
- Booking fee: ₹250 on service creation
- ⚠️ Payment routes not yet registered — backend fix needed first

### Images
- `photos[]` field expects URLs, not files
- Need file upload endpoint that returns CDN URLs
- Max 5 photos per service request

### Real-time (Not Available Yet)
- Currently polling-based — app must refresh manually
- WebSocket support not built
- Push notifications not built
- Plan for pull-to-refresh in first version

---

## 7. App Implementation Roadmap

### Phase 1: Core (Weeks 1-3) — Uses Working APIs Only
- Splash + user type selection
- Login (email/phone)
- Signup
- Home with service categories
- Service request form + submission
- My service requests list
- Basic profile view/edit + logout

### Phase 2: Partner (Weeks 3-5) — Needs Backend Fixes
- ⚠️ Accept/deny (needs new endpoint)
- OTP verification handshake
- Start service (geo-fenced)
- Complete service
- Past services history

### Phase 3: Enhanced (Weeks 5-7) — Needs New Backend Features
- Password reset (needs new endpoints)
- Google/Facebook login (needs OAuth integration)
- Rating & reviews (needs new table + endpoints)
- Profile picture upload (needs file upload + cloud storage)
- Invoice download (needs PDF generation)
- Products + cart + checkout

### Phase 4: Polish (Weeks 7-9)
- Push notifications
- Support tickets
- Account deletion
- Settings/preferences
- Error handling polish
- Store submission

---

## 8. Design System (From Figma)

### Colors
- Primary: `#2196F3` (Blue)
- Background: `#FFFFFF`
- Surface: `#F5F5F5`
- Text: `#212121` / `#757575`
- Success: `#4CAF50`
- Error: `#F44336`

### Components
- Cards: White, subtle shadow, 12px radius
- Buttons: Full-width blue, 8px radius
- Inputs: Outlined with icons, 8px radius
- Bottom nav: 5 tabs, blue active state

---

*Version 3.0 — Audited. All API statuses verified against actual registered routes.*  
*Cross-reference: `BACKEND_ADMIN_REQUIREMENTS.md` for full backend details.*
