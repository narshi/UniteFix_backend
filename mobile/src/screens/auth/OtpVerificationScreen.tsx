/**
 * OTP Verification Screen — Production implementation
 *
 * Uses:
 * - useOtp hook (all logic)
 * - OTPInput component (all UI)
 *
 * The screen is now just layout + wiring.
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ShieldCheck } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useOtp } from '../../hooks/useOtp';
import { OTPInput } from '../../components/auth/OTPInput';
import { maskContact } from '../../utils/validation';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'OTPVerification'>;

export function OtpVerificationScreen({ navigation, route }: Props) {
    const { phone, email, purpose, role } = route.params;

    const contact = email || phone || '';
    const masked = maskContact(contact);

    const otpState = useOtp(
        { email, phone, purpose, role },
        // ── onSuccess callback ────────────────────────────────────────────
        (payload) => {
            if (purpose === 'signup') {
                navigation.replace('SetPassword', {
                    signupToken: payload.signupToken,
                    email: email || '',
                });
            } else if (purpose === 'reset') {
                navigation.replace('ResetPassword', {
                    token: payload.resetToken || payload.token || '',
                });
            } else {
                navigation.replace('Login');
            }
        },
    );

    const {
        otp, otpString, isComplete,
        resendTimer, canResend,
        loading, resending, errorMessage,
        isLockedOut, attempts,
        handleDigitChange, handleKeyPress, handleVerify, handleResend,
        inputRefs,
    } = otpState;

    const resendLabel = resendTimer > 0
        ? `Resend in ${resendTimer}s`
        : resending
            ? 'Sending...'
            : 'Resend Code';

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* ── Back ─────────────────────────────────────────────── */}
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                    accessibilityLabel="Go back"
                    accessibilityRole="button"
                >
                    <Text style={styles.backArrow}>←</Text>
                </TouchableOpacity>

                {/* ── Header ───────────────────────────────────────────── */}
                <View style={styles.header}>
                    <View style={styles.iconCircle}>
                        <ShieldCheck size={28} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title} accessibilityRole="header">
                        Verify Code
                    </Text>
                    <Text style={styles.subtitle}>
                        We sent a 6-digit code to{'\n'}
                        <Text style={styles.contactText}>{masked}</Text>
                    </Text>
                    <Text style={styles.expiryNote}>
                        Code expires in 15 minutes
                    </Text>
                </View>

                {/* ── Lockout state ─────────────────────────────────────── */}
                {isLockedOut ? (
                    <View style={styles.lockoutCard} accessibilityRole="alert">
                        <Text style={styles.lockoutTitle}>Too many incorrect attempts</Text>
                        <Text style={styles.lockoutBody}>
                            Please tap "Resend Code" to receive a new code.
                        </Text>
                        <TouchableOpacity
                            style={styles.resendButton}
                            onPress={handleResend}
                            disabled={!canResend || resending}
                            accessibilityLabel="Request new OTP code"
                        >
                            <Text style={[
                                styles.resendButtonText,
                                (!canResend || resending) && styles.resendButtonDisabled,
                            ]}>
                                {resending ? 'Sending...' : 'Request New Code'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        {/* ── OTP Input ─────────────────────────────────── */}
                        <View style={styles.otpWrapper}>
                            <OTPInput
                                value={otp}
                                onChange={handleDigitChange}
                                onKeyPress={handleKeyPress}
                                inputRefs={inputRefs}
                                error={errorMessage}
                                autoFocus
                            />
                        </View>

                        {/* ── Verify Button ─────────────────────────────── */}
                        <Button
                            title="Verify Code"
                            onPress={handleVerify}
                            loading={loading}
                            disabled={!isComplete || loading}
                            style={styles.verifyButton}
                            accessibilityLabel="Verify OTP code"
                        />
                    </>
                )}

                {/* ── Resend Row ────────────────────────────────────────── */}
                <View style={styles.resendRow}>
                    <Text style={styles.resendLabel}>Didn't receive it?</Text>
                    {resendTimer > 0 ? (
                        <Text style={styles.timerText}>{resendLabel}</Text>
                    ) : (
                        <TouchableOpacity
                            onPress={handleResend}
                            disabled={!canResend}
                            accessibilityLabel={resendLabel}
                            accessibilityRole="button"
                            style={styles.resendTouchable}
                        >
                            <Text style={[
                                styles.resendLink,
                                !canResend && styles.resendLinkDisabled,
                            ]}>
                                {resendLabel}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* ── Back to Login ─────────────────────────────────────── */}
                <TouchableOpacity
                    style={styles.backToLogin}
                    onPress={() => navigation.navigate('Login')}
                    accessibilityLabel="Back to login"
                    accessibilityRole="link"
                >
                    <Text style={styles.backToLoginText}>← Back to Login</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    content: {
        paddingHorizontal: spacing.xl,
        paddingTop: 60,
        paddingBottom: 40,
    },
    backButton: {
        marginBottom: spacing.lg,
        padding: spacing.xs,
        alignSelf: 'flex-start',
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
    },
    backArrow: {
        fontSize: 24,
        color: colors.textPrimary,
    },
    header: {
        alignItems: 'center',
        marginBottom: spacing['2xl'],
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.lg,
        ...shadows.md,
    },
    title: {
        ...typography.h2,
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 24,
    },
    contactText: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
        fontWeight: '700',
    },
    expiryNote: {
        marginTop: spacing.sm,
        ...typography.small,
        color: colors.textDisabled,
    },
    otpWrapper: {
        marginBottom: spacing.xl,
    },
    verifyButton: {
        marginBottom: spacing.xl,
    },
    resendRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.sm,
        marginBottom: spacing.xl,
    },
    resendLabel: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    timerText: {
        ...typography.caption,
        color: colors.textDisabled,
        fontWeight: '600',
    },
    resendTouchable: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.xs,
        minHeight: 44,
        justifyContent: 'center',
    },
    resendLink: {
        ...typography.caption,
        color: colors.primary,
        fontWeight: '700',
    },
    resendLinkDisabled: {
        color: colors.textDisabled,
    },
    lockoutCard: {
        backgroundColor: colors.errorLight,
        borderRadius: radii.lg,
        padding: spacing.xl,
        marginBottom: spacing.xl,
        alignItems: 'center',
        gap: spacing.md,
        borderWidth: 1,
        borderColor: colors.error,
    },
    lockoutTitle: {
        ...typography.bodyMedium,
        color: colors.error,
        fontWeight: '700',
    },
    lockoutBody: {
        ...typography.caption,
        color: colors.error,
        textAlign: 'center',
        lineHeight: 20,
    },
    resendButton: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.error,
        borderRadius: radii.md,
        minHeight: 44,
        justifyContent: 'center',
    },
    resendButtonText: {
        ...typography.bodyMedium,
        color: colors.textInverse,
        fontWeight: '700',
    },
    resendButtonDisabled: {
        opacity: 0.5,
    },
    backToLogin: {
        alignItems: 'center',
        paddingVertical: spacing.sm,
        minHeight: 44,
        justifyContent: 'center',
    },
    backToLoginText: {
        ...typography.bodyMedium,
        color: colors.primary,
    },
});
