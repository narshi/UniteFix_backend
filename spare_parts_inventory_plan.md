# Business Partners, Spare Parts & B2B Ordering — Architecture Plan

**Status:** v2 approved 13 Sep 2026. **Phases 0–6 implemented** (backend + APIs). Phase 7 (mobile screens) and Phase 8 (dropping the dead tables) pending.
**Written against:** `feature/react-native-app` @ `72c6da2`, 13 Sep 2026

**§9 decisions applied (as recommended, no objection raised):**
1. `business_partners` + `/api/b2b/*`; technicians stay "partner" in code.
2. No netting — both ledgers shown side by side on one statement.
3. Schema supports credit; partners launch prepaid; credit set per partner by super_admin.
4. One `trade_price_paise` per part.
5. Deposit ₹5,000 and 40% floor from `platform_config`.
6. **Platform parts fitted on a job are UniteFix's sale, not technician earning.** Customer pays for them; they are carved out of `employeeEarnings` / `technicianEarning` and frozen as `platformPartsCost`. Margin (`unit − cost`) is admin-visible only.
7. super_admin approves business partners and parts access.

**Also in scope, discovered while building:** the earlier FTTH add-on migration emitted `$do` instead of `$do$` and every startup statement after it was failing silently. Fixed in Phase 0; never pushed, so production never ran it.

**Verification:** `npm run smoke:parts-platform` — warranty 64, FTTH add-ons 41, business partners 28, spare parts 35, deposit + B2B 41. All green.
**Scope:** a general business-partner model (FTTH becomes one vertical of it), a purpose-built spare-parts inventory keyed to service categories, a parts-enabled technician tier backed by a deposit, and B2B ordering from that inventory with tracking and a partner ledger. **Backend and mobile APIs first; mobile screens later.**

---

## 0. What is actually there

### 0.1 Two things are both called "partner" — and neither is what you now mean

| Word in the code | What it is | Where |
|---|---|---|
| **partner** | a **technician** (an `employees` row) | `partner_wallets`, `authenticatePartner`, `/api/partner/*`, `/api/business/partners` (admin CRUD of technicians), `partner-profile.routes.ts` |
| **operator** | an **ISP** (`ftth_operators`) with a web portal login via `admin_users` | `authenticateOperator`, `/api/ftth/admin/*`, `client/src/pages/operator/*` |

What you are describing — a computer shop, a CCTV installer, a consultant, an ISP — is a **business entity that does commerce with UniteFix**. That is the *operator* concept generalised, and it is not the *partner* concept. The plan therefore names the new entity **`business_partners`**, keeps the technician vocabulary exactly as it is, and never puts anything new under `/api/business/*` (already taken, and it returns technicians). New APIs live under **`/api/b2b/*`**. This is decision #1 in §9 because it will be in every conversation from now on.

### 0.2 Inventory: three models, none connected to what technicians actually fit

| Model | Tables | State |
|---|---|---|
| **A. Service consumption stock** | `inventory_items`, `inventory_transactions` | **Dead.** Only writer fires on completion metadata `inventoryItems[]`; nothing sends it. Free-text category. Seed is "Screwdriver Set". No admin UI. |
| **B. E-commerce store** | `products`, `product_variants`, `product_categories`, `product_brands`, `product_images` | **Halted.** `registerProductRoutes` commented out. The admin page titled *Inventory* edits **this** — laptops with RAM/SSD variants. |
| **C. Parts actually fitted** | `service_part_items` (Sep 2026) | **Live.** Provenance + warranty per line. But `sourceType = 'platform'` is a word the technician chose — verified against nothing, decrementing nothing. |

### 0.3 FTTH: a vertical already built as if it were the only one

`ftth_operators` carries generic business fields (company name, GSTIN, contact, status, portal login, approval) **and** FTTH-specific ones (lead fee, convenience fee) in one table, with `ftth_plans`, `ftth_connections`, `ftth_recharges`, `ftth_operator_ledger` hanging off it. Adding a CCTV shop today means either abusing `ftth_operators` or copying it. Neither scales.

