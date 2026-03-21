/**
 * App-level Store — Theme preferences, onboarding status
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface AppState {
    theme: 'light' | 'dark' | 'system';
    hasSeenOnboarding: boolean;
    isOffline: boolean;

    // Actions
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    completeOnboarding: () => void;
    setOfflineStatus: (offline: boolean) => void;
    hydrate: () => Promise<void>;
}

const APP_PREFS_KEY = 'unitefix_app_prefs';

export const useAppStore = create<AppState>((set) => ({
    theme: 'light',
    hasSeenOnboarding: false,
    isOffline: false,

    setTheme: async (theme) => {
        set({ theme });
        const prefs = await SecureStore.getItemAsync(APP_PREFS_KEY);
        const parsed = prefs ? JSON.parse(prefs) : {};
        await SecureStore.setItemAsync(APP_PREFS_KEY, JSON.stringify({ ...parsed, theme }));
    },

    completeOnboarding: async () => {
        set({ hasSeenOnboarding: true });
        const prefs = await SecureStore.getItemAsync(APP_PREFS_KEY);
        const parsed = prefs ? JSON.parse(prefs) : {};
        await SecureStore.setItemAsync(APP_PREFS_KEY, JSON.stringify({ ...parsed, hasSeenOnboarding: true }));
    },

    setOfflineStatus: (offline) => {
        set({ isOffline: offline });
    },

    hydrate: async () => {
        try {
            const prefs = await SecureStore.getItemAsync(APP_PREFS_KEY);
            if (prefs) {
                const parsed = JSON.parse(prefs);
                set({
                    theme: parsed.theme || 'light',
                    hasSeenOnboarding: parsed.hasSeenOnboarding || false,
                });
            }
        } catch (error) {
            console.error('[AppStore] Hydration failed:', error);
        }
    },
}));
