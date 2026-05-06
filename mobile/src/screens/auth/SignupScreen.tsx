/**
 * Sign Up Screen — Email-first registration with OTP verification
 * Role selection (User / Employee) happens here.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { User, Users, Mail } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuthStore, UserRole } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { useTruecallerAuth } from '../../hooks/useTruecallerAuth';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

export function SignupScreen({ navigation }: Props) {
    const [email, setEmail] = useState('');
    const [agreePrivacy, setAgreePrivacy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { selectedRole, setSelectedRole } = useAuthStore();
    const { isAvailable: tcAvailable, authenticate: tcAuthenticate, loading: tcLoading } = useTruecallerAuth();

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        const trimmed = email.trim();
        if (!trimmed) {
            newErrors.email = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            newErrors.email = 'Please enter a valid email';
        }
        if (!agreePrivacy) {
            newErrors.privacy = 'You must agree to the Privacy Policy';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSendOtp = async () => {
        if (!validate()) return;

        const normalizedEmail = email.trim().toLowerCase();
        setLoading(true);
        try {
            await authApi.initiateSignup({
                email: normalizedEmail,
                role: selectedRole,
            });

            navigation.navigate('OTPVerification', {
                email: normalizedEmail,
                purpose: 'signup',
                role: selectedRole,
            });
        } catch (error) {
            Alert.alert('Error', getApiErrorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleTruecaller = async () => {
        const profile = await tcAuthenticate();
        if (profile) {
            const tcEmail = profile.email || `${profile.phoneNumber}@unitefix.app`;
            const normalizedEmail = tcEmail.trim().toLowerCase();
            try {
                await authApi.initiateSignup({ email: normalizedEmail, role: selectedRole });
                Alert.alert(
                    'Truecaller Verified!',
                    `Welcome ${profile.firstName}! Please check your email to complete signup.`,
                    [{
                        text: 'OK',
                        onPress: () => navigation.navigate('OTPVerification', {
                            email: normalizedEmail,
                            purpose: 'signup',
                            role: selectedRole,
                        }),
                    }]
                );
            } catch (error) {
                Alert.alert('Error', getApiErrorMessage(error));
            }
        }
    };

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
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Text style={styles.backArrow}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.title}>Create Account</Text>
                    <Text style={styles.subtitle}>
                        {selectedRole === 'serviceman'
                            ? 'Join as a service expert'
                            : 'Sign up to get started'}
                    </Text>
                </View>

                {/* Role Selection */}
                <View style={styles.roleSection}>
                    <Text style={styles.roleLabel}>I am signing up as:</Text>
                    <View style={styles.radioRow}>
                        <TouchableOpacity
                            style={[
                                styles.roleCard,
                                selectedRole === 'user' && styles.roleCardSelected,
                            ]}
                            onPress={() => setSelectedRole('user')}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.radioOuter,
                                selectedRole === 'user' && styles.radioOuterSelected,
                            ]}>
                                {selectedRole === 'user' && <View style={styles.radioInner} />}
                            </View>
                            <User size={20} color={selectedRole === 'user' ? colors.primary : colors.textSecondary} />
                            <Text style={[
                                styles.radioText,
                                selectedRole === 'user' && styles.radioTextSelected,
                            ]}>Customer</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.roleCard,
                                selectedRole === 'serviceman' && styles.roleCardSelected,
                            ]}
                            onPress={() => setSelectedRole('serviceman')}
                            activeOpacity={0.7}
                        >
                            <View style={[
                                styles.radioOuter,
                                selectedRole === 'serviceman' && styles.radioOuterSelected,
                            ]}>
                                {selectedRole === 'serviceman' && <View style={styles.radioInner} />}
                            </View>
                            <Users size={20} color={selectedRole === 'serviceman' ? colors.primary : colors.textSecondary} />
                            <Text style={[
                                styles.radioText,
                                selectedRole === 'serviceman' && styles.radioTextSelected,
                            ]}>Employee</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Truecaller One-Tap (Android only, if available) */}
                {tcAvailable && (
                    <View style={styles.truecallerSection}>
                        <TouchableOpacity
                            style={styles.truecallerButton}
                            onPress={handleTruecaller}
                            disabled={tcLoading || loading}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.truecallerIcon}>📱</Text>
                            <Text style={styles.truecallerButtonText}>
                                {tcLoading ? 'Verifying...' : 'Continue with Truecaller'}
                            </Text>
                        </TouchableOpacity>

                        <View style={styles.dividerRow}>
                            <View style={styles.dividerLine} />
                            <Text style={styles.orText}>or use email</Text>
                            <View style={styles.dividerLine} />
                        </View>
                    </View>
                )}

                {/* Email Form */}
                <View style={styles.form}>
                    <Input
                        label="Email address"
                        placeholder="you@example.com"
                        value={email}
                        onChangeText={(text) => {
                            setEmail(text);
                            if (errors.email) setErrors((e) => ({ ...e, email: '' }));
                        }}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        icon={<Mail size={18} color={colors.textSecondary} />}
                        error={errors.email}
                    />

                    <View style={styles.otpNote}>
                        <Text style={styles.otpNoteText}>
                            📧 We'll send a 6-digit verification code to this email
                        </Text>
                    </View>

                    {/* Privacy policy checkbox */}
                    <TouchableOpacity
                        style={styles.privacyRow}
                        onPress={() => setAgreePrivacy(!agreePrivacy)}
                    >
                        <View style={[styles.checkbox, agreePrivacy && styles.checkboxChecked]}>
                            {agreePrivacy && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.privacyText}>
                            I agree to the <Text style={styles.privacyLink}>Privacy Policy</Text>
                        </Text>
                    </TouchableOpacity>
                    {errors.privacy && (
                        <Text style={styles.errorText}>{errors.privacy}</Text>
                    )}
                </View>

                {/* Send OTP button */}
                <Button
                    title="Send Verification Code"
                    onPress={handleSendOtp}
                    loading={loading}
                    disabled={loading}
                    style={styles.signupButton}
                />

                {/* Login link */}
                <View style={styles.loginRow}>
                    <Text style={styles.loginText}>Already have an account? </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                        <Text style={styles.loginLink}>Login</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

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
    backButton: {
        position: 'absolute',
        left: 0,
        top: -10,
    },
    backArrow: {
        fontSize: 24,
        color: colors.textPrimary,
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
    roleSection: {
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        padding: spacing.base,
        marginBottom: spacing.xl,
    },
    roleLabel: {
        ...typography.label,
        color: colors.textSecondary,
        marginBottom: spacing.sm,
    },
    radioRow: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    roleCard: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.base,
        borderRadius: radii.md,
        borderWidth: 1.5,
        borderColor: colors.border,
        backgroundColor: colors.background,
    },
    roleCardSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    radioOuter: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioOuterSelected: {
        borderColor: colors.primary,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.primary,
    },
    radioText: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
        flex: 1,
    },
    radioTextSelected: {
        color: colors.primary,
        fontWeight: '600',
    },
    truecallerSection: {
        marginBottom: spacing.lg,
    },
    truecallerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0085FF',
        paddingVertical: 14,
        borderRadius: radii.md,
        gap: spacing.sm,
        marginBottom: spacing.lg,
    },
    truecallerIcon: {
        fontSize: 18,
    },
    truecallerButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fff',
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: colors.divider,
    },
    orText: {
        ...typography.caption,
        color: colors.textSecondary,
        marginHorizontal: spacing.md,
    },
    form: {
        marginBottom: spacing.lg,
    },
    otpNote: {
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        padding: spacing.base,
        marginTop: spacing.sm,
        marginBottom: spacing.md,
    },
    otpNoteText: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    privacyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        marginTop: spacing.sm,
    },
    checkbox: {
        width: 18,
        height: 18,
        borderWidth: 1.5,
        borderColor: colors.border,
        borderRadius: radii.sm,
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkboxChecked: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    checkmark: {
        color: colors.textInverse,
        fontSize: 12,
        fontWeight: '700',
    },
    privacyText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    privacyLink: {
        color: colors.primary,
        fontWeight: '500',
    },
    errorText: {
        fontSize: 11,
        color: colors.error,
        marginTop: spacing.xs,
    },
    signupButton: {
        marginBottom: spacing.xl,
    },
    loginRow: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
    loginText: {
        ...typography.body,
        color: colors.textSecondary,
    },
    loginLink: {
        ...typography.bodyMedium,
        color: colors.primary,
    },
});
