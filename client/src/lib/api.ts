import { apiRequest } from "./queryClient";

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  phone: string;
  password: string;
  userType: 'normal' | 'business';
  homeAddress?: string;
  pinCode: string;
  businessType?: 'individual' | 'business';
  services?: string[];
}

export interface OTPRequest {
  phone?: string;
  email?: string;
  purpose: string;
}

export interface OTPVerification {
  phone?: string;
  email?: string;
  otp: string;
  purpose: string;
}

export const authApi = {
  login: async (credentials: LoginCredentials) => {
    const response = await apiRequest("POST", "/api/auth/login", credentials);
    return response.json();
  },

  register: async (userData: RegisterData) => {
    const response = await apiRequest("POST", "/api/auth/register", userData);
    return response.json();
  },

  sendOTP: async (otpRequest: OTPRequest) => {
    const response = await apiRequest("POST", "/api/otp/send", otpRequest);
    return response.json();
  },

  verifyOTP: async (verification: OTPVerification) => {
    const response = await apiRequest("POST", "/api/otp/verify", verification);
    return response.json();
  },
};

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

export const utilsApi = {
  generateVerificationCode: async () => {
    const response = await apiRequest("POST", "/api/utils/generate-code");
    return response.json();
  },
};
