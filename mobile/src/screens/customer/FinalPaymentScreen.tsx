/**
 * Final Payment Screen — Razorpay checkout for pending_payment bookings
 * 
 * Features:
 * - Premium bill breakdown (parts + labor + fee + GST - ₹99)
 * - Razorpay web checkout via WebView/Linking
 * - Payment success/failure states
 * - Animated transitions
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Animated,
    Platform,
    ActivityIndicator,
    Alert,
    BackHandler,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { openRazorpayCheckout } from '../../services/razorpay';
import {
    ArrowLeft,
    CreditCard,
    CheckCircle,
    Shield,
    IndianRupee,
    Receipt,
    XCircle,
} from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button, BackOnMount } from '../../components/ui';
import { apiClient, getApiErrorMessage } from '../../api/client';
import { inr } from '../../utils/money';
import { usePublicConfig, queryKeys, useServiceRequests } from '../../hooks/useCustomerData';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FinalPayment'>;

export function FinalPaymentScreen({ navigation, route }: Props) {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const queryClient = useQueryClient();
    // In-app navigation passes the whole booking. A push notification only knows
    // its id, so fall back to looking the booking up in the live list — without
    // this, tapping a "bill is ready" notification crashed on `request.id`.
    const routeRequest = route.params?.request;
    const paramId = route.params?.serviceId ?? route.params?.id;
    const { data: liveRequests } = useServiceRequests();
    const request =
        routeRequest ??
        (liveRequests as any[] | undefined)?.find((r) => r.id === Number(paramId));
    const [paymentState, setPaymentState] = useState<'idle' | 'loading' | 'success' | 'failed'>('idle');
    const [billingData, setBillingData] = useState<any>(null);
    const [loadingBill, setLoadingBill] = useState(true);
    const [billError, setBillError] = useState(false);
    const [payError, setPayError] = useState<string | null>(null);
    const { data: publicConfig } = usePublicConfig();

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 7 }),
        ]).start();
    }, []);

    // Keyed on the booking id rather than mount: arriving from a notification,
    // `request` is undefined on the first render and only resolves once the
    // bookings list loads.
    useEffect(() => {
        if (!request?.id) return;
        fetchBilling();
    }, [request?.id]);

    const fetchBilling = async () => {
        setLoadingBill(true);
        setBillError(false);
        try {
            const { data } = await apiClient.get(`/api/v1/bookings/${request.id}/billing`);
            if (data?.success && data.data?.billing) setBillingData(data.data);
            else setBillError(true);
        } catch (err) {
            console.warn('Failed to fetch billing:', err);
            setBillError(true);
        } finally {
            setLoadingBill(false);
        }
    };

    /**
     * End of the service journey: drop every screen in the stack and land on Home.
     *
     * The booking, its history entry and the profile totals all changed as a
     * result of this payment, so the caches are invalidated before navigating —
     * otherwise Home and Bookings would briefly show the pre-payment state.
     */
    const finishAndGoHome = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.serviceRequests });
        queryClient.invalidateQueries({ queryKey: queryKeys.serviceHistory });
        queryClient.invalidateQueries({ queryKey: queryKeys.profile });

        navigation.reset({
            index: 0,
            routes: [
                {
                    name: 'CustomerTabs',
                    state: { index: 0, routes: [{ name: 'HomeTab' }] },
                },
            ],
        });
    }, [navigation, queryClient]);

    // On the success screen the hardware back button must not drop the user back
    // into the payment screen for a booking they have already paid for.
    useFocusEffect(
        useCallback(() => {
            if (paymentState !== 'success') return;
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                finishAndGoHome();
                return true; // handled — suppress default back
            });
            return () => sub.remove();
        }, [paymentState, finishAndGoHome]),
    );

    const handlePayment = async () => {
        if (total == null) return;
        setPaymentState('loading');
        setPayError(null);
        try {
            if (total <= 0) {
                // If amount is 0 (e.g. covered entirely by booking fee), just mark complete via verify endpoint
                await apiClient.post('/api/payments/verify', { 
                    razorpay_payment_id: 'zero_amount', 
                    razorpay_order_id: `order_${request.id}`, 
                    razorpay_signature: 'zero_amount_sig' 
                });
                setPaymentState('success');
                return;
            }

            // Create Razorpay order on backend
            const { data } = await apiClient.post(
                `/api/customer/services/${request.id}/create-final-payment`
            );

            if (data?.razorpayOrder?.orderId) {
                const paymentResponse = await openRazorpayCheckout({
                    razorpayOrderId: data.razorpayOrder.orderId,
                    razorpayKeyId: data.razorpayOrder.razorpayKeyId,
                    amount: data.razorpayOrder.amount,
                    description: `Final Payment — Booking #${request.id}`,
                });

                // Verify on backend
                await apiClient.post('/api/payments/verify', paymentResponse);
                setPaymentState('success');
            } else if (__DEV__) {
                // Local development without Razorpay keys only.
                setPaymentState('success');
            } else {
                // No order means nothing can be paid — never show a success the customer did not get.
                throw new Error(data?.error || data?.message || 'Could not start the payment.');
            }
        } catch (err: any) {
            // Unlock cash payment on backend
            try {
                await apiClient.post(`/api/customer/services/${request.id}/cancel-final-payment`);
            } catch (unlockErr) {
                console.warn('Failed to unlock payment method', unlockErr);
            }

            if (err?.code === 2) {
                // User cancelled
                setPaymentState('idle');
            } else {
                setPayError(getApiErrorMessage(err));
                setPaymentState('failed');
            }
        }
    };

    if (!request) {
        // Arrived from a notification with only an id: hold on a spinner until
        // the bookings list resolves, and only bail out if it truly isn't there.
        if (paramId && liveRequests === undefined) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            );
        }
        return <BackOnMount navigation={navigation} />;
    }

    // Every figure on this screen is the server's — the bill frozen on the
    // booking. Nothing is estimated here: an estimate shown next to a Pay
    // button is a promise, and the server charges its own number.
    const billing: any = billingData?.billing ?? null;
    const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
    const isFixedPrice = Number(billing?.snapshotVersion) === 2;
    const total = num(billing?.finalTotal) ?? (billing ? num(request.totalCharge) : null);
    const bookingCredit = num(billing?.bookingFeeCredit) ?? num(billing?.bookingFee) ?? 0;
    const addedParts = Number(billing?.extraPartsCost || 0) + Number(billing?.platformPartsCost || 0);
    const addedPartsGst = Number(billing?.partsGst || 0);
    const sparePartsCost = Number(billing?.sparePartsCost || 0);
    const serviceLaborCost = Number(billing?.serviceLaborCost || 0);
    const subtotal = num(billing?.subtotal) ?? sparePartsCost + serviceLaborCost;
    const platformFee = Number(billing?.platformFee || 0);
    const gst = num(billing?.gst) ?? Number(billing?.cgst || 0) + Number(billing?.sgst || 0);
    const gstRate = num(billing?.gstPercent);
    const feeRate = num(billing?.platformFeePercent);
    const billReady = !loadingBill && !billError && total != null;

    if (paymentState === 'success') {
        return (
            <View style={styles.successContainer}>
                <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: fadeAnim }}>
                    <View style={styles.successCircle}>
                        <CheckCircle size={56} color={colors.textInverse} />
                    </View>
                </Animated.View>
                <Text style={styles.successTitle}>Payment Successful!</Text>
                {total != null && <Text style={styles.successAmount}>{inr(total)}</Text>}
                <Text style={styles.successSub}>
                    Your service booking is now complete. Thank you for choosing UniteFix!
                </Text>
                <Button
                    title="Done"
                    onPress={finishAndGoHome}
                    style={{ marginTop: spacing['2xl'] }}
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
                    <ArrowLeft size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>Complete Payment</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 96 }]} showsVerticalScrollIndicator={false}>
                {/* Amount Hero */}
                <View style={styles.amountCard}>
                    <Text style={styles.amountLabel}>Total Due</Text>
                    {billReady
                        ? <Text style={styles.amountValue} numberOfLines={1} adjustsFontSizeToFit>{inr(total)}</Text>
                        : <ActivityIndicator color={colors.textInverse} style={{ marginVertical: spacing.md }} />}
                    <View style={styles.amountBadge}>
                        <Shield size={12} color={colors.textInverse} />
                        <Text style={styles.amountBadgeText}>Secure Payment via Razorpay</Text>
                    </View>
                </View>

                {/* Bill Breakdown */}
                <View style={styles.billCard}>
                    <View style={styles.billHeader}>
                        <Receipt size={18} color={colors.textPrimary} />
                        <Text style={styles.billTitle}>Bill Summary</Text>
                    </View>

                    {loadingBill ? (
                        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
                    ) : !billReady ? (
                        <View style={styles.billErrorBox}>
                            <Text style={styles.billErrorText}>We couldn't load your bill. Check your connection and try again — you won't be charged until you see the amount.</Text>
                            <Button title="Try again" variant="outline" size="sm" fullWidth={false} onPress={fetchBilling} />
                        </View>
                    ) : (
                        <>
                            {isFixedPrice ? (
                                <BillRow label={`Service price${gstRate != null ? ` (incl. ${gstRate}% GST)` : ' (incl. GST)'}`} value={num(billing.basePrice) ?? 0} />
                            ) : (
                                <>
                                    {sparePartsCost > 0 && <BillRow label="Spare parts" value={sparePartsCost} />}
                                    {serviceLaborCost > 0 && <BillRow label="Service labour" value={serviceLaborCost} />}
                                    <View style={styles.billDivider} />
                                    <BillRow label="Subtotal" value={subtotal} />
                                    {platformFee > 0 && <BillRow label={`UniteFix fee${feeRate != null ? ` (${feeRate}%)` : ''}`} value={platformFee} />}
                                    {gst > 0 && <BillRow label={`GST${gstRate != null ? ` (${gstRate}%)` : ''}`} value={gst} />}
                                </>
                            )}
                            {addedParts > 0 && <BillRow label="Spare parts fitted" value={addedParts} />}
                            {addedPartsGst > 0 && <BillRow label="GST on parts" value={addedPartsGst} />}
                            {bookingCredit > 0 && <BillRow label="Booking fee already paid" value={-bookingCredit} good />}
                            <View style={styles.billDivider} />
                            <View style={styles.billRow}>
                                <Text style={styles.billTotal}>Total due</Text>
                                <Text style={styles.billTotalValue} numberOfLines={1} adjustsFontSizeToFit>{inr(total)}</Text>
                            </View>
                        </>
                    )}
                </View>

                {/* Service Info */}
                <View style={styles.serviceInfo}>
                    <Text style={styles.serviceInfoLabel}>Service</Text>
                    <Text style={styles.serviceInfoValue}>
                        {request.serviceType?.replace(/_/g, ' ')}
                    </Text>
                    <Text style={styles.serviceInfoSub}>Booking #{request.id}</Text>
                </View>
            </ScrollView>

            {/* Fixed Bottom CTA */}
            <View style={[styles.ctaContainer, { paddingBottom: bottomPad }]}>
                <Button
                    title={!billReady ? 'Loading your bill…' : paymentState === 'failed' ? 'Try payment again' : total! <= 0 ? 'Complete booking' : `Pay ${inr(total)}`}
                    onPress={handlePayment}
                    loading={paymentState === 'loading'}
                    disabled={!billReady}
                    variant={paymentState === 'failed' ? 'danger' : 'primary'}
                    icon={<CreditCard size={20} color="#fff" />}
                />
                {paymentState === 'failed' && (
                    <Text style={styles.failedText}>
                        {payError ?? 'Payment failed.'} No money was taken unless your bank confirms it.
                    </Text>
                )}
            </View>
        </View>
    );
}


