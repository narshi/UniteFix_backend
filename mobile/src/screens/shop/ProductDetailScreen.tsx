/**
 * Product Detail Screen — Image, price, description, add to cart
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, ShoppingCart, ShoppingBag, Star, Package } from 'lucide-react-native';
import { useAddToCart } from '../../hooks/useShopData';
import { Product } from '../../api/shop.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'ProductDetail'>;

export function ProductDetailScreen({ navigation, route }: Props) {
    const product: Product = route.params?.product;
    const { mutate: addToCart, isPending } = useAddToCart();

    if (!product) { navigation.goBack(); return null; }

    const discount = product.mrp && product.mrp > product.price
        ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
        : null;

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Product</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Cart')} style={styles.backBtn}>
                    <ShoppingCart size={22} color={colors.textPrimary} />
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Image */}
                <View style={styles.imageContainer}>
                    {product.imageUrl ? (
                        <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="contain" />
                    ) : (
                        <View style={styles.placeholderImage}>
                            <ShoppingBag size={56} color={colors.textDisabled} />
                        </View>
                    )}
                    {discount && (
                        <View style={styles.discountBadge}>
                            <Text style={styles.discountText}>{discount}% OFF</Text>
                        </View>
                    )}
                </View>

                {/* Info */}
                <View style={styles.infoSection}>
                    <Text style={styles.category}>{product.category}</Text>
                    <Text style={styles.name}>{product.name}</Text>

                    <View style={styles.priceSection}>
                        <Text style={styles.price}>₹{product.price}</Text>
                        {product.mrp && product.mrp > product.price && (
                            <Text style={styles.mrp}>₹{product.mrp}</Text>
                        )}
                        {discount && (
                            <View style={styles.saveBadge}>
                                <Text style={styles.saveText}>Save ₹{product.mrp! - product.price}</Text>
                            </View>
                        )}
                    </View>

                    {/* Stock */}
                    <View style={[styles.stockBadge, { backgroundColor: product.stock > 0 ? colors.successLight : colors.errorLight }]}>
                        <Package size={14} color={product.stock > 0 ? colors.success : colors.error} />
                        <Text style={[styles.stockText, { color: product.stock > 0 ? colors.success : colors.error }]}>
                            {product.stock > 0 ? `${product.stock} in stock` : 'Out of Stock'}
                        </Text>
                    </View>

                    {/* Description */}
                    <View style={styles.descSection}>
                        <Text style={styles.descTitle}>Description</Text>
                        <Text style={styles.descText}>{product.description || 'No description available.'}</Text>
                    </View>
                </View>
            </ScrollView>

            {/* Bottom bar */}
            <View style={styles.bottomBar}>
                <View style={styles.bottomPrice}>
                    <Text style={styles.bottomPriceLabel}>Price</Text>
                    <Text style={styles.bottomPriceValue}>₹{product.price}</Text>
                </View>
                <Button
                    title="Add to Cart"
                    onPress={() => addToCart({ productId: product.id })}
                    loading={isPending}
                    disabled={product.stock <= 0}
                    style={styles.addBtn}
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { paddingBottom: 100 },
    imageContainer: { height: 300, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', position: 'relative' },
    image: { width: '100%', height: '100%' },
    placeholderImage: { justifyContent: 'center', alignItems: 'center' },
    discountBadge: {
        position: 'absolute', top: spacing.lg, left: spacing.lg,
        backgroundColor: colors.error, paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
        borderRadius: radii.md,
    },
    discountText: { fontSize: 13, fontWeight: '700', color: '#fff' },
    infoSection: { padding: spacing.xl },
    category: { ...typography.small, color: colors.primary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
    name: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
    priceSection: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
    price: { fontSize: 28, fontWeight: '800', color: colors.primary },
    mrp: { fontSize: 18, color: colors.textDisabled, textDecorationLine: 'line-through' },
    saveBadge: { backgroundColor: colors.successLight, paddingVertical: 3, paddingHorizontal: spacing.sm, borderRadius: radii.sm },
    saveText: { ...typography.small, color: colors.success, fontWeight: '700' },
    stockBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, alignSelf: 'flex-start', marginBottom: spacing.xl },
    stockText: { ...typography.caption, fontWeight: '600' },
    descSection: { marginTop: spacing.sm },
    descTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.sm },
    descText: { ...typography.body, color: colors.textSecondary, lineHeight: 22 },
    bottomBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.background, paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl, paddingBottom: spacing.xl,
        borderTopWidth: 1, borderTopColor: colors.divider, ...shadows.md,
    },
    bottomPrice: {},
    bottomPriceLabel: { ...typography.small, color: colors.textSecondary },
    bottomPriceValue: { ...typography.h3, color: colors.textPrimary },
    addBtn: { flex: 0.6 },
});
