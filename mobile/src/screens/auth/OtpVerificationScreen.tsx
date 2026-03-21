/**
 * OTP Verification Screen — 6-digit PIN entry with timer and resend
 * Used after Forgot Password and Sign Up flows
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    TextInput,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Wrench, ShieldCheck } from 'lucide-react-native';
import { AuthStackParamList } from '../../types/navigation.types';
import { authApi } from '../../api/auth.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<AuthStackParamList, 'OTPVerification'>;

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

export function OtpVerificationScreen({ navigation, route }: Props) {
    const { phone, email, purpose } = route.params;
    const contact = phone || email || '';
    const contactType = phone ? 'phone' : 'email';

    const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
    const [loading, setLoading] = useState(false);
    const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN);
    const [resending, setResending] = useState(false);

    const inputRefs = useRef<(TextInput | null)[]>([]);

    // Countdown timer
    useEffect(() => {
        if (resendTimer <= 0) return;
        const timer = setInterval(() => {
            setResendTimer((prev) => {
                if (prev <= 1) { clearInterval(timer); return 0; }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [resendTimer]);

    const handleOtpChange = (value: string, index: number) => {
        // Only allow digits
        const digit = value.replace(/[^0-9]/g, '');
        if (digit.length > 1) {
            // Handle paste — distribute digits across fields
            const digits = digit.split('').slice(0, OTP_LENGTH);
            const newOtp = [...otp];
            digits.forEach((d, i) => {
                if (index + i < OTP_LENGTH) newOtp[index + i] = d;
            });
            setOtp(newOtp);
            const nextIdx = Math.min(index + digits.length, OTP_LENGTH - 1);
            inputRefs.current[nextIdx]?.focus();
            return;
        }

        const newOtp = [...otp];
        newOtp[index] = digit;
        setOtp(newOtp);

        // Auto-focus next
        if (digit && index < OTP_LENGTH - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyPress = (key: string, index: number) => {
        if (key === 'Backspace' && !otp[index] && index > 0) {
            const newOtp = [...otp];
            newOtp[index - 1] = '';
            setOtp(newOtp);
            inputRefs.current[index - 1]?.focus();
        }
    };

    const otpString = otp.join('');
    const isComplete = otpString.length === OTP_LENGTH;

    const handleVerify = async () => {
        if (!isComplete) {
            Alert.alert('Incomplete', 'Please enter all 6 digits.');
            return;
        }

        setLoading(true);
        try {
            const response = await authApi.verifyOtp({
                [contactType]: contact,
                otp: otpString,
            });

            const token = (response.data as any)?.token || otpString;

            if (purpose === 'reset') {
                navigation.replace('ResetPassword', { token });
            } else {
                // Signup verification — go to login
                Alert.alert('Verified!', 'Your account has been verified. Please log in.', [
                    { text: 'OK', onPress: () => navigation.replace('Login') },
                ]);
            }
        } catch (err) {
            Alert.alert('Invalid OTP', getApiErrorMessage(err));
            // Clear OTP on error
            setOtp(Array(OTP_LENGTH).fill(''));
            inputRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        if (resendTimer > 0) return;
        setResending(true);
        try {
            await authApi.resendOtp({ [contactType]: contact });
            setResendTimer(RESEND_COOLDOWN);
            setOtp(Array(OTP_LENGTH).fill(''));
            inputRefs.current[0]?.focus();
            Alert.alert('Code Sent', `A new code has been sent to your ${contactType}.`);
        } catch (err) {
            Alert.alert('Error', getApiErrorMessage(err));
        } finally {
            setResending(false);
        }
    };

    const maskedContact = phone
        ? `${phone.slice(0, 3)}****${phone.slice(-3)}`
        : email
            ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
            : '';

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
                        <ShieldCheck size={28} color={colors.textInverse} />
                    </View>
                    <Text style={styles.title}>Verify OTP</Text>
                    <Text style={styles.subtitle}>
                        Enter the 6-digit code sent to{'\n'}
                        <Text style={styles.contactText}>{maskedContact}</Text>
                    </Text>
                </View>

                {/* OTP Input Grid */}
                <View style={styles.otpContainer}>
                    {otp.map((digit, index) => (
                        <TextInput
                            key={index}
                            ref={(ref) => { inputRefs.current[index] = ref; }}
                            style={[
                                styles.otpInput,
                                digit ? styles.otpInputFilled : null,
                            ]}
                            value={digit}
                            onChangeText={(val) => handleOtpChange(val, index)}
                            onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                            keyboardType="number-pad"
                            maxLength={index === 0 ? OTP_LENGTH : 1}
                            selectTextOnFocus
                            autoFocus={index === 0}
                        />
                    ))}
                </View>

                {/* Verify Button */}
                <Button
                    title="Verify Code"
                    onPress={handleVerify}
                    loading={loading}
                    disabled={!isComplete}
                    style={{ marginTop: spacing.xl }}
                />

                {/* Resend */}
                <View style={styles.resendRow}>
                    <Text style={styles.resendLabel}>Didn't receive a code?</Text>
                    {resendTimer > 0 ? (
                        <Text style={styles.timerText}>
                            Resend in {Math.floor(resendTimer / 60)}:{(resendTimer % 60).toString().padStart(2, '0')}
                        </Text>
                    ) : (
                        <TouchableOpacity onPress={handleResend} disabled={resending}>
                            <Text style={styles.resendLink}>
                                {resending ? 'Sending...' : 'Resend Code'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Back to Login */}
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
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: 60 },
    backButton: { marginBottom: spacing.lg },
    backArrow: { fontSize: 24, color: colors.textPrimary },
    header: { alignItems: 'center', marginBottom: spacing['3xl'] },
    iconCircle: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.lg, ...shadows.md,
    },
    title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
    subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
    contactText: { color: colors.textPrimary, fontWeight: '600' },
    otpContainer: {
        flexDirection: 'row', justifyContent: 'center', gap: 10,
    },
    otpInput: {
        width: 48, height: 56, borderRadius: radii.md,
        borderWidth: 2, borderColor: colors.border,
        backgroundColor: colors.surface,
        textAlign: 'center', fontSize: 22, fontWeight: '700',
        color: colors.textPrimary,
    },
    otpInputFilled: {
        borderColor: colors.primary, backgroundColor: colors.primarySurface,
    },
    resendRow: {
        flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
        gap: spacing.sm, marginTop: spacing.xl,
    },
    resendLabel: { ...typography.caption, color: colors.textSecondary },
    timerText: { ...typography.caption, color: colors.textDisabled, fontWeight: '600' },
    resendLink: { ...typography.caption, color: colors.primary, fontWeight: '700' },
    backToLogin: { alignItems: 'center', marginTop: spacing['2xl'] },
    backToLoginText: { ...typography.bodyMedium, color: colors.primary },
});
