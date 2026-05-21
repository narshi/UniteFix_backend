/**
 * API Client with automatic token refresh interceptor
 * 
 * Flow:
 * 1. Every request gets Authorization header from auth store
 * 2. On 403 → try refresh token
 * 3. If refresh succeeds → retry original request
 * 4. If refresh fails → force logout
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth.store';

import Constants from 'expo-constants';

// Dynamically resolve dev server IP from Expo manifest.
// This prevents "Network Error" caused by hardcoded IPs going stale after DHCP changes.
// hostUri looks like "192.168.1.x:8081" — we extract just the IP part.
function getApiBaseUrl(): string {
    if (!__DEV__) return 'https://unitefix-backend.onrender.com';

    // Try to extract IP from expo-constants (works in Expo Go and dev builds)
    const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost ?? '';
    const hostIp = hostUri.split(':')[0];

    if (hostIp && hostIp !== 'localhost') {
        return `http://${hostIp}:3000`;
    }

    // Fallback to localhost
    return 'http://localhost:3000';
}

const API_BASE_URL = getApiBaseUrl();


export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor — attach access token
apiClient.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const token = useAuthStore.getState().accessToken;
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — handle token refresh on 403
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((promise) => {
        if (error) {
            promise.reject(error);
        } else {
            promise.resolve(token!);
        }
    });
    failedQueue = [];
};

apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // Only attempt refresh on 403 (token expired), not 401 (no token)
        if (error.response?.status === 403 && !originalRequest._retry) {
            if (isRefreshing) {
                // Queue this request until refresh completes
                return new Promise((resolve, reject) => {
                    failedQueue.push({
                        resolve: (token: string) => {
                            originalRequest.headers.Authorization = `Bearer ${token}`;
                            resolve(apiClient(originalRequest));
                        },
                        reject,
                    });
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const refreshToken = useAuthStore.getState().refreshToken;
                if (!refreshToken) {
                    throw new Error('No refresh token');
                }

                const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
                    refreshToken,
                });

                const { accessToken, refreshToken: newRefreshToken } = data;
                useAuthStore.getState().setTokens(accessToken, newRefreshToken);

                processQueue(null, accessToken);
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);
                useAuthStore.getState().logout();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

// Helper to extract error message from API responses
export function getApiErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
        return error.response?.data?.message || error.message || 'Something went wrong';
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'An unexpected error occurred';
}
