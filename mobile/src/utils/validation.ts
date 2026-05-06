/**
 * Auth Validation Utilities
 * Zero external dependencies — pure TypeScript.
 * Covers: email (RFC 5322 simplified), India phone (E.164).
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type IdentifierType = 'email' | 'phone' | 'unknown';

export interface ParsedIdentifier {
    type: IdentifierType;
    raw: string;          // user's original input
    normalized: string;   // cleaned/normalized value to send to backend
    error: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** India ISD code — 10-digit mobiles only */
const INDIA_CODE = '+91';
const INDIA_PHONE_RE = /^[6-9]\d{9}$/;                 // 10-digit Indian mobile
const INTL_PHONE_RE  = /^\+[1-9]\d{9,14}$/;            // E.164 international
// RFC 5322 simplified — handles 99.9% of real emails
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

// ─── Phone normalization ───────────────────────────────────────────────────

/**
 * Strips all whitespace, dashes, and parentheses from a phone string.
 * "98 765-43 210" → "9876543210"
 */
function stripPhoneFormatting(input: string): string {
    return input.replace(/[\s\-().]/g, '');
}

/**
 * Converts an Indian phone number to E.164 format.
 * Supports:
 *   "9876543210"      → "+919876543210"
 *   "09876543210"     → "+919876543210"
 *   "+919876543210"   → "+919876543210" (already correct)
 *   "+1 800 555 1234" → "+18005551234"  (intl — pass through)
 */
export function normalizePhone(input: string): string {
    const stripped = stripPhoneFormatting(input);

    if (stripped.startsWith('+')) {
        // Already E.164 — just clean formatting
        return stripped;
    }
    if (stripped.startsWith('0') && stripped.length === 11) {
        // Indian trunk prefix "0" — "09876543210"
        return `${INDIA_CODE}${stripped.slice(1)}`;
    }
    if (INDIA_PHONE_RE.test(stripped)) {
        return `${INDIA_CODE}${stripped}`;
    }
    // Return as-is and let validation catch it
    return stripped;
}

// ─── Validators ───────────────────────────────────────────────────────────

export function isValidEmail(input: string): boolean {
    return EMAIL_RE.test(input.trim());
}

export function isValidPhone(input: string): boolean {
    const normalized = normalizePhone(input);
    return INTL_PHONE_RE.test(normalized);
}

/**
 * Detects whether user input is an email or phone.
 */
export function detectIdentifierType(input: string): IdentifierType {
    const trimmed = input.trim();
    if (isValidEmail(trimmed)) return 'email';
    // Even partial phone input — detect before full normalization
    const stripped = stripPhoneFormatting(trimmed);
    if (/^[+0]?\d{9,15}$/.test(stripped)) return 'phone';
    return 'unknown';
}

/**
 * Full identifier parsing — validates and normalizes in one pass.
 * Use the returned ParsedIdentifier for API calls.
 */
export function parseIdentifier(input: string): ParsedIdentifier {
    const raw = input.trim();

    if (!raw) {
        return { type: 'unknown', raw, normalized: '', error: 'Please enter your email or phone number' };
    }

    if (isValidEmail(raw)) {
        return {
            type: 'email',
            raw,
            normalized: raw.toLowerCase(),
            error: null,
        };
    }

    const normalized = normalizePhone(raw);
    if (INTL_PHONE_RE.test(normalized)) {
        return {
            type: 'phone',
            raw,
            normalized,
            error: null,
        };
    }

    // Looks like an attempted email
    if (raw.includes('@')) {
        return { type: 'unknown', raw, normalized: '', error: 'Please enter a valid email address' };
    }

    return { type: 'unknown', raw, normalized: '', error: 'Please enter a valid email or Indian mobile number' };
}

// ─── Password validation ───────────────────────────────────────────────────

export interface PasswordStrength {
    score: 0 | 1 | 2 | 3;   // 0=weak, 1=fair, 2=good, 3=strong
    label: 'Weak' | 'Fair' | 'Good' | 'Strong';
    color: string;
    hints: string[];         // unmet requirements
}

export function checkPasswordStrength(password: string): PasswordStrength {
    const hints: string[] = [];
    let score = 0;

    if (password.length >= 8)  score++; else hints.push('At least 8 characters');
    if (/[A-Z]/.test(password)) score++; else hints.push('An uppercase letter');
    if (/\d/.test(password))   score++; else hints.push('A number');

    const labels: PasswordStrength['label'][] = ['Weak', 'Fair', 'Good', 'Strong'];
    const colorMap = ['#F44336', '#FF9800', '#2196F3', '#4CAF50'];

    return {
        score: score as PasswordStrength['score'],
        label: labels[score],
        color: colorMap[score],
        hints,
    };
}

export function validatePassword(password: string): string | null {
    if (!password) return 'Password is required';
    if (password.length < 6) return 'Password must be at least 6 characters';
    return null;
}

// ─── Masking (for display) ────────────────────────────────────────────────

/**
 * Masks a contact for display:
 *   "user@example.com"   → "us***@example.com"
 *   "+919876543210"      → "+91 98****3210"
 */
export function maskContact(contact: string): string {
    if (contact.includes('@')) {
        const [local, domain] = contact.split('@');
        const visible = local.slice(0, 2);
        return `${visible}***@${domain}`;
    }
    if (contact.startsWith('+')) {
        const digits = contact.slice(-4);
        const prefix = contact.slice(0, contact.length - 8);
        return `${prefix}****${digits}`;
    }
    return contact;
}
