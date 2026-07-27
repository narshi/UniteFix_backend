/**
 * React Query hooks for e-commerce data
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shopApi, Product } from '../api/shop.api';
import { Alert } from 'react-native';
import { getApiErrorMessage } from '../api/client';

export const shopQueryKeys = {
    products: (page: number, category?: string) => ['shop.products', page, category] as const,
    product: (id: number) => ['shop.product', id] as const,
    cart: ['shop.cart'] as const,
};

// ==================== PRODUCTS ====================

export function useProducts(page = 1, category?: string) {
    return useQuery({
        queryKey: shopQueryKeys.products(page, category),
        queryFn: async () => {
            const response = await shopApi.getProducts(page, 20, category);
            return response.data;
        },
    });
}

export function useProduct(id: number) {
    return useQuery({
        queryKey: shopQueryKeys.product(id),
        queryFn: async () => {
            const response = await shopApi.getProduct(id);
            return response.data;
        },
        enabled: id > 0,
    });
}

// ==================== CART ====================

export function useCart() {
    return useQuery({
        queryKey: shopQueryKeys.cart,
        queryFn: async () => {
            const response = await shopApi.getCart();
            return response.data;
        },
    });
}

export function useAddToCart() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ productId, quantity }: { productId: number; quantity?: number }) =>
            shopApi.addToCart(productId, quantity),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: shopQueryKeys.cart });
            Alert.alert('Added!', 'Item added to cart.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useUpdateCartItem() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
            shopApi.updateCartItem(itemId, quantity),
        onSuccess: () => qc.invalidateQueries({ queryKey: shopQueryKeys.cart }),
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useRemoveFromCart() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (itemId: number) => shopApi.removeFromCart(itemId),
        onSuccess: () => qc.invalidateQueries({ queryKey: shopQueryKeys.cart }),
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

// ==================== ORDERS ====================

export function usePlaceOrder() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: shopApi.placeOrder,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: shopQueryKeys.cart });
            Alert.alert('Order Placed!', 'Your order has been placed successfully.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useCheckout() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: shopApi.checkout,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: shopQueryKeys.cart });
            Alert.alert('Success!', 'Your order has been placed.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}

export function useRequestReturn() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ orderId, data }: { orderId: number; data: { reason: string; type: 'return' | 'exchange' } }) =>
            shopApi.requestReturn(orderId, data),
        onSuccess: () => {
            // Without this the orders list kept showing the pre-return status
            // until the screen was remounted.
            qc.invalidateQueries({ queryKey: ['shop.myOrders'] });
            Alert.alert('Return Requested', 'Your return request has been submitted.');
        },
        onError: (e) => Alert.alert('Error', getApiErrorMessage(e)),
    });
}
