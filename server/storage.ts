import {
  users,
  adminUsers,
  serviceRequests,
  productOrders,
  products,
  cartItems,
  invoices,
  otpVerifications,
  partnerAssignments,
  type User,
  type InsertUser,
  type AdminUser,
  type InsertAdminUser,
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

  // Admin management
  getAdminUser(id: number): Promise<AdminUser | undefined>;
  getAdminByUsername(username: string): Promise<AdminUser | undefined>;
  getAdminByEmail(email: string): Promise<AdminUser | undefined>;
  createAdminUser(admin: InsertAdminUser): Promise<AdminUser>;
  updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined>;

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
  private adminUsers: Map<number, AdminUser>;
  private serviceRequests: Map<number, ServiceRequest>;
  private productOrders: Map<number, ProductOrder>;
  private products: Map<number, Product>;
  private cartItems: Map<number, CartItem>;
  private invoices: Map<number, Invoice>;
  private otpVerifications: Map<number, OtpVerification>;
  private partnerAssignments: Map<number, PartnerAssignment>;
  private currentUserId: number;
  private currentAdminId: number;
  private currentServiceRequestId: number;
  private currentProductOrderId: number;
  private currentProductId: number;
  private currentCartItemId: number;
  private currentInvoiceId: number;
  private currentOtpId: number;
  private currentAssignmentId: number;

  constructor() {
    this.users = new Map();
    this.adminUsers = new Map();
    this.serviceRequests = new Map();
    this.productOrders = new Map();
    this.products = new Map();
    this.cartItems = new Map();
    this.invoices = new Map();
    this.otpVerifications = new Map();
    this.partnerAssignments = new Map();
    this.currentUserId = 1;
    this.currentAdminId = 1;
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
    // Initialize with admin user
    const adminUser: AdminUser = {
      id: this.currentAdminId++,
      username: "admin",
      email: "admin@unitefix.com",
      password: "$2b$10$5rSIzBDIJX424CjiFON2h.g5bnV.h/w2mAwif31pIHRjS89QVvbzm", // hashed password for "admin123"
      role: "admin",
      isActive: true,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.adminUsers.set(adminUser.id, adminUser);

    // Initialize with some sample data for demonstration
    const sampleUsers = [
      {
        username: "john_doe",
        email: "john@example.com",
        phone: "9876543210",
        password: "$2b$10$hash", // hashed password
        userType: "normal" as const,
        homeAddress: "123 Main St, Sirsi",
        pinCode: "581301",
        isVerified: true,
        status: "active" as const,
        businessType: null,
        services: null,
        suspendedUntil: null,
        suspensionReason: null,
        deactivationReason: null,
        deletionReason: null,
        verificationDate: new Date(),
        verificationComment: null,
        deactivatedAt: null,
        deletedAt: null,
      },
      {
        username: "repair_expert",
        email: "expert@repair.com",
        phone: "9876543211",
        password: "$2b$10$hash",
        userType: "business" as const,
        homeAddress: "456 Service St, Kumta",
        pinCode: "581343",
        businessType: "individual" as const,
        services: ["AC Repair", "Washing Machine", "Refrigerator"],
        isVerified: true,
        status: "active" as const,
        suspendedUntil: null,
        suspensionReason: null,
        deactivationReason: null,
        deletionReason: null,
        verificationDate: new Date(),
        verificationComment: "Verified business partner",
        deactivatedAt: null,
        deletedAt: null,
      },
      {
        username: "fix_solutions",
        email: "contact@fixsolutions.com",
        phone: "9876543212",
        password: "$2b$10$hash",
        userType: "business" as const,
        homeAddress: "789 Business Park, Karwar",
        pinCode: "581301",
        businessType: "business" as const,
        services: ["Electronics", "Home Appliances", "Plumbing"],
        isVerified: true,
        status: "active" as const,
        suspendedUntil: null,
        suspensionReason: null,
        deactivationReason: null,
        deletionReason: null,
        verificationDate: new Date(),
        verificationComment: "Verified business solutions provider",
        deactivatedAt: null,
        deletedAt: null,
      }
    ];

    sampleUsers.forEach(userData => {
      const user: User = {
        ...userData,
        id: this.currentUserId++,
        createdAt: new Date(),
      };
      this.users.set(user.id, user);
    });

    // Sample service requests
    const sampleServices = [
      {
        userId: 1,
        serviceType: "AC Repair",
        brand: "LG",
        model: "LSA3AU3D",
        description: "AC not cooling properly, making strange noise",
        photos: [],
        status: "confirmed",
        bookingFee: 250,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        userId: 1,
        serviceType: "Washing Machine",
        brand: "Samsung",
        model: "WA70H4200SW",
        description: "Washing machine not draining water",
        photos: [],
        status: "partner_assigned",
        partnerId: 2,
        bookingFee: 250,
        totalAmount: 850,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        userId: 1,
        serviceType: "Refrigerator",
        brand: "Whirlpool",
        model: "NEO DF278",
        description: "Refrigerator not cooling, weird sounds from compressor",
        photos: [],
        status: "service_started",
        partnerId: 3,
        bookingFee: 250,
        totalAmount: 1200,
        address: "123 Main St, Sirsi, Karnataka",
      }
    ];

    sampleServices.forEach(serviceData => {
      const service: ServiceRequest = {
        ...serviceData,
        id: this.currentServiceRequestId++,
        serviceId: `SR${String(this.currentServiceRequestId - 1).padStart(6, '0')}`,
        verificationCode: Math.floor(1000 + Math.random() * 9000).toString(),
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        photos: serviceData.photos || null,
        brand: serviceData.brand || null,
        model: serviceData.model || null,
        partnerId: serviceData.partnerId || null,
        totalAmount: serviceData.totalAmount || null,
      };
      this.serviceRequests.set(service.id, service);
    });

    // Sample products with proper categories
    const sampleProducts = [
      {
        name: "Universal AC Remote",
        description: "Compatible with all major AC brands",
        price: 299,
        category: "AC",
        stock: 50,
        images: [],
      },
      {
        name: "Washing Machine Drain Pump",
        description: "High quality replacement drain pump",
        price: 1200,
        category: "Washing Machine",
        stock: 25,
        images: [],
      },
      {
        name: "Refrigerator Thermostat",
        description: "Digital thermostat for modern refrigerators",
        price: 850,
        category: "Refrigerator",
        stock: 30,
        images: [],
      },
      {
        name: "Dell Inspiron 15",
        description: "High-performance laptop for business use",
        price: 45000,
        category: "Laptop",
        stock: 15,
        images: [],
      },
      {
        name: "Electric Water Heater 15L",
        description: "Energy efficient water heater with auto-cut feature",
        price: 8500,
        category: "Water Heater",
        stock: 12,
        images: [],
      },
      {
        name: "Samsung 43inch Smart TV",
        description: "4K Ultra HD Smart LED Television",
        price: 32000,
        category: "Television",
        stock: 8,
        images: [],
      },
      {
        name: "iPhone 14",
        description: "Latest smartphone with advanced features",
        price: 65000,
        category: "Mobile Phone",
        stock: 20,
        images: [],
      },
      {
        name: "iPad Air",
        description: "Lightweight tablet for productivity and entertainment",
        price: 55000,
        category: "Tablet",
        stock: 10,
        images: [],
      }
    ];

    sampleProducts.forEach(productData => {
      const product: Product = {
        ...productData,
        id: this.currentProductId++,
        createdAt: new Date(),
        description: productData.description || null,
        stock: productData.stock || null,
        images: productData.images || null,
      };
      this.products.set(product.id, product);
    });

    // Sample product orders with categorized products
    const sampleOrders = [
      {
        userId: 1,
        products: [
          { productId: 1, name: "Universal AC Remote", category: "AC", quantity: 2, price: 299 },
          { productId: 3, name: "Refrigerator Thermostat", category: "Refrigerator", quantity: 1, price: 850 }
        ],
        status: "delivered",
        totalAmount: 1448,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        userId: 1,
        products: [
          { productId: 4, name: "Dell Inspiron 15", category: "Laptop", quantity: 1, price: 45000 }
        ],
        status: "in_transit",
        totalAmount: 45000,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        userId: 2,
        products: [
          { productId: 5, name: "Electric Water Heater 15L", category: "Water Heater", quantity: 1, price: 8500 },
          { productId: 2, name: "Washing Machine Drain Pump", category: "Washing Machine", quantity: 2, price: 1200 }
        ],
        status: "confirmed",
        totalAmount: 10900,
        address: "456 Service St, Kumta, Karnataka",
      },
      {
        userId: 1,
        products: [
          { productId: 7, name: "iPhone 14", category: "Mobile Phone", quantity: 1, price: 65000 }
        ],
        status: "placed",
        totalAmount: 65000,
        address: "123 Main St, Sirsi, Karnataka",
      },
      {
        userId: 2,
        products: [
          { productId: 6, name: "Samsung 43inch Smart TV", category: "Television", quantity: 1, price: 32000 },
          { productId: 8, name: "iPad Air", category: "Tablet", quantity: 1, price: 55000 }
        ],
        status: "out_for_delivery",
        totalAmount: 87000,
        address: "456 Service St, Kumta, Karnataka",
      }
    ];

    sampleOrders.forEach(orderData => {
      const order: ProductOrder = {
        ...orderData,
        id: this.currentProductOrderId++,
        orderId: `ORD${String(this.currentProductOrderId - 1).padStart(4, '0')}`,
        createdAt: new Date(Date.now() - Math.random() * 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        products: orderData.products as any,
      };
      this.productOrders.set(order.id, order);
    });
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
      isVerified: insertUser.isVerified ?? false,
      status: insertUser.status ?? "active",
      suspendedUntil: null,
      suspensionReason: null,
      deactivationReason: null,
      deletionReason: null,
      verificationDate: null,
      verificationComment: null,
      deactivatedAt: null,
      deletedAt: null,
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

  // Admin management
  async getAdminUser(id: number): Promise<AdminUser | undefined> {
    return this.adminUsers.get(id);
  }

  async getAdminByUsername(username: string): Promise<AdminUser | undefined> {
    return Array.from(this.adminUsers.values()).find(admin => admin.username === username);
  }

  async getAdminByEmail(email: string): Promise<AdminUser | undefined> {
    return Array.from(this.adminUsers.values()).find(admin => admin.email === email);
  }

  async createAdminUser(insertAdmin: InsertAdminUser): Promise<AdminUser> {
    const id = this.currentAdminId++;
    const admin: AdminUser = {
      ...insertAdmin,
      id,
      isActive: insertAdmin.isActive ?? true,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.adminUsers.set(id, admin);
    return admin;
  }

  async updateAdminUser(id: number, updates: Partial<AdminUser>): Promise<AdminUser | undefined> {
    const admin = this.adminUsers.get(id);
    if (!admin) return undefined;
    
    const updatedAdmin = { ...admin, ...updates, updatedAt: new Date() };
    this.adminUsers.set(id, updatedAdmin);
    return updatedAdmin;
  }

  // Service requests
  async createServiceRequest(request: InsertServiceRequest): Promise<ServiceRequest> {
    const id = this.currentServiceRequestId++;
    const serviceId = `SR${String(id).padStart(6, '0')}`;
    const serviceRequest: ServiceRequest = {
      ...request,
      id,
      serviceId,
      status: request.status ?? "placed",
      partnerId: request.partnerId ?? null,
      brand: request.brand ?? null,
      model: request.model ?? null,
      photos: request.photos ?? null,
      totalAmount: request.totalAmount ?? null,
      verificationCode: request.verificationCode ?? null,
      bookingFee: request.bookingFee ?? 250,
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
      status: order.status ?? "placed",
      products: order.products as any,
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
      quantity: item.quantity ?? 1,
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
      partnerId: invoice.partnerId ?? null,
      serviceRequestId: invoice.serviceRequestId ?? null,
      productOrderId: invoice.productOrderId ?? null,
      discount: invoice.discount ?? null,
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
      phone: otp.phone ?? null,
      email: otp.email ?? null,
      isVerified: otp.isVerified ?? false,
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
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  async getRecentOrders(limit: number): Promise<ProductOrder[]> {
    return Array.from(this.productOrders.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }
}

export const storage = new MemStorage();
