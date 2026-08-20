/**
 * JWT Token Service — P0 FIX: Refresh tokens persisted in PostgreSQL
 * 
 * Handles access + refresh token lifecycle for mobile apps.
 * - Access token: short-lived (15 min) — used in Authorization header
 * - Refresh token: long-lived (30 days) — stored as hashed value in DB
 * 
 * Flow:
 * 1. Login → returns { accessToken, refreshToken }
 * 2. API calls use accessToken
 * 3. When accessToken expires → POST /api/auth/refresh with refreshToken
 * 4. Returns new { accessToken, refreshToken } (rotation)
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import logger from "../lib/logger";
import { db } from "../db";
import { refreshTokens } from "@shared/schema";
import { eq, lt, and } from "drizzle-orm";

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.JWT_SECRET;

// Use a separate secret for refresh tokens (derived from JWT_SECRET)
const REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '_refresh';

export interface TokenPayload {
    userId: number;
    role: string;
    phone?: string;
    partnerId?: number;
    username?: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number; // seconds until access token expires
}

export class TokenService {
    static readonly ACCESS_TOKEN_EXPIRY = '15m';
    static readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;
    /**
     * How long a just-rotated refresh token keeps working. Long enough to
     * survive a lost write or a retry, short enough that a leaked token is
     * useless almost immediately.
     */
    static readonly ROTATION_GRACE_MS = 60 * 1000;

    /**
     * Generate access + refresh token pair.
     * Refresh token is stored as SHA-256 hash in the database.
     */
    static async generateTokenPair(payload: TokenPayload, deviceInfo?: string): Promise<TokenPair> {
        const accessToken = jwt.sign(payload, JWT_SECRET, {
            expiresIn: this.ACCESS_TOKEN_EXPIRY,
        });

        const refreshToken = crypto.randomBytes(64).toString('hex');
        const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

        // Persist to database
        await db.insert(refreshTokens).values({
            userId: payload.userId,
            tokenHash: refreshHash,
            userRole: payload.role,
            deviceInfo: deviceInfo || null,
            expiresAt,
        });

        return {
            accessToken,
            refreshToken,
            expiresIn: 900, // 15 minutes in seconds
        };
    }

    /**
     * Generate a backward-compatible long-lived token (for admin dashboard)
     * Admin tokens don't need refresh flow since sessions are shorter
     */
    static generateAdminToken(payload: TokenPayload): string {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    }

    /**
     * Generate a backward-compatible long-lived token (for legacy mobile flow)
     * Use generateTokenPair() for new mobile app
     */
    static generateLegacyToken(payload: TokenPayload): string {
        return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    }

    /**
     * Refresh: validate refresh token, return new token pair.
     * Old refresh token is invalidated (rotation).
     */
    static async refreshTokens(refreshToken: string): Promise<TokenPair | null> {
        const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

        // Find the token in the database
        const [stored] = await db.select().from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, refreshHash));

        if (!stored) {
            logger.warn('Refresh token not found (expired or already used)');
            return null;
        }

        // Inside the grace window this is a token we rotated moments ago. Not an
        // error - it is the retry path that keeps a client with a lost write
        // signed in - but worth seeing, because repeated reuse of one token from
        // different devices is what theft looks like.
        if (stored.expiresAt.getTime() - Date.now() <= this.ROTATION_GRACE_MS) {
            logger.info('Refresh token reused inside rotation grace window', {
                userId: stored.userId,
                msLeft: stored.expiresAt.getTime() - Date.now(),
            });
        }

        if (new Date() > stored.expiresAt) {
            // Delete expired token
            await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id));
            logger.warn('Refresh token expired', { userId: stored.userId });
            return null;
        }

        // Rotate, but with a GRACE WINDOW rather than an immediate delete.
        //
        // Deleting straight away meant any client that failed to persist the new
        // token got permanently signed out: the app is killed mid-refresh, or the
        // SecureStore write fails, and the next launch presents a token the
        // server has already destroyed. The only way back is a fresh OTP, which
        // is what was burning the SMS quota.
        //
        // Keeping the old row valid for a few more seconds lets exactly that case
        // recover, while still ending the token’s life almost immediately. Reuse
        // is logged so a genuinely stolen token is still visible.
        const graceUntil = new Date(Date.now() + this.ROTATION_GRACE_MS);
        if (stored.expiresAt > graceUntil) {
            await db.update(refreshTokens)
                .set({ expiresAt: graceUntil })
                .where(eq(refreshTokens.id, stored.id));
        }

        // Generate new pair with the stored payload
        const payload: TokenPayload = {
            userId: stored.userId,
            role: stored.userRole,
        };

        return this.generateTokenPair(payload, stored.deviceInfo || undefined);
    }

    /**
     * Revoke all refresh tokens for a user (logout from all devices)
     */
    static async revokeUserTokens(userId: number): Promise<void> {
        const result = await db.delete(refreshTokens)
            .where(eq(refreshTokens.userId, userId));
        logger.info('Revoked all refresh tokens', { userId });
    }

    /**
     * Verify an access token
     */
    static verifyAccessToken(token: string): TokenPayload | null {
        try {
            return jwt.verify(token, JWT_SECRET) as TokenPayload;
        } catch {
            return null;
        }
    }

    /**
     * Cleanup expired refresh tokens from DB.
     * Called by background jobs.
     */
    static async cleanupExpiredTokens(): Promise<number> {
        const result = await db.delete(refreshTokens)
            .where(lt(refreshTokens.expiresAt, new Date()));
        const count = (result as any).rowCount || 0;
        if (count > 0) {
            logger.info(`Cleaned up ${count} expired refresh tokens`);
        }
        return count;
    }
}
