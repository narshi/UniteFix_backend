/**
 * Jobs — the bookings UniteFix sends this partner. The owner assigns each one
 * to a technician, or takes it himself; jobs he takes are worked in
 * technician mode, with the same screens every UniteFix expert uses.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Alert, Linking, Share } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Phone, UserCheck, Wrench, X, Share2 } from 'lucide-react-native';
import { partnerHubApi, type HubJob, type HubJobView, type HubTechnician } from '../../api/partnerHub.api';
import { getApiErrorMessage } from '../../api/client';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { Button, EmptyState } from '../../components/ui';

const rs = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const VIEWS: Array<[HubJobView, string]> = [['queue', 'To assign'], ['active', 'In progress'], ['done', 'Done']];


/** The partner's customer link: customers who open it, or enter the code while booking, come to this partner. */
function ShareCard() {
    const q = useQuery({ queryKey: ['hub-share'], queryFn: async () => (await partnerHubApi.share()).data.data, staleTime: 5 * 60_000, retry: 1 });
    const d = q.data;
    if (!d) return null;
    const share = () => Share.share({ message: `Book me on the UniteFix app: ${d.link}\nPartner code: ${d.code}\nSame UniteFix price and guarantee.` }).catch(() => {});
    return (
        <View style={styles.shareCard}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.shareKicker}>Your customer code</Text>
                <Text style={styles.shareCode} selectable>{d.code}</Text>
                <Text style={styles.shareMeta}>{d.bookings} booking{d.bookings === 1 ? '' : 's'} through your link · keep your rating up, customers see it</Text>
            </View>
            <TouchableOpacity style={styles.shareBtn} onPress={share} accessibilityRole="button" accessibilityLabel="Share your customer link">
                <Share2 size={16} color={colors.textInverse} />
                <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
        </View>
    );
}

