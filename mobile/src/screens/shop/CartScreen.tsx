/**
 * Cart: kept on the server, re-priced every time it is shown. Each line says
 * if its price changed, if stock is short, or if it is no longer sold —
 * checkout opens only when every line can be bought.
 */

import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Trash2, ShoppingCart, AlertCircle } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button, ScreenHeader, EmptyState } from '../../components/ui';
import { useCart, useRemoveCartLine, useSetCartQuantity } from '../../hooks/useShopData';
import { getApiErrorMessage } from '../../api/client';
import type { CartLine } from '../../api/shop.api';
import { ProductImage, QtyStepper, rupees } from './parts';

type Props = NativeStackScreenProps<any, 'Cart'>;

export function CartScreen({ navigation }: Props) {
    const { bottomBar } = useScreenInsets();
    const { data: cart, isLoading, isError, refetch, isRefetching } = useCart();
    const setQty = useSetCartQuantity();
    const remove = useRemoveCartLine();

    const change = (l: CartLine, quantity: number) =>
        setQty.mutate({ lineId: l.id, quantity }, { onError: e => Alert.alert('Could not change it', getApiErrorMessage(e)) });
    const drop = (l: CartLine) =>
        Alert.alert('Remove from cart?', l.name ?? 'This item', [
            { text: 'Keep', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(l.id) },
        ]);

    if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;

    const lines = cart?.lines ?? [];
    const problems = lines.filter(l => l.issue).length;

    return (
        <View style={styles.screen}>
            <ScreenHeader title={`Cart${cart?.count ? ` (${cart.count})` : ''}`} onBack={() => navigation.goBack()} />
            <FlatList
                data={lines}
                keyExtractor={l => String(l.id)}
                contentContainerStyle={{ padding: spacing.base, gap: spacing.md, paddingBottom: 200 }}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
                ListEmptyComponent={isError
                    ? <EmptyState title="Could not load your cart" description="Check your connection and try again." actionLabel="Try again" onAction={() => refetch()} />
                    : <EmptyState icon={<ShoppingCart size={40} color={colors.textDisabled} />} title="Your cart is empty" description="Add products from the Shop and they will wait for you here." actionLabel="Go to the Shop" onAction={() => navigation.navigate('CustomerTabs', { screen: 'ShopTab' })} />}
                ListHeaderComponent={cart && cart.sellers.length > 1 ? (
                    <View style={styles.note}><Text style={styles.noteText}>These items come from {cart.sellers.length} sellers: {cart.sellers.map(s => s.name).join(' and ')}. They arrive as separate parcels, each with its own invoice.</Text></View>
                ) : null}
                renderItem={({ item: l }) => (
                    <View style={[styles.line, !!l.issue && styles.lineBad]}>
                        <TouchableOpacity onPress={() => navigation.navigate('ProductDetail', { id: l.productId })} accessibilityRole="button" accessibilityLabel={`Open ${l.name ?? 'product'}`}>
                            <ProductImage uri={l.image} size={76} />
                        </TouchableOpacity>
                        <View style={{ flex: 1, gap: 4 }}>
                            <Text style={styles.name} numberOfLines={2}>{l.name ?? 'No longer sold'}</Text>
                            {!!l.seller && <Text style={styles.meta}>Sold by {l.seller}</Text>}
                            {l.price != null && (
                                <View style={styles.priceLine}>
                                    <Text style={styles.price}>{rupees(l.price)}</Text>
                                    {l.mrp != null && l.mrp > l.price && <Text style={styles.mrp}>{rupees(l.mrp)}</Text>}
                                </View>
                            )}
                            {l.priceChanged && l.previousPrice != null && (
                                <Text style={styles.changed}>Price {l.price! > l.previousPrice ? 'went up' : 'dropped'} from {rupees(l.previousPrice)}</Text>
                            )}
                            {!!l.issue && <View style={styles.issue}><AlertCircle size={14} color={colors.error} /><Text style={styles.issueText}>{l.issue.message}</Text></View>}
                            <View style={styles.actions}>
                                <QtyStepper value={l.quantity} max={Math.max(l.quantity, Math.min(20, l.available))} onChange={n => change(l, n)} disabled={setQty.isPending || !l.price} />
                                <TouchableOpacity onPress={() => drop(l)} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8}>
                                    <Trash2 size={18} color={colors.textTertiary} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                )}
            />
            {lines.length > 0 && cart && (
                <View style={[styles.bar, { paddingBottom: bottomBar }]}>
                    <View style={styles.totals}>
                        <View>
                            <Text style={styles.totalLabel}>Total (incl. GST {rupees(cart.tax)})</Text>
                            {cart.savings > 0 && <Text style={styles.savings}>You save {rupees(cart.savings)}</Text>}
                        </View>
                        <Text style={styles.total}>{rupees(cart.total)}</Text>
                    </View>
                    {problems > 0 && <Text style={styles.blocker}>Fix {problems === 1 ? 'the item marked in red' : `the ${problems} items marked in red`} to check out.</Text>}
                    <Button title="Proceed to checkout" onPress={() => navigation.navigate('Checkout', { source: 'cart' })} disabled={!cart.canCheckout} />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    note: { backgroundColor: colors.infoLight, borderRadius: radii.md, padding: spacing.md },
    noteText: { ...typography.caption, color: colors.textPrimary },
    line: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.divider },
    lineBad: { borderColor: colors.errorLight },
    name: { ...typography.bodyMedium, color: colors.textPrimary },
    meta: { ...typography.small, color: colors.textTertiary },
    priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    price: { ...typography.bodySemibold, color: colors.textPrimary },
    mrp: { ...typography.caption, color: colors.textTertiary, textDecorationLine: 'line-through' },
    changed: { ...typography.caption, color: colors.warningDark },
    issue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    issueText: { ...typography.caption, color: colors.error, flexShrink: 1 },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.background, paddingHorizontal: spacing.base, paddingTop: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, ...shadows.md },
    totals: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totalLabel: { ...typography.caption, color: colors.textSecondary },
    savings: { ...typography.captionMedium, color: colors.successDark },
    total: { ...typography.h3, color: colors.textPrimary },
    blocker: { ...typography.caption, color: colors.error },
});
