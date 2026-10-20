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

import { db } from '../db';
import { eq } from 'drizzle-orm';
import { serviceCategories, services } from '@shared/schema';
import { configService } from './config.service';

// ─── Types ──────────────────────────────────────────────────────────

export interface PricingSnapshot {
  // Frozen at booking creation
  bookingFee: number;         // ₹99 — customer's ADVANCE, paid upfront, credited against the total
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
  // so there is no separate bill-submission step. GST and the platform fee are
  // carved OUT of basePrice (they are NOT added on top). The booking fee is not
  // a bucket at all: it is the customer's advance towards basePrice.
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
  technicianEarning?: number;  // ₹581.24 — P − gst − platformFee (the booking fee is NOT taken from it)
  extraPartsCost?: number;     // parts the TECHNICIAN bought — passes through to them
  partsNote?: string;          // what the extra parts were for
  /**
   * Parts UniteFix supplied from its own stock, billed to the customer at the
   * catalogue price. NOT technician earning — we do not pay a technician for
   * our own capacitor. Carried separately so the settlement and the receipt
   * both know whose sale it was.
   */
  platformPartsCost?: number;
  /**
   * Partner Hub phase 4: a job routed to a partner territory. The partner is
   * the payee for technicianEarning (booked to its ledger, not a wallet).
   */
  /**
   * The category's booking fee is 0, so the customer pays the whole price when
   * booking (prepaidAmount) and nothing after the service unless parts are added.
   * bookingFee stays 0: no booking charge is carved out of the technician's share.
   */
  prepaid?: boolean;
  /**
   * 'advance' on catalog snapshots made since the booking fee became the
   * customer's advance towards the price (technicianEarning = P − gst − fee).
   * Absent on older v2 snapshots, where the ₹99 was UniteFix's and was taken
   * out of the technician's share — kept as they were frozen.
   */
  bookingFeeModel?: 'advance';
  prepaidAmount?: number;
  payeeType?: 'partner' | 'technician';
  payeePartnerId?: number;
  servicedBy?: string;
  nationalUnitPrice?: number;
  /**
   * GST on the parts (v2). The service price carves its GST out of P; parts
   * are added on top of P, so their tax is added on top too — a catalogue part
   * at its own rate, a local purchase at the booking's service rate. Absent on
   * snapshots billed before parts were taxed; those invoices print as they did.
   */
  partsTaxable?: number;       // extraPartsCost + platformPartsCost
  partsGst?: number;           // partsCgst + partsSgst
  partsCgst?: number;
  partsSgst?: number;

  /**
   * How the listPrice was arrived at: unitPrice x quantity.
   *
   * METADATA ONLY — nothing here is an input to the arithmetic. The caller
   * multiplies before calling, so every bucket below already scales correctly
   * and this exists so the invoice can print "2 x Rs.499" instead of one opaque
   * line, and so a reprint years later still shows the rate that applied.
   */
  unitPrice?: number;
  quantity?: number;

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
  /**
   * The booking fee for a category: its own fee if the admin set one, else the
   * platform-wide BASE_SERVICE_FEE. The ONE place this is decided — booking
   * creation, the public catalogue and the admin guard all ask here, so the
   * number the app quotes is the number the server charges.
   */
  static async resolveBookingFee(categoryId: number | null | undefined): Promise<number> {
    if (categoryId) {
      const [cat] = await db.select({ fee: serviceCategories.bookingFee })
        .from(serviceCategories).where(eq(serviceCategories.id, categoryId)).limit(1);
      if (cat && cat.fee !== null && cat.fee !== undefined && Number.isFinite(Number(cat.fee))) {
        return Math.max(0, Math.round(Number(cat.fee)));
      }
    }
    return this.defaultBookingFee();
  }

  /** The platform-wide fee, for categories that do not set their own. */
  static async defaultBookingFee(): Promise<number> {
    const str = await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');
    return Math.max(0, Math.round(parseFloat(str || '99')));
  }

  /** The catalogue category of a catalogue service, or null. */
  static async categoryOfService(catalogServiceId: number | null | undefined): Promise<number | null> {
    if (!catalogServiceId) return null;
    const [svc] = await db.select({ categoryId: services.categoryId })
      .from(services).where(eq(services.id, catalogServiceId)).limit(1);
    return svc?.categoryId ?? null;
  }

