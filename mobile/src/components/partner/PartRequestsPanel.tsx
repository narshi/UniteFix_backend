/**
 * Spare parts on the job, by their state with the customer.
 *
 * Every request says plainly where it stands — waiting, approved, rejected,
 * no answer — so the technician never has to guess whether they may fit a
 * part or bill it. While one is waiting the screen checks every few seconds.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Clock, CheckCircle2, XCircle, TimerOff } from 'lucide-react-native';
import { partnerApi, PartRequest } from '../../api/partner.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import AddPartSheet from './AddPartSheet';

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const ago = (iso: string) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

export const partRequestsKey = (bookingId: number) => ['partner.partRequests', bookingId];

/** The job's requests; refreshes every 4 s while the customer is deciding. */
export function usePartRequests(bookingId: number | undefined, enabled: boolean) {
    return useQuery({
        queryKey: partRequestsKey(bookingId ?? 0),
        queryFn: async () => (await partnerApi.getPartRequests(bookingId!)).data.data,
        enabled: !!bookingId && enabled,
        refetchInterval: (q) => ((q.state.data ?? []).some(r => r.status === 'pending') ? 4000 : 30000),
        retry: 1,
    });
}

/** Totals the job screen needs: what approved parts add, and whether anything is still waiting. */
export function partRequestTotals(list: PartRequest[] | undefined) {
    const live = list ?? [];
    return {
        approvedTotal: live.filter(r => r.status === 'approved').reduce((a, r) => a + r.total, 0),
        pending: live.filter(r => r.status === 'pending').length,
    };
}

export default function PartRequestsPanel({ bookingId, requests, loading, error }: { bookingId: number; requests: PartRequest[] | undefined; loading: boolean; error: boolean }) {
    const qc = useQueryClient();
    const [sheet, setSheet] = useState(false);
    const [busy, setBusy] = useState<number | null>(null);
    const refresh = () => qc.invalidateQueries({ queryKey: partRequestsKey(bookingId) });
    const shown = (requests ?? []).filter(r => r.status !== 'cancelled');

    const withdraw = (r: PartRequest) => {
        Alert.alert(
            r.status === 'approved' ? 'Remove this part?' : 'Withdraw this request?',
            r.status === 'approved' ? 'The customer approved it. Removing it takes it off their bill, and they are told.' : 'The customer will no longer see it.',
            [{ text: 'Keep', style: 'cancel' }, {
                text: r.status === 'approved' ? 'Remove' : 'Withdraw', style: 'destructive', onPress: async () => {
                    setBusy(r.id);
                    try { await partnerApi.cancelPartRequest(r.id); refresh(); }
                    catch (e) { Alert.alert('Not withdrawn', getApiErrorMessage(e)); }
                    finally { setBusy(null); }
                },
            }],
        );
    };

    return (
        <View style={styles.wrap}>
            <View style={styles.head}>
                <Text style={styles.title}>Spare parts</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setSheet(true)} accessibilityRole="button">
                    <Plus size={16} color={colors.primary} />
                    <Text style={styles.addText}>Add part</Text>
                </TouchableOpacity>
            </View>

            {loading && !requests ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
                : error && !requests ? <Text style={styles.error}>Could not load spare parts. Pull down to refresh.</Text>
                    : !shown.length ? <Text style={styles.empty}>Need a part? Add it here — the customer approves it in their app before it goes on the bill.</Text>
                        : shown.map(r => {
                            const names = r.items.map(i => `${i.partName}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ');
                            const state = r.status === 'pending'
                                ? { icon: <Clock size={18} color={colors.warningDark} />, text: `Waiting for customer approval · sent ${ago(r.sentAt)}`, color: colors.warningDark }
                                : r.status === 'approved'
                                    ? { icon: <CheckCircle2 size={18} color={colors.successDark} />, text: `Customer approved · ${at(r.decidedAt)}`, color: colors.successDark }
                                    : r.status === 'rejected'
                                        ? { icon: <XCircle size={18} color={colors.errorDark} />, text: 'Customer rejected', color: colors.errorDark }
                                        : { icon: <TimerOff size={18} color={colors.textSecondary} />, text: 'No answer in time', color: colors.textSecondary };
                            return (
                                <View key={r.id} style={styles.row}>
                                    <View style={styles.icon}>{state.icon}</View>
                                    <View style={styles.body}>
                                        <View style={styles.line}>
                                            <Text style={[styles.name, (r.status === 'rejected' || r.status === 'expired') && styles.faded]} numberOfLines={2}>{names}</Text>
                                            <Text style={[styles.amount, (r.status === 'rejected' || r.status === 'expired') && styles.struck]}>{rs(r.total)}</Text>
                                        </View>
                                        <Text style={[styles.state, { color: state.color }]}>{state.text}</Text>
                                        {r.status === 'rejected' && !!r.customerNote && <Text style={styles.note}>“{r.customerNote}”</Text>}
                                        <View style={styles.actions}>
                                            {(r.status === 'pending' || r.status === 'approved') && (
                                                <TouchableOpacity onPress={() => withdraw(r)} disabled={busy === r.id} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                                    <Text style={styles.actionMuted}>{busy === r.id ? 'Withdrawing…' : r.status === 'approved' ? 'Remove' : 'Withdraw'}</Text>
                                                </TouchableOpacity>
                                            )}
                                            {(r.status === 'rejected' || r.status === 'expired') && (
                                                <TouchableOpacity onPress={() => setSheet(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                                    <Text style={styles.action}>Send a new request</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                </View>
                            );
                        })}

            <AddPartSheet visible={sheet} bookingId={bookingId} onClose={() => setSheet(false)} onSent={() => refresh()} />
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: spacing.lg },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    title: { ...typography.h4, color: colors.textPrimary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.primarySurface },
    addText: { ...typography.captionMedium, color: colors.primary },
    empty: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
    error: { ...typography.caption, color: colors.errorDark },
    row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    icon: { paddingTop: 2 },
    body: { flex: 1, gap: 2 },
    line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    name: { ...typography.bodyMedium, color: colors.textPrimary, flex: 1 },
    faded: { color: colors.textSecondary },
    amount: { ...typography.bodySemibold, color: colors.textPrimary },
    struck: { color: colors.textTertiary, textDecorationLine: 'line-through' },
    state: { ...typography.caption },
    note: { ...typography.caption, color: colors.textSecondary, fontStyle: 'italic' },
    actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
    action: { ...typography.captionMedium, color: colors.primary },
    actionMuted: { ...typography.captionMedium, color: colors.textSecondary },
});
