/**
 * Shop / E-Commerce API — Products, Cart, Orders
 */

import { apiClient } from './client';

// ==================== TYPES ====================

export interface Product {
    id: number;
    name: string;
    description: string;
    price: number;
    mrp?: number;
    category: string;
    imageUrl?: string;
    stock: number;
    isActive: boolean;
    createdAt: string;
}

export interface CartItem {
    id: number;
    productId: number;
    userId: number;
    quantity: number;
    product?: Product;
    createdAt: string;
}

export interface Order {
    id: number;
    userId: number;
    products: Array<{ productId: number; quantity: number; name?: string; price?: number }>;
    totalAmount: number;
    address: string;
    status: string; // pending, confirmed, shipped, delivered, cancelled
    deliveryLat?: number;
    deliveryLong?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Pagination {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    hasMore: boolean;
}

// ==================== API ====================

export const shopApi = {
    // Products
    getProducts: (page = 1, limit = 20, category?: string) => {
        const params: Record<string, any> = { page, limit };
        if (category) params.category = category;
        return apiClient.get<{ data: Product[]; pagination: Pagination }>('/api/products/list', { params });
    },

    getProduct: (id: number) =>
        apiClient.get<Product>(`/api/products/${id}`),

    // Cart
    getCart: () =>
        apiClient.get<CartItem[]>('/api/cart'),

    addToCart: (productId: number, quantity = 1) =>
        apiClient.post('/api/cart/add', { productId, quantity }),

    updateCartItem: (itemId: number, quantity: number) =>
        apiClient.put(`/api/cart/${itemId}`, { quantity }),

    removeFromCart: (itemId: number) =>
        apiClient.delete(`/api/cart/${itemId}`),

    checkout: (data: { address: string; deliveryLat?: number; deliveryLong?: number }) =>
        apiClient.post('/api/cart/checkout', data),

    // Orders
    placeOrder: (data: {
        products: Array<{ productId: number; quantity: number }>;
        address: string;
        deliveryLat?: number;
        deliveryLong?: number;
    }) =>
        apiClient.post('/api/orders/place', data),

    // Returns
    requestReturn: (orderId: number, data: { reason: string; type: 'return' | 'exchange' }) =>
        apiClient.post(`/api/orders/${orderId}/return`, data),

    getReturnStatus: (orderId: number) =>
        apiClient.get(`/api/orders/${orderId}/return-status`),
};
