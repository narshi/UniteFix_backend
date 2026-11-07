/**
 * Which photo a service or category gets, by its name. Pure rules (no images
 * here) so they can be tested against the live catalogue; servicePhotos.ts
 * turns a key into the bundled picture.
 *
 * Order matters: the first rule that matches wins, so specific things come
 * before general ones ("Floor Mount Commode with Flush Tank" is a commode;
 * "Electrical Geyser" is a geyser; "Laptop Battery" is a laptop; "AC Point" is
 * an electrical point, not an AC service).
 */

export type PhotoKey =
    | 'plumbing' | 'electrical' | 'ac' | 'painting' | 'travel' | 'inspection' | 'house'
    | 'toilet_flush' | 'toilet_concealed' | 'commode' | 'geyser' | 'bathtub' | 'tank' | 'kitchen_sink' | 'basin' | 'pipes' | 'mixer'
    | 'fan' | 'lights' | 'switchboard' | 'socket' | 'mcb' | 'meter' | 'wiring'
    | 'laptop' | 'desktop' | 'desktop_repair' | 'software' | 'ssd' | 'router' | 'fiber'
    | 'printer' | 'ink' | 'cctv' | 'fingerprint' | 'battery' | 'purifier' | 'washing' | 'solar' | 'tax';

const SERVICE_RULES: [RegExp, PhotoKey][] = [
    // Plumbing
    [/concealed (flush|tank)|flush plate/, 'toilet_concealed'],
    [/commode|toilet|\bwc\b|western closet/, 'commode'],
    [/flush ?tank/, 'toilet_flush'],
    [/geyser|water heater|boiler/, 'geyser'],
    [/bath ?tub/, 'bathtub'],
    [/tank fitting|water tank|overhead tank|\d+ ?lit(re|er)/, 'tank'],
    [/sink/, 'kitchen_sink'],
    [/wash ?basin|\bbasin\b/, 'basin'],
    [/mixer|diverter|shower|health faucet/, 'mixer'],
    [/pipe|clog|blockage|leak|joint|valve|stop ?cock|concealed point|drain/, 'pipes'],
    [/plumb|\btap\b|faucet/, 'plumbing'],
    // Electrical points come before AC and UPS services
    [/exhaust|\bfans?\b/, 'fan'],
    [/tube ?light|light point|pop light|\blights?\b|chandelier/, 'lights'],
    [/meter/, 'meter'],
    [/\bmcb\b|distribution box|\bdb\b|change ?over/, 'mcb'],
    [/switch|bell/, 'switchboard'],
    [/socket|tv point|ac point|ups point|heating point|\bpoint\b/, 'socket'],
    [/earthing|wiring|electric/, 'wiring'],
    // Appliances
    [/\bac\b|a\.c\.|air ?condition/, 'ac'],
    [/washing machine/, 'washing'],
    [/solar/, 'solar'],
    [/purifier|\bro\b|\btds\b|filter change/, 'purifier'],
    [/biometric|fingerprint|attendance/, 'fingerprint'],
    [/cctv|camera|footage|\bdvr\b|\bnvr\b|mobile view/, 'cctv'],
    // Computers and printers
    [/laptop|keyboard/, 'laptop'],
    [/cartridge|\bink\b|toner|head cleaning/, 'ink'],
    [/printer|paper jam|maintenance box/, 'printer'],
    [/\bups\b|inverter|battery/, 'battery'],
    [/ssd|hard ?dis[ck]|hard ?drive|data backup|recovery/, 'ssd'],
    [/desktop|motherboard|assembly|hardware|computer|\bpc\b/, 'desktop_repair'],
    [/\bos\b|software|virus|windows|installation of os/, 'software'],
    [/display|monitor|screen/, 'desktop'],
    [/patch cord|fibre|fiber|ftth|broadband/, 'fiber'],
    [/network|router|wi-?fi|\blan\b|power adaptor|modem/, 'router'],
    // Others
    [/paint/, 'painting'],
    [/tax|\bitr\b|\bgst\b|audit|legal|account/, 'tax'],
    [/travel|tour|trip|holiday/, 'travel'],
];

const CATEGORY_RULES: [RegExp, PhotoKey][] = [
    [/visit|inspection/, 'inspection'],
    [/plumb/, 'plumbing'],
    [/electric/, 'electrical'],
    [/computer|laptop|\bit\b/, 'desktop_repair'],
    [/printer/, 'printer'],
    [/cctv|camera|security/, 'cctv'],
    [/biometric/, 'fingerprint'],
    [/\bups\b|battery|inverter/, 'battery'],
    [/purifier|water filter/, 'purifier'],
    [/broad ?band|ftth|fibre|fiber|internet/, 'fiber'],
    [/tax|audit|legal|itr/, 'tax'],
    [/travel|tour/, 'travel'],
    [/paint/, 'painting'],
    [/\bac\b|air ?condition/, 'ac'],
    [/solar/, 'solar'],
    [/washing|appliance/, 'washing'],
];

const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9.+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const first = (rules: [RegExp, PhotoKey][], text: string) => rules.find(([re]) => re.test(text))?.[1] ?? null;

/** The photo for a service's own name, or null when nothing in it says what it is. */
export function photoKeyForService(name?: string | null): PhotoKey | null {
    return first(SERVICE_RULES, norm(name));
}

/** The photo for a category, or null when its name says nothing we have a photo for. */
export function photoKeyForCategory(name?: string | null): PhotoKey | null {
    return first(CATEGORY_RULES, norm(name));
}

/** Category photos that also have a full-width header (assets/home/hero-<name>.jpg). */
export const HERO_OF: Partial<Record<PhotoKey, string>> = {
    plumbing: 'plumbing', electrical: 'electrical', ac: 'ac', painting: 'painting', inspection: 'inspection',
    desktop_repair: 'computer', printer: 'printer', cctv: 'cctv', fingerprint: 'biometric', battery: 'battery',
    purifier: 'purifier', fiber: 'broadband', tax: 'tax', travel: 'travel', solar: 'solar', washing: 'washing',
};

/**
 * A photo the admin put on many different services is a placeholder, not a
 * picture of this service (one photo is on all 11 Visiting & Inspection
 * services today). Those give way to the service's own photo.
 */
export const SHARED_PHOTO_LIMIT = 3;
