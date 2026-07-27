# UniteFix — Data Consistency Audit

**Date:** 2026-07-27
**Scope:** `mobile/` ↔ `server/` ↔ `shared/schema.ts` round-trips for profile, address/booking, partner profile, API contracts, React Query cache invalidation, and status propagation.

**Method:** every `apiClient.*` call in the mobile app (91 call sites) was extracted and diffed against every registered Express route (235, including sub-router mount prefixes). Field names were then traced call-site → route handler → Drizzle column. Every `useMutation` was checked for `invalidateQueries`.

**Verification:** `tsc --noEmit` clean on both projects; server bundles via esbuild; mobile bundles via Metro (3262 modules).

---

## 1. Issues Found

| # | File | Line | Issue | Severity |
|---|---|---|---|---|
| 1 | `mobile/src/screens/customer/SupportTicketScreen.tsx` | 62, 71 | Calls `/api/client/support-tickets`; server registers `/api/client/tickets`. Both list and create 404 — support ticketing entirely non-functional. | **CRITICAL** |
| 2 | `mobile/src/screens/customer/RequestDetailScreen.tsx` | 175 | Binds to `route.params.request`, a snapshot frozen at navigation time. Never re-reads the live query, so status, `handshakeOtp`, technician details and payment state never update while the screen is open. | **CRITICAL** |
| 3 | `server/routes/admin.routes.ts` | 587 | `PATCH /api/admin/config/:key` writes via `storage.updatePlatformConfig` and never invalidates `ConfigService`'s 5-minute cache. Admin sees "saved"; every reader keeps the old value. | **CRITICAL** |
| 4 | `server/routes/client-features.routes.ts` | 31 | Local `new ConfigService()` owns a private cache, separate from the exported singleton used by `BillingEngine`. `/api/config/public` and the billing snapshot can disagree on the booking fee. | **CRITICAL** |
| 5 | `mobile/src/screens/customer/MapAddressPickerScreen.tsx` | 94, 198 | `reverseGeocode` reads `place.postalCode` but only concatenates it into the address string; `handleSave` omits `pinCode`. Places-autocomplete path never resolves one at all. Every saved address has `pinCode: undefined` → bookings send the literal `'000000'`. | **HIGH** |
| 6 | `mobile/src/api/partner.api.ts` | 100 | `updateLocation` sends `{ latitude, longitude }`; handler destructures `{ lat, long }` → both `undefined` → 400. Classic camelCase mismatch. Currently uncalled. | **HIGH** |
| 7 | `mobile/src/screens/customer/OtpDisplayScreen.tsx` | 42 | POSTs `/api/customer/services/:id/generate-otp`, which does not exist. The handshake OTP is minted server-side and read from the booking. | **HIGH** |
| 8 | `mobile/src/screens/customer/SavedAddressesScreen.tsx` | 51 | `handleDelete` removes the row from local state *before* the request and never inspects the result. A failed PATCH leaves the address deleted on screen but alive in the DB. | **HIGH** |
| 9 | `mobile/src/screens/customer/MapAddressPickerScreen.tsx`, `SavedAddressesScreen.tsx` | 207, 51 | Both call `customerApi.updateProfile` directly, bypassing `useUpdateProfile`. Nothing invalidates `queryKeys.profile`, so `HomeScreen`/`ProfileScreen` keep serving the stale address list. | **HIGH** |
| 10 | `mobile/src/screens/partner/PartnerProfileScreen.tsx` | 58 | Availability `Switch` seeds from `useAuthStore().user.isOnline`, written once at login and persisted to SecureStore. After relaunch it shows login-time state, not `employees.isOnline`. | **MEDIUM** |
| 11 | `mobile/src/api/customer.api.ts` | 184 | `markNotificationRead` uses `PATCH`; server registers `PUT` → 404. Currently uncalled (no UI wires it). | **MEDIUM** |
| 12 | `mobile/src/api/customer.api.ts` | 170, 173, 211 | `createPaymentOrder`, `getPaymentStatus`, `generateOTP` target routes that were never implemented. All currently uncalled. | **MEDIUM** |
| 13 | `mobile/src/api/partner.api.ts` | 96 | `validateOtp` targets `/api/technician/*`, a namespace that does not exist. Currently uncalled. | **MEDIUM** |
| 14 | `server/routes.ts` | 2195 | `registerTruecallerAuthRoutes(app)` called twice, mounting the same router at `/api/auth` a second time. | **MEDIUM** |
| 15 | `mobile/src/hooks/useShopData.ts` | 109 | `useRequestReturn` has no `onSuccess` invalidation; the orders list keeps showing pre-return status. | **MEDIUM** |
| 16 | `mobile/src/hooks/useCustomerData.ts` | 55 | `usePartnerProfile` comment claims the route returns the employee directly. It returns `{ success, data: employee }` — which is why call sites defensively read `x?.data?.field ?? x?.field`. | **LOW** |

