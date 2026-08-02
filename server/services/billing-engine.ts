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
  basePrice?: number;          // ₹799 — the customer's all-in, GST-inclusive price P
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

    return {
      bookingFee: Math.round(parseFloat(bookingFeeStr || '99')),
      platformFeePercent: parseFloat(feePercentStr || '12'),
      gstPercent: parseFloat(gstPercentStr || '18'),
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

    const bookingFee = Math.round(parseFloat(bookingFeeStr || '99'));
    const platformFeePercent = parseFloat(feePercentStr || '12');
    const gstPercent = parseFloat(gstPercentStr || '18');

    const P = Math.round(basePrice);
    const gst = round2(P * gstPercent / 100);
    const platformFee = round2(P * platformFeePercent / 100);
    const cgst = round2(gst / 2);
    const sgst = round2(gst - cgst);
    const serviceValue = round2(P - gst - platformFee);          // 0.70P — customer's service line
    const technicianEarning = round2(serviceValue - bookingFee); // 0.70P − 99
    const taxableAmount = round2(serviceValue + platformFee);    // = P − gst
    const finalTotal = P - bookingFee;                            // customer pays after the booking fee

    const now = new Date().toISOString();
    return {
      bookingFee,
      platformFeePercent,
      gstPercent,
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

    const subtotal = Math.round(sparePartsCost + serviceLaborCost);
    const platformFee = Math.round(subtotal * platformFeePercent / 100);
    const taxableAmount = subtotal + platformFee;
    const totalGst = Math.round(taxableAmount * gstPercent / 100);
    const cgst = Math.round(totalGst / 2);
    const sgst = totalGst - cgst; // Remainder to avoid rounding loss
    const grossTotal = taxableAmount + totalGst;
    const bookingFeeCredit = bookingFee;
    const finalTotal = Math.max(0, grossTotal - bookingFeeCredit);

    return {
      // Preserved from booking creation
      bookingFee,
      platformFeePercent,
      gstPercent,
      snapshotVersion: existingSnapshot.snapshotVersion,
      createdAt: existingSnapshot.createdAt,

      // Frozen at bill submission
      sparePartsCost: Math.round(sparePartsCost),
      serviceLaborCost: Math.round(serviceLaborCost),
      subtotal,
      platformFee,
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
