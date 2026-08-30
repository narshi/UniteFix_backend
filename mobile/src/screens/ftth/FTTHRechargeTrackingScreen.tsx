/**
 * Dedicated 3-Stage FTTH Recharge Tracking Screen
 *
 * Distinct from generic home service bookings:
 * Stage 1: Payment Successful (Amount, Razorpay ID, Timestamp)
 * Stage 2: In Progress (ISP operator is configuring line on OLT / billing)
 * Stage 3: Recharge Process Complete (Operator has confirmed fulfillment, line active)
 */

import React, { useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
    RefreshControl, Linking,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
    CheckCircle2, Clock, Phone, MessageSquare, RefreshCw,
    Wifi, ArrowLeft,
} from 'lucide-react-native';
import { ftthApi } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader, Button } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHRechargeTracking'>;

export function FTTHRechargeTrackingScreen({ navigation, route }: Props) {
    const rechargeId = Number(route.params?.rechargeId);
    const { bottomBar } = useScreenInsets();

    const {
        data: tracking,
        isLoading,
        isRefetching,
        refetch,
    } = useQuery({
        queryKey: ['ftth', 'recharge', 'tracking', rechargeId],
        queryFn: () => ftthApi.getRechargeTracking(rechargeId),
        enabled: !!rechargeId,
        refetchInterval: (query) => {
            // Auto poll every 10 seconds if in progress, stop when completed or failed
            const data = query.state.data;
            if (data && data.stage < 3 && data.status !== 'failed') return 10000;
            return false;
        },
    });

    const callOperator = () => {
        if (tracking?.operatorPhone) {
            Linking.openURL(`tel:${tracking.operatorPhone}`);
        }
    };

    const whatsappOperator = () => {
        if (tracking?.operatorPhone) {
            const cleanPhone = tracking.operatorPhone.replace(/\D/g, '');
            const msg = encodeURIComponent(
                `Hello ${tracking.operatorName}, I have a query regarding my broadband recharge of ${tracking.plan.name} (Recharge #${rechargeId}, Connection ID: ${tracking.ispConnectionId}).`
            );
            Linking.openURL(`https://wa.me/91${cleanPhone.slice(-10)}?text=${msg}`);
        }
    };

    if (isLoading) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Recharge Status" onBack={() => navigation.navigate('CustomerTabs')} />
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.loadingText}>Fetching recharge status…</Text>
                </View>
            </View>
        );
    }

    if (!tracking) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Recharge Status" onBack={() => navigation.navigate('CustomerTabs')} />
                <View style={styles.centerContainer}>
                    <Text style={styles.errorTitle}>Recharge Not Found</Text>
                    <Text style={styles.errorBody}>Unable to load tracking information for this recharge.</Text>
                    <Button
                        title="Back to Home"
                        onPress={() => navigation.navigate('CustomerTabs')}
                        style={{ marginTop: spacing.xl }}
                    />
                </View>
            </View>
        );
    }

    const stage = tracking.stage;

    return (
        <View style={styles.screen}>
            <ScreenHeader
                title="Recharge Status"
                onBack={() => navigation.navigate('CustomerTabs')}
                rightAction={
                    <TouchableOpacity onPress={() => refetch()} style={styles.headerRefreshBtn}>
                        <RefreshCw size={18} color={colors.primary} />
                    </TouchableOpacity>
                }
            />

            <ScrollView
                contentContainerStyle={[styles.content, { paddingBottom: bottomBar + spacing['2xl'] }]}
                refreshControl={
                    <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
                }
            >
                {/* Hero Status Banner */}
                <View style={[
                    styles.heroCard,
                    stage === 3 && styles.heroCardSuccess,
                    stage === 2 && styles.heroCardInProgress,
                ]}>
                    <View style={styles.heroHeader}>
                        <View style={[
                            styles.heroIconCircle,
                            stage === 3 && { backgroundColor: '#10B98122' },
                            stage === 2 && { backgroundColor: '#F59E0B22' },
                        ]}>
                            {stage === 3 ? (
                                <CheckCircle2 size={24} color="#10B981" />
                            ) : (
                                <Clock size={24} color="#F59E0B" />
                            )}
                        </View>
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={styles.heroTitle}>{tracking.stageTitle}</Text>
                            <Text style={styles.heroSubtitle}>{tracking.stageDescription}</Text>
                        </View>
                    </View>

                    <View style={styles.heroDivider} />

                    <View style={styles.heroFooter}>
                        <View>
                            <Text style={styles.heroFooterLabel}>Connection ID</Text>
                            <Text style={styles.heroFooterValue}>{tracking.ispConnectionId ?? '—'}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.heroFooterLabel}>Total Amount</Text>
                            <Text style={styles.heroFooterValue}>₹{tracking.plan.total}</Text>
                        </View>
                    </View>
                </View>

                {/* 3-Stage Visual Timeline */}
                <Text style={styles.sectionTitle}>Progress Timeline</Text>
                <View style={styles.timelineCard}>
                    {/* Stage 1: Payment Successful */}
                    <View style={styles.timelineStep}>
                        <View style={styles.timelineLeft}>
                            <View style={[styles.timelineNode, styles.timelineNodeDone]}>
                                <CheckCircle2 size={16} color="#FFFFFF" />
                            </View>
                            <View style={[styles.timelineLine, styles.timelineLineDone]} />
                        </View>
                        <View style={styles.timelineRight}>
                            <Text style={styles.stepTitle}>1. Payment Successful</Text>
                            <Text style={styles.stepDescription}>
                                Verified via Razorpay
                                {tracking.razorpayPaymentId ? ` (${tracking.razorpayPaymentId})` : ''}
                            </Text>
                            <Text style={styles.stepTime}>
                                {tracking.paidAt ? new Date(tracking.paidAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Done'}
                            </Text>
                        </View>
                    </View>

                    {/* Stage 2: In Progress */}
                    <View style={styles.timelineStep}>
                        <View style={styles.timelineLeft}>
                            <View style={[
                                styles.timelineNode,
                                stage >= 2 ? (stage > 2 ? styles.timelineNodeDone : styles.timelineNodeActive) : styles.timelineNodePending,
                            ]}>
                                {stage > 2 ? (
                                    <CheckCircle2 size={16} color="#FFFFFF" />
                                ) : (
                                    <Clock size={16} color={stage === 2 ? '#FFFFFF' : colors.textDisabled} />
                                )}
                            </View>
                            <View style={[
                                styles.timelineLine,
                                stage >= 3 ? styles.timelineLineDone : styles.timelineLinePending,
                            ]} />
                        </View>
                        <View style={styles.timelineRight}>
                            <Text style={[styles.stepTitle, stage < 2 && styles.stepTitleMuted]}>
                                2. In Progress (ISP Line Provisioning)
                            </Text>
                            <Text style={styles.stepDescription}>
                                {stage >= 2
                                    ? `${tracking.operatorName} is configuring the broadband OLT and updating account validity.`
                                    : 'Awaiting operator provisioning.'}
                            </Text>
                            {stage === 2 && (
                                <View style={styles.inProgressBadge}>
                                    <ActivityIndicator size="small" color="#D97706" />
                                    <Text style={styles.inProgressBadgeText}>Operator processing in background</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Stage 3: Complete */}
                    <View style={styles.timelineStep}>
                        <View style={styles.timelineLeft}>
                            <View style={[
                                styles.timelineNode,
                                stage >= 3 ? styles.timelineNodeDone : styles.timelineNodePending,
                            ]}>
                                <CheckCircle2 size={16} color={stage >= 3 ? '#FFFFFF' : colors.textDisabled} />
                            </View>
                        </View>
                        <View style={styles.timelineRight}>
                            <Text style={[styles.stepTitle, stage < 3 && styles.stepTitleMuted]}>
                                3. Recharge Process Complete
                            </Text>
                            <Text style={styles.stepDescription}>
                                {stage >= 3
                                    ? `Broadband active. Valid till ${new Date(tracking.validTill!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.`
                                    : 'Operator confirms completion in the ISP admin portal.'}
                            </Text>
                            {tracking.fulfilledAt && (
                                <Text style={styles.stepTime}>
                                    {new Date(tracking.fulfilledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Plan Summary Card */}
                <Text style={styles.sectionTitle}>Plan Details</Text>
                <View style={styles.card}>
                    <View style={styles.rowBetween}>
                        <View style={styles.rowCenter}>
                            <View style={styles.planIconCircle}>
                                <Wifi size={18} color={colors.primary} />
                            </View>
                            <View style={{ marginLeft: spacing.md }}>
                                <Text style={styles.cardHeading}>{tracking.plan.name}</Text>
                                <Text style={styles.cardSubtext}>{tracking.plan.speedMbps} Mbps · {tracking.plan.durationMonths} Month(s)</Text>
                            </View>
                        </View>
                        <Text style={styles.cardAmount}>₹{tracking.plan.total}</Text>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Plan Base Price</Text>
                        <Text style={styles.summaryValue}>₹{tracking.plan.planPrice}</Text>
                    </View>
                    {tracking.plan.discount > 0 && (
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Operator Discount</Text>
                            <Text style={[styles.summaryValue, { color: colors.accentDark }]}>− ₹{tracking.plan.discount}</Text>
                        </View>
                    )}
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Convenience Fee</Text>
                        <Text style={styles.summaryValue}>₹{tracking.plan.convenienceFee}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryLabel, styles.bold]}>Total Paid</Text>
                        <Text style={[styles.summaryValue, styles.bold]}>₹{tracking.plan.total}</Text>
                    </View>
                </View>

                {/* Operator Support Contact Card */}
                <Text style={styles.sectionTitle}>Need Assistance?</Text>
                <View style={styles.card}>
                    <Text style={styles.cardHeading}>{tracking.operatorName}</Text>
                    <Text style={styles.cardSubtext}>
                        For line speed checks, fiber cable routing, or instant status updates, reach out to your local operator.
                    </Text>

                    <View style={styles.supportButtonsRow}>
                        {tracking.operatorPhone && (
                            <>
                                <TouchableOpacity style={styles.supportBtn} onPress={callOperator}>
                                    <Phone size={16} color={colors.primary} />
                                    <Text style={styles.supportBtnText}>Call Operator</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.supportBtn, styles.whatsappBtn]} onPress={whatsappOperator}>
                                    <MessageSquare size={16} color="#059669" />
                                    <Text style={[styles.supportBtnText, { color: '#059669' }]}>WhatsApp</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>

                {/* Navigation CTA */}
                <View style={styles.actionButtonsContainer}>
                    <Button
                        title="Back to Home"
                        onPress={() => navigation.navigate('CustomerTabs')}
                        variant="primary"
                        style={{ flex: 1 }}
                    />
                    <Button
                        title="Recharge History"
                        onPress={() => navigation.navigate('FTTHHistory')}
                        variant="secondary"
                        style={{ flex: 1 }}
                    />
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.base },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
    loadingText: { ...typography.bodyMedium, color: colors.textSecondary, marginTop: spacing.md },
    errorTitle: { ...typography.h3, color: colors.textPrimary },
    errorBody: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
    headerRefreshBtn: { padding: spacing.sm },

    heroCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.xl,
        padding: spacing.lg,
        ...shadows.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    heroCardInProgress: {
        borderColor: '#F59E0B66',
        backgroundColor: '#FFFDF9',
    },
    heroCardSuccess: {
        borderColor: '#10B98166',
        backgroundColor: '#F7FCFA',
    },
    heroHeader: { flexDirection: 'row', alignItems: 'center' },
    heroIconCircle: {
        width: 48,
        height: 48,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroTitle: { ...typography.h4, color: colors.textPrimary },
    heroSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    heroDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.divider,
        marginVertical: spacing.md,
    },
    heroFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    heroFooterLabel: { ...typography.caption, color: colors.textSecondary },
    heroFooterValue: { ...typography.h4, color: colors.textPrimary, marginTop: 2 },

    sectionTitle: {
        ...typography.label,
        color: colors.textSecondary,
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },

    timelineCard: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.lg,
        ...shadows.xs,
    },
    timelineStep: { flexDirection: 'row', minHeight: 70 },
    timelineLeft: { width: 32, alignItems: 'center' },
    timelineNode: {
        width: 28,
        height: 28,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    timelineNodeDone: { backgroundColor: '#10B981' },
    timelineNodeActive: { backgroundColor: '#F59E0B' },
    timelineNodePending: { backgroundColor: colors.border },
    timelineLine: {
        width: 2,
        flex: 1,
        marginVertical: 4,
    },
    timelineLineDone: { backgroundColor: '#10B981' },
    timelineLinePending: { backgroundColor: colors.border },
    timelineRight: { flex: 1, marginLeft: spacing.md, paddingBottom: spacing.lg },
    stepTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    stepTitleMuted: { color: colors.textDisabled },
    stepDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    stepTime: { ...typography.caption, color: colors.textSecondary, marginTop: 4, fontSize: 11 },
    inProgressBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF3C7',
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 4,
        marginTop: spacing.xs,
        alignSelf: 'flex-start',
        gap: spacing.xs,
    },
    inProgressBadgeText: { ...typography.caption, color: '#D97706', fontWeight: '600', fontSize: 11 },

    card: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.base,
        ...shadows.xs,
    },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowCenter: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    planIconCircle: {
        width: 36,
        height: 36,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardHeading: { ...typography.bodySemibold, color: colors.textPrimary },
    cardSubtext: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    cardAmount: { ...typography.h4, color: colors.textPrimary },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginVertical: spacing.md },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
    summaryLabel: { ...typography.caption, color: colors.textSecondary },
    summaryValue: { ...typography.caption, color: colors.textPrimary },
    bold: { ...typography.bodySemibold, color: colors.textPrimary },

    supportButtonsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
    supportBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing.md,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
        gap: spacing.xs,
    },
    whatsappBtn: {
        borderColor: '#059669',
        backgroundColor: '#ECFDF5',
    },
    supportBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

    actionButtonsContainer: {
        flexDirection: 'row',
        gap: spacing.md,
        marginTop: spacing.xl,
    },
});
