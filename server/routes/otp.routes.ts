/**
 * PHASE 4: OTP API Routes
 * Customer: Generate OTP
 * Technician: Validate OTP
 */

import type { Express, Request, Response } from "express";
import { OtpService } from "../services/otp.service";

export function registerOtpRoutes(app: Express) {
    /**
     * POST /api/customer/services/:id/generate-otp
     * Customer generates OTP after technician accepts
     * Auth: Customer only
     */
    app.post("/api/customer/services/:id/generate-otp", async (req: Request, res: Response) => {
        try {
            const service Id = parseInt(req.params.id);
            const customerId = (req as any).user?.id; // Assumes auth middleware sets req.user

            if (!customerId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            const result = await OtpService.generateOtp(serviceId, customerId);

            res.json({
                message: "OTP generated successfully",
                otp: result.otp,
                expiresAt: result.expiresAt,
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });

    /**
     * POST /api/technician/services/:id/validate-otp
     * Technician validates OTP before starting service
     * Auth: Technician only
     */
    app.post("/api/technician/services/:id/validate-otp", async (req: Request, res: Response) => {
        try {
            const serviceId = parseInt(req.params.id);
            const { otp } = req.body;
            const technicianId = (req as any).user?.serviceProviderId; // Assumes auth middleware

            if (!technicianId) {
                return res.status(401).json({ error: "Unauthorized - Technician only" });
            }

            if (!otp) {
                return res.status(400).json({ error: "OTP is required" });
            }

            const result = await OtpService.validateOtp(serviceId, otp, technicianId);

            if (result.valid) {
                res.json({
                    success: true,
                    message: result.message,
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.message,
                });
            }
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    });
}