  /**
   * A fixed-price booking in a category with a 0 booking fee is paid in full
   * when booking. Only a priced (v2) booking can be: an unpriced one has no
   * amount to charge, so it stays a free booking paid after the service.
   */
  static applyPrepay(s: PricingSnapshot): PricingSnapshot {
    if (s.snapshotVersion !== 2 || s.bookingFee !== 0) return s;
    const amount = Math.round((s.grossTotal ?? 0) * 100) / 100;
    if (!(amount > 0)) return s;
    return { ...s, prepaid: true, prepaidAmount: amount, bookingFeeCredit: amount, finalTotal: 0 };
  }

  /** What the customer pays when booking, in rupees: the full price if prepaid, else the booking fee. */
  static amountDueAtBooking(s: PricingSnapshot | null | undefined, fallbackFee = 0): number {
    if (s?.prepaid) return Number(s.prepaidAmount ?? 0);
    return Number(s?.bookingFee ?? fallbackFee);
  }

  static async createBookingSnapshot(opts: { bookingFee?: number } = {}): Promise<PricingSnapshot> {
    const bookingFeeStr = opts.bookingFee !== undefined ? String(opts.bookingFee) : await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');
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
   * Formula, given catalog price P (GST-inclusive):
   *   gst               = round2(P × gst%/(100 + gst%))  -- carved out of P
   *   platformFee       = round2(P × fee%/100)           -- carved out of P
   *   technicianEarning = round2(P − gst − platformFee)  -- the technician's full share
   *
   * THE BOOKING FEE IS THE CUSTOMER'S ADVANCE, NOT A DEDUCTION. The customer
   * pays bookingFee (₹99) when booking and finalTotal = P − bookingFee after
   * the service; the ₹99 is credit towards P, and none of it comes out of the
   * technician's share. Three buckets sum back to P:
   *   gst + platformFee + technicianEarning = P
   * Verified: 799 → 121.88 + 95.88 + 581.24 (customer: 99 now + 700 after).
   */
/**
   * A catalog booking for N units — 2 ACs, 4 CCTV cameras, 3 fan points.
   *
   * Deliberately a WRAPPER rather than a quantity parameter on
   * createCatalogSnapshot. That function takes one number and carves GST, the
   * platform fee, the discount and the technician's earning out of it; feeding
   * it a total that is already unitPrice x quantity makes every one of those
   * buckets scale correctly with no change to the arithmetic at all. Putting a
   * multiplication inside it would add a second way to get the money wrong in
   * the one function that must never be wrong.
   *
   * unitPrice and quantity ride along as frozen metadata so the invoice can
   * itemise "2 x Rs.499" — they are never read back as inputs.
   *
   * NOTE the booking fee does not scale; see createCatalogSnapshot for why.
   */
  static async createCatalogSnapshotForQuantity(
    unitPrice: number,
    quantity: number,
    opts: { bookingFee?: number; platformFeePercent?: number } = {},
  ): Promise<PricingSnapshot> {
    // Clamped to match the CHECK constraint on service_requests.quantity. A
    // snapshot is immutable once written, so a bad quantity reaching here is
    // frozen onto the booking permanently.
    const qty = Math.max(1, Math.min(50, Math.floor(quantity) || 1));
    const snapshot = await this.createCatalogSnapshot(unitPrice * qty, opts);
    return { ...snapshot, unitPrice, quantity: qty };
  }

  static async createCatalogSnapshot(basePrice: number, opts: { bookingFee?: number; platformFeePercent?: number } = {}): Promise<PricingSnapshot> {
    // The category's fee when the caller resolved one; the platform default otherwise.
    const bookingFeeStr = opts.bookingFee !== undefined ? String(opts.bookingFee) : await configService.get<string>('BUSINESS_CONFIG.BASE_SERVICE_FEE');
    const feePercentStr = await configService.get<string>('BUSINESS_CONFIG.UNITEFIX_FEE_PERCENT');
    const gstPercentStr = await configService.get<string>('BUSINESS_CONFIG.GST_PERCENTAGE');
    const discountStr = await configService.get<string>('BUSINESS_CONFIG.DISCOUNT_PERCENT');

    const bookingFee = Math.round(parseFloat(bookingFeeStr || '99'));
    // A partner-territory job carries the partner's fee % (decided at routing).
    const platformFeePercent = opts.platformFeePercent ?? parseFloat(feePercentStr || '12');
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

    // The technician keeps the whole price less tax and the platform fee. The
    // booking fee is the customer's advance towards this same price — it is
    // NOT taken from the technician (it once was; snapshots frozen then keep
    // their old figures). One advance per booking, whatever the quantity.
    const technicianEarning = round2(listPrice - gstOnList - feeOnList);

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

    // Whatever is left after tax and the technician is the platform's
    // (technicianEarning + platformFee + gst = P). It shrinks by the discount
    // less the tax saved, and it can go negative — a real loss-leader, flagged
    // rather than hidden.
    const platformFee = round2(P - gst - technicianEarning);
    const platformSubsidised = platformFee < 0;

    const serviceValue = round2(P - gst - platformFee);          // = technicianEarning
    const taxableAmount = round2(P - gst);
    // The booking fee was the customer's advance; the rest is due after the service.
    const finalTotal = Math.max(0, round2(P - bookingFee));

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
      bookingFeeModel: 'advance',

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
    existingSnapshot: PricingSnapshot,
    /** The part of sparePartsCost that was UniteFix stock; stays out of the earning. */
    platformPartsCost: number = 0,
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
      // The technician keeps parts + labour, minus whatever UniteFix supplied.
      employeeEarnings: Math.max(0, subtotal - Math.round(platformPartsCost)),
      platformPartsCost: Math.round(platformPartsCost),
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
   * GST on the parts lines of a bill, in rupees.
   *
   * Each line is taxed at its own rate: a catalogue part at the rate on its
   * catalogue row, a local purchase at the service rate frozen on the booking.
   * Summed in paise and split into CGST/SGST once, so the halves add back to
   * the whole.
   */
  static partsTax(
    items: Array<{ unitPricePaise: number; quantity: number; gstPercent?: number | null }>,
    defaultGstPercent: number,
  ): { partsTaxable: number; partsGst: number; partsCgst: number; partsSgst: number } {
    let taxablePaise = 0;
    let gstPaise = 0;
    for (const it of items) {
      const line = it.unitPricePaise * it.quantity;
      const rate = it.gstPercent != null && Number.isFinite(Number(it.gstPercent)) ? Number(it.gstPercent) : defaultGstPercent;
      taxablePaise += line;
      gstPaise += Math.round(line * rate / 100);
    }
    const cgstPaise = Math.round(gstPaise / 2);
    const sgstPaise = gstPaise - cgstPaise;
    const r = (p: number) => Math.round(p) / 100;
    return { partsTaxable: r(taxablePaise), partsGst: r(gstPaise), partsCgst: r(cgstPaise), partsSgst: r(sgstPaise) };
  }

  /**
   * When the customer pays the rest in cash: what the technician owes UniteFix
   * (positive → debit their wallet) or UniteFix owes the technician (negative
   * → credit it), so the technician ends with exactly their earning.
   *
   * Catalog (v2) bookings:
   *   net = finalTotal − technicianEarning
   * The technician holds finalTotal in cash and is owed technicianEarning;
   * UniteFix already holds whatever the customer paid online (the ₹99 advance,
   * or the whole price on a prepaid booking). Equivalently, with no parts:
   * (platformFee + gst) − bookingFee. Visiting & inspection at ₹349: cash ₹250,
   * earning ₹253.88 → net −₹3.88, credited to the technician. Parts follow the
   * same rule: their GST and any UniteFix-supplied part are UniteFix's, the
   * technician's own purchases are already in their earning.
   *
   * Bill-submission (v1) bookings keep their own rule: UniteFix's share is
   * platformFee + GST (+ parts GST and UniteFix parts).
   */
  static calculateCashDebitAmount(snapshot: PricingSnapshot): number {
    if (snapshot.snapshotVersion === 2 && snapshot.technicianEarning != null) {
      return Math.round(((snapshot.finalTotal ?? 0) - snapshot.technicianEarning) * 100) / 100;
    }
    const platformFee = snapshot.platformFee ?? 0;
    const cgst = snapshot.cgst ?? 0;
    const sgst = snapshot.sgst ?? 0;
    const partsGst = (snapshot.partsCgst ?? 0) + (snapshot.partsSgst ?? 0);
    const platformParts = snapshot.platformPartsCost ?? 0;
    return Math.round((platformFee + cgst + sgst + partsGst + platformParts) * 100) / 100;
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
