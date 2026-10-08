/**
 * Celebrations — the vocabulary shared by the server, the Hub and the public
 * pages: halls, photographers and event planners, and booking them.
 */

export const SLOT_LABEL: Record<'am' | 'pm' | 'full', string> = { am: 'Morning', pm: 'Evening', full: 'Full day' };
export const DAY_TYPE_LABEL: Record<'weekday' | 'weekend' | 'peak', string> = { weekday: 'Weekday', weekend: 'Weekend', peak: 'Peak date' };

export const SPACE_KINDS: Array<[string, string]> = [
    ['hall', 'Hall'], ['banquet', 'Banquet hall'], ['lawn', 'Lawn'], ['terrace', 'Terrace'], ['rooftop', 'Rooftop'], ['room', 'Small room'], ['other', 'Other'],
];

export const AMENITIES: string[] = [
    'Air conditioning', 'Power backup', 'Car parking', 'Valet parking', 'Guest rooms', 'Bridal room', 'Lift', 'Wheelchair access',
    'Stage', 'Dining hall', 'In-house catering', 'In-house décor', 'Sound system', 'Projector & screen', 'Wi-Fi', 'Changing rooms',
    'Open lawn', 'Swimming pool', 'Kitchen for caterers', 'CCTV & security',
];

export const OCCASIONS: string[] = ['Wedding', 'Reception', 'Engagement', 'Birthday', 'Anniversary', 'Baby shower', 'Naming ceremony', 'Housewarming', 'Corporate event', 'Get-together'];

export const PHOTO_STYLES: string[] = ['Wedding', 'Candid', 'Traditional', 'Pre-wedding', 'Cinematic films', 'Drone', 'Maternity', 'Newborn & baby', 'Birthday & events', 'Portraits', 'Fashion', 'Product', 'Corporate'];

export const ALBUM_CATEGORIES: Array<[string, string]> = [
    ['wedding', 'Wedding'], ['pre_wedding', 'Pre-wedding'], ['candid', 'Candid'], ['maternity', 'Maternity'], ['baby', 'Newborn & baby'],
    ['birthday', 'Birthday'], ['portrait', 'Portraits'], ['product', 'Product'], ['event', 'Event'], ['other', 'Other'],
];

export const DEFAULT_CANCELLATION = [
    { daysBefore: 60, refundPercent: 90 },
    { daysBefore: 30, refundPercent: 50 },
    { daysBefore: 0, refundPercent: 0 },
];

/** "Refund if cancelled N+ days before" tiers → the refund percent for a cancellation `daysLeft` days before. */
export function refundPercentFor(tiers: Array<{ daysBefore: number; refundPercent: number }> | null | undefined, daysLeft: number) {
    const list = [...(tiers?.length ? tiers : DEFAULT_CANCELLATION)].sort((a, b) => b.daysBefore - a.daysBefore);
    for (const t of list) if (daysLeft >= t.daysBefore) return t.refundPercent;
    return 0;
}

export function cancellationText(tiers: Array<{ daysBefore: number; refundPercent: number }> | null | undefined): string[] {
    const list = [...(tiers?.length ? tiers : DEFAULT_CANCELLATION)].sort((a, b) => b.daysBefore - a.daysBefore);
    return list.map((t, i) => {
        const prev = list[i - 1];
        const when = t.daysBefore === 0 ? (prev ? `Less than ${prev.daysBefore} days before` : 'Any time') : prev ? `${t.daysBefore}–${prev.daysBefore - 1} days before` : `${t.daysBefore}+ days before`;
        return `${when}: ${t.refundPercent ? `${t.refundPercent}% of what you paid is refunded` : 'no refund'}`;
    });
}
