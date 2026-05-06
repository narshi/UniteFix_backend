/**
 * Structured Auth Error Handling
 *
 * Maps backend error codes → user-friendly messages.
 * Eliminates generic "Something went wrong" catch-alls.
 */

// ─── Error codes ──────────────────────────────────────────────────────────

export type AuthErrorCode =
    | 'INVALID_CREDENTIALS'
    | 'USER_NOT_FOUND'
    | 'EMAIL_TAKEN'
    | 'INVALID_OTP'
    | 'OTP_EXPIRED'
    | 'OTP_MAX_ATTEMPTS'
    | 'TOO_MANY_REQUESTS'
    | 'NETWORK_ERROR'
    | 'SESSION_EXPIRED'
    | 'ACCOUNT_LOCKED'
    | 'UNKNOWN';

export interface AuthError {
    code: AuthErrorCode;
    message: string;       // user-facing
    isRetryable: boolean;
}

// ─── User-facing messages ─────────────────────────────────────────────────

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
    INVALID_CREDENTIALS: 'Incorrect email or password. Please try again.',
    USER_NOT_FOUND:      'No account found with this email or phone.',
    EMAIL_TAKEN:         'This email is already registered. Please log in instead.',
    INVALID_OTP:         'Incorrect code. Please check and try again.',
    OTP_EXPIRED:         'This code has expired. Please request a new one.',
    OTP_MAX_ATTEMPTS:    'Too many incorrect attempts. Please request a new code.',
    TOO_MANY_REQUESTS:   'Too many requests. Please wait a few minutes and try again.',
    NETWORK_ERROR:       'Network error. Please check your connection and try again.',
    SESSION_EXPIRED:     'Your session has expired. Please log in again.',
    ACCOUNT_LOCKED:      'Your account has been temporarily locked. Please contact support.',
    UNKNOWN:             'Something went wrong. Please try again.',
};

const RETRYABLE: Set<AuthErrorCode> = new Set([
    'INVALID_OTP', 'OTP_EXPIRED', 'NETWORK_ERROR', 'UNKNOWN',
]);

// ─── Parser ───────────────────────────────────────────────────────────────

/**
 * Converts any thrown error (axios, network, or backend) into a
 * structured AuthError that components can act on.
 */
export function parseAuthError(error: unknown): AuthError {
    // Axios / fetch errors
    if (typeof error === 'object' && error !== null) {
        const err = error as any;

        // Network-level failure (no response)
        if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || !err.response) {
            return makeError('NETWORK_ERROR');
        }

        const status: number = err.response?.status ?? 0;
        const serverMessage: string = (
            err.response?.data?.message || ''
        ).toLowerCase();

        // 429 — rate limited
        if (status === 429) return makeError('TOO_MANY_REQUESTS');

        // 401 Unauthorized
        if (status === 401) {
            if (serverMessage.includes('session') || serverMessage.includes('expired')) {
                return makeError('SESSION_EXPIRED');
            }
            return makeError('INVALID_CREDENTIALS');
        }

        // 400 Bad Request — parse message content
        if (status === 400) {
            if (serverMessage.includes('already registered') || serverMessage.includes('email taken')) {
                return makeError('EMAIL_TAKEN');
            }
            if (serverMessage.includes('invalid') && serverMessage.includes('otp')) {
                return makeError('INVALID_OTP');
            }
            if (serverMessage.includes('expired')) {
                return makeError('OTP_EXPIRED');
            }
            if (serverMessage.includes('attempts')) {
                return makeError('OTP_MAX_ATTEMPTS');
            }
            if (serverMessage.includes('not found') || serverMessage.includes('no account')) {
                return makeError('USER_NOT_FOUND');
            }
            if (serverMessage.includes('locked')) {
                return makeError('ACCOUNT_LOCKED');
            }
        }

        // 404
        if (status === 404) return makeError('USER_NOT_FOUND');

        // 423 Locked
        if (status === 423) return makeError('ACCOUNT_LOCKED');
    }

    return makeError('UNKNOWN');
}

function makeError(code: AuthErrorCode): AuthError {
    return {
        code,
        message: AUTH_ERROR_MESSAGES[code],
        isRetryable: RETRYABLE.has(code),
    };
}

/**
 * Quick helper — just get the message string.
 * Use parseAuthError() if you need to branch on the code.
 */
export function getAuthErrorMessage(error: unknown): string {
    return parseAuthError(error).message;
}
