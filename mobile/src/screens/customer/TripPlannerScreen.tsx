/**
 * Plan a trip, in four steps:
 *   1 Who's going  — the host, adults and children, friends to invite (optional)
 *   2 Where        — from, round trip or one way (and to), regions and places
 *   3 Your plan    — the optimised route, day by day; pace; best picks nearby
 *   4 Details      — date, stay, cab, guide, budget, notes, contact
 * then "Send for quotation": a travel manager is assigned and calls.
 * The places come from Admin → Travel Places; the route is planned on the server.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Share, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft, Users, UserPlus, Minus, Plus, X, MapPin, Check, Star, Sparkles, Clock, Car, Moon, Repeat, ArrowRight,
    Waves, Droplets, Landmark, Sailboat, Mountain, Trees, Castle, Flag, Compass, BedDouble, CheckCircle2, Share2, Headset, Navigation,
} from 'lucide-react-native';
import {
    useTravelCatalog, travelApi, regionPhoto, hoursText, vehicleFor,
    type TripType, type Pace, type StayChoice, type TravelPlace, type TravelRegion, type PlanRequest,
} from '../../api/travel.api';
import { getApiErrorMessage } from '../../api/client';
import { useProfile } from '../../hooks/useCustomerData';
import { useBackClose } from '../../hooks/useBackClose';
import { DatePick, niceDate } from './CelebrationsScreen';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const KIND_ICON: Record<string, any> = { beach: Waves, falls: Droplets, temple: Landmark, activity: Sailboat, viewpoint: Mountain, nature: Trees, heritage: Castle, culture: Flag };
const ORANGE_SOFT = '#FFF3E3';
const NAVY_SOFT = '#EAF0F8';

type Spot = { id: number | null; text: string | null };

function Stepper({ label, sub, value, min, max, onChange }: { label: string; sub?: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
    return (
        <View style={s.stepperRow}>
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>{label}</Text>{sub ? <Text style={s.rowSub}>{sub}</Text> : null}</View>
            <Pressable onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={[s.stepBtn, value <= min && { opacity: 0.35 }]} accessibilityLabel={`${label}: fewer`}><Minus size={16} color={brand.navy} /></Pressable>
            <Text style={s.stepValue} accessibilityLiveRegion="polite">{value}</Text>
            <Pressable onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={[s.stepBtn, value >= max && { opacity: 0.35 }]} accessibilityLabel={`${label}: more`}><Plus size={16} color={brand.navy} /></Pressable>
        </View>
    );
}

function Chip({ label, on, onPress, icon: Icon }: { label: string; on: boolean; onPress: () => void; icon?: any }) {
    return (
        <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            {Icon ? <Icon size={14} color={on ? '#fff' : brand.navy} /> : null}
            <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string, any?]>; onChange: (v: T) => void }) {
    return (
        <View style={s.segment} accessibilityRole="tablist">
            {options.map(([v, label, Icon]) => (
                <Pressable key={v} onPress={() => onChange(v)} style={[s.segItem, value === v && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: value === v }}>
                    {Icon ? <Icon size={14} color={value === v ? brand.navy : brand.textSecondary} /> : null}
                    <Text style={[s.segText, value === v && s.segTextOn]}>{label}</Text>
                </Pressable>
            ))}
        </View>
    );
}

/** Where the trip starts or ends: a pickup point, or a place typed in. */
function SpotPicker({ label, value, onChange, pickups, otherLabel }: { label: string; value: Spot; onChange: (v: Spot) => void; pickups: Array<{ id: number; name: string }>; otherLabel: string }) {
    const [other, setOther] = useState(value.id == null && !!value.text);
    return (
        <View style={{ gap: spacing.sm }}>
            <Text style={s.label}>{label}</Text>
            <View style={s.chips}>
                {pickups.map(p => <Chip key={p.id} label={p.name} on={value.id === p.id} onPress={() => { setOther(false); onChange({ id: p.id, text: null }); }} />)}
                <Chip label={otherLabel} on={other} icon={Navigation} onPress={() => { setOther(true); onChange({ id: null, text: value.id == null ? value.text : '' }); }} />
            </View>
            {other && (
                <TextInput style={s.input} value={value.text ?? ''} onChangeText={text => onChange({ id: null, text })} placeholder="Village, town or address" placeholderTextColor={brand.textSecondary} accessibilityLabel={`${label}: type the place`} />
            )}
        </View>
    );
}

