# FTTH Recharge — Modular Packages Architecture Plan

**Status:** Approved 13 Sep 2026 with the §5 decisions below. **Phase 1 implemented** (backend). Phases 2–4 pending.
**Written against:** `feature/react-native-app` @ `940ce4a`, 13 Sep 2026

**§5 decisions (locked):**
1. Discounts apply to the broadband line only — never to add-ons.
2. Exclusive groups ship in Phase 1.
3. Catalogue is strictly per operator.
4. Logos deferred to Phase 4; icons by `kind` until then.
**Scope:** `shared/schema.ts` (ftth_*), `server/services/ftth.service.ts`, `server/routes/ftth.routes.ts`, `mobile/src/screens/ftth/FTTHRechargeScreen.tsx`, `mobile/src/api/ftth.api.ts`, `client/src/pages/operator/plans.tsx`, `client/src/components/operator/PlanAddonsEditor.tsx`

---

## 0. Where we actually are

This is not greenfield. A first version of modular add-ons shipped in `67693e5` ("Itemise broadband bills") and it is worth being precise about what it does and does not do, because the redesign should build on it rather than replace it.

### What exists today

| Piece | State |
|---|---|
| `ftth_plans` | Flat: `listPricePaise`, `discountPaise`, `speedMbps`, `durationMonths`, `benefits` (marketing bullets, jsonb) |
| `ftth_plan_addons` | **Per-plan** rows: `label`, `kind` (enum), `amountPaise`, `isOptional`, `isActive`. Price lives on each row. |
| `ftth_addon_kind` enum | `telephone · ott · iptv · static_ip · installation · other` |
| `ftth_recharges` | Frozen snapshot per purchase, incl. `addonsSnapshot` (jsonb) + `addonsTotalPaise` |
| `FtthService.quote()` | Reads active add-ons for the plan, bills mandatory ones always, optional ones when `selectedAddonIds` names them. Add-ons flow 100% to `operatorPayable`; convenience fee does **not** multiply per line. |
| `GET /api/ftth/operators/:id/plans` | Returns `addons[]`, `mandatoryAddonsTotal`, `payable` (with mandatory only) per plan |
| `POST /api/ftth/recharges/initiate` | Accepts `addonIds[]`; prices server-side; ignores unknown ids |
| Mobile `FTTHRechargeScreen.tsx` | 669 lines. Speed chips → `DurationRangeSelector` (519 lines) → inline optional add-on card → inline bill breakdown card → sticky footer with total |
| Operator `plans.tsx` | Speed × duration grid → plan dialog. `PlanAddonsEditor` inside the dialog adds add-ons **to that one plan** |
| Smoke | `npm run smoke:ftth-addons` — 20 checks on `quote()` against a real DB |

### What the current design gets right (keep)

- **Add-ons are additive.** `listPricePaise` stays the broadband line; extras stack on top. No live plan was repriced by introducing them, and the smoke suite asserts that first.
- **Frozen snapshot on the recharge.** A receipt reprinted next year shows what was sold, not today's catalogue. This is where JSONB belongs.
- **Money rules.** Add-ons are the operator's supply; UniteFix takes nothing from them; one convenience fee per recharge however many lines.
- **Server-side pricing.** The client names *which*; the server decides *how much*.

### The gap that motivates this plan

**Price lives on the per-plan row.** An operator with 12 plans who wants to change their OTT pack from ₹149 to ₹179 edits 12 rows. That is exactly requirement #2 ("update the cost of an OTT addon across all plans") and it does not scale past a handful of plans.

The secondary gap is the mobile screen: the add-on picker and the bill breakdown are both inline cards inside the scroll. With two or three groups of add-ons the screen becomes a long list on a 5.5" device and the total falls out of view.

---

## 1. Database Schema Redesign

### 1.1 Relational vs JSONB — decision

**Relational for the catalogue. JSONB only for the frozen receipt.**

