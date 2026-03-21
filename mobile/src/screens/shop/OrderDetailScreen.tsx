/**
 * Order Detail Screen — Order info, items, status, return request
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
    ArrowLeft, Package, MapPin, Calendar, RotateCcw,
    CheckCircle, Truck, Clock,
} from 'lucide-react-native';
import { useRequestReturn } from '../../hooks/useShopData';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'OrderDetail'>;

const TIMELINE_STEPS = [
    { key: 'pending', label: 'Order Placed', icon: Clock },
    { key: 'confirmed', label: 'Confirmed', icon: CheckCircle },
    { key: 'shipped', label: 'Shipped', icon: Truck },
    { key: 'delivered', label: 'Delivered', icon: Package },
];

export function OrderDetailScreen({ navigation, route }: Props) {
    const order = route.params?.order;
    const [showReturn, setShowReturn] = useState(false);
    const [returnReason, setReturnReason] = useState('');
    const { mutate: requestReturn, isPending: returning } = useRequestReturn();

    if (!order) { navigation.goBack(); return null; }

    const createdDate = new Date(order.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const statusOrder = ['pending', 'confirmed', 'shipped', 'delivered'];
    const currentIdx = statusOrder.indexOf(order.status);

    const handleReturn = () => {
        if (!returnReason.trim()) { Alert.alert('Required', 'Please provide a reason.'); return; }
        requestReturn(
            { orderId: order.id, data: { reason: returnReason, type: 'return' } },
            { onSuccess: () => { setShowReturn(false); setReturnReason(''); } },
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Order #{order.id}</Text>
                <View style={{ width: 36 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Status timeline */}
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Order Status</Text>
                    {TIMELINE_STEPS.map((step, idx) => {
                        const isComplete = idx <= currentIdx;
                        const isCurrent = idx === currentIdx;
                        const Icon = step.icon;
                        return (
                            <View key={step.key} style={styles.timelineRow}>
                                <View style={styles.timelineLeft}>
                                    <View style={[
                                        styles.timelineDot,
                                        isComplete && styles.timelineDotActive,
                                        isCurrent && styles.timelineDotCurrent,
                                    ]}>
                                        <Icon
                                            size={14}
                                            color={isComplete ? '#fff' : colors.textDisabled}
                                        />
                                    </View>
                                    {idx < TIMELINE_STEPS.length - 1 && (
                                        <View style={[styles.timelineLine, isComplete && styles.timelineLineActive]} />
                                    )}
                                </View>
                                <Text style={[
                                    styles.timelineLabel,
                                    isComplete && styles.timelineLabelActive,
                                    isCurrent && styles.timelineLabelCurrent,
                                ]}>
                                    {step.label}
                                </Text>
                            </View>
                        );
                    })}
                </View>

                {/* Order items */}
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>Items ({order.products?.length || 0})</Text>
                    {(order.products || []).map((p: any, idx: number) => (
                        <View key={idx} style={styles.itemRow}>
                            <View style={styles.itemBullet}>
                                <Package size={14} color={colors.primary} />
                            </View>
                            <Text style={styles.itemName}>{p.name || `Product #${p.productId}`}</Text>
                            <Text style={styles.itemQty}>×{p.quantity}</Text>
                            {p.price && <Text style={styles.itemPrice}>₹{p.price * p.quantity}</Text>}
                        </View>
                    ))}
                    <View style={[styles.itemRow, styles.totalRow]}>
                        <Text style={styles.totalLabel}>Total</Text>
                        <Text style={styles.totalValue}>₹{order.totalAmount}</Text>
                    </View>
                </View>

                {/* Delivery address */}
                {order.address && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Delivery Address</Text>
                        <View style={styles.addressRow}>
                            <MapPin size={16} color={colors.textSecondary} />
                            <Text style={styles.addressText}>{order.address}</Text>
                        </View>
                    </View>
                )}

                {/* Date */}
                <View style={styles.card}>
                    <View style={styles.addressRow}>
                        <Calendar size={16} color={colors.textSecondary} />
                        <Text style={styles.addressText}>Ordered on {createdDate}</Text>
                    </View>
                </View>

                {/* Return button (only for delivered) */}
                {order.status === 'delivered' && !showReturn && (
                    <TouchableOpacity style={styles.returnBtn} onPress={() => setShowReturn(true)}>
                        <RotateCcw size={18} color={colors.warning} />
                        <Text style={styles.returnBtnText}>Request Return / Exchange</Text>
                    </TouchableOpacity>
                )}

                {showReturn && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>Return Request</Text>
                        <TextInput
                            style={styles.reasonInput}
                            placeholder="Why do you want to return?"
                            value={returnReason}
                            onChangeText={setReturnReason}
                            multiline
                            placeholderTextColor={colors.textDisabled}
                        />
                        <View style={styles.returnActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowReturn(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <Button title="Submit Return" onPress={handleReturn} loading={returning} style={{ flex: 1 }} />
                        </View>
                    </View>
                )}
            </ScrollView>
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
    backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { ...typography.h4, color: colors.textPrimary },
    scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['3xl'] },
    card: { backgroundColor: colors.background, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.sm },
    sectionTitle: { ...typography.h4, color: colors.textPrimary, marginBottom: spacing.md },
    // Timeline
    timelineRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 44 },
    timelineLeft: { alignItems: 'center', marginRight: spacing.md },
    timelineDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.border },
    timelineDotActive: { backgroundColor: colors.success, borderColor: colors.success },
    timelineDotCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
    timelineLine: { width: 2, height: 16, backgroundColor: colors.border },
    timelineLineActive: { backgroundColor: colors.success },
    timelineLabel: { ...typography.body, color: colors.textDisabled, paddingTop: 4 },
    timelineLabelActive: { color: colors.textSecondary },
    timelineLabelCurrent: { color: colors.textPrimary, fontWeight: '600' },
    // Items
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
    itemBullet: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySurface, justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm },
    itemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
    itemQty: { ...typography.caption, color: colors.textSecondary, marginRight: spacing.md },
    itemPrice: { ...typography.bodyMedium, color: colors.textPrimary },
    totalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.sm, paddingTop: spacing.md },
    totalLabel: { ...typography.h4, color: colors.textPrimary, flex: 1 },
    totalValue: { ...typography.h3, color: colors.primary },
    // Address
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    addressText: { ...typography.body, color: colors.textSecondary, flex: 1 },
    // Return
    returnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.warningLight, padding: spacing.lg, borderRadius: radii.lg, marginBottom: spacing.lg },
    returnBtnText: { ...typography.bodyMedium, color: colors.warning },
    reasonInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, minHeight: 80, ...typography.body, color: colors.textPrimary, textAlignVertical: 'top', marginBottom: spacing.md },
    returnActions: { flexDirection: 'row', gap: spacing.md },
    cancelBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
    cancelText: { ...typography.bodyMedium, color: colors.textSecondary },
});
