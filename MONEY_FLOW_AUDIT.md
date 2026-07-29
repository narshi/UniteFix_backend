# Money Movement Audit — Refunds & Withdrawals

**Date:** 2026-07-29
**Question:** are refunds actually happening, and does the admin-approved withdrawal
actually move money?

**Short answers:**
- **Refunds — NO.** The two live refund paths never issue a refund, and both tell
  the customer and the database that they did.
- **Withdrawals — YES, the payout genuinely fires.** But the record never reaches
  `completed`, and there is a double-payout race.

Traced through code only. No production queries were run.

---

## PART 1 — REFUNDS

### 1.1 Booking cancellation (₹99) — **BROKEN, silent** · CRITICAL

**Flow:** customer cancels from `created` → `POST /api/bookings/:id/cancel`
→ `PaymentService.refundBookingCharge(bookingId)` → `razorpay.payments.refund()`.

**The break** — `refundBookingCharge` looks for the payment to reverse with three
conditions (`payment.service.ts`):

```js
.where(and(
    eq(paymentTransactions.serviceRequestId, serviceRequestId),
    eq(paymentTransactions.status, 'captured'),
    sql`${paymentTransactions.metadata}->>'paymentType' = 'booking_charge'`
))
```

No row in `payment_transactions` can satisfy all three. Every writer:

| Written by | serviceRequestId | status | `metadata.paymentType` | matches? |
|---|---|---|---|---|
| `/api/services/create` (order created) | ✅ set | `pending` ❌ | `booking_charge` ✅ | **no** |
| `PaymentService.createBookingOrder` | ✅ set | `pending` ❌ | `booking_charge` ✅ | **no** |
| `/api/payments/verify` (the path that works) | ❌ **not set** | `captured` ✅ | `verifiedVia` only ❌ | **no** |
| webhook `payment.captured` | ❌ **not set** | `captured` ✅ | raw Razorpay entity ❌ | **no** |

Verified there is no update path that could rescue it: the only
`db.update(paymentTransactions)` in the codebase is inside `refundBookingCharge`
itself, setting `status: 'refunded'` *after* a successful refund. Nothing ever
promotes the `order_created` row to `captured`.

**Why it is silent.** `refundBookingCharge` does not throw when it finds nothing —
it logs a warning and returns `null`. The caller only catches throws:

```js
// bookingFeeStatus is set to 'refunded' BEFORE the refund is even attempted
await db.update(serviceRequests).set({
    status: BookingState.CANCELLED,
    bookingFeeStatus: 'refunded',      // ← unconditional
})

try { await PaymentService.refundBookingCharge(bookingId); }
catch (e) { /* null return is not a throw, so never reached */ }

res.json({
    message: 'Booking cancelled. ₹99 refund will be processed within 5-7 business days.',
    data: { refundInitiated: true },   // ← hardcoded true
});
```

**Net effect:** customer is told they are refunded, the booking says `refunded`,
Razorpay was never called, and the only trace is one `logger.warn`. Nothing in the
admin dashboard surfaces it.

### 1.2 Dispute resolution refund — **BROKEN, same root cause** · CRITICAL

`POST /api/admin/bookings/:id/resolve-dispute` with `refund_customer` or `split`
calls the same broken function, and reports success regardless:

```js
try {
    await PaymentService.refundBookingCharge(bookingId);
    actionsTaken.push('Booking fee refund initiated');   // ← pushed even on null
} catch (err) { ... }
```

Two further problems in this path:

1. **`refundAmount` is ignored.** The body accepts `refundAmount`, and the route
   documents "split: Partial refund + partial release", but the call takes no
   amount — `refundBookingCharge(bookingId)` only ever targets the ₹99 booking fee.
   An admin resolving a ₹5,000 dispute in the customer's favour refunds nothing,
   and would refund only ₹99 even once the function is fixed.
2. **The final service payment is never refundable at all.** No code path refunds
   the `finalTotal` a customer paid for a completed job — only the booking fee is
   ever considered.

The wallet side of the same handler **does** work: `release_employee` correctly
moves `balanceHold → balanceAvailable` and flips `isReleased`.

### 1.3 Product return refunds — **WORKS** (but dormant)

`PaymentTrackingService.initiateRefund` genuinely calls
`razorpay.payments.refund()`, records `refund_initiated`, and writes to the
`refunds` table. It requires a real `razorpayPaymentId` handed in by the caller.

This is the only correct refund implementation in the codebase — and it serves
product returns, which are halted ("Coming Soon"). The live flows use the broken one.

### 1.4 Refund summary

| Path | Calls Razorpay? | Tells user it worked? | Severity |
|---|---|---|---|
| Booking cancellation (₹99) | **No** | **Yes** | CRITICAL |
| Dispute → refund_customer / split | **No** | **Yes** | CRITICAL |
| Dispute → partial `refundAmount` | Not implemented | Yes | HIGH |
| Final service payment refund | Does not exist | — | HIGH |
| Product return | **Yes** ✅ | Yes | dormant |

