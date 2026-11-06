/**
 * On Home, for a customer who came through a partner's link: who they are
 * booking with. The booking screen then has that partner chosen. Dismissing
 * it forgets the code (the customer can still type it while booking).
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Star, X, ShieldCheck } from 'lucide-react-native';
import { usePartnerRef } from '../../services/partnerLinks';
import { usePartnerCard } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

export function PartnerRefBanner() {
    const code = usePartnerRef(s => s.code);
    const setCode = usePartnerRef(s => s.setCode);
    const { data: card, isError } = usePartnerCard(code);
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        if (card) Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [card, v]);
    // A code that names nobody: forget it quietly.
    useEffect(() => { if (code && isError) setCode(null); }, [code, isError]);
    if (!code || !card) return null;

    return (
        <Animated.View style={[styles.wrap, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}>
            <View style={styles.icon}><ShieldCheck size={20} color={colors.primary} /></View>
            <View style={styles.body}>
                <Text style={styles.kicker}>Booking with your partner</Text>
                <Text style={styles.name} numberOfLines={1}>{card.name}</Text>
                <View style={styles.metaRow}>
                    {card.rating != null && card.reviews > 0 ? (
                        <>
                            <Star size={12} color={colors.warning} fill={colors.warning} />
                            <Text style={styles.meta}>{card.rating.toFixed(1)} ({card.reviews})</Text>
                        </>
                    ) : <Text style={styles.meta}>New on UniteFix</Text>}
                    <Text style={styles.meta}> · choose a service, they are selected for you</Text>
                </View>
            </View>
            <Pressable onPress={() => setCode(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Stop booking with this partner">
                <X size={18} color={colors.textTertiary} />
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg,
        padding: spacing.md, borderRadius: radii.xl, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primaryLight, ...shadows.sm,
    },
    icon: { width: 40, height: 40, borderRadius: radii.lg, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    kicker: { ...typography.small, color: colors.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    name: { ...typography.bodySemibold, color: colors.textPrimary },
    metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 3 },
    meta: { ...typography.small, color: colors.textSecondary },
});
