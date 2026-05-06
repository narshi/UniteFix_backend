/**
 * useOtp — OTP state management hook
 *
 * Handles:
 * - Countdown timer (configurable cooldown)
 * - Attempt tracking with lockout
 * - Resend logic with idempotency
 * - Auto-reset on new send
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { authApi } from '../api/auth.api';
import { parseAuthError } from '../utils/authErrors';

const OTP_LENGTH = 6;
const DEFAULT_COOLDOWN = 30;  // seconds between resends
const MAX_ATTEMPTS = 5;        // lock out after this many wrong attempts

// ─── Types ────────────────────────────────────────────────────────────────

export interface UseOtpOptions {
    email?: string;
    phone?: string;
    purpose: 'signup' | 'reset' | 'login_otp';
    role?: 'user' | 'serviceman';
    cooldown?: number;   // seconds, default 30
}

export interface UseOtpReturn {
    // OTP digit state
    otp: string[];
    setOtp: (otp: string[]) => void;
    otpString: string;
    isComplete: boolean;

    // Timer
    resendTimer: number;
    canResend: boolean;

    // Status
    loading: boolean;
    resending: boolean;
    errorMessage: string | null;
    clearError: () => void;
    attempts: number;
    isLockedOut: boolean;

    // Actions
    handleDigitChange: (value: string, index: number) => void;
    handleKeyPress: (key: string, index: number) => void;
    handleVerify: () => Promise<void>;
    handleResend: () => Promise<void>;
    resetOtp: () => void;

    // Refs (for auto-focus)
    inputRefs: React.MutableRefObject<(any | null)[]>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useOtp(
    options: UseOtpOptions,
    onSuccess: (payload: any) => void,
): UseOtpReturn {
    const { email, phone, purpose, role, cooldown = DEFAULT_COOLDOWN } = options;

    const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [resendTimer, setResendTimer] = useState(cooldown);
    const [attempts, setAttempts] = useState(0);

    const inputRefs = useRef<(any | null)[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const isLockedOut = attempts >= MAX_ATTEMPTS;
    const otpString = otp.join('');
    const isComplete = otpString.length === OTP_LENGTH;
    const canResend = resendTimer === 0 && !resending && !isLockedOut;

    // ── Countdown timer ────────────────────────────────────────────────────
    const startTimer = useCallback((seconds = cooldown) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setResendTimer(seconds);
        timerRef.current = setInterval(() => {
            setResendTimer((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current!);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, [cooldown]);

    useEffect(() => {
        startTimer();
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, []);

    // ── OTP digit handling ─────────────────────────────────────────────────
    const resetOtp = useCallback(() => {
        setOtp(Array(OTP_LENGTH).fill(''));
        setErrorMessage(null);
        setTimeout(() => inputRefs.current[0]?.focus(), 50);
    }, []);

    const handleDigitChange = useCallback((value: string, index: number) => {
        if (isLockedOut) return;
        setErrorMessage(null);

        const digits = value.replace(/[^0-9]/g, '');

        // Handle paste — distribute digits
        if (digits.length > 1) {
            const newOtp = [...otp];
            digits.split('').slice(0, OTP_LENGTH).forEach((d, i) => {
                if (index + i < OTP_LENGTH) newOtp[index + i] = d;
            });
            setOtp(newOtp);
            const nextIdx = Math.min(index + digits.length, OTP_LENGTH - 1);
            setTimeout(() => inputRefs.current[nextIdx]?.focus(), 0);
            return;
        }

        const newOtp = [...otp];
        newOtp[index] = digits;
        setOtp(newOtp);

        if (digits && index < OTP_LENGTH - 1) {
            setTimeout(() => inputRefs.current[index + 1]?.focus(), 0);
        }
    }, [otp, isLockedOut]);

    const handleKeyPress = useCallback((key: string, index: number) => {
        if (key === 'Backspace' && !otp[index] && index > 0) {
            const newOtp = [...otp];
            newOtp[index - 1] = '';
            setOtp(newOtp);
            setTimeout(() => inputRefs.current[index - 1]?.focus(), 0);
        }
    }, [otp]);

    // ── Verify ─────────────────────────────────────────────────────────────
    const handleVerify = useCallback(async () => {
        if (!isComplete || loading || isLockedOut) return;

        setLoading(true);
        setErrorMessage(null);

        try {
            let payload: any;

            if (purpose === 'signup') {
                const res = await authApi.verifySignupOtp({
                    email: email || '',
                    otp: otpString,
                    role: (role as 'user' | 'serviceman') || 'user',
                });
                payload = res.data;
            } else if (purpose === 'reset') {
                const res = await authApi.verifyResetOtp({
                    email: email || undefined,
                    phone: phone || undefined,
                    otp: otpString,
                });
                payload = res.data;
            } else {
                // login_otp — future use
                payload = {};
            }

            setAttempts(0);
            onSuccess(payload);
        } catch (err) {
            const authErr = parseAuthError(err);
            const newAttempts = attempts + 1;
            setAttempts(newAttempts);

            if (newAttempts >= MAX_ATTEMPTS) {
                setErrorMessage(`Too many incorrect attempts. Please request a new code.`);
            } else {
                const remaining = MAX_ATTEMPTS - newAttempts;
                setErrorMessage(
                    authErr.code === 'OTP_EXPIRED'
                        ? 'This code has expired. Please request a new one.'
                        : `${authErr.message} (${remaining} attempt${remaining > 1 ? 's' : ''} left)`,
                );
            }

            // Clear boxes on wrong OTP — force re-entry
            if (['INVALID_OTP', 'OTP_EXPIRED'].includes(authErr.code)) {
                resetOtp();
            }
        } finally {
            setLoading(false);
        }
    }, [isComplete, loading, isLockedOut, purpose, email, phone, otpString, role, attempts, onSuccess, resetOtp]);

    // ── Resend ─────────────────────────────────────────────────────────────
    const handleResend = useCallback(async () => {
        if (!canResend) return;

        setResending(true);
        setErrorMessage(null);

        try {
            if (purpose === 'signup' && email) {
                await authApi.initiateSignup({ email, role: role || 'user' });
            } else if (purpose === 'reset') {
                await authApi.forgotPassword({
                    email: email || undefined,
                    phone: phone || undefined,
                });
            }
            setAttempts(0);
            resetOtp();
            startTimer();
        } catch (err) {
            setErrorMessage(parseAuthError(err).message);
        } finally {
            setResending(false);
        }
    }, [canResend, purpose, email, phone, role, resetOtp, startTimer]);

    return {
        otp, setOtp, otpString, isComplete,
        resendTimer, canResend,
        loading, resending, errorMessage, clearError: () => setErrorMessage(null),
        attempts, isLockedOut,
        handleDigitChange, handleKeyPress, handleVerify, handleResend, resetOtp,
        inputRefs,
    };
}
