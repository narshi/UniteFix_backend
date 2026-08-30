/**
 * PHASE 2: Rate Limit Configuration
 * 
 * Extensible rate limiting configuration per endpoint category.
 * Different limits for auth, mobile, partner, and admin endpoints.
 */

export interface RateLimitConfig {
    windowMs: number;  // Time window in milliseconds
    max: number;       // Maximum requests per window
    message: string;   // Error message when limit exceeded
}

export const RATE_LIMIT_CONFIG: Record<string, RateLimitConfig> = {
    // Credential endpoints — password login, password reset. Strict, because
    // these are the ones worth brute-forcing.
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5,                    // 5 attempts per window
        message: 'Too many authentication attempts. Please try again later.',
    },

    // Phone/OTP identity verification — Truecaller, Firebase, phone checks.
    //
    // Deliberately far more generous than `auth`, for two reasons:
    //
    //  1. A normal signup legitimately makes several calls (check-phone, then a
    //     verification, sometimes a retry). At 5 per 15 minutes users were being
    //     locked out after two or three attempts — which read as "the app blocked
    //     me" and was the actual cause, not Firebase.
    //
    //  2. This limiter keys on IP, and mobile carriers put thousands of
    //     subscribers behind one NAT gateway. A tight per-IP limit here does not
    //     stop an attacker (who can rotate IPs) but does lock out unrelated real
    //     users sharing a carrier. The genuine abuse protection for phone auth is
    //     Firebase's own per-number throttle and the SMS cost itself.
    identity: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 40,
        message: 'Too many verification attempts. Please wait a few minutes and try again.',
    },

    /**
     * Token refresh and logout.
     *
     * These were falling under `auth` (5 per 15 minutes, keyed on IP) and that
     * was the cause of the short-interval logouts. Access tokens live 15
     * minutes, so every signed-in device refreshes roughly every 15 minutes, and
     * mobile carriers NAT thousands of subscribers behind one address — a
     * handful of users on the same carrier IP exhausted the window almost
     * immediately. The refresh then 429'd and the app signed them out, so they
     * had to request a fresh OTP.
     *
     * A strict limit buys nothing here anyway: refresh presents a 64-byte random
     * token, so there is no credential to guess. This is generous enough for
     * many devices behind one NAT while still capping a runaway client.
     */
    session: {
        windowMs: 15 * 60 * 1000,
        max: 300,
        message: 'Too many session requests. Please try again shortly.',
    },

    // Mobile app endpoints - moderate limits
    mobileApi: {
        windowMs: 60 * 1000,  // 1 minute
        max: 60,              // 60 requests per minute
        message: 'Too many requests from mobile app. Please slow down.',
    },

    // Partner app endpoints - higher limits (location updates are frequent)
    partnerApi: {
        windowMs: 60 * 1000,  // 1 minute
        max: 100,             // 100 requests per minute
        message: 'Too many requests from partner app. Please slow down.',
    },

    // Admin dashboard endpoints - highest limits
    adminApi: {
        windowMs: 60 * 1000,  // 1 minute
        max: 200,             // 200 requests per minute
        message: 'Too many admin requests. Please slow down.',
    },

    /**
     * FTTH operator applications.
     *
     * Its OWN bucket, deliberately not `auth`. express-rate-limit keys per
     * limiter instance, so mounting the application form on `authLimiter` would
     * have meant a handful of submissions from an office IP exhausting the same
     * five-per-15-minutes budget that /api/admin/auth/login uses — locking staff
     * out of the dashboard because an ISP filled in a form.
     *
     * Still tight: every submission lands in a super_admin's review queue, so
     * the cost of abuse is a human reading spam.
     */
    operatorApply: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5,
        message: 'Too many applications from this network. Please try again later.',
    },

    // Public endpoints (health check, static resources)
    public: {
        windowMs: 60 * 1000,  // 1 minute
        max: 20,              // 20 requests per minute
        message: 'Too many public requests. Please slow down.',
    },
};
