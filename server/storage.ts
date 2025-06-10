import {
  users,
  serviceRequests,
  productOrders,
  products,
  cartItems,
  invoices,
  otpVerifications,
  partnerAssignments,
  type User,
  type InsertUser,
  type ServiceRequest,
  type InsertServiceRequest,
  type ProductOrder,
  type InsertProductOrder,
  type Product,
  type InsertProduct,
  type CartItem,
  type InsertCartItem,
  type Invoice,
  type InsertInvoice,
  type OtpVerification,
  type InsertOtpVerification,
  type PartnerAssignment,
} from "@shared/schema";

export interface IStorage {
  // User management
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  getAllBusinessUsers(): Promise<User[]>;
  getBusinessUsersByService(service: string): Promise<User[]>;

  // Service requests
  createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest>;
  getServiceRequest(id: number): Promise<ServiceRequest | undefined>;
  getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined>;
  getUserServiceRequests(userId: number): Promise<ServiceRequest[]>;
  getPartnerServiceRequests(partnerId: number): Promise<ServiceRequest[]>;
  updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined>;
  assignPartnerToService(serviceRequestId: number, partnerId: number): Promise<ServiceRequest | undefined>;
  getPendingAssignments(): Promise<ServiceRequest[]>;
  getAllServiceRequests(): Promise<ServiceRequest[]>;

  // Product orders
  createProductOrder(order: InsertProductOrder): Promise<ProductOrder>;
  getProductOrder(id: number): Promise<ProductOrder | undefined>;
  getUserProductOrders(userId: number): Promise<ProductOrder[]>;
  updateProductOrderStatus(id: number, status: string): Promise<ProductOrder | undefined>;
  getAllProductOrders(): Promise<ProductOrder[]>;

  // Products
  createProduct(product: InsertProduct): Promise<Product>;
  getProduct(id: number): Promise<Product | undefined>;
  getAllProducts(): Promise<Product[]>;
  getProductsByCategory(category: string): Promise<Product[]>;
  updateProductStock(id: number, stock: number): Promise<Product | undefined>;

  // Cart management
  addToCart(item: InsertCartItem): Promise<CartItem>;
  getCartItems(userId: number): Promise<CartItem[]>;
  updateCartItemQuantity(id: number, quantity: number): Promise<CartItem | undefined>;
  removeFromCart(id: number): Promise<boolean>;
  clearCart(userId: number): Promise<boolean>;

  // Invoices
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoiceByInvoiceId(invoiceId: string): Promise<Invoice | undefined>;
  getUserInvoices(userId: number): Promise<Invoice[]>;

  // OTP verification
  createOtpVerification(otp: InsertOtpVerification): Promise<OtpVerification>;
  getOtpVerification(phone?: string, email?: string, purpose?: string): Promise<OtpVerification | undefined>;
  verifyOtp(phone: string | undefined, email: string | undefined, otp: string, purpose: string): Promise<boolean>;
  deleteExpiredOtps(): Promise<void>;

  // Partner assignments
  assignPartner(serviceRequestId: number, partnerId: number): Promise<PartnerAssignment>;
  getPartnerAssignments(partnerId: number): Promise<PartnerAssignment[]>;

