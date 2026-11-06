/**
 * My Bookings → the customer's open free-quote enquiries, above the bookings:
 * what they asked for, and who will call. Hidden when there are none.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareQuote } from 'lucide-react-native';
import { customerApi, type ServiceEnquiry } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

const statusLine = (e: ServiceEnquiry) =>
    e.status === 'new' ? 'Sent to partners near you — waiting for one to take it'
        : e.status === 'taken' || e.status === 'forwarded' ? `${e.partnerName ?? 'A UniteFix partner'} will call you`
            : e.status === 'contacted' ? `${e.partnerName ?? 'UniteFix'} has called you`
                : 'Closed';

export function EnquiriesStrip() {
    const q = useQuery({ queryKey: ['myEnquiries'], queryFn: async () => (await customerApi.getMyEnquiries()).data.data ?? [], refetchInterval: 30_000, retry: 1 });
    const open = (q.data ?? []).filter(e => e.status !== 'closed');
    if (!open.length) return null;
    return (
        <View style={styles.wrap}>
            <Text style={styles.title}>Your enquiries</Text>
            {open.map(e => (
                <View key={e.id} style={styles.card}>
                    <View style={styles.icon}><MessageSquareQuote size={18} color={colors.accentDark} /></View>
                    <View style={styles.body}>
                        <Text style={styles.name} numberOfLines={1}>{e.serviceName} <Text style={styles.ref}>{e.ref}</Text></Text>
                        <Text style={styles.details} numberOfLines={1}>{e.details}</Text>
                        <Text style={[styles.status, e.status !== 'new' && styles.statusOn]}>{statusLine(e)}</Text>
                    </View>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: spacing.lg, gap: spacing.sm },
    title: { ...typography.label, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
    card: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.accentLight },
    icon: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0, gap: 2 },
    name: { ...typography.bodySemibold, color: colors.textPrimary },
    ref: { ...typography.small, color: colors.textTertiary, fontWeight: '400' },
    details: { ...typography.caption, color: colors.textSecondary },
    status: { ...typography.small, color: colors.textSecondary },
    statusOn: { color: colors.accentDark, fontWeight: '700' },
});
