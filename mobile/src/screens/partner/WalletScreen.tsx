/**
 * Wallet / Payments Screen — Earnings summary + transaction history
 * Features:
 * - Live balances (Available, On Hold, Total Earned)
 * - Fast-track release explanation modal with Info icons
 * - "N jobs completed" live badge
 * - Negative balance / platform dues warning banner
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    RefreshControl,
    ActivityIndicator,
    Alert,
    TouchableOpacity,
    Modal,
    Pressable,
} from 'react-native';
import {
    Wallet,
    TrendingUp,
    ArrowDownLeft,
    ArrowUpRight,
    Briefcase,
    Info,
    AlertTriangle,
    X,
    CheckCircle2,
    Clock,
    Sparkles,
} from 'lucide-react-native';
import { useWallet, useWithdraw } from '../../hooks/usePartnerData';
import { usePartnerProfile, usePublicConfig } from '../../hooks/useCustomerData';
import { WalletTransaction } from '../../api/partner.api';
import { Button } from '../../components/ui/Button';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { EmptyState } from '../../components/ui/EmptyState';
import { useScreenInsets } from '../../theme/layout';

/** "4 Sep" — short enough for a summary card, unambiguous enough to plan around. */
function formatReleaseDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

interface InfoModalData {
    title: string;
    description: string;
    badge?: string;
    highlights?: string[];
}

function TransactionItem({ item }: { item: WalletTransaction }) {
    const isCredit = item.type === 'credit';
    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short',
    });

    return (
        <View style={styles.txnItem}>
            <View style={[styles.txnIcon, { backgroundColor: isCredit ? colors.successLight : colors.errorLight }]}>
                {isCredit ? (
                    <ArrowDownLeft size={16} color={colors.success} />
                ) : (
                    <ArrowUpRight size={16} color={colors.error} />
                )}
            </View>
            <View style={styles.txnContent}>
                <Text style={styles.txnDesc}>{item.description}</Text>
                <Text style={styles.txnDate}>{date}</Text>
            </View>
            <Text style={[styles.txnAmount, { color: isCredit ? colors.success : colors.error }]}>
                {isCredit ? '+' : '-'}₹{item.amount}
            </Text>
        </View>
    );
}

