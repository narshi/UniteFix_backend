/**
 * Auth API — Truecaller OAuth + Email Verification
 *
 * PRIMARY: Truecaller OAuth (phone verification via SDK 3.x)
 * SECONDARY: Email verification via Nodemailer (post-auth)
 */

import { apiClient } from './client';

// ── Request Types ─────────────────────────────────────────────────────

/**
 * Signup and login share a verification step but are distinct intents.
 * The server refuses to create an account when mode is 'login'.
 */
export type AuthMode = 'login' | 'signup';

export interface TruecallerVerifyRequest {
  authorizationCode: string;
  codeVerifier: string;
  role: 'user' | 'serviceman';
  mode: AuthMode;
}

export interface EmailVerifyRequest {
  email: string;
}

export interface EmailConfirmRequest {
  email: string;
  code: string;
}

// ── Response Types ────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  phone: string | null;
  email: string | null;
  username: string | null;
  role: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  isVerified: boolean;
  isActive: boolean;
  profilePicture: string | null;
  // PHASE 3: Employee verification gate fields
  employeeId: number | null;
  documentVerificationStatus: 'pending' | 'verified' | 'rejected' | 'suspended' | null;
  isOnline: boolean | null;
  /**
   * Mandatory-onboarding gate. Derived server-side from stored data (name +
   * address + pincode, plus skills for technicians) rather than a flag, so an
   * interrupted signup resumes instead of leaking into the app half-configured.
   */
  onboardingCompleted: boolean;
  /**
   * Which steps are still outstanding, in the order to walk them. Server-derived
   * (see server/lib/onboarding.ts) and therefore authoritative — the client must
   * not infer this from user fields, because it does not hold an expert's
   * trades and would send a finished expert back to the trade picker forever.
   */
  pendingOnboardingSteps?: OnboardingStep[];
  homeAddress?: string | null;
  pinCode?: string | null;
}

export type OnboardingStep = 'profile' | 'location' | 'skills';

export interface AuthResponse {
  success: boolean;
  message: string;
  isNewUser: boolean;
  /** True when signup was requested but the number already had an account. */
  alreadyRegistered?: boolean;
  /** False until profile + location (+ skills for technicians) are supplied. */
  onboardingCompleted?: boolean;
  pendingOnboardingSteps?: OnboardingStep[];
  requiresProfile?: boolean;
  user: AuthUser;
  profile: any;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenRefreshResponse {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CheckPhoneResponse {
  success: boolean;
  exists: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  message?: string;
}

// ── API Endpoints ─────────────────────────────────────────────────────

export const authApi = {
  /**
   * PRIMARY AUTH: Exchange Truecaller authorization code for JWT tokens
   * Backend verifies the code server-to-server with Truecaller
   */
  truecallerVerify: (data: TruecallerVerifyRequest) =>
    apiClient.post<AuthResponse>('/api/auth/truecaller/verify', data),

  /**
   * TOKEN REFRESH: Rotate access + refresh tokens
   */
  refreshToken: (refreshToken: string) =>
    apiClient.post<TokenRefreshResponse>('/api/auth/refresh', { refreshToken }),

  /**
   * LOGOUT: Revoke refresh tokens
   */
  logout: () =>
    apiClient.post('/api/auth/logout'),

  /**
   * Check if a phone number exists
   */
  checkPhone: (data: { phone: string }) =>
    apiClient.post<CheckPhoneResponse>('/api/auth/check-phone', data),

  requestFallbackOtp: (data: { phone: string; email?: string; role: 'user' | 'serviceman'; firstName?: string; lastName?: string }) =>
    apiClient.post<AuthResponse>('/api/auth/fallback/request-otp', data),

  /**
   * FALLBACK AUTH: Verify Firebase OTP ID Token
   */
  firebaseVerify: (data: { idToken: string; phone: string; role: 'user' | 'serviceman'; mode?: AuthMode; firstName?: string; lastName?: string; email?: string }) =>
    apiClient.post<AuthResponse>('/api/auth/fallback/firebase-verify', data),

  /**
   * FALLBACK AUTH: Verify OTP for non-Truecaller users
   */
  verifyFallbackOtp: (data: { phone: string; email?: string; code: string; role: 'user' | 'serviceman'; firstName?: string; lastName?: string }) =>
    apiClient.post<AuthResponse>('/api/auth/fallback/verify-otp', data),

  /**
   * DROP CALL AUTH: Validate missed call accessToken for non-TC users
   */
  verifyDropCall: (data: { accessToken: string; role: 'user' | 'serviceman' }) =>
    apiClient.post<AuthResponse>('/api/auth/truecaller/verify-dropcall', data),

  /**
   * EMAIL VERIFICATION: Request verification code (authenticated)
   */
  requestEmailVerification: (data: EmailVerifyRequest) =>
    apiClient.post('/api/auth/email/verify-request', data),

  /**
   * EMAIL VERIFICATION: Confirm code (authenticated)
   */
  confirmEmailVerification: (data: EmailConfirmRequest) =>
    apiClient.post('/api/auth/email/confirm', data),

  /**
   * PROFILE: Get authenticated user's profile
   */
  getProfile: () =>
    apiClient.get('/api/client/profile'),

  /**
   * PROFILE: Update user profile
   */
  updateProfile: (data: Partial<{
    username: string;
    email: string;
    address: string;
    pinCode: string;
  }>) =>
    apiClient.patch('/api/client/profile', data),

  /**
   * ACCOUNT: Delete account
   */
  deleteAccount: () =>
    apiClient.delete('/api/client/account'),
};
