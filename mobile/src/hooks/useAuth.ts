/**
 * useAuth — Login / session management hook
 *
 * Features:
 * - Password login
 * - OTP login (passwordless toggle)
 * - Brute-force protection (5 attempts → 60s lockout)
 * - Structured error handling
 * - Proper identifier parsing (email/phone)
 */

import { useState, useRef, useCallback } from 'react';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { parseIdentifier } from '../utils/validation';
import { parseAuthError } from '../utils/authErrors';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_S  = 60; // seconds

export type LoginMode = 'password' | 'otp';

export interface UseAuthReturn {
    // State
    identifier: string;
    setIdentifier: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    loginMode: LoginMode;
    setLoginMode: (mode: LoginMode) => void;

    // Validation errors
    errors: Record<string, string>;
    clearError: (field: string) => void;

    // Brute-force
    loginAttempts: number;
    lockoutRemaining: number;
    isLockedOut: boolean;

    // Loading
    loading: boolean;

    // Actions
    handlePasswordLogin: () => Promise<void>;
    handleRequestOtpLogin: () => Promise<{ email?: string; phone?: string } | null>;
}

export function useAuth(): UseAuthReturn {
    const [identifier, setIdentifierRaw] = useState('');
    const [password, setPassword] = useState('');
    const [loginMode, setLoginMode] = useState<LoginMode>('password');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Brute-force state
    const [loginAttempts, setLoginAttempts] = useState(0);
    const [lockoutRemaining, setLockoutRemaining] = useState(0);
    const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const { login: loginToStore } = useAuthStore();

    const isLockedOut = lockoutRemaining > 0;

    const setIdentifier = useCallback((v: string) => {
        setIdentifierRaw(v);
        if (errors.identifier) setErrors((e) => ({ ...e, identifier: '' }));
    }, [errors.identifier]);

    const clearError = useCallback((field: string) => {
        setErrors((e) => ({ ...e, [field]: '' }));
    }, []);

    const startLockout = useCallback(() => {
        if (lockoutTimer.current) clearInterval(lockoutTimer.current);
        setLockoutRemaining(LOCKOUT_DURATION_S);
        lockoutTimer.current = setInterval(() => {
            setLockoutRemaining((prev) => {
                if (prev <= 1) {
                    clearInterval(lockoutTimer.current!);
                    setLoginAttempts(0);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    const recordFailedAttempt = useCallback(() => {
        const next = loginAttempts + 1;
        setLoginAttempts(next);
        if (next >= MAX_LOGIN_ATTEMPTS) {
            startLockout();
        }
    }, [loginAttempts, startLockout]);

    // ── Validate fields before any API call ───────────────────────────────
    const validateIdentifier = useCallback((): ReturnType<typeof parseIdentifier> | null => {
        const parsed = parseIdentifier(identifier);
        if (parsed.error) {
            setErrors((e) => ({ ...e, identifier: parsed.error! }));
            return null;
        }
        return parsed;
    }, [identifier]);

    // ── Password Login ────────────────────────────────────────────────────
    const handlePasswordLogin = useCallback(async () => {
        if (isLockedOut || loading) return;

        const parsed = validateIdentifier();
        if (!parsed) return;

        if (!password) {
            setErrors((e) => ({ ...e, password: 'Password is required' }));
            return;
        }
        if (password.length < 6) {
            setErrors((e) => ({ ...e, password: 'Password must be at least 6 characters' }));
            return;
        }

        setLoading(true);
        setErrors({});

        try {
            const response = await authApi.login({
                email: parsed.type === 'email' ? parsed.normalized : undefined,
                phone: parsed.type === 'phone' ? parsed.normalized : undefined,
                password,
            });

            const { user, accessToken, refreshToken, token } = response.data;
            await loginToStore(user, accessToken || token, refreshToken || '');
            setLoginAttempts(0); // reset on success
        } catch (err) {
            const authErr = parseAuthError(err);
            recordFailedAttempt();
            const remaining = MAX_LOGIN_ATTEMPTS - loginAttempts - 1;
            const suffix = remaining > 0
                ? ` (${remaining} attempt${remaining > 1 ? 's' : ''} left)`
                : '';
            setErrors({ form: authErr.message + suffix });
        } finally {
            setLoading(false);
        }
    }, [isLockedOut, loading, identifier, password, loginAttempts, loginToStore, validateIdentifier, recordFailedAttempt]);

    // ── OTP Login — returns contact info to navigate to OTP screen ─────────
    const handleRequestOtpLogin = useCallback(async (): Promise<{ email?: string; phone?: string } | null> => {
        if (isLockedOut || loading) return null;

        const parsed = validateIdentifier();
        if (!parsed) return null;

        setLoading(true);
        setErrors({});

        try {
            await authApi.forgotPassword({
                email: parsed.type === 'email' ? parsed.normalized : undefined,
                phone: parsed.type === 'phone' ? parsed.normalized : undefined,
            });
            return {
                email: parsed.type === 'email' ? parsed.normalized : undefined,
                phone: parsed.type === 'phone' ? parsed.normalized : undefined,
            };
        } catch (err) {
            const authErr = parseAuthError(err);
            // USER_NOT_FOUND is deliberately generic on backend — don't leak it
            if (authErr.code === 'TOO_MANY_REQUESTS') {
                setErrors({ form: authErr.message });
            }
            // For other errors, still navigate to OTP screen to avoid user enumeration
            return {
                email: parsed.type === 'email' ? parsed.normalized : undefined,
                phone: parsed.type === 'phone' ? parsed.normalized : undefined,
            };
        } finally {
            setLoading(false);
        }
    }, [isLockedOut, loading, validateIdentifier]);

    return {
        identifier, setIdentifier,
        password, setPassword,
        loginMode, setLoginMode,
        errors, clearError,
        loginAttempts, lockoutRemaining, isLockedOut,
        loading,
        handlePasswordLogin,
        handleRequestOtpLogin,
    };
}
