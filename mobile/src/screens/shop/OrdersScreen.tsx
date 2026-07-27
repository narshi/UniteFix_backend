/**
 * My Orders Screen — Order history list
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Package, ChevronRight, ShoppingBag, Calendar } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

// Since there's no dedicated my-orders endpoint, we'll use a local approach with the data
// For now, this screen fetches from the same mechanism
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { useScreenInsets } from '../../theme/layout';

function useMyOrders() {
    return useQuery({
        queryKey: ['shop.myOrders'],
        queryFn: async () => {
            // Try admin orders endpoint for now (backend may need a user-specific one)
            try {
                const res = await apiClient.get('/api/admin/orders');
                return (res.data as any)?.data || res.data || [];
            } catch {
                return [];
            }
        },
    });
}

const ORDER_STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: colors.warningLight, text: colors.warning, label: 'Pending' },
    confirmed: { bg: colors.infoLight, text: colors.info, label: 'Confirmed' },
    shipped: { bg: colors.primarySurface, text: colors.primary, label: 'Shipped' },
    out_for_delivery: { bg: colors.primarySurface, text: colors.primary, label: 'On the Way' },
    delivered: { bg: colors.successLight, text: colors.success, label: 'Delivered' },
    cancelled: { bg: colors.errorLight, text: colors.error, label: 'Cancelled' },
    returned: { bg: colors.errorLight, text: colors.error, label: 'Returned' },
};

function OrderCard({ item, onPress }: { item: any; onPress: () => void }) {
    const config = ORDER_STATUS_CONFIG[item.status] || ORDER_STATUS_CONFIG.pending;
    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
    const itemCount = item.products?.length || 0;

    return (
        <TouchableOpacity style={styles.orderCard} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.orderIcon}>
                <Package size={22} color={colors.primary} />
            </View>
            <View style={styles.orderInfo}>
                <View style={styles.orderTop}>
                    <Text style={styles.orderId}>Order #{item.id}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
                        <Text style={[styles.statusText, { color: config.text }]}>{config.label}</Text>
                    </View>
                </View>
                <Text style={styles.orderItems}>{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
                <View style={styles.orderBottom}>
                    <View style={styles.dateRow}>
                        <Calendar size={12} color={colors.textDisabled} />
                        <Text style={styles.dateText}>{date}</Text>
                    </View>
                    <Text style={styles.orderTotal}>₹{item.totalAmount}</Text>
                </View>
            </View>
            <ChevronRight size={18} color={colors.textDisabled} />
        </TouchableOpacity>
    );
}

export function OrdersScreen() {
    const { headerTop } = useScreenInsets();
    const { data: orders, isLoading, refetch, isRefetching } = useMyOrders();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.headerTitle}>My Orders</Text>
                <Text style={styles.headerSub}>{(orders || []).length} orders</Text>
            </View>

            <FlatList
                data={orders || []}
                renderItem={({ item }) => (
                    <OrderCard
                        item={item}
                        onPress={() => navigation.navigate('OrderDetail', { order: item })}
                    />
                )}
                keyExtractor={(item) => item.id?.toString() || Math.random().toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <ShoppingBag size={48} color={colors.textDisabled} />
                        <Text style={styles.emptyTitle}>No orders yet</Text>
                        <Text style={styles.emptySubtitle}>Your orders will appear here</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: { paddingBottom: spacing.lg, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
    listContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    orderCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.sm, ...shadows.sm,
    },
    orderIcon: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySurface,
        justifyContent: 'center', alignItems: 'center', marginRight: spacing.md,
    },
    orderInfo: { flex: 1 },
    orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
    orderId: { ...typography.bodyMedium, color: colors.textPrimary },
    statusBadge: { paddingVertical: 2, paddingHorizontal: spacing.sm, borderRadius: radii.full },
    statusText: { fontSize: 10, fontWeight: '600' },
    orderItems: { ...typography.small, color: colors.textSecondary },
    orderBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    dateText: { ...typography.small, color: colors.textDisabled },
    orderTotal: { ...typography.bodyMedium, color: colors.primary, fontWeight: '700' },
    emptyContainer: { alignItems: 'center', paddingTop: spacing['4xl'] },
    emptyTitle: { ...typography.h4, color: colors.textSecondary, marginTop: spacing.lg },
    emptySubtitle: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm },
});
