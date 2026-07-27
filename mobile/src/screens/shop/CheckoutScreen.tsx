/**
 * Checkout Screen — Address, payment summary, place order via Razorpay
 * Role: 🟦 Customer only
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, MapPin, CreditCard, ShieldCheck, Package } from 'lucide-react-native';
import { useCart, useCheckout } from '../../hooks/useShopData';
import { CartItem } from '../../api/shop.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { openRazorpayCheckout } from '../../services/razorpay';
import { apiClient } from '../../api/client';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'Checkout'>;

export function CheckoutScreen({ navigation }: Props) {
    const { headerTop, bottomBar: bottomPad } = useScreenInsets();
    const { data: cartData, isLoading } = useCart();
    const { mutate: checkout, isPending } = useCheckout();

    const [address, setAddress] = useState('');
    const [city, setCity] = useState('');
    const [pincode, setPincode] = useState('');
    const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');

    const cartItems: CartItem[] = Array.isArray(cartData) ? cartData : (cartData as any)?.data || [];

    const subtotal = cartItems.reduce((sum, item) => {
        return sum + (item.product?.price || 0) * item.quantity;
    }, 0);
    const deliveryCharge = subtotal > 500 ? 0 : 49;
    const total = subtotal + deliveryCharge;

    const handlePlaceOrder = () => {
        if (!address.trim()) { Alert.alert('Required', 'Please enter a delivery address.'); return; }
        if (!city.trim()) { Alert.alert('Required', 'Please enter city.'); return; }
        if (!pincode.trim() || pincode.length < 6) { Alert.alert('Required', 'Enter valid 6-digit pincode.'); return; }

        const fullAddress = `${address}, ${city} - ${pincode}`;

        if (paymentMethod === 'online') {
            const processOnlinePayment = async () => {
                try {
                    // Create order on backend
                    const { data } = await apiClient.post('/api/shop/create-order', {
                        amount: total,
                        address: fullAddress,
                    });

                    if (data?.data?.razorpayOrderId) {
                        const paymentResponse = await openRazorpayCheckout({
                            razorpayOrderId: data.data.razorpayOrderId,
                            razorpayKeyId: data.data.razorpayKeyId,
                            amount: total,
                            description: `Product Order — ₹${total}`,
                        });

                        // Verify payment
                        await apiClient.post('/api/payments/verify', paymentResponse);

                        // Now place the order
                        checkout(
                            { address: fullAddress, paymentMethod: 'online', paymentId: paymentResponse.razorpay_payment_id },
                            { onSuccess: () => { Alert.alert('Order Placed! ✅', 'Payment successful.'); navigation.replace('OrderConfirmation', { total }); } }
                        );
                    }
                } catch (err: any) {
                    if (err?.code !== 2) {
                        Alert.alert('Payment Failed', err?.description || 'Please try again.');
                    }
                }
            };
            processOnlinePayment();
        } else {
            checkout(
                { address: fullAddress },
                { onSuccess: () => navigation.replace('OrderConfirmation', { total }) },
            );
        }
    };

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    if (cartItems.length === 0) {
        navigation.goBack();
        return null;
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Checkout</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 96 }]} showsVerticalScrollIndicator={false}>
                {/* Delivery Address */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <MapPin size={18} color={colors.primary} />
                        <Text style={styles.cardTitle}>Delivery Address</Text>
                    </View>
                    <TextInput
                        style={styles.input}
                        placeholder="House/Flat No., Street, Landmark"
                        value={address}
                        onChangeText={setAddress}
                        multiline
                        placeholderTextColor={colors.textDisabled}
                    />
                    <View style={styles.row}>
                        <TextInput
                            style={[styles.input, styles.halfInput]}
                            placeholder="City"
                            value={city}
                            onChangeText={setCity}
                            placeholderTextColor={colors.textDisabled}
                        />
                        <TextInput
                            style={[styles.input, styles.halfInput]}
                            placeholder="Pincode"
                            value={pincode}
                            onChangeText={setPincode}
                            keyboardType="number-pad"
                            maxLength={6}
                            placeholderTextColor={colors.textDisabled}
                        />
                    </View>
                </View>

                {/* Payment Method */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <CreditCard size={18} color={colors.primary} />
                        <Text style={styles.cardTitle}>Payment Method</Text>
                    </View>
                    <TouchableOpacity
                        style={[styles.paymentOption, paymentMethod === 'online' && styles.paymentSelected]}
                        onPress={() => setPaymentMethod('online')}
                    >
                        <View style={[styles.radio, paymentMethod === 'online' && styles.radioSelected]} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.paymentLabel}>Pay Online (UPI / Card / Netbanking)</Text>
                            <Text style={styles.paymentSub}>Powered by Razorpay</Text>
                        </View>
                        <ShieldCheck size={16} color={colors.success} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.paymentOption, paymentMethod === 'cod' && styles.paymentSelected]}
                        onPress={() => setPaymentMethod('cod')}
                    >
                        <View style={[styles.radio, paymentMethod === 'cod' && styles.radioSelected]} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.paymentLabel}>Cash on Delivery</Text>
                            <Text style={styles.paymentSub}>Pay when you receive</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Order Items */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <Package size={18} color={colors.primary} />
                        <Text style={styles.cardTitle}>Order Items ({cartItems.length})</Text>
                    </View>
                    {cartItems.map((item) => (
                        <View key={item.id} style={styles.itemRow}>
                            <Text style={styles.itemName} numberOfLines={1}>
                                {item.product?.name || `Product #${item.productId}`}
                            </Text>
                            <Text style={styles.itemQty}>×{item.quantity}</Text>
                            <Text style={styles.itemPrice}>₹{(item.product?.price || 0) * item.quantity}</Text>
                        </View>
                    ))}
                </View>

                {/* Order Summary */}
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Order Summary</Text>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Subtotal</Text>
                        <Text style={styles.summaryValue}>₹{subtotal}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Delivery</Text>
                        <Text style={[styles.summaryValue, deliveryCharge === 0 ? { color: colors.success } : {}]}>
                            {deliveryCharge === 0 ? 'FREE' : `₹${deliveryCharge}`}
                        </Text>
                    </View>
                    {deliveryCharge > 0 && (
                        <Text style={styles.freeDeliveryHint}>
                            Add ₹{500 - subtotal} more for free delivery
                        </Text>
                    )}
                    <View style={[styles.summaryRow, styles.totalRow]}>
                        <Text style={styles.totalLabel}>Total</Text>
                        <Text style={styles.totalValue}>₹{total}</Text>
                    </View>
                </View>
            </ScrollView>

            {/* Bottom CTA */}
            <View style={[styles.bottomBar, { paddingBottom: bottomPad }]}>
                <View>
                    <Text style={styles.bottomLabel}>Total Amount</Text>
                    <Text style={styles.bottomAmount}>₹{total}</Text>
                </View>
                <Button
                    title={paymentMethod === 'online' ? `Pay ₹${total}` : 'Place Order'}
                    onPress={handlePlaceOrder}
                    loading={isPending}
                    style={{ flex: 0.55 }}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { padding: spacing.xl, paddingBottom: 120 },
    card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    cardTitle: { ...typography.h4, color: colors.textPrimary },
    input: {
        borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
        padding: spacing.md, ...typography.body, color: colors.textPrimary, marginBottom: spacing.sm,
    },
    row: { flexDirection: 'row', gap: spacing.sm },
    halfInput: { flex: 1 },
    paymentOption: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        padding: spacing.md, borderWidth: 1, borderColor: colors.border,
        borderRadius: radii.md, marginBottom: spacing.sm,
    },
    paymentSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
    radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
    paymentLabel: { ...typography.bodyMedium, color: colors.textPrimary },
    paymentSub: { ...typography.small, color: colors.textSecondary },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
    itemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
    itemQty: { ...typography.caption, color: colors.textSecondary, marginHorizontal: spacing.md },
    itemPrice: { ...typography.bodyMedium, color: colors.textPrimary },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    summaryLabel: { ...typography.body, color: colors.textSecondary },
    summaryValue: { ...typography.bodyMedium, color: colors.textPrimary },
    freeDeliveryHint: { ...typography.small, color: colors.primary, fontStyle: 'italic', marginBottom: spacing.sm },
    totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { fontSize: 20, fontWeight: '800', color: colors.primary },
    bottomBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.background, padding: spacing.xl,
        borderTopWidth: 1, borderTopColor: colors.divider, ...shadows.md,
    },
    bottomLabel: { ...typography.small, color: colors.textSecondary },
    bottomAmount: { ...typography.h3, color: colors.textPrimary },
});
