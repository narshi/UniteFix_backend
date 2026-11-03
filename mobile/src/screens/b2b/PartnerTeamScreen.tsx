/**
 * Team — the partner's technicians, the commission the partner earns on each
 * of their jobs, and switching people on and off. The owner can add himself
 * ("This is me") on his own login and take jobs like any technician, with no
 * commission on his own work. Documents are uploaded from the web Hub.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Alert, Switch, TextInput } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react-native';
import { partnerHubApi, commissionText, type Commission, type HubTechnician } from '../../api/partnerHub.api';
import { getApiErrorMessage } from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button } from '../../components/ui';

type Mode = 'default' | Commission['type'];
const VER: Record<string, { label: string; color: string }> = {
    verified: { label: 'Verified', color: colors.successDark },
    pending: { label: 'Waiting for UniteFix to verify', color: colors.warningDark },
    rejected: { label: 'Documents rejected', color: colors.errorDark },
    suspended: { label: 'Suspended by UniteFix', color: colors.errorDark },
};

export function PartnerTeamScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const qc = useQueryClient();
    const myPhone = useAuthStore(s => s.user?.phone ?? '');
    const team = useQuery({ queryKey: ['hub-team'], queryFn: async () => (await partnerHubApi.technicians()).data.data });
    const settings = useQuery({ queryKey: ['hub-field-settings'], queryFn: async () => (await partnerHubApi.settings()).data.data });
    const def = settings.data?.commission ?? null;

    const [defEdit, setDefEdit] = useState<null | { type: Commission['type']; value: string }>(null);
    const [cFor, setCFor] = useState<null | { t: HubTechnician; mode: Mode; value: string }>(null);
    const [adding, setAdding] = useState<null | { fullName: string; phone: string; isOwner: boolean }>(null);
    const [busy, setBusy] = useState(false);
    const refresh = () => { qc.invalidateQueries({ queryKey: ['hub-team'] }); qc.invalidateQueries({ queryKey: ['hub-field-settings'] }); };
    const hasOwner = (team.data ?? []).some(t => t.isOwner);

    const run = async (fn: () => Promise<unknown>, ok: string, failTitle: string) => {
        setBusy(true);
        try { await fn(); refresh(); Alert.alert(ok); return true; }
        catch (e) { Alert.alert(failTitle, getApiErrorMessage(e)); return false; }
        finally { setBusy(false); }
    };

    const toggle = (t: HubTechnician) => run(() => partnerHubApi.updateTechnician(t.id, { isActive: !t.isActive }), t.isActive ? 'Switched off' : 'Switched on', 'Not changed');

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <View style={styles.titleRow}>
                    <Text style={styles.title}>Team</Text>
                    <TouchableOpacity style={styles.addBtn} onPress={() => setAdding({ fullName: '', phone: '', isOwner: false })} accessibilityRole="button">
                        <Plus size={16} color={colors.primary} /><Text style={styles.addText}>Add</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabContent }]}
                refreshControl={<RefreshControl refreshing={team.isRefetching} onRefresh={() => { team.refetch(); settings.refetch(); }} colors={[colors.primary]} tintColor={colors.primary} />}>

                <View style={styles.card}>
                    <Text style={styles.cardTitle}>Your commission</Text>
                    <Text style={styles.meta}>What you earn from each job your technicians finish. UniteFix holds it 7 days, then adds it to your account. The rest goes to the technician’s own UniteFix wallet.</Text>
                    {!def ? <ActivityIndicator color={colors.primary} /> : !defEdit ? (
                        <View style={styles.row}>
                            <Text style={styles.big}>{def.type === 'fixed' ? `₹${def.value} a job` : `${def.value}% of each job`}</Text>
                            <TouchableOpacity onPress={() => setDefEdit({ type: def.type, value: String(def.value) })} accessibilityRole="button"><Text style={styles.link}>Change</Text></TouchableOpacity>
                        </View>
                    ) : (
                        <View style={{ gap: spacing.sm }}>
                            <TypeToggle value={defEdit.type} onChange={type => setDefEdit({ ...defEdit, type })} />
                            <TextInput style={styles.input} value={defEdit.value} onChangeText={v => setDefEdit({ ...defEdit, value: v.replace(/[^\d.]/g, '') })} keyboardType="numeric" placeholder={defEdit.type === 'fixed' ? '₹ per job' : 'Percent'} placeholderTextColor={colors.textDisabled} accessibilityLabel="Commission" />
                            <View style={styles.row}>
                                <Button title="Cancel" variant="outline" onPress={() => setDefEdit(null)} />
                                <Button title="Save" loading={busy} disabled={defEdit.value === ''} onPress={async () => { if (await run(() => partnerHubApi.saveCommission({ type: defEdit.type, value: Number(defEdit.value) }), 'Commission saved', 'Not saved')) setDefEdit(null); }} />
                            </View>
                        </View>
                    )}
                </View>

                {team.isLoading ? <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.primary} /> : !(team.data ?? []).length ? (
                    <Text style={styles.empty}>No technicians yet. Tap Add — with their mobile number, which is their login to the UniteFix app. Add yourself too if you do jobs.</Text>
                ) : (team.data ?? []).map(t => {
                    const v = VER[t.verification] ?? { label: t.verification, color: colors.textSecondary };
                    const missing = [!t.documents.aadhaar && 'ID', !t.documents.pan && 'PAN', !t.documents.photo && 'photo'].filter(Boolean);
                    return (
                        <View key={t.id} style={styles.card}>
                            <View style={styles.row}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={styles.name}>{t.fullName}{t.isOwner ? ' (you)' : ''}</Text>
                                    <Text style={styles.meta}>{t.phone} · {t.completed} done · {t.activeJobs} active</Text>
                                </View>
                                <Switch value={t.isActive} onValueChange={() => { toggle(t); }} disabled={busy || (!t.isActive && t.verification !== 'verified')} accessibilityLabel={`${t.fullName} available for jobs`} />
                            </View>
                            <Text style={[styles.meta, { color: v.color }]}>{v.label}{t.verification === 'rejected' && t.adminRemarks ? `: ${t.adminRemarks}` : ''}</Text>
                            {missing.length > 0 && <Text style={styles.meta}>Still needed: {missing.join(', ')} — upload them in the Partner Hub on the web.</Text>}
                            {t.isOwner ? <Text style={styles.meta}>No commission on your own jobs.</Text> : (
                                <TouchableOpacity onPress={() => setCFor({ t, mode: t.commission ? t.commission.type : 'default', value: String(t.commission?.value ?? def?.value ?? '') })} accessibilityRole="button">
                                    <Text style={styles.link}>Your commission: {t.commission ? commissionText(t.commission) : def ? `${commissionText(def)} (default)` : 'default'} · change</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    );
                })}
            </ScrollView>

            {/* One technician's commission */}
            <Modal visible={!!cFor} transparent animationType="slide" onRequestClose={() => setCFor(null)} statusBarTranslucent>
                <View style={styles.backdrop}><View style={styles.sheet}>
                    <View style={styles.sheetHead}><Text style={styles.sheetTitle}>Commission from {cFor?.t.fullName}</Text><TouchableOpacity onPress={() => setCFor(null)} accessibilityLabel="Close"><X size={22} color={colors.textPrimary} /></TouchableOpacity></View>
                    {cFor && (<>
                        {(['default', 'percent', 'fixed'] as Mode[]).map(m => (
                            <TouchableOpacity key={m} style={[styles.option, cFor.mode === m && styles.optionOn]} onPress={() => setCFor({ ...cFor, mode: m })} accessibilityRole="radio" accessibilityState={{ checked: cFor.mode === m }}>
                                <Text style={styles.optionText}>{m === 'default' ? `Your default${def ? ` (${commissionText(def)})` : ''}` : m === 'percent' ? 'Percentage of the job' : 'Fixed ₹ per job'}</Text>
                            </TouchableOpacity>
                        ))}
                        {cFor.mode !== 'default' && <TextInput style={styles.input} value={cFor.value} onChangeText={v => setCFor({ ...cFor, value: v.replace(/[^\d.]/g, '') })} keyboardType="numeric" placeholder={cFor.mode === 'fixed' ? '₹ per job' : 'Percent'} placeholderTextColor={colors.textDisabled} accessibilityLabel="Commission" />}
                        <Button title="Save" loading={busy} disabled={cFor.mode !== 'default' && cFor.value === ''} onPress={async () => {
                            if (await run(() => partnerHubApi.updateTechnician(cFor.t.id, { commission: cFor.mode === 'default' ? null : { type: cFor.mode as Commission['type'], value: Number(cFor.value) } }), 'Commission saved', 'Not saved')) setCFor(null);
                        }} style={{ marginTop: spacing.sm }} />
                    </>)}
                </View></View>
            </Modal>

            {/* Add a technician, or yourself */}
            <Modal visible={!!adding} transparent animationType="slide" onRequestClose={() => setAdding(null)} statusBarTranslucent>
                <View style={styles.backdrop}><View style={styles.sheet}>
                    <View style={styles.sheetHead}><Text style={styles.sheetTitle}>Add to your team</Text><TouchableOpacity onPress={() => setAdding(null)} accessibilityLabel="Close"><X size={22} color={colors.textPrimary} /></TouchableOpacity></View>
                    {adding && (<>
                        {!hasOwner && (
                            <View style={styles.row}>
                                <Text style={[styles.optionText, { flex: 1 }]}>This is me — I do jobs myself (no commission on my own jobs)</Text>
                                <Switch value={adding.isOwner} onValueChange={v => setAdding({ ...adding, isOwner: v, phone: v ? myPhone.replace(/\D/g, '').slice(-10) : adding.phone })} accessibilityLabel="This is me" />
                            </View>
                        )}
                        <TextInput style={styles.input} value={adding.fullName} onChangeText={v => setAdding({ ...adding, fullName: v })} placeholder="Full name" placeholderTextColor={colors.textDisabled} accessibilityLabel="Full name" />
                        <TextInput style={styles.input} value={adding.phone} onChangeText={v => setAdding({ ...adding, phone: v.replace(/\D/g, '').slice(-10) })} keyboardType="phone-pad" placeholder="Mobile number (their app login)" placeholderTextColor={colors.textDisabled} editable={!adding.isOwner} accessibilityLabel="Mobile number" />
                        <Text style={styles.meta}>{adding.isOwner ? 'You stay on this login. Use "Work as technician" on Jobs to work the jobs you take.' : 'They sign in to the UniteFix app with this number. UniteFix verifies their documents before their first job.'}</Text>
                        <Button title="Add" loading={busy} disabled={adding.fullName.trim().length < 2 || adding.phone.length !== 10} onPress={async () => {
                            if (await run(() => partnerHubApi.addTechnician({ fullName: adding.fullName.trim(), phone: adding.phone, isOwner: adding.isOwner }), adding.isOwner ? 'You are on your team. Upload your documents in the web Hub for UniteFix to verify.' : 'Added. Upload their documents in the web Hub for UniteFix to verify.', 'Not added')) setAdding(null);
                        }} style={{ marginTop: spacing.sm }} />
                    </>)}
                </View></View>
            </Modal>
        </View>
    );
}

