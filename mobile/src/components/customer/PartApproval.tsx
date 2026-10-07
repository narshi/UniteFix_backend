/**
 * The customer's side of a spare part: what it is, why, the warranty, what
 * they pay — and two answers. Nothing about shops, stock or paperwork; that is
 * the technician's business.
 *
 * Shown on the booking while the work is in progress. A request waiting on the
 * customer is the first thing on the screen; decided ones collapse to a line.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Clock, Info } from 'lucide-react-native';
import { customerApi, PartApprovalRequest } from '../../api/customer.api';
import { getApiErrorMessage } from '../../api/client';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from '../ui';

const rs = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const REJECT_REASONS = ['Too expensive', "I'll get the part myself", 'I have a question', "I don't think it's needed"];

export const customerPartRequestsKey = (bookingId: number) => ['customer.partRequests', bookingId];

export default function PartApproval({ bookingId, live }: { bookingId: number; live: boolean }) {
    const qc = useQueryClient();
    const { data } = useQuery({
        queryKey: customerPartRequestsKey(bookingId),
        queryFn: async () => (await customerApi.getPartRequests(bookingId)).data.data,
        // The technician is usually standing in the room: while work is going on a
        // new request should appear without a refresh. After the bill, nothing new can arrive.
        refetchInterval: live ? 5000 : false,
    });
    const list = data ?? [];
    if (!list.length) return null;
    const pending = list.filter(r => r.status === 'pending');
    const decided = list.filter(r => r.status !== 'pending');

    return (
        <View style={styles.wrap}>
            {pending.map(r => <PendingRequest key={r.id} r={r} onDone={() => qc.invalidateQueries({ queryKey: customerPartRequestsKey(bookingId) })} />)}
            {decided.length > 0 && (
                <View style={styles.history}>
                    <Text style={styles.historyTitle}>Spare parts</Text>
                    {decided.map(r => (
                        <View key={r.id} style={styles.historyRow}>
                            {r.status === 'approved' ? <CheckCircle2 size={16} color={colors.successDark} />
                                : r.status === 'rejected' ? <XCircle size={16} color={colors.errorDark} /> : <Clock size={16} color={colors.textSecondary} />}
                            <Text style={styles.historyName} numberOfLines={1}>{r.items.map(i => i.partName).join(', ')}</Text>
                            <Text style={[styles.historyState, { color: r.status === 'approved' ? colors.successDark : colors.textSecondary }]}>
                                {r.status === 'approved' ? `Approved · ${rs(r.total)}` : r.status === 'rejected' ? 'Rejected' : 'Expired'}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

function PendingRequest({ r, onDone }: { r: PartApprovalRequest; onDone: () => void }) {
    const [mode, setMode] = useState<'ask' | 'reject'>('ask');
    const [why, setWhy] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const item = r.items[0];
    const many = r.items.length > 1;
    const title = many ? `${r.items.length} spare parts` : `${item.partName}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`;

    const decide = async (approve: boolean) => {
        setBusy(approve ? 'approve' : 'reject'); setError(null);
        try {
            if (approve) await customerApi.approvePartRequest(r.id);
            else await customerApi.rejectPartRequest(r.id, [why, note.trim()].filter(Boolean).join(' — ') || undefined);
            onDone();
        } catch (e) {
            setError(getApiErrorMessage(e));
            onDone();
        } finally {
            setBusy(null);
        }
    };

    return (
        <View style={styles.card} accessibilityLabel="Spare part approval required">
            <Text style={styles.eyebrow}>Your approval is needed</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>Your technician needs {many ? 'these parts' : 'this part'} for your service.</Text>

            {many && r.items.map((i, n) => (
                <View key={n} style={styles.itemRow}>
                    <Text style={styles.itemName}>{i.partName}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</Text>
                    <Text style={styles.itemPrice}>{rs(i.lineTotal)}</Text>
                </View>
            ))}

            {!!r.reason && (
                <View style={styles.block}>
                    <Text style={styles.blockLabel}>Why it is needed</Text>
                    <Text style={styles.reason}>{r.reason}</Text>
                </View>
            )}

            <View style={styles.block}>
                <Text style={styles.blockLabel}>Warranty</Text>
                {r.items.map((i, n) => (
                    <View key={n} style={styles.warrantyRow}>
                        {i.warranty.covered ? <ShieldCheck size={16} color={colors.successDark} /> : <ShieldAlert size={16} color={colors.textSecondary} />}
                        <Text style={[styles.warranty, { color: i.warranty.covered ? colors.successDark : colors.textSecondary }]}>{many ? `${i.partName}: ` : ''}{i.warranty.label}</Text>
                    </View>
                ))}
            </View>

            {r.earlierWarranty && (
                <View style={styles.notice}>
                    <Info size={16} color={colors.info} />
                    <Text style={styles.noticeText}>
                        A {r.earlierWarranty.partName} fitted on your booking {r.earlierWarranty.jobRef} is under warranty until {day(r.earlierWarranty.warrantyUntil)}. If this replaces it, you should not be charged — reject and ask your technician.
                    </Text>
                </View>
            )}

            <View style={styles.payRow}>
                <View>
                    <Text style={styles.payLabel}>You pay</Text>
                    <Text style={styles.payHint}>incl. {rs(r.gst)} GST · added to your final bill</Text>
                </View>
                <Text style={styles.payValue}>{rs(r.total)}</Text>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {mode === 'ask' ? (
                <View style={styles.actions}>
                    <Button title={`Approve ${rs(r.total)}`} onPress={() => decide(true)} loading={busy === 'approve'} disabled={!!busy} />
                    <TouchableOpacity style={styles.secondary} onPress={() => setMode('reject')} disabled={!!busy} accessibilityRole="button">
                        <Text style={styles.secondaryText}>Reject or ask a question</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={styles.actions}>
                    <Text style={styles.blockLabel}>Tell your technician why</Text>
                    <View style={styles.chips}>
                        {REJECT_REASONS.map(x => {
                            const on = why === x;
                            return (
                                <TouchableOpacity key={x} style={[styles.chip, on && styles.chipOn]} onPress={() => setWhy(on ? null : x)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{x}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <TextInput
                        style={styles.input} placeholder="Add a message (optional)" placeholderTextColor={colors.textTertiary}
                        value={note} onChangeText={setNote} maxLength={200} accessibilityLabel="Message to your technician"
                    />
                    <Button title="Reject this part" variant="danger" onPress={() => decide(false)} loading={busy === 'reject'} disabled={!!busy} />
                    <TouchableOpacity style={styles.secondary} onPress={() => setMode('ask')} disabled={!!busy} accessibilityRole="button">
                        <Text style={styles.secondaryText}>Back</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: spacing.md, marginBottom: spacing.lg },
    card: { backgroundColor: colors.background, borderRadius: radii.xl, padding: spacing.lg, borderWidth: 1.5, borderColor: colors.warning, gap: spacing.md },
    eyebrow: { ...typography.captionMedium, color: colors.warningDark, textTransform: 'uppercase', letterSpacing: 0.6 },
    title: { ...typography.h2, color: colors.textPrimary, marginTop: -spacing.xs },
    sub: { ...typography.body, color: colors.textSecondary, marginTop: -spacing.sm },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
    itemName: { ...typography.body, color: colors.textPrimary, flex: 1 },
    itemPrice: { ...typography.body, color: colors.textPrimary },
    block: { gap: spacing.xs },
    blockLabel: { ...typography.label, color: colors.textSecondary },
    reason: { ...typography.body, color: colors.textPrimary },
    warrantyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    warranty: { ...typography.body, flex: 1 },
    notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.infoLight },
    noticeText: { ...typography.caption, color: colors.textPrimary, flex: 1, lineHeight: 18 },
    payRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
    payLabel: { ...typography.h4, color: colors.textPrimary },
    payHint: { ...typography.caption, color: colors.textSecondary },
    payValue: { ...typography.h2, color: colors.textPrimary },
    error: { ...typography.caption, color: colors.errorDark },
    actions: { gap: spacing.sm },
    secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { ...typography.bodyMedium, color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    chipText: { ...typography.captionMedium, color: colors.textSecondary },
    chipTextOn: { color: colors.primary },
    input: { height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.textPrimary },
    history: { backgroundColor: colors.background, borderRadius: radii.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
    historyTitle: { ...typography.h4, color: colors.textPrimary },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
    historyName: { ...typography.body, color: colors.textPrimary, flex: 1 },
    historyState: { ...typography.captionMedium },
});
