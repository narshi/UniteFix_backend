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

    // Public endpoints (health check, static resources)
    public: {
        windowMs: 60 * 1000,  // 1 minute
        max: 20,              // 20 requests per minute
        message: 'Too many public requests. Please slow down.',
    },
};
