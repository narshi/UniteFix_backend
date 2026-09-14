/**
 * The itemised bill, in a sheet.
 *
 * Moving this out of the scroll is the largest space recovery on the recharge
 * screen: a breakdown with add-ons is eight to twelve rows, and on a small
 * phone it pushed the toggles and the total apart so every tick was followed
 * by a scroll to see what it did. The footer carries the total; this is the
 * working, on demand. Read-only on purpose — the toggles stay on the screen,
 * so nobody edits inside a sheet whose total is above it.
 */

import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import type { FtthPlan, FtthPlanAddon } from '../../api/ftth.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

interface Props {
    visible: boolean;
    onClose: () => void;
    plan: FtthPlan;
    mandatory: FtthPlanAddon[];
    chosen: FtthPlanAddon[];
    total: number;
}

function Line({ label, sub, value, tone, bold }: { label: string; sub?: string; value: string; tone?: 'good'; bold?: boolean }) {
    return (
        <View style={styles.line}>
            <View style={{ flex: 1 }}>
                <Text style={[styles.lineLabel, bold && styles.bold]}>{label}</Text>
                {!!sub && <Text style={styles.lineSub}>{sub}</Text>}
            </View>
            <Text style={[styles.lineValue, bold && styles.bold, tone === 'good' && { color: colors.successDark }]}>{value}</Text>
        </View>
    );
}

export function BillSummarySheet({ visible, onClose, plan, mandatory, chosen, total }: Props) {
    const derivation = (a: FtthPlanAddon) =>
        a.pricingBasis === 'per_month' && (a.months ?? 1) > 1 ? `₹${a.unitAmount} × ${a.months} months` : undefined;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.wrap}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View style={styles.sheet}>
                    <View style={styles.handle} />
                    <View style={styles.head}>
                        <Text style={styles.title}>Bill breakdown</Text>
                        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <X size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: spacing.sm }}>
                        <Line label={`${plan.speedMbps} Mbps broadband`} sub={`${plan.durationMonths} month${plan.durationMonths === 1 ? '' : 's'}`} value={`₹${plan.price}`} />
                        {plan.discount > 0 && <Line label="Operator discount" value={`− ₹${plan.discount}`} tone="good" />}
                        {mandatory.map(a => <Line key={a.id} label={a.label} sub={derivation(a) ?? 'Included with the plan'} value={`₹${a.amount}`} />)}
                        {chosen.map(a => <Line key={a.id} label={a.label} sub={derivation(a)} value={`₹${a.amount}`} />)}
                        <Line label="UniteFix convenience fee" value={`₹${plan.convenienceFee}`} />
                        <View style={styles.divider} />
                        <Line label="Total payable" sub="All taxes included" value={`₹${total}`} bold />
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    wrap: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.45)' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl + spacing.md, paddingTop: spacing.sm },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    title: { ...typography.bodySemibold, color: colors.textPrimary },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.xs + 2 },
    lineLabel: { ...typography.body, color: colors.textPrimary },
    lineSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    lineValue: { ...typography.body, color: colors.textPrimary },
    bold: { ...typography.bodySemibold },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
