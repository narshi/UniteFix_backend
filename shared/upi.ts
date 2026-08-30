/**
 * UPI ID (VPA) validation.
 *
 * Until now the only check was `upiId.includes('@')`, so `ramesh@gmail.com`,
 * `9876543210@ybll` and `a@b` all saved happily — and the partner found out
 * their payout details were wrong when money failed to arrive, if at all.
 *
 * Three things can be wrong with a UPI ID, and they need different answers:
 *
 *   1. Malformed        — caught here, instantly, for free.
 *   2. Well-formed but nonexistent — only the PSP knows; see
 *      server/services/upi-validation.service.ts.
 *   3. Well-formed, real, but SOMEONE ELSE'S — no format check will ever catch
 *      this. Only showing the registered name back to the partner does.
 *
 * This file handles (1) and nothing more. It deliberately never returns a bare
 * "invalid": a partner who is told *what* is wrong can fix it, and one who is
 * told "invalid UPI ID" tries the same string again.
 *
 * NOTE: `mobile/src/utils/upi.ts` mirrors the format checks so the app can give
 * feedback as the partner types — Metro cannot resolve this directory. The
 * server is the authority; the mobile copy exists only to avoid a round trip per
 * keystroke. Keep them in step.
 */

export type UpiCheckSeverity = 'error' | 'warning';

export interface UpiCheckResult {
    /** False only for things we are confident are wrong. Warnings pass. */
    ok: boolean;
    severity?: UpiCheckSeverity;
    code?:
    | 'EMPTY'
    | 'NO_HANDLE'
    | 'LOOKS_LIKE_EMAIL'
    | 'MULTIPLE_AT'
    | 'BAD_CHARACTERS'
    | 'TOO_SHORT'
    | 'UNKNOWN_HANDLE';
    /** Written for the partner, not for a developer. */
    message?: string;
    /** Trimmed and lower-cased, ready to store. */
    normalised?: string;
}

/**
 * PSP handles we recognise. Deliberately used only to WARN, never to reject:
 * new payment apps and bank handles appear regularly, and refusing a valid one
 * because this list is stale is worse than letting a rare typo through to the
 * PSP check.
 */
const KNOWN_HANDLES = new Set([
    // PhonePe / Yes Bank
    'ybl', 'ibl', 'axl',
    // Google Pay
    'okhdfcbank', 'oksbi', 'okaxis', 'okicici',
    // Paytm
    'paytm', 'ptaxis', 'ptsbi', 'ptyes', 'pthdfc',
    // Amazon Pay
    'apl', 'yapl', 'rapl',
    // BHIM and generic
    'upi', 'abfspay',
    // Banks
    'hdfcbank', 'sbi', 'icici', 'axisbank', 'kotak', 'yesbank', 'indus',
    'idfcbank', 'idfcfirst', 'federal', 'fbl', 'unionbank', 'uboi', 'barodampay',
    'cnrb', 'pnb', 'cbin', 'iob', 'ikwik', 'jupiteraxis', 'timecosmos',
    'waaxis', 'wasbi', 'wahdfcbank', 'waicici',
    'airtel', 'freecharge', 'slice', 'naviaxis', 'fam', 'superyes',
]);

/** Domains that mean the partner typed an email address into the UPI field. */
const EMAIL_DOMAIN = /\.(com|in|net|org|co|io|me|info|edu|gov)$/i;

/**
 * NPCI allows letters, digits, dot, hyphen and underscore before the handle.
 * The handle itself is alphabetic in practice.
 */
const VPA_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;

export function checkUpiFormat(raw: unknown): UpiCheckResult {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return {
            ok: false, severity: 'error', code: 'EMPTY',
            message: 'Enter your UPI ID.',
        };
    }

    // UPI IDs are case-insensitive; store one form so two spellings of the same
    // id cannot end up on two different partners.
    //
    // Whitespace is TRIMMED but never stripped from the middle. Removing an
    // interior space silently turns "ram esh@ybl" into "ramesh@ybl", which may
    // be a real VPA belonging to somebody else entirely — the id we save would
    // not be the id the partner typed, and nobody would ever know.
    const vpa = raw.trim().toLowerCase();

    if (/\s/.test(vpa)) {
        return {
            ok: false, severity: 'error', code: 'BAD_CHARACTERS',
            message: "A UPI ID has no spaces in it. Copy it exactly from your payment app.",
        };
    }

    const atCount = (vpa.match(/@/g) || []).length;
    if (atCount === 0) {
        return {
            ok: false, severity: 'error', code: 'NO_HANDLE',
            message: "A UPI ID needs an @ — like 9876543210@ybl. Copy it from your payment app.",
        };
    }
    if (atCount > 1) {
        return {
            ok: false, severity: 'error', code: 'MULTIPLE_AT',
            message: 'A UPI ID has only one @. Copy it exactly from your payment app.',
        };
    }

    const [identifier, handle] = vpa.split('@');

    // THE most common mistake: an email address in the UPI field. Named
    // explicitly, because "invalid UPI ID" leaves someone staring at an address
    // they know is correct — it just isn't a UPI ID.
    if (EMAIL_DOMAIN.test(handle)) {
        return {
            ok: false, severity: 'error', code: 'LOOKS_LIKE_EMAIL',
            message: "That's an email address, not a UPI ID. A UPI ID ends in something like @ybl or @okhdfcbank — check your payment app.",
        };
    }

    if (identifier.length < 2 || handle.length < 2) {
        return {
            ok: false, severity: 'error', code: 'TOO_SHORT',
            message: "That UPI ID looks incomplete. Copy the whole thing from your payment app.",
        };
    }

    if (!VPA_PATTERN.test(vpa)) {
        return {
            ok: false, severity: 'error', code: 'BAD_CHARACTERS',
            message: "That doesn't look like a UPI ID. It should look like 9876543210@ybl or name@okhdfcbank.",
        };
    }

    if (!KNOWN_HANDLES.has(handle)) {
        // A warning, not a rejection — see KNOWN_HANDLES above.
        return {
            ok: true, severity: 'warning', code: 'UNKNOWN_HANDLE',
            normalised: vpa,
            message: `We don't recognise "@${handle}". Double-check it matches your payment app exactly.`,
        };
    }

    return { ok: true, normalised: vpa };
}
