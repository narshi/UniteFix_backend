/**
 * Auth Store — Zustand + SecureStore persistence
 *
 * Manages: access token, refresh token, user object, role
 * Persists tokens securely via expo-secure-store
 * 
 * Session policy: Stay signed in. Auto-logout only after 7 days of inactivity.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export type UserRole = 'user' | 'serviceman';

export interface User {
    id: number;
    username: string;
    email?: string;
    phone: string;
    role: UserRole;
    profilePicture?: string;
    pinCode?: string;
    address?: string;
    referralCode?: string;
}

interface AuthState {
    // State
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    selectedRole: UserRole;

    // Actions
    setTokens: (accessToken: string, refreshToken: string) => void;
    setUser: (user: User) => void;
    login: (user: User, accessToken: string, refreshToken: string) => void;
    logout: () => void;
    setSelectedRole: (role: UserRole) => void;
    recordActivity: () => void;
    hydrate: () => Promise<void>;
}

const SECURE_KEYS = {
    ACCESS_TOKEN: 'unitefix_access_token',
    REFRESH_TOKEN: 'unitefix_refresh_token',
    USER: 'unitefix_user',
    ROLE: 'unitefix_selected_role',
    LAST_ACTIVE: 'unitefix_last_active',
};

// 7 days in milliseconds
const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export const useAuthStore = create<AuthState>((set, get) => ({
    // Initial state
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isLoading: true,
    selectedRole: 'user',

    setTokens: async (accessToken: string, refreshToken: string) => {
        await SecureStore.setItemAsync(SECURE_KEYS.ACCESS_TOKEN, accessToken);
        await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, refreshToken);
        set({ accessToken, refreshToken });
    },

    setUser: async (user: User) => {
        await SecureStore.setItemAsync(SECURE_KEYS.USER, JSON.stringify(user));
        set({ user });
    },

    login: async (user: User, accessToken: string, refreshToken: string) => {
        const now = Date.now().toString();
        await Promise.all([
            SecureStore.setItemAsync(SECURE_KEYS.ACCESS_TOKEN, accessToken),
            SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, refreshToken),
            SecureStore.setItemAsync(SECURE_KEYS.USER, JSON.stringify(user)),
            SecureStore.setItemAsync(SECURE_KEYS.LAST_ACTIVE, now),
        ]);
        set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            selectedRole: user.role as UserRole,
        });
    },

    logout: async () => {
        await Promise.all([
            SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
            SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
            SecureStore.deleteItemAsync(SECURE_KEYS.USER),
            SecureStore.deleteItemAsync(SECURE_KEYS.LAST_ACTIVE),
        ]);
        set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
        });
    },

    setSelectedRole: async (role: UserRole) => {
        await SecureStore.setItemAsync(SECURE_KEYS.ROLE, role);
        set({ selectedRole: role });
    },

    // Call this on every app foreground / API call to track activity
    recordActivity: async () => {
        await SecureStore.setItemAsync(SECURE_KEYS.LAST_ACTIVE, Date.now().toString());
    },

    hydrate: async () => {
        try {
            const [accessToken, refreshToken, userJson, role, lastActive] = await Promise.all([
                SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN),
                SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN),
                SecureStore.getItemAsync(SECURE_KEYS.USER),
                SecureStore.getItemAsync(SECURE_KEYS.ROLE),
                SecureStore.getItemAsync(SECURE_KEYS.LAST_ACTIVE),
            ]);

            const user = userJson ? JSON.parse(userJson) : null;
            const hasValidToken = !!accessToken && !!user;

            // Check 7-day inactivity timeout
            let sessionExpired = false;
            if (hasValidToken && lastActive) {
                const elapsed = Date.now() - parseInt(lastActive, 10);
                sessionExpired = elapsed > SESSION_TIMEOUT_MS;
            }

            if (sessionExpired) {
                // Auto-logout: session inactive for 7+ days
                await Promise.all([
                    SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
                    SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
                    SecureStore.deleteItemAsync(SECURE_KEYS.USER),
                    SecureStore.deleteItemAsync(SECURE_KEYS.LAST_ACTIVE),
                ]);
                set({
                    user: null,
                    accessToken: null,
                    refreshToken: null,
                    isAuthenticated: false,
                    isLoading: false,
                    selectedRole: (role as UserRole) || 'user',
                });
            } else {
                // Session valid — record activity and restore
                if (hasValidToken) {
                    await SecureStore.setItemAsync(SECURE_KEYS.LAST_ACTIVE, Date.now().toString());
                }
                set({
                    accessToken,
                    refreshToken,
                    user,
                    isAuthenticated: hasValidToken,
                    isLoading: false,
                    selectedRole: (role as UserRole) || 'user',
                });
            }
        } catch (error) {
            console.error('Failed to hydrate auth state:', error);
            set({ isLoading: false });
        }
    },
}));
