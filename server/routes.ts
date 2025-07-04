import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertUserSchema,
  insertServiceRequestSchema,
  insertProductOrderSchema,
  insertProductSchema,
  insertCartItemSchema,
  insertInvoiceSchema,
  insertOtpVerificationSchema
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Middleware to verify JWT
async function authenticateToken(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token' });
  }
}

// Helper function to validate Uttara Kannada pin codes
function isValidUttaraKannadaPinCode(pinCode: string): boolean {
  const uttaraKannadaPinCodes = [
    '581301', '581302', '581303', '581304', '581305', '581306', '581307', '581308', '581309', '581310',
    '581311', '581312', '581313', '581314', '581315', '581316', '581317', '581318', '581319', '581320',
    '581321', '581322', '581323', '581324', '581325', '581326', '581327', '581328', '581329', '581330',
    '581331', '581332', '581333', '581334', '581335', '581336', '581337', '581338', '581339', '581340',
    '581341', '581342', '581343', '581344', '581345', '581346', '581347', '581348', '581349', '581350',
    '581351', '581352', '581353', '581354', '581355', '581356', '581357', '581358', '581359', '581360'
  ];
  return uttaraKannadaPinCodes.includes(pinCode);
}

// Helper function to generate OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to generate 4-digit verification code
function generateVerificationCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Validate pin code
      if (!isValidUttaraKannadaPinCode(userData.pinCode)) {
        return res.status(400).json({ 
          message: "Currently, we are not serving in your area. We are expanding soon!" 
        });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email) || 
                          await storage.getUserByPhone(userData.phone) ||
                          await storage.getUserByUsername(userData.username);
      
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
      });

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, userType: user.userType },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({ 
        message: "User created successfully",
        user: { ...user, password: undefined },
        token 
      });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      const user = await storage.getUserByUsername(username) || 
                   await storage.getUserByEmail(username) ||
                   await storage.getUserByPhone(username);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { userId: user.id, userType: user.userType },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({ 
        message: "Login successful",
        user: { ...user, password: undefined },
        token 
      });
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  // OTP routes
  app.post("/api/otp/send", async (req, res) => {
    try {
      const { phone, email, purpose } = req.body;
      
      if (!phone && !email) {
        return res.status(400).json({ message: "Phone or email required" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await storage.createOtpVerification({
        phone,
        email,
        otp,
        purpose,
        expiresAt,
      });

      // In a real app, send OTP via SMS/Email service
      console.log(`OTP for ${phone || email}: ${otp}`);
      
      res.json({ message: "OTP sent successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/otp/verify", async (req, res) => {
    try {
      const { phone, email, otp, purpose } = req.body;
      
      const isValid = await storage.verifyOtp(phone, email, otp, purpose);
      
      if (isValid) {
        res.json({ message: "OTP verified successfully" });
      } else {
        res.status(400).json({ message: "Invalid or expired OTP" });
      }
    } catch (error) {
      res.status(500).json({ message: "OTP verification failed" });
    }
  });

  // Pin code validation
  app.post("/api/validate-pincode", (req, res) => {
    try {
      const { pinCode } = req.body;
      const isValid = isValidUttaraKannadaPinCode(pinCode);
      
      res.json({ 
        valid: isValid,
        message: isValid ? "Valid pin code" : "Currently, we are not serving in your area. We are expanding soon!"
      });
    } catch (error) {
      res.status(500).json({ message: "Validation failed" });
    }
  });

  // Service request routes
  app.post("/api/services", authenticateToken, async (req, res) => {
    try {
      const serviceData = insertServiceRequestSchema.parse(req.body);
      
      const serviceRequest = await storage.createServiceRequest({
        ...serviceData,
        userId: req.user.userId,
        verificationCode: generateVerificationCode(),
      });

      res.status(201).json(serviceRequest);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create service request" });
    }
  });

  app.get("/api/services", authenticateToken, async (req, res) => {
    try {
      const services = await storage.getUserServiceRequests(req.user.userId);
      res.json(services);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch services" });
    }
  });

  app.get("/api/services/:id", authenticateToken, async (req, res) => {
    try {
      const service = await storage.getServiceRequest(parseInt(req.params.id));
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch service" });
    }
  });

  app.patch("/api/services/:id/status", authenticateToken, async (req, res) => {
    try {
      const { status } = req.body;
      const service = await storage.updateServiceRequestStatus(parseInt(req.params.id), status);
      
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }
      
      res.json(service);
    } catch (error) {
      res.status(500).json({ message: "Failed to update service status" });
    }
  });

  // Product routes
  app.get("/api/products", async (req, res) => {
    try {
      const { category } = req.query;
      const products = category 
        ? await storage.getProductsByCategory(category as string)
        : await storage.getAllProducts();
      res.json(products);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(parseInt(req.params.id));
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch product" });
    }
  });

  // Cart routes
  app.post("/api/cart", authenticateToken, async (req, res) => {
    try {
      const cartData = insertCartItemSchema.parse(req.body);
      const cartItem = await storage.addToCart({
        ...cartData,
        userId: req.user.userId,
      });
      res.status(201).json(cartItem);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to add to cart" });
    }
  });

  app.get("/api/cart", authenticateToken, async (req, res) => {
    try {
      const cartItems = await storage.getCartItems(req.user.userId);
      res.json(cartItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cart items" });
    }
  });

  app.patch("/api/cart/:id", authenticateToken, async (req, res) => {
    try {
      const { quantity } = req.body;
      const cartItem = await storage.updateCartItemQuantity(parseInt(req.params.id), quantity);
      
      if (!cartItem) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      res.json(cartItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to update cart item" });
    }
  });

  app.delete("/api/cart/:id", authenticateToken, async (req, res) => {
    try {
      const success = await storage.removeFromCart(parseInt(req.params.id));
      
      if (!success) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      res.json({ message: "Item removed from cart" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove from cart" });
    }
  });

  // Product order routes
  app.post("/api/orders", authenticateToken, async (req, res) => {
    try {
      const orderData = insertProductOrderSchema.parse(req.body);
      const order = await storage.createProductOrder({
        ...orderData,
        userId: req.user.userId,
      });

      // Clear cart after successful order
      await storage.clearCart(req.user.userId);
      
      res.status(201).json(order);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create order" });
    }
  });

  app.get("/api/orders", authenticateToken, async (req, res) => {
    try {
      const orders = await storage.getUserProductOrders(req.user.userId);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Business user routes
  app.get("/api/business/services", authenticateToken, async (req, res) => {
    try {
      if (req.user.userType !== 'business') {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const services = await storage.getPartnerServiceRequests(req.user.userId);
      res.json(services);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch partner services" });
    }
  });

  app.get("/api/business/partners", async (req, res) => {
    try {
      const { service } = req.query;
      const partners = service 
        ? await storage.getBusinessUsersByService(service as string)
        : await storage.getAllBusinessUsers();
      
      // Remove sensitive information
      const sanitizedPartners = partners.map(partner => ({
        ...partner,
        password: undefined,
      }));
      
      res.json(sanitizedPartners);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch business partners" });
    }
  });

  // Admin routes (demo mode - no auth required for demonstration)
  app.get("/api/admin/stats", async (req, res) => {
    try {
      const stats = {
        totalUsers: await storage.getTotalUsers(),
        activeServices: await storage.getActiveServices(),
        productOrders: await storage.getTotalProductOrders(),
        revenue: await storage.getTotalRevenue(),
      };
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/admin/services/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const services = await storage.getRecentServices(limit);
      
      // Fetch user details for each service
      const servicesWithUsers = await Promise.all(
        services.map(async (service) => {
          const user = await storage.getUser(service.userId);
          return {
            ...service,
            user: user ? { id: user.id, username: user.username, phone: user.phone } : null,
          };
        })
      );
      
      res.json(servicesWithUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent services" });
    }
  });

  app.get("/api/admin/orders/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const orders = await storage.getRecentOrders(limit);
      
      // Fetch user details for each order
      const ordersWithUsers = await Promise.all(
        orders.map(async (order) => {
          const user = await storage.getUser(order.userId);
          return {
            ...order,
            user: user ? { id: user.id, username: user.username, phone: user.phone } : null,
          };
        })
      );
      
      res.json(ordersWithUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recent orders" });
    }
  });

  app.get("/api/admin/services/pending", async (req, res) => {
    try {
      const pendingServices = await storage.getPendingAssignments();
      
      // Fetch user details for each service
      const servicesWithUsers = await Promise.all(
        pendingServices.map(async (service) => {
          const user = await storage.getUser(service.userId);
          return {
            ...service,
            user: user ? { id: user.id, username: user.username, phone: user.phone, homeAddress: user.homeAddress } : null,
          };
        })
      );
      
      res.json(servicesWithUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pending assignments" });
    }
  });

  app.post("/api/admin/services/:id/assign", async (req, res) => {
    try {
      const { partnerId } = req.body;
      const serviceId = parseInt(req.params.id);
      
      const service = await storage.assignPartnerToService(serviceId, partnerId);
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }
      
      // Create partner assignment record
      await storage.assignPartner(serviceId, partnerId);
      
      res.json({ message: "Partner assigned successfully", service });
    } catch (error) {
      res.status(500).json({ message: "Failed to assign partner" });
    }
  });

  // Invoice routes
  app.post("/api/invoices", authenticateToken, async (req, res) => {
    try {
      const invoiceData = insertInvoiceSchema.parse(req.body);
      const invoice = await storage.createInvoice(invoiceData);
      res.status(201).json(invoice);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create invoice" });
    }
  });

  app.get("/api/invoices/:id", authenticateToken, async (req, res) => {
    try {
      const invoice = await storage.getInvoiceByInvoiceId(req.params.id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  // Admin routes for new pages
  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = [];
      const normalUsers = Array.from((storage as any).users.values());
      const businessUsers = await storage.getAllBusinessUsers();
      users.push(...normalUsers, ...businessUsers);
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/invoices", async (req, res) => {
    try {
      const allInvoices = Array.from((storage as any).invoices.values());
      res.json(allInvoices);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get("/api/admin/services", async (req, res) => {
    try {
      const allServices = await storage.getAllServiceRequests();
      // Enrich with user and partner details
      const enrichedServices = await Promise.all(allServices.map(async (service) => {
        const user = await storage.getUser(service.userId);
        const partner = service.partnerId ? await storage.getUser(service.partnerId) : null;
        return {
          ...service,
          user,
          partner
        };
      }));
      res.json(enrichedServices);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch all services" });
    }
  });

  app.get("/api/admin/orders", async (req, res) => {
    try {
      const allOrders = await storage.getAllProductOrders();
      // Enrich with user details
      const enrichedOrders = await Promise.all(allOrders.map(async (order) => {
        const user = await storage.getUser(order.userId);
        return {
          ...order,
          user
        };
      }));
      res.json(enrichedOrders);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch all orders" });
    }
  });

  // Location Management endpoints with in-memory storage
  const locationStorage = new Map([
    ["581301", { pinCode: "581301", area: "Sirsi", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581320", { pinCode: "581320", area: "Yellapur", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581343", { pinCode: "581343", area: "Kumta", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581355", { pinCode: "581355", area: "Karwar", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581313", { pinCode: "581313", area: "Dandeli", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581325", { pinCode: "581325", area: "Haliyal", district: "Uttara Kannada", state: "Karnataka", isActive: false }],
    ["581350", { pinCode: "581350", area: "Ankola", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
    ["581345", { pinCode: "581345", area: "Honnavar", district: "Uttara Kannada", state: "Karnataka", isActive: true }],
  ]);

  app.get("/api/admin/locations", async (req, res) => {
    try {
      const locations = Array.from(locationStorage.values());
      res.json(locations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.get("/api/admin/location-stats", async (req, res) => {
    try {
      const locations = Array.from(locationStorage.values());
      
      const stats = {
        totalLocations: locations.length,
        activeLocations: locations.filter(l => l.isActive).length,
        inactiveLocations: locations.filter(l => !l.isActive).length,
        districtsCovered: Array.from(new Set(locations.map(l => l.district))).length
      };
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch location stats" });
    }
  });

  app.post("/api/admin/locations", async (req, res) => {
    try {
      const locationData = req.body;
      
      // Validate if it's a valid Uttara Kannada pin code
      if (!isValidUttaraKannadaPinCode(locationData.pinCode)) {
        return res.status(400).json({ 
          message: "Pin code is not in Uttara Kannada region. Only Uttara Kannada pin codes are allowed." 
        });
      }
      
      // In a real app, save to database
      res.status(201).json({ 
        message: "Location added successfully",
        location: locationData 
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to add location" });
    }
  });

  app.patch("/api/admin/locations/:pinCode/toggle", async (req, res) => {
    try {
      const { pinCode } = req.params;
      
      const location = locationStorage.get(pinCode);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      
      // Toggle the active status
      location.isActive = !location.isActive;
      locationStorage.set(pinCode, location);
      
      res.json({ 
        message: `Location ${location.isActive ? 'activated' : 'deactivated'} successfully`,
        location
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update location status" });
    }
  });

  app.post("/api/utils/validate-pincode", (req, res) => {
    try {
      const { pinCode } = req.body;
      const isValid = isValidUttaraKannadaPinCode(pinCode);
      
      res.json({
        valid: isValid,
        message: isValid 
          ? "Pin code is valid and serviceable in Uttara Kannada region"
          : "Pin code is not in Uttara Kannada region or invalid format"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to validate pin code" });
    }
  });

  // Utility routes
  app.post("/api/utils/generate-code", (req, res) => {
    const code = generateVerificationCode();
    res.json({ code });
  });

  // Partner management endpoints
  app.post("/api/admin/partners/:partnerId/verify", async (req, res) => {
    try {
      const { partnerId } = req.params;
      const { comment } = req.body;
      
      const partner = await storage.updateUser(parseInt(partnerId), { 
        isVerified: true,
        verificationDate: new Date(),
        verificationComment: comment 
      });
      
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      
      res.json({ message: "Partner verified successfully", partner });
    } catch (error) {
      res.status(500).json({ message: "Failed to verify partner" });
    }
  });

  app.post("/api/admin/partners/:partnerId/suspend", async (req, res) => {
    try {
      const { partnerId } = req.params;
      const { comment, days } = req.body;
      
      const suspendUntil = new Date();
      suspendUntil.setDate(suspendUntil.getDate() + parseInt(days));
      
      const partner = await storage.updateUser(parseInt(partnerId), { 
        status: 'suspended',
        suspendedUntil: suspendUntil,
        suspensionReason: comment 
      });
      
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      
      res.json({ message: "Partner suspended successfully", partner });
    } catch (error) {
      res.status(500).json({ message: "Failed to suspend partner" });
    }
  });

  app.post("/api/admin/partners/:partnerId/deactivate", async (req, res) => {
    try {
      const { partnerId } = req.params;
      const { comment } = req.body;
      
      const partner = await storage.updateUser(parseInt(partnerId), { 
        status: 'deactivated',
        deactivationReason: comment,
        deactivatedAt: new Date()
      });
      
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      
      res.json({ message: "Partner deactivated successfully", partner });
    } catch (error) {
      res.status(500).json({ message: "Failed to deactivate partner" });
    }
  });

  app.post("/api/admin/partners/:partnerId/delete", async (req, res) => {
    try {
      const { partnerId } = req.params;
      const { comment } = req.body;
      
      // In a real app, you might want to soft delete or archive instead
      const partner = await storage.getUser(parseInt(partnerId));
      if (!partner) {
        return res.status(404).json({ message: "Partner not found" });
      }
      
      // For now, we'll mark as deleted rather than actually removing
      await storage.updateUser(parseInt(partnerId), { 
        status: 'deleted',
        deletionReason: comment,
        deletedAt: new Date()
      });
      
      res.json({ message: "Partner deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete partner" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
