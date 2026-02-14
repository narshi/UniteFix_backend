# UniteFix — Mobile App Requirements Document
### For Emergent AI Development Reference

> **Version:** 2.0  
> **Date:** 2026-02-15  
> **Platforms:** Android & iOS  
> **Design Source:** Figma (60-70% screens designed)  
> **Backend Coordination:** See `BACKEND_ADMIN_REQUIREMENTS.md`

---

## 1. App Overview

UniteFix is a home services and product ordering app serving the Uttara Kannada region of Karnataka. The app supports two user types:

- **Customer (User):** Books repair/maintenance services, orders products
- **Service Partner:** Receives and completes service assignments, earns via wallet

Both user types share a single app with role-based UI.

---

## 2. User Flows (From Figma Designs)

### 2.1 Onboarding Flow
```
App Launch → Splash Screen → User Type Selection → Login / Sign Up → Home
                                  ↓
                          [User]    [Partner]
                             ↓          ↓
                         User Home   Partner Home
```

### 2.2 Service Booking Flow (User)
```
Home → Select Category → Fill Request Form → Confirm → Payment (₹250) → Request Created
                                                                              ↓
                                              Track Status ← Partner Assigned ←
                                                    ↓
                                              Service Started (OTP Verify)
                                                    ↓
                                              Service Completed → Rate Partner → Invoice
```

### 2.3 Service Management Flow (Partner)
```
Partner Home → Incoming Services → Accept/Deny → Navigate to Customer
                                                       ↓
                                                  Enter OTP → Start Service
                                                       ↓
                                                  Enter Charges → Complete
                                                       ↓
                                                  Wallet Credit → Past Services
```

---

## 3. Screen-by-Screen Requirements

### 3.1 Splash Screen
**Design:** ✅ Complete

| Element | Requirement | Backend API |
|---------|------------|-------------|
| UniteFix Logo | Brand logo display | None (static) |
| Welcome text | "Welcome" heading | None |
| User type cards | Two options: "User" & "Partner" with images | None |
| Selection | Tap to proceed to Login/Signup | None |

**Notes:** No backend dependency. Store selected type locally for routing.

---

### 3.2 Login Screen
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Email input | Email text field | `POST /api/auth/login` | ✅ Ready |
| Phone input | Phone text field | `POST /api/auth/login` | ✅ Ready |
| Password input | Secure field with show/hide toggle | `POST /api/auth/login` | ✅ Ready |
| Remember me | Checkbox for persistent session | — | ⚠️ Use longer token |
| Forgot password | Link to password reset flow | `POST /api/auth/forgot-password` | ❌ NOT BUILT |
| Login button | Submit credentials | `POST /api/auth/login` | ✅ Ready |
| Facebook login | OAuth social login | `POST /api/auth/social/facebook` | ❌ NOT BUILT |
| Google login | OAuth social login | `POST /api/auth/social/google` | ❌ NOT BUILT |
| Sign Up link | Navigate to registration | — | ✅ Ready |

**API Response (Login):**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": 123,
    "phone": "+919876543210",
    "email": "user@email.com",
    "username": "John Doe",
    "role": "user",
    "isVerified": true
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Token Storage:** Store JWT securely in device Keychain (iOS) / Keystore (Android). Token expires in 30 days for users.

---

### 3.3 Sign Up Screen
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Full name | Text input | `username` field in signup | ✅ Ready |
| Email | Email input | `email` field | ✅ Ready |
| Phone | Phone input with country code | `phone` field (unique) | ✅ Ready |
| Partnership type | Radio: Individual / Business | `partnerType` field | ✅ Ready (Partner signup) |
| Password | Secure input with toggle | bcrypt hashed on server | ✅ Ready |
| Privacy Policy | Checkbox + link | — | ⚠️ Need timestamp field |
| Sign Up button | Submit registration | `POST /api/auth/signup` | ✅ Ready |
| Social signup | Facebook / Google | — | ❌ NOT BUILT |
| Login link | Navigate to login | — | ✅ Ready |

**API: `POST /api/auth/signup`**
```json
{
  "phone": "+919876543210",
  "email": "user@email.com",
  "password": "SecurePass123",
  "username": "John Doe",
  "role": "user",
  "pinCode": "581301",
  "homeAddress": "123 Main St, Sirsi",
  "referralCode": "UFABC123"
}
```

