/**
 * OTP Display Screen — Customer shows OTP to technician for verification
 * Role: 🟦 Customer only
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, ShieldCheck, RefreshCw, Clock } from 'lucide-react-native';
import { TouchableOpacity } from 'react-native';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'OtpDisplay'>;

const OTP_VALIDITY_SECONDS = 300; // 5 minutes

export function OtpDisplayScreen({ navigation, route }: Props) {
    const serviceId = route.params?.serviceId;

    const [otp, setOtp] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [expiryTimer, setExpiryTimer] = useState(OTP_VALIDITY_SECONDS);

    const generateOtp = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const response = await apiClient.post(`/api/customer/services/${serviceId}/generate-otp`);
            const data = response.data as any;
            setOtp(data.otp || data.data?.otp);
            setExpiryTimer(OTP_VALIDITY_SECONDS);
        } catch (err) {
            Alert.alert('Error', getApiErrorMessage(err));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        generateOtp();
    }, []);

    // Countdown timer
    useEffect(() => {
        if (!otp || expiryTimer <= 0) return;
        const timer = setInterval(() => {
            setExpiryTimer((prev) => {
                if (prev <= 1) { clearInterval(timer); return 0; }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [otp, expiryTimer]);

    const isExpired = expiryTimer <= 0;
    const minutes = Math.floor(expiryTimer / 60);
    const seconds = expiryTimer % 60;

    const otpDigits = otp ? otp.split('') : [];

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Service OTP</Text>
                <View style={{ width: 36 }} />
            </View>

            <View style={styles.content}>
                <View style={styles.iconWrap}>
                    <ShieldCheck size={36} color={colors.textInverse} />
                </View>

                <Text style={styles.title}>Show this code to your technician</Text>
                <Text style={styles.subtitle}>
                    Share this OTP with the assigned technician to verify the service handshake
                </Text>

                {loading ? (
                    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing['2xl'] }} />
                ) : (
                    <>
                        {/* OTP Display */}
                        <View style={styles.otpContainer}>
                            {otpDigits.map((digit, index) => (
                                <View
                                    key={index}
                                    style={[styles.otpBox, isExpired && styles.otpBoxExpired]}
                                >
                                    <Text style={[styles.otpDigit, isExpired && styles.otpDigitExpired]}>
                                        {isExpired ? '—' : digit}
                                    </Text>
                                </View>
                            ))}
                        </View>

                        {/* Timer */}
                        <View style={[styles.timerBadge, isExpired && styles.timerBadgeExpired]}>
                            <Clock size={14} color={isExpired ? colors.error : colors.textSecondary} />
                            <Text style={[styles.timerText, isExpired && styles.timerTextExpired]}>
                                {isExpired
                                    ? 'OTP Expired'
                                    : `Valid for ${minutes}:${seconds.toString().padStart(2, '0')}`
                                }
                            </Text>
                        </View>

                        {/* Refresh */}
                        {isExpired && (
                            <Button
                                title="Generate New OTP"
                                onPress={() => generateOtp(true)}
                                loading={refreshing}
                                style={{ marginTop: spacing.xl, width: '100%' }}
                            />
                        )}

                        {!isExpired && (
                            <TouchableOpacity
                                style={styles.refreshBtn}
                                onPress={() => generateOtp(true)}
                                disabled={refreshing}
                            >
                                <RefreshCw size={16} color={colors.primary} />
                                <Text style={styles.refreshText}>
                                    {refreshing ? 'Refreshing...' : 'Regenerate OTP'}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </>
                )}

                {/* Info */}
                <View style={styles.infoCard}>
                    <Text style={styles.infoTitle}>How it works</Text>
                    <Text style={styles.infoStep}>1. The technician arrives at your location</Text>
                    <Text style={styles.infoStep}>2. Share this OTP code verbally</Text>
                    <Text style={styles.infoStep}>3. Technician enters the OTP to start service</Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    content: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing['2xl'] },
    iconWrap: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
        marginBottom: spacing.xl, ...shadows.md,
    },
    title: { ...typography.h3, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
    subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
    otpContainer: { flexDirection: 'row', gap: 12, marginBottom: spacing.lg },
    otpBox: {
        width: 52, height: 64, borderRadius: radii.lg,
        backgroundColor: colors.primarySurface, borderWidth: 2, borderColor: colors.primary,
        justifyContent: 'center', alignItems: 'center',
    },
    otpBoxExpired: { borderColor: colors.error, backgroundColor: colors.errorLight },
    otpDigit: { fontSize: 28, fontWeight: '800', color: colors.primary },
    otpDigitExpired: { color: colors.error },
    timerBadge: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.surface, paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg, borderRadius: radii.full,
    },
    timerBadgeExpired: { backgroundColor: colors.errorLight },
    timerText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
    timerTextExpired: { color: colors.error },
    refreshBtn: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginTop: spacing.xl, padding: spacing.md,
    },
    refreshText: { ...typography.bodyMedium, color: colors.primary },
    infoCard: {
        width: '100%', backgroundColor: colors.surface, borderRadius: radii.lg,
        padding: spacing.lg, marginTop: spacing['2xl'],
    },
    infoTitle: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: spacing.md },
    infoStep: { ...typography.caption, color: colors.textSecondary, lineHeight: 22 },
});
