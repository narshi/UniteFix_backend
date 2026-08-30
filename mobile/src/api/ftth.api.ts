/**
 * FTTH (broadband) API.
 *
 * Note what this file does NOT contain: any list of speeds or durations. The
 * catalogue is entirely operator-authored and arrives from the server grouped by
 * speed. Onboarding an ISP that sells 25/75 Mbps must never require an app
 * release, so a hardcoded ladder here would be a bug even if it happened to
 * match today's operators.
 */

import { apiClient } from './client';

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
    meta?: any;
}

export interface FtthOperator {
    id: number;
    companyName: string;
    logoUrl: string | null;
    brandColor: string | null;
    contactPhone: string;
}

export interface FtthPlan {
    id: number;
    name: string;
    speedMbps: number;
    durationMonths: number;
    price: number;
    discount: number;
    finalPrice: number;
    dataLimitGb: number | null;
    benefits: string[];
    convenienceFee: number;
    /** finalPrice + convenienceFee — what the customer actually pays. */
    payable: number;
}

/** Plans grouped by speed. The matrix is SPARSE — see FtthRechargeScreen. */
export interface FtthSpeedGroup {
    speedMbps: number;
    plans: FtthPlan[];
}

export interface FtthConnection {
    id: number;
    operatorId: number;
    operatorName: string;
    logoUrl: string | null;
    brandColor: string | null;
    ispConnectionId: string | null;
    status: 'pending_id' | 'active' | 'suspended' | 'closed';
    validTill: string | null;
    planName: string | null;
    speedMbps: number | null;
    daysRemaining: number | null;
    isExpired: boolean;
}

export interface FtthPendingIdRequest {
    id: number;
    operatorId: number;
    operatorName: string;
    status: string;
    rejectionReason: string | null;
    createdAt: string;
}

export interface FtthPendingLead {
    id: number;
    operatorId: number;
    operatorName: string;
    status: string;
    createdAt: string;
}

export interface FtthConnectionsPayload {
    connections: FtthConnection[];
    pendingIdRequests: FtthPendingIdRequest[];
    pendingLeads: FtthPendingLead[];
}

export interface FtthRechargeOrder {
    rechargeId: number;
    razorpayOrderId: string;
    razorpayKeyId: string;
    amount: number;
    breakdown: {
        planPrice: number;
        discount: number;
        convenienceFee: number;
        total: number;
    };
    customer: { name?: string | null; email?: string | null; phone?: string | null };
}

export interface FtthRechargeHistoryItem {
    id: number;
    planName: string;
    speedMbps: number;
    durationMonths: number;
    amount: number;
    convenienceFee: number;
    status: string;
    periodStart: string | null;
    periodEnd: string | null;
    createdAt: string;
    operatorName: string;
}

export interface FtthRechargeTracking {
    id: number;
    status: 'created' | 'pending' | 'success' | 'failed' | 'refunded';
    stage: 1 | 2 | 3;
    stageTitle: string;
    stageDescription: string;
    ispConnectionId: string | null;
    customerName: string | null;
    operatorName: string;
    operatorPhone: string | null;
    brandColor: string;
    plan: {
        name: string;
        speedMbps: number;
        durationMonths: number;
        total: number;
        planPrice: number;
        discount: number;
        convenienceFee: number;
    };
    validTill: string | null;
    periodStart: string | null;
    paidAt: string | null;
    fulfilledAt: string | null;
    razorpayPaymentId: string | null;
    razorpayOrderId: string | null;
    createdAt: string;
}

export const ftthApi = {
    /** Operators serving the caller's pincode. Empty is a legitimate answer. */
    async getOperators(pincode?: string) {
        const { data } = await apiClient.get<ApiResponse<FtthOperator[]>>('/api/ftth/operators', {
            params: pincode ? { pincode } : undefined,
        });
        return data;
    },

    /** Look up an existing ISP connection under an operator by ID or phone */
    async lookupCustomer(operatorId: number, query: string) {
        const { data } = await apiClient.post<{ success: boolean; exists: boolean; message?: string; data?: FtthConnection }>(
            '/api/ftth/customers/lookup',
            { operatorId, query },
        );
        return data;
    },

    async getPlans(operatorId: number) {
        const { data } = await apiClient.get<ApiResponse<{ speeds: FtthSpeedGroup[] }>>(
            `/api/ftth/operators/${operatorId}/plans`,
        );
        return data.data.speeds;
    },

    async getConnections() {
        const { data } = await apiClient.get<ApiResponse<FtthConnectionsPayload>>('/api/ftth/connections');
        return data.data;
    },

    async submitLead(body: {
        operatorId: number;
        name: string;
        phone: string;
        address: string;
        pincode: string;
        notes?: string;
    }) {
        const { data } = await apiClient.post<ApiResponse<{ leadId: number }>>('/api/ftth/leads', body);
        return data;
    },

    async submitIdRequest(body: {
        operatorId: number;
        claimedName: string;
        claimedPhone: string;
        claimedAddress?: string;
        claimedIspId?: string;
    }) {
        const { data } = await apiClient.post<ApiResponse<{ requestId: number }>>('/api/ftth/id-requests', body);
        return data;
    },

    async initiateRecharge(body: { connectionId: number; planId: number }) {
        const { data } = await apiClient.post<ApiResponse<FtthRechargeOrder>>(
            '/api/ftth/recharges/initiate', body,
        );
        return data.data;
    },

    /**
     * Confirm a payment the SDK reported as successful.
     *
     * This is optimistic, not authoritative: if the app dies before this call the
     * Razorpay webhook still applies the recharge server-side. So a failure here
     * is not a failed payment, and the UI must not say it is.
     */
    async verifyRecharge(body: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
    }) {
        const { data } = await apiClient.post<ApiResponse<{ rechargeId: number; validTill: string | null }>>(
            '/api/ftth/recharges/verify', body,
        );
        return data;
    },

    async getHistory() {
        const { data } = await apiClient.get<ApiResponse<FtthRechargeHistoryItem[]>>('/api/ftth/recharges');
        return data.data;
    },

    async getRechargeTracking(rechargeId: number) {
        const { data } = await apiClient.get<ApiResponse<FtthRechargeTracking>>(
            `/api/ftth/recharges/${rechargeId}/tracking`,
        );
        return data.data;
    },
};
