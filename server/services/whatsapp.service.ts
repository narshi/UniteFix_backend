/**
 * WhatsApp messages from UniteFix's business number — WhatsApp Cloud API
 * (Meta, no middleman). Business-started messages must use a template Meta
 * has approved; the payment-link template is a UTILITY template.
 *
 * Connected in admin → WhatsApp (stored in integration_settings, the access
 * token sealed by secret-box.ts and never sent back to the browser), or by
 * environment variables, which win when all are set:
 *   WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_PAYMENT_TEMPLATE,
 *   WHATSAPP_TEMPLATE_LANG (default en), WHATSAPP_BUSINESS_ACCOUNT_ID (for templates)
 *
 * The payment template's body takes five values, in this order:
 *   {{1}} customer's name, {{2}} service, {{3}} booking number, {{4}} amount (₹), {{5}} payment link
 * Staff can submit it to Meta for approval from the admin (submitTemplate).
 *
 * When a send fails (or before it is connected), callers also get a wa.me link
 * staff can open to send the same text from WhatsApp Web.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { integrationSettings } from '@shared/schema';
import { seal, open } from '../lib/secret-box';
import { recordAudit } from '../lib/audit';
import logger from '../lib/logger';

/** Overridable so tests can stand in for Meta. */
const graph = () => (process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v21.0').replace(/\/$/, '');
export const DEFAULT_TEMPLATE = 'unitefix_payment_link';
export const TEMPLATE_BODY = 'Hi {{1}}, your UniteFix booking for {{2}} ({{3}}) is ready. Pay ₹{{4}} to confirm it: {{5}}';
const TEMPLATE_EXAMPLE = ['Ravi', 'Tap repair', 'SR000123', '99', 'https://rzp.io/i/abc123'];

export type WhatsAppResult = { sent: boolean; reason?: 'not_configured' | 'failed'; detail?: string; fallbackUrl: string };
type Settings = {
    token: string | null; phoneNumberId: string | null; businessAccountId: string | null;
    template: string; lang: string; enabled: boolean; source: 'env' | 'admin' | null;
    displayNumber: string | null; verifiedName: string | null; templateStatus: string | null; templateReason: string | null; checkedAt: string | null;
};

export class WhatsAppError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
let cache: { at: number; s: Settings } | null = null;
/** The settings row; a test uses its own so it never touches the real connection. */
const ROW = () => process.env.WHATSAPP_SETTINGS_KEY || 'whatsapp';

export class WhatsAppService {
    /** The connection in use: environment variables when all set, else what staff saved. Cached for a minute. */
    static async settings(): Promise<Settings> {
        if (cache && Date.now() - cache.at < 60_000) return cache.s;
        const env = process.env;
        const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, ROW())).limit(1).catch(() => [] as any[]);
        const c: any = row?.config ?? {};
        const base = {
            displayNumber: c.displayNumber ?? null, verifiedName: c.verifiedName ?? null,
            templateStatus: c.templateStatus ?? null, templateReason: c.templateReason ?? null, checkedAt: c.checkedAt ?? null,
        };
        let s: Settings;
        if (env.WHATSAPP_CLOUD_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_PAYMENT_TEMPLATE) {
            s = { token: env.WHATSAPP_CLOUD_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID || c.businessAccountId || null,
                template: env.WHATSAPP_PAYMENT_TEMPLATE, lang: env.WHATSAPP_TEMPLATE_LANG || 'en', enabled: true, source: 'env', ...base };
        } else if (row) {
            s = { token: open(row.secret), phoneNumberId: c.phoneNumberId ?? null, businessAccountId: c.businessAccountId ?? null,
                template: c.template || DEFAULT_TEMPLATE, lang: c.lang || 'en', enabled: c.enabled !== false, source: 'admin', ...base };
        } else {
            s = { token: null, phoneNumberId: null, businessAccountId: null, template: DEFAULT_TEMPLATE, lang: 'en', enabled: false, source: null, ...base };
        }
        cache = { at: Date.now(), s };
        return s;
    }

    static async configured() {
        const s = await this.settings();
        return !!(s.enabled && s.token && s.phoneNumberId && s.template);
    }

    /** A wa.me link with the message typed in, for staff to send by hand. */
    static manualLink(phone10: string, text: string) {
        return `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`;
    }

    static paymentText(p: { name: string; service: string; ref: string; amount: number; url: string }) {
        return `Hi ${p.name || 'there'}, your UniteFix booking for ${p.service} (${p.ref}) is ready. Pay ₹${p.amount} to confirm it: ${p.url}`;
    }

    private static async call(s: Settings, method: string, path: string, body?: unknown) {
        const res = await fetch(`${graph()}/${path}`, {
            method,
            headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(12_000),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = json?.error?.error_user_msg || json?.error?.message || `WhatsApp refused it (${res.status})`;
            throw new WhatsAppError(msg, res.status >= 500 ? 502 : 400);
        }
        return json;
    }

    private static async sendTemplate(s: Settings, phone10: string, values: string[]) {
        return this.call(s, 'POST', `${s.phoneNumberId}/messages`, {
            messaging_product: 'whatsapp',
            to: `91${phone10}`,
            type: 'template',
            template: {
                name: s.template,
                language: { code: s.lang },
                components: [{ type: 'body', parameters: values.map(text => ({ type: 'text', text: String(text).slice(0, 300) })) }],
            },
        });
    }

    /** Send the payment-link template. Never throws. */
    static async sendPaymentLink(phone10: string, p: { name: string; service: string; ref: string; amount: number; url: string }): Promise<WhatsAppResult> {
        const fallbackUrl = this.manualLink(phone10, this.paymentText(p));
        const s = await this.settings();
        if (!(s.enabled && s.token && s.phoneNumberId && s.template)) return { sent: false, reason: 'not_configured', fallbackUrl };
        try {
            await this.sendTemplate(s, phone10, [p.name || 'there', p.service, p.ref, String(p.amount), p.url]);
            return { sent: true, fallbackUrl };
        } catch (e: any) {
            logger.warn('[WHATSAPP] Payment link not sent', { error: e?.message });
            return { sent: false, reason: 'failed', detail: e instanceof WhatsAppError ? e.message : 'WhatsApp could not be reached', fallbackUrl };
        }
    }

    // ── Admin → WhatsApp ───────────────────────────────────────────────────

    /** What the admin page shows. The token itself never leaves the server. */
    static async status() {
        const s = await this.settings();
        return {
            source: s.source, enabled: s.enabled, connected: !!(s.token && s.phoneNumberId),
            ready: !!(s.enabled && s.token && s.phoneNumberId && s.template && s.templateStatus === 'APPROVED'),
            tokenSaved: !!s.token, tokenEnding: s.token ? s.token.slice(-4) : null,
            phoneNumberId: s.phoneNumberId, businessAccountId: s.businessAccountId, template: s.template, lang: s.lang,
            displayNumber: s.displayNumber, verifiedName: s.verifiedName, templateStatus: s.templateStatus, templateReason: s.templateReason, checkedAt: s.checkedAt,
            templateBody: TEMPLATE_BODY,
        };
    }

    private static async saveRow(adminId: number, config: Record<string, unknown>, token?: string | null) {
        const [row] = await db.select().from(integrationSettings).where(eq(integrationSettings.key, ROW())).limit(1);
        const merged = { ...((row?.config as any) ?? {}), ...config };
        const secret = token === undefined ? row?.secret ?? null : token ? seal(token) : null;
        if (row) await db.update(integrationSettings).set({ config: merged, secret, updatedBy: adminId, updatedAt: new Date() }).where(eq(integrationSettings.key, ROW()));
        else await db.insert(integrationSettings).values({ key: ROW(), config: merged, secret, updatedBy: adminId });
        cache = null;
    }

    /** Save the connection and check it with Meta (the number's name and display number). */
    static async connect(adminId: number, input: Record<string, unknown>) {
        const cur = await this.settings();
        if (cur.source === 'env') throw new WhatsAppError('WhatsApp is set by the server\'s environment variables; change it there.', 409);
        const token = clean(input.token, 600) || null;          // blank = keep the saved one
        const phoneNumberId = clean(input.phoneNumberId, 40);
        const businessAccountId = clean(input.businessAccountId, 40) || null;
        const template = clean(input.template, 60) || DEFAULT_TEMPLATE;
        const lang = clean(input.lang, 10) || 'en';
        if (!/^\d{6,30}$/.test(phoneNumberId)) throw new WhatsAppError('Enter the Phone number ID from WhatsApp Manager → API setup (digits only).');
        if (businessAccountId && !/^\d{6,30}$/.test(businessAccountId)) throw new WhatsAppError('The WhatsApp Business Account ID is digits only.');
        if (!/^[a-z0-9_]{1,60}$/.test(template)) throw new WhatsAppError('A template name is lower-case letters, digits and _ only.');
        const useToken = token ?? cur.token;
        if (!useToken) throw new WhatsAppError('Paste the access token.');
        // Check before saving: a wrong token or id is caught here, not on a customer's booking.
        const probe = await this.call({ ...cur, token: useToken }, 'GET', `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
        await this.saveRow(adminId, {
            phoneNumberId, businessAccountId, template, lang, enabled: input.enabled === undefined ? true : input.enabled !== false,
            displayNumber: probe.display_phone_number ?? null, verifiedName: probe.verified_name ?? null, checkedAt: new Date().toISOString(),
            ...(template !== cur.template ? { templateStatus: null, templateReason: null } : {}),
        }, token ?? undefined);
        await recordAudit({ entityType: 'integration', entityId: 0, action: 'whatsapp_connected', changedBy: adminId, metadata: { phoneNumberId, displayNumber: probe.display_phone_number, template, tokenChanged: !!token } });
        return this.status();
    }

    /** Turn automatic WhatsApp sending on or off (keeps the connection). */
    static async setEnabled(adminId: number, enabled: boolean) {
        const cur = await this.settings();
        if (cur.source === 'env') throw new WhatsAppError('WhatsApp is set by the server\'s environment variables; change it there.', 409);
        if (!cur.source) throw new WhatsAppError('Connect WhatsApp first.', 409);
        await this.saveRow(adminId, { enabled });
        await recordAudit({ entityType: 'integration', entityId: 0, action: enabled ? 'whatsapp_on' : 'whatsapp_off', changedBy: adminId });
        return this.status();
    }

    /** Forget the saved connection. */
    static async disconnect(adminId: number) {
        await db.delete(integrationSettings).where(eq(integrationSettings.key, ROW()));
        cache = null;
        await recordAudit({ entityType: 'integration', entityId: 0, action: 'whatsapp_disconnected', changedBy: adminId });
        return this.status();
    }

    /** Submit the payment-link template to Meta for approval (UTILITY). */
    static async submitTemplate(adminId: number) {
        const s = await this.settings();
        if (!s.token || !s.businessAccountId) throw new WhatsAppError('Save the access token and the WhatsApp Business Account ID first.', 409);
        const r = await this.call(s, 'POST', `${s.businessAccountId}/message_templates`, {
            name: s.template, language: s.lang, category: 'UTILITY',
            components: [{ type: 'BODY', text: TEMPLATE_BODY, example: { body_text: [TEMPLATE_EXAMPLE] } }],
        });
        if (s.source === 'admin') await this.saveRow(adminId, { templateStatus: r.status ?? 'PENDING', templateReason: null, templateId: r.id ?? null, checkedAt: new Date().toISOString() });
        await recordAudit({ entityType: 'integration', entityId: 0, action: 'whatsapp_template_submitted', changedBy: adminId, metadata: { template: s.template, status: r.status } });
        return this.status();
    }

    /** Ask Meta where the template stands: APPROVED, PENDING or REJECTED (with the reason). */
    static async refreshTemplate(adminId: number) {
        const s = await this.settings();
        if (!s.token || !s.businessAccountId) throw new WhatsAppError('Save the access token and the WhatsApp Business Account ID first.', 409);
        const r = await this.call(s, 'GET', `${s.businessAccountId}/message_templates?name=${encodeURIComponent(s.template)}&fields=name,status,language,category,rejected_reason`);
        const t = (r.data ?? []).find((x: any) => x.name === s.template && (!x.language || x.language === s.lang)) ?? (r.data ?? [])[0];
        const status = t?.status ?? 'NOT_FOUND';
        const reason = t?.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null;
        if (s.source === 'admin') await this.saveRow(adminId, { templateStatus: status, templateReason: reason, templateCategory: t?.category ?? null, checkedAt: new Date().toISOString() });
        else cache = null;
        return { ...(await this.status()), templateStatus: status, templateReason: reason, templateCategory: t?.category ?? null };
    }

    /** Send the payment template with sample values to a staff number. */
    static async sendTest(rawPhone: unknown) {
        const phone = String(rawPhone ?? '').replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(phone)) throw new WhatsAppError('Enter a 10-digit mobile number to send the test to.');
        const s = await this.settings();
        if (!s.token || !s.phoneNumberId) throw new WhatsAppError('Connect WhatsApp first.', 409);
        await this.sendTemplate(s, phone, ['Test', 'Tap repair', 'SR000000', '99', 'https://unitefix.com']);
        return { sent: true, to: phone };
    }
}
