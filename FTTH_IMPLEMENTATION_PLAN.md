# FTTH Recharge — Implementation Plan

Supersedes the earlier draft. Rewritten after auditing the existing auth, payment,
billing and wallet code so the design fits what is already here instead of
assuming a greenfield.

Two corrections to the earlier review are folded in below and called out where
they land:

- The operator role does **not** require relaxing `authenticateAdmin` or
  auditing the ~90 existing `/api/admin/*` routes. A separate middleware is
  strictly safer and smaller. See §2.
- Operator settlement **cannot** reuse `walletTransactions` /
  `walletTransactionsV2`. Both have `partnerId → employees.id NOT NULL`
  (`shared/schema.ts:258`, `:532`). It needs its own ledger table modelled on
  the same shape. See §3.6.

---

## 0. Decisions taken

| Question | Decision |
| --- | --- |
| Operator identity | A row in `admin_users` with `role = 'operator'`. That column is `text` (`shared/schema.ts:943`), **not** an enum — no `ALTER TYPE`, and `user_role` is not touched at all. |
| Operator access control | New `authenticateOperator` middleware, used **only** on `/api/ftth/admin/*`. `authenticateAdmin` is left exactly as it is. |
| Money collection | Collected into UniteFix's Razorpay account. |
| Operator settlement | Accrued in an append-only `ftth_operator_ledger`, settled manually (offline) at first, with the ledger recording each settlement. |
| ISP-side recharge | UniteFix records payment success; the operator performs the actual recharge in their own portal and marks it done. |
| Revenue lines built now | Convenience fee (B2C) and lead fee (B2B). Both get a real data model, and both are set **per operator**. |
| Catalogue shape | Operator-authored. Speeds and durations are free integers, never an enum or a hardcoded ladder; the plan matrix may be sparse. Onboarding an ISP with an unusual tier must never need a deploy. |
| Operator onboarding | Public apply → super-admin approve. Built in Phase 0 so you are not the bottleneck at operator number ten. |
| Money units | **Integer paise everywhere**, matching `payment_transactions.amount` (`shared/schema.ts:870`). |

### Still needs a human answer (does not block Phases 0–2)

1. **Whose GSTIN invoices the ₹471?** This plan assumes the plan amount is the
   *operator's* supply to the customer and UniteFix invoices only its own
   convenience fee (₹10 = ₹8.47 + ₹1.53 GST, carved out exactly the way
   `billing-engine.ts:164` does it). If your CA says otherwise, §3.5's
   `operatorPayablePaise` / `platformRevenuePaise` split is the only thing that
   changes.
2. **Razorpay's position on third-party collection.** Collecting ₹471 that is
   substantially the operator's revenue is not standard merchant activity.
   Confirm with Razorpay before Phase 3. Phases 0–2 carry no such exposure.

---

## 1. Phasing

Each phase is independently shippable. Phase 2 already earns the lead-generation
fee with no payment risk.

| Phase | Scope | Gate |
| --- | --- | --- |
| **0** ✅ | Operator auth (`authenticateOperator`), apply + approve flow | **Shipped** — see §2.1 for what landed and the two design changes the tests forced |
| **1** ✅ | Schema, `ftth.routes.ts`, operator portal (Plans grid, Coverage, Customers, Leads, Settlements) | **Shipped** |
| **2** ✅ | Mobile: operator select, onboarding, lead + ID-request forms | **Shipped** |
| **3** ✅ | Recharge + payment, webhook-first | **Shipped** |
| **4** ✅ | Renewal reminders, settlement reporting | **Shipped** |

All four are built and green: `npm run smoke:ftth` runs both suites (27 + 33 = 60
assertions). See §10 for how to exercise it by hand.

---

## 2. Phase 0 — Operator auth

### Why not the original approach

The draft proposed adding `'operator'` to `userRoleEnum` and branching on
`role === 'operator'` in `client/src/App.tsx`. That does not work:

- `userRoleEnum` (`shared/schema.ts:7`) governs `users.role` — the **mobile**
  account table. The web dashboard never reads it.
- The dashboard authenticates via `authenticateAdmin`
  (`server/middleware/auth.middleware.ts:187`), which requires a live
  `admin_users` row with role `'admin'` or `'super_admin'` and re-reads that row
  on every request so a token claim alone grants nothing (`:226`, `:265`).

### What to build

**`server/middleware/auth.middleware.ts`** — add `authenticateOperator`,
mirroring `authenticateAdmin` line for line but requiring `role === 'operator'`,
and attaching `req.operator = { adminUserId, operatorId, username }`. It resolves
`operatorId` by joining `ftth_operators.adminUserId` and **rejects an operator
row whose `ftth_operators.status !== 'active'`**, so pausing an operator is
immediate.