### Not fixed (reported only)

| File | Issue | Why not fixed |
|---|---|---|
| `server/routes.ts` (`POST /api/services/create`) | Mobile sends `pinCode`; `service_requests` has **no** `pinCode` column, so `insertServiceRequestSchema` (Zod) strips it silently. | No downstream consumer reads a per-booking pincode, and adding a column is a schema change, outside "fix broken data flows". Issue #5 still matters because the *saved address* loses its pincode. |
| `server/routes/geofence.routes.ts:104` | When `customerLocation` is null the 200 m geofence is **skipped** (`distanceMeters = 0`), so a partner can mark "arrived" from anywhere. | Deliberate per the inline comment (admin-created bookings). Business-rule decision, not a data-flow defect. |
| `mobile/src/screens/customer/ServiceRequestScreen.tsx:48` | `deviceLocation` is captured on mount and never used; `customerLocation` correctly uses the selected address coords. | Dead state only — no incorrect data reaches the server. |
| `mobile/src/screens/customer/NotificationsScreen.tsx` | Renders `isRead` styling but nothing ever marks a notification read. | Missing feature, not a broken flow. Contract bug #11 fixed so it works when wired. |

---

## 2. Fixes Applied

### #1 — Support tickets pointed at a non-existent route

```diff
- const res = await apiClient.get('/api/client/support-tickets');
+ // Server route is /api/client/tickets (client-features.routes.ts).
+ // The old '/api/client/support-tickets' path never existed and 404'd.
+ const res = await apiClient.get('/api/client/tickets');

- apiClient.post('/api/client/support-tickets', data),
+ apiClient.post('/api/client/tickets', data),
```

Body (`{ subject, description }`) and response envelope already matched; only the path was wrong.

### #2 — Detail screen frozen at navigation time

`useServiceRequests` polls every 5 s, so the **list** updated while the open **detail** screen did not. A customer sitting on the screen never saw the partner accept, and — because `showServiceCode` requires `status ∈ {accepted, reached}` **and** `handshakeOtp`, neither present in an `assigned` snapshot — the 6-digit service code never appeared.

```diff
- const request: ServiceRequest = route.params?.request;
+ // route.params.request is a snapshot frozen at navigation time. Re-read the
+ // booking from the live (5s-polled) list so status, handshakeOtp, technician
+ // details and payment state stay in sync while this screen is open — the
+ // same pattern AssignmentDetailScreen already uses on the partner side.
+ const routeRequest: ServiceRequest = route.params?.request;
+ const { data: liveRequests } = useServiceRequests();
+ const request: ServiceRequest =
+     (liveRequests as ServiceRequest[] | undefined)?.find(
+         (r) => r.id === routeRequest?.id || (!!r.serviceId && r.serviceId === routeRequest?.serviceId),
+     ) || routeRequest;
```

The `|| routeRequest` fallback keeps history items working. Verified `/api/services/my-requests` returns **all** statuses (`storage.getUserServiceRequests` filters only on `userId`).

### #3 + #4 — Admin config changes silently ineffective

```diff
  await storage.updatePlatformConfig(key, String(value), adminUserId);
  }
+ // ConfigService caches every key for 5 minutes. Writing straight to
+ // storage left both the public config endpoint and BillingEngine
+ // serving the previous value long after the admin saw "saved" — the
+ // app could quote one booking fee while billing froze another.
+ configService.invalidate(key);
```

```diff
- import { ConfigService } from "../services/config.service";
- // Config service instance
- const configService = new ConfigService();
+ // Use the shared singleton. A local `new ConfigService()` here carried its own
+ // 5-minute cache, so /api/config/public and BillingEngine could disagree about
+ // the booking fee after an admin edit.
+ import { configService } from "../services/config.service";
```

### #5 — Pincode discarded when saving an address

```diff
  if (place.postalCode) parts.push(place.postalCode);
  setAddressText(parts.join(', '));
+ if (place.postalCode) setPostalCode(place.postalCode);

  const newAddress: SavedAddress = {
      label, address: addressText,
      lat: markerCoordinate.latitude, long: markerCoordinate.longitude,
+     ...(postalCode ? { pinCode: postalCode } : {}),
  };
```

The Places path now requests `address_component` and extracts `postal_code`, leaving `formatted_address` untouched.

### #6, #7, #11–13 — Broken API contracts

```diff
- markNotificationRead: (id) => apiClient.patch(`/api/notifications/${id}/read`),
+ // Server registers this as PUT (notification.routes.ts); PATCH 404'd.
+ markNotificationRead: (id) => apiClient.put(`/api/notifications/${id}/read`),

- apiClient.post('/api/serviceman/location/update', { latitude, longitude }),
+ apiClient.post('/api/serviceman/location/update', { lat: latitude, long: longitude }),
```

