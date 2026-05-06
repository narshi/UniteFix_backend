/**
 * Splash Screen — White background with UniteFix logo
 *
 * Responsibilities:
 * 1. Shows branding animation (1.5s minimum)
 * 2. Waits for auth store hydration to complete
 * 3. Navigates to Login if unauthenticated (authenticated users are
 *    handled by RootNavigator automatically)
 */

import React, { useEffect, useRef } from 'react';
import {
    View,
    StyleSheet,
    StatusBar,
    Image,
    Animated,
    Dimensions,
    Text,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';

const { width } = Dimensions.get('window');
const MIN_SPLASH_MS = 2000;

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

export function SplashScreen({ navigation }: Props) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.8)).current;
    const hasNavigated = useRef(false);

    // Subscribe reactively so the component re-renders when these change
    const authLoading = useAuthStore((s) => s.isLoading);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    // --- Animation ---
    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.spring(scaleAnim, {
                toValue: 1,
                friction: 6,
                tension: 40,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    // --- Navigation decision ---
    // Runs every time authLoading or isAuthenticated changes.
    useEffect(() => {
        if (hasNavigated.current) return;

        // Still hydrating? Wait.
        if (authLoading) return;

        // Hydration done — enforce minimum branding time then decide.
        const timer = setTimeout(() => {
            if (hasNavigated.current) return;
            hasNavigated.current = true;

            if (isAuthenticated) {
                // RootNavigator will swap AuthStack → CustomerStack/PartnerStack
                // automatically because isAuthenticated is now true AND isLoading
                // is false. We don't need to navigate anywhere.
                console.log('[Splash] Authenticated — RootNavigator will switch stacks');
            } else {
                console.log('[Splash] Not authenticated — navigating to Login');
                navigation.replace('Login');
            }
        }, MIN_SPLASH_MS);

        return () => clearTimeout(timer);
    }, [authLoading, isAuthenticated]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

            <View style={styles.content}>
                <Animated.View
                    style={[
                        styles.logoWrapper,
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: scaleAnim }],
                        },
                    ]}
                >
                    <Image
                        source={require('../../../assets/logo.jpg')}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                </Animated.View>

                <View style={styles.footer}>
                    <Text style={styles.loadingText}>
                        {authLoading ? 'Restoring session…' : 'Starting…'}
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    logo: {
        width: width * 0.55,
        height: width * 0.55,
        borderRadius: 20,
    },
    footer: {
        position: 'absolute',
        bottom: 60,
        width: '100%',
        alignItems: 'center',
    },
    loadingText: {
        ...typography.caption,
        color: colors.textDisabled,
        letterSpacing: 0.5,
    },
});
