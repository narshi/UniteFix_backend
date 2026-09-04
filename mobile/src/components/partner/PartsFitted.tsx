/**
 * The parts recorded on a finished job, read-only.
 *
 * MissingBills already asks about the parts whose paperwork is incomplete. This
 * is the other half: a technician who typed "Sirsi Electricals" into the bill
 * form had no screen anywhere that showed it back to them, so from their side
 * the entry looked like it had gone nowhere. Recording something a person can
 * never see again is indistinguishable from not recording it.
 *
 * The shop is printed for every line regardless of whether the part ended up
 * documented, because where it was bought is a fact on its own and does not stop
 * being true when the bill photo is missing.
 */

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Package, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { partnerApi, RecordedPart } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

/** Mirrors sourceLabel() on the server, so both sides name a source the same way. */
function sourceOf(p: RecordedPart): string {
    switch (p.sourceType) {
        case 'platform': return 'UniteFix stock';
        case 'approved_vendor': return p.vendorName || 'Approved vendor';
        case 'technician_local': return p.vendorName || 'Local shop (not named)';
        case 'customer_supplied': return 'Supplied by the customer';
        default: return p.vendorName || 'Unknown source';
    }
}

export default function PartsFitted({ bookingId }: { bookingId: number }) {
    const { data, isLoading } = useQuery({
        queryKey: ['job-parts', bookingId],
        queryFn: async () => (await partnerApi.getJobParts(bookingId)).data.data,
    });

    if (isLoading) {
        return <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: spacing.md }} />;
    }

    const items = data?.items ?? [];
    if (!items.length) return null;

    return (
        <View style={styles.card}>
            <View style={styles.head}>
                <Package size={17} color={colors.primary} />
                <Text style={styles.title}>Parts you fitted</Text>
            </View>

            {items.map(p => (
                <View key={p.id} style={styles.row}>
                    <View style={styles.rowTop}>
                        <Text style={styles.name}>
                            {p.partName}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
                            {p.brand ? <Text style={styles.brand}>  {p.brand}</Text> : null}
                        </Text>
                        <Text style={styles.price}>
                            ₹{((p.unitPricePaise * p.quantity) / 100).toFixed(0)}
                        </Text>
                    </View>

                    <Text style={styles.source}>{sourceOf(p)}</Text>

                    <View style={styles.coverRow}>
                        {p.isDocumented && p.warrantyDays > 0
                            ? <ShieldCheck size={13} color={colors.successDark} />
                            : <ShieldOff size={13} color={colors.textSecondary} />}
                        <Text style={styles.cover}>
                            {p.isDocumented && p.warrantyDays > 0
                                ? `Covered for ${p.warrantyDays} days`
                                : 'Not covered — no bill on file'}
                        </Text>
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md,
        marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
    title: { ...typography.bodySemibold, color: colors.textPrimary },
    row: {
        borderTopWidth: 1, borderTopColor: colors.border,
        paddingTop: spacing.sm, marginTop: spacing.sm,
    },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
    name: { ...typography.captionMedium, color: colors.textPrimary, flex: 1 },
    brand: { ...typography.caption, color: colors.textSecondary },
    price: { ...typography.captionMedium, color: colors.textPrimary },
    source: { ...typography.caption, color: colors.textPrimary, marginTop: 2 },
    coverRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    cover: { ...typography.caption, color: colors.textSecondary },
});
