# Fixed-Price Catalog & Earnings — Implementation Plan

_Source of truth: `CATALOG-1.xlsx` (7 categories, 42 services). This plan turns
that spreadsheet into a dynamic, admin-editable pricing engine._

---

## 1. What the spreadsheet actually says

Every one of the 42 rows follows **one** formula. Given a per-service price `P`
(the "TOTAL AMOUNT (Customer View)"):

| Bucket | Formula | Who gets it |
|--------|---------|-------------|
| GST | `P × 18%` | Government (remitted) |
| Platform Fee (profit) | `P × 12%` | UniteFix |
| Booking Charge | `₹99` flat | UniteFix (paid upfront) |
| **Technician earning** | `P − GST − Fee − 99` = **`P × 0.70 − 99`** | Technician |

The four buckets **sum exactly to `P`**. Verified against all 42 rows (e.g.
`799 → 143.82 + 95.88 + 99 + 460.30`; `3499 → 629.82 + 419.88 + 99 + 2350.30`).

**This is materially different from the current system**, which is the crux of
the work:

| | Current (BillingEngine v1) | New (catalog v2) |
|---|---|---|
| Price origin | Technician types parts+labor | Fixed per-service, set by admin |
| GST / fee | Added **on top** of the charge | Carved **out** of the fixed price |
| Platform fee | 15% | **12%** |
| ₹99 booking | Prepaid **credit** to customer | **Deducted** from technician |
| Technician gets | 100% of parts+labor | `P × 0.70 − 99` |
| Bill-entry step | Required | **Removed** for catalog jobs |

---

## 2. Current state (what exists today)

- **`services` table has _no price column_** — it is display metadata only
  (name, category, icon, sort). Pricing is entirely technician-entered at
  bill-submission time.
- **`BillingEngine`** freezes a `pricingSnapshot` (v1) on the booking row and
  computes the bill additively from `sparePartsCost + serviceLaborCost`.
- **Config** already lives in `platform_config` and is admin-editable via
  Settings: `BASE_SERVICE_FEE` (99), `UNITEFIX_FEE_PERCENT` (15),
  `GST_PERCENTAGE` (18).
- **Wallet**: on completion the technician's earning is credited to
  `partner_wallets.balance_hold`, then released to `balance_available` after
  `WALLET_HOLD_DAYS` (a background job already does this).
- `pricingSnapshot` was deliberately versioned (`snapshotVersion`) for exactly
  this kind of evolution — we add **v2**, we do not rewrite v1.

---

## 3. Target model

### 3.1 Data model change (one new column, one optional table)

```
services.base_price        integer  NOT NULL DEFAULT 0   -- the "TOTAL (Customer View)" P, in ₹
```

- Kept as an **integer number of rupees** (all sheet prices are whole rupees).
- Money math is done in **paise internally**, rounded to 2 decimals for storage
  in `decimal(10,2)` wallet/earning fields, matching the sheet (e.g. `460.30`).

**Optional (recommended) — service price tiers.** The sheet already has
"Visiting & Inspection Charges" at 5 price points (349/449/549/649/749) and
per-camera CCTV pricing. Two ways to model:

- **A. Flat (ship first):** each tier is its own service row. Simplest, matches
  the sheet 1:1. 42 rows.
- **B. Variants (phase 2):** a `service_variants` table (`service_id, label,
  price`) so one "Visiting & Inspection" service holds its tiers. Cleaner UX.

Recommend **A now, B later** — A unblocks everything and needs no new table.

### 3.2 Config (all already admin-editable, just re-tuned)

| Key | Old | New |
|-----|-----|-----|
| `BUSINESS_CONFIG.GST_PERCENTAGE` | 18 | 18 |
| `BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT` | 15 | **12** |
| `BUSINESS_CONFIG.BASE_SERVICE_FEE` (booking) | 99 | 99 |

No new config keys. The percentages and booking charge stay dynamic and are
edited on the existing **Settings** page.

### 3.3 The v2 snapshot (frozen on the booking at creation)

`BillingEngine.createCatalogSnapshot(basePrice)` → `snapshotVersion: 2`:

```
total            = P
gstPercent       = 18   (from config, frozen)
feePercent       = 12   (from config, frozen)
gst              = round2(P × gstPercent/100)
platformFee      = round2(P × feePercent/100)
bookingCharge    = 99   (from config, frozen)
technicianEarning= round2(P − gst − platformFee − bookingCharge)
cgst             = round2(gst / 2)
sgst             = round2(gst − cgst)
upfrontDue       = bookingCharge          -- customer pays now
finalDue         = P − bookingCharge      -- customer pays on completion
```

Frozen at booking creation so a later admin price edit **never** changes an
in-flight job — same immutability guarantee v1 already gives.

---

## 4. Flow-by-flow changes

### 4.1 Customer app — selecting a service
- Service list/detail now shows **`base_price`** and a breakdown:
  _"Pay ₹99 now to book · ₹(P−99) after the job is done · ₹P total (incl. GST)"_.
- Booking creation freezes the **v2 snapshot** from the service's price.
- Upfront payment = `bookingCharge` (unchanged ₹99 flow).

