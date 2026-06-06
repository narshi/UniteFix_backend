import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  insertUserSchema,
  insertAdminUserSchema,
  insertServiceRequestSchema,
  insertProductOrderSchema,
  insertProductSchema,
  insertEmployeeSchema,
  insertServiceablePincodeSchema,
  insertDistrictSchema,
  otpVerifications,
  serviceRequests,
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { TokenService } from "./services/token.service";
import logger from "./lib/logger";
import { parsePaginationParams, buildPaginatedResult, getOffset } from "./lib/pagination";
// PHASE 7: Import modular route registrations
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerPaymentRoutes } from "./routes/payment.routes";
import { registerProductRoutes } from "./routes/product.routes";
// PHASE 0: OTP routes removed — auth OTP replaced by Truecaller SDK v3
// import { registerOtpRoutes } from "./routes/otp.routes";
import { registerClientFeatureRoutes } from "./routes/client-features.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { ConfigService } from "./services/config.service";

const configService = new ConfigService();

import { NotificationService } from "./services/notification.service";
import { registerNotificationRoutes } from "./routes/notification.routes";
import { registerReturnRoutes } from "./routes/return.routes";
import { registerCatalogRoutes } from "./routes/catalog.routes";
import { registerTruecallerAuthRoutes } from "./routes/auth-truecaller.routes";
import { registerGeofenceRoutes } from "./routes/geofence.routes";
import { registerBillingRoutes } from "./routes/billing.routes";
import { registerAdminVerificationRoutes } from "./routes/admin-verification.routes";
import { registerAdminWithdrawalRoutes } from "./routes/admin-withdrawals.routes";
import { registerUploadRoutes } from "./routes/upload.routes";
import { authLimiter, adminLimiter, partnerLimiter, mobileLimiter, publicLimiter } from "./middleware/rate-limit";
import { BillingEngine } from "./services/billing-engine";
import { PaymentTrackingService } from "./services/payment-tracking.service";
import { PaymentService } from "./services/payment.service";
import { db } from "./db";
import { eq } from "drizzle-orm";


if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.JWT_SECRET;
// PHASE 5: COMMISSION_RATE removed — billing now uses 15% UniteFix fee from config
const MAX_SERVICE_START_DISTANCE = 200; // PHASE 4: Updated to 200m (was 500m)

// Geo-fencing: use shared utility
import { calculateHaversineDistance as calculateDistance } from "./lib/geo";

// Import canonical auth middleware (single source of truth)
import { authenticateToken, authenticateAdmin as _authenticateAdmin, authenticatePartner } from "./middleware/auth.middleware";

// Extended Request type for backward compatibility
interface AuthenticatedRequest extends Request {
  user?: any;
}

// Global error handler middleware
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Route error', { message: err.message, name: err.name });

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

// Admin authentication wrapper — adds isAdmin flag for backward compat
function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  _authenticateAdmin(req, res, (err?: any) => {
    if (err) return next(err);
    // Add backward-compat user object with isAdmin flag
    const admin = (req as any).admin;
    if (admin) {
      (req as any).user = { ...admin, isAdmin: true };
    }
    next();
  });
}

// Serviceman authentication — delegates to authenticatePartner
function authenticateServiceman(req: Request, res: Response, next: NextFunction) {
  authenticatePartner(req, res, (err?: any) => {
    if (err) return next(err);
    // Backward compat: ensure req.user is set
    const partner = (req as any).partner;
    if (partner && !(req as any).user) {
      (req as any).user = { userId: partner.userId, role: partner.role };
    }
    next();
  });
}

