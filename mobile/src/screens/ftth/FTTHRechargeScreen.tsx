/**
 * Recharge — pick a speed, then a term, then extras, then pay.
 *
 * LAYOUT, and why. Five things used to stack in one scroll: speed chips, the
 * duration selector, an add-on card, an itemised bill card, then a sticky
 * footer. With two or three groups of add-ons the total fell off a 360×740
 * screen and every tick was followed by a scroll to see what it did.
 *
 * Two moves fix it, neither of which is shrinking anything:
 *   - add-ons collapse into one row per kind (opened one at a time);
 *   - the itemised bill leaves the scroll and lives in a bottom sheet behind
 *     the footer's total.
 * With all groups collapsed, the base plan, every group header and the footer
 * fit on the first screen.
 *
 * The total shown here is a PREVIEW. At pay time the server prices the same
 * ids from the database and the Razorpay sheet opens on that figure.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StatusBar, Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wifi, Info, Zap, ArrowRight, ChevronUp } from 'lucide-react-native';
import { ftthApi, FtthConnection, FtthPlan } from '../../api/ftth.api';
import { openRazorpayCheckout, handleRazorpayError } from '../../services/razorpay';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';
import { DurationRangeSelector } from '../../components/ftth/DurationRangeSelector';
import { AddonGroupAccordion } from '../../components/ftth/AddonGroupAccordion';
import { BillSummarySheet } from '../../components/ftth/BillSummarySheet';
import { usePlanPricing } from '../../hooks/usePlanPricing';

type Props = NativeStackScreenProps<any, 'FTTHRecharge'>;

export function FTTHRechargeScreen({ navigation, route }: Props) {
    const connection = route.params?.connection as FtthConnection;
    const { bottomBar } = useScreenInsets();
    const queryClient = useQueryClient();

    const [speed, setSpeed] = useState<number | null>(null);
    const [planId, setPlanId] = useState<number | null>(null);
    const [paying, setPaying] = useState(false);
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);

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

    const durationsForSpeed: FtthPlan[] = useMemo(() => {
        if (speed === null || !speedGroups) return [];
        return speedGroups.find(g => g.speedMbps === speed)?.plans ?? [];
    }, [speed, speedGroups]);

    // Select recommended / 12-month plan by default, or fall back to the first.
    useEffect(() => {
        if (durationsForSpeed.length === 0) { setPlanId(null); return; }
        if (!durationsForSpeed.some(p => p.id === planId)) {
            const recommended = durationsForSpeed.find(p => p.isRecommended || p.durationMonths === 12);
            setPlanId(recommended ? recommended.id : durationsForSpeed[0].id);
        }
    }, [durationsForSpeed, planId]);

    const selected = durationsForSpeed.find(p => p.id === planId) ?? null;
    const pricing = usePlanPricing(selected);
    const chosen = pricing.optional.filter(a => pricing.selected.includes(a.id));

    const pay = async () => {
        if (!selected) return;
        setPaying(true);
        try {
            const order = await ftthApi.initiateRecharge({
                connectionId: connection.id,
                planId: selected.id,
                addonIds: pricing.selected,
            });
            const result = await openRazorpayCheckout({
                razorpayOrderId: order.razorpayOrderId,
                razorpayKeyId: order.razorpayKeyId,
                amount: order.amount,                 // the server's figure, not the preview
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
            } catch {
                // The webhook applies it either way; the tracking screen shows the truth.
            }
            queryClient.invalidateQueries({ queryKey: ['ftth', 'connections'] });
            navigation.replace('FTTHRechargeTracking', { rechargeId: order.rechargeId });
        } catch (error: any) {
            const serverMessage = error?.response?.data?.message;
            if (serverMessage) Alert.alert('Cannot recharge', serverMessage);
            else handleRazorpayError(error);
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

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomBar + 120 }]} showsVerticalScrollIndicator={false}>
                {/* Hero Connection Card */}
                <View style={styles.connectionCard}>
                    <View style={styles.iconCircle}><Wifi size={20} color={colors.primary} /></View>
                    <View style={styles.connectionDetails}>
                        <View style={styles.operatorRow}>
                            <Text style={styles.connectionTitle} numberOfLines={1}>{connection.operatorName}</Text>
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
                        <Text style={styles.emptyText}>{connection.operatorName} hasn't published any recharge plans yet. Please check back soon.</Text>
                    </View>
                ) : (
                    <>
                        {/* ── Base plan ─────────────────────────────────────── */}
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Base plan</Text>
                            <Text style={styles.sectionHint}>Dedicated Fiber</Text>
                        </View>
                        <View style={styles.speedChipRow}>
                            {speedGroups.map((g) => {
                                const on = speed === g.speedMbps;
                                return (
                                    <TouchableOpacity key={g.speedMbps} style={[styles.speedChip, on && styles.speedChipActive]} onPress={() => setSpeed(g.speedMbps)} activeOpacity={0.7}>
                                        <Text style={[styles.speedChipNumber, on && styles.speedChipNumberActive]}>{g.speedMbps}</Text>
                                        <Text style={[styles.speedChipUnit, on && styles.speedChipUnitActive]}>Mbps</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        <DurationRangeSelector plans={durationsForSpeed} selectedPlanId={planId} onSelectPlan={(p) => setPlanId(p.id)} />

                        {/* One line confirming the base choice, and what it includes.
                            Mandatory add-ons are part of the plan, not a choice, so
                            they read as "Includes", never as a checkbox you can't untick. */}
                        {selected && (
                            <View style={styles.baseSummary}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.baseTitle}>{selected.speedMbps} Mbps · {selected.durationMonths} month{selected.durationMonths === 1 ? '' : 's'}</Text>
                                    {pricing.mandatory.length > 0 && (
                                        <Text style={styles.baseIncludes}>
                                            Includes {pricing.mandatory.map(a => `${a.label} ₹${a.amount}`).join(', ')}
                                        </Text>
                                    )}
                                </View>
                                <Text style={styles.basePrice}>₹{selected.payable}</Text>
                            </View>
                        )}

                        {/* ── Add-ons ───────────────────────────────────────── */}
                        {selected && pricing.groups.length > 0 && (
                            <>
                                <View style={styles.sectionHeaderRow}>
                                    <Text style={styles.sectionTitle}>Add-ons</Text>
                                    <Text style={styles.sectionHint}>Optional</Text>
                                </View>
                                {pricing.groups.map(g => (
                                    <AddonGroupAccordion
                                        key={g.kind}
                                        group={g}
                                        open={openGroup === g.kind}
                                        onToggleOpen={() => setOpenGroup(openGroup === g.kind ? null : g.kind)}
                                        selected={pricing.selected}
                                        onToggleItem={pricing.toggle}
                                    />
                                ))}
                            </>
                        )}
                    </>
                )}
            </ScrollView>

            {/* ── Sticky footer: the answer, not the working ─────────────────── */}
            {selected && (
                <View style={[styles.footer, { paddingBottom: Math.max(bottomBar, spacing.md) + spacing.xs }]}>
                    <TouchableOpacity style={styles.footerInfo} onPress={() => setSheetOpen(true)} activeOpacity={0.7}>
                        <Text style={styles.footerLabel}>Total payable · {pricing.itemCount} item{pricing.itemCount === 1 ? '' : 's'}</Text>
                        <Text style={styles.footerAmount}>₹{pricing.total}</Text>
                        <View style={styles.footerLink}>
                            <ChevronUp size={12} color={colors.primary} />
                            <Text style={styles.footerLinkText}>View breakdown</Text>
                        </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.payButton, paying && styles.payButtonDisabled]} onPress={pay} disabled={paying} activeOpacity={0.8}>
                        {paying ? <ActivityIndicator size="small" color="#fff" /> : (
                            <>
                                <Text style={styles.payButtonText}>Proceed to Pay</Text>
                                <ArrowRight size={18} color="#fff" style={{ marginLeft: 6 }} />
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            )}

            {selected && (
                <BillSummarySheet
                    visible={sheetOpen}
                    onClose={() => setSheetOpen(false)}
                    plan={selected}
                    mandatory={pricing.mandatory}
                    chosen={chosen}
                    total={pricing.total}
                />
            )}
        </View>
    );
}


