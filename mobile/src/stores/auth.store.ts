/**
 * Auth Store — Zustand + SecureStore
 *
 * Manages:
 * - Authentication state (Truecaller OAuth + JWT tokens)
 * - Secure token persistence via expo-secure-store
 * - Session hydration with 7-day inactivity timeout
 * - Role-based navigation state
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { authApi, AuthUser, AuthResponse } from '../api/auth.api';
import { customerApi } from '../api/customer.api';

// ── Storage Keys ──────────────────────────────────────────────────────
const KEYS = {
  ACCESS_TOKEN: 'uf_access_token',
  REFRESH_TOKEN: 'uf_refresh_token',
  USER: 'uf_user',
  LAST_ACTIVITY: 'uf_last_activity',
} as const;

const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Store Types ───────────────────────────────────────────────────────

interface AuthState {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;

  // Actions
  hydrate: () => Promise<void>;
  loginWithTruecaller: (response: AuthResponse) => Promise<void>;
  refreshTokens: () => Promise<boolean>;
  logout: () => Promise<void>;
  recordActivity: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  /**
   * Re-reads onboarding completeness from the server and persists it.
   * Called after each onboarding step so RootNavigator can move the user on
   * as soon as the final requirement is satisfied.
   */
  refreshOnboardingStatus: () => Promise<boolean>;
}

// ── Secure Storage Helpers ────────────────────────────────────────────

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (firstError) {
    // Retried once before giving up. A dropped write here used to be invisible
    // and fatal: the rotated refresh token lived only in memory, so the next
    // launch presented the old one, the server had already rotated it away, and
    // the user was signed out and had to request a new OTP.
    try {
      await SecureStore.setItemAsync(key, value);
      return;
    } catch { /* fall through to the warning below */ }
    console.warn(`[AUTH_STORE] Failed to write ${key} (after retry):`, firstError);
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (err) {
    console.warn(`[AUTH_STORE] Failed to read ${key}:`, err);
    return null;
  }
}

async function secureClear(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => {})
    )
  );
}