| Concern | Relational | JSONB config column |
|---|---|---|
| Update OTT price across all plans | One `UPDATE` on the catalogue row | Rewrite every plan's blob |
| "Which plans include Netflix?" | `WHERE catalog_id = …` | jsonb path query, no index on price |
| Referential integrity | FK, cascade, can't dangle | None — a typo'd key silently drops a line |
| Per-plan override | One nullable column | Nested override structure inside the blob |
| Receipt of what was bought | ✗ — must be frozen | ✓ — already done (`addonsSnapshot`) |

JSONB is the right tool for the *result* of pricing (the receipt), and the wrong tool for the *source* of pricing (the catalogue). Keep the split we already have.

### 1.2 Proposed structure

Three tables. One is new, one is the existing table with two columns added, one is unchanged.

```
ftth_addon_catalog        (NEW)  — the operator's master list, priced once
ftth_plan_addons          (KEEP) — becomes a LINK: plan ↔ catalog item, with optional override
ftth_recharges            (KEEP) — addons_snapshot / addons_total_paise unchanged
```

#### `ftth_addon_catalog` (new)

```
id                  serial PK
operator_id         int FK → ftth_operators (cascade)
name                text            -- "Netflix Basic", "Telephone", "Static IP"
kind                ftth_addon_kind -- existing enum; drives UI grouping + icon
description         text null
pricing_basis       enum('flat','per_month')   ← the key column
default_price_paise int
default_optional    bool default true
exclusive_group     text null       -- "ott_tier": at most one selected per group per plan
logo_url            text null       -- OTT brand mark
sort_order          int default 0
is_active           bool default true
created_at, updated_at
UNIQUE (operator_id, name)
```

**`pricing_basis` is what solves the duration problem** that made the first version per-plan. Telephone rental is ₹118/month; on a 12-month plan the line is ₹1,416. With `per_month`, the catalogue holds ₹118 once and every plan derives its own figure from `durationMonths`. `flat` covers one-time items (installation, a static IP setup fee) and OTT packs sold as a bundle regardless of term.

**`exclusive_group`** gives you "Netflix Basic / Standard / Premium — pick one" without a separate bundle-rules table. Within one plan, the server refuses two selections from the same group; the UI renders that group as radio buttons instead of checkboxes.

#### `ftth_plan_addons` (existing → link table)

Add two nullable columns. Everything else stays.

```
catalog_id            int FK → ftth_addon_catalog null   ← NEW
price_override_paise  int null                            ← NEW
-- existing: plan_id, label, kind, amount_paise, is_optional, description, sort_order, is_active
```

**Effective price of a plan add-on:**

```
effective_paise =
    link.price_override_paise
    ?? (catalog.pricing_basis == 'per_month'
          ? catalog.default_price_paise * plan.duration_months
          : catalog.default_price_paise)
    ?? link.amount_paise                     -- legacy row with no catalog_id
```

**Effective optional flag:** `link.is_optional ?? catalog.default_optional`.

This ordering means:

- Change the catalogue price → every plan **without an override** changes. That is requirement #2.
- An operator who negotiated "₹99 OTT on the annual plan only" sets one override on one link.
- Rows that exist today (`catalog_id IS NULL`) keep pricing exactly as they do now. **Zero-downtime, zero behaviour change on deploy.**

#### `ftth_addon_categories` — deliberately not added

The user prompt suggests a categories table. Recommendation: **not yet.** The `kind` enum already provides the grouping the UI needs (Telephone / OTT / IPTV / …) and, more importantly, it is what future *system* behaviour will key on — GST treatment per category, icons, fulfilment steps. Operator-defined custom categories add an admin surface and a join for a need nobody has expressed. Revisit when an operator asks for a group the enum cannot express; adding it later is additive.

### 1.3 Migration path

All additive. Consistent with the rule this project has followed throughout: schema changes yes, data never hampered.

