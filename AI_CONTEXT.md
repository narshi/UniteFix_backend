# UniteFix - Master AI System Context & Execution Tracker

## 1. Project Overview & Meta-Directives
- **Project Name:** UniteFix (Home services & product marketplace for Uttara Kannada).
- **Core Strategy:** A single, unified mobile application (React Native/Expo) communicating with a monolithic Node.js REST API, utilizing a 3-tier environment setup (DEV, UAT, PROD).
- **AI Agent Role:** You are a Senior Solution Architect and Lead Developer. You write modular, clean, and highly secure TypeScript code. 
- **STRICT RULES FOR AI:**
  1. **NO Legacy Tables:** The `serviceProviders` table is dead. Do not reference it. All partners are managed in the `employees` table.
  2. **NO WebSockets for Tracking:** Geofencing is strictly a REST API check using PostGIS (`ST_DistanceSphere`). Do not build live location tracking.
  3. **NO Custom SMS OTPs:** We use Truecaller v3 SDK for *everything*. It natively handles 1-tap for users and Drop-Call/OTP fallback for non-users. Do not use Twilio/MSG91.
  4. **Trust No Client Math:** The mobile app NEVER calculates the final bill. The Node.js backend calculates all totals, platform fees (15%), and GST.
  5. **Product Ordering is HALTED:** All product/shop screens display "Coming Soon". Do not build product ordering flows. Focus is service bookings only.

## 2. Technology Stack
- **Mobile Client:** React Native (Expo SDK), Zustand (State), React Navigation.
- **Backend API:** Node.js, Express.js, TypeScript.
- **Database Layer:** Neon Serverless PostgreSQL, Drizzle ORM, PostGIS Extension.
- **Key Integrations:** Truecaller SDK v3 (Auth), Razorpay (Payments), Firebase FCM (Push Notifications), Google Maps API, AWS S3/Cloudinary (Media), WhatsApp Business (Support).

## 3. Core Architectural Truths

### A. The Unified Identity Model
- A single `users` table handles authentication.
- **Role Enum:** `'user' | 'admin' | 'serviceman'`.
- **Profile Linking:** `users.id` links 1:1 to `customers` (for users) OR `employees` (for servicemen).
- **Verification Gate:** If a user logs in with `role === 'serviceman'`, the app MUST check `employee.documentVerificationStatus`. If `'pending'`, they are locked to a `<PendingVerificationScreen/>`.

### B. The Booking State Machine
Bookings (`serviceRequests` table) must follow this strict state progression:
1. `CREATED` (User paid initial ₹99 fee).
2. `ASSIGNED` (Admin allocated an employee).
3. `ACCEPTED` (Employee accepted, backend generates 6-digit `handshakeOtp`).
4. `REACHED` (Employee marked arrived; backend validates via PostGIS < 200m).
5. `IN_PROGRESS` (Employee verified the `handshakeOtp` from the user).
6. `PENDING_PAYMENT` (Employee submitted final bill; waiting on user to pay).
7. `COMPLETED` (Final Razorpay transaction successful).

### C. The Dynamic Billing Engine
When a service finishes, the backend calculates:
`Subtotal = spare_parts_cost + service_labor_cost`
`Platform_Fee = Subtotal * 0.15`
`Taxable_Amount = Subtotal + Platform_Fee`
`GST = Taxable_Amount * 0.18`
`Final_Total = Taxable_Amount + GST - 99` (Minus initial booking fee).

### D. Cancellation & Support Policy
- **CREATED only:** Customer can cancel and receive a full ₹99 refund via Razorpay.
- **ASSIGNED and beyond:** Cancellation is **NOT allowed**. The cancel button is hidden.
- **Support Redirect:** Once a booking is `ASSIGNED` or later, show a "Contact Support" button that opens WhatsApp Business via deep link (`https://wa.me/{WHATSAPP_BUSINESS_NUMBER}?text=Booking:{serviceId}`).
- **Env var:** `WHATSAPP_BUSINESS_NUMBER` (E.164 format, e.g., `919876543210`).