export function WalletScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const { data: wallet, isLoading, refetch, isRefetching, isError } = useWallet();
    const { data: partnerProfile, isLoading: isPartnerLoading } = usePartnerProfile();
    const { data: publicConfig } = usePublicConfig();
    const withdrawMutation = useWithdraw();

    const [activeInfo, setActiveInfo] = useState<InfoModalData | null>(null);

    // Admin-configurable minimum withdrawal (BUSINESS_CONFIG.MIN_WALLET_REDEMPTION).
    const minRedemption = publicConfig?.minWalletRedemption ?? 500;

    if (isLoading || isPartnerLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    const available = wallet?.availableBalance || 0;
    const held = wallet?.pendingPayments || 0;
    const isNegativeBlocked = wallet?.isBlockedDueToDues || available <= -250;

    const handleWithdraw = () => {
        if (!(partnerProfile as any)?.upiId && !(partnerProfile as any)?.data?.upiId) {
            Alert.alert(
                'UPI ID Required',
                'Please set up your UPI ID in your Profile before requesting a withdrawal.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (available < minRedemption && held > 0) {
            Alert.alert(
                'Your earnings are still on hold',
                `₹${held} from your recent jobs isn't available to withdraw yet.`
                + (wallet?.nextReleaseDate
                    ? `\n\nIt becomes available on ${formatReleaseDate(wallet.nextReleaseDate)}.`
                    : '')
                + `\n\nTip: When customers give you a 4★ or 5★ rating, funds release instantly!`
                + `\n\nAvailable to withdraw right now: ₹${available}.`,
            );
            return;
        }

        if (available < minRedemption) {
            Alert.alert(
                'Not enough to withdraw yet',
                `You have ₹${available} available. The minimum withdrawal is ₹${minRedemption}.`,
            );
            return;
        }

        Alert.alert(
            'Request Withdrawal',
            `Request a payout of ₹${available} to your linked UPI?\n\nThe amount moves to processing and will be sent to your UPI once approved by our team.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Request Payout',
                    onPress: () => withdrawMutation.mutate({ amount: available, method: 'upi' })
                }
            ]
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.headerTitle}>Earnings & Wallet</Text>
            </View>

            <FlatList
                data={wallet?.recentTransactions || []}
                renderItem={({ item }) => <TransactionItem item={item} />}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={[styles.listContent, { paddingBottom: tabContent }]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                ListHeaderComponent={
                    <View>
                        {/* Negative Balance / Dues Alert Banner */}
                        {isNegativeBlocked && (
                            <View style={styles.duesAlertCard}>
                                <View style={styles.duesAlertHeader}>
                                    <AlertTriangle size={20} color="#DC2626" />
                                    <Text style={styles.duesAlertTitle}>Outstanding Platform Dues</Text>
                                </View>
                                <Text style={styles.duesAlertText}>
                                    Your wallet has an unpaid cash commission of{' '}
                                    <Text style={{ fontWeight: '800' }}>₹{Math.abs(available)}</Text>.
                                    New job assignments are paused until your balance is brought above -₹250.
                                </Text>
                            </View>
                        )}

                        {/* Completed Jobs Counter Card */}
                        <TouchableOpacity
                            style={styles.completedCard}
                            activeOpacity={0.8}
                            onPress={() => setActiveInfo({
                                title: 'Completed Jobs',
                                description: 'This counter tracks all jobs verified with the customer handshake OTP and completed successfully.',
                                highlights: [
                                    'Updates immediately upon OTP completion',
                                    'Builds platform trust and higher customer priority',
                                ]
                            })}
                        >
                            <View style={styles.completedLeft}>
                                <Briefcase size={18} color={colors.success} />
                                <Text style={styles.completedText}>
                                    {wallet?.completedJobs || 0} jobs completed
                                </Text>
                            </View>
                            <Info size={16} color={colors.successDark} />
                        </TouchableOpacity>

                        {/* Available Balance Hero Card */}
                        <View style={styles.availableCard}>
                            <View style={styles.availableHeader}>
                                <View style={styles.labelWithInfo}>
                                    <Text style={styles.availableLabel}>Available Balance</Text>
                                    <TouchableOpacity
                                        onPress={() => setActiveInfo({
                                            title: 'Available Balance',
                                            badge: 'Withdrawable Now',
                                            description: 'Funds in your Available Balance have passed verification and are ready for payout directly to your bank or UPI.',
                                            highlights: [
                                                `Minimum withdrawal amount is ₹${minRedemption}`,
                                                'Transfers are processed within 24 hours of request',
                                                'No hidden transaction or convenience fees',
                                            ]
                                        })}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                    >
                                        <Info size={16} color={colors.primary} />
                                    </TouchableOpacity>
                                </View>
                                <Wallet size={20} color={colors.primary} />
                            </View>

                            <Text style={[
                                styles.availableAmount,
                                available < 0 && { color: '#DC2626' }
                            ]}>
                                {available < 0 ? `-₹${Math.abs(available)}` : `₹${available}`}
                            </Text>

                            <Button
                                title="Withdraw to UPI"
                                onPress={handleWithdraw}
                                variant="primary"
                                disabled={available < minRedemption || isNegativeBlocked}
                                loading={withdrawMutation.isPending}
                                style={styles.withdrawBtn}
                            />

                            {/* Informational Hold Notice */}
                            {held > 0 && available < minRedemption && (
                                <View style={styles.holdBannerBox}>
                                    <Clock size={14} color="#B45309" />
                                    <Text style={styles.holdBannerText}>
                                        ₹{held} from recent jobs is on hold
                                        {wallet?.nextReleaseDate
                                            ? ` (unlocks ${formatReleaseDate(wallet.nextReleaseDate)})`
                                            : ''}
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Summary Split Row: Total Earned & On Hold */}
                        <View style={styles.summaryRow}>
                            {/* Total Earned */}
                            <TouchableOpacity
                                style={styles.summaryCard}
                                activeOpacity={0.8}
                                onPress={() => setActiveInfo({
                                    title: 'Total Earned',
                                    badge: 'Lifetime Metric',
                                    description: 'This is the total gross earnings you have accumulated across all completed services on UniteFix.',
                                    highlights: [
                                        'Never decreases when you withdraw funds',
                                        'Shows your lifetime earning milestone',
                                    ]
                                })}
                            >
                                <View style={styles.summaryCardTop}>
                                    <TrendingUp size={20} color={colors.success} />
                                    <Info size={14} color={colors.textTertiary} />
                                </View>
                                <Text style={styles.summaryAmount}>₹{wallet?.totalEarnings || 0}</Text>
                                <Text style={styles.summaryLabel}>Total Earned</Text>
                            </TouchableOpacity>

                            {/* On Hold */}
                            <TouchableOpacity
                                style={styles.summaryCard}
                                activeOpacity={0.8}
                                onPress={() => setActiveInfo({
                                    title: 'Earnings On Hold',
                                    badge: 'Quality Escrow',
                                    description: 'Earnings from recent jobs are placed on temporary hold for customer dispute protection.',
                                    highlights: [
                                        '⚡ Instant Release: Customer rating of 4★ or 5★ unlocks funds immediately!',
                                        'Standard Release: Auto-transfers to Available after dispute window (24–48 hrs)',
                                        'Never deducted unless an official customer dispute is verified',
                                    ]
                                })}
                            >
                                <View style={styles.summaryCardTop}>
                                    <Clock size={20} color="#D97706" />
                                    <Info size={14} color={colors.textTertiary} />
                                </View>
                                <Text style={styles.summaryAmount}>₹{held}</Text>
                                <Text style={styles.summaryLabel}>On Hold</Text>
                                {held > 0 && (
                                    <View style={styles.fastTrackPill}>
                                        <Sparkles size={10} color="#059669" />
                                        <Text style={styles.fastTrackText}>5★ = Instant Unlock</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.sectionTitle}>Recent Transactions</Text>
                    </View>
                }
                ListEmptyComponent={
                    isError ? (
                        <EmptyState
                            icon={<Wallet size={36} color={colors.textDisabled} />}
                            title="Wallet unavailable"
                            description="Pull down to refresh and try again."
                        />
                    ) : (
                        <EmptyState
                            icon={<Wallet size={36} color={colors.textDisabled} />}
                            title="No transactions yet"
                            description="Complete services to start earning. Your transaction history will appear here."
                        />
                    )
                }
            />

            {/* Explanation Modal */}
            <Modal
                visible={activeInfo !== null}
                transparent
                animationType="fade"
                onRequestClose={() => setActiveInfo(null)}
            >
                <Pressable style={styles.modalOverlay} onPress={() => setActiveInfo(null)}>
                    <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                        <View style={styles.modalHeader}>
                            <View>
                                <Text style={styles.modalTitle}>{activeInfo?.title}</Text>
                                {activeInfo?.badge && (
                                    <View style={styles.modalBadge}>
                                        <Text style={styles.modalBadgeText}>{activeInfo.badge}</Text>
                                    </View>
                                )}
                            </View>
                            <TouchableOpacity
                                style={styles.modalCloseBtn}
                                onPress={() => setActiveInfo(null)}
                            >
                                <X size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.modalDesc}>{activeInfo?.description}</Text>

                        {activeInfo?.highlights && activeInfo.highlights.length > 0 && (
                            <View style={styles.highlightsBox}>
                                {activeInfo.highlights.map((h, idx) => (
                                    <View key={idx} style={styles.highlightRow}>
                                        <CheckCircle2 size={15} color="#059669" style={{ marginTop: 2 }} />
                                        <Text style={styles.highlightText}>{h}</Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        <Button
                            title="Got It"
                            variant="primary"
                            onPress={() => setActiveInfo(null)}
                            style={{ marginTop: spacing.lg }}
                        />
                    </Pressable>
                </Pressable>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: {
        paddingBottom: spacing.md,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    listContent: { padding: spacing.xl },

    // Dues Alert Banner
    duesAlertCard: {
        backgroundColor: '#FEF2F2',
        borderWidth: 1.5,
        borderColor: '#FCA5A5',
        borderRadius: radii.xl,
        padding: spacing.md,
        marginBottom: spacing.md,
    },
    duesAlertHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginBottom: 4,
    },
    duesAlertTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#DC2626',
    },
    duesAlertText: {
        ...typography.caption,
        color: '#991B1B',
        lineHeight: 18,
    },

    // Completed jobs
    completedCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        borderRadius: radii.lg,
        marginBottom: spacing.md,
    },
    completedLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    completedText: {
        ...typography.bodySemibold,
        color: '#065F46',
        fontSize: 13,
    },

    // Available card
    availableCard: {
        backgroundColor: colors.primaryLight,
        borderRadius: radii.xl,
        padding: spacing.xl,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.primary + '30',
    },
    availableHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    labelWithInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    availableLabel: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
        fontWeight: '600',
    },
    availableAmount: {
        ...typography.h1,
        color: colors.primaryDark,
        fontSize: 32,
        marginBottom: spacing.md,
    },
    withdrawBtn: { width: '100%' },
    holdBannerBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#FEF3C7',
        borderRadius: radii.md,
        paddingVertical: spacing.xs + 2,
        paddingHorizontal: spacing.sm,
        marginTop: spacing.sm,
    },
    holdBannerText: {
        ...typography.caption,
        color: '#92400E',
        fontSize: 11,
        fontWeight: '600',
        flex: 1,
    },

    // Summary row
    summaryRow: {
        flexDirection: 'row',
        gap: spacing.md,
        marginBottom: spacing.xl,
    },
    summaryCard: {
        flex: 1,
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'flex-start',
    },
    summaryCardTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: spacing.xs,
    },
    summaryAmount: {
        ...typography.h3,
        color: colors.textPrimary,
        fontSize: 20,
        fontWeight: '800',
    },
    summaryLabel: {
        ...typography.caption,
        color: colors.textSecondary,
        fontWeight: '600',
        marginTop: 2,
    },
    fastTrackPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#ECFDF5',
        borderRadius: radii.full,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 6,
    },
    fastTrackText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#047857',
    },

    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    txnItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.md,
        marginBottom: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    txnIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: spacing.md,
    },
    txnContent: { flex: 1 },
    txnDesc: { ...typography.bodyMedium, color: colors.textPrimary },
    txnDate: { ...typography.small, color: colors.textDisabled, marginTop: 1 },
    txnAmount: { ...typography.bodyMedium, fontWeight: '700' },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.lg,
    },
    modalContent: {
        width: '100%',
        maxWidth: 380,
        backgroundColor: colors.surface,
        borderRadius: radii.2xl,
        padding: spacing.xl,
        ...shadows.lg,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.sm,
    },
    modalTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    modalBadge: {
        alignSelf: 'flex-start',
        backgroundColor: '#ECFDF5',
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radii.full,
        marginTop: 4,
    },
    modalBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#047857',
        textTransform: 'uppercase',
    },
    modalCloseBtn: {
        padding: spacing.xs,
    },
    modalDesc: {
        ...typography.body,
        color: colors.textSecondary,
        fontSize: 13,
        lineHeight: 20,
        marginBottom: spacing.md,
    },
    highlightsBox: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        padding: spacing.md,
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: colors.border,
    },
    highlightRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
    },
    highlightText: {
        ...typography.caption,
        color: colors.textPrimary,
        fontSize: 12,
        lineHeight: 18,
        flex: 1,
    },
});
