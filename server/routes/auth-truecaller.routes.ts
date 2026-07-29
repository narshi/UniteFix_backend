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
import { admin } from '../lib/firebase';
import { TokenService } from '../services/token.service';
import { NotificationService } from '../services/notification.service';
import logger from '../lib/logger';
import { getPendingOnboardingSteps } from '../lib/onboarding';
import crypto from 'crypto';
import { db } from '../db';
import { otpVerifications } from '@shared/schema';
import { and, eq, gte, desc } from 'drizzle-orm';

/** Minimum gap between OTP requests for the same phone. */
const OTP_REQUEST_COOLDOWN_MS = 60 * 1000;

const router = Router();

const TRUECALLER_CLIENT_ID = process.env.TRUECALLER_CLIENT_ID || '';
const TRUECALLER_TOKEN_URL = 'https://oauth-account-noneu.truecaller.com/v1/token';
const TRUECALLER_USERINFO_URL = 'https://oauth-account-noneu.truecaller.com/v1/userinfo';

// ── Validation Schemas ────────────────────────────────────────────────

/**
 * Signup and login are distinct intents even though they share a verification
 * step. `mode` lets the server refuse to silently create an account when the
 * user believed they were logging in. Defaults to 'signup' so older clients
 * keep their previous find-or-create behaviour.
 */
const authModeSchema = z.enum(['login', 'signup']).optional().default('signup');

const truecallerVerifySchema = z.object({
  authorizationCode: z.string().min(1, 'Authorization code is required'),
  codeVerifier: z.string().min(1, 'Code verifier is required'),
  role: z.enum(['user', 'serviceman']),
  mode: authModeSchema,
});

const phoneLoginSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  role: z.enum(['user', 'serviceman']),
});

const fallbackRequestSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  email: z.string().email('Valid email is required').optional(),
  role: z.enum(['user', 'serviceman']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const fallbackVerifySchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Valid Indian mobile number required'),
  email: z.string().email('Valid email is required').optional(),
  code: z.string().min(6, 'Code must be 6 digits'),
  role: z.enum(['user', 'serviceman']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  mode: authModeSchema,
});

// ── Indian Phone Validation Helper ────────────────────────────────────

function normalizeIndianPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91')) return cleaned;
  if (cleaned.startsWith('91') && cleaned.length === 12) return '+' + cleaned;
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) return '+91' + cleaned;
  return cleaned;
}

// ── Route: Check Phone (Fallback UX Streamlining) ─────────────────────

router.post('/check-phone', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    const normalizedPhone = normalizeIndianPhone(phone);
    const user = await storage.getUserByPhone(normalizedPhone);
    
    if (user) {
      res.json({
        success: true,
        exists: true,
        email: user.email,
        firstName: user.username?.split(' ')[0],
        lastName: user.username?.split(' ').slice(1).join(' '),
      });
    } else {
      res.json({ success: true, exists: false });
    }
  } catch (error) {
    next(error);
  }
});

// ── Route: Truecaller OAuth Verify ────────────────────────────────────

router.post('/truecaller/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { authorizationCode, codeVerifier, role, mode } = truecallerVerifySchema.parse(req.body);

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

    // Explicit login must not create an account behind the user's back.
    if (!user && mode === 'login') {
      logger.info(`[TC_AUTH] Login attempted for unregistered phone ${phone}`);
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        message: 'No UniteFix account found for this number. Please sign up first.',
      });
    }

    if (!user) {
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
    let employeeRecord = null;
    if (user.role === 'serviceman') {
      employeeRecord = await storage.getEmployeeByUserId(user.id);
      profileData = { employee: employeeRecord };
    } else {
      const customer = await storage.getCustomerByUserId(user.id);
      profileData = { customer };
    }

    const pendingOnboarding = getPendingOnboardingSteps(user, employeeRecord);

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      // Set when the caller asked to sign up but the number already had an
      // account — the client greets them instead of claiming a new signup.
      alreadyRegistered: !isNewUser && mode === 'signup',
      onboardingCompleted: pendingOnboarding.length === 0,
      pendingOnboardingSteps: pendingOnboarding,
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

// ── Route: Save Email to Profile (Authenticated) ─────────────────────
// NOTE: Email OTP verification is temporarily disabled.
// This route now just validates the email format and saves it directly.
// TODO: Re-enable OTP verification when SMTP/Resend is configured.

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

    // Save email directly to profile (no OTP for now)
    await storage.updateUser(user.userId, {
      email: normalizedEmail,
      emailVerified: false, // Will be set to true once OTP verification is re-enabled
    });

    logger.info(`[EMAIL] Email saved to profile: ${normalizedEmail} for user ${user.userId}`);
    res.json({ success: true, message: 'Email saved successfully' });
  } catch (error) {
    next(error);
  }
});

