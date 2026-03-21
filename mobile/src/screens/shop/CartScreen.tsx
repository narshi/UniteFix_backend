/**
 * Cart Screen — View cart items, adjust quantities, checkout
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    Image,
    Alert,
    TextInput,
    ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, Trash2, Plus, Minus, ShoppingBag, ShoppingCart, MapPin,
} from 'lucide-react-native';
import { useCart, useRemoveFromCart, useUpdateCartItem, useCheckout } from '../../hooks/useShopData';
import { CartItem } from '../../api/shop.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'Cart'>;

function CartItemCard({
    item, onRemove, onUpdate,
}: {
    item: CartItem;
    onRemove: () => void;
    onUpdate: (qty: number) => void;
}) {
    const product = item.product;

    return (
        <View style={styles.cartItem}>
            <View style={styles.itemImage}>
                {product?.imageUrl ? (
                    <Image source={{ uri: product.imageUrl }} style={styles.imgThumb} resizeMode="cover" />
                ) : (
                    <ShoppingBag size={20} color={colors.textDisabled} />
                )}
            </View>
            <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={2}>{product?.name || `Product #${item.productId}`}</Text>
                <Text style={styles.itemPrice}>₹{product?.price || 0}</Text>
            </View>
            <View style={styles.qtySection}>
                <TouchableOpacity
                    style={styles.qtyBtn}
                    onPress={() => item.quantity > 1 ? onUpdate(item.quantity - 1) : onRemove()}
                >
                    <Minus size={14} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.qtyText}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => onUpdate(item.quantity + 1)}>
                    <Plus size={14} color={colors.textPrimary} />
                </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
                <Trash2 size={16} color={colors.error} />
            </TouchableOpacity>
        </View>
    );
}

export function CartScreen({ navigation }: Props) {
    const { data: cartData, isLoading } = useCart();
    const { mutate: removeItem } = useRemoveFromCart();
    const { mutate: updateItem } = useUpdateCartItem();
    const { mutate: checkout, isPending: checkingOut } = useCheckout();
    const [address, setAddress] = useState('');

    const cartItems: CartItem[] = Array.isArray(cartData) ? cartData : (cartData as any)?.data || [];

    const totalAmount = cartItems.reduce((sum, item) => {
        const price = item.product?.price || 0;
        return sum + price * item.quantity;
    }, 0);

    const handleCheckout = () => {
        if (!address.trim()) {
            Alert.alert('Address Required', 'Enter a delivery address.');
            return;
        }
        checkout({ address });
    };

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>My Cart</Text>
                <Text style={styles.itemCount}>{cartItems.length} items</Text>
            </View>

            <FlatList
                data={cartItems}
                renderItem={({ item }) => (
                    <CartItemCard
                        item={item}
                        onRemove={() => removeItem(item.id)}
                        onUpdate={(qty) => updateItem({ itemId: item.id, quantity: qty })}
                    />
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <ShoppingCart size={48} color={colors.textDisabled} />
                        <Text style={styles.emptyTitle}>Cart is empty</Text>
                        <Text style={styles.emptySubtitle}>Browse the shop to add items</Text>
                        <Button title="Go to Shop" onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
                    </View>
                }
                ListFooterComponent={
                    cartItems.length > 0 ? (
                        <View>
                            {/* Address input */}
                            <View style={styles.addressCard}>
                                <Text style={styles.sectionTitle}>Delivery Address</Text>
                                <View style={styles.addressInput}>
                                    <MapPin size={18} color={colors.textSecondary} />
                                    <TextInput
                                        style={styles.addressField}
                                        placeholder="Enter delivery address"
                                        value={address}
                                        onChangeText={setAddress}
                                        multiline
                                        placeholderTextColor={colors.textDisabled}
                                    />
                                </View>
                            </View>

                            {/* Summary */}
                            <View style={styles.summaryCard}>
                                <Text style={styles.sectionTitle}>Order Summary</Text>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryLabel}>Subtotal ({cartItems.length} items)</Text>
                                    <Text style={styles.summaryValue}>₹{totalAmount}</Text>
                                </View>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryLabel}>Delivery</Text>
                                    <Text style={[styles.summaryValue, { color: colors.success }]}>FREE</Text>
                                </View>
                                <View style={[styles.summaryRow, styles.totalRow]}>
                                    <Text style={styles.totalLabel}>Total</Text>
                                    <Text style={styles.totalValue}>₹{totalAmount}</Text>
                                </View>
                            </View>

                            <Button
                                title={`Checkout — ₹${totalAmount}`}
                                onPress={handleCheckout}
                                loading={checkingOut}
                                style={styles.checkoutBtn}
                            />
                        </View>
                    ) : null
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingBottom: spacing.md, paddingHorizontal: spacing.lg,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md,
    },
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary, flex: 1 },
    itemCount: { ...typography.caption, color: colors.textSecondary },
    listContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    cartItem: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.md, marginBottom: spacing.sm, ...shadows.sm,
    },
    itemImage: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginRight: spacing.md },
    imgThumb: { width: '100%', height: '100%' },
    itemInfo: { flex: 1 },
    itemName: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
    itemPrice: { ...typography.bodyMedium, color: colors.primary, marginTop: 2 },
    qtySection: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginRight: spacing.md },
    qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    qtyText: { ...typography.bodyMedium, color: colors.textPrimary, minWidth: 20, textAlign: 'center' },
    removeBtn: { padding: spacing.sm },
    addressCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg, ...shadows.sm },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    addressInput: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
    addressField: { flex: 1, ...typography.body, color: colors.textPrimary, minHeight: 50 },
    summaryCard: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.md, ...shadows.sm },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
    summaryLabel: { ...typography.body, color: colors.textSecondary },
    summaryValue: { ...typography.bodyMedium, color: colors.textPrimary },
    totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary },
    totalValue: { ...typography.h3, color: colors.primary },
    checkoutBtn: { marginTop: spacing.xl },
    emptyContainer: { alignItems: 'center', paddingTop: spacing['4xl'] },
    emptyTitle: { ...typography.h4, color: colors.textSecondary, marginTop: spacing.lg },
    emptySubtitle: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm },
});