function BillRow({ label, value, good }: { label: string; value: number; good?: boolean }) {
    return (
        <View style={styles.billRow}>
            <Text style={[styles.billLabel, good && { color: colors.success }]}>{label}</Text>
            <Text style={[styles.billValue, good && { color: colors.success }]}>{inr(value, { paise: 'always' })}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingBottom: spacing.base, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: {
        width: 40, height: 40, borderRadius: radii.lg,
        backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center',
    },
    headerTitle: { ...typography.h4, color: colors.textPrimary, flex: 1, textAlign: 'center' },
    scrollContent: { padding: spacing.xl, paddingBottom: 120 },

    // Amount hero
    billErrorBox: { paddingVertical: spacing.md, gap: spacing.md, alignItems: 'flex-start' },
    billErrorText: { ...typography.body, color: colors.textSecondary },
    amountCard: {
        backgroundColor: colors.primary,
        borderRadius: radii['2xl'], padding: spacing['2xl'],
        alignItems: 'center', marginBottom: spacing.xl,
        ...shadows.glow,
    },
    amountLabel: { ...typography.captionMedium, color: 'rgba(255,255,255,0.7)' },
    amountValue: { ...typography.monoLarge, color: colors.textInverse, fontSize: 40, marginTop: spacing.xs },
    amountBadge: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
        borderRadius: radii.full, marginTop: spacing.md,
    },
    amountBadgeText: { ...typography.small, color: 'rgba(255,255,255,0.9)' },

    // Bill breakdown
    billCard: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.lg,
        borderWidth: 1, borderColor: colors.border, ...shadows.sm,
    },
    billHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
    billTitle: { ...typography.h4, color: colors.textPrimary },
    billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
    billLabel: { ...typography.body, color: colors.textSecondary, flex: 1, minWidth: 0 },
    billValue: { ...typography.mono, color: colors.textPrimary, fontSize: 14, flexShrink: 0 },
    billDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
    billTotal: { ...typography.h4, color: colors.textPrimary },
    billTotalValue: { ...typography.monoLarge, color: colors.primary, fontSize: 22 },

    // Service info
    serviceInfo: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, borderWidth: 1, borderColor: colors.border,
    },
    serviceInfoLabel: { ...typography.small, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
    serviceInfoValue: { ...typography.h3, color: colors.textPrimary, textTransform: 'capitalize', marginTop: 4 },
    serviceInfoSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

    // CTA
    ctaContainer: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: colors.background,
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.lg,
        borderTopWidth: 1, borderTopColor: colors.divider,
        ...shadows.lg,
    },
    failedText: { ...typography.caption, color: colors.error, textAlign: 'center', marginTop: spacing.sm },

    loadingContainer: {
        flex: 1, backgroundColor: colors.background,
        justifyContent: 'center', alignItems: 'center',
    },

    // Success
    successContainer: {
        flex: 1, backgroundColor: colors.background,
        justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: spacing['2xl'],
    },
    successCircle: {
        width: 100, height: 100, borderRadius: 50,
        backgroundColor: colors.success, justifyContent: 'center', alignItems: 'center',
        ...shadows.successGlow,
    },
    successTitle: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.xl },
    successAmount: { ...typography.monoLarge, color: colors.success, fontSize: 36, marginTop: spacing.sm },
    successSub: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },

    // Cash option
    cashOptionContainer: {
        marginTop: spacing.md,
        paddingVertical: spacing.sm,
        alignItems: 'center',
    },
    cashOptionText: {
        ...typography.small,
        color: colors.textSecondary,
        textDecorationLine: 'underline',
    },
});
