/**
 * Recharge — pick a speed, then a duration, then pay.
 *
 * Features:
 * - Senior UI/UX Stepped Horizon Range Selector & Milestone Value Slider
 * - Live calculations: Effective monthly rate, daily run-rate, savings milestone
 * - Green tick recommendation push for 1-Year / Best Value packs
 * - Itemized transparent bill summary
 * - Fixed bottom action bar with notch/safe area handling
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Wifi, Check, Info, Sparkles, CheckCircle2, ShieldCheck, Zap, ArrowRight,
} from 'lucide-react-native';
import { ftthApi, FtthConnection, FtthPlan } from '../../api/ftth.api';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader, Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';
import { DurationRangeSelector } from '../../components/ftth/DurationRangeSelector';

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

    // Default to the speed they're already on, else the first tier.
    useEffect(() => {
        if (!speedGroups?.length || speed !== null) return;
        const current = connection?.speedMbps;
        const match = current ? speedGroups.find(g => g.speedMbps === current) : undefined;
        setSpeed((match ?? speedGroups[0]).speedMbps);
    }, [speedGroups, speed, connection?.speedMbps]);

    // Durations this operator sells at the chosen speed
    const durationsForSpeed: FtthPlan[] = useMemo(() => {
        if (speed === null || !speedGroups) return [];
        return speedGroups.find(g => g.speedMbps === speed)?.plans ?? [];
    }, [speed, speedGroups]);

    // Select recommended / 12-month plan by default, or fallback to first
    useEffect(() => {
        if (durationsForSpeed.length === 0) {
            setPlanId(null);
            return;
        }
        if (!durationsForSpeed.some(p => p.id === planId)) {
            const recommended = durationsForSpeed.find(p => p.isRecommended || p.durationMonths === 12);
            setPlanId(recommended ? recommended.id : durationsForSpeed[0].id);
        }
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
                queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
                navigation.replace('FTTHRechargeTracking', { rechargeId: order.rechargeId });
            }
        } catch (error: any) {
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
                <ScreenHeader title="Broadband Recharge" onBack={() => navigation.goBack()} />
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <StatusBar barStyle="dark-content" backgroundColor={colors.surface} />
            <ScreenHeader title="Broadband Recharge" onBack={() => navigation.goBack()} />

            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomBar + 120 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Hero Connection Card */}
                <View style={styles.connectionCard}>
                    <View style={styles.iconCircle}>
                        <Wifi size={20} color={colors.primary} />
                    </View>
                    <View style={styles.connectionDetails}>
                        <View style={styles.operatorRow}>
                            <Text style={styles.connectionTitle} numberOfLines={1}>
                                {connection.operatorName}
                            </Text>
                            {connection.speedMbps && (
                                <View style={styles.speedPill}>
                                    <Zap size={10} color={colors.primary} />
                                    <Text style={styles.speedPillText}>{connection.speedMbps} Mbps</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.connectionSub}>{connection.ispConnectionId}</Text>
                    </View>
                    {connection.validTill && (
                        <View style={[styles.validityBadge, connection.isExpired && styles.validityBadgeExpired]}>
                            <Text style={[styles.validityText, connection.isExpired && styles.validityTextExpired]}>
                                {connection.isExpired ? 'Expired' : `${connection.daysRemaining}d left`}
                            </Text>
                        </View>
                    )}
                </View>

                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>Fetching available plans…</Text>
                    </View>
                ) : !speedGroups?.length ? (
                    <View style={styles.emptyCard}>
                        <Info size={24} color={colors.textSecondary} />
                        <Text style={styles.emptyTitle}>No Plans Available</Text>
                        <Text style={styles.emptyText}>
                            {connection.operatorName} hasn't published any recharge plans yet. Please check back soon.
                        </Text>
                    </View>
                ) : (
                    <>
                        {/* Speed Selection */}
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>1. Choose Speed Tier</Text>
                            <Text style={styles.sectionHint}>Dedicated Fiber</Text>
                        </View>
                        <View style={styles.speedChipRow}>
                            {speedGroups.map((g) => {
                                const isSpeedActive = speed === g.speedMbps;
                                return (
                                    <TouchableOpacity
                                        key={g.speedMbps}
                                        style={[styles.speedChip, isSpeedActive && styles.speedChipActive]}
                                        onPress={() => setSpeed(g.speedMbps)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.speedChipNumber, isSpeedActive && styles.speedChipNumberActive]}>
                                            {g.speedMbps}
                                        </Text>
                                        <Text style={[styles.speedChipUnit, isSpeedActive && styles.speedChipUnitActive]}>
                                            Mbps
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Senior UI/UX Stepped Horizon Range Selector & Milestone Value Slider */}
                        <DurationRangeSelector
                            plans={durationsForSpeed}
                            selectedPlanId={planId}
                            onSelectPlan={(p) => setPlanId(p.id)}
                        />

                        {/* Itemized Price Summary */}
                        {selected && (
                            <View style={styles.billBreakdownCard}>
                                <Text style={styles.billHeaderTitle}>Bill Breakdown</Text>
                                <Row label="Plan Base Price" value={`₹${selected.price}`} />
                                {selected.discount > 0 && (
                                    <Row label="Special ISP Discount" value={`− ₹${selected.discount}`} positive />
                                )}
                                <Row label="UniteFix Platform Convenience Fee" value={`₹${selected.convenienceFee}`} />
                                <View style={styles.divider} />
                                <Row label="Total Payable (incl. GST)" value={`₹${selected.payable}`} bold />
                            </View>
                        )}
                    </>
                )}
            </ScrollView>

            {/* Sticky Bottom Action Bar */}
            {selected && (
                <View style={[styles.footer, { paddingBottom: Math.max(bottomBar, spacing.md) + spacing.xs }]}>
                    <View style={styles.footerInfo}>
                        <Text style={styles.footerLabel}>Total Payable</Text>
                        <Text style={styles.footerAmount}>₹{selected.payable}</Text>
                        <Text style={styles.footerGstText}>All taxes included</Text>
                    </View>
                    <TouchableOpacity
                        style={[styles.payButton, paying && styles.payButtonDisabled]}
                        onPress={pay}
                        disabled={paying}
                        activeOpacity={0.8}
                    >
                        {paying ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Text style={styles.payButtonText}>Proceed to Pay</Text>
                                <ArrowRight size={18} color="#fff" style={{ marginLeft: 6 }} />
                            </>
                        )}
                    </TouchableOpacity>
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
                positive && { color: '#059669', fontWeight: '700' },
            ]}>
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },

    // ── Connection Hero Card ──
    connectionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.md,
        ...shadows.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    iconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    connectionDetails: {
        flex: 1,
        marginLeft: spacing.md,
        justifyContent: 'center',
    },
    operatorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    connectionTitle: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 15,
    },
    speedPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primarySurface,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: radii.full,
        gap: 2,
    },
    speedPillText: {
        fontSize: 10,
        fontWeight: '700',
        color: colors.primary,
    },
    connectionSub: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    validityBadge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        borderRadius: radii.full,
        backgroundColor: '#DCFCE7',
    },
    validityBadgeExpired: {
        backgroundColor: '#FEE2E2',
    },
    validityText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#15803D',
    },
    validityTextExpired: {
        color: colors.error,
    },

    // ── Speed Section ──
    sectionHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
    },
    sectionTitle: {
        ...typography.label,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    sectionHint: {
        ...typography.caption,
        color: colors.textTertiary,
        fontSize: 11,
    },
    speedChipRow: {
        flexDirection: 'row',
        gap: spacing.sm,
    },
    speedChip: {
        flex: 1,
        paddingVertical: spacing.md,
        borderRadius: radii.lg,
        borderWidth: 1.5,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    speedChipActive: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
        ...shadows.xs,
    },
    speedChipNumber: {
        ...typography.h4,
        color: colors.textPrimary,
        fontSize: 18,
    },
    speedChipNumberActive: {
        color: colors.primary,
        fontWeight: '800',
    },
    speedChipUnit: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 11,
        marginTop: -2,
    },
    speedChipUnitActive: {
        color: colors.primary,
        fontWeight: '600',
    },

    // ── Bill Breakdown ──
    billBreakdownCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.lg,
        marginTop: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.xs,
    },
    billHeaderTitle: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 14,
        marginBottom: spacing.sm,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.divider,
        marginVertical: spacing.sm,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: spacing.xs,
    },
    rowLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 13,
    },
    rowValue: {
        ...typography.caption,
        color: colors.textPrimary,
        fontSize: 13,
    },
    rowBold: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 14,
    },

    // ── Loading & Empty States ──
    loadingContainer: {
        marginTop: spacing['3xl'],
        alignItems: 'center',
        gap: spacing.sm,
    },
    loadingText: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    emptyCard: {
        marginTop: spacing.xl,
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        padding: spacing.xl,
        alignItems: 'center',
        gap: spacing.sm,
        ...shadows.xs,
    },
    emptyTitle: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
    },
    emptyText: {
        ...typography.caption,
        color: colors.textSecondary,
        textAlign: 'center',
    },

    // ── Sticky Footer ──
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        ...shadows.lg,
    },
    footerInfo: {
        flex: 1,
    },
    footerLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 11,
    },
    footerAmount: {
        ...typography.h3,
        color: colors.textPrimary,
        fontSize: 22,
    },
    footerGstText: {
        ...typography.caption,
        color: colors.textTertiary,
        fontSize: 10,
    },
    payButton: {
        backgroundColor: colors.primary,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        borderRadius: radii.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 160,
        ...shadows.sm,
    },
    payButtonDisabled: {
        opacity: 0.7,
    },
    payButtonText: {
        color: '#fff',
        ...typography.bodySemibold,
        fontSize: 15,
    },
});