function PlaceRow({ p, on, onToggle }: { p: TravelPlace; on: boolean; onToggle: () => void }) {
    const { t } = useTranslation();
    const Icon = KIND_ICON[p.kind] ?? Compass;
    return (
        <Pressable onPress={onToggle} style={[s.place, on && s.placeOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${p.name}. ${p.description ?? ''}`}>
            <View style={[s.placeIcon, on && { backgroundColor: brand.navy }]}><Icon size={18} color={on ? '#fff' : brand.navy} /></View>
            <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.placeName}>{p.name}</Text>
                {p.description ? <Text style={s.placeDesc} numberOfLines={2}>{p.description}</Text> : null}
                <View style={s.badges}>
                    <View style={s.badge}><Clock size={11} color={brand.textSecondary} /><Text style={s.badgeText}>{hoursText(p.visitMinutes)}</Text></View>
                    {p.featured && <View style={[s.badge, { backgroundColor: ORANGE_SOFT }]}><Star size={11} color="#C2410C" fill="#C2410C" /><Text style={[s.badgeText, { color: '#C2410C' }]}>{t('travel.best_pick', 'Best pick')}</Text></View>}
                    {p.inSeason && p.bestMonths.length > 0 && <View style={[s.badge, { backgroundColor: '#E7F8F0' }]}><Sparkles size={11} color="#047857" /><Text style={[s.badgeText, { color: '#047857' }]}>{t('travel.in_season', 'In season')}</Text></View>}
                </View>
            </View>
            <View style={[s.check, on && s.checkOn]}>{on && <Check size={14} color="#fff" />}</View>
        </Pressable>
    );
}

export function TripPlannerScreen({ navigation, route }: any) {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const qc = useQueryClient();
    const catalog = useTravelCatalog();
    const { data: profile } = useProfile();

    const [step, setStep] = useState(0);
    // 1 · who
    const [host, setHost] = useState('');
    const [adults, setAdults] = useState(2);
    const [children, setChildren] = useState(0);
    const [members, setMembers] = useState<Array<{ name: string; phone: string }>>([]);
    // 2 · where
    const [from, setFrom] = useState<Spot>({ id: null, text: null });
    const [to, setTo] = useState<Spot>({ id: null, text: null });
    const [tripType, setTripType] = useState<TripType>('round_trip');
    const [regionIds, setRegionIds] = useState<number[]>([]);
    const [placeIds, setPlaceIds] = useState<number[]>([]);
    // 3 · plan
    const [pace, setPace] = useState<Pace>('balanced');
    // 4 · details
    const [startDate, setStartDate] = useState<string | null>(null);
    const [stay, setStay] = useState<StayChoice>('standard');
    const [rooms, setRooms] = useState(1);
    const [needsCab, setNeedsCab] = useState(true);
    const [needsGuide, setNeedsGuide] = useState(false);
    const [budget, setBudget] = useState('');
    const [notes, setNotes] = useState('');
    const [phone, setPhone] = useState('');
    const [sent, setSent] = useState<{ code: string; message: string } | null>(null);

    useEffect(() => {
        if (profile && !host) setHost((profile as any).username ?? '');
        if (profile && !phone) setPhone(String((profile as any).phone ?? '').slice(-10));
    }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { setRooms(Math.max(1, Math.ceil(adults / 2))); }, [adults]);

    const regions = catalog.data?.regions ?? [];
    const pickups = catalog.data?.pickups ?? [];
    const placeById = useMemo(() => new Map([...regions.flatMap(r => r.places), ...(catalog.data?.otherPlaces ?? [])].map(p => [p.id, p])), [catalog.data]); // eslint-disable-line react-hooks/exhaustive-deps

    // A region opened from the Travel tab starts selected, with its best picks.
    useEffect(() => {
        const rid = route?.params?.regionId;
        if (!rid || !regions.length || regionIds.length) return;
        const r = regions.find(x => x.id === rid);
        if (r) toggleRegion(r);
    }, [regions.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleRegion = (r: TravelRegion) => {
        if (regionIds.includes(r.id)) {
            setRegionIds(regionIds.filter(x => x !== r.id));
            setPlaceIds(placeIds.filter(id => placeById.get(id)?.regionId !== r.id));
        } else {
            setRegionIds([...regionIds, r.id]);
            const picks = r.places.filter(p => p.featured).slice(0, 3).map(p => p.id);
            setPlaceIds([...placeIds, ...picks.filter(id => !placeIds.includes(id))]);
        }
    };
    const togglePlace = (id: number) => setPlaceIds(placeIds.includes(id) ? placeIds.filter(x => x !== id) : [...placeIds, id]);

    const hasSpot = (v: Spot) => v.id != null || !!v.text?.trim();
    const whereReady = hasSpot(from) && (tripType === 'round_trip' || hasSpot(to)) && placeIds.length > 0;
    const planReq: PlanRequest = {
        tripType, pace, pickupId: from.id, pickupText: from.id ? null : from.text?.trim() || null,
        dropId: tripType === 'one_way' ? to.id : null, dropText: tripType === 'one_way' && !to.id ? to.text?.trim() || null : null,
        placeIds, regionIds,
    };
    const plan = useQuery({ queryKey: ['tripPlan', planReq], queryFn: () => travelApi.plan(planReq), enabled: whereReady && step >= 1, placeholderData: (prev) => prev });
    const nights = plan.data?.nights ?? 0;
    useEffect(() => { if (plan.data && plan.data.nights === 0 && stay !== 'none') setStay('none'); }, [plan.data?.nights]); // eslint-disable-line react-hooks/exhaustive-deps
    const people = adults + children;

    const phoneOk = /^[6-9]\d{9}$/.test(phone.replace(/\D/g, '').slice(-10));
    const send = useMutation({
        mutationFn: () => travelApi.send({
            ...planReq, adults, children,
            members: members.filter(m => m.name.trim()).map(m => ({ name: m.name.trim(), phone: m.phone.replace(/\D/g, '').slice(-10) || null })),
            startDate: startDate!, stay: nights === 0 ? 'none' : stay, rooms: stay === 'none' || nights === 0 ? null : rooms,
            needsCab, needsGuide, budgetPerPerson: budget ? Number(budget) : null, notes: notes.trim() || null,
            contactName: host.trim(), contactPhone: phone.replace(/\D/g, '').slice(-10),
        }),
        onSuccess: (r) => { setSent({ code: r.code, message: r.message }); setStep(4); qc.invalidateQueries({ queryKey: ['myTrips'] }); },
    });

    const STEPS = [t('travel.step_who', "Who's going"), t('travel.step_where', 'Where'), t('travel.step_plan', 'Your plan'), t('travel.step_details', 'Details')];
    const canNext = step === 0 ? adults >= 1 && host.trim().length > 0 : step === 1 ? whereReady : step === 2 ? !!plan.data && !plan.isFetching : !!startDate && phoneOk && host.trim().length > 0;
    const why = step === 0 ? t('travel.need_name', 'Add your name')
        : step === 1 ? (!hasSpot(from) ? t('travel.need_from', 'Choose where to start') : tripType === 'one_way' && !hasSpot(to) ? t('travel.need_to', 'Choose where it ends') : t('travel.need_places', 'Pick at least one place'))
            : step === 3 ? (!startDate ? t('travel.need_date', 'Pick a start date') : t('travel.need_phone', 'Add a 10-digit mobile number')) : '';

    const back = () => (step > 0 && step < 4 ? setStep(step - 1) : navigation.goBack());
    useBackClose(step > 0 && step < 4, React.useCallback(() => setStep(st => st - 1), []));
    const scrollRef = React.useRef<ScrollView>(null);
    useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [step]);
    const tileW = Math.floor((width - spacing.base * 2 - spacing.md) / 2);

    const shareTrip = () => {
        if (!sent || !plan.data) return;
        const stops = plan.data.days.flatMap(d => d.stops.filter(x => x.type === 'place').map(x => x.name));
        Share.share({ message: `${host.trim()} ${t('travel.share_invite', 'is planning a trip — you are invited!')}\n${stops.join(' → ')}\n${startDate ? niceDate(startDate) : ''} · ${plan.data.days.length} ${t('travel.days', 'days')}\n${t('travel.trip_code', 'Trip code')}: ${sent.code}` }).catch(() => {});
    };

    if (step === 4 && sent) {
        return (
            <View style={[s.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
                <ScrollView contentContainerStyle={s.doneBody}>
                    <View style={s.doneIcon}><CheckCircle2 size={56} color="#047857" /></View>
                    <Text style={s.doneTitle}>{t('travel.sent_title', 'Your plan is sent!')}</Text>
                    <Text style={s.doneText}>{t('travel.sent_body', 'Your travel manager will be assigned and will call you soon with a quotation.')}</Text>
                    <View style={s.codeBox}><Text style={s.codeLabel}>{t('travel.trip_code', 'Trip code')}</Text><Text style={s.code}>{sent.code}</Text></View>
                    <View style={s.doneSteps}>
                        {[[Headset, t('travel.next1', 'A travel manager is assigned to your trip')], [Car, t('travel.next2', 'They call you to fix the cab, stay and guide')], [Check, t('travel.next3', 'You get the quotation here and on your phone')]].map(([Icon, text]: any, i) => (
                            <View key={i} style={s.doneStep}><View style={s.doneStepIcon}><Icon size={16} color={brand.navy} /></View><Text style={s.doneStepText}>{text}</Text></View>
                        ))}
                    </View>
                    {members.some(m => m.name.trim()) && <Text style={s.rowSub}>{t('travel.invite_hint', 'Share the plan with the people you invited:')}</Text>}
                    <Pressable onPress={shareTrip} style={[s.primary, { backgroundColor: brand.navy }]} accessibilityRole="button"><Share2 size={18} color="#fff" /><Text style={s.primaryText}>{t('travel.share_group', 'Share with your group')}</Text></Pressable>
                    <Pressable onPress={() => navigation.navigate('CustomerTabs', { screen: 'TravelTab' })} style={s.secondary} accessibilityRole="button"><Text style={s.secondaryText}>{t('travel.see_trips', 'See my trips')}</Text></Pressable>
                </ScrollView>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.header, { paddingTop: insets.top + 6 }]}>
                <View style={s.headerRow}>
                    <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back', 'Back')} style={s.backBtn}><ArrowLeft size={22} color="#fff" /></Pressable>
                    <View style={{ flex: 1 }}>
                        <Text style={s.headerTitle}>{STEPS[step]}</Text>
                        <Text style={s.headerSub}>{t('travel.step_of', 'Step {{n}} of 4', { n: step + 1 })}</Text>
                    </View>
                    {plan.data && step >= 1 && <View style={s.headerPill}><Text style={s.headerPillText}>{plan.data.days.length} {t('travel.days_short', 'd')} · {plan.data.totalKm} km</Text></View>}
                </View>
                <View style={s.progress}>{STEPS.map((_, i) => <View key={i} style={[s.progressBit, i <= step && s.progressOn]} />)}</View>
            </View>

            <ScrollView ref={scrollRef} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
                {catalog.isLoading && <ActivityIndicator color={brand.navy} style={{ marginTop: spacing.xl }} />}

                {step === 0 && (
                    <>
                        <View style={s.card}>
                            <Text style={s.label}>{t('travel.host', 'You are the host')}</Text>
                            <TextInput style={s.input} value={host} onChangeText={setHost} placeholder={t('travel.your_name', 'Your name')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('travel.your_name', 'Your name')} />
                        </View>
                        <View style={s.card}>
                            <View style={s.cardHead}><Users size={18} color={brand.navy} /><Text style={s.cardTitle}>{t('travel.how_many', 'How many are going?')}</Text></View>
                            <Stepper label={t('travel.adults', 'Adults')} sub={t('travel.adults_sub', 'Including you')} value={adults} min={1} max={60} onChange={setAdults} />
                            <Stepper label={t('travel.children', 'Children')} sub={t('travel.children_sub', 'Under 12')} value={children} min={0} max={40} onChange={setChildren} />
                            <View style={s.hintRow}><Car size={14} color={brand.textSecondary} /><Text style={s.rowSub}>{t('travel.vehicle_hint', 'For {{n}} people: {{v}}', { n: people, v: vehicleFor(people) })}</Text></View>
                        </View>
                        <View style={s.card}>
                            <View style={s.cardHead}><UserPlus size={18} color={brand.navy} /><Text style={s.cardTitle}>{t('travel.invite', 'Invite your group')}</Text><Text style={s.optional}>{t('travel.optional', 'Optional')}</Text></View>
                            <Text style={s.rowSub}>{t('travel.invite_body', 'Add who is coming. Once you send the plan, share it with them in one tap.')}</Text>
                            {members.map((m, i) => (
                                <View key={i} style={s.memberRow}>
                                    <TextInput style={[s.input, { flex: 1.2 }]} value={m.name} onChangeText={v => setMembers(members.map((x, j) => (j === i ? { ...x, name: v } : x)))} placeholder={t('travel.name', 'Name')} placeholderTextColor={brand.textSecondary} accessibilityLabel={`${t('travel.name', 'Name')} ${i + 1}`} />
                                    <TextInput style={[s.input, { flex: 1 }]} value={m.phone} onChangeText={v => setMembers(members.map((x, j) => (j === i ? { ...x, phone: v.replace(/[^\d+ ]/g, '') } : x)))} placeholder={t('travel.phone_opt', 'Phone')} keyboardType="phone-pad" placeholderTextColor={brand.textSecondary} accessibilityLabel={`${t('travel.phone_opt', 'Phone')} ${i + 1}`} />
                                    <Pressable onPress={() => setMembers(members.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={t('travel.remove', 'Remove')}><X size={18} color={brand.textSecondary} /></Pressable>
                                </View>
                            ))}
                            <Pressable onPress={() => setMembers([...members, { name: '', phone: '' }])} style={s.addRow} accessibilityRole="button"><Plus size={16} color={brand.navy} /><Text style={s.addText}>{t('travel.add_person', 'Add a person')}</Text></Pressable>
                        </View>
                    </>
                )}

                {step === 1 && catalog.data && (
                    <>
                        <View style={s.card}>
                            <SpotPicker label={t('travel.from', 'Starting from')} value={from} onChange={setFrom} pickups={pickups} otherLabel={t('travel.other_place', 'Other place')} />
                            <Segmented value={tripType} onChange={setTripType} options={[['round_trip', t('travel.round_trip', 'Round trip'), Repeat], ['one_way', t('travel.one_way', 'One way'), ArrowRight]]} />
                            {tripType === 'one_way'
                                ? <SpotPicker label={t('travel.to', 'Ending at')} value={to} onChange={setTo} pickups={pickups} otherLabel={t('travel.other_place', 'Other place')} />
                                : <Text style={s.rowSub}>{t('travel.round_hint', 'You come back to where you started.')}</Text>}
                        </View>

                        <Text style={s.sectionTitle}>{t('travel.choose_regions', 'Choose where to go')}</Text>
                        <View style={s.tiles}>
                            {regions.map(r => {
                                const on = regionIds.includes(r.id);
                                return (
                                    <Pressable key={r.id} onPress={() => toggleRegion(r)} style={[s.tile, { width: tileW }, on && s.tileOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${r.name}. ${r.tagline ?? ''}`}>
                                        <Image source={regionPhoto(r)} style={{ width: '100%', height: tileW * 0.62 }} contentFit="cover" />
                                        {on && <View style={s.tileCheck}><Check size={14} color="#fff" /></View>}
                                        {r.inSeason && <View style={s.tileSeason}><Text style={s.tileSeasonText}>{t('travel.in_season', 'In season')}</Text></View>}
                                        <View style={s.tileBody}><Text style={s.tileName} numberOfLines={1}>{r.name}</Text><Text style={s.tileLine} numberOfLines={1}>{r.places.length} {t('travel.places', 'places')}</Text></View>
                                    </Pressable>
                                );
                            })}
                        </View>

                        {regions.filter(r => regionIds.includes(r.id)).map(r => (
                            <View key={r.id} style={{ gap: spacing.sm }}>
                                <View style={s.regionHead}>
                                    <Text style={s.sectionTitle}>{r.name}</Text>
                                    <Text style={s.rowSub}>{r.places.filter(p => placeIds.includes(p.id)).length}/{r.places.length}</Text>
                                </View>
                                {[...r.places].sort((a, b) => Number(b.featured) - Number(a.featured)).map(p => <PlaceRow key={p.id} p={p} on={placeIds.includes(p.id)} onToggle={() => togglePlace(p.id)} />)}
                            </View>
                        ))}
                        {regionIds.length === 0 && <Text style={s.empty}>{t('travel.pick_region_hint', 'Pick one or more regions above, then choose the places. Best picks are ticked for you.')}</Text>}
                    </>
                )}

                {step === 2 && (
                    !plan.data ? <ActivityIndicator color={brand.navy} style={{ marginTop: spacing.xl }} /> : (
                        <>
                            <View style={s.summary}>
                                {[
                                    [plan.data.days.length, t('travel.days', 'days')],
                                    [plan.data.nights, t('travel.nights', 'nights')],
                                    [`${plan.data.totalKm}`, 'km'],
                                    [`${Math.floor(plan.data.totalDriveMinutes / 60)}h ${plan.data.totalDriveMinutes % 60}m`, t('travel.driving', 'driving')],
                                ].map(([v, l], i) => <View key={i} style={s.sumCell}><Text style={s.sumValue}>{v}</Text><Text style={s.sumLabel}>{l}</Text></View>)}
                            </View>
                            <View style={s.card}>
                                <Text style={s.label}>{t('travel.pace', 'Pace')}</Text>
                                <Segmented value={pace} onChange={setPace} options={[['relaxed', t('travel.relaxed', 'Relaxed')], ['balanced', t('travel.balanced', 'Balanced')], ['packed', t('travel.packed', 'Packed')]]} />
                                <Text style={s.rowSub}>{pace === 'relaxed' ? t('travel.relaxed_sub', 'About 7 hours of travel and sightseeing a day') : pace === 'balanced' ? t('travel.balanced_sub', 'About 9 hours a day') : t('travel.packed_sub', 'About 11 hours a day, fewer nights')}</Text>
                                <Text style={s.rowSub}>{tripType === 'round_trip' ? t('travel.plan_round', 'Round trip, back to the start. Order chosen for the least driving.') : t('travel.plan_oneway', 'One way. Order chosen for the least driving towards your end point.')}</Text>
                            </View>
                            {plan.isFetching && <ActivityIndicator color={brand.navy} />}
                            {plan.data.days.map(d => (
                                <View key={d.day} style={s.day}>
                                    <View style={s.dayHead}>
                                        <View style={s.dayBadge}><Text style={s.dayBadgeText}>{t('travel.day', 'Day')} {d.day}</Text></View>
                                        <Text style={s.dayMeta}>{d.km} km · {hoursText(d.minutes)}</Text>
                                    </View>
                                    {d.stops.map((x, i) => (
                                        <View key={i}>
                                            {x.driveKm > 0 && (
                                                <View style={s.leg}><View style={s.legLine} /><Car size={13} color={brand.textSecondary} /><Text style={s.legText}>{x.driveKm} km · {hoursText(x.driveMinutes)}</Text></View>
                                            )}
                                            <View style={s.stop}>
                                                <View style={[s.dot, x.type !== 'place' && s.dotEnd]} />
                                                <View style={{ flex: 1 }}>
                                                    <Text style={[s.stopName, x.type !== 'place' && { color: brand.textSecondary }]}>{x.name}</Text>
                                                    {x.type === 'place' ? <Text style={s.stopSub}>{hoursText(x.visitMinutes)} {t('travel.there', 'there')}</Text>
                                                        : <Text style={s.stopSub}>{x.type === 'start' ? (d.day === 1 ? t('travel.start', 'Start') : t('travel.morning', 'Morning')) : tripType === 'round_trip' ? t('travel.back_home', 'Back home') : t('travel.end', 'Trip ends')}</Text>}
                                                </View>
                                            </View>
                                        </View>
                                    ))}
                                    {d.stayNear && <View style={s.night}><Moon size={14} color="#6D28D9" /><Text style={s.nightText}>{t('travel.night_near', 'Night near {{place}}', { place: d.stayNear })}</Text></View>}
                                </View>
                            ))}
                            {plan.data.startUnknown && <Text style={s.rowSub}>{t('travel.start_unknown', 'Your travel manager will confirm the drive from your pickup on the call.')}</Text>}
                            {plan.data.suggestions.length > 0 && (
                                <View style={{ gap: spacing.sm }}>
                                    <Text style={s.sectionTitle}>{t('travel.best_nearby', 'Best picks on your way')}</Text>
                                    {plan.data.suggestions.map(sg => (
                                        <View key={sg.id} style={s.suggest}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={s.placeName}>{sg.name}</Text>
                                                <Text style={s.rowSub}>{sg.detourKm > 0 ? t('travel.detour', '+{{km}} km', { km: sg.detourKm }) : t('travel.on_route', 'On your route')}{sg.regionName ? ` · ${sg.regionName}` : ''}{sg.inSeason ? ` · ${t('travel.in_season', 'In season')}` : ''}</Text>
                                            </View>
                                            <Pressable onPress={() => { togglePlace(sg.id); const r = placeById.get(sg.id)?.regionId; if (r && !regionIds.includes(r)) setRegionIds([...regionIds, r]); }} style={s.addBtn} accessibilityRole="button" accessibilityLabel={`${t('travel.add', 'Add')} ${sg.name}`}>
                                                <Plus size={15} color="#fff" /><Text style={s.addBtnText}>{t('travel.add', 'Add')}</Text>
                                            </Pressable>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </>
                    )
                )}

                {step === 3 && (
                    <>
                        <View style={s.card}>
                            <Text style={s.label}>{t('travel.start_date', 'Start date')}{startDate ? ` · ${niceDate(startDate)}` : ''}</Text>
                            <DatePick value={startDate} onChange={setStartDate} />
                        </View>
                        {nights > 0 && (
                            <View style={s.card}>
                                <View style={s.cardHead}><BedDouble size={18} color={brand.navy} /><Text style={s.cardTitle}>{t('travel.stay', 'Stay')} · {nights} {t('travel.nights', 'nights')}</Text></View>
                                <View style={s.chips}>
                                    {([['none', t('travel.stay_none', 'No stay needed')], ['budget', t('travel.stay_budget', 'Budget')], ['standard', t('travel.stay_standard', 'Standard hotel')], ['premium', t('travel.stay_premium', 'Premium / resort')], ['homestay', t('travel.stay_home', 'Homestay')]] as Array<[StayChoice, string]>)
                                        .map(([v, l]) => <Chip key={v} label={l} on={stay === v} onPress={() => setStay(v)} />)}
                                </View>
                                {stay !== 'none' && <Stepper label={t('travel.rooms', 'Rooms')} value={rooms} min={1} max={40} onChange={setRooms} />}
                            </View>
                        )}
                        <View style={s.card}>
                            <Pressable onPress={() => setNeedsCab(!needsCab)} style={s.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: needsCab }}>
                                <Car size={18} color={brand.navy} />
                                <View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('travel.cab', 'Cab for the trip')}</Text><Text style={s.rowSub}>{needsCab ? vehicleFor(people) : t('travel.own_vehicle', 'We have our own vehicle')}</Text></View>
                                <View style={[s.switch, needsCab && s.switchOn]}><View style={[s.knob, needsCab && s.knobOn]} /></View>
                            </Pressable>
                            <Pressable onPress={() => setNeedsGuide(!needsGuide)} style={s.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: needsGuide }}>
                                <Compass size={18} color={brand.navy} />
                                <View style={{ flex: 1 }}><Text style={s.rowTitle}>{t('travel.guide', 'Local guide')}</Text><Text style={s.rowSub}>{t('travel.guide_sub', 'Someone who knows the places and the stories')}</Text></View>
                                <View style={[s.switch, needsGuide && s.switchOn]}><View style={[s.knob, needsGuide && s.knobOn]} /></View>
                            </Pressable>
                        </View>
                        <View style={s.card}>
                            <Text style={s.label}>{t('travel.budget', 'Budget per person (optional)')}</Text>
                            <TextInput style={s.input} value={budget} onChangeText={v => setBudget(v.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" placeholder="₹ 5,000" placeholderTextColor={brand.textSecondary} accessibilityLabel={t('travel.budget', 'Budget per person (optional)')} />
                            <Text style={s.label}>{t('travel.notes', 'Anything else?')}</Text>
                            <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} value={notes} onChangeText={setNotes} multiline maxLength={1000} placeholder={t('travel.notes_ph', 'Food, senior citizens, rafting, a birthday…')} placeholderTextColor={brand.textSecondary} accessibilityLabel={t('travel.notes', 'Anything else?')} />
                        </View>
                        <View style={s.card}>
                            <Text style={s.label}>{t('travel.call_on', 'Your travel manager will call')}</Text>
                            <TextInput style={s.input} value={phone} onChangeText={v => setPhone(v.replace(/\D/g, '').slice(-10))} keyboardType="phone-pad" placeholder="98450 12345" placeholderTextColor={brand.textSecondary} accessibilityLabel={t('travel.mobile', 'Mobile number')} />
                        </View>
                        {send.isError && <Text style={s.error}>{getApiErrorMessage(send.error)}</Text>}
                    </>
                )}
            </ScrollView>

            <View style={[s.footer, { paddingBottom: insets.bottom + spacing.md }]}>
                {!canNext && why ? <Text style={s.why}>{why}</Text> : null}
                {step === 1 && plan.data && whereReady && <Text style={s.footerPlan}>{plan.data.days.length} {t('travel.days', 'days')} · {plan.data.totalKm} km · {placeIds.length} {t('travel.places', 'places')}</Text>}
                <Pressable
                    onPress={() => (step < 3 ? setStep(step + 1) : send.mutate())}
                    disabled={!canNext || send.isPending}
                    style={[s.primary, (!canNext || send.isPending) && { opacity: 0.45 }]}
                    accessibilityRole="button"
                >
                    {send.isPending ? <ActivityIndicator color="#fff" /> : <>
                        {step === 3 ? <Headset size={18} color="#fff" /> : step === 1 ? <MapPin size={18} color="#fff" /> : null}
                        <Text style={s.primaryText}>{step === 0 ? t('travel.next_where', 'Next: where to go') : step === 1 ? t('travel.see_plan', 'See my plan') : step === 2 ? t('travel.next_details', 'Next: a few details') : t('travel.send_quote', 'Send for quotation')}</Text>
                    </>}
                </Pressable>
            </View>
        </KeyboardAvoidingView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: brand.background },
    header: { backgroundColor: brand.navy, paddingHorizontal: spacing.base, paddingBottom: spacing.md, gap: spacing.md },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
    headerTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
    headerSub: { color: brand.onNavyMuted, fontSize: 12 },
    headerPill: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 5 },
    headerPillText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    progress: { flexDirection: 'row', gap: 6 },
    progressBit: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
    progressOn: { backgroundColor: brand.orange },
    body: { padding: spacing.base, gap: spacing.md, paddingBottom: 140 },
    card: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base, gap: spacing.md },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { fontSize: 16, fontWeight: '700', color: brand.text, flex: 1 },
    optional: { fontSize: 12, color: brand.textSecondary },
    label: { fontSize: 13, fontWeight: '700', color: brand.text },
    input: { borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.lg, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 9, fontSize: 15, color: brand.text, backgroundColor: '#FBFCFE' },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    rowTitle: { fontSize: 15, fontWeight: '600', color: brand.text },
    rowSub: { fontSize: 13, color: brand.textSecondary, lineHeight: 18 },
    stepBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: brand.cardBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY_SOFT },
    stepValue: { minWidth: 28, textAlign: 'center', fontSize: 18, fontWeight: '800', color: brand.text },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
    addText: { color: brand.navy, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: brand.cardBorder, borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
    chipOn: { backgroundColor: brand.navy, borderColor: brand.navy },
    chipText: { fontSize: 13, color: brand.text, fontWeight: '600' },
    chipTextOn: { color: '#fff' },
    segment: { flexDirection: 'row', backgroundColor: '#EEF2F7', borderRadius: radii.lg, padding: 4, gap: 4 },
    segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: radii.md },
    segOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segText: { fontSize: 13, fontWeight: '600', color: brand.textSecondary },
    segTextOn: { color: brand.navy },
    sectionTitle: { fontSize: 16, fontWeight: '800', color: brand.text, marginTop: spacing.sm },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    tile: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' },
    tileOn: { borderColor: brand.orange },
    tileCheck: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: brand.orange, alignItems: 'center', justifyContent: 'center' },
    tileSeason: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(4,120,87,0.92)', borderRadius: radii.full, paddingHorizontal: 7, paddingVertical: 2 },
    tileSeasonText: { color: '#fff', fontSize: 10, fontWeight: '700' },
    tileBody: { padding: 10 },
    tileName: { fontSize: 14, fontWeight: '800', color: brand.text },
    tileLine: { fontSize: 12, color: brand.textSecondary },
    regionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    place: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#fff', borderRadius: radii.lg, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.md },
    placeOn: { borderColor: brand.navy, backgroundColor: '#F7FAFE' },
    placeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: NAVY_SOFT, alignItems: 'center', justifyContent: 'center' },
    placeName: { fontSize: 15, fontWeight: '700', color: brand.text },
    placeDesc: { fontSize: 12, color: brand.textSecondary, lineHeight: 17 },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F1F4F8', borderRadius: radii.full, paddingHorizontal: 7, paddingVertical: 2 },
    badgeText: { fontSize: 11, color: brand.textSecondary, fontWeight: '600' },
    check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: brand.cardBorder, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: brand.navy, borderColor: brand.navy },
    empty: { color: brand.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: spacing.lg },
    summary: { flexDirection: 'row', backgroundColor: brand.navy, borderRadius: radii.xl, paddingVertical: spacing.base },
    sumCell: { flex: 1, alignItems: 'center' },
    sumValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
    sumLabel: { color: brand.onNavyMuted, fontSize: 11, marginTop: 2 },
    day: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
    dayBadge: { backgroundColor: ORANGE_SOFT, borderRadius: radii.full, paddingHorizontal: 10, paddingVertical: 4 },
    dayBadgeText: { color: '#C2410C', fontWeight: '800', fontSize: 13 },
    dayMeta: { fontSize: 12, color: brand.textSecondary },
    leg: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3, paddingVertical: 4 },
    legLine: { width: 2, height: 18, backgroundColor: brand.cardBorder, marginRight: 8 },
    legText: { fontSize: 12, color: brand.textSecondary },
    stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: brand.navy, marginTop: 5 },
    dotEnd: { backgroundColor: '#fff', borderWidth: 2, borderColor: brand.textSecondary },
    stopName: { fontSize: 15, fontWeight: '700', color: brand.text },
    stopSub: { fontSize: 12, color: brand.textSecondary },
    night: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F4EFFF', borderRadius: radii.md, padding: 8, marginTop: spacing.sm },
    nightText: { color: '#5B21B6', fontSize: 13, fontWeight: '600' },
    suggest: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#fff', borderRadius: radii.lg, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.md },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: brand.orange, borderRadius: radii.full, paddingHorizontal: 12, paddingVertical: 7 },
    addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: '#D5DCE5', padding: 3 },
    switchOn: { backgroundColor: '#047857' },
    knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
    knobOn: { transform: [{ translateX: 18 }] },
    error: { color: '#B91C1C', fontSize: 14, textAlign: 'center' },
    footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: brand.cardBorder, paddingHorizontal: spacing.base, paddingTop: spacing.md, gap: 6 },
    why: { fontSize: 12, color: brand.textSecondary, textAlign: 'center' },
    footerPlan: { fontSize: 12, color: brand.navy, textAlign: 'center', fontWeight: '700' },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: brand.orange, borderRadius: radii.full, paddingVertical: 14 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    secondary: { alignItems: 'center', paddingVertical: 12 },
    secondaryText: { color: brand.navy, fontSize: 15, fontWeight: '700' },
    doneBody: { padding: spacing.xl, alignItems: 'stretch', gap: spacing.base },
    doneIcon: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: '#E7F8F0', alignItems: 'center', justifyContent: 'center' },
    doneTitle: { fontSize: 24, fontWeight: '800', color: brand.text, textAlign: 'center' },
    doneText: { fontSize: 15, color: brand.textSecondary, textAlign: 'center', lineHeight: 22 },
    codeBox: { alignSelf: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: radii.lg, borderWidth: 1, borderColor: brand.cardBorder, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
    codeLabel: { fontSize: 12, color: brand.textSecondary },
    code: { fontSize: 22, fontWeight: '800', color: brand.navy, letterSpacing: 1 },
    doneSteps: { backgroundColor: '#fff', borderRadius: radii.xl, borderWidth: 1, borderColor: brand.cardBorder, padding: spacing.base, gap: spacing.md },
    doneStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    doneStepIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: NAVY_SOFT, alignItems: 'center', justifyContent: 'center' },
    doneStepText: { flex: 1, fontSize: 14, color: brand.text },
});
