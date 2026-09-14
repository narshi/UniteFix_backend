/**
 * One trade order: where it is, what is in it, what it cost, and what the
 * partner can still do about it.
 *
 * The stage tracker is the server's `tracking` block — the same one the
 * admin fulfilment page shows — so both sides read the same story. The
 * event log under it is the audit trail: every transition, who made it,
 * and the courier details when dispatched. Cancel is offered while the
 * order is still the partner's to cancel (placed/paid); return only after
 * delivery. An unpaid prepaid order offers to finish paying.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Truck, XCircle } from 'lucide-react-native';
import { b2bApi, type OrderDetail, type OrderEvent } from '../../api/b2b.api';
import { getApiErrorMessage } from '../../api/client';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { ScreenHeader, Button } from '../../components/ui';
import { orderStatusTone } from './OrdersScreen';

type Props = NativeStackScreenProps<any, 'OrderDetail'>;

const EVENT_LABEL: Record<string, string> = {
    placed: 'Order placed', payment_received: 'Payment received', confirmed: 'Confirmed by UniteFix', packed: 'Packed',
    dispatched: 'Dispatched', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
    return_requested: 'Return requested', returned: 'Return accepted', note: 'Note from UniteFix',
};

const fmt = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function eventDetail(e: OrderEvent): string | null {
    const p = e.payload ?? {};
    if (e.type === 'dispatched' && (p.courier || p.trackingId)) return [p.courier, p.trackingId].filter(Boolean).join(' · ');
    if (e.type === 'note' && p.note) return String(p.note);
    if ((e.type === 'cancelled' || e.type === 'return_requested') && p.reason) return String(p.reason);
    if (e.type === 'payment_received' && p.razorpayPaymentId) return `Ref ${p.razorpayPaymentId}`;
    return null;
}

export function OrderDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.id);
    const qc = useQueryClient();
    const { scrollBottom, bottomBar } = useScreenInsets();
    const user = useAuthStore(s => s.user);
    const [busy, setBusy] = useState(false);
    const [returnOpen, setReturnOpen] = useState(false);
    const [returnReason, setReturnReason] = useState('');

    const { data, isLoading, refetch, isRefetching, error } = useQuery({
        queryKey: ['b2b-order', id],
        queryFn: async () => (await b2bApi.order(id)).data.data,
        enabled: Number.isFinite(id),
    });

    const done = () => {
        qc.invalidateQueries({ queryKey: ['b2b-orders'] });
        qc.invalidateQueries({ queryKey: ['b2b-credit'] });
        qc.invalidateQueries({ queryKey: ['b2b-ledger'] });
        refetch();
    };

    const payNow = async (o: OrderDetail) => {
        setBusy(true);
        try {
            const { data: info } = await b2bApi.paymentInfo(o.id);
            const rp = info.data;
            const result = await openRazorpayCheckout({
                razorpayOrderId: rp.orderId, razorpayKeyId: rp.keyId, amount: rp.amount,
                description: `UniteFix trade order ${o.orderCode}`,
                customerName: user?.username ?? undefined, customerEmail: user?.email ?? undefined, customerPhone: user?.phone ?? undefined,
            });
            try {
                await b2bApi.verifyPayment(o.id, {
                    razorpay_order_id: result.razorpay_order_id, razorpay_payment_id: result.razorpay_payment_id, razorpay_signature: result.razorpay_signature,
                });
                Alert.alert('Payment received', 'UniteFix will confirm and dispatch the order.');
            } catch {
                Alert.alert('Payment made', 'It can take a minute to show here.');
            }
            done();
        } catch (err: any) {
            const msg = err?.response?.data?.message;
            if (msg) Alert.alert('Cannot pay', msg); else handleRazorpayError(err);
        } finally {
            setBusy(false);
        }
    };

    const cancel = (o: OrderDetail) => {
        Alert.alert(
            `Cancel ${o.orderCode}?`,
            o.paymentStatus === 'paid' ? 'Your payment is refunded to the method you paid with.' : 'The order is withdrawn before UniteFix picks it.',
            [
                { text: 'Keep it', style: 'cancel' },
                {
                    text: 'Cancel order', style: 'destructive',
                    onPress: async () => {
                        setBusy(true);
                        try {
                            const { data: res } = await b2bApi.cancelOrder(o.id, 'Cancelled by partner');
                            Alert.alert('Cancelled', res.message);
                            done();
                        } catch (err) {
                            Alert.alert('Not cancelled', getApiErrorMessage(err));
                        } finally { setBusy(false); }
                    },
                },
            ],
        );
    };

    // Alert.prompt is iOS-only, so the reason is collected in a small sheet.
    const submitReturn = async (o: OrderDetail) => {
        const reason = returnReason.trim();
        if (reason.length < 5) { Alert.alert('Tell us a little more', 'A few words about what is wrong helps us fix it.'); return; }
        setBusy(true);
        try {
            const { data: res } = await b2bApi.requestReturn(o.id, reason);
            setReturnOpen(false);
            setReturnReason('');
            Alert.alert('Return requested', res.message);
            done();
        } catch (err) {
            Alert.alert('Not requested', getApiErrorMessage(err));
        } finally { setBusy(false); }
    };

    return (
        <View style={styles.screen}>
            <ScreenHeader title={data?.orderCode ?? 'Order'} onBack={() => navigation.goBack()} />
            {isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
            ) : !data ? (
                <Text style={styles.err}>{error ? getApiErrorMessage(error) : 'Order not found.'}</Text>
            ) : (
                <>
                    <ScrollView
                        contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
                        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} tintColor={colors.primary} />}
                    >
                        <StatusHeader order={data} />

                        {/* Stage tracker */}
                        <View style={styles.card}>
                            {data.tracking.terminal ? (
                                <View style={styles.terminal}>
                                    <XCircle size={18} color={colors.textSecondary} />
                                    <Text style={styles.terminalText}>{data.tracking.terminalLabel}{data.cancelReason ? ` — ${data.cancelReason}` : ''}</Text>
                                </View>
                            ) : data.tracking.steps.map((s, i) => (
                                <View key={s.key} style={styles.step}>
                                    <View style={styles.stepRail}>
                                        <View style={[styles.dot, s.done && styles.dotDone, s.current && styles.dotCurrent]}>
                                            {s.done && !s.current ? <Check size={10} color={colors.background} /> : s.current ? <Circle size={6} color={colors.background} fill={colors.background} /> : null}
                                        </View>
                                        {i < data.tracking.steps.length - 1 && <View style={[styles.rail, s.done && !s.current && styles.railDone]} />}
                                    </View>
                                    <Text style={[styles.stepLabel, s.done && styles.stepLabelDone, s.current && styles.stepLabelCurrent]}>{s.label}</Text>
                                </View>
                            ))}
                        </View>

                        {/* Items */}
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>{data.items.length} {data.items.length === 1 ? 'line' : 'lines'}</Text>
                            {data.items.map(it => (
                                <View key={it.id} style={styles.item}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.itemName}>{it.name}</Text>
                                        <Text style={styles.itemMeta}>{it.partCode} · ₹{it.unitPrice} × {it.quantity}{it.gstPercent ? ` · ${it.gstPercent}% GST` : ''}</Text>
                                        {it.backordered && <Text style={styles.backorder}>Backordered{it.quantityFulfilled > 0 ? ` — ${it.quantityFulfilled} of ${it.quantity} sent` : ''}</Text>}
                                    </View>
                                    <Text style={styles.itemTotal}>₹{it.lineTotal}</Text>
                                </View>
                            ))}
                            <View style={styles.divider} />
                            <Row label="Subtotal" value={`₹${data.subtotal}`} />
                            <Row label="GST" value={`₹${data.gst}`} />
                            {data.shipping > 0 && <Row label="Shipping" value={`₹${data.shipping}`} />}
                            {data.discount > 0 && <Row label="Discount" value={`− ₹${data.discount}`} />}
                            <Row label="Total" value={`₹${data.total}`} bold />
                            <Text style={styles.payMeta}>
                                {data.paymentMode === 'credit' ? 'On UniteFix credit — settles on your statement' : data.paymentStatus === 'paid' ? `Paid${data.paidAt ? ` on ${fmt(data.paidAt)}` : ''}` : data.paymentStatus === 'refunded' ? 'Refunded' : 'Payment pending'}
                            </Text>
                        </View>

                        {!!data.notes && (
                            <View style={styles.card}>
                                <Text style={styles.cardTitle}>Your note</Text>
                                <Text style={styles.note}>{data.notes}</Text>
                            </View>
                        )}

                        {/* Timeline */}
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>History</Text>
                            {[...data.events].reverse().map(e => {
                                const detail = eventDetail(e);
                                return (
                                    <View key={e.id} style={styles.event}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.eventTitle}>{EVENT_LABEL[e.type] ?? e.type}</Text>
                                            {!!detail && <Text style={styles.eventDetail}>{detail}</Text>}
                                        </View>
                                        <Text style={styles.eventAt}>{fmt(e.at)}</Text>
                                    </View>
                                );
                            })}
                        </View>
                    </ScrollView>

                    <Actions order={data} busy={busy} onPay={() => payNow(data)} onCancel={() => cancel(data)} onReturn={() => setReturnOpen(true)} bottom={bottomBar} />

                    <Modal visible={returnOpen} transparent animationType="slide" onRequestClose={() => setReturnOpen(false)}>
                        <KeyboardAvoidingView style={styles.sheetWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                            <Pressable style={styles.backdrop} onPress={() => setReturnOpen(false)} />
                            <View style={[styles.sheet, { paddingBottom: bottomBar + spacing.md }]}>
                                <Text style={styles.sheetTitle}>What is wrong with the delivery?</Text>
                                <Text style={styles.sheetSub}>UniteFix will get in touch to arrange collection.</Text>
                                <TextInput
                                    style={styles.reason}
                                    value={returnReason}
                                    onChangeText={setReturnReason}
                                    placeholder="Wrong item, damaged in transit, short quantity…"
                                    placeholderTextColor={colors.textDisabled}
                                    multiline
                                    maxLength={500}
                                    autoFocus
                                />
                                <Button title="Request return" onPress={() => submitReturn(data)} loading={busy} disabled={busy} fullWidth />
                            </View>
                        </KeyboardAvoidingView>
                    </Modal>
                </>
            )}
        </View>
    );
}

