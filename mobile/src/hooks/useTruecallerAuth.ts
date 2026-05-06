/**
 * useTruecallerAuth — React hook for Truecaller one-tap verification
 *
 * Wraps the native TruecallerAuth module with a clean React interface.
 * Falls back gracefully when Truecaller is not available (Expo Go, iOS, no TC installed).
 *
 * Usage:
 *   const { isAvailable, authenticate, loading, error } = useTruecallerAuth();
 */

import { useState, useEffect } from 'react';
import { NativeModules, Platform } from 'react-native';

const { TruecallerAuth } = NativeModules;

interface TruecallerProfile {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    email: string;
    isVerified: boolean;
}

interface UseTruecallerAuth {
    isAvailable: boolean;
    authenticate: () => Promise<TruecallerProfile | null>;
    loading: boolean;
    error: string | null;
}

export function useTruecallerAuth(): UseTruecallerAuth {
    const [isAvailable, setIsAvailable] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        checkAvailability();
    }, []);

    const checkAvailability = async () => {
        // Only available on Android with native module
        if (Platform.OS !== 'android' || !TruecallerAuth) {
            setIsAvailable(false);
            return;
        }

        try {
            TruecallerAuth.initialize();
            const usable = await TruecallerAuth.isUsable();
            setIsAvailable(usable);
        } catch {
            setIsAvailable(false);
        }
    };

    const authenticate = async (): Promise<TruecallerProfile | null> => {
        if (!isAvailable || !TruecallerAuth) return null;

        setLoading(true);
        setError(null);

        try {
            const profile: TruecallerProfile = await TruecallerAuth.authenticate();
            return profile;
        } catch (err: any) {
            const msg = err?.message || 'Truecaller authentication failed';
            setError(msg);
            return null;
        } finally {
            setLoading(false);
        }
    };

    return { isAvailable, authenticate, loading, error };
}
