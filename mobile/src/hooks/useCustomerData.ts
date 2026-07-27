/**
 * React Query hooks for customer data
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { customerApi, CreateServiceRequest } from '../api/customer.api';
import { Alert } from 'react-native';
import { getApiErrorMessage } from '../api/client';

// ==================== QUERY KEYS ====================

export const queryKeys = {
    profile: ['profile'] as const,
    serviceRequests: ['serviceRequests'] as const,
    serviceHistory: ['serviceHistory'] as const,
    notifications: ['notifications'] as const,
    homeServices: ['homeServices'] as const,
    allServices: ['allServices'] as const,
    publicConfig: ['publicConfig'] as const,
    partnerProfile: ['partnerProfile'] as const,
};

// ==================== PROFILE ====================

export function useProfile() {
    return useQuery({
        queryKey: queryKeys.profile,
        queryFn: async () => {
            const response = await customerApi.getProfile();
            return response.data.data;
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

export function usePartnerProfile() {
    return useQuery({
        queryKey: queryKeys.partnerProfile,
        queryFn: async () => {
            const response = await customerApi.getPartnerProfile();
            // NOTE: partner-profile.routes.ts DOES respond `{ success: true, data: employee }`,
            // so `response.data` is the envelope and the employee row sits at
            // `response.data.data`. Callers therefore read `x?.data?.field ?? x?.field`.
            // Returning the envelope unchanged to avoid breaking those call sites.
            return response.data;
        },
    });
}

export function useUpdateUpiId() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: customerApi.updateUpiId,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.partnerProfile });
        },
        onError: (error) => {
            Alert.alert('Update Failed', getApiErrorMessage(error));
        },
    });
}

// ==================== SERVICE CATALOG ====================

export function useHomeServices() {
    return useQuery({
        queryKey: queryKeys.homeServices,
        queryFn: async () => {
            const response = await customerApi.getHomeServices();
            return response.data.data;
        },
    });
}

export function useAllServices() {
    return useQuery({
        queryKey: queryKeys.allServices,
        queryFn: async () => {
            const response = await customerApi.getAllCategories();
            return response.data.data;
        },
    });
}

// ==================== SERVICE REQUESTS ====================

export function useServiceRequests() {
    return useQuery({
        queryKey: queryKeys.serviceRequests,
        queryFn: async () => {
            const response = await customerApi.getMyServiceRequests();
            return response.data.data;
        },
        refetchInterval: 5_000,
    });
}

export function useServiceHistory() {
    return useInfiniteQuery({
        queryKey: queryKeys.serviceHistory,
        queryFn: async ({ pageParam = 1 }) => {
            const response = await customerApi.getServiceHistory(pageParam as number, 15);
            return response.data;
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
        onMutate: async (id: number) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.serviceRequests });
            await queryClient.cancelQueries({ queryKey: queryKeys.serviceHistory });

            const previousRequests = queryClient.getQueryData(queryKeys.serviceRequests);
            const previousHistory = queryClient.getQueryData(queryKeys.serviceHistory);

            queryClient.setQueryData(queryKeys.serviceRequests, (old: any) => {
                if (!old) return old;
                // Remove from active list - it will be fetched in history instead if it's merely cancelled
                return old.filter((r: any) => r.id !== id);
            });

            return { previousRequests, previousHistory };
        },
        onError: (err, id, context) => {
            if (context?.previousRequests) {
                queryClient.setQueryData(queryKeys.serviceRequests, context.previousRequests);
            }
            if (context?.previousHistory) {
                queryClient.setQueryData(queryKeys.serviceHistory, context.previousHistory);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.serviceRequests });
            queryClient.invalidateQueries({ queryKey: queryKeys.serviceHistory });
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
            return response.data.data;
        },
    });
}

// ==================== PINCODE ====================

export function useValidatePincode() {
    return useMutation({
        mutationFn: (pinCode: string) => customerApi.validatePincode(pinCode),
    });
}

// ==================== PUBLIC CONFIG ====================

export function usePublicConfig() {
    return useQuery({
        queryKey: queryKeys.publicConfig,
        queryFn: async () => {
            const response = await customerApi.getPublicConfig();
            return response.data.data;
        },
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes — config rarely changes
    });
}