Keep the same three properties the admin middleware earned the hard way:

- `TokenExpiredError` → 401 (`:213`), everything else → 403.
- The **row's** role wins over the token claim (`:265`).
- Inactive account → 403.

**No change to `authenticateAdmin`.** Because it already rejects any role that
is not `admin`/`super_admin`, an operator token is refused by all ~90 existing
`/api/admin/*` routes on day one, with no route-by-route audit and no allowlist
to keep in sync. This is the whole reason for a separate middleware rather than
a relaxed shared one.

**Login** needs no change. `server/routes.ts:628-640` checks `isActive` and signs
`{ userId, role: admin.role }` straight off the row, so an operator logs in
through the existing `/api/admin/auth/login` and receives a `role: 'operator'`
token that only the FTTH routes will accept.

**Operator account creation** is super-admin only. Extend
`server/routes/admin-management.routes.ts` (already `super_admin`-gated, already
enforces "you cannot change your own role") to permit `'operator'` as a
creatable/assignable role, and add `POST /api/admin/ftth/operators` to create
the `admin_users` row and its `ftth_operators` profile in one transaction.

### 2.1 What shipped, and two changes the tests forced

Phase 0 is built and green: `node scripts/smoke-ftth-phase0.mjs` walks an ISP
from public application → super_admin approval → sign-in → suspension →
reactivation and asserts the boundary in both directions. 27/27 pass. Two things
came out of writing it that were not in this plan:

**1. The apply endpoint needed its own rate limiter.** It was first mounted on
the existing `authLimiter`. `express-rate-limit` counts per limiter *instance*,
not per route — so applications and `/api/admin/auth/login` shared one
five-per-15-minutes budget per IP, and an ISP filling in the form three times
would have locked staff out of the dashboard. Now `RATE_LIMIT_CONFIG.operatorApply`
(5/hour), a separate instance.

**2. Suspension is one condition, not two checks.** Pausing an operator flips
`ftth_operators.status` *and* `admin_users.is_active` together. The middleware
originally checked them in sequence, so whichever ran first won the message: a
paused operator hit the generic "account deactivated" branch with no error code,
the portal could not tell that from a dead session, and it would have shown them
a login screen — i.e. told a suspended partner their password was wrong. Both
columns are now one check answering `OPERATOR_NOT_ACTIVE`.

Also worth recording: `apiRequest`/`getQueryFn` attached the bearer token only to
URLs containing `/api/admin/`. The operator portal lives at `/api/ftth/admin/`,
which does not contain that substring, so every operator page would have 401'd
while looking like an auth bug. Both now go through one `isDashboardCall()`.

### Web shell

`client/src/pages/admin-login.tsx:30` already stores the whole admin object in
`localStorage.adminUser`, so the role is on hand with no API change.

`client/src/App.tsx` currently renders one shell for everyone
(`AdminLogin` → `Sidebar` → a flat `<Switch>`, `:138-188`). Branch once, after
the auth check:

```tsx
const role = JSON.parse(localStorage.getItem("adminUser") ?? "{}").role;
if (role === "operator") return <OperatorLayout />;
```

`OperatorLayout` is its own shell with its own sidebar (`Plans`, `Customers`,
`Leads`, `Settlements`) and its own `<Switch>` over `/operator/*`. It does not
reuse `components/admin/sidebar.tsx` — the point is that an operator cannot see
admin navigation, and sharing the component makes that a permanent one-`if`-away
regression risk.

The client guard is cosmetic. The server guard in `authenticateOperator` is the
real one.

---

## 3. Phase 1 — Schema

All in `shared/schema.ts`, following the file's existing conventions.

### 3.1 Enums

```ts
export const ftthOperatorStatusEnum   = pgEnum('ftth_operator_status',   ['active', 'paused', 'disabled']);
export const ftthConnectionStatusEnum = pgEnum('ftth_connection_status', ['pending_id', 'active', 'suspended', 'closed']);
export const ftthIdRequestStatusEnum  = pgEnum('ftth_id_request_status', ['pending', 'approved', 'rejected']);
export const ftthLeadStatusEnum       = pgEnum('ftth_lead_status',       ['new', 'contacted', 'converted', 'closed']);
export const ftthRechargeStatusEnum   = pgEnum('ftth_recharge_status',   ['created', 'pending', 'success', 'failed', 'refunded']);
export const ftthLedgerEntryTypeEnum  = pgEnum('ftth_ledger_entry_type', [
  'recharge_collected', 'platform_fee', 'lead_fee', 'settlement_paid', 'adjustment',
]);
```

`'refunded'` is present from the start. The earlier draft omitted it, which
guarantees hand-patched rows the first time a recharge is reversed.

### 3.2 `ftth_operators`

