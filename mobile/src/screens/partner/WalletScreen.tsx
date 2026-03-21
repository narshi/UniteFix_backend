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
} from 'react-native';
import { Wallet, TrendingUp, ArrowDownLeft, ArrowUpRight, DollarSign } from 'lucide-react-native';
import { useWallet } from '../../hooks/usePartnerData';
import { WalletTransaction } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

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
    const { data: wallet, isLoading, refetch, isRefetching, isError } = useWallet();

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Payments</Text>
            </View>

            <FlatList
                data={wallet?.recentTransactions || []}
                renderItem={({ item }) => <TransactionItem item={item} />}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                ListHeaderComponent={
                    <View>
                        {/* Summary cards */}
                        <View style={styles.summaryRow}>
                            <View style={[styles.summaryCard, { backgroundColor: colors.primary }]}>
                                <Wallet size={24} color="#fff" />
                                <Text style={styles.summaryAmount}>₹{wallet?.totalEarnings || 0}</Text>
                                <Text style={styles.summaryLabel}>Total Earnings</Text>
                            </View>
                            <View style={[styles.summaryCard, { backgroundColor: colors.warning }]}>
                                <TrendingUp size={24} color="#fff" />
                                <Text style={styles.summaryAmount}>₹{wallet?.pendingPayments || 0}</Text>
                                <Text style={styles.summaryLabel}>Pending</Text>
                            </View>
                        </View>

                        <View style={styles.completedCard}>
                            <DollarSign size={20} color={colors.success} />
                            <Text style={styles.completedText}>
                                {wallet?.completedJobs || 0} jobs completed
                            </Text>
                        </View>

                        <Text style={styles.sectionTitle}>Recent Transactions</Text>
                    </View>
                }
                ListEmptyComponent={
                    isError ? (
                        <View style={styles.emptyContainer}>
                            <Wallet size={48} color={colors.textDisabled} />
                            <Text style={styles.emptyTitle}>Wallet unavailable</Text>
                            <Text style={styles.emptySubtitle}>Pull to refresh</Text>
                        </View>
                    ) : (
                        <View style={styles.emptyContainer}>
                            <Wallet size={48} color={colors.textDisabled} />
                            <Text style={styles.emptyTitle}>No transactions yet</Text>
                            <Text style={styles.emptySubtitle}>Complete services to see your earnings</Text>
                        </View>
                    )
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: {
        paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    listContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    summaryCard: {
        flex: 1, borderRadius: radii.lg, padding: spacing.lg,
        alignItems: 'flex-start', gap: spacing.sm,
    },
    summaryAmount: { ...typography.h3, color: '#fff' },
    summaryLabel: { ...typography.small, color: 'rgba(255,255,255,0.8)' },
    completedCard: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        backgroundColor: colors.successLight, padding: spacing.md,
        borderRadius: radii.md, marginBottom: spacing.xl,
    },
    completedText: { ...typography.bodyMedium, color: colors.success },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    txnItem: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
    },
    txnIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md },
    txnContent: { flex: 1 },
    txnDesc: { ...typography.bodyMedium, color: colors.textPrimary },
    txnDate: { ...typography.small, color: colors.textDisabled, marginTop: 1 },
    txnAmount: { ...typography.bodyMedium, fontWeight: '700' },
    emptyContainer: { alignItems: 'center', paddingTop: spacing['2xl'] },
    emptyTitle: { ...typography.h4, color: colors.textSecondary, marginTop: spacing.lg },
    emptySubtitle: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm },
});
