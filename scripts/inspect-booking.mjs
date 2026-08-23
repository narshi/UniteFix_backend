/**
 * Explain the amount shown against a service request.
 *
 *   npm run inspect:booking                 -- the 10 most recent bookings
 *   npm run inspect:booking UF-1234         -- by service id, or numeric id
 *   npm run inspect:booking 6360743483      -- every booking for a phone number
 *
 * Answers the question "why does an unfulfilled job show a price?" by printing
 * where each number comes from: the stored total, the booking fee, and the
 * frozen pricing snapshot. Read-only — it writes nothing.
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const url = process.env.RENDER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
    console.error('FAILED: set DATABASE_URL (or RENDER_DATABASE_URL) first.');
    process.exit(1);
}
const needsSsl = !/localhost|127\.0\.0\.1/.test(url) && !/sslmode=disable/.test(url);
const pool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 30000,
});

const rupees = (v) => (v == null ? '—' : `₹${Number(v)}`);
const target = process.argv[2];

try {
    const { rows } = await pool.query(
        `SELECT sr.id, sr.service_id, sr.service_type, sr.status,
                sr.booking_fee, sr.booking_fee_status,
                sr.total_amount, sr.commission_amount,
                sr.catalog_service_id, s.name AS catalog_name, s.base_price,
                sr.pricing_snapshot, sr.created_at,
                u.phone AS customer_phone, u.username AS customer_name,
                (SELECT COUNT(*) FROM payment_transactions pt
                  WHERE pt.service_request_id = sr.id AND pt.status = 'captured')::int AS captured_payments,
                (SELECT COUNT(*) FROM payment_transactions pt
                  WHERE pt.service_request_id = sr.id)::int AS payment_rows
         FROM service_requests sr
         LEFT JOIN services s ON s.id = sr.catalog_service_id
         LEFT JOIN users u ON u.id = sr.user_id
         ${target ? "WHERE sr.service_id = $1 OR sr.id::text = $1 OR u.phone = $1 OR u.phone LIKE '%' || $1" : ''}
         ORDER BY sr.created_at DESC
         LIMIT ${target ? 20 : 10}`,
        target ? [target] : [],
    );

    if (!rows.length) {
        console.log(target ? `No booking matching "${target}".` : 'No bookings yet.');
        process.exit(0);
    }

    for (const r of rows) {
        const snap = r.pricing_snapshot || {};
        const shown = r.total_amount ?? r.booking_fee;

        console.log(`\n─ ${r.service_id}  (#${r.id})  ${r.status}`);
        console.log(`  ${r.service_type}`);
        console.log(`  customer                    : ${r.customer_name ?? '—'}  ${r.customer_phone ?? ''}`);
        console.log(`  created                     : ${new Date(r.created_at).toLocaleString()}`);

        /**
         * Was money actually taken? The old code marked a booking PAID when
         * Razorpay was unavailable, so "paid" alone proves nothing.
         */
        const feePaid = r.booking_fee_status === 'paid';
        if (feePaid && r.captured_payments === 0) {
            console.log(`  !! marked PAID with no captured payment — the old Razorpay bypass`);
            console.log(`     (${r.payment_rows} payment row(s) in total, none captured)`);
        } else if (feePaid) {
            console.log(`  payment evidence            : ${r.captured_payments} captured transaction(s)`);
        }

        // What the cancel endpoint would do with this row.
        if (r.status !== 'created') {
            console.log(`  cancel would                : refuse — only a 'created' booking is cancellable by the customer`);
        } else if (r.booking_fee_status === 'pending') {
            console.log(`  cancel would                : hard-delete it (unpaid)`);
            console.log(`  visible to the customer     : NO — hidden as an abandoned draft, and swept after 30 min`);
        } else {
            console.log(`  cancel would                : mark cancelled, and attempt a refund`);
            console.log(`  visible to the customer     : YES — it counts as a paid, active booking`);
        }
        console.log(`  admin "Amount" column shows : ${rupees(shown)}`);
        console.log(`    total_amount              : ${rupees(r.total_amount)}${r.total_amount == null ? '   <- null, so the column falls back to the booking fee' : ''}`);
        console.log(`    booking_fee               : ${rupees(r.booking_fee)} (${r.booking_fee_status})`);
        console.log(`    commission_amount         : ${rupees(r.commission_amount)}`);

        if (r.catalog_service_id) {
            console.log(`  catalog service             : ${r.catalog_name} @ ${rupees(r.base_price)}`);
            console.log(`    -> fixed-price booking: the whole bill is frozen at CREATION,`);
            console.log(`       so the price appears before the work is done. By design.`);
        } else {
            console.log(`  catalog service             : none (technician-billed)`);
            console.log(`    -> no price until the expert submits the bill, so the column`);
            console.log(`       is showing the BOOKING FEE, not the cost of the job.`);
        }

        if (snap.snapshotVersion) {
            console.log(`  frozen snapshot (v${snap.snapshotVersion})`);
            console.log(`    listPrice ${rupees(snap.listPrice)}  discount ${rupees(snap.discountAmount)} (${snap.discountPercent ?? 0}%${snap.discountLabel ? ' — ' + snap.discountLabel : ''})`);
            console.log(`    customer pays ${rupees(snap.basePrice ?? snap.grossTotal)}   gst ${rupees(snap.gst ?? (snap.cgst ?? 0) + (snap.sgst ?? 0))}   platform ${rupees(snap.platformFee)}   expert ${rupees(snap.technicianEarning ?? snap.employeeEarnings)}`);
            console.log(`    due after booking fee ${rupees(snap.finalTotal)}`);
        } else {
            console.log(`  frozen snapshot             : none`);
        }
    }

    // The figure that actually counts as money in.
    const { rows: [rev] } = await pool.query(
        `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(total_amount), 0) AS billed FROM invoices`,
    );
    console.log(`\nInvoiced to date: ${rev.invoices} invoice(s), ${rupees(rev.billed)}.`);
    console.log('Only invoices count as revenue — a quoted booking never does.\n');
} catch (error) {
    console.error(`FAILED: ${error.message}`);
    process.exitCode = 1;
} finally {
    await pool.end();
}
