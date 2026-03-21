/**
 * React Query hooks for customer data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customerApi, CreateServiceRequest } from '../api/customer.api';
import { Alert } from 'react-native';
import { getApiErrorMessage } from '../api/client';

// ==================== QUERY KEYS ====================

export const queryKeys = {
    profile: ['profile'] as const,
    serviceRequests: ['serviceRequests'] as const,
    notifications: ['notifications'] as const,
};

// ==================== PROFILE ====================

export function useProfile() {
    return useQuery({
        queryKey: queryKeys.profile,
        queryFn: async () => {
            const response = await customerApi.getProfile();
            return response.data;
        },
    });
}

export function useUpdateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: customerApi.updateProfile,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.profile });
        },
        onError: (error) => {
            Alert.alert('Update Failed', getApiErrorMessage(error));
        },
    });
}

// ==================== SERVICE REQUESTS ====================

export function useServiceRequests() {
    return useQuery({
        queryKey: queryKeys.serviceRequests,
        queryFn: async () => {
            const response = await customerApi.getMyServiceRequests();
            return response.data;
        },
    });
}

export function useCreateServiceRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateServiceRequest) =>
            customerApi.createServiceRequest(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.serviceRequests });
        },
        onError: (error) => {
            Alert.alert('Request Failed', getApiErrorMessage(error));
        },
    });
}

export function useCancelServiceRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => customerApi.cancelServiceRequest(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.serviceRequests });
        },
    });
}

export function useRateService() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: { rating: number; feedback: string } }) =>
            customerApi.rateService(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.serviceRequests });
        },
    });
}

// ==================== NOTIFICATIONS ====================

export function useNotifications() {
    return useQuery({
        queryKey: queryKeys.notifications,
        queryFn: async () => {
            const response = await customerApi.getNotifications();
            return response.data;
        },
    });
}

// ==================== PINCODE ====================

export function useValidatePincode() {
    return useMutation({
        mutationFn: (pinCode: string) => customerApi.validatePincode(pinCode),
    });
}
