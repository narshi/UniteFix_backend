/**
 * Auth API — Truecaller OAuth + Email Verification
 *
 * PRIMARY: Truecaller OAuth (phone verification via SDK 3.x)
 * SECONDARY: Email verification via Nodemailer (post-auth)
 */

import { apiClient } from './client';

// ── Request Types ─────────────────────────────────────────────────────

export interface TruecallerVerifyRequest {
  authorizationCode: string;
  codeVerifier: string;
  role: 'user' | 'serviceman';
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
}

export interface AuthResponse {
  success: boolean;
  message: string;
  isNewUser: boolean;
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
   * FALLBACK AUTH: Request OTP via email for non-Truecaller users
   */
  requestFallbackOtp: (data: { phone: string; email: string }) =>
    apiClient.post('/api/auth/fallback/request-otp', data),

  /**
   * FALLBACK AUTH: Verify OTP for non-Truecaller users
   */
  verifyFallbackOtp: (data: { phone: string; email: string; code: string; role: 'user' | 'serviceman' }) =>
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
