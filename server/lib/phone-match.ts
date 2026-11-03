/**
 * The ways one Indian mobile number is stored in users.phone.
 *
 * App sign-ups store "+919876543210"; accounts made from the Partner Hub's
 * Team page (and some older rows) store "9876543210". Both are the same
 * person, so a lookup by phone must find either. Rows are never rewritten
 * here — we only widen how they are found.
 */

/** Every stored spelling of this number, the canonical "+91…" first. */
export function phoneVariants(raw: string): string[] {
    const given = String(raw ?? '').trim();
    const digits = given.replace(/\D/g, '');
    const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
        : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
        : digits.length === 10 ? digits : null;
    if (!ten || !/^[6-9]\d{9}$/.test(ten)) return given ? [given] : [];
    return Array.from(new Set([`+91${ten}`, ten, given]));
}