```
id, adminUserId (FK admin_users.id, unique, notNull),
companyName, legalName, gstin,
contactEmail, contactPhone,
logoUrl, brandColor,                -- how they appear in the app list
status,                             -- pending_approval | active | paused | disabled
leadFeePaise,                       -- per-operator bounty; null → config default
convenienceFeePaise,                -- per-operator override; null → config default
onboardedByAdminId, approvedAt,
createdAt, updatedAt
```

The earlier draft's `userId` was ambiguous about which table it pointed at.
It is `admin_users`.

Commercial terms are **per operator**, not global. You will not negotiate the
same ₹400 lead fee with every ISP, and hardcoding one number means renegotiating
in a config file. Both columns are nullable and fall back to
`FTTH_CONFIG.DEFAULT_LEAD_FEE_PAISE` / `FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE`.

`pending_approval` exists so operator onboarding does not have to run through
you personally — see §4.3.

### 3.3 `ftth_plans` — operator-authored, no fixed ladder

```
id, operatorId (FK, notNull),
name,                        -- the operator's own label: "40 Mbps Unlimited + OTT"
speedMbps      (int, notNull),
durationMonths (int, notNull),
listPricePaise (int, notNull),   -- GST-inclusive, as the operator quotes it
discountPaise  (int, default 0),
dataLimitGb    (int, nullable),  -- null = unlimited / no FUP
benefits       (jsonb, nullable),-- ["OTT pack", "Free installation", "Static IP"]
sortOrder      (int, default 0),
isActive       (bool, default true),
createdAt, updatedAt
```

Index on `(operatorId, isActive)` and `(operatorId, speedMbps)`.

**`speedMbps` and `durationMonths` are free integers, never an enum and never a
hardcoded list.** Operator A sells 30/50/100; operator B sells 40/60/200; a third
sells 25/75. Nothing in the schema, the API, or the UI may contain a speed
ladder — every speed and duration shown anywhere is derived from that operator's
own rows. This is the single constraint that keeps the feature open-ended, and
it is the one the earlier draft's "sliders for Speed and Months" quietly broke
(see §6).

`name`, `dataLimitGb` and `benefits` exist because ISPs do not sell a clean
(speed × duration) grid. The moment someone offers "100 Mbps + IPTV" or
"40 Mbps, 3.3 TB FUP", a rigid two-axis schema forces you into a migration.
These three columns absorb that without one.

**Plans are soft-deleted only** (`isActive = false`), never hard-deleted —
`ftth_recharges` holds an FK to them. The route rejects a duplicate *active*
`(operatorId, speedMbps, durationMonths)`; this is validated in the handler
rather than by a unique index, because a plain unique constraint would block
re-creating a plan that was previously deactivated.

The plan matrix is deliberately allowed to be **sparse**. An operator may sell
30 Mbps at 1 and 6 months but not 3. The UI must respect that (§6).

### 3.3b `ftth_operator_pincodes` — serviceability

```
operatorId (FK, notNull), pincode (FK serviceable_pincodes.pincode, notNull),
isActive (bool, default true), createdAt
primaryKey(operatorId, pincode)
```

`serviceable_pincodes.pincode` is already a text primary key
(`shared/schema.ts:291`), so this joins cleanly to the existing coverage model.

**This is the piece that actually makes multi-operator work.** With one operator
you can list everyone; at fifteen operators across Uttara Kannada, a customer in
Yellapur must not be offered an ISP that only wires Karwar. `GET /api/ftth/operators`
filters on the caller's `users.pinCode` (`shared/schema.ts:103`) through this
table. Operators manage their own coverage list in the portal.

### 3.4 `ftth_connections`

`id`, `userId` (FK `users.id`, notNull), `operatorId` (FK, notNull),
`ispConnectionId` (text, null until the operator assigns it), `status`,
`currentPlanId` (FK, nullable), `validTill` (timestamp, nullable),
`createdAt`, `updatedAt`.

- `uniqueIndex('ftth_conn_user_operator_idx').on(userId, operatorId)` — settles
  the "is `GET /api/ftth/connection` singular?" question: one connection per user
  **per operator**. The endpoint becomes `GET /api/ftth/connections` returning an
  array; the mobile app renders the single-connection case as today.
- `uniqueIndex('ftth_conn_isp_id_idx').on(operatorId, ispConnectionId)` — the
  same ISP ID cannot be mapped to two UniteFix accounts.

**`validTill` on the connection is the single source of truth for expiry.** The
earlier draft carried `nextRenewalDate` here *and* `validFrom`/`validTo` on the
recharge; that is duplicated state and it will drift. Recharge rows keep
`periodStart`/`periodEnd` purely as history.

### 3.5 `ftth_recharges`

