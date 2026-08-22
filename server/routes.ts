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
  services as servicesCatalog,
  paymentTransactions,
  users,
  employees,
  invoices as invoicesTable,
  serviceCategories,
  serviceCategoryTechnicianTypes,
  technicianTypes,
} from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { TokenService } from "./services/token.service";
import { configService } from "./services/config.service";
import logger from "./lib/logger";
import { recordAudit } from "./lib/audit";
import { syncEmployeeTechnicianTypes, getCategoryTechnicianTypes, setCategoryTechnicianTypes } from "./lib/expertise-matching";
import { parsePaginationParams, buildPaginatedResult, getOffset } from "./lib/pagination";
// PHASE 7: Import modular route registrations
import { registerAdminRoutes } from "./routes/admin.routes";
import { registerAdminManagementRoutes } from "./routes/admin-management.routes";
import { AdminOrderManager } from "./services/admin-order.manager";
import { registerManualBillRoutes } from "./routes/manual-bill.routes";
import { registerTechnicianTypeRoutes } from "./routes/technician-type.routes";
import { registerPaymentRoutes } from "./routes/payment.routes";
import { registerProductRoutes } from "./routes/product.routes";
// PHASE 0: OTP routes removed — auth OTP replaced by Truecaller SDK v3
// import { registerOtpRoutes } from "./routes/otp.routes";
import { registerClientFeatureRoutes } from "./routes/client-features.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
// NOTE: use the shared `configService` singleton imported above. A second
// `new ConfigService()` here shadowed it and carried its own cache, so config
// updates applied through one instance were invisible to the other.

import { NotificationService } from "./services/notification.service";
import { BookingNotifications } from "./services/booking-notifications";
import { registerNotificationRoutes } from "./routes/notification.routes";
import { registerReturnRoutes } from "./routes/return.routes";
import { registerCatalogRoutes } from "./routes/catalog.routes";
import { registerTruecallerAuthRoutes } from "./routes/auth-truecaller.routes";
import { registerGeofenceRoutes } from "./routes/geofence.routes";
import { registerBillingRoutes } from "./routes/billing.routes";
import { registerAdminVerificationRoutes } from "./routes/admin-verification.routes";
import { registerAdminWithdrawalRoutes } from "./routes/admin-withdrawals.routes";
import { registerAdminDbConsoleRoutes } from "./routes/admin-db-console.routes";
import { registerUploadRoutes } from "./routes/upload.routes";
import { registerPartnerProfileRoutes } from "./routes/partner-profile.routes";
import { authLimiter, identityLimiter, sessionLimiter, adminLimiter, partnerLimiter, mobileLimiter, publicLimiter } from "./middleware/rate-limit";
import { BillingEngine } from "./services/billing-engine";
import { PaymentTrackingService } from "./services/payment-tracking.service";
import { PaymentService } from "./services/payment.service";
import { InvoiceGenerator } from "./services/invoice-generator";
import { db } from "./db";
import { eq, inArray, desc, and, or, ilike, count, isNull, isNotNull } from "drizzle-orm";
import {
  parseListParams,
  buildOrderBy,
  dateRangeConditions,
  combine,
  paginationMeta,
} from "./lib/list-query";


if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = process.env.JWT_SECRET;
// PHASE 5: COMMISSION_RATE removed — billing now uses 15% UniteFix fee from config


// Geo-fencing: use shared utility
import { calculateHaversineDistance as calculateDistance } from "./lib/geo";

