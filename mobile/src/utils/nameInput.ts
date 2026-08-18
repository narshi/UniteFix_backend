/**
 * Text rules for human-entered names — a person's full name and a trade name.
 *
 * Deliberately a DENYLIST (strip digits and unwanted symbols) rather than an
 * allowlist of A-Z. An allowlist would reject Kannada, Devanagari and every
 * other script our users actually type their names in, and Hermes cannot be
 * relied on for unicode property escapes (\p{L}) to express "any letter".
 *
 * Because digits are stripped as they are typed, "contains at least one letter"
 * reduces to "is not empty after trimming" — no script-aware letter test is
 * needed anywhere below.
 */

/**
 * A person's name keeps letters of any script, spaces, and . ' -
 * (as in "D'Souza", "Ravi Kumar N.", "Anne-Marie").
 */
const PERSON_DISALLOWED = /[0-9!@#$%^&*()_=+{}\[\]|\\<>?~"`;:,/]/g;

/**
 * A trade additionally keeps & / ( ) — real entries include
 * "UPS & Battery Technician" and "Networking & Internet Technician".
 */
const TRADE_DISALLOWED = /[0-9!@#$%^*_=+{}\[\]|\\<>?~"`;:,]/g;

/** Collapse runs of whitespace and drop leading spaces, so typing still feels natural. */
function tidy(value: string): string {
    return value.replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
}

export function sanitizePersonName(value: string): string {
    return tidy(value.replace(PERSON_DISALLOWED, ''));
}

export function sanitizeTradeName(value: string): string {
    return tidy(value.replace(TRADE_DISALLOWED, ''));
}

/** null when valid, otherwise the message to show. */
export function validatePersonName(value: string): string | null {
    const name = value.trim();
    if (!name) return 'Please enter your full name';
    if (name.length < 2) return 'Please enter your full name';
    return null;
}

export function validateTradeName(value: string): string | null {
    const name = value.trim();
    if (!name) return null;
    if (name.length < 3) return 'Please enter at least 3 characters.';
    return null;
}

/** True when the filter would change the text — used to explain why characters vanished. */
export function hasDisallowedPersonChars(value: string): boolean {
    return sanitizePersonName(value) !== tidy(value);
}

export function hasDisallowedTradeChars(value: string): boolean {
    return sanitizeTradeName(value) !== tidy(value);
}

/** Case- and whitespace-insensitive key for duplicate detection. */
export function nameKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
