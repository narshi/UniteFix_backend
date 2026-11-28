/**
 * Store API — catalogue, server cart, checkout with stock holds, my orders.
 * Prices in rupees. The server prices everything; the app only shows it.
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface StoreCategory { id: number; name: string; slug: string; iconUrl: string | null; count: number }

export interface ProductCard {
    id: number; name: string; image: string | null; categoryId: number | null; category: string;
    price: number; mrp: number | null; hasOptions: boolean; inStock: boolean; lowStock: boolean;
    rating: number | null; ratingCount: number; seller: string; soldByUnitefix: boolean;
}
export interface ProductPage { items: ProductCard[]; page: number; limit: number; total: number; hasMore: boolean }

export interface ProductOption { id: number; label: string; attributes: Record<string, string> | null; price: number; mrp: number | null; available: number }
export interface ProductDetail {
    id: number; name: string; description: string | null; category: string; categoryId: number | null; images: string[];
    price: number; mrp: number | null; available: number | null; inStock: boolean; options: ProductOption[];
    specifications: Record<string, string> | null;
    details: { countryOfOrigin: string | null; manufacturer: string | null; netQuantity: string | null; warrantyMonths: number | null; warrantyBy: string | null; bisNumber: string | null; gstPercent: number | null };
    returnPolicy: { returnable: boolean; days: number; text: string };
    installation: { price: number; note: string | null } | null;
    seller: { name: string; legalName: string; gstin: string | null; soldByUnitefix: boolean; address: string | null; grievance: { name: string | null; phone: string | null; email: string | null }; returnPolicy: string | null };
    rating: { average: number; count: number } | null;
    reviews: Array<{ rating: number; review: string | null; sellerReply: string | null; createdAt: string }>;
}

export interface LineIssue { code: string; message: string }
export interface CartLine {
    id: number; productId: number; variantId: number | null; quantity: number; available: number;
    name: string | null; image: string | null; seller: string | null; price: number | null; mrp: number | null; lineTotal: number | null;
    priceChanged: boolean; previousPrice: number | null; issue: LineIssue | null;
}
export interface Cart { lines: CartLine[]; count: number; total: number; tax: number; savings: number; sellers: Array<{ name: string; total: number; items: number }>; canCheckout: boolean }

export interface BuyItem { productId: number; variantId?: number | null; quantity: number }
export type CheckoutSource = { source: 'cart' } | { source: 'buy_now'; items: BuyItem[] };

export interface SummaryLine { kind: string; productId: number; variantId: number | null; name: string; image: string | null; seller: string; quantity: number; price: number; mrp: number | null; total: number; returnWindowDays: number }
export interface CheckoutSummary { total: number; tax: number; savings: number; sellers: Array<{ name: string; total: number; items: number; isUnitefix: boolean }>; lines: SummaryLine[] }
export interface Preview extends CheckoutSummary { stockIssues: string[]; multipleParcels: boolean }

export interface ShipTo { name: string; phone: string; line1: string; line2?: string | null; city: string; pincode: string; stateCode: string }

export interface StartedCheckout extends CheckoutSummary {
    checkoutId: number; status: string; replay: boolean; expiresAt: string | null;
    payment: { provider: 'mock' } | { provider: 'razorpay'; orderId: string; keyId: string | null; amountPaise: number; currency: string; prefill: { name: string | null; contact: string | null } };
}
export interface PayResult { status: 'paid' | 'refund_due'; message: string; orders: Array<{ id: number; code: string }> }
export interface CheckoutStatus { checkoutId: number; status: string; total: number; expiresAt: string | null; failureReason: string | null; orders: Array<{ id: number; code: string }> }

export interface OrderItem { id: number; productId: number; variantId: number | null; kind: string; name: string; image: string | null; quantity: number; price: number; total: number; review: number | null; canReview: boolean }
export interface StoreOrder {
    id: number; code: string; status: string; statusLabel: string; createdAt: string; total: number; tax: number;
    seller: string; soldByUnitefix: boolean;
    shipTo: { name: string | null; phone: string | null; address: string | null; pincode: string | null };
    shipment: {
        courier: string | null; trackingId: string | null; trackingUrl: string | null;
        /** Where the parcel is, from India Post (null for other couriers). */
        status?: string | null; statusLabel?: string | null; updatedAt?: string | null;
        events?: Array<{ at: string; description: string; office: string | null }>;
    } | null;
    dates: { confirmedAt: string | null; dispatchedAt: string | null; deliveredAt: string | null; cancelledAt: string | null };
    refund: { amount: number; status: string | null } | null;
    cancel: { by: string | null; reason: string | null } | null;
    return: { windowDays: number; until: string | null; status: string | null; reason: string | null };
    documents: Array<{ id: number; number: string; kind: string }>;
    canCancel: boolean; canReturn: boolean; hasInvoice: boolean; installationStatus: string | null;
    items: OrderItem[];
    timeline?: Array<{ status: string; label: string; at: string; note: string | null }>;
    grievance?: { name: string | null; phone: string | null; email: string | null };
}

type Ok<T> = { success: true; data: T; message?: string };

// ==================== API ====================

