/**
 * The Safety shield, on a booked trip and on a home-service visit.
 *
 *   SOS (hold 3 s): our team is alerted with your location, which is then shared
 *     every 30 s for 2 hours; you text your emergency contacts in one tap.
 *   Call 112. Share my location. Report someone (quietly). Check who is with you.
 *
 * Help (trips only) is the everyday version: car broke down, driver late, etc.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, TextInput, ActivityIndicator, Linking, Share, Platform, Animated, Easing, Alert } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Phone, MapPin, Flag, UserCheck, X, ChevronLeft, MessageSquare, CheckCircle2, ShieldCheck, LifeBuoy, Siren } from 'lucide-react-native';
import { safetyApi, REPORT_REASONS, HELP_REASONS, type SafetyWhere, type SosResult, type EmergencyContact } from '../../api/safety.api';
import { getApiErrorMessage } from '../../api/client';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const RED = '#D92D20', RED_SOFT = '#FEE4E2';
export type SafetyPerson = { id?: number; role: string; name: string; phone?: string | null; vehicle?: string | null; plate?: string | null; verified?: boolean; ours?: boolean };

/** Current position, or null if refused or slow (SOS must not wait on GPS). */
export async function currentLocation(timeoutMs = 8000): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
    try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
            new Promise<null>(r => setTimeout(() => r(null), timeoutMs)),
        ]);
        if (!pos) { const last = await Location.getLastKnownPositionAsync(); return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null } : null; }
        return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
    } catch { return null; }
}

/** After SOS the location goes to our team every 30 s for 2 hours, while the app is open. */
let pinger: { id: number; timer: ReturnType<typeof setInterval>; until: number } | null = null;
function startPings(id: number, minutes: number) {
    if (pinger) clearInterval(pinger.timer);
    const until = Date.now() + minutes * 60_000;
    const timer = setInterval(async () => {
        if (!pinger || Date.now() > pinger.until) { stopPings(); return; }
        const loc = await currentLocation(6000);
        if (loc) safetyApi.ping(id, loc).then(r => { if (!r.live) stopPings(); }).catch(() => {});
    }, 30_000);
    pinger = { id, timer, until };
}
function stopPings() { if (pinger) clearInterval(pinger.timer); pinger = null; }

function smsUrl(numbers: string[], body: string) {
    const to = numbers.map(n => `+91${n.replace(/\D/g, '').slice(-10)}`).join(',');
    return Platform.OS === 'ios' ? `sms:/open?addresses=${to}&body=${encodeURIComponent(body)}` : `sms:${to}?body=${encodeURIComponent(body)}`;
}
const call = (n: string) => Linking.openURL(`tel:${n.startsWith('1') && n.length <= 3 ? n : `+91${n.replace(/\D/g, '').slice(-10)}`}`).catch(() => {});

/** Hold for 3 seconds: a ring fills, then SOS fires. Letting go early cancels. */
function HoldToSos({ onFire, busy }: { onFire: () => void; busy: boolean }) {
    const { t } = useTranslation();
    const p = useRef(new Animated.Value(0)).current;
    const anim = useRef<Animated.CompositeAnimation | null>(null);
    const [holding, setHolding] = useState(false);
    const begin = () => {
        if (busy) return;
        setHolding(true);
        anim.current = Animated.timing(p, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: false });
        anim.current.start(({ finished }) => { setHolding(false); if (finished) { p.setValue(0); onFire(); } });
    };
    const end = () => { anim.current?.stop(); setHolding(false); Animated.timing(p, { toValue: 0, duration: 150, useNativeDriver: false }).start(); };
    const width = p.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
    return (
        <Pressable onPressIn={begin} onPressOut={end} style={s.sosBtn} accessibilityRole="button" accessibilityLabel={t('safety.sos_hold', 'SOS: hold for 3 seconds')} accessibilityHint={t('safety.sos_hint', 'Alerts our safety team with your location')}>
            <Animated.View style={[s.sosFill, { width }]} />
            {busy ? <ActivityIndicator color="#fff" /> : <>
                <Siren size={22} color="#fff" />
                <View style={{ flex: 1 }}>
                    <Text style={s.sosTitle}>{holding ? t('safety.keep_holding', 'Keep holding…') : t('safety.sos', 'SOS')}</Text>
                    <Text style={s.sosSub}>{t('safety.sos_sub', 'Hold for 3 seconds. Alerts our safety team with your location.')}</Text>
                </View>
            </>}
        </Pressable>
    );
}

