/**
 * BILLING ENGINE — Single Source of Truth for ALL Financial Calculations
 * 
 * RULES:
 * 1. ALL billing math flows through this file. No exceptions.
 * 2. No other file may contain billing formulas.
 * 3. Amounts are in whole Rupees (integer). Paise conversion is ONLY at Razorpay boundary.
 * 4. Snapshot is frozen at two lifecycle points:
 *    - Booking creation: freezes bookingFee, platformFeePercent, gstPercent
 *    - Bill submission: freezes full billing math using ALREADY-FROZEN rates
 * 5. Once written, snapshot values are NEVER recalculated.
 */

import { configService } from './config.service';

// ─── Types ──────────────────────────────────────────────────────────

export interface PricingSnapshot {
  // Frozen at booking creation
  bookingFee: number;         // ₹99 — what customer pays upfront
  platformFeePercent: number; // 15 — from config at creation time
  gstPercent: number;         // 18 — from config at creation time
  discountPercent: number;    // 0  — promotional discount, frozen like the rates above
  /**
   * Why the discount was given ("Monsoon Offer"). Frozen with the percentage
   * for the same reason: an invoice reprinted next year has to name the offer
   * that actually applied, not whatever promotion is running when it is opened.
   */
  discountLabel?: string;

  // Frozen at bill submission (by employee)
  sparePartsCost?: number;    // ₹500 — entered by technician
  serviceLaborCost?: number;  // ₹300 — entered by technician
  subtotal?: number;          // ₹800 — parts + labor
  platformFee?: number;       // ₹120 — subtotal × platformFeePercent%
  taxableAmount?: number;     // ₹920 — subtotal + platformFee
  cgst?: number;              // ₹83  — taxableAmount × (gstPercent/2)%
  sgst?: number;              // ₹83  — taxableAmount × (gstPercent/2)%
  grossTotal?: number;        // ₹1086 — taxableAmount + cgst + sgst
  bookingFeeCredit?: number;  // ₹99  — already paid, subtracted from due
  finalTotal?: number;        // ₹987 — grossTotal - bookingFeeCredit (customer pays this)
  employeeEarnings?: number;  // ₹800 — subtotal (employee keeps parts + labor)

  // ── v2 (fixed-price catalog) — frozen at booking creation ──────────
  // In v2 the whole bill is known up front from the service's catalog price,
  // so there is no separate bill-submission step. GST, fee and the booking
  // charge are carved OUT of basePrice (they are NOT added on top).
  listPrice?: number;          // ₹799 — catalog price BEFORE discount (the "was" price)
  discountAmount?: number;     // ₹79.90 — listPrice × discountPercent%
  /**
   * True when the discount exceeded the platform fee, i.e. UniteFix is paying
   * to do the job. Never hidden: a loss-leader can be a deliberate choice, but
   * it must be a visible one.
   */
  platformSubsidised?: boolean;
  basePrice?: number;          // ₹719.10 — what the customer actually pays, all-in
  gst?: number;                // ₹143.82 — cgst + sgst (= P × gstPercent%)
  technicianEarning?: number;  // ₹460.30 — P − gst − platformFee − bookingCharge
  extraPartsCost?: number;     // customer-approved parts add-on (pass-through to technician)
  partsNote?: string;          // what the extra parts were for

  // Metadata
  snapshotVersion: number;    // 1 = technician-billed · 2 = fixed-price catalog
  createdAt: string;          // ISO timestamp of snapshot creation
  billedAt?: string;          // ISO timestamp of bill submission
}

/** Round to 2 decimals (paise). v2 keeps paise so earnings match the catalog exactly. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Trim and cap the reason so it cannot overflow the invoice or a price card. */
function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * A discount is a percentage, and nothing else. A NaN from a malformed config
 * value would otherwise propagate silently through every downstream figure and
 * end up on a customer's invoice.
 */
