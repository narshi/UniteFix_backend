/**
 * Auth API endpoints
 */

import { apiClient } from './client';

export interface LoginRequest {
    phone?: string;
    email?: string;
    password: string;
}

export interface SignupRequest {
    username: string;
    email?: string;
    phone: string;
    password: string;
    pinCode?: string;
    referralCode?: string;
    role?: string;
    partnerType?: string;
}

export interface AuthResponse {
    success: boolean;
    message: string;
    user: any;
    token: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export interface TokenRefreshResponse {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export const authApi = {
    login: (data: LoginRequest) =>
        apiClient.post<AuthResponse>('/api/auth/login', data),

    signup: (data: SignupRequest) =>
        apiClient.post<AuthResponse>('/api/auth/signup', data),

    refreshToken: (refreshToken: string) =>
        apiClient.post<TokenRefreshResponse>('/api/auth/refresh', { refreshToken }),

    forgotPassword: (data: { phone?: string; email?: string }) =>
        apiClient.post('/api/auth/forgot-password', data),

    verifyOtp: (data: { phone?: string; email?: string; otp: string }) =>
        apiClient.post<{ success: boolean; token: string }>('/api/otp/verify', data),

    resendOtp: (data: { phone?: string; email?: string }) =>
        apiClient.post('/api/auth/forgot-password', data),

    resetPassword: (data: { token: string; password: string }) =>
        apiClient.post('/api/auth/reset-password', data),

    getProfile: () =>
        apiClient.get('/api/client/auth/profile'),

    updateProfile: (data: Partial<{ username: string; email: string; phone: string; address: string; pinCode: string }>) =>
        apiClient.patch('/api/client/auth/profile', data),

    logout: () =>
        apiClient.post('/api/auth/logout'),

    deleteAccount: () =>
        apiClient.delete('/api/client/account'),

    socialLogin: (data: { provider: 'google' | 'facebook'; idToken?: string; accessToken?: string }) =>
        apiClient.post<AuthResponse>('/api/auth/social/token', data),
};
