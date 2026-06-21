import { Router } from "express";
import { db } from "../db";
import { employees } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { authenticatePartner as requireAuth } from "../middleware/auth.middleware";
import { RazorpayXService } from "../services/razorpayx.service";
import logger from "../lib/logger";

import { Express } from "express";

export function registerPartnerProfileRoutes(app: Express) {
  const partnerProfileRouter = Router();

  // GET /api/partner/profile - Get partner profile
  partnerProfileRouter.get("/", requireAuth, async (req, res) => {
  try {
    const employee = await db.query.employees.findFirst({
      where: eq(employees.userId, req.user!.id),
    });

    if (!employee) {
      return res.status(404).json({ message: "Partner profile not found" });
    }

    res.json(employee);
  } catch (error: any) {
    logger.error("Error fetching partner profile", { error: error.message });
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// PUT /api/partner/profile/upi - Update UPI ID
partnerProfileRouter.put("/upi", requireAuth, async (req, res) => {
  try {
    const { upiId } = req.body;

    if (!upiId || typeof upiId !== 'string' || !upiId.includes('@')) {
      return res.status(400).json({ message: "Valid UPI ID is required (e.g. name@bank)" });
    }

    // 1. Find employee
    const employee = await db.query.employees.findFirst({
      where: eq(employees.userId, req.user!.id),
    });

    if (!employee) {
      return res.status(404).json({ message: "Partner profile not found" });
    }

    // 2. Update DB
    const [updatedEmployee] = await db.update(employees)
      .set({ upiId, updatedAt: new Date() })
      .where(eq(employees.id, employee.id))
      .returning();

    // 3. Sync with RazorpayX (creates Contact & VPA Fund Account)
    try {
      await RazorpayXService.syncEmployeeForPayouts(updatedEmployee);
    } catch (rzpError: any) {
      logger.error("RazorpayX sync failed during UPI update", { error: rzpError.message });
      // We don't fail the request here, but we could if strict validation is desired.
      // For MVP, we let it save. If VPA is invalid, it will fail during payout.
    }

    res.json({ message: "UPI ID updated successfully", upiId: updatedEmployee.upiId });
  } catch (error: any) {
    logger.error("Error updating UPI ID", { error: error.message });
    res.status(500).json({ message: "Failed to update UPI ID" });
  }
});

  app.use("/api/partner/profile", partnerProfileRouter);
}
