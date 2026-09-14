/**
 * Business partner API — /api/b2b/*
 *
 * A business partner is a company (an ISP, a computer shop, a CCTV installer)
 * that buys parts from UniteFix stock and settles on credit or prepaid. This
 * is the whole of their surface: who they are, what is for sale, what they
 * ordered and where it is, and what they owe.
 *
 * Money arrives in rupees from the server — the paise-to-rupees boundary is
 * on the server side of these routes, so nothing here does arithmetic.
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export type Availability = 'in_stock' | 'low' | 'backorder';

export interface CatalogItem {
    id: number;
    partCode: string;
    name: string;
    brand: string | null;
    specification: string | null;
    unit: string | null;
    tradePrice: number;
    gstPercent: number | null;
    warrantyDays: number | null;
    categoryIds?: number[];
    availability: Availability;
}

export interface CatalogItemDetail extends Omit<CatalogItem, 'categoryIds'> {
    photoUrl: string | null;
    categories: { id: number; name: string }[];
}

export interface QuoteLine {
    sparePartId: number;
    name: string;
    quantity: number;
    backordered: boolean;
    unitPrice: number;
    net: number;
    gst: number;
    lineTotal: number;
}

export interface Quote {
    lines: QuoteLine[];
    subtotal: number;
    gst: number;
    total: number;
    backordered: string[];
}

export type OrderStatus = 'placed' | 'paid' | 'confirmed' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';
export type PaymentMode = 'prepaid' | 'credit';

export interface TrackingStep {
    key: string;
    label: string;
    done: boolean;
    current: boolean;
}

export interface Tracking {
    terminal: boolean;
    terminalLabel: string | null;
    steps: TrackingStep[];
}

export interface OrderSummary {
    id: number;
    orderCode: string;
    status: OrderStatus;
    paymentMode: PaymentMode;
    paymentStatus: string;
    total: number;
    placedAt: string;
    deliveredAt: string | null;
    tracking: Tracking;
}

export interface OrderItem {
    id: number;
    sparePartId: number;
    partCode: string;
    name: string;
    specification: string | null;
    quantity: number;
    quantityFulfilled: number;
    backordered: boolean;
    unitPrice: number;
    gstPercent: number | null;
    lineTotal: number;
}

export interface OrderEvent {
    id: number;
    type: string;
    from: string | null;
    to: string | null;
    actor: string;
    payload: Record<string, any> | null;
    at: string;
}

export interface OrderDetail extends OrderSummary {
    subtotal: number;
    gst: number;
    shipping: number;
    discount: number;
    deliveryAddress: Record<string, any> | null;
    deliveryContact: Record<string, any> | null;
    notes: string | null;
    cancelReason: string | null;
    paidAt: string | null;
    confirmedAt: string | null;
    dispatchedAt: string | null;
    cancelledAt: string | null;
    items: OrderItem[];
    events: OrderEvent[];
}

export interface PlaceOrderResult {
    order: OrderDetail;
    razorpay: { orderId: string; keyId: string; amount: number } | null;
}

export interface BusinessPartnerMe {
    partnerCode: string;
    displayName: string;
    legalName: string;
    gstin: string | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    address: string | null;
    pincode: string | null;
    district: string | null;
    status: 'pending' | 'active' | 'suspended' | 'rejected' | string;
    verticals: string[];
    credit: { limit: number; outstanding: number; available: number; paymentTermsDays: number | null };
    payout: { beneficiaryName: string | null; bankLast4: string | null; upiId: string | null };
}

export interface LedgerLine {
    id: number;
    /** 'b2b' — parts trade; 'ftth' — broadband recharge settlement. */
    source: 'b2b' | 'ftth';
    entryType: string;
    /** Signed per `convention`: positive means the partner owes UniteFix. */
    amount: number;
    description: string | null;
    b2bOrderId: number | null;
    createdAt: string;
}

export interface Statement {
    convention: string;
    youOwe: number;
    owedToYou: number;
    b2bBalance: number;
    ftthBalance: number;
    lines: LedgerLine[];
}

export interface CreditSummary {
    creditLimit: number;
    outstanding: number;
    creditAvailable: number;
    prepaidOnly: boolean;
}

interface ApiResponse<T> {
    success: boolean;
    message?: string;
    data: T;
}

export interface CartLine { sparePartId: number; quantity: number }

// ==================== API ====================

export const b2bApi = {
    me: () => apiClient.get<ApiResponse<BusinessPartnerMe>>('/api/b2b/me'),

    catalog: (params: { q?: string; categoryId?: number; limit?: number } = {}) =>
        apiClient.get<ApiResponse<CatalogItem[]>>('/api/b2b/catalog', { params }),

    catalogItem: (id: number) => apiClient.get<ApiResponse<CatalogItemDetail>>(`/api/b2b/catalog/${id}`),

    quote: (items: CartLine[]) => apiClient.post<ApiResponse<Quote>>('/api/b2b/orders/quote', { items }),

    placeOrder: (body: { items: CartLine[]; paymentMode: PaymentMode; notes?: string | null }) =>
        apiClient.post<ApiResponse<PlaceOrderResult>>('/api/b2b/orders', body),

    verifyPayment: (orderId: number, body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        apiClient.post<ApiResponse<OrderDetail>>(`/api/b2b/orders/${orderId}/verify-payment`, body),

    /** Razorpay details to re-open checkout on an unpaid prepaid order. 409 when nothing is owed. */
    paymentInfo: (orderId: number) =>
        apiClient.get<ApiResponse<{ orderId: string; keyId: string; amount: number }>>(`/api/b2b/orders/${orderId}/payment`),

    orders: (status?: string) => apiClient.get<ApiResponse<OrderSummary[]>>('/api/b2b/orders', { params: status ? { status } : {} }),

    order: (id: number) => apiClient.get<ApiResponse<OrderDetail>>(`/api/b2b/orders/${id}`),

    cancelOrder: (id: number, reason?: string) =>
        apiClient.post<ApiResponse<OrderDetail>>(`/api/b2b/orders/${id}/cancel`, { reason }),

    requestReturn: (id: number, reason: string) =>
        apiClient.post<ApiResponse<null>>(`/api/b2b/orders/${id}/return`, { reason }),

    ledger: (params: { limit?: number } = {}) => apiClient.get<ApiResponse<Statement>>('/api/b2b/ledger', { params }),

    creditSummary: () => apiClient.get<ApiResponse<CreditSummary>>('/api/b2b/ledger/summary'),
};