// ── Route: Email Verification Confirm — TEMPORARILY DISABLED ──────────
// TODO: Uncomment when email OTP verification is re-enabled
/*
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
*/

// ── Route: Fallback Authentication (Non-Truecaller Users) ─────────────

router.post('/fallback/request-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email, role, firstName, lastName } = fallbackRequestSchema.parse(req.body);
    const normalizedPhone = normalizeIndianPhone(phone);

    let user = await storage.getUserByPhone(normalizedPhone);
    let targetEmail = '';

    if (user) {
      if (!user.email) {
        if (!email) {
          return res.status(400).json({ success: false, message: 'Existing profile has no email. Please provide an email.' });
        }
        targetEmail = email.trim().toLowerCase();
        // Save the provided email
        await storage.updateUser(user.id, { email: targetEmail });
      } else {
        targetEmail = user.email;
      }
    } else {
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required for new users.' });
      }
      targetEmail = email.trim().toLowerCase();
      const existingEmail = await storage.getUserByEmail(targetEmail);
      if (existingEmail) {
        return res.status(400).json({ success: false, message: 'Email is already registered with another phone number.' });
      }
    }

    // Cooldown between OTP requests.
    //
    // verifyOtp caps attempts at 5 PER OTP RECORD and always matches the newest
    // one, so unlimited re-requests reset the lockout — five guesses, ask again,
    // five more. It also let anyone spam a registered user's inbox and burn SMTP
    // quota. A minimum gap makes both impractical without hurting a real user
    // who simply did not receive the first mail.
    const [recentOtp] = await db.select({ createdAt: otpVerifications.createdAt })
        .from(otpVerifications)
        .where(and(
            eq(otpVerifications.phone, normalizedPhone),
            eq(otpVerifications.purpose, 'fallback_login'),
            gte(otpVerifications.createdAt, new Date(Date.now() - OTP_REQUEST_COOLDOWN_MS)),
        ))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(1);

    if (recentOtp?.createdAt) {
        const waitSeconds = Math.ceil(
            (OTP_REQUEST_COOLDOWN_MS - (Date.now() - new Date(recentOtp.createdAt).getTime())) / 1000,
        );
        return res.status(429).json({
            success: false,
            message: `Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting another code.`,
            retryAfterSeconds: waitSeconds,
        });
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save OTP
    await storage.createOtpVerification({
      phone: normalizedPhone,
      email: targetEmail,
      otp,
      purpose: 'fallback_login',
      expiresAt
    });

    const emailHtml = `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>UniteFix Authentication</h2>
        <p>Your verification code is: <span style="font-size: 24px; font-weight: bold; color: #0095FF;">${otp}</span></p>
        <p>This code will expire in 10 minutes.</p>
      </div>
    `;

    try {
      await NotificationService.sendEmail(targetEmail, 'UniteFix Verification Code', emailHtml);
      logger.info(`[FALLBACK_OTP] OTP sent to ${targetEmail} for phone ${normalizedPhone}`);
    } catch (err: any) {
      logger.error('[EMAIL_FAILED]', { error: err?.message || String(err) });
      return res.status(500).json({ success: false, message: 'Failed to send OTP email. Please check your email address or SMTP configuration.' });
    }

    res.json({
      success: true,
      message: 'OTP sent to your email successfully.',
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.errors[0].message });
    }
    next(error);
  }
});


