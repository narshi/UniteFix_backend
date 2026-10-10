/**
 * Where UniteFix lives on the web.
 *
 *   PUBLIC_APP_URL   https://app.unitefix.com — the Partner Hub, every link
 *                    people share (newspapers, pay links, quotations, halls…)
 *                    and the API
 *   ADMIN_APP_URL    https://admin.unitefix.com — the staff dashboard
 *
 * Both point at this same Render service. Until they are set (the domains are
 * verified on Render first), everything keeps working on the onrender.com
 * address exactly as before.
 *
 * The onrender.com address never goes away: app builds already installed call
 * its API. Pages opened on it are sent to the real domain instead, so the
 * Render address stops appearing in browsers and in the links people copy.
 */

import type { Request, Response, NextFunction } from 'express';

const clean = (u: string | undefined) => (u ?? '').trim().replace(/\/+$/, '');

/** The address for links people open and share; '' when no domain is configured. */
export function publicAppUrl(): string {
    return clean(process.env.PUBLIC_APP_URL) || clean(process.env.HUB_BASE_URL) || clean(process.env.CLIENT_URL);
}
export function adminAppUrl(): string {
    return clean(process.env.ADMIN_APP_URL) || publicAppUrl();
}

/** Browser origins on our own domains, for CORS. */
export function ownOrigins(): string[] {
    return [clean(process.env.PUBLIC_APP_URL), clean(process.env.ADMIN_APP_URL)].filter(Boolean);
}

/**
 * Pages requested on the onrender.com address move to the real domain (301).
 * Not moved: the API (installed apps and payment webhooks call it there), the
 * newspaper reader an app WebView opens, and anything that is not a page load.
 */
export function canonicalHost() {
    return (req: Request, res: Response, next: NextFunction) => {
        const app = clean(process.env.PUBLIC_APP_URL);
        if (!app || !/\.onrender\.com$/i.test(req.hostname)) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const p = req.path;
        if (p.startsWith('/api/') || p === '/api' || p.startsWith('/news/read/') || p.startsWith('/pdfjs/') || p.startsWith('/.well-known/')) return next();
        const target = p === '/admin' || p.startsWith('/admin/') ? adminAppUrl() : app;
        res.redirect(301, `${target}${req.originalUrl}`);
    };
}

/**
 * Android App Links: lets https://app.unitefix.com/news/… links open the
 * UniteFix app directly. ANDROID_CERT_SHA256 is the app-signing certificate
 * fingerprint from Play Console (comma-separate several).
 */
export function assetLinks(_req: Request, res: Response) {
    const prints = (process.env.ANDROID_CERT_SHA256 ?? '').split(',').map(s => s.trim().toUpperCase()).filter(s => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
    if (!prints.length) return res.status(404).json([]);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.unitefix.app', sha256_cert_fingerprints: prints } }]);
}
