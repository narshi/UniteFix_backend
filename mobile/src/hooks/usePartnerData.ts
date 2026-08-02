/**
 * React Query hooks for partner/employee data
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { partnerApi } from '../api/partner.api';
import { Alert } from 'react-native';
import { getApiErrorMessage, apiClient } from '../api/client';

export const partnerQueryKeys = {
    assignments: ['partner.assignments'] as const,
    assignmentHistory: ['partner.assignmentHistory'] as const,
    wallet: ['partner.wallet'] as const,
    profile: ['partner.profile'] as const,
};

// ==================== ASSIGNMENTS ====================

export function useAssignments() {
    return useQuery({
        queryKey: partnerQueryKeys.assignments,
        queryFn: async () => {
            const response = await partnerApi.getAssignments();
            // Backend returns { success, data: Assignment[] }
            // Axios wraps in response.data → { success, data }
            // We need the inner data array
            const payload = response.data;
            if (Array.isArray(payload)) return payload; // Direct array response
            if (payload && Array.isArray((payload as any).data)) return (payload as any).data;
            return []; // Fallback to empty array
        },
        refetchInterval: 5_000,
    });
}

export function useAssignmentHistory() {
    return useInfiniteQuery({
        queryKey: partnerQueryKeys.assignmentHistory,
        queryFn: async ({ pageParam = 1 }) => {
            const response = await partnerApi.getAssignmentHistory(pageParam as number, 15);
            const payload = response.data;
            // Normalize: backend returns { success, data: [...], pagination: {...} }
            return payload;
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage: any) => {
            const pagination = lastPage.pagination;
            if (pagination && pagination.hasMore) {
                return pagination.page + 1;
            }
            return undefined;
        },
        refetchInterval: 10_000,
    });
}

export function useAcceptAssignment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => partnerApi.acceptAssignment(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Accepted!', 'You have accepted the assignment.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useDenyAssignment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
            partnerApi.denyAssignment(id, reason),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

// ==================== SERVICE FLOW ====================

export function useMarkArrived() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ bookingId, latitude, longitude }: { bookingId: number; latitude: number; longitude: number }) =>
            partnerApi.markArrived(bookingId, latitude, longitude),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Arrived', 'Location verified. Please ask the customer for the OTP to start the service.');
        },
        onError: (e) => Alert.alert('Arrival Error', getApiErrorMessage(e)),
    });
}

export function useStartServiceWithOtp() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ bookingId, otp }: { bookingId: number; otp: string }) =>
            partnerApi.startServiceWithOtp(bookingId, otp),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Service Started', 'OTP verified successfully.');
        },
        onError: (e) => Alert.alert('Start Error', getApiErrorMessage(e)),
    });
}

export function useCompleteService() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (serviceId: number) => partnerApi.completeService(serviceId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Done!', 'Service marked as complete.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useEnterServiceCharge() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ serviceId, data }: { serviceId: number | string; data: { serviceCharge: number; materialCharge?: number; notes?: string } }) =>
            partnerApi.enterServiceCharge(serviceId as number, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Success', 'Service charges submitted successfully.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useRequestPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ bookingId, extraPartsCost, partsNote }: { bookingId: number; extraPartsCost?: number; partsNote?: string }) =>
            partnerApi.requestPayment(bookingId, { extraPartsCost, partsNote }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Payment Requested', 'The customer can now pay the balance.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

// ==================== WALLET ====================

export function useWallet() {
    return useQuery({
        queryKey: partnerQueryKeys.wallet,
        queryFn: () => partnerApi.getWallet(),
        retry: 1,
    });
}

export function useWithdraw() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (data: { amount: number; method: 'bank' | 'upi' }) => partnerApi.withdraw(data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.wallet });
            Alert.alert(
                'Withdrawal Requested',
                'Your payout request has been submitted. The money will reach your UPI once an admin approves it, usually within 24 hours. You can track it in your wallet history.'
            );
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useGenerateRazorpayQR() {
    return useMutation({
        mutationFn: async (serviceId: number) => {
            const { data } = await apiClient.post(`/api/partner/services/${serviceId}/generate-qr`);
            return data.data; // { qrImageUrl, qrCodeId }
        },
        onError: (e) => {
            Alert.alert('QR Generation Failed', getApiErrorMessage(e));
        }
    });
}

/**
 * Poll Razorpay (via our backend) for the outcome of a dynamic QR.
 *
 * A scanned QR is paid from the customer's own UPI app, so unlike card or
 * in-app UPI no payment id ever comes back to a client. Without this the
 * booking can only be completed by the webhook, and stays in pending_payment
 * whenever webhook delivery fails.
 *
 * `enabled` should be true only while a QR is actually on screen.
 */
export function useQrPaymentStatus(serviceId: number | undefined, enabled: boolean) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: ['partner.qrStatus', serviceId],
        queryFn: async () => {
            const { data } = await apiClient.get(`/api/partner/services/${serviceId}/qr-status`);
            const result = data?.data ?? {};
            if (result.paid) {
                // Booking just moved to COMPLETED — refresh the assignment list
                // and wallet so the partner sees it immediately.
                qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
                qc.invalidateQueries({ queryKey: partnerQueryKeys.wallet });
            }
            return result as { paid: boolean; status?: string; amount?: number };
        },
        enabled: !!serviceId && enabled,
        refetchInterval: (query) => (query.state.data?.paid ? false : 5000),
        // A transient failure here must not look like "not paid" — keep the last
        // known value and let the next tick retry.
        retry: 1,
    });
}
