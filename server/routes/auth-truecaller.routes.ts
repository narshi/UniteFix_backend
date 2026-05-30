/**
 * Truecaller OAuth Authentication Routes
 * 
 * Handles the server-side exchange of Truecaller authorization codes
 * for user profile data, then creates/logs in users with JWT tokens.
 * 
 * SDK 3.x OAuth Flow:
 * 1. Mobile gets authorizationCode from Truecaller SDK
 * 2. Backend exchanges code for access_token via Truecaller API  
 * 3. Backend uses access_token to get user profile
 * 4. Backend creates/finds user, issues JWT + refresh token
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { TokenService } from '../services/token.service';
import logger from '../lib/logger';

const router = Router();

const TRUECALLER_CLIENT_ID = process.env.TRUECALLER_CLIENT_ID || '';
const TRUECALLER_TOKEN_URL = 'https://oauth-account-noneu.truecaller.com/v1/token';
const TRUECALLER_USERINFO_URL = 'https://oauth-account-noneu.truecaller.com/v1/userinfo';

// ── Validation Schemas ────────────────────────────────────────────────

const truecallerVerifySchema = z.object({
  authorizationCode: z.string().min(1, 'Authorization code is required'),
  codeVerifier: z.string().min(1, 'Code verifier is required'),
  role: z.enum(['user', 'serviceman']),
});

const phoneLoginSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  role: z.enum(['user', 'serviceman']),
});

const fallbackRequestSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  email: z.string().email('Valid email is required'),
});

const fallbackVerifySchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  email: z.string().email('Valid email is required'),
  code: z.string().min(6, 'Code must be 6 digits'),
  role: z.enum(['user', 'serviceman']),
});

// ── Indian Phone Validation Helper ────────────────────────────────────

function normalizeIndianPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91')) return cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) return '+' + cleaned;
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) return '+91' + cleaned;
  return cleaned;
}

// ── Route: Truecaller OAuth Verify ────────────────────────────────────

router.post('/truecaller/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { authorizationCode, codeVerifier, role } = truecallerVerifySchema.parse(req.body);

    if (!TRUECALLER_CLIENT_ID) {
      logger.error('[TC_AUTH] TRUECALLER_CLIENT_ID not configured');
      return res.status(503).json({ success: false, message: 'Truecaller authentication not configured' });
    }

    // Step 1: Exchange authorization code for access token
    logger.info('[TC_AUTH] Exchanging authorization code for token');

    const tokenResponse = await fetch(TRUECALLER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: TRUECALLER_CLIENT_ID,
        code: authorizationCode,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      logger.error('[TC_AUTH] Token exchange failed', { status: tokenResponse.status, body: errorText });
      
      // Mapped from PDF Page 38
      const errorMap: Record<number, string> = {
        400: 'Invalid request parameters.',
        403: 'Invalid or expired authorization code/verifier.',
        429: 'Too many requests. Please try again later.',
        500: 'Truecaller server error.',
        503: 'Truecaller service unavailable.',
      };
      
      return res.status(tokenResponse.status === 403 ? 401 : 400).json({ 
        success: false, 
        message: errorMap[tokenResponse.status] || 'Truecaller verification failed.' 
      });
    }

    const tokenData = await tokenResponse.json() as { access_token: string; token_type: string };

    // Step 2: Get user profile using access token
    const profileResponse = await fetch(TRUECALLER_USERINFO_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      logger.error('[TC_AUTH] Profile fetch failed', { status: profileResponse.status, body: errorText });
      
      if (profileResponse.status === 401) {
        return res.status(401).json({ success: false, message: 'Truecaller session expired. Please login again.' });
      }
      return res.status(401).json({ success: false, message: 'Could not retrieve profile from Truecaller' });
    }

    const profile = await profileResponse.json() as {
      sub: string;          // Truecaller user ID
      phone_number: string; // E.164 format
      phone_number_country_code: string;
      given_name?: string;
      family_name?: string;
      email?: string;
    };

    // Step 3: Validate the phone number
    const phone = normalizeIndianPhone(profile.phone_number);
    if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) {
      logger.warn('[TC_AUTH] Invalid phone from Truecaller', { phone: profile.phone_number });
      return res.status(400).json({ success: false, message: 'Invalid phone number received from Truecaller' });
    }

    const truecallerId = profile.sub;
    const fullName = [profile.given_name, profile.family_name].filter(Boolean).join(' ') || 'User';
    const email = profile.email || null;

    logger.info('[TC_AUTH] Profile received', { phone, truecallerId, name: fullName });

    // Step 4: Find or create user
    let user = await storage.getUserByPhone(phone);
    let isNewUser = false;

    if (!user) {
      // Also check by truecallerId (in case phone changed)
      const users = await storage.getUserByEmail(email || '');
      // New user — create account
      isNewUser = true;
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';

      user = await storage.createUser({
        phone,
        email,
        password: null as any, // TC users don't need password
        username: fullName,
        role: userRole as any,
        truecallerId,
        phoneVerified: true,
        emailVerified: !!email,
        isVerified: true,
        isActive: userRole === 'user', // Employees need admin approval
      });

      // Create role-specific profile
      if (userRole === 'serviceman') {
        await storage.createEmployee({
          userId: user.id,
          fullName,
          // PHASE 1: partnerId, walletBalance, isOnline etc. are now on employees table
          partnerType: 'Individual',
          services: [],
          isActive: false, // Admin must verify
          isOnline: false,
        });
        logger.info(`[TC_AUTH] New employee created: ${phone} (ID: ${user.id})`);
      } else {
        await storage.createCustomer({
          userId: user.id,
          fullName,
        });
        logger.info(`[TC_AUTH] New customer created: ${phone} (ID: ${user.id})`);
      }
    } else {
      // Existing user — update Truecaller ID if not set
      if (!user.truecallerId) {
        await storage.updateUser(user.id, {
          truecallerId,
          phoneVerified: true,
          ...(email && !user.email ? { email } : {}),
        });
      }
      logger.info(`[TC_AUTH] Existing user login: ${phone} (ID: ${user.id})`);
    }

    // Step 5: Generate token pair
    const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });

    // Step 6: Get role-specific profile data
    let profileData = null;
    if (user.role === 'serviceman') {
      const emp = await storage.getEmployeeByUserId(user.id);
      profileData = { employee: emp };
    } else {
      const customer = await storage.getCustomerByUserId(user.id);
      profileData = { customer };
    }

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      user: { ...user, password: undefined },
      profile: profileData,
      ...tokens,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    logger.error('[TC_AUTH] Unexpected error', { error: error.message });
    next(error);
  }
});

// ── Route: Email Verification Request (Authenticated) ─────────────────

router.post('/email/verify-request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const crypto = await import('crypto');
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await storage.createOtpVerification({
      email: normalizedEmail,
      phone: null,
      otp,
      purpose: 'email_verify',
      expiresAt,
    });

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV ONLY] Email verification OTP for ${normalizedEmail} is: ${otp}`);
    }

    // Send via Nodemailer
    const { NotificationService } = await import('../services/notification.service');
    await NotificationService.sendEmail(
      normalizedEmail,
      'UniteFix — Verify Your Email',
      `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #1a1a2e; text-align: center;">Verify Your Email</h2>
        <p style="color: #555; text-align: center;">Use the code below to verify your email address:</p>
        <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
        </div>
        <p style="color: #888; font-size: 13px; text-align: center;">This code expires in 15 minutes.</p>
      </div>`
    );

    logger.info(`[EMAIL_VERIFY] Code sent to ${normalizedEmail} for user ${user.userId}`);
    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (error) {
    next(error);
  }
});

// ── Route: Email Verification Confirm (Authenticated) ─────────────────

router.post('/email/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isValid = await storage.verifyOtp(undefined, normalizedEmail, code, 'email_verify');

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code' });
    }

    // Mark email as verified
    await storage.updateUser(user.userId, {
      email: normalizedEmail,
      emailVerified: true,
    });

    logger.info(`[EMAIL_VERIFY] Email verified: ${normalizedEmail} for user ${user.userId}`);
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
});

// ── Route: Fallback Authentication (Non-Truecaller Users) ─────────────

router.post('/fallback/request-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email } = fallbackRequestSchema.parse(req.body);
    const normalizedPhone = normalizeIndianPhone(phone);
    const normalizedEmail = email.trim().toLowerCase();

    const crypto = await import('crypto');
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store OTP first (so it's valid even if email is slow)
    await storage.createOtpVerification({
      email: normalizedEmail,
      phone: normalizedPhone,
      otp,
      purpose: 'fallback_login',
      expiresAt,
    });

    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV ONLY] Fallback login OTP for ${normalizedEmail} (${normalizedPhone}) is: ${otp}`);
    }

    // Send email — wrap separately so SMTP errors return a clean JSON
    try {
      const { NotificationService } = await import('../services/notification.service');
      await NotificationService.sendEmail(
        normalizedEmail,
        'UniteFix — Login Verification Code',
        `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #1a1a2e; text-align: center;">Your Login Code</h2>
          <p style="color: #555; text-align: center;">Use the code below to log into UniteFix:</p>
          <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 13px; text-align: center;">This code expires in 15 minutes.</p>
        </div>`
      );
    } catch (smtpError: any) {
      logger.error('[FALLBACK_OTP] SMTP send failed', { email: normalizedEmail, error: smtpError.message });
      // OTP is stored — user can retry. Return 503 with clear message body.
      return res.status(503).json({
        success: false,
        message: 'Could not send email right now. Please check your email address and try again.',
      });
    }

    logger.info(`[FALLBACK_OTP] OTP sent to ${normalizedEmail}`);
    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0].message });
    }
    next(error);
  }
});


router.post('/fallback/verify-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email, code, role } = fallbackVerifySchema.parse(req.body);
    const normalizedPhone = normalizeIndianPhone(phone);
    const normalizedEmail = email.trim().toLowerCase();

    const isValid = await storage.verifyOtp(normalizedPhone, normalizedEmail, code, 'fallback_login');
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // OTP is valid, proceed to login/signup
    let user = await storage.getUserByPhone(normalizedPhone);
    let isNewUser = false;

    if (!user) {
      // Also check email to prevent duplicate accounts if phone changed
      const existingEmail = await storage.getUserByEmail(normalizedEmail);
      if (existingEmail) {
        return res.status(400).json({ success: false, message: 'Email is already registered with another phone number.' });
      }

      isNewUser = true;
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';
      const fullName = 'User';

      user = await storage.createUser({
        phone: normalizedPhone,
        email: normalizedEmail,
        password: null as any,
        username: fullName,
        role: userRole as any,
        phoneVerified: false, // Phone isn't strictly verified via SMS, but we trust it for now
        emailVerified: true,
        isVerified: true,
        isActive: userRole === 'user',
      });

      if (userRole === 'serviceman') {
        await storage.createEmployee({
          userId: user.id,
          fullName,
          partnerType: 'Individual',
          services: [],
          isActive: false,
          isOnline: false,
        });
      } else {
        await storage.createCustomer({ userId: user.id, fullName });
      }
    } else {
      // Existing user — ensure email is updated/verified
      if (!user.emailVerified || user.email !== normalizedEmail) {
        await storage.updateUser(user.id, { email: normalizedEmail, emailVerified: true });
      }
    }

    const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });
    let profileData = null;
    if (user.role === 'serviceman') {
      const emp = await storage.getEmployeeByUserId(user.id);
      profileData = { employee: emp };
    } else {
      const customer = await storage.getCustomerByUserId(user.id);
      profileData = { customer };
    }

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      user: { ...user, password: undefined },
      profile: profileData,
      ...tokens,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0].message });
    }
    next(error);
  }
});

// ── Route: Drop Call Verification (Non-Truecaller Users) ─────────────

router.post('/truecaller/verify-dropcall', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accessToken, role } = req.body;
    if (!accessToken) return res.status(400).json({ success: false, message: 'Access Token required' });

    logger.info('[TC_DROP_CALL] Validating Drop Call Token');

    const response = await fetch(`https://sdk-otp-verification-noneu.truecaller.com/v1/otp/client/installation/phoneNumberDetail/${accessToken}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error('[TC_DROP_CALL] Validation failed', { status: response.status, errText });
      return res.status(401).json({ success: false, message: 'Drop Call Verification Failed' });
    }

    const tcProfile = await response.json() as any;
    // Expected tcProfile: { phoneNumber: string, ... }
    if (!tcProfile.phoneNumber) {
      return res.status(400).json({ success: false, message: 'No phone number returned from Truecaller' });
    }

    const phone = normalizeIndianPhone(tcProfile.phoneNumber);
    let user = await storage.getUserByPhone(phone);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';
      const fullName = 'User';

      user = await storage.createUser({
        phone,
        email: null,
        password: null as any,
        username: fullName,
        role: userRole as any,
        truecallerId: null, // Since it's drop call, we might not have a global Truecaller ID
        phoneVerified: true,
        emailVerified: false,
        isVerified: true,
        isActive: userRole === 'user',
      });

      if (userRole === 'serviceman') {
        await storage.createEmployee({
          userId: user.id,
          fullName,
          partnerType: 'Individual',
          services: [],
          isActive: false,
          isOnline: false,
        });
      } else {
        await storage.createCustomer({ userId: user.id, fullName });
      }
    }

    const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });

    let profileData = null;
    if (user.role === 'serviceman') {
      const emp = await storage.getEmployeeByUserId(user.id);
      profileData = { employee: emp };
    } else {
      const customer = await storage.getCustomerByUserId(user.id);
      profileData = { customer };
    }

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      user: { ...user, password: undefined },
      profile: profileData,
      ...tokens,
    });
  } catch (error) {
    logger.error('[TC_DROP_CALL] Error', { error });
    next(error);
  }
});

export function registerTruecallerAuthRoutes(app: any) {
  app.use('/api/auth', router);
  logger.info('[ROUTES] Truecaller auth routes registered');
}
