/**
 * One-time codes are stored as a hash, never as the digits that were sent.
 *
 * A code in the otp_verifications table is a key to an account for as long as
 * it is valid — anyone who could read that table (a database backup, a staff
 * login with the SQL console, a log of a query) could sign in as whoever asked
 * for it. Stored hashed, reading the table no longer gives a way in.
 *
 * A six-digit code has only a million values, so the hash does not stop someone
 * who has the table from trying them all offline — what protects the code is
 * that it expires in minutes and is limited to five guesses. This protects the
 * long tail of old rows and the casual read.
 *
 * `otpMatches` still accepts a row written before this change (plain digits,
 * recognisable by its length), so a code requested a moment before a deploy
 * still works when the deploy lands.
 */

import crypto from 'crypto';

const HASH_SHAPE = /^[0-9a-f]{64}$/;

/** What is stored for a code. */
export function hashOtp(code: string): string {
    return crypto.createHash('sha256').update(`unitefix-otp:${String(code)}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Does `submitted` match the stored value, in constant time? */
export function otpMatches(stored: string | null | undefined, submitted: string): boolean {
    if (!stored || typeof submitted !== 'string') return false;
    return HASH_SHAPE.test(stored)
        ? safeEqual(stored, hashOtp(submitted))
        : safeEqual(stored, submitted);          // a row from before hashing
}
