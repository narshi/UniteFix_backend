/**
 * Social authentication hook
 * 
 * Uses expo-auth-session with Google and Facebook OAuth.
 * Gets an ID token from the provider, sends it to our backend
 * /api/auth/social/token endpoint, which verifies and returns a JWT.
 */

import { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Facebook from 'expo-auth-session/providers/facebook';
import { Alert } from 'react-native';
import { authApi } from '../api/auth.api';
import { getApiErrorMessage } from '../api/client';
import { useAuthStore } from '../stores/auth.store';

// Required for auth session redirect on web
WebBrowser.maybeCompleteAuthSession();

// TODO: Replace these with your actual OAuth credentials
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '';
const FACEBOOK_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || '';

export function useSocialAuth() {
    const [loading, setLoading] = useState(false);
    const { login: loginToStore } = useAuthStore();

    // Google Auth
    const [, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
        clientId: GOOGLE_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID,
        androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    });

    // Facebook Auth
    const [, fbResponse, promptFacebookAsync] = Facebook.useAuthRequest({
        clientId: FACEBOOK_APP_ID,
    });

    const handleSocialLogin = async (
        provider: 'google' | 'facebook',
        idToken?: string,
        accessToken?: string
    ) => {
        setLoading(true);
        try {
            const response = await authApi.socialLogin({
                provider,
                idToken,
                accessToken,
            });

            const { user, accessToken: jwt, refreshToken, token } = response.data;
            await loginToStore(user, jwt || token, refreshToken || '');
        } catch (error) {
            Alert.alert('Social Login Failed', getApiErrorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const loginWithGoogle = async () => {
        try {
            const result = await promptGoogleAsync();
            if (result?.type === 'success') {
                const { id_token, access_token } = result.params;
                await handleSocialLogin('google', id_token, access_token);
            }
        } catch (error) {
            Alert.alert('Google Sign In', 'Google sign in was cancelled or failed.');
        }
    };

    const loginWithFacebook = async () => {
        try {
            const result = await promptFacebookAsync();
            if (result?.type === 'success') {
                const { access_token } = result.params;
                await handleSocialLogin('facebook', undefined, access_token);
            }
        } catch (error) {
            Alert.alert('Facebook Sign In', 'Facebook sign in was cancelled or failed.');
        }
    };

    return {
        loginWithGoogle,
        loginWithFacebook,
        socialLoading: loading,
    };
}
