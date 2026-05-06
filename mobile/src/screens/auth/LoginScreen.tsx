/**
 * Login Screen — Production-grade implementation
 *
 * Features:
 * - Single identifier input (auto-detects email vs phone)
 * - Password login (default)
 * - OTP login toggle (passwordless)
 * - Brute-force protection (5 attempts → 60s lockout)
 * - Structured error messages
 * - Accessibility labels
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Image,
    Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Mail, Lock, Phone } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuth } from '../../hooks/useAuth';
import { detectIdentifierType } from '../../utils/validation';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

const { width } = Dimensions.get('window');

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

export function LoginScreen({ navigation }: Props) {
    const {
        identifier, setIdentifier,
        password, setPassword,
        loginMode, setLoginMode,
        errors, clearError,
        loginAttempts, lockoutRemaining, isLockedOut,
        loading,
        handlePasswordLogin,
        handleRequestOtpLogin,
    } = useAuth();

    // Detect what type of identifier the user is typing for smart icon/hint
    const identifierType = detectIdentifierType(identifier);
    const IdentifierIcon = identifierType === 'phone'
        ? <Phone size={18} color={colors.textSecondary} />
        : <Mail size={18} color={colors.textSecondary} />;

    const handleOtpLogin = async () => {
        const contact = await handleRequestOtpLogin();
        if (!contact) return;
        navigation.navigate('OTPVerification', {
            email: contact.email,
            phone: contact.phone,
            purpose: 'reset',  // reuses reset OTP flow for passwordless login
        });
    };

    const lockoutLabel = lockoutRemaining > 0
        ? `Too many attempts. Try again in ${lockoutRemaining}s`
        : null;

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ── Logo & Header ──────────────────────────────────────── */}
                <View style={styles.header}>
                    <Image
                        source={require('../../../assets/logo.jpg')}
                        style={styles.logoImage}
                        resizeMode="contain"
                        accessibilityLabel="UniteFix logo"
                    />
                    <Text style={styles.title} accessibilityRole="header">
                        Welcome Back
                    </Text>
                    <Text style={styles.subtitle}>
                        Sign in to your UniteFix account
                    </Text>
                </View>

                {/* ── Login Mode Toggle ─────────────────────────────────── */}
                <View style={styles.modeToggle} accessibilityRole="tablist">
                    <TouchableOpacity
                        style={[styles.modeTab, loginMode === 'password' && styles.modeTabActive]}
                        onPress={() => setLoginMode('password')}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: loginMode === 'password' }}
                        accessibilityLabel="Password login"
                    >
                        <Text style={[styles.modeText, loginMode === 'password' && styles.modeTextActive]}>
                            Password
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modeTab, loginMode === 'otp' && styles.modeTabActive]}
                        onPress={() => setLoginMode('otp')}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: loginMode === 'otp' }}
                        accessibilityLabel="OTP / passwordless login"
                    >
                        <Text style={[styles.modeText, loginMode === 'otp' && styles.modeTextActive]}>
                            Login with OTP
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* ── Lockout Banner ────────────────────────────────────── */}
                {isLockedOut && lockoutLabel && (
                    <View style={styles.lockoutBanner} accessibilityRole="alert">
                        <Text style={styles.lockoutText}>🔒 {lockoutLabel}</Text>
                    </View>
                )}

                {/* ── Form Error ────────────────────────────────────────── */}
                {errors.form ? (
                    <View style={styles.formError} accessibilityRole="alert">
                        <Text style={styles.formErrorText}>{errors.form}</Text>
                    </View>
                ) : null}

                {/* ── Fields ───────────────────────────────────────────── */}
                <View style={styles.form}>
                    <Input
                        label="Email or Phone"
                        placeholder={
                            identifierType === 'phone'
                                ? 'e.g. +91 98765 43210'
                                : 'you@example.com'
                        }
                        value={identifier}
                        onChangeText={setIdentifier}
                        keyboardType={identifierType === 'phone' ? 'phone-pad' : 'email-address'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!isLockedOut}
                        icon={IdentifierIcon}
                        error={errors.identifier}
                        accessibilityLabel="Email address or phone number"
                    />

                    {loginMode === 'password' && (
                        <>
                            <Input
                                label="Password"
                                placeholder="Enter your password"
                                value={password}
                                onChangeText={(v) => { setPassword(v); clearError('password'); }}
                                isPassword
                                editable={!isLockedOut}
                                icon={<Lock size={18} color={colors.textSecondary} />}
                                error={errors.password}
                                accessibilityLabel="Password"
                            />

                            <TouchableOpacity
                                style={styles.forgotRow}
                                onPress={() => navigation.navigate('ForgotPassword')}
                                accessibilityLabel="Forgot password"
                                accessibilityRole="link"
                            >
                                <Text style={styles.forgotText}>Forgot password?</Text>
                            </TouchableOpacity>
                        </>
                    )}

                    {loginMode === 'otp' && (
                        <View style={styles.otpHint}>
                            <Text style={styles.otpHintText}>
                                📧 We'll send a one-time code to your email or phone
                            </Text>
                        </View>
                    )}
                </View>

                {/* ── Action Button ─────────────────────────────────────── */}
                <Button
                    title={
                        isLockedOut
                            ? `Locked (${lockoutRemaining}s)`
                            : loginMode === 'password'
                                ? 'Login'
                                : 'Send OTP'
                    }
                    onPress={loginMode === 'password' ? handlePasswordLogin : handleOtpLogin}
                    loading={loading}
                    disabled={isLockedOut || loading}
                    style={styles.actionButton}
                    accessibilityLabel={loginMode === 'password' ? 'Login with password' : 'Send one-time password'}
                />

                {/* ── Attempt counter ───────────────────────────────────── */}
                {loginAttempts > 0 && !isLockedOut && (
                    <Text style={styles.attemptWarning}>
                        {MAX_ATTEMPTS - loginAttempts} login attempt{MAX_ATTEMPTS - loginAttempts !== 1 ? 's' : ''} remaining
                    </Text>
                )}

                {/* ── Sign Up Link ──────────────────────────────────────── */}
                <View style={styles.signupRow}>
                    <Text style={styles.signupText}>Don't have an account? </Text>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Signup')}
                        accessibilityLabel="Create a new account"
                        accessibilityRole="link"
                    >
                        <Text style={styles.signupLink}>Sign Up</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const MAX_ATTEMPTS = 5;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: 60,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    logoImage: {
        width: width * 0.22,
        height: width * 0.22,
        borderRadius: radii.lg,
        marginBottom: spacing.lg,
        ...shadows.sm,
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
    },
    modeToggle: {
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        padding: 4,
        marginBottom: spacing.xl,
    },
    modeTab: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: radii.md,
        alignItems: 'center',
    },
    modeTabActive: {
        backgroundColor: colors.background,
        ...shadows.sm,
    },
    modeText: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '500',
    },
    modeTextActive: {
        color: colors.primary,
        fontWeight: '700',
    },
    lockoutBanner: {
        backgroundColor: colors.errorLight,
        borderRadius: radii.md,
        padding: spacing.base,
        marginBottom: spacing.base,
        borderLeftWidth: 3,
        borderLeftColor: colors.error,
    },
    lockoutText: {
        ...typography.caption,
        color: colors.error,
        fontWeight: '600',
    },
    formError: {
        backgroundColor: colors.errorLight,
        borderRadius: radii.md,
        padding: spacing.base,
        marginBottom: spacing.base,
        borderLeftWidth: 3,
        borderLeftColor: colors.error,
    },
    formErrorText: {
        ...typography.caption,
        color: colors.error,
        fontWeight: '500',
    },
    form: {
        marginBottom: spacing.base,
    },
    forgotRow: {
        alignSelf: 'flex-end',
        marginTop: spacing.sm,
        paddingVertical: spacing.xs,  // minimum 44pt touch target
        paddingHorizontal: spacing.sm,
    },
    forgotText: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '600',
    },
    otpHint: {
        backgroundColor: colors.primarySurface,
        borderRadius: radii.md,
        padding: spacing.base,
        marginTop: spacing.sm,
    },
    otpHintText: {
        ...typography.caption,
        color: colors.primary,
        textAlign: 'center',
        lineHeight: 20,
    },
    actionButton: {
        marginBottom: spacing.base,
    },
    attemptWarning: {
        textAlign: 'center',
        fontSize: 12,
        color: colors.warning,
        fontWeight: '500',
        marginBottom: spacing.base,
    },
    signupRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.sm,
    },
    signupText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    signupLink: {
        ...typography.bodyMedium,
        color: colors.primary,
    },
});
