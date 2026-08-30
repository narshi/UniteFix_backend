/**
 * UPI ID format checks, for instant feedback as the partner types.
 *
 * MIRRORS `shared/upi.ts`. Metro cannot resolve a directory outside the mobile
 * root, so this is a deliberate copy rather than an import. Keep the two in
 * step; the SERVER is the authority and re-checks everything, so a drift here
 * costs a confusing message, never a bad id getting saved.
 *
 * This only catches malformed ids. Whether a well-formed id actually exists —
 * and whose it is — comes from POST /api/partner/profile/upi/validate.
 */

export interface UpiCheckResult {
    ok: boolean;
    severity?: 'error' | 'warning';
    message?: string;
    normalised?: string;
}

const KNOWN_HANDLES = new Set([
    'ybl', 'ibl', 'axl',
    'okhdfcbank', 'oksbi', 'okaxis', 'okicici',
    'paytm', 'ptaxis', 'ptsbi', 'ptyes', 'pthdfc',
    'apl', 'yapl', 'rapl',
    'upi', 'abfspay',
    'hdfcbank', 'sbi', 'icici', 'axisbank', 'kotak', 'yesbank', 'indus',
    'idfcbank', 'idfcfirst', 'federal', 'fbl', 'unionbank', 'uboi', 'barodampay',
    'cnrb', 'pnb', 'cbin', 'iob', 'ikwik', 'jupiteraxis', 'timecosmos',
    'waaxis', 'wasbi', 'wahdfcbank', 'waicici',
    'airtel', 'freecharge', 'slice', 'naviaxis', 'fam', 'superyes',
]);

const EMAIL_DOMAIN = /\.(com|in|net|org|co|io|me|info|edu|gov)$/i;
const VPA_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;

export function checkUpiFormat(raw: string): UpiCheckResult {
    if (!raw || !raw.trim()) {
        return { ok: false, severity: 'error', message: 'Enter your UPI ID.' };
    }

    // Trimmed, but interior whitespace is never stripped — deleting a space
    // turns "ram esh@ybl" into "ramesh@ybl", which could be a real VPA belonging
    // to someone else. See shared/upi.ts.
    const vpa = raw.trim().toLowerCase();

    if (/\s/.test(vpa)) {
        return {
            ok: false, severity: 'error',
            message: 'A UPI ID has no spaces in it. Copy it exactly from your payment app.',
        };
    }

    const atCount = (vpa.match(/@/g) || []).length;

    if (atCount === 0) {
        return {
            ok: false, severity: 'error',
            message: 'A UPI ID needs an @ — like 9876543210@ybl. Copy it from your payment app.',
        };
    }
    if (atCount > 1) {
        return {
            ok: false, severity: 'error',
            message: 'A UPI ID has only one @. Copy it exactly from your payment app.',
        };
    }

    const [identifier, handle] = vpa.split('@');

    // The most common mistake by far, so it gets its own message rather than a
    // generic "invalid" a partner would read as wrong-about-their-own-email.
    if (EMAIL_DOMAIN.test(handle)) {
        return {
            ok: false, severity: 'error',
            message: "That's an email address, not a UPI ID. A UPI ID ends in something like @ybl or @okhdfcbank.",
        };
    }

    if (identifier.length < 2 || handle.length < 2) {
        return {
            ok: false, severity: 'error',
            message: 'That UPI ID looks incomplete. Copy the whole thing from your payment app.',
        };
    }

    if (!VPA_PATTERN.test(vpa)) {
        return {
            ok: false, severity: 'error',
            message: "That doesn't look like a UPI ID. It should look like 9876543210@ybl.",
        };
    }

    if (!KNOWN_HANDLES.has(handle)) {
        // Warning, never a block — new payment apps and bank handles appear, and
        // rejecting a valid one is worse than a second look at a rare typo.
        return {
            ok: true, severity: 'warning', normalised: vpa,
            message: `We don't recognise "@${handle}". Check it matches your payment app exactly.`,
        };
    }

    return { ok: true, normalised: vpa };
}
