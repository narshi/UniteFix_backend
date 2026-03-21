/**
 * Sign Up Screen — Registration form + Social sign up (Google/Facebook)
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
import { Wrench, User, Mail, Phone, Lock } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { useSocialAuth } from '../../hooks/useSocialAuth';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Signup'>;
};

export function SignupScreen({ navigation }: Props) {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [partnerType, setPartnerType] = useState<'individual' | 'business'>('individual');
    const [agreePrivacy, setAgreePrivacy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { selectedRole, login: loginToStore } = useAuthStore();
    const { loginWithGoogle, loginWithFacebook, socialLoading } = useSocialAuth();
    const isEmployee = selectedRole === 'serviceman';

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!fullName.trim()) newErrors.fullName = 'Full name is required';
        if (!phone.trim()) newErrors.phone = 'Phone number is required';
        if (!password) {
            newErrors.password = 'Password is required';
        } else if (password.length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
        }
        if (!agreePrivacy) newErrors.privacy = 'You must agree to the Privacy Policy';

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSignup = async () => {
        if (!validate()) return;

        setLoading(true);
        try {
            const response = await authApi.signup({
                username: fullName,
                email: email || undefined,
                phone,
                password,
                role: selectedRole,
                partnerType: isEmployee ? partnerType : undefined,
            });

            const { user, accessToken, refreshToken, token } = response.data;
            await loginToStore(user, accessToken || token, refreshToken || '');
        } catch (error) {
            Alert.alert('Sign Up Failed', getApiErrorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const isSubmitting = loading || socialLoading;

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
                    <View style={styles.logoSmall}>
                        <Wrench size={24} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title}>Sign Up</Text>
                    <Text style={styles.subtitle}>Thank you for joining us!</Text>
                </View>

                {/* Form */}
                <View style={styles.form}>
                    <Input
                        label="Full name"
                        placeholder="Input your full name here"
                        value={fullName}
                        onChangeText={setFullName}
                        icon={<User size={18} color={colors.textSecondary} />}
                        error={errors.fullName}
                    />

                    <Input
                        label="E-mail"
                        placeholder="Input your email here"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        icon={<Mail size={18} color={colors.textSecondary} />}
                    />

                    <Input
                        label="Phone number"
                        placeholder="Input your phone number here"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        icon={<Phone size={18} color={colors.textSecondary} />}
                        error={errors.phone}
                    />

                    {/* Employment type (only for employees) */}
                    {isEmployee && (
                        <View style={styles.employmentSection}>
                            <Text style={styles.fieldLabel}>Employment Type</Text>
                            <View style={styles.employmentOptions}>
                                <TouchableOpacity
                                    style={styles.radioOption}
                                    onPress={() => setPartnerType('individual')}
                                >
                                    <View
                                        style={[
                                            styles.radio,
                                            partnerType === 'individual' && styles.radioSelected,
                                        ]}
                                    >
                                        {partnerType === 'individual' && (
                                            <View style={styles.radioInner} />
                                        )}
                                    </View>
                                    <Text style={styles.radioLabel}>Individual</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.radioOption}
                                    onPress={() => setPartnerType('business')}
                                >
                                    <View
                                        style={[
                                            styles.radio,
                                            partnerType === 'business' && styles.radioSelected,
                                        ]}
                                    >
                                        {partnerType === 'business' && (
                                            <View style={styles.radioInner} />
                                        )}
                                    </View>
                                    <Text style={styles.radioLabel}>Business</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <Input
                        label="Password"
                        placeholder="Input your password here"
                        value={password}
                        onChangeText={setPassword}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.password}
                    />

                    {/* Privacy policy */}
                    <TouchableOpacity
                        style={styles.privacyRow}
                        onPress={() => setAgreePrivacy(!agreePrivacy)}
                    >
                        <View
                            style={[
                                styles.checkbox,
                                agreePrivacy && styles.checkboxChecked,
                            ]}
                        >
                            {agreePrivacy && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.privacyText}>
                            I agree to <Text style={styles.privacyLink}>Privacy Policy</Text>
                        </Text>
                    </TouchableOpacity>
                    {errors.privacy && (
                        <Text style={styles.errorText}>{errors.privacy}</Text>
                    )}
                </View>

                {/* Sign up button */}
                <Button
                    title="Sign Up"
                    onPress={handleSignup}
                    loading={loading}
                    disabled={isSubmitting}
                    style={styles.signupButton}
                />

                {/* Social sign up */}
                <View style={styles.socialContainer}>
                    <View style={styles.dividerRow}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.orText}>or sign up with</Text>
                        <View style={styles.dividerLine} />
                    </View>
                    <View style={styles.socialRow}>
                        <TouchableOpacity
                            style={[styles.socialButton, styles.facebookButton]}
                            onPress={loginWithFacebook}
                            disabled={isSubmitting}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.socialIcon}>f</Text>
                            <Text style={styles.socialButtonTextWhite}>Facebook</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.socialButton, styles.googleButton]}
                            onPress={loginWithGoogle}
                            disabled={isSubmitting}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.googleIcon}>G</Text>
                            <Text style={styles.socialButtonTextDark}>Google</Text>
                        </TouchableOpacity>
                    </View>
                </View>

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
    logoSmall: {
        width: 48,
        height: 48,
        borderRadius: radii.md,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.md,
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
    form: {
        marginBottom: spacing.lg,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: colors.textPrimary,
        marginBottom: spacing.sm,
    },
    employmentSection: {
        marginBottom: spacing.base,
    },
    employmentOptions: {
        flexDirection: 'row',
        gap: spacing.lg,
        paddingVertical: spacing.sm,
    },
    radioOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    radio: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioSelected: {
        borderColor: colors.primary,
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: colors.primary,
    },
    radioLabel: {
        ...typography.body,
        color: colors.textPrimary,
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
    socialContainer: {
        marginBottom: spacing.xl,
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.lg,
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
    socialRow: {
        flexDirection: 'row',
        gap: spacing.md,
    },
    socialButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: radii.md,
        gap: spacing.sm,
    },
    facebookButton: {
        backgroundColor: '#1877F2',
    },
    googleButton: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
    },
    socialIcon: {
        fontSize: 18,
        fontWeight: '800',
        color: '#fff',
    },
    googleIcon: {
        fontSize: 18,
        fontWeight: '700',
        color: '#4285F4',
    },
    socialButtonTextWhite: {
        fontSize: 14,
        fontWeight: '600',
        color: '#fff',
    },
    socialButtonTextDark: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.textPrimary,
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
