import rateLimit from "express-rate-limit";
import { RATE_LIMIT_CONFIG } from "../config/rate-limit-config";

// Create rate limiters based on config
export const authLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.auth.windowMs,
    max: RATE_LIMIT_CONFIG.auth.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.auth.message },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Phone/OTP identity verification. See RATE_LIMIT_CONFIG.identity for why this
 * is much looser than `authLimiter` — in short, the strict limit was locking out
 * real users mid-signup and, being per-IP, punished everyone behind a carrier
 * NAT rather than any attacker.
 */
export const identityLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.identity.windowMs,
    max: RATE_LIMIT_CONFIG.identity.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.identity.message },
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Token refresh and logout. See RATE_LIMIT_CONFIG.session — refreshing is a
 * routine operation on a 15-minute cycle, not a credential guess, and the
 * strict auth limit was signing users out and costing them an OTP.
 */
export const sessionLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.session.windowMs,
    max: RATE_LIMIT_CONFIG.session.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.session.message },
    standardHeaders: true,
    legacyHeaders: false,
});

export const mobileLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.mobileApi.windowMs,
    max: RATE_LIMIT_CONFIG.mobileApi.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.mobileApi.message },
    standardHeaders: true,
    legacyHeaders: false,
});

export const partnerLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.partnerApi.windowMs,
    max: RATE_LIMIT_CONFIG.partnerApi.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.partnerApi.message },
    standardHeaders: true,
    legacyHeaders: false,
});

export const adminLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.adminApi.windowMs,
    max: RATE_LIMIT_CONFIG.adminApi.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.adminApi.message },
    standardHeaders: true,
    legacyHeaders: false,
});

export const publicLimiter = rateLimit({
    windowMs: RATE_LIMIT_CONFIG.public.windowMs,
    max: RATE_LIMIT_CONFIG.public.max,
    message: { success: false, message: RATE_LIMIT_CONFIG.public.message },
    standardHeaders: true,
    legacyHeaders: false,
});
