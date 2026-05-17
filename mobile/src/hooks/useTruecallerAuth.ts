import { useState, useEffect, useCallback } from 'react';
import * as Crypto from 'expo-crypto';
import { Platform, NativeModules, NativeEventEmitter } from 'react-native';

const TruecallerOAuth = NativeModules.TruecallerOAuth;
export const truecallerEmitter = TruecallerOAuth 
  ? new NativeEventEmitter(TruecallerOAuth) 
  : null;

export interface TcOAuthResult {
  authorizationCode: string;
  codeVerifier: string;
}

// Truecaller SDK Error Codes (Mapped from PDF Page 33)
const TC_ERRORS: Record<number | string, string> = {
  0: 'Something went wrong. Please try again.',
  2: 'Verification cancelled while loading.',
  5: 'Truecaller app is not installed or logged in.',
  7: 'Truecaller app closed unexpectedly.',
  10: 'Invalid account state. Please contact Truecaller support.',
  11: 'Verification cancelled.',
  12: 'Partner configuration mismatch.',
  14: 'Verification dismissed.',
  16: 'This device is not supported for 1-tap verification.',
  'NOT_INITIALIZED': 'Truecaller SDK is still initializing...',
  'NO_ACTIVITY': 'App context error. Please restart the app.',
};

export function useTruecallerAuth() {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android' || !TruecallerOAuth) {
      setIsAvailable(false);
      return;
    }

    const init = async () => {
      try {
        await TruecallerOAuth.initialize();
        setIsInitialized(true);

        const usable = await TruecallerOAuth.isUsable();
        setIsAvailable(usable);
      } catch (err: any) {
        console.warn('[TC_AUTH] SDK init failed:', err.message);
        setIsAvailable(false);
      }
    };

    init();

    return () => {
      try {
        TruecallerOAuth?.clear();
      } catch {}
    };
  }, []);

  const setTheme = useCallback(async (theme: 'light' | 'dark') => {
    if (!TruecallerOAuth) return;
    try {
      await TruecallerOAuth.setTheme(theme);
    } catch (err) {
      console.warn('[TC_AUTH] Failed to set theme', err);
    }
  }, []);

  const getAuthorizationCode = useCallback(async (): Promise<TcOAuthResult | null> => {
    if (!TruecallerOAuth) {
      setError('Truecaller is not supported on this device');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Generate State and Code Verifier (PKCE)
      const state = Crypto.randomUUID();
      const codeVerifier = Crypto.randomUUID() + Crypto.randomUUID();
      
      // 2. Generate Base64URL-encoded SHA-256 Code Challenge
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      const codeChallenge = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // 3. Request Authorization Code via Native Bridge
      const result = await TruecallerOAuth.getAuthorizationCode(state, codeChallenge);
      
      if (result?.verificationRequired) return null;

      // 4. Validate State (CSRF Protection - Page 19 of PDF)
      if (result.state !== state) {
        throw new Error('Security Error: Auth state mismatch');
      }
      
      return {
        authorizationCode: result.authorizationCode,
        codeVerifier: codeVerifier 
      };
    } catch (err: any) {
      const errorCode = err.code || err.message;
      const friendlyMessage = TC_ERRORS[errorCode] || 'Verification failed. Please use another method.';
      setError(friendlyMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const requestVerification = useCallback(async (phone: string, countryCode: string = 'IN') => {
    if (!TruecallerOAuth) throw new Error('Truecaller SDK not available');
    return TruecallerOAuth.requestVerification(phone, countryCode);
  }, []);

  const verifyMissedCall = useCallback(async (firstName: string, lastName: string) => {
    if (!TruecallerOAuth) throw new Error('Truecaller SDK not available');
    return TruecallerOAuth.verifyMissedCall(firstName, lastName);
  }, []);

  const clearError = () => setError(null);

  return {
    isAvailable,
    isInitialized,
    isLoading,
    error,
    getAuthorizationCode,
    requestVerification,
    verifyMissedCall,
    setTheme,
    clearError,
  };
}
