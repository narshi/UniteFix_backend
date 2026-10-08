/**
 * One hall, photographer or planner from Celebrations: their photos, what
 * they offer and for how much, and reviews. "Check dates & book" opens their
 * page, where the date is held and the advance paid.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, FlatList, Dimensions, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Star, X } from 'lucide-react-native';
import { apiClient, API_BASE_URL } from '../../api/client';
import { niceDate, rs, type CelebrationType } from './CelebrationsScreen';

type Offer = { title: string; sub: string | null; price: string | null };
type Detail = { name: string; tagline: string | null; city: string | null; about: string | null; photos: string[]; facts: string[]; offers: Offer[]; offersTitle: string; reviews: { average: number; count: number; items: Array<{ id: number; name: string; rating: number; body: string | null }> } | null; terms: string[] };
const W = Dimensions.get('window').width;
const unit = (u: string) => (u === 'event' ? '' : u === 'plate' ? ' / plate' : ` / ${u}`);

function normalise(type: CelebrationType, d: any): Detail {
    if (type === 'halls') {
        const photos = [d.profile.coverPhoto, ...d.spaces.flatMap((s: any) => s.photos)].filter(Boolean);
        const max = Math.max(0, ...d.spaces.map((s: any) => Math.max(s.seated ?? 0, s.floating ?? 0)));
        return {
            name: d.name, tagline: d.profile.tagline, city: d.city, about: d.profile.about, photos,
            facts: [max ? `Up to ${max} guests` : '', d.profile.rooms ? `${d.profile.rooms} guest rooms` : '', d.profile.parking ? `Parking for ${d.profile.parking}` : '', d.profile.rules?.vegOnly ? 'Vegetarian only' : '', ...d.profile.amenities.slice(0, 6)].filter(Boolean),
            offersTitle: 'Spaces', offers: d.spaces.map((s: any) => ({ title: s.name, sub: [s.seated && `${s.seated} seated`, s.floating && `${s.floating} floating`].filter(Boolean).join(' · ') || null, price: s.from != null ? `from ${rs(s.from)} + GST` : null })),
            reviews: d.reviews,
            terms: [d.policies.advancePercent >= 100 ? 'Pay in full to confirm' : `${d.policies.advancePercent}% advance to confirm`, d.policies.deposit ? `Refundable deposit ${rs(d.policies.deposit)}` : '', d.policies.instantBooking ? `Book instantly — your date is held ${d.policies.holdHours} hours while you pay` : `The hall confirms within ${d.policies.holdHours} hours`].filter(Boolean),
        };
    }
    if (type === 'photographers') {
        return {
            name: d.name, tagline: d.profile.tagline, city: d.city, about: d.profile.about, photos: [d.profile.coverPhoto, ...d.featured.filter((m: any) => m.kind === 'photo').map((m: any) => m.url)].filter(Boolean),
            facts: [d.profile.since ? `Shooting since ${d.profile.since}` : '', `${d.stats.albums} stories · ${d.stats.photos} photos`, ...d.profile.styles.slice(0, 4), d.profile.travelAreas.length ? `Travels to ${d.profile.travelAreas.slice(0, 3).join(', ')}` : ''].filter(Boolean),
            offersTitle: 'Packages', offers: [...d.packages, ...d.addons].map((k: any) => ({ title: k.name, sub: k.description, price: `${rs(k.price)}${unit(k.unit)}` })),
            reviews: d.reviews, terms: [`${d.policies.advancePercent}% advance to confirm`, `Your date is held ${d.policies.holdHours} hours while they send your quotation`],
        };
    }
    return {
        name: d.name, tagline: d.profile.tagline, city: d.city, about: d.profile.about,
        photos: [d.profile.coverPhoto, ...d.gallery.filter((g: any) => g.kind === 'photo').map((g: any) => g.url), ...d.themes.flatMap((t: any) => t.photos)].filter(Boolean),
        facts: [d.themes.length ? `${d.themes.length} themes` : '', d.venues.length ? `${d.venues.length} venues` : ''].filter(Boolean),
        offersTitle: 'Themes and add-ons', offers: [...d.themes.map((t: any) => ({ title: `${t.name} theme`, sub: t.suitableFor, price: t.price ? rs(t.price) : 'Included' })), ...d.addons.map((a: any) => ({ title: a.name, sub: a.description, price: `${rs(a.price)}${unit(a.unit)}` }))],
        reviews: null, terms: ['They confirm your date and send the final quotation'],
    };
}

export function CelebrationDetailScreen({ navigation, route }: any) {
    const { type, code, url, date, guests, name } = route.params as { type: CelebrationType; code: string; url: string; date: string | null; guests: string | null; name: string };
    const path = type === 'halls' ? `/api/public/halls/${code}` : type === 'photographers' ? `/api/public/photographers/${code}` : `/api/public/events/${code}/showcase`;
    const q = useQuery<Detail>({ queryKey: ['celebration', type, code], queryFn: async () => normalise(type, (await apiClient.get(path)).data?.data) });
    const [big, setBig] = useState<string | null>(null);
    const d = q.data;
    const open = () => {
        const p = new URLSearchParams();
        if (date) p.set('date', date);
        if (guests) p.set('guests', guests);
        Linking.openURL(`${API_BASE_URL}${url}${p.toString() ? `?${p}` : ''}${type === 'photographers' ? '#ask' : type === 'halls' ? '#book' : ''}`);
    };
    return (
        <SafeAreaView style={s.container} edges={['top']}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><ArrowLeft size={22} color="#231B16" /></TouchableOpacity>
                <Text style={s.headerTitle} numberOfLines={1}>{d?.name ?? name}</Text>
            </View>
            {q.isLoading ? <ActivityIndicator color="#B5562B" style={{ marginTop: 40 }} /> : !d ? <Text style={s.muted}>This page is not available right now.</Text> : (
                <>
                    <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
                        <FlatList horizontal pagingEnabled showsHorizontalScrollIndicator={false} data={d.photos.slice(0, 20)} keyExtractor={(u, i) => `${i}`}
                            renderItem={({ item }) => <TouchableOpacity activeOpacity={0.95} onPress={() => setBig(item)}><Image source={{ uri: item }} style={{ width: W, height: W * 0.75 }} contentFit="cover" transition={200} /></TouchableOpacity>} />
                        <View style={s.body}>
                            {d.city && <Text style={s.kicker}>{d.city.toUpperCase()}</Text>}
                            <Text style={s.h1}>{d.name}</Text>
                            {d.tagline && <Text style={s.tagline}>{d.tagline}</Text>}
                            {d.reviews && d.reviews.count > 0 && <View style={s.rating}><Star size={14} color="#B98B2E" fill="#B98B2E" /><Text style={s.ratingText}>{d.reviews.average.toFixed(1)} · {d.reviews.count} reviews from real bookings</Text></View>}
                            {d.facts.length > 0 && <View style={s.chips}>{d.facts.map(f => <Text key={f} style={s.chip}>{f}</Text>)}</View>}
                            {d.about && <Text style={s.about}>{d.about}</Text>}
                            {d.offers.length > 0 && <Text style={s.section}>{d.offersTitle}</Text>}
                            {d.offers.map((o, i) => (
                                <View key={i} style={s.offer}>
                                    <View style={{ flex: 1 }}><Text style={s.offerTitle}>{o.title}</Text>{o.sub ? <Text style={s.offerSub} numberOfLines={2}>{o.sub}</Text> : null}</View>
                                    {o.price && <Text style={s.offerPrice}>{o.price}</Text>}
                                </View>
                            ))}
                            {d.reviews && d.reviews.items.length > 0 && <Text style={s.section}>Reviews</Text>}
                            {d.reviews?.items.slice(0, 3).map(r => (
                                <View key={r.id} style={s.review}>
                                    <Text style={{ color: '#B98B2E' }}>{'★'.repeat(r.rating)}<Text style={{ color: '#E3D6C6' }}>{'★'.repeat(5 - r.rating)}</Text>  <Text style={s.reviewName}>{r.name}</Text></Text>
                                    {r.body && <Text style={s.reviewBody}>{r.body}</Text>}
                                </View>
                            ))}
                            <Text style={s.section}>Good to know</Text>
                            {d.terms.map(t => <Text key={t} style={s.term}>• {t}</Text>)}
                        </View>
                    </ScrollView>
                    <View style={s.footer}>
                        <TouchableOpacity style={s.cta} onPress={open} accessibilityRole="link">
                            <Text style={s.ctaText}>{date ? `Check ${niceDate(date)} & book` : 'Check dates & book'}</Text>
                        </TouchableOpacity>
                        <Text style={s.footNote}>Opens their booking page — your date is held while you pay or they confirm.</Text>
                    </View>
                </>
            )}
            <Modal visible={!!big} transparent animationType="fade" onRequestClose={() => setBig(null)}>
                <View style={s.modal}>
                    <TouchableOpacity style={s.close} onPress={() => setBig(null)} accessibilityLabel="Close"><X size={22} color="#fff" /></TouchableOpacity>
                    {big && <Image source={{ uri: big }} style={{ width: '100%', height: '80%' }} contentFit="contain" />}
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FBF7F1' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E9DFD3' },
    headerTitle: { fontSize: 17, fontWeight: '600', color: '#231B16', flex: 1 },
    muted: { color: '#6F625A', textAlign: 'center', marginTop: 40 },
    body: { padding: 16 },
    kicker: { fontSize: 11, letterSpacing: 2, color: '#B5562B', fontWeight: '600' },
    h1: { fontSize: 28, lineHeight: 34, color: '#231B16', fontWeight: '600', marginTop: 4, fontFamily: 'serif' },
    tagline: { fontSize: 15, color: '#6F625A', marginTop: 6 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    ratingText: { fontSize: 13, color: '#231B16' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
    chip: { fontSize: 12, color: '#231B16', borderWidth: 1, borderColor: '#E9DFD3', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' },
    about: { fontSize: 15, lineHeight: 23, color: '#231B16', marginTop: 16 },
    section: { fontSize: 20, fontWeight: '600', color: '#231B16', marginTop: 24, marginBottom: 8, fontFamily: 'serif' },
    offer: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0E7DC' },
    offerTitle: { fontSize: 15, fontWeight: '600', color: '#231B16' },
    offerSub: { fontSize: 13, color: '#6F625A', marginTop: 2 },
    offerPrice: { fontSize: 14, color: '#231B16' },
    review: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0E7DC' },
    reviewName: { color: '#231B16', fontSize: 13, fontWeight: '600' },
    reviewBody: { fontSize: 14, color: '#231B16', marginTop: 4, lineHeight: 20 },
    term: { fontSize: 14, color: '#6F625A', marginTop: 4 },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, backgroundColor: '#FBF7F1', borderTopWidth: 1, borderTopColor: '#E9DFD3' },
    cta: { backgroundColor: '#B5562B', borderRadius: 999, height: 50, alignItems: 'center', justifyContent: 'center' },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    footNote: { fontSize: 11, color: '#9A8C82', textAlign: 'center', marginTop: 6 },
    modal: { flex: 1, backgroundColor: 'rgba(18,13,10,0.96)', justifyContent: 'center', alignItems: 'center' },
    close: { position: 'absolute', top: 50, right: 20, padding: 8 },
});
