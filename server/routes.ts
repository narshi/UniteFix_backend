import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertUserSchema,
  insertAdminUserSchema,
  insertServiceRequestSchema,
  insertProductOrderSchema,
  insertProductSchema,
  insertServiceProviderSchema,
  insertServiceablePincodeSchema,
  insertDistrictSchema
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
// PHASE 7: Import modular route registrations
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerPaymentRoutes } from "./routes/payment.routes";
import { registerProductRoutes } from "./routes/product.routes";
import { registerOtpRoutes } from "./routes/otp.routes";
import { registerClientFeatureRoutes } from "./routes/client-features.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { registerSocialAuthRoutes } from "./routes/auth-social.routes";
import { NotificationService } from "./services/notification.service";
import { registerNotificationRoutes } from "./routes/notification.routes";
import { authLimiter, adminLimiter, partnerLimiter, mobileLimiter, publicLimiter } from "./middleware/rate-limit";

const JWT_SECRET = process.env.JWT_SECRET || "unitefix-secret-key-2024";
const COMMISSION_RATE = 0.10; // 10% commission
const MAX_SERVICE_START_DISTANCE = 500; // meters (per business requirement)

// Haversine formula for geo-fencing
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Extended Request types
interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    role: string;
  };
}

// Global error handler middleware
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err.message);

  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: (err as any).errors
    });
  }

  if (err.message.includes('not found')) {
    return res.status(404).json({ success: false, message: err.message });
  }

  if (err.message.includes('unauthorized') || err.message.includes('Invalid')) {
    return res.status(401).json({ success: false, message: err.message });
  }

  if (err.message.includes('forbidden') || err.message.includes('too far')) {
    return res.status(403).json({ success: false, message: err.message });
  }

  res.status(500).json({ success: false, message: 'Internal server error' });
}

// JWT Authentication middleware
function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
}

// Admin authentication middleware
function authenticateAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.role !== 'admin' && decoded.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid admin token' });
  }
}