```
id, connectionId (FK, notNull), planId (FK, notNull),

-- snapshot, frozen at initiate
planName, speedMbps, durationMonths,
listPricePaise, discountPaise,
convenienceFeePaise, gstOnConvenienceFeePaise,
totalPaise,                -- what the customer is charged
operatorPayablePaise,      -- listPrice - discount
platformRevenuePaise,      -- convenienceFee - gstOnConvenienceFee

razorpayOrderId (text, unique), razorpayPaymentId (text),
status, periodStart, periodEnd, failureReason,
createdAt, updatedAt
```

Indexes: `connectionIdx`, `statusIdx`, unique `razorpayOrderIdx`,
`razorpayPaymentIdx`.

**The snapshot is the important part.** The earlier draft stored only `planId`,
so editing the ₹471 plan tomorrow silently re-prices every historic recharge.
`billing-engine.ts:9` already establishes the pattern — it freezes `bookingFee`,
`platformFeePercent` and `gstPercent` at booking creation for exactly this
reason. Do the same here.

**Convenience-fee GST**, carved out the same way as `billing-engine.ts:164`:

```
gstOnConvenienceFeePaise = round(convenienceFeePaise * gstPercent / (100 + gstPercent))
```

₹10 collected is ₹8.47 revenue and ₹1.53 GST. It is not ₹10 of margin.

The unique index on `razorpayOrderId` plus a handler guard rejecting a second
`created`/`pending` recharge on the same connection is what stops a customer
opening two orders and paying both.

### 3.6 `ftth_operator_ledger`

Append-only. **Not** `walletTransactions` — both wallet tables are keyed to
`employees.id NOT NULL` (`shared/schema.ts:258`, `:532`) and an operator is not
an employee.

`id`, `operatorId` (FK, notNull), `entryType`,
`amountPaise` (signed integer: positive = owed to the operator, negative = paid
out or deducted), `rechargeId` (FK, nullable), `leadId` (FK, nullable),
`balanceBeforePaise`, `balanceAfterPaise`, `description`, `metadata` (jsonb),
`createdByAdminId` (nullable), `createdAt`.

- `uniqueIndex('ftth_ledger_recharge_entry_idx').on(entryType, rechargeId)`
- `uniqueIndex('ftth_ledger_lead_entry_idx').on(entryType, leadId)`

Both are the idempotency guard — NULLs do not collide in Postgres, so manual
`adjustment` and `settlement_paid` rows are unaffected. This is the same
technique `walletTransactionsV2` uses at `:553`.

This table is what makes "what do we owe Poorvi this week" a query instead of a
spreadsheet, and it is the only place the **lead fee** — the recommended primary
revenue line, and the one thing the earlier draft had no implementation for at
all — actually accrues.

### 3.7 `ftth_id_requests` / `ftth_leads`

`ftth_id_requests`: `id`, `userId`, `operatorId`, `connectionId` (set on
approval), `claimedName`, `claimedPhone`, `claimedAddress`, `claimedIspId`,
`status`, `rejectionReason`, `reviewedByAdminId`, `reviewedAt`, `createdAt`.

`ftth_leads`: `id`, `userId`, `operatorId`, `name`, `phone`, `address`,
`pincode`, `notes`, `status`, `convertedConnectionId` (nullable),
`leadFeePaise` (snapshot taken at conversion), `createdAt`, `updatedAt`.

### 3.8 `payment_transactions` — one added column

```ts
ftthRechargeId: integer("ftth_recharge_id").references(() => ftthRecharges.id),
// + index("payment_tx_ftth_idx").on(table.ftthRechargeId)
```

Today the table links only to `productOrders.orderId` and
`serviceRequests.id` (`shared/schema.ts:865-885`). Without this column, FTTH
payments are invisible to `/api/admin/payments/stuck`,
`/api/admin/payments/transactions` and `/api/admin/services/:id/reconcile-payment`
— the exact tools that exist because this class of failure has already happened
here once.

`PaymentTrackingService.recordPaymentEvent` takes the new optional field.

### 3.9 Config keys

Added to `server/seed_platform_config.ts` in the existing shape:

| Key | Value | Editable |
| --- | --- | --- |
| `FTTH_CONFIG.DEFAULT_CONVENIENCE_FEE_PAISE` | `1000` | yes |
| `FTTH_CONFIG.DEFAULT_LEAD_FEE_PAISE` | `40000` | yes |

The two `DEFAULT_` keys are fallbacks only. A populated
`ftth_operators.convenienceFeePaise` / `.leadFeePaise` always wins, so
per-operator terms never require a config edit.
| `FTTH_CONFIG.EARLY_RENEWAL_WINDOW_DAYS` | `15` | yes |
| `FTTH_CONFIG.RENEWAL_REMINDER_DAYS` | `7,3,1` | yes |