// Import canonical auth middleware (single source of truth)
import { authenticateToken, authenticateAdmin as _authenticateAdmin, authenticatePartner, authenticateAny, requireSuperAdmin } from "./middleware/auth.middleware";

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

  // ==================== RATE LIMITING ====================
  // MUST come before any route registration. Express matches middleware and
  // routes in registration order, so these previously sat at the bottom of this
  // function — after every auth route had already been mounted — and could never
  // fire. Brute-force protection on the Truecaller/OTP/reset paths was therefore
  // absent entirely, and unlimited OTP requests could reset the 5-attempt
  // lockout by simply asking for a fresh code.
  /**
   * Two tiers under /api/auth.
   *
   * Phone/OTP identity verification gets the generous `identityLimiter`; the
   * strict 5-per-15-minutes limit applied to everything here, and a single
   * signup legitimately spends several of those (check-phone, verify, a retry),
   * so users were locked out after two or three attempts. Because the limiter
   * keys on IP and mobile carriers NAT thousands of subscribers behind one
   * address, it also punished unrelated users rather than any attacker.
   *
   * Password login, signup-by-password and password reset keep the strict limit
   * — those are the endpoints where guessing actually gets you something.
   */
  const IDENTITY_PATHS = /^\/(check-phone|truecaller|fallback|email)/;

  /**
   * Session upkeep, NOT authentication. Access tokens live 15 minutes, so every
   * signed-in device hits /refresh about four times an hour. Under the strict
   * 5-per-15-minutes auth limit — keyed on IP, and carriers NAT thousands of
   * subscribers behind one — refreshes started returning 429, the app treated
   * that as a dead session and signed people out, and each logout cost a fresh
   * OTP. There is no credential to guess here: refresh presents a 64-byte random
   * token.
   */
  const SESSION_PATHS = /^\/(refresh|logout)/;

  app.use("/api/auth", (req, res, next) => {
    if (SESSION_PATHS.test(req.path)) return sessionLimiter(req, res, next);
    if (IDENTITY_PATHS.test(req.path)) return identityLimiter(req, res, next);
    return authLimiter(req, res, next);
  });
  app.use("/api/otp", identityLimiter); // OTP send/verify — same reasoning
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

  // Register Partner Profile Routes
  registerPartnerProfileRoutes(app);

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
  app.post("/api/auth/signup", authLimiter, async (req, res, next) => {
    try {
      // SECURITY: this route previously did insertUserSchema.parse(req.body) and
      // spread the result straight into createUser. That schema includes `role`,
      // `isVerified`, `isActive` and `phoneVerified`, so an unauthenticated
      // caller could POST { role: "admin" } and receive an admin JWT — full
      // access to every /api/admin route.
      //
      // Only ever accept the fields a signing-up user is allowed to set, and
      // derive role server-side exactly as /api/auth/signup/complete does.
      const parsed = insertUserSchema.parse(req.body);
      const requestedRole = (req.body as any)?.role;
      const userData = {
        phone: parsed.phone,
        email: parsed.email,
        username: parsed.username,
        password: parsed.password,
        pinCode: parsed.pinCode,
        homeAddress: parsed.homeAddress,
        // Clamped: 'admin' is not reachable from this endpoint.
        role: (requestedRole === 'serviceman' ? 'serviceman' : 'user') as 'user' | 'serviceman',
        // Trust markers are set by the server, never by the client.
        phoneVerified: false,
        emailVerified: false,
        isVerified: false,
        isActive: requestedRole === 'serviceman' ? false : true,
      };

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
  // authenticateAny, not authenticateToken: the latter is customer-only, so a
  // partner's logout 403'd. The mobile client swallowed that error and cleared
  // local state, leaving their refresh token valid server-side for 30 days —
  // a lost or resold device kept a resumable session.
  app.post("/api/auth/logout", authenticateAny, async (req: any, res, next) => {
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
  /**
   * GET /api/admin/me
   * The signed-in admin, with the role read from the database rather than the
   * token. The dashboard uses this to decide which menu items and destructive
   * actions to show — it must not trust the `adminUser` blob in localStorage,
   * which the user can edit freely.
   *
   * Deliberately NOT under /api/admin/auth/: that prefix is exempted from
   * authenticateAdmin (so login and register can be reached unauthenticated),
   * which would leave req.admin undefined here.
   */
  app.get("/api/admin/me", async (req, res, next) => {
    try {
      const admin = (req as any).admin as { userId: number; role: string; username: string } | undefined;
      if (!admin) {
        return res.status(401).json({ success: false, message: "Admin authentication required" });
      }

      const record = await storage.getAdminById(admin.userId);
      res.json({
        success: true,
        data: {
          id: admin.userId,
          username: admin.username,
          email: record?.email ?? null,
          role: admin.role,
          isSuperAdmin: admin.role === 'super_admin',
        },
      });
    } catch (error) {
      next(error);
    }
  });

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
        // SMS delivery is not wired up for phone-only resets. Never print the
        // code: this ran in production and put working password-reset codes into
        // the logs, which is a complete account-takeover path for anyone with
        // log access.
        logger.warn('[PASSWORD RESET] No delivery channel for phone-only reset — code not sent', {
          hasEmail: false,
        });
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

      // End every existing session. A reset is often triggered *because* the
      // account is compromised; without this the attacker's refresh tokens
      // survived the password change for their full 30-day lifetime.
      await TokenService.revokeUserTokens(decoded.userId);

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
  // Standard admin list contract: ?page&limit&sort&order&q&from&to&status
  const USER_SORTABLE = {
    id: users.id,
    username: users.username,
    phone: users.phone,
    email: users.email,
    createdAt: users.createdAt,
    isActive: users.isActive,
  };

  app.get("/api/admin/users", async (req, res, next) => {
    try {
      const listOptions = { defaultSort: 'createdAt', sortable: USER_SORTABLE };
      const params = parseListParams(req.query, listOptions);

      const conditions: any[] = [
        // Servicemen are managed in /api/admin/servicemen; this list is customers.
        eq(users.role, 'user' as any),
      ];

      if (req.query.status === 'active') conditions.push(eq(users.isActive, true));
      if (req.query.status === 'deactivated') conditions.push(eq(users.isActive, false));

      if (params.q) {
        const term = `%${params.q}%`;
        conditions.push(or(
          ilike(users.username, term),
          ilike(users.email, term),
          ilike(users.phone, term),
          ilike(users.pinCode, term),
        ));
      }

      conditions.push(...dateRangeConditions(params, users.createdAt));

      const where = combine(conditions);

      const [{ total }] = await db.select({ total: count() }).from(users).where(where as any);

      const rows = await db
        .select()
        .from(users)
        .where(where as any)
        .orderBy(buildOrderBy(params, listOptions))
        .limit(params.limit)
        .offset(params.offset);

      res.json({
        success: true,
        data: rows.map(u => ({ ...u, password: undefined })),
        pagination: paginationMeta(params, Number(total)),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/admin/users/bulk-status
   * Body: { ids: number[], isActive: boolean }
   * One request and one audit entry for N rows, rather than N of each.
   */
  app.post("/api/admin/users/bulk-status", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      const isActive = req.body?.isActive;

      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
      }
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: "isActive must be a boolean" });
      }

      const updated = await db
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        // Scoped to customers so this can never deactivate an admin or a
        // serviceman, whose accounts are managed by their own screens.
        .where(and(inArray(users.id, ids), eq(users.role, 'user' as any)))
        .returning({ id: users.id });

      const adminId = (req as any).admin?.userId;
      await storage.logAuditEvent({
        entityType: 'user',
        entityId: 0,
        action: isActive ? 'users_bulk_activated' : 'users_bulk_deactivated',
        changedBy: adminId,
        metadata: { requestedIds: ids, affected: updated.length },
      }).catch(() => { /* never fail the action over its audit row */ });

      res.json({
        success: true,
        message: `${updated.length} customer(s) ${isActive ? 'activated' : 'deactivated'}.`,
        data: { affected: updated.length },
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

  // Get all service providers — standard admin list contract.
  // ?page&limit&sort&order&q&from&to&status (status = verification status)
  const EMPLOYEE_SORTABLE = {
    id: employees.id,
    fullName: employees.fullName,
    partnerId: employees.partnerId,
    createdAt: employees.createdAt,
    totalServicesCompleted: employees.totalServicesCompleted,
    averageRating: employees.averageRating,
    isActive: employees.isActive,
    documentVerificationStatus: employees.documentVerificationStatus,
  };

  app.get("/api/admin/servicemen/list", async (req, res, next) => {
    try {
      const listOptions = { defaultSort: 'createdAt', sortable: EMPLOYEE_SORTABLE };
      const params = parseListParams(req.query, listOptions);

      const conditions: any[] = [];
      const status = req.query.status as string | undefined;
      if (status && status !== 'all') {
        conditions.push(eq(employees.documentVerificationStatus, status as any));
      }

      if (params.q) {
        const term = `%${params.q}%`;
        conditions.push(or(
          ilike(employees.fullName, term),
          ilike(employees.partnerId, term),
          ilike(employees.businessName, term),
          ilike(users.phone, term),
          ilike(users.email, term),
          ilike(users.pinCode, term),
          ilike(users.homeAddress, term),
        ));
      }

      conditions.push(...dateRangeConditions(params, employees.createdAt));
      const where = combine(conditions);

      // Joined rather than a getUser() per row: the old version issued one query
      // per employee on every page load.
      const [{ total }] = await db
        .select({ total: count() })
        .from(employees)
        .leftJoin(users, eq(users.id, employees.userId))
        .where(where as any);

      const rows = await db
        .select({
          employee: employees,
          userEmail: users.email,
          userPhone: users.phone,
          username: users.username,
          // Address and pin code live on `users` — the employees table has no
          // such columns. They were never selected here and `location` was
          // hardcoded to '', so everything an expert entered during signup was
          // invisible in the directory and the Edit dialog opened blank.
          homeAddress: users.homeAddress,
          pinCode: users.pinCode,
        })
        .from(employees)
        .leftJoin(users, eq(users.id, employees.userId))
        .where(where as any)
        .orderBy(buildOrderBy(params, listOptions))
        .limit(params.limit)
        .offset(params.offset);

      // Field aliases kept for admin dashboard backward compat.
      const data = rows.map(({ employee: p, userEmail, userPhone, username, homeAddress, pinCode }) => ({
        ...p,
        partnerName: p.fullName || username || 'Unknown',
        verificationStatus: p.documentVerificationStatus || 'pending',
        email: userEmail || '',
        phone: userPhone || '',
        // `location` is the dashboard's historical name for the pin code — the
        // create form labels that same field "Pin Code". Both names are sent so
        // neither the form nor the table has to care which it reads.
        location: pinCode || '',
        pinCode: pinCode || '',
        address: homeAddress || '',
        homeAddress: homeAddress || '',
        services: p.services || [],
      }));

      res.json({ success: true, data, pagination: paginationMeta(params, Number(total)) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/admin/servicemen/bulk-status
   * Body: { ids: number[], isActive: boolean }   (ids are employees.id)
   *
   * Deactivating also forces isOnline false — an employee left "online" while
   * inactive still looks assignable on the queue screen.
   */
  app.post("/api/admin/servicemen/bulk-status", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      const isActive = req.body?.isActive;

      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
      }
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: "isActive must be a boolean" });
      }

      const updated = await db
        .update(employees)
        .set({ isActive, ...(isActive ? {} : { isOnline: false }), updatedAt: new Date() })
        .where(inArray(employees.id, ids))
        .returning({ id: employees.id });

      const adminId = (req as any).admin?.userId;
      await storage.logAuditEvent({
        entityType: 'employee',
        entityId: 0,
        action: isActive ? 'employees_bulk_activated' : 'employees_bulk_deactivated',
        changedBy: adminId,
        metadata: { requestedIds: ids, affected: updated.length },
      }).catch(() => { /* never fail the action over its audit row */ });

      res.json({
        success: true,
        message: `${updated.length} employee(s) ${isActive ? 'activated' : 'deactivated'}.`,
        data: { affected: updated.length },
      });
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

      // `location` is the pin code — same field the edit route accepts under
      // either name. Validated here so create and edit cannot disagree.
      if (location && !/^\d{6}$/.test(String(location).trim())) {
        return res.status(400).json({ success: false, message: "Pin code must be exactly 6 digits" });
      }

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
        pinCode: location ? String(location).trim() : null,
        homeAddress: address ? String(address).trim() : null
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
  /**
   * An employee's record is split across two tables: trade details live on
   * `employees`, identity and address live on `users`. This route used to hand
   * the whole request body to storage.updateServiceProvider, which writes only
   * to `employees` — so email, phone, address and pin code were silently
   * dropped by Drizzle as unknown columns and the edit appeared to do nothing.
   */
  app.patch("/api/admin/servicemen/:id", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const b = req.body ?? {};

      const [existing] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Provider not found" });
      }

      // --- fields that belong to `users` -------------------------------------
      const userUpdates: any = {};
      // The dashboard calls the pin code "location"; accept either name.
      const pin = b.pinCode ?? b.location;
      const addr = b.homeAddress ?? b.address;
      if (b.partnerName !== undefined) userUpdates.username = b.partnerName;
      if (b.email !== undefined) userUpdates.email = String(b.email).trim() || null;
      if (b.phone !== undefined) userUpdates.phone = String(b.phone).trim() || null;
      if (pin !== undefined) userUpdates.pinCode = String(pin).trim() || null;
      if (addr !== undefined) userUpdates.homeAddress = String(addr).trim() || null;

      if (userUpdates.pinCode && !/^\d{6}$/.test(userUpdates.pinCode)) {
        return res.status(400).json({ success: false, message: "Pin code must be exactly 6 digits" });
      }

      // Phone and email are unique on `users`; a clash would otherwise surface
      // as a raw 23505 with no indication of which field caused it.
      for (const [field, column] of [['email', users.email], ['phone', users.phone]] as const) {
        const value = userUpdates[field];
        if (!value) continue;
        const [clash] = await db.select({ id: users.id }).from(users)
          .where(eq(column as any, value)).limit(1);
        if (clash && clash.id !== existing.userId) {
          return res.status(400).json({
            success: false,
            message: `That ${field} is already registered to another account`,
          });
        }
      }

      if (Object.keys(userUpdates).length > 0) {
        await db.update(users)
          .set({ ...userUpdates, updatedAt: new Date() })
          .where(eq(users.id, existing.userId));
      }

      // --- fields that belong to `employees` ---------------------------------
      const employeeUpdates: any = {};
      if (b.partnerName !== undefined) employeeUpdates.fullName = b.partnerName;
      if (b.partnerType !== undefined) employeeUpdates.partnerType = b.partnerType;
      if (b.businessName !== undefined) employeeUpdates.businessName = b.businessName;
      if (b.services !== undefined) employeeUpdates.services = b.services;
      if (b.skills !== undefined) employeeUpdates.skills = b.skills;
      if (b.experienceYears !== undefined) employeeUpdates.experienceYears = b.experienceYears;
      if (b.qualifications !== undefined) employeeUpdates.qualifications = b.qualifications;
      if (b.emergencyContact !== undefined) employeeUpdates.emergencyContact = b.emergencyContact;

      const provider = Object.keys(employeeUpdates).length > 0
        ? await storage.updateServiceProvider(id, employeeUpdates)
        : existing;

      // Keep the technician-type ids in step whenever an admin edits the trade
      // list, so assignment matching does not go stale behind the display copy.
      if (b.services !== undefined) {
        try {
          await syncEmployeeTechnicianTypes(id, Array.isArray(b.services) ? b.services : []);
        } catch (syncError: any) {
          logger.warn("[ADMIN] Could not sync technician type ids", { employeeId: id, error: syncError.message });
        }
      }

      const [user] = await db.select().from(users).where(eq(users.id, existing.userId)).limit(1);

      res.json({
        success: true,
        message: "Provider updated",
        data: {
          ...provider,
          partnerName: provider?.fullName || user?.username || 'Unknown',
          email: user?.email || '',
          phone: user?.phone || '',
          location: user?.pinCode || '',
          pinCode: user?.pinCode || '',
          address: user?.homeAddress || '',
          homeAddress: user?.homeAddress || '',
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // Approve/Verify service provider
  // This is the route the Employees page "Verify" button calls — NOT
  // PATCH /api/admin/employees/:id/verify. Both must notify the expert and keep
  // the user row in step, or which button an admin happens to press changes the
  // outcome.
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

      // Experts are created with users.is_active = false pending approval, and
      // this route previously never cleared it — leaving approved experts marked
      // inactive on the user row forever.
      await storage.updateUser(provider.userId, { isActive: true });

      // Approval is the moment an expert can finally receive work. Without this
      // they had to keep reopening the app to find out.
      void BookingNotifications.verificationDecision(id, 'verified');

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

      await storage.updateUser(provider.userId, { isActive: false });

      // Being suspended silently is the worst version of this: the expert keeps
      // opening the app wondering why no jobs arrive.
      void BookingNotifications.verificationDecision(id, "suspended", reason);

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

      await storage.updateUser(provider.userId, { isActive: true });

      void BookingNotifications.verificationDecision(id, "verified");

      res.json({ success: true, message: "Provider activated", data: provider });
    } catch (error) {
      next(error);
    }
  });

  // Delete service provider
  app.delete("/api/admin/servicemen/:id", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid employee id" });
      }

      const deleted = await storage.deleteServiceProvider(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }

      res.json({ success: true, message: "Employee deleted successfully" });
    } catch (error) {
      next(error);
    }
  });

  // ==================== HARD ACCOUNT PURGE ====================
  // Distinct from DELETE /api/admin/servicemen/:id above, which only
  // deactivates. These remove the account and every connected record.
  //
  // `kind` is 'user' (customers, by users.id) or 'employee' (by employees.id).
  // Both resolve to the same account — an expert has a row in each table.

  /**
   * GET /api/admin/accounts/:kind/:id/deletion-impact
   * What a purge would remove. Runs the real deletes and rolls back, so the
   * numbers cannot drift from what the purge actually does.
   */
  app.get("/api/admin/accounts/:kind/:id/deletion-impact", requireSuperAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const kind = req.params.kind;
      if (Number.isNaN(id) || (kind !== 'user' && kind !== 'employee')) {
        return res.status(400).json({ success: false, message: "Invalid account kind or id" });
      }

      const result = await storage.purgeAccountCascade({
        ...(kind === 'user' ? { userId: id } : { employeeId: id }),
        dryRun: true,
      });

      if (!result) return res.status(404).json({ success: false, message: "Account not found" });

      const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
      res.json({ success: true, data: { ...result, totalRows: total } });
    } catch (error: any) {
      if (/Refusing to purge/.test(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
      next(error);
    }
  });

  /**
   * DELETE /api/admin/accounts/:kind/:id
   * Irreversible. Requires ?confirm=true so it cannot fire from a stray click.
   */
  /**
   * POST /api/admin/accounts/:kind/bulk-deletion-impact
   * Body: { ids: number[] }
   * Combined preview across a selection. Each id is measured with the same
   * dry-run purge the single-account dialog uses, so the total an admin is shown
   * is the sum of what will actually be deleted.
   */
  app.post("/api/admin/accounts/:kind/bulk-deletion-impact", requireSuperAdmin, async (req, res, next) => {
    try {
      const kind = req.params.kind;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      if (kind !== 'user' && kind !== 'employee') {
        return res.status(400).json({ success: false, message: "Invalid account kind" });
      }
      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
      }

      const counts: Record<string, number> = {};
      const accounts: Array<{ id: number; username: string | null; totalRows: number }> = [];
      let skipped = 0;

      for (const id of ids) {
        try {
          const result = await storage.purgeAccountCascade({
            ...(kind === 'user' ? { userId: id } : { employeeId: id }),
            dryRun: true,
          });
          if (!result) { skipped++; continue; }
          let rowTotal = 0;
          for (const [table, n] of Object.entries(result.counts)) {
            counts[table] = (counts[table] ?? 0) + n;
            rowTotal += n;
          }
          accounts.push({ id, username: result.username, totalRows: rowTotal });
        } catch {
          // Admin accounts are refused by purgeAccountCascade — report them as
          // skipped rather than failing the whole preview.
          skipped++;
        }
      }

      const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
      res.json({ success: true, data: { accounts, counts, totalRows, skipped } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/admin/accounts/:kind/bulk?confirm=true
   * Body: { ids: number[] }
   */
  app.delete("/api/admin/accounts/:kind/bulk", requireSuperAdmin, async (req, res, next) => {
    try {
      const kind = req.params.kind;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];

      if (kind !== 'user' && kind !== 'employee') {
        return res.status(400).json({ success: false, message: "Invalid account kind" });
      }
      if (ids.length === 0) {
        return res.status(400).json({ success: false, message: "ids must be a non-empty array" });
      }
      if (req.query.confirm !== 'true') {
        return res.status(428).json({
          success: false,
          requiresConfirmation: true,
          message: "This permanently deletes the selected accounts and all connected services. Re-send with ?confirm=true.",
        });
      }

      const adminId = (req as any).admin?.userId;
      const deleted: Array<{ id: number; username: string | null; totalRows: number }> = [];
      const failed: Array<{ id: number; reason: string }> = [];

      // Sequential rather than parallel: each purge is its own transaction, and
      // two overlapping cascades can contend on the same child rows.
      for (const id of ids) {
        try {
          const result = await storage.purgeAccountCascade({
            ...(kind === 'user' ? { userId: id } : { employeeId: id }),
          });
          if (!result) { failed.push({ id, reason: 'not found' }); continue; }
          const rowTotal = Object.values(result.counts).reduce((a, b) => a + b, 0);
          deleted.push({ id: result.userId, username: result.username, totalRows: rowTotal });
        } catch (err: any) {
          failed.push({ id, reason: err.message });
        }
      }

      const totalRows = deleted.reduce((sum, d) => sum + d.totalRows, 0);
      logger.warn(`[ADMIN_PURGE] Bulk purge by admin ${adminId}: ${deleted.length} account(s), ${totalRows} rows, ${failed.length} failed`);

      await storage.logAuditEvent({
        entityType: 'user',
        entityId: 0,
        action: 'accounts_bulk_purged',
        changedBy: adminId,
        metadata: { kind, deleted, failed, totalRows },
      }).catch(() => { /* never fail the purge over its audit row */ });

      res.json({
        success: true,
        message: `Deleted ${deleted.length} account(s) and ${totalRows} connected row(s).`
          + (failed.length ? ` ${failed.length} could not be deleted.` : ''),
        data: { deleted, failed, totalRows },
      });
    } catch (error) {
      next(error);
    }
  });

  // NOTE: registered AFTER /accounts/:kind/bulk below — Express matches in
  // registration order, and this pattern would otherwise swallow "bulk" as an
  // :id, parse it to NaN, and reject the bulk delete with "Invalid id".
  app.delete("/api/admin/accounts/:kind/:id", requireSuperAdmin, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const kind = req.params.kind;
      if (Number.isNaN(id) || (kind !== 'user' && kind !== 'employee')) {
        return res.status(400).json({ success: false, message: "Invalid account kind or id" });
      }
      if (req.query.confirm !== 'true') {
        return res.status(428).json({
          success: false,
          requiresConfirmation: true,
          message: "This permanently deletes the account and all connected services. Re-send with ?confirm=true.",
        });
      }

      const result = await storage.purgeAccountCascade({
        ...(kind === 'user' ? { userId: id } : { employeeId: id }),
      });

      if (!result) return res.status(404).json({ success: false, message: "Account not found" });

      const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
      const adminId = (req as any).admin?.userId ?? (req as any).user?.userId;

      logger.warn(`[ADMIN_PURGE] ${result.username ?? 'account'} (users.id=${result.userId}) purged by admin ${adminId} — ${total} rows`);

      // Written after the purge, deliberately: audit_logs survives the account so
      // there is a permanent record of who removed what.
      await storage.logAuditEvent({
        entityType: 'user',
        entityId: result.userId,
        action: 'account_purged',
        changedBy: adminId,
        metadata: {
          username: result.username,
          employeeId: result.employeeId,
          totalRows: total,
          counts: result.counts,
        },
      }).catch(() => { /* never fail the purge over its own audit row */ });

      res.json({
        success: true,
        message: `Deleted ${result.username ?? 'account'} and ${total} connected row(s).`,
        data: { ...result, totalRows: total },
      });
    } catch (error: any) {
      if (/Refusing to purge/.test(error.message)) {
        return res.status(403).json({ success: false, message: error.message });
      }
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
      const deleted = await storage.deleteServiceProvider(parseInt(req.params.id));
      if (!deleted) {
        return res.status(404).json({ success: false, message: "Partner not found" });
      }
      res.json({ success: true, message: "Partner deleted" });
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

          const maxDistStr = await configService.get("OPERATIONAL_CONFIG.MAX_SERVICE_START_DISTANCE");
          const maxDistance = maxDistStr ? parseInt(maxDistStr as string, 10) : 200;

          if (distance > maxDistance) {
            return res.status(403).json({
              success: false,
              message: `You are too far from the location to start the service. Distance: ${Math.round(distance)}m (max: ${maxDistance}m)`
            });
          }
        }
      }

      const targetId = isStringId ? service.id : parseInt(serviceId as string);
      const updatedService = await storage.updateServiceRequest(targetId, {
        status: 'in_progress',
        startedAt: new Date()
      });

      void BookingNotifications.serviceStarted(targetId);

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

      void BookingNotifications.serviceCompleted(targetId!, result.transaction?.amount);

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
      // Catalog service id (distinct from the booking's own serviceId string).
      // Read before the schema parse so it survives, and so it can't be spoofed
      // into serviceRequests columns.
      const catalogServiceId = req.body?.catalogServiceId ? Number(req.body.catalogServiceId) : null;

      const serviceData = insertServiceRequestSchema.parse({
        ...req.body,
        userId: req.user!.userId
      });

      // FIXED-PRICE CATALOG (v2): if the client picked a catalog service with a
      // set price, freeze the whole bill now. Otherwise fall back to the v1
      // (technician-billed) snapshot so older app builds keep working.
      let pricingSnapshot = await BillingEngine.createBookingSnapshot();
      let catalogTotal: number | null = null;
      let catalogCommission: number | null = null;

      if (catalogServiceId) {
        const [svc] = await db.select({ basePrice: servicesCatalog.basePrice })
          .from(servicesCatalog).where(eq(servicesCatalog.id, catalogServiceId)).limit(1);
        if (svc && svc.basePrice > 0) {
          pricingSnapshot = await BillingEngine.createCatalogSnapshot(svc.basePrice);
          catalogTotal = pricingSnapshot.grossTotal ?? svc.basePrice;
          catalogCommission = Math.round(pricingSnapshot.platformFee ?? 0);
        }
      }

      const service = await storage.createServiceRequest({
        ...serviceData,
        catalogServiceId: catalogServiceId ?? undefined,
        bookingFee: pricingSnapshot.bookingFee,
        bookingFeeStatus: pricingSnapshot.bookingFee === 0 ? 'paid' : 'pending',
      });

      // Write the frozen snapshot to the service_requests row. For a catalog
      // booking, the total and commission are known now.
      await db.update(serviceRequests)
        .set({
          pricingSnapshot: pricingSnapshot as any,
          ...(catalogTotal !== null ? { totalAmount: catalogTotal } : {}),
          ...(catalogCommission !== null ? { commissionAmount: catalogCommission } : {}),
        })
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
          } else {
            logger.warn(`[BOOKING] Razorpay keys missing. Skipping payment (dev mode).`);
            await db.update(serviceRequests)
              .set({ bookingFeeStatus: 'paid' as any })
              .where(eq(serviceRequests.id, service.id));
          }
        } catch (payError: any) {
          logger.warn(`[BOOKING] Razorpay order creation skipped: ${payError.message}`);
          // Don't block booking — proceed without payment for dev/testing
          await db.update(serviceRequests)
            .set({ bookingFeeStatus: 'paid' as any })
            .where(eq(serviceRequests.id, service.id));
        }
      } else {
        logger.info(`[BOOKING] Free booking created for service ${service.id}.`);
      }

      void BookingNotifications.bookingCreated(service.id);

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
          message: "Cannot cancel after a service expert has been assigned. Please contact support.",
          data: {
            whatsappLink: `https://wa.me/${process.env.WHATSAPP_BUSINESS_NUMBER || '919999999999'}?text=${encodeURIComponent(`Booking #${service.id}: I need to cancel`)}`,
          },
        });
      }

      if (isAdmin && service.status === 'completed') {
        return res.status(400).json({ success: false, message: "Cannot cancel a completed service." });
      }

      // Hard-delete unpaid bookings (e.g. if the user backed out of Razorpay)
      if (service.status === 'created' && service.bookingFeeStatus === 'pending') {
          await db.delete(serviceRequests).where(eq(serviceRequests.id, service.id));
          return res.json({ 
              success: true, 
              message: "Unpaid booking removed successfully", 
              data: { ...service, status: 'deleted' } 
          });
      }

      // Refund the booking fee whenever it was actually collected — for CUSTOMER
      // cancellations too, not just admin ones. Per AI_CONTEXT §3.D a customer
      // cancelling from CREATED is entitled to a full booking-fee refund, but this
      // route previously attempted a refund only when `isAdmin`, so every customer
      // cancellation silently kept the money.
      let refundInitiated = false;
      let refundedAmount = 0;
      let refundFailed = false;

      if (service.bookingFeeStatus === 'paid') {
          try {
              const refund = await PaymentService.refundBookingCharge(service.id);
              refundInitiated = true;
              refundedAmount = refund.amountRupees;
              logger.info(
                  `[CANCEL] Booking ${service.id} cancelled by ${isAdmin ? 'admin' : 'customer'} + ₹${refundedAmount} refunded`,
              );
          } catch (refundErr: any) {
              // Leave bookingFeeStatus as 'paid' so the outstanding refund stays
              // visible for manual reconciliation rather than being marked done.
              refundFailed = true;
              logger.error(
                  `[CANCEL] REFUND FAILED for booking ${service.id} — manual refund required: ${refundErr.message}`,
              );
          }
      }

      // 'refunded' is written only when Razorpay actually accepted the refund.
      const [updated] = await db.update(serviceRequests).set({
          status: 'cancelled',
          bookingFeeStatus: refundInitiated ? 'refunded' : service.bookingFeeStatus,
          updatedAt: new Date()
      }).where(eq(serviceRequests.id, service.id)).returning();

      const message = refundInitiated
          ? `Service cancelled. ₹${refundedAmount} will be credited within 5-7 business days.`
          : refundFailed
              ? "Service cancelled. Your refund needs manual processing — our team will contact you shortly."
              : "Service cancelled successfully.";

      // Only matters when an expert was already assigned — otherwise this is a
      // no-op, since bookingCancelled targets the expert.
      void BookingNotifications.bookingCancelled(service.id, req.body?.reason);

      res.json({
          success: true,
          message,
          data: { ...updated, refundInitiated, refundedAmount },
      });
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
  // Registered here AND in admin.routes.ts; this one wins because routes.ts runs
  // first. Both now use the same list contract via AdminOrderManager, so which
  // one Express picks no longer changes the response shape.
  // Also drops a full-table read: it previously fetched every order and sliced
  // the array in memory.
  app.get("/api/admin/orders", async (req, res, next) => {
    try {
      const listOptions = { defaultSort: 'createdAt', sortable: AdminOrderManager.SORTABLE };
      const params = parseListParams(req.query, listOptions);
      const status = req.query.status as string | undefined;

      const result = await AdminOrderManager.getOrders(
        status && status !== 'all' ? status : undefined,
        params.page,
        params.limit,
        {
          q: params.q || undefined,
          from: params.from,
          to: params.to,
          orderBy: buildOrderBy(params, listOptions),
        },
      );

      res.json({
        success: true,
        data: result.orders,
        pagination: paginationMeta(params, result.total),
      });
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
      const serviceRequestIds = invoices
        .map(i => i.serviceRequestId)
        .filter((id): id is number => id !== null);

      let payments: any[] = [];
      if (serviceRequestIds.length > 0) {
        payments = await db.select({
          serviceRequestId: paymentTransactions.serviceRequestId,
          status: paymentTransactions.status,
          razorpayPaymentId: paymentTransactions.razorpayPaymentId,
        })
        .from(paymentTransactions)
        .where(inArray(paymentTransactions.serviceRequestId, serviceRequestIds))
        .orderBy(desc(paymentTransactions.createdAt));
      }

      const enrichedInvoices = invoices.map(inv => {
        const tx = payments.find(p => p.serviceRequestId === inv.serviceRequestId);
        return {
          ...inv,
          paymentStatus: tx?.status || 'pending',
          razorpayPaymentId: tx?.razorpayPaymentId || null,
        };
      });

      const result = paginate(enrichedInvoices, page, limit);
      res.json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) {
      next(error);
    }
  });

  const INVOICE_SORTABLE = {
    createdAt: invoicesTable.createdAt,
    invoiceId: invoicesTable.invoiceId,
    totalAmount: invoicesTable.totalAmount,
    baseAmount: invoicesTable.baseAmount,
  };

  app.get("/api/admin/invoices", async (req, res, next) => {
    try {
      const listOptions = { defaultSort: 'createdAt', sortable: INVOICE_SORTABLE };
      const params = parseListParams(req.query, listOptions);

      const conditions: any[] = [];

      if (params.q) {
        const term = `%${params.q}%`;
        conditions.push(or(
          ilike(invoicesTable.invoiceId, term),
          ilike(users.username, term),
          ilike(users.phone, term),
        ));
      }
      conditions.push(...dateRangeConditions(params, invoicesTable.createdAt));

      // 'manual' / 'service' / 'product' — which billing path produced it.
      const source = req.query.source as string | undefined;
      if (source === 'manual') {
        conditions.push(and(isNull(invoicesTable.serviceRequestId), isNull(invoicesTable.productOrderId)));
      } else if (source === 'service') {
        conditions.push(isNotNull(invoicesTable.serviceRequestId));
      } else if (source === 'product') {
        conditions.push(isNotNull(invoicesTable.productOrderId));
      }

      const where = combine(conditions);

      const [{ total }] = await db
        .select({ total: count() })
        .from(invoicesTable)
        .leftJoin(users, eq(users.id, invoicesTable.userId))
        .where(where as any);

      const rows = await db
        .select({ invoice: invoicesTable, customerName: users.username, customerPhone: users.phone })
        .from(invoicesTable)
        .leftJoin(users, eq(users.id, invoicesTable.userId))
        .where(where as any)
        .orderBy(buildOrderBy(params, listOptions))
        .limit(params.limit)
        .offset(params.offset);

      // Payment status only for the page being shown — the old version fetched
      // every invoice and every transaction on every load.
      const serviceRequestIds = rows
        .map(r => r.invoice.serviceRequestId)
        .filter((id): id is number => id !== null);

      let payments: any[] = [];
      if (serviceRequestIds.length > 0) {
        payments = await db.select({
          serviceRequestId: paymentTransactions.serviceRequestId,
          status: paymentTransactions.status,
          razorpayPaymentId: paymentTransactions.razorpayPaymentId,
        })
        .from(paymentTransactions)
        .where(inArray(paymentTransactions.serviceRequestId, serviceRequestIds))
        .orderBy(desc(paymentTransactions.createdAt));
      }

      const data = rows.map(({ invoice, customerName, customerPhone }) => {
        const tx = payments.find(p => p.serviceRequestId === invoice.serviceRequestId);
        const isManual = !invoice.serviceRequestId && !invoice.productOrderId;
        return {
          ...invoice,
          customerName,
          customerPhone,
          source: isManual ? 'manual' : invoice.serviceRequestId ? 'service' : 'product',
          // A manual bill is settled at the counter, so it has no Razorpay
          // transaction and must not be shown as perpetually 'pending'.
          paymentStatus: isManual ? 'paid' : (tx?.status || 'pending'),
          razorpayPaymentId: tx?.razorpayPaymentId || null,
        };
      });

      res.json({ success: true, data, pagination: paginationMeta(params, Number(total)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/invoices/:id/refund", authenticateAdmin, async (req, res, next) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const invoice = await storage.getInvoice(invoiceId);
      
      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      if (!invoice.serviceRequestId) {
        return res.status(400).json({ success: false, message: "Refunds for product orders are not supported yet via this endpoint." });
      }

      const { refunds, totalRefunded } = await PaymentService.refundBookingPayments(
        invoice.serviceRequestId,
        undefined, // Refund full amount captured
        'Admin requested refund via Dashboard'
      );

      res.json({ success: true, refunds, totalRefunded, message: `Successfully refunded ₹${totalRefunded}` });
    } catch (error: any) {
      logger.error(`[ADMIN_REFUND] Error refunding invoice ${req.params.id}: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
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

  /**
   * GET /api/admin/services/:id/invoice
   * Download the tax invoice PDF for a completed service request.
   *
   * The admin Services page used to open /api/invoices/generate/:id, which never
   * existed — hence the "API endpoint not found" page. This serves the SAME PDF
   * the customer gets (pdfkit, built from the frozen billing snapshot), and
   * generates the invoice on the fly if completion happened before invoicing was
   * wired up. generateInvoice is idempotent, so repeat downloads reuse one row.
   */
  app.get("/api/admin/services/:id/invoice", authenticateAdmin, async (req, res, next) => {
    try {
      const serviceRequestId = parseInt(req.params.id);
      if (isNaN(serviceRequestId)) {
        return res.status(400).json({ success: false, message: "Invalid service id" });
      }

      const [sr] = await db.select().from(serviceRequests)
        .where(eq(serviceRequests.id, serviceRequestId)).limit(1);
      if (!sr) {
        return res.status(404).json({ success: false, message: "Service request not found" });
      }
      if (!sr.totalAmount) {
        return res.status(400).json({
          success: false,
          message: "No invoice yet — this booking's billing has not been completed.",
        });
      }

      // Reuse the existing invoice if present; otherwise create it now (idempotent).
      const { invoiceId } = await PaymentService.generateInvoice(
        serviceRequestId,
        sr.userId,
        sr.providerId as number,
      );

      const invoice = await storage.getInvoiceByInvoiceId(invoiceId);
      if (!invoice) {
        return res.status(500).json({ success: false, message: "Invoice could not be located after generation." });
      }

      const pdfBuffer = await InvoiceGenerator.generatePDF(invoice.id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${invoiceId}.pdf`);
      res.send(pdfBuffer);
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

  // ============ CATEGORY -> TECHNICIAN TYPE MAPPING ============
  //
  // Decides which trades are suitable for a booking in a given category, which
  // is what the assignment queue ranks experts on. Mapped per CATEGORY, not per
  // service: services inside a category are worked by the same trades, so
  // per-service rows would be admin busywork with no extra signal.
  //
  // A category with NO rows means "no trade restriction known" and leaves every
  // expert eligible — that is the correct reading for Professional & Property,
  // Transport, Events and Specialized, where no technician type applies.

  /** All categories with their mapped trades, for the admin editor. */
  app.get("/api/admin/category-technician-types", authenticateAdmin, async (req, res, next) => {
    try {
      const rows = await db
        .select({
          categoryId: serviceCategories.id,
          categoryName: serviceCategories.name,
          technicianTypeId: serviceCategoryTechnicianTypes.technicianTypeId,
          technicianTypeName: technicianTypes.name,
        })
        .from(serviceCategories)
        .leftJoin(
          serviceCategoryTechnicianTypes,
          eq(serviceCategoryTechnicianTypes.categoryId, serviceCategories.id),
        )
        .leftJoin(
          technicianTypes,
          eq(technicianTypes.id, serviceCategoryTechnicianTypes.technicianTypeId),
        )
        .orderBy(serviceCategories.sortOrder, serviceCategories.name);

      const byCategory = new Map<number, any>();
      for (const r of rows) {
        if (!byCategory.has(r.categoryId)) {
          byCategory.set(r.categoryId, {
            categoryId: r.categoryId,
            categoryName: r.categoryName,
            technicianTypes: [] as { id: number; name: string }[],
          });
        }
        if (r.technicianTypeId != null) {
          byCategory.get(r.categoryId).technicianTypes.push({
            id: r.technicianTypeId,
            name: r.technicianTypeName,
          });
        }
      }

      res.json({ success: true, data: Array.from(byCategory.values()) });
    } catch (error) {
      next(error);
    }
  });

  /** Trades mapped to one category. */
  app.get("/api/admin/categories/:id/technician-types", authenticateAdmin, async (req, res, next) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (!Number.isInteger(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid category id" });
      }
      const data = await getCategoryTechnicianTypes(categoryId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Replace a category's trade mapping.
   * Sending an empty array is meaningful — it makes the category unrestricted.
   */
  app.put("/api/admin/categories/:id/technician-types", authenticateAdmin, async (req, res, next) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (!Number.isInteger(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid category id" });
      }

      const [category] = await db
        .select({ id: serviceCategories.id, name: serviceCategories.name })
        .from(serviceCategories)
        .where(eq(serviceCategories.id, categoryId))
        .limit(1);
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const raw = req.body?.technicianTypeIds;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ success: false, message: "technicianTypeIds must be an array" });
      }

      const saved = await setCategoryTechnicianTypes(categoryId, raw.map(Number));

      // recordAudit never throws by design, so no catch is needed here.
      await recordAudit({
        entityType: "service_category",
        entityId: categoryId,
        action: "category_trades_updated",
        changedBy: (req as any).admin?.userId ?? null,
        metadata: { categoryName: category.name, technicianTypeIds: saved },
      });

      const data = await getCategoryTechnicianTypes(categoryId);
      res.json({
        success: true,
        message: saved.length === 0
          ? `${category.name} is now unrestricted — every expert stays eligible`
          : `${category.name} mapped to ${saved.length} trade(s)`,
        data,
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

  app.put("/api/admin/locations/:pinCode", async (req, res, next) => {
    try {
      const data = insertServiceablePincodeSchema.partial().parse(req.body);
      const result = await storage.updateServiceablePincode(req.params.pinCode, data);
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

  // ==================== DEVICE TOKEN ALIASES ====================
  // Legacy paths, kept for app builds already in the field. The canonical routes
  // are /api/notifications/register-token and /unregister-token in
  // notification.routes.ts — new clients should use those.

  // authenticateAny, not authenticateToken — the latter is customer-only and
  // 403'd every service expert trying to register their device.
  app.post("/api/notifications/register", authenticateAny, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { token, platform } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: "Device token is required" });
      }

      // Expo push tokens are routed by Expo's service, not FCM — storing one
      // guarantees every later send to that device fails. Reject it loudly.
      if (/^Expo(nent)?PushToken\[/i.test(token)) {
        return res.status(400).json({
          success: false,
          message: "Expo push tokens are not supported. Send the native FCM token instead.",
        });
      }

      await storage.addDeviceToken(req.user!.userId, token, platform || 'unknown');
      res.json({ success: true, message: "Device registered for notifications" });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/notifications/unregister", authenticateAny, async (req: AuthenticatedRequest, res, next) => {
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

      // Customer has been waiting to hear the expert is coming.
      void BookingNotifications.expertAccepted(serviceId);

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

      // Reassure the customer, and put it back on the admin's radar.
      void BookingNotifications.expertDenied(serviceId, provider.id, reason);

      res.json({ success: true, message: "Service denied. It will be reassigned.", service: updated });
    } catch (error) {
      next(error);
    }
  });

  // ==================== APP VERSION CHECK ====================
  app.get("/api/client/app-version", async (req, res, next) => {
    try {
      const platform = req.query.platform as string || 'android';
      
      // Default to 21 (current version) if not found in db
      const minVersionCode = await configService.get('APP_CONFIG.MIN_VERSION_CODE', 21);
      const latestVersionCode = await configService.get('APP_CONFIG.LATEST_VERSION_CODE', 21);
      const updateUrl = await configService.get('APP_CONFIG.UPDATE_URL', 'market://details?id=com.unitefix.app');
      
      res.json({
        success: true,
        data: {
          minVersionCode,
          latestVersionCode,
          updateUrl,
          platform
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // ==================== REGISTER MODULAR ROUTES ====================
  // These were previously dead code — now properly connected

  // ==================== ROUTE REGISTRATION ====================
  // Apply Admin Authentication Middleware (skipping login/register)
  // This must be registered BEFORE any admin routes
  
  registerAdminRoutes(app);
  registerAdminManagementRoutes(app); // Administrator roles + enable/disable (super_admin only)
  registerManualBillRoutes(app); // Counter-sale billing for in-house visits
  registerTechnicianTypeRoutes(app); // Expert trade list + admin CRUD
  registerAdminVerificationRoutes(app); // PHASE 6: Employee verification + dispute resolution
  registerAdminWithdrawalRoutes(app);
  registerAdminDbConsoleRoutes(app);
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
  // registerTruecallerAuthRoutes is already called earlier (see above); calling it
  // twice mounted the same router at /api/auth a second time, so every auth
  // request walked a duplicate set of handlers that could never match.
  registerGeofenceRoutes(app); // PHASE 4: Geofenced booking transitions
  registerBillingRoutes(app); // PHASE 5: Billing submission + cancellation
  registerAdminVerificationRoutes(app); // PHASE 6: Employee verification + dispute resolution
  registerUploadRoutes(app); // Image uploads (Cloudinary)
  registerPaymentRoutes(app); // Register Razorpay and webhook routes

  // Apply error handler (must be LAST)
  app.use(errorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
