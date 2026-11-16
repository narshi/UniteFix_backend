import { apiRequest } from "./queryClient";

export const locationApi = {
  validatePinCode: async (pinCode: string) => {
    const response = await apiRequest("POST", "/api/validate-pincode", { pinCode });
    return response.json();
  },
};

export const serviceApi = {
  createServiceRequest: async (serviceData: any) => {
    const response = await apiRequest("POST", "/api/services", serviceData);
    return response.json();
  },

  getUserServices: async () => {
    const response = await apiRequest("GET", "/api/services");
    return response.json();
  },

  updateServiceStatus: async (id: number, status: string) => {
    const response = await apiRequest("PATCH", `/api/services/${id}/status`, { status });
    return response.json();
  },
};

export const productApi = {
  getAllProducts: async () => {
    const response = await apiRequest("GET", "/api/products");
    return response.json();
  },

  getProduct: async (id: number) => {
    const response = await apiRequest("GET", `/api/products/${id}`);
    return response.json();
  },

  getProductsByCategory: async (category: string) => {
    const response = await apiRequest("GET", `/api/products?category=${category}`);
    return response.json();
  },
};

export const cartApi = {
  addToCart: async (productId: number, quantity: number) => {
    const response = await apiRequest("POST", "/api/cart", { productId, quantity });
    return response.json();
  },

  getCartItems: async () => {
    const response = await apiRequest("GET", "/api/cart");
    return response.json();
  },

  updateCartItem: async (id: number, quantity: number) => {
    const response = await apiRequest("PATCH", `/api/cart/${id}`, { quantity });
    return response.json();
  },

  removeFromCart: async (id: number) => {
    const response = await apiRequest("DELETE", `/api/cart/${id}`);
    return response.json();
  },
};

export const orderApi = {
  createOrder: async (orderData: any) => {
    const response = await apiRequest("POST", "/api/orders", orderData);
    return response.json();
  },

  getUserOrders: async () => {
    const response = await apiRequest("GET", "/api/orders");
    return response.json();
  },
};

export const businessApi = {
  getPartnerServices: async () => {
    const response = await apiRequest("GET", "/api/business/services");
    return response.json();
  },

  getBusinessPartners: async (service?: string) => {
    const url = service ? `/api/business/partners?service=${service}` : "/api/business/partners";
    const response = await apiRequest("GET", url);
    return response.json();
  },
};

export const adminApi = {
  getStats: async () => {
    const response = await apiRequest("GET", "/api/admin/stats");
    return response.json();
  },

  getRecentServices: async (limit = 10) => {
    const response = await apiRequest("GET", `/api/admin/services/recent?limit=${limit}`);
    return response.json();
  },

  getRecentOrders: async (limit = 10) => {
    const response = await apiRequest("GET", `/api/admin/orders/recent?limit=${limit}`);
    return response.json();
  },

  getPendingAssignments: async () => {
    const response = await apiRequest("GET", "/api/admin/services/pending");
    return response.json();
  },

  assignPartner: async (serviceId: number, partnerId: number) => {
    const response = await apiRequest("POST", `/api/admin/services/${serviceId}/assign`, { partnerId });
    return response.json();
  },
};