**Pincode Validation:** On signup, the backend checks if the pincode is in the `serviceable_pincodes` table. Returns error if not serviceable.

---

### 3.4 Home Screen (User)
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Welcome greeting | "Welcome {firstName}" | Token → user profile | ✅ Ready |
| Notification bell | Navigate to notifications | `GET /api/notifications` | ❌ NOT BUILT |
| Service grid | Category cards with icons | `GET /api/client/services/types` | ✅ Ready |
| — AC Services | Category with icon | — | ⚠️ Need icon URLs |
| — Refrigerator | Category with icon | — | ⚠️ Need icon URLs |
| — TV Repair | Category with icon | — | ⚠️ Need icon URLs |
| — Laptop Repair | Category with icon | — | ⚠️ Need icon URLs |
| — Water Filter | Category with icon | — | ⚠️ Need icon URLs |
| — Mobile Repair | Category with icon | — | ⚠️ Need icon URLs |
| — Others | Show all categories | — | ⚠️ Need icon URLs |
| Bottom nav | Home / Service / Orders / Payments / Profile | — | App-side |

**Recommendation:** Add `iconUrl` and `startingPrice` to service types response so the app can render category cards with icons and price indicators.

---

### 3.5 Service Request Form
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Service type | Pre-selected from category | `serviceType` | ✅ Ready |
| Brand | Text input (e.g. "Samsung") | `brand` | ✅ Ready |
| Model | Text input | `model` | ✅ Ready |
| Description | Textarea for problem | `description` | ✅ Ready |
| Photos | Multi-image picker (max 5) | `photos[]` | ✅ Ready |
| Preferred date | Date picker | `preferredDate` | ✅ Ready |
| Preferred time | Time slot selector | `preferredTime` | ✅ Ready |
| Address | Text + map pin | `address` + `locationLat/Long` | ✅ Ready |
| Booking fee | Display ₹250 | `bookingFee` | ✅ Ready |
| Submit | "Request Service" button | `POST /api/services/create` | ✅ Ready |

**API: `POST /api/services/create`**
```json
{
  "serviceType": "AC Repair",
  "brand": "Samsung",
  "model": "AR18TY",
  "description": "AC not cooling properly",
  "photos": ["url1.jpg", "url2.jpg"],
  "address": "123 Main St, Sirsi",
  "locationLat": 14.5886,
  "locationLong": 74.8345,
  "bookingFee": 250
}
```

**Note:** Photos need a file upload API. Currently `photos` field expects URLs — need to build upload endpoint that returns URLs to store.

---

### 3.6 My Service Requests (User)
**Design:** Implied from flow

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Request list | List of user's service requests | `GET /api/services/my-requests` | ✅ Ready |
| Status badge | Color-coded status display | `status` field | ✅ Ready |
| Request details | Tap to view full details | Service request object | ✅ Ready |
| Cancel button | Cancel if pre-assignment | `POST /api/services/:id/cancel` | ✅ Ready |

**Status Display Mapping:**
| Status | Label | Color |
|--------|-------|-------|
| created | Request Placed | Blue |
| assigned | Partner Assigned | Orange |
| accepted | Partner Accepted | Green |
| in_progress | Service In Progress | Yellow |
| completed | Completed | Green |
| cancelled | Cancelled | Red |
| disputed | Under Review | Red |

---

### 3.7 Incoming Services (Partner)
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Request cards | List of assigned requests | `GET /api/serviceman/assignments` | ✅ Ready |
| Customer info | Name, avatar | Included in assignment | ⚠️ No profile picture |
| Request title | "Request for {serviceType} service" | `serviceType` | ✅ Ready |
| Request ID | Display request identifier | `serviceId` | ✅ Ready |
| Date | Assignment date | `assignedAt` | ✅ Ready |
| Price | "₹{price} per hour" | — | ⚠️ Need hourly rate |
| Accept button | Accept the job | `POST /api/serviceman/requests/:id/accept` | ❌ NOT BUILT |
| Deny button | Reject the request | `POST /api/serviceman/requests/:id/deny` | ❌ NOT BUILT |

**Critical Gap:** The app design prominently shows Accept/Deny buttons, but these API endpoints don't exist yet.

