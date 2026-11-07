/**
 * Home screen cards: the "Home Services" row of four on the app's Home.
 *
 * Staff keep sets of up to four cards (admin → Home screen). Each set is live
 *   always        — the everyday set;
 *   yearly        — every year between two days (1 Jun → 30 Sep; may cross the new year);
 *   dates         — between two calendar dates, once.
 * On a given day (India time) the live set with the highest priority wins
 * (at equal priority: dates, then yearly, then always). If it has fewer than
 * four usable cards, the next live sets fill the gaps; the app fills any still
 * missing with its built-in four.
 *
 * Shared by the server (validation, resolving) and the admin page.
 */

export const MAX_HOME_CARDS = 4;

export type HomeCardSchedule = 'always' | 'yearly' | 'dates';
export type HomeCardScreen = 'recharge' | 'celebrate' | 'all_services';
export type HomeCardPhoto =
    | { kind: 'auto' }                       // the app picks one from the category or service
    | { kind: 'library'; key: string }       // one of the app's bundled photos (PHOTO_LIBRARY)
    | { kind: 'link'; url: string };         // an image on the web (https)

export type HomeCard =
    | { target: 'category'; id: number; label?: string | null; photo?: HomeCardPhoto }
    | { target: 'service'; id: number; label?: string | null; photo?: HomeCardPhoto }
    | { target: 'screen'; screen: HomeCardScreen; label?: string | null; photo?: HomeCardPhoto };

/** What the app receives for one card. */
export type ResolvedHomeCard = {
    key: string;                              // stable per target, e.g. "category:60"
    target: 'category' | 'service' | 'screen';
    id: number | null;                        // category or service id
    categoryId: number | null;                // a service's category
    screen: HomeCardScreen | null;
    label: string;
    /** The category's or service's own name (for the app's icon and photo when the label is custom). */
    name: string;
    photo: HomeCardPhoto;
    fromSetId: number;
};

export type ResolvedHome = {
    date: string;                             // YYYY-MM-DD, India time
    heading: string;
    setId: number | null;
    setName: string | null;
    cards: ResolvedHomeCard[];
};

export const DEFAULT_HEADING = 'Home Services';

export const HOME_CARD_SCREENS: { key: HomeCardScreen; label: string }[] = [
    { key: 'recharge', label: 'Broadband recharge' },
    { key: 'celebrate', label: 'Celebrate (events, halls, photographers)' },
    { key: 'all_services', label: 'All services' },
];

/** The photos bundled in the app (mobile/assets/services/<key>.jpg). Keys must match the app's. */
export const PHOTO_LIBRARY: { key: string; label: string }[] = [
    ['plumbing', 'Tap (plumbing)'], ['electrical', 'Lamp (electrical)'], ['ac', 'Split AC'], ['painting', 'Paint roller'],
    ['travel', 'Suitcase and beach'], ['inspection', 'Technician with a multimeter'], ['house', 'House at night'],
    ['toilet_flush', 'Flush tank'], ['toilet_concealed', 'Concealed flush plate'], ['commode', 'Commode'], ['geyser', 'Geyser'],
    ['bathtub', 'Bathtub'], ['tank', 'Water tanks'], ['kitchen_sink', 'Kitchen sink'], ['basin', 'Wash basin'], ['pipes', 'Pipe repair'],
    ['mixer', 'Shower mixer'], ['fan', 'Ceiling fan'], ['lights', 'Ceiling light'], ['switchboard', 'Switch board'], ['socket', 'Socket'],
    ['mcb', 'MCB panel'], ['meter', 'Meter board'], ['wiring', 'Wiring'], ['laptop', 'Laptop repair'], ['desktop', 'Desktop PC'],
    ['desktop_repair', 'PC repair'], ['software', 'Software on a laptop'], ['ssd', 'SSD'], ['router', 'Wi-Fi router'], ['fiber', 'Fibre cables'],
    ['printer', 'Printer'], ['ink', 'Ink cartridges'], ['cctv', 'CCTV camera'], ['fingerprint', 'Biometric scanner'], ['battery', 'Inverter battery'],
    ['purifier', 'Water purifier'], ['washing', 'Washing machine'], ['solar', 'Solar panels'], ['tax', 'Tax papers'],
].map(([key, label]) => ({ key, label }));

export const isLibraryPhoto = (key: unknown) => typeof key === 'string' && PHOTO_LIBRARY.some(p => p.key === key);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (mmdd: string) => `${Number(mmdd.slice(3))} ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}`;
const date = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** "Every year, 1 Jun – 30 Sep" / "1 Mar 2027 – 31 Mar 2027" / "Always". */
export function describeSchedule(s: { schedule: string; fromMmdd?: string | null; toMmdd?: string | null; startsOn?: string | null; endsOn?: string | null }) {
    if (s.schedule === 'yearly' && s.fromMmdd && s.toMmdd) return `Every year, ${day(s.fromMmdd)} – ${day(s.toMmdd)}`;
    if (s.schedule === 'dates' && s.startsOn && s.endsOn) return `${date(s.startsOn)} – ${date(s.endsOn)}`;
    return 'Always';
}