function StatusHeader({ order }: { order: OrderDetail }) {
    const tone = orderStatusTone(order);
    const dispatched = order.events.find(e => e.type === 'dispatched');
    const courier = dispatched ? eventDetail(dispatched) : null;
    return (
        <View style={styles.statusHead}>
            <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.color }]}>{tone.label}</Text></View>
            <Text style={styles.placed}>Placed {fmt(order.placedAt)}</Text>
            {!!courier && order.status === 'dispatched' && (
                <View style={styles.courier}><Truck size={14} color={colors.primary} /><Text style={styles.courierText}>{courier}</Text></View>
            )}
        </View>
    );
}

function Actions({ order, busy, onPay, onCancel, onReturn, bottom }: { order: OrderDetail; busy: boolean; onPay: () => void; onCancel: () => void; onReturn: () => void; bottom: number }) {
    const unpaid = order.paymentMode === 'prepaid' && order.paymentStatus !== 'paid' && order.status === 'placed';
    const cancellable = order.status === 'placed' || order.status === 'paid';
    const returnable = order.status === 'delivered';
    if (!unpaid && !cancellable && !returnable) return null;
    return (
        <View style={[styles.footer, { paddingBottom: bottom }]}>
            {unpaid && <View style={{ flex: 1 }}><Button title={`Pay ₹${order.total}`} onPress={onPay} loading={busy} disabled={busy} fullWidth /></View>}
            {cancellable && (
                <TouchableOpacity style={styles.ghost} onPress={onCancel} disabled={busy}>
                    <Text style={styles.ghostText}>Cancel order</Text>
                </TouchableOpacity>
            )}
            {returnable && <View style={{ flex: 1 }}><Button title="Report a problem with this delivery" variant="outline" onPress={onReturn} loading={busy} disabled={busy} fullWidth /></View>}
        </View>
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
    content: { padding: spacing.xl },
    err: { ...typography.body, color: colors.textSecondary, padding: spacing.xl, textAlign: 'center' },
    statusHead: { marginBottom: spacing.lg, gap: spacing.xs, alignItems: 'flex-start' },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full },
    pillText: { ...typography.captionMedium },
    placed: { ...typography.caption, color: colors.textSecondary },
    courier: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
    courierText: { ...typography.captionMedium, color: colors.primary },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    terminal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    terminalText: { ...typography.body, color: colors.textSecondary, flex: 1 },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, minHeight: 36 },
    stepRail: { alignItems: 'center', width: 20 },
    dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    dotDone: { borderColor: colors.successDark, backgroundColor: colors.successDark },
    dotCurrent: { borderColor: colors.primary, backgroundColor: colors.primary },
    rail: { width: 2, flex: 1, minHeight: 16, backgroundColor: colors.border },
    railDone: { backgroundColor: colors.successDark },
    stepLabel: { ...typography.body, color: colors.textDisabled, paddingTop: 1 },
    stepLabelDone: { color: colors.textSecondary },
    stepLabelCurrent: { ...typography.bodySemibold, color: colors.textPrimary },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs },
    itemName: { ...typography.bodyMedium, color: colors.textPrimary },
    itemMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    backorder: { ...typography.caption, color: colors.warningDark, marginTop: 2 },
    itemTotal: { ...typography.bodyMedium, color: colors.textPrimary },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    rowLabel: { ...typography.body, color: colors.textSecondary },
    rowValue: { ...typography.body, color: colors.textPrimary },
    bold: { ...typography.bodySemibold, color: colors.textPrimary },
    payMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
    note: { ...typography.body, color: colors.textPrimary },
    event: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.divider },
    eventTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    eventDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    eventAt: { ...typography.caption, color: colors.textSecondary },
    footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
    ghost: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    ghostText: { ...typography.bodyMedium, color: colors.errorDark },
    sheetWrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.lg, gap: spacing.sm },
    sheetTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    sheetSub: { ...typography.caption, color: colors.textSecondary },
    reason: { ...typography.body, color: colors.textPrimary, minHeight: 88, textAlignVertical: 'top', padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginVertical: spacing.sm },
});
