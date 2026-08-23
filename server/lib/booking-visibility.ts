/**
 * What counts as a real booking, for anything an admin looks at.
 *
 * A service request row is written BEFORE the customer pays the booking fee —
 * it has to be, because the Razorpay order is raised against it. If the payment
 * is then abandoned, or the app is killed on the payment sheet, the row stays
 * behind as `status = 'created'` with `booking_fee_status = 'pending'`.
 *
 * Those are abandoned drafts, not work. They should not appear in the dashboard
 * counts, the recent-activity list or the services table, where they read as
 * jobs waiting to be dispatched and inflate every figure they touch.
 *
 * Deliberately narrow: it keys on the fee never having been paid. 'cancelled'
 * is included alongside 'created' because abandoned bookings are now cancelled
 * rather than deleted — without it they would simply move from the customer's
 * active list into their history, which is not an improvement.
 *
 * A fee status of anything other than 'pending' — paid, refunded, waived, or
 * null on an older row — stays visible, as does any booking that reached
 * 'assigned' or beyond. A cancellation AFTER payment is real history and must
 * be kept. Hiding data is easy to get wrong in the direction that loses real
 * work.
 *
 * Nothing is unreachable: the admin services list takes `includeDrafts=true` to
 * show them, which is how you would go looking for abandoned payments.
 */

import { sql } from "drizzle-orm";
import { serviceRequests } from "@shared/schema";

/**
 * COALESCE matters here. booking_fee_status is NULL on rows written before the
 * column existed, and in SQL `NULL = 'pending'` is NULL, not false — so
 * `NOT (created AND NULL)` is NULL, which a WHERE clause discards. Without the
 * coalesce this predicate quietly hid every older created booking, which is the
 * opposite of what it is for.
 */
const IS_ABANDONED_DRAFT = sql`(
    ${serviceRequests.status} IN ('created', 'cancelled')
    AND COALESCE(${serviceRequests.bookingFeeStatus}::text, '') = 'pending'
)`;

/** Excludes abandoned, never-paid drafts. */
export const EXCLUDE_UNPAID_DRAFTS = sql`NOT ${IS_ABANDONED_DRAFT}`;

/** The inverse — only the abandoned drafts, for a clean-up or an audit view. */
export const ONLY_UNPAID_DRAFTS = IS_ABANDONED_DRAFT;
