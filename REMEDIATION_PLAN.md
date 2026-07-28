# UniteFix — Remediation Plan

Outstanding issues found during the UI, data-consistency and auth audits, ordered by
what should be done first. Nothing here has been fixed yet.

**Legend —** Effort: S ≈ under an hour · M ≈ half a day · L ≈ 1–2 days.

---

## Phase 0 — Do today (credential exposure)

### 0.1 Rotate the leaked production database password
**Issue:** `scripts/resetRenderDb.ts` contains the live Render Postgres connection
string, password in plaintext, and is committed to git (`e47b923`).

```
postgresql://unitefix_db_user:F6V0…@dpg-d866tit7vvec7382re10-a.singapore-postgres.render.com/unitefix_db
```

**Why it can't wait:** anyone with repo access — past collaborators, anyone who
cloned it, any future leak — has full read/write on production. Deleting the file
does **not** help: the password stays in git history forever.

**Steps**
1. Render dashboard → database → rotate credentials.
2. Update `RENDER_DATABASE_URL` in `.env` and in Render's own service env vars.
3. Delete `scripts/resetRenderDb.ts` and `scripts/reset-render-db.ts`.
4. Only then consider history rewriting (see 0.2).

**Effort:** S · **Risk if skipped:** total data loss / breach.

### 0.2 Decide on git history
The password remains in history even after the file is deleted. Options:

| Option | Trade-off |
|---|---|
| **Rotate only** (recommended) | The leaked password becomes worthless. Simple, no history rewrite, no coordination. |
| Rotate + `git-filter-repo` | Also scrubs history, but rewrites every commit hash — everyone must re-clone. Only worth it if the repo will ever be made public. |

**Recommendation:** rotate and move on. The rewrite is rarely worth the disruption
for a private repo.

### 0.3 Remove the unguarded reset scripts
`reset-db.ts`, `resetRenderDb.ts`, `reset-render-db.ts` all run
`DROP SCHEMA public CASCADE` with no confirmation, no dry run and no indication of
which database they will destroy. `scripts/reset-for-testing.ts` now covers this
safely (dry-run default, named env var, prints target).

**Effort:** S

---

## Phase 1 — Security (this week)

### 1.1 Privilege escalation: anyone can self-register as admin — **CRITICAL**
**Issue:** `POST /api/auth/signup` (`server/routes.ts:359`) is unauthenticated and
does `insertUserSchema.parse(req.body)`, which accepts `role` from the body.
Verified: `role: "admin"` survives parsing and reaches `storage.createUser`, and the
route returns an admin JWT immediately. `authenticateAdmin` only checks the JWT
claim — it never confirms the caller exists in `adminUsers`.

**Impact:** one unauthenticated POST → full `/api/admin/*`: platform config (fees),
withdrawal approval (money out via RazorpayX), dispute resolution, all customer data.

**Fix (two independent layers, do both)**
1. In that route, stop trusting the body. Pick the role server-side exactly as
   `/api/auth/signup/complete` already does:
   `const userRole = req.body.role === 'serviceman' ? 'serviceman' : 'user'`, and
   build the insert from an explicit allow-list (`phone`, `email`, `username`,
   `password`, `pinCode`) rather than spreading the parsed body. Also drop
   `isVerified` / `isActive` / `phoneVerified` from client control.
2. In `authenticateAdmin`, look the admin up in `adminUsers` and confirm `isActive`
   before granting access — the same live-DB check `authenticatePartner` already does.

Layer 2 alone neutralises the escalation even if a similar hole reappears.

**Effort:** S · **Test:** `POST /api/auth/signup {role:"admin"}` must produce a
`user`-role account, and an old admin-role JWT must be rejected.

### 1.2 Auth rate limiting is dead code — **CRITICAL**
**Issue:** `app.use("/api/auth", authLimiter)` sits at `routes.ts:2159`, but every
auth route is registered earlier (Truecaller router at 173, legacy auth 181–720, OTP
at 1987). Express matches in registration order, so those three `app.use` lines can
never fire.

Routes with an inline limiter still work (`/login`, `/forgot-password`,
`/verify-reset-otp`, `/admin/auth/login`, `/signup/initiate`, `/signup/verify`).
**Unprotected:** the whole Truecaller router (`/truecaller/verify`,
`/fallback/request-otp`, `/fallback/verify-otp`, `/fallback/firebase-verify`,
`/check-phone`), plus `/signup`, `/signup/complete`, `/reset-password`,
`/api/otp/send`, `/api/otp/verify`.

`verifyOtp` caps attempts at 5 **per OTP record** and always picks the newest, so
unlimited `request-otp` calls reset the window — the lockout is bypassable, and each
call sends an email (cost + inbox bombing).

**Fix:** move the three `app.use(...limiter)` lines to the top of `registerRoutes`,
before any route registration. Then add a short cooldown on `request-otp`
(e.g. reject if an unexpired OTP for that phone was issued < 60s ago).

**Effort:** S

### 1.3 `trust proxy` is unset — rate limits are global, not per-user — **HIGH**
**Issue:** no `app.set('trust proxy', …)` anywhere and no custom `keyGenerator`, so
`req.ip` is Render's proxy address — identical for every user. Every working limiter
therefore shares **one bucket across your entire user base**: `/api/client` is capped
at 60 requests/minute *in total*.

This is the most likely cause of the intermittent "Failed to save address" and
profile-not-updating reports: a 429 on `GET /api/client/profile` leaves the form
blank, and a 429 on the `PATCH` fails the save.