**Required New Endpoints:**
```
POST /api/serviceman/requests/:id/accept
  → Updates status: assigned → accepted
  → Returns: updated service request

POST /api/serviceman/requests/:id/deny
  → Updates status: assigned → created (returns to pool)
  → Requires: { reason: "string" }
  → Returns: success message
```

---

### 3.8 Past Services (Partner)
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Service list | Completed services history | `GET /api/serviceman/assignments?status=completed` | ⚠️ Need filter |
| Service icon | Category icon | — | ⚠️ Need icon URLs |
| Service name | e.g. "TV Repair" | `serviceType` | ✅ Ready |
| Service ID | e.g. "254-647-944F" | `serviceId` | ✅ Ready |
| Date | Completion date | `completedAt` | ✅ Ready |
| Price | Earnings from this service | `totalAmount` | ✅ Ready |
| Rating | Star rating (e.g. ★ 4.7) | — | ❌ NOT BUILT |

**Critical Gap:** No rating system exists. Design shows star ratings on every past service.

---

### 3.9 Service Details (Partner)
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Header | "Request for {serviceType} service" | `serviceType` | ✅ Ready |
| Customer name | Customer who booked | via `userId` join | ✅ Ready |
| Service Request ID | e.g. "254-647-944F" | `serviceId` | ✅ Ready |
| Date | Service date | `createdAt` | ✅ Ready |
| Customer ID | e.g. "A7556367" | `userId` | ⚠️ Need UFID format |
| Amount received | Earnings | `totalAmount` | ✅ Ready |
| Time | Service time | `startedAt` / `completedAt` | ✅ Ready |
| Download Invoice | Generate and download PDF | `GET /api/invoices/:id/download` | ❌ NOT BUILT |

**Required New Endpoint:**
```
GET /api/invoices/:id/download
  → Returns: PDF file stream
  → Content-Type: application/pdf
```

---

### 3.10 Profile Screen
**Design:** ✅ Complete

| Element | Requirement | Backend API | Status |
|---------|------------|-------------|--------|
| Profile picture | Circular avatar + edit icon | `GET/POST /api/client/profile/picture` | ❌ NOT BUILT |
| Full name | Display name | `username` | ✅ Ready |
| User ID | "UFID-{formatted_id}" | — | ⚠️ Need UFID format |
| Email | Display email | `email` | ✅ Ready |
| Edit Profile | Navigate to profile editor | `PATCH /api/client/auth/profile` | ✅ Ready |
| Contact Support | Open support form | `POST /api/support/ticket` | ❌ NOT BUILT |
| Log Out | Clear token, redirect to login | Client-side | ✅ Ready |
| Delete Account | Account removal | `DELETE /api/client/account` | ❌ NOT BUILT |

---

### 3.11 Bottom Navigation
**Design:** ✅ Complete (5 tabs)

| Tab | Icon | Description | User | Partner |
|-----|------|-------------|------|---------|
| Home | 🏠 | Dashboard / Categories | Home screen | — |
| Incoming Service | 📥 | Incoming assignments | — | Incoming requests |
| Past Service | 📋 | History & tracking | My requests | Past services |
| Start Service | ▶️ | Initiate service | — | OTP + start service |
| Payments | 💰 | Payment/wallet | Payment history | Wallet & earnings |
| Profile | 👤 | User profile | Profile | Profile |

**Note:** Navigation tabs differ between User and Partner views based on role.

---

## 4. Feature Requirements Not in Figma (But Needed for App)

### 4.1 Password Reset Flow
```
Forgot Password → Enter Phone/Email → Receive OTP → Enter OTP → New Password → Success
```

**Required APIs:**
| API | Purpose | Status |
|-----|---------|--------|
| `POST /api/auth/forgot-password` | Initiate reset, send OTP | ❌ Build |
| `POST /api/auth/verify-reset-otp` | Verify OTP, return reset token | ❌ Build |
| `POST /api/auth/reset-password` | Change password with reset token | ❌ Build |

### 4.2 Rating & Review System
After service completion, user rates the partner (1-5 stars + optional text review).

**Required APIs:**
| API | Purpose | Status |
|-----|---------|--------|
| `POST /api/ratings/service/:serviceId` | Submit rating | ❌ Build |
| `GET /api/ratings/provider/:providerId` | Get provider's ratings | ❌ Build |
| `GET /api/ratings/provider/:providerId/average` | Average rating | ❌ Build |

