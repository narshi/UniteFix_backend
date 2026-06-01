/**
 * React Query hooks for partner/employee data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { partnerApi } from '../api/partner.api';
import { Alert } from 'react-native';
import { getApiErrorMessage } from '../api/client';

export const partnerQueryKeys = {
    assignments: ['partner.assignments'] as const,
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
        refetchInterval: 30_000,
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

export function useVerifyHandshake() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ serviceId, otp }: { serviceId: number; otp: string }) =>
            partnerApi.verifyHandshake(serviceId, otp),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
            Alert.alert('Verified!', 'OTP verified successfully.');
        },
        onError: (e) => Alert.alert('OTP Error', getApiErrorMessage(e)),
    });
}

export function useStartService() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ serviceId, latitude, longitude }: { serviceId: number; latitude?: number; longitude?: number }) =>
            partnerApi.startService(serviceId, latitude, longitude),
        onSuccess: () => qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments }),
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
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
            Alert.alert('Success', 'Withdrawal requested successfully');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}
