/**
 * Partner Hub — the shared vocabulary.
 *
 * One business partner record, one portal. What a partner sees is decided
 * here: their verticals switch modules on, their team role decides what they
 * may do inside a module, and their plan decides how much of the paid back
 * office (invoicing, GST desk) they get. Imported by the server (enforcement)
 * and the web client (navigation) so the two can never disagree.
 *
 * "partner" in /api/partner/* means a TECHNICIAN. The Hub lives at /api/hub/*.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Modules
// ─────────────────────────────────────────────────────────────────────────────

export type HubModule =
    // every partner
    | 'home' | 'onboarding' | 'team' | 'customers' | 'sales' | 'purchases' | 'money' | 'gst' | 'docs'
    // by vertical
    | 'broadband' | 'field' | 'parts' | 'consulting' | 'events' | 'marketplace' | 'venue' | 'portfolio' | 'newsroom';

export const CORE_MODULES: HubModule[] = ['home', 'onboarding', 'team', 'customers', 'sales', 'purchases', 'money', 'gst', 'docs'];
export const VERTICAL_MODULES: HubModule[] = ['broadband', 'field', 'parts', 'consulting', 'events', 'marketplace', 'venue', 'portfolio', 'newsroom'];

export const MODULE_LABEL: Record<HubModule, string> = {
    home: 'Home', onboarding: 'Onboarding', team: 'Team', customers: 'Customers', sales: 'Sales', purchases: 'Purchases',
    money: 'Money', gst: 'GST desk', docs: 'Documents', broadband: 'Broadband', field: 'Field service', parts: 'Parts',
    consulting: 'Consulting', events: 'Events', marketplace: 'Store', venue: 'Venue', portfolio: 'Portfolio', newsroom: 'Newsroom',
};

/** What each vertical switches on. A partner with several verticals gets the union. */
export const VERTICAL_TO_MODULES: Record<string, HubModule[]> = {
    isp: ['broadband', 'parts'],
    computer: ['field', 'parts'],
    cctv: ['field', 'parts'],
    electronics: ['marketplace', 'parts'],
    consultation: ['consulting'],
    events: ['events'],
    // Halls and photographers take bookings through the events machinery
    // (enquiries, quotations, bookings, advances, vendors) and add their own
    // pages: a hall's spaces and calendar, a photographer's portfolio.
    hall: ['venue', 'events'],
    photography: ['portfolio', 'events'],
    // Local newspapers publish their editions to UniteFix readers.
    media: ['newsroom'],
    other: [],
};

export function modulesForVerticals(verticals: string[], overrides: Array<{ module: string; enabled: boolean }> = []): HubModule[] {
    const set = new Set<HubModule>(CORE_MODULES);
    for (const v of verticals) for (const m of VERTICAL_TO_MODULES[v] ?? []) set.add(m);
    for (const o of overrides) {
        if (!(VERTICAL_MODULES as string[]).includes(o.module)) continue; // core modules cannot be switched off
        if (o.enabled) set.add(o.module as HubModule); else set.delete(o.module as HubModule);
    }
    return Array.from(set);
}

// ─────────────────────────────────────────────────────────────────────────────
// Team roles and permissions
// ─────────────────────────────────────────────────────────────────────────────

export type HubRole = 'owner' | 'manager' | 'accountant' | 'dispatcher' | 'technician';
export const HUB_ROLES: HubRole[] = ['owner', 'manager', 'accountant', 'dispatcher', 'technician'];
export const HUB_ROLE_LABEL: Record<HubRole, string> = {
    owner: 'Owner', manager: 'Manager', accountant: 'Accountant', dispatcher: 'Dispatcher', technician: 'Technician lead',
};

export type HubPermission =
    | 'settings:manage' | 'team:manage' | 'customers:manage' | 'sales:manage' | 'purchases:manage'
    | 'money:view' | 'gst:manage' | 'docs:manage' | 'ops:manage' | 'ops:view';