// Helper to generate OTP
function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
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

  // ==================== API VERSIONING REWRITE ====================
  // Rewrite /api/v1/... requests to /api/... globally before any route handlers execute.
  // This prevents versioning dead-ends for mobile clients.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.url.startsWith('/api/v1/')) {
      req.url = req.url.replace('/api/v1/', '/api/');
    } else if (req.url === '/api/v1') {
      req.url = '/api';
    }
    next();
  });

  // ==================== AUTHENTICATION ROUTES ====================

  // Apply Admin Authentication Middleware (skipping login/register)
  // This must be registered BEFORE any admin routes
  app.use("/api/admin", (req, res, next) => {
    if (req.path.startsWith("/auth")) return next();
    authenticateAdmin(req, res, next);
  });

  registerInventoryRoutes(app);
  
  // Register Truecaller Auth Routes (SDK 3.x)
  registerTruecallerAuthRoutes(app);

  // ==================== 3-STEP SIGNUP FLOW (Email OTP) ====================

  // Step 1: Initiate signup — sends OTP to email
  app.post("/api/auth/signup/initiate", authLimiter, async (req, res, next) => {
    try {
      const { email, role } = req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!normalizedEmail) {
        return res.status(400).json({ success: false, message: "Email is required" });
      }

      // Validate role — only 'user' or 'serviceman' are allowed
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';

      // Check if email is already registered
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ success: false, message: "Email is already registered. Please login instead." });
      }

      // Generate 6-digit OTP
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      // Store OTP
      await storage.createOtpVerification({
        email: normalizedEmail,
        phone: null,
        otp,
        purpose: 'signup',
        expiresAt,
      });

      // Send OTP via email
      await NotificationService.sendEmail(
        normalizedEmail,
        "UniteFix — Verify Your Email",
        `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #1a1a2e; text-align: center;">Welcome to UniteFix!</h2>
          <p style="color: #555; text-align: center;">Use the code below to verify your email address:</p>
          <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 13px; text-align: center;">This code expires in 15 minutes. If you didn't request this, please ignore this email.</p>
        </div>`
      );

      logger.info(`[SIGNUP] OTP sent to ${normalizedEmail} (role: ${userRole})`);

      res.json({
        success: true,
        message: "Verification code sent to your email",
      });
    } catch (error) {
      next(error);
    }
  });

  // Step 2: Verify signup OTP — returns a short-lived signupToken with role embedded
  app.post("/api/auth/signup/verify", authLimiter, async (req, res, next) => {
    try {
      const { email, otp, role } = req.body;
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

      if (!normalizedEmail || !otp) {
        return res.status(400).json({ success: false, message: "Email and OTP are required" });
      }

      const isValid = await storage.verifyOtp(undefined, normalizedEmail, otp, 'signup');
      if (!isValid) {
        return res.status(400).json({ success: false, message: "Invalid or expired verification code" });
      }

      // Embed role in the token so it cannot be tampered with in subsequent steps
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';
      const signupToken = jwt.sign(
        { email: normalizedEmail, role: userRole, purpose: 'signup' },
        JWT_SECRET,
        { expiresIn: '15m' }
      );

      res.json({
        success: true,
        message: "Email verified successfully",
        signupToken,
      });
    } catch (error) {
      next(error);
    }
  });

  // Step 3: Complete signup — create user using the signupToken
  app.post("/api/auth/signup/complete", async (req, res, next) => {
    try {
      const { signupToken, password, username, phone } = req.body;

      if (!signupToken || !password) {
        return res.status(400).json({ success: false, message: "Signup token and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
      }

      // Verify the signup token — role is read from the JWT, NOT from req.body
      let decoded: any;
      try {
        decoded = jwt.verify(signupToken, JWT_SECRET);
      } catch (err) {
        return res.status(400).json({ success: false, message: "Invalid or expired signup session. Please start over." });
      }

      if (decoded.purpose !== 'signup') {
        return res.status(400).json({ success: false, message: "Invalid signup token" });
      }

      const email = decoded.email;
      // Role was cryptographically bound at OTP-verify step — safe to trust
      const userRole: 'user' | 'serviceman' = decoded.role === 'serviceman' ? 'serviceman' : 'user';

      // Double-check email isn't taken (race condition guard)
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ success: false, message: "Email is already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user — role field is the single source of truth
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        username: username || email.split('@')[0],
        phone: phone || null,
        role: userRole,
        isVerified: true, // Email already verified via OTP
        isActive: true,
      });

      // Create role-specific profile record (DB segregation)
      if (userRole === 'serviceman') {
        // PHASE 1: All partner data now on employees table (serviceProviders deleted)
        await storage.createEmployee({
          userId: user.id,
          fullName: username || email.split('@')[0],
          partnerType: 'Individual',
          services: [],
          isActive: false,  // Admin must verify
          isOnline: false,
        });

        logger.info(`[SIGNUP] Employee profile created for user ${user.id}`);
      } else {
        await storage.createCustomer({
          userId: user.id,
          fullName: username || email.split('@')[0],
        });
        logger.info(`[SIGNUP] Customer profile created for user ${user.id}`);
      }

      // Generate token pair (access + refresh) for mobile apps
      const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });
      const token = TokenService.generateLegacyToken({ userId: user.id, role: user.role });

      logger.info(`[SIGNUP] User created: ${email} (ID: ${user.id})`);

      res.status(201).json({
        success: true,
        message: "Account created successfully",
        user: { ...user, password: undefined },
        token,
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  });

  // User Signup with referral code support (legacy — kept for backward compatibility)
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
      if (!userData.phone) {
        return res.status(400).json({ success: false, message: "Phone number is required for registration" });
      }
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
      const hashedPassword = await bcrypt.hash(userData.password || '', 10);

      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
        referredById,
      });

      // Generate token pair (access + refresh) for mobile apps
      const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });
      // Backward-compatible legacy token
      const token = TokenService.generateLegacyToken({ userId: user.id, role: user.role });

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: { ...user, password: undefined },
        token,
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  });

  // User Login
  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const { phone, email, password } = req.body;

      // Input validation
      if (!phone && !email) {
        return res.status(400).json({ success: false, message: "Phone number or email is required" });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: "Password is required" });
      }

      let user;
      if (phone) {
        user = await storage.getUserByPhone(phone);
      } else if (email) {
        user = await storage.getUserByEmail(email);
      }

      if (!user) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      if (!user.password) {
        return res.status(401).json({ success: false, message: "This account uses Truecaller login. Please use the Truecaller option." });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Generate token pair (access + refresh) for mobile apps
      const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });
      // Backward-compatible legacy token
      const token = TokenService.generateLegacyToken({ userId: user.id, role: user.role });

      res.json({
        success: true,
        message: "Login successful",
        user: { ...user, password: undefined },
        token,
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  });

  // Token Refresh — used by mobile app when access token expires
  app.post("/api/auth/refresh", async (req, res, next) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({ success: false, message: "Refresh token is required" });
      }

      const tokens = await TokenService.refreshTokens(refreshToken);
      if (!tokens) {
        return res.status(401).json({ success: false, message: "Invalid or expired refresh token. Please login again." });
      }

      res.json({
        success: true,
        message: "Tokens refreshed",
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  });

  // Logout — revoke all refresh tokens for user
  app.post("/api/auth/logout", authenticateToken, async (req: any, res, next) => {
    try {
      const userId = req.user?.userId;
      if (userId) {
        await TokenService.revokeUserTokens(userId);
      }
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Admin Login — rate-limited: 5 attempts per 15 min
  app.post("/api/admin/auth/login", authLimiter, async (req, res, next) => {
    try {
      const { username, password } = req.body;

      if (!username || typeof username !== 'string') {
        return res.status(400).json({ success: false, message: "Username is required" });
      }
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ success: false, message: "Password is required" });
      }

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

  // Admin Registration — PROTECTED: requires super_admin JWT
  // 401 if no/invalid token, 403 if role !== 'super_admin'
  app.post("/api/admin/auth/register", authenticateAdmin, async (req, res, next) => {
    try {
      // Only super_admin may create new admin accounts
      const requestingAdmin = (req as any).admin as { userId: number; role: string; username: string } | undefined;
      if (!requestingAdmin) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }
      if (requestingAdmin.role !== "super_admin") {
        return res.status(403).json({
          success: false,
          message: "Forbidden: only super_admin accounts may create new administrators",
        });
      }

      const adminData = insertAdminUserSchema.parse(req.body);

      const existingAdmin =
        (await storage.getAdminByEmail(adminData.email)) ||
        (await storage.getAdminByUsername(adminData.username));

      if (existingAdmin) {
        return res.status(400).json({ success: false, message: "Admin already exists" });
      }

      const hashedPassword = await bcrypt.hash(adminData.password, 10);

      const admin = await storage.createAdminUser({
        ...adminData,
        password: hashedPassword,
      });

      logger.info(`[ADMIN_REG] New admin '${admin.username}' created by super_admin '${requestingAdmin.username}'`);

      res.status(201).json({
        success: true,
        message: "Admin created successfully",
        admin: { ...admin, password: undefined },
      });
    } catch (error) {
      next(error);
    }
  });


  // ==================== PASSWORD RESET FLOW ====================

  // Step 1: Request password reset — sends OTP to phone/email
  app.post("/api/auth/forgot-password", authLimiter, async (req, res, next) => {
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

      // Send OTP via Email if email is provided
      if (email) {
        await NotificationService.sendEmail(
          email,
          "UniteFix Password Reset",
          `<h1>Password Reset</h1><p>Your OTP for password reset is: <strong>${otp}</strong></p><p>This OTP will expire in 10 minutes.</p>`
        );
      } else {
        // Fallback for phone (log to console as before)
        console.log(`[PASSWORD RESET] OTP for ${phone}: ${otp}`);
      }

      res.json({ success: true, message: "If the account exists, an OTP has been sent" });
    } catch (error) {
      next(error);
    }
  });

  // Step 2: Verify reset OTP — returns a short-lived reset token
  app.post("/api/auth/verify-reset-otp", authLimiter, async (req, res, next) => {
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

  // Get all CUSTOMER users (role='user' only — servicemen are in Partners section)
  app.get("/api/admin/users", async (req, res, next) => {
    try {
      const { page, limit } = parsePaginationParams(req.query);
      const offset = getOffset({ page, limit });

      // Only show customers (role='user') — servicemen are managed in /api/admin/servicemen
      const total = await storage.countUsers({ role: 'user' });
      const pageData = await storage.getAllUsers(limit, offset, 'user');

      const result = buildPaginatedResult(
        pageData.map(u => ({ ...u, password: undefined })),
        total,
        { page, limit }
      );

      res.json({ success: true, ...result });
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

  // Get all service providers with filtering and DB-level pagination
  // Get all service providers with filtering and DB-level pagination
  app.get("/api/admin/servicemen/list", async (req, res, next) => {
    try {
      const { status } = req.query;
      const { page, limit } = parsePaginationParams(req.query);
      const offset = getOffset({ page, limit });

      let providers;
      let total: number;
      if (status === 'pending') {
        providers = await storage.getPendingServiceProviders(limit, offset);
        total = await storage.countServiceProviders('pending');
      } else if (status === 'verified') {
        providers = await storage.getVerifiedServiceProviders(limit, offset);
        total = await storage.countServiceProviders('verified');
      } else if (status === 'suspended') {
        providers = await storage.getAllServiceProviders(limit, offset);
        providers = providers.filter(p => p.documentVerificationStatus === 'suspended');
        total = await storage.countServiceProviders('suspended');
      } else {
        providers = await storage.getAllServiceProviders(limit, offset);
        total = await storage.countServiceProviders();
      }

      // Enrich with user contact info (email, phone) for admin display
      // PHASE 1: Map unified employees columns → admin dashboard field names
      const enriched = await Promise.all(
        providers.map(async (p) => {
          const user = await storage.getUser(p.userId);
          return {
            ...p,
            // Field aliases for admin dashboard backward compat
            partnerName: p.fullName || user?.username || 'Unknown',
            verificationStatus: p.documentVerificationStatus || 'pending',
            email: user?.email || '',
            phone: user?.phone || '',
            location: '', // No longer stored as simple text
            services: p.services || [],
          };
        })
      );

      const result = buildPaginatedResult(enriched, total, { page, limit });
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
        fullName: partnerName,
        partnerType: partnerType || 'Individual',
        services: services || [],
        documentVerificationStatus: 'verified',
        isActive: true,
        walletBalance: '0.00'
      });

      res.status(201).json({ success: true, data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Update service provider details
  app.patch("/api/admin/servicemen/:id", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const provider = await storage.updateServiceProvider(id, updates);

      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      res.json({ success: true, message: "Provider updated", data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Approve/Verify service provider
  app.post("/api/admin/servicemen/:id/approve", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const provider = await storage.updateServiceProvider(id, {
        documentVerificationStatus: 'verified',
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
        documentVerificationStatus: 'suspended',
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

  // Activate (Unsuspend) service provider
  app.post("/api/admin/servicemen/:id/activate", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);

      const provider = await storage.updateServiceProvider(id, {
        documentVerificationStatus: 'verified', // Restore to verified
        isActive: true
      });

      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      res.json({ success: true, message: "Provider activated", data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Delete service provider
  app.delete("/api/admin/servicemen/:id", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteServiceProvider(id);
      res.json({ success: true, message: "Provider deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Top up provider wallet
  app.post("/api/admin/servicemen/:id/topup", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);

      const provider = await storage.getServiceProvider(id);
      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      if (provider.documentVerificationStatus === 'suspended') {
        return res.status(403).json({ success: false, message: "Cannot top up suspended provider wallet" });
      }

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

  // Deduct from provider wallet
  app.post("/api/admin/servicemen/:id/deduct", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);

      const provider = await storage.getServiceProvider(id);
      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      const { amount, description } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: "Invalid amount" });
      }

      if (!description) {
        return res.status(400).json({ success: false, message: "Reason is required for deduction" });
      }

      try {
        const transaction = await storage.deductProviderWallet(id, amount, description);
        res.json({ success: true, message: "Wallet deducted", data: transaction });
      } catch (err: any) {
        // Handle insufficient balance or other errors
        return res.status(400).json({ success: false, message: err.message });
      }
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
  app.get("/api/business/partners", authenticateAdmin, async (req, res, next) => {
    try {
      const providers = await storage.getAllServiceProviders();
      // PHASE 1: Map employees columns → legacy partner field names
      const mapped = await Promise.all(
        providers.map(async (p) => {
          const user = await storage.getUser(p.userId);
          return {
            ...p,
            partnerName: p.fullName || user?.username || 'Unknown',
            verificationStatus: p.documentVerificationStatus || 'pending',
            email: user?.email || '',
            phone: user?.phone || '',
            services: p.services || [],
          };
        })
      );
      res.json(mapped);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners", authenticateAdmin, async (req, res, next) => {
    try {
      const providerData = insertEmployeeSchema.parse(req.body);
      const provider = await storage.createServiceProvider({
        ...providerData,
        documentVerificationStatus: 'verified'
      });
      res.status(201).json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/business/partners/pending", authenticateAdmin, async (req, res, next) => {
    try {
      const providers = await storage.getPendingServiceProviders();
      res.json(providers);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/business/partners/:id", authenticateAdmin, async (req, res, next) => {
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

  app.put("/api/business/partners/:id", authenticateAdmin, async (req, res, next) => {
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

  app.delete("/api/business/partners/:id", authenticateAdmin, async (req, res, next) => {
    try {
      await storage.deleteServiceProvider(parseInt(req.params.id));
      res.json({ message: "Partner deleted" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/verify", authenticateAdmin, async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), {
        documentVerificationStatus: 'verified'
      });
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/suspend", authenticateAdmin, async (req, res, next) => {
    try {
      const provider = await storage.updateServiceProvider(parseInt(req.params.id), {
        documentVerificationStatus: 'suspended',
        isActive: false
      });
      res.json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/business/partners/:id/deactivate", authenticateAdmin, async (req, res, next) => {
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

  // Get serviceman assignments (with optional pagination + status filter)
  app.get("/api/serviceman/assignments", authenticateServiceman, async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = await storage.getServiceProviderByUserId(req.user!.userId);
      if (!provider) {
        return res.status(404).json({ success: false, message: "Provider profile not found" });
      }

      const statusFilter = req.query.status as 'active' | 'past' | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);

      // If pagination params are provided, use paginated method
      if (statusFilter || req.query.page || req.query.limit) {
        const result = await storage.getProviderServiceRequestsPaginated(
          provider.id,
          statusFilter || 'all',
          page,
          limit,
        );
        const totalPages = Math.ceil(result.total / limit);
        return res.json({
          success: true,
          data: result.data,
          pagination: {
            page,
            limit,
            total: result.total,
            pages: totalPages,
            hasMore: page < totalPages,
          },
        });
      }

      // Backwards compat: no query params → return all
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

      const isStringId = typeof serviceId === 'string' && isNaN(Number(serviceId));
      const service = isStringId 
        ? await storage.getServiceRequestByServiceId(serviceId)
        : await storage.getServiceRequest(parseInt(serviceId as string));
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

      const isStringId = typeof serviceId === 'string' && isNaN(Number(serviceId));
      const service = isStringId 
        ? await storage.getServiceRequestByServiceId(serviceId)
        : await storage.getServiceRequest(parseInt(serviceId as string));
      if (!service) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      // Geo-fencing check
      if (service.customerLocation) {
        const match = service.customerLocation.match(/POINT\(([\d.-]+) ([\d.-]+)\)/);
        if (match) {
          const custLng = parseFloat(match[1]);
          const custLat = parseFloat(match[2]);
          
          if (providerLat === undefined || providerLong === undefined) {
             return res.status(400).json({ success: false, message: "Provider location is required to verify arrival distance." });
          }

          const distance = calculateDistance(
            providerLat,
            providerLong,
            custLat,
            custLng
          );

          if (distance > MAX_SERVICE_START_DISTANCE) {
            return res.status(403).json({
              success: false,
              message: `You are too far from the location to start the service. Distance: ${Math.round(distance)}m (max: ${MAX_SERVICE_START_DISTANCE}m)`
            });
          }
        }
      }

      const targetId = isStringId ? service.id : parseInt(serviceId as string);
      const updatedService = await storage.updateServiceRequest(targetId, {
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
      const { serviceId } = req.body;
      let { totalAmount } = req.body;

      if (!serviceId) {
        return res.status(400).json({ success: false, message: "serviceId required" });
      }

      const isStringId = typeof serviceId === 'string' && isNaN(Number(serviceId));
      let targetId = isStringId ? null : parseInt(serviceId as string);
      
      let service;
      if (isStringId) {
        service = await storage.getServiceRequestByServiceId(serviceId);
        if (!service) return res.status(404).json({ success: false, message: "Service not found" });
        targetId = service.id;
      } else {
        const [found] = await db.select().from(serviceRequests).where(eq(serviceRequests.id, targetId!));
        service = found;
        if (!service) return res.status(404).json({ success: false, message: "Service not found" });
      }

      if (service.status === 'completed') {
        return res.json({ success: true, message: "Service is already completed" });
      }
      if (service.status === 'pending_payment') {
        return res.status(409).json({ success: false, message: "Cannot mark complete directly. Please collect cash or wait for customer payment." });
      }

      // If totalAmount wasn't provided, use the BillingEngine's frozen pricingSnapshot
      if (!totalAmount) {
        const snapshot = service.pricingSnapshot as any;
        if (!snapshot || !snapshot.subtotal) {
            return res.status(400).json({ success: false, message: "Service charges must be submitted before completion" });
        }
        totalAmount = snapshot.subtotal; // Subtotal (parts+labor) used for commission math
      }

      const result = await storage.completeServiceWithTransaction(
        targetId!,
        totalAmount,
        0.15 // PHASE 5: 15% UniteFix fee (was COMMISSION_RATE=0.10)
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

  // Create service request with booking charge (₹99 default, dynamic from config)
  app.post("/api/services/create", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const serviceData = insertServiceRequestSchema.parse({
        ...req.body,
        userId: req.user!.userId
      });

      // BILLING ENGINE: Freeze current pricing config into a snapshot
      const pricingSnapshot = await BillingEngine.createBookingSnapshot();

      const service = await storage.createServiceRequest({
        ...serviceData,
        bookingFee: pricingSnapshot.bookingFee,
        bookingFeeStatus: pricingSnapshot.bookingFee === 0 ? 'paid' : 'pending',
      });

      // Write the frozen snapshot to the service_requests row
      await db.update(serviceRequests)
        .set({ pricingSnapshot: pricingSnapshot as any })
        .where(eq(serviceRequests.id, service.id));

      // Attempt to create Razorpay booking charge order using frozen fee
      let paymentInfo = null;
      if (pricingSnapshot.bookingFee > 0) {
        try {
          const keyId = process.env.RAZORPAY_KEY_ID;
          const keySecret = process.env.RAZORPAY_KEY_SECRET;

          if (keyId && keySecret) {
            const Razorpay = (await import('razorpay')).default;
            const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

            const amountInPaise = pricingSnapshot.bookingFee * 100;

            const order = await razorpay.orders.create({
              amount: amountInPaise,
              currency: 'INR',
              receipt: `booking_${service.id}_${Date.now()}`,
              notes: {
                service_request_id: service.id.toString(),
                customer_id: req.user!.userId.toString(),
                payment_type: 'booking_charge',
              },
            });

            paymentInfo = {
              razorpayOrderId: order.id,
              razorpayKeyId: keyId,
              amount: pricingSnapshot.bookingFee,
              currency: 'INR',
            };

            // Record booking payment in payment_transactions via Drizzle ORM
            await PaymentTrackingService.recordPaymentEvent({
              serviceRequestId: service.id,
              razorpayOrderId: order.id,
              amount: amountInPaise, // stored as paise
              currency: 'INR',
              eventType: 'order_created',
              status: 'pending',
              metadata: { paymentType: 'booking_charge', customerId: req.user!.userId },
            });

            logger.info(`[BOOKING] Razorpay order ${order.id} created for service ${service.id}, amount: ₹${pricingSnapshot.bookingFee}`);
          }
        } catch (payError: any) {
          logger.warn(`[BOOKING] Razorpay order creation skipped: ${payError.message}`);
          // Don't block booking — proceed without payment for dev/testing
        }
      } else {
        logger.info(`[BOOKING] Free booking created for service ${service.id}.`);
      }

      res.status(201).json({
        success: true,
        data: service,
        payment: paymentInfo,
      });
    } catch (error) {
      next(error);
    }
  });

  // Get user's service requests (with optional pagination + status filter)
  app.get("/api/services/my-requests", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const statusFilter = req.query.status as 'active' | 'past' | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 15, 50); // Cap at 50

      // If pagination params are provided, use the paginated method
      if (statusFilter || req.query.page || req.query.limit) {
        const result = await storage.getUserServiceRequestsPaginated(
          req.user!.userId,
          statusFilter || 'all',
          page,
          limit,
        );
        const totalPages = Math.ceil(result.total / limit);
        return res.json({
          success: true,
          data: result.data,
          pagination: {
            page,
            limit,
            total: result.total,
            pages: totalPages,
            hasMore: page < totalPages,
          },
        });
      }

      // Backwards compat: no query params → return all (legacy behavior)
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

      const isAdmin = req.user!.role === 'admin';

      if (!service || (service.userId !== req.user!.userId && !isAdmin)) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      // Allow cancellation only from 'created' state for users. Admins can cancel anytime before completion.
      const cancellableStates = ['created'];
      if (!isAdmin && !cancellableStates.includes(service.status)) {
        return res.status(400).json({
          success: false,
          message: "Cannot cancel after technician has been assigned. Please contact support.",
          data: {
            whatsappLink: `https://wa.me/${process.env.WHATSAPP_BUSINESS_NUMBER || '919999999999'}?text=${encodeURIComponent(`Booking #${service.id}: I need to cancel`)}`,
          },
        });
      }

      if (isAdmin && service.status === 'completed') {
        return res.status(400).json({ success: false, message: "Cannot cancel a completed service." });
      }

      // Admin cancellation automatically triggers a refund of the booking fee
      let refundInitiated = false;
      if (isAdmin) {
          try {
              await PaymentService.refundBookingCharge(service.id);
              refundInitiated = true;
              logger.info(`[ADMIN] Booking ${service.id} cancelled by admin + refund initiated`);
          } catch (refundErr: any) {
              logger.error(`[ADMIN] Refund failed for booking ${service.id} during admin cancellation:`, refundErr.message);
          }
      }

      // Update both status and bookingFeeStatus
      const [updated] = await db.update(serviceRequests).set({
          status: 'cancelled',
          bookingFeeStatus: refundInitiated ? 'refunded' : service.bookingFeeStatus,
          updatedAt: new Date()
      }).where(eq(serviceRequests.id, service.id)).returning();

      res.json({ success: true, message: refundInitiated ? "Service cancelled and refund initiated" : "Service cancelled successfully", data: updated });
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

  // Get serviceability status (for PincodeChecker component)
  app.get("/api/customer/check-serviceability", async (req, res, next) => {
    try {
      const pincode = req.query.pincode as string;
      if (!pincode) {
        return res.status(400).json({ success: false, message: "Pincode is required" });
      }
      
      const isServiceable = await storage.isPincodeServiceable(pincode);
      
      console.log(`[check-serviceability] Checked pincode: '${pincode}', result: ${isServiceable}`);

      res.json({
        success: true,
        available: isServiceable,
        serviceable: isServiceable, // For compatibility
        pincode,
        message: isServiceable ? "Service available" : "Service not available in your area"
      });
    } catch (error) {
      next(error);
    }
  });

  // Validate pincode (POST version for other flows)
  app.post("/api/validate-pincode", async (req, res, next) => {
    try {
      const { pinCode } = req.body;
      const isServiceable = await storage.isPincodeServiceable(pinCode);

      res.json({
        success: true,
        serviceable: isServiceable, // Match mobile app expectation
        valid: isServiceable,       // Keep for backward compatibility
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

  app.delete("/api/admin/districts/:id", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteDistrict(id);
      res.sendStatus(204);
    } catch (error: any) {
      if (error.message.includes("Cannot delete")) {
        return res.status(403).json({ message: error.message });
      }
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
    const code = crypto.randomInt(1000, 9999).toString();
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
  app.post("/api/notifications/register", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { token, platform } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: "Device token is required" });
      }

      await storage.addDeviceToken(req.user!.userId, token, platform || 'unknown');
      res.json({ success: true, message: "Device registered for notifications" });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/notifications/unregister", authenticateToken, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: "Token required" });
      }

      await storage.removeDeviceToken(req.user!.userId, token);
      res.json({ success: true, message: "Device unregistered" });
    } catch (error) {
      next(error);
    }
  });

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
        metadata: { reason, providerId: provider.id, partnerName: provider.fullName || provider.businessName || 'Unknown' },
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
  app.use("/api/catalog", mobileLimiter);  // Product catalog

  // Public/Default
  app.use("/api/public", publicLimiter);

  // ==================== ROUTE REGISTRATION ====================
  // Apply Admin Authentication Middleware (skipping login/register)
  // This must be registered BEFORE any admin routes
  
  registerAdminRoutes(app);
  registerAdminVerificationRoutes(app); // PHASE 6: Employee verification + dispute resolution
  registerAdminWithdrawalRoutes(app);
  registerCatalogRoutes(app);
  // PHASE 0: Product ordering halted — Coming Soon (AI_CONTEXT §3.K)
  // registerProductRoutes(app);
  // PHASE 0: Auth OTP removed — Truecaller handles phone auth (AI_CONTEXT §1.3)
  // registerOtpRoutes(app);
  registerClientFeatureRoutes(app);
  // registerSocialAuthRoutes(app); // REMOVED: Social auth deprecated
  registerNotificationRoutes(app);
  registerReturnRoutes(app);
  registerCatalogRoutes(app);
  registerTruecallerAuthRoutes(app);
  registerGeofenceRoutes(app); // PHASE 4: Geofenced booking transitions
  registerBillingRoutes(app); // PHASE 5: Billing submission + cancellation
  registerAdminVerificationRoutes(app); // PHASE 6: Employee verification + dispute resolution
  registerUploadRoutes(app); // Image uploads (Cloudinary)

  // Apply error handler (must be LAST)
  app.use(errorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