### 0.4 What to keep

- `service_part_items` and the warranty routing — the live record of what was fitted.
- `ftth_operator_ledger`'s discipline: append-only, running balance, idempotent by `(entry_type, recharge_id)`. Every new ledger below copies it.
- `paymentTransactions`' pattern of one nullable FK per payment kind (`serviceRequestId`, `orderId`, `ftthRechargeId`). B2B orders add a fourth.
- `PaymentService` webhook + verify landing on one idempotent apply — the shape FTTH recharges use.
- Cashfree payouts for anything UniteFix pays out.

---

## 1. Decisions that shape everything

1. **One party model.** `business_partners` is the "who". Verticals are a join, not a column, because a shop can be CCTV *and* computers. FTTH's operator becomes the first vertical profile, linked 1:1 — **not** rewritten.
2. **Spare parts hang off `service_categories`.** A part is searched by the job's category first. Many-to-many, because a capacitor fits AC and fan.
3. **`platform` requires a reference, or it is not `platform`.** The integrity rule for `service_part_items`.
4. **Collateral is not wallet money.** The technician's ₹5,000 deposit and a business partner's credit exposure each get their own ledger. Nothing new writes `partner_wallets`.
5. **Two prices on a part.** `unit_price_paise` (what a customer is billed on a job) and `trade_price_paise` (what a business partner pays to buy it). Cost is a third, admin-only figure.
6. **Stock has a location.** Warehouse, technician kit, or a business partner's order in transit. Every change is a ledger row; quantities are a rebuildable cache.
7. **Money before bookkeeping.** A job completes even if stock is oversold. A payment applies even if fulfilment lags. Bookkeeping catches up; customers never wait on it.
8. **Providers propose, admins publish.** Nothing enters the catalogue without an admin's id.

---

## 2. Party model — `business_partners`

### 2.1 Tables

```
partner_verticals                           -- admin-managed, like technician_types
  id, code UNIQUE ('isp','computer','cctv','consultation','electronics','other'),
  name, description, is_active, sort_order

business_partners
  id                 serial PK
  partner_code       text UNIQUE            -- "BP-0001"
  legal_name, display_name
  gstin, pan
  contact_name, contact_phone, contact_email
  address, pincode, district
  status             enum('pending_approval','active','paused','disabled')   -- same as ftth_operators
  -- logins: web portal today, mobile app next
  admin_user_id      int null UNIQUE FK → admin_users     -- existing operator portal login
  user_id            int null UNIQUE FK → users           -- mobile app login (Truecaller), see §2.3
  -- commerce terms
  credit_limit_paise int default 0           -- 0 = prepaid only
  payment_terms_days int default 0
  -- payout (for verticals where UniteFix owes them — ISP settlements)
  beneficiary_name, bank_account_number, bank_ifsc, upi_id, cashfree_bene_id
  approved_by_admin_id, approved_at, rejection_reason
  created_at, updated_at

business_partner_verticals
  business_partner_id FK, vertical_id FK, PRIMARY KEY (both)
```

### 2.2 FTTH becomes a vertical profile

```
ftth_operators
  + business_partner_id  int null UNIQUE FK → business_partners      ← new, backfilled, then NOT NULL
```

`ftth_operators` **keeps** its FTTH-specific columns (`leadFeePaise`, `convenienceFeePaise`) and every dependent table stays exactly where it is. Backfill creates one `business_partners` row per operator, copies the generic fields, links them, and attaches the `isp` vertical. Nothing in `ftth.service.ts` or `ftth.routes.ts` changes in Phase 0. The generic columns on `ftth_operators` become read-through copies and are dropped in the last phase.