### 4.2 Technician app — accepting the job
- The assignment card shows **"You'll earn ₹`technicianEarning`"** (read from the
  frozen snapshot), on the incoming-service and accept screens.
- **No full bill entry.** After work is done the technician taps "Mark done" and
  the job goes to `pending_payment` with `finalDue` already known from the price.
- **Optional parts line** (decision 3): if the job needed extra parts, the
  technician adds a single parts amount + note; the customer sees and **approves**
  it before final payment. `finalDue` becomes `P − 99 + approvedParts`, and the
  parts amount is added to `technicianEarning` (pass-through, admin-overridable).

### 4.3 Completion & money
- Customer pays `finalDue` (existing final-payment / QR / cash paths — only the
  amount source changes: snapshot + any approved parts line, instead of a full
  technician bill).
- On completion: credit **`technicianEarning`** to `balance_hold`; existing hold
  → available release job carries it the rest of the way. Unchanged mechanism.
- Invoice generated from the **v2 snapshot** (extend `InvoiceGenerator` +
  `PaymentService.generateInvoice` to read v2 fields; v1 still works for old
  bookings).

### 4.4 Admin dashboard — editing prices
- **Service Catalog page**: add an editable **Price (₹)** field per service, plus
  a live read-only breakdown (GST / fee / booking / technician) so the admin sees
  the split as they type — the spreadsheet, in the UI.
- **Settings page**: already edits GST %, platform %, booking charge. Change
  platform % default to 12.
- All edits write to existing config/catalog endpoints; nothing is hard-coded.

---

## 5. Migration & seeding

1. Add `base_price` column (Drizzle migration, `db:push` reviewed — **not** the
   unattended `--force` in the build; that risk is already noted separately).
2. **Seed script** `scripts/seed-catalog.ts` (idempotent, guarded to local/one-off
   like the existing seeders): reads `CATALOG-1.xlsx`, upserts the 7 categories
   and 42 services with prices by `(category, name)`.
3. **Reconcile the live catalog**: the current DB has different service/category
   names (e.g. the old category-level ones). Decision needed — _replace_ the live
   catalog with the sheet, or _merge_. Recommend: deactivate (`is_active=false`)
   catalog items not in the sheet rather than deleting (preserves any historical
   FKs), then insert the sheet's 42.

---

## 6. Rounding & correctness rules

- Compute each bucket with `round2()` (2 decimals) to match the sheet exactly.
- `technicianEarning` is the **remainder** (`P − gst − fee − booking`) not an
  independent 70%×P−99, so the four buckets always re-sum to `P` with zero drift.
- `sgst` is `gst − cgst` (remainder) to avoid a 1-paise rounding loss on the
  invoice — same trick v1 already uses.

---

## 7. Phased delivery

| Phase | Scope | Ship independently? |
|-------|-------|---------------------|
| **1. Data + config** | `base_price` column, seed from Excel, set fee%→12 | Yes (invisible to users) |
| **2. Backend v2 billing** | `createCatalogSnapshot`, completion credit, invoice v2, payment amounts from snapshot | Yes (behind catalog price presence) |
| **3. Admin editing** | Price field + live breakdown on Service Catalog | Yes |
| **4. Customer app** | Price + upfront/final breakdown on select & booking | Needs app build |
| **5. Technician app** | "You'll earn ₹X" on accept; remove bill entry for catalog jobs | Needs app build |

Backend phases (1–3) deploy without an app release. The app phases (4–5) ride a
new Android build. Old in-flight v1 bookings keep working throughout.

---

## 8. Confirmed decisions (locked 2026-08-03)

1. **Money model = the sheet, exactly.** Price `P` is the customer's **all-in,
   GST-inclusive total**. GST (18%), platform fee (12%), and booking (₹99) are
   carved **out** of `P`; the ₹99 is the **platform's** (not credited back).
   Technician earns `P − GST − fee − 99 = P × 0.70 − 99`. _(Confirmed against the
   worked ₹799 example: customer ₹799, technician ₹460.30, platform ₹194.88.)_
2. **Platform fee = 12%** (down from 15%).
3. **Variable spare parts → technician adds a parts line the customer approves.**
   The fixed catalog price and its split are untouched; the approved parts amount
   is an **additional line** added to the customer's final due. Sub-decision for
   Phase 5: whether the parts line is taxed/split or passed straight to the
   technician — default **pass-through to the technician, GST-inclusive**, admin-
   overridable. This keeps a *minimal* bill step (parts only), not the old
   full parts+labor entry.
4. **Live catalog → replace.** Deactivate (`is_active=false`) existing catalog
   items not in the sheet (preserves FKs/history), then load the 7 categories +
   42 services from `CATALOG-1.xlsx`.
5. **Tiers → flat now (A), variants table later (B).** Visiting & Inspection's 5
   price points and per-camera CCTV ship as separate service rows first; a
   `service_variants` table is a later phase.

**Risks (unchanged):**
- Fee% and ₹99 semantics affect **reporting/GST filing** — old bookings stay on
  the v1 snapshot; new ones use v2. Frozen snapshots + versioning keep them apart.
- The technician workflow loses full bill-entry (keeps a parts-only line) — needs
  clear in-app messaging so technicians understand the price is now fixed.
```
