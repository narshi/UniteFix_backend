/**
 * One group of optional add-ons — "OTT subscriptions", "Telephone" — as a
 * collapsed row that says what is chosen and what it adds, and opens inline.
 *
 * Collapsed is the default and the point: the recharge screen used to stack
 * every add-on as a card, and on a 360×740 phone the total fell off the bottom.
 * A row per group keeps the whole flow on one screen; opening one group is
 * bounded by that group.
 *
 * A group whose items share one exclusive group renders as radios, because
 * "Hotstar Basic or Premium" is a choice, not a shopping list.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, LayoutAnimation, Platform, UIManager } from 'react-native';
import { ChevronDown, ChevronUp, Check, Phone, Tv, MonitorPlay, Globe, Wrench, Puzzle } from 'lucide-react-native';
import type { FtthPlanAddon } from '../../api/ftth.api';
import type { AddonGroup } from '../../hooks/usePlanPricing';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Icons by kind — decided: no logos until Phase 4. */
export function KindIcon({ kind, size = 18, color = colors.primary }: { kind: FtthPlanAddon['kind']; size?: number; color?: string }) {
    switch (kind) {
        case 'telephone': return <Phone size={size} color={color} />;
        case 'ott': return <MonitorPlay size={size} color={color} />;
        case 'iptv': return <Tv size={size} color={color} />;
        case 'static_ip': return <Globe size={size} color={color} />;
        case 'installation': return <Wrench size={size} color={color} />;
        default: return <Puzzle size={size} color={color} />;
    }
}

interface Props {
    group: AddonGroup;
    open: boolean;
    onToggleOpen: () => void;
    selected: number[];
    onToggleItem: (addon: FtthPlanAddon) => void;
}

export function AddonGroupAccordion({ group, open, onToggleOpen, selected, onToggleItem }: Props) {
    const toggleOpen = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onToggleOpen();
    };

    return (
        <View style={[styles.card, open && styles.cardOpen]}>
            <TouchableOpacity style={styles.head} onPress={toggleOpen} activeOpacity={0.7}>
                <KindIcon kind={group.kind} />
                <View style={styles.headBody}>
                    <Text style={styles.headTitle}>{group.label}</Text>
                    <Text style={styles.headMeta}>
                        {group.selectedCount === 0
                            ? `${group.items.length} available`
                            : `${group.selectedCount} selected · ₹${group.subtotal}`}
                    </Text>
                </View>
                {group.selectedCount > 0 && !open && (
                    <Text style={styles.headAmount}>+₹{group.subtotal}</Text>
                )}
                {open ? <ChevronUp size={18} color={colors.textSecondary} /> : <ChevronDown size={18} color={colors.textSecondary} />}
            </TouchableOpacity>

            {open && (
                <View style={styles.body}>
                    {group.pickOne && <Text style={styles.pickOne}>Choose one</Text>}
                    {group.items.map(item => {
                        const on = selected.includes(item.id);
                        return (
                            <TouchableOpacity key={item.id} style={[styles.row, on && styles.rowOn]} onPress={() => onToggleItem(item)} activeOpacity={0.7}>
                                <View style={[group.pickOne ? styles.radio : styles.tick, on && (group.pickOne ? styles.radioOn : styles.tickOn)]}>
                                    {on && (group.pickOne ? <View style={styles.radioDot} /> : <Check size={13} color="#fff" strokeWidth={3} />)}
                                </View>
                                <View style={styles.rowBody}>
                                    <Text style={styles.rowLabel}>{item.label}</Text>
                                    {!!item.description && <Text style={styles.rowDesc}>{item.description}</Text>}
                                    {item.pricingBasis === 'per_month' && (item.months ?? 1) > 1 && (
                                        <Text style={styles.rowDesc}>₹{item.unitAmount} × {item.months} months</Text>
                                    )}
                                </View>
                                <Text style={styles.rowAmount}>₹{item.amount}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden' },
    cardOpen: { borderColor: colors.primary },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
    headBody: { flex: 1 },
    headTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    headMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    headAmount: { ...typography.captionMedium, color: colors.primary, marginRight: spacing.xs },
    body: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
    pickOne: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs },
    rowOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    rowBody: { flex: 1 },
    rowLabel: { ...typography.captionMedium, color: colors.textPrimary },
    rowDesc: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    rowAmount: { ...typography.captionMedium, color: colors.textPrimary },
    tick: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: colors.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
});