A CCTV installer, a computer shop or a consultant is just a `business_partners` row with the right vertical and **no profile table** — until a vertical needs one, at which point it gets its own `<vertical>_profiles` table linked the same way. That is the whole scalability mechanism: add a vertical row, optionally add a profile table, never touch the party.

### 2.3 Authentication

- **Web portal (today):** `authenticateOperator` reads `role: 'operator'` from an `admin_users` JWT. Generalise to `authenticateBusinessPartner` that resolves `business_partners` via `admin_user_id` **or** `user_id`, and attaches `{ businessPartnerId, verticals[] }` to the request. `authenticateOperator` becomes a thin wrapper that additionally requires the `isp` vertical, so FTTH routes keep their guarantee.
- **Mobile app (new):** `users.role` gains `'business_partner'` (`ALTER TYPE user_role ADD VALUE` — additive). A business partner signs in with the same Truecaller flow as everyone else; their `users` row links to `business_partners.user_id`. One person may be both a technician and a shop owner — that is two `users` rows today, and this plan does not try to merge identities.

### 2.4 Onboarding

Reuses the shape `ftth_operators` already has: apply → `pending_approval` → super_admin approves (mints the login, sets verticals and credit terms) → `active`. Readiness gate before `active`: contact, GSTIN if credit > 0, at least one vertical. For the `isp` vertical the existing FTTH gates (coverage, plans, payout account) still apply on top.

---

## 3. Spare-parts inventory

### 3.1 `spare_parts` — the catalogue

```
id, part_code UNIQUE ("AC-CAP-2.5UF")
name, brand null, specification null
unit text default 'piece'
unit_price_paise    int      -- billed to a CUSTOMER on a job
trade_price_paise   int null -- billed to a BUSINESS PARTNER on a B2B order; null = not sold B2B
cost_price_paise    int null -- what UniteFix paid; admin-only
warranty_days       int default 0
gst_percent         numeric(4,2) null
photo_url           text null
status  enum('active','discontinued','pending_review')
created_from_proposal_id  int null FK
created_by_admin_id, is_active, created_at, updated_at
```

### 3.2 `spare_part_categories`

```
spare_part_id FK (cascade), category_id FK → service_categories (cascade), PRIMARY KEY (both)
```

### 3.3 `spare_part_stock` — quantity per location

```
id, spare_part_id FK
location            enum('warehouse','technician')
holder_employee_id  int null FK → employees
quantity            int NOT NULL CHECK (quantity >= 0)
reorder_level       int default 5
UNIQUE (spare_part_id, location, holder_employee_id)
```

### 3.4 `spare_part_movements` — the ledger

```
id, movement_id UNIQUE ("SPM-…")
spare_part_id FK
movement_type  enum('purchase_in','transfer_to_technician','return_to_warehouse',
                    'consumed','sold_to_partner','partner_return','adjustment','write_off')
quantity (signed)
from_location/to_location, from_holder/to_holder     -- nullable per type
service_request_id      null FK   -- consumed
service_part_item_id    null FK   -- the fitted line it fulfilled
b2b_order_item_id       null FK   -- the B2B line it fulfilled
unit_cost_paise null
performed_by_employee_id / performed_by_admin_id
stock_before, stock_after
notes, created_at
UNIQUE (service_part_item_id, movement_type)
UNIQUE (b2b_order_item_id, movement_type)
```

Append-only. `spare_part_stock.quantity` is rebuilt from this if it ever disagrees.

### 3.5 `spare_part_proposals`

```
id, proposed_by_employee_id FK, service_request_id null
name, brand, specification, category_id, unit, indicative_price_paise, vendor_name, photo_url
status enum('pending','approved','rejected','merged')
resolved_spare_part_id null FK
reviewed_by_admin_id, reviewed_at, review_notes, created_at
```

### 3.6 `service_part_items` — two columns and one rule

```
+ spare_part_id  int null FK
+ proposal_id    int null FK
```

