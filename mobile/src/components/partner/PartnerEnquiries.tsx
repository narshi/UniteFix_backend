/**
 * Partner app → Jobs → Enquiries: free-quote requests from customers in the
 * partner's pincodes. Take one to get the customer's number, then call.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareQuote, Phone } from 'lucide-react-native';
import { partnerHubApi, type HubEnquiry } from '../../api/partnerHub.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { EmptyState } from '../ui';

const LABEL: Record<string, string> = { open: 'Open', new: 'Open', taken: 'Yours', forwarded: 'From UniteFix', contacted: 'Called', closed: 'Closed', taken_by_other: 'Taken by another partner' };

export function PartnerEnquiries({ bottomPadding }: { bottomPadding: number }) {
    const qc = useQueryClient();
    const [busy, setBusy] = useState<number | null>(null);
    const q = useQuery({ queryKey: ['hub-enquiries'], queryFn: async () => (await partnerHubApi.enquiries()).data.data, refetchInterval: 30_000 });
    const run = async (id: number, fn: () => Promise<unknown>, done: string) => {
        setBusy(id);
        try { await fn(); qc.invalidateQueries({ queryKey: ['hub-enquiries'] }); Alert.alert(done); }
        catch (e) { Alert.alert('Not done', getApiErrorMessage(e)); }
        finally { setBusy(null); }
    };
    if (q.isLoading) return <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />;
    return (
        <FlatList
            data={q.data ?? []}
            keyExtractor={e => String(e.id)}
            contentContainerStyle={[styles.list, { paddingBottom: bottomPadding }]}
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} colors={[colors.primary]} tintColor={colors.primary} />}
            ListEmptyComponent={<EmptyState icon={<MessageSquareQuote size={40} color={colors.textDisabled} />} title="No enquiries yet" description="Customers in your pincodes who ask for quotes on services you list appear here." />}
            renderItem={({ item: e }: { item: HubEnquiry }) => {
                const mine = !!e.customer;
                return (
                    <View style={styles.card}>
                        <View style={styles.top}>
                            <Text style={styles.name} numberOfLines={1}>{e.serviceName}</Text>
                            <Text style={[styles.tag, (e.status === 'open' || e.status === 'new') && styles.tagOpen, mine && styles.tagMine]}>{LABEL[e.status] ?? e.status}</Text>
                        </View>
                        <Text style={styles.details}>{e.details}</Text>
                        <Text style={styles.meta}>{[e.ref, e.pincode, e.preferredDate && `for ${e.preferredDate}`, e.budget && `budget ${e.budget}`].filter(Boolean).join(' · ')}</Text>
                        {mine && (
                            <TouchableOpacity style={styles.call} onPress={() => e.customer?.phone && Linking.openURL(`tel:${e.customer.phone}`)} accessibilityRole="button">
                                <Phone size={16} color={colors.primary} />
                                <Text style={styles.callText}>{e.customer!.name ?? 'Customer'} · {e.customer!.phone ?? '—'}</Text>
                            </TouchableOpacity>
                        )}
                        <View style={styles.actions}>
                            {(e.status === 'open' || e.status === 'new') && (
                                <TouchableOpacity style={styles.primary} disabled={busy === e.id} onPress={() => run(e.id, () => partnerHubApi.takeEnquiry(e.id), 'It is yours — call the customer.')}>
                                    <Text style={styles.primaryText}>{busy === e.id ? 'Taking…' : 'Take it'}</Text>
                                </TouchableOpacity>
                            )}
                            {mine && (e.status === 'taken' || e.status === 'forwarded') && (
                                <TouchableOpacity style={styles.secondary} disabled={busy === e.id} onPress={() => run(e.id, () => partnerHubApi.updateEnquiry(e.id, 'contacted'), 'Marked as called')}>
                                    <Text style={styles.secondaryText}>I called them</Text>
                                </TouchableOpacity>
                            )}
                            {mine && e.status !== 'closed' && (
                                <TouchableOpacity style={styles.secondary} disabled={busy === e.id} onPress={() => run(e.id, () => partnerHubApi.updateEnquiry(e.id, 'closed'), 'Closed')}>
                                    <Text style={styles.secondaryText}>Close</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                );
            }}
        />
    );
}

const styles = StyleSheet.create({
    list: { padding: spacing.base, gap: spacing.md },
    card: { backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    name: { ...typography.bodySemibold, color: colors.textPrimary, flex: 1 },
    tag: { ...typography.small, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 2, overflow: 'hidden' },
    tagOpen: { color: colors.warningDark, backgroundColor: colors.warningLight },
    tagMine: { color: colors.accentDark, backgroundColor: colors.accentLight },
    details: { ...typography.caption, color: colors.textPrimary },
    meta: { ...typography.small, color: colors.textTertiary },
    call: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.primarySurface },
    callText: { ...typography.captionMedium, color: colors.primary },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
    primary: { backgroundColor: colors.primary, borderRadius: radii.full, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
    primaryText: { ...typography.buttonSmall, color: colors.textInverse },
    secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.full, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
    secondaryText: { ...typography.buttonSmall, color: colors.textPrimary },
});
