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
import { Button } from '../../components/ui';
import { apiClient } from '../../api/client';
import { usePublicConfig, queryKeys } from '../../hooks/useCustomerData';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FinalPayment'>;

export function FinalPaymentScreen({ navigation, route }: Props) {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const queryClient = useQueryClient();
    const request = route.params?.request;
    const [paymentState, setPaymentState] = useState<'idle' | 'loading' | 'success' | 'failed'>('idle');
    const [billingData, setBillingData] = useState<any>(null);
    const [loadingBill, setLoadingBill] = useState(true);
    const { data: publicConfig } = usePublicConfig();

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 7 }),
        ]).start();

        // Fetch billing details
        fetchBilling();
    }, []);

    const fetchBilling = async () => {
        try {
            const { data } = await apiClient.get(`/api/v1/bookings/${request.id}/billing`);
            if (data?.success) {
                setBillingData(data.data);
            }
        } catch (err) {
            console.warn('Failed to fetch billing:', err);
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
        setPaymentState('loading');
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
            } else {
                // Dev fallback
                setPaymentState('success');
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
                setPaymentState('failed');
                setTimeout(() => setPaymentState('idle'), 3000);
            }
        }
    };

    if (!request) {
        navigation.goBack();
        return null;
    }

    const billing = billingData?.billing || {};
    const sparePartsCost = billing.sparePartsCost || request.materialCharge || 0;
    const serviceLaborCost = billing.serviceLaborCost || request.serviceCharge || 0;
    const subtotal = sparePartsCost + serviceLaborCost;
    const platformFee = billing.platformFee || Math.round(subtotal * 0.15);
    const gst = billing.gst || Math.round((subtotal + platformFee) * 0.18);
    const bookingCredit = request?.bookingFee ?? publicConfig?.bookingFee ?? 99;
    const total = billing.finalTotal || request.totalCharge || (subtotal + platformFee + gst - bookingCredit);

    if (paymentState === 'success') {
        return (
            <View style={styles.successContainer}>
                <Animated.View style={{ transform: [{ scale: scaleAnim }], opacity: fadeAnim }}>
                    <View style={styles.successCircle}>
                        <CheckCircle size={56} color={colors.textInverse} />
                    </View>
                </Animated.View>
                <Text style={styles.successTitle}>Payment Successful!</Text>
                <Text style={styles.successAmount}>₹{total}</Text>
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
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Complete Payment</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 96 }]} showsVerticalScrollIndicator={false}>
                {/* Amount Hero */}
                <View style={styles.amountCard}>
                    <Text style={styles.amountLabel}>Total Due</Text>
                    <Text style={styles.amountValue}>₹{total}</Text>
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
                    ) : (
                        <>
                            <View style={styles.billRow}>
                                <Text style={styles.billLabel}>Spare Parts</Text>
                                <Text style={styles.billValue}>₹{sparePartsCost}</Text>
                            </View>
                            <View style={styles.billRow}>
                                <Text style={styles.billLabel}>Service Labour</Text>
                                <Text style={styles.billValue}>₹{serviceLaborCost}</Text>
                            </View>
                            <View style={styles.billDivider} />
                            <View style={styles.billRow}>
                                <Text style={styles.billLabel}>Subtotal</Text>
                                <Text style={styles.billValue}>₹{subtotal}</Text>
                            </View>
                            <View style={styles.billRow}>
                                <Text style={styles.billLabel}>UniteFix Fee (15%)</Text>
                                <Text style={styles.billValue}>₹{platformFee}</Text>
                            </View>
                            <View style={styles.billRow}>
                                <Text style={styles.billLabel}>GST (18%)</Text>
                                <Text style={styles.billValue}>₹{gst}</Text>
                            </View>
                            <View style={styles.billRow}>
                                <Text style={[styles.billLabel, { color: colors.success }]}>
                                    Booking Fee Credit
                                </Text>
                                <Text style={[styles.billValue, { color: colors.success }]}>
                                    -₹{bookingCredit}
                                </Text>
                            </View>
                            <View style={styles.billDivider} />
                            <View style={styles.billRow}>
                                <Text style={styles.billTotal}>Total</Text>
                                <Text style={styles.billTotalValue}>₹{total}</Text>
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
                    title={paymentState === 'failed' ? 'Retry Payment' : `Pay ₹${total}`}
                    onPress={handlePayment}
                    loading={paymentState === 'loading'}
                    variant={paymentState === 'failed' ? 'danger' : 'primary'}
                    icon={<CreditCard size={20} color="#fff" />}
                />
                {paymentState === 'failed' && (
                    <Text style={styles.failedText}>
                        Payment failed. Please try again.
                    </Text>
            </View>
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
    billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    billLabel: { ...typography.body, color: colors.textSecondary },
    billValue: { ...typography.mono, color: colors.textPrimary, fontSize: 14 },
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
