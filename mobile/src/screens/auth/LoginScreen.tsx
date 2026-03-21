/**
 * Login Screen — Email/Phone + Password + Social login (Google/Facebook)
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
import { Wrench, Mail, Phone, Lock } from 'lucide-react-native';
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
    navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
};

export function LoginScreen({ navigation }: Props) {
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { login: loginToStore } = useAuthStore();
    const { loginWithGoogle, loginWithFacebook, socialLoading } = useSocialAuth();

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!email && !phone) {
            newErrors.email = 'Email or phone number is required';
        }
        if (!password) {
            newErrors.password = 'Password is required';
        } else if (password.length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleLogin = async () => {
        if (!validate()) return;

        setLoading(true);
        try {
            const response = await authApi.login({
                email: email || undefined,
                phone: phone || undefined,
                password,
            });

            const { user, accessToken, refreshToken, token } = response.data;
            await loginToStore(user, accessToken || token, refreshToken || '');
        } catch (error) {
            Alert.alert('Login Failed', getApiErrorMessage(error));
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
                    <Text style={styles.title}>Login</Text>
                    <Text style={styles.subtitle}>We are really happy to have you back!</Text>
                </View>

                {/* Form */}
                <View style={styles.form}>
                    <Input
                        label="E-mail"
                        placeholder="Input your email here"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        icon={<Mail size={18} color={colors.textSecondary} />}
                        error={errors.email}
                    />

                    <Input
                        label="Phone number"
                        placeholder="Input your phone number here"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        icon={<Phone size={18} color={colors.textSecondary} />}
                    />

                    <Input
                        label="Password"
                        placeholder="Input your password here"
                        value={password}
                        onChangeText={setPassword}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.password}
                    />

                    {/* Forgot password */}
                    <View style={styles.optionsRow}>
                        <View />
                        <TouchableOpacity
                            onPress={() => navigation.navigate('ForgotPassword')}
                        >
                            <Text style={styles.forgotText}>Forgotten password?</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Login button */}
                <Button
                    title="Login"
                    onPress={handleLogin}
                    loading={loading}
                    disabled={isSubmitting}
                    style={styles.loginButton}
                />

                {/* Social login */}
                <View style={styles.socialContainer}>
                    <View style={styles.dividerRow}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.orText}>or login with</Text>
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

                {/* Sign up link */}
                <View style={styles.signupRow}>
                    <Text style={styles.signupText}>Don't have an account? </Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                        <Text style={styles.signupLink}>Sign Up</Text>
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
        marginBottom: spacing['2xl'],
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
    optionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: -spacing.sm,
    },
    forgotText: {
        ...typography.caption,
        color: colors.error,
        fontWeight: '500',
    },
    loginButton: {
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
    signupRow: {
        flexDirection: 'row',
        justifyContent: 'center',
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
