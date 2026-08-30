/**
 * Recharge history.
 *
 * `created` recharges (an order raised but never paid) are filtered out
 * server-side — showing a customer a recharge they abandoned at the payment
 * sheet reads as a charge they don't recognise.
 */

import React from 'react';
import {
    View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react-native';
import { ftthApi, FtthRechargeHistoryItem } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui';
import { useScreenInsets } from '../../theme/layout';

type Props = NativeStackScreenProps<any, 'FTTHHistory'>;

const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const STATUS_COLOR: Record<string, string> = {
    success: colors.accentDark,
    pending: colors.warningDark,
    failed: colors.error,
    refunded: colors.textSecondary,
};

export function FTTHHistoryScreen({ navigation }: Props) {
    const { bottomBar } = useScreenInsets();

    const { data, isLoading, isFetching, refetch } = useQuery({
        queryKey: ['ftth', 'history'],
        queryFn: () => ftthApi.getHistory(),
    });

    const items = data ?? [];

    const renderItem = ({ item }: { item: FtthRechargeHistoryItem }) => (
        <View style={styles.card}>
            <View style={styles.rowBetween}>
                <Text style={styles.title}>{item.planName}</Text>
                <Text style={styles.amount}>₹{item.amount}</Text>
            </View>
            <Text style={styles.meta}>
                {item.operatorName} · {item.speedMbps} Mbps · {item.durationMonths} month
                {item.durationMonths === 1 ? '' : 's'}
            </Text>
            <View style={styles.rowBetween}>
                <Text style={styles.period}>
                    {item.periodEnd ? `Valid till ${fmt(item.periodEnd)}` : fmt(item.createdAt)}
                </Text>
                <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? colors.textSecondary }]}>
                    {item.status}
                </Text>
            </View>
            {item.convenienceFee > 0 && (
                <Text style={styles.fee}>Includes ₹{item.convenienceFee} UniteFix convenience fee</Text>
            )}
        </View>
    );

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Recharge history" onBack={() => navigation.goBack()} />

            {isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(i) => String(i.id)}
                    renderItem={renderItem}
                    contentContainerStyle={[
                        styles.list,
                        { paddingBottom: bottomBar + spacing.xl },
                        items.length === 0 && { flexGrow: 1, justifyContent: 'center' },
                    ]}
                    refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Receipt size={22} color={colors.textSecondary} />
                            <Text style={styles.emptyText}>No recharges yet.</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    list: { padding: spacing.base },
    card: {
        backgroundColor: colors.surfaceElevated, borderRadius: radii.lg,
        padding: spacing.base, marginBottom: spacing.md, ...shadows.xs,
    },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { ...typography.h4, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
    amount: { ...typography.bodySemibold, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.sm },
    period: { ...typography.caption, color: colors.textSecondary },
    status: { ...typography.caption, fontWeight: '700', textTransform: 'capitalize' },
    fee: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.xs },
    empty: { alignItems: 'center', gap: spacing.sm },
    emptyText: { ...typography.caption, color: colors.textSecondary },
});