---

## PART 2 — WITHDRAWALS

### 2.1 Is it admin approved? — **Yes** ✅

- Partner requests via `POST /api/partner/wallet/withdraw`, creating
  `withdrawal_requests` with `status: 'pending'`. No payout occurs here.
- Only `POST /api/admin/withdrawals/:id/approve` triggers money movement, behind
  `authenticateAdmin`, and it refuses anything not `pending`.
- Validations on request: minimum ₹500, balance sufficiency, and UPI/fund-account
  present.

### 2.2 Does money actually move? — **Yes** ✅

Unlike refunds, this path is real. `RazorpayXService.createPayout` performs a live
`POST /v1/payouts` against `api.razorpay.com` with `mode: 'IMPS'`, the partner's
fund account, and `queue_if_low_balance: true`. `syncEmployeeForPayouts` lazily
creates the RazorpayX Contact and Fund Account (bank account or VPA) first.

The wallet is debited at **request** time, not approval — correct, since it
prevents the partner spending the same balance twice while approval is pending.

Failure handling is also correct: an immediate payout error marks the request
`failed` and credits the balance back with a `refund` ledger entry.

### 2.3 Problems found

**A. Status never reaches `completed`** · HIGH
Approval sets `status: 'processing'`. Only the RazorpayX webhook
(`payout.processed`) promotes it to `completed`. **That webhook is currently
returning 401**, so every successful payout is stuck showing `processing`
indefinitely, and an admin cannot tell a paid partner from an unpaid one.

The same broken webhook handles `payout.failed` / `payout.reversed`, which is what
returns money to the partner's wallet on a reversal. **A reversed payout currently
leaves the partner out of pocket** — the funds left their wallet, the payout came
back, and nothing credits them. Unlike QR, this path has **no polling fallback**.

**B. Double-payout race** · HIGH
Approval is guarded only by a read-then-write:

```js
const [withdrawal] = await db.select()...            // reads 'pending'
if (withdrawal.status !== 'pending') return ...      // passes
await RazorpayXService.createPayout(...)             // real money leaves
await db.update(withdrawalRequests).set({ status: 'processing' })
```

There is no row lock, no transaction, and no idempotency key on the Razorpay call
(`reference_id` is not an idempotency key — RazorpayX uses the
`X-Payout-Idempotency` header). Two concurrent approvals — a double-click, or two
admins — can both read `pending` and both issue a real payout. **The partner is
paid twice and the wallet is debited once.**

**C. Request creation is not atomic** · MEDIUM
`POST /api/partner/wallet/withdraw` performs three separate writes with no
transaction: insert ledger row → insert withdrawal request → update wallet
balance. A failure between them leaves the wallet debited with no request, or a
request with an undebited wallet.

**D. Reject silently skips the refund if no wallet row** · LOW
`if (wallet) { ...credit back... }` — the request is marked `rejected` either way.
With no wallet row the partner's money is simply not returned.

**E. Minimum withdrawal is hardcoded** · LOW
`const minRedemption = 500; // From platform config` — the comment says config,
the code does not read it.

### 2.4 Withdrawal summary

| Question | Answer |
|---|---|
| Admin approval enforced? | **Yes** ✅ |
| Real RazorpayX payout fired? | **Yes** ✅ |
| Wallet debited correctly? | **Yes**, at request time ✅ |
| Immediate-failure refund? | **Yes** ✅ |
| Status reaches `completed`? | **No** — webhook 401 |
| Reversed payout refunded? | **No** — webhook 401, no fallback |
| Safe against double approval? | **No** — race, real double payout |

---

## Recommended order of fixes

| # | Fix | Why first |
|---|---|---|
| 1 | Fix `RAZORPAY_WEBHOOK_SECRET` | Unblocks payout completion *and* reversal refunds. No code change. |
| 2 | Row-lock withdrawal approval (`SELECT … FOR UPDATE` in a transaction) + RazorpayX idempotency header | Prevents paying a partner twice |
| 3 | Fix `refundBookingCharge` lookup, and make it throw rather than return null | Stops silently lying about refunds |
| 4 | Stop hardcoding `bookingFeeStatus: 'refunded'` and `refundInitiated: true` — set them from the actual result | Makes failures visible |
| 5 | Honour `refundAmount` in dispute resolution; add final-payment refunds | Disputes over real money currently cannot be settled |
| 6 | Wrap withdrawal request creation in a transaction | Removes partial-write states |
| 7 | Add a payout-status polling fallback mirroring the QR one | Removes the webhook single point of failure |

### Reconciliation needed

Because refunds silently no-op, any booking with `bookingFeeStatus = 'refunded'`
should be treated as **unverified**. Cross-check the Razorpay dashboard for actual
refunds against those bookings before trusting the flag.

Both databases were reset on 2026-07-28, so the current exposure is limited to
test traffic — the pre-reset snapshot is at `prod-snapshot-before-reset.json` if
historical reconciliation is needed.
