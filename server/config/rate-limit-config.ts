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
    // Authentication endpoints - strict limits to prevent brute force
    auth: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5,                    // 5 attempts per window
        message: 'Too many authentication attempts. Please try again later.',
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
