/**
 * Open the phone dialer with a customer's number.
 *
 * `tel:` opens the dialer with the number filled in; the technician still
 * presses call. That needs no CALL_PHONE permission on Android, and it is the
 * right behaviour anyway — a mis-tap should not start a call.
 *
 * Not gated on Linking.canOpenURL: on Android 11+ that returns false for tel:
 * unless the app declares a <queries> entry, so it would hide the button on
 * exactly the phones that can call. openURL is tried and a failure explained.
 */

import { Alert, Linking } from 'react-native';

/** Statuses where the technician has a live reason to ring the customer. */
const CALLABLE = new Set(['assigned', 'accepted', 'reached', 'in_progress', 'pending_payment', 'disputed']);

export function canCallCustomer(status: string | null | undefined, phone: string | null | undefined): boolean {
    return CALLABLE.has(String(status ?? '')) && dialable(phone) !== null;
}

/** Digits and a leading +, or null if there is nothing a dialer could use. */
function dialable(phone: string | null | undefined): string | null {
    const raw = String(phone ?? '').trim();
    const cleaned = raw.replace(/[^\d+]/g, '');
    return cleaned.replace(/\D/g, '').length >= 10 ? cleaned : null;
}

export function callCustomer(phone: string | null | undefined, name?: string | null): void {
    const number = dialable(phone);
    if (!number) {
        Alert.alert('No number on file', 'This booking has no phone number for the customer. Contact UniteFix support.');
        return;
    }
    Linking.openURL(`tel:${number}`).catch(() => {
        Alert.alert('Could not open the dialer', `Call ${name ? `${name} on ` : ''}${number} from your phone app.`);
    });
}