// ── Store ─────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  isLoading: true,
  user: null,
  accessToken: null,
  refreshToken: null,

  /**
   * Hydrate session from SecureStore on app launch.
   * Checks for session expiry (7-day inactivity timeout).
   */
  hydrate: async () => {
    try {
      const [accessToken, refreshToken, userJson, lastActivity] = await Promise.all([
        secureGet(KEYS.ACCESS_TOKEN),
        secureGet(KEYS.REFRESH_TOKEN),
        secureGet(KEYS.USER),
        secureGet(KEYS.LAST_ACTIVITY),
      ]);

      // Check session expiry
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed > SESSION_TIMEOUT_MS) {
          if (__DEV__) console.log('[AUTH_STORE] Session expired (7-day inactivity)');
          await secureClear();
          set({ isAuthenticated: false, isLoading: false, user: null, accessToken: null, refreshToken: null });
          return;
        }
      }

      if (accessToken && refreshToken && userJson) {
        const user = JSON.parse(userJson) as AuthUser;
        set({
          isAuthenticated: true,
          isLoading: false,
          user,
          accessToken,
          refreshToken,
        });
        if (__DEV__) console.log(`[AUTH_STORE] Session restored: ${user.phone} (${user.role})`);
      } else {
        set({ isAuthenticated: false, isLoading: false });
      }
    } catch (err) {
      console.error('[AUTH_STORE] Hydration failed:', err);
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  /**
   * Store auth response from Truecaller verification.
   * PHASE 3: Merges employee profile data into user for navigation gating.
   */
  loginWithTruecaller: async (response: AuthResponse) => {
    const { user, accessToken, refreshToken, profile } = response;

    // Merge employee verification data into user object for navigation gating
    const enrichedUser: AuthUser = {
      ...user,
      employeeId: profile?.employee?.id ?? null,
      documentVerificationStatus: profile?.employee?.documentVerificationStatus ?? null,
      isOnline: profile?.employee?.isOnline ?? null,
      // Older servers omit this; treating a missing value as "complete" keeps
      // existing sessions out of the onboarding stack.
      onboardingCompleted: response.onboardingCompleted ?? true,
      pendingOnboardingSteps: response.pendingOnboardingSteps ?? [],
    };

    await Promise.all([
      secureSet(KEYS.ACCESS_TOKEN, accessToken),
      secureSet(KEYS.REFRESH_TOKEN, refreshToken),
      secureSet(KEYS.USER, JSON.stringify(enrichedUser)),
      secureSet(KEYS.LAST_ACTIVITY, Date.now().toString()),
    ]);

    set({
      isAuthenticated: true,
      isLoading: false,
      user: enrichedUser,
      accessToken,
      refreshToken,
    });

    if (__DEV__) console.log(`[AUTH_STORE] Logged in: ${enrichedUser.phone} (${enrichedUser.role}) docStatus=${enrichedUser.documentVerificationStatus}`);
  },

  /**
   * Refresh access + refresh tokens (rotation)
   */
  refreshTokens: async () => {
    const { refreshToken } = get();
    if (!refreshToken) return false;

    try {
      const { data } = await authApi.refreshToken(refreshToken);
      if (data.accessToken && data.refreshToken) {
        await get().setTokens(data.accessToken, data.refreshToken);
        return true;
      }
    } catch (err) {
      console.warn('[AUTH_STORE] Token refresh failed:', err);
    }

    return false;
  },

  /**
   * Manually update tokens (used by API client interceptor)
   */
  setTokens: async (accessToken: string, refreshToken: string) => {
    await Promise.all([
      secureSet(KEYS.ACCESS_TOKEN, accessToken),
      secureSet(KEYS.REFRESH_TOKEN, refreshToken),
      secureSet(KEYS.LAST_ACTIVITY, Date.now().toString()),
    ]);
    set({ accessToken, refreshToken });
  },

  /**
   * Clear all auth state and revoke tokens
   */
  logout: async () => {
    // Drop the push token FIRST, while the access token is still valid — this
    // device is registered against the outgoing user id, so skipping it would
    // deliver their notifications to whoever signs in next.
    // Required lazily: notifications → apiClient → auth.store is a cycle at
    // module scope, and Metro would hand one of them a half-initialised module.
    try {
      const { NotificationService } = require('../services/notifications');
      await NotificationService.unregisterToken();
    } catch {
      // Best effort — the server prunes dead tokens on its next send.
    }

    try {
      await authApi.logout();
    } catch {
      // Best effort — still clear local state
    }

    await secureClear();
    set({
      isAuthenticated: false,
      isLoading: false,
      user: null,
      accessToken: null,
      refreshToken: null,
    });

    if (__DEV__) console.log('[AUTH_STORE] Logged out');
  },

  /**
   * Record user activity (resets 7-day inactivity timer)
   */
  recordActivity: () => {
    secureSet(KEYS.LAST_ACTIVITY, Date.now().toString());
  },

  /**
   * Update user data in store + SecureStore
   */
  updateUser: (updates: Partial<AuthUser>) => {
    const current = get().user;
    if (!current) return;

    const updated = { ...current, ...updates };
    set({ user: updated });
    secureSet(KEYS.USER, JSON.stringify(updated));
  },

  /**
   * Pull the authoritative onboarding state from the server.
   * GET /api/client/profile derives it from the stored data, so this also picks
   * up the name/address written by the step that just completed.
   */
  refreshOnboardingStatus: async () => {
    const current = get().user;
    if (!current) return false;

    try {
      const { data } = await customerApi.getProfile();
      const profile: any = data?.data ?? {};

      const updated: AuthUser = {
        ...current,
        username: profile.username ?? current.username,
        email: profile.email ?? current.email,
        homeAddress: profile.homeAddress ?? current.homeAddress,
        pinCode: profile.pinCode ?? current.pinCode,
        onboardingCompleted: profile.onboardingCompleted ?? current.onboardingCompleted,
        // Refreshed alongside the flag so the onboarding stack always resumes at
        // the step the server still considers outstanding.
        pendingOnboardingSteps: profile.pendingOnboardingSteps ?? current.pendingOnboardingSteps,
      };

      set({ user: updated });
      await secureSet(KEYS.USER, JSON.stringify(updated));
      return updated.onboardingCompleted;
    } catch (err) {
      if (__DEV__) console.warn('[AUTH_STORE] Onboarding status refresh failed:', err);
      return current.onboardingCompleted;
    }
  },
}));
