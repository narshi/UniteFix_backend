/**
 * Booking Notifications — every push the service lifecycle owes a user.
 *
 * WHY THIS FILE EXISTS
 * Booking state changes happen in a dozen places (admin assignment, geofence
 * arrival, bill submission, Razorpay webhooks, admin overrides). Putting the
 * copy and the recipient resolution here keeps the wording consistent and makes
 * it obvious, in one screen, which transitions notify whom.
 *
 * CONTRACT
 * - Every method is fire-and-forget: it resolves recipients and hands off to
 *   NotificationService.notify(), which swallows its own errors. A push must
 *   never fail a payment, a state transition, or a wallet credit.
 * - `data.serviceId` is the numeric service_requests.id — the mobile app uses it
 *   to deep-link into RequestDetail (customer) or AssignmentDetail (expert).
 *
 * COVERAGE MAP  (state → who gets told)
 *   created           → customer (booking confirmed)         [+ admins: new job in queue]
 *   assigned          → customer (expert on the way) + EXPERT (new assignment)
 *   accepted          → customer (expert accepted)
 *   denied            → customer (finding another expert)    [+ admins: back in queue]
 *   reached           → customer (expert has arrived, share OTP)
 *   in_progress       → customer (work started)
 *   pending_payment   → customer (bill ready, pay now)
 *   completed         → customer (done + invoice) + expert (earnings on hold)
 *   cancelled         → expert (if one was assigned)
 *   disputed          → customer + expert
 * Money & account events live here too: wallet release, withdrawal decisions,
 * KYC verification results.
 */

import { db } from "../db";
import { eq } from "drizzle-orm";
import { employees, serviceRequests, users } from "@shared/schema";
import { NotificationService } from "./notification.service";
import logger from "../lib/logger";

