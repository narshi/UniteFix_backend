import { Router } from "express";
import { db } from "../db";
import { employees, users } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { authenticatePartner as requireAuth } from "../middleware/auth.middleware";
import { RazorpayXService } from "../services/razorpayx.service";
import { UpiValidationService } from "../services/upi-validation.service";
import { checkUpiFormat } from "../../shared/upi";
import logger from "../lib/logger";
import { syncEmployeeTechnicianTypes } from "../lib/expertise-matching";

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
      const { upiId, confirmedName } = req.body;
      const userId = (req as any).user?.userId || (req as any).partner?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      // Format first — free, instant, and it names the actual problem. The old
      // check was `upiId.includes('@')`, which let an email address through.
      const format = checkUpiFormat(upiId);
      if (!format.ok) {
        return res.status(400).json({
          success: false,
          code: format.code,
          message: format.message,
        });
      }
      const vpa = format.normalised!;

      logger.info(`[PARTNER_PROFILE] PUT UPI for userId=${userId}, upiId=${vpa}`);

      // Then ask the PSP whether it exists. Returns 'unverified' rather than
      // throwing when Razorpay is unreachable or the endpoint isn't enabled, so
      // an outage cannot lock a partner out of getting paid.
      //
      // `confirmedName` is the app telling us the partner looked at the
      // registered name and said "yes, that's me". Without it we refuse a VALID
      // id, because a valid id belonging to a stranger is the case that loses
      // money and the name is the only thing that catches it.
      const verification = await UpiValidationService.verify(vpa);

      if (verification.status === 'invalid') {
        return res.status(400).json({
          success: false,
          code: 'UPI_NOT_FOUND',
          message: "We couldn't find that UPI ID. Open your payment app, copy it exactly, and try again.",
        });
      }

      if (verification.status === 'valid'
        && verification.customerName
        && confirmedName !== verification.customerName) {
        return res.status(409).json({
          success: false,
          code: 'CONFIRM_NAME',
          message: `This UPI ID belongs to ${verification.customerName}.`,
          data: { customerName: verification.customerName, upiId: vpa },
        });
      }

      // 1. Find or create employee
      const employee = await getOrCreateEmployee(userId);

      // 2. Update DB
      const [updatedEmployee] = await db.update(employees)
        .set({
          upiId: vpa,
          // Null when we could not check. It must stay null rather than being
          // stamped with a date, or "verified" and "nobody looked" become
          // indistinguishable to whoever approves the payout.
          upiVerifiedAt: verification.status === 'valid' ? new Date() : null,
          upiVerifiedName: verification.status === 'valid' ? (verification.customerName ?? null) : null,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employee.id))
        .returning();

      // 3. Sync with RazorpayX (creates Contact & VPA Fund Account)
      //
      // Still non-fatal — the UPI id is saved either way, and an automated payout
      // is not the only way this partner gets paid; admins settle by hand through
      // /approve-manual against a proof screenshot.
      //
      // But it is no longer SILENT. Reporting plain success here is what made a
      // partner believe their payout details were complete when the fund account
      // had never been created, and left nobody able to tell why withdrawals
      // failed afterwards.
      let payoutReady = true;
      let payoutWarning: string | null = null;

      try {
        await RazorpayXService.syncEmployeeForPayouts(updatedEmployee);
      } catch (rzpError: any) {
        payoutReady = false;
        payoutWarning =
          "Your UPI ID is saved. Automatic payouts aren't set up yet, so UniteFix will "
          + "transfer your money manually — you can still request a payout as normal.";

        // Loud, and identifiable: this is the single point where automated payout
        // setup breaks, and it breaks for every partner at once when RazorpayX is
        // unconfigured or not activated on the account.
        logger.error("[PAYOUT_SETUP] RazorpayX sync failed — partner has no fund account", {
          employeeId: updatedEmployee.id,
          userId,
          upiId,
          hasContact: !!updatedEmployee.razorpayContactId,
          error: rzpError?.message || String(rzpError),
        });
      }

      res.json({
        success: true,
        message: payoutReady ? "UPI ID updated successfully" : "UPI ID saved",
        // The app shows this instead of implying everything is configured.
        payoutReady,
        payoutWarning,
        // Whether the id was actually checked, and against whose name. Null
        // verification is honest: it means nobody confirmed this exists.
        upiVerified: verification.status === 'valid',
        upiVerifiedName: verification.customerName ?? null,
        upiUnverifiedReason: verification.status === 'unverified' ? verification.reason : null,
        data: updatedEmployee,
      });
    } catch (error: any) {
      logger.error("Error updating UPI ID", { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, message: "Failed to update UPI ID" });
    }
  });

  /**
   * POST /api/partner/profile/upi/validate
   *
   * Check a UPI ID without saving it, so the app can show the registered name
   * and ask "is this you?" BEFORE anything is written.
   *
   * Separate from PUT /upi because the confirmation is a two-step conversation:
   * a partner has to see the name before they can confirm it, and making them
   * save first would mean storing an id they are about to reject.
   */
  partnerProfileRouter.post("/upi/validate", requireAuth, async (req, res) => {
    try {
      const { upiId } = req.body;

      const format = checkUpiFormat(upiId);
      if (!format.ok) {
        return res.json({
          success: true,
          data: { status: 'invalid', code: format.code, message: format.message },
        });
      }

      const verification = await UpiValidationService.verify(format.normalised!);

      res.json({
        success: true,
        data: {
          status: verification.status,
          upiId: format.normalised,
          customerName: verification.customerName ?? null,
          reason: verification.reason ?? null,
          // A recognised-format id on an unfamiliar handle still passes, but the
          // app repeats the warning so the partner looks twice.
          warning: format.severity === 'warning' ? format.message : null,
          message:
            verification.status === 'valid'
              ? (verification.customerName
                ? `This UPI ID belongs to ${verification.customerName}.`
                : 'This UPI ID is valid.')
              : verification.status === 'invalid'
                ? "We couldn't find that UPI ID. Open your payment app, copy it exactly, and try again."
                : "We couldn't check this UPI ID right now. Make sure it's exactly right before saving.",
        },
      });
    } catch (error: any) {
      logger.error("Error validating UPI ID", { error: error.message });
      res.status(500).json({ success: false, message: "Failed to validate UPI ID" });
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

      // Mirror the names into employee_technician_types. That id table is what
      // assignment matching joins on; employees.services stays the display copy.
      // Not fatal if it fails — the expert has still saved their trades, and the
      // migration backfill can repair the link.
      try {
        await syncEmployeeTechnicianTypes(employee.id, cleanedServices);
      } catch (syncError: any) {
        logger.warn("[PARTNER_PROFILE] Could not sync technician type ids", {
          employeeId: employee.id, error: syncError.message,
        });
      }

      res.json({ success: true, message: "Expertise updated successfully", data: updated });
    } catch (error: any) {
      logger.error("Error updating expertise", { error: error.message, stack: error.stack });
      res.status(500).json({ success: false, message: "Failed to update expertise" });
    }
  });

  app.use("/api/partner/profile", partnerProfileRouter);
}
