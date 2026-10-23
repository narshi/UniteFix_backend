/**
 * Forcing an app update.
 *
 * Staff set, on Admin → Settings → App updates:
 *   latest version code   the newest build in the store (a soft "update available")
 *   minimum version code  anything older must update before it can be used
 *   message / store links what the "Update required" screen says and opens
 *   block older builds    see below
 *
 * Builds that carry this (versionCode 32 on) send X-App-Version-Code on every
 * request and check /api/client/app-version on start and on foreground: below
 * the minimum they show a full-screen "Update required" that cannot be
 * dismissed. The server refuses their requests too (HTTP 426), so a screen
 * left open cannot keep working.
 *
 * Builds before that send no version, so they cannot draw that screen. They
 * are still recognisable — they talk to us as the Android/iOS app (okhttp /
 * CFNetwork) with no version header — and "block older builds" refuses their
 * requests with the update message, which they show as an error. Off by
 * default: it is a blunt instrument, for when old installs must stop.
 *
 * Browsers (admin, Partner Hub, website) send neither and are never affected.
 */

import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { platformConfig } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { configService } from '../services/config.service';
import logger from './logger';

export type AppVersionPolicy = {
    minVersionCode: number;
    latestVersionCode: number;
    message: string;
    androidUrl: string;
    iosUrl: string;
    blockLegacy: boolean;
};

const KEYS = {
    minVersionCode: 'APP_CONFIG.MIN_VERSION_CODE',
    latestVersionCode: 'APP_CONFIG.LATEST_VERSION_CODE',
    message: 'APP_CONFIG.UPDATE_MESSAGE',
    androidUrl: 'APP_CONFIG.UPDATE_URL',
    iosUrl: 'APP_CONFIG.IOS_UPDATE_URL',
    blockLegacy: 'APP_CONFIG.BLOCK_LEGACY_BUILDS',
} as const;

const DEFAULTS: AppVersionPolicy = {
    minVersionCode: 0,
    latestVersionCode: 0,
    message: 'A new version of UniteFix is available. Please update to keep using the app.',
    androidUrl: 'market://details?id=com.unitefix.app',
    iosUrl: '',
    blockLegacy: false,
};

let cached: { at: number; policy: AppVersionPolicy } | null = null;
const TTL_MS = 60_000;

export async function appVersionPolicy(): Promise<AppVersionPolicy> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.policy;
    const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };
    const policy: AppVersionPolicy = {
        minVersionCode: num(await configService.get(KEYS.minVersionCode, DEFAULTS.minVersionCode), 0),
        latestVersionCode: num(await configService.get(KEYS.latestVersionCode, DEFAULTS.latestVersionCode), 0),
        message: String(await configService.get(KEYS.message, DEFAULTS.message) || DEFAULTS.message),
        androidUrl: String(await configService.get(KEYS.androidUrl, DEFAULTS.androidUrl) || DEFAULTS.androidUrl),
        iosUrl: String(await configService.get(KEYS.iosUrl, DEFAULTS.iosUrl) || ''),
        blockLegacy: String(await configService.get(KEYS.blockLegacy, false)) === 'true',
    };
    cached = { at: Date.now(), policy };
    return policy;
}

export class AppVersionError extends Error {}