1. `CREATE TYPE ftth_pricing_basis`, `CREATE TABLE ftth_addon_catalog`.
2. `ALTER TABLE ftth_plan_addons ADD COLUMN catalog_id …, ADD COLUMN price_override_paise …`.
3. **Backfill script** (one-off, idempotent, run once per environment):
   - For each operator, `SELECT DISTINCT label, kind FROM ftth_plan_addons` → create a catalogue row per distinct `(label, kind)`, `pricing_basis = 'flat'`, `default_price_paise` = the most common `amount_paise` across its plans.
   - For each existing add-on row: set `catalog_id`; set `price_override_paise = amount_paise` **only where it differs from the catalogue default**. Rows matching the default get no override, so they follow the catalogue from then on.
   - Log a summary per operator: N catalogue items, M links, K overrides.
4. `quote()` and the plan listing switch to the effective-price formula. Legacy rows (null `catalog_id`) keep working via the `?? link.amount_paise` fallback.
5. **Phase 4 only, after a full cycle:** `ALTER … catalog_id SET NOT NULL`, drop `label`/`kind`/`amount_paise` from the link table. Not before — the fallback is what makes this deployable without a freeze.

### 1.4 What `quote()` changes to

```ts
// today: SELECT * FROM ftth_plan_addons WHERE plan_id = ? AND is_active
// after:  LEFT JOIN ftth_addon_catalog ON catalog_id, compute effective per row,
//         enforce exclusive_group on the selected set, freeze the result.
```

The snapshot written to `ftth_recharges.addons_snapshot` gains two fields per line — `catalogId` and `pricingBasis` — so a receipt can say "Telephone · ₹118 × 12 months". The **shape** of the money math does not change: `operatorPayable = listPrice − discount + Σ effective`, `total = operatorPayable + convenienceFee`. The existing 20 smoke checks must continue to pass unchanged; new ones cover catalogue inheritance, override precedence, `per_month` × duration, and exclusive-group rejection.

### 1.5 Invariants to carry forward (non-negotiable)

1. A plan with no add-ons prices to the paisa as it does today.
2. Add-ons are additive to `listPricePaise`, never a re-description of it.
3. Every paisa of add-on revenue is `operatorPayable`; none is `platformRevenue`.
4. One convenience fee per recharge, regardless of line count.
5. The client sends ids; the server sends prices. An unknown id adds ₹0.
6. The recharge row is the receipt. It is never recomputed from the live catalogue.

---

## 2. UI/UX Strategy — Mobile

### 2.1 The real-estate problem, stated precisely

The current screen stacks five things in one scroll: speed chips, the duration selector (which is tall — it is a range selector with milestone markers), an add-on card, an itemised bill card, and then a sticky footer. The bill card alone is 6–9 rows once add-ons exist. On a 360×740 device the user cannot see the total and the add-on toggles at the same time, so every toggle is followed by a scroll to check what it did.

The fix is not to shrink things. It is to **move the bill out of the scroll** and **collapse the add-ons by default**.

### 2.2 Proposed flow

```
┌──────────────────────────────────────────┐
│ ← Broadband Recharge                     │  ScreenHeader (unchanged)
├──────────────────────────────────────────┤
│ ▌BASE PLAN                               │
│  [30] [50] [100] [200] Mbps              │  speed chips (unchanged)
│  ───●────────○────────○────              │  DurationRangeSelector (unchanged)
│  30 Mbps · 12 months            ₹5,652   │  one-line summary of the base choice
│  Includes: Telephone ₹1,416              │  mandatory add-ons, folded in, not toggleable
├──────────────────────────────────────────┤
│ ▌ADD-ONS                                 │
│  ▸ OTT Subscriptions      1 selected ₹149│  accordion, collapsed, summary on the right
│  ▸ IPTV                      none        │
│  ▸ Static IP                 none        │
├──────────────────────────────────────────┤
│               (scroll ends)              │
├══════════════════════════════════════════┤
│ Total ₹7,227 · 3 items         [Pay →]   │  sticky footer
│ ▴ View breakdown                         │  opens BillSummarySheet
└──────────────────────────────────────────┘
```

