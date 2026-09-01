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
    basePrice?: number; // fixed catalog price (customer all-in). 0/undefined = not priced
    subCategory?: string | null; // grouping within a category (e.g. Desktop/Laptop)
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
    brand?: string;
    model?: string;
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
    pricingSnapshot?: any;
    bookingFeeStatus?: string;
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
    catalogServiceId?: number; // catalog service id → server freezes the fixed price
    /**
     * Units this booking covers — 2 ACs, 4 cameras, 3 fan points. Defaults to 1
     * server-side when omitted, so older app builds keep working unchanged.
     * The server clamps it and does not trust this value.
     */
    quantity?: number;
}

export interface SavedAddress {
    label: string;
    address: string;
    lat: number;
    long: number;
    pinCode?: string;
}

export interface UserProfile {
    id: number;
    username: string;
    email?: string;
    phone: string;
    role: string;
    homeAddress?: string;
    pinCode?: string;
    savedAddresses?: SavedAddress[];
    profilePicture?: string;
    isVerified: boolean;
    referralCode?: string;
    createdAt: string;
}

export interface Notification {
    id: number;
    userId: number;
    title: string;
    /** DB column is `body`. `message` is kept only for older server responses. */
    body: string;
    message?: string;
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

    updateProfile: (data: Partial<{ username: string; email: string; homeAddress: string; pinCode: string; savedAddresses: SavedAddress[] }>) =>
        apiClient.patch<ApiResponse<UserProfile>>('/api/client/profile', data),

    // Partner-Specific Profile
    getPartnerProfile: () =>
        apiClient.get<ApiResponse<any>>('/api/partner/profile'),

    /**
     * `clientSupportsNameConfirmation` tells the server this build can show the
     * registered name and ask the partner to confirm it. Builds that don't send
     * it are not held to that step, so an older app can still save a UPI id
     * rather than being locked out by a 409 it has no handler for.
     */
    updateUpiId: (data: { upiId: string; confirmedName?: string }) =>
        apiClient.put<ApiResponse<{ upiId: string }>>('/api/partner/profile/upi', {
            ...data,
            clientSupportsNameConfirmation: true,
        }),

    /**
     * Check a UPI ID without saving it, so the partner can be shown the name it
     * is registered to and confirm it is theirs before anything is written.
     * A valid UPI belonging to someone else is the failure that loses money, and
     * the registered name is the only thing that catches it.
     */
    validateUpiId: (data: { upiId: string }) =>
        apiClient.post<ApiResponse<{
            status: 'valid' | 'invalid' | 'unverified';
            upiId?: string;
            customerName: string | null;
            reason: string | null;
            warning: string | null;
            message: string;
        }>>('/api/partner/profile/upi/validate', data),

    // Service Requests
    createServiceRequest: (data: CreateServiceRequest) =>
        apiClient.post<ApiResponse<ServiceRequest>>('/api/services/create', data),

    getMyServiceRequests: () =>
        apiClient.get<ApiResponse<ServiceRequest[]>>('/api/services/my-requests'),

    getServiceHistory: (page: number = 1, limit: number = 15) =>
        apiClient.get<ApiResponse<ServiceRequest[]> & { pagination: any }>(
            `/api/services/my-requests?status=past&page=${page}&limit=${limit}`
        ),

    cancelServiceRequest: (id: number) =>
        apiClient.post(`/api/services/${id}/cancel`),

    rateService: (id: number, data: { rating: number; feedback: string }) =>
        apiClient.post(`/api/ratings/service/${id}`, data),

    createBookingPayment: async (serviceId: number) => {
        const response = await apiClient.post(`/api/customer/services/${serviceId}/create-booking-payment`);
        return response.data;
    },
    
    // Payment
    getBillingDetails: (bookingId: number) =>
        apiClient.get<ApiResponse<any>>(`/api/v1/bookings/${bookingId}/billing`),

