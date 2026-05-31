/**
 * Partner/Employee API — Assignments, service actions, wallet
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface Assignment {
    id: number;
    serviceId: number;
    serviceType: string;
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
    latitude?: number;
    longitude?: number;
    customerLocation?: string;
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
        apiClient.get<Assignment[]>('/api/serviceman/assignments'),

    acceptAssignment: (id: number) =>
        apiClient.post(`/api/serviceman/requests/${id}/accept`),

    denyAssignment: (id: number, reason?: string) =>
        apiClient.post(`/api/serviceman/requests/${id}/deny`, { reason }),

    // Service flow
    verifyHandshake: (serviceId: number, otp: string) =>
        apiClient.post('/api/service/verify-handshake', { serviceId, otp }),

    startService: (serviceId: number, latitude?: number, longitude?: number) =>
        apiClient.post('/api/service/start', { serviceId, providerLat: latitude, providerLong: longitude }),

    completeService: (serviceId: number) =>
        apiClient.post('/api/service/complete', { serviceId }),

    // Cash payment — employee confirms cash collected from customer
    collectCash: (bookingId: number, amountCollected: number) =>
        apiClient.post(`/api/bookings/${bookingId}/cash-collected`, { amountCollected }),

    enterServiceCharge: (serviceId: number, data: { serviceCharge: number; materialCharge?: number; notes?: string }) =>
        apiClient.post(`/api/technician/services/${serviceId}/enter-service-charge`, {
            serviceAmount: data.serviceCharge,
            partsUsed: data.materialCharge,
            notes: data.notes,
        }),

    validateOtp: (serviceId: number, otp: string) =>
        apiClient.post(`/api/technician/services/${serviceId}/validate-otp`, { otp }),

    // Location
    updateLocation: (latitude: number, longitude: number) =>
        apiClient.post('/api/serviceman/location/update', { latitude, longitude }),

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