**Rule in `resolvePartItem()`:** `sourceType = 'platform'` without `spare_part_id` is downgraded to `technician_local`, `isDocumented = false`, and logged. Catalogue price is authoritative for `platform` lines; the technician's figure is ignored. This ships in Phase 1 before any UI exists, because it fixes the assertion problem today.

---

## 4. Parts-enabled technician (deposit)

Unchanged from v1 in substance; summarised.

```
employees
  + parts_access  enum('none','requested','active','suspended') default 'none'
  + parts_access_granted_at, parts_access_granted_by

partner_deposits            -- one per employee; purpose enum('parts_access')
  required_paise (from platform_config, seeded 5_00_000), paid_paise
  status enum('unpaid','pending_payment','held','partially_drawn','refund_requested','refunded','forfeited')
  razorpay_order_id, razorpay_payment_id, paid_at, refunded_at

partner_deposit_ledger      -- append-only
  entry_type enum('paid_in','drawn_warranty','drawn_shortage','drawn_damage','topped_up','refunded','adjustment')
  amount_paise signed, warranty_claim_id null, spare_part_movement_id null
  balance_before/after, created_by_admin_id, notes
```

- Flow: verified technician → pays via Razorpay (new `paymentTransactions.partnerDepositId`) → `requested` → super_admin approves → `active`.
- `active` unlocks: catalogue search + `platform` lines, proposals, technician-held stock, My Stock view. Everything else unchanged.
- Drawn by admin action when a warranty claim resolves `costBearer = 'technician'` — **this is the collection mechanism `routeCost()` has been missing** — or on a count shortage or damaged return. Below a configurable floor → `suspended`.
- Refund via Cashfree when no open claims name them, no held stock, no pending draws.

---

## 5. B2B ordering

### 5.1 Tables

```
b2b_orders
  id, order_code UNIQUE ("B2B-2026-00042")
  business_partner_id FK
  status  enum('draft','placed','confirmed','packed','dispatched','delivered','cancelled','returned')
  payment_mode    enum('prepaid','credit')
  payment_status  enum('unpaid','paid','partially_paid','refunded')
  subtotal_paise, gst_paise, shipping_paise, discount_paise, total_paise
  delivery_address  jsonb      -- snapshot at placement
  delivery_contact  jsonb
  razorpay_order_id, razorpay_payment_id
  notes, cancel_reason
  placed_at, confirmed_at, dispatched_at, delivered_at, cancelled_at
  confirmed_by_admin_id, dispatched_by_admin_id
  created_at, updated_at

b2b_order_items
  id, order_id FK (cascade)
  spare_part_id FK
  -- frozen at placement, as every other price in this system is
  part_code, name, specification
  quantity, unit_price_paise (= trade price at placement), gst_percent, line_total_paise
  quantity_fulfilled int default 0

b2b_order_events                 -- the tracking timeline
  id, order_id FK (cascade)
  event_type  enum('placed','payment_received','confirmed','packed','dispatched','out_for_delivery',
                   'delivered','cancelled','return_requested','returned','note')
  from_status, to_status
  actor_type  enum('partner','admin','system'), actor_id
  payload jsonb            -- courier name, tracking id, photo url, note
  created_at
```

### 5.2 Order lifecycle

```
draft ──place──▶ placed ──(prepaid: payment webhook)──▶ paid ──admin──▶ confirmed ──▶ packed ──▶ dispatched ──▶ delivered
                    │       (credit: ledger invoice)                                      │
                    └──cancel (partner, before confirmed)──▶ cancelled           returned ◀─┘ (admin, with return movement)
```

