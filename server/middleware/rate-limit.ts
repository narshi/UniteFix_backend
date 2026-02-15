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
