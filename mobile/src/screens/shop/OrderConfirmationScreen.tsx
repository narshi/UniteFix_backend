/**
 * After payment: the order is placed. One order per seller; each opens to its
 * detail (tracking, invoice). Back goes to the Shop, not to checkout.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, BackHandler } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CheckCircle2, ChevronRight } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button } from '../../components/ui';
import { rupees } from './parts';

type Props = NativeStackScreenProps<any, 'OrderConfirmation'>;

export function OrderConfirmationScreen({ navigation, route }: Props) {
    const { headerTop, bottomBar } = useScreenInsets();
    const orders: Array<{ id: number; code: string }> = route.params?.orders ?? [];
    const total: number | null = route.params?.total ?? null;
    const toShop = () => navigation.navigate('CustomerTabs', { screen: 'ShopTab' });

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => { toShop(); return true; });
        return () => sub.remove();
    }, []);

    return (
        <View style={[styles.screen, { paddingTop: headerTop + spacing['2xl'], paddingBottom: bottomBar }]}>
            <View style={styles.hero}>
                <CheckCircle2 size={64} color={colors.success} />
                <Text style={styles.title} accessibilityRole="header">Order placed</Text>
                <Text style={styles.text}>
                    {total != null ? `${rupees(total)} paid. ` : ''}We will tell you when it ships.
                    {orders.length > 1 ? ` It comes in ${orders.length} parcels, one from each seller.` : ''}
                </Text>
            </View>
            <View style={styles.list}>
                {orders.map(o => (
                    <TouchableOpacity key={o.id} style={styles.row} onPress={() => navigation.replace('OrderDetail', { id: o.id })} accessibilityRole="button" accessibilityLabel={`Open order ${o.code}`}>
                        <Text style={styles.code}>Order {o.code}</Text>
                        <ChevronRight size={18} color={colors.textTertiary} />
                    </TouchableOpacity>
                ))}
            </View>
            <View style={{ gap: spacing.md, marginTop: 'auto' }}>
                <Button title="View my orders" variant="outline" onPress={() => navigation.replace('ShopOrders')} />
                <Button title="Continue shopping" onPress={toShop} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
    hero: { alignItems: 'center', gap: spacing.md },
    title: { ...typography.h2, color: colors.textPrimary },
    text: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
    list: { marginTop: spacing['2xl'], gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.base },
    code: { ...typography.bodySemibold, color: colors.textPrimary },
});
