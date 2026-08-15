/**
 * Category & service icon registry.
 *
 * The services catalog in the DB was seeded with Unsplash photo URLs in the
 * `icon`/`bannerImage` columns, and several unrelated entries share the same
 * photo. Screens therefore ignore remote image URLs and resolve a unique
 * Lucide glyph from the entry's name instead. Resolution order:
 *   1. a non-URL `icon` value from the backend that names a real Lucide icon
 *      (lets the admin panel override a glyph without an app release)
 *   2. exact (normalized) name match — covers every seeded catalog entry
 *   3. keyword rules — covers renamed or newly added entries
 *   4. per-surface default (Wrench for services, LayoutGrid for categories)
 */

import * as LucideIcons from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

const { Wrench, LayoutGrid } = LucideIcons;

interface IconOwner {
    name?: string | null;
    icon?: string | null;
}

/** 'Water Purifiers (Domestic & Commercial)' → 'water purifiers domestic commercial' */
function normalize(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** 'satellite-dish' / 'satellite_dish' / 'SatelliteDish' → SatelliteDish component */
export function resolveLucideIcon(iconName?: string | null): LucideIcon | null {
    if (!iconName || iconName.startsWith('http')) return null;
    const pascal = iconName
        .split(/[-_\s]+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    const icon = (LucideIcons as Record<string, unknown>)[pascal];
    return typeof icon === 'object' || typeof icon === 'function' ? (icon as LucideIcon) : null;
}

// One unique glyph per catalog entry. Keys are display names as seeded
// (seed-catalog-extended.ts and the legacy seed-services.ts); lookups are
// normalized, so punctuation and casing differences don't matter.
const EXACT: Array<[string, LucideIcon]> = [
    // Categories — extended catalog
    ['IT & Security', LucideIcons.ShieldCheck],
    ['Appliances & Utilities', LucideIcons.Plug],
    ['Repairs & Maintenance', LucideIcons.Wrench],
    ['Professional & Property', LucideIcons.Briefcase],
    ['Transport & Logistics', LucideIcons.Truck],
    ['Events, Travel & Lifestyle', LucideIcons.Compass],
    ['Specialized Services', LucideIcons.Sparkles],
    // Categories — legacy seed
    ['Technology Services', LucideIcons.Monitor],
    ['Home Services', LucideIcons.House],
    ['Repair Services', LucideIcons.Hammer],

    // Services — extended catalog
    ['Computer & Printer', LucideIcons.Monitor],
    ['CCTV Camera', LucideIcons.Cctv],
    ['Biometric Device', LucideIcons.FingerprintPattern],
    ['Internet & Broadband Services (FTTH)', LucideIcons.Router],
    ['DTH Services', LucideIcons.SatelliteDish],
    ['Home Appliances', LucideIcons.WashingMachine],
    ['UPS & Batteries', LucideIcons.BatteryCharging],
    ['Water Purifiers (Domestic & Commercial)', LucideIcons.GlassWater],
    ['Solar & Heat Pumps', LucideIcons.Sun],
    ['WTP & STP', LucideIcons.Waves],
    ['Generators, Water Pumps, Water Cutoff Sensors', LucideIcons.PlugZap],
    ['Household Repairs', LucideIcons.Hammer],
    ['Electrical & Plumbing', LucideIcons.Zap],
    ['Mobile Repairs', LucideIcons.Smartphone],
    ['Digital Camera Services', LucideIcons.Camera],
    ['Hardware & Painting', LucideIcons.PaintRoller],
    ['Welding', LucideIcons.Flame],
    ['Architecture', LucideIcons.DraftingCompass],
    ['Interior Design', LucideIcons.Sofa],
    ['Real Estate', LucideIcons.Building2],
    ['Tax & Audit (For All Types of Firms)', LucideIcons.Calculator],
    ['Lawyers & Advocates', LucideIcons.Scale],
    ['Vehicle Service (2 & 4 Wheeler)', LucideIcons.Car],
    ['Earth Movers (JCB / Cranes)', LucideIcons.Forklift],
    ['Packers & Movers', LucideIcons.Package],
    ['Driving School', LucideIcons.CarFront],
    ['Travel & Tourism', LucideIcons.Plane],
    ['Hotels, Homestay, Lodge, Restaurant & Resorts', LucideIcons.Hotel],
    ['Event Management (Auditorium Services)', LucideIcons.PartyPopper],
    ['Catering Services', LucideIcons.ChefHat],
    ['Astrology Services', LucideIcons.MoonStar],
    ['Agriculture Product Services', LucideIcons.Tractor],
    ['Pest Controlling System', LucideIcons.Bug],
    ['Loans & All types of insurance', LucideIcons.HandCoins],
    ['Education', LucideIcons.GraduationCap],
    ['Health', LucideIcons.HeartPulse],

    // Services — legacy seed variants
    ['Computers & Printers', LucideIcons.Monitor],
    ['CCTV Installation', LucideIcons.Cctv],
    ['Biometric Systems', LucideIcons.FingerprintPattern],
    ['UPS & Battery', LucideIcons.BatteryCharging],
    ['Water Purifier', LucideIcons.GlassWater],
    ['Solar Services', LucideIcons.Sun],
    ['Electric & Plumbing', LucideIcons.Zap],
    ['FTTH Installation', LucideIcons.Router],
    ['AC Service & Repair', LucideIcons.AirVent],
    ['Refrigerator Repair', LucideIcons.Refrigerator],
];

const EXACT_MAP = new Map(EXACT.map(([name, icon]) => [normalize(name), icon]));

// Fallbacks for entries added or renamed in the admin panel after this app
// version shipped. Order matters: specific terms come before generic ones
// (e.g. 'driving school' before vehicle terms, 'heat pump' before 'pump').
const KEYWORD_RULES: Array<[RegExp, LucideIcon]> = [
    [/driving school/, LucideIcons.CarFront],
    [/earth mover|jcb|crane|excavat/, LucideIcons.Forklift],
    [/packer|relocat/, LucideIcons.Package],
    [/water purifier|purifier/, LucideIcons.GlassWater],
    [/wtp|stp|sewage|water treatment/, LucideIcons.Waves],
    [/solar|heat pump/, LucideIcons.Sun],
    [/generator|water pump|\bpump\b/, LucideIcons.PlugZap],
    [/cctv|surveillance/, LucideIcons.Cctv],
    [/biometric|fingerprint|attendance/, LucideIcons.FingerprintPattern],
    [/computer|laptop|pc\b/, LucideIcons.Monitor],
    [/printer|scanner|photocopier/, LucideIcons.Printer],
    [/internet|broadband|ftth|wifi|router|fiber/, LucideIcons.Router],
    [/dth|satellite|dish/, LucideIcons.SatelliteDish],
    [/appliance|washing/, LucideIcons.WashingMachine],
    [/\bups\b|batter|inverter/, LucideIcons.BatteryCharging],
    [/refrigerat|fridge/, LucideIcons.Refrigerator],
    [/\bac\b|air condition|hvac/, LucideIcons.AirVent],
    [/electric|plumb|wiring/, LucideIcons.Zap],
    [/mobile|smartphone/, LucideIcons.Smartphone],
    [/camera|dslr/, LucideIcons.Camera],
    [/paint|hardware/, LucideIcons.PaintRoller],
    [/weld|fabricat/, LucideIcons.Flame],
    [/architect/, LucideIcons.DraftingCompass],
    [/interior/, LucideIcons.Sofa],
    [/real estate|property/, LucideIcons.Building2],
    [/tax|audit|account/, LucideIcons.Calculator],
    [/lawyer|advocate|legal/, LucideIcons.Scale],
    [/vehicle|wheeler|\bcar\b|bike/, LucideIcons.Car],
    [/travel|tourism|tour/, LucideIcons.Plane],
    [/hotel|homestay|lodge|restaurant|resort/, LucideIcons.Hotel],
    [/event|wedding|auditorium/, LucideIcons.PartyPopper],
    [/cater/, LucideIcons.ChefHat],
    [/astrolog|horoscope|vastu/, LucideIcons.MoonStar],
    [/agricultur|farm/, LucideIcons.Tractor],
    [/pest|termite/, LucideIcons.Bug],
    [/loan|insurance/, LucideIcons.HandCoins],
    [/educat|tuition|school|coaching/, LucideIcons.GraduationCap],
    [/health|nursing|physio|wellness/, LucideIcons.HeartPulse],
    [/household|handyman|repair|maintenance/, LucideIcons.Hammer],
    [/security/, LucideIcons.ShieldCheck],
    [/transport|logistic/, LucideIcons.Truck],
    [/utilit/, LucideIcons.Plug],
    [/lifestyle/, LucideIcons.Compass],
    [/technolog/, LucideIcons.Monitor],
    [/\bhome\b|house/, LucideIcons.House],
];

function lookupByName(name?: string | null): LucideIcon | null {
    if (!name) return null;
    const normalized = normalize(name);
    const exact = EXACT_MAP.get(normalized);
    if (exact) return exact;
    for (const [pattern, icon] of KEYWORD_RULES) {
        if (pattern.test(normalized)) return icon;
    }
    return null;
}

/** Unique glyph for a service tile. */
export function getServiceIcon(service: IconOwner): LucideIcon {
    return resolveLucideIcon(service.icon) || lookupByName(service.name) || Wrench;
}

/** Unique glyph for a category (e.g. the All Services sidebar). */
export function getCategoryIcon(category: IconOwner): LucideIcon {
    return resolveLucideIcon(category.icon) || lookupByName(category.name) || LayoutGrid;
}
