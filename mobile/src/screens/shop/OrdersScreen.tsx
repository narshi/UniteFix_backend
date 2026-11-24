/**
 * My orders: everything bought in the Shop, newest first, in two tabs —
 * on the way, and delivered or closed. Each row opens the order.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Package } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { ScreenHeader, EmptyState } from '../../components/ui';
import { useStoreOrders } from '../../hooks/useShopData';
import type { StoreOrder } from '../../api/shop.api';
import { ProductImage, rupees } from './parts';

type Props = NativeStackScreenProps<any, 'ShopOrders'>;

export const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
    placed: { bg: colors.infoLight, fg: colors.info }, confirmed: { bg: colors.infoLight, fg: colors.info }, packed: { bg: colors.infoLight, fg: colors.info },
    dispatched: { bg: colors.primarySurface, fg: colors.primary }, delivered: { bg: colors.successLight, fg: colors.successDark },
    cancelled: { bg: colors.errorLight, fg: colors.errorDark }, returned: { bg: colors.warningLight, fg: colors.warningDark },
};

export function OrdersScreen({ navigation }: Props) {
    const { scrollBottom } = useScreenInsets();
    const [tab, setTab] = useState<'open' | 'done'>('open');
    const q = useStoreOrders(tab);
    const items = useMemo(() => q.data?.pages.flatMap(p => p.items) ?? [], [q.data]);

    return (
        <View style={styles.screen}>
            <ScreenHeader title="My orders" onBack={() => navigation.goBack()} />
            <View style={styles.tabs}>
                {(['open', 'done'] as const).map(t => (
                    <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
                        <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'open' ? 'On the way' : 'Delivered & closed'}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <FlatList
                data={items}
                keyExtractor={o => String(o.id)}
                contentContainerStyle={{ padding: spacing.base, gap: spacing.md, paddingBottom: scrollBottom }}
                renderItem={({ item }) => <Row o={item} onPress={() => navigation.navigate('OrderDetail', { id: item.id })} />}
                onEndReachedThreshold={0.4}
                onEndReached={() => { if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage(); }}
                refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => q.refetch()} tintColor={colors.primary} />}
                ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
                ListEmptyComponent={q.isLoading ? <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
                    : <EmptyState icon={<Package size={40} color={colors.textDisabled} />} title={tab === 'open' ? 'No orders on the way' : 'No past orders'} description="Orders from the Shop appear here." actionLabel="Go to the Shop" onAction={() => navigation.navigate('CustomerTabs', { screen: 'ShopTab' })} />}
            />
        </View>
    );
}

function Row({ o, onPress }: { o: StoreOrder; onPress: () => void }) {
    const tone = STATUS_TONE[o.status] ?? STATUS_TONE.placed;
    const first = o.items[0];
    return (
        <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`Order ${o.code}, ${o.statusLabel}`}>
            <ProductImage uri={first?.image ?? null} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{first?.name}{o.items.length > 1 ? ` and ${o.items.length - 1} more` : ''}</Text>
                <Text style={styles.meta}>{o.code} · {new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                <Text style={styles.meta}>{rupees(o.total)} · {o.seller}</Text>
            </View>
            <View style={[styles.pill, { backgroundColor: tone.bg }]}><Text style={[styles.pillText, { color: tone.fg }]}>{o.return.status === 'requested' ? 'Return asked' : o.statusLabel}</Text></View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    tabs: { flexDirection: 'row', marginHorizontal: spacing.base, marginTop: spacing.sm, backgroundColor: colors.divider, borderRadius: radii.full, padding: 4 },
    tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radii.full, alignItems: 'center' },
    tabOn: { backgroundColor: colors.background },
    tabText: { ...typography.captionMedium, color: colors.textSecondary },
    tabTextOn: { color: colors.textPrimary },
    row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.divider },
    name: { ...typography.bodyMedium, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary },
    pill: { borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    pillText: { ...typography.small, fontWeight: '600' },
});
