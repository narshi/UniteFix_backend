/**
 * The capability catalogue.
 *
 * ROLES ARE USER-CREATED. CAPABILITIES ARE NOT — and cannot be, because a
 * capability only means something if code checks it. Inventing "can approve
 * refunds" in the UI would grant nothing until someone writes the check. So the
 * catalogue is defined here, in code, and the Roles screen lets you compose it
 * into any role you like.
 *
 * Shared between server and dashboard deliberately: the middleware that enforces
 * a capability and the sidebar that hides a menu must read the same list, or the
 * UI eventually offers something the server refuses.
 *
 * Two levels per area:
 *   view    — read it
 *   manage  — change it (IMPLIES view; see `expandCapabilities`)
 *
 * SCOPE is the hard boundary, not a capability. A 'staff' role can never be
 * given operator-portal access and an 'operator' role can never be given staff
 * access, whatever capabilities are ticked — `authenticateAdmin` and
 * `authenticateOperator` each require their own scope. That is what keeps a
 * third-party ISP out of the staff console even if someone mis-configures a role.
 */

export type CapabilityScope = 'staff' | 'operator';

export interface CapabilityArea {
    key: string;
    label: string;
    description: string;
    scope: CapabilityScope;
    /** Grouping for the roles matrix. */
    group: string;
    /** Areas with no meaningful read-only mode (the console, for one). */
    manageOnly?: boolean;
    /** Losing this one locks everybody out — guarded server-side. */
    critical?: boolean;
}

export const CAPABILITY_AREAS: CapabilityArea[] = [
    // ---- Operations -------------------------------------------------------
    { key: 'dashboard', label: 'Dashboard', group: 'Operations', scope: 'staff',
      description: 'Home dashboard, revenue chart and headline stats' },
    { key: 'bookings', label: 'Service Requests', group: 'Operations', scope: 'staff',
      description: 'Bookings, assignment queue, status overrides and OTPs' },
    { key: 'support', label: 'Support Tickets', group: 'Operations', scope: 'staff',
      description: 'Customer support tickets and replies' },
    { key: 'orders', label: 'Product Orders', group: 'Operations', scope: 'staff',
      description: 'Shop orders, shipments and returns' },
    { key: 'inventory', label: 'Inventory', group: 'Operations', scope: 'staff',
      description: 'Stock levels, items and stock movements' },

    // ---- People -----------------------------------------------------------
    { key: 'customers', label: 'Customers', group: 'People', scope: 'staff',
      description: 'Customer accounts, addresses and account deletion' },
    { key: 'employees', label: 'Employees', group: 'People', scope: 'staff',
      description: 'Service experts, verification, suspension and wallets' },

    // ---- Money ------------------------------------------------------------
    { key: 'payments', label: 'Payments & Invoices', group: 'Money', scope: 'staff',
      description: 'Payment transactions, invoices, refunds and reconciliation' },
    { key: 'withdrawals', label: 'Withdrawals', group: 'Money', scope: 'staff',
      description: 'Partner payout requests and RazorpayX transfers' },
    { key: 'billing', label: 'Manual Billing', group: 'Money', scope: 'staff',
      description: 'Counter-sale bills raised at the shop' },

    // ---- Catalogue --------------------------------------------------------
    { key: 'catalog', label: 'Service Catalog', group: 'Catalogue', scope: 'staff',
      description: 'Services, categories, trades and expertise mapping' },
    { key: 'locations', label: 'Locations', group: 'Catalogue', scope: 'staff',
      description: 'Districts, serviceable pincodes and geofencing' },

    // ---- Growth -----------------------------------------------------------
    { key: 'marketing', label: 'Marketing Push', group: 'Growth', scope: 'staff',
      description: 'Broadcast notifications and campaigns' },
    { key: 'ftth', label: 'FTTH Operators', group: 'Growth', scope: 'staff',
      description: 'Broadband partners: applications, terms, coverage and settlements' },

    // ---- Platform ---------------------------------------------------------
    { key: 'settings', label: 'Settings', group: 'Platform', scope: 'staff',
      description: 'Platform configuration, fees and GST rates' },
    { key: 'audit', label: 'Audit Trail', group: 'Platform', scope: 'staff',
      description: 'Who did what, across the platform' },
    { key: 'accounts', label: 'Roles & Access', group: 'Platform', scope: 'staff',
      description: 'Staff accounts, operator accounts, roles and capabilities',
      critical: true },
    { key: 'db_console', label: 'Database Console', group: 'Platform', scope: 'staff',
      description: 'Raw SQL against production. Grant with care.',
      manageOnly: true },

    // ---- Operator portal --------------------------------------------------
    { key: 'operator_portal', label: 'Operator Portal', group: 'Operator', scope: 'operator',
      description: 'Their own plans, coverage, customers, leads and settlements' },
];

export const CAPABILITY_AREA_BY_KEY: Record<string, CapabilityArea> =
    Object.fromEntries(CAPABILITY_AREAS.map(a => [a.key, a]));

/** Every capability string that can legally be stored. */
export const ALL_CAPABILITIES: string[] = CAPABILITY_AREAS.flatMap(a =>
    a.manageOnly ? [`${a.key}:manage`] : [`${a.key}:view`, `${a.key}:manage`],
);

const ALL_CAPABILITY_SET = new Set(ALL_CAPABILITIES);

export function isValidCapability(cap: string): boolean {
    return ALL_CAPABILITY_SET.has(cap);
}

/**
 * `manage` implies `view`. Stored rows may hold only the manage half; expand
 * before checking so a role granted "manage bookings" is not refused the read
 * endpoints that make managing possible.
 */
export function expandCapabilities(caps: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const cap of caps) {
        out.add(cap);
        if (cap.endsWith(':manage')) {
            const area = cap.slice(0, -':manage'.length);
            if (!CAPABILITY_AREA_BY_KEY[area]?.manageOnly) out.add(`${area}:view`);
        }
    }
    return out;
}

/** Capabilities valid for a role on this side of the boundary. */
export function capabilitiesForScope(scope: CapabilityScope): string[] {
    return CAPABILITY_AREAS
        .filter(a => a.scope === scope)
        .flatMap(a => a.manageOnly ? [`${a.key}:manage`] : [`${a.key}:view`, `${a.key}:manage`]);
}

/**
 * System roles. These exist on every install, cannot be deleted, and cannot have
 * their slug changed.
 *
 * `super_admin` is deliberately NOT capability-driven: it always holds every
 * staff capability, computed at read time. If its grants were editable rows
 * somebody would eventually untick "Roles & Access" on the only super admin and
 * lock the whole company out with no way back in.
 */
export const SYSTEM_ROLES = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    FTTH_OPERATOR: 'operator',
} as const;

export function isSystemRole(slug: string): boolean {
    return (Object.values(SYSTEM_ROLES) as string[]).includes(slug);
}

/** super_admin's effective grants — every staff capability, always. */
export function superAdminCapabilities(): string[] {
    return capabilitiesForScope('staff');
}

/** Sensible starting grants for the built-in `admin` role. */
export const DEFAULT_ADMIN_CAPABILITIES: string[] = [
    'dashboard:view',
    'bookings:manage',
    'support:manage',
    'orders:manage',
    'inventory:manage',
    'customers:view',
    'employees:manage',
    'payments:view',
    'withdrawals:view',
    'billing:manage',
    'catalog:manage',
    'locations:manage',
    'marketing:view',
    'ftth:view',
    'settings:view',
];

export const OPERATOR_CAPABILITIES: string[] = ['operator_portal:manage'];
