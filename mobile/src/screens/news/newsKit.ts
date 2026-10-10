/** Shared bits of the newspaper screens: newsprint colours, dates, sharing. */

import { Share } from 'react-native';
import { API_BASE_URL } from '../../api/client';

export const NEWS_PAPER = '#F5F1E8';
export const NEWS_INK = '#16130F';
export const NEWS_RED = '#A3271F';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** "Today", "Yesterday", or "Mon, 8 Sept". */
export function newsDay(d: string) {
    const t = istToday();
    if (d === t) return 'Today';
    if (d === addDays(t, -1)) return 'Yesterday';
    if (d === addDays(t, 1)) return 'Tomorrow';
    return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Share an edition: the link shows half the front page and brings people to the app. */
export function shareEdition(e: { paper: string; editionDate: string; headline?: string | null; shareUrl: string }) {
    const url = `${API_BASE_URL}${e.shareUrl}`;
    return Share.share({ message: `${e.paper} — ${longDay(e.editionDate)}${e.headline ? `\n${e.headline}` : ''}\n\nRead it free on UniteFix: ${url}` }).catch(() => undefined);
}

export function sharePaper(p: { name: string; shareUrl: string | null }) {
    if (!p.shareUrl) return Promise.resolve(undefined);
    return Share.share({ message: `Read ${p.name} free on the UniteFix app, and get every new edition the moment it comes out: ${API_BASE_URL}${p.shareUrl}` }).catch(() => undefined);
}
