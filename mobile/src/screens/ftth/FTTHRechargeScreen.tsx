/**
 * Recharge — pick a speed, then a duration, then pay.
 *
 * NO SLIDERS. A slider implies a continuous, uniform range, which is exactly
 * what a multi-operator catalogue is not: one ISP sells 30/50/100, the next
 * 40/60/200, and neither sells every duration at every speed. A slider would
 * either invent combinations nobody can buy, or need per-operator clamping,
 * which is a slider pretending to be a chip list.
 *
 * So: speed chips come from the operator's own plans, and choosing a speed
 * filters the duration chips to only the durations sold AT THAT SPEED. There is
 * deliberately no speed or duration constant anywhere in this file — onboarding
 * an ISP with an unusual tier must never require an app release.
 *
 * On payment: the SDK callback is optimistic. If it fails or the app dies, the
 * Razorpay webhook still applies the recharge server-side, so this screen never
 * tells the customer a captured payment failed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wifi, Check, Info } from 'lucide-react-native';
import { ftthApi, FtthConnection, FtthPlan } from '../../api/ftth.api';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader, Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHRecharge'>;

export function FTTHRechargeScreen({ navigation, route }: Props) {
    const connection = route.params?.connection as FtthConnection;
    const { bottomBar } = useScreenInsets();
    const queryClient = useQueryClient();

    const [speed, setSpeed] = useState<number | null>(null);
    const [planId, setPlanId] = useState<number | null>(null);
    const [paying, setPaying] = useState(false);

    const { data: speedGroups, isLoading } = useQuery({
        queryKey: ['ftth', 'plans', connection?.operatorId],
        queryFn: () => ftthApi.getPlans(connection.operatorId),
        enabled: !!connection?.operatorId,
    });

    // Default to the speed they're already on, else the cheapest tier. Never a
    // hardcoded "50 Mbps".
    useEffect(() => {
        if (!speedGroups?.length || speed !== null) return;
        const current = connection?.speedMbps;
        const match = current ? speedGroups.find(g => g.speedMbps === current) : undefined;
        setSpeed((match ?? speedGroups[0]).speedMbps);
    }, [speedGroups, speed, connection?.speedMbps]);

    // Only the durations this operator actually sells at the chosen speed. The
    // matrix is sparse by design.
    const durationsForSpeed: FtthPlan[] = useMemo(() => {
        if (speed === null || !speedGroups) return [];
        return speedGroups.find(g => g.speedMbps === speed)?.plans ?? [];
    }, [speed, speedGroups]);

    useEffect(() => {
        if (durationsForSpeed.length === 0) { setPlanId(null); return; }
        if (!durationsForSpeed.some(p => p.id === planId)) setPlanId(durationsForSpeed[0].id);
    }, [durationsForSpeed, planId]);

    const selected = durationsForSpeed.find(p => p.id === planId) ?? null;

    const pay = async () => {
        if (!selected) return;
        setPaying(true);
        try {
            const order = await ftthApi.initiateRecharge({
                connectionId: connection.id,
                planId: selected.id,
            });

            const result = await openRazorpayCheckout({
                razorpayOrderId: order.razorpayOrderId,
                razorpayKeyId: order.razorpayKeyId,
                amount: order.amount,
                description: `${connection.operatorName} — ${selected.name}`,
                customerName: order.customer?.name ?? undefined,
                customerEmail: order.customer?.email ?? undefined,
                customerPhone: order.customer?.phone ?? undefined,
            });

            try {
                await ftthApi.verifyRecharge({
                    razorpay_order_id: result.razorpay_order_id,
                    razorpay_payment_id: result.razorpay_payment_id,
                    razorpay_signature: result.razorpay_signature,
                });
                queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
                navigation.replace('FTTHRechargeTracking', { rechargeId: order.rechargeId });
            } catch {
                // The money is captured; only our confirmation call failed. The
                // webhook will settle it, so navigate to tracking directly.
                queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
                navigation.replace('FTTHRechargeTracking', { rechargeId: order.rechargeId });
            }
        } catch (error: any) {
            // Server-side refusals (too early, already in progress, awaiting ID)
            // arrive here with a real message worth showing.
            const serverMessage = error?.response?.data?.message;
            if (serverMessage) {
                Alert.alert('Cannot recharge', serverMessage);
            } else {
                handleRazorpayError(error);
            }
        } finally {
            setPaying(false);
        }
    };

    if (!connection) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Recharge" onBack={() => navigation.goBack()} />
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Recharge" onBack={() => navigation.goBack()} />

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomBar + 140 }]}>
                <View style={styles.connectionCard}>
                    <View style={styles.iconCircle}><Wifi size={18} color={colors.primary} /></View>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={styles.connectionTitle}>{connection.operatorName}</Text>
                        <Text style={styles.connectionSub}>{connection.ispConnectionId}</Text>
                    </View>
                    {connection.validTill && (
                        <Text style={[styles.validity, connection.isExpired && { color: colors.error }]}>
                            {connection.isExpired ? 'Expired' : `${connection.daysRemaining}d left`}
                        </Text>
                    )}
                </View>

                {isLoading ? (
                    <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
                ) : !speedGroups?.length ? (
                    <View style={styles.emptyCard}>
                        <Info size={20} color={colors.textSecondary} />
                        <Text style={styles.emptyText}>
                            {connection.operatorName} hasn't published any plans yet. Please check back soon.
                        </Text>
                    </View>
                ) : (
                    <>
                        <Text style={styles.sectionTitle}>Speed</Text>
                        <View style={styles.chipRow}>
                            {speedGroups.map(g => (
                                <TouchableOpacity
                                    key={g.speedMbps}
                                    style={[styles.chip, speed === g.speedMbps && styles.chipActive]}
                                    onPress={() => setSpeed(g.speedMbps)}
                                >
                                    <Text style={[styles.chipText, speed === g.speedMbps && styles.chipTextActive]}>
                                        {g.speedMbps} Mbps
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.sectionTitle}>Validity</Text>
                        <View style={styles.chipRow}>
                            {durationsForSpeed.map(p => (
                                <TouchableOpacity
                                    key={p.id}
                                    style={[styles.chip, planId === p.id && styles.chipActive]}
                                    onPress={() => setPlanId(p.id)}
                                >
                                    <Text style={[styles.chipText, planId === p.id && styles.chipTextActive]}>
                                        {p.durationMonths} month{p.durationMonths === 1 ? '' : 's'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {selected && (
                            <View style={styles.planCard}>
                                <Text style={styles.planName}>{selected.name}</Text>
                                <Text style={styles.planMeta}>
                                    {selected.dataLimitGb === null
                                        ? 'Unlimited data'
                                        : `${selected.dataLimitGb} GB`}
                                    {' · '}{selected.speedMbps} Mbps
                                </Text>

                                {selected.benefits.length > 0 && (
                                    <View style={{ marginTop: spacing.md }}>
                                        {selected.benefits.map(b => (
                                            <View key={b} style={styles.benefitRow}>
                                                <Check size={14} color={colors.accentDark} />
                                                <Text style={styles.benefitText}>{b}</Text>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <View style={styles.divider} />

                                <Row label="Plan price" value={`₹${selected.price}`} />
                                {selected.discount > 0 && (
                                    <Row label="Discount" value={`− ₹${selected.discount}`} positive />
                                )}
                                {/* Shown as its own line, never folded into the total —
                                    a visible fee is the whole basis for charging one. */}
                                <Row label="UniteFix convenience fee" value={`₹${selected.convenienceFee}`} />
                                <View style={styles.divider} />
                                <Row label="Total payable" value={`₹${selected.payable}`} bold />
                            </View>
                        )}
                    </>
                )}
            </ScrollView>

            {selected && (
                <View style={[styles.footer, { paddingBottom: bottomBar + spacing.base }]}>
                    <View>
                        <Text style={styles.footerLabel}>Total</Text>
                        <Text style={styles.footerAmount}>₹{selected.payable}</Text>
                    </View>
                    <Button
                        title={paying ? 'Opening…' : 'Pay now'}
                        onPress={pay}
                        disabled={paying}
                        style={{ flex: 1, marginLeft: spacing.base }}
                    />
                </View>
            )}
        </View>
    );
}

