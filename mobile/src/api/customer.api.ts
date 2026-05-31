/**
 * Customer API — Service requests, profile, notifications, pincode
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
    pagination?: any;
}

export interface ServiceCategory {
    id: number;
    name: string;
    icon?: string;
    sortOrder: number;
    isActive: boolean;
    items?: ServiceItem[];
}

export interface ServiceItem {
    id: number;
    categoryId: number;
    name: string;
    subtitle?: string;
    icon?: string;
    bannerImage?: string;
    status: 'ACTIVE' | 'COMING_SOON' | 'DISABLED' | 'MAINTENANCE';
    isHomeVisible: boolean;
    sortOrder: number;
    isActive: boolean;
}

export interface ServiceRequest {
    id: number;
    serviceId?: string;
    userId: number;
    serviceType: string;
    description: string;
    status: 'created' | 'assigned' | 'accepted' | 'reached' | 'in_progress' | 'pending_payment' | 'completed' | 'cancelled' | 'disputed';
    address?: string;
    pinCode?: string;
    photos?: string[];
    assignedTo?: number;
    providerId?: number;
    scheduledDate?: string;
    preferredDate?: string;
    preferredTimeSlot?: string;
    createdAt: string;
    updatedAt: string;
    // Billing
    bookingFee?: number;
    serviceCharge?: number;
    materialCharge?: number;
    totalCharge?: number;
    totalAmount?: number;
    // Technician
    servicemanName?: string;
    servicemanPhone?: string;
    // State / OTP
    handshakeOtp?: string;
    otp?: string;
    assignedAt?: string;
    reachedAt?: string;
    startedAt?: string;
    completedAt?: string;
    // Rating
    rating?: number;
    feedback?: string;
}

export interface CreateServiceRequest {
    serviceType: string;
    description: string;
    address: string;
    pinCode: string;
    photos?: string[];
    scheduledDate?: string;
    urgency?: 'normal' | 'urgent';
    customerLocation?: string; // WKT POINT(lng lat) for geofence
}

export interface UserProfile {
    id: number;
    username: string;
    email?: string;
    phone: string;
    role: string;
    homeAddress?: string;
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
        apiClient.get<ApiResponse<UserProfile>>('/api/client/profile'),

    updateProfile: (data: Partial<{ username: string; email: string; homeAddress: string; pinCode: string }>) =>
        apiClient.patch<ApiResponse<UserProfile>>('/api/client/profile', data),

    // Service Requests
    createServiceRequest: (data: CreateServiceRequest) =>
        apiClient.post<ApiResponse<ServiceRequest>>('/api/services/create', data),

    getMyServiceRequests: () =>
        apiClient.get<ApiResponse<ServiceRequest[]>>('/api/services/my-requests'),

    cancelServiceRequest: (id: number) =>
        apiClient.post(`/api/services/${id}/cancel`),

    rateService: (id: number, data: { rating: number; feedback: string }) =>
        apiClient.post(`/api/ratings/service/${id}`, data),

    // Payment
    getBillingDetails: (bookingId: number) =>
        apiClient.get<ApiResponse<any>>(`/api/v1/bookings/${bookingId}/billing`),

    createPaymentOrder: (bookingId: number) =>
        apiClient.post<ApiResponse<{ paymentLink: string; orderId: string }>>(`/api/v1/bookings/${bookingId}/create-payment-order`),

    getPaymentStatus: (bookingId: number) =>
        apiClient.get<ApiResponse<{ paid: boolean; status: string }>>(`/api/v1/bookings/${bookingId}/payment-status`),

    // Support
    getSupportLink: (bookingId: number) =>
        apiClient.get<ApiResponse<{ whatsappUrl: string }>>(`/api/v1/bookings/${bookingId}/support-link`),

    // Notifications
    getNotifications: () =>
        apiClient.get<ApiResponse<Notification[]>>('/api/notifications'),

    markNotificationRead: (id: number) =>
        apiClient.patch(`/api/notifications/${id}/read`),

    // Pincode validation
    validatePincode: (pinCode: string) =>
        apiClient.get<{ available: boolean; serviceable?: boolean; message?: string }>(`/api/customer/check-serviceability?pincode=${pinCode}`),

    // Service Catalog
    getHomeServices: () =>
        apiClient.get<ApiResponse<ServiceItem[]>>('/api/services/home'),

    getAllCategories: () =>
        apiClient.get<ApiResponse<ServiceCategory[]>>('/api/services/categories'),

    // Platform Config
    getPublicConfig: () =>
        apiClient.get<ApiResponse<{ bookingFee: number; gstRate: number; cancelFee: number; whatsappNumber: string }>>('/api/config/public'),

    // OTP
    generateOTP: (serviceId: number) =>
        apiClient.post(`/api/otp/generate`, { serviceId }),

    // Razorpay Payment Verification
    verifyPayment: (data: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
    }) => apiClient.post('/api/payments/verify', data),

    // Final payment order creation (after service completion)
    createFinalPaymentOrder: (serviceId: number) =>
        apiClient.post<ApiResponse<{ razorpayOrderId: string; amount: number }>>(`/api/customer/services/${serviceId}/create-final-payment`),

    // Shop payment order
    createShopOrder: (data: { amount: number; address: string }) =>
        apiClient.post<ApiResponse<{ razorpayOrderId: string; razorpayKeyId: string; amount: number }>>('/api/shop/create-order', data),

    // Image Uploads
    uploadImage: async (uri: string, folder: string = 'general'): Promise<string> => {
        const formData = new FormData();
        const filename = uri.split('/').pop() || 'photo.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri, name: filename, type } as any);

        const response = await apiClient.post<ApiResponse<{ url: string }>>(`/api/upload/image?folder=${folder}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        });
        return response.data.data.url;
    },

    uploadImages: async (uris: string[], folder: string = 'general'): Promise<string[]> => {
        const formData = new FormData();
        uris.forEach((uri, index) => {
            const filename = uri.split('/').pop() || `photo_${index}.jpg`;
            const match = /\.(\w+)$/.exec(filename);
            const type = match ? `image/${match[1]}` : 'image/jpeg';
            formData.append('images', { uri, name: filename, type } as any);
        });

        const response = await apiClient.post<ApiResponse<{ urls: string[] }>>(`/api/upload/images?folder=${folder}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60000,
        });
        return response.data.data.urls;
    },

    uploadProfilePicture: async (uri: string): Promise<string> => {
        const formData = new FormData();
        const filename = uri.split('/').pop() || 'profile.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';
        formData.append('image', { uri, name: filename, type } as any);

        const response = await apiClient.post<ApiResponse<{ profilePicture: string }>>('/api/client/profile/picture', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        });
        return response.data.data.profilePicture;
    },
};
