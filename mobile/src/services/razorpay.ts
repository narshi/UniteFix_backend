/**
 * Razorpay Native SDK Wrapper
 * Single source of truth for all payment flows in UniteFix
 * 
 * Usage:
 *   import { openRazorpayCheckout, handleRazorpayError } from '../services/razorpay';
 *   const response = await openRazorpayCheckout({ ... });
 */

import RazorpayCheckout from 'react-native-razorpay';
import { Alert } from 'react-native';

// Razorpay test key — also sent from backend per-request
const DEFAULT_KEY_ID = 'rzp_test_S4tdycF8xSAo2L';

export interface RazorpayOrderInfo {
    razorpayOrderId: string;
    razorpayKeyId?: string;
    amount: number;         // in RUPEES (not paise)
    currency?: string;
    description?: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
}

export interface RazorpaySuccessResponse {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
}

/**
 * Open Razorpay native checkout
 * @returns Payment response on success
 * @throws Error with code=2 on user cancellation, or other codes on failure
 */
export async function openRazorpayCheckout(
    orderInfo: RazorpayOrderInfo
): Promise<RazorpaySuccessResponse> {
    const options = {
        key: orderInfo.razorpayKeyId || DEFAULT_KEY_ID,
        amount: (orderInfo.amount * 100).toString(), // Rupees → Paise (string)
        currency: orderInfo.currency || 'INR',
        name: 'UniteFix',
        description: orderInfo.description || 'Service Payment',
        order_id: orderInfo.razorpayOrderId,
        prefill: {
            name: orderInfo.customerName || '',
            email: orderInfo.customerEmail || '',
            contact: orderInfo.customerPhone || '',
        },
        theme: {
            color: '#4F46E5', // Deep Indigo — brand primary
        },
    };

    const response = await RazorpayCheckout.open(options);
    return response as RazorpaySuccessResponse;
}

/**
 * Handle Razorpay error — shows alert for real failures, silent for cancellation
 * @returns User-friendly error message
 */
export function handleRazorpayError(error: any): string {
    const code = error?.code;
    const description = error?.description || 'Payment was cancelled or failed.';

    // code 2 = user pressed back / cancelled — don't show error
    if (code === 2) {
        return 'Payment cancelled.';
    }

    Alert.alert('Payment Failed', description);
    return description;
}
