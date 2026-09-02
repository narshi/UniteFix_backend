/**
 * Warranty: what a job is covered for, and claiming on it.
 *
 * The customer-facing half of the parts record. Without these routes we would
 * have provenance in the database and still no answer for the person on the
 * phone — better data that somebody has to look up by hand.
 *
 * The promise being kept here is "we handle the claim", NOT "we always pay".
 * Who absorbs the cost is decided by warranty.service.routeCost() from the
 * inspecting technician's verdict, and on every genuine failure the customer
 * pays nothing regardless of which of our suppliers is actually liable. They
 * should never have to work out who they are arguing with.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { serviceRequests, servicePartItems } from '@shared/schema';
import { authenticateToken, authenticatePartner, authenticateAny } from '../middleware/auth.middleware';
import {
    warrantySummary, createClaim, settleClaim, listClaims, getPartItems,
    partStatement, type Verdict,
} from '../services/warranty.service';
import logger from '../lib/logger';

const VERDICTS: Verdict[] = [
    'workmanship_fault', 'part_failed', 'customer_damage', 'out_of_warranty', 'unrelated',
];

export function registerWarrantyRoutes(app: Express) {

    /**
     * GET /api/bookings/:id/warranty
     *
     * Everything this job is covered for, in sentences rather than fields. Open
     * to the customer who booked it and to the partner who did it — both get
     * asked this question and neither could previously answer it.
     */
    app.get('/api/bookings/:id/warranty', authenticateAny, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

            const userId = (req as any).user?.userId ?? (req as any).user?.id;
            const partnerId = (req as any).partner?.partnerId;
            const isOwner = userId && booking.userId === userId;
            const isAssigned = partnerId && (booking as any).providerId === partnerId;
            if (!isOwner && !isAssigned) {
                return res.status(403).json({ success: false, message: 'This is not your booking' });
            }

            const summary = await warrantySummary(bookingId);
            res.json({ success: true, data: summary });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/bookings/:id/warranty-claims
     *
     * The customer raises a claim. Deliberately permissive about the window: a
     * claim just outside it is still recorded and then closed as out_of_warranty
     * with a reason, rather than refused at the door. Someone whose part failed
     * on day 92 deserves an answer, not a validation error.
     */
    app.post('/api/bookings/:id/warranty-claims', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const userId = (req as any).user?.userId ?? (req as any).user?.id;
            const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
            const partItemId = req.body?.partItemId ? parseInt(req.body.partItemId) : null;

            if (description.length < 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Please describe what went wrong, so the technician knows what to look at.',
                });
            }

            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.userId !== userId) {
                return res.status(403).json({ success: false, message: 'This is not your booking' });
            }

            if (partItemId) {
                const [part] = await db.select().from(servicePartItems)
                    .where(eq(servicePartItems.id, partItemId)).limit(1);
                if (!part || part.serviceRequestId !== bookingId) {
                    return res.status(400).json({ success: false, message: 'That part is not on this booking' });
                }
            }

            const claim = await createClaim({ serviceRequestId: bookingId, partItemId, raisedByUserId: userId, description });
            res.status(201).json({
                success: true,
                message: 'Claim raised. We will inspect it and handle it from here — you do not need to contact the shop.',
                data: claim,
            });
        } catch (error) { next(error); }
    });

    /** GET /api/bookings/:id/parts — what was fitted, with who backs each line. */
    app.get('/api/bookings/:id/parts', authenticateAny, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const items = await getPartItems(bookingId);
            res.json({
                success: true,
                data: items.map(p => ({
                    ...p,
                    lineTotalRupees: (p.unitPricePaise * p.quantity) / 100,
                    statement: partStatement(p as any),
                })),
            });
        } catch (error) { next(error); }
    });

    // ── admin ───────────────────────────────────────────────────────────────
    // Mapped to the `bookings` capability area (see capability-map.ts): a
    // warranty claim is a property of a job, and whoever manages service
    // requests is who handles them.

    app.get('/api/admin/warranty-claims', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const claims = await listClaims({
                status: typeof req.query.status === 'string' ? req.query.status : undefined,
                serviceRequestId: req.query.serviceRequestId ? parseInt(String(req.query.serviceRequestId)) : undefined,
            });
            res.json({ success: true, data: claims });
        } catch (error) { next(error); }
    });

    /**
     * POST /api/admin/warranty-claims/:id/verdict
     *
     * One verdict in, one cost bearer out. No case-by-case negotiation: the
     * routing is the policy, and recording it here is what makes the policy
     * auditable later.
     */
    app.post('/api/admin/warranty-claims/:id/verdict', async (req: Request, res: Response, next: NextFunction) => {
        try {
            const claimId = parseInt(req.params.id);
            const verdict = String(req.body?.verdict ?? '') as Verdict;
            // Whoever is signed in, not whoever the client claims. A settled claim
            // is the record of a decision, and a decision with no author is not
            // auditable later — which is the point of recording it at all.
            const inspectedBy = (req as any).admin?.userId ?? 0;

            if (!VERDICTS.includes(verdict)) {
                return res.status(400).json({
                    success: false,
                    message: `verdict must be one of: ${VERDICTS.join(', ')}`,
                });
            }

            const updated = await settleClaim(claimId, verdict, inspectedBy, req.body?.notes);
            if (!updated) return res.status(404).json({ success: false, message: 'Claim not found' });

            logger.info(`[WARRANTY] Claim #${claimId} settled: ${verdict} → ${updated.costBearer}`);
            res.json({
                success: true,
                message: `Recorded as ${verdict.replace(/_/g, ' ')}. Cost is borne by ${updated.costBearer}.`,
                data: updated,
            });
        } catch (error) { next(error); }
    });

    /** Partner-side: the parts I recorded, and whether the paperwork is complete. */
    app.get('/api/partner/bookings/:id/parts', authenticatePartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const items = await getPartItems(parseInt(req.params.id));
            res.json({
                success: true,
                data: {
                    items,
                    undocumented: items.filter(i => !i.isDocumented).length,
                    // Said plainly, because the consequence lands on them later.
                    hint: items.some(i => !i.isDocumented)
                        ? 'Add the shop bill photo and warranty period so this part is covered if it fails.'
                        : null,
                },
            });
        } catch (error) { next(error); }
    });
}