export const shopApi = {
    categories: () => apiClient.get<Ok<StoreCategory[]>>('/api/store/categories').then(r => r.data.data),
    /** The state and city of a pincode, and whether India Post delivers there. */
    pincode: (pin: string) => apiClient.get<Ok<{ known: boolean; deliverable?: boolean; stateCode?: string | null; stateName?: string | null; city?: string | null }>>(`/api/store/pincode/${pin}`).then(r => r.data.data),
    products: (q: { search?: string; categoryId?: number; sort?: string; page?: number; limit?: number }) =>
        apiClient.get<Ok<ProductPage>>('/api/store/products', { params: q }).then(r => r.data.data),
    product: (id: number) => apiClient.get<Ok<ProductDetail>>(`/api/store/products/${id}`).then(r => r.data.data),

    cart: () => apiClient.get<Ok<Cart>>('/api/store/cart').then(r => r.data.data),
    addToCart: (item: BuyItem) => apiClient.post<Ok<Cart>>('/api/store/cart/lines', item).then(r => r.data.data),
    setQuantity: (lineId: number, quantity: number) => apiClient.patch<Ok<Cart>>(`/api/store/cart/lines/${lineId}`, { quantity }).then(r => r.data.data),
    removeLine: (lineId: number) => apiClient.delete<Ok<Cart>>(`/api/store/cart/lines/${lineId}`).then(r => r.data.data),

    preview: (src: CheckoutSource) => apiClient.post<Ok<Preview>>('/api/store/checkout/preview', src).then(r => r.data.data),
    /** idempotencyKey: one per "Place order" attempt; the same on a retry of that attempt. */
    startCheckout: (src: CheckoutSource, shipTo: ShipTo, idempotencyKey: string) =>
        apiClient.post<Ok<StartedCheckout>>('/api/store/checkout', { ...src, shipTo }, { headers: { 'Idempotency-Key': idempotencyKey }, timeout: 30000 }).then(r => r.data.data),
    verify: (checkoutId: number, p: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        apiClient.post<Ok<PayResult>>(`/api/store/checkout/${checkoutId}/verify`, p, { timeout: 30000 }).then(r => r.data.data),
    mockPay: (checkoutId: number) => apiClient.post<Ok<PayResult>>(`/api/store/checkout/${checkoutId}/mock-pay`, {}).then(r => r.data.data),
    abandon: (checkoutId: number) => apiClient.post(`/api/store/checkout/${checkoutId}/abandon`, {}),
    checkoutStatus: (checkoutId: number) => apiClient.get<Ok<CheckoutStatus>>(`/api/store/checkout/${checkoutId}`).then(r => r.data.data),

    orders: (q: { status?: 'open' | 'done' | 'all'; page?: number }) =>
        apiClient.get<Ok<{ items: StoreOrder[]; page: number; hasMore: boolean }>>('/api/store/orders', { params: q }).then(r => r.data.data),
    order: (id: number) => apiClient.get<Ok<StoreOrder>>(`/api/store/orders/${id}`).then(r => r.data.data),
    cancel: (id: number, reason: string) => apiClient.post(`/api/store/orders/${id}/cancel`, { reason }).then(r => r.data),
    requestReturn: (id: number, reason: string) => apiClient.post(`/api/store/orders/${id}/return`, { reason }).then(r => r.data),
    review: (itemId: number, rating: number, review?: string) => apiClient.post(`/api/store/items/${itemId}/review`, { rating, review: review || null }).then(r => r.data),
    /** A short-lived link to open a GST document (invoice, credit note, receipt) in the browser. */
    documentLink: (orderId: number, docId: number) => apiClient.post<Ok<{ url: string }>>(`/api/store/orders/${orderId}/documents/${docId}/link`, {}).then(r => r.data.data.url),
};

/** GST state codes for the delivery address (place of supply). */
export const STATES: Array<{ code: string; name: string }> = [
    ['35', 'Andaman and Nicobar Islands'], ['37', 'Andhra Pradesh'], ['12', 'Arunachal Pradesh'], ['18', 'Assam'], ['10', 'Bihar'],
    ['04', 'Chandigarh'], ['22', 'Chhattisgarh'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['07', 'Delhi'], ['30', 'Goa'],
    ['24', 'Gujarat'], ['06', 'Haryana'], ['02', 'Himachal Pradesh'], ['01', 'Jammu and Kashmir'], ['20', 'Jharkhand'],
    ['29', 'Karnataka'], ['32', 'Kerala'], ['38', 'Ladakh'], ['31', 'Lakshadweep'], ['23', 'Madhya Pradesh'],
    ['27', 'Maharashtra'], ['14', 'Manipur'], ['17', 'Meghalaya'], ['15', 'Mizoram'], ['13', 'Nagaland'],
    ['21', 'Odisha'], ['34', 'Puducherry'], ['03', 'Punjab'], ['08', 'Rajasthan'], ['11', 'Sikkim'],
    ['33', 'Tamil Nadu'], ['36', 'Telangana'], ['16', 'Tripura'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'], ['19', 'West Bengal'],
].map(([code, name]) => ({ code, name }));
