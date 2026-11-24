/**
 * Small pieces the shop screens share: money, product images, the quantity
 * stepper, the cart button with its count, a reason sheet and star rating.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Minus, Plus, ShoppingBag, ShoppingCart, Star } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../../components/ui';
import { useCart } from '../../hooks/useShopData';

export const rupees = (n: number | null | undefined) =>
    n == null ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(n) ? 0 : 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`;

export const offPercent = (price: number, mrp: number | null) => (mrp && mrp > price ? Math.round((1 - price / mrp) * 100) : 0);

export function PriceRow({ price, mrp, size = 'md' }: { price: number; mrp: number | null; size?: 'sm' | 'md' | 'lg' }) {
    const off = offPercent(price, mrp);
    const big = size === 'lg' ? styles.priceLg : size === 'sm' ? styles.priceSm : styles.priceMd;
    return (
        <View style={styles.priceRow}>
            <Text style={big}>{rupees(price)}</Text>
            {off > 0 && <Text style={styles.mrp}>{rupees(mrp)}</Text>}
            {off > 0 && <Text style={styles.off}>{off}% off</Text>}
        </View>
    );
}

export function ProductImage({ uri, size, style }: { uri: string | null; size?: number; style?: any }) {
    const box = size ? { width: size, height: size } : null;
    if (!uri) {
        return (
            <View style={[styles.imgFallback, box, style]}>
                <ShoppingBag size={size ? Math.max(18, size / 3) : 32} color={colors.textDisabled} />
            </View>
        );
    }
    return <Image source={{ uri }} style={[styles.img, box, style]} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />;
}

export function QtyStepper({ value, min = 1, max, onChange, disabled }: { value: number; min?: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
    return (
        <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(value - 1)} disabled={disabled || value <= min} accessibilityLabel="Fewer" hitSlop={8}>
                <Minus size={16} color={disabled || value <= min ? colors.textDisabled : colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.stepVal} accessibilityLabel={`Quantity ${value}`}>{value}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => onChange(value + 1)} disabled={disabled || value >= max} accessibilityLabel="More" hitSlop={8}>
                <Plus size={16} color={disabled || value >= max ? colors.textDisabled : colors.textPrimary} />
            </TouchableOpacity>
        </View>
    );
}

/** The cart icon with how many items are in it. */
export function CartButton({ onPress }: { onPress: () => void }) {
    const { data } = useCart();
    const n = data?.count ?? 0;
    return (
        <TouchableOpacity onPress={onPress} style={styles.cartBtn} accessibilityRole="button" accessibilityLabel={`Cart, ${n} item${n === 1 ? '' : 's'}`} hitSlop={6}>
            <ShoppingCart size={20} color={colors.textPrimary} />
            {n > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{n > 99 ? '99+' : n}</Text></View>}
        </TouchableOpacity>
    );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
    return (
        <View style={{ flexDirection: 'row', gap: 2 }} accessibilityLabel={`${value} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map(i => <Star key={i} size={size} color={colors.warning} fill={i <= Math.round(value) ? colors.warning : 'transparent'} />)}
        </View>
    );
}

/** A bottom sheet asking for a reason (cancel, return) or a review. */
export function ReasonSheet({ visible, title, hint, confirmLabel, withRating, minLength = 2, onClose, onSubmit }: {
    visible: boolean; title: string; hint: string; confirmLabel: string; withRating?: boolean; minLength?: number;
    onClose: () => void; onSubmit: (text: string, rating: number) => Promise<void>;
}) {
    const [text, setText] = useState('');
    const [rating, setRating] = useState(0);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setText(''); setRating(0); setBusy(false); } }, [visible]);
    const ok = withRating ? rating > 0 : text.trim().length >= minLength;
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
                <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
                <View style={styles.sheet}>
                    <Text style={styles.sheetTitle}>{title}</Text>
                    {withRating && (
                        <View style={styles.rateRow}>
                            {[1, 2, 3, 4, 5].map(i => (
                                <TouchableOpacity key={i} onPress={() => setRating(i)} accessibilityLabel={`${i} star${i > 1 ? 's' : ''}`} hitSlop={6}>
                                    <Star size={32} color={colors.warning} fill={i <= rating ? colors.warning : 'transparent'} />
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                    <TextInput
                        style={styles.sheetInput} value={text} onChangeText={setText} placeholder={hint} placeholderTextColor={colors.textTertiary}
                        multiline maxLength={500} textAlignVertical="top"
                    />
                    <View style={styles.sheetBtns}>
                        <Button title="Not now" variant="ghost" onPress={onClose} fullWidth={false} style={{ flex: 1 }} />
                        <Button title={confirmLabel} loading={busy} disabled={!ok} fullWidth={false} style={{ flex: 1 }}
                            onPress={async () => { setBusy(true); try { await onSubmit(text.trim(), rating); } finally { setBusy(false); } }} />
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 },
    priceSm: { ...typography.bodySemibold, color: colors.textPrimary },
    priceMd: { ...typography.h4, color: colors.textPrimary },
    priceLg: { ...typography.h2, color: colors.textPrimary },
    mrp: { ...typography.caption, color: colors.textTertiary, textDecorationLine: 'line-through' },
    off: { ...typography.captionMedium, color: colors.successDark },
    img: { backgroundColor: colors.surface, borderRadius: radii.md },
    imgFallback: { backgroundColor: colors.surface, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
    stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radii.full },
    stepBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    stepVal: { ...typography.bodySemibold, minWidth: 24, textAlign: 'center', color: colors.textPrimary },
    cartBtn: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    badgeText: { color: colors.textInverse, fontSize: 10, fontWeight: '700' },
    sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], padding: spacing.xl, gap: spacing.md },
    sheetTitle: { ...typography.h4, color: colors.textPrimary },
    rateRow: { flexDirection: 'row', gap: spacing.md, justifyContent: 'center', paddingVertical: spacing.sm },
    sheetInput: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, ...typography.body, color: colors.textPrimary },
    sheetBtns: { flexDirection: 'row', gap: spacing.md, paddingBottom: spacing.base },
});