`OtpDisplayScreen` now reads `handshakeOtp` off the live booking instead of POSTing to a route that never existed. The four unimplemented endpoints (#12, #13) were **annotated, not deleted**, per the no-removal rule.

### #8 + #9 — Address writes bypassed the cache and swallowed failures

```diff
+ const previous = addresses;
  const newAddresses = addresses.filter((_, i) => i !== index);
  setAddresses(newAddresses);
- await customerApi.updateProfile({ savedAddresses: newAddresses });
+ try {
+     await customerApi.updateProfile({ savedAddresses: newAddresses });
+     queryClient.invalidateQueries({ queryKey: queryKeys.profile });
+ } catch (err) {
+     setAddresses(previous);   // don't claim a deletion the server rejected
+     Alert.alert('Delete Failed', getApiErrorMessage(err));
+ }
```

### #10 — Availability toggle out of step with the DB

```diff
+ const fetchedIsOnline =
+     (partnerProfile as any)?.data?.isOnline ?? (partnerProfile as any)?.isOnline;
+ if (typeof fetchedIsOnline === 'boolean') setIsOnline(fetchedIsOnline);
```

Plus `invalidateQueries({ queryKey: queryKeys.partnerProfile })` after a successful toggle.

---

## 3. NOT BROKEN — verified working

**A. Customer profile round-trip.** `updateProfile` sends `{ username, email, homeAddress, pinCode, savedAddresses }`; `PATCH /api/client/profile` destructures exactly those names, maps them to real Drizzle columns on `users`, writes `savedAddresses` to `customers` (inserting the row if absent), returns the merged updated object, and `useUpdateProfile` invalidates `queryKeys.profile`. It also keeps `employees.fullName` in sync for servicemen.

**`phone` is intentionally read-only** — rendered with `editable={false}` and the label `profile.phone_readonly`. It is correctly excluded from both the payload and the handler; not a dropped field.

**B. Booking location persistence.** Mobile sends `customerLocation` as WKT `POINT(lng lat)` built from the selected address; the column is `text` and `storage.createServiceRequest` inserts it verbatim. `PATCH /api/bookings/:id/arrive` parses the WKT and feeds the coordinates to PostGIS `ST_MakePoint`/`ST_DistanceSphere` (never casting the text column), with a Haversine fallback if PostGIS is unavailable, and persists `reachedLat`/`reachedLong`. `address` stores and returns correctly.

**C. Partner profile writes.** `PUT /api/partner/profile/upi` and `PATCH /api/partner/profile/expertise` both validate input, `getOrCreateEmployee`, write with `.returning()`, and respond with the updated row. `PATCH /api/partner/availability` correctly gates on `documentVerificationStatus === 'verified'` before allowing online. RazorpayX sync failure during UPI update is explicitly non-fatal — the UPI still persists.

**D. Sub-router mounts.** `/api/auth/*` (`auth-truecaller.routes.ts`) and `/api/partner/profile/*` (`partner-profile.routes.ts`) resolve correctly through their `app.use()` prefixes — these appeared as false positives in the raw route diff.

**E. Cache invalidation.** 17 of 21 mutations already invalidate the right keys. `useCancelServiceRequest` additionally implements proper optimistic updates with rollback across both `serviceRequests` and `serviceHistory`. The two remaining non-invalidating mutations (`useValidatePincode`, `useGenerateRazorpayQR`) are read-only/side-effect-free and correctly need none.

**F. Status propagation.**
- `MyRequestsScreen` auto-refreshes via `refetchInterval: 5_000` on `useServiceRequests`.
- `AssignmentDetailScreen` (partner) **already** merges `route.params.assignment` with the live `useAssignments()` query — this was the reference pattern applied to fix issue #2.
- Razorpay `payment.captured` and `qr_code.credited` webhooks both transition the booking to `COMPLETED` server-side, and the customer's polling picks it up.

**G. `/api/v1/*` calls.** Not broken — `registerRoutes` installs a URL-rewrite middleware that maps `/api/v1/...` → `/api/...` before any handler runs.

**H. Response envelopes.** Every checked call site reads the correct depth. `SupportTicketScreen` and `PartnerProfileScreen` defensively handle both `data` and `data.data`, so they were unaffected by the envelope ambiguity noted in #16.

---

## 4. Commits

| Commit | Subject |
|---|---|
| `697c506` | fix(mobile): point support tickets at the real server route |
| `0b5fad2` | fix(mobile): show live booking state in RequestDetailScreen |
| `7300d35` | fix(mobile): persist pincode when saving an address from the map |
| `0af07f4` | fix(mobile): keep saved addresses in sync with the profile cache |
| `365e261` | fix(mobile): correct broken API contracts |
| `329a989` | fix(mobile): sync partner availability toggle with the database |
| `baa6e67` | fix(server): make admin config edits take effect immediately |
| `915a4ab` | fix: drop duplicate auth route mount and invalidate orders after return |