function Row({ label, value, bold, positive }: {
    label: string; value: string; bold?: boolean; positive?: boolean;
}) {
    return (
        <View style={styles.row}>
            <Text style={[styles.rowLabel, bold && styles.rowBold]}>{label}</Text>
            <Text style={[
                styles.rowValue,
                bold && styles.rowBold,
                positive && { color: colors.accentDark },
            ]}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.base },
    connectionCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.surfaceElevated, borderRadius: radii.lg,
        padding: spacing.base, ...shadows.xs,
    },
    iconCircle: {
        width: 40, height: 40, borderRadius: radii.full,
        backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center',
    },
    connectionTitle: { ...typography.h4, color: colors.textPrimary },
    connectionSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    validity: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
    sectionTitle: {
        ...typography.label, color: colors.textSecondary,
        marginTop: spacing.xl, marginBottom: spacing.sm,
        textTransform: 'uppercase', letterSpacing: 0.6,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
        paddingHorizontal: spacing.base, paddingVertical: spacing.md,
        borderRadius: radii.full, borderWidth: 1, borderColor: colors.border,
        backgroundColor: colors.surfaceElevated,
    },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.bodyMedium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontWeight: '700' },
    planCard: {
        marginTop: spacing.xl, backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg, padding: spacing.base, ...shadows.xs,
    },
    planName: { ...typography.h4, color: colors.textPrimary },
    planMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    benefitText: { ...typography.caption, color: colors.textPrimary },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginVertical: spacing.md },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
    rowLabel: { ...typography.caption, color: colors.textSecondary },
    rowValue: { ...typography.caption, color: colors.textPrimary },
    rowBold: { ...typography.bodySemibold, color: colors.textPrimary },
    emptyCard: {
        marginTop: spacing.xl, backgroundColor: colors.surfaceElevated, borderRadius: radii.lg,
        padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.xs,
    },
    emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
    footer: {
        position: 'absolute', left: 0, right: 0, bottom: 0,
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.base, paddingTop: spacing.base,
        backgroundColor: colors.surfaceElevated,
        borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    footerLabel: { ...typography.caption, color: colors.textSecondary },
    footerAmount: { ...typography.h3, color: colors.textPrimary },
});
