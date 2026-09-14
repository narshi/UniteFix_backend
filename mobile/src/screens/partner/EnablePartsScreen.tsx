/**
 * Spare-parts access — the deposit, and what it buys.
 *
 * Says what it costs before asking for money: the amount, what it covers, when
 * it is drawn, and how it comes back. Every draw is listed with its reason,
 * because a technician who finds ₹1,200 missing and no explanation has been
 * given a grievance, not a ledger.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Package, Clock, AlertTriangle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react-native';
import { partnerApi } from '../../api/partner.api';
import { getApiErrorMessage } from '../../api/client';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { ScreenHeader, Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'EnableParts'>;

const ENTRY_LABEL: Record<string, string> = {
    paid_in: 'Deposit paid', topped_up: 'Topped up', drawn_warranty: 'Warranty claim on your job',
    drawn_shortage: 'Stock count shortage', drawn_damage: 'Damaged return', refunded: 'Refunded', adjustment: 'Adjustment',
};

export function EnablePartsScreen({ navigation }: Props) {
    const qc = useQueryClient();
    const [paying, setPaying] = useState(false);
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['parts-access'],
        queryFn: async () => (await partnerApi.getPartsAccess()).data.data,
    });

    const pay = async () => {
        setPaying(true);
        try {
            const { data: res } = await partnerApi.requestPartsAccess();
            const order = res.data;
            const result = await openRazorpayCheckout({
                razorpayOrderId: order.razorpayOrderId,
                razorpayKeyId: order.razorpayKeyId,
                amount: order.amount,
                description: order.isTopUp ? 'UniteFix spare-parts deposit top-up' : 'UniteFix spare-parts deposit',
                customerName: order.customer?.name ?? undefined,
                customerEmail: order.customer?.email ?? undefined,
                customerPhone: order.customer?.phone ?? undefined,
            });
            try {
                const v = await partnerApi.verifyPartsAccessPayment({
                    razorpay_order_id: result.razorpay_order_id,
                    razorpay_payment_id: result.razorpay_payment_id,
                    razorpay_signature: result.razorpay_signature,
                });
                Alert.alert('Received', v.data?.message ?? 'Deposit recorded.');
            } catch {
                // The webhook applies it even if this call did not go through.
                Alert.alert('Payment made', 'It can take a minute to show here.');
            }
            qc.invalidateQueries({ queryKey: ['parts-access'] });
            refetch();
        } catch (err: any) {
            const msg = err?.response?.data?.message;
            if (msg) Alert.alert('Cannot proceed', msg); else handleRazorpayError(err);
        } finally {
            setPaying(false);
        }
    };

    const requestRefund = () => {
        Alert.alert(
            'Give up spare-parts access?',
            'Your remaining deposit is returned to your registered account. You can no longer fit parts from UniteFix stock.',
            [
                { text: 'Keep it', style: 'cancel' },
                {
                    text: 'Request refund', style: 'destructive',
                    onPress: async () => {
                        try {
                            const { data: res } = await partnerApi.requestPartsRefund();
                            Alert.alert('Requested', res.message);
                            refetch();
                        } catch (err) {
                            Alert.alert('Not yet', getApiErrorMessage(err));
                        }
                    },
                },
            ],
        );
    };

    if (isLoading || !data) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Spare parts" onBack={() => navigation.goBack()} />
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
            </View>
        );
    }

    const access = data.partsAccess;
    const dep = data.deposit;
    const remaining = dep?.remaining ?? 0;

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Spare parts" onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={styles.content}>

                {/* Status, in one line. */}
                <View style={[styles.statusCard, access === 'active' ? styles.statusOk : access === 'suspended' ? styles.statusBad : styles.statusNeutral]}>
                    {access === 'active' ? <ShieldCheck size={22} color={colors.successDark} />
                        : access === 'suspended' ? <ShieldAlert size={22} color={colors.errorDark} />
                            : <Clock size={22} color={colors.textSecondary} />}
                    <View style={{ flex: 1 }}>
                        <Text style={styles.statusTitle}>
                            {access === 'active' ? 'You can fit parts from UniteFix stock'
                                : access === 'requested' ? 'Deposit received — awaiting approval'
                                    : access === 'suspended' ? 'Access suspended'
                                        : 'Not enabled'}
                        </Text>
                        <Text style={styles.statusText}>
                            {access === 'active' ? 'Pick from the catalogue when you bill a job. No shop bills, no warranty paperwork — UniteFix stands behind the part.'
                                : access === 'requested' ? 'UniteFix reviews new requests within a working day.'
                                    : access === 'suspended' ? `Your deposit fell below ₹${data.floor}. Top it up to restore access.`
                                        : `A refundable deposit of ₹${data.required} enables it.`}
                        </Text>
                    </View>
                </View>

                {/* What it is, before asking for it. */}
                {access === 'none' && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>How it works</Text>
                        <Row icon={<Package size={16} color={colors.primary} />} text="Fit parts straight from UniteFix's catalogue, or carry a kit issued to you." />
                        <Row icon={<ShieldCheck size={16} color={colors.primary} />} text="UniteFix backs the warranty on every part you fit from stock. No bill photos." />
                        <Row icon={<AlertTriangle size={16} color={colors.warningDark} />} text={`The deposit is drawn only when a warranty claim is found to be your fault, or a stock count comes up short. Every draw is listed here with its reason. Below ₹${data.floor}, access pauses until you top up.`} />
                        <Row icon={<ArrowUpCircle size={16} color={colors.primary} />} text="Leave any time. What is left of the deposit is refunded to your registered account." />
                    </View>
                )}

                {/* The money. */}
                {dep && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>Your deposit</Text>
                        <View style={styles.amounts}>
                            <Amount label="Paid" value={dep.paid} />
                            <Amount label="Drawn" value={dep.drawn} tone={dep.drawn > 0 ? 'bad' : undefined} />
                            <Amount label="Remaining" value={remaining} tone={dep.belowFloor ? 'bad' : 'good'} />
                        </View>
                        {dep.belowFloor && dep.topUpNeeded > 0 && (
                            <Text style={styles.warn}>Top up ₹{dep.topUpNeeded} to restore the full deposit.</Text>
                        )}
                    </View>
                )}

                {/* The one button that matters for this state. */}
                {(access === 'none' || (dep && dep.topUpNeeded > 0 && dep.status !== 'refund_requested' && dep.status !== 'refunded')) && (
                    <Button
                        title={access === 'none' ? `Pay the ₹${data.required} deposit` : `Top up ₹${dep!.topUpNeeded}`}
                        onPress={pay}
                        loading={paying}
                        style={{ marginBottom: spacing.md }}
                    />
                )}

                {/* Every draw, with its reason. */}
                {data.ledger.length > 0 && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>History</Text>
                        {data.ledger.map(l => (
                            <View key={l.id} style={styles.ledgerRow}>
                                {l.amount < 0 ? <ArrowDownCircle size={16} color={colors.errorDark} /> : <ArrowUpCircle size={16} color={colors.successDark} />}
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.ledgerTitle}>{ENTRY_LABEL[l.type] ?? l.type}</Text>
                                    {!!l.notes && <Text style={styles.ledgerNote}>{l.notes}</Text>}
                                    <Text style={styles.ledgerDate}>{new Date(l.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                                </View>
                                <Text style={[styles.ledgerAmt, { color: l.amount < 0 ? colors.errorDark : colors.successDark }]}>{l.amount < 0 ? '−' : '+'}₹{Math.abs(l.amount)}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {(access === 'active' || access === 'suspended') && dep && remaining > 0 && dep.status !== 'refund_requested' && (
                    <TouchableOpacity onPress={requestRefund} style={styles.leaveBtn}>
                        <Text style={styles.leaveText}>Give up access and get ₹{remaining} back</Text>
                    </TouchableOpacity>
                )}
                {dep?.status === 'refund_requested' && (
                    <Text style={styles.footnote}>Refund requested. UniteFix will transfer ₹{remaining} to your registered account.</Text>
                )}
            </ScrollView>
        </View>
    );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <View style={styles.howRow}>
            {icon}
            <Text style={styles.howText}>{text}</Text>
        </View>
    );
}

function Amount({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
    return (
        <View style={styles.amount}>
            <Text style={styles.amountLabel}>{label}</Text>
            <Text style={[styles.amountValue, tone === 'good' && { color: colors.successDark }, tone === 'bad' && { color: colors.errorDark }]}>₹{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    statusCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.md, borderWidth: 1 },
    statusOk: { backgroundColor: colors.successLight, borderColor: colors.successLight },
    statusBad: { backgroundColor: colors.errorLight, borderColor: colors.errorLight },
    statusNeutral: { backgroundColor: colors.surface, borderColor: colors.border },
    statusTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    statusText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    howRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
    howText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
    amounts: { flexDirection: 'row', gap: spacing.sm },
    amount: { flex: 1, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.background },
    amountLabel: { ...typography.caption, color: colors.textSecondary },
    amountValue: { ...typography.bodySemibold, color: colors.textPrimary, marginTop: 2 },
    warn: { ...typography.caption, color: colors.warningDark, marginTop: spacing.sm },
    ledgerRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    ledgerTitle: { ...typography.captionMedium, color: colors.textPrimary },
    ledgerNote: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    ledgerDate: { ...typography.caption, color: colors.textDisabled, marginTop: 1 },
    ledgerAmt: { ...typography.captionMedium },
    leaveBtn: { alignItems: 'center', paddingVertical: spacing.md },
    leaveText: { ...typography.caption, color: colors.textSecondary, textDecorationLine: 'underline' },
    footnote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
});
