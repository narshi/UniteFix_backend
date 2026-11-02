/**
 * A job that does not finish in one visit.
 *
 *   - Paused: when the expert comes back, and "Resume work" (no new OTP).
 *   - Continue another day: pick the day (tomorrow to 2 weeks) and say what
 *     was done; the customer is told.
 *   - Could not fix: say why; the expert earns the visit pay and the job goes
 *     to another expert.
 *   - Follow-up: what the earlier expert found, for whoever comes next.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, AlertTriangle, X } from 'lucide-react-native';
import { Assignment, partnerApi } from '../../api/partner.api';
import { partnerQueryKeys } from '../../hooks/usePartnerData';
import { getApiErrorMessage } from '../../api/client';
import { Button } from '../ui';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

const IST_MS = 5.5 * 3_600_000;
const dayAhead = (n: number) => new Date(Date.now() + IST_MS + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Banner for a paused job, and what an earlier expert found on a follow-up. Shown above the actions. */
export function JobProgressNotes({ assignment }: { assignment: Assignment }) {
    const qc = useQueryClient();
    const [busy, setBusy] = useState(false);
    const resume = async () => {
        setBusy(true);
        try { await partnerApi.resumeJob(assignment.id); await qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments }); }
        catch (e) { Alert.alert('Not resumed', getApiErrorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <>
            {(assignment.followUpCount ?? 0) > 0 && !!assignment.lastAttemptReason && (
                <View style={[styles.note, styles.warnNote]}>
                    <AlertTriangle size={18} color={colors.warningDark} />
                    <View style={styles.noteBody}>
                        <Text style={styles.noteTitle}>Follow-up job</Text>
                        <Text style={styles.noteText}>An earlier visit could not fix it: {assignment.lastAttemptReason}</Text>
                    </View>
                </View>
            )}
            {assignment.status === 'in_progress' && !!assignment.pausedUntil && (
                <View style={[styles.note, styles.infoNote]}>
                    <CalendarClock size={18} color={colors.primary} />
                    <View style={styles.noteBody}>
                        <Text style={styles.noteTitle}>Continues on {dayLabel(assignment.pausedUntil)}</Text>
                        {!!assignment.pauseNote && <Text style={styles.noteText}>Last visit: {assignment.pauseNote}</Text>}
                        <Button title="Resume work" onPress={resume} loading={busy} style={{ marginTop: spacing.sm }} />
                    </View>
                </View>
            )}
        </>
    );
}

