/**
 * PHASE 4: Start Service Screen — Two-phase geofenced service start
 *
 * Phase A: "I've Arrived" — Captures GPS, sends to geofence endpoint
 *   → ACCEPTED → REACHED (server validates ≤ 200m via PostGIS)
 *
 * Phase B: OTP Verification — Employee enters 6-digit OTP from customer
 *   → REACHED → IN_PROGRESS (server validates handshakeOtp)
 *
 * Role: 🟧 Employee/Serviceman only
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Alert,
    ActivityIndicator,
    TouchableOpacity,
    TextInput,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, MapPin, Navigation, AlertCircle, CheckCircle,
    Loader, ShieldCheck, Lock,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'StartService'>;

const PROXIMITY_THRESHOLD_METERS = 200; // Matches backend MAX_SERVICE_START_DISTANCE

type Phase = 'arrive' | 'otp';
type LocationStatus = 'checking' | 'granted' | 'denied' | 'error';
type ArrivalStatus = 'idle' | 'checking' | 'arrived' | 'too_far' | 'error';

export function StartServiceScreen({ navigation, route }: Props) {
    const bookingId = route.params?.serviceId || route.params?.bookingId;

    // ── Phase state ──────────────────────────────────────────
    const [phase, setPhase] = useState<Phase>('arrive');
    const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');
    const [arrivalStatus, setArrivalStatus] = useState<ArrivalStatus>('idle');
    const [distance, setDistance] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    // ── OTP state ────────────────────────────────────────────
    const [otp, setOtp] = useState('');
    const [otpError, setOtpError] = useState('');
    const [verifying, setVerifying] = useState(false);

    useEffect(() => {
        checkLocationPermission();
    }, []);

    const checkLocationPermission = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            setLocationStatus(status === 'granted' ? 'granted' : 'denied');
        } catch {
            setLocationStatus('error');
        }
    };

    // ── Phase A: "I've Arrived" ──────────────────────────────
    const handleArrival = async () => {
        setArrivalStatus('checking');
        setLoading(true);
        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });
            const { latitude, longitude } = location.coords;

            // Use the numeric ID for backend route matching
            const numericId = route.params?.bookingId || route.params?.id || bookingId;

            const { data } = await apiClient.patch(`/api/v1/bookings/${numericId}/arrive`, {
                latitude,
                longitude,
            });

            if (data?.success) {
                setDistance(data.data?.distanceMeters ?? null);
                setArrivalStatus('arrived');
                // Auto-advance to OTP phase
                setPhase('otp');
            }
        } catch (err: any) {
            const errData = err?.response?.data;
            if (errData?.data?.distanceMeters) {
                setDistance(errData.data.distanceMeters);
                setArrivalStatus('too_far');
            } else {
                setArrivalStatus('error');
            }
            Alert.alert('Cannot Confirm Arrival', getApiErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    // ── Phase B: OTP Verification ────────────────────────────
    const handleVerifyOtp = async () => {
        if (otp.length !== 6) {
            setOtpError('Please enter the 6-digit code');
            return;
        }
        setOtpError('');
        setVerifying(true);
        try {
            const { data } = await apiClient.patch(`/api/v1/bookings/${bookingId}/start`, {
                otp: otp.trim(),
            });

            if (data?.success) {
                Alert.alert(
                    '🔧 Service Started!',
                    'You can now proceed with the service work.',
                    [{ text: 'OK', onPress: () => navigation.goBack() }],
                );
            }
        } catch (err) {
            const msg = getApiErrorMessage(err);
            setOtpError(msg);
            Alert.alert('Invalid OTP', msg);
        } finally {
            setVerifying(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {phase === 'arrive' ? 'Confirm Arrival' : 'Enter Service Code'}
                </Text>
                <View style={{ width: 36 }} />
            </View>

            <View style={styles.content}>
                {/* ── PHASE A: Arrival ──────────────────────────────── */}
                {phase === 'arrive' && (
                    <>
                        {/* Step indicator */}
                        <View style={styles.stepIndicator}>
                            <View style={[styles.stepDot, styles.stepActive]} />
                            <View style={styles.stepLine} />
                            <View style={styles.stepDot} />
                        </View>

                        {/* Location status */}
                        <StatusCard
                            icon={<MapPin size={20} color={locationStatus === 'granted' ? colors.success : colors.warning} />}
                            title="Location Permission"
                            status={
                                locationStatus === 'checking' ? 'Checking...' :
                                    locationStatus === 'granted' ? 'Permission granted' :
                                        locationStatus === 'denied' ? 'Permission denied — tap to enable' :
                                            'Error checking permission'
                            }
                            statusColor={locationStatus === 'granted' ? colors.success : colors.warning}
                            onPress={locationStatus === 'denied' ? checkLocationPermission : undefined}
                        />

                        {/* Distance feedback */}
                        {arrivalStatus === 'too_far' && distance !== null && (
                            <View style={styles.distanceCard}>
                                <AlertCircle size={20} color={colors.error} />
                                <Text style={styles.distanceText}>
                                    You are {distance}m away. Move within {PROXIMITY_THRESHOLD_METERS}m of the customer.
                                </Text>
                            </View>
                        )}

                        {/* Info */}
                        <View style={styles.infoCard}>
                            <Text style={styles.infoTitle}>How it works</Text>
                            <Text style={styles.infoText}>
                                • Tap "I've Arrived" when you reach the customer{'\n'}
                                • GPS will verify you are within {PROXIMITY_THRESHOLD_METERS}m{'\n'}
                                • After arrival, enter the 6-digit code shown on customer's phone
                            </Text>
                        </View>
                    </>
                )}

                {/* ── PHASE B: OTP ─────────────────────────────────── */}
                {phase === 'otp' && (
                    <>
                        {/* Step indicator */}
                        <View style={styles.stepIndicator}>
                            <View style={[styles.stepDot, styles.stepComplete]}>
                                <CheckCircle size={12} color="#fff" />
                            </View>
                            <View style={[styles.stepLine, styles.stepLineActive]} />
                            <View style={[styles.stepDot, styles.stepActive]} />
                        </View>

                        {/* Arrival confirmed */}
                        <View style={styles.arrivedBanner}>
                            <CheckCircle size={24} color={colors.success} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.arrivedTitle}>Arrival Confirmed</Text>
                                {distance !== null && (
                                    <Text style={styles.arrivedSubtitle}>
                                        Verified at {distance}m from customer
                                    </Text>
                                )}
                            </View>
                        </View>

                        {/* OTP Input */}
                        <View style={styles.otpSection}>
                            <Lock size={28} color={colors.primary} />
                            <Text style={styles.otpTitle}>Enter Service Code</Text>
                            <Text style={styles.otpSubtitle}>
                                Ask the customer for the 6-digit code shown on their phone
                            </Text>

                            <TextInput
                                style={[styles.otpInput, otpError ? styles.otpInputError : null]}
                                value={otp}
                                onChangeText={(text) => {
                                    setOtp(text.replace(/[^0-9]/g, '').slice(0, 6));
                                    setOtpError('');
                                }}
                                keyboardType="number-pad"
                                maxLength={6}
                                placeholder="● ● ● ● ● ●"
                                placeholderTextColor={colors.textDisabled}
                                textAlign="center"
                                autoFocus
                            />

                            {otpError ? (
                                <Text style={styles.otpErrorText}>{otpError}</Text>
                            ) : null}
                        </View>
                    </>
                )}
            </View>

            {/* Bottom action button */}
            <View style={styles.bottomBar}>
                {phase === 'arrive' ? (
                    <Button
                        title={
                            arrivalStatus === 'checking' ? 'Verifying Location...' :
                                arrivalStatus === 'too_far' ? 'Retry — I\'ve Arrived' :
                                    'I\'ve Arrived'
                        }
                        onPress={handleArrival}
                        loading={loading}
                        disabled={locationStatus !== 'granted' || loading}
                    />
                ) : (
                    <Button
                        title="Verify & Start Service"
                        onPress={handleVerifyOtp}
                        loading={verifying}
                        disabled={otp.length !== 6 || verifying}
                    />
                )}
            </View>
        </KeyboardAvoidingView>
    );
}