**Base Plan card** — the speed + duration controls stay exactly as they are (they are the strongest part of the current screen). What changes: a one-line summary underneath confirming the choice and its price, and mandatory add-ons presented as *"Includes …"* rather than as toggles the user cannot toggle. They are part of the plan; showing them as disabled checkboxes invites the question "why can't I turn this off?"

**Add-on groups as accordions** — one per `kind` present on the selected plan, **collapsed by default**. The header row carries the summary: name, how many selected, running subtotal for the group. Expanding one shows its rows inline (no navigation, no modal). A group with `exclusive_group` renders radio rows; otherwise checkboxes. Only one accordion open at a time (opening one closes the others) — keeps the scroll bounded.

**Bill breakdown moves to a bottom sheet** — this is the largest single space recovery. The footer's total is the summary; the itemised breakdown (broadband line, discount, each add-on with its `× 12 months` where relevant, convenience fee, total) is behind "View breakdown", using the same `Modal` + slide pattern already used for `WarrantyCard`'s claim sheet and `SupportTicketScreen`'s ticket sheet. The sheet is read-only; toggles stay on the main screen so the user never edits inside a sheet whose total is above it.

### 2.3 Sticky footer and dynamic total

```
total = plan.payable                       // base + mandatory + fee, from the server
      + Σ selectedOptional.effectiveAmount // from the plan payload, client-side
```

- Recomputed with `useMemo` over `(selectedPlan, selectedAddonIds)`. Rounded to paise (`Math.round(x*100)/100`) so `471 + 118.5` never renders as `589.4999`.
- Footer shows **total**, **item count** ("3 items"), and **the chevron for the breakdown**. Nothing else — the footer is the answer, not the working.
- `selectedAddonIds` resets on plan change (already implemented) — add-on rows belong to a plan.
- On **Pay**, the client sends `{ connectionId, planId, addonIds }`. The server re-prices from the database. If the server total differs from what the client showed (catalogue changed between load and pay), `initiate` returns the server figure and the Razorpay sheet opens on *that* — the client total is a preview, never the charge.
- Small delight, cheap: when a toggle changes the total, animate the footer number (`Animated` value, 180ms). Respect `prefers-reduced-motion` (`AccessibilityInfo.isReduceMotionEnabled`).

### 2.4 Component decomposition

`FTTHRechargeScreen.tsx` becomes an orchestrator (~180 lines) over:

| Component | Responsibility | Lines (est.) |
|---|---|---|
| `BasePlanSection` | speed chips + `DurationRangeSelector` + summary line + "Includes" | ~120 |
| `AddonGroupAccordion` | one `kind` group; header summary; expand/collapse; radio vs checkbox by `exclusiveGroup` | ~140 |
| `AddonRow` | logo/icon, name, description, price (with "× N months" hint), control | ~70 |
| `BillSummarySheet` | bottom sheet, read-only itemised bill, close | ~120 |
| `StickyTotalBar` | total, count, breakdown trigger, Pay button, safe-area padding | ~80 |
| `usePlanPricing(plan, selectedIds)` | hook: groups add-ons by kind, computes total, exposes toggle with exclusive-group logic | ~80 |

The `DurationRangeSelector` (519 lines) is untouched.

### 2.5 Screen-fit acceptance

- On a 360×740 viewport with all accordions collapsed, the base plan, the add-on group headers, and the footer are all visible **without scrolling**.
- Expanding one group of up to 5 rows keeps the footer visible.
- The breakdown sheet lists up to 12 lines without internal scroll on that viewport.
- Tracking and History screens keep reading `addonsSnapshot` — no change needed there; they gain the "× N months" hint from the enriched snapshot.

---

## 3. Operator Panel

Two surfaces. The first is new; the second replaces the current `PlanAddonsEditor`.

### 3.1 Add-on Catalogue page (new: `/operator/addons`)

The operator's master price list. Sidebar entry beside "Plans".

