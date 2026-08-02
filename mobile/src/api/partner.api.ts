/**
 * Partner/Employee API — Assignments, service actions, wallet
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface Assignment {
    id: number;
    serviceId: string;  // Human-readable ID like "SR000001"
    serviceType: string;
    brand?: string;
    model?: string;
    description: string;
    status: string;
    customerName: string;
    customerPhone: string;
    address: string;
    pinCode: string;
    scheduledDate?: string;
    assignedAt: string;
    createdAt: string;
    updatedAt: string;
    serviceCharge?: number;
    materialCharge?: number;
    totalCharge?: number;
    otp?: string;
    rating?: number;
    feedback?: string;
    pricingSnapshot?: any;
    latitude?: number;
    longitude?: number;
    customerLocation?: string;
    paymentMethod?: string;
}

export interface WalletSummary {
    totalEarnings: number;
    pendingPayments: number;
    completedJobs: number;
    availableBalance?: number;
    recentTransactions: WalletTransaction[];
}

export interface WalletTransaction {
    id: number;
    amount: number;
    type: 'credit' | 'debit';
    description: string;
    status: string;
    createdAt: string;
    // Map from backend's V2 transactions
    transactionType?: string;
    balanceAvailableAfter?: string;
}

// ==================== API ====================

export const partnerApi = {
    // Assignments
    getAssignments: () =>
        apiClient.get<{ success: boolean; data: Assignment[] }>('/api/serviceman/assignments'),

    getAssignmentHistory: (page: number = 1, limit: number = 15) =>
        apiClient.get<any>(`/api/serviceman/assignments?status=past&page=${page}&limit=${limit}`),

    acceptAssignment: (id: number) =>
        apiClient.post(`/api/serviceman/requests/${id}/accept`),

    denyAssignment: (id: number, reason?: string) =>
        apiClient.post(`/api/serviceman/requests/${id}/deny`, { reason }),

    // Service flow (V2 Geofence Endpoints)
    markArrived: (bookingId: number, latitude: number, longitude: number) =>
        apiClient.patch(`/api/bookings/${bookingId}/arrive`, { latitude, longitude }),

    startServiceWithOtp: (bookingId: number, otp: string) =>
        apiClient.patch(`/api/bookings/${bookingId}/start`, { otp }),

    completeService: (serviceId: number) =>
        apiClient.post('/api/service/complete', { serviceId }),

    // Cash payment — employee confirms cash collected from customer
    collectCash: (bookingId: number, amountCollected: number) =>
        apiClient.post(`/api/bookings/${bookingId}/cash-collected`, { amountCollected }),

    enterServiceCharge: (serviceId: number | string, data: { serviceCharge: number; materialCharge?: number; notes?: string }) =>
        apiClient.post(`/api/bookings/${serviceId}/submit-bill`, {
            serviceLaborCost: data.serviceCharge,
            sparePartsCost: data.materialCharge || 0,
            notes: data.notes,
        }),

    // Fixed-price (v2) equivalent of submit-bill: the price is already frozen, so
    // this just moves the job to awaiting-payment. Optional parts add-on is a
    // customer-approved extra passed through to the technician.
    requestPayment: (bookingId: number, data?: { extraPartsCost?: number; partsNote?: string }) =>
        apiClient.post(`/api/bookings/${bookingId}/request-payment`, data || {}),

    validateOtp: (serviceId: number, otp: string) =>
        // NOT IMPLEMENTED SERVER-SIDE — no /api/technician/* namespace exists.
        // Currently unused; calling it returns 404. OTP verification goes through
        // PATCH /api/bookings/:id/start (geofence.routes.ts).
        apiClient.post(`/api/technician/services/${serviceId}/validate-otp`, { otp }),

    // Location
    // The server destructures { lat, long } (routes.ts POST
    // /api/serviceman/location/update). Sending { latitude, longitude } made both
    // undefined and the handler rejected the request with 400.
    updateLocation: (latitude: number, longitude: number) =>
        apiClient.post('/api/serviceman/location/update', { lat: latitude, long: longitude }),

    // Wallet (V2 API calls)
    getWallet: async (): Promise<WalletSummary> => {
        try {
            // Fetch balance
            const balanceRes = await apiClient.get<any>('/api/partner/wallet/balance');
            // Fetch transactions
            const txRes = await apiClient.get<any>('/api/partner/wallet/transactions?limit=50');
            
            const walletData = balanceRes.data?.data || {};
            const txData = txRes.data?.data || [];
            
            return {
                totalEarnings: parseFloat(walletData.totalEarned || '0'),
                pendingPayments: parseFloat(walletData.balanceHold || '0'),
                availableBalance: parseFloat(walletData.balanceAvailable || '0'), // Added for UI
                completedJobs: 0, // Not provided by API currently
                recentTransactions: txData.map((tx: any) => {
                    // Map V2 transaction types to credit/debit
                    const isCredit = tx.transactionType === 'release' || tx.transactionType === 'hold_credit' || parseFloat(tx.amount) > 0;
                    return {
                        id: tx.id,
                        amount: parseFloat(tx.amount || '0'),
                        type: isCredit ? 'credit' : 'debit',
                        description: tx.description || tx.transactionType,
                        status: tx.isReleased ? 'completed' : 'pending',
                        createdAt: tx.createdAt,
                        transactionType: tx.transactionType
                    };
                })
            };
        } catch (error) {
            console.error('Failed to fetch wallet:', error);
            throw error;
        }
    },

    withdraw: (data: { amount: number; method: 'bank' | 'upi' }) =>
        apiClient.post('/api/partner/wallet/withdraw', data),

    // Profile (reuse client profile endpoint)
    getProfile: () =>
        apiClient.get('/api/client/profile'),

    updateProfile: (data: Record<string, any>) =>
        apiClient.patch('/api/client/profile', data),
};
