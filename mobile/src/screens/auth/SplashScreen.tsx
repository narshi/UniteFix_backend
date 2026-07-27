/**
 * Splash Screen — Premium dark branded introduction
 *
 * Features:
 * - Dark branded background (#0F172A)
 * - Logo with subtle glow pulse
 * - Brand wordmark with fade entrance
 * - Minimal loading indicator
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
import { spacing } from '../../theme/spacing';

const { width } = Dimensions.get('window');
const MIN_SPLASH_MS = 2000;

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

export function SplashScreen({ navigation }: Props) {
    const logoFade = useRef(new Animated.Value(0)).current;
    const logoScale = useRef(new Animated.Value(0.85)).current;
    const textFade = useRef(new Animated.Value(0)).current;
    const textSlide = useRef(new Animated.Value(12)).current;
    const dotFade = useRef(new Animated.Value(0)).current;
    const hasNavigated = useRef(false);

    // Subscribe reactively so the component re-renders when these change
    const authLoading = useAuthStore((s) => s.isLoading);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    // --- Animation sequence ---
    useEffect(() => {
        // 1. Logo entrance
        Animated.parallel([
            Animated.timing(logoFade, { toValue: 1, duration: 600, useNativeDriver: true }),
            Animated.spring(logoScale, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
        ]).start();

        // 2. Wordmark entrance (staggered)
        Animated.parallel([
            Animated.timing(textFade, { toValue: 1, duration: 500, delay: 400, useNativeDriver: true }),
            Animated.timing(textSlide, { toValue: 0, duration: 500, delay: 400, useNativeDriver: true }),
        ]).start();

        // 3. Loading dots
        Animated.timing(dotFade, { toValue: 1, duration: 400, delay: 800, useNativeDriver: true }).start();
    }, []);

    // --- Navigation decision ---
    useEffect(() => {
        if (hasNavigated.current) return;
        if (authLoading) return;

        const timer = setTimeout(() => {
            if (hasNavigated.current) return;
            hasNavigated.current = true;

            if (isAuthenticated) {
                if (__DEV__) console.log('[Splash] Authenticated — RootNavigator will switch stacks');
            } else {
                // Land on the signup/login fork rather than assuming signup.
                if (__DEV__) console.log('[Splash] Not authenticated — navigating to AuthLanding');
                navigation.replace('AuthLanding');
            }
        }, MIN_SPLASH_MS);

        return () => clearTimeout(timer);
    }, [authLoading, isAuthenticated]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.backgroundDark} />

            <View style={styles.content}>
                {/* Logo */}
                <Animated.View
                    style={[
                        styles.logoWrapper,
                        { opacity: logoFade, transform: [{ scale: logoScale }] },
                    ]}
                >
                    <View style={styles.logoGlow}>
                        <Image
                            source={require('../../../assets/app_icon.png')}
                            style={styles.logo}
                            resizeMode="contain"
                        />
                    </View>
                </Animated.View>

                {/* Brand wordmark */}
                <Animated.View
                    style={{
                        opacity: textFade,
                        transform: [{ translateY: textSlide }],
                    }}
                >
                    <Text style={styles.brandName}>UniteFix</Text>
                    <Text style={styles.tagline}>Expert repairs at your doorstep</Text>
                </Animated.View>
            </View>

            {/* Footer */}
            <Animated.View style={[styles.footer, { opacity: dotFade }]}>
                <View style={styles.loadingDots}>
                    <View style={[styles.dot, styles.dotActive]} />
                    <View style={styles.dot} />
                    <View style={styles.dot} />
                </View>
                <Text style={styles.loadingText}>
                    {authLoading ? 'Restoring session...' : 'Starting...'}
                </Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.backgroundDark,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: spacing['2xl'],
    },
    logoGlow: {
        borderRadius: 28,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
        elevation: 8,
    },
    logo: {
        width: width * 0.3,
        height: width * 0.3,
        borderRadius: 24,
    },
    brandName: {
        ...typography.display,
        color: colors.textInverse,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    tagline: {
        ...typography.body,
        color: 'rgba(255,255,255,0.5)',
        textAlign: 'center',
        marginTop: spacing.xs,
    },
    footer: {
        alignItems: 'center',
        paddingBottom: 60,
    },
    loadingDots: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: spacing.sm,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
    dotActive: {
        backgroundColor: colors.primary,
    },
    loadingText: {
        ...typography.small,
        color: 'rgba(255,255,255,0.35)',
        letterSpacing: 0.5,
    },
});
