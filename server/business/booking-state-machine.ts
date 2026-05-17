/**
 * PHASE 1: Booking State Machine (Updated per AI_CONTEXT.md §3.B)
 * 
 * 9-state machine: CREATED → ASSIGNED → ACCEPTED → REACHED → IN_PROGRESS → PENDING_PAYMENT → COMPLETED
 * Cancellation ONLY from CREATED state (AI_CONTEXT §3.D).
 * Disputes from IN_PROGRESS, PENDING_PAYMENT, or COMPLETED.
 */

export enum BookingState {
    CREATED = 'created',               // User creates service request, pays ₹99
    ASSIGNED = 'assigned',             // Admin assigns employee
    ACCEPTED = 'accepted',             // Employee accepts, backend generates 6-digit handshakeOtp
    REACHED = 'reached',               // Employee arrived, PostGIS validates < 200m
    IN_PROGRESS = 'in_progress',       // Employee verified handshakeOtp from customer
    PENDING_PAYMENT = 'pending_payment', // Employee submitted bill, waiting on customer to pay
    COMPLETED = 'completed',           // Final Razorpay transaction successful
    CANCELLED = 'cancelled',           // Customer cancelled (only from CREATED)
    DISPUTED = 'disputed',             // Dispute raised (requires admin resolution)
}

/**
 * Allowed state transitions mapping.
 * Each state can only transition to specific next states.
 */
export const ALLOWED_TRANSITIONS: Record<BookingState, BookingState[]> = {
    [BookingState.CREATED]: [BookingState.ASSIGNED, BookingState.CANCELLED],
    [BookingState.ASSIGNED]: [BookingState.ACCEPTED],
    [BookingState.ACCEPTED]: [BookingState.REACHED],
    [BookingState.REACHED]: [BookingState.IN_PROGRESS],
    [BookingState.IN_PROGRESS]: [BookingState.PENDING_PAYMENT, BookingState.DISPUTED],
    [BookingState.PENDING_PAYMENT]: [BookingState.COMPLETED, BookingState.DISPUTED],
    [BookingState.COMPLETED]: [BookingState.DISPUTED],
    [BookingState.CANCELLED]: [],       // Terminal state
    [BookingState.DISPUTED]: [],        // Terminal state (admin resolves externally)
};

/**
 * Validates if a state transition is allowed
 */
export function validateStateTransition(from: BookingState, to: BookingState): boolean {
    const allowedNext = ALLOWED_TRANSITIONS[from];
    return allowedNext.includes(to);
}

/**
 * Checks if a booking can be cancelled in its current state.
 * AI_CONTEXT §3.D: Cancellation ONLY from CREATED state.
 * ASSIGNED and beyond → show WhatsApp Support button instead.
 */
export function canCancelBooking(currentState: BookingState): boolean {
    return currentState === BookingState.CREATED;
}

/**
 * Determines if wallet credit and inventory deduction should be triggered.
 * CRITICAL: This ONLY happens when state transitions to COMPLETED.
 */
export function shouldTriggerWalletCredit(newState: BookingState): boolean {
    return newState === BookingState.COMPLETED;
}

/**
 * PHASE 1: Geofence Requirement Check
 * PostGIS ST_DistanceSphere validation required for ACCEPTED → REACHED.
 * Employee must be within 200m of customer location.
 */
export function requiresGeofenceValidation(from: BookingState, to: BookingState): boolean {
    return from === BookingState.ACCEPTED && to === BookingState.REACHED;
}

/**
 * OTP Requirement Check
 * UPDATED: OTP required for REACHED → IN_PROGRESS (was ACCEPTED → IN_PROGRESS)
 * Employee verifies the 6-digit handshakeOtp shown to the customer.
 */
export function requiresOtpValidation(from: BookingState, to: BookingState): boolean {
    return from === BookingState.REACHED && to === BookingState.IN_PROGRESS;
}

/**
 * Payment Verification Requirement
 * UPDATED: Required for PENDING_PAYMENT → COMPLETED (was IN_PROGRESS → COMPLETED)
 * Final payment must be verified via Razorpay webhook.
 */
export function requiresPaymentVerification(from: BookingState, to: BookingState): boolean {
    return from === BookingState.PENDING_PAYMENT && to === BookingState.COMPLETED;
}

/**
 * Bill Submission Requirement
 * NEW: Employee must submit spare_parts_cost + service_labor_cost
 * for IN_PROGRESS → PENDING_PAYMENT transition.
 */
export function requiresBillSubmission(from: BookingState, to: BookingState): boolean {
    return from === BookingState.IN_PROGRESS && to === BookingState.PENDING_PAYMENT;
}

/**
 * Get human-readable state description
 */
export function getStateDescription(state: BookingState): string {
    const descriptions: Record<BookingState, string> = {
        [BookingState.CREATED]: 'Service request created, booking fee paid',
        [BookingState.ASSIGNED]: 'Employee assigned to service',
        [BookingState.ACCEPTED]: 'Employee accepted the service',
        [BookingState.REACHED]: 'Employee has arrived at location',
        [BookingState.IN_PROGRESS]: 'Service work in progress',
        [BookingState.PENDING_PAYMENT]: 'Awaiting final payment from customer',
        [BookingState.COMPLETED]: 'Service completed successfully',
        [BookingState.CANCELLED]: 'Service cancelled, booking fee refunded',
        [BookingState.DISPUTED]: 'Service under dispute — admin review required',
    };
    return descriptions[state];
}
