/**
 * Duration Selector — Single unified card grid + value breakdown.
 *
 * Replaces the previous dual-selector (dotted track + segmented strip)
 * with ONE clean card-based picker that works on all screen sizes
 * without any overlapping floating badges.
 */

import React, { useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import {
    CheckCircle2, TrendingDown, Clock, Sparkles,
} from 'lucide-react-native';
import { FtthPlan } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

interface Props {
    plans: FtthPlan[];
    selectedPlanId: number | null;
    onSelectPlan: (plan: FtthPlan) => void;
}

export function DurationRangeSelector({ plans, selectedPlanId, onSelectPlan }: Props) {
    if (!plans || plans.length === 0) return null;

    const sortedPlans = useMemo(() => {
        return [...plans].sort((a, b) => a.durationMonths - b.durationMonths);
    }, [plans]);

    const selectedIndex = Math.max(
        0,
        sortedPlans.findIndex((p) => p.id === selectedPlanId)
    );
    const activePlan = sortedPlans[selectedIndex] || sortedPlans[0];

    // Baseline 1-month rate for savings comparison
    const basePlan = useMemo(() => {
        return sortedPlans.find((p) => p.durationMonths === 1) || sortedPlans[0];
    }, [sortedPlans]);
    const baseMonthlyPrice = Math.round(basePlan.finalPrice / Math.max(1, basePlan.durationMonths));

    return (
        <View style={styles.container}>
            {/* Section Header */}
            <View style={styles.headerRow}>
                <Text style={styles.headerTitle}>2. Choose Duration</Text>
                <Text style={styles.headerSubtitle}>Longer = cheaper per month</Text>
            </View>

            {/* ── Single Duration Card Grid ── */}
            <View style={styles.cardGrid}>
                {sortedPlans.map((plan) => {
                    const isSelected = plan.id === activePlan.id;
                    const isAnnual = plan.isRecommended || plan.durationMonths >= 12;
                    const monthlyRate = Math.round(plan.finalPrice / plan.durationMonths);
                    const savings = Math.max(0, (baseMonthlyPrice * plan.durationMonths) - plan.finalPrice);
                    const percentSaved = baseMonthlyPrice > 0 && savings > 0
                        ? Math.round((savings / (baseMonthlyPrice * plan.durationMonths)) * 100)
                        : 0;

                    return (
                        <TouchableOpacity
                            key={plan.id}
                            style={[
                                styles.durationCard,
                                isSelected && styles.durationCardSelected,
                                isAnnual && isSelected && styles.durationCardAnnual,
                            ]}
                            onPress={() => onSelectPlan(plan)}
                            activeOpacity={0.7}
                        >
                            {/* Recommended ribbon */}
                            {isAnnual && (
                                <View style={styles.ribbonBadge}>
                                    <Sparkles size={9} color="#fff" />
                                    <Text style={styles.ribbonText}>Best Value</Text>
                                </View>
                            )}

                            {/* Duration */}
                            <Text style={[
                                styles.cardDuration,
                                isSelected && styles.cardDurationSelected,
                                isAnnual && isSelected && styles.cardDurationAnnual,
                            ]}>
                                {plan.durationMonths >= 12
                                    ? '1 Year'
                                    : `${plan.durationMonths} Mo`}
                            </Text>

                            {/* Effective monthly rate */}
                            <Text style={[
                                styles.cardPrice,
                                isSelected && styles.cardPriceSelected,
                                isAnnual && isSelected && styles.cardPriceAnnual,
                            ]}>
                                ₹{monthlyRate}
                                <Text style={styles.cardPriceUnit}>/mo</Text>
                            </Text>

                            {/* Savings pill */}
                            {percentSaved > 0 ? (
                                <View style={[
                                    styles.savingsPill,
                                    isSelected && styles.savingsPillSelected,
                                    isAnnual && styles.savingsPillAnnual,
                                ]}>
                                    <Text style={[
                                        styles.savingsPillText,
                                        isAnnual && styles.savingsPillTextAnnual,
                                    ]}>
                                        Save {percentSaved}%
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.savingsPillSpacer} />
                            )}

                            {/* Selection indicator */}
                            {isSelected && (
                                <View style={[
                                    styles.selectedDot,
                                    isAnnual && { backgroundColor: '#059669' },
                                ]} />
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* ── Active Plan Value Card ── */}
            <View style={[
                styles.valueCard,
                (activePlan.isRecommended || activePlan.durationMonths >= 12) && styles.valueCardAnnual,
            ]}>
                {/* Card Header */}
                <View style={styles.valueCardHeader}>
                    <View style={styles.validityRow}>
                        <Clock size={13} color={colors.primary} />
                        <Text style={styles.validityText}>
                            {activePlan.durationMonths >= 12
                                ? '12 Months (1 Full Year)'
                                : `${activePlan.durationMonths} Month${activePlan.durationMonths === 1 ? '' : 's'} Validity`}
                        </Text>
                    </View>

                    {(activePlan.isRecommended || activePlan.durationMonths >= 12) && (
                        <View style={styles.recPill}>
                            <CheckCircle2 size={11} color="#059669" />
                            <Text style={styles.recPillText}>Recommended</Text>
                        </View>
                    )}
                </View>

                {/* Price Row */}
                <View style={styles.priceRow}>
                    <View style={{ flex: 1 }}>
                        <View style={styles.priceAmountRow}>
                            <Text style={styles.rupeeSign}>₹</Text>
                            <Text style={styles.totalPrice}>{activePlan.finalPrice}</Text>
                            {activePlan.discount > 0 && (
                                <Text style={styles.strikePrice}>₹{activePlan.price}</Text>
                            )}
                        </View>
                        <Text style={styles.priceTenure}>
                            Total for {activePlan.durationMonths} {activePlan.durationMonths === 1 ? 'month' : 'months'} (All Taxes Included)
                        </Text>
                    </View>

                    <View style={styles.effectiveBox}>
                        <Text style={styles.effectiveLabel}>EFFECTIVE</Text>
                        <Text style={styles.effectiveValue}>
                            ₹{Math.round(activePlan.finalPrice / activePlan.durationMonths)}
                            <Text style={styles.effectiveMo}>/mo</Text>
                        </Text>
                        <Text style={styles.dailyRate}>
                            ~₹{(activePlan.finalPrice / (activePlan.durationMonths * 30)).toFixed(1)}/day
                        </Text>
                    </View>
                </View>

                {/* Savings Banner */}
                {(() => {
                    const savings = Math.max(0, (baseMonthlyPrice * activePlan.durationMonths) - activePlan.finalPrice);
                    if (savings <= 0) return null;
                    return (
                        <View style={styles.savingsBanner}>
                            <TrendingDown size={14} color="#15803D" />
                            <Text style={styles.savingsBannerText}>
                                You save <Text style={{ fontWeight: '800' }}>₹{savings}</Text> compared to monthly renewals!
                            </Text>
                        </View>
                    );
                })()}

                {/* Perks */}
                <View style={styles.perksContainer}>
                    <View style={styles.perkRow}>
                        <CheckCircle2 size={14} color="#059669" />
                        <Text style={styles.perkText}>
                            {activePlan.dataLimitGb === null ? 'Truly Unlimited High-Speed Fiber' : `${activePlan.dataLimitGb} GB High Speed Data`}
                        </Text>
                    </View>
                    <View style={styles.perkRow}>
                        <CheckCircle2 size={14} color="#059669" />
                        <Text style={styles.perkText}>
                            {activePlan.speedMbps} Mbps Dedicated Optical Fiber Line
                        </Text>
                    </View>
                    {(activePlan.durationMonths >= 12 || activePlan.isRecommended) && (
                        <>
                            <View style={styles.perkRow}>
                                <CheckCircle2 size={14} color="#059669" />
                                <Text style={styles.perkText}>
                                    Priority OLT Routing & Faster Support
                                </Text>
                            </View>
                            <View style={styles.perkRow}>
                                <CheckCircle2 size={14} color="#059669" />
                                <Text style={styles.perkText}>
                                    Protected Against Price Hikes for 1 Full Year
                                </Text>
                            </View>
                        </>
                    )}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: spacing.xl,
        marginBottom: spacing.md,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: spacing.sm,
    },
    headerTitle: {
        ...typography.label,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    headerSubtitle: {
        ...typography.caption,
        color: colors.textTertiary,
        fontSize: 11,
    },

    // ── Duration Card Grid ──
    cardGrid: {
        flexDirection: 'row',
        gap: spacing.sm,
        marginBottom: spacing.md,
    },
    durationCard: {
        flex: 1,
        backgroundColor: colors.surface,
        borderRadius: radii.lg,
        borderWidth: 1.5,
        borderColor: colors.border,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
        paddingHorizontal: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
    },
    durationCardSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
        ...shadows.xs,
    },
    durationCardAnnual: {
        borderColor: '#10B981',
        backgroundColor: '#ECFDF5',
        borderWidth: 2,
    },
    ribbonBadge: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#059669',
        paddingVertical: 2,
        gap: 2,
    },
    ribbonText: {
        fontSize: 8,
        fontWeight: '800',
        color: '#fff',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    cardDuration: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 15,
        marginTop: 2,
    },
    cardDurationSelected: {
        color: colors.primary,
        fontWeight: '800',
    },
    cardDurationAnnual: {
        color: '#047857',
    },
    cardPrice: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
    },
    cardPriceSelected: {
        color: colors.textPrimary,
        fontWeight: '700',
    },
    cardPriceAnnual: {
        color: '#065F46',
    },
    cardPriceUnit: {
        fontSize: 10,
        fontWeight: 'normal',
    },
    savingsPill: {
        backgroundColor: '#EFF6FF',
        borderRadius: radii.full,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 4,
    },
    savingsPillSelected: {
        backgroundColor: '#DBEAFE',
    },
    savingsPillAnnual: {
        backgroundColor: '#D1FAE5',
    },
    savingsPillText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#1D4ED8',
    },
    savingsPillTextAnnual: {
        color: '#047857',
    },
    savingsPillSpacer: {
        height: 18,
        marginTop: 4,
    },
    selectedDot: {
        position: 'absolute',
        bottom: 4,
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: colors.primary,
    },

    // ── Value Card ──
    valueCard: {
        backgroundColor: colors.surface,
        borderRadius: radii.xl,
        borderWidth: 1.5,
        borderColor: colors.border,
        padding: spacing.lg,
        ...shadows.sm,
    },
    valueCardAnnual: {
        borderColor: '#10B981',
        backgroundColor: '#FAFCFB',
        borderWidth: 2,
    },
    valueCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: spacing.xs,
        marginBottom: spacing.md,
    },
    validityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    validityText: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        fontSize: 13,
    },
    recPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radii.full,
        gap: 3,
    },
    recPillText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#047857',
        textTransform: 'uppercase',
    },
    priceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingBottom: spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.divider,
    },
    priceAmountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    rupeeSign: {
        fontSize: 20,
        fontWeight: '800',
        color: colors.textPrimary,
        marginRight: 2,
    },
    totalPrice: {
        fontSize: 28,
        fontWeight: '800',
        color: colors.textPrimary,
        letterSpacing: -0.5,
    },
    strikePrice: {
        fontSize: 14,
        color: colors.textTertiary,
        textDecorationLine: 'line-through',
        marginLeft: spacing.sm,
        fontWeight: '600',
    },
    priceTenure: {
        ...typography.caption,
        color: colors.textSecondary,
        fontSize: 11,
        marginTop: 2,
    },
    effectiveBox: {
        backgroundColor: colors.surfaceElevated,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.lg,
        alignItems: 'flex-end',
        borderWidth: 1,
        borderColor: colors.border,
    },
    effectiveLabel: {
        fontSize: 9,
        color: colors.textSecondary,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    effectiveValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#059669',
        marginTop: 1,
    },
    effectiveMo: {
        fontSize: 11,
        color: colors.textSecondary,
        fontWeight: 'normal',
    },
    dailyRate: {
        fontSize: 9,
        color: colors.textTertiary,
        marginTop: 1,
    },
    savingsBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DCFCE7',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.lg,
        marginTop: spacing.md,
        gap: spacing.sm,
    },
    savingsBannerText: {
        fontSize: 12,
        color: '#15803D',
        fontWeight: '600',
        flex: 1,
    },
    perksContainer: {
        marginTop: spacing.md,
        gap: spacing.xs + 2,
    },
    perkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    perkText: {
        ...typography.caption,
        color: colors.textPrimary,
        fontSize: 12,
    },
});
