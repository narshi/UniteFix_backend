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
 * - Unlimit

ed retries
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

interface ServiceOtp {
    id: number;
    serviceRequestId: number;
    otp: string;
    generatedBy: number;
    isVerified: boolean;
    verifiedBy: number | null;
    verifiedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
}

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
        const [service] = await db.execute(sql`
      SELECT id, status, user_id 
      FROM service_requests 
      WHERE id = ${serviceRequestId}
    `);

        if (!service) {
            throw new Error("Service request not found");
        }

        if (service.status !== "accepted") {
            throw new Error(
                `OTP can only be generated when service is ACCEPTED. Current status: ${service.status}`
            );
        }

        if (service.user_id !== customerId) {
            throw new Error("Only the customer can generate OTP for their service");
        }

        // 2. Invalidate any previous active OTPs for this service
        await db.execute(sql`
      UPDATE service_otps 
      SET is_verified = true 
      WHERE service_request_id = ${serviceRequestId} 
        AND is_verified = false
    `);

        // 3. Generate 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        // 4. Calculate expiry (10 minutes from now)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // 5. Insert OTP
        await db.execute(sql`
      INSERT INTO service_otps (
        service_request_id,
        otp,
        generated_by,
        expires_at
      ) VALUES (
        ${serviceRequestId},
        ${otp},
        ${customerId},
        ${expiresAt}
      )
    `);

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
        const [otpRecord] = await db.execute<ServiceOtp>(sql`
      SELECT * FROM service_otps 
      WHERE service_request_id = ${serviceRequestId}
        AND is_verified = false
      ORDER BY created_at DESC
      LIMIT 1
    `);

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
        await db.execute(sql`
      UPDATE service_otps 
      SET is_verified = true,
          verified_by = ${technicianId},
          verified_at = NOW()
      WHERE id = ${otpRecord.id}
    `);

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
        const [otpRecord] = await db.execute(sql`
      SELECT id FROM service_otps 
      WHERE service_request_id = ${serviceRequestId}
        AND is_verified = true
      LIMIT 1
    `);

        return !!otpRecord;
    }
}
