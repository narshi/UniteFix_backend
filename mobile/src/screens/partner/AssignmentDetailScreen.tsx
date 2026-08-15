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
    KeyboardAvoidingView,
    Image,
    ActivityIndicator,
    Modal,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as ExpoLocation from 'expo-location';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, User, Phone, MapPin, Calendar, Navigation2,
    CheckCircle, XCircle, Play, KeyRound, Banknote, QrCode
} from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import { usePublicConfig } from '../../hooks/useCustomerData';
import {
    useAssignments,
    useAcceptAssignment,
    useDenyAssignment,
    useMarkArrived,
    useStartServiceWithOtp,
    useCompleteService,
    useEnterServiceCharge,
    useRequestPayment,
    useGenerateRazorpayQR,
    useQrPaymentStatus
} from '../../hooks/usePartnerData';

/** Must stay in sync with close_by in PaymentService.createDynamicQRCode. */
const QR_VALIDITY_MS = 12 * 60 * 1000;
import { Assignment, partnerApi } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, ScreenHeader } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'AssignmentDetail'>;

export function AssignmentDetailScreen({ navigation, route }: Props) {
    const { headerTop } = useScreenInsets();
    const routeAssignment: Assignment = route.params?.assignment;
    // A push notification only carries the booking id — the in-app list passes
    // the whole object. Support both so "New job assigned" opens the real job.
    const paramId = route.params?.id ?? route.params?.serviceId;
    const targetId = routeAssignment?.id ?? (paramId != null ? Number(paramId) : undefined);
    const { data: assignmentsList, isLoading: loadingAssignments } = useAssignments();
    const assignment =
        assignmentsList?.find(
            (a: Assignment) => a.id === targetId || a.serviceId === routeAssignment?.serviceId,
        ) || routeAssignment;
    const { data: publicConfig } = usePublicConfig();
    
    const [otp, setOtp] = useState('');
    const [serviceCharge, setServiceCharge] = useState('');
    const [materialCharge, setMaterialCharge] = useState('');
    const [showChargeForm, setShowChargeForm] = useState(false);
    const [extraParts, setExtraParts] = useState('');
    const [partsNote, setPartsNote] = useState('');
    const [showPartsForm, setShowPartsForm] = useState(false);

    // v2 fixed-price bookings carry the technician's earning + final amount frozen
    // in the snapshot, so there is no bill to enter.
    const snap: any = assignment?.pricingSnapshot;
    const isFixedPrice = snap?.snapshotVersion === 2;
    const technicianEarning = Number(snap?.technicianEarning ?? 0);
    const [collectingCash, setCollectingCash] = useState(false);
    const [customerCoords, setCustomerCoords] = useState<{ latitude: number; longitude: number } | null>(null);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);

    const { mutate: accept, isPending: accepting } = useAcceptAssignment();
    const { mutate: deny, isPending: denying } = useDenyAssignment();
    const { mutate: markArrived, isPending: arriving } = useMarkArrived();
    const { mutate: startService, isPending: starting } = useStartServiceWithOtp();
    const { mutate: complete, isPending: completing } = useCompleteService(); // Keep hook if needed elsewhere, though Mark Complete removed from in_progress
    const { mutate: enterCharge, isPending: enteringCharge } = useEnterServiceCharge();
    const { mutate: requestPayment, isPending: requestingPayment } = useRequestPayment();
    const { mutate: generateQr, isPending: generatingQr } = useGenerateRazorpayQR();
    const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
    const [qrError, setQrError] = useState(false);
    const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
    const [qrTimeLeft, setQrTimeLeft] = useState(0);
    const [isQrModalVisible, setQrModalVisible] = useState(false);

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

    // Generate dynamic QR Code automatically when entering pending_payment state
    const handleGenerateQr = () => {
        setQrError(false);
        setQrExpiresAt(null);
        setQrCodeUrl(null);
        generateQr(assignment.id, {
            onSuccess: (data) => {
                if (data?.qrImageUrl) {
                    setQrCodeUrl(data.qrImageUrl);
                    // Must match the server's close_by (12 min). The old 5-minute
                    // countdown told the partner the QR had expired while it was
                    // still payable, so a customer paying at minute 6 looked like
                    // a failure.
                    setQrExpiresAt(Date.now() + QR_VALIDITY_MS);
                    setQrTimeLeft(QR_VALIDITY_MS / 1000);
                } else {
                    setQrError(true);
                }
            },
            onError: () => {
                setQrError(true);
            }
        });
    };

    useEffect(() => {
        if (assignment?.status === 'pending_payment' && !qrCodeUrl && !qrError && !generatingQr) {
            handleGenerateQr();
        }
    }, [assignment?.status]);

    // The customer pays from their own UPI app, so nothing reports back to this
    // screen. Ask Razorpay directly instead of waiting on the webhook — otherwise
    // a paid booking sits in pending_payment with no way for the partner to tell.
    const { data: qrStatus } = useQrPaymentStatus(
        assignment?.id,
        assignment?.status === 'pending_payment' && !!qrCodeUrl,
    );

    useEffect(() => {
        if (!qrStatus?.paid) return;
        setQrModalVisible(false);
        Alert.alert(
            '✅ Payment Received',
            'The customer\'s payment has been confirmed. This job is now complete.',
            [{ text: 'Done', onPress: () => navigation.goBack() }],
        );
    }, [qrStatus?.paid]);

    // Timer countdown effect
    useEffect(() => {
        if (!qrExpiresAt) return;

        const interval = setInterval(() => {
            const left = Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000));
            setQrTimeLeft(left);
            
            if (left <= 0) {
                clearInterval(interval);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [qrExpiresAt]);

    // Early return AFTER all hooks (React Rules of Hooks)
    if (!assignment) {
        // Opened from a notification with only an id: hold until the assignment
        // list loads rather than bouncing the expert straight back out.
        if (targetId != null && loadingAssignments) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            );
        }
        navigation.goBack();
        return null;
    }

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
            { text: 'Cancel', style: 'cancel' },
            { text: 'Accept', onPress: () => accept(assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleDeny = () => {
        Alert.alert('Deny Assignment', 'Are you sure you want to decline?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Deny', style: 'destructive', onPress: () => deny({ id: assignment.id }, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    const handleVerifyAndStart = () => {
        if (otp.length < 4) { Alert.alert('Invalid OTP', 'Enter the OTP from the customer.'); return; }
        startService({ bookingId: assignment.id, otp });
    };

    const handleArrive = async () => {
        try {
            setIsFetchingLocation(true);
            const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission is required to verify arrival distance.');
                setIsFetchingLocation(false);
                return;
            }
            const location = await ExpoLocation.getCurrentPositionAsync({});
            markArrived({ 
                bookingId: assignment.id,
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
            { text: 'Cancel', style: 'cancel' },
            { text: 'Complete', onPress: () => complete(assignment.id, { onSuccess: () => navigation.goBack() }) },
        ]);
    };

    // v2: move a fixed-price job to awaiting-payment, with an optional
    // customer-approved parts add-on.
    const handleRequestPayment = () => {
        const extra = extraParts ? Math.max(0, parseFloat(extraParts) || 0) : 0;
        requestPayment(
            { bookingId: assignment.id, extraPartsCost: extra || undefined, partsNote: partsNote || undefined },
            { onSuccess: () => { setShowPartsForm(false); setExtraParts(''); setPartsNote(''); } }
        );
    };

    const createdDate = new Date(assignment.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <KeyboardAvoidingView 
            style={styles.container} 
            behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 20}
        >
            <ScreenHeader title="Assignment" onBack={() => navigation.goBack()} />

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                        {isFixedPrice && technicianEarning > 0 && (
                            <View style={styles.earnCard}>
                                <Text style={styles.earnLabel}>You'll earn on this job</Text>
                                <Text style={styles.earnValue}>₹{technicianEarning.toFixed(2)}</Text>
                            </View>
                        )}
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
                        <Text style={styles.sectionTitle}>Arrive at Location</Text>
                        <Text style={styles.hintText}>Mark your arrival when you reach the customer's location. You must be nearby to proceed.</Text>
                        <Button 
                            title={isFetchingLocation ? "Getting Location..." : "📍 Mark as Arrived"} 
                            onPress={handleArrive} 
                            loading={arriving || isFetchingLocation} 
                            style={styles.startBtn} 
                        />
                    </View>
                )}

                {assignment.status === 'reached' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Verify Customer OTP</Text>
                        <Text style={styles.hintText}>Ask the customer for their service OTP to begin the job.</Text>
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
                            <Button title="▶ Verify & Start" onPress={handleVerifyAndStart} loading={starting} style={styles.otpBtn} fullWidth={false} />
                        </View>
                    </View>
                )}

                {assignment.status === 'in_progress' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Complete Service</Text>

                        {isFixedPrice ? (
                            /* v2 fixed-price: the amount is set. Request payment, optionally
                               adding customer-approved parts. */
                            <View>
                                <View style={styles.earnCard}>
                                    <Text style={styles.earnLabel}>Customer pays now</Text>
                                    <Text style={styles.earnValue}>₹{Number(snap?.finalTotal ?? 0).toFixed(2)}</Text>
                                    {technicianEarning > 0 && (
                                        <Text style={styles.earnSub}>You earn ₹{technicianEarning.toFixed(2)}</Text>
                                    )}
                                </View>

                                {showPartsForm ? (
                                    <View>
                                        <Text style={styles.label}>Spare parts cost (₹) — customer approved</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="e.g. 300"
                                            value={extraParts}
                                            onChangeText={setExtraParts}
                                            keyboardType="numeric"
                                            placeholderTextColor={colors.textDisabled}
                                        />
                                        <Text style={styles.label}>What was it for?</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="e.g. replacement adapter"
                                            value={partsNote}
                                            onChangeText={setPartsNote}
                                            placeholderTextColor={colors.textDisabled}
                                        />
                                    </View>
                                ) : (
                                    <TouchableOpacity onPress={() => setShowPartsForm(true)}>
                                        <Text style={styles.addPartsLink}>+ Add spare parts cost</Text>
                                    </TouchableOpacity>
                                )}

                                <Button
                                    title="Request Payment"
                                    onPress={handleRequestPayment}
                                    loading={requestingPayment}
                                    style={styles.chargeBtn}
                                />
                            </View>
                        ) : assignment.pricingSnapshot?.billedAt ? (
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

                {/* ✅ COMPLETED — Payment received success state */}
                {assignment.status === 'completed' && (
                    <View style={[styles.actionsCard, { borderColor: '#22c55e', borderWidth: 1, backgroundColor: 'rgba(34,197,94,0.05)' }]}>
                        <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                            <CheckCircle size={48} color="#22c55e" />
                            <Text style={{ ...typography.h3, color: '#22c55e', marginTop: spacing.md }}>Payment Received!</Text>
                            <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }}>
                                Service completed successfully. ₹{assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0} has been collected.
                            </Text>
                            <Text style={{ ...typography.caption, color: colors.textDisabled, marginTop: spacing.md }}>
                                Payment method: {assignment.paymentMethod === 'razorpay' ? '💳 Online (UPI/QR)' : assignment.paymentMethod === 'cash' ? '💵 Cash' : '💳 Online'}
                            </Text>
                            <Button
                                title="View Invoice"
                                onPress={() => navigation.navigate('InvoiceView', { serviceId: assignment.id })}
                                style={{ marginTop: spacing.lg, width: '100%' }}
                            />
                        </View>
                    </View>
                )}

                {assignment.status === 'pending_payment' && (
                    <View style={styles.actionsCard}>
                        <Text style={styles.sectionTitle}>Awaiting Payment</Text>
                        <Text style={styles.hintText}>
                            Customer needs to pay ₹{assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}. If they have no network or phone charge, you can collect cash.
                        </Text>

                        {assignment.paymentMethod === 'online' ? (
                            <View style={[styles.cashWarningCard, { borderLeftColor: colors.primary, backgroundColor: colors.primarySurface }]}>
                                <CheckCircle size={18} color={colors.primary} />
                                <Text style={[styles.cashWarningText, { color: colors.primary }]}>
                                    Customer is processing online payment... Cash collection is temporarily disabled.
                                </Text>
                            </View>
                        ) : (
                            <>
                                <View style={{ alignItems: 'center', marginBottom: spacing.lg, padding: spacing.lg, backgroundColor: '#fff', borderRadius: radii.md, borderWidth: 1, borderColor: colors.divider }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
                                        <QrCode size={20} color="#000" />
                                        <Text style={{ ...typography.h4, color: '#000' }}>Scan to Pay via UPI</Text>
                                    </View>
                                    {qrExpiresAt && qrTimeLeft <= 0 ? (
                                        <View style={{ alignItems: 'center', justifyContent: 'center', width: 180, height: 180, backgroundColor: '#f5f5f5', borderRadius: radii.md }}>
                                            <Text style={{ ...typography.body, color: colors.error, marginBottom: spacing.md, fontWeight: 'bold' }}>QR Expired</Text>
                                            <Button title="Regenerate QR" onPress={handleGenerateQr} loading={generatingQr} disabled={generatingQr} />
                                        </View>
                                    ) : (
                                        <TouchableOpacity activeOpacity={0.8} onPress={() => setQrModalVisible(true)}>
                                            {qrCodeUrl ? (
                                                <Image
                                                    source={{ uri: qrCodeUrl }}
                                                    style={{ width: 180, height: 180 }}
                                                    resizeMode="contain"
                                                />
                                            ) : qrError ? (
                                                <QRCode
                                                    value={`upi://pay?pa=${publicConfig?.companyUpiId || 'yourmerchant@upi'}&pn=UniteFix&am=${assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}&cu=INR`}
                                                    size={180}
                                                    color="black"
                                                    backgroundColor="white"
                                                />
                                            ) : (
                                                <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
                                                    <ActivityIndicator size="large" color={colors.primary} />
                                                </View>
                                            )}
                                        </TouchableOpacity>
                                    )}
                                    <Text style={{ ...typography.caption, color: '#666', marginTop: spacing.md, textAlign: 'center' }}>
                                        {qrExpiresAt && qrTimeLeft > 0 
                                            ? `Expires in ${Math.floor(qrTimeLeft / 60).toString().padStart(2, '0')}:${(qrTimeLeft % 60).toString().padStart(2, '0')}` 
                                            : "Customer can scan this QR with GPay, PhonePe, or Paytm"}
                                    </Text>
                                </View>
                                
                                {/* Zoomed QR Modal */}
                                <Modal visible={isQrModalVisible} transparent={true} statusBarTranslucent animationType="fade" onRequestClose={() => setQrModalVisible(false)}>
                                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl }}>
                                        <TouchableOpacity style={{ position: 'absolute', top: headerTop, right: 30, padding: 10 }} onPress={() => setQrModalVisible(false)}>
                                            <XCircle size={32} color="#fff" />
                                        </TouchableOpacity>
                                        <View style={{ backgroundColor: '#fff', padding: spacing.xl, borderRadius: radii.lg, alignItems: 'center' }}>
                                            {qrCodeUrl ? (
                                                <Image
                                                    source={{ uri: qrCodeUrl }}
                                                    style={{ width: 300, height: 300 }}
                                                    resizeMode="contain"
                                                />
                                            ) : qrError && (
                                                <QRCode
                                                    value={`upi://pay?pa=${publicConfig?.companyUpiId || 'yourmerchant@upi'}&pn=UniteFix&am=${assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}&cu=INR`}
                                                    size={300}
                                                    color="black"
                                                    backgroundColor="white"
                                                />
                                            )}
                                            <Text style={{ ...typography.h4, color: '#000', marginTop: spacing.lg, textAlign: 'center' }}>
                                                Scan to Pay ₹{assignment.pricingSnapshot?.finalTotal || assignment.totalCharge || 0}
                                            </Text>
                                            <Text style={{ ...typography.caption, color: '#666', marginTop: spacing.sm, textAlign: 'center' }}>
                                                {qrExpiresAt && qrTimeLeft > 0 ? `Expires in ${Math.floor(qrTimeLeft / 60).toString().padStart(2, '0')}:${(qrTimeLeft % 60).toString().padStart(2, '0')}` : ""}
                                            </Text>
                                        </View>
                                    </View>
                                </Modal>

                                {/* Show Collect Cash ONLY when QR has expired or failed */}
                                {(qrError || (qrExpiresAt && qrTimeLeft <= 0)) && (
                                    <>
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
                                    </>
                                )}
                            </>
                        )}
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
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    loadingContainer: {
        flex: 1, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center',
    },
    // NOTE: header/backBtn/headerTitle styles removed — this screen uses <ScreenHeader />.
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
    earnCard: {
        backgroundColor: colors.successLight,
        borderRadius: radii.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        alignItems: 'center',
    },
    earnLabel: { ...typography.caption, color: colors.textSecondary },
    earnValue: { ...typography.h3, color: colors.success, marginTop: 2 },
    earnSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
    addPartsLink: { ...typography.bodyMedium, color: colors.primary, marginBottom: spacing.md },
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
