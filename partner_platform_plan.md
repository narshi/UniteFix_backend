# Partner Platform — one way to onboard, verify, run and pay every kind of partner

_Drafted 2026-11-25 from the current code._

> **Decisions (2026-11-25):**
> 1. Verification: Cashfree Secure ID **and** by hand, both available now.
> 2. Food sellers may be auto-approved.
> 3. Payout schedule and limits are set per partner, and a partner can ask to be paid at any time.
> 4. Travel: UniteFix sells the trip and assigns it to a partner, paying the partner for the work.
> 5. Technicians move to partner accounts over time.
>
> **Built (2026-11-25):**
> - Identity checks, through Cashfree (PAN, GSTIN, bank penny drop, driving licence, vehicle RC) or recorded by hand (any check; FSSAI is always by hand). Each result keeps its history, names are compared, and a mismatch goes to review.
> - The **food** partner type (FSSAI document, food safety annex), with auto-approval once every check passes.
> - Payout settings per partner (schedule, automatic limit, minimum, hold), payout requests, staff "Pay now", an approval queue and the daily schedule job.
> - Screens: Admin → Business Partners → **Checks** and **Payouts** tabs; Partner Settlements → approval queue; the partner's Hub → Money → **Payouts**.
> - Tests: `npx tsx scripts/smoke-partner-platform.ts` (35 checks).
>
> **Next, in order:**
> 1. Approval per partner type (`partner_verticals` status).
> 2. The partner-type registry.
> 3. Seller GST types, for unregistered home cooks.
> 4. The travel module and travel partner accounts.
> 5. Document expiry jobs.
> 6. Gateway split settlement.
> 7. Partner 360 and work queues.
> 8. Technicians moved to partner accounts.

## 1. Where you are today

The foundation is already the right one. The **Partner Hub** gives one partner one record and one portal (`business_partners`). Their **verticals** switch **modules** on, team **roles** decide what each person may do, and a **plan** decides the paid back office (`shared/hub.ts`). Already on it:

| Partner type | Vertical → modules | Money |
|---|---|---|
| FTTH / broadband operators | `isp` → broadband, parts | Separate `ftth_operator_ledger` |
| Service businesses (computer, CCTV, plumbing, electrical) | → field, parts | Partner ledger |
| Product sellers | `electronics` → marketplace | Partner ledger, settled after the return window |
| Consultants | `consultation` → consulting | Partner ledger |
| Events, halls, photographers | → events, venue, portfolio | Partner ledger |
| Newspapers | `media` → newsroom | — |

Common to all: KYC (GSTIN and PAN checked for shape, bank verified by Cashfree penny-drop), onboarding documents and agreements per vertical, GST documents in their own series, monthly fee invoices, settlement runs paid through Cashfree Payouts.

**The gaps (why it will become a headache as partner types grow):**

1. **Partner types outside the Hub.**
   - **Travel partners** (`travel_partners`) are contact cards only: no login, no KYC, no ledger. Payouts to them are typed in by hand.
   - **Individual technicians** (`employees`) have their own app, document checks, wallet and withdrawals: a second money system.
2. **One vertical per business type is hard-wired in code.** Adding "food" or "travel" means editing several code lists (modules, documents, agreements). There is no vertical for home-made food, spices, dry fruits or travel.
3. **Approval is all or nothing.** A partner is `pending_approval / active / paused / disabled` as a whole. A seller approved for the store but not yet for travel can't be represented.
4. **Verification is partly manual.** GSTIN and PAN are shape checks only, and there are no checks for FSSAI, driving licence, vehicle permit or document expiry. Staff check what automation could.
5. **Two ledgers and a wallet** (`business_partner_ledger`, `ftth_operator_ledger`, technician wallets). Settlement offsets them by hand.
6. **Partner money passes through UniteFix's bank account** (see `product_store_plan.md` §2.4). This is fine for fees UniteFix earns, but questionable for marketplace sales.

## 2. Target: "one partner, one identity, many verticals"

```
                    ┌──────────── Vertical registry (one entry per partner type) ────────────┐
                    │ modules · documents · checks · agreements · tax · invoices · payout  │
                    └───────────────────────────────┬───────────────────────────────────────┘
Partner (business_partners) ──< partner_verticals (status per vertical) ──> modules in the Hub
        │                                                                     (web + app, by role)
        ├── KYC once: PAN, GSTIN, bank, address        ┐
        ├── vertical checks: FSSAI, licence, RC …       ├─ automated, re-checked on expiry
        ├── team (owner, manager, accountant, staff)    ┘
        └── ONE ledger ──> settlement engine (policy per vertical) ──> payout / gateway split
```

