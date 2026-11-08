/**
 * Book by call (call-booking.service.ts) — staff book for a customer on the phone.
 *
 *   GET  /api/admin/call-bookings/customer?phone=9845012345   the customer, addresses, recent bookings (or null: new)
 *   GET  /api/admin/call-bookings/quote?catalogServiceId=&pincode=&quantity=
 *   POST /api/admin/call-bookings      { phone, name?, email?, payment: link|after_service, catalogServiceId, quantity?, address, pincode, preferredDate?, preferredTimeSlot?, urgency?, description?, note? }
 *   POST /api/admin/call-bookings/:id/resend-link        { channels: [sms, email, whatsapp], email? }
 *   POST /api/admin/call-bookings/:id/pay-after-service
 *   GET  /api/admin/call-bookings      the latest call bookings
 * Bookings capability (capability-map.ts): view to look up and quote, manage to book.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { CallBookingService, CallBookingError, publicQuote } from '../services/call-booking.service';

export function registerCallBookingRoutes(app: Express) {
    const fail = (e: unknown, res: Response, next: NextFunction) => {
        if (e instanceof CallBookingError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
        next(e);
    };
    const adminId = (req: Request) => (req as any).admin?.userId as number;
    const base = '/api/admin/call-bookings';

    app.get(`${base}/customer`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: await CallBookingService.lookup(req.query.phone) }); } catch (e) { fail(e, res, next); }
    });
    app.get(`${base}/quote`, authenticateAdmin, async (req, res, next) => {
        try { res.json({ success: true, data: publicQuote(await CallBookingService.quote(req.query as any)) }); } catch (e) { fail(e, res, next); }
    });
    app.post(base, authenticateAdmin, async (req, res, next) => {
        try {
            const r = await CallBookingService.create(adminId(req), req.body ?? {});
            res.status(201).json({ success: true, message: r.payment.mode === 'link' ? `Booked ${r.ref}. The payment link is sent; it joins the queue once paid.` : `Booked ${r.ref} for the customer. It is in the queue now.`, data: r });
        } catch (e) { fail(e, res, next); }
    });
    const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new CallBookingError('Unknown booking.', 404); return n; };
    /** Send the payment link again: { channels: ['sms','email','whatsapp'], email? }. A fresh link when the last expired. */
    app.post(`${base}/:id/resend-link`, authenticateAdmin, async (req, res, next) => {
        try {
            const r = await CallBookingService.resend(adminId(req), id(req), req.body ?? {});
            res.json({ success: true, message: r.newLink ? 'A new payment link was made and sent.' : 'The payment link was sent again.', data: r });
        } catch (e) { fail(e, res, next); }
    });
    /** The customer will pay after the service instead: no fee now; the booking joins the queue. */
    app.post(`${base}/:id/pay-after-service`, authenticateAdmin, async (req, res, next) => {
        try {
            const r = await CallBookingService.payAfterService(adminId(req), id(req));
            res.json({ success: true, message: `${r.ref} is now pay-after-service and in the queue.`, data: r });
        } catch (e) { fail(e, res, next); }
    });
    app.get(base, authenticateAdmin, async (_req, res, next) => {
        try { res.json({ success: true, data: await CallBookingService.recent() }); } catch (e) { fail(e, res, next); }
    });
}
