/**
 * Reset Password Screen — Enter new password after OTP verification
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Lock, Wrench } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'ResetPassword'>;

export function ResetPasswordScreen({ navigation, route }: Props) {
    const { token } = route.params;

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

    const validate = () => {
        const e: typeof errors = {};
        if (!password) e.password = 'Password is required';
        else if (password.length < 6) e.password = 'Password must be at least 6 characters';
        if (!confirmPassword) e.confirm = 'Please confirm your password';
        else if (password !== confirmPassword) e.confirm = 'Passwords do not match';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleReset = async () => {
        if (!validate()) return;

        setLoading(true);
        try {
            await authApi.resetPassword({ token, password });

            Alert.alert(
                'Password Reset!',
                'Your password has been updated. Please log in with your new password.',
                [
                    {
                        text: 'Go to Login',
                        onPress: () => navigation.navigate('Login'),
                    },
                ]
            );
        } catch (err) {
            Alert.alert('Error', getApiErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <View style={styles.content}>
                {/* Back */}
                <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Text style={styles.backArrow}>←</Text>
                </TouchableOpacity>

                {/* Header */}
                <View style={styles.header}>
                    <View style={styles.iconCircle}>
                        <Lock size={24} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title}>Reset Password</Text>
                    <Text style={styles.subtitle}>
                        Create a new, strong password for your account
                    </Text>
                </View>

                {/* Password fields */}
                <View style={styles.form}>
                    <Input
                        label="New Password"
                        placeholder="Enter new password"
                        value={password}
                        onChangeText={(val) => { setPassword(val); setErrors((e) => ({ ...e, password: '' })); }}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.password}
                    />

                    <Input
                        label="Confirm Password"
                        placeholder="Confirm new password"
                        value={confirmPassword}
                        onChangeText={(val) => { setConfirmPassword(val); setErrors((e) => ({ ...e, confirm: '' })); }}
                        isPassword
                        icon={<Lock size={18} color={colors.textSecondary} />}
                        error={errors.confirm}
                    />

                    {/* Password strength hints */}
                    <View style={styles.hints}>
                        <PasswordHint text="At least 6 characters" met={password.length >= 6} />
                        <PasswordHint text="Contains a number" met={/\d/.test(password)} />
                        <PasswordHint text="Passwords match" met={password.length > 0 && password === confirmPassword} />
                    </View>

                    <Button
                        title="Reset Password"
                        onPress={handleReset}
                        loading={loading}
                        style={{ marginTop: spacing.xl }}
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

function PasswordHint({ text, met }: { text: string; met: boolean }) {
    return (
        <View style={styles.hintRow}>
            <View style={[styles.hintDot, met && styles.hintDotMet]} />
            <Text style={[styles.hintText, met && styles.hintTextMet]}>{text}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 60 },
    backButton: { marginBottom: spacing.lg },
    backArrow: { fontSize: 24, color: colors.textPrimary },
    header: { alignItems: 'center', marginBottom: spacing['2xl'] },
    iconCircle: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.lg, ...shadows.md,
    },
    title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
    subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    form: { gap: spacing.md },
    hints: { marginTop: spacing.md, gap: spacing.sm },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    hintDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors.border,
    },
    hintDotMet: { backgroundColor: colors.success },
    hintText: { ...typography.small, color: colors.textDisabled },
    hintTextMet: { color: colors.success },
});
