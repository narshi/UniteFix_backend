/**
 * React Query hooks for the store. The cart lives on the server: every change
 * returns the new cart, which replaces the cached one (no refetch flicker).
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { shopApi, type BuyItem, type Cart, type CheckoutSource } from '../api/shop.api';
import { useAuthStore } from '../stores/auth.store';

export const shopKeys = {
    categories: ['shop', 'categories'] as const,
    products: (q: { search?: string; categoryId?: number; sort?: string }) => ['shop', 'products', q] as const,
    product: (id: number) => ['shop', 'product', id] as const,
    cart: ['shop', 'cart'] as const,
    preview: (src: CheckoutSource) => ['shop', 'preview', src] as const,
    orders: (status: string) => ['shop', 'orders', status] as const,
    order: (id: number) => ['shop', 'order', id] as const,
};

export function useStoreCategories() {
    return useQuery({ queryKey: shopKeys.categories, queryFn: shopApi.categories, staleTime: 5 * 60_000 });
}

export function useStoreProducts(q: { search?: string; categoryId?: number; sort?: string }) {
    return useInfiniteQuery({
        queryKey: shopKeys.products(q),
        queryFn: ({ pageParam }) => shopApi.products({ ...q, page: pageParam, limit: 20 }),
        initialPageParam: 1,
        getNextPageParam: last => (last.hasMore ? last.page + 1 : undefined),
        staleTime: 30_000,
    });
}

export function useStoreProduct(id: number) {
    return useQuery({ queryKey: shopKeys.product(id), queryFn: () => shopApi.product(id), enabled: id > 0 });
}

export function useCart() {
    const signedIn = useAuthStore(s => s.isAuthenticated);
    return useQuery({ queryKey: shopKeys.cart, queryFn: shopApi.cart, enabled: signedIn, staleTime: 10_000 });
}

function useCartMutation<V>(fn: (v: V) => Promise<Cart>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: cart => qc.setQueryData(shopKeys.cart, cart),
        // A refused change (out of stock, price) leaves the server's cart as it is: show that.
        onError: () => qc.invalidateQueries({ queryKey: shopKeys.cart }),
    });
}
export const useAddToCart = () => useCartMutation((item: BuyItem) => shopApi.addToCart(item));
export const useSetCartQuantity = () => useCartMutation((v: { lineId: number; quantity: number }) => shopApi.setQuantity(v.lineId, v.quantity));
export const useRemoveCartLine = () => useCartMutation((lineId: number) => shopApi.removeLine(lineId));

export function useCheckoutPreview(src: CheckoutSource) {
    return useQuery({ queryKey: shopKeys.preview(src), queryFn: () => shopApi.preview(src), staleTime: 0, gcTime: 0 });
}

export function useStoreOrders(status: 'open' | 'done' | 'all') {
    return useInfiniteQuery({
        queryKey: shopKeys.orders(status),
        queryFn: ({ pageParam }) => shopApi.orders({ status, page: pageParam }),
        initialPageParam: 1,
        getNextPageParam: last => (last.hasMore ? last.page + 1 : undefined),
    });
}

export function useStoreOrder(id: number) {
    return useQuery({ queryKey: shopKeys.order(id), queryFn: () => shopApi.order(id), enabled: id > 0 });
}

/** After anything that changes orders or stock. */
export function useRefreshShop() {
    const qc = useQueryClient();
    return () => {
        qc.invalidateQueries({ queryKey: ['shop', 'orders'] });
        qc.invalidateQueries({ queryKey: ['shop', 'order'] });
        qc.invalidateQueries({ queryKey: ['shop', 'product'] });
        qc.invalidateQueries({ queryKey: ['shop', 'products'] });
        qc.invalidateQueries({ queryKey: shopKeys.cart });
    };
}
