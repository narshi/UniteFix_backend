/**
 * Wallet / Payments Screen — Earnings summary + transaction history
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    RefreshControl,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { Wallet, TrendingUp, ArrowDownLeft, ArrowUpRight, Briefcase } from 'lucide-react-native';
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

    // Admin-configurable minimum withdrawal (BUSINESS_CONFIG.MIN_WALLET_REDEMPTION).
    // Fall back to 500 while the config request is in flight or unavailable.
    const minRedemption = publicConfig?.minWalletRedemption ?? 500;

    if (isLoading || isPartnerLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    const handleWithdraw = () => {
        if (!(partnerProfile as any)?.upiId && !(partnerProfile as any)?.data?.upiId) {
            Alert.alert(
                'UPI ID Required',
                'Please set up your UPI ID in your Profile before requesting a withdrawal.',
                [{ text: 'OK' }]
            );
            return;
        }

        const available = wallet?.availableBalance || 0;
        const held = wallet?.pendingPayments || 0;

        // "Insufficient Balance" is a lie when the money exists but is held, and
        // it was being shown to partners looking at hundreds of rupees of their
        // own earnings on the same screen. Name the real reason and the date.
        if (available < minRedemption && held > 0) {
            Alert.alert(
                'Your earnings are still on hold',
                `₹${held} from your recent jobs isn't available to withdraw yet.`
                + (wallet?.nextReleaseDate
                    ? `\n\nIt becomes available on ${formatReleaseDate(wallet.nextReleaseDate)}.`
                    : '')
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
            `Request a payout of ₹${available} to your linked UPI?\n\nThe amount is held from your balance now and paid out to your UPI once our team approves the request (usually within 24 hours).`,
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
                <Text style={styles.headerTitle}>Payments</Text>
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
                        {/* Summary cards */}
                        <View style={styles.availableCard}>
                            <View style={styles.availableHeader}>
                                <Text style={styles.availableLabel}>Available Balance</Text>
                                <Wallet size={20} color={colors.primary} />
                            </View>
                            <Text style={styles.availableAmount}>₹{wallet?.availableBalance || 0}</Text>
                            <Button
                                title="Withdraw to UPI"
                                onPress={handleWithdraw}
                                variant="primary"
                                loading={withdrawMutation.isPending}
                                style={styles.withdrawBtn}
                            />

                            {/* Shown BEFORE they tap, not as an error afterwards.
                                A partner with everything on hold was seeing a live
                                Withdraw button, a wallet full of money, and then
                                "Insufficient Balance" — with nothing connecting
                                the three. */}
                            {(wallet?.pendingPayments || 0) > 0
                                && (wallet?.availableBalance || 0) < minRedemption && (
                                <Text style={styles.holdBanner}>
                                    ₹{wallet?.pendingPayments} from recent jobs is still on hold
                                    {wallet?.nextReleaseDate
                                        ? ` — you can withdraw it from ${formatReleaseDate(wallet.nextReleaseDate)}.`
                                        : ' and isn\'t withdrawable yet.'}
                                </Text>
                            )}
                        </View>

                        <View style={styles.summaryRow}>
                            <View style={[styles.summaryCard, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
                                <TrendingUp size={24} color={colors.success} />
                                <Text style={[styles.summaryAmount, { color: colors.textPrimary }]}>₹{wallet?.totalEarnings || 0}</Text>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Total Earned</Text>
                            </View>
                            <View style={[styles.summaryCard, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
                                <Wallet size={24} color={colors.warning} />
                                <Text style={[styles.summaryAmount, { color: colors.textPrimary }]}>₹{wallet?.pendingPayments || 0}</Text>
                                <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>On Hold</Text>
                                {/* The number alone told a partner nothing — they read
                                    it as money they could take out. Say when it frees up. */}
                                {(wallet?.pendingPayments || 0) > 0 && (
                                    <Text style={styles.holdNote}>
                                        {wallet?.nextReleaseDate
                                            ? `Free on ${formatReleaseDate(wallet.nextReleaseDate)}`
                                            : 'Not withdrawable yet'}
                                    </Text>
                                )}
                            </View>
                        </View>

                        <View style={styles.completedCard}>
                            <Briefcase size={20} color={colors.success} />
                            <Text style={styles.completedText}>
                                {wallet?.completedJobs || 0} jobs completed
                            </Text>
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: { paddingBottom: spacing.lg, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    listContent: { padding: spacing.xl },
    availableCard: {
        backgroundColor: colors.primaryLight, borderRadius: radii.xl, padding: spacing.xl,
        marginBottom: spacing.md, borderWidth: 1, borderColor: colors.primary + '30',
    },
    availableHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    availableLabel: { ...typography.bodyMedium, color: colors.textSecondary },
    availableAmount: { ...typography.h1, color: colors.primaryDark, marginBottom: spacing.lg },
    withdrawBtn: { width: '100%' },
    summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
    summaryCard: {
        flex: 1, borderRadius: radii.xl, padding: spacing.lg,
        alignItems: 'flex-start', gap: spacing.sm,
    },
    summaryAmount: { ...typography.h3, color: '#fff' },
    summaryLabel: { ...typography.small, color: 'rgba(255,255,255,0.8)' },
    holdNote: {
        ...typography.small,
        color: colors.warningDark,
        marginTop: 2,
        textAlign: 'center',
    },
    holdBanner: {
        ...typography.caption,
        color: colors.warningDark,
        backgroundColor: colors.warningLight,
        borderRadius: radii.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        marginTop: spacing.md,
        textAlign: 'center',
    },
    completedCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.successLight, padding: spacing.md,
        borderRadius: radii.lg, marginBottom: spacing.xl,
    },
    completedText: { ...typography.bodyMedium, color: colors.successDark },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    txnItem: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.md, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
    },
    txnIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
    txnContent: { flex: 1 },
    txnDesc: { ...typography.bodyMedium, color: colors.textPrimary },
    txnDate: { ...typography.small, color: colors.textDisabled, marginTop: 1 },
    txnAmount: { ...typography.bodyMedium, fontWeight: '700' },
});