export const ROLE_PERMISSIONS: Record<HubRole, HubPermission[]> = {
    owner: ['settings:manage', 'team:manage', 'customers:manage', 'sales:manage', 'purchases:manage', 'money:view', 'gst:manage', 'docs:manage', 'ops:manage', 'ops:view'],
    manager: ['settings:manage', 'customers:manage', 'sales:manage', 'purchases:manage', 'money:view', 'docs:manage', 'ops:manage', 'ops:view'],
    accountant: ['customers:manage', 'sales:manage', 'purchases:manage', 'money:view', 'gst:manage', 'ops:view'],
    dispatcher: ['customers:manage', 'ops:manage', 'ops:view'],
    technician: ['ops:view'],
};

export function can(role: HubRole, perm: HubPermission): boolean {
    return (ROLE_PERMISSIONS[role] ?? []).includes(perm);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans (decision 4: a paid tier for the invoicing and GST back office)
// ─────────────────────────────────────────────────────────────────────────────

export type HubPlan = 'starter' | 'pro';
export const PLAN_LIMITS: Record<HubPlan, { invoicesPerMonth: number | null; teamMembers: number | null; gstExports: boolean; eInvoice: boolean }> = {
    starter: { invoicesPerMonth: 25, teamMembers: 3, gstExports: false, eInvoice: false },
    pro: { invoicesPerMonth: null, teamMembers: null, gstExports: true, eInvoice: true },
};
export const PLAN_LABEL: Record<HubPlan, string> = { starter: 'Starter (free)', pro: 'Pro' };

// ─────────────────────────────────────────────────────────────────────────────
// Documents asked for at onboarding
// ─────────────────────────────────────────────────────────────────────────────

export interface DocType {
    code: string;
    label: string;
    hint: string;
    /** Verticals that must provide it; '*' = everyone. Empty = optional for all. */
    requiredFor: string[];
    /** Verticals for which it is offered as optional. */
    optionalFor?: string[];
    hasExpiry?: boolean;
    /** Only asked when the partner gave a GSTIN. */
    needsGstin?: boolean;
}

export const DOC_TYPES: DocType[] = [
    { code: 'pan_card', label: 'PAN card', hint: 'Of the business, or the proprietor for a sole proprietorship.', requiredFor: ['*'] },
    { code: 'gst_certificate', label: 'GST registration certificate', hint: 'Form REG-06 from the GST portal.', requiredFor: ['*'], needsGstin: true },
    { code: 'bank_proof', label: 'Cancelled cheque or bank statement', hint: 'Showing the account name, number and IFSC we will pay into.', requiredFor: ['*'] },
    { code: 'address_proof', label: 'Shop or office address proof', hint: 'Rent agreement, utility bill or shop licence.', requiredFor: [], optionalFor: ['*'] },
    { code: 'isp_licence', label: 'ISP licence or franchise agreement', hint: 'DoT ISP authorisation, or your agreement with the licensed ISP you resell for.', requiredFor: ['isp'] },
    { code: 'liability_insurance', label: 'Public liability insurance', hint: 'Covers damage at a customer\'s premises. Needed before your own technicians take jobs.', requiredFor: [], optionalFor: ['computer', 'cctv'], hasExpiry: true },
    { code: 'trade_licence', label: 'Trade licence', hint: 'Municipal trade licence, if your business holds one.', requiredFor: [], optionalFor: ['events', 'electronics', 'hall', 'photography'], hasExpiry: true },
    { code: 'rni_certificate', label: 'RNI / PRGI registration', hint: 'The registration of your newspaper with the Registrar of Newspapers (PRGI), if it is registered.', requiredFor: [], optionalFor: ['media'] },
    { code: 'fire_noc', label: 'Fire safety NOC', hint: 'From the fire department, for a hall that hosts large gatherings.', requiredFor: [], optionalFor: ['hall'], hasExpiry: true },
    { code: 'professional_certificate', label: 'Professional certificate', hint: 'ICAI / ICSI / bar membership or similar, for regulated advice.', requiredFor: [], optionalFor: ['consultation'], hasExpiry: true },
];

export function docsFor(verticals: string[], hasGstin: boolean): Array<DocType & { required: boolean }> {
    const applies = (list: string[] = []) => list.includes('*') || list.some(v => verticals.includes(v));
    return DOC_TYPES
        .filter(d => !(d.needsGstin && !hasGstin))
        .filter(d => applies(d.requiredFor) || applies(d.optionalFor))
        .map(d => ({ ...d, required: applies(d.requiredFor) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Agreements — versioned; a change of version needs re-acceptance.
// Draft wording for legal review.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgreementDoc { code: string; version: string; title: string; appliesTo: string[]; sections: Array<[string, string]> }

export const AGREEMENTS: AgreementDoc[] = [
    {
        code: 'core', version: '2026-10-v1', title: 'UniteFix Partner Terms', appliesTo: ['*'],
        sections: [
            ['Who we are to each other', 'You run an independent business. UniteFix provides the platform, the customer channel and the back office tools described in the Partner Hub. Nothing here makes you an employee or agent of UniteFix.'],
            ['Your information', 'You confirm that the business details, GSTIN, PAN and bank account you give us are yours and correct, and you will update them when they change. Payouts go only to the verified bank account.'],
            ['Money', 'Amounts UniteFix owes you and you owe UniteFix are recorded on one statement you can see at any time. Settlements are paid weekly to your verified account. UniteFix invoices its own fees to you with GST.'],
            ['Customer data', 'You may use customer details only to serve the order or booking they relate to. You may not export, sell or reuse them. This follows the Digital Personal Data Protection Act, 2023.'],
            ['Tax', 'You are responsible for the GST on your own supplies and for filing your returns. Where the law requires UniteFix to collect or deduct tax on your sales (TCS, TDS), it will do so and give you the certificate.'],
            ['Plans', 'The Starter plan is free. The Pro plan is billed monthly on your statement at the published price; you can change plan from the next month.'],
            ['Ending the arrangement', 'Either side may end this with 30 days\' notice. Open orders and bookings are completed or refunded, and a final settlement is paid once every return window has closed.'],
        ],
    },
    {
        code: 'isp', version: '2026-10-v1', title: 'Broadband annex', appliesTo: ['isp'],
        sections: [
            ['Licence', 'You hold, or resell under, a valid ISP authorisation and will tell UniteFix if it lapses.'],
            ['Recharges', 'When a customer pays for a recharge through UniteFix, you apply it in your own system promptly and mark it done. Your share is settled weekly after UniteFix\'s fee.'],
        ],
    },
    {
        code: 'field', version: '2026-10-v1', title: 'Field service annex', appliesTo: ['computer', 'cctv'],
        sections: [
            ['Your technicians', 'Everyone you send to a customer is verified by UniteFix before their first job. You are their employer and pay them.'],
            ['Service levels', 'Assign a technician within 2 working hours of a booking in your territory. Late assignments may be handed to UniteFix technicians.'],
            ['Warranty', 'Workmanship faults on your jobs are yours to fix first, within 48 hours. If UniteFix has to send someone else, the cost is charged to your statement.'],
        ],
    },
    {
        code: 'consulting', version: '2026-10-v1', title: 'Consulting annex', appliesTo: ['consultation'],
        sections: [
            ['Qualified advice', 'Regulated advice (tax, legal, audit) is given only by people qualified to give it.'],
            ['Appointments', 'You keep the appointments you publish, or reschedule with the client in advance.'],
        ],
    },
    {
        code: 'events', version: '2026-10-v1', title: 'Events annex', appliesTo: ['events'],
        sections: [
            ['Quotations', 'A quotation the client accepts is binding on the scope and price it states. Changes are a new quotation version.'],
            ['Advances', 'Advances received are recorded against the booking and adjusted in the final invoice, with GST as the law requires on advances.'],
            ['Vendors', 'You are responsible for the vendors you engage and for paying them.'],
        ],
    },
    {
        code: 'venue', version: '2026-10-v1', title: 'Venue annex', appliesTo: ['hall'],
        sections: [
            ['Your calendar', 'Dates you show as free are free. Block dates you have booked elsewhere the same day, so no client books a date you cannot give them. A date held for a client stays theirs until the hold ends.'],
            ['Your page', 'Photos, capacities and amenities on your page are of your property and true. UniteFix reviews your page before it goes live and may pause it if it is not.'],
            ['Advances and deposits', 'Advances paid through UniteFix are settled to you weekly after the collection fee. A refundable security deposit is collected and returned by you, on the terms shown on your page.'],
            ['Cancellations', 'The cancellation terms on your page when a client booked are the terms for that booking.'],
            ['Commission', 'Bookings that come to you through UniteFix carry the commission shown in your Hub, charged on your statement once the event has taken place (or, on a cancellation, on what you keep).'],
        ],
    },
    {
        code: 'portfolio', version: '2026-10-v1', title: 'Photography annex', appliesTo: ['photography'],
        sections: [
            ['Your work', 'Photos and films on your portfolio are your own work, and you have the consent of the people in them to show them publicly.'],
            ['Your dates', 'Keep your availability current. A date you confirm for a client is theirs.'],
            ['Deliverables', 'You deliver what your package promises, by the date you agreed.'],
            ['Commission', 'Bookings that come to you through UniteFix carry the commission shown in your Hub, charged on your statement once the shoot has taken place (or, on a cancellation, on what you keep).'],
        ],
    },
    {
        code: 'newsroom', version: '2026-10-v1', title: 'Media annex', appliesTo: ['media'],
        sections: [
            ['Your content', 'You publish only newspapers and material you own or are licensed to publish, and you are responsible for what they say, as their publisher.'],
            ['Reach', 'UniteFix shows your editions to readers who choose your paper, free to read in the UniteFix app, and shows a preview of your first page on the links you and your readers share.'],
            ['Takedown', 'UniteFix may take down an edition that breaks the law or these terms, and will tell you why.'],
            ['Storage', 'Editions are kept for 3 days free, or 30 days on a paid archive plan. Older editions are removed automatically.'],
        ],
    },
    {
        code: 'marketplace', version: '2026-10-v1', title: 'Store annex', appliesTo: ['electronics'],
        sections: [
            ['Listings', 'Listings show the MRP, HSN code, country of origin and your return policy. The selling price never exceeds the MRP.'],
            ['Dispatch', 'Dispatch within 48 hours of an order. UniteFix may cancel orders not dispatched in 72 hours.'],
            ['Tax collected', 'UniteFix collects TCS and deducts TDS on your marketplace sales as the law requires, and gives you the certificates.'],
        ],
    },
];

export function agreementsFor(verticals: string[]): AgreementDoc[] {
    return AGREEMENTS.filter(a => a.appliesTo.includes('*') || a.appliesTo.some(v => verticals.includes(v)));
}

// ─────────────────────────────────────────────────────────────────────────────
// GSTIN / PAN
// ─────────────────────────────────────────────────────────────────────────────

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
    '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
    '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
    '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
    '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
    '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The GSTIN check digit (15th character), per the GSTN algorithm. */
export function gstinCheckDigit(first14: string): string {
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const v = GSTIN_CHARS.indexOf(first14[i]);
        const product = v * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(product / 36) + (product % 36);
    }
    return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export interface GstinCheck { valid: boolean; reason?: string; stateCode?: string; stateName?: string; pan?: string }

/**
 * Shape, state code and check digit. This proves the number is well-formed,
 * not that it is registered or active — that needs a GST portal lookup.
 */
export function checkGstin(raw: string | null | undefined): GstinCheck {
    const g = String(raw ?? '').trim().toUpperCase();
    if (!g) return { valid: false, reason: 'No GSTIN given.' };
    if (!GSTIN_SHAPE.test(g)) return { valid: false, reason: 'A GSTIN is 15 characters: 2-digit state code, 10-character PAN, entity number, Z, check digit.' };
    const stateCode = g.slice(0, 2);
    const stateName = GST_STATES[stateCode];
    if (!stateName) return { valid: false, reason: `${stateCode} is not a GST state code.` };
    if (gstinCheckDigit(g.slice(0, 14)) !== g[14]) return { valid: false, reason: 'The last character (check digit) does not match — the number has a typo.' };
    return { valid: true, stateCode, stateName, pan: g.slice(2, 12) };
}

export function checkPan(raw: string | null | undefined): { valid: boolean; reason?: string } {
    const p = String(raw ?? '').trim().toUpperCase();
    if (!p) return { valid: false, reason: 'No PAN given.' };
    if (!PAN_SHAPE.test(p)) return { valid: false, reason: 'A PAN is 10 characters: 5 letters, 4 digits, 1 letter.' };
    return { valid: true };
}

/** Indian financial year of a date, as "26-27" for 1 Apr 2026 – 31 Mar 2027. */
export function financialYear(d: Date = new Date()): string {
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}