/** "Continue another day" and "Could not fix it", under the job's main action. */
export default function JobProgressActions({ assignment, onLeft }: { assignment: Assignment; onLeft: () => void }) {
    const qc = useQueryClient();
    const { headerTop } = useScreenInsets();
    const [mode, setMode] = useState<null | 'later' | 'cannot'>(null);
    const [date, setDate] = useState(dayAhead(1));
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const open = (m: 'later' | 'cannot') => { setMode(m); setText(''); setDate(dayAhead(1)); };
    const canPause = assignment.status === 'in_progress' && !assignment.pausedUntil;
    const canFail = assignment.status === 'reached' || assignment.status === 'in_progress';
    if (!canPause && !canFail) return null;

    const submit = async () => {
        setBusy(true);
        try {
            if (mode === 'later') {
                const r = await partnerApi.continueLater(assignment.id, { date, note: text.trim() });
                await qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
                setMode(null);
                Alert.alert('Saved', r.data?.message ?? 'The customer has been told.');
            } else {
                const r = await partnerApi.cannotFix(assignment.id, text.trim());
                await qc.invalidateQueries({ queryKey: partnerQueryKeys.assignments });
                setMode(null);
                Alert.alert('Reported', r.data?.message ?? 'The job goes to another expert.', [{ text: 'OK', onPress: onLeft }]);
            }
        } catch (e) {
            Alert.alert(mode === 'later' ? 'Not saved' : 'Not reported', getApiErrorMessage(e));
        } finally { setBusy(false); }
    };

    return (
        <View style={styles.wrap}>
            {canPause && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => open('later')} accessibilityRole="button">
                    <CalendarClock size={16} color={colors.primary} />
                    <Text style={styles.linkText}>Continue another day</Text>
                </TouchableOpacity>
            )}
            {canFail && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => open('cannot')} accessibilityRole="button">
                    <AlertTriangle size={16} color={colors.errorDark} />
                    <Text style={[styles.linkText, { color: colors.errorDark }]}>Could not fix it</Text>
                </TouchableOpacity>
            )}

            <Modal visible={!!mode} animationType="slide" onRequestClose={() => setMode(null)} statusBarTranslucent>
                <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <View style={[styles.sheetHead, { paddingTop: headerTop }]}>
                        <Text style={styles.sheetTitle}>{mode === 'later' ? 'Continue another day' : 'Could not fix it'}</Text>
                        <TouchableOpacity onPress={() => setMode(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                            <X size={22} color={colors.textPrimary} />
                        </TouchableOpacity>
                    </View>
                    <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
                        {mode === 'later' ? (
                            <>
                                <Text style={styles.hint}>The job stays yours and stays open. The customer is told the day you come back. No new OTP is needed then.</Text>
                                <Text style={styles.label}>Which day do you come back?</Text>
                                <View style={styles.days}>
                                    {Array.from({ length: 7 }, (_, i) => dayAhead(i + 1)).map(d => (
                                        <TouchableOpacity key={d} onPress={() => setDate(d)} style={[styles.day, date === d && styles.daySel]} accessibilityRole="button" accessibilityState={{ selected: date === d }}>
                                            <Text style={[styles.dayText, date === d && styles.dayTextSel]}>{dayLabel(d)}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                                <Text style={styles.label}>What was done today, and what is left?</Text>
                            </>
                        ) : (
                            <>
                                <Text style={styles.hint}>The job goes to another expert. You earn the visit pay for this visit; the rest goes to whoever finishes it.</Text>
                                <Text style={styles.label}>What did you find, and why could it not be fixed?</Text>
                            </>
                        )}
                        <TextInput
                            style={styles.input} value={text} onChangeText={setText} multiline maxLength={mode === 'later' ? 300 : 500}
                            placeholder={mode === 'later' ? 'e.g. Wiring of two rooms done; kitchen tomorrow' : 'e.g. Motor shaft is bent; needs a lathe shop'}
                            placeholderTextColor={colors.textDisabled}
                            accessibilityLabel={mode === 'later' ? 'What was done today' : 'Why it could not be fixed'}
                        />
                        <Button
                            title={mode === 'later' ? `Continue on ${dayLabel(date)}` : 'Report and hand over'}
                            onPress={submit} loading={busy} disabled={busy || text.trim().length < (mode === 'later' ? 3 : 5)}
                            style={{ marginTop: spacing.md }}
                        />
                    </ScrollView>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginTop: spacing.md, gap: spacing.xs },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
    linkText: { ...typography.bodyMedium, color: colors.primary },
    note: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, marginBottom: spacing.md, borderWidth: 1 },
    warnNote: { backgroundColor: colors.warningLight ?? colors.surface, borderColor: colors.warningDark },
    infoNote: { backgroundColor: colors.primarySurface, borderColor: colors.primaryLight },
    noteBody: { flex: 1, minWidth: 0, gap: 2 },
    noteTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    noteText: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
    sheet: { flex: 1, backgroundColor: colors.background },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    sheetTitle: { ...typography.h3, color: colors.textPrimary },
    sheetBody: { padding: spacing.lg, gap: spacing.sm },
    hint: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
    label: { ...typography.captionMedium, color: colors.textPrimary, marginTop: spacing.sm },
    days: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    day: { paddingHorizontal: spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    daySel: { backgroundColor: colors.primary, borderColor: colors.primary },
    dayText: { ...typography.caption, color: colors.textPrimary },
    dayTextSel: { color: colors.textInverse },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, minHeight: 96, textAlignVertical: 'top', ...typography.body, color: colors.textPrimary, backgroundColor: colors.surface },
});