function StatusCard({
    icon, title, status, statusColor, onPress,
}: {
    icon: React.ReactNode; title: string; status: string;
    statusColor: string; onPress?: () => void;
}) {
    const Comp = onPress ? TouchableOpacity : View;
    return (
        <Comp style={styles.statusCard} onPress={onPress} activeOpacity={0.7}>
            {icon}
            <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>{title}</Text>
                <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
            </View>
        </Comp>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    content: { flex: 1, padding: spacing.xl },

    // Step indicator
    stepIndicator: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginBottom: spacing.xl, gap: 0,
    },
    stepDot: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center',
    },
    stepActive: { backgroundColor: colors.primary },
    stepComplete: { backgroundColor: colors.success },
    stepLine: {
        width: 60, height: 3, backgroundColor: colors.border, marginHorizontal: 4,
    },
    stepLineActive: { backgroundColor: colors.success },

    // Status cards
    statusCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm,
    },
    statusTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    statusText: { ...typography.caption, marginTop: 2 },

    // Distance feedback
    distanceCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.errorLight, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.md,
    },
    distanceText: { ...typography.caption, color: colors.error, flex: 1 },

    // Info card
    infoCard: {
        backgroundColor: colors.primarySurface, borderRadius: radii.lg,
        padding: spacing.lg, marginTop: spacing.lg,
    },
    infoTitle: { ...typography.bodyMedium, color: colors.primary, marginBottom: spacing.sm },
    infoText: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },

    // Arrived banner
    arrivedBanner: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.successLight, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.xl,
    },
    arrivedTitle: { ...typography.bodyMedium, color: colors.success, fontWeight: '600' },
    arrivedSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

    // OTP section
    otpSection: {
        alignItems: 'center', paddingVertical: spacing.xl,
    },
    otpTitle: {
        ...typography.h3, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.xs,
    },
    otpSubtitle: {
        ...typography.caption, color: colors.textSecondary, textAlign: 'center',
        marginBottom: spacing.xl, paddingHorizontal: spacing.xl,
    },
    otpInput: {
        width: '100%', maxWidth: 320, height: 64, borderWidth: 2, borderColor: colors.border,
        borderRadius: radii.lg, fontSize: 32, fontWeight: '700',
        color: colors.textPrimary, backgroundColor: colors.background,
        letterSpacing: 12, textAlign: 'center',
    },
    otpInputError: { borderColor: colors.error },
    otpErrorText: {
        ...typography.caption, color: colors.error, marginTop: spacing.sm,
    },

    // Bottom bar
    bottomBar: {
        padding: spacing.xl, paddingBottom: spacing['2xl'],
        backgroundColor: colors.background,
        borderTopWidth: 1, borderTopColor: colors.divider,
    },
});