    /**
     * NOT IMPLEMENTED SERVER-SIDE — no /bookings/:id/create-payment-order route exists.
     * Currently unused; calling it returns 404. Use
     * POST /api/customer/services/:id/create-final-payment instead.
     */
    createPaymentOrder: (bookingId: number) =>
        apiClient.post<ApiResponse<{ paymentLink: string; orderId: string }>>(`/api/v1/bookings/${bookingId}/create-payment-order`),

    /**
     * NOT IMPLEMENTED SERVER-SIDE — no /bookings/:id/payment-status route exists.
     * Currently unused; calling it returns 404. Booking status is available on the
     * booking itself via GET /api/services/my-requests.
     */
    getPaymentStatus: (bookingId: number) =>
        apiClient.get<ApiResponse<{ paid: boolean; status: string }>>(`/api/v1/bookings/${bookingId}/payment-status`),

    // Support
    getSupportLink: (bookingId: number) =>
        apiClient.get<ApiResponse<{ whatsappUrl: string }>>(`/api/v1/bookings/${bookingId}/support-link`),

    // Invoices
    getMyInvoices: () =>
        apiClient.get<ApiResponse<Array<{
            id: number;
            invoiceId: string;
            serviceRequestId: number | null;
            totalAmount: number;
            createdAt: string;
        }>>>('/api/client/invoices'),

    /**
     * Short-lived (5 min) URL for the invoice PDF. Opened with Linking, so it
     * works without bundling native file-system/sharing modules.
     */
    getInvoiceDownloadLink: (invoiceId: string) =>
        apiClient.post<ApiResponse<{ url: string; expiresInSeconds: number }>>(
            `/api/client/invoices/${encodeURIComponent(invoiceId)}/download-link`,
        ),

    // Notifications
    // The response also carries `notifications` and `unreadCount` alongside `data`.
    getNotifications: () =>
        apiClient.get<ApiResponse<Notification[]> & {
            notifications?: Notification[];
            unreadCount?: number;
            total?: number;
        }>('/api/notifications'),

    getUnreadNotificationCount: () =>
        apiClient.get<ApiResponse<{ unreadCount: number }>>('/api/notifications/unread-count'),

    // Server registers this as PUT (notification.routes.ts); PATCH 404'd.
    markNotificationRead: (id: number) =>
        apiClient.put(`/api/notifications/${id}/read`),

    markAllNotificationsRead: () =>
        apiClient.put('/api/notifications/read-all'),

    // Pincode validation
    validatePincode: (pinCode: string) =>
        apiClient.get<{ available: boolean; serviceable?: boolean; message?: string }>(`/api/customer/check-serviceability?pincode=${pinCode}`),

    // Service Catalog
    getHomeServices: () =>
        apiClient.get<ApiResponse<ServiceItem[]>>('/api/services/home'),

    getAllCategories: () =>
        apiClient.get<ApiResponse<ServiceCategory[]>>('/api/services/categories'),

    // Platform Config — shape mirrors GET /api/config/public in client-features.routes.ts
    getPublicConfig: () =>
        apiClient.get<ApiResponse<{
            bookingFee: number;
            gstRate: number;
            cancelFee: number;
            platformFeePercent: number;
            /** Platform-wide promotional discount, and why it is being given. */
            discountPercent: number;
            discountLabel: string;
            supportWindowHours: number;
            minWalletRedemption: number;
            whatsappNumber: string;
            companyUpiId: string;
        }>>('/api/config/public'),

    /**
     * OTP
     * NOT IMPLEMENTED SERVER-SIDE — /api/otp/generate does not exist (the server
     * exposes /api/otp/send and /api/otp/verify, which are auth OTPs for
     * phone/email, not the service handshake code). The handshake OTP is minted
     * server-side on booking creation/acceptance and read from the booking's
     * `handshakeOtp` field. Currently unused; calling it returns 404.
     */
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