- **Placement** freezes prices from `spare_parts.trade_price_paise`, checks each line against `warehouse` stock (soft — an out-of-stock line is allowed with a flag, so a partner can order what you can procure), computes GST per line.
- **Prepaid** goes through `PaymentService` exactly as FTTH recharges do: Razorpay order → webhook **and** verify both land on one idempotent `applyB2bPayment()`. New `paymentTransactions.b2bOrderId`.
- **Credit** requires `credit_limit_paise − outstanding ≥ total` at placement, else refused with the shortfall named. Placement writes a `business_partner_ledger` invoice entry.
- **Confirm/pack/dispatch/deliver** are admin transitions, each writing an event. Dispatch writes `sold_to_partner` movements from `warehouse` for the fulfilled quantities (idempotent by order item). Partial fulfilment is `quantity_fulfilled < quantity` with the order staying `dispatched` until a second dispatch or an admin closes the remainder.
- **Cancel** before `confirmed` by the partner; after that, admin only. A prepaid cancellation refunds via Razorpay refund on the original payment (not Cashfree — money goes back the way it came). A credit cancellation writes a credit-note ledger entry.
- **Tracking** for the partner is the events list rendered as stages — the same three-stage pattern `FTTHRechargeTrackingScreen` uses today, with more stages.

### 5.3 `business_partner_ledger` — partner transactions

```
id, business_partner_id FK
entry_type  enum('order_invoice','payment_received','credit_note','refund','adjustment',
                 'settlement_paid','settlement_received')
amount_paise  signed
b2b_order_id null FK, payment_transaction_id null FK, ftth_settlement_ref null
balance_before / balance_after
description, metadata jsonb, created_by_admin_id, created_at
UNIQUE (entry_type, b2b_order_id)     -- one invoice per order, one refund per order
```

**Sign convention, stated once:** `balance > 0` means **the partner owes UniteFix**; `balance < 0` means **UniteFix owes the partner**. An order on credit is `+`; a payment received is `−`; a refund we issue is `+`.

**FTTH's existing ledger stays where it is.** `ftth_operator_ledger` runs the opposite convention (positive = UniteFix owes the operator) and is live money. It is **not migrated**. The partner-facing "Transactions" API unions the two into one statement with the sign normalised at read time. Whether an ISP's recharge collections should ever *net* against their parts orders is a business decision (§9), not a schema one — the read model makes it possible without a migration if you want it.

### 5.4 Stock interaction

| Event | Movement |
|---|---|
| Admin receives purchase | `purchase_in` → warehouse |
| Admin issues kit to technician | `transfer_to_technician` |
| Job completes with `platform` lines | `consumed` from technician kit if held, else warehouse; oversold tolerated + alert |
| B2B order dispatched | `sold_to_partner` from warehouse, per item, idempotent |
| B2B return accepted | `partner_return` → warehouse |
| Count | `adjustment`; shortage on a technician kit suggests a deposit draw |

---

## 6. API surface

Backend first, mobile-ready. All money in rupees at the boundary, paise inside.

### 6.1 Business partner (mobile + portal) — `/api/b2b/*`, `authenticateBusinessPartner`

```
GET    /api/b2b/me                                   profile, verticals, credit limit, outstanding, deposit-free
GET    /api/b2b/catalog?category=&q=&page=           spare parts with trade_price, warehouse availability (in stock / low / out)
GET    /api/b2b/catalog/:partId
POST   /api/b2b/orders                               { items:[{spare_part_id, quantity}], delivery_address, payment_mode }
                                                     → priced server-side; returns order + (prepaid) Razorpay order
POST   /api/b2b/orders/:id/verify-payment            SDK callback (webhook is authoritative)
GET    /api/b2b/orders?status=                       list
GET    /api/b2b/orders/:id                           order + items + events timeline (tracking)
POST   /api/b2b/orders/:id/cancel                    only while placed/paid
POST   /api/b2b/orders/:id/return                    request, after delivered
GET    /api/b2b/ledger?from=&to=                     statement: unified across business_partner_ledger and (isp) ftth_operator_ledger
GET    /api/b2b/ledger/summary                       outstanding, credit available, last settlement
```

### 6.2 Technician (mobile) — `/api/partner/*`, `authenticatePartner` (existing prefix, existing meaning)