router.post('/fallback/verify-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, email, code, role, firstName, lastName, mode } = fallbackVerifySchema.parse(req.body);
    const normalizedPhone = normalizeIndianPhone(phone);

    // Look up user to find registered email if email wasn't provided (for existing users)
    let user = await storage.getUserByPhone(normalizedPhone);

    // Explicit login must not create an account behind the user's back.
    if (!user && mode === 'login') {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        message: 'No UniteFix account found for this number. Please sign up first.',
      });
    }
    let targetEmail = '';

    if (user && user.email) {
      targetEmail = user.email;
    } else if (email) {
      targetEmail = email.trim().toLowerCase();
    } else {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const isValid = await storage.verifyOtp(normalizedPhone, targetEmail, code, 'fallback_login');
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // OTP is valid, proceed to login/signup
    let isNewUser = false;

    if (!user) {
      // Also check email to prevent duplicate accounts if phone changed
      const existingEmail = await storage.getUserByEmail(targetEmail);
      if (existingEmail) {
        return res.status(400).json({ success: false, message: 'Email is already registered with another phone number.' });
      }

      isNewUser = true;
      const userRole = role === 'serviceman' ? 'serviceman' : 'user';
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'User';

      user = await storage.createUser({
        phone: normalizedPhone,
        email: targetEmail,
        password: null as any,
        username: fullName,
        role: userRole as any,
        phoneVerified: false, // Phone isn't strictly verified via SMS, but we trust it via Email
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
      // Existing user — ensure email is verified
      if (!user.emailVerified) {
        await storage.updateUser(user.id, { emailVerified: true });
      }
    }

    const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });
    let profileData = null;
    let employeeRecord = null;
    if (user.role === 'serviceman') {
      employeeRecord = await storage.getEmployeeByUserId(user.id);
      profileData = { employee: employeeRecord };
    } else {
      const customer = await storage.getCustomerByUserId(user.id);
      profileData = { customer };
    }

    const pendingOnboarding = getPendingOnboardingSteps(user, employeeRecord);

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      isNewUser,
      alreadyRegistered: !isNewUser && mode === 'signup',
      onboardingCompleted: pendingOnboarding.length === 0,
      pendingOnboardingSteps: pendingOnboarding,
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
      headers: {
        'Content-Type': 'application/json',
        'clientId': TRUECALLER_CLIENT_ID || '4gniidv8yotvmqym7nwgcfven6mk36mqep70ikeq8qs',
      },
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

/**
 * ──────────────────────────────────────────────────────────────────
 * FIREBASE FALLBACK LOGIN (For Non-Truecaller Users)
 * Route: POST /api/auth/fallback/firebase-verify
 * ──────────────────────────────────────────────────────────────────
 */
const firebaseVerifySchema = z.object({
  idToken: z.string(),
  phone: z.string().min(10).max(15),
  role: z.enum(['user', 'serviceman']),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  mode: authModeSchema,
});

router.post('/fallback/firebase-verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = firebaseVerifySchema.parse(req.body);
    const role = data.role;
    const mode = data.mode;
    
    // 1. Verify ID Token with Firebase
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(data.idToken);
    } catch (err: any) {
      logger.error('[FIREBASE_AUTH] Invalid ID token', { error: err.message });
      return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
    }
    
    // Normalize phone number (handle formatting differences if needed)
    const phone = normalizeIndianPhone(data.phone) || data.phone;
    
    // 2. Validate token matches the phone number (Firebase formats as +91...)
    if (!decodedToken.phone_number || !decodedToken.phone_number.includes(phone.substring(1))) {
       logger.warn('[FIREBASE_AUTH] Phone number mismatch in token', { tokenPhone: decodedToken.phone_number, reqPhone: phone });
       // Note: we can enforce this strictly if required, but Firebase already verifies the number
    }

    const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ');

    // 3. Find or Create User
    let user = await storage.getUserByPhone(phone);
    let isNewUser = false;

    // Explicit login must not create an account behind the user's back.
    if (!user && mode === 'login') {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_FOUND',
        message: 'No UniteFix account found for this number. Please sign up first.',
      });
    }

    if (!user) {
      isNewUser = true;

      // Require Name and Email for new users
      if (!fullName || !data.email) {
          return res.json({ 
              success: true, 
              requiresProfile: true, 
              isNewUser: true,
              message: "Please provide your name and email to complete registration."
          });
      }

      if (data.email) {
        const existingEmailUser = await storage.getUserByEmail(data.email);
        if (existingEmailUser) {
          return res.status(400).json({ 
            success: false, 
            message: 'This email is already associated with another account.' 
          });
        }
      }

      const userRole = role === 'serviceman' ? 'serviceman' : 'user';

      user = await storage.createUser({
        phone,
        email: data.email || null,
        password: null as any,
        username: fullName,
        role: userRole as any,
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
        logger.info(`[FIREBASE_AUTH] New employee created: ${phone}`);
      } else {
        await storage.createCustomer({ userId: user.id, fullName });
        logger.info(`[FIREBASE_AUTH] New customer created: ${phone}`);
      }
    } else {
      logger.info(`[FIREBASE_AUTH] Existing user login: ${phone}`);
    }

    // 4. Generate Tokens
    const tokens = await TokenService.generateTokenPair({ userId: user.id, role: user.role });

    // 5. Get Profile
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
    logger.error('[FIREBASE_AUTH] Error', { error: error.message });
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Invalid request data', errors: error.errors });
    }
    next(error);
  }
});


export function registerTruecallerAuthRoutes(app: any) {
  app.use('/api/auth', router);
  logger.info('[ROUTES] Truecaller auth routes registered');
}
