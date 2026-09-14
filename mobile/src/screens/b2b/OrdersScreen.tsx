/**
 * Orders — every trade order this partner has placed, newest first, with
 * where each one is. The status pill is the tracking stage the server
 * derives, so the list and the detail page never disagree.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, PackageSearch } from 'lucide-react-native';
import { b2bApi, type OrderSummary } from '../../api/b2b.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { EmptyState } from '../../components/ui';

type Filter = 'open' | 'all';

export function orderStatusTone(o: OrderSummary): { label: string; color: string; bg: string } {
    if (o.tracking.terminal) return { label: o.tracking.terminalLabel ?? o.status, color: colors.textSecondary, bg: colors.surface };
    if (o.paymentMode === 'prepaid' && o.paymentStatus !== 'paid' && o.status === 'placed') return { label: 'Awaiting payment', color: colors.warningDark, bg: colors.warningLight };
    if (o.status === 'delivered') return { label: 'Delivered', color: colors.successDark, bg: colors.successLight };
    const current = o.tracking.steps.find(s => s.current);
    return { label: current?.label ?? o.status, color: colors.primary, bg: colors.primaryLight + '55' };
}

export function OrdersScreen() {
    const navigation = useNavigation<any>();
    const { headerTop, tabContent } = useScreenInsets();
    const [filter, setFilter] = useState<Filter>('open');

    const { data, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['b2b-orders'],
        queryFn: async () => (await b2bApi.orders()).data.data,
    });

    const rows = (data ?? []).filter(o => filter === 'all' || (!o.tracking.terminal && o.status !== 'delivered'));

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.title}>Orders</Text>
                <View style={styles.filters}>
                    {(['open', 'all'] as Filter[]).map(f => (
                        <TouchableOpacity key={f} style={[styles.filter, filter === f && styles.filterOn]} onPress={() => setFilter(f)}>
                            <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>{f === 'open' ? 'In progress' : 'All'}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={o => String(o.id)}
                    contentContainerStyle={[styles.list, { paddingBottom: tabContent }]}
                    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} tintColor={colors.primary} />}
                    renderItem={({ item }) => {
                        const tone = orderStatusTone(item);
                        return (
                            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('OrderDetail', { id: item.id })} activeOpacity={0.7}>
                                <View style={{ flex: 1 }}>
                                    <View style={styles.cardTop}>
                                        <Text style={styles.code}>{item.orderCode}</Text>
                                        <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.color }]}>{tone.label}</Text></View>
                                    </View>
                                    <Text style={styles.meta}>
                                        {new Date(item.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {item.paymentMode === 'credit' ? 'On credit' : 'Prepaid'}
                                    </Text>
                                    <Text style={styles.total}>₹{item.total}</Text>
                                </View>
                                <ChevronRight size={18} color={colors.textDisabled} />
                            </TouchableOpacity>
                        );
                    }}
                    ListEmptyComponent={
                        <EmptyState
                            icon={<PackageSearch size={40} color={colors.textDisabled} />}
                            title={filter === 'open' ? 'Nothing in progress' : 'No orders yet'}
                            description={filter === 'open' ? 'Delivered and closed orders are under "All".' : 'Orders you place from the catalogue show up here with their tracking.'}
                            actionLabel="Browse catalogue"
                            onAction={() => navigation.navigate('CatalogueTab')}
                        />
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
    title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
    filters: { flexDirection: 'row', gap: spacing.sm },
    filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    filterOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight + '55' },
    filterText: { ...typography.captionMedium, color: colors.textSecondary },
    filterTextOn: { color: colors.primary },
    list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
    card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    code: { ...typography.bodySemibold, color: colors.textPrimary },
    pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full },
    pillText: { fontSize: 11, fontWeight: '600' },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    total: { ...typography.bodyMedium, color: colors.textPrimary, marginTop: spacing.xs },
});
