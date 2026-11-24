/**
 * Shop tab: search, categories, and the catalogue — UniteFix's own products
 * and partners' listings. Cards show price, discount, rating, who sells it
 * and whether it is in stock; tapping opens the product.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, RefreshControl, ActivityIndicator, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Search, Package, X, ArrowUpDown } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { EmptyState } from '../../components/ui';
import { useStoreCategories, useStoreProducts } from '../../hooks/useShopData';
import type { ProductCard } from '../../api/shop.api';
import { CartButton, PriceRow, ProductImage, Stars } from './parts';

const SORTS = [
    { key: 'relevance', label: 'Recommended' },
    { key: 'new', label: 'Newest' },
    { key: 'price_asc', label: 'Price: low to high' },
    { key: 'price_desc', label: 'Price: high to low' },
    { key: 'rating', label: 'Top rated' },
] as const;

export function ShopScreen() {
    const navigation = useNavigation<any>();
    const { headerTop, tabContent } = useScreenInsets();
    const [input, setInput] = useState('');
    const [search, setSearch] = useState('');
    const [categoryId, setCategoryId] = useState<number | undefined>();
    const [sortIdx, setSortIdx] = useState(0);

    // Search as they type, once they pause.
    useEffect(() => { const t = setTimeout(() => setSearch(input.trim()), 350); return () => clearTimeout(t); }, [input]);

    const cats = useStoreCategories();
    const q = useMemo(() => ({ search: search || undefined, categoryId, sort: SORTS[sortIdx].key }), [search, categoryId, sortIdx]);
    const list = useStoreProducts(q);
    const items = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data]);

    const open = (p: ProductCard) => navigation.navigate('ProductDetail', { id: p.id });

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <View style={styles.titleRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.title} accessibilityRole="header">Shop</Text>
                        <Text style={styles.subtitle}>Computers, spices, dry fruits and home-made food</Text>
                    </View>
                    <TouchableOpacity onPress={() => navigation.navigate('ShopOrders')} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="My orders" hitSlop={6}>
                        <Package size={20} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <CartButton onPress={() => navigation.navigate('Cart')} />
                </View>
                <View style={styles.searchBox}>
                    <Search size={18} color={colors.textTertiary} />
                    <TextInput
                        value={input} onChangeText={setInput} placeholder="Search products" placeholderTextColor={colors.textTertiary}
                        style={styles.searchInput} returnKeyType="search" onSubmitEditing={() => setSearch(input.trim())} accessibilityLabel="Search products"
                    />
                    {!!input && <TouchableOpacity onPress={() => setInput('')} accessibilityLabel="Clear search" hitSlop={8}><X size={18} color={colors.textTertiary} /></TouchableOpacity>}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                    <Chip label="All" active={!categoryId} onPress={() => setCategoryId(undefined)} />
                    {(cats.data ?? []).map(c => <Chip key={c.id} label={c.name} active={categoryId === c.id} onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)} />)}
                </ScrollView>
                <TouchableOpacity style={styles.sort} onPress={() => setSortIdx((sortIdx + 1) % SORTS.length)} accessibilityRole="button" accessibilityLabel={`Sort: ${SORTS[sortIdx].label}. Tap to change.`}>
                    <ArrowUpDown size={14} color={colors.textSecondary} />
                    <Text style={styles.sortText}>{SORTS[sortIdx].label}</Text>
                    {list.data?.pages[0] && <Text style={styles.count}> · {list.data.pages[0].total} item{list.data.pages[0].total === 1 ? '' : 's'}</Text>}
                </TouchableOpacity>
            </View>

            <FlatList
                data={items}
                keyExtractor={p => String(p.id)}
                numColumns={2}
                columnWrapperStyle={{ gap: spacing.md }}
                contentContainerStyle={{ padding: spacing.base, gap: spacing.md, paddingBottom: tabContent }}
                renderItem={({ item }) => <Card p={item} onPress={() => open(item)} />}
                onEndReachedThreshold={0.4}
                onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }}
                refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => { list.refetch(); cats.refetch(); }} tintColor={colors.primary} />}
                ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
                ListEmptyComponent={list.isLoading
                    ? <ActivityIndicator style={{ marginTop: spacing['3xl'] }} color={colors.primary} />
                    : list.isError
                        ? <EmptyState title="Could not load the shop" description="Check your connection and pull down to try again." actionLabel="Try again" onAction={() => list.refetch()} />
                        : <EmptyState title={search ? 'Nothing matches' : 'Nothing here yet'} description={search ? `No products match "${search}". Try another word or category.` : 'New products are on their way. Check back soon.'} />}
            />
        </View>
    );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
        </TouchableOpacity>
    );
}

function Card({ p, onPress }: { p: ProductCard; onPress: () => void }) {
    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.price} rupees${p.inStock ? '' : ', out of stock'}`}>
            <View>
                <ProductImage uri={p.image} style={styles.cardImg} />
                {!p.inStock && <View style={styles.soldOut}><Text style={styles.soldOutText}>Out of stock</Text></View>}
                {p.inStock && p.lowStock && <View style={styles.low}><Text style={styles.lowText}>Few left</Text></View>}
            </View>
            <View style={styles.cardBody}>
                <Text style={styles.cardName} numberOfLines={2}>{p.name}</Text>
                {p.rating != null && (
                    <View style={styles.ratingRow}><Stars value={p.rating} size={11} /><Text style={styles.ratingCount}>({p.ratingCount})</Text></View>
                )}
                <PriceRow price={p.price} mrp={p.mrp} size="sm" />
                {p.hasOptions && <Text style={styles.meta}>More options</Text>}
                <Text style={styles.meta} numberOfLines={1}>Sold by {p.seller}</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    header: { backgroundColor: colors.background, paddingHorizontal: spacing.base, paddingBottom: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    title: { ...typography.h2, color: colors.textPrimary },
    subtitle: { ...typography.caption, color: colors.textSecondary },
    iconBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.md, height: 44, borderWidth: 1, borderColor: colors.border },
    searchInput: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: 0 },
    chips: { gap: spacing.sm, paddingRight: spacing.base },
    chip: { paddingHorizontal: spacing.md, height: 32, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', backgroundColor: colors.background },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.captionMedium, color: colors.textSecondary },
    chipTextActive: { color: colors.textInverse },
    sort: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
    sortText: { ...typography.captionMedium, color: colors.textSecondary },
    count: { ...typography.caption, color: colors.textTertiary },
    card: { flex: 1, maxWidth: '50%', backgroundColor: colors.background, borderRadius: radii.lg, overflow: 'hidden', ...shadows.xs, borderWidth: 1, borderColor: colors.divider },
    cardImg: { width: '100%', aspectRatio: 1, borderRadius: 0 },
    cardBody: { padding: spacing.md, gap: 4 },
    cardName: { ...typography.bodyMedium, color: colors.textPrimary, minHeight: 40 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingCount: { ...typography.small, color: colors.textTertiary },
    meta: { ...typography.small, color: colors.textTertiary },
    soldOut: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay, paddingVertical: 4, alignItems: 'center' },
    soldOutText: { ...typography.captionMedium, color: colors.textInverse },
    low: { position: 'absolute', left: spacing.sm, top: spacing.sm, backgroundColor: colors.warningLight, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 2 },
    lowText: { ...typography.small, color: colors.warningDark, fontWeight: '600' },
});
