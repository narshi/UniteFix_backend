/**
 * Auth Landing — explicit Sign Up vs Log In fork.
 *
 * Truecaller authentication is identical for both intents, which previously
 * made them indistinguishable: tapping "Continue with Truecaller" silently
 * created an account for a returning user who mistyped their number, and gave
 * a brand-new user no onboarding. Choosing the intent up front lets the server
 * reject an unknown number on login, and lets signup route into the mandatory
 * profile / location / skills steps.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Image, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation.types';
import { colors } from '../../theme/colors';
import { fontSizes, fontWeights } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { UserPlus, LogIn, ShieldCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<AuthStackParamList, 'AuthLanding'>;

export function AuthLandingScreen({ navigation }: Props) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(24)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]).start();
    }, [fadeAnim, slideAnim]);

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

            <Animated.View
                style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
            >
                <View style={styles.header}>
                    <Image
                        source={require('../../../assets/icon_trimmed.png')}
                        style={styles.logo}
                        resizeMode="contain"
                    />
                    <Text style={styles.title}>Welcome to UniteFix</Text>
                    <Text style={styles.subtitle}>
                        Trusted home services across Uttara Kannada
                    </Text>
                </View>

                <View style={styles.actions}>
                    {/* Signup — collects role, then profile, location and skills */}
                    <Pressable
                        style={styles.primaryCard}
                        onPress={() => navigation.navigate('RoleSelection', { mode: 'signup' })}
                        accessibilityRole="button"
                        accessibilityLabel="Create a new account"
                    >
                        <View style={styles.primaryIcon}>
                            <UserPlus size={22} color={colors.textInverse} strokeWidth={2.4} />
                        </View>
                        <View style={styles.cardText}>
                            <Text style={styles.primaryTitle}>Create an account</Text>
                            <Text style={styles.primarySubtitle}>
                                New here? Set up your profile in a minute.
                            </Text>
                        </View>
                    </Pressable>

                    {/* Login — no role picker; the server returns the stored role */}
                    <Pressable
                        style={styles.secondaryCard}
                        onPress={() =>
                            navigation.navigate('TruecallerAuth', { role: 'user', mode: 'login' })
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Log in to an existing account"
                    >
                        <View style={styles.secondaryIcon}>
                            <LogIn size={22} color={colors.primary} strokeWidth={2.4} />
                        </View>
                        <View style={styles.cardText}>
                            <Text style={styles.secondaryTitle}>I already have an account</Text>
                            <Text style={styles.secondarySubtitle}>
                                Log in with your registered number.
                            </Text>
                        </View>
                    </Pressable>
                </View>

                <View style={styles.footer}>
                    <View style={styles.securityNote}>
                        <ShieldCheck size={14} color={colors.textDisabled} />
                        <Text style={styles.securityText}>
                            Verified by Truecaller, with OTP as a backup
                        </Text>
                    </View>
                    <Pressable onPress={() => navigation.navigate('Legal')} hitSlop={8}>
                        <Text style={styles.legalLink}>Terms & Privacy Policy</Text>
                    </Pressable>
                </View>
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: 'space-between' },

    header: { alignItems: 'center', marginTop: spacing['4xl'] },
    logo: { width: 80, height: 80, borderRadius: radii.xl, marginBottom: spacing.lg },
    title: {
        fontSize: fontSizes['2xl'],
        fontWeight: fontWeights.bold,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: fontSizes.base,
        color: colors.textSecondary,
        textAlign: 'center',
    },

    actions: { gap: spacing.base },
    primaryCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        backgroundColor: colors.primary,
        borderRadius: radii.xl,
        padding: spacing.lg,
        ...shadows.glow,
    },
    primaryIcon: {
        width: 44,
        height: 44,
        borderRadius: radii.lg,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryTitle: {
        fontSize: fontSizes.md,
        fontWeight: fontWeights.semibold,
        color: colors.textInverse,
    },
    primarySubtitle: {
        fontSize: fontSizes.sm,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 2,
    },

    secondaryCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.lg,
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    secondaryIcon: {
        width: 44,
        height: 44,
        borderRadius: radii.lg,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    secondaryTitle: {
        fontSize: fontSizes.md,
        fontWeight: fontWeights.semibold,
        color: colors.textPrimary,
    },
    secondarySubtitle: {
        fontSize: fontSizes.sm,
        color: colors.textSecondary,
        marginTop: 2,
    },
    cardText: { flex: 1 },

    footer: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.xl },
    securityNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    securityText: { fontSize: fontSizes.xs, color: colors.textDisabled },
    legalLink: {
        fontSize: fontSizes.xs,
        color: colors.primary,
        fontWeight: fontWeights.medium,
    },
});