### 2.1 Vertical registry: adding a partner type is one entry, not a project

Each partner type is declared once (typed code in `shared/verticals/`, reviewed like code). Each entry says:

| Field | Example: home-made food seller | Example: travel cab partner |
|---|---|---|
| `modules` | marketplace | travel |
| `documents` | PAN, bank proof, FSSAI registration (expiry), kitchen photo | PAN, bank proof, driving licence (expiry), RC, permit, insurance (expiry) |
| `checks` | PAN, penny-drop, FSSAI number | PAN, penny-drop, licence, RC |
| `agreements` | Seller terms, food safety declaration | Partner terms, passenger safety code |
| `gstTypes` allowed | regular, composition, unregistered (in-state only) | regular, unregistered |
| `invoicing` | Seller issues to the customer (platform generates) | UniteFix issues to the customer; partner bills UniteFix (or self-billing) |
| `tax` | TCS (GST 52) + TDS 194-O on regular sellers | TDS 194C on payouts **VERIFY with CA** |
| `commission` | % by category | Margin per trip (quote − cost) |
| `settlement` | After return window, weekly | After trip completion, weekly |
| `risk limits` | New seller: 20 orders/day | New partner: no night trips for 30 days |

Staff tune the numbers (commission, hold days, limits) in Admin without a deploy. The behaviour (what a module does) stays in code. That split keeps a new vertical safe and fast.

### 2.2 Approval per vertical, not per partner

New table `partner_verticals (partner_id, vertical, status, risk_tier, approved_by, approved_at, paused_reason, limits jsonb)`.
- Status per vertical: `applied → checking → needs_review → active → paused → closed`.
- A partner can be active as a store seller while their travel application is in review. Modules switch on only for **active** verticals.
- The existing partner-level status becomes the account switch (suspended or closed overrides everything).

### 2.3 Onboarding as an automated pipeline (staff see only exceptions)

1. **Apply** (public page or invited by link, both exist): choose verticals; the form shows only the documents those verticals need.
2. **Automatic checks** run as jobs:
   - PAN and GSTIN live lookup, adding to today's shape checks.
   - Bank penny-drop with name match (exists).
   - FSSAI licence lookup.
   - Driving licence and RC checks.

   These need a verification provider. Cashfree Secure ID covers PAN, GSTIN, bank, driving licence and vehicle RC. **VERIFY** FSSAI coverage, which may need its own lookup or a manual check.
3. **Risk score:** name match, document expiry, duplicate PAN, phone or bank across partners, blacklist.
4. **Decision:**
   - Clean and low risk: auto-approve into the `new` tier with limits.
   - Anything else: a **review queue** item with the reason highlighted ("bank name doesn't match PAN").
5. **Agreement e-sign** (agreements exist): the vertical goes active and the modules appear.
6. **Ongoing:**
   - Expiring documents warn the partner at 30 and 7 days, then pause the vertical automatically.
   - Scores (rating, on-time, cancellations, returns; the store already does this) move the tier up or down and raise or lower limits.

### 2.4 One portal, one app mode: modules decide what each partner sees

- **Web:** the existing Partner Hub (`/partner/*`). Its navigation is built from active modules and the person's role, as it is already.
- **App:** the existing business-partner mode in the mobile app gains tabs from the same module list (Orders for sellers, Trips for travel, Jobs for field, Editions for newsroom).
- **No separate app per partner type.** A new vertical adds a module screen, not a new app.
- **Technicians and drivers** stay in the worker app (jobs and trips assigned to them). They are team members of a partner, or a "solo partner" record of their own, so their identity and pay flow through the same model.

### 2.5 Money: one ledger per partner, one settlement engine

- **One ledger.** `business_partner_ledger` is the single source. Every vertical posts typed entries: sale, commission, fee, TCS, TDS, penalty, adjustment, payout. FTTH's ledger moves into it over time; until then the engine reads both, as it does today. Technician wallets keep their own storage for now, but the settlement engine treats them as a **payee type**, so one payout run and one report covers all.
- **Settlement policy per vertical** from the registry: when money becomes payable (after the return window, after the trip, after installation) and on what cadence.
- **Settlement runs are automatic:**
  - Drafted weekly.
  - Paid automatically up to a limit; above it, one approver; above a higher limit, two (maker-checker).
  - Paid only to a verified bank account.
  - A run refuses if balances moved since it was drafted (exists).
