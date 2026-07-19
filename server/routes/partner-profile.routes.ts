import { Router } from "express";
import { db } from "../db";
import { employees, users } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { authenticatePartner as requireAuth } from "../middleware/auth.middleware";
import { RazorpayXService } from "../services/razorpayx.service";
import logger from "../lib/logger";

import { Express } from "express";

/**
 * Helper: get or auto-create employee record for a given userId.
 * Covers the edge case where a partner's JWT is valid but the employees row is missing
 * (e.g., legacy accounts, DB migrations, or race conditions during signup).
 */
async function getOrCreateEmployee(userId: number) {
  // Try finding by userId first
  const [existing] = await db.select().from(employees).where(eq(employees.userId, userId)).limit(1);
  if (existing) return existing;

  // Auto-create a minimal employee record
  logger.warn(`[PARTNER_PROFILE] No employee record for userId=${userId}. Auto-creating.`);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const fullName = user?.username || 'Partner';

  const [newEmployee] = await db.insert(employees).values({
    userId,
    fullName,
    partnerType: 'Individual',
    services: [],
    isActive: true,   // They passed authenticatePartner, so they're valid
    isOnline: false,
  }).returning();

  return newEmployee;
}

export function registerPartnerProfileRoutes(app: Express) {
  const partnerProfileRouter = Router();

  // GET /api/partner/profile - Get partner profile
  partnerProfileRouter.get("/", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.userId || (req as any).partner?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      logger.info(`[PARTNER_PROFILE] GET profile for userId=${userId}`);

      const employee = await getOrCreateEmployee(userId);

      res.json({ success: true, data: employee });
    } catch (error: any) {
      logger.error("Error fetching partner profile", { error: error.message });
      res.status(500).json({ success: false, message: "Failed to fetch profile" });
    }
  });

  // PUT /api/partner/profile/upi - Update UPI ID
  partnerProfileRouter.put("/upi", requireAuth, async (req, res) => {
    try {
      const { upiId } = req.body;
      const userId = (req as any).user?.userId || (req as any).partner?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      if (!upiId || typeof upiId !== 'string' || !upiId.includes('@')) {
        return res.status(400).json({ success: false, message: "Valid UPI ID is required (e.g. name@bank)" });
      }

      logger.info(`[PARTNER_PROFILE] PUT UPI for userId=${userId}, upiId=${upiId}`);

      // 1. Find or create employee
      const employee = await getOrCreateEmployee(userId);

      // 2. Update DB
      const [updatedEmployee] = await db.update(employees)
        .set({ upiId, updatedAt: new Date() })
        .where(eq(employees.id, employee.id))
        .returning();

      // 3. Sync with RazorpayX (creates Contact & VPA Fund Account)
      try {
        await RazorpayXService.syncEmployeeForPayouts(updatedEmployee);
      } catch (rzpError: any) {
        logger.error("RazorpayX sync failed during UPI update", { error: rzpError.message || rzpError });
        // Non-fatal: UPI is saved in DB, Razorpay sync can be retried later
      }

      res.json({ success: true, message: "UPI ID updated successfully", data: updatedEmployee });
    } catch (error: any) {
      logger.error("Error updating UPI ID", { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, message: "Failed to update UPI ID" });
    }
  });

  // PATCH /api/partner/profile/expertise - Update employee expertise/services
  partnerProfileRouter.patch("/expertise", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.userId || (req as any).partner?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      const { services } = req.body;

      if (!Array.isArray(services) || services.length === 0) {
        return res.status(400).json({ success: false, message: "At least one expertise is required" });
      }

      // Validate all entries are non-empty strings
      const cleanedServices = services
        .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s: string) => s.length > 0);

      if (cleanedServices.length === 0) {
        return res.status(400).json({ success: false, message: "At least one valid expertise is required" });
      }

      logger.info(`[PARTNER_PROFILE] PATCH expertise for userId=${userId}, services=[${cleanedServices.join(', ')}]`);

      const employee = await getOrCreateEmployee(userId);

      const [updated] = await db.update(employees)
        .set({ services: cleanedServices, updatedAt: new Date() })
        .where(eq(employees.id, employee.id))
        .returning();

      res.json({ success: true, message: "Expertise updated successfully", data: updated });
    } catch (error: any) {
      logger.error("Error updating expertise", { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, message: "Failed to update expertise" });
    }
  });

  app.use("/api/partner/profile", partnerProfileRouter);
}
