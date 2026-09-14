/**
 * One catalogue part: the full specification, the trade price, the warranty
 * UniteFix backs it with, and a quantity to add. Photo when there is one.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShieldCheck, Package } from 'lucide-react-native';
import { b2bApi } from '../../api/b2b.api';
import { getApiErrorMessage } from '../../api/client';
import { useB2bCartStore } from '../../stores/b2bCart.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { ScreenHeader, Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'PartDetail'>;

const AVAIL_LABEL: Record<string, string> = { in_stock: 'In stock — ships from the warehouse', low: 'Only a few left', backorder: 'Backorder — UniteFix will confirm a date' };

export function PartDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.id);
    const { bottomBar } = useScreenInsets();
    const inCart = useB2bCartStore(s => s.entries.find(e => e.sparePartId === id)?.quantity ?? 0);
    const add = useB2bCartStore(s => s.add);
    const [qty, setQty] = useState(1);

    const { data, isLoading, error } = useQuery({
        queryKey: ['b2b-catalog-item', id],
        queryFn: async () => (await b2bApi.catalogItem(id)).data.data,
        enabled: Number.isFinite(id),
    });

    const addToCart = () => {
        if (!data) return;
        add({ sparePartId: data.id, name: data.name, partCode: data.partCode, tradePrice: data.tradePrice, unit: data.unit }, qty);
        navigation.goBack();
    };

    return (
        <View style={styles.screen}>
            <ScreenHeader title="Part" onBack={() => navigation.goBack()} />
            {isLoading ? (
                <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
            ) : !data ? (
                <Text style={styles.err}>{error ? getApiErrorMessage(error) : 'This part is no longer available for trade.'}</Text>
            ) : (
                <>
                    <ScrollView contentContainerStyle={styles.content}>
                        {data.photoUrl ? (
                            <Image source={{ uri: data.photoUrl }} style={styles.photo} resizeMode="contain" />
                        ) : (
                            <View style={[styles.photo, styles.photoEmpty]}><Package size={40} color={colors.textDisabled} /></View>
                        )}
                        <Text style={styles.name}>{data.name}</Text>
                        <Text style={styles.meta}>{data.partCode}{data.brand ? ` · ${data.brand}` : ''}</Text>
                        {!!data.specification && <Text style={styles.spec}>{data.specification}</Text>}

                        <View style={styles.priceCard}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.priceLabel}>Trade price</Text>
                                <Text style={styles.price}>₹{data.tradePrice} <Text style={styles.priceUnit}>/ {data.unit || 'unit'}</Text></Text>
                                <Text style={styles.priceSub}>{data.gstPercent ? `${data.gstPercent}% GST added at checkout` : 'GST as applicable'}</Text>
                            </View>
                        </View>

                        <View style={styles.factRow}><Package size={16} color={colors.textSecondary} /><Text style={styles.fact}>{AVAIL_LABEL[data.availability] ?? data.availability}</Text></View>
                        {data.warrantyDays != null && data.warrantyDays > 0 && (
                            <View style={styles.factRow}><ShieldCheck size={16} color={colors.successDark} /><Text style={styles.fact}>{data.warrantyDays}-day warranty from UniteFix</Text></View>
                        )}
                        {data.categories.length > 0 && (
                            <Text style={styles.cats}>{data.categories.map(c => c.name).join(' · ')}</Text>
                        )}
                    </ScrollView>

                    <View style={[styles.footer, { paddingBottom: bottomBar }]}>
                        <View style={styles.stepper}>
                            <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} style={styles.stepBtn}><Minus size={18} color={colors.primary} /></TouchableOpacity>
                            <Text style={styles.stepQty}>{qty}</Text>
                            <TouchableOpacity onPress={() => setQty(q => Math.min(10_000, q + 1))} style={styles.stepBtn}><Plus size={18} color={colors.primary} /></TouchableOpacity>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Button title={inCart > 0 ? `Add ${qty} more (${inCart} in cart)` : `Add ${qty} to cart`} onPress={addToCart} fullWidth />
                        </View>
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.xl, paddingBottom: spacing.xl },
    err: { ...typography.body, color: colors.textSecondary, padding: spacing.xl, textAlign: 'center' },
    photo: { width: '100%', height: 200, borderRadius: radii.lg, backgroundColor: colors.surface, marginBottom: spacing.lg },
    photoEmpty: { alignItems: 'center', justifyContent: 'center' },
    name: { ...typography.h3, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    spec: { ...typography.body, color: colors.textPrimary, marginTop: spacing.md },
    priceCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border },
    priceLabel: { ...typography.caption, color: colors.textSecondary },
    price: { ...typography.h2, color: colors.textPrimary, marginTop: 2 },
    priceUnit: { ...typography.body, color: colors.textSecondary },
    priceSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
    fact: { ...typography.body, color: colors.textPrimary, flex: 1 },
    cats: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.lg },
    footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
    stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: colors.primary, overflow: 'hidden', height: 48 },
    stepBtn: { paddingHorizontal: spacing.md, height: '100%', alignItems: 'center', justifyContent: 'center' },
    stepQty: { ...typography.bodySemibold, color: colors.textPrimary, minWidth: 32, textAlign: 'center' },
});