export function PartnerJobsScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const qc = useQueryClient();
    const enterTechnicianMode = useAuthStore(s => s.enterTechnicianMode);
    const [view, setView] = useState<HubJobView>('queue');
    const [assignFor, setAssignFor] = useState<HubJob | null>(null);
    const [busy, setBusy] = useState<number | 'mode' | null>(null);

    const jobs = useQuery({ queryKey: ['hub-jobs', view], queryFn: async () => (await partnerHubApi.jobs(view)).data.data, refetchInterval: 60_000 });
    const team = useQuery({ queryKey: ['hub-team'], queryFn: async () => (await partnerHubApi.technicians()).data.data });
    const ready = useMemo(() => (team.data ?? []).filter(t => t.isActive && t.verification === 'verified'), [team.data]);
    const me = ready.find(t => t.isOwner);
    const meOnTeam = (team.data ?? []).find(t => t.isOwner);

    const assign = async (job: HubJob, tech: HubTechnician) => {
        setBusy(job.id);
        try {
            await partnerHubApi.assign(job.id, tech.id);
            setAssignFor(null);
            qc.invalidateQueries({ queryKey: ['hub-jobs'] });
            qc.invalidateQueries({ queryKey: ['hub-team'] });
            if (tech.isOwner) {
                Alert.alert('It is yours', 'Switch to technician mode to start it: accept, travel, and enter the customer’s OTP there.', [
                    { text: 'Later', style: 'cancel' }, { text: 'Work as technician', onPress: () => workAsTechnician() },
                ]);
            } else {
                Alert.alert('Assigned', `${tech.fullName ?? 'Your technician'} has been told.`);
            }
        } catch (e) { Alert.alert('Not assigned', getApiErrorMessage(e)); }
        finally { setBusy(null); }
    };

    const workAsTechnician = async () => {
        setBusy('mode');
        try {
            const r = await partnerHubApi.technicianSession();
            await enterTechnicianMode(r.data);
        } catch (e) { Alert.alert('Could not switch', getApiErrorMessage(e)); }
        finally { setBusy(null); }
    };

    return (
        <View style={styles.screen}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <View style={styles.titleRow}>
                    <Text style={styles.title}>Jobs</Text>
                    {me && (
                        <TouchableOpacity style={styles.modeBtn} onPress={workAsTechnician} disabled={busy === 'mode'} accessibilityRole="button">
                            {busy === 'mode' ? <ActivityIndicator size="small" color={colors.primary} /> : <Wrench size={16} color={colors.primary} />}
                            <Text style={styles.modeText}>Work as technician</Text>
                        </TouchableOpacity>
                    )}
                </View>
                <View style={styles.filters}>
                    {VIEWS.map(([v, l]) => (
                        <TouchableOpacity key={v} style={[styles.filter, view === v && styles.filterOn]} onPress={() => setView(v)} accessibilityRole="tab" accessibilityState={{ selected: view === v }}>
                            <Text style={[styles.filterText, view === v && styles.filterTextOn]}>{l}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {meOnTeam && !me && <Text style={styles.hint}>You are on your team. Once UniteFix verifies your documents and you switch yourself on in Team, you can take jobs and work them here.</Text>}
            {jobs.isLoading ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} /> : (
                <FlatList
                    ListHeaderComponent={<ShareCard />}
                    data={jobs.data ?? []}
                    keyExtractor={j => String(j.id)}
                    contentContainerStyle={[styles.list, { paddingBottom: tabContent }]}
                    refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => { jobs.refetch(); team.refetch(); }} colors={[colors.primary]} tintColor={colors.primary} />}
                    renderItem={({ item: j }) => {
                        const canAssign = ['created', 'assigned'].includes(j.status);
                        return (
                            <View style={styles.card}>
                                <View style={styles.cardTop}>
                                    <Text style={styles.name} numberOfLines={2}>{j.serviceName ?? 'Job'}{j.quantity > 1 ? ` × ${j.quantity}` : ''}</Text>
                                    <Text style={styles.code}>{j.serviceId}</Text>
                                </View>
                                <View style={styles.chips}>
                                    {j.urgency === 'urgent' && <Chip text="Urgent" tone="bad" />}
                                    {j.overdue && <Chip text="Past assign-by time" tone="bad" />}
                                    {j.followUpCount > 0 && <Chip text="Follow-up" tone="warn" />}
                                    {j.pausedUntil && <Chip text={`Continues ${day(j.pausedUntil)}`} tone="info" />}
                                    {view !== 'queue' && <Chip text={j.status.replace(/_/g, ' ')} tone="muted" />}
                                </View>
                                {j.followUpCount > 0 && !!j.lastAttemptReason && <Text style={styles.warnText}>Earlier visit could not fix it: {j.lastAttemptReason}</Text>}
                                {!!j.customerName && <Text style={styles.meta}>{j.customerName}{j.address ? ` · ${j.address}` : j.pincode ? ` · ${j.pincode}` : ''}</Text>}
                                {!!j.description && <Text style={styles.meta} numberOfLines={2}>{j.description}</Text>}
                                {j.yourValue != null && (
                                    <Text style={styles.money}>Customer pays {rs(j.price)} · job value {rs(j.yourValue)}{j.yourCommission != null ? ` · your commission ${rs(j.yourCommission)}` : ''}</Text>
                                )}
                                <View style={styles.actions}>
                                    {j.technician ? (
                                        <View style={styles.techRow}><UserCheck size={16} color={colors.successDark} /><Text style={styles.techText}>{j.technician.id === meOnTeam?.id ? 'You' : j.technician.name}</Text></View>
                                    ) : <Text style={styles.unassigned}>Not assigned</Text>}
                                    <View style={styles.actionBtns}>
                                        {!!j.customerPhone && (
                                            <TouchableOpacity onPress={() => Linking.openURL(`tel:${j.customerPhone}`).catch(() => {})} style={styles.iconBtn} accessibilityLabel={`Call ${j.customerName ?? 'customer'}`}>
                                                <Phone size={16} color={colors.primary} />
                                            </TouchableOpacity>
                                        )}
                                        {canAssign && me && j.technician?.id !== me.id && (
                                            <TouchableOpacity style={styles.smallBtn} onPress={() => assign(j, me)} disabled={busy === j.id} accessibilityRole="button">
                                                <Text style={styles.smallBtnText}>Take it myself</Text>
                                            </TouchableOpacity>
                                        )}
                                        {canAssign && (
                                            <TouchableOpacity style={[styles.smallBtn, styles.primaryBtn]} onPress={() => setAssignFor(j)} disabled={busy === j.id} accessibilityRole="button">
                                                <Text style={[styles.smallBtnText, { color: colors.textInverse }]}>{j.technician ? 'Reassign' : 'Assign'}</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            </View>
                        );
                    }}
                    ListEmptyComponent={
                        <EmptyState
                            icon={<Briefcase size={40} color={colors.textDisabled} />}
                            title={view === 'queue' ? 'Nothing to assign' : view === 'active' ? 'No jobs in progress' : 'No finished jobs yet'}
                            description={view === 'queue' ? 'Jobs UniteFix sends you appear here. Assign each to a technician, or take it yourself.' : ''}
                        />
                    }
                />
            )}

            <Modal visible={!!assignFor} transparent animationType="slide" onRequestClose={() => setAssignFor(null)} statusBarTranslucent>
                <View style={styles.backdrop}>
                    <View style={styles.sheet}>
                        <View style={styles.sheetHead}>
                            <Text style={styles.sheetTitle}>Who does {assignFor?.serviceId}?</Text>
                            <TouchableOpacity onPress={() => setAssignFor(null)} accessibilityLabel="Close" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}><X size={22} color={colors.textPrimary} /></TouchableOpacity>
                        </View>
                        {!ready.length ? (
                            <Text style={styles.meta}>No technician is ready. On the Team tab, add technicians and switch them on once UniteFix has verified them.</Text>
                        ) : ready.filter(t => t.id !== assignFor?.technician?.id).map(t => (
                            <TouchableOpacity key={t.id} style={styles.techOption} onPress={() => assignFor && assign(assignFor, t)} disabled={busy === assignFor?.id} accessibilityRole="button">
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.techName}>{t.isOwner ? 'Me' : t.fullName}</Text>
                                    <Text style={styles.meta}>{t.activeJobs} active job{t.activeJobs === 1 ? '' : 's'}{t.isOnline ? ' · online' : ''}</Text>
                                </View>
                                <Text style={styles.pick}>Assign</Text>
                            </TouchableOpacity>
                        ))}
                        <Button title="Cancel" variant="outline" onPress={() => setAssignFor(null)} style={{ marginTop: spacing.md }} />
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function Chip({ text, tone }: { text: string; tone: 'bad' | 'warn' | 'info' | 'muted' }) {
    const c = tone === 'bad' ? [colors.errorDark, colors.errorLight] : tone === 'warn' ? [colors.warningDark, colors.warningLight] : tone === 'info' ? [colors.primary, colors.primarySurface] : [colors.textSecondary, colors.surface];
    return <View style={[styles.chip, { backgroundColor: c[1] }]}><Text style={[styles.chipText, { color: c[0] }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
    title: { ...typography.h2, color: colors.textPrimary },
    modeBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: colors.primarySurface },
    modeText: { ...typography.captionMedium, color: colors.primary },
    filters: { flexDirection: 'row', gap: spacing.sm },
    filter: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    filterOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight + '55' },
    filterText: { ...typography.captionMedium, color: colors.textSecondary },
    filterTextOn: { color: colors.primary },
    list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
    hint: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing.xl, marginBottom: spacing.xs },
    card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: 4 },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    name: { ...typography.bodySemibold, color: colors.textPrimary, flex: 1 },
    code: { ...typography.caption, color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.full },
    chipText: { fontSize: 11, fontWeight: '600' },
    warnText: { ...typography.caption, color: colors.warningDark },
    meta: { ...typography.caption, color: colors.textSecondary },
    money: { ...typography.caption, color: colors.textPrimary },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
    techRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    techText: { ...typography.captionMedium, color: colors.textPrimary },
    unassigned: { ...typography.caption, color: colors.textSecondary },
    actionBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    iconBtn: { width: 40, height: 40, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySurface },
    smallBtn: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, justifyContent: 'center', borderWidth: 1, borderColor: colors.primary },
    primaryBtn: { backgroundColor: colors.primary },
    smallBtnText: { ...typography.captionMedium, color: colors.primary },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], padding: spacing.xl, paddingBottom: spacing['2xl'] ?? spacing.xl, gap: spacing.sm },
    sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    sheetTitle: { ...typography.h4, color: colors.textPrimary },
    techOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    techName: { ...typography.bodyMedium, color: colors.textPrimary },
    pick: { ...typography.captionMedium, color: colors.primary },
    shareCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md, borderRadius: radii.lg, backgroundColor: colors.primarySurface, borderWidth: 1, borderColor: colors.primaryLight },
    shareKicker: { ...typography.small, color: colors.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    shareCode: { ...typography.h3, color: colors.textPrimary, letterSpacing: 2 },
    shareMeta: { ...typography.small, color: colors.textSecondary },
    shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radii.full, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
    shareBtnText: { ...typography.buttonSmall, color: colors.textInverse },
});
