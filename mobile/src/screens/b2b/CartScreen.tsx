/**
 * Cart and checkout, on one screen.
 *
 * The quote comes from the server for every change — the cart caches names
 * and prices for display, but the money on this screen is what the server
 * will charge, GST included, backorders named. Payment is a choice between
 * credit (when UniteFix has extended some and enough is free) and paying
 * now through Razorpay. A credit order is placed at once and UniteFix
 * confirms it; a prepaid order opens checkout and is verified on return —
 * and the webhook applies the capture even if the return never happens.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Trash2, CreditCard, Wallet, AlertTriangle } from 'lucide-react-native';
import { b2bApi, type PaymentMode } from '../../api/b2b.api';
import { getApiErrorMessage } from '../../api/client';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { useB2bCartStore } from '../../stores/b2bCart.store';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { ScreenHeader, Button, EmptyState } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'Cart'>;

export function CartScreen({ navigation }: Props) {
    const qc = useQueryClient();
    const { bottomBar } = useScreenInsets();
    const user = useAuthStore(s => s.user);
    const entries = useB2bCartStore(s => s.entries);
    const setQuantity = useB2bCartStore(s => s.setQuantity);
    const remove = useB2bCartStore(s => s.remove);
    const clear = useB2bCartStore(s => s.clear);

    const [mode, setMode] = useState<PaymentMode>('prepaid');
    const [notes, setNotes] = useState('');
    const [placing, setPlacing] = useState(false);

    const lines = useMemo(() => entries.map(e => ({ sparePartId: e.sparePartId, quantity: e.quantity })), [entries]);

    const credit = useQuery({
        queryKey: ['b2b-credit'],
        queryFn: async () => (await b2bApi.creditSummary()).data.data,
    });

    const quote = useQuery({
        queryKey: ['b2b-quote', lines],
        queryFn: async () => (await b2bApi.quote(lines)).data.data,
        enabled: lines.length > 0,
        placeholderData: (prev) => prev,
    });

    // Default to credit when it is there and covers the order; a partner who
    // was given terms expects to use them, and paying now is one tap away.
    const creditOk = !!credit.data && !credit.data.prepaidOnly && !!quote.data && credit.data.creditAvailable >= quote.data.total;
    useEffect(() => { setMode(creditOk ? 'credit' : 'prepaid'); }, [creditOk]);

    const place = async () => {
        if (!quote.data || lines.length === 0) return;
        setPlacing(true);
        try {
            const { data: res } = await b2bApi.placeOrder({ items: lines, paymentMode: mode, notes: notes.trim() || null });
            const placed = res.data.order;
            clear();
            qc.invalidateQueries({ queryKey: ['b2b-orders'] });
            qc.invalidateQueries({ queryKey: ['b2b-credit'] });

            if (mode === 'credit' || !res.data.razorpay) {
                Alert.alert('Order placed', res.message ?? `Order ${placed.orderCode} placed.`);
                navigation.replace('OrderDetail', { id: placed.id });
                return;
            }

            try {
                const rp = res.data.razorpay;
                const result = await openRazorpayCheckout({
                    razorpayOrderId: rp.orderId,
                    razorpayKeyId: rp.keyId,
                    amount: rp.amount,
                    description: `UniteFix trade order ${placed.orderCode}`,
                    customerName: user?.username ?? undefined,
                    customerEmail: user?.email ?? undefined,
                    customerPhone: user?.phone ?? undefined,
                });
                try {
                    await b2bApi.verifyPayment(placed.id, {
                        razorpay_order_id: result.razorpay_order_id,
                        razorpay_payment_id: result.razorpay_payment_id,
                        razorpay_signature: result.razorpay_signature,
                    });
                    Alert.alert('Payment received', `Order ${placed.orderCode} is paid. UniteFix will confirm and dispatch it.`);
                } catch {
                    Alert.alert('Payment made', 'It can take a minute to show on the order.');
                }
            } catch (err) {
                // Order exists, unpaid. It shows as "awaiting payment" and can be paid from its page.
                handleRazorpayError(err);
            }
            qc.invalidateQueries({ queryKey: ['b2b-orders'] });
            navigation.replace('OrderDetail', { id: placed.id });
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const msg = getApiErrorMessage(err);
            if (code === 'CREDIT_EXCEEDED' || code === 'PREPAID_ONLY') {
                Alert.alert('Credit not enough', `${msg}\n\nPay now instead?`, [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Pay now', onPress: () => { setMode('prepaid'); } },
                ]);
            } else {
                Alert.alert('Order not placed', msg);
            }
        } finally {
            setPlacing(false);
        }
    };

    if (entries.length === 0) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Cart" onBack={() => navigation.goBack()} />
                <EmptyState title="Nothing in the cart" description="Add parts from the catalogue to place a trade order." actionLabel="Browse catalogue" onAction={() => navigation.goBack()} />
            </View>
        );
    }

    const q = quote.data;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScreenHeader title="Cart" onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.card}>
                    {entries.map((e, i) => {
                        const ql = q?.lines.find(l => l.sparePartId === e.sparePartId);
                        return (
                            <View key={e.sparePartId} style={[styles.line, i > 0 && styles.lineBorder]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.lineName} numberOfLines={2}>{e.name}</Text>
                                    <Text style={styles.lineMeta}>{e.partCode} · ₹{ql?.unitPrice ?? e.tradePrice}/{e.unit || 'unit'}</Text>
                                    {ql?.backordered && <Text style={styles.backorder}>Backorder — UniteFix will confirm a date</Text>}
                                </View>
                                <View style={styles.stepper}>
                                    <TouchableOpacity onPress={() => setQuantity(e.sparePartId, e.quantity - 1)} style={styles.stepBtn}>
                                        {e.quantity === 1 ? <Trash2 size={14} color={colors.errorDark} /> : <Minus size={14} color={colors.primary} />}
                                    </TouchableOpacity>
                                    <Text style={styles.stepQty}>{e.quantity}</Text>
                                    <TouchableOpacity onPress={() => setQuantity(e.sparePartId, e.quantity + 1)} style={styles.stepBtn}><Plus size={14} color={colors.primary} /></TouchableOpacity>
                                </View>
                                <Text style={styles.lineTotal}>₹{ql?.lineTotal ?? e.tradePrice * e.quantity}</Text>
                            </View>
                        );
                    })}
                </View>

                <Text style={styles.sectionTitle}>Pay with</Text>
                <View style={styles.modes}>
                    <TouchableOpacity
                        style={[styles.mode, mode === 'credit' && styles.modeOn, !creditOk && styles.modeOff]}
                        disabled={!creditOk}
                        onPress={() => setMode('credit')}
                    >
                        <Wallet size={18} color={mode === 'credit' ? colors.primary : colors.textSecondary} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.modeTitle, mode === 'credit' && { color: colors.primary }]}>UniteFix credit</Text>
                            <Text style={styles.modeSub}>
                                {credit.isLoading ? '…' : credit.data?.prepaidOnly ? 'No credit terms on this account' : `₹${credit.data?.creditAvailable ?? 0} available`}
                            </Text>
                        </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.mode, mode === 'prepaid' && styles.modeOn]} onPress={() => setMode('prepaid')}>
                        <CreditCard size={18} color={mode === 'prepaid' ? colors.primary : colors.textSecondary} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.modeTitle, mode === 'prepaid' && { color: colors.primary }]}>Pay now</Text>
                            <Text style={styles.modeSub}>UPI, card or netbanking</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                <Text style={styles.sectionTitle}>Note for UniteFix (optional)</Text>
                <TextInput
                    style={styles.notes}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Delivery instructions, a PO number, anything the packer should know"
                    placeholderTextColor={colors.textDisabled}
                    multiline
                    maxLength={500}
                />

                {q && (
                    <View style={styles.card}>
                        <Row label="Subtotal" value={`₹${q.subtotal}`} />
                        <Row label="GST" value={`₹${q.gst}`} />
                        <View style={styles.divider} />
                        <Row label="Total" value={`₹${q.total}`} bold />
                        {q.backordered.length > 0 && (
                            <View style={styles.warn}>
                                <AlertTriangle size={14} color={colors.warningDark} />
                                <Text style={styles.warnText}>{q.backordered.length === 1 ? '1 line is' : `${q.backordered.length} lines are`} on backorder. UniteFix will confirm before dispatch.</Text>
                            </View>
                        )}
                    </View>
                )}
                {quote.isError && <Text style={styles.quoteErr}>{getApiErrorMessage(quote.error)}</Text>}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: bottomBar }]}>
                <View>
                    <Text style={styles.footerLabel}>Total incl. GST</Text>
                    {quote.isFetching && !q ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.footerTotal}>₹{q?.total ?? '—'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                    <Button
                        title={mode === 'credit' ? 'Place on credit' : 'Place & pay'}
                        onPress={place}
                        loading={placing}
                        disabled={!q || quote.isError || placing}
                        fullWidth
                    />
                </View>
            </View>
        </KeyboardAvoidingView>
    );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <View style={styles.row}>
            <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
            <Text style={[styles.rowValue, bold && styles.bold]}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.xl, paddingBottom: spacing.xl },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
    lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    lineName: { ...typography.bodyMedium, color: colors.textPrimary },
    lineMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    backorder: { ...typography.caption, color: colors.warningDark, marginTop: 2 },
    stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.background },
    stepBtn: { paddingHorizontal: spacing.sm, height: 32, alignItems: 'center', justifyContent: 'center' },
    stepQty: { ...typography.bodySemibold, color: colors.textPrimary, minWidth: 26, textAlign: 'center' },
    lineTotal: { ...typography.bodySemibold, color: colors.textPrimary, minWidth: 64, textAlign: 'right' },
    sectionTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    modes: { gap: spacing.sm, marginBottom: spacing.lg },
    mode: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    modeOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight + '33' },
    modeOff: { opacity: 0.5 },
    modeTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    modeSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    notes: { ...typography.body, color: colors.textPrimary, minHeight: 72, textAlignVertical: 'top', padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.lg },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
    rowLabel: { ...typography.body, color: colors.textSecondary },
    rowValue: { ...typography.body, color: colors.textPrimary },
    bold: { ...typography.bodySemibold, color: colors.textPrimary },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
    warn: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start', marginTop: spacing.sm },
    warnText: { ...typography.caption, color: colors.warningDark, flex: 1 },
    quoteErr: { ...typography.caption, color: colors.errorDark, marginBottom: spacing.md },
    footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
    footerLabel: { ...typography.caption, color: colors.textSecondary },
    footerTotal: { ...typography.h3, color: colors.textPrimary },
});