```
Add-on catalogue                                     [+ New add-on]

Name              Kind        Basis      Price     Used by   Active
Telephone         Telephone   per month  ₹118      9 plans   ●
Netflix Basic     OTT         flat       ₹149      6 plans   ●   ⟵ exclusive: ott_tier
Netflix Premium   OTT         flat       ₹299      6 plans   ●   ⟵ exclusive: ott_tier
Static IP         Static IP   flat       ₹500      2 plans   ●
Installation      Installation flat      ₹1,000    0 plans   ○
```

- **Edit price** → confirm dialog: *"₹149 → ₹179 affects 6 plans. 2 of those have their own override and will not change."* The operator sees the blast radius before committing. This is the feature that answers requirement #2.
- **Attach to plans** → multi-select over the speed×duration grid, or "all plans at 30 Mbps", or "all plans". Bulk-creates link rows with no override. This is what makes onboarding an ISP with 20 plans a five-minute job.
- **Retire** (soft) — links stay, add-on disappears from customer app. Existing recharges unaffected (snapshot).
- Form fields: name, kind, basis, default price, default optional/mandatory, exclusive group (free text with suggestions from existing groups), description, logo upload (reuses the Cloudinary upload route).

### 3.2 Plan dialog — "Add-ons on this plan"

Replaces the free-form `PlanAddonsEditor`. Inside the existing plan dialog, below pricing:

```
Add-ons on this plan                          [Attach from catalogue ▾]

  Telephone        per month  ₹118 × 12 = ₹1,416   Always billed   [override ₹ ___]  ✕
  Netflix Basic    flat       ₹149                 Optional        [override ₹ ___]  ✕
  Netflix Premium  flat       ₹299                 Optional        [override ₹ ___]  ✕

  Card price: ₹5,652 (base ₹4,236 + always-billed ₹1,416)
```

- **Attach from catalogue** is a picker grouped by kind, not a form. Creating a brand-new add-on from here is a link to the catalogue page — one place to define, many places to attach.
- Each row shows the **effective** price and how it was derived (`₹118 × 12`), with an inline override field. Leaving it blank means "follow the catalogue". A filled override shows a small "custom" badge so it is visible that this plan has diverged.
- Optional/mandatory is a per-link toggle defaulting from the catalogue.
- The card price line updates live, as it does today.
- Unchanged from the current version: add-ons need a saved plan (there is no plan id before save).

### 3.3 Relabel the existing "Extras" field

Already done in `67693e5` — `benefits` is labelled *"Benefits shown on the card (not billed)"*. Keep that distinction sharp in the new UI: benefits are bullets, add-ons are money.

### 3.4 API surface (operator side)

```
GET    /api/ftth/admin/addons                       list catalogue (+ usage count)
POST   /api/ftth/admin/addons                       create
PATCH  /api/ftth/admin/addons/:id                   edit (returns affected plan count)
DELETE /api/ftth/admin/addons/:id                   soft retire; ?hard=true only if unused
POST   /api/ftth/admin/addons/:id/attach            { planIds[] | speedMbps | all }

GET    /api/ftth/admin/plans/:planId/addons         existing — now returns effective + derivation
POST   /api/ftth/admin/plans/:planId/addons         existing — body becomes { catalogId, priceOverrideRupees?, isOptional? }
PATCH  /api/ftth/admin/plans/:planId/addons/:id     existing — override + optional only
DELETE /api/ftth/admin/plans/:planId/addons/:id     existing
```

All scoped through `operatorPlan()` / operatorId as today. Customer-facing `GET /api/ftth/operators/:id/plans` gains per add-on: `catalogId`, `pricingBasis`, `unitAmount`, `effectiveAmount`, `exclusiveGroup`, `logoUrl`.

---

## 4. Step-by-Step Execution Plan

Sequenced by dependency. Each phase ships independently and leaves the app working.

### Phase 1 — Schema & pricing engine (backend only, ~2 days)