- **Partner money for marketplace sales goes through gateway split settlement** (Razorpay Route or Cashfree Easy Split), not UniteFix's account **VERIFY with CA and gateway**. UniteFix's own fees are deducted in the split.
- **Statements and documents are automatic:**
  - Monthly statement PDF.
  - Monthly UniteFix fee invoice (exists).
  - TDS and TCS certificates data.
  - Partner GSTR-1 export (exists for Hub partners).

### 2.6 Invoices without staff effort

The registry's `invoicing` decides who issues what. Documents are generated from frozen order or trip lines at the right moment (as the store now does) in the issuer's own series, so staff never type an invoice. The Hub's GST desk gives each partner their sales register and returns data. UniteFix's admin sees the same registers across all partners.

### 2.7 The admin experience

| Screen | Purpose |
|---|---|
| **Partner 360** | One page per partner: verticals and status, KYC, documents with expiry, agreements, team, ledger, invoices, payouts, scores, tickets, audit log |
| **Work queues** | Only what needs a human: review applications, failed checks, expiring documents, disputes, failed payouts, penalties to review; each with an SLA timer |
| **Settlements** | This week's run: totals by vertical, exceptions first, approve in one click (maker-checker) |
| **Verticals** | Fees, hold days, limits and required documents per partner type |
| **Reports** | Partners by vertical and stage, onboarding time, payouts, TCS/TDS, GMV and take rate per vertical |

Staff roles map onto this through the existing capability map (for example, a Verifier can review KYC but not pay; Finance can approve runs but not edit partners).

## 3. Scaling to many more partners (thousands of partners, dozens of types)

- **Tenant isolation:** every Hub query is scoped by `partner_id` in the middleware (exists: `authenticateHub`, `hubModule`, `hubCan`). Keep it the only way in, and add an automated test per new module that a partner can't read another's data.
- **Jobs, not requests:** checks, document expiry, scoring, settlements and statements run on the job queue (pg-boss, as in the store plan), so admin pages stay fast and retries are safe.
- **Idempotent money:** every ledger entry has a unique source key (order, trip, run), and payouts carry an idempotency key. A retried job never pays twice.
- **Ledger at scale:** monthly partitions, and a balance snapshot table updated per entry so balances are one row read.
- **Events:** each vertical emits events (order delivered, trip completed). The settlement engine listens, so it never needs to know vertical internals.
- **Read models for dashboards:** nightly or streaming aggregates, so reports don't scan ledgers.
- **Later:** partner API keys and webhooks for larger partners (inventory sync, order feeds), and public partner pages (exist for events and portfolio).

## 4. Moving what exists, without breaking it (additive only)

| Step | Change | Effect |
|---|---|---|
| 1 | `partner_verticals` table; fill it from today's `verticals` list as `active` for active partners | Per-vertical approval, no behaviour change |
| 2 | Vertical registry in `shared/verticals/`; today's `VERTICAL_TO_MODULES`, `DOC_TYPES` and agreements move into it | Adding a type is one entry |
| 3 | New verticals: `food_homemade`, `spices`, `dry_fruits`, `travel`; seller GST types | Food sellers and travel partners can onboard |
| 4 | Travel module in the Hub; `travel_partners.business_partner_id` links existing cards to accounts when they join | Travel partners get a portal, KYC and statements; old trips keep their history |
| 5 | Automated checks provider and expiry jobs | Staff review only exceptions |
| 6 | Settlement engine: policies, payee types (including technician wallets), automatic weekly runs, maker-checker | Payouts without spreadsheets |
| 7 | Gateway split settlement for marketplace partners | Partner money stays outside UniteFix's account |
| 8 | Partner 360, work queues, verticals admin | The admin experience above |
| 9 | Fold FTTH ledger into the partner ledger (read both meanwhile) | One ledger |

## 5. Decisions to make

1. **Verification provider** for PAN, GSTIN, licence and RC (Cashfree Secure ID fits, since Cashfree is already used for payouts and penny-drop), and how to check FSSAI.
2. **Auto-approve rules:** which verticals may auto-approve into the `new` tier (store sellers, newspapers), and which always need a person (travel drivers, food).
3. **Payout cadence and approval limits** (for example: weekly; automatic up to ₹25,000; one approver up to ₹2,00,000; two above).
4. **Travel billing model:** UniteFix sells the trip and pays partners (as today), or partners invoice UniteFix. This changes the documents and TDS section **VERIFY with CA**.
5. **Technicians:** stay as UniteFix workers with wallets, or move to "solo partner" accounts over time.
