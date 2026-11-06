/**
 * Booking bands: how booking a service works.
 *
 *   field_service     a visit — book, pay the booking fee, the expert comes (as always)
 *   inspect_quote     pay an inspection fee to book the visit; the expert quotes in
 *                     the app; approved, the work goes ahead and the fee counts
 *                     towards the bill; declined, the job closes and the fee is the
 *                     expert's visit pay
 *   consultation      a phone call at a slot the customer books; no visit
 *   digital_recharge  the recharge flow (broadband); nothing is booked here
 *   referral          a free enquiry sent to partners in the area (enquiry.service.ts)
 *
 * A category has a band (default field_service, what every booking did before
 * bands); a service may override it. Colours are theme colours only.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { services, serviceCategories } from '@shared/schema';

export const BANDS = ['field_service', 'inspect_quote', 'consultation', 'digital_recharge', 'referral'] as const;
export type Band = typeof BANDS[number];

export const isBand = (x: unknown): x is Band => typeof x === 'string' && (BANDS as readonly string[]).includes(x);

/** The theme colours a band may use (mobile/src/theme/colors.ts). */
export const BAND_COLOURS = ['#4F46E5', '#F59E0B', '#10B981', '#7C3AED', '#3B82F6', '#EF4444'] as const;

export const BAND_INFO: Record<Band, { label: string; color: string }> = {
    field_service: { label: 'Visit', color: '#4F46E5' },        // primary
    inspect_quote: { label: 'Inspect & quote', color: '#F59E0B' }, // warning
    consultation: { label: 'Consultation', color: '#7C3AED' },  // the theme's violet (gradientPrimary)
    digital_recharge: { label: 'Recharge', color: '#3B82F6' },  // info
    referral: { label: 'Free quotes', color: '#10B981' },       // accent
};

export const effectiveBand = (serviceBand: string | null | undefined, categoryBand: string | null | undefined): Band =>
    isBand(serviceBand) ? serviceBand : isBand(categoryBand) ? categoryBand : 'field_service';

export const bandColour = (band: Band, categoryColour: string | null | undefined) =>
    categoryColour && /^#[0-9A-Fa-f]{6}$/.test(categoryColour) ? categoryColour : BAND_INFO[band].color;

export class BookingBandService {
    /** The band, inspection fee and category of a catalogue service. */
    static async forCatalogService(catalogServiceId: number | null | undefined): Promise<{ band: Band; inspectionFee: number | null; categoryId: number | null }> {
        if (!catalogServiceId) return { band: 'field_service', inspectionFee: null, categoryId: null };
        const [row] = await db.select({
            sBand: services.bookingBand, cBand: serviceCategories.bookingBand, fee: serviceCategories.inspectionFee, categoryId: services.categoryId,
        }).from(services).leftJoin(serviceCategories, eq(serviceCategories.id, services.categoryId)).where(eq(services.id, catalogServiceId)).limit(1);
        if (!row) return { band: 'field_service', inspectionFee: null, categoryId: null };
        return { band: effectiveBand(row.sBand, row.cBand), inspectionFee: row.fee ?? null, categoryId: row.categoryId ?? null };
    }

    /** Check admin input for a category or service. Throws a plain-language message. */
    static clean(input: { bookingBand?: unknown; inspectionFee?: unknown; bandColor?: unknown }, opts: { allowInherit: boolean }) {
        const out: { bookingBand?: Band | null; inspectionFee?: number | null; bandColor?: string | null } = {};
        if (input.bookingBand !== undefined) {
            if ((input.bookingBand === null || input.bookingBand === '') && opts.allowInherit) out.bookingBand = null;
            else if (isBand(input.bookingBand)) out.bookingBand = input.bookingBand;
            else throw new Error('Choose a booking band: Visit, Inspect & quote, Consultation, Recharge or Free quotes.');
        }
        if (input.inspectionFee !== undefined) {
            if (input.inspectionFee === null || input.inspectionFee === '') out.inspectionFee = null;
            else {
                const n = Number(input.inspectionFee);
                if (!Number.isInteger(n) || n < 0 || n > 5000) throw new Error('Inspection fee: a whole number of rupees, 0 to 5000.');
                out.inspectionFee = n;
            }
        }
        if (input.bandColor !== undefined) {
            if (input.bandColor === null || input.bandColor === '') out.bandColor = null;
            else if ((BAND_COLOURS as readonly string[]).includes(String(input.bandColor).toUpperCase())) out.bandColor = String(input.bandColor).toUpperCase();
            else throw new Error('Band colour: choose one of the theme colours.');
        }
        return out;
    }
}