**Database Table Needed:**
```sql
CREATE TABLE ratings (
  id SERIAL PRIMARY KEY,
  service_request_id INTEGER REFERENCES service_requests(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER REFERENCES service_providers(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4.3 Push Notifications
| Trigger | Notification to | Content |
|---------|----------------|---------|
| Service request created | Admin | "New service request: {type}" |
| Partner assigned | User | "A partner has been assigned to your request" |
| Partner accepts | User | "{partnerName} accepted your request" |
| Service started | User | "Your {serviceType} service has started" |
| Service completed | User | "Service completed! Rate your experience" |
| Payment received | Partner | "₹{amount} credited to your wallet" |
| New assignment | Partner | "New job: {serviceType} at {location}" |

**Required APIs:**
| API | Purpose | Status |
|-----|---------|--------|
| `POST /api/notifications/register-device` | Register FCM/APNS token | ❌ Build |
| `GET /api/notifications` | Get user's notifications | ❌ Build |
| `PATCH /api/notifications/:id/read` | Mark as read | ❌ Build |

### 4.4 Support Ticket System
**Required APIs:**
| API | Purpose | Status |
|-----|---------|--------|
| `POST /api/support/ticket` | Create ticket | ❌ Build |
| `GET /api/support/tickets` | User's tickets | ❌ Build |
| `POST /api/support/tickets/:id/message` | Add message | ❌ Build |

### 4.5 Profile Picture Upload
**Required APIs:**
| API | Purpose | Status |
|-----|---------|--------|
| `POST /api/client/profile/picture` | Upload image | ❌ Build |
| `DELETE /api/client/profile/picture` | Remove image | ❌ Build |

**Implementation:** Use multipart/form-data upload → store in cloud (S3/Cloudinary) → save URL to user record.

### 4.6 Account Deletion
**Required API:**
| API | Purpose | Status |
|-----|---------|--------|
| `DELETE /api/client/account` | Delete account + data | ❌ Build |

**Flow:** Confirm via password → soft-delete user → anonymize data → schedule hard delete after 30 days.

---

## 5. API Endpoints Summary for App

### Already Working (Use Immediately)
| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/signup` | Register new user/partner |
| `POST /api/auth/login` | Login with phone + password |
| `POST /api/services/create` | Create service request |
| `GET /api/services/my-requests` | User's service history |
| `POST /api/services/:id/cancel` | Cancel request |
| `GET /api/serviceman/assignments` | Partner's assigned jobs |
| `POST /api/serviceman/location/update` | Update partner GPS |
| `POST /api/service/verify-handshake` | Verify OTP at service start |
| `POST /api/service/start` | Start service (geo-fenced) |
| `POST /api/service/complete` | Complete service |
| `GET /api/products/list` | Browse products |
| `POST /api/cart/add` | Add to cart |
| `GET /api/cart` | View cart |
| `DELETE /api/cart/:id` | Remove from cart |
| `POST /api/orders/place` | Place product order |
| `POST /api/validate-pincode` | Check if area is serviced |
| `POST /api/otp/send` | Send OTP |
| `POST /api/otp/verify` | Verify OTP |

### Must Build Before App Launch
| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /api/auth/forgot-password` | Password reset initiation | 🔴 Critical |
| `POST /api/auth/reset-password` | Complete password reset | 🔴 Critical |
| `POST /api/auth/social/google` | Google OAuth login | 🔴 Critical |
| `POST /api/auth/social/facebook` | Facebook OAuth login | 🔴 Critical |
| `POST /api/serviceman/requests/:id/accept` | Accept assigned job | 🔴 Critical |
| `POST /api/serviceman/requests/:id/deny` | Deny assigned job | 🔴 Critical |
| `POST /api/ratings/service/:id` | Rate completed service | 🔴 Critical |
| `GET /api/ratings/provider/:id` | Get provider ratings | 🟡 Important |
| `POST /api/client/profile/picture` | Upload profile picture | 🟡 Important |
| `DELETE /api/client/account` | Delete user account | 🟡 Important |
| `GET /api/invoices/:id/download` | Download PDF invoice | 🟡 Important |
| `POST /api/support/ticket` | Create support ticket | 🟡 Important |
| `POST /api/notifications/register-device` | Register push token | 🟡 Important |
| `GET /api/notifications` | Get notifications | 🟡 Important |

---

## 6. Data Contracts (Key Request/Response Formats)

### 6.1 Auth Token
All authenticated requests must include:
```
Authorization: Bearer <jwt_token>
```

Token payload contains:
```json
{ "userId": 123, "role": "user" | "serviceman", "iat": ..., "exp": ... }
```

### 6.2 Error Response (Consistent)
```json
{
  "success": false,
  "message": "Error description"
}
```

### 6.3 Paginated Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

### 6.4 Service Status Values
```typescript
type ServiceStatus = 
  'created' | 'assigned' | 'accepted' | 
  'in_progress' | 'completed' | 'cancelled' | 'disputed';
