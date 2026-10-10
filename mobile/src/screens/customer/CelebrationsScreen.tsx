/**
 * Celebrations — halls, photographers and event planners near the customer,
 * for their date. Results come from the same search as the website; a card
 * opens the partner's details, and booking a date happens on the partner's
 * page (it holds the date and takes the advance). "My celebrations" lists the
 * customer's requests and bookings — from the app, or made on the web with
 * the same mobile number.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, ChevronLeft, ChevronRight, Star, CalendarDays, X } from 'lucide-react-native';
import { apiClient, WEB_BASE_URL } from '../../api/client';
import { useProfile } from '../../hooks/useCustomerData';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';

export type CelebrationType = 'halls' | 'photographers' | 'planners';
type Card = { code: string; name: string; city: string | null; featured: boolean; rating: { avg: number; count: number } | null; cover: string | null; tagline: string | null; from: number | null; available: boolean | null; capacity?: number; highlights: string[]; since?: number | null; url: string };
type Mine = { id: number; partner: string; eventType: string; eventDate: string | null; status: string; kind?: string; page?: string; quotation: { status: string; total: number; link: string } | null };

const TYPES: Array<[CelebrationType, string]> = [['halls', 'Halls'], ['photographers', 'Photographers'], ['planners', 'Planners']];
const STATUS: Record<string, string> = { new: 'Waiting for them', contacted: 'In discussion', quoted: 'Quotation ready', won: 'Booked', lost: 'Closed' };
const ist = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthAdd = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
export const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** A small month calendar — no native date picker needed. */
export function DatePick({ value, onChange }: { value: string | null; onChange: (d: string | null) => void }) {
    const [month, setMonth] = useState((value ?? addDays(ist(), 1)).slice(0, 7));
    const first = `${month}-01`;
    const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
    const days: string[] = [];
    for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
    const min = addDays(ist(), 1);
    return (
        <View style={cal.box}>
            <View style={cal.head}>
                <TouchableOpacity accessibilityLabel="Previous month" disabled={month <= ist().slice(0, 7)} onPress={() => setMonth(monthAdd(month, -1))} style={cal.nav}><ChevronLeft size={18} color={colors.textPrimary} /></TouchableOpacity>
                <Text style={cal.title}>{new Date(`${first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</Text>
                <TouchableOpacity accessibilityLabel="Next month" onPress={() => setMonth(monthAdd(month, 1))} style={cal.nav}><ChevronRight size={18} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <View style={cal.grid}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <Text key={i} style={[cal.cell, cal.dow]}>{x}</Text>)}
                {Array.from({ length: lead }).map((_, i) => <View key={`b${i}`} style={cal.cell} />)}
                {days.map(d => {
                    const off = d < min, on = d === value;
                    return (
                        <TouchableOpacity key={d} disabled={off} onPress={() => onChange(on ? null : d)} style={[cal.cell, on && cal.on]} accessibilityLabel={niceDate(d)} accessibilityState={{ selected: on, disabled: off }}>
                            <Text style={[cal.day, off && { color: colors.textDisabled }, on && { color: '#fff', fontWeight: '700' }]}>{Number(d.slice(8))}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

export function CelebrationsScreen({ navigation }: any) {
    const { data: profile } = useProfile();
    const pin = (profile as any)?.pinCode as string | undefined;
    const [type, setType] = useState<CelebrationType>('halls');
    const [where, setWhere] = useState('');
    const [date, setDate] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [guests, setGuests] = useState('');
    const place = where.trim() || pin || '';
    const qs = useMemo(() => {
        const q = new URLSearchParams({ type });
        if (/^\d{6}$/.test(place)) q.set('pincode', place); else if (place) q.set('city', place);
        if (date) q.set('date', date);
        if (guests) q.set('guests', guests);
        return q.toString();
    }, [type, place, date, guests]);
    const res = useQuery<{ results: Card[] }>({ queryKey: ['celebrations', qs], queryFn: async () => (await apiClient.get(`/api/public/celebrations/search?${qs}`)).data?.data });
    const mine = useQuery<Mine[]>({ queryKey: ['myEventEnquiries'], queryFn: async () => (await apiClient.get('/api/events/my-enquiries')).data?.data ?? [] });
    const results = res.data?.results ?? [];

    return (
        <SafeAreaView style={s.container} edges={['top']}>
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
                <View style={s.hero}>
                    <View style={s.badge}><Sparkles size={14} color="#B5562B" /><Text style={s.badgeText}>CELEBRATIONS</Text></View>
                    <Text style={s.h1}>Your hall, photographer and planner — for your date</Text>
                    <Text style={s.lead}>Real availability, clear prices and reviews only from real bookings.</Text>
                </View>
                <View style={s.tabs} accessibilityRole="tablist">
                    {TYPES.map(([t, l]) => (
                        <TouchableOpacity key={t} onPress={() => setType(t)} style={[s.tab, type === t && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: type === t }}>
                            <Text style={[s.tabText, type === t && s.tabTextOn]}>{l}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={s.searchBox}>
                    <TextInput style={s.input} placeholder={pin ? `Near ${pin} — or type a town` : 'Town or pincode'} placeholderTextColor={colors.textTertiary} value={where} onChangeText={setWhere} accessibilityLabel="Where" />
                    <View style={s.row}>
                        <TouchableOpacity style={[s.input, s.dateBtn]} onPress={() => setPicking(!picking)} accessibilityLabel="Date">
                            <CalendarDays size={16} color={colors.textSecondary} />
                            <Text style={{ color: date ? colors.textPrimary : colors.textTertiary, flex: 1 }}>{date ? niceDate(date) : 'Any date'}</Text>
                            {date && <TouchableOpacity onPress={() => setDate(null)} accessibilityLabel="Clear date"><X size={16} color={colors.textSecondary} /></TouchableOpacity>}
                        </TouchableOpacity>
                        <TextInput style={[s.input, { width: 96 }]} placeholder="Guests" keyboardType="number-pad" placeholderTextColor={colors.textTertiary} value={guests} onChangeText={v => setGuests(v.replace(/\D/g, ''))} accessibilityLabel="Guests" />
                    </View>
                    {picking && <DatePick value={date} onChange={d => { setDate(d); setPicking(false); }} />}
                </View>

                {res.isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}
                {res.isError && <Text style={s.muted}>Could not load. Pull down to try again.</Text>}
                {!res.isLoading && results.length === 0 && <Text style={s.muted}>Nobody here yet — try a nearby town or another date.</Text>}
                {results.map(c => (
                    <TouchableOpacity key={c.code} style={s.card} activeOpacity={0.9} onPress={() => navigation.navigate('CelebrationDetail', { type, code: c.code, url: c.url, date, guests: guests || null, name: c.name })}>
                        <View style={s.coverWrap}>
                            {c.cover ? <Image source={{ uri: c.cover }} style={s.cover} contentFit="cover" transition={200} /> : <View style={[s.cover, { backgroundColor: '#EFE6DB' }]} />}
                            <View style={s.tags}>
                                {c.featured && <Text style={[s.tag, s.tagDark]}>Featured</Text>}
                                {c.available === true && date && <Text style={[s.tag, { color: '#24603A' }]}>Free on {niceDate(date)}</Text>}
                                {c.available === false && <Text style={[s.tag, { color: '#9B2C2C' }]}>Booked that day</Text>}
                            </View>
                        </View>
                        <View style={s.cardBody}>
                            <View style={{ flex: 1 }}>
                                <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                                <Text style={s.meta} numberOfLines={1}>{[c.city, c.capacity ? `up to ${c.capacity} guests` : null, c.since ? `since ${c.since}` : null].filter(Boolean).join(' · ')}</Text>
                                {c.highlights.length > 0 && <Text style={s.hl} numberOfLines={1}>{c.highlights.join(' · ')}</Text>}
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                {c.rating && <View style={s.rating}><Star size={12} color="#B98B2E" fill="#B98B2E" /><Text style={s.ratingText}>{c.rating.avg.toFixed(1)} ({c.rating.count})</Text></View>}
                                {c.from != null && <Text style={s.price}>from {rs(c.from)}</Text>}
                            </View>
                        </View>
                    </TouchableOpacity>
                ))}

                {(mine.data ?? []).length > 0 && <Text style={s.section}>My celebrations</Text>}
                {(mine.data ?? []).map(m => (
                    <TouchableOpacity key={m.id} style={s.mine} onPress={() => Linking.openURL(`${WEB_BASE_URL}${m.page ?? m.quotation?.link ?? ''}`)} accessibilityRole="link">
                        <View style={{ flex: 1 }}>
                            <Text style={s.mineTitle}>{m.eventType} · {m.partner}</Text>
                            <Text style={s.meta}>{STATUS[m.status] ?? m.status}{m.eventDate ? ` · ${niceDate(m.eventDate)}` : ''}{m.quotation ? ` · ${rs(m.quotation.total)}` : ''}</Text>
                        </View>
                        <ChevronRight size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#FBF7F1' },
    body: { padding: spacing.base, paddingBottom: 140 },
    hero: { marginTop: spacing.sm, marginBottom: spacing.md },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    badgeText: { fontSize: 11, letterSpacing: 2, color: '#B5562B', fontWeight: '600' },
    h1: { fontSize: 26, lineHeight: 32, fontWeight: '600', color: '#231B16', marginTop: 8, fontFamily: 'serif' },
    lead: { ...typography.body, color: '#6F625A', marginTop: 6 },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
    tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#D9CBBB', backgroundColor: '#fff' },
    tabOn: { backgroundColor: '#231B16', borderColor: '#231B16' },
    tabText: { fontSize: 14, color: '#231B16' },
    tabTextOn: { color: '#fff', fontWeight: '600' },
    searchBox: { backgroundColor: '#fff', borderRadius: 20, padding: 12, gap: 10, borderWidth: 1, borderColor: '#E9DFD3', marginBottom: spacing.lg },
    row: { flexDirection: 'row', gap: 10 },
    input: { borderWidth: 1, borderColor: '#E2D6C8', borderRadius: 12, paddingHorizontal: 12, height: 44, color: colors.textPrimary, backgroundColor: '#fff' },
    dateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    muted: { ...typography.body, color: '#6F625A', marginTop: spacing.md, textAlign: 'center' },
    card: { marginBottom: spacing.lg },
    coverWrap: { borderRadius: 20, overflow: 'hidden' },
    cover: { width: '100%', aspectRatio: 4 / 3 },
    tags: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 },
    tag: { backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
    tagDark: { backgroundColor: 'rgba(35,27,22,0.85)', color: '#fff' },
    cardBody: { flexDirection: 'row', gap: 10, marginTop: 10 },
    name: { fontSize: 19, fontWeight: '600', color: '#231B16', fontFamily: 'serif' },
    meta: { fontSize: 13, color: '#6F625A', marginTop: 2 },
    hl: { fontSize: 12, color: '#9A8C82', marginTop: 2 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingText: { fontSize: 13, color: '#231B16' },
    price: { fontSize: 14, color: '#231B16', marginTop: 4, fontWeight: '600' },
    section: { fontSize: 20, fontWeight: '600', color: '#231B16', marginTop: spacing.lg, marginBottom: spacing.sm, fontFamily: 'serif' },
    mine: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radii.lg, padding: spacing.base, borderWidth: 1, borderColor: '#E9DFD3', marginBottom: spacing.sm },
    mineTitle: { fontSize: 15, fontWeight: '600', color: '#231B16' },
});

const cal = StyleSheet.create({
    box: { borderTopWidth: 1, borderTopColor: '#F0E7DC', paddingTop: 8 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nav: { padding: 8 },
    title: { fontSize: 15, fontWeight: '600', color: '#231B16' },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    dow: { fontSize: 11, color: '#9A8C82', textAlign: 'center', textAlignVertical: 'center' },
    day: { fontSize: 14, color: '#231B16' },
    on: { backgroundColor: '#231B16' },
});
