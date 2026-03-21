/**
 * Order Confirmation Screen — Success state after placing an order
 * Role: 🟦 Customer only
 */

import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CheckCircle, Package, ShoppingBag } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Button } from '../../components/ui';

type Props = NativeStackScreenProps<any, 'OrderConfirmation'>;

export function OrderConfirmationScreen({ navigation, route }: Props) {
    const total = route.params?.total || 0;

    const scaleAnim = useRef(new Animated.Value(0)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.sequence([
            Animated.spring(scaleAnim, {
                toValue: 1,
                friction: 4,
                tension: 60,
                useNativeDriver: true,
            }),
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                {/* Success animation */}
                <Animated.View style={[styles.iconWrap, { transform: [{ scale: scaleAnim }] }]}>
                    <View style={styles.iconCircle}>
                        <CheckCircle size={48} color="#fff" />
                    </View>
                </Animated.View>

                <Animated.View style={[styles.textContent, { opacity: fadeAnim }]}>
                    <Text style={styles.title}>Order Placed! 🎉</Text>
                    <Text style={styles.subtitle}>
                        Your order has been placed successfully. You'll receive updates on your order status.
                    </Text>

                    {total > 0 && (
                        <View style={styles.amountCard}>
                            <Text style={styles.amountLabel}>Amount Paid</Text>
                            <Text style={styles.amountValue}>₹{total}</Text>
                        </View>
                    )}

                    <View style={styles.infoCards}>
                        <View style={styles.infoItem}>
                            <Package size={20} color={colors.primary} />
                            <Text style={styles.infoText}>Order is being prepared</Text>
                        </View>
                        <View style={styles.infoItem}>
                            <ShoppingBag size={20} color={colors.primary} />
                            <Text style={styles.infoText}>Track in "My Orders"</Text>
                        </View>
                    </View>
                </Animated.View>
            </View>

            {/* Buttons */}
            <Animated.View style={[styles.actions, { opacity: fadeAnim }]}>
                <Button
                    title="View My Orders"
                    onPress={() => {
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'CustomerTabs', params: { screen: 'OrdersTab' } }],
                        });
                    }}
                />
                <Button
                    title="Continue Shopping"
                    variant="outline"
                    onPress={() => {
                        navigation.reset({
                            index: 0,
                            routes: [{ name: 'CustomerTabs', params: { screen: 'ShopTab' } }],
                        });
                    }}
                    style={{ marginTop: spacing.md }}
                />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
    iconWrap: { marginBottom: spacing.xl },
    iconCircle: {
        width: 96, height: 96, borderRadius: 48,
        backgroundColor: colors.success, justifyContent: 'center', alignItems: 'center',
        ...shadows.lg,
    },
    textContent: { alignItems: 'center' },
    title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.md, textAlign: 'center' },
    subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: spacing.xl },
    amountCard: {
        backgroundColor: colors.primarySurface, borderRadius: radii.lg,
        paddingVertical: spacing.lg, paddingHorizontal: spacing['2xl'],
        alignItems: 'center', marginBottom: spacing.xl,
    },
    amountLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    amountValue: { fontSize: 28, fontWeight: '800', color: colors.primary },
    infoCards: { width: '100%', gap: spacing.md },
    infoItem: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        backgroundColor: colors.surface, borderRadius: radii.md,
        padding: spacing.lg,
    },
    infoText: { ...typography.bodyMedium, color: colors.textPrimary },
    actions: { paddingHorizontal: spacing.xl, paddingBottom: spacing['3xl'] },
});