Read through `configService.get()` (`server/services/config.service.ts:21`).
GST comes from the existing `BUSINESS_CONFIG.GST_PERCENTAGE` — do not add a
second GST key.

### 3.10 Migration

**`migrations/` is gitignored in this repo**, so a `.sql` file there never
reaches the deployed container. Migrations ship as tracked scripts under
`scripts/`, following `apply-admin-migrations.mjs`: idempotent SQL in one
transaction, run from the Render shell after deploy. Phase 0 is
`scripts/apply-ftth-phase0-migration.mjs` / `npm run migrate:ftth`; later phases
extend the same pattern. The `payment_transactions` change is a nullable
`ADD COLUMN` and is safe online.

There is **no `ALTER TYPE`** in this plan. The original draft's
`ALTER TYPE user_role ADD VALUE 'operator'` cannot run inside a transaction
block and is not needed, because operator identity lives in `admin_users.role`,
which is `text`.

---

## 4. Phase 1 — Backend

`server/routes/ftth.routes.ts`, exporting `registerFtthRoutes(app: Express)` per
the convention in `server/routes/*.ts`, registered in `server/routes.ts`
alongside the others (~`:3324`).

Business logic goes in `server/services/ftth.service.ts` — routes stay thin, and
the recharge-application logic must be callable from both the webhook and the
verify endpoint (§5).

### Customer APIs — `authenticateToken`, `mobileLimiter`

