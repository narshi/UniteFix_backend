/**
 * Customer API — Service requests, profile, notifications, pincode
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface ServiceCategory {
    id: string;
    name: string;
    icon: string;
    description?: string;
}

export interface ServiceRequest {
    id: number;
    userId: number;
    serviceType: string;
    description: string;
    status: string;
    address?: string;
    pinCode?: string;
    photos?: string[];
    assignedTo?: number;
    scheduledDate?: string;
    createdAt: string;
    updatedAt: string;
    serviceCharge?: number;
    materialCharge?: number;
    totalCharge?: number;
    servicemanName?: string;
    servicemanPhone?: string;
    rating?: number;
    feedback?: string;
    otp?: string;
}

export interface CreateServiceRequest {
    serviceType: string;
    description: string;
    address: string;
    pinCode: string;
    photos?: string[];
    scheduledDate?: string;
    urgency?: 'normal' | 'urgent';
}

export interface UserProfile {
    id: number;
    username: string;
    email?: string;
    phone: string;
    role: string;
    address?: string;
    pinCode?: string;
    profilePicture?: string;
    isVerified: boolean;
    referralCode?: string;
    createdAt: string;
}

export interface Notification {
    id: number;
    userId: number;
    title: string;
    message: string;
    type: string;
    isRead: boolean;
    data?: any;
    createdAt: string;
}

// ==================== API ====================

export const customerApi = {
    // Profile
    getProfile: () =>
        apiClient.get<UserProfile>('/api/client/auth/profile'),

    updateProfile: (data: Partial<{ username: string; email: string; phone: string; address: string; pinCode: string }>) =>
        apiClient.patch<UserProfile>('/api/client/auth/profile', data),

    // Service Requests
    createServiceRequest: (data: CreateServiceRequest) =>
        apiClient.post<ServiceRequest>('/api/services/create', data),

    getMyServiceRequests: () =>
        apiClient.get<ServiceRequest[]>('/api/services/my-requests'),

    cancelServiceRequest: (id: number) =>
        apiClient.post(`/api/services/${id}/cancel`),

    rateService: (id: number, data: { rating: number; feedback: string }) =>
        apiClient.post(`/api/ratings/service/${id}`, data),

    // Notifications
    getNotifications: () =>
        apiClient.get<Notification[]>('/api/notifications'),

    markNotificationRead: (id: number) =>
        apiClient.patch(`/api/notifications/${id}/read`),

    // Pincode validation
    validatePincode: (pinCode: string) =>
        apiClient.post<{ serviceable: boolean; district?: string }>('/api/validate-pincode', { pinCode }),

    // OTP
    generateOTP: (serviceId: number) =>
        apiClient.post(`/api/otp/generate`, { serviceId }),
};
