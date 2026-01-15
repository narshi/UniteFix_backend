/**
 * PHASE 2: Booking State Machine
 * 
 * Defines the normalized booking states and valid transitions.
 * Wallet credit & inventory deduction triggers ONLY on COMPLETED state.
 */

export enum BookingState {
    CREATED = 'created',           // User creates service request
    ASSIGNED = 'assigned',         // Admin assigns partner
    ACCEPTED = 'accepted',         // Partner accepts the job
    IN_PROGRESS = 'in_progress',   // Service work started
    COMPLETED = 'completed',       // Service finished (triggers wallet credit & inventory deduction)
    CANCELLED = 'cancelled',       // User/admin cancelled
    DISPUTED = 'disputed',         // Reserved for future dispute handling
}

/**
 * Allowed state transitions mapping
 * Each state can only transition to specific next states
 */
export const ALLOWED_TRANSITIONS: Record<BookingState, BookingState[]> = {
    [BookingState.CREATED]: [BookingState.ASSIGNED, BookingState.CANCELLED],
    [BookingState.ASSIGNED]: [BookingState.ACCEPTED, BookingState.CANCELLED],
    [BookingState.ACCEPTED]: [BookingState.IN_PROGRESS, BookingState.CANCELLED],
    [BookingState.IN_PROGRESS]: [BookingState.COMPLETED, BookingState.DISPUTED],
    [BookingState.COMPLETED]: [BookingState.DISPUTED], // Can dispute after completion
    [BookingState.CANCELLED]: [], // Terminal state
    [BookingState.DISPUTED]: [], // Terminal state (requires admin intervention)
};

/**
 * Validates if a state transition is allowed
 */
export function validateStateTransition(from: BookingState, to: BookingState): boolean {
    const allowedNext = ALLOWED_TRANSITIONS[from];
    return allowedNext.includes(to);
}

/**
 * Checks if a booking can be cancelled in its current state
 * Business rule: Can only cancel before IN_PROGRESS
 */
export function canCancelBooking(currentState: BookingState): boolean {
    return [
        BookingState.CREATED,
        BookingState.ASSIGNED,
        BookingState.ACCEPTED
    ].includes(currentState);
}

/**
 * Determines if wallet credit and inventory deduction should be triggered
 * CRITICAL: This ONLY happens when state transitions to COMPLETED
 * Phase 3 will implement the actual wallet/inventory logic
 */
export function shouldTriggerWalletCredit(newState: BookingState): boolean {
    return newState === BookingState.COMPLETED;
}

/**
 * Get human-readable state description
 */
export function getStateDescription(state: BookingState): string {
    const descriptions: Record<BookingState, string> = {
        [BookingState.CREATED]: 'Service request created',
        [BookingState.ASSIGNED]: 'Partner assigned to service',
        [BookingState.ACCEPTED]: 'Partner accepted the service',
        [BookingState.IN_PROGRESS]: 'Service work in progress',
        [BookingState.COMPLETED]: 'Service completed successfully',
        [BookingState.CANCELLED]: 'Service cancelled',
        [BookingState.DISPUTED]: 'Service under dispute',
    };
    return descriptions[state];
}
