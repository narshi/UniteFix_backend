# FTTH Recharge — ID-first flow, range pricing, and its own tracking

Plan only. Nothing below is built yet.

Three changes to what shipped:

1. **Enter your connection ID and recharge immediately**, instead of requesting
   a link and waiting days for the operator to approve it. If the ID isn't
   theirs, say so and send them to the new-connection flow.
2. **Range selectors** over speed / duration / connection type, pricing live.
3. **Its own tracking**, not the service-booking tracker: paid → in progress →
   recharge complete.

---

## 0. The decision everything else depends on

> **What does "check if this ID exists" check against?**

Right now: nothing. `ftth_connections.user_id` is `NOT NULL`, so a connection row
only comes into being *after* a customer asks to link and the operator approves.
On day one an ID lookup would find nothing for anybody, and every single
customer would be told "you don't exist — book a new connection". That is worse
than the current flow, not better.

So this feature is really a request for something UniteFix does not have yet: **a
list of each operator's existing customers.** Everything else here is
straightforward; this is the part that needs your decision.

### Option A — the operator uploads their customer list *(recommended)*

A new `ftth_customer_roster` table: operator id, their customer ID, name, phone,
address, and optionally the current plan and expiry. The operator imports it as
CSV from the portal — the same import already built for the plan grid, pointed at
a different file.

- Delivers exactly the flow you described, instantly.
- Costs the operator one CSV export from their billing system, and a re-upload
  when it drifts.
- Means UniteFix stores an ISP's customer PII. Worth a line in the operator
  agreement.

### Option B — make `ftth_connections.user_id` nullable

Operators pre-create connection rows with no customer attached; linking fills in
the user.

- One table instead of two.
- But "a connection belonging to nobody" muddies a table that currently has a
  clean meaning, and `unique(user_id, operator_id)` starts allowing multiple
  NULL-user rows per operator. I'd rather keep the roster separate and let a
  `ftth_connections` row keep meaning "a customer of ours, linked".

### Option C — don't verify at all

Accept whatever ID is typed and let the operator reconcile later.

- Zero operator effort, works day one.
- But it cannot produce the "doesn't exist" popup you asked for, and it takes
  money against typo'd IDs. This is roughly what ships today, minus the wait.

### What I'd do

**Option A, with Option C as the automatic fallback.** If an operator has
uploaded a roster, the ID lookup is real. If they haven't, the app quietly keeps
the current request-and-approve path instead of telling every customer they don't
exist. That way onboarding an operator who won't share a list still works, and
one who will gets the better flow.

> **Please confirm before I build:** will Poorvi (and the operators after them)
> actually export and maintain a customer list? If the honest answer is no, the
> ID-first flow cannot work as described and we should talk about Option C.

---

## 1. Don't let the lookup leak their customer base

If typing an ID returns "found — Ramesh Kumar, 100 Mbps, expires 12 Sep", anyone
can walk the ID space and reconstruct an ISP's entire customer list, name by
name. That is a real risk and cheap to avoid:

- **Never echo identity back.** A match returns "found, continue" and nothing
  else. Name and plan appear only *after* the second factor below.
- **Require a second factor.** ID plus the last 4 digits of the phone on the
  roster. Cheap, no SMS cost, and enough that a stranger with a guessed ID gets
  nowhere.
- **Rate limit hard** — its own bucket, like the operator-apply limiter, not one
  shared with anything else.
- **Log every failed lookup** with the ID attempted. A burst from one account is
  exactly what enumeration looks like.

If you want it tighter, an OTP to the roster's registered number instead of the
last-4 check. It proves ownership rather than knowledge, at the cost of an SMS
and a step. My recommendation is last-4 to start, with the OTP path designed for
but not switched on.

Note the actual harm here is *disclosure*, not the recharge — a stranger paying
to extend someone's broadband hurts nobody. So the defence belongs on what the
lookup reveals, not on who may pay.

---

## 2. Range selectors, honestly

You asked for range selectors. I argued against sliders when building the current
screen, so let me be straight about why, and where I think we land.

The problem was never the slider. It was that an operator's catalogue is
**sparse** — Poorvi sells 30 Mbps at 1 and 6 months but not 3 — and a continuous
slider happily lands on combinations nobody sells.

**A slider that snaps to real values solves both.** Concretely:

- **Connection type** first (see below), if the operator offers more than one.
- **Speed:** a slider whose stops are exactly that operator's speeds for that
  type. Drag it and it clicks between 30 → 50 → 100. No stop exists that can't
  be bought.
- **Duration:** a slider whose stops are exactly the durations sold *at the
  chosen speed*. Choosing 30 Mbps leaves stops at 1 and 6 only; 3 months isn't
  reachable because it isn't sold.
- **Price updates live** as either slider moves, with the breakdown underneath.

