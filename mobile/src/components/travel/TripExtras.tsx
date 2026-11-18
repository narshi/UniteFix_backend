/**
 * On the road and after it.
 *
 *   TripMode   while the trip is on, shares the traveller's location with the
 *              travel manager every minute or so, while the app is open; the
 *              traveller turns it on once (remembered on the phone) and can stop it.
 *   TripProgress  places visited, the next one, and the family link.
 *   RateTrip   after the trip: stars and quick tags for each person.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, TextInput, ActivityIndicator, Alert, Share } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { Navigation, Star, X, Users, Radio } from 'lucide-react-native';
import { travelApi, RATING_TAGS, type MyTrip } from '../../api/travel.api';
import { getApiErrorMessage } from '../../api/client';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const key = (id: number) => `uf_tripmode_${id}`;

/** Trip mode: on until the traveller stops it or the trip ends. */
export function TripMode({ trip, onProgress }: { trip: MyTrip; onProgress: () => void }) {
    const { t } = useTranslation();
    const [on, setOn] = useState<boolean | null>(null);
    const [denied, setDenied] = useState(false);
    const [lastAt, setLastAt] = useState<number | null>(trip.tracking.lastPingAt ? new Date(trip.tracking.lastPingAt).getTime() : null);
    const [, tick] = useState(0);
    const last = useRef(0);
    useEffect(() => { SecureStore.getItemAsync(key(trip.id)).then(v => setOn(v === '1')).catch(() => setOn(false)); }, [trip.id]);
    useEffect(() => { const i = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(i); }, []);
    useEffect(() => {
        if (!on) return;
        let sub: Location.LocationSubscription | null = null;
        let cancelled = false;
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') { setDenied(true); return; }
            setDenied(false);
            if (cancelled) return;
            sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 150 }, pos => {
                const now = Date.now();
                if (now - last.current < 55_000) return;
                last.current = now;
                travelApi.ping(trip.id, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null, speed: pos.coords.speed ?? null })
                    .then(r => { if (r.tracking) { setLastAt(Date.now()); if (r.checked.length) onProgress(); } })
                    .catch(() => {});
            });
        })();
        return () => { cancelled = true; sub?.remove(); };
    }, [on, trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = (v: boolean) => { setOn(v); SecureStore.setItemAsync(key(trip.id), v ? '1' : '0').catch(() => {}); };
    if (on === null) return null;
    const mins = lastAt ? Math.round((Date.now() - lastAt) / 60_000) : null;
    return on ? (
        <View style={[st.mode, st.modeOn]}>
            <Radio size={18} color="#047857" />
            <View style={{ flex: 1 }}>
                <Text style={st.modeTitle}>{t('trip.mode_on', 'Trip mode is on')}</Text>
                <Text style={st.modeSub}>{denied
                    ? t('trip.mode_denied', 'Location is blocked. Allow it for UniteFix in your phone settings.')
                    : t('trip.mode_on_sub', 'Your travel manager sees where you are while this app is open{{when}}.', { when: mins != null ? ` · ${mins === 0 ? t('trip.just_now', 'shared just now') : t('trip.mins_ago', 'shared {{n}} min ago', { n: mins })}` : '' })}</Text>
            </View>
            <Pressable onPress={() => set(false)} hitSlop={8} accessibilityRole="button"><Text style={st.modeStop}>{t('trip.stop', 'Stop')}</Text></Pressable>
        </View>
    ) : (
        <Pressable onPress={() => set(true)} style={st.mode} accessibilityRole="button">
            <Navigation size={18} color={brand.navy} />
            <View style={{ flex: 1 }}>
                <Text style={st.modeTitle}>{t('trip.mode_start', 'Turn on Trip mode')}</Text>
                <Text style={st.modeSub}>{t('trip.mode_start_sub', 'Shares your location with your travel manager while the app is open, only until the trip ends. Keeps you safer and checks off places as you visit them.')}</Text>
            </View>
        </Pressable>
    );
}