function TypeToggle({ value, onChange }: { value: Commission['type']; onChange: (t: Commission['type']) => void }) {
    return (
        <View style={styles.toggle}>
            {([['percent', '% of the job'], ['fixed', '₹ per job']] as const).map(([v, l]) => (
                <TouchableOpacity key={v} style={[styles.toggleBtn, value === v && styles.toggleOn]} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ checked: value === v }}>
                    <Text style={[styles.toggleText, value === v && { color: colors.textInverse }]}>{l}</Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...typography.h2, color: colors.textPrimary },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.primarySurface },
    addText: { ...typography.captionMedium, color: colors.primary },
    body: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.sm },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 6 },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    big: { ...typography.h4, color: colors.textPrimary, flexShrink: 1 },
    name: { ...typography.bodySemibold, color: colors.textPrimary },
    meta: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
    link: { ...typography.captionMedium, color: colors.primary },
    empty: { ...typography.body, color: colors.textSecondary, marginTop: spacing.lg },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, minHeight: 48, ...typography.body, color: colors.textPrimary, backgroundColor: colors.background },
    toggle: { flexDirection: 'row', gap: spacing.xs },
    toggleBtn: { flex: 1, minHeight: 40, borderRadius: radii.full, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    toggleOn: { backgroundColor: colors.primary },
    toggleText: { ...typography.captionMedium, color: colors.primary },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], padding: spacing.xl, gap: spacing.sm },
    sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
    sheetTitle: { ...typography.h4, color: colors.textPrimary, flexShrink: 1 },
    option: { padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
    optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
    optionText: { ...typography.body, color: colors.textPrimary },
});
