/**
 * Online payment links for a partner's customers.
 *
 *   Hub     GET  /api/hub/pay-links                  links, newest first (?kind=&refId=)
 *           POST /api/hub/pay-links                  { kind: invoice|milestone, refId, amountRupees? } — the open link, or a new one
 *           POST /api/hub/pay-links/:id/cancel
 *   Public  GET  /api/public/pay/:token              what is being paid, to whom
 *           POST /api/public/pay/:token/order        start a payment (Razorpay order)
 *           POST /api/public/pay/:token/confirm      the signed result from the checkout
 */

import type { Express } from 'express';
import { z } from 'zod';
import { authenticateHub, hubCan, hubError, HubRequest } from '../middleware/hub-auth';
import { HubError } from '../services/partner-hub.service';
import { PartnerPayLinkService } from '../services/partner-pay-links.service';
import { publicLimiter } from '../middleware/rate-limit';

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HubError(r.error.issues[0]?.message ?? 'Invalid input', 'BAD_INPUT');
    return r.data;
};

export function registerHubPayLinkRoutes(app: Express) {
    const active = authenticateHub();
    const ctxOf = (req: any) => (req as HubRequest).hub!;

    app.get('/api/hub/pay-links', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
            const refId = req.query.refId ? Number(req.query.refId) : undefined;
            res.json({ success: true, data: { gateway: PartnerPayLinkService.gatewayReady(), fee: await PartnerPayLinkService.fee(10000), links: await PartnerPayLinkService.list(ctxOf(req).businessPartnerId, { kind, refId }) } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/pay-links', active, hubCan('sales:manage'), async (req, res, next) => {
        try {
            const b = parse(z.object({ kind: z.enum(['invoice', 'milestone']), refId: z.number().int().positive(), amountRupees: z.number().positive().optional().nullable() }), req.body ?? {});
            const link = await PartnerPayLinkService.create(ctxOf(req), b);
            res.status(201).json({ success: true, message: 'Payment link ready.', data: { ...link, gateway: PartnerPayLinkService.gatewayReady() } });
        } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/hub/pay-links/:id/cancel', active, hubCan('sales:manage'), async (req, res, next) => {
        try { res.json({ success: true, message: 'Link cancelled.', data: await PartnerPayLinkService.cancel(ctxOf(req), Number(req.params.id)) }); } catch (e) { hubError(e, res, next); }
    });

    app.get('/api/public/pay/:token', async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerPayLinkService.publicView(req.params.token) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/pay/:token/order', publicLimiter, async (req, res, next) => {
        try { res.json({ success: true, data: await PartnerPayLinkService.startPayment(req.params.token) }); } catch (e) { hubError(e, res, next); }
    });
    app.post('/api/public/pay/:token/confirm', async (req, res, next) => {
        try {
            const b = parse(z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }), req.body ?? {});
            res.json({ success: true, message: 'Payment received. Thank you.', data: await PartnerPayLinkService.confirm(req.params.token, b) });
        } catch (e) { hubError(e, res, next); }
    });
}