function clampPercent(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

// ─── Engine ─────────────────────────────────────────────────────────

export class BillingEngine {

  /**
   * Phase 1 of snapshot: Called at booking creation.
   * Reads current config values and freezes them into the snapshot.
   * Future config changes will NOT affect this booking.
   */
  static async createBookingSnapshot(): Promise<PricingSnapshot> {
    const bookingFeeStr = await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');
    const feePercentStr = await configService.get<string>('BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT');
    const gstPercentStr = await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE');
    const discountStr = await configService.get<string>('BUSINESS_CONFIG.DISCOUNT_PERCENT');
    const discountLabelStr = await configService.get<string>('BUSINESS_CONFIG.DISCOUNT_LABEL');

    return {
      bookingFee: Math.round(parseFloat(bookingFeeStr || '99')),
      platformFeePercent: parseFloat(feePercentStr || '12'),
      gstPercent: parseFloat(gstPercentStr || '18'),
      // Frozen here for the same reason as the rates: ending a promotion must
      // not change the bill of a booking taken while it was running.
      discountPercent: clampPercent(parseFloat(discountStr || '0')),
      discountLabel: clampPercent(parseFloat(discountStr || '0')) > 0 ? cleanLabel(discountLabelStr) : '',
      snapshotVersion: 1,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * v2 — Fixed-price catalog snapshot. Called at BOOKING CREATION when the
   * customer picks a catalog service with a set price. The full bill is frozen
   * immediately; there is no later bill-submission step.
   *
   * Formula (matches CATALOG-1.xlsx exactly), given catalog price P:
   *   gst              = round2(P × gstPercent/100)     -- carved out of P
   *   platformFee      = round2(P × feePercent/100)     -- carved out of P
   *   bookingCharge    = bookingFee (₹99)               -- part of P, prepaid
   *   serviceValue     = round2(P − gst − platformFee)  -- = 0.70P
   *   technicianEarning= round2(serviceValue − bookingCharge)
   *   finalTotal       = P − bookingCharge              -- customer pays after booking
   *
   * The four buckets (gst + platformFee + bookingCharge + technicianEarning)
   * sum back to P. Verified: 799 → 143.82 + 95.88 + 99 + 460.30.
   */
  static async createCatalogSnapshot(basePrice: number): Promise<PricingSnapshot> {
    const bookingFeeStr = await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');
    const feePercentStr = await configService.get<string>('BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT');
    const gstPercentStr = await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE');
    const discountStr = await configService.get<string>('BUSINESS_CONFIG.DISCOUNT_PERCENT');

    const bookingFee = Math.round(parseFloat(bookingFeeStr || '99'));
    const platformFeePercent = parseFloat(feePercentStr || '12');
    const gstPercent = parseFloat(gstPercentStr || '18');
    const discountLabelStr = await configService.get<string>('BUSINESS_CONFIG.DISCOUNT_LABEL');
    const discountPercent = clampPercent(parseFloat(discountStr || '0'));
    // Only when a discount is actually being given. Freezing "Monsoon Offer"
    // onto a booking that got 0% would put a reason on an invoice that shows no
    // discount, and would make the app and the bill disagree about whether an
    // offer applied.
    const discountLabel = discountPercent > 0 ? cleanLabel(discountLabelStr) : '';

    const listPrice = Math.round(basePrice);

    // The technician's earning is computed from the UNDISCOUNTED price and then
    // held there. A promotion is a decision the business makes; making the
    // technician fund it is how you lose the technician. Same reasoning as the
    // platform fee being the thing that flexes.
    // Tax-INCLUSIVE extraction: r/(100+r), not r/100.
    //
    // The catalog price already contains the GST — the header above says so, and
    // the buckets are carved OUT of it rather than added on top. Taking 18% OF
    // the gross therefore over-declared the tax: on ₹799 it set aside ₹143.82,
    // leaving a taxable value of ₹655.18, which implies a rate of 21.95% and not
    // 18%. The correct extraction is ₹121.88 on a taxable ₹677.12.
    const gstOnList = round2(listPrice * gstPercent / (100 + gstPercent));
    const feeOnList = round2(listPrice * platformFeePercent / 100);
    const technicianEarning = round2(listPrice - gstOnList - feeOnList - bookingFee);

    // The customer-facing total stays a WHOLE RUPEE, as it was before discounts
    // existed — service_requests.total_amount is an integer column, and a price
    // of "₹719.10" on a catalog listing reads like a rounding error anyway. The
    // paise settle in platformFee, which is already the balancing bucket.
    const P = Math.round(listPrice - round2(listPrice * discountPercent / 100));
    const discountAmount = round2(listPrice - P);   // exact, so the two reconcile

    // GST follows the real transaction value, not the list price — the discount
    // is given at the time of supply and shown on the invoice, so tax is due on
    // the reduced amount. Extracted from the inclusive figure, as above.
    const gst = round2(P * gstPercent / (100 + gstPercent));
    const cgst = round2(gst / 2);
    const sgst = round2(gst - cgst);

    // Whatever is left after tax, the booking charge and the technician is the
    // platform's. It shrinks by the discount less the tax saved, and it can go
    // negative — that is a real loss-leader, flagged rather than hidden.
    const platformFee = round2(P - gst - bookingFee - technicianEarning);
    const platformSubsidised = platformFee < 0;

    const serviceValue = round2(P - gst - platformFee);          // = technician + booking charge
    const taxableAmount = round2(P - gst);
    const finalTotal = Math.max(0, round2(P - bookingFee));       // customer pays after the booking fee

    const now = new Date().toISOString();
    return {
      bookingFee,
      platformFeePercent,
      gstPercent,
      discountPercent,
      discountLabel,
      listPrice,
      discountAmount,
      platformSubsidised,
      basePrice: P,

      // Mapped so the existing invoice generator & payment paths work unchanged:
      sparePartsCost: 0,
      serviceLaborCost: serviceValue,
      subtotal: serviceValue,
      platformFee,
      taxableAmount,
      gst,
      cgst,
      sgst,
      grossTotal: P,
      bookingFeeCredit: bookingFee,
      finalTotal,

      technicianEarning,
      employeeEarnings: technicianEarning, // v2 wallet credit uses the real earning

      snapshotVersion: 2,
      createdAt: now,
      billedAt: now, // v2 is fully billed at creation
    };
  }

  /**
   * Phase 2 of snapshot: Called at bill submission.
   * Uses the FROZEN rates from the existing booking snapshot.
   * 
   * Formula (deterministic, all Math.round for whole Rupees):
   *   subtotal = sparePartsCost + serviceLaborCost
   *   platformFee = round(subtotal × platformFeePercent / 100)
   *   taxableAmount = subtotal + platformFee
   *   totalGst = round(taxableAmount × gstPercent / 100)
   *   cgst = round(totalGst / 2)
   *   sgst = totalGst - cgst   (remainder avoids rounding loss)
   *   grossTotal = taxableAmount + totalGst
   *   finalTotal = max(0, grossTotal - bookingFeeCredit)
   *   employeeEarnings = subtotal
   */
  static calculateFinalBill(
    sparePartsCost: number,
    serviceLaborCost: number,
    existingSnapshot: PricingSnapshot
  ): PricingSnapshot {
    const { bookingFee, platformFeePercent, gstPercent } = existingSnapshot;
    // Frozen at booking creation. Older snapshots predate the field entirely,
    // so they read as 0 and bill exactly as they always did.
    const discountPercent = clampPercent(Number(existingSnapshot.discountPercent ?? 0));

    const subtotal = Math.round(sparePartsCost + serviceLaborCost);
    const platformFee = Math.round(subtotal * platformFeePercent / 100);

    // Discount comes off the pre-tax value, so GST is charged on what the
    // customer actually pays. The technician's earning is the subtotal and is
    // untouched by it.
    const grossOfDiscount = subtotal + platformFee;
    const discountAmount = Math.round(grossOfDiscount * discountPercent / 100);
    const taxableAmount = grossOfDiscount - discountAmount;

    const totalGst = Math.round(taxableAmount * gstPercent / 100);
    const cgst = Math.round(totalGst / 2);
    const sgst = totalGst - cgst; // Remainder to avoid rounding loss
    const grossTotal = taxableAmount + totalGst;
    const bookingFeeCredit = bookingFee;
    const finalTotal = Math.max(0, grossTotal - bookingFeeCredit);
    const platformSubsidised = discountAmount > platformFee;

    return {
      // Preserved from booking creation
      bookingFee,
      platformFeePercent,
      gstPercent,
      discountPercent,
      discountLabel: discountPercent > 0 ? cleanLabel(existingSnapshot.discountLabel) : '',
      snapshotVersion: existingSnapshot.snapshotVersion,
      createdAt: existingSnapshot.createdAt,

      // Frozen at bill submission
      sparePartsCost: Math.round(sparePartsCost),
      serviceLaborCost: Math.round(serviceLaborCost),
      subtotal,
      platformFee,
      discountAmount,
      platformSubsidised,
      taxableAmount,
      cgst,
      sgst,
      grossTotal,
      bookingFeeCredit,
      finalTotal,
      employeeEarnings: subtotal,
      billedAt: new Date().toISOString(),
    };
  }

  /**
   * Preview billing calculation for live display (SubmitBillScreen).
   * Uses frozen rates from booking snapshot but does NOT persist.
   */
  static previewBill(
    sparePartsCost: number,
    serviceLaborCost: number,
    existingSnapshot: PricingSnapshot
  ): PricingSnapshot {
    // Same math as calculateFinalBill, just not persisted
    return this.calculateFinalBill(sparePartsCost, serviceLaborCost, existingSnapshot);
  }

  /**
   * Calculate the amount to DEBIT from employee wallet when customer pays cash.
   * This is UniteFix's share: platformFee + CGST + SGST.
   * Employee collected the full amount in cash — we recover our cut from their wallet.
   */
  static calculateCashDebitAmount(snapshot: PricingSnapshot): number {
    const platformFee = snapshot.platformFee ?? 0;
    const cgst = snapshot.cgst ?? 0;
    const sgst = snapshot.sgst ?? 0;
    return platformFee + cgst + sgst;
  }

  /**
   * Determine service value tier based on the final bill amount.
   * high_value = ₹5,000+ (subtotal, i.e. parts + labor before fees/tax)
   */
  static determineServiceValueTier(snapshot: PricingSnapshot): 'standard' | 'high_value' {
    const subtotal = snapshot.subtotal ?? 0;
    return subtotal >= 5000 ? 'high_value' : 'standard';
  }

  /**
   * Build a synthetic snapshot for OLD bookings that don't have one.
   * Uses the values already stored on the booking record.
   * NEVER recalculates — just wraps existing data.
   */
  static buildLegacySnapshot(booking: {
    bookingFee: number | null;
    totalAmount: number | null;
    commissionAmount: number | null;
  }): PricingSnapshot {
    const bookingFee = booking.bookingFee ?? 99;
    const totalAmount = booking.totalAmount ?? 0;
    const commissionAmount = booking.commissionAmount ?? 0;

    // Reverse-engineer from stored values (best effort for legacy)
    // totalAmount = grossTotal, commissionAmount = platformFee
    const grossTotal = totalAmount;
    const platformFee = commissionAmount;
    const totalGst = grossTotal > 0 ? Math.round(grossTotal - grossTotal / 1.18) : 0;
    const taxableAmount = grossTotal - totalGst;
    const subtotal = taxableAmount - platformFee;

    return {
      bookingFee,
      platformFeePercent: 15,
      gstPercent: 18,
      // Legacy bookings predate discounts entirely; reverse-engineering one
      // from stored totals would be a guess, and a guess on a historical
      // invoice is worse than the absence of a discount line.
      discountPercent: 0,
      subtotal: Math.max(0, subtotal),
      platformFee,
      taxableAmount,
      cgst: Math.round(totalGst / 2),
      sgst: totalGst - Math.round(totalGst / 2),
      grossTotal,
      bookingFeeCredit: bookingFee,
      finalTotal: Math.max(0, grossTotal - bookingFee),
      employeeEarnings: Math.max(0, subtotal),
      snapshotVersion: 0, // 0 = legacy/synthetic
      createdAt: new Date().toISOString(),
    };
  }
}
