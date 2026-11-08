/**
 * WhatsApp messages from UniteFix's business number — WhatsApp Cloud API
 * (Meta). Business-initiated messages must use a template Meta has approved.
 *
 * Set up (Render environment):
 *   WHATSAPP_CLOUD_TOKEN        a permanent access token for the WhatsApp Business account
 *   WHATSAPP_PHONE_NUMBER_ID    the sending number's id (WhatsApp Manager → API setup)
 *   WHATSAPP_PAYMENT_TEMPLATE   the approved template's name for payment links
 *   WHATSAPP_TEMPLATE_LANG      its language code (default en)
 * The payment template's body takes five values, in this order:
 *   {{1}} customer's name, {{2}} service, {{3}} booking number, {{4}} amount (₹), {{5}} payment link
 * e.g. "Hi {{1}}, your UniteFix booking for {{2}} ({{3}}) is ready. Pay ₹{{4}} to
 *       confirm it: {{5}}"
 *
 * Until it is set up, send() says so and returns a wa.me link staff can open
 * to send the same text from WhatsApp Web. Tests never have these variables.
 */

import logger from '../lib/logger';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type WhatsAppResult = { sent: boolean; reason?: 'not_configured' | 'failed'; detail?: string; fallbackUrl: string };

export class WhatsAppService {
    static configured() {
        return !!(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PAYMENT_TEMPLATE);
    }

    /** A wa.me link with the message typed in, for staff to send by hand. */
    static manualLink(phone10: string, text: string) {
        return `https://wa.me/91${phone10}?text=${encodeURIComponent(text)}`;
    }

    static paymentText(p: { name: string; service: string; ref: string; amount: number; url: string }) {
        return `Hi ${p.name || 'there'}, your UniteFix booking for ${p.service} (${p.ref}) is ready. Pay ₹${p.amount} to confirm it: ${p.url}`;
    }

    /** Send the payment-link template. Never throws. */
    static async sendPaymentLink(phone10: string, p: { name: string; service: string; ref: string; amount: number; url: string }): Promise<WhatsAppResult> {
        const fallbackUrl = this.manualLink(phone10, this.paymentText(p));
        if (!this.configured()) return { sent: false, reason: 'not_configured', fallbackUrl };
        try {
            const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: `91${phone10}`,
                    type: 'template',
                    template: {
                        name: process.env.WHATSAPP_PAYMENT_TEMPLATE,
                        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
                        components: [{
                            type: 'body',
                            parameters: [p.name || 'there', p.service, p.ref, String(p.amount), p.url].map(text => ({ type: 'text', text: String(text).slice(0, 300) })),
                        }],
                    },
                }),
                signal: AbortSignal.timeout(10_000),
            });
            if (res.ok) return { sent: true, fallbackUrl };
            const body = await res.text().catch(() => '');
            logger.warn('[WHATSAPP] Template send refused', { status: res.status, body: body.slice(0, 300) });
            return { sent: false, reason: 'failed', detail: `WhatsApp refused it (${res.status})`, fallbackUrl };
        } catch (e: any) {
            logger.warn('[WHATSAPP] Template send failed', { error: e?.message });
            return { sent: false, reason: 'failed', detail: 'WhatsApp could not be reached', fallbackUrl };
        }
    }
}
