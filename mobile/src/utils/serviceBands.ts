/**
 * Booking bands — how a service is booked (server: booking-band.service.ts).
 *
 *   field_service     Book a visit (as always)
 *   inspect_quote     Book an inspection: pay the inspection fee, get a quote, approve or decline
 *   consultation      Book a call at a day and time; no visit
 *   digital_recharge  Opens the recharge flow; nothing is booked
 *   referral          Get free quotes: an enquiry to partners near you
 *
 * One place decides where tapping a service goes, so Home and All Services agree.
 */

import { Alert } from 'react-native';
import { colors } from '../theme/colors';
import type { ServiceItem } from '../api/customer.api';

export type Band = 'field_service' | 'inspect_quote' | 'consultation' | 'digital_recharge' | 'referral';
const BANDS: Band[] = ['field_service', 'inspect_quote', 'consultation', 'digital_recharge', 'referral'];
export const isBand = (x: unknown): x is Band => typeof x === 'string' && (BANDS as string[]).includes(x);

/** Labels and default colours (theme colours only; staff may pick another theme colour per category). */
export const BAND_META: Record<Band, { label: string; cta: string; color: string }> = {
    field_service: { label: 'Visit', cta: 'Book a visit', color: colors.primary },
    inspect_quote: { label: 'Inspect & quote', cta: 'Book inspection', color: colors.warning },
    consultation: { label: 'Consultation', cta: 'Book a consultation', color: colors.gradientPrimary[1] },
    digital_recharge: { label: 'Recharge', cta: 'Recharge', color: colors.info },
    referral: { label: 'Free quotes', cta: 'Get free quotes', color: colors.accent },
};

export const bandOf = (s?: { band?: string | null } | null): Band => (isBand(s?.band) ? s!.band as Band : 'field_service');
export const bandColorOf = (s?: { band?: string | null; bandColor?: string | null } | null): string =>
    s?.bandColor && /^#[0-9A-Fa-f]{6}$/.test(s.bandColor) ? s.bandColor : BAND_META[bandOf(s)].color;

/** Where tapping a service goes. */
export function openService(navigation: any, service: ServiceItem) {
    if (service.status === 'COMING_SOON') {
        Alert.alert('Coming Soon', 'This service is launching soon in your area.');
        return;
    }
    if (service.status === 'MAINTENANCE') {
        Alert.alert('Under Maintenance', 'This service is temporarily under maintenance. Please try again later.');
        return;
    }
    const band = bandOf(service);
    if (band === 'referral') {
        navigation.navigate('ServiceEnquiry', { serviceId: service.id, serviceName: service.name });
        return;
    }
    if (band === 'digital_recharge') {
        if (/broadband|internet|ftth|fiber|fibre|wi-?fi/i.test(service.name)) navigation.navigate('FTTHOperatorSelect');
        else Alert.alert('Recharge coming soon', `${service.name} recharges are coming to the app soon.`);
        return;
    }
    navigation.navigate('ServiceRequest', {
        serviceType: service.name,
        serviceName: service.name,
        serviceId: service.id,
        basePrice: service.basePrice ?? 0,
        bookingFee: service.bookingFee,
        band,
    });
}