```
GET    /api/partner/parts/search?q=&categoryId=       catalogue with unit_price and "in your kit / warehouse" counts   [parts_access=active]
POST   /api/partner/parts/proposals                   propose                                                       [active]
GET    /api/partner/parts/proposals                   mine, with status
GET    /api/partner/parts/stock                       my kit
POST   /api/partner/parts/stock/return                request return to warehouse
GET    /api/partner/parts-access                      status, deposit balance, ledger, floor
POST   /api/partner/parts-access/request              → Razorpay order for the deposit
POST   /api/partner/parts-access/verify-payment
POST   /api/partner/parts-access/refund-request
-- existing bill routes accept spare_part_id on partItems; refuse platform/proposals when not active
```

### 6.3 Admin — `/api/admin/*`, capability-mapped

```
/api/admin/business-partners/*        CRUD, approve, verticals, credit terms, payout account (admin-only edit)   → area: partners (new)
/api/admin/spare-parts/*              catalogue CRUD, categories, proposals queue (approve/merge/reject)        → inventory
/api/admin/spare-parts/stock/*        receive, issue-to-technician, count, movements                             → inventory
/api/admin/b2b-orders/*               list, detail, confirm, pack, dispatch (courier + tracking id), deliver,
                                      cancel, accept-return                                                      → orders
/api/admin/parts-access/*             requests, approve/reject, suspend/reinstate, draw (from claim), refund     → inventory:manage + withdrawals:manage for refund
/api/admin/business-partners/:id/ledger   statement, record payment received, adjustment                        → partners
```

`capability-map.ts` gains a `partners` area and the `/business-partners`, `/spare-parts`, `/b2b-orders`, `/parts-access` prefixes. Unmapped paths already deny by default.

---

## 7. Mobile — APIs now, screens later

Deliberately deferred per your instruction. What the APIs above are shaped for, so screens can be designed against a stable contract:

- **Business partner app surface:** Catalogue (category tabs → search → part detail → add to cart), Cart → Place order (prepaid Razorpay sheet or "on credit" with available credit shown), Orders list → Order tracking (stage timeline from events), Transactions (statement with running balance).
- **Technician additions:** parts picker (category-first search, locked prices, stock hints, propose), My Stock, Enable-parts onboarding + deposit card.

Both reuse `openRazorpayCheckout` and the tracking-stage pattern already in the app.

---

## 8. Execution plan

Sequenced so each phase ships alone and leaves everything working. Backend + APIs through Phase 6; screens after.

