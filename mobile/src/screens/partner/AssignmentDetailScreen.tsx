/**
 * Assignment Detail — Accept/Deny + Customer info + Service flow actions
 */

import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    TextInput,
    Linking,
    Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as ExpoLocation from 'expo-location';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, User, Phone, MapPin, Calendar, Navigation2,
    CheckCircle, XCircle, Play, DollarSign, KeyRound, Banknote,
} from 'lucide-react-native';
import {
    useAssignments,
    useAcceptAssignment,
    useDenyAssignment,
    useVerifyHandshake,
    useStartService,
    useCompleteService,
    useEnterServiceCharge,
} from '../../hooks/usePartnerData';
import { Assignment, partnerApi } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, ScreenHeader } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'AssignmentDetail'>;

export function AssignmentDetailScreen({ navigation, route }: Props) {
    const routeAssignment: Assignment = route.params?.assignment;
    const { data: assignmentsList } = useAssignments();
    const assignment = assignmentsList?.find(a => a.id === routeAssignment?.id || a.serviceId === routeAssignment?.serviceId) || routeAssignment;
    
    const [otp, setOtp] = useState('');
    const [serviceCharge, setServiceCharge] = useState('');
    const [materialCharge, setMaterialCharge] = useState('');
    const [showChargeForm, setShowChargeForm] = useState(false);
    const [collectingCash, setCollectingCash] = useState(false);
    const [customerCoords, setCustomerCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);

    const { mutate: accept, isPending: accepting } = useAcceptAssignment();
    const { mutate: deny, isPending: denying } = useDenyAssignment();
    const { mutate: verifyOtp, isPending: verifying } = useVerifyHandshake();
    const { mutate: startSvc, isPending: starting } = useStartService();
    const { mutate: complete, isPending: completing } = useCompleteService(); // Keep hook if needed elsewhere, though Mark Complete removed from in_progress
    const { mutate: enterCharge, isPending: enteringCharge } = useEnterServiceCharge();

    // Parse customerLocation from WKT string or fallback to geocode
    useEffect(() => {
        if (assignment?.customerLocation) {
            // customerLocation is in format: "POINT(lng lat)"
            const match = assignment.customerLocation.match(/POINT\(([^ ]+)\s+([^)]+)\)/);
            if (match && match.length === 3) {
                const lng = parseFloat(match[1]);
                const lat = parseFloat(match[2]);
                if (!isNaN(lat) && !isNaN(lng)) {
                    setCustomerCoords({ latitude: lat, longitude: lng });
                    return; // Successfully parsed from DB, skip geocoding
                }
            }
        }

        // Fallback to geocoding if customerLocation is missing or invalid
        if (assignment?.address) {
            ExpoLocation.geocodeAsync(assignment.address)
                .then((results) => {
                    if (results.length > 0) {
                        setCustomerCoords({
                            latitude: results[0].latitude,
                            longitude: results[0].longitude,
                        });
                    }
                })
                .catch((err) => { if (__DEV__) console.log('[MAP] Geocode failed:', err.message); });
        }
    }, [assignment?.address, assignment?.customerLocation]);

    // Early return AFTER all hooks (React Rules of Hooks)
    if (!assignment) { navigation.goBack(); return null; }

    const openDirections = () => {
        if (!customerCoords) return;
        const { latitude, longitude } = customerCoords;
        const url = Platform.select({
            ios: `maps://app?daddr=${latitude},${longitude}`,
            android: `google.navigation:q=${latitude},${longitude}`,
        });
        if (url) Linking.openURL(url).catch(() => {
            // Fallback to Google Maps web
            Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
        });
    };

    const handleAccept = () => {
        Alert.alert('Accept Assignment', 'Take this job?', [
            { text: 'Cancel' },
            { text: 'Accept', onPress: () => accept(assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleDeny = () => {
        Alert.alert('Deny Assignment', 'Are you sure you want to decline?', [
            { text: 'Cancel' },
            { text: 'Deny', style: 'destructive', onPress: () => deny({ id: assignment.id }, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleVerifyOtp = () => {
        if (otp.length < 4) { Alert.alert('Invalid OTP', 'Enter the OTP from the customer.'); return; }
        verifyOtp({ serviceId: assignment.serviceId || assignment.id, otp });
    };

    const handleStart = async () => {
        try {
            setIsFetchingLocation(true);
            const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission is required to start the service.');
                setIsFetchingLocation(false);
                return;
            }
            const location = await ExpoLocation.getCurrentPositionAsync({});
            startSvc({ 
                serviceId: assignment.serviceId || assignment.id,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude
            });
        } catch (error) {
            Alert.alert('Error', 'Failed to get location. Please enable GPS.');
        } finally {
            setIsFetchingLocation(false);
        }
    };

    const handleEnterCharge = () => {
        const charge = parseFloat(serviceCharge);
        if (isNaN(charge) || charge <= 0) { Alert.alert('Invalid', 'Enter a valid service charge.'); return; }
        enterCharge({
            serviceId: assignment.id,
            data: {
                serviceCharge: charge,
                materialCharge: materialCharge ? parseFloat(materialCharge) : undefined,
            },
        });
    };

    const handleComplete = () => {
        Alert.alert('Complete Service', 'Mark this service as done?', [
            { text: 'Cancel' },
            { text: 'Complete', onPress: () => complete(assignment.serviceId || assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const createdDate = new Date(assignment.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <View style={styles.container}>
            <ScreenHeader title="Assignment" onBack={() => navigation.goBack()} />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Service info card */}
                <View style={styles.card}>
                    <Text style={styles.serviceType}>{assignment.serviceType.replace(/_/g, ' ')}</Text>
                    {(assignment.brand || assignment.model) && (
                        <Text style={styles.brandText}>
                            {assignment.brand} {assignment.model ? `- ${assignment.model}` : ''}
                        </Text>
                    )}
                    <Text style={styles.desc}>{assignment.description}</Text>
                    <View style={styles.metaRow}>
                        <Calendar size={14} color={colors.textSecondary} />
                        <Text style={styles.metaText}>{createdDate}</Text>
                    </View>
                    <View style={styles.metaRow}>
                        <MapPin size={14} color={colors.textSecondary} />
                        <Text style={styles.metaText}>{assignment.address}</Text>
                    </View>
                </View>

                {/* Mini Map */}
                {customerCoords && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Location</Text>
                        <View style={styles.mapContainer}>
                            <MapView
                                style={styles.miniMap}
                                provider={PROVIDER_DEFAULT}
                                initialRegion={{
                                    ...customerCoords,
                                    latitudeDelta: 0.008,
                                    longitudeDelta: 0.008,
                                }}
                                scrollEnabled={false}
                                zoomEnabled={false}
                                pitchEnabled={false}
                                rotateEnabled={false}
                            >
                                <Marker coordinate={customerCoords} />
                            </MapView>
                        </View>
                        <TouchableOpacity
                            style={styles.directionsBtn}
                            onPress={openDirections}
                            activeOpacity={0.7}
                        >
                            <Navigation2 size={16} color={colors.textInverse} />
                            <Text style={styles.directionsBtnText}>Get Directions</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Customer info */}
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Customer</Text>
                    <View style={styles.customerRow}>
                        <View style={styles.customerAvatar}>
                            <User size={20} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.customerName}>{assignment.customerName}</Text>
                            <View style={styles.phoneRow}>
                                <Phone size={12} color={colors.textSecondary} />
                                <Text style={styles.phoneText}>{assignment.customerPhone}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Actions based on status */}
                {assignment.status === 'assigned' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Actions</Text>
                        <View style={styles.actionRow}>
                            <View style={{ flex: 1 }}>
                                <Button title="✓ Accept" onPress={handleAccept} loading={accepting} fullWidth={true} />
                            </View>
                            <TouchableOpacity style={styles.denyBtn} onPress={handleDeny} disabled={denying}>
                                <XCircle size={18} color={colors.error} />
                                <Text style={styles.denyText}>Deny</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {assignment.status === 'accepted' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Verify Customer OTP</Text>
                        <Text style={styles.hintText}>Ask the customer for their OTP before starting the service.</Text>
                        <View style={styles.otpRow}>
                            <TextInput
                                style={styles.otpInput}
                                placeholder="Enter OTP"
                                value={otp}
                                onChangeText={setOtp}
                                keyboardType="number-pad"
                                maxLength={6}
                                placeholderTextColor={colors.textDisabled}
                            />
                            <Button title="Verify" onPress={handleVerifyOtp} loading={verifying} style={styles.otpBtn} fullWidth={false} />
                        </View>
                        <Button title={isFetchingLocation ? "Validating location..." : "▶ Start Service"} onPress={handleStart} loading={starting || isFetchingLocation} style={styles.startBtn} />
                    </View>
                )}

                {assignment.status === 'in_progress' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Complete Service</Text>

                        {assignment.pricingSnapshot?.billedAt ? (
                            <View style={styles.cashWarningCard}>
                                <CheckCircle size={18} color={colors.success} />
                                <Text style={[styles.cashWarningText, { color: colors.success }]}>
                                    Charges submitted. Waiting for customer payment or refresh to see Awaiting Payment.
                                </Text>
                            </View>
                        ) : !showChargeForm ? (
                            <Button title="💰 Enter Charges" onPress={() => setShowChargeForm(true)} style={styles.chargeBtn} />
                        ) : (
                            <View>
                                <Text style={styles.label}>Service Charge (₹) *</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. 500"
                                    value={serviceCharge}
                                    onChangeText={setServiceCharge}
                                    keyboardType="numeric"
                                    placeholderTextColor={colors.textDisabled}
                                />
                                <Text style={styles.label}>Material Charge (₹)</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g. 200 (optional)"
                                    value={materialCharge}
                                    onChangeText={setMaterialCharge}
                                    keyboardType="numeric"
                                    placeholderTextColor={colors.textDisabled}
                                />
                                <Button title="Submit Charges" onPress={handleEnterCharge} loading={enteringCharge} />
                            </View>
                        )}
                    </View>
                )}

                {assignment.status === 'pending_payment' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Awaiting Payment</Text>
                        <Text style={styles.hintText}>
                            Customer needs to pay ₹{assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}. If they have no network or phone charge, you can collect cash.
                        </Text>

                        <View style={styles.cashWarningCard}>
                            <Banknote size={18} color={colors.warning} />
                            <Text style={styles.cashWarningText}>
                                UniteFix fee will be deducted from your wallet when you confirm cash collection.
                            </Text>
                        </View>

                        <Button
                            title={collectingCash ? 'Processing...' : `💵 Collect Cash — ₹${assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}`}
                            onPress={() => {
                                const amount = assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0;
                                Alert.alert(
                                    'Confirm Cash Collection',
                                    `You are confirming that the customer paid ₹${amount} in cash.\n\nUniteFix platform fee will be deducted from your wallet.\n\nThis cannot be undone.`,
                                    [
                                        { text: 'Cancel', style: 'cancel' },
                                        {
                                            text: 'Confirm Cash Received',
                                            style: 'default',
                                            onPress: async () => {
                                                setCollectingCash(true);
                                                try {
                                                    const { data } = await partnerApi.collectCash(assignment.id, amount);
                                                    if (data?.success) {
                                                        Alert.alert(
                                                            '✅ Cash Payment Recorded',
                                                            `Service completed! ₹${data.data?.platformFeeDeducted || 0} platform fee deducted from wallet.`,
                                                            [{ text: 'OK', onPress: () => navigation.goBack() }]
                                                        );
                                                    }
                                                } catch (err: any) {
                                                    const msg = err?.response?.data?.message || 'Failed to record cash payment.';
                                                    Alert.alert('Error', msg);
                                                } finally {
                                                    setCollectingCash(false);
                                                }
                                            },
                                        },
                                    ]
                                );
                            }}
                            loading={collectingCash}
                            disabled={collectingCash}
                        />
                    </View>
                )}

                {/* Charges summary (if available) */}
                {assignment.totalCharge != null && assignment.totalCharge > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Charges</Text>
                        {assignment.serviceCharge != null && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Service</Text>
                                <Text style={styles.chargeValue}>₹{assignment.serviceCharge}</Text>
                            </View>
                        )}
                        {assignment.materialCharge != null && assignment.materialCharge > 0 && (
                            <View style={styles.chargeRow}>
                                <Text style={styles.chargeLabel}>Material</Text>
                                <Text style={styles.chargeValue}>₹{assignment.materialCharge}</Text>
                            </View>
                        )}
                        <View style={[styles.chargeRow, styles.totalRow]}>
                            <Text style={styles.totalLabel}>Total</Text>
                            <Text style={styles.totalValue}>₹{assignment.totalCharge}</Text>
                        </View>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    card: { backgroundColor: colors.background, borderRadius: radii.xl, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
    serviceType: { ...typography.h3, color: colors.textPrimary, textTransform: 'capitalize', marginBottom: spacing.xs },
    brandText: { ...typography.body2, color: colors.primary, fontWeight: '500', marginBottom: spacing.xs },
    desc: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    metaText: { ...typography.caption, color: colors.textSecondary },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    customerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    customerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center' },
    customerName: { ...typography.bodyMedium, color: colors.textPrimary },
    phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
    phoneText: { ...typography.caption, color: colors.textSecondary },
    actionsCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.md },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    acceptBtn: { flex: 1 },
    denyBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.error },
    denyText: { ...typography.bodyMedium, color: colors.error },
    hintText: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 18 },
    otpRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    otpInput: { flex: 1, maxWidth: 320, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, fontSize: 24, fontWeight: '700', letterSpacing: 8, textAlign: 'center', color: colors.textPrimary },
    otpBtn: { width: 100 },
    startBtn: { marginTop: spacing.sm },
    chargeBtn: { marginBottom: spacing.md },
    label: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.sm },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm },
    completeBtn: { marginTop: spacing.lg },
    chargeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    chargeLabel: { ...typography.body, color: colors.textSecondary },
    chargeValue: { ...typography.bodyMedium, color: colors.textPrimary },
    totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { ...typography.h4, color: colors.primary },
    mapContainer: {
        borderRadius: radii.lg,
        overflow: 'hidden',
        marginBottom: spacing.md,
    },
    miniMap: {
        width: '100%',
        height: 160,
    },
    directionsBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.primary,
        borderRadius: radii.lg,
        paddingVertical: spacing.md,
    },
    directionsBtnText: {
        ...typography.button,
        color: colors.textInverse,
    },

    cashWarningCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
        backgroundColor: colors.warningLight || '#FFF8E1',
        borderRadius: radii.md,
        padding: spacing.md,
        marginBottom: spacing.lg,
        borderLeftWidth: 3,
        borderLeftColor: colors.warning,
    },
    cashWarningText: {
        ...typography.small,
        color: colors.warning,
        flex: 1,
        lineHeight: 18,
    },
});
