/**
 * PHASE 4: Geofence Routes — Booking status transitions with geofence enforcement
 *
 * Endpoints:
 * - PATCH /api/v1/bookings/:id/arrive   → ACCEPTED → REACHED (geofence gate)
 * - PATCH /api/v1/bookings/:id/start    → REACHED → IN_PROGRESS (OTP gate)
 *
 * Uses raw SQL with ST_DistanceSphere for distance calculation when PostGIS
 * geometry columns are available. Falls back to Haversine when coordinates
 * are stored as WKT text.
 */

import type { Express, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { eq, sql } from 'drizzle-orm';
import { serviceRequests, employees } from '@shared/schema';
import { authenticatePartner , requireVerifiedPartner} from '../middleware/auth.middleware';
import { BookingState, validateStateTransition, requiresGeofenceValidation, requiresOtpValidation } from '../business/booking-state-machine';
import { configService } from '../services/config.service';
import { BookingNotifications } from '../services/booking-notifications';
import logger from '../lib/logger';

export function registerGeofenceRoutes(app: Express) {

    /**
     * PATCH /api/v1/bookings/:id/arrive
     *
     * Employee marks "I've Arrived" at customer location.
     * Gate: PostGIS geofence — employee must be within MAX_SERVICE_START_DISTANCE meters.
     *
     * Body: { latitude: number, longitude: number }
     * Transition: ACCEPTED → REACHED
     */
    app.patch('/api/bookings/:id/arrive', authenticatePartner, requireVerifiedPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { latitude, longitude } = req.body;
            const partnerId = (req as any).partner?.partnerId;

            // ── Validate input ───────────────────────────────────────
            if (!latitude || !longitude || typeof latitude !== 'number' || typeof longitude !== 'number') {
                return res.status(400).json({
                    success: false,
                    message: 'Valid latitude and longitude are required',
                });
            }

            // ── Fetch booking ────────────────────────────────────────
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            // Verify this employee owns this booking
            if (booking.providerId !== partnerId) {
                return res.status(403).json({ success: false, message: 'This booking is not assigned to you' });
            }

            // ── State transition validation ──────────────────────────
            const currentState = booking.status as BookingState;
            const targetState = BookingState.REACHED;

            if (!validateStateTransition(currentState, targetState)) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot transition from '${currentState}' to '${targetState}'. Current state must be 'accepted'.`,
                });
            }

            // ── Geofence check ───────────────────────────────────────
            const maxDistStr = await configService.get<string>('OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE');
            const maxDistance = maxDistStr ? parseInt(maxDistStr, 10) : 200;

            let distanceMeters: number;

            if (booking.customerLocation) {
                // Parse WKT: "POINT(lng lat)"
                const match = booking.customerLocation.match(/POINT\(([\d.-]+) ([\d.-]+)\)/);
                if (match) {
                    const custLng = parseFloat(match[1]);
                    const custLat = parseFloat(match[2]);

                    // Use raw SQL with PostGIS ST_DistanceSphere for server-side accuracy
                    try {
                        const [result] = await db.execute(sql`
                            SELECT ST_DistanceSphere(
                                ST_MakePoint(${longitude}, ${latitude}),
                                ST_MakePoint(${custLng}, ${custLat})
                            ) as distance_meters
                        `) as any;
                        distanceMeters = parseFloat(result?.distance_meters || '0');
                    } catch (pgErr) {
                        // Fallback to Haversine if PostGIS function not available
                        logger.warn('[GEOFENCE] ST_DistanceSphere failed, using Haversine fallback');
                        const { calculateHaversineDistance } = await import('../lib/geo');
                        distanceMeters = calculateHaversineDistance(latitude, longitude, custLat, custLng);
                    }
                } else {
                    return res.status(400).json({
                        success: false,
                        message: 'Customer location data is invalid',
                    });
                }
            } else {
                // No customer location stored — skip geofence (admin-created bookings)
                logger.warn(`[GEOFENCE] Booking ${bookingId} has no customerLocation — skipping geofence`);
                distanceMeters = 0;
            }

            if (distanceMeters > maxDistance) {
                logger.info(`[GEOFENCE] REJECTED: Booking ${bookingId}, distance=${Math.round(distanceMeters)}m, max=${maxDistance}m`);
                return res.status(403).json({
                    success: false,
                    message: `You are too far from the customer location. Distance: ${Math.round(distanceMeters)}m. Maximum allowed: ${maxDistance}m.`,
                    data: {
                        distanceMeters: Math.round(distanceMeters),
                        maxDistanceMeters: maxDistance,
                    },
                });
            }

            // ── Update booking to REACHED ────────────────────────────
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.REACHED as any,
                    reachedAt: new Date(),
                    reachedLat: latitude,
                    reachedLong: longitude,
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            // Update employee's current location
            await db.update(employees)
                .set({
                    currentLocation: `POINT(${longitude} ${latitude})`,
                    lastLocationUpdate: new Date(),
                })
                .where(eq(employees.id, partnerId));

            logger.info(`[GEOFENCE] APPROVED: Booking ${bookingId} → REACHED (distance=${Math.round(distanceMeters)}m)`);

            // The customer has to open the app to read the OTP out — without a
            // push they have no idea the expert is standing outside.
            void BookingNotifications.expertArrived(bookingId);

            res.json({
                success: true,
                message: 'Arrival confirmed. Please ask the customer for the service OTP to begin.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    distanceMeters: Math.round(distanceMeters),
                    reachedAt: updated.reachedAt,
                    handshakeOtp: undefined, // OTP is shown to customer, NOT to employee
                },
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PATCH /api/v1/bookings/:id/start
     *
     * Employee submits the 6-digit OTP shown on the customer's phone.
     * Gate: OTP must match booking.handshakeOtp.
     *
     * Body: { otp: string }
     * Transition: REACHED → IN_PROGRESS
     */
    app.patch('/api/bookings/:id/start', authenticatePartner, requireVerifiedPartner, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const bookingId = parseInt(req.params.id);
            const { otp } = req.body;
            const partnerId = (req as any).partner?.partnerId;

            if (!otp || typeof otp !== 'string') {
                return res.status(400).json({ success: false, message: 'OTP is required' });
            }

            // ── Fetch booking ────────────────────────────────────────
            const [booking] = await db.select().from(serviceRequests)
                .where(eq(serviceRequests.id, bookingId)).limit(1);

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.providerId !== partnerId) {
                return res.status(403).json({ success: false, message: 'This booking is not assigned to you' });
            }

            // ── State transition validation ──────────────────────────
            const currentState = booking.status as BookingState;
            const targetState = BookingState.IN_PROGRESS;

            if (!validateStateTransition(currentState, targetState)) {
                return res.status(409).json({
                    success: false,
                    message: `Cannot start service. Current status must be 'reached'. Current: '${currentState}'.`,
                });
            }

            // ── OTP verification ─────────────────────────────────────
            if (!booking.handshakeOtp) {
                return res.status(500).json({
                    success: false,
                    message: 'No handshake OTP found for this booking. Contact admin.',
                });
            }

            if (otp.trim() !== booking.handshakeOtp.trim()) {
                // The expected code is deliberately not logged — printing it let
                // anyone with log access start a job without the customer present.
                logger.warn(`[OTP] Invalid handshake OTP attempt for booking ${bookingId}`);
                return res.status(400).json({
                    success: false,
                    message: 'Invalid OTP. Please ask the customer for the correct service code.',
                });
            }

            // ── Update booking to IN_PROGRESS ────────────────────────
            const [updated] = await db.update(serviceRequests)
                .set({
                    status: BookingState.IN_PROGRESS as any,
                    startedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(serviceRequests.id, bookingId))
                .returning();

            if (!updated) {
                return res.status(500).json({ success: false, message: 'Failed to update booking status' });
            }

            logger.info(`[OTP] Verified: Booking ${bookingId} → IN_PROGRESS`);

            void BookingNotifications.serviceStarted(bookingId);

            res.json({
                success: true,
                message: 'OTP verified. Service has started.',
                data: {
                    bookingId: updated.id,
                    status: updated.status,
                    startedAt: updated.startedAt,
                },
            });
        } catch (error: any) {
            logger.error('[START SERVICE ERROR]', { message: error.message, stack: error.stack });
            res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    });
}
