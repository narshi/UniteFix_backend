/**
 * Which capability does each admin endpoint need?
 *
 * ONE MAP, mounted once on /api/admin, rather than a `requireCapability(...)`
 * argument on each of ~100 route definitions. Two reasons:
 *
 *   1. Tagging routes individually means a new route added later is
 *      unprotected by DEFAULT and nobody notices. Here the default is DENY:
 *      an unmapped admin path is refused outright, so forgetting to map a new
 *      feature fails loudly and safely instead of quietly granting it to
 *      everyone.
 *   2. The whole access model is auditable on one screen. Spread across a
 *      hundred call sites, "what can a Manager actually reach?" stops being a
 *      question anyone can answer.
 *
 * The method decides the level: GET/HEAD need `:view`, everything else needs
 * `:manage`. `manage` implies `view` (see shared/capabilities.ts), so a role
 * granted manage on an area can also read it.
 *
 * FIRST MATCH WINS — order the list most-specific first.
 */

import type { Request, Response, NextFunction } from 'express';
import { CAPABILITY_AREA_BY_KEY } from '@shared/capabilities';
import logger from '../lib/logger';

interface Rule {
    /** Matched against the path AFTER the /api/admin prefix, e.g. "/users/12/status". */
    test: RegExp;
    area: string;
    /** Force a level regardless of method. */
    force?: 'view' | 'manage';
}

/**
 * Paths every authenticated admin may reach whatever their role — asking who
 * you are, and signing in. Gating /me on a capability would make a role with an
 * empty grant list unable to even load the dashboard shell and discover that.
 */
const ALWAYS_ALLOWED: RegExp[] = [
    /^\/auth(\/|$)/,
    /^\/me$/,
];

const RULES: Rule[] = [
    // --- Platform ---------------------------------------------------------
    // Raw SQL: manage-level whatever the method, because a SELECT here can read
    // every table in the database.
    { test: /^\/db(\/|$)/, area: 'db_console', force: 'manage' },
    { test: /^\/audit-logs(\/|$)/, area: 'audit' },
    { test: /^\/admins(\/|$)/, area: 'accounts' },
    { test: /^\/roles(\/|$)/, area: 'accounts' },
    { test: /^\/config(\/|$)/, area: 'settings' },

    // --- Account deletion, split by what is being deleted ------------------
    // /accounts/:kind/... where kind is 'user' or 'employee'. Deleting a
    // customer and deleting an expert are different powers, so they map to
    // different areas rather than one blanket grant.
    { test: /^\/accounts\/user(\/|$)/, area: 'customers', force: 'manage' },
    { test: /^\/accounts\/employee(\/|$)/, area: 'employees', force: 'manage' },

    // --- Growth -----------------------------------------------------------
    { test: /^\/ftth(\/|$)/, area: 'ftth' },
    { test: /^\/notifications(\/|$)/, area: 'marketing' },

    // --- Money ------------------------------------------------------------
    { test: /^\/withdrawals(\/|$)/, area: 'withdrawals' },
    { test: /^\/manual-bills(\/|$)/, area: 'billing' },
    { test: /^\/payments(\/|$)/, area: 'payments' },
    { test: /^\/invoices(\/|$)/, area: 'payments' },

    // --- Catalogue --------------------------------------------------------
    { test: /^\/catalog(\/|$)/, area: 'catalog' },
    { test: /^\/categories(\/|$)/, area: 'catalog' },
    { test: /^\/category-technician-types(\/|$)/, area: 'catalog' },
    { test: /^\/technician-types(\/|$)/, area: 'catalog' },
    { test: /^\/districts(\/|$)/, area: 'locations' },
    { test: /^\/locations(\/|$)/, area: 'locations' },
    { test: /^\/location-stats(\/|$)/, area: 'locations' },
    { test: /^\/pincodes(\/|$)/, area: 'locations' },

    // --- People -----------------------------------------------------------
    { test: /^\/servicemen(\/|$)/, area: 'employees' },
    { test: /^\/technicians(\/|$)/, area: 'employees' },
    { test: /^\/users(\/|$)/, area: 'customers' },

    // --- Operations -------------------------------------------------------
    { test: /^\/tickets(\/|$)/, area: 'support' },
    { test: /^\/inventory(\/|$)/, area: 'inventory' },
    { test: /^\/products(\/|$)/, area: 'orders' },
    { test: /^\/returns(\/|$)/, area: 'orders' },
    { test: /^\/orders(\/|$)/, area: 'orders' },

    // Bookings LAST among operations: /services matches a lot, and
    // /services/:id/reconcile-payment is still a booking action.
    { test: /^\/assignment-queue(\/|$)/, area: 'bookings' },
    { test: /^\/services(\/|$)/, area: 'bookings' },

    // --- Dashboard --------------------------------------------------------
    { test: /^\/stats(\/|$)/, area: 'dashboard' },
    { test: /^\/revenue(\/|$)/, area: 'dashboard' },
    { test: /^\/reports(\/|$)/, area: 'dashboard' },
];

/** Resolve the capability an admin request needs, or null if always allowed. */
export function capabilityForAdminPath(method: string, subPath: string): string | null | undefined {
    if (ALWAYS_ALLOWED.some(re => re.test(subPath))) return null;

    const rule = RULES.find(r => r.test.test(subPath));
    if (!rule) return undefined;  // unmapped → deny

    const isRead = method === 'GET' || method === 'HEAD';
    const area = CAPABILITY_AREA_BY_KEY[rule.area];
    const level = rule.force ?? (isRead ? 'view' : 'manage');
    // An area with no read-only mode only ever grants manage.
    return `${rule.area}:${area?.manageOnly ? 'manage' : level}`;
}

/**
 * Mount ONCE, immediately after the global authenticateAdmin on /api/admin.
 *
 * Deliberately fails CLOSED on an unmapped path: a new admin endpoint is
 * inaccessible until someone adds it to RULES above. That is noisy for whoever
 * adds the feature and silent for everyone else, which is the right way round —
 * the alternative is a new endpoint being reachable by every role by accident.
 */
export function adminCapabilityGuard(req: Request, res: Response, next: NextFunction) {
    const admin = (req as any).admin as
        { userId: number; role: string; capabilities?: Set<string> } | undefined;

    // No admin on the request means this ran before authentication, or on a
    // path authentication skipped (login). Nothing to enforce.
    if (!admin) return next();

    // req.path here is already relative to the /api/admin mount point.
    const subPath = req.path;
    const required = capabilityForAdminPath(req.method, subPath);

    if (required === null) return next();

    if (required === undefined) {
        logger.error('[CAPABILITY] Unmapped admin endpoint — denying', {
            method: req.method, path: subPath, adminId: admin.userId,
        });
        return res.status(403).json({
            success: false,
            code: 'CAPABILITY_UNMAPPED',
            message: 'This endpoint has no access rule configured. Please report this.',
        });
    }

    if (!admin.capabilities?.has(required)) {
        logger.warn('[CAPABILITY] Refused', {
            adminId: admin.userId, role: admin.role, required,
            method: req.method, path: subPath,
        });
        const area = CAPABILITY_AREA_BY_KEY[required.split(':')[0]];
        return res.status(403).json({
            success: false,
            code: 'CAPABILITY_REQUIRED',
            capability: required,
            message: area
                ? `Your role does not allow you to ${required.endsWith(':manage') ? 'change' : 'view'} ${area.label}.`
                : 'Your role does not allow this action.',
        });
    }

    next();
}
