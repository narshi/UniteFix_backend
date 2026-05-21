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
}

export interface WalletSummary {
    totalEarnings: number;
    pendingPayments: number;
    completedJobs: number;
    recentTransactions: WalletTransaction[];
}

export interface WalletTransaction {
    id: number;
    amount: number;
    type: 'credit' | 'debit';
    description: string;
    status: string;
    createdAt: string;
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
        apiClient.post('/api/service/start', { serviceId, latitude, longitude }),

    completeService: (serviceId: number) =>
        apiClient.post('/api/service/complete', { serviceId }),

    enterServiceCharge: (serviceId: number, data: { serviceCharge: number; materialCharge?: number; notes?: string }) =>
        apiClient.post(`/api/technician/services/${serviceId}/enter-service-charge`, data),

    validateOtp: (serviceId: number, otp: string) =>
        apiClient.post(`/api/technician/services/${serviceId}/validate-otp`, { otp }),

    // Location
    updateLocation: (latitude: number, longitude: number) =>
        apiClient.post('/api/serviceman/location/update', { latitude, longitude }),

    // Wallet (may not exist yet — graceful fallback)
    getWallet: () =>
        apiClient.get<WalletSummary>('/api/serviceman/wallet'),

    // Profile (reuse client profile endpoint)
    getProfile: () =>
        apiClient.get('/api/client/profile'),

    updateProfile: (data: Record<string, any>) =>
        apiClient.patch('/api/client/profile', data),
};
