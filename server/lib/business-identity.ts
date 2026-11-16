/**
 * UniteFix's own contact and tax details, as customers and experts see them.
 *
 * Several places each carried a made-up fallback for when a setting was
 * missing: a sample GSTIN on tax invoices, +91-9876543210 as the support
 * number, 919999999999 for WhatsApp, 'yourmerchant@upi' for the company UPI ID.
 * A fallback like that does not fail — it prints. A customer got an invoice
 * with a GSTIN that belongs to nobody, or a QR that pays a stranger.
 *
 * So: a sample value is treated as MISSING, here in one place. Missing means
 * the field is left off (and reported, loudly and once an hour, in the log and
 * on the go-live checklist) — never invented.
 */

import { configService } from '../services/config.service';
import logger from './logger';

export const SAMPLE_GSTIN = '29ABCDE1234F1Z5';
const SAMPLE_PHONES = new Set(['9876543210', '9999999999']);
const SAMPLE_UPI_IDS = new Set(['yourmerchant@upi']);

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** A GSTIN to print, or '' when none is configured (or only the sample is). */
export function realGstin(value: unknown): string {
    const g = String(value ?? '').trim().toUpperCase();
    return g && g !== SAMPLE_GSTIN ? g : '';
}

/** A phone number to show, or undefined when none is configured (or only a sample is). */
export function realPhone(value: unknown): string | undefined {
    const raw = String(value ?? '').trim();
    const d = digits(raw);
    if (!raw || d.length < 10 || SAMPLE_PHONES.has(d.slice(-10))) return undefined;
    return raw;
}

/** A UPI ID to pay to, or '' when none is configured (or only the sample is). */
export function realUpiId(value: unknown): string {
    const v = String(value ?? '').trim();
    return v && v.includes('@') && !SAMPLE_UPI_IDS.has(v.toLowerCase()) ? v : '';
}

/**
 * The number the app's "contact support" button has always fallen back to when
 * WHATSAPP_BUSINESS_NUMBER is unset (it was written into /api/config/public).
 * The "I need to cancel" links on the server fell back to 919999999999 instead,
 * which is nobody. One fallback now, and the go-live checklist says when the
 * setting itself is missing.
 */
const WHATSAPP_FALLBACK = '919448850679';

/** Is WHATSAPP_BUSINESS_NUMBER set to a real number? */
export function whatsAppConfigured(): boolean {
    const d = digits(process.env.WHATSAPP_BUSINESS_NUMBER);
    return d.length >= 10 && !SAMPLE_PHONES.has(d.slice(-10));
}

/** UniteFix's WhatsApp number for "contact support" links: digits, country code first. */
export function supportWhatsAppNumber(): string {
    return whatsAppConfigured() ? digits(process.env.WHATSAPP_BUSINESS_NUMBER) : WHATSAPP_FALLBACK;
}

/** A wa.me link to UniteFix support with a prefilled message. */
export function supportWhatsAppLink(text: string): string {
    return `https://wa.me/${supportWhatsAppNumber()}?text=${encodeURIComponent(text)}`;
}

/** The company UPI ID from Settings, or '' when it is unset or still the sample. */
export async function companyUpiId(): Promise<string> {
    return realUpiId(await configService.get('BUSINESS_CONFIG.COMPANY_UPI_ID', ''));
}

// ── Saying so ───────────────────────────────────────────────────────────

const lastReported = new Map<string, number>();

/**
 * Report a missing business detail. An error in production (it is a
 * misconfiguration customers can see), a warning elsewhere; at most once an
 * hour per detail, so a busy invoice screen does not flood the log.
 */
export function reportMissing(what: string, consequence: string): void {
    const now = Date.now();
    if (now - (lastReported.get(what) ?? 0) < 60 * 60 * 1000) return;
    lastReported.set(what, now);
    const line = `[BUSINESS_CONFIG] ${what} is not set (or is still the sample value) — ${consequence}`;
    if (process.env.NODE_ENV === 'production') logger.error(line);
    else logger.warn(line);
}
