/**
 * Shop / Products Catalog Screen — Browse products with category filter
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    Image,
    RefreshControl,
    ActivityIndicator,
    Dimensions,
    TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ShoppingBag, Search, ShoppingCart } from 'lucide-react-native';
import { useProducts, useCart } from '../../hooks/useShopData';
import { Product } from '../../api/shop.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ProductGridSkeleton } from '../../components/Skeleton';

const { width } = Dimensions.get('window');
const CARD_W = (width - spacing.xl * 2 - spacing.md) / 2;

const CATEGORIES = ['All', 'Electrical', 'Plumbing', 'Tools', 'Safety', 'Cleaning', 'Hardware'];

function ProductCard({ item, onPress }: { item: Product; onPress: () => void }) {
    const discount = item.mrp && item.mrp > item.price
        ? Math.round(((item.mrp - item.price) / item.mrp) * 100)
        : null;

    return (
        <TouchableOpacity style={styles.productCard} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.imageWrap}>
                {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.productImage} resizeMode="cover" />
                ) : (
                    <View style={styles.placeholderImage}>
                        <ShoppingBag size={28} color={colors.textDisabled} />
                    </View>
                )}
                {discount && (
                    <View style={styles.discountBadge}>
                        <Text style={styles.discountText}>{discount}% OFF</Text>
                    </View>
                )}
            </View>
            <View style={styles.productInfo}>
                <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
                <View style={styles.priceRow}>
                    <Text style={styles.price}>₹{item.price}</Text>
                    {item.mrp && item.mrp > item.price && (
                        <Text style={styles.mrp}>₹{item.mrp}</Text>
                    )}
                </View>
                <Text style={[styles.stockText, { color: item.stock > 0 ? colors.success : colors.error }]}>
                    {item.stock > 0 ? 'In Stock' : 'Out of Stock'}
                </Text>
            </View>
        </TouchableOpacity>
    );
}

export function ShopScreen() {
    const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);
    const [searchQuery, setSearchQuery] = useState('');
    const { data: response, isLoading, refetch, isRefetching } = useProducts(1, selectedCategory);
    const { data: cartItems } = useCart();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const allProducts = (response as any)?.data || response || [];
    const products = searchQuery.trim()
        ? (Array.isArray(allProducts) ? allProducts : []).filter((p: Product) =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : allProducts;
    const cartCount = Array.isArray(cartItems) ? cartItems.length : ((cartItems as any)?.data?.length || 0);

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Shop</Text>
                <TouchableOpacity style={styles.cartBtn} onPress={() => navigation.navigate('Cart')}>
                    <ShoppingCart size={22} color={colors.textPrimary} />
                    {cartCount > 0 && (
                        <View style={styles.cartBadge}>
                            <Text style={styles.cartBadgeText}>{cartCount}</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            {/* Search bar */}
            <View style={styles.searchContainer}>
                <Search size={18} color={colors.textDisabled} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search products..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholderTextColor={colors.textDisabled}
                    returnKeyType="search"
                />
            </View>

            {/* Category filter */}
            <FlatList
                data={CATEGORIES}
                renderItem={({ item }) => {
                    const isActive = item === 'All' ? !selectedCategory : selectedCategory === item.toLowerCase();
                    return (
                        <TouchableOpacity
                            style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                            onPress={() => setSelectedCategory(item === 'All' ? undefined : item.toLowerCase())}
                        >
                            <Text style={[styles.categoryText, isActive && styles.categoryTextActive]}>{item}</Text>
                        </TouchableOpacity>
                    );
                }}
                keyExtractor={(item) => item}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryList}
            />

            {/* Products grid */}
            {isLoading ? (
                <ProductGridSkeleton count={6} />
            ) : (
                <FlatList
                    data={Array.isArray(products) ? products : []}
                    renderItem={({ item }) => (
                        <ProductCard
                            item={item}
                            onPress={() => navigation.navigate('ProductDetail', { product: item })}
                        />
                    )}
                    keyExtractor={(item) => item.id.toString()}
                    numColumns={2}
                    columnWrapperStyle={styles.columnWrapper}
                    contentContainerStyle={styles.gridContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                    removeClippedSubviews={true}
                    initialNumToRender={6}
                    maxToRenderPerBatch={10}
                    windowSize={5}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <ShoppingBag size={48} color={colors.textDisabled} />
                            <Text style={styles.emptyTitle}>No products found</Text>
                            <Text style={styles.emptySubtitle}>Try a different category</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingTop: 54, paddingBottom: spacing.md, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    cartBtn: { position: 'relative', padding: spacing.sm },
    searchContainer: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        marginHorizontal: spacing.xl, marginTop: spacing.sm,
        paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
        backgroundColor: colors.background, borderRadius: radii.lg,
        borderWidth: 1, borderColor: colors.border,
    },
    searchInput: { flex: 1, ...typography.body, color: colors.textPrimary, paddingVertical: 4 },
    cartBadge: {
        position: 'absolute', top: 0, right: 0,
        backgroundColor: colors.error, borderRadius: 10, minWidth: 18, height: 18,
        justifyContent: 'center', alignItems: 'center',
    },
    cartBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff' },
    categoryList: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
    categoryChip: {
        paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
        borderRadius: radii.full, backgroundColor: colors.background,
        borderWidth: 1, borderColor: colors.border,
    },
    categoryChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    categoryText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
    categoryTextActive: { color: colors.textInverse },
    gridContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    columnWrapper: { justifyContent: 'space-between' },
    productCard: {
        width: CARD_W, backgroundColor: colors.background, borderRadius: radii.lg,
        marginBottom: spacing.md, ...shadows.sm, overflow: 'hidden',
    },
    imageWrap: { height: CARD_W * 0.85, backgroundColor: colors.surface, position: 'relative' },
    productImage: { width: '100%', height: '100%' },
    placeholderImage: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
    discountBadge: {
        position: 'absolute', top: spacing.sm, left: spacing.sm,
        backgroundColor: colors.error, paddingVertical: 2, paddingHorizontal: spacing.sm,
        borderRadius: radii.sm,
    },
    discountText: { fontSize: 10, fontWeight: '700', color: '#fff' },
    productInfo: { padding: spacing.md },
    productName: { ...typography.caption, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
    priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
    price: { ...typography.bodyMedium, color: colors.primary, fontWeight: '700' },
    mrp: { ...typography.small, color: colors.textDisabled, textDecorationLine: 'line-through' },
    stockText: { ...typography.small, fontWeight: '600' },
    emptyContainer: { alignItems: 'center', paddingTop: spacing['4xl'] },
    emptyTitle: { ...typography.h4, color: colors.textSecondary, marginTop: spacing.lg },
    emptySubtitle: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm },
});