```

### 6.5 Order Status Values
```typescript
type OrderStatus = 
  'placed' | 'confirmed' | 'in_transit' | 
  'out_for_delivery' | 'delivered' | 'cancelled';
```

---

## 7. Technical Integration Notes

### 7.1 Authentication Storage
- **iOS:** Keychain
- **Android:** EncryptedSharedPreferences / Keystore
- **Token Refresh:** Re-login when 401 received (no refresh token endpoint yet)
- **Token Expiry:** 30 days for users

### 7.2 Location Services
- Partner app must send GPS updates periodically via `POST /api/serviceman/location/update`
- Service start requires being within 500m of service location (geo-fencing)
- Location format: `{ lat: number, long: number }`

### 7.3 Image Uploads
- Currently `photos` field expects URL strings
- **Need to build:** File upload API that returns URLs
- Recommended: Use multipart/form-data → cloud storage → return CDN URL

### 7.4 Payment Integration
- Razorpay SDK should be integrated in the mobile app
- Flow: Create order (server) → Open Razorpay checkout (app) → Verify payment (server webhook)
- Booking fee: ₹250 on service creation
- Final payment: After service completion

### 7.5 Real-time Updates (Future)
- Currently polling-based (app must refresh)
- WebSocket support planned for live updates
- Push notifications planned via FCM (Android) / APNS (iOS)

---

## 8. Implementation Roadmap for App

### Phase 1: Core App (Weeks 1-3)
- [ ] Splash screen + user type selection
- [ ] Login with email/phone
- [ ] Sign up with all fields
- [ ] Home screen with service categories
- [ ] Service request form + submission
- [ ] My service requests list
- [ ] Basic profile view/edit
- [ ] Logout

### Phase 2: Partner Features (Weeks 3-5)
- [ ] Incoming services list
- [ ] Accept/deny requests (after backend builds API)
- [ ] OTP verification handshake
- [ ] Start service (with geo-fence)
- [ ] Complete service
- [ ] Past services history

### Phase 3: Enhanced Features (Weeks 5-7)
- [ ] Password reset flow
- [ ] Google/Facebook login
- [ ] Rating & reviews
- [ ] Profile picture upload
- [ ] Invoice download
- [ ] Product browsing & cart
- [ ] Order placement & tracking

### Phase 4: Polish (Weeks 7-9)
- [ ] Push notifications
- [ ] Support ticket system
- [ ] Payment integration (Razorpay SDK)
- [ ] Account deletion
- [ ] Settings & preferences
- [ ] Error handling & edge cases
- [ ] App Store/Play Store submission

---

## 9. Design System Notes (From Figma)

### Color Palette
- **Primary:** #2196F3 (Blue)
- **Primary Light:** #64B5F6
- **Background:** #FFFFFF
- **Surface:** #F5F5F5
- **Text Primary:** #212121
- **Text Secondary:** #757575
- **Success:** #4CAF50
- **Error:** #F44336
- **Warning:** #FFC107

### Typography
- Headings: Semi-bold, 18-24px
- Body: Regular, 14-16px
- Captions: Regular, 12px

### Component Style
- Cards: White background, subtle shadow, rounded corners (12px)
- Buttons: Full-width primary blue, rounded corners (8px)
- Inputs: Outlined style with icons, rounded (8px)
- Bottom nav: 5 tabs, active tab highlighted in blue

---

*This document serves as the complete reference for the UniteFix Mobile App for the Emergent AI development team. All API endpoints referenced here coordinate with the backend system documented in `BACKEND_ADMIN_REQUIREMENTS.md`.*