### E. Employee Availability
- Employees have an `isOnline` boolean toggle (separate from admin-controlled `isActive`).
- Only employees matching **all 3 conditions** appear for assignment: `isOnline = true` AND `isActive = true` AND `documentVerificationStatus = 'verified'`.
- Employee can toggle online/offline from their dashboard.

### F. Assignment Timeout & Re-assignment
- If an employee doesn't `ACCEPT` within **4 hours**, the booking auto-reverts to `CREATED`.
- The admin is notified via push notification to re-assign.
- Implemented via a periodic task in `server/services/task_queues.ts`.

### G. Dispute Resolution
- `DISPUTED` can be raised from `IN_PROGRESS`, `PENDING_PAYMENT`, or `COMPLETED`.
- Admin reviews disputes via dashboard and can:
  - **Resolve in favor of customer:** Issue partial/full refund via Razorpay, close booking.
  - **Resolve in favor of employee:** Release held wallet funds, close booking.
  - **Force override:** Manually set booking to `COMPLETED` or `CANCELLED`.
- Resolution is logged in `auditLogs`.

### H. Post-Service Rating
- On `COMPLETED`, the backend sends an FCM push notification prompting the customer to rate.
- Rating prompt also appears in the `RequestDetailScreen` when status is `COMPLETED` and no rating exists.
- 1-5 stars + optional text review.

### I. Service Scheduling
- `serviceRequests` includes `preferredDate` (date) and `preferredTimeSlot` (enum: `'morning'` 8-12, `'afternoon'` 12-4, `'evening'` 4-8).
- Admin sees preferred schedule when assigning employees.
- Employee sees scheduled time on their assignment card.

### J. Referral System (Schema Ready, Rewards Deferred)
- `users.referralCode` is auto-generated on signup.
- `users.referredById` tracks who referred whom.
- **Reward mechanism is deferred** — no wallet credit or discount yet. Schema is ready for future activation.

### K. Product Ordering (Coming Soon)
- All product catalog, cart, checkout, and order tracking features are **paused**.
- Mobile app shows "Coming Soon" badge on the Shop tab.
- Backend product routes remain functional but are not exposed to end users.
- Will resume with Annual Maintenance Package feature in a future phase.

---

## 4. Execution Roadmap & State Tracker
*(Human: Update [ ] to [x] as tasks are completed. Provide this updated file to the AI at the start of any new session.)*

### Phase 0: Pre-Flight Cleanup
- [ ] Add "Coming Soon" overlay to product/shop screens in mobile.
- [ ] Remove old reference `.md` files (`API_DOCUMENTATION.md`, `APP_REQUIREMENTS.md`, `BACKEND_ADMIN_REQUIREMENTS.md`, `FINAL_REVIEW.md`, `expo_help.txt`).
- [ ] Delete `scratch_truecaller/` directory.
- [ ] Remove SMS env vars from `.env.example` (`TWILIO_*`, `MSG91_API_KEY`).
- [ ] Add `WHATSAPP_BUSINESS_NUMBER` to `.env.example`.
- [ ] Delete `server/routes/otp.routes.ts` (auth OTPs — replaced by Truecaller).
- [ ] Gate product-order routes behind feature flag or comment out.

### Phase 1: Database Re-Architecture (The Clean Slate)
- [ ] **Initialize PostGIS:** Ensure Neon DB has the PostGIS extension enabled.
- [ ] **Consolidate Models:** Delete `serviceProviders` from `schema.ts`. Move `walletBalance`, `skills`, `services`, `isActive`, `isOnline`, and a new `currentLocation` (`geometry(Point, 4326)`) into the `employees` table.
- [ ] **Update ServiceRequests:** Change plain lat/long columns to `customerLocation` (`geometry(Point, 4326)`). Add `preferredDate`, `preferredTimeSlot`, `reachedAt`, `reachedLat`, `reachedLong`.
- [ ] **Update State Machine:** Add `reached` and `pending_payment` to `serviceStatusEnum`. Update `booking-state-machine.ts` transitions. Cancellation only from `CREATED`.
- [ ] **Fix Billing Schema:** Change `bookingFee` default to `99`. Add `sparePartsCost` + `serviceLaborCost` to `serviceCharges`. Change OTP to 6-digit on `ACCEPTED`.
- [ ] **Wipe & Push:** Drop the existing DEV database and run `drizzle-kit push`.
- [ ] **Seed:** Run seed scripts for districts, pincodes, platform config, admin user.

