/**
 * PHASE 4: OTP Service
 * Handles OTP generation and validation for service verification
 * Guards state transition: ACCEPTED → IN_PROGRESS only
 * 
 * LOCKED REQUIREMENTS:
 * - 4-digit random OTP
 * - 10-minute expiry
 * - Customer generates after ACCEPTED
 * - Technician validates before IN_PROGRESS
 * - NO financial or inventory side effects
 * - Unlimited retries
 */

import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { serviceRequests, serviceOtps } from "@shared/schema";
import crypto from "crypto";

export class OtpService {
    /**
     * Generate 4-digit OTP for service verification
     * Can only be called when service status = ACCEPTED
     */
    static async generateOtp(
        serviceRequestId: number,
        customerId: number
    ): Promise<{ otp: string; expiresAt: Date }> {
        // 1. Validate service is in ACCEPTED state
        const [service] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceRequestId))
            .limit(1);

        if (!service) {
            throw new Error("Service request not found");
        }

        if (service.status !== "accepted") {
            throw new Error(
                `OTP can only be generated when service is ACCEPTED. Current status: ${service.status}`
            );
        }

        if (service.userId !== customerId) {
            throw new Error("Only the customer can generate OTP for their service");
        }

        // 2. Invalidate any previous active OTPs for this service
        await db
            .update(serviceOtps)
            .set({ isVerified: true })
            .where(
                and(
                    eq(serviceOtps.serviceRequestId, serviceRequestId),
                    eq(serviceOtps.isVerified, false)
                )
            );

        // 3. Generate 4-digit OTP
        const otp = crypto.randomInt(1000, 9999).toString();

        // 4. Calculate expiry (10 minutes from now)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // 5. Insert OTP using Drizzle
        await db.insert(serviceOtps).values({
            serviceRequestId,
            otp,
            generatedBy: customerId,
            expiresAt,
        });

        return { otp, expiresAt };
    }

    /**
     * Validate OTP before allowing IN_PROGRESS transition
     * Called by technician at service location
     */
    static async validateOtp(
        serviceRequestId: number,
        otpCode: string,
        technicianId: number
    ): Promise<{ valid: boolean; message: string }> {
        // 1. Get the latest active OTP
        const [otpRecord] = await db
            .select()
            .from(serviceOtps)
            .where(
                and(
                    eq(serviceOtps.serviceRequestId, serviceRequestId),
                    eq(serviceOtps.isVerified, false)
                )
            )
            .orderBy(desc(serviceOtps.createdAt))
            .limit(1);

        if (!otpRecord) {
            return {
                valid: false,
                message: "No active OTP found. Please ask customer to generate OTP.",
            };
        }

        // 2. Check expiry
        if (new Date() > new Date(otpRecord.expiresAt)) {
            return {
                valid: false,
                message: "OTP has expired. Please ask customer to generate a new OTP.",
            };
        }

        // 3. Validate OTP code
        if (otpRecord.otp !== otpCode) {
            return {
                valid: false,
                message: "Invalid OTP. Please try again.",
            };
        }

        // 4. Mark OTP as verified
        await db
            .update(serviceOtps)
            .set({
                isVerified: true,
                verifiedBy: technicianId,
                verifiedAt: new Date(),
            })
            .where(eq(serviceOtps.id, otpRecord.id));

        return {
            valid: true,
            message: "OTP verified successfully. You can start the service.",
        };
    }

    /**
     * Check if service has valid OTP for IN_PROGRESS transition
     * Called by transitionBookingState before allowing ACCEPTED → IN_PROGRESS
     */
    static async hasValidOtp(serviceRequestId: number): Promise<boolean> {
        const [otpRecord] = await db
            .select({ id: serviceOtps.id })
            .from(serviceOtps)
            .where(
                and(
                    eq(serviceOtps.serviceRequestId, serviceRequestId),
                    eq(serviceOtps.isVerified, true)
                )
            )
            .limit(1);

        return !!otpRecord;
    }
}
