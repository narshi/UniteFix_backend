/**
 * My stock — the parts a technician is carrying, and what moved.
 *
 * The kit is what UniteFix issued minus what they have fitted. A count that
 * disagrees with this is the technician's to answer for, so it is shown to
 * them plainly, with every movement that led here.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Package, Undo2 } from 'lucide-react-native';
import { partnerApi } from '../../api/partner.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'MyStock'>;

const MOVE_LABEL: Record<string, string> = {
    transfer_to_technician: 'Issued to you', return_to_warehouse: 'Returned to warehouse', consumed: 'Fitted on a job',
    adjustment: 'Count adjustment', purchase_in: 'Received', sold_to_partner: 'Sold', partner_return: 'Return', write_off: 'Written off',
};

export function MyStockScreen({ navigation }: Props) {
    const [returning, setReturning] = useState<number | null>(null);
    const { data, isLoading, refetch, isRefetching } = useQuery({
        queryKey: ['my-stock'],
        queryFn: async () => (await partnerApi.getMyStock()).data.data,
    });

    const returnOne = (sparePartId: number, name: string, qty: number) => {
        Alert.alert(`Return ${name}?`, `Hand ${qty} back at the office. This records the return; UniteFix confirms it on receipt.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: `Return ${qty}`,
                onPress: async () => {
                    setReturning(sparePartId);
                    try {
                        const { data: res } = await partnerApi.returnStock(sparePartId, qty);
                        Alert.alert('Recorded', res.message);
                        refetch();
                    } catch (err) {
                        Alert.alert('Not recorded', getApiErrorMessage(err));
                    } finally {
                        setReturning(null);
                    }
                },
            },
        ]);
    };

    return (
        <View style={styles.screen}>
            <ScreenHeader title="My stock" onBack={() => navigation.goBack()} />
            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
            >
                {isLoading ? (
                    <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
                ) : (
                    <>
                        <View style={styles.card}>
                            <Text style={styles.cardTitle}>In your kit</Text>
                            {(data?.items.length ?? 0) === 0 ? (
                                <Text style={styles.empty}>Nothing at the moment. Parts issued to you at the office show up here; parts you fit on jobs come off.</Text>
                            ) : data!.items.map(it => (
                                <View key={it.sparePartId} style={styles.itemRow}>
                                    <Package size={16} color={colors.primary} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.itemName}>{it.name}{it.brand ? <Text style={styles.itemBrand}>  {it.brand}</Text> : null}</Text>
                                        <Text style={styles.itemMeta}>{it.partCode} · ₹{it.unitPrice} each to the customer</Text>
                                    </View>
                                    <Text style={styles.itemQty}>×{it.quantity}</Text>
                                    <TouchableOpacity
                                        onPress={() => returnOne(it.sparePartId, it.name, it.quantity)}
                                        disabled={returning === it.sparePartId}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        {returning === it.sparePartId ? <ActivityIndicator size="small" color={colors.primary} /> : <Undo2 size={16} color={colors.textSecondary} />}
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>

                        {(data?.movements.length ?? 0) > 0 && (
                            <View style={styles.card}>
                                <Text style={styles.cardTitle}>Movements</Text>
                                {data!.movements.map(m => (
                                    <View key={m.id} style={styles.moveRow}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.moveTitle}>{MOVE_LABEL[m.type] ?? m.type} · {m.part.name}</Text>
                                            <Text style={styles.moveDate}>{new Date(m.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{m.notes ? ` · ${m.notes}` : ''}</Text>
                                        </View>
                                        <Text style={[styles.moveQty, { color: m.quantity < 0 ? colors.errorDark : colors.successDark }]}>{m.quantity > 0 ? '+' : ''}{m.quantity}</Text>
                                    </View>
                                ))}
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    empty: { ...typography.caption, color: colors.textSecondary },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    itemName: { ...typography.bodyMedium, color: colors.textPrimary },
    itemBrand: { ...typography.caption, color: colors.textSecondary },
    itemMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    itemQty: { ...typography.bodySemibold, color: colors.textPrimary },
    moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    moveTitle: { ...typography.captionMedium, color: colors.textPrimary },
    moveDate: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    moveQty: { ...typography.captionMedium },
});
