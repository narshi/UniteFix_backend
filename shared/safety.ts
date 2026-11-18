/**
 * Safety: SOS, help requests and reports about behaviour, on trips and on
 * home-service visits. One queue for staff (Admin → Safety desk), with a
 * severity that sets how fast someone must call back.
 *
 * The same rules apply to travel partners, their drivers and hosts, and
 * UniteFix's own service experts.
 */

export type Severity = 'critical' | 'high' | 'medium';
export type IncidentKind = 'sos' | 'report' | 'help';
export type IncidentContext = 'trip' | 'service';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

/** How fast staff must respond, in minutes. */
export const RESPONSE_MINUTES: Record<Severity, number> = { critical: 5, high: 30, medium: 24 * 60 };
export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium' };
export const RESPONSE_LABEL: Record<Severity, string> = { critical: 'Call back within 5 min', high: 'Call back within 30 min', medium: 'Answer within 24 h' };

/** What a traveller or customer can report about someone's behaviour. */
export const REPORT_CATEGORIES = {
    harassment: { label: 'Sexual harassment', severity: 'critical' },
    physical_harm: { label: 'Physical harm or assault', severity: 'critical' },
    threats: { label: 'Threats or intimidation', severity: 'critical' },
    drunk: { label: 'Drunk or high on the job', severity: 'critical' },
    unsafe_driving: { label: 'Unsafe or rash driving', severity: 'high' },
    abusive: { label: 'Abusive language', severity: 'high' },
    extra_money: { label: 'Asked for extra money', severity: 'high' },
    route: { label: 'Changed the route without asking', severity: 'high' },
    theft_damage: { label: 'Theft or damage', severity: 'high' },
    rude: { label: 'Rude behaviour', severity: 'medium' },
    late: { label: 'Very late', severity: 'medium' },
    not_as_promised: { label: 'Car, room or service not as promised', severity: 'medium' },
    other: { label: 'Something else', severity: 'medium' },
} as const satisfies Record<string, { label: string; severity: Severity }>;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;

/** Help on a trip that isn't about someone's behaviour. */
export const HELP_CATEGORIES = {
    medical: { label: 'Medical help needed', severity: 'high' },
    breakdown: { label: 'Car broke down', severity: 'high' },
    driver_late: { label: 'Driver is late or not here', severity: 'high' },
    stay: { label: 'Problem with the stay', severity: 'medium' },
    lost_item: { label: 'Lost something', severity: 'medium' },
    other: { label: 'Something else', severity: 'medium' },
    // Raised by the system while a trip is on (travel.service.ts liveAlerts), not by the traveller.
    no_signal: { label: 'No location for 20 minutes', severity: 'high' },
    off_route: { label: 'Off the planned route', severity: 'high' },
    long_stop: { label: 'Stopped for long, not a planned stop', severity: 'high' },
    night_driving: { label: 'Driving after 10 pm', severity: 'high' },
    low_rating: { label: 'Low rating after a trip', severity: 'medium' },
} as const satisfies Record<string, { label: string; severity: Severity }>;
export type HelpCategory = keyof typeof HELP_CATEGORIES;

/** Who a report is about. */
export interface IncidentSubject {
    type: 'driver' | 'stay' | 'guide' | 'activity' | 'expert' | 'partner' | 'other';
    name: string | null;
    teamMemberId?: number | null;   // travel_trip_team
    employeeId?: number | null;     // a UniteFix service expert
    partnerId?: number | null;      // a travel partner
    businessPartnerId?: number | null;
    phone?: string | null;          // a partner's driver or host has no account: flagged by phone
}

export const SAFETY_ACTIONS = ['none', 'warning', 'strike', 'suspend', 'ban', 'clear'] as const;
export type SafetyAction = typeof SAFETY_ACTIONS[number];
export const SAFETY_ACTION_LABEL: Record<SafetyAction, string> = {
    none: 'No action', warning: 'Warning', strike: 'Strike', suspend: 'Suspend', ban: 'Ban from UniteFix', clear: 'Cleared: lift the pause',
};
/** Three strikes in this many days takes someone off the platform. */
export const STRIKE_WINDOW_DAYS = 180;
export const STRIKES_TO_REMOVE = 3;

/** SOS keeps sharing location this long. */
export const SOS_SHARE_MINUTES = 120;