  // Statistics for admin dashboard
  getTotalUsers(): Promise<number>;
  getActiveServices(): Promise<number>;
  getTotalProductOrders(): Promise<number>;
  getTotalRevenue(): Promise<number>;
  getRecentServices(limit: number): Promise<ServiceRequest[]>;
  getRecentOrders(limit: number): Promise<ProductOrder[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private serviceRequests: Map<number, ServiceRequest>;
  private productOrders: Map<number, ProductOrder>;
  private products: Map<number, Product>;
  private cartItems: Map<number, CartItem>;
  private invoices: Map<number, Invoice>;
  private otpVerifications: Map<number, OtpVerification>;
  private partnerAssignments: Map<number, PartnerAssignment>;
  private currentUserId: number;
  private currentServiceRequestId: number;
  private currentProductOrderId: number;
  private currentProductId: number;
  private currentCartItemId: number;
  private currentInvoiceId: number;
  private currentOtpId: number;
  private currentAssignmentId: number;

  constructor() {
    this.users = new Map();
    this.serviceRequests = new Map();
    this.productOrders = new Map();
    this.products = new Map();
    this.cartItems = new Map();
    this.invoices = new Map();
    this.otpVerifications = new Map();
    this.partnerAssignments = new Map();
    this.currentUserId = 1;
    this.currentServiceRequestId = 1;
    this.currentProductOrderId = 1;
    this.currentProductId = 1;
    this.currentCartItemId = 1;
    this.currentInvoiceId = 1;
    this.currentOtpId = 1;
    this.currentAssignmentId = 1;

    this.initializeData();
  }

  private initializeData() {
    // Initialize with some sample data for the admin dashboard
    // This would normally be empty in a real application
  }

  // User management
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.phone === phone);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = {
      ...insertUser,
      id,
      isVerified: false,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async getAllBusinessUsers(): Promise<User[]> {
    return Array.from(this.users.values()).filter(user => user.userType === 'business');
  }

  async getBusinessUsersByService(service: string): Promise<User[]> {
    return Array.from(this.users.values()).filter(
      user => user.userType === 'business' && user.services?.includes(service)
    );
  }

  // Service requests
  async createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest> {
    const id = this.currentServiceRequestId++;
    const serviceId = `SR${String(id).padStart(6, '0')}`;
    const serviceRequest: ServiceRequest = {
      ...request,
      id,
      serviceId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.serviceRequests.set(id, serviceRequest);
    return serviceRequest;
  }

  async getServiceRequest(id: number): Promise<ServiceRequest | undefined> {
    return this.serviceRequests.get(id);
  }

  async getServiceRequestByServiceId(serviceId: string): Promise<ServiceRequest | undefined> {
    return Array.from(this.serviceRequests.values()).find(req => req.serviceId === serviceId);
  }

  async getUserServiceRequests(userId: number): Promise<ServiceRequest[]> {
    return Array.from(this.serviceRequests.values()).filter(req => req.userId === userId);
  }

  async getPartnerServiceRequests(partnerId: number): Promise<ServiceRequest[]> {
    return Array.from(this.serviceRequests.values()).filter(req => req.partnerId === partnerId);
  }

  async updateServiceRequestStatus(id: number, status: string): Promise<ServiceRequest | undefined> {
    const request = this.serviceRequests.get(id);
    if (!request) return undefined;
    
    const updatedRequest = { ...request, status, updatedAt: new Date() };
    this.serviceRequests.set(id, updatedRequest);
    return updatedRequest;
  }

  async assignPartnerToService(serviceRequestId: number, partnerId: number): Promise<ServiceRequest | undefined> {
    const request = this.serviceRequests.get(serviceRequestId);
    if (!request) return undefined;
    
    const updatedRequest = { 
      ...request, 
      partnerId, 
      status: 'partner_assigned', 
      updatedAt: new Date() 
    };
    this.serviceRequests.set(serviceRequestId, updatedRequest);
    return updatedRequest;
  }

  async getPendingAssignments(): Promise<ServiceRequest[]> {
    return Array.from(this.serviceRequests.values()).filter(
      req => req.status === 'confirmed' && !req.partnerId
    );
  }

  async getAllServiceRequests(): Promise<ServiceRequest[]> {
    return Array.from(this.serviceRequests.values());
  }

  // Product orders
  async createProductOrder(order: InsertProductOrder): Promise<ProductOrder> {
    const id = this.currentProductOrderId++;
    const orderId = `ORD${String(id).padStart(4, '0')}`;
    const productOrder: ProductOrder = {
      ...order,
      id,
      orderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.productOrders.set(id, productOrder);
    return productOrder;
  }

  async getProductOrder(id: number): Promise<ProductOrder | undefined> {
    return this.productOrders.get(id);
  }

  async getUserProductOrders(userId: number): Promise<ProductOrder[]> {
    return Array.from(this.productOrders.values()).filter(order => order.userId === userId);
  }

  async updateProductOrderStatus(id: number, status: string): Promise<ProductOrder | undefined> {
    const order = this.productOrders.get(id);
    if (!order) return undefined;
    
    const updatedOrder = { ...order, status, updatedAt: new Date() };
    this.productOrders.set(id, updatedOrder);
    return updatedOrder;
  }

  async getAllProductOrders(): Promise<ProductOrder[]> {
    return Array.from(this.productOrders.values());
  }

  // Products
  async createProduct(product: InsertProduct): Promise<Product> {
    const id = this.currentProductId++;
    const newProduct: Product = {
      ...product,
      id,
      createdAt: new Date(),
    };
    this.products.set(id, newProduct);
    return newProduct;
  }

  async getProduct(id: number): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getAllProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter(product => product.category === category);
  }

  async updateProductStock(id: number, stock: number): Promise<Product | undefined> {
    const product = this.products.get(id);
    if (!product) return undefined;
    
    const updatedProduct = { ...product, stock };
    this.products.set(id, updatedProduct);
    return updatedProduct;
  }

  // Cart management
  async addToCart(item: InsertCartItem): Promise<CartItem> {
    const id = this.currentCartItemId++;
    const cartItem: CartItem = {
      ...item,
      id,
      createdAt: new Date(),
    };
    this.cartItems.set(id, cartItem);
    return cartItem;
  }

  async getCartItems(userId: number): Promise<CartItem[]> {
    return Array.from(this.cartItems.values()).filter(item => item.userId === userId);
  }

  async updateCartItemQuantity(id: number, quantity: number): Promise<CartItem | undefined> {
    const item = this.cartItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, quantity };
    this.cartItems.set(id, updatedItem);
    return updatedItem;
  }

  async removeFromCart(id: number): Promise<boolean> {
    return this.cartItems.delete(id);
  }

  async clearCart(userId: number): Promise<boolean> {
    const userItems = Array.from(this.cartItems.entries()).filter(([_, item]) => item.userId === userId);
    userItems.forEach(([id]) => this.cartItems.delete(id));
    return true;
  }

  // Invoices
  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const id = this.currentInvoiceId++;
    const invoiceId = `INV${String(id).padStart(6, '0')}`;
    const newInvoice: Invoice = {
      ...invoice,
      id,
      invoiceId,
      createdAt: new Date(),
    };
    this.invoices.set(id, newInvoice);
    return newInvoice;
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async getInvoiceByInvoiceId(invoiceId: string): Promise<Invoice | undefined> {
    return Array.from(this.invoices.values()).find(inv => inv.invoiceId === invoiceId);
  }

  async getUserInvoices(userId: number): Promise<Invoice[]> {
    return Array.from(this.invoices.values()).filter(inv => inv.userId === userId);
  }

  // OTP verification
  async createOtpVerification(otp: InsertOtpVerification): Promise<OtpVerification> {
    const id = this.currentOtpId++;
    const verification: OtpVerification = {
      ...otp,
      id,
      createdAt: new Date(),
    };
    this.otpVerifications.set(id, verification);
    return verification;
  }

  async getOtpVerification(phone?: string, email?: string, purpose?: string): Promise<OtpVerification | undefined> {
    return Array.from(this.otpVerifications.values()).find(otp => 
      (phone ? otp.phone === phone : true) && 
      (email ? otp.email === email : true) && 
      (purpose ? otp.purpose === purpose : true) &&
      !otp.isVerified &&
      otp.expiresAt > new Date()
    );
  }

  async verifyOtp(phone: string | undefined, email: string | undefined, otp: string, purpose: string): Promise<boolean> {
    const verification = Array.from(this.otpVerifications.values()).find(v => 
      (phone ? v.phone === phone : email ? v.email === email : false) &&
      v.otp === otp &&
      v.purpose === purpose &&
      !v.isVerified &&
      v.expiresAt > new Date()
    );
    
    if (verification) {
      verification.isVerified = true;
      return true;
    }
    return false;
  }

  async deleteExpiredOtps(): Promise<void> {
    const now = new Date();
    Array.from(this.otpVerifications.entries()).forEach(([id, otp]) => {
      if (otp.expiresAt <= now) {
        this.otpVerifications.delete(id);
      }
    });
  }

  // Partner assignments
  async assignPartner(serviceRequestId: number, partnerId: number): Promise<PartnerAssignment> {
    const id = this.currentAssignmentId++;
    const assignment: PartnerAssignment = {
      id,
      serviceRequestId,
      partnerId,
      assignedAt: new Date(),
      status: 'assigned',
    };
    this.partnerAssignments.set(id, assignment);
    return assignment;
  }

  async getPartnerAssignments(partnerId: number): Promise<PartnerAssignment[]> {
    return Array.from(this.partnerAssignments.values()).filter(a => a.partnerId === partnerId);
  }

  // Statistics for admin dashboard
  async getTotalUsers(): Promise<number> {
    return this.users.size;
  }

  async getActiveServices(): Promise<number> {
    return Array.from(this.serviceRequests.values()).filter(
      req => ['confirmed', 'partner_assigned', 'service_started'].includes(req.status)
    ).length;
  }

  async getTotalProductOrders(): Promise<number> {
    return this.productOrders.size;
  }

  async getTotalRevenue(): Promise<number> {
    const serviceRevenue = Array.from(this.serviceRequests.values())
      .reduce((sum, req) => sum + (req.totalAmount || req.bookingFee || 0), 0);
    const productRevenue = Array.from(this.productOrders.values())
      .reduce((sum, order) => sum + order.totalAmount, 0);
    return serviceRevenue + productRevenue;
  }

  async getRecentServices(limit: number): Promise<ServiceRequest[]> {
    return Array.from(this.serviceRequests.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getRecentOrders(limit: number): Promise<ProductOrder[]> {
    return Array.from(this.productOrders.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export const storage = new MemStorage();
