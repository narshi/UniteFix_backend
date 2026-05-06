/**
 * Set Password Screen — Final step of the OTP signup flow
 * Collects username, phone (optional), and password to complete registration
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Wrench, User, Phone, Lock, CheckCircle } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { useAuthStore } from '../../stores/auth.store';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'SetPassword'>;

export function SetPasswordScreen({ navigation, route }: Props) {
    const { signupToken, email } = route.params;

    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const { login: loginToStore } = useAuthStore();

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!username.trim()) {
            newErrors.username = 'Full name is required';
        }
        if (!password) {
            newErrors.password = 'Password is required';
        } else if (password.length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
        }
        if (password !== confirmPassword) {
            newErrors.confirmPassword = 'Passwords do not match';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleComplete = async () => {
        if (!validate()) return;

        setLoading(true);
        try {
            const response = await authApi.completeSignup({
                signupToken,
                password,
                username: username.trim(),
                phone: phone.trim() || undefined,
            });

            const { user, accessToken, refreshToken, token } = response.data;
            await loginToStore(user, accessToken || token, refreshToken || '');

            // Navigation will be handled by the auth state change in the store
        } catch (error) {
            Alert.alert('Registration Failed', getApiErrorMessage(error));
        } finally {
            setLoading(false);
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
                    <View style={styles.iconCircle}>
                        <CheckCircle size={28} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title}>Almost Done!</Text>
                    <Text style={styles.subtitle}>
                        Complete your profile to get started
                    </Text>
                </View>

                {/* Verified badge */}
                <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>
                        ✅  {email} verified
                    </Text>
                </View>

                {/* Form */}
                <View style={styles.form}>
                    <Input
                        label="Full Name"
                        placeholder="Enter your full name"
                        value={username}
                        onChangeText={setUsername}
                        icon={<User size={18} color={colors.textSecondary} />}
                        error={errors.username}
                    />

                    <Input
                        label="Phone Number (Optional)"
                        placeholder="+91 XXXXX XXXXX"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        icon={<Phone size={18} color={colors.textSecondary} />}
                    />

                    <Input
                        label="Create Password"
                        placeholder="Min 6 characters"
                        value={password}
                        onChangeText={setPassword}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.password}
                    />

                    <Input
                        label="Confirm Password"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.confirmPassword}
                    />
                </View>

                {/* Complete button */}
                <Button
                    title="Complete Registration"
                    onPress={handleComplete}
                    loading={loading}
                    disabled={loading}
                    style={styles.completeButton}
                />

                {/* Back to login */}
                <TouchableOpacity
                    style={styles.backToLogin}
                    onPress={() => navigation.navigate('Login')}
                >
                    <Text style={styles.backToLoginText}>Back to Login</Text>
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
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: 60,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    iconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: colors.success || '#22c55e',
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
    },
    verifiedBadge: {
        backgroundColor: '#f0fdf4',
        borderRadius: radii.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        alignSelf: 'center',
        marginBottom: spacing.xl,
        borderWidth: 1,
        borderColor: '#bbf7d0',
    },
    verifiedText: {
        ...typography.caption,
        color: '#16a34a',
        fontWeight: '600',
    },
    form: {
        marginBottom: spacing.lg,
    },
    completeButton: {
        marginBottom: spacing.xl,
    },
    backToLogin: {
        alignItems: 'center',
        marginTop: spacing.md,
    },
    backToLoginText: {
        ...typography.bodyMedium,
        color: colors.primary,
    },
});
