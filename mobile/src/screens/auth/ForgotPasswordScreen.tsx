/**
 * Forgot Password Screen — Enter phone/email → send OTP
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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Wrench, Mail, Phone } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button, Input } from '../../components/ui';

type Props = {
    navigation: NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;
};

export function ForgotPasswordScreen({ navigation }: Props) {
    const [method, setMethod] = useState<'phone' | 'email'>('phone');
    const [value, setValue] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSendOTP = async () => {
        if (!value.trim()) {
            setError(`Please enter your ${method}`);
            return;
        }
        setError('');
        setLoading(true);

        try {
            await authApi.forgotPassword({
                [method]: value,
            });

            Alert.alert(
                'OTP Sent',
                `A reset code has been sent to your ${method}.`,
                [
                    {
                        text: 'OK',
                        onPress: () =>
                            navigation.navigate('OTPVerification', {
                                [method]: value,
                                purpose: 'reset',
                            }),
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
                {/* Header */}
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Text style={styles.backArrow}>←</Text>
                </TouchableOpacity>

                <View style={styles.header}>
                    <View style={styles.logoSmall}>
                        <Wrench size={24} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title}>Forgot Password</Text>
                    <Text style={styles.subtitle}>
                        Enter your registered {method} to receive a reset code
                    </Text>
                </View>

                {/* Method toggle */}
                <View style={styles.methodToggle}>
                    <TouchableOpacity
                        style={[styles.methodButton, method === 'phone' && styles.methodActive]}
                        onPress={() => { setMethod('phone'); setValue(''); setError(''); }}
                    >
                        <Text style={[styles.methodText, method === 'phone' && styles.methodTextActive]}>
                            Phone
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.methodButton, method === 'email' && styles.methodActive]}
                        onPress={() => { setMethod('email'); setValue(''); setError(''); }}
                    >
                        <Text style={[styles.methodText, method === 'email' && styles.methodTextActive]}>
                            Email
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Input */}
                <Input
                    label={method === 'phone' ? 'Phone number' : 'E-mail'}
                    placeholder={
                        method === 'phone'
                            ? 'Enter your phone number'
                            : 'Enter your email address'
                    }
                    value={value}
                    onChangeText={setValue}
                    keyboardType={method === 'phone' ? 'phone-pad' : 'email-address'}
                    autoCapitalize="none"
                    icon={
                        method === 'phone' ? (
                            <Phone size={18} color={colors.textSecondary} />
                        ) : (
                            <Mail size={18} color={colors.textSecondary} />
                        )
                    }
                    error={error}
                />

                <Button
                    title="Send Reset Code"
                    onPress={handleSendOTP}
                    loading={loading}
                    style={{ marginTop: spacing.lg }}
                />

                {/* Back to login */}
                <TouchableOpacity
                    style={styles.backToLogin}
                    onPress={() => navigation.navigate('Login')}
                >
                    <Text style={styles.backToLoginText}>Back to Login</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
    },
    content: {
        flex: 1,
        paddingHorizontal: spacing.xl,
        paddingTop: 60,
    },
    backButton: {
        marginBottom: spacing.lg,
    },
    backArrow: {
        fontSize: 24,
        color: colors.textPrimary,
    },
    header: {
        alignItems: 'center',
        marginBottom: spacing['2xl'],
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
        marginBottom: spacing.sm,
    },
    subtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
    },
    methodToggle: {
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        padding: 4,
        marginBottom: spacing.xl,
    },
    methodButton: {
        flex: 1,
        paddingVertical: spacing.md,
        borderRadius: radii.md - 2,
        alignItems: 'center',
    },
    methodActive: {
        backgroundColor: colors.background,
    },
    methodText: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
    },
    methodTextActive: {
        color: colors.primary,
    },
    backToLogin: {
        alignItems: 'center',
        marginTop: spacing.xl,
    },
    backToLoginText: {
        ...typography.bodyMedium,
        color: colors.primary,
    },
});
