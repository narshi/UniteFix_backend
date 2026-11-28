/**
 * Checkout: delivery address (with the state — it decides the GST on the
 * invoice), the order summary priced by the server, then payment.
 *
 * Safe against double taps and bad networks: each "Place order" attempt
 * carries one Idempotency-Key, so a retry returns the same checkout instead of
 * charging twice. Stock is held while the customer pays; closing the payment
 * sheet gives it back at once. If confirming the payment fails on the way back,
 * the app asks the server, which may already have the order from Razorpay.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Modal, FlatList, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import { ChevronDown, Package, ShieldCheck } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button, ScreenHeader, EmptyState } from '../../components/ui';
import { useCheckoutPreview, useRefreshShop } from '../../hooks/useShopData';
import { shopApi, STATES, type CheckoutSource, type PayResult, type ShipTo } from '../../api/shop.api';
import { getApiErrorMessage } from '../../api/client';
import { openRazorpayCheckout } from '../../services/razorpay';
import { useAuthStore } from '../../stores/auth.store';
import { ProductImage, rupees } from './parts';

type Props = NativeStackScreenProps<any, 'Checkout'>;
const SHIP_KEY = 'shop_ship_to';
const newKey = () => `app-${Crypto.randomUUID()}`;
const codeOf = (e: unknown) => (axios.isAxiosError(e) ? (e.response?.data as any)?.code : undefined);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function CheckoutScreen({ navigation, route }: Props) {
    const { bottomBar } = useScreenInsets();
    const user = useAuthStore(s => s.user);
    const refreshShop = useRefreshShop();
    const src: CheckoutSource = useMemo(
        () => (route.params?.source === 'buy_now' ? { source: 'buy_now', items: route.params.items } : { source: 'cart' }),
        [route.params],
    );
    const preview = useCheckoutPreview(src);
    const [ship, setShip] = useState<ShipTo>({ name: (user as any)?.username ?? '', phone: String((user as any)?.phone ?? '').replace(/\D/g, '').slice(-10), line1: '', line2: '', city: '', pincode: '', stateCode: '29' });
    const [pickState, setPickState] = useState(false);
    const [pinNote, setPinNote] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const keyRef = useRef(newKey());

    // The last address used, so a returning customer does not type it again.
    useEffect(() => {
        SecureStore.getItemAsync(SHIP_KEY).then(raw => { if (raw) setShip(s => ({ ...s, ...JSON.parse(raw) })); }).catch(() => null);
    }, []);

    const set = (k: keyof ShipTo) => (v: string) => setShip(s => ({ ...s, [k]: v }));

    // A full pincode fills the state (it decides the GST) and an empty city, and warns if India Post does not deliver there.
    useEffect(() => {
        setPinNote(null);
        if (!/^[1-9]\d{5}$/.test(ship.pincode)) return;
        let live = true;
        shopApi.pincode(ship.pincode).then(p => {
            if (!live || !p?.known) return;
            if (p.deliverable === false) { setPinNote('India Post does not deliver to this pincode. Check it, or use another address.'); return; }
            setShip(s => ({ ...s, stateCode: p.stateCode || s.stateCode, city: s.city.trim() ? s.city : (p.city ?? s.city) }));
        }).catch(() => null);
        return () => { live = false; };
    }, [ship.pincode]);
    const missing = !ship.name.trim() ? 'the name' : !/^[6-9]\d{9}$/.test(ship.phone) ? 'a 10-digit mobile number' : ship.line1.trim().length < 3 ? 'the address' : ship.city.trim().length < 2 ? 'the city' : !/^[1-9]\d{5}$/.test(ship.pincode) ? 'a 6-digit pincode' : null;
    const state = STATES.find(s => s.code === ship.stateCode);

    const done = (r: PayResult, checkoutId: number) => {
        refreshShop();
        if (r.status === 'refund_due') {
            Alert.alert('Sold out while you paid', r.message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
            return;
        }
        navigation.replace('OrderConfirmation', { checkoutId, orders: r.orders, total: preview.data?.total ?? null });
    };

    /** Verify failed on the way back: the webhook may have placed the order anyway. */
    const confirmFromServer = async (checkoutId: number) => {
        for (let i = 0; i < 6; i++) {
            try {
                const s = await shopApi.checkoutStatus(checkoutId);
                if (s.status === 'paid') return done({ status: 'paid', message: 'Order placed.', orders: s.orders }, checkoutId);
                if (s.status === 'refund_due') return done({ status: 'refund_due', message: `${s.failureReason ?? 'An item'} sold out while you paid. Your payment is being refunded in full.`, orders: [] }, checkoutId);
            } catch { /* keep asking */ }
            await sleep(2000);
        }
        refreshShop();
        Alert.alert('Confirming your payment', 'We are still confirming your payment with the bank. Your order will appear in My orders in a few minutes. You have not been charged twice.', [
            { text: 'My orders', onPress: () => navigation.replace('ShopOrders') },
        ]);
    };

    const place = async () => {
        if (missing) { Alert.alert('Delivery address', `Add ${missing}.`); return; }
        if (busy) return;
        setBusy(true);
        try {
            SecureStore.setItemAsync(SHIP_KEY, JSON.stringify(ship)).catch(() => null);
            let started;
            try {
                started = await shopApi.startCheckout(src, ship, keyRef.current);
            } catch (e) {
                if (codeOf(e) === 'CHECKOUT_ENDED') { keyRef.current = newKey(); started = await shopApi.startCheckout(src, ship, keyRef.current); }
                else throw e;
            }
            if (started.status === 'paid') return done({ status: 'paid', message: 'Order placed.', orders: [] }, started.checkoutId);

            if (started.payment.provider === 'mock') {
                return done(await shopApi.mockPay(started.checkoutId), started.checkoutId);
            }
            const pay = started.payment;
            let paid;
            try {
                paid = await openRazorpayCheckout({
                    razorpayOrderId: pay.orderId, razorpayKeyId: pay.keyId ?? undefined, amount: pay.amountPaise / 100,
                    description: `UniteFix store order`, customerName: ship.name, customerPhone: ship.phone,
                });
            } catch (err: any) {
                // Closed or failed: give the held stock back now, and start fresh next time.
                shopApi.abandon(started.checkoutId).catch(() => null);
                keyRef.current = newKey();
                if (err?.code === 2) Alert.alert('Payment cancelled', 'Nothing was charged. Your items are still here when you are ready.');
                else Alert.alert('Payment failed', err?.description || 'The payment did not go through. Nothing was charged.');
                return;
            }
            try {
                return done(await shopApi.verify(started.checkoutId, paid), started.checkoutId);
            } catch (e) {
                if (codeOf(e) === 'BAD_SIGNATURE') { Alert.alert('Payment not verified', 'We could not verify this payment. If money left your account, it will be refunded automatically.'); return; }
                return confirmFromServer(started.checkoutId);
            }
        } catch (e) {
            const code = codeOf(e);
            Alert.alert(code === 'OUT_OF_STOCK' ? 'Not enough stock' : 'Could not place the order', getApiErrorMessage(e));
            if (code === 'OUT_OF_STOCK' || code === 'GONE') preview.refetch();
        } finally {
            setBusy(false);
        }
    };

    if (preview.isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
    if (preview.isError || !preview.data) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Checkout" onBack={() => navigation.goBack()} />
                <EmptyState title="Cannot check out right now" description={getApiErrorMessage(preview.error)} actionLabel="Back" onAction={() => navigation.goBack()} />
            </View>
        );
    }
    const p = preview.data;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScreenHeader title="Checkout" onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={{ padding: spacing.base, gap: spacing.md, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Deliver to</Text>
                    <Field label="Full name" value={ship.name} onChange={set('name')} autoComplete="name" />
                    <Field label="Mobile number" value={ship.phone} onChange={v => set('phone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" autoComplete="tel" />
                    <Field label="House, building, street" value={ship.line1} onChange={set('line1')} autoComplete="street-address" />
                    <Field label="Area, landmark (optional)" value={ship.line2 ?? ''} onChange={set('line2')} />
                    <View style={styles.twoCol}>
                        <View style={{ flex: 1 }}><Field label="City / town" value={ship.city} onChange={set('city')} /></View>
                        <View style={{ flex: 1 }}><Field label="Pincode" value={ship.pincode} onChange={v => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="postal-code" /></View>
                    </View>
                    {!!pinNote && <Text style={{ ...typography.caption, color: colors.error, marginBottom: spacing.sm }}>{pinNote}</Text>}
                    <Text style={styles.fieldLabel}>State</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setPickState(true)} accessibilityRole="button" accessibilityLabel={`State: ${state?.name ?? 'choose'}`}>
                        <Text style={styles.selectText}>{state?.name ?? 'Choose the state'}</Text>
                        <ChevronDown size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                </View>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Order summary</Text>
                    {p.multipleParcels && (
                        <View style={styles.parcels}>
                            <Package size={16} color={colors.info} />
                            <Text style={styles.parcelsText}>Ships in {p.sellers.length} parcels, one from each seller, each with its own invoice.</Text>
                        </View>
                    )}
                    {p.lines.map((l, i) => (
                        <View key={i} style={styles.line}>
                            <ProductImage uri={l.image} size={48} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.lineName} numberOfLines={2}>{l.name}</Text>
                                <Text style={styles.meta}>{l.quantity} × {rupees(l.price)} · {l.seller}</Text>
                                <Text style={styles.meta}>{l.kind === 'installation' ? 'Installation service' : l.returnWindowDays > 0 ? `Returnable within ${l.returnWindowDays} day${l.returnWindowDays === 1 ? '' : 's'}` : 'Not returnable (damaged or wrong items are replaced)'}</Text>
                            </View>
                            <Text style={styles.lineTotal}>{rupees(l.total)}</Text>
                        </View>
                    ))}
                    {p.stockIssues.length > 0 && <Text style={styles.warn}>Stock changed: {p.stockIssues.join('; ')}. Go back and adjust the quantity.</Text>}
                    <View style={styles.sumRow}><Text style={styles.meta}>Delivery</Text><Text style={styles.free}>Free</Text></View>
                    {p.savings > 0 && <View style={styles.sumRow}><Text style={styles.meta}>You save</Text><Text style={styles.free}>{rupees(p.savings)}</Text></View>}
                    <View style={styles.sumRow}><Text style={styles.meta}>GST included</Text><Text style={styles.meta}>{rupees(p.tax)}</Text></View>
                    <View style={[styles.sumRow, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.total}>{rupees(p.total)}</Text></View>
                </View>

                <View style={styles.trust}>
                    <ShieldCheck size={16} color={colors.successDark} />
                    <Text style={styles.trustText}>Paid securely through Razorpay. A GST invoice from the seller comes with your order.</Text>
                </View>
            </ScrollView>

            <View style={[styles.bar, { paddingBottom: bottomBar }]}>
                <Button title={busy ? 'Placing your order…' : `Pay ${rupees(p.total)}`} onPress={place} loading={busy} disabled={busy || p.stockIssues.length > 0} />
            </View>

            <Modal visible={pickState} animationType="slide" onRequestClose={() => setPickState(false)}>
                <View style={[styles.screen, { paddingTop: spacing['3xl'] }]}>
                    <Text style={[styles.cardTitle, { paddingHorizontal: spacing.base, paddingBottom: spacing.sm }]}>Choose the state</Text>
                    <FlatList
                        data={STATES}
                        keyExtractor={s => s.code}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={[styles.stateRow, item.code === ship.stateCode && { backgroundColor: colors.primarySurface }]} onPress={() => { set('stateCode')(item.code); setPickState(false); }}>
                                <Text style={styles.selectText}>{item.name}</Text>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

function Field({ label, value, onChange, keyboardType, autoComplete }: { label: string; value: string; onChange: (v: string) => void; keyboardType?: any; autoComplete?: any }) {
    return (
        <View style={{ gap: 4 }}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput style={styles.input} value={value} onChangeText={onChange} keyboardType={keyboardType} autoComplete={autoComplete} placeholderTextColor={colors.textTertiary} accessibilityLabel={label} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.base, gap: spacing.sm, borderWidth: 1, borderColor: colors.divider },
    cardTitle: { ...typography.h4, color: colors.textPrimary },
    fieldLabel: { ...typography.captionMedium, color: colors.textSecondary },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, height: 44, ...typography.body, color: colors.textPrimary },
    twoCol: { flexDirection: 'row', gap: spacing.md },
    select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, height: 44 },
    selectText: { ...typography.body, color: colors.textPrimary },
    stateRow: { paddingHorizontal: spacing.base, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
    parcels: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.infoLight, borderRadius: radii.md, padding: spacing.sm },
    parcelsText: { ...typography.caption, color: colors.textPrimary, flexShrink: 1 },
    line: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
    lineName: { ...typography.bodyMedium, color: colors.textPrimary },
    lineTotal: { ...typography.bodySemibold, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary },
    warn: { ...typography.caption, color: colors.error },
    sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
    free: { ...typography.captionMedium, color: colors.successDark },
    totalRow: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
    totalLabel: { ...typography.bodySemibold, color: colors.textPrimary },
    total: { ...typography.h3, color: colors.textPrimary },
    trust: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingHorizontal: spacing.sm },
    trustText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.background, paddingHorizontal: spacing.base, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, ...shadows.md },
});