export function SafetySheet({ visible, onClose, where, people = [], manager }: {
    visible: boolean; onClose: () => void; where: SafetyWhere; people?: SafetyPerson[]; manager?: { name: string; phone: string | null } | null;
}) {
    const { t } = useTranslation();
    const navigation = useNavigation<any>();
    const [view, setView] = useState<'menu' | 'report' | 'team' | 'sos'>('menu');
    const [busy, setBusy] = useState(false);
    const [sos, setSos] = useState<SosResult | null>(null);
    const [reason, setReason] = useState<string | null>(null);
    const [who, setWho] = useState<number | null>(null);
    const [about, setAbout] = useState('');
    const [details, setDetails] = useState('');
    const [done, setDone] = useState<string | null>(null);
    useEffect(() => { if (!visible) { setView(sos ? 'sos' : 'menu'); setDone(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

    const fire = async () => {
        setBusy(true);
        try {
            const loc = await currentLocation();
            const r = await safetyApi.sos(where, loc);
            setSos(r); setView('sos');
            startPings(r.id, r.liveMinutes);
        } catch (e) {
            Alert.alert(t('safety.sos_failed', 'Could not reach UniteFix'), `${getApiErrorMessage(e)}\n\n${t('safety.call_112_now', 'If you are in danger, call 112 now.')}`, [
                { text: t('safety.call_112', 'Call 112'), onPress: () => call('112') }, { text: t('common.close', 'Close'), style: 'cancel' },
            ]);
        } finally { setBusy(false); }
    };
    const shareLocation = async () => {
        const loc = await currentLocation();
        if (!loc) { Alert.alert(t('safety.no_location', 'Location is off'), t('safety.no_location_body', 'Allow location for UniteFix in your phone settings to share where you are.')); return; }
        Share.share({ message: `${t('safety.my_location', 'My location now')}: https://maps.google.com/?q=${loc.lat},${loc.lng}` }).catch(() => {});
    };
    const sendReport = async () => {
        if (!reason) return;
        setBusy(true);
        try {
            const r = await safetyApi.report(where, { category: reason, teamMemberId: who, about: who ? null : about.trim() || null, description: details.trim() || null });
            setDone(r.message); setReason(null); setDetails(''); setWho(null); setAbout('');
        } catch (e) { Alert.alert(t('safety.not_sent', 'Not sent'), getApiErrorMessage(e)); }
        finally { setBusy(false); }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={s.shade} onPress={onClose} accessibilityLabel={t('common.close', 'Close')} />
            <View style={s.sheet} accessibilityViewIsModal>
                <View style={s.top}>
                    {view !== 'menu' && view !== 'sos'
                        ? <Pressable onPress={() => { setView('menu'); setDone(null); }} hitSlop={10} accessibilityLabel={t('common.back', 'Back')}><ChevronLeft size={22} color={brand.text} /></Pressable>
                        : <ShieldAlert size={22} color={RED} />}
                    <Text style={s.title}>{view === 'report' ? t('safety.report_title', 'Report someone') : view === 'team' ? t('safety.team_title', 'Who is with you') : view === 'sos' ? t('safety.sos_sent', 'Help is on the way') : t('safety.title', 'Safety')}</Text>
                    <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close', 'Close')}><X size={22} color={brand.textSecondary} /></Pressable>
                </View>
                <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                    {view === 'menu' && (
                        <>
                            <HoldToSos onFire={fire} busy={busy} />
                            <Pressable onPress={() => call('112')} style={s.row112} accessibilityRole="button">
                                <View style={[s.icon, { backgroundColor: RED }]}><Phone size={18} color="#fff" /></View>
                                <View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('safety.call_112', 'Call 112')}</Text><Text style={s.rowSub}>{t('safety.call_112_sub', 'Police and ambulance. Always first in danger.')}</Text></View>
                            </Pressable>
                            {[
                                [MapPin, t('safety.share', 'Share my location'), t('safety.share_sub', 'Send where you are to anyone, by WhatsApp or SMS'), shareLocation],
                                [Flag, t('safety.report', 'Report someone\'s behaviour'), t('safety.report_sub', 'Quietly. They are not told until we have reviewed it.'), () => setView('report')],
                                [UserCheck, t('safety.check_team', 'Check who is with you'), t('safety.check_team_sub', 'Faces, number plates and who is verified'), () => setView('team')],
                            ].map(([Icon, title, sub, onPress]: any, i) => (
                                <Pressable key={i} onPress={onPress} style={s.row} accessibilityRole="button">
                                    <View style={s.icon}><Icon size={18} color={brand.navy} /></View>
                                    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{title}</Text><Text style={s.rowSub}>{sub}</Text></View>
                                </Pressable>
                            ))}
                            <Text style={s.note}>{t('safety.note', 'UniteFix helps, but is not an emergency service. In danger, call 112 first.')}</Text>
                        </>
                    )}

                    {view === 'sos' && sos && (
                        <>
                            <View style={s.sosDone}>
                                <CheckCircle2 size={20} color="#fff" />
                                <Text style={s.sosDoneText}>{t('safety.alerted', '{{who}} and our safety team are alerted and will call you. Your location is shared for 2 hours.', { who: sos.manager?.name ?? t('safety.your_manager', 'Your travel manager') })}</Text>
                            </View>
                            <Pressable onPress={() => call('112')} style={s.row112}><View style={[s.icon, { backgroundColor: RED }]}><Phone size={18} color="#fff" /></View><Text style={[s.rowTitle, { flex: 1 }]}>{t('safety.call_112', 'Call 112')}</Text></Pressable>
                            {sos.manager?.phone && <Pressable onPress={() => call(sos.manager!.phone)} style={s.row}><View style={s.icon}><Phone size={18} color={brand.navy} /></View><Text style={[s.rowTitle, { flex: 1 }]}>{t('safety.call_name', 'Call {{name}}', { name: sos.manager.name })}</Text></Pressable>}
                            {sos.contacts.length > 0 ? (
                                <Pressable onPress={() => Linking.openURL(smsUrl(sos.contacts.map((c: EmergencyContact) => c.phone), sos.smsText)).catch(() => {})} style={s.row}>
                                    <View style={s.icon}><MessageSquare size={18} color={brand.navy} /></View>
                                    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('safety.text_contacts', 'Text my emergency contacts')}</Text><Text style={s.rowSub}>{sos.contacts.map(c => c.name).join(', ')} · {t('safety.text_contacts_sub', 'with your live location')}</Text></View>
                                </Pressable>
                            ) : (
                                <Pressable onPress={() => { onClose(); navigation.navigate('EmergencyContacts'); }} style={s.row}>
                                    <View style={s.icon}><MessageSquare size={18} color={brand.navy} /></View>
                                    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('safety.add_contacts', 'Add emergency contacts')}</Text><Text style={s.rowSub}>{t('safety.add_contacts_sub', 'So next time they get your location too')}</Text></View>
                                </Pressable>
                            )}
                            <Pressable onPress={() => Share.share({ message: sos.smsText }).catch(() => {})} style={s.row}><View style={s.icon}><MapPin size={18} color={brand.navy} /></View><Text style={[s.rowTitle, { flex: 1 }]}>{t('safety.share_link', 'Share my live location link')}</Text></Pressable>
                            <Pressable onPress={async () => { stopPings(); await safetyApi.stop(sos.id).catch(() => {}); setSos(null); setView('menu'); onClose(); }} style={s.safeBtn} accessibilityRole="button">
                                <ShieldCheck size={18} color={brand.navy} /><Text style={s.safeText}>{t('safety.im_safe', 'I\'m safe now: stop sharing')}</Text>
                            </Pressable>
                            <Text style={s.note}>{t('safety.case', 'Case {{code}}', { code: sos.code })}</Text>
                        </>
                    )}

                    {view === 'report' && (done ? (
                        <View style={s.okBox}><CheckCircle2 size={20} color="#047857" /><Text style={s.okText}>{done}</Text></View>
                    ) : (
                        <>
                            {people.length > 0 && (
                                <>
                                    <Text style={s.label}>{t('safety.who', 'Who is it about?')}</Text>
                                    <View style={s.chips}>
                                        {people.filter(p => p.id).map(p => <Pressable key={p.id} onPress={() => setWho(p.id!)} style={[s.chip, who === p.id && s.chipOn]}><Text style={[s.chipText, who === p.id && s.chipTextOn]}>{p.name} · {p.role}</Text></Pressable>)}
                                        <Pressable onPress={() => setWho(null)} style={[s.chip, who === null && s.chipOn]}><Text style={[s.chipText, who === null && s.chipTextOn]}>{t('safety.someone_else', 'Someone else')}</Text></Pressable>
                                    </View>
                                </>
                            )}
                            {who === null && where.context === 'trip' && <TextInput style={s.input} value={about} onChangeText={setAbout} placeholder={t('safety.who_ph', 'Name or description')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('safety.who', 'Who is it about?')} />}
                            <Text style={s.label}>{t('safety.what', 'What happened?')}</Text>
                            <View style={s.chips}>
                                {REPORT_REASONS.map(r => <Pressable key={r.key} onPress={() => setReason(r.key)} style={[s.chip, reason === r.key && (r.critical ? s.chipCrit : s.chipOn)]}><Text style={[s.chipText, reason === r.key && s.chipTextOn]}>{t(`safety.r_${r.key}`, r.label)}</Text></Pressable>)}
                            </View>
                            <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} value={details} onChangeText={setDetails} multiline maxLength={2000} placeholder={t('safety.details_ph', 'Tell us more (optional)')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('safety.details', 'Details')} />
                            {REPORT_REASONS.find(r => r.key === reason)?.critical && <Text style={s.crit}>{t('safety.crit_note', 'We call you within 5 minutes and the person is taken off new jobs while we look into it. If you are in danger, call 112 now.')}</Text>}
                            <Pressable onPress={sendReport} disabled={!reason || busy} style={[s.primary, (!reason || busy) && { opacity: 0.4 }]} accessibilityRole="button">
                                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t('safety.send_report', 'Send report')}</Text>}
                            </Pressable>
                        </>
                    ))}

                    {view === 'team' && (
                        people.length === 0 ? <Text style={s.rowSub}>{t('safety.team_none', 'Your travel manager has not named the team yet.')}</Text>
                            : people.map((p, i) => (
                                <View key={i} style={s.person}>
                                    <View style={s.avatar}><Text style={s.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text></View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.rowTitle}>{p.name} <Text style={s.rowSub}>· {p.role}</Text></Text>
                                        {(p.vehicle || p.plate) && <Text style={s.rowSub}>{p.vehicle}{p.plate ? '  ' : ''}{p.plate ? <Text style={s.plate}> {p.plate} </Text> : null}</Text>}
                                        <Text style={[s.badge, { color: p.verified ? '#047857' : '#B45309' }]}>{p.verified ? (p.ours ? t('safety.ours', 'UniteFix expert · verified') : t('safety.verified', 'Documents checked')) : t('safety.not_verified', 'Documents not yet checked')}</Text>
                                    </View>
                                    {p.phone && <Pressable onPress={() => call(p.phone!)} hitSlop={8} accessibilityLabel={`${t('safety.call', 'Call')} ${p.name}`}><Phone size={20} color={brand.navy} /></Pressable>}
                                </View>
                            ))
                    )}
                    {view === 'team' && <Text style={s.note}>{t('safety.team_note', 'If the person or car in front of you does not match, do not get in. Call your travel manager.')}</Text>}
                </ScrollView>
            </View>
        </Modal>
    );
}