**Fix:** `app.set('trust proxy', 1)` in `server/index.ts` before the limiters.
Verify by logging `req.ip` for two devices on different networks — they must differ.

**Effort:** S · **High payoff:** likely fixes a live user-facing bug.

### 1.4 OTPs and reset codes written to logs in plaintext — **HIGH**
| File | Leak |
|---|---|
| `server/storage.ts:1524` | `console.log('[OTP_DEBUG] … stored=${verification.otp} …')` on every verification |
| `server/routes.ts:637` | `console.log('[PASSWORD RESET] OTP for ${phone}: ${otp}')` |
| `server/routes/geofence.routes.ts:212` | logs the expected service handshake OTP |

All use `console.log`, bypassing `LOG_LEVEL`, so they run in production. Anyone with
Render log access can read live login and password-reset codes.

**Fix:** delete the values from the log lines (keep the events, drop the secrets).
Gate anything still needed behind `if (process.env.NODE_ENV !== 'production')`.

**Effort:** S

### 1.5 Session revocation gaps — **HIGH**
- `POST /api/auth/logout` is guarded by `authenticateToken`, which is **customer-only**.
  A partner's logout 403s, the mobile `catch` swallows it, local state clears — and
  their refresh token stays valid server-side for 30 days.
  **Fix:** switch that route to `authenticateAny`.
- `POST /api/auth/reset-password` never calls `TokenService.revokeUserTokens`, so a
  password reset does not end existing sessions.
  **Fix:** call it after the password update.

**Effort:** S

### 1.6 New partners are locked out of their own onboarding — **HIGH**
**Issue:** signup creates the employee with `isActive: false` (awaiting approval), but
`authenticatePartner` rejects `isActive === false` with *"Your partner account has been
suspended. Please contact support."* `GET /api/partner/verification-status` — the exact
endpoint `EmployeePendingScreen` polls — is behind that middleware.

So every new technician is told they are **suspended**, cannot refresh their status, and
must log out and back in after approval (the store's `documentVerificationStatus` is only
written at login).

`employees.isActive` is overloaded: "admin-approved" *and* "not suspended", and the
middleware reads it as the latter.

**Fix:** separate the two. Let `authenticatePartner` allow an unverified-but-not-suspended
partner through to read-only status endpoints, gating on
`documentVerificationStatus === 'suspended'` for the hard block instead of `isActive`.
Keep `isActive` for assignment eligibility.

**Effort:** M (touches middleware — regression-test partner auth)

### 1.7 Medium-severity hardening
- Admin JWTs put `adminUsers.id` in the same `userId` claim customer tokens use for
  `users.id`, signed with the same secret. Cross-use is currently blocked by role
  checks, but the namespaces collide by convention only — add an `aud`/`typ` claim.
- Password policy is length ≥ 6 with no complexity requirement.
- On Truecaller login, an existing customer who taps "Partner" is silently signed in as a
  customer. The server correctly ignores the client role; the user just gets no
  explanation. Surface `alreadyRegistered` / role mismatch in the UI.

**Effort:** M total

---

## Phase 2 — Correctness & polish (next sprint)

### 2.1 Restore partners locked out by the old delete bug
Until `55bada3`, a failed employee delete still soft-deleted the **user** (the two writes
weren't in a transaction), so partners were locked out of accounts the admin was told were
*not* deleted.

**Fix:** query for `users.deletedAt IS NOT NULL` where the linked employee is still
`isActive` — the exact signature — review the list, and clear `deletedAt` for the
legitimate ones. I can write the read-only detection script; you run the restore.

**Effort:** S · **Note:** both databases were just reset, so this only matters if you
restore from a pre-reset backup.

### 2.2 Reduce polling
`useAssignments` and `useServiceRequests` both poll every 5s. On a field app that is
heavy on battery and data, and it multiplies the effect of 1.3. Suggest 15–30s, or
`refetchOnWindowFocus` plus a longer interval. Deliberately left alone so far because
it is a product-behaviour decision, not a bug.

**Effort:** S

### 2.3 Dead API methods pointing at routes that never existed
`createPaymentOrder`, `getPaymentStatus`, `generateOTP` (customer) and `validateOtp`
(partner) all target unimplemented endpoints. Currently uncalled and annotated as such.
Either implement or delete — leaving them invites someone to wire one up.

**Effort:** S

### 2.4 Duplicated logic worth consolidating
- `server/repositories/*` is a complete parallel implementation of `storage.ts` that
  nothing imports. Two copies of partner/user/order logic will drift. Delete or adopt.
- `server/routes.ts` is 2,200 lines and registers routes that also exist in the modular
  files, with the legacy copies winning by registration order. Worth finishing the
  migration.

**Effort:** L

---

## Suggested order

| Order | Item | Why |
|---|---|---|
| 1 | 0.1 rotate credential | Active exposure |
| 2 | 1.1 privilege escalation | Remotely exploitable, full admin |
| 3 | 1.3 trust proxy | Small change, likely fixes live user-facing failures |
| 4 | 1.2 rate limiter ordering | Restores brute-force protection |
| 5 | 1.4 secrets in logs | Small, removes takeover path |
| 6 | 1.5 + 1.6 auth gaps | Unblocks partner onboarding |
| 7 | 0.3 remove reset scripts | Prevents accidental production nuke |
| 8 | Phase 2 | Non-urgent |

Items 2–5 are each an hour or less and together close every critical finding.
