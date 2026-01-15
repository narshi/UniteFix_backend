/**
 * PHASE 2: State Mapping Layer (Backward Compatibility)
 * 
 * Maps legacy database states to canonical internal states and vice versa.
 * This allows gradual migration from old enum to new normalized states.
 * 
 * DB States (current): placed, confirmed, partner_assigned, service_started, service_completed, cancelled
 * Canonical States: CREATED, ASSIGNED, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED, DISPUTED
 */

import { BookingState } from './booking-state-machine';

// Type for legacy database states
export type LegacyBookingState =
    | 'placed'
    | 'confirmed'
    | 'partner_assigned'
    | 'service_started'
    | 'service_completed'
    | 'cancelled';

/**
 * Map legacy DB state to canonical internal state
 * Used when READING from database
 */
export function legacyToCanonical(legacyState: string): BookingState {
    const mapping: Record<LegacyBookingState, BookingState> = {
        'placed': BookingState.CREATED,
        'confirmed': BookingState.ACCEPTED,           // confirmed maps to accepted (user confirmed)
        'partner_assigned': BookingState.ASSIGNED,    // partner_assigned maps to assigned
        'service_started': BookingState.IN_PROGRESS,
        'service_completed': BookingState.COMPLETED,
        'cancelled': BookingState.CANCELLED,
    };

    // If it's already a canonical state, return as-is
    if (Object.values(BookingState).includes(legacyState as BookingState)) {
        return legacyState as BookingState;
    }

    const canonical = mapping[legacyState as LegacyBookingState];
    if (!canonical) {
        console.warn(`Unknown legacy state: ${legacyState}, defaulting to CREATED`);
        return BookingState.CREATED;
    }

    return canonical;
}

/**
 * Map canonical internal state to legacy DB state
 * Used when WRITING to database (for backward compatibility)
 * 
 * Note: Some canonical states (ASSIGNED, ACCEPTED) need special handling
 */
export function canonicalToLegacy(canonicalState: BookingState): LegacyBookingState {
    const mapping: Record<BookingState, LegacyBookingState> = {
        [BookingState.CREATED]: 'placed',
        [BookingState.ASSIGNED]: 'partner_assigned',
        [BookingState.ACCEPTED]: 'confirmed',
        [BookingState.IN_PROGRESS]: 'service_started',
        [BookingState.COMPLETED]: 'service_completed',
        [BookingState.CANCELLED]: 'cancelled',
        [BookingState.DISPUTED]: 'cancelled', // DISPUTED maps to cancelled in legacy (closest match)
    };

    return mapping[canonicalState];
}

/**
 * Normalize a state value (DB or canonical) to canonical
 * Safe to use on any string state value
 */
export function normalizeState(state: string): BookingState {
    return legacyToCanonical(state);
}

/**
 * Check if a state value is legacy format
 */
export function isLegacyState(state: string): boolean {
    const legacyStates: LegacyBookingState[] = [
        'placed',
        'confirmed',
        'partner_assigned',
        'service_started',
        'service_completed',
        'cancelled'
    ];
    return legacyStates.includes(state as LegacyBookingState);
}

/**
 * Get human-readable description for any state (legacy or canonical)
 */
export function getStateDescription(state: string): string {
    const canonical = normalizeState(state);
    const descriptions: Record<BookingState, string> = {
        [BookingState.CREATED]: 'Service request created',
        [BookingState.ASSIGNED]: 'Partner assigned to service',
        [BookingState.ACCEPTED]: 'Partner accepted the service',
        [BookingState.IN_PROGRESS]: 'Service work in progress',
        [BookingState.COMPLETED]: 'Service completed successfully',
        [BookingState.CANCELLED]: 'Service cancelled',
        [BookingState.DISPUTED]: 'Service under dispute',
    };
    return descriptions[canonical] || 'Unknown state';
}