Same feel as a range control, but the sparse matrix stays honoured and nothing in
the app hardcodes a speed ladder. If an operator later sells 25/75 Mbps, the
slider has those stops the moment they save the plan.

### Connection type

New dimension. `ftth_plans` gains a `connection_type` column — operator-defined
free text, e.g. "Residential" / "Business" / "OTT Bundle", defaulting to a single
type so existing plans and the current screen keep working untouched. The
selector only appears when an operator actually offers more than one.

---

## 3. Tracking — its own, not the booking tracker

You're right that this shouldn't reuse service-booking tracking. A recharge has
nothing in common with a technician visit: no assignment, no OTP, no geofence, no
final bill.

Three stages, as you described:

| Stage | Becomes true when | What the customer sees |
| --- | --- | --- |
| **1 · Payment successful** | Razorpay capture applied (`status = 'success'`) | Done, with the amount and time |
| **2 · In progress** | Immediately after 1, until the operator confirms | Active, "Poorvi is applying your recharge" |
| **3 · Recharge complete** | Operator marks it done in their portal | Done, with the new expiry date |

**Most of this already exists.** `ftth_recharges` already carries `status`,
`fulfilled_at` and `fulfilled_by_admin_id`, and the operator portal already has
the "Mark done" button that sets them. What's missing is the customer-facing
screen and the notifications.

So stages derive from data we already store — no new state machine:

```
failed / refunded  → terminal, shown as its own state
status = 'success' && fulfilled_at IS NULL   → stage 2 active
status = 'success' && fulfilled_at IS NOT NULL → stage 3 complete
```

Optionally an `acknowledged_at` so the operator can say "seen it, working on it"
and stage 2 has a real transition rather than being pure waiting. I'd leave it
out at first — it's another thing for the operator to remember, and the customer
can't tell the difference.

Two things that matter more than the visual:

- **Notify on completion.** Stage 3 is invisible unless we push it. Also notify
  on payment success, since that's the receipt.
- **What if the operator never marks it done?** Today the customer waits at
  stage 2 forever and nobody notices. Needs: a nudge to the operator after a few
  hours, and an escalation to UniteFix staff after a day. The operator portal
  already surfaces an "awaiting fulfilment" count; this makes it chase itself.

### Where it lives

`FTTHRechargeStatusScreen`, reached from the recharge confirmation, from history,
and from the push notification. Explicitly not wired into `RequestDetailScreen`
or the booking status components.

---

## 4. What changes, concretely

**New**
```
shared/schema.ts                    ftth_customer_roster, ftth_plans.connection_type
scripts/apply-ftth-roster-migration.mjs
server/routes/ftth.routes.ts        POST /api/ftth/lookup, roster import + list endpoints
client/src/pages/operator/customers.tsx   roster upload + management tab
mobile/src/screens/ftth/FTTHConnectionLookupScreen.tsx
mobile/src/screens/ftth/FTTHRechargeStatusScreen.tsx
mobile/src/components/ftth/SnapSlider.tsx
server/services/task_queues.ts      fulfilment nudge + escalation
```

**Changed**
```
FTTHOperatorSelectScreen   → route to lookup rather than onboarding
FTTHOnboardingScreen       → becomes the not-found destination; keep the
                             "I'm sure I'm a customer" path as fallback
FTTHRechargeScreen         → chips become snapping sliders, + connection type
```

**Kept as-is.** Payments, the ledger, settlements, leads, plans, coverage,
operator auth and the whole RBAC layer are untouched. The delta is smaller than
the description suggests — mostly one new table, one lookup endpoint, and two
mobile screens.

---

## 5. Suggested order

| Phase | Scope | Why here |
| --- | --- | --- |
| **1** | Roster table, CSV import in the operator portal, staff view | Nothing else can be built or tested until an operator's customers exist in the system |
| **2** | Lookup endpoint + `FTTHConnectionLookupScreen`, not-found → new-connection flow, rate limits and the last-4 check | The flow you described, end to end, before any UI polish |
| **3** | Connection type + snapping sliders | Pure UI on top of a working flow |
| **4** | Tracking screen + notifications | Needs real recharges to look at |
| **5** | Fulfilment nudge and escalation | Only matters once operators are actually using it |

Phases 1–2 are the ones that change the product. 3–5 make it good.

---

## 6. What I need from you

1. **Will operators maintain a customer list?** The honest answer decides between
   the flow you described and Option C. Everything else is downstream of this.
2. **Second factor on lookup** — last 4 digits of the registered phone (my
   recommendation), or an OTP?
3. **Connection type** — is that residential/business, or something else in your
   market? It changes whether it's a plan attribute or a separate axis.
4. **Fulfilment SLA** — how long before UniteFix should chase an operator who
   hasn't applied a paid recharge? I'd suggest a nudge at 4 hours and an
   escalation at 24.