const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },

    // ── Connection Hero Card ──
    connectionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.md, ...shadows.sm, borderWidth: 1, borderColor: colors.border },
    iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
    connectionDetails: { flex: 1, marginLeft: spacing.md, justifyContent: 'center' },
    operatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    connectionTitle: { ...typography.bodySemibold, color: colors.textPrimary, fontSize: 15 },
    speedPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySurface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.full, gap: 2 },
    speedPillText: { fontSize: 10, fontWeight: '700', color: colors.primary },
    connectionSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    validityBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.full, backgroundColor: '#DCFCE7' },
    validityBadgeExpired: { backgroundColor: '#FEE2E2' },
    validityText: { fontSize: 11, fontWeight: '700', color: '#15803D' },
    validityTextExpired: { color: colors.error },

    // ── Sections ──
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: spacing.xl, marginBottom: spacing.sm },
    sectionTitle: { ...typography.label, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
    sectionHint: { ...typography.caption, color: colors.textTertiary, fontSize: 11 },
    speedChipRow: { flexDirection: 'row', gap: spacing.sm },
    speedChip: { flex: 1, paddingVertical: spacing.md, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    speedChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySurface, ...shadows.xs },
    speedChipNumber: { ...typography.h4, color: colors.textPrimary, fontSize: 18 },
    speedChipNumberActive: { color: colors.primary, fontWeight: '800' },
    speedChipUnit: { ...typography.caption, color: colors.textSecondary, fontSize: 11, marginTop: -2 },
    speedChipUnitActive: { color: colors.primary, fontWeight: '600' },

    // ── Base summary line ──
    baseSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md },
    baseTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    baseIncludes: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    basePrice: { ...typography.bodySemibold, color: colors.textPrimary },

    // ── States ──
    loadingContainer: { marginTop: spacing['3xl'], alignItems: 'center', gap: spacing.sm },
    loadingText: { ...typography.caption, color: colors.textSecondary },
    emptyCard: { marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadows.xs },
    emptyTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },

    // ── Sticky Footer ──
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadows.lg },
    footerInfo: { flex: 1 },
    footerLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
    footerAmount: { ...typography.h3, color: colors.textPrimary, fontSize: 22 },
    footerLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    footerLinkText: { ...typography.caption, color: colors.primary, fontSize: 11 },
    payButton: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 160, ...shadows.sm },
    payButtonDisabled: { opacity: 0.7 },
    payButtonText: { color: '#fff', ...typography.bodySemibold, fontSize: 15 },
});
