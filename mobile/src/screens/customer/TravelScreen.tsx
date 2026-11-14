/**
 * Travel tab. A photo header, the regions to explore (staff-managed in
 * Admin → Travel Places), "Plan a trip", and the customer's trips with where
 * each stands: waiting for a travel manager, the manager to call, the
 * quotation.
 */

import React, { useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ActivityIndicator, Alert, Linking, Share, RefreshControl, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plane, MapPin, Phone, CalendarDays, Users, ChevronRight, Sparkles, Route, Headset, FileText, Share2, X } from 'lucide-react-native';
import { useTravelCatalog, useMyTrips, travelApi, regionPhoto, TRAVEL_HEADER, type MyTrip, type TravelRegion } from '../../api/travel.api';
import { getApiErrorMessage } from '../../api/client';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
    new: { bg: '#FFF4E5', fg: '#B45309' }, assigned: { bg: '#E8F1FF', fg: '#1D4ED8' }, contacted: { bg: '#F1ECFF', fg: '#6D28D9' },
    quoted: { bg: '#E7F8F0', fg: '#047857' }, confirmed: { bg: '#E7F8F0', fg: '#047857' }, cancelled: { bg: '#F1F3F6', fg: '#687588' },
};
const niceDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

function RegionCard({ r, width, onPress }: { r: TravelRegion; width: number; onPress: () => void }) {
    const { t } = useTranslation();
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [st.region, { width }, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={`${r.name}. ${r.places.length} places. Plan a trip here`}>
            <Image source={regionPhoto(r)} style={{ width, height: width * 0.68 }} contentFit="cover" transition={150} />
            <View style={st.regionShade} />
            {r.inSeason && <View style={st.season}><Sparkles size={11} color="#fff" /><Text style={st.seasonText}>{t('travel.in_season', 'In season')}</Text></View>}
            <View style={st.regionText}>
                <Text style={st.regionName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{r.name}</Text>
                <Text style={st.regionLine} numberOfLines={1} maxFontSizeMultiplier={1.3}>{r.tagline ?? t('travel.places_count', '{{n}} places', { n: r.places.length })}</Text>
            </View>
        </Pressable>
    );
}

function TripCard({ trip, onCancel }: { trip: MyTrip; onCancel: () => void }) {
    const { t } = useTranslation();
    const tone = STATUS_TONE[trip.status] ?? STATUS_TONE.new;
    const people = trip.adults + trip.children;
    const route = trip.tripType === 'round_trip' ? `${trip.from ?? ''} ⇄ ${t('travel.round_trip', 'Round trip')}` : `${trip.from ?? ''} → ${trip.to ?? ''}`;
    const share = () => Share.share({
        message: `${t('travel.share_title', 'Our trip plan')} (${trip.code})\n${route}\n${niceDate(trip.startDate)} · ${trip.days ?? ''} ${t('travel.days', 'days')}\n${trip.places.join(' → ')}\n\n${t('travel.share_footer', 'Planned on the UniteFix app')}`,
    }).catch(() => {});
    return (
        <View style={st.trip}>
            <View style={st.tripHead}>
                <Text style={st.tripCode}>{trip.code}</Text>
                <View style={[st.chip, { backgroundColor: tone.bg }]}><Text style={[st.chipText, { color: tone.fg }]}>{trip.statusLabel}</Text></View>
            </View>
            <Text style={st.tripRoute} numberOfLines={2}>{route}</Text>
            <View style={st.metaRow}>
                <View style={st.meta}><CalendarDays size={14} color={brand.textSecondary} /><Text style={st.metaText}>{niceDate(trip.startDate)} · {trip.days ?? '?'} {t('travel.days', 'days')}</Text></View>
                <View style={st.meta}><Users size={14} color={brand.textSecondary} /><Text style={st.metaText}>{people}</Text></View>
                {trip.totalKm != null && <View style={st.meta}><Route size={14} color={brand.textSecondary} /><Text style={st.metaText}>{trip.totalKm} km</Text></View>}
            </View>
            {trip.places.length > 0 && <Text style={st.places} numberOfLines={2}>{trip.places.join('  ·  ')}</Text>}

            {trip.status === 'new' && (
                <View style={st.note}><Headset size={16} color="#B45309" /><Text style={st.noteText}>{t('travel.waiting_manager', 'A travel manager will be assigned and will call you soon.')}</Text></View>
            )}
            {trip.manager && trip.status !== 'cancelled' && (
                <View style={st.manager}>
                    <View style={st.managerAvatar}><Text style={st.managerInitial}>{trip.manager.name.slice(0, 1).toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                        <Text style={st.managerLabel}>{t('travel.your_manager', 'Your travel manager')}</Text>
                        <Text style={st.managerName}>{trip.manager.name}</Text>
                    </View>
                    {trip.manager.phone && (
                        <Pressable onPress={() => Linking.openURL(`tel:+91${trip.manager!.phone}`)} style={st.callBtn} accessibilityRole="button" accessibilityLabel={t('travel.call_manager', 'Call {{name}}', { name: trip.manager.name })}>
                            <Phone size={16} color="#fff" /><Text style={st.callText}>{t('travel.call', 'Call')}</Text>
                        </Pressable>
                    )}
                </View>
            )}
            {trip.quote && (
                <View style={st.quote}>
                    <FileText size={16} color="#047857" />
                    <View style={{ flex: 1 }}>
                        <Text style={st.quoteAmount}>₹{trip.quote.amount.toLocaleString('en-IN')} <Text style={st.quoteFor}>{t('travel.for_group', 'for your group')}</Text></Text>
                        {trip.quote.note ? <Text style={st.quoteNote}>{trip.quote.note}</Text> : null}
                    </View>
                </View>
            )}
            <View style={st.tripActions}>
                <Pressable onPress={share} style={st.linkBtn} accessibilityRole="button"><Share2 size={15} color={brand.navy} /><Text style={st.linkText}>{t('travel.share_group', 'Share with your group')}</Text></Pressable>
                {trip.canCancel && <Pressable onPress={onCancel} style={st.linkBtn} accessibilityRole="button"><X size={15} color={brand.textSecondary} /><Text style={[st.linkText, { color: brand.textSecondary }]}>{t('travel.cancel_trip', 'Cancel')}</Text></Pressable>}
            </View>
        </View>
    );
}

export function TravelScreen({ navigation }: any) {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const screen = useScreenInsets();
    const { width } = useWindowDimensions();
    const qc = useQueryClient();
    const catalog = useTravelCatalog();
    const trips = useMyTrips();
    const scrollY = useRef(new Animated.Value(0)).current;
    const HERO_H = Math.min(360, Math.round(width * 0.82));
    const barOpacity = scrollY.interpolate({ inputRange: [HERO_H - 140, HERO_H - 80], outputRange: [0, 1], extrapolate: 'clamp' });
    useFocusEffect(useCallback(() => { trips.refetch(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

    const plan = (regionId?: number) => navigation.navigate('TripPlanner', regionId ? { regionId } : {});
    const cancel = (trip: MyTrip) => Alert.alert(t('travel.cancel_title', 'Cancel trip {{code}}?', { code: trip.code }), t('travel.cancel_body', 'Your travel manager will stop working on it.'), [
        { text: t('common.keep', 'Keep it'), style: 'cancel' },
        { text: t('travel.cancel_trip', 'Cancel'), style: 'destructive', onPress: async () => {
            try { await travelApi.cancel(trip.id); qc.invalidateQueries({ queryKey: ['myTrips'] }); } catch (e) { Alert.alert(t('travel.not_cancelled', 'Not cancelled'), getApiErrorMessage(e)); }
        } },
    ]);
    const cardW = Math.min(260, Math.round(width * 0.62));
    const regions = catalog.data?.regions ?? [];
    const myTrips = trips.data ?? [];

    return (
        <View style={st.container}>
            <Animated.ScrollView
                onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
                scrollEventThrottle={16}
                contentContainerStyle={{ paddingBottom: screen.tabContent }}
                refreshControl={<RefreshControl refreshing={trips.isRefetching} onRefresh={() => { trips.refetch(); catalog.refetch(); }} progressViewOffset={insets.top} />}
            >
                <View style={{ height: HERO_H }}>
                    <Image source={TRAVEL_HEADER} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={[st.heroInner, { paddingTop: insets.top + spacing.base }]}>
                        <View style={st.kicker}><Plane size={13} color="#fff" /><Text style={st.kickerText}>{t('travel.kicker', 'UNITEFIX TRAVEL')}</Text></View>
                        <View style={{ flex: 1 }} />
                        <Text style={st.h1} maxFontSizeMultiplier={1.25}>{t('travel.headline', 'Plan your trip across Uttara Kannada')}</Text>
                        <Text style={st.lead} maxFontSizeMultiplier={1.3}>{t('travel.lead', 'Pick the places, we plan the route. Your travel manager arranges the cab, stay and guide.')}</Text>
                        <Pressable onPress={() => plan()} style={({ pressed }) => [st.cta, pressed && { opacity: 0.9 }]} accessibilityRole="button">
                            <MapPin size={18} color="#fff" /><Text style={st.ctaText}>{t('travel.plan_trip', 'Plan a trip')}</Text><ChevronRight size={18} color="#fff" />
                        </Pressable>
                    </View>
                </View>

                <View style={st.section}>
                    <Text style={st.h2}>{t('travel.explore', 'Where do you want to go?')}</Text>
                    {catalog.isLoading ? <ActivityIndicator color={brand.navy} style={{ marginVertical: spacing.lg }} /> : catalog.isError ? (
                        <Pressable onPress={() => catalog.refetch()}><Text style={st.muted}>{t('travel.load_failed', 'Could not load the places. Tap to try again.')}</Text></Pressable>
                    ) : (
                        <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingRight: spacing.base }} style={{ marginHorizontal: -spacing.base, paddingLeft: spacing.base }}>
                            {regions.map(r => <RegionCard key={r.id} r={r} width={cardW} onPress={() => plan(r.id)} />)}
                        </Animated.ScrollView>
                    )}
                </View>

                <View style={st.section}>
                    <Text style={st.h2}>{t('travel.how', 'How it works')}</Text>
                    <View style={st.steps}>
                        {[
                            [MapPin, t('travel.how1', 'Pick your places and who is coming')],
                            [Route, t('travel.how2', 'We plan the shortest route, day by day')],
                            [Headset, t('travel.how3', 'Your travel manager calls with a quotation')],
                        ].map(([Icon, text]: any, i) => (
                            <View key={i} style={st.step}>
                                <View style={st.stepIcon}><Icon size={18} color={brand.navy} /></View>
                                <Text style={st.stepText}>{text}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <View style={st.section}>
                    <Text style={st.h2}>{t('travel.my_trips', 'My trips')}</Text>
                    {trips.isLoading ? <ActivityIndicator color={brand.navy} /> : myTrips.length === 0 ? (
                        <View style={st.empty}>
                            <Text style={st.emptyTitle}>{t('travel.no_trips', 'No trips yet')}</Text>
                            <Text style={st.muted}>{t('travel.no_trips_body', 'Plans you send for a quotation show here, with your travel manager and the price.')}</Text>
                        </View>
                    ) : myTrips.map(trip => <TripCard key={trip.id} trip={trip} onCancel={() => cancel(trip)} />)}
                </View>
            </Animated.ScrollView>

            {/* Collapsed toolbar once the header has scrolled away. */}
            <Animated.View pointerEvents="box-none" style={[st.bar, { paddingTop: insets.top, opacity: barOpacity }]}>
                <Text style={st.barTitle}>{t('tabs.travel', 'Travel')}</Text>
                <Pressable onPress={() => plan()} style={st.barBtn} accessibilityRole="button"><MapPin size={15} color="#fff" /><Text style={st.barBtnText}>{t('travel.plan_trip', 'Plan a trip')}</Text></Pressable>
            </Animated.View>
        </View>
    );
}

const st = StyleSheet.create({
    container: { flex: 1, backgroundColor: brand.background },
    heroInner: { flex: 1, paddingHorizontal: spacing.base, paddingBottom: spacing.xl },
    kicker: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
    kickerText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    h1: { color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 32 },
    lead: { color: brand.onNavyMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },
    cta: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: brand.orange, borderRadius: radii.full, paddingHorizontal: 18, paddingVertical: 12, marginTop: spacing.base },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    section: { paddingHorizontal: spacing.base, paddingTop: spacing.xl, gap: spacing.md },
    h2: { fontSize: 18, fontWeight: '800', color: brand.text },
    muted: { color: brand.textSecondary, fontSize: 14, lineHeight: 20 },
    region: { borderRadius: radii.xl, overflow: 'hidden', backgroundColor: brand.navy },
    regionShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,26,53,0.28)' },
    regionText: { position: 'absolute', left: 12, right: 12, bottom: 12 },
    regionName: { color: '#fff', fontSize: 18, fontWeight: '800' },
    regionLine: { color: 'rgba(255,255,255,0.88)', fontSize: 12, marginTop: 2 },
    season: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(4,120,87,0.92)', borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 3 },
    seasonText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    steps: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base, gap: spacing.md },
    step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    stepIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EAF0F8', alignItems: 'center', justifyContent: 'center' },
    stepText: { flex: 1, color: brand.text, fontSize: 14, lineHeight: 20 },
    empty: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.lg, gap: 4 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: brand.text },
    trip: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base, gap: 8 },
    tripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    tripCode: { fontSize: 13, fontWeight: '700', color: brand.textSecondary, letterSpacing: 0.5 },
    chip: { borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 4 },
    chipText: { fontSize: 12, fontWeight: '700' },
    tripRoute: { fontSize: 16, fontWeight: '700', color: brand.text },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    metaText: { fontSize: 13, color: brand.textSecondary },
    places: { fontSize: 13, color: brand.text, lineHeight: 19 },
    note: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FFF8EC', borderRadius: radii.lg, padding: 10 },
    noteText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },
    manager: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F2F6FB', borderRadius: radii.lg, padding: 10 },
    managerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: brand.navy, alignItems: 'center', justifyContent: 'center' },
    managerInitial: { color: '#fff', fontWeight: '800', fontSize: 16 },
    managerLabel: { fontSize: 11, color: brand.textSecondary },
    managerName: { fontSize: 15, fontWeight: '700', color: brand.text },
    callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#047857', borderRadius: radii.full, paddingHorizontal: 14, paddingVertical: 9 },
    callText: { color: '#fff', fontWeight: '700' },
    quote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#ECFBF3', borderRadius: radii.lg, padding: 10 },
    quoteAmount: { fontSize: 18, fontWeight: '800', color: '#065F46' },
    quoteFor: { fontSize: 13, fontWeight: '500', color: '#047857' },
    quoteNote: { fontSize: 13, color: '#065F46', marginTop: 2, lineHeight: 18 },
    tripActions: { flexDirection: 'row', gap: spacing.lg, marginTop: 2 },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
    linkText: { fontSize: 13, fontWeight: '600', color: brand.navy },
    bar: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: brand.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingBottom: 10 },
    barTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 10 },
    barBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: brand.orange, borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 7, marginTop: 10 },
    barBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