/** Help on a trip: not about safety, about getting things fixed. */
export function HelpSheet({ visible, onClose, tripId, manager }: { visible: boolean; onClose: () => void; tripId: number; manager?: { name: string; phone: string | null } | null }) {
    const { t } = useTranslation();
    const [reason, setReason] = useState<string | null>(null);
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    useEffect(() => { if (visible) { setDone(null); setReason(null); setDetails(''); } }, [visible]);
    const send = async () => {
        if (!reason) return;
        setBusy(true);
        try { const loc = await currentLocation(5000); const r = await safetyApi.help({ context: 'trip', tripId }, { category: reason, description: details.trim() || null, lat: loc?.lat, lng: loc?.lng }); setDone(r.message); }
        catch (e) { Alert.alert(t('safety.not_sent', 'Not sent'), getApiErrorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={s.shade} onPress={onClose} />
            <View style={s.sheet} accessibilityViewIsModal>
                <View style={s.top}><LifeBuoy size={22} color={brand.navy} /><Text style={s.title}>{t('safety.help_title', 'Help with your trip')}</Text><Pressable onPress={onClose} hitSlop={10}><X size={22} color={brand.textSecondary} /></Pressable></View>
                <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                    {manager?.phone && <Pressable onPress={() => call(manager.phone!)} style={s.row}><View style={s.icon}><Phone size={18} color={brand.navy} /></View><View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('safety.call_name', 'Call {{name}}', { name: manager.name })}</Text><Text style={s.rowSub}>{t('safety.manager_sub', 'Your travel manager')}</Text></View></Pressable>}
                    {done ? <View style={s.okBox}><CheckCircle2 size={20} color="#047857" /><Text style={s.okText}>{done}</Text></View> : (
                        <>
                            <Text style={s.label}>{t('safety.help_what', 'What do you need help with?')}</Text>
                            <View style={s.chips}>{HELP_REASONS.map(r => <Pressable key={r.key} onPress={() => setReason(r.key)} style={[s.chip, reason === r.key && s.chipOn]}><Text style={[s.chipText, reason === r.key && s.chipTextOn]}>{t(`safety.h_${r.key}`, r.label)}</Text></Pressable>)}</View>
                            {reason === 'medical' && <Pressable onPress={() => call('108')} style={s.row112}><View style={[s.icon, { backgroundColor: RED }]}><Phone size={18} color="#fff" /></View><Text style={[s.rowTitle, { flex: 1 }]}>{t('safety.call_108', 'Call 108 for an ambulance')}</Text></Pressable>}
                            <TextInput style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} value={details} onChangeText={setDetails} multiline maxLength={2000} placeholder={t('safety.details_ph', 'Tell us more (optional)')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('safety.details', 'Details')} />
                            <Pressable onPress={send} disabled={!reason || busy} style={[s.primary, { backgroundColor: brand.navy }, (!reason || busy) && { opacity: 0.4 }]} accessibilityRole="button">
                                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{t('safety.send_help', 'Send to my travel manager')}</Text>}
                            </Pressable>
                        </>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
}

/** The red shield button that opens the sheet. */
export function ShieldButton({ onPress, label }: { onPress: () => void; label?: string }) {
    const { t } = useTranslation();
    return (
        <Pressable onPress={onPress} style={s.shieldBtn} accessibilityRole="button" accessibilityLabel={label ?? t('safety.title', 'Safety')} hitSlop={6}>
            <ShieldAlert size={20} color="#fff" />
            {label ? <Text style={s.shieldText}>{label}</Text> : null}
        </Pressable>
    );
}

const s = StyleSheet.create({
    shade: { flex: 1, backgroundColor: 'rgba(6,26,53,0.5)' },
    sheet: { maxHeight: '88%', backgroundColor: '#fff', borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
    top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    title: { flex: 1, fontSize: 19, fontWeight: '800', color: brand.text },
    sosBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: RED, borderRadius: radii.xl, padding: spacing.base, overflow: 'hidden', minHeight: 76 },
    sosFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.22)' },
    sosTitle: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 1 },
    sosSub: { color: 'rgba(255,255,255,0.92)', fontSize: 13 },
    row112: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: RED_SOFT, borderRadius: radii.lg, padding: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.md },
    icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EAF0F8', alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontSize: 15, fontWeight: '700', color: brand.text },
    rowSub: { fontSize: 12, color: brand.textSecondary, lineHeight: 17 },
    note: { fontSize: 12, color: brand.textSecondary, textAlign: 'center' },
    sosDone: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#047857', borderRadius: radii.lg, padding: spacing.md },
    sosDoneText: { flex: 1, color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
    safeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: brand.navy, borderRadius: radii.full, paddingVertical: 12 },
    safeText: { color: brand.navy, fontWeight: '800', fontSize: 15 },
    label: { fontSize: 13, fontWeight: '700', color: brand.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 7 },
    chipOn: { backgroundColor: brand.navy, borderColor: brand.navy },
    chipCrit: { backgroundColor: RED, borderColor: RED },
    chipText: { fontSize: 13, color: brand.text, fontWeight: '600' },
    chipTextOn: { color: '#fff' },
    input: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: brand.text },
    crit: { fontSize: 13, color: RED, lineHeight: 18, fontWeight: '600' },
    primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: RED, borderRadius: radii.full, paddingVertical: 14 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    okBox: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#ECFBF3', borderRadius: radii.lg, padding: spacing.md },
    okText: { flex: 1, color: '#065F46', fontSize: 14, lineHeight: 20 },
    person: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, padding: spacing.md },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: brand.navy, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
    plate: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: '#FFE45C', color: '#111', fontWeight: '700' },
    badge: { fontSize: 12, fontWeight: '700', marginTop: 2 },
    shieldBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RED, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 8, shadowColor: RED, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
    shieldText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