### Phase 2: Truecaller v3 Unified Auth
- [ ] **Expo Config:** Add `TRUECALLER_APP_KEY` to `app.json` / `app.config.js`.
- [ ] **Mobile Integration:** Implement `react-native-truecaller-sdk` hook to trigger `TruecallerSDK.authenticate()`.
- [ ] **Backend Verification:** Update `auth-truecaller.routes.ts` to fetch Truecaller Public Keys and cryptographically verify the RSA signature of the payload.
- [ ] **Cleanup:** Delete `otp.service.ts` and remove MSG91/Twilio dependencies.

### Phase 3: The Verification Gate & App Navigation
- [x] **Update Zustand Store:** Ensure the user profile fetched on login includes the document verification status.
- [x] **Role-Based Router:** Update `RootNavigator.tsx` to handle the 3 branches: Customer Stack, Verified Partner Stack, and Pending Verification Screen.
- [x] **Build Holding UI:** Create `PendingVerificationScreen.tsx`.
- [x] **Employee Online/Offline:** Add toggle to employee dashboard, wire to `employees.isOnline`.

### Phase 4: REST API Geofencing
- [x] **Geofence Controller:** Create modular route for `PATCH /api/v1/bookings/:id/status`.
- [x] **PostGIS Query:** Write a Drizzle query using `ST_DistanceSphere` to compare `employee` coordinates against `serviceRequests.customerLocation`.
- [x] **Enforce Logic:** If distance <= 200m -> Update status to `REACHED`. If > 200m -> Return `403 Forbidden` with distance details.
- [x] **StartServiceScreen Update:** "I've Arrived" button → capture GPS → POST + OTP entry for REACHED → IN_PROGRESS.
- [x] **Config Update:** `MAX_SERVICE_START_DISTANCE → 200`. `geo.ts` kept for backward compat.

### Phase 5: Billing & Payments Automation
- [x] **Billing Controller:** Create API endpoint for Employee to submit `spare_parts_cost` and `service_labor_cost`.
- [x] **Backend Math:** Implement the Server-Side Billing Engine (Base + 15% + 18% GST - ₹99).
- [x] **Razorpay Link:** Generate the dynamic Razorpay payment order for the `Final_Total` and push notification to the User.
- [x] **Cancellation Refund:** Implement ₹99 Razorpay refund when customer cancels from `CREATED` state.
- [x] **WhatsApp Support:** Show "Contact Support" button (WhatsApp deep link) for bookings in `ASSIGNED` state or beyond.
- [x] **SubmitBillScreen:** Two numeric inputs with real-time billing breakdown.
- [x] **Config:** Added `UNITEFIX_FEE_PERCENT=15` to platform config. Removed hardcoded `COMMISSION_RATE`.

### Phase 6: Admin Dashboard Modernization (React 18)
- [x] **Role & Verification API:** Endpoints to list pending employees and update `documentVerificationStatus`.
- [x] **Financial Audit:** API to view complete breakdown of every `Final_Total` calculation per booking.
- [x] **Override Controls:** Endpoints for Admin to manually force a booking state change (e.g., overriding a failed geofence).
- [x] **Dispute Resolution:** Admin can resolve disputes (refund customer or release employee funds).
- [x] **Assignment Timeout:** Cron job in `task_queues.ts` to auto-revert stale `ASSIGNED` bookings after 4 hours.

---
**HOW TO PROMPT THE AI:**
"Read this `AI_CONTEXT.md` file. Review the unchecked tasks in the Execution Roadmap. We are currently working on Phase [X], Task [Y]. Please provide the exact code required to complete this task."