| Phase | Scope | Days | Done when |
|---|---|---|---|
| **0 · Party model** | `partner_verticals`, `business_partners`, join table; `ftth_operators.business_partner_id` + backfill script; `authenticateBusinessPartner` with `authenticateOperator` as a wrapper; `users.role += 'business_partner'`; admin business-partners CRUD + approve. | 3 | Every existing operator has a linked `business_partners` row; all FTTH smoke suites pass unchanged; a CCTV partner can be created and approved with no profile table. |
| **1 · Catalogue + integrity** | `spare_parts`, categories, proposals; two columns on `service_part_items`; `platform`-requires-reference rule; catalogue price authoritative; admin catalogue + proposals routes. Rename admin nav "Inventory" → "Product Store". | 2 | Smoke: unreferenced platform downgrades; platform price from catalogue; approve creates row and re-points line; merge resolves to existing. |
| **2 · Deposit + parts access** | Deposit tables, `employees.parts_access`; Razorpay via `PaymentService` + idempotent apply; admin approve/suspend/refund (Cashfree); warranty verdict → draw; bill routes gate `platform`/proposals; technician parts-access APIs. | 3 | Smoke: deposit state machine; draw on `technician` verdict; floor → suspension; refund blocked with open claims. |
| **3 · Stock + movements** | `spare_part_stock`, `spare_part_movements`; consumption in the completion transaction (idempotent, oversold-tolerant); admin receive/issue/count; technician stock APIs. | 3 | Smoke: consumption idempotency; oversold completes + alerts; count adjusts + suggests draw; cache rebuilds from ledger. |
| **4 · B2B orders + ledger** | `b2b_orders`, items, events, `business_partner_ledger`; placement pricing + stock check + credit check; prepaid via `PaymentService` (new `b2bOrderId`) with webhook + verify; credit invoice entry; admin transitions with `sold_to_partner` movements on dispatch; cancel/refund/return; unified statement read model over both ledgers. | 4 | Smoke: prices frozen at placement; credit refused over limit with shortfall named; webhook and verify each apply once; dispatch moves stock once per item however many times pressed; statement sign convention verified against both ledgers. |
| **5 · B2B partner APIs** | `/api/b2b/*` complete: me, catalog, orders, tracking, cancel, return, ledger. | 2 | An approved partner on a mobile JWT can browse, order prepaid, see the tracking timeline advance as admin transitions, and read a statement that matches the ledger to the paisa. |
| **6 · Hardening** | Fulfilment ageing alerts (placed > N hours unconfirmed, dispatched > N days undelivered); low-stock alerts; per-partner P&L (trade − cost); per-vertical dashboards. | 2 | — |
| **7 · Mobile screens** | Technician parts picker, My Stock, enable-parts; business partner catalogue/cart/orders/tracking/statement. Designed against the Phase 5 contract. | — | Separate plan once APIs are stable. |
| **8 · Retire the dead** | Drop `inventory_items`/`inventory_transactions` + `deductInventoryForBooking`; drop generic columns from `ftth_operators` (read from `business_partners`); `products*` stays halted and untouched. | 1 | — |

**Dependencies:** 1 needs 0 only for admin capability wiring, not for schema — they can run in parallel. 2 needs 1. 3 needs 1. 4 needs 0 + 3. 5 needs 4. 7 needs 5.

### Invariants carried throughout

1. A `platform` part has a catalogue reference or it is not a `platform` part.
2. Customer price for job lines; trade price for B2B lines; cost is never shown outside admin.
3. Deposits and partner credit never touch `partner_wallets`.
4. Every stock change is a ledger row; `quantity` is a rebuildable cache.
5. Completion never fails on stock; payment never fails on fulfilment.
6. Nothing enters the catalogue without an admin's id.
7. FTTH's ledger is not migrated. The unified statement is a read model.
8. Every new table is additive; nothing existing is dropped before Phase 8.

---

## 9. Decisions needed before Phase 0

1. **Naming.** `business_partners` + `/api/b2b/*` for the new entity, technicians stay "partner" in code. Alternative is a repo-wide rename of technician → something else, which touches ~40 files and every mobile screen. *Recommend: accept the two words, document them at the top of `AI_CONTEXT.md`, never use bare "partner" for the new thing.*
2. **Netting.** Should an ISP's recharge collections (UniteFix owes them) offset their parts orders (they owe UniteFix)? *Recommend: not at launch. Show both on one statement; settle separately. Revisit once there is a partner with both.*
3. **Credit at launch.** Prepaid only, or credit limits from day one? *Recommend: schema supports both; launch prepaid; enable credit per partner by super_admin.*
4. **Trade price** — one `trade_price_paise` on the part, or per-partner price lists? *Recommend: one column now; a `business_partner_price_overrides` table is additive later, same shape as the FTTH add-on override.*
5. **Deposit amount and suspension floor** — config, seeded ₹5,000 and 40%.
6. **Margin on platform parts fitted on jobs** — if `unit_price_paise > cost_price_paise`, that margin is UniteFix revenue on the job and needs its own line in the pricing snapshot, distinct from the platform fee. *Business answer needed before Phase 1 fixes the columns.*
7. **Who approves** business partners and parts access — super_admin only at launch (recommended), widened later via capability.

---

*Money is integer paise throughout. Rupees appear only at the UI boundary.*