// Serviceman authentication middleware
function authenticateServiceman(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (decoded.role !== 'serviceman' && decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Serviceman access required' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
}

// Helper to generate OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to generate referral code
function generateReferralCode(): string {
  return `UF${Date.now().toString(36).toUpperCase()}`;
}

// Pagination helper
function paginate<T>(data: T[], page: number = 1, limit: number = 20): { data: T[]; pagination: { page: number; limit: number; total: number; pages: number } } {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  return {
    data: data.slice(offset, offset + limit),
    pagination: { page, limit, total, pages }
  };
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ==================== AUTHENTICATION ROUTES ====================

  // User Signup with referral code support
  app.post("/api/auth/signup", async (req, res, next) => {
    try {
      const userData = insertUserSchema.parse(req.body);

      // Check if pincode is serviceable
      const isServiceable = await storage.isPincodeServiceable(userData.pinCode || '');
      if (userData.pinCode && !isServiceable) {
        return res.status(400).json({
          success: false,
          message: "Service not available in your area. We are expanding soon!"
        });
      }

      // Check for existing user
      const existingUser = await storage.getUserByPhone(userData.phone);
      if (existingUser) {
        return res.status(400).json({ success: false, message: "Phone number already registered" });
      }

      // Handle referral code
      let referredById: number | undefined;
      if (req.body.referralCode) {
        const referrer = await storage.getUserByReferralCode(req.body.referralCode);
        if (referrer) {
          referredById = referrer.id;
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
        referredById,
      });

      const token = jwt.sign(
        { userId: user.id, role: user.role },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: { ...user, password: undefined },
        token
      });
    } catch (error) {
      next(error);
    }
  });

  // User Login
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const { phone, password } = req.body;

      const user = await storage.getUserByPhone(phone);
      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      const token = jwt.sign(
        { userId: user.id, role: user.role },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.json({
        success: true,
        message: "Login successful",
        user: { ...user, password: undefined },
        token
      });
    } catch (error) {
      next(error);
    }
  });

  // Admin Login
  app.post("/api/admin/auth/login", async (req, res, next) => {
    try {
      const { username, password } = req.body;

      const admin = await storage.getAdminByUsername(username) ||
        await storage.getAdminByEmail(username);

      if (!admin || !admin.isActive) {
        return res.status(401).json({ success: false, message: "Invalid admin credentials" });
      }

      const validPassword = await bcrypt.compare(password, admin.password);
      if (!validPassword) {
        return res.status(401).json({ success: false, message: "Invalid admin credentials" });
      }

      await storage.updateAdminUser(admin.id, { lastLogin: new Date() });

      const token = jwt.sign(
        { userId: admin.id, role: admin.role },
        JWT_SECRET,
        { expiresIn: '8h' }
      );

      res.json({
        success: true,
        message: "Admin login successful",
        admin: { ...admin, password: undefined },
        token
      });
    } catch (error) {
      next(error);
    }
  });

  // Admin Registration (for initial setup)
  app.post("/api/admin/auth/register", async (req, res, next) => {
    try {
      const adminData = insertAdminUserSchema.parse(req.body);

      const existingAdmin = await storage.getAdminByEmail(adminData.email) ||
        await storage.getAdminByUsername(adminData.username);

      if (existingAdmin) {
        return res.status(400).json({ success: false, message: "Admin already exists" });
      }

      const hashedPassword = await bcrypt.hash(adminData.password, 10);

      const admin = await storage.createAdminUser({
        ...adminData,
        password: hashedPassword,
      });

      res.status(201).json({
        success: true,
        message: "Admin created successfully",
        admin: { ...admin, password: undefined }
      });
    } catch (error) {
      next(error);
    }
  });

  // ==================== PASSWORD RESET FLOW ====================

  // Step 1: Request password reset — sends OTP to phone/email
  app.post("/api/auth/forgot-password", async (req, res, next) => {
    try {
      const { phone, email } = req.body;
      if (!phone && !email) {
        return res.status(400).json({ success: false, message: "Phone or email is required" });
      }

      // Verify user exists
      let user;
      if (phone) {
        user = await storage.getUserByPhone(phone);
      } else if (email) {
        user = await storage.getUserByEmail(email);
      }

      // Don't reveal if user exists (security best practice)
      if (!user) {
        return res.json({ success: true, message: "If the account exists, an OTP has been sent" });
      }

      // Generate 6-digit OTP
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP
      await storage.createOtpVerification({
        phone: phone || null,
        email: email || null,
        otp,
        purpose: 'password_reset',
        expiresAt,
      });

      // TODO: Send OTP via SMS/Email provider (Twilio/MSG91)
      // For now, log to console in dev mode
      console.log(`[PASSWORD RESET] OTP for ${phone || email}: ${otp}`);

      res.json({ success: true, message: "If the account exists, an OTP has been sent" });
    } catch (error) {
      next(error);
    }
  });

  // Step 2: Verify reset OTP — returns a short-lived reset token
  app.post("/api/auth/verify-reset-otp", async (req, res, next) => {
    try {
      const { phone, email, otp } = req.body;
      if (!otp || (!phone && !email)) {
        return res.status(400).json({ success: false, message: "OTP and phone/email are required" });
      }

      const isValid = await storage.verifyOtp(phone, email, otp, 'password_reset');
      if (!isValid) {
        return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      }

      // Find the user
      let user;
      if (phone) {
        user = await storage.getUserByPhone(phone);
      } else if (email) {
        user = await storage.getUserByEmail(email);
      }

      if (!user) {
        return res.status(400).json({ success: false, message: "User not found" });
      }

      // Generate a short-lived reset token (5 minutes)
      const resetToken = jwt.sign(
        { userId: user.id, purpose: 'password_reset' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );

      res.json({ success: true, message: "OTP verified", resetToken });
    } catch (error) {
      next(error);
    }
  });

  // Step 3: Reset password using the reset token
  app.post("/api/auth/reset-password", async (req, res, next) => {
    try {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || !newPassword) {
        return res.status(400).json({ success: false, message: "Reset token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      }

      // Verify the reset token
      let decoded: any;
      try {
        decoded = jwt.verify(resetToken, JWT_SECRET);
      } catch (err) {
        return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
      }

      if (decoded.purpose !== 'password_reset') {
        return res.status(400).json({ success: false, message: "Invalid reset token" });
      }

      // Hash and update password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(decoded.userId, { password: hashedPassword });

      res.json({ success: true, message: "Password reset successfully. Please login with your new password." });
    } catch (error) {
      next(error);
    }
  });

  // ==================== ADMIN DASHBOARD ROUTES ====================

  // Dashboard Statistics (Optimized SQL aggregations)
  app.get("/api/admin/stats", async (req, res, next) => {
    try {
      const stats = await storage.getAdminStats();
      res.json({ success: true, data: stats });
    } catch (error) {
      next(error);
    }
  });

  // Revenue chart data
  app.get("/api/admin/revenue/chart", async (req, res, next) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const revenueData = await storage.getRevenueByPeriod(days);
      res.json({ success: true, data: revenueData });
    } catch (error) {
      next(error);
    }
  });

  // Get all users with pagination
  app.get("/api/admin/users", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const allUsers = await storage.getAllUsers();
      const result = paginate(allUsers, page, limit);

      res.json({
        success: true,
        data: result.data.map(u => ({ ...u, password: undefined })),
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  });

  // Update user status (activate/deactivate)
  app.patch("/api/admin/users/:id/status", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body;
      const user = await storage.updateUser(id, { isActive });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  });

  // ==================== SERVICE PROVIDER MANAGEMENT ====================

  // Get all service providers with filtering
  app.get("/api/admin/servicemen/list", async (req, res, next) => {
    try {
      const { status, page = '1', limit = '20' } = req.query;

      let providers;
      if (status === 'pending') {
        providers = await storage.getPendingServiceProviders();
      } else if (status === 'verified') {
        providers = await storage.getVerifiedServiceProviders();
      } else if (status === 'suspended') {
        providers = await storage.getAllServiceProviders().then(ps => ps.filter(p => p.verificationStatus === 'suspended'));
      } else {
        providers = await storage.getAllServiceProviders();
      }

      const result = paginate(providers, parseInt(page as string), parseInt(limit as string));
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  // Get partners sorted by distance from a location
  app.get("/api/admin/servicemen/nearby", async (req, res, next) => {
    try {
      const { lat, long, status } = req.query;

      if (!lat || !long) {
        return res.status(400).json({ success: false, message: "Latitude and longitude required" });
      }

      const providers = await storage.getProvidersSortedByDistance(
        parseFloat(lat as string),
        parseFloat(long as string),
        status as string
      );

      res.json({
        success: true,
        data: providers.map(p => ({
          ...p,
          distanceKm: (p.distance / 1000).toFixed(2)
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  // Create new service provider
  app.post("/api/admin/servicemen/create", async (req, res, next) => {
    try {
      const { partnerName, email, phone, password, partnerType, services, location, address } = req.body;

      // 1. Create the user account first
      const hashedPassword = await bcrypt.hash(password || 'Temp123!', 10);
      const user = await storage.createUser({
        username: partnerName,
        email,
        phone,
        password: hashedPassword,
        role: 'serviceman',
        isVerified: true,
        isActive: true,
        pinCode: location,
        homeAddress: address
      });

      // 2. Create the provider profile
      const provider = await storage.createServiceProvider({
        userId: user.id,
        partnerName,
        partnerType: partnerType || 'Individual',
        services: services || [],
        location,
        address,
        verificationStatus: 'verified',
        isActive: true,
        walletBalance: '0.00'
      });

      res.status(201).json({ success: true, data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Approve/Verify service provider
  app.post("/api/admin/servicemen/:id/approve", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.updateServiceProvider(id, {
        verificationStatus: 'verified',
        isActive: true
      });

      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      res.json({ success: true, message: "Provider approved", data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Suspend service provider
  app.post("/api/admin/servicemen/:id/suspend", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { reason } = req.body;

      const provider = await storage.updateServiceProvider(id, {
        verificationStatus: 'suspended',
        isActive: false
      });

      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      res.json({ success: true, message: "Provider suspended", data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Top up provider wallet
  app.post("/api/admin/servicemen/:id/topup", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { amount, description } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Invalid amount" });
      }

      const transaction = await storage.topUpProviderWallet(id, amount, description || 'Admin top-up');
      res.json({ success: true, message: "Wallet topped up", data: transaction });
    } catch (error) {
      next(error);
    }
  });

  // Get provider wallet transactions
  app.get("/api/admin/servicemen/:id/transactions", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const transactions = await storage.getProviderWalletTransactions(id);
      res.json({ success: true, data: transactions });
    } catch (error) {
      next(error);
    }
  });

  // Business partners endpoints (backward compatibility)
  app.get("/api/business/partners", async (req, res, next) => {
    try {
      const providers = await storage.getAllServiceProviders();
      res.json(providers);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners", async (req, res, next) => {
    try {
      const providerData = insertServiceProviderSchema.parse(req.body);
      const provider = await storage.createServiceProvider({
        ...providerData,
        verificationStatus: 'verified'
      });
      res.status(201).json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/business/partners/pending", async (req, res, next) => {
    try {
      const providers = await storage.getPendingServiceProviders();
      res.json(providers);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/business/partners/:id", async (req, res, next) => {
    try {
      const provider = await storage.getServiceProvider(parseInt(req.params.id));
      if (!provider) {
        return res.status(404).json({ message: "Partner not found" });
      }
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/business/partners/:id", async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), req.body);
      if (!provider) {
        return res.status(404).json({ message: "Partner not found" });
      }
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/business/partners/:id", async (req, res, next) => {
    try {
      await storage.deleteServiceProvider(parseInt(req.params.id));
      res.json({ message: "Partner deleted" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/verify", async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), {
        verificationStatus: 'verified'
      });
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/suspend", async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), {
        verificationStatus: 'suspended',
        isActive: false
      });
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/deactivate", async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), {
        isActive: false
      });
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  // ==================== SERVICE REQUEST MANAGEMENT ====================

  // Get all service requests (admin) with pagination
  app.get("/api/admin/services", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;

      let services = await storage.getAllServiceRequests();

      if (status) {
        services = services.filter(s => s.status === status);
      }

      const result = paginate(services, page, limit);
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  // Get recent services
  app.get("/api/admin/services/recent", async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const services = await storage.getRecentServices(limit);
      res.json(services);
    } catch (error) {
      next(error);
    }
  });

  // Get pending assignments
  app.get("/api/admin/services/pending", async (req, res, next) => {
    try {
      const services = await storage.getPendingAssignments();
      res.json(services);
    } catch (error) {
      next(error);
    }
  });

  // Assign provider to service request
  app.post("/api/admin/requests/assign", async (req, res, next) => {
    try {
      const { request_id, provider_id } = req.body;

      if (!request_id || !provider_id) {
        return res.status(400).json({ success: false, message: "request_id and provider_id required" });
      }

      const service = await storage.assignProviderToService(request_id, provider_id);

      if (!service) {
        return res.status(404).json({ success: false, message: "Service request not found" });
      }

      res.json({ success: true, message: "Provider assigned successfully", data: service });
    } catch (error) {
      next(error);
    }
  });

  // Update service status
  app.patch("/api/admin/services/:id/status", async (req, res, next) => {
    try {
      const { status } = req.body;
      const service = await storage.updateServiceRequestStatus(parseInt(req.params.id), status);

      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      res.json({ success: true, data: service });
    } catch (error) {
      next(error);
    }
  });

  // Assign partner (backward compatibility)
  app.post("/api/admin/services/:id/assign", async (req, res, next) => {
    try {
      const { partnerId } = req.body;
      const service = await storage.assignProviderToService(parseInt(req.params.id), partnerId);

      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }

      res.json(service);
    } catch (error) {
      next(error);
    }
  });

  // ==================== UTILS ====================

  app.post("/api/utils/validate-pincode", async (req, res, next) => {
    try {
      const { pinCode } = req.body;
      if (!pinCode) {
        return res.status(400).json({ success: false, message: "Pin code required" });
      }

      const isServiceable = await storage.isPincodeServiceable(pinCode);
      const pincodeDetails = await storage.getServiceablePincode(pinCode);

      if (isServiceable && pincodeDetails) {
        res.json({
          success: true,
          valid: true,
          message: `Service available in ${pincodeDetails.area}, ${pincodeDetails.district}`,
          data: pincodeDetails
        });
      } else {
        res.json({
          success: true,
          valid: false,
          message: "Service not available in this area yet"
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // ==================== SERVICEMAN APP ROUTES ====================

  // Update serviceman location (lightweight)
  app.post("/api/serviceman/location/update", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { lat, long } = req.body;

      if (!lat || !long) {
        return res.status(400).json({ success: false, message: "Latitude and longitude required" });
      }

      const provider = await storage.getServiceProviderByUserId(req.user!.userId);
      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider profile not found" });
      }

      await storage.updateProviderLocation(provider.id, lat, long);
      res.json({ success: true, message: "Location updated" });
    } catch (error) {
      next(error);
    }
  });

  // Get serviceman assignments
  app.get("/api/serviceman/assignments", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = await storage.getServiceProviderByUserId(req.user!.userId);
      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider profile not found" });
      }

      const assignments = await storage.getProviderServiceRequests(provider.id);
      res.json({ success: true, data: assignments });
    } catch (error) {
      next(error);
    }
  });

  // Verify handshake OTP
  app.post("/api/service/verify-handshake", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { serviceId, otp } = req.body;

      const service = await storage.getServiceRequest(parseInt(serviceId));
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.handshakeOtp !== otp) {
        return res.status(400).json({ success: false, message: "Invalid OTP" });
      }

      res.json({ success: true, message: "OTP verified successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Start service with geo-fencing
  app.post("/api/service/start", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { serviceId, providerLat, providerLong } = req.body;

      const service = await storage.getServiceRequest(parseInt(serviceId));
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      // Geo-fencing check
      if (service.locationLat && service.locationLong) {
        const distance = calculateDistance(
          providerLat,
          providerLong,
          service.locationLat,
          service.locationLong
        );

        if (distance > MAX_SERVICE_START_DISTANCE) {
          return res.status(403).json({
            success: false,
            message: `You are too far from the location to start the service. Distance: ${Math.round(distance)}m (max: ${MAX_SERVICE_START_DISTANCE}m)`
          });
        }
      }

      const updatedService = await storage.updateServiceRequest(parseInt(serviceId), {
        status: 'in_progress',
        startedAt: new Date()
      });

      res.json({ success: true, message: "Service started", data: updatedService });
    } catch (error) {
      next(error);
    }
  });

  // Complete service with ACID transaction
  app.post("/api/service/complete", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { serviceId, totalAmount } = req.body;

      if (!serviceId || !totalAmount) {
        return res.status(400).json({ success: false, message: "serviceId and totalAmount required" });
      }

      const result = await storage.completeServiceWithTransaction(
        parseInt(serviceId),
        totalAmount,
        COMMISSION_RATE
      );

      res.json({
        success: true,
        message: "Service completed successfully",
        data: {
          service: result.service,
          commission: result.transaction
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ==================== USER APP ROUTES ====================

  // Create service request
  app.post("/api/services/create", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const serviceData = insertServiceRequestSchema.parse({
        ...req.body,
        userId: req.user!.userId
      });

      const service = await storage.createServiceRequest(serviceData);
      res.status(201).json({ success: true, data: service });
    } catch (error) {
      next(error);
    }
  });

  // Get user's service requests
  app.get("/api/services/my-requests", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const services = await storage.getUserServiceRequests(req.user!.userId);
      res.json({ success: true, data: services });
    } catch (error) {
      next(error);
    }
  });

  // Cancel service (before partner assignment only)
  app.post("/api/services/:id/cancel", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const service = await storage.getServiceRequest(parseInt(req.params.id));

      if (!service || service.userId !== req.user!.userId) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (!['placed', 'confirmed'].includes(service.status)) {
        return res.status(400).json({
          success: false,
          message: "Cannot cancel after partner assignment. Please contact support."
        });
      }

      const updated = await storage.updateServiceRequestStatus(service.id, 'cancelled');
      res.json({ success: true, message: "Service cancelled", data: updated });
    } catch (error) {
      next(error);
    }
  });

  // ==================== PRODUCTS & ORDERS ====================

  // Get products with pagination
  app.get("/api/products/list", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const category = req.query.category as string;

      let products;
      if (category) {
        products = await storage.getProductsByCategory(category);
      } else {
        products = await storage.getAllProducts();
      }

      const result = paginate(products, page, limit);
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  // Get all orders (admin)
  app.get("/api/admin/orders", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const orders = await storage.getAllProductOrders();
      const result = paginate(orders, page, limit);
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  // Get recent orders
  app.get("/api/admin/orders/recent", async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const orders = await storage.getRecentOrders(limit);
      res.json(orders);
    } catch (error) {
      next(error);
    }
  });

  // Update order status
  app.patch("/api/admin/orders/:id/status", async (req, res, next) => {
    try {
      const { status } = req.body;
      const order = await storage.updateProductOrderStatus(parseInt(req.params.id), status);

      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }

      res.json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  });

  // Place order
  app.post("/api/orders/place", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { products, address, deliveryLat, deliveryLong } = req.body;

      // Calculate total
      let totalAmount = 0;
      for (const item of products) {
        const product = await storage.getProduct(item.productId);
        if (product) {
          totalAmount += product.price * item.quantity;
        }
      }

      const order = await storage.createProductOrder({
        userId: req.user!.userId,
        products,
        totalAmount,
        address,
        deliveryLat,
        deliveryLong
      });

      // Clear cart
      await storage.clearCart(req.user!.userId);

      res.status(201).json({ success: true, data: order });
    } catch (error) {
      next(error);
    }
  });

  // Cart endpoints
  app.get("/api/cart", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const items = await storage.getCartItems(req.user!.userId);
      res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/cart/add", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { productId, quantity } = req.body;
      const item = await storage.addToCart({
        userId: req.user!.userId,
        productId,
        quantity: quantity || 1
      });
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cart/:id", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      await storage.removeFromCart(parseInt(req.params.id));
      res.json({ success: true, message: "Item removed" });
    } catch (error) {
      next(error);
    }
  });

  // ==================== INVOICES ====================

  app.get("/api/admin/invoices/all", async (req, res, next) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const invoices = await storage.getAllInvoices();
      const result = paginate(invoices, page, limit);
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/invoices", async (req, res, next) => {
    try {
      const invoices = await storage.getAllInvoices();
      res.json(invoices);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/invoices/:id", async (req, res, next) => {
    try {
      const invoice = await storage.getInvoice(parseInt(req.params.id));
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error) {
      next(error);
    }
  });

  // ==================== PINCODES MANAGEMENT ====================

  app.get("/api/admin/pincodes", async (req, res, next) => {
    try {
      const pincodes = await storage.getAllServiceablePincodes();
      res.json({ success: true, data: pincodes });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/pincodes", async (req, res, next) => {
    try {
      const pincodeData = insertServiceablePincodeSchema.parse(req.body);
      const pincode = await storage.createServiceablePincode(pincodeData);
      res.status(201).json({ success: true, data: pincode });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/pincodes/toggle", async (req, res, next) => {
    try {
      const { pincode } = req.body;
      const result = await storage.togglePincodeStatus(pincode);

      if (!result) {
        return res.status(404).json({ success: false, message: "Pincode not found" });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  // Validate pincode
  app.post("/api/validate-pincode", async (req, res, next) => {
    try {
      const { pinCode } = req.body;
      const isServiceable = await storage.isPincodeServiceable(pinCode);

      res.json({
        success: true,
        valid: isServiceable,
        message: isServiceable ? "Valid pin code" : "Service not available in your area"
      });
    } catch (error) {
      next(error);
    }
  });

  // ==================== DISTRICT ROUTES ====================

  app.get("/api/admin/districts", async (req, res, next) => {
    try {
      const districts = await storage.getAllDistricts();
      res.json(districts);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/districts", async (req, res, next) => {
    try {
      const data = insertDistrictSchema.parse(req.body);
      const district = await storage.createDistrict(data);
      res.status(201).json(district);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/districts/:id/toggle", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { isActive } = req.body;
      const result = await storage.toggleDistrictStatus(id, isActive);
      if (!result) {
        return res.status(404).json({ message: "District not found" });
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Backward compatibility for locations
  app.get("/api/admin/locations", async (req, res, next) => {
    try {
      const pincodes = await storage.getAllServiceablePincodes();
      res.json(pincodes);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/locations/:pinCode/toggle", async (req, res, next) => {
    try {
      const { isActive } = req.body;
      // togglePincodeStatus now accepts optional explicit status
      const result = await storage.togglePincodeStatus(req.params.pinCode, isActive);
      if (!result) {
        return res.status(404).json({ message: "Pincode not found" });
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Create new location (serviceable pincode)
  app.post("/api/admin/locations", async (req, res, next) => {
    try {
      const data = insertServiceablePincodeSchema.parse(req.body);

      // Check if already exists
      const existing = await storage.getServiceablePincode(data.pincode);
      if (existing) {
        return res.status(409).json({ message: "Pincode already exists" });
      }

      const location = await storage.createServiceablePincode(data);
      res.status(201).json(location);
    } catch (error) {
      next(error);
    }
  });

  // Get location statistics
  app.get("/api/admin/location-stats", async (req, res, next) => {
    try {
      const pincodes = await storage.getAllServiceablePincodes();

      const totalLocations = pincodes.length;
      const activeLocations = pincodes.filter(p => p.isActive).length;
      const inactiveLocations = totalLocations - activeLocations;

      // Count unique districts
      const districts = new Set(pincodes.map(p => p.district));
      const districtsCovered = districts.size;

      res.json({
        totalLocations,
        activeLocations,
        inactiveLocations,
        districtsCovered
      });
    } catch (error) {
      next(error);
    }
  });

  // ==================== OTP ROUTES ====================

  app.post("/api/otp/send", async (req, res, next) => {
    try {
      const { phone, email, purpose } = req.body;

      if (!phone && !email) {
        return res.status(400).json({ success: false, message: "Phone or email required" });
      }

      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await storage.createOtpVerification({
        phone,
        email,
        otp,
        purpose,
        expiresAt,
      });

      const message = `Your UniteFix verification code is: ${otp}. Do not share this code with anyone.`;

      if (phone) {
        // Send SMS
        await NotificationService.sendSms(phone, message);
      }

      if (email) {
        // Send Email
        await NotificationService.sendEmail(
          email,
          "UniteFix Verification Code",
          `<p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>`
        );
      }

      // For simulator/testing purposes, return the OTP
      res.json({ success: true, message: "OTP sent successfully", otp });
    } catch (error) {
      next(error);
    }
  });

  // Utility route for generating verification codes
  app.post("/api/utils/generate-code", (req, res) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    res.json({ success: true, code });
  });

  app.post("/api/otp/verify", async (req, res, next) => {
    try {
      const { phone, email, otp, purpose } = req.body;

      const isValid = await storage.verifyOtp(phone, email, otp, purpose);

      if (isValid) {
        res.json({ success: true, message: "OTP verified successfully" });
      } else {
        res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      }
    } catch (error) {
      next(error);
    }
  });

  // ==================== PARTNER ACCEPT/DENY ====================
  // Critical: These are the #1 missing feature from Figma designs

  // Partner accepts an assigned service request
  app.post("/api/serviceman/requests/:id/accept", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const serviceId = parseInt(req.params.id);
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      // Verify the provider is assigned to this service
      const provider = await storage.getServiceProviderByUserId(userId);
      if (!provider) return res.status(404).json({ success: false, message: "Provider not found" });

      const service = await storage.getServiceRequest(serviceId);
      if (!service) return res.status(404).json({ success: false, message: "Service not found" });
      if (service.providerId !== provider.id) {
        return res.status(403).json({ success: false, message: "This service is not assigned to you" });
      }

      // Use state machine: ASSIGNED → ACCEPTED
      const { BookingState } = await import("./business/booking-state-machine");
      const updated = await storage.transitionBookingState(
        serviceId,
        BookingState.ACCEPTED,
        userId,
        { action: 'partner_accepted' }
      );

      res.json({ success: true, message: "Service accepted successfully", service: updated });
    } catch (error) {
      next(error);
    }
  });

  // Partner denies an assigned service request (back to pool)
  app.post("/api/serviceman/requests/:id/deny", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const serviceId = parseInt(req.params.id);
      const userId = req.user?.userId;
      const { reason } = req.body;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

      const provider = await storage.getServiceProviderByUserId(userId);
      if (!provider) return res.status(404).json({ success: false, message: "Provider not found" });

      const service = await storage.getServiceRequest(serviceId);
      if (!service) return res.status(404).json({ success: false, message: "Service not found" });
      if (service.providerId !== provider.id) {
        return res.status(403).json({ success: false, message: "This service is not assigned to you" });
      }

      // Reset to CREATED and unassign provider (back to pool)
      const updated = await storage.updateServiceRequest(serviceId, {
        status: 'created',
        providerId: null as any,
        assignedAt: null as any,
      });

      // Log the denial in audit
      await storage.logAuditEvent({
        entityType: 'service_request',
        entityId: serviceId,
        action: 'partner_denied',
        fromState: 'assigned',
        toState: 'created',
        changedBy: userId,
        metadata: { reason, providerId: provider.id, partnerName: provider.partnerName },
      });

      res.json({ success: true, message: "Service denied. It will be reassigned.", service: updated });
    } catch (error) {
      next(error);
    }
  });

  // ==================== REGISTER MODULAR ROUTES ====================
  // These were previously dead code — now properly connected
  // ==================== RATE LIMITING ====================
  // Essential security layer (Post-Launch Task #6)
  app.use("/api/auth", authLimiter);
  app.use("/api/otp", authLimiter); // Protect OTP generation strongly
  app.use("/api/admin/auth", authLimiter); // Admin login protection

  app.use("/api/admin", adminLimiter);
  app.use("/api/serviceman", partnerLimiter);
  app.use("/api/partner", partnerLimiter); // Wallet/Earnings APIs
  app.use("/api/business", partnerLimiter); // Partner onboarding

  app.use("/api/client", mobileLimiter);
  app.use("/api/services", mobileLimiter); // Service creation
  app.use("/api/products", mobileLimiter); // Product listing
  app.use("/api/orders", mobileLimiter);   // Order placement
  app.use("/api/cart", mobileLimiter);     // Cart management

  // Public/Default
  app.use("/api/public", publicLimiter);

  // ==================== ROUTE REGISTRATION ====================
  registerAdminRoutes(app);
  registerPaymentRoutes(app);
  registerProductRoutes(app);
  registerOtpRoutes(app);
  registerClientFeatureRoutes(app);
  registerInventoryRoutes(app);
  registerSocialAuthRoutes(app);
  registerNotificationRoutes(app);

  // Apply error handler (must be LAST)
  app.use(errorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