/** Save from the admin screen. Validated so a typo cannot lock everyone out by accident. */
export async function saveAppVersionPolicy(input: Partial<Record<keyof AppVersionPolicy, unknown>>, adminId: number | null): Promise<AppVersionPolicy> {
    const current = await appVersionPolicy();
    const int = (v: unknown, name: string) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new AppVersionError(`${name} must be a whole number (the build's version code, e.g. 32).`);
        return n;
    };
    const next: AppVersionPolicy = {
        minVersionCode: int(input.minVersionCode, 'Minimum version code') ?? current.minVersionCode,
        latestVersionCode: int(input.latestVersionCode, 'Latest version code') ?? current.latestVersionCode,
        message: input.message !== undefined ? String(input.message).trim().slice(0, 300) || DEFAULTS.message : current.message,
        androidUrl: input.androidUrl !== undefined ? String(input.androidUrl).trim() || DEFAULTS.androidUrl : current.androidUrl,
        iosUrl: input.iosUrl !== undefined ? String(input.iosUrl).trim() : current.iosUrl,
        blockLegacy: input.blockLegacy !== undefined ? input.blockLegacy === true || input.blockLegacy === 'true' : current.blockLegacy,
    };
    if (next.minVersionCode > 0 && next.latestVersionCode > 0 && next.minVersionCode > next.latestVersionCode) {
        throw new AppVersionError(`The minimum (${next.minVersionCode}) is above the latest version in the store (${next.latestVersionCode}): nobody could update past it. Raise the latest first.`);
    }
    for (const u of [next.androidUrl, next.iosUrl].filter(Boolean)) {
        if (!/^(market:\/\/|https:\/\/|itms-apps:\/\/)/.test(u)) throw new AppVersionError('Store links start with market://, https:// or itms-apps://.');
    }
    const rows: Array<[string, string, string]> = [
        [KEYS.minVersionCode, String(next.minVersionCode), 'number'],
        [KEYS.latestVersionCode, String(next.latestVersionCode), 'number'],
        [KEYS.message, next.message, 'string'],
        [KEYS.androidUrl, next.androidUrl, 'string'],
        [KEYS.iosUrl, next.iosUrl, 'string'],
        [KEYS.blockLegacy, String(next.blockLegacy), 'boolean'],
    ];
    for (const [key, value, valueType] of rows) {
        await db.insert(platformConfig).values({ key, value, valueType, category: 'APP_CONFIG', description: 'App update policy (Settings → App updates)', isEditable: true, updatedBy: adminId ?? undefined } as any)
            .onConflictDoUpdate({ target: platformConfig.key, set: { value, updatedBy: adminId ?? undefined } as any });
        configService.invalidate(key);
    }
    cached = null;
    return appVersionPolicy();
}

/** What a client reads to decide; the legacy fields stay for older callers. */
export async function appVersionInfo(platform: string) {
    const p = await appVersionPolicy();
    const updateUrl = platform === 'ios' ? (p.iosUrl || p.androidUrl) : p.androidUrl;
    return { minVersionCode: p.minVersionCode, latestVersionCode: p.latestVersionCode, message: p.message, updateUrl, androidUrl: p.androidUrl, iosUrl: p.iosUrl, platform };
}

// Server-to-server and public paths are never gated; nor is the version check itself.
const EXEMPT = /^\/api\/(client\/app-version|health|webhooks?\/|public\/|admin\/|razorpay|cashfree)/i;
const MOBILE_UA = /\bokhttp\/|CFNetwork|Dalvik\//i;

/** Refuses requests from app builds below the minimum (and, if switched on, from builds too old to say). */
export function appVersionGate() {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.path.startsWith('/api/') || EXEMPT.test(req.path)) return next();
            const raw = req.get('x-app-version-code');
            const p = await appVersionPolicy();
            if (p.minVersionCode <= 0 && !p.blockLegacy) return next();
            const platform = String(req.get('x-app-platform') ?? '').toLowerCase() === 'ios' ? 'ios' : 'android';
            const refuse = () => res.status(426).json({
                success: false, code: 'UPDATE_REQUIRED', message: p.message,
                updateUrl: platform === 'ios' ? (p.iosUrl || p.androidUrl) : p.androidUrl, minVersionCode: p.minVersionCode,
            });
            if (raw != null && raw !== '') {
                const v = Number(raw);
                if (Number.isFinite(v) && v > 0 && p.minVersionCode > 0 && v < p.minVersionCode) return refuse();
                return next();
            }
            if (p.blockLegacy && MOBILE_UA.test(req.get('user-agent') ?? '')) return refuse();
            return next();
        } catch (e: any) {
            // Never let the gate itself take the API down.
            logger.warn(`[APP_VERSION] gate skipped: ${e?.message}`);
            return next();
        }
    };
}