1. Enum + `ftth_addon_catalog` table + two columns on `ftth_plan_addons`, in `runStartupMigrations()`. Additive.
2. Drizzle schema + types.
3. `scripts/backfill-addon-catalog.ts` — idempotent, per-operator summary log, dry-run flag.
4. `quote()`: join catalogue, effective-price formula, `exclusive_group` enforcement (reject with a 400 naming the group), enriched snapshot fields.
5. Customer plan listing returns the enriched add-on shape.
6. Smoke: extend `smoke-ftth-addons.ts` — catalogue inheritance, override precedence, `per_month × duration`, exclusive-group rejection, legacy null-catalog fallback. Existing 20 must pass unchanged.

**Done when:** all smoke checks green; `npm run build` green; a plan with legacy rows and a plan with catalogue rows both price correctly on the same operator.

### Phase 2 — Operator panel (~2–3 days)

1. Catalogue CRUD routes + attach route.
2. `/operator/addons` page: table, create/edit dialog, price-change blast-radius confirmation, attach-to-plans picker.
3. Rework `PlanAddonsEditor` → catalogue picker + per-link override/optional, effective-price derivation shown.
4. Sidebar entry.

**Done when:** an operator can create "Telephone ₹118/month", attach it to every plan in one action, see each plan's derived figure, override one, and change the catalogue price with the confirmation showing the right counts.

### Phase 3 — Mobile rewrite (~3 days + device testing)

1. `usePlanPricing` hook; `mobile/src/api/ftth.api.ts` types for the enriched shape.
2. Components: `BasePlanSection`, `AddonGroupAccordion`, `AddonRow`, `BillSummarySheet`, `StickyTotalBar`.
3. `FTTHRechargeScreen.tsx` → orchestrator. `DurationRangeSelector` untouched.
4. Tracking + History: render `× N months` from the enriched snapshot (small).
5. Device pass on a 360×740 Android and one larger device against the acceptance criteria in §2.5.

**Done when:** screen-fit criteria met; toggling add-ons updates the footer live; a mismatch between preview and server total shows the server figure at pay; a plan with no add-ons renders with no accordions and no breakdown chevron (nothing to break down).

### Phase 4 — Hardening & cleanup (after one billing cycle on Phase 1–3)

1. `catalog_id SET NOT NULL`; drop `label`/`kind`/`amount_paise` from `ftth_plan_addons`; remove the legacy fallback branch from `quote()`.
2. Operator P&L: add-on revenue by kind per operator (reads `addonsSnapshot`).
3. Optional: `ftth_addon_categories` if an operator has asked for a grouping the enum cannot express.

**Not before Phase 4:** anything non-additive.

### Risks and how they are contained

| Risk | Containment |
|---|---|
| Backfill mis-groups two add-ons with the same label but different prices | Backfill sets an override wherever price ≠ catalogue default; nothing changes price. Dry-run first. |
| Catalogue price edit silently reprices a negotiated plan | Override wins over catalogue; blast-radius dialog names the count of overridden plans that will *not* change. |
| Client shows a stale total after a catalogue edit | Server re-prices at `initiate`; Razorpay opens on the server figure. Preview is never the charge. |
| Exclusive-group rule bypassed by a crafted request | Enforced in `quote()`, not just in the UI. |
| Mobile rewrite regresses the working duration selector | It is not touched. |

---

## 5. Decisions needed before Phase 1

1. **`per_month` add-ons and discounts** — should a plan-level `discountPaise` ever apply to add-on lines, or only to the broadband line? *Recommend: broadband line only*, as today. Add-on promotions belong in the offers work planned separately (`funded_by`).
2. **Exclusive groups at launch** — ship `exclusive_group` in Phase 1 (recommended; it is one nullable column and the OTT tier case is the first thing an ISP will ask for), or defer?
3. **Catalogue scope** — per operator (recommended; ISPs price differently) or a shared platform catalogue operators subscribe to? Per-operator is simpler and matches how every other FTTH table is scoped.
4. **Logo uploads for OTT brands** — reuse the Cloudinary route now, or ship with icons by `kind` and add logos in Phase 4?

---

*Money is integer paise throughout. Rupees appear only at the UI boundary.*