/** Rupee formatting used in every money-bearing notification body. */
function inr(amount: number | string | null | undefined): string {
    const value = Number(amount ?? 0);
    return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

interface BookingParties {
    serviceRequestId: number;
    /** Human-facing booking reference, e.g. "SRV-00123". */
    serviceRef: string;
    serviceType: string | null;
    /** users.id of the customer. */
    customerUserId: number | null;
    customerName: string | null;
    /** users.id of the assigned service expert (null when unassigned). */
    expertUserId: number | null;
    expertName: string | null;
}

/**
 * Resolve both sides of a booking in one query.
 *
 * Note the two-hop join on the expert side: service_requests.provider_id points
 * at employees.id, but device tokens are keyed by users.id.
 */
async function getParties(serviceRequestId: number): Promise<BookingParties | null> {
    const [row] = await db
        .select({
            id: serviceRequests.id,
            serviceRef: serviceRequests.serviceId,
            serviceType: serviceRequests.serviceType,
            customerUserId: serviceRequests.userId,
            customerName: users.username,
            expertUserId: employees.userId,
            expertName: employees.fullName,
        })
        .from(serviceRequests)
        .leftJoin(users, eq(users.id, serviceRequests.userId))
        .leftJoin(employees, eq(employees.id, serviceRequests.providerId))
        .where(eq(serviceRequests.id, serviceRequestId));

    if (!row) {
        logger.warn("[BOOKING_NOTIFY] Service request not found", { serviceRequestId });
        return null;
    }

    return {
        serviceRequestId: row.id,
        serviceRef: row.serviceRef,
        serviceType: row.serviceType,
        customerUserId: row.customerUserId ?? null,
        customerName: row.customerName ?? null,
        expertUserId: row.expertUserId ?? null,
        expertName: row.expertName ?? null,
    };
}

/** users.id for an employees.id — needed when the booking row isn't loaded. */
async function getExpertUserId(employeeId: number): Promise<number | null> {
    const [row] = await db
        .select({ userId: employees.userId })
        .from(employees)
        .where(eq(employees.id, employeeId));
    return row?.userId ?? null;
}

/** What the customer calls the job, e.g. "AC Repair" → falls back to "service". */
function jobLabel(parties: BookingParties): string {
    return parties.serviceType || "service";
}

export class BookingNotifications {
    // ==================== CUSTOMER: BOOKING LIFECYCLE ====================

    /** created — booking fee paid, request is in the assignment queue. */
    static async bookingCreated(serviceRequestId: number) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Booking confirmed",
            `Your ${jobLabel(p)} request ${p.serviceRef} is confirmed. We're assigning a service expert now.`,
            "service_created",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );

        void NotificationService.sendToAdmins(
            "New booking in queue",
            `${p.serviceRef} (${jobLabel(p)}) is awaiting expert assignment.`,
            { serviceId: p.serviceRequestId }
        );
    }

    /**
     * assigned — the single most important notification in the product.
     * The expert must know they have a job; the customer must know who is coming.
     */
    static async expertAssigned(serviceRequestId: number, isReassignment = false) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        const expertName = p.expertName || "A service expert";

        // → Service expert: you have a new job.
        NotificationService.notify(
            p.expertUserId,
            isReassignment ? "Job reassigned to you" : "New job assigned",
            `${jobLabel(p)} — ${p.serviceRef}. Open the app to accept and view the address.`,
            isReassignment ? "assignment_reassigned" : "assignment_new",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef, role: "expert" }
        );

        // → Customer: an expert is on it.
        NotificationService.notify(
            p.customerUserId,
            "Service expert assigned",
            `${expertName} has been assigned to your ${jobLabel(p)} request ${p.serviceRef}.`,
            "service_assigned",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef, expertName }
        );
    }

    /** Previous expert loses the job on reassignment. */
    static async assignmentRevoked(previousEmployeeId: number, serviceRequestId: number, reason?: string) {
        const expertUserId = await getExpertUserId(previousEmployeeId);
        if (!expertUserId) return;

        const [row] = await db
            .select({ serviceRef: serviceRequests.serviceId })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceRequestId));

        NotificationService.notify(
            expertUserId,
            "Job reassigned",
            `Job ${row?.serviceRef ?? serviceRequestId} has been reassigned${reason ? `: ${reason}` : "."}`,
            "assignment_cancelled",
            { serviceId: serviceRequestId }
        );
    }

    /** accepted — expert confirmed. Customer can now expect an arrival. */
    static async expertAccepted(serviceRequestId: number) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Expert accepted your booking",
            `${p.expertName || "Your service expert"} accepted ${p.serviceRef} and will be on the way shortly.`,
            "service_accepted",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );
    }

    /** denied — job goes back to the pool; customer should not be left guessing. */
    static async expertDenied(serviceRequestId: number, previousEmployeeId: number, reason?: string) {
        const [row] = await db
            .select({
                serviceRef: serviceRequests.serviceId,
                customerUserId: serviceRequests.userId,
                serviceType: serviceRequests.serviceType,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, serviceRequestId));
        if (!row) return;

        NotificationService.notify(
            row.customerUserId,
            "Assigning a new expert",
            `We're matching your ${row.serviceType || "service"} request ${row.serviceRef} with another expert. No action needed.`,
            "service_assigned",
            { serviceId: serviceRequestId, serviceRef: row.serviceRef }
        );

        void NotificationService.sendToAdmins(
            "Job returned to queue",
            `${row.serviceRef} was declined by employee ${previousEmployeeId}${reason ? ` (${reason})` : ""}.`,
            { serviceId: serviceRequestId, employeeId: previousEmployeeId, reason }
        );
    }

    /** reached — expert is at the door. Customer needs to open the OTP screen. */
    static async expertArrived(serviceRequestId: number) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Your expert has arrived",
            `${p.expertName || "Your service expert"} has reached your location. Share the 6-digit OTP from the app to start the work.`,
            "service_reached",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );
    }

    /** in_progress — OTP verified, work has begun. */
    static async serviceStarted(serviceRequestId: number) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Service started",
            `Work on ${p.serviceRef} has started. You'll get the bill here once it's done.`,
            "service_started",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );
    }

    /** pending_payment — the money moment. Customer must act. */
    static async billSubmitted(serviceRequestId: number, totalAmount: number | string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Your bill is ready",
            `${inr(totalAmount)} is due for ${p.serviceRef}. Tap to review the bill and pay.`,
            "service_bill_ready",
            {
                serviceId: p.serviceRequestId,
                serviceRef: p.serviceRef,
                amount: String(totalAmount),
            }
        );
    }

    /** completed — payment cleared. Both sides get closure. */
    static async serviceCompleted(serviceRequestId: number, partnerEarning?: number | string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Service completed",
            `${p.serviceRef} is complete. Your invoice is available in the app — and we'd love your rating.`,
            "service_completed",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );

        NotificationService.notify(
            p.expertUserId,
            "Job completed",
            partnerEarning !== undefined
                ? `${p.serviceRef} is closed. ${inr(partnerEarning)} has been added to your wallet (on hold).`
                : `${p.serviceRef} is closed. Your earnings have been added to your wallet.`,
            "wallet_credited",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef, role: "expert" }
        );
    }

    /** cancelled — only the assigned expert needs telling; the customer did it. */
    static async bookingCancelled(serviceRequestId: number, reason?: string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.expertUserId,
            "Job cancelled",
            `${p.serviceRef} was cancelled by the customer${reason ? `: ${reason}` : "."}`,
            "assignment_cancelled",
            { serviceId: p.serviceRequestId, serviceRef: p.serviceRef }
        );
    }

    /** disputed — both parties, because an admin is about to contact them. */
    static async disputeRaised(serviceRequestId: number, reason?: string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        const body = `${p.serviceRef} is under review${reason ? `: ${reason}` : "."} Our team will contact you shortly.`;

        NotificationService.notify(p.customerUserId, "Booking under review", body, "service_disputed", {
            serviceId: p.serviceRequestId,
        });
        NotificationService.notify(p.expertUserId, "Booking under review", body, "service_disputed", {
            serviceId: p.serviceRequestId,
        });
    }

    /** Admin resolved a dispute — tell both sides the outcome. */
    static async disputeResolved(serviceRequestId: number, resolution: string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        const body = `${p.serviceRef}: ${resolution}`;
        NotificationService.notify(p.customerUserId, "Dispute resolved", body, "service_disputed", {
            serviceId: p.serviceRequestId,
        });
        NotificationService.notify(p.expertUserId, "Dispute resolved", body, "service_disputed", {
            serviceId: p.serviceRequestId,
        });
    }

    // ==================== MONEY ====================

    /** Final payment captured (Razorpay online or cash marked collected). */
    static async paymentReceived(serviceRequestId: number, amount: number | string, method: string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Payment received",
            `We've received ${inr(amount)} for ${p.serviceRef}. Thank you!`,
            "payment_received",
            { serviceId: p.serviceRequestId, amount: String(amount), method }
        );

        NotificationService.notify(
            p.expertUserId,
            "Customer paid",
            `${inr(amount)} received for ${p.serviceRef} via ${method}.`,
            "payment_received",
            { serviceId: p.serviceRequestId, amount: String(amount), method, role: "expert" }
        );
    }

    static async paymentFailed(serviceRequestId: number, reason?: string) {
        const p = await getParties(serviceRequestId);
        if (!p) return;

        NotificationService.notify(
            p.customerUserId,
            "Payment failed",
            `Your payment for ${p.serviceRef} did not go through${reason ? `: ${reason}` : "."} Please try again.`,
            "payment_failed",
            { serviceId: p.serviceRequestId }
        );
    }

    /** Hold period elapsed — money is now withdrawable. */
    static async walletReleased(employeeId: number, amount: number | string) {
        const expertUserId = await getExpertUserId(employeeId);
        NotificationService.notify(
            expertUserId,
            "Earnings available",
            `${inr(amount)} has moved from hold to your available balance. You can withdraw it now.`,
            "wallet_released",
            { role: "expert" }
        );
    }

    static async withdrawalApproved(employeeId: number, amount: number | string, reference?: string) {
        const expertUserId = await getExpertUserId(employeeId);
        NotificationService.notify(
            expertUserId,
            "Withdrawal approved",
            `${inr(amount)} is on its way to your bank account${reference ? ` (ref ${reference})` : ""}.`,
            "withdrawal_approved",
            { role: "expert", amount: String(amount) }
        );
    }

    static async withdrawalRejected(employeeId: number, amount: number | string, reason?: string) {
        const expertUserId = await getExpertUserId(employeeId);
        NotificationService.notify(
            expertUserId,
            "Withdrawal rejected",
            `Your ${inr(amount)} withdrawal was not processed${reason ? `: ${reason}` : "."} The amount is back in your available balance.`,
            "withdrawal_rejected",
            { role: "expert", amount: String(amount) }
        );
    }

    // ==================== ACCOUNT ====================

    /** KYC decision — gates the expert out of, or into, the whole app. */
    static async verificationDecision(
        employeeId: number,
        status: "verified" | "rejected" | "suspended",
        remarks?: string
    ) {
        const expertUserId = await getExpertUserId(employeeId);
        if (!expertUserId) return;

        if (status === "verified") {
            NotificationService.notify(
                expertUserId,
                "You're verified",
                "Your documents have been approved. You can now receive job assignments.",
                "verification_approved",
                { role: "expert" }
            );
            return;
        }

        NotificationService.notify(
            expertUserId,
            status === "rejected" ? "Verification rejected" : "Account suspended",
            remarks || "Please contact UniteFix support for details.",
            status === "rejected" ? "verification_rejected" : "account_suspended",
            { role: "expert" }
        );
    }

    // ==================== GENERIC DISPATCH ====================

    /**
     * Route a state change to the right notification. Used by admin overrides,
     * where the destination state is data rather than a known code path.
     * Money-specific states (completed) intentionally omit the earnings figure —
     * an override does not carry one.
     */
    static async forState(serviceRequestId: number, newState: string, reason?: string) {
        switch (newState) {
            case "assigned":
                return this.expertAssigned(serviceRequestId, false);
            case "accepted":
                return this.expertAccepted(serviceRequestId);
            case "reached":
                return this.expertArrived(serviceRequestId);
            case "in_progress":
                return this.serviceStarted(serviceRequestId);
            case "completed":
                return this.serviceCompleted(serviceRequestId);
            case "cancelled":
                return this.bookingCancelled(serviceRequestId, reason);
            case "disputed":
                return this.disputeRaised(serviceRequestId, reason);
            default:
                logger.debug("[BOOKING_NOTIFY] No notification defined for state", {
                    serviceRequestId,
                    newState,
                });
        }
    }

    /** Admin flipped a user's active flag. */
    static async accountStatusChanged(userId: number, isActive: boolean, reason?: string) {
        NotificationService.notify(
            userId,
            isActive ? "Account reactivated" : "Account suspended",
            isActive
                ? "Your UniteFix account is active again."
                : reason || "Your account has been suspended. Contact support for details.",
            isActive ? "system" : "account_suspended",
            {}
        );
    }
}