`mobileLimiter` is already applied to payment routes (`payment.routes.ts:39`);
apply it to the FTTH write endpoints too. The earlier draft did not mention rate
limiting on what are effectively public lead-submission endpoints.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ftth/operators` | active operators covering the caller's `pinCode` (§3.3b) |
| GET | `/api/ftth/operators/:id/plans` | active plans, grouped by speed (§6) |
| GET | `/api/ftth/connections` | array, not singular (§3.4) |
| POST | `/api/ftth/leads` | new-connection request |
| POST | `/api/ftth/id-requests` | map an existing ISP account |
| GET | `/api/ftth/recharges` | the user's own history |
| POST | `/api/ftth/recharges/initiate` | Phase 3 |

### Operator APIs — `authenticateOperator`

Every handler scopes its query by `req.operator.operatorId`. Never accept an
`operatorId` from the request body — that is the one mistake that turns a
multi-tenant portal into a data leak.

| Method | Path |
| --- | --- |
| GET/POST/PATCH | `/api/ftth/admin/plans[/:id]` |
| POST | `/api/ftth/admin/plans/bulk` (§4.2) |
| POST | `/api/ftth/admin/plans/:id/duplicate` |
| GET/PUT | `/api/ftth/admin/pincodes` (own coverage list) |
| GET/PATCH | `/api/ftth/admin/profile` (branding, contacts) |
| GET/PATCH | `/api/ftth/admin/leads[/:id]` |
| POST | `/api/ftth/admin/leads/:id/convert` |
| GET | `/api/ftth/admin/id-requests` |
| POST | `/api/ftth/admin/id-requests/:id/approve` \| `/reject` |
| GET | `/api/ftth/admin/connections` (filters: active / pending / expiring) |
| POST | `/api/ftth/admin/connections/:id/suspend` \| `/reactivate` |
| GET | `/api/ftth/admin/recharges` |
| POST | `/api/ftth/admin/recharges/:id/mark-fulfilled` |
| GET | `/api/ftth/admin/ledger` |

`mark-fulfilled` is the operator confirming they performed the recharge in their
own portal — the acknowledgement step Open Question 2 implies but the earlier
draft never gave anywhere to live.

### 4.2 Bulk plan entry

A real ISP arrives with 15–25 plans (5 speeds × 3–5 durations). Adding those
one modal at a time is how a feature gets abandoned during onboarding, and it is
what the earlier draft's plain "CRUD plans" implied.

`client/src/pages/operator/Plans.tsx` is therefore a **grid, not a form list**:
rows are speeds the operator has entered, columns are durations they offer, and
each cell is an editable price (blank = not sold, which is a legitimate and
common state — see the sparse-matrix note in §3.3). Supporting actions:

- **Add speed row** / **add duration column** — free-text integer entry, so a new
  operator types `40` and `200` without anyone touching code.
- **Duplicate plan** — `POST /api/ftth/admin/plans/:id/duplicate` for the common
  "same plan, next duration tier" case.
- **CSV import** — `POST /api/ftth/admin/plans/bulk` accepting
  `name, speedMbps, durationMonths, priceRupees, discountRupees, dataLimitGb`.
  Validates the whole batch and inserts in one `withTransaction`, all-or-nothing,
  returning per-row errors. Most operators already have this in a spreadsheet.
- **Bulk activate/deactivate** by speed row, for seasonal or withdrawn tiers.

Prices are entered in **rupees** in the UI and converted to paise at the API
boundary, once, in the handler. Do not make an operator type paise.

### 4.3 Operator onboarding at scale

At three operators you create accounts by hand. At thirty that is a bottleneck,
so build the flow once, now:

- `POST /api/ftth/operators/apply` — public, rate-limited. An ISP submits company
  name, contact, GSTIN and coverage pincodes. Creates an `ftth_operators` row
  with `status = 'pending_approval'` and no `admin_users` row yet.
- `GET /api/admin/ftth/operators` + `POST /api/admin/ftth/operators/:id/approve`
  — super-admin only, on the existing `authenticateAdmin` guard. Approval
  creates the `admin_users` row with `role = 'operator'`, links it, sets
  `status = 'active'`, and sends credentials.
- Rejection and re-application are ordinary status transitions.

An operator in `pending_approval` is invisible to `GET /api/ftth/operators` and
cannot log in — `authenticateOperator` already rejects any operator whose
`ftth_operators.status !== 'active'` (§2), so `paused` and `disabled` are
enforced by the same check with no extra code.

### 4.4 Audit

`assign-id`, `suspend`, `reactivate` and `convert` all write through
`server/lib/audit.ts`. "An operator deactivated a customer who had paid through
October" needs a record, and suspension of a customer inside a paid validity
window is a money question, not a toggle — the handler warns when
`validTill > now()` and records the remaining days in the audit entry.

### 4.5 Lead conversion

`POST /api/ftth/admin/leads/:id/convert` runs in one `withTransaction`
(`server/lib/transaction.ts:27`):

1. lead → `converted`, snapshot `leadFeePaise` from the operator row (or config)
2. create the `ftth_connections` row (`pending_id`, or `active` if the ISP ID is
   supplied inline)
3. insert `ftth_operator_ledger` `lead_fee` with **negative** `amountPaise` —
   the operator owes UniteFix, so it reduces what UniteFix owes them
4. audit entry

Idempotent via the `(entryType, leadId)` unique index.

---

## 5. Phase 3 — Payments (webhook-first)

This is the part that must not be rebuilt from scratch. The existing code has
already paid for these lessons; `payment.routes.ts:786-796` carries the comment
describing the outcome when it was got wrong: *"money taken, booking stuck in
pending_payment, and NO INVOICE EVER CREATED."*

### Initiate

`POST /api/ftth/recharges/initiate`:

1. Validate: connection is `active` or `pending_id`-with-ID-assigned, plan is
   active and belongs to that connection's operator, no existing
   `created`/`pending` recharge on the connection.
2. Early-renewal guard: reject if `validTill - now > EARLY_RENEWAL_WINDOW_DAYS`.
   Without it a customer can stack twelve recharges in a row.
3. Compute the full snapshot (§3.5).
4. Insert `ftth_recharges` with `status = 'created'`.
5. Create the Razorpay order with

   ```js
   notes: { payment_type: 'ftth_recharge', ftth_recharge_id: String(recharge.id) }
   ```

   This is the mechanism the rest of the system already uses —
   `PaymentService.handleWebhook` reads `notes.service_request_id` and
   `notes.payment_type` at `payment.service.ts:419-427` for exactly this.
6. Write the `order_created` row into `payment_transactions` with
   `ftthRechargeId` set, so the order can be resolved later even if `notes` are
   ever missing.

### Settlement — both paths, one function

```
FtthService.applyCapture({ razorpayOrderId, razorpayPaymentId, amountPaise })
```

Idempotent: inside `withTransaction`, it re-reads the recharge `FOR UPDATE`,
returns immediately if `status === 'success'`, and otherwise:

```
periodStart = (validTill && validTill > now) ? validTill : now
periodEnd   = periodStart + durationMonths months
connection.validTill = periodEnd
connection.status    = 'active'
connection.currentPlanId = planId
recharge.status = 'success'
ledger += recharge_collected (+operatorPayablePaise)
ledger += platform_fee       (−platformRevenuePaise)
```

Renewing early adds to the remaining validity rather than burning it; renewing
after expiry starts from today. The earlier draft's "update `nextRenewalDate`"
left all of that undefined.

Two callers:

- **`PaymentService.handleWebhook`** (`payment.service.ts:411`) — add a
  `notes.payment_type === 'ftth_recharge'` branch beside the existing
  `booking_charge` branch. **This is the source of truth.**
- **`POST /api/payments/verify`** (`payment.routes.ts:757`) — extend the existing
  order-resolution block (`:798-812`) to also look up `ftthRechargeId` from the
  `order_created` row, exactly as it resolves `serviceRequestId` today.

The earlier draft listed a bespoke `/api/ftth/recharge/verify` as the only
settlement path. If the app is killed after checkout, that call never happens:
money taken, no extension, no record. The webhook is what makes that impossible.

`payment.failed` marks the recharge `failed` with `failureReason`; refunds write
a `refunded` status plus a compensating `adjustment` ledger entry.

---

## 6. Phase 2 — Mobile

Screens live in `mobile/src/screens/ftth/` (the earlier draft named the
directory two different ways). They register in
`mobile/src/navigation/CustomerStack.tsx` alongside the existing screens
(`:30-46`), with the entry point on the customer home tab.

| Screen | Purpose |
| --- | --- |
| `FTTHOperatorSelectScreen` | operators serviceable at the user's pincode, with logo and brand colour |
| `FTTHOnboardingScreen` | New user → lead form; existing user → ID-request form; pending state until approved |
| `FTTHRechargeScreen` | plan picker, price breakdown, checkout (Phase 3) |
| `FTTHHistoryScreen` | past recharges, current validity |

### No sliders — the plan picker is data-driven

The earlier draft specified *"Sliders/chips for `Speed (Mbps)` and `Months`"*.
**Drop the slider.** A slider implies a continuous, uniform range, which is
exactly what a multi-operator catalogue is not: operator A offers 30/50/100,
operator B offers 40/60/200, and neither sells every duration at every speed.
A slider either invents combinations that cannot be bought or has to be
range-clamped per operator, which is a slider pretending to be a chip list.

Instead, `FTTHRechargeScreen` renders only what exists:

1. Speed chips = `DISTINCT speedMbps` from that operator's active plans, sorted.
2. Picking a speed filters the duration chips to **only the durations sold at
   that speed** — the sparse matrix from §3.3 is honoured rather than papered
   over.
3. The resulting single plan renders its `name`, `dataLimitGb` and `benefits`
   verbatim as the operator entered them.
4. Nothing in the mobile bundle contains a speed or duration constant. Onboarding
   a new ISP with an unusual tier must never require an app release — that is the
   test for whether this screen was built correctly.

`FTTHOperatorSelectScreen` handles zero, one and many: no operators at the
pincode → a "not available in your area yet" state with a notify-me capture
(which is itself a lead); exactly one → still show the card, do not auto-skip,
because auto-skipping breaks the moment a second operator appears.

The price breakdown shows plan price, discount, and the UniteFix convenience fee
as a separate line. Do not bury the fee in the total — the "trained by PhonePe"
argument only holds when the fee is visible.

Checkout reuses `mobile/src/services/razorpay.ts` and follows
`screens/shop/CheckoutScreen.tsx`. On SDK success it calls the existing
`/api/payments/verify`; on any failure or abandonment it does nothing, because
the webhook will settle it regardless.

---

## 7. Phase 4 — Reminders and settlement

Renewal reminders were sold in the SaaS tier of the strategy section and had no
implementation in the earlier draft. A daily job in `server/services/task_queues.ts`
selects connections where `validTill` falls on any offset in
`FTTH_CONFIG.RENEWAL_REMINDER_DAYS` and dispatches through
`notification.service.ts` (FCM). Deduped by `(connectionId, offsetDay)`.

Settlement: `GET /api/ftth/admin/ledger` gives the operator their running
balance; an admin-side view gives UniteFix the same across all operators.
Recording a payout writes a `settlement_paid` entry with the reference number.

---

## 8. Verification

**Automated** (`e2e/`, `playwright.config.ts` already configured):

- Unit: validity arithmetic — renewal before expiry extends from `validTill`;
  after expiry starts from today; the early-renewal window rejects correctly.
- Unit: `convenienceFee` GST carve-out sums back to the collected total.
- Integration: `applyCapture` called twice with the same `razorpayPaymentId`
  extends validity **once** and writes **one** pair of ledger rows.
- Integration: an operator token gets 403 on `/api/admin/users`,
  `/api/admin/db/query` and `/api/admin/notifications/broadcast`.
- Integration: operator A cannot read operator B's plans, leads or connections.
- Integration: a customer in pincode X is offered only operators covering X.
- Integration: `POST /api/ftth/admin/plans` with `operatorId` in the body is
  ignored — the row is created against `req.operator.operatorId` regardless.
- Integration: recharge `initiate` rejects a `planId` belonging to a different
  operator than the connection's.

**Manual:**

1. Super-admin creates an operator; operator logs in, sees only FTTH navigation.
2. Operator adds 30/50/100 Mbps plans at 1/3/6 months.
2b. **Scale check — do this with a second operator, not just Poorvi.** Onboard a
   second ISP offering 40/60/200 Mbps, with 40 Mbps sold only at 6 months, and
   coverage in a different pincode. Confirm: both appear correctly for customers
   in their respective pincodes and neither appears in the other's; the recharge
   screen shows 40/60/200 with no 30/50/100 leaking through; selecting 40 Mbps
   offers only the 6-month duration; and none of it required a code change or an
   app release. If any step needs a deploy, the catalogue is hardcoded somewhere.
3. Mobile user submits a new-connection lead → appears in the operator's list →
   operator converts → a `lead_fee` ledger entry exists.
4. Mobile user submits an ID request → operator assigns `POORVI-9912` → the app
   shows the connection active.
5. Recharge 100 Mbps / 3 months in Razorpay test mode. Confirm: validity extends,
   `payment_transactions` carries `ftthRechargeId`, both ledger rows exist.
6. **Kill the app immediately after payment.** Validity must still extend, from
   the webhook alone. This is the test that matters.
7. Replay the same webhook. Nothing changes.

---

## 9. Files touched

**New**
```
server/routes/ftth.routes.ts
server/services/ftth.service.ts
client/src/layouts/OperatorLayout.tsx
client/src/components/operator/sidebar.tsx
client/src/lib/operator-auth.ts
client/src/pages/operator/{overview,plans,coverage,customers,leads,settlements}.tsx
client/src/pages/admin/ftth-operators.tsx      applications, approval, settlement payouts
mobile/src/screens/ftth/{FTTHOperatorSelect,FTTHOnboarding,FTTHRecharge,FTTHHistory}Screen.tsx
mobile/src/api/ftth.api.ts
scripts/apply-ftth-phase0-migration.mjs   npm run migrate:ftth
scripts/apply-ftth-phase1-migration.mjs   npm run migrate:ftth1
scripts/smoke-ftth-phase0.mjs             27 assertions — onboarding + access boundary
scripts/smoke-ftth-phase1.mjs             33 assertions — catalogue, leads, recharge, ledger
```

**Modified**
```
shared/schema.ts                          6 enums, 8 tables, payment_transactions.ftthRechargeId
server/middleware/auth.middleware.ts      + authenticateOperator (authenticateAdmin untouched)
server/middleware/rate-limit.ts           + operatorApplyLimiter (own bucket, not authLimiter)
server/config/rate-limit-config.ts        + operatorApply
server/lib/audit.ts                       + ftth_operator / ftth_connection / ftth_lead entities
server/routes.ts                          + registerFtthRoutes; /register refuses role 'operator'
server/routes/admin-management.routes.ts  operator rows are read-only here
server/routes/payment.routes.ts           /api/payments/verify resolves + applies ftthRechargeId
server/services/payment.service.ts        handleWebhook: ftth_recharge capture + payment.failed
server/services/payment-tracking.service.ts  optional ftthRechargeId
server/services/task_queues.ts            renewal reminders (daily) + abandoned recharges (15m)
server/seed_platform_config.ts            FTTH_CONFIG keys
client/src/App.tsx                        role branch after auth check
client/src/lib/queryClient.ts             isDashboardCall covers /api/ftth/admin/
client/src/components/admin/sidebar.tsx   + FTTH Operators (super_admin only)
client/src/pages/admin/admins.tsx         operator rows render read-only
mobile/src/navigation/CustomerStack.tsx   register FTTH screens
mobile/src/screens/customer/HomeScreen.tsx  broadband entry point
package.json                              migrate:ftth, migrate:ftth1, smoke:ftth
```

## 10. Testing it by hand

```bash
npm run migrate:ftth      # Phase 0 tables (already applied locally)
npm run migrate:ftth1     # Phase 1 tables (already applied locally)
npm run dev
npm run smoke:ftth        # 60 assertions across both suites
```

Local database state worth knowing before a manual walkthrough:

- **`serviceable_pincodes` is empty.** Operators can only claim pincodes UniteFix
  already serves, so add areas under Location Management first or every
  application and coverage save is refused. Both smoke tests seed and remove
  their own.
- **The apply endpoint allows 5 submissions/hour per IP.** A second smoke run
  inside the hour 429s; restart the dev server to reset the in-memory store.
- Real Razorpay keys are needed for `/recharges/initiate` to reach Razorpay. The
  smoke test stubs the order and exercises everything downstream of it — the
  snapshot, `applyCapture`, the ledger, idempotency and the validity maths are
  all real code.

Manual path: sign in as super_admin → **FTTH Operators** → approve an application
→ sign in as that operator → **Plans** (add a speed, add a duration, fill cells)
→ **Coverage** → then in the app: Home → Broadband → pick the operator →
onboard → operator links the ID → recharge.

**The test that matters most:** kill the app immediately after paying. Validity
must still extend, from the webhook alone.
