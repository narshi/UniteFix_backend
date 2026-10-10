/**
 * Newspaper links opened from WhatsApp or a QR code:
 *
 *   unitefix://news/e/<token>   a shared edition
 *   unitefix://news/p/<code>    a paper's follow link
 *
 * They are not routed by the linking config, because reading needs a signed-in
 * reader and the link usually arrives before sign-in (a fresh install). The
 * link is held here until the app has a signed-in branch, then RootNavigator
 * opens it in whichever app (customer, expert, business) the person uses.
 */

export type NewsLink = { kind: 'edition'; token: string } | { kind: 'paper'; code: string };

let pending: NewsLink | null = null;
const listeners = new Set<() => void>();

export function parseNewsLink(url: string | null | undefined): NewsLink | null {
    if (!url) return null;
    const m = /(?:^unitefix:\/\/|^https?:\/\/[^/]+\/|^exp\+?[^:]*:\/\/[^/]*\/--\/)?\/?news\/(e|p)\/([A-Za-z0-9_-]{3,40})/.exec(url);
    if (!m) return null;
    return m[1] === 'e' ? { kind: 'edition', token: m[2] } : { kind: 'paper', code: m[2] };
}

/** Hold a news link if the URL is one. Returns true when it was (so the router ignores it). */
export function captureNewsLink(url: string | null | undefined): boolean {
    const link = parseNewsLink(url);
    if (!link) return false;
    pending = link;
    listeners.forEach(l => l());
    return true;
}

export function takePendingNewsLink(): NewsLink | null {
    const l = pending;
    pending = null;
    return l;
}

export function onNewsLink(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
