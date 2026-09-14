/**
 * Catalogue — what UniteFix sells to this business partner, at trade price.
 *
 * A shop owner reordering stock knows what they want; the search box is the
 * primary control and the list is dense on purpose. Adding to the cart is a
 * single tap with a stepper once the line exists, so a twenty-line order
 * does not mean twenty detail screens. Availability is a word, not a count:
 * how much UniteFix holds is UniteFix's business.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Search, ShoppingCart, Plus, Minus, X } from 'lucide-react-native';
import { b2bApi, type CatalogItem, type Availability } from '../../api/b2b.api';
import { useB2bCartStore } from '../../stores/b2bCart.store';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { EmptyState } from '../../components/ui';

const AVAILABILITY: Record<Availability, { label: string; color: string; bg: string }> = {
    in_stock: { label: 'In stock', color: colors.successDark, bg: colors.successLight },
    low: { label: 'Few left', color: colors.warningDark, bg: colors.warningLight },
    backorder: { label: 'Backorder', color: colors.textSecondary, bg: colors.surface },
};

function useDebounced<T>(value: T, ms: number): T {
    const [v, setV] = useState(value);
    React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
    return v;
}

function CatalogueRow({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
    const qty = useB2bCartStore(s => s.entries.find(e => e.sparePartId === item.id)?.quantity ?? 0);
    const add = useB2bCartStore(s => s.add);
    const setQuantity = useB2bCartStore(s => s.setQuantity);
    const av = AVAILABILITY[item.availability] ?? AVAILABILITY.backorder;
    const entry = { sparePartId: item.id, name: item.name, partCode: item.partCode, tradePrice: item.tradePrice, unit: item.unit };

    return (
        <TouchableOpacity style={styles.row} onPress={onOpen} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{item.name}{item.brand ? <Text style={styles.brand}>  {item.brand}</Text> : null}</Text>
                <Text style={styles.meta} numberOfLines={1}>{item.partCode}{item.specification ? ` · ${item.specification}` : ''}</Text>
                <View style={styles.priceLine}>
                    <Text style={styles.price}>₹{item.tradePrice}</Text>
                    <Text style={styles.priceSub}>/{item.unit || 'unit'}{item.gstPercent ? ` + ${item.gstPercent}% GST` : ''}</Text>
                    <View style={[styles.avail, { backgroundColor: av.bg }]}><Text style={[styles.availText, { color: av.color }]}>{av.label}</Text></View>
                </View>
            </View>
            {qty === 0 ? (
                <TouchableOpacity style={styles.addBtn} onPress={() => add(entry, 1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Plus size={18} color={colors.background} />
                </TouchableOpacity>
            ) : (
                <View style={styles.stepper}>
                    <TouchableOpacity onPress={() => setQuantity(item.id, qty - 1)} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6 }}>
                        <Minus size={16} color={colors.primary} />
                    </TouchableOpacity>
                    <Text style={styles.stepQty}>{qty}</Text>
                    <TouchableOpacity onPress={() => add(entry, 1)} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6 }}>
                        <Plus size={16} color={colors.primary} />
                    </TouchableOpacity>
                </View>
            )}
        </TouchableOpacity>
    );
}

export function CatalogueScreen() {
    const navigation = useNavigation<any>();
    const { headerTop, tabContent } = useScreenInsets();
    const user = useAuthStore(s => s.user);
    const [q, setQ] = useState('');
    const dq = useDebounced(q.trim(), 300);
    const cartCount = useB2bCartStore(s => s.entries.reduce((n, e) => n + e.quantity, 0));

    const { data, isLoading, isError, refetch, isRefetching } = useQuery({
        queryKey: ['b2b-catalog', dq],
        queryFn: async () => (await b2bApi.catalog({ q: dq || undefined, limit: 80 })).data.data,
        staleTime: 60_000,
    });

    const items = useMemo(() => data ?? [], [data]);

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <View style={{ flex: 1 }}>
                    <Text style={styles.hello} numberOfLines={1}>{user?.username || 'UniteFix trade'}</Text>
                    <Text style={styles.title}>Order parts</Text>
                </View>
                <TouchableOpacity style={styles.cartBtn} onPress={() => navigation.navigate('Cart')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <ShoppingCart size={22} color={colors.textPrimary} />
                    {cartCount > 0 && <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text></View>}
                </TouchableOpacity>
            </View>

            <View style={styles.searchWrap}>
                <Search size={18} color={colors.textSecondary} />
                <TextInput
                    style={styles.search}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search by name, code or brand"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                />
                {q.length > 0 && (
                    <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <X size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                )}
            </View>

            {isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
            ) : (
                <FlatList
                    data={items}
                    keyExtractor={(it) => String(it.id)}
                    renderItem={({ item }) => <CatalogueRow item={item} onOpen={() => navigation.navigate('PartDetail', { id: item.id })} />}
                    contentContainerStyle={[styles.list, { paddingBottom: tabContent }]}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} tintColor={colors.primary} />}
                    ListEmptyComponent={
                        <EmptyState
                            title={isError ? 'Could not load the catalogue' : dq ? 'Nothing matches' : 'Catalogue is empty'}
                            description={isError ? 'Pull down to try again.' : dq ? 'Try a shorter word, or the part code.' : 'UniteFix has not priced any parts for trade yet.'}
                        />
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: spacing.md },
    hello: { ...typography.caption, color: colors.textSecondary },
    title: { ...typography.h2, color: colors.textPrimary },
    cartBtn: { padding: spacing.xs },
    cartBadge: { position: 'absolute', top: -2, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    cartBadgeText: { color: colors.background, fontSize: 10, fontWeight: '700' },
    searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.md, height: 44, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    search: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: 0 },
    list: { paddingHorizontal: spacing.xl },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
    name: { ...typography.bodyMedium, color: colors.textPrimary },
    brand: { ...typography.caption, color: colors.textSecondary },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    priceLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' },
    price: { ...typography.bodySemibold, color: colors.textPrimary },
    priceSub: { ...typography.caption, color: colors.textSecondary },
    avail: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full, marginLeft: spacing.xs },
    availText: { fontSize: 11, fontWeight: '600' },
    addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, overflow: 'hidden' },
    stepBtn: { paddingHorizontal: spacing.sm, height: 36, alignItems: 'center', justifyContent: 'center' },
    stepQty: { ...typography.bodySemibold, color: colors.textPrimary, minWidth: 28, textAlign: 'center' },
});
