/**
 * Product page: photos, price and discount, options (pack size, RAM…),
 * quantity, stock, the return policy and the disclosures the E-Commerce
 * Rules ask for (seller, grievance contact, origin, maker), reviews.
 * Add to cart, or Buy now straight to checkout for just this item.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RotateCcw, ShieldCheck, Store, ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button, ScreenHeader, EmptyState } from '../../components/ui';
import { useAddToCart, useStoreProduct } from '../../hooks/useShopData';
import { getApiErrorMessage } from '../../api/client';
import { CartButton, PriceRow, ProductImage, QtyStepper, Stars } from './parts';

type Props = NativeStackScreenProps<any, 'ProductDetail'>;
const W = Dimensions.get('window').width;

export function ProductDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.id);
    const { bottomBar } = useScreenInsets();
    const { data: p, isLoading, isError, refetch } = useStoreProduct(id);
    const add = useAddToCart();
    const [optionId, setOptionId] = useState<number | null>(null);
    const [qty, setQty] = useState(1);
    const [photo, setPhoto] = useState(0);
    const [showSeller, setShowSeller] = useState(false);

    // Preselect the first option that is in stock.
    useEffect(() => {
        if (p?.options.length && optionId == null) setOptionId((p.options.find(o => o.available > 0) ?? p.options[0]).id);
    }, [p, optionId]);

    const option = p?.options.find(o => o.id === optionId) ?? null;
    const price = option ? option.price : p?.price ?? 0;
    const mrp = option ? option.mrp : p?.mrp ?? null;
    const available = option ? option.available : p?.available ?? 0;
    const canBuy = !!p && available > 0 && (!p.options.length || !!option);
    const maxQty = Math.max(1, Math.min(20, available));
    useEffect(() => { if (qty > maxQty) setQty(maxQty); }, [maxQty, qty]);

    const item = useMemo(() => ({ productId: id, variantId: option?.id ?? null, quantity: qty }), [id, option, qty]);

    if (isLoading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
    if (isError || !p) {
        return (
            <View style={styles.screen}>
                <ScreenHeader title="Product" onBack={() => navigation.goBack()} />
                <EmptyState title="This product is not available" description="It may have sold out or been taken off sale." actionLabel="Try again" onAction={() => refetch()} />
            </View>
        );
    }

    const addToCart = async () => {
        try {
            await add.mutateAsync(item);
            Alert.alert('Added to cart', `${p.name}${option ? ` (${option.label})` : ''} × ${qty}`, [
                { text: 'Keep shopping', style: 'cancel' },
                { text: 'Go to cart', onPress: () => navigation.navigate('Cart') },
            ]);
        } catch (e) {
            Alert.alert('Could not add', getApiErrorMessage(e));
        }
    };
    const buyNow = () => navigation.navigate('Checkout', { source: 'buy_now', items: [item] });

    return (
        <View style={styles.screen}>
            <ScreenHeader title="" onBack={() => navigation.goBack()} rightAction={<CartButton onPress={() => navigation.navigate('Cart')} />} />
            <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
                {/* Photos */}
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={e => setPhoto(Math.round(e.nativeEvent.contentOffset.x / W))}>
                    {(p.images.length ? p.images : [null]).map((uri, i) => <ProductImage key={i} uri={uri} style={{ width: W, height: W * 0.85, borderRadius: 0 }} />)}
                </ScrollView>
                {p.images.length > 1 && (
                    <View style={styles.dots}>{p.images.map((_, i) => <View key={i} style={[styles.dot, i === photo && styles.dotOn]} />)}</View>
                )}

                <View style={styles.block}>
                    <Text style={styles.category}>{p.category}</Text>
                    <Text style={styles.name}>{p.name}</Text>
                    {p.rating && (
                        <View style={styles.row}><Stars value={p.rating.average} /><Text style={styles.muted}>{p.rating.average} · {p.rating.count} review{p.rating.count === 1 ? '' : 's'}</Text></View>
                    )}
                    <PriceRow price={price} mrp={mrp} size="lg" />
                    <Text style={styles.muted}>Inclusive of all taxes{p.details.gstPercent != null ? ` (GST ${p.details.gstPercent}%)` : ''}</Text>
                </View>

                {p.options.length > 0 && (
                    <View style={styles.block}>
                        <Text style={styles.label}>Choose an option</Text>
                        <View style={styles.options}>
                            {p.options.map(o => {
                                const on = o.id === optionId, out = o.available <= 0;
                                return (
                                    <TouchableOpacity key={o.id} onPress={() => setOptionId(o.id)} style={[styles.option, on && styles.optionOn, out && styles.optionOut]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${o.label}, ${o.price} rupees${out ? ', out of stock' : ''}`}>
                                        <Text style={[styles.optionLabel, on && { color: colors.primary }]}>{o.label}</Text>
                                        <Text style={styles.optionPrice}>{out ? 'Out of stock' : `₹${o.price.toLocaleString('en-IN')}`}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                )}

                <View style={[styles.block, styles.row, { justifyContent: 'space-between' }]}>
                    <View style={{ gap: 2 }}>
                        <Text style={styles.label}>Quantity</Text>
                        <Text style={[styles.muted, available <= 0 ? { color: colors.error } : available <= 3 ? { color: colors.warningDark } : null]}>
                            {available <= 0 ? 'Out of stock' : available <= 3 ? `Only ${available} left` : 'In stock'}
                        </Text>
                    </View>
                    <QtyStepper value={qty} max={maxQty} onChange={setQty} disabled={!canBuy} />
                </View>

                <View style={styles.block}>
                    <View style={styles.infoRow}><RotateCcw size={18} color={colors.textSecondary} /><Text style={styles.info}>{p.returnPolicy.text}</Text></View>
                    {!!p.details.warrantyMonths && <View style={styles.infoRow}><ShieldCheck size={18} color={colors.textSecondary} /><Text style={styles.info}>{p.details.warrantyMonths}-month warranty{p.details.warrantyBy === 'manufacturer' ? ' from the manufacturer' : p.details.warrantyBy === 'seller' ? ' from the seller' : ''}</Text></View>}
                    <TouchableOpacity style={styles.infoRow} onPress={() => setShowSeller(!showSeller)} accessibilityRole="button" accessibilityState={{ expanded: showSeller }}>
                        <Store size={18} color={colors.textSecondary} />
                        <Text style={[styles.info, { flex: 1 }]}>Sold by <Text style={{ fontWeight: '600', color: colors.textPrimary }}>{p.seller.name}</Text></Text>
                        {showSeller ? <ChevronUp size={18} color={colors.textTertiary} /> : <ChevronDown size={18} color={colors.textTertiary} />}
                    </TouchableOpacity>
                    {showSeller && (
                        <View style={styles.sellerBox}>
                            <Text style={styles.small}>{p.seller.legalName}{p.seller.gstin ? ` · GSTIN ${p.seller.gstin}` : ''}</Text>
                            {!!p.seller.address && <Text style={styles.small}>{p.seller.address}</Text>}
                            <Text style={styles.small}>Grievance officer: {[p.seller.grievance.name, p.seller.grievance.phone, p.seller.grievance.email].filter(Boolean).join(' · ') || 'see Help in the app'}</Text>
                            {!!p.seller.returnPolicy && <Text style={styles.small}>Seller's policy: {p.seller.returnPolicy}</Text>}
                        </View>
                    )}
                </View>

                {!!p.description && (
                    <View style={styles.block}>
                        <Text style={styles.label}>About this product</Text>
                        <Text style={styles.body}>{p.description}</Text>
                    </View>
                )}

                <View style={styles.block}>
                    <Text style={styles.label}>Details</Text>
                    {[
                        ['Net quantity', p.details.netQuantity], ['Country of origin', p.details.countryOfOrigin], ['Manufacturer', p.details.manufacturer],
                        ['BIS registration', p.details.bisNumber],
                        ...Object.entries(p.specifications ?? {}).map(([k, v]) => [k, String(v)]),
                    ].filter(([, v]) => !!v).map(([k, v]) => (
                        <View key={k as string} style={styles.spec}><Text style={styles.specKey}>{k}</Text><Text style={styles.specVal}>{v}</Text></View>
                    ))}
                </View>

                <View style={styles.block}>
                    <Text style={styles.label}>Reviews</Text>
                    {p.reviews.length === 0 && <Text style={styles.muted}>No reviews yet. Reviews come only from customers who bought it.</Text>}
                    {p.reviews.map((r, i) => (
                        <View key={i} style={styles.review}>
                            <Stars value={r.rating} size={12} />
                            {!!r.review && <Text style={styles.body}>{r.review}</Text>}
                            {!!r.sellerReply && <Text style={styles.reply}>Seller: {r.sellerReply}</Text>}
                        </View>
                    ))}
                </View>
            </ScrollView>

            <View style={[styles.bar, { paddingBottom: bottomBar }]}>
                <Button title="Add to cart" variant="outline" onPress={addToCart} loading={add.isPending} disabled={!canBuy} fullWidth={false} style={{ flex: 1 }} />
                <Button title={canBuy ? 'Buy now' : 'Out of stock'} onPress={buyNow} disabled={!canBuy} fullWidth={false} style={{ flex: 1 }} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, backgroundColor: colors.background },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
    dotOn: { backgroundColor: colors.primary, width: 16 },
    block: { backgroundColor: colors.background, padding: spacing.base, marginTop: spacing.sm, gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    category: { ...typography.captionMedium, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
    name: { ...typography.h3, color: colors.textPrimary },
    muted: { ...typography.caption, color: colors.textSecondary },
    label: { ...typography.bodySemibold, color: colors.textPrimary },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    option: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minWidth: 96, gap: 2 },
    optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    optionOut: { opacity: 0.5 },
    optionLabel: { ...typography.bodyMedium, color: colors.textPrimary },
    optionPrice: { ...typography.caption, color: colors.textSecondary },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
    info: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
    sellerBox: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, gap: 4 },
    small: { ...typography.caption, color: colors.textSecondary },
    body: { ...typography.body, color: colors.textPrimary },
    spec: { flexDirection: 'row', gap: spacing.md, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
    specKey: { ...typography.caption, color: colors.textSecondary, width: 130 },
    specVal: { ...typography.caption, color: colors.textPrimary, flex: 1 },
    review: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
    reply: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.base, paddingTop: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.divider, ...shadows.md },
});
