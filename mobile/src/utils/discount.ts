/**
 * Applying the platform discount to a catalog price, in one place.
 *
 * The app quotes the customer from the catalog's list price, but the server
 * bills from the pricing snapshot — which has the discount carved in. Without
 * this the booking screen said "₹799" and the card was charged ₹719: a pleasant
 * surprise, but a quote that does not match the charge is a support ticket
 * waiting to happen, and it would read as a bug the first time it went the
 * other way.
 *
 * The rounding here mirrors BillingEngine.createCatalogSnapshot exactly — the
 * customer-facing total is a whole rupee — so the figure shown before booking
 * is the figure that gets charged.
 */

export interface DiscountInfo {
    /** Catalog price before any discount. */
    listPrice: number;
    /** What the customer actually pays, all in. */
    payable: number;
    /** listPrice − payable. Zero when no discount is running. */
    saving: number;
    percent: number;
    /** Why, e.g. "Monsoon Offer". Empty when the admin has not given a reason. */
    label: string;
    /** Convenience: is there anything to show? */
    active: boolean;
}

export function applyDiscount(
    listPrice: number | null | undefined,
    config?: { discountPercent?: number; discountLabel?: string } | null,
): DiscountInfo {
    const list = Math.round(Number(listPrice) || 0);
    const percent = Math.min(100, Math.max(0, Number(config?.discountPercent) || 0));
    const label = String(config?.discountLabel ?? '').trim().slice(0, 40);

    if (list <= 0 || percent <= 0) {
        return { listPrice: list, payable: list, saving: 0, percent: 0, label: '', active: false };
    }

    // Same rounding as the server: whole rupees for the customer-facing total.
    const payable = Math.round(list - Math.round(list * percent) / 100);

    return {
        listPrice: list,
        payable,
        saving: list - payable,
        percent,
        label,
        active: list - payable > 0,
    };
}