/** Places visited, next, and a link family can follow. */
export function TripProgress({ trip }: { trip: MyTrip }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const p = trip.progress;
    const share = async () => {
        setBusy(true);
        try {
            const r = trip.familyUrl ? { url: trip.familyUrl } : await travelApi.familyLink(trip.id);
            await Share.share({ message: t('trip.family_msg', 'Follow my UniteFix trip {{code}} live: {{url}}', { code: trip.code, url: r.url }) });
        } catch (e) { Alert.alert(t('trip.not_shared', 'Could not share'), getApiErrorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <View style={{ gap: 8 }}>
            {p.total > 0 && trip.status === 'started' && (
                <View style={{ gap: 4 }}>
                    <Text style={st.progText}>{t('trip.progress', '{{done}} of {{total}} places visited', { done: p.done, total: p.total })}{p.next ? ` · ${t('trip.next', 'next')}: ${p.next}` : ''}</Text>
                    <View style={st.bar}><View style={[st.barFill, { width: `${Math.round((p.done / p.total) * 100)}%` }]} /></View>
                </View>
            )}
            <Pressable onPress={share} disabled={busy} style={st.family} accessibilityRole="button">
                {busy ? <ActivityIndicator color={brand.navy} /> : <Users size={16} color={brand.navy} />}
                <Text style={st.familyText}>{t('trip.family', 'Share a live link with family')}</Text>
            </Pressable>
        </View>
    );
}

/** After the trip: rate each person on the team. */
export function RateTrip({ trip, visible, onClose, onDone }: { trip: MyTrip; visible: boolean; onClose: () => void; onDone: () => void }) {
    const { t } = useTranslation();
    const [stars, setStars] = useState<Record<number, number>>({});
    const [tags, setTags] = useState<Record<number, string[]>>({});
    const [notes, setNotes] = useState<Record<number, string>>({});
    const [busy, setBusy] = useState(false);
    const rated = trip.team.filter(m => stars[m.id]);
    const send = async () => {
        setBusy(true);
        try {
            const r = await travelApi.rate(trip.id, rated.map(m => ({ teamMemberId: m.id, stars: stars[m.id], tags: tags[m.id] ?? [], comment: notes[m.id]?.trim() || null })));
            Alert.alert(t('trip.thanks', 'Thank you!'), r.message);
            onDone(); onClose();
        } catch (e) { Alert.alert(t('trip.not_sent', 'Not sent'), getApiErrorMessage(e)); }
        finally { setBusy(false); }
    };
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={st.shade} onPress={onClose} />
            <View style={st.sheet} accessibilityViewIsModal>
                <View style={st.top}><Text style={st.title}>{t('trip.rate_title', 'How was your trip?')}</Text><Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close', 'Close')}><X size={22} color={brand.textSecondary} /></Pressable></View>
                <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
                    {trip.team.map(m => (
                        <View key={m.id} style={st.person}>
                            <Text style={st.name}>{m.name} <Text style={st.role}>· {m.role}</Text></Text>
                            <View style={st.stars} accessibilityRole="adjustable" accessibilityLabel={`${m.name}: ${stars[m.id] ?? 0} of 5`}>
                                {[1, 2, 3, 4, 5].map(n => (
                                    <Pressable key={n} onPress={() => setStars({ ...stars, [m.id]: n })} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                                        <Star size={30} color="#F59E0B" fill={(stars[m.id] ?? 0) >= n ? '#F59E0B' : 'transparent'} />
                                    </Pressable>
                                ))}
                            </View>
                            {!!stars[m.id] && (
                                <>
                                    <View style={st.tags}>
                                        {(RATING_TAGS[m.role] ?? []).map(tag => {
                                            const on = (tags[m.id] ?? []).includes(tag);
                                            return <Pressable key={tag} onPress={() => setTags({ ...tags, [m.id]: on ? (tags[m.id] ?? []).filter(x => x !== tag) : [...(tags[m.id] ?? []), tag] })} style={[st.tag, on && st.tagOn]}><Text style={[st.tagText, on && st.tagTextOn]}>{tag}</Text></Pressable>;
                                        })}
                                    </View>
                                    {stars[m.id] < 3 && <TextInput style={st.input} value={notes[m.id] ?? ''} onChangeText={v => setNotes({ ...notes, [m.id]: v })} placeholder={t('trip.what_wrong', 'What went wrong? Your travel manager will call you.')} placeholderTextColor={brand.textSecondary} multiline accessibilityLabel={t('trip.what_wrong', 'What went wrong?')} />}
                                </>
                            )}
                        </View>
                    ))}
                    <Pressable onPress={send} disabled={!rated.length || busy} style={[st.primary, (!rated.length || busy) && { opacity: 0.4 }]} accessibilityRole="button">
                        {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryText}>{t('trip.send_rating', 'Send')}</Text>}
                    </Pressable>
                </ScrollView>
            </View>
        </Modal>
    );
}

const st = StyleSheet.create({
    mode: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, padding: 10, backgroundColor: '#F7FAFE' },
    modeOn: { borderColor: '#A7F3D0', backgroundColor: '#ECFBF3' },
    modeTitle: { fontSize: 14, fontWeight: '800', color: brand.text },
    modeSub: { fontSize: 12, color: brand.textSecondary, lineHeight: 17 },
    modeStop: { color: brand.navy, fontWeight: '800' },
    progText: { fontSize: 13, color: brand.text, fontWeight: '600' },
    bar: { height: 6, borderRadius: 3, backgroundColor: '#E6EAF0', overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: brand.orange },
    family: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
    familyText: { color: brand.navy, fontWeight: '700', fontSize: 13 },
    shade: { flex: 1, backgroundColor: 'rgba(6,26,53,0.45)' },
    sheet: { maxHeight: '88%', backgroundColor: '#fff', borderTopLeftRadius: radii['2xl'], borderTopRightRadius: radii['2xl'], paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
    top: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
    title: { flex: 1, fontSize: 19, fontWeight: '800', color: brand.text },
    person: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, padding: spacing.md, gap: 8 },
    name: { fontSize: 15, fontWeight: '700', color: brand.text },
    role: { fontSize: 13, fontWeight: '500', color: brand.textSecondary },
    stars: { flexDirection: 'row', gap: 6 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
    tagOn: { backgroundColor: brand.navy, borderColor: brand.navy },
    tagText: { fontSize: 12, color: brand.text, fontWeight: '600' },
    tagTextOn: { color: '#fff' },
    input: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: brand.text, minHeight: 60, textAlignVertical: 'top' },
    primary: { alignItems: 'center', justifyContent: 'center', backgroundColor: brand.orange, borderRadius: radii.full, paddingVertical: 14 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
