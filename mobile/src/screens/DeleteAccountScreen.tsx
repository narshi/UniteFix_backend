/**
 * Delete account — a request UniteFix reviews, not a one-tap delete.
 *
 * The person says why (a reason and a few words of their own), confirms they
 * understand what happens, and sends it. While it is pending they can see it
 * and withdraw it; if UniteFix denies it, the note explaining why is shown here
 * and they can ask again once it is sorted. Approval closes the account.
 * Shared by the customer and expert apps.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Square, Clock, XCircle, Info, CheckCircle2 } from 'lucide-react-native';
import { apiClient, getApiErrorMessage } from '../api/client';
import { Button, ScreenHeader } from '../components/ui';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing, radii } from '../theme/spacing';
import { useScreenInsets } from '../theme/layout';
import { useAuthStore } from '../stores/auth.store';

type Props = NativeStackScreenProps<any, 'DeleteAccount'>;
type Request = { id: number; status: 'pending' | 'approved' | 'denied' | 'cancelled'; reasonLabel: string | null; reason: string; adminNote: string | null; createdAt: string; decidedAt: string | null };
type State = { request: Request | null; reasons: Array<{ value: string; label: string }> };

const MIN = 10, MAX = 1000;
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function DeleteAccountScreen({ navigation }: Props) {
    const { scrollBottom } = useScreenInsets();
    const qc = useQueryClient();
    const isExpert = useAuthStore((s) => s.user?.role) === 'serviceman';
    const q = useQuery<State>({
        queryKey: ['account-deletion-request'],
        queryFn: async () => (await apiClient.get('/api/client/account/deletion-request')).data.data,
    });
    const [category, setCategory] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [understood, setUnderstood] = useState(false);
    const refresh = () => qc.invalidateQueries({ queryKey: ['account-deletion-request'] });

    const send = useMutation({
        mutationFn: async () => (await apiClient.post('/api/client/account/deletion-request', { reasonCategory: category, reason: reason.trim() })).data,
        onSuccess: (r: any) => { refresh(); setReason(''); setCategory(null); setUnderstood(false); Alert.alert('Request sent', r?.message ?? 'UniteFix will review it and let you know.'); },
        onError: (e) => Alert.alert('Not sent', getApiErrorMessage(e)),
    });
    const withdraw = useMutation({
        mutationFn: async () => (await apiClient.delete('/api/client/account/deletion-request')).data,
        onSuccess: (r: any) => { refresh(); Alert.alert('Request withdrawn', r?.message ?? 'Your account stays as it is.'); },
        onError: (e) => Alert.alert('Not withdrawn', getApiErrorMessage(e)),
    });
    const confirmWithdraw = () => Alert.alert('Withdraw your request?', 'Your account will stay open.', [
        { text: 'Keep request', style: 'cancel' },
        { text: 'Withdraw', onPress: () => withdraw.mutate() },
    ]);

    const req = q.data?.request ?? null;
    const pending = req?.status === 'pending';
    const ready = !!category && reason.trim().length >= MIN && understood;

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScreenHeader title="Delete account" onBack={() => navigation.goBack()} />
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]} keyboardShouldPersistTaps="handled">
                {q.isLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : q.isError ? (
                    <View style={styles.card}>
                        <Text style={styles.body}>Couldn't load your account details. Check your connection.</Text>
                        <Button title="Try again" variant="outline" onPress={() => q.refetch()} style={{ marginTop: spacing.md }} />
                    </View>
                ) : pending ? (
                    <View style={[styles.card, styles.pendingCard]}>
                        <View style={styles.statusHead}><Clock size={20} color={colors.warningDark} /><Text style={[styles.statusTitle, { color: colors.warningDark }]}>Request under review</Text></View>
                        <Text style={styles.body}>You asked on {when(req!.createdAt)}. UniteFix reviews requests within 2 working days and will notify you. Your account keeps working until then.</Text>
                        <View style={styles.quote}>
                            {req!.reasonLabel && <Text style={styles.quoteTitle}>{req!.reasonLabel}</Text>}
                            <Text style={styles.quoteText}>{req!.reason}</Text>
                        </View>
                        <Button title="Withdraw my request" variant="outline" onPress={confirmWithdraw} loading={withdraw.isPending} />
                    </View>
                ) : (
                    <>
                        {req?.status === 'denied' && (
                            <View style={[styles.card, styles.deniedCard]}>
                                <View style={styles.statusHead}><XCircle size={20} color={colors.errorDark} /><Text style={[styles.statusTitle, { color: colors.errorDark }]}>Your last request wasn't approved</Text></View>
                                {req.adminNote && <Text style={styles.body}>UniteFix: “{req.adminNote}”</Text>}
                                <Text style={[styles.hint, { marginTop: spacing.sm }]}>Once that's sorted, you can ask again below.</Text>
                            </View>
                        )}

                        <View style={styles.card}>
                            <View style={styles.statusHead}><Info size={20} color={colors.primary} /><Text style={styles.statusTitle}>What happens</Text></View>
                            {[
                                'Your request goes to the UniteFix team, who reply within 2 working days.',
                                isExpert
                                    ? 'Finish or hand back any open jobs, and withdraw your wallet balance first — we cannot close an account with money or work still open.'
                                    : 'Finish or cancel any open bookings and orders first — we cannot close an account with work still open.',
                                'Once approved, your account is closed and you are signed out everywhere. This cannot be undone.',
                                'Invoices and payment records are kept as the law requires. Signing up again later with the same number starts a fresh account.',
                            ].map((t) => (
                                <View key={t} style={styles.bullet}><Text style={styles.dot}>•</Text><Text style={styles.bulletText}>{t}</Text></View>
                            ))}
                        </View>

                        <View style={styles.card}>
                            <Text style={styles.label}>Why are you leaving?</Text>
                            <View style={styles.chips}>
                                {(q.data?.reasons ?? []).map((r) => {
                                    const on = category === r.value;
                                    return (
                                        <Pressable key={r.value} onPress={() => setCategory(r.value)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>

                            <Text style={[styles.label, { marginTop: spacing.lg }]}>Tell us more</Text>
                            <TextInput
                                style={styles.input}
                                value={reason}
                                onChangeText={(t) => setReason(t.slice(0, MAX))}
                                placeholder="What went wrong, or what could we have done better?"
                                placeholderTextColor={colors.textDisabled}
                                multiline
                                textAlignVertical="top"
                                accessibilityLabel="Describe why you want to delete your account"
                            />
                            <Text style={[styles.counter, reason.trim().length > 0 && reason.trim().length < MIN && { color: colors.errorDark }]}>
                                {reason.trim().length < MIN ? `At least ${MIN} characters` : `${reason.length}/${MAX}`}
                            </Text>

                            <Pressable style={styles.confirm} onPress={() => setUnderstood(!understood)} accessibilityRole="checkbox" accessibilityState={{ checked: understood }}>
                                {understood ? <CheckSquare size={22} color={colors.error} /> : <Square size={22} color={colors.textSecondary} />}
                                <Text style={styles.confirmText}>I understand my account will be closed for good once UniteFix approves this.</Text>
                            </Pressable>

                            <Button title="Send deletion request" variant="danger" onPress={() => send.mutate()} loading={send.isPending} disabled={!ready} style={{ marginTop: spacing.lg }} />
                        </View>

                        {req?.status === 'cancelled' && (
                            <View style={styles.note}><CheckCircle2 size={16} color={colors.textSecondary} /><Text style={styles.hint}>You withdrew an earlier request on {when(req.decidedAt)}.</Text></View>
                        )}
                    </>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    content: { padding: spacing.lg, gap: spacing.md },
    card: { backgroundColor: colors.background, borderRadius: radii.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
    pendingCard: { borderColor: colors.warning, backgroundColor: colors.warningLight },
    deniedCard: { borderColor: colors.error, backgroundColor: colors.errorLight },
    statusHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    statusTitle: { ...typography.h4, color: colors.textPrimary, flexShrink: 1 },
    body: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
    quote: { backgroundColor: colors.background, borderRadius: radii.md, padding: spacing.md, marginVertical: spacing.md },
    quoteTitle: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: 2 },
    quoteText: { ...typography.body, color: colors.textSecondary },
    bullet: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
    dot: { ...typography.body, color: colors.textSecondary },
    bulletText: { ...typography.body, color: colors.textSecondary, flex: 1, lineHeight: 21 },
    label: { ...typography.bodySemibold, color: colors.textPrimary, marginBottom: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: radii.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
    chipOn: { borderColor: colors.error, backgroundColor: colors.errorLight },
    chipText: { ...typography.caption, color: colors.textPrimary },
    chipTextOn: { color: colors.errorDark, fontWeight: '600' },
    input: { minHeight: 110, borderWidth: 1.5, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface },
    counter: { ...typography.caption, color: colors.textTertiary, textAlign: 'right', marginTop: spacing.xs },
    confirm: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
    confirmText: { ...typography.body, color: colors.textPrimary, flex: 1, lineHeight: 21 },
    hint: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
    note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
});
