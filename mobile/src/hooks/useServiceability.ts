/**
 * Pin code serviceability — one implementation for customers AND service experts.
 *
 * The customer home screen used to do this inline with useEffect + useState.
 * Experts need the same answer for a different reason: jobs are only dispatched
 * in pin codes we cover, so an expert registered outside one will simply never
 * be assigned anything, with nothing on screen explaining why.
 *
 * FAILS OPEN. A network blip resolves to "serviceable" rather than "not". The
 * wrong answer in that direction merely shows a catalogue we cannot yet fulfil;
 * the other direction tells a working expert their area is dead, or hides the
 * services from a customer who could have booked.
 */

import { useQuery } from '@tanstack/react-query';
import { customerApi } from '../api/customer.api';

/** Cached for a while — a pin code's coverage does not change minute to minute. */
const STALE_MS = 1000 * 60 * 10;

export interface Serviceability {
    /** Normalised pin code that was checked ('' when none is known). */
    pinCode: string;
    /** true / false, or null while unknown — no pin code yet, or still checking. */
    isServiceable: boolean | null;
    isChecking: boolean;
}

export function useServiceability(pinCode?: string | null): Serviceability {
    const clean = typeof pinCode === 'string' ? pinCode.replace(/\s+/g, '') : '';
    const enabled = clean.length > 0;

    const { data, isLoading } = useQuery({
        queryKey: ['serviceability', clean],
        enabled,
        staleTime: STALE_MS,
        queryFn: async () => {
            try {
                const res = await customerApi.validatePincode(clean);
                const body: any = res.data;
                // The endpoint returns both `available` and `serviceable`.
                return (body?.available ?? body?.serviceable ?? true) as boolean;
            } catch {
                return true;
            }
        },
    });

    return {
        pinCode: clean,
        isServiceable: !enabled || isLoading ? null : data ?? null,
        isChecking: enabled && isLoading,
    };
}
