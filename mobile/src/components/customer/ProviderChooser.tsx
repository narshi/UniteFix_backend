/**
 * Who does the job — the customer's choice while booking.
 *
 * Two cards. "Book via UniteFix" opens, in the same card, the partner
 * businesses that serve this address with their customers' rating; the first
 * row lets UniteFix choose (the default, and what every booking did before).
 * "Nearby service person" opens the verified UniteFix experts close to the
 * address. The price is UniteFix's whoever is chosen, and says so.
 *
 * Motion is the platform's own (Animated + LayoutAnimation, no extra native
 * module): the selected card's border and tint ease in, its chevron turns, the
 * card grows to its list, and the rows fade up one after another. Colours are
 * the theme's tokens only.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, LayoutAnimation, Platform, UIManager, Image, ActivityIndicator } from 'react-native';
import { ShieldCheck, Navigation, ChevronDown, Star, Sparkles, Check, Users, Briefcase, MapPin } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import type { ProviderOptions, PartnerOption, ExpertOption } from '../../api/customer.api';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ProviderChoice =
    | { type: 'unitefix' }
    | { type: 'partner'; id: number; name: string }
    | { type: 'expert'; id: number; name: string };

type Mode = 'unitefix' | 'nearby';

const GROW = {
    duration: 300,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.86 },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

const AVATAR_TINTS = [
    { bg: colors.primarySurface, fg: colors.primary },
    { bg: colors.accentLight, fg: colors.accentDark },
    { bg: colors.infoLight, fg: colors.info },
    { bg: colors.warningLight, fg: colors.warningDark },
];
const tintFor = (id: number) => AVATAR_TINTS[Math.abs(id) % AVATAR_TINTS.length];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || 'U';

/** Fades and lifts a row in, a beat after the one above it. */
function Appear({ index, children }: { index: number; children: React.ReactNode }) {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(v, { toValue: 1, duration: 320, delay: 60 + index * 55, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [v, index]);
    return (
        <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
            {children}
        </Animated.View>
    );
}

/** A soft press-down on touch. */
function usePressScale(to = 0.98) {
    const s = useRef(new Animated.Value(1)).current;
    const pressIn = () => Animated.spring(s, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
    const pressOut = () => Animated.spring(s, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    return { scale: s, pressIn, pressOut };
}

function Radio({ on }: { on: boolean }) {
    const v = useRef(new Animated.Value(on ? 1 : 0)).current;
    useEffect(() => {
        Animated.spring(v, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 22, bounciness: 9 }).start();
    }, [on, v]);
    return (
        <View style={[styles.radio, on && styles.radioOn]}>
            <Animated.View style={[styles.radioDot, { opacity: v, transform: [{ scale: v }] }]}>
                <Check size={12} color={colors.textInverse} strokeWidth={3} />
            </Animated.View>
        </View>
    );
}

function Rating({ rating, reviews }: { rating: number | null; reviews: number }) {
    if (rating == null || reviews === 0) {
        return <View style={styles.newPill}><Text style={styles.newPillText}>New</Text></View>;
    }
    return (
        <View style={styles.ratingRow}>
            <Star size={13} color={colors.warning} fill={colors.warning} />
            <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>({reviews} {reviews === 1 ? 'review' : 'reviews'})</Text>
        </View>
    );
}

function Avatar({ id, name, photoUrl, online }: { id: number; name: string; photoUrl?: string | null; online?: boolean }) {
    const t = tintFor(id);
    return (
        <View>
            {photoUrl
                ? <Image source={{ uri: photoUrl }} style={styles.avatar} />
                : <View style={[styles.avatar, { backgroundColor: t.bg }]}><Text style={[styles.avatarText, { color: t.fg }]}>{initials(name)}</Text></View>}
            {online && <View style={styles.onlineDot} />}
        </View>
    );
}

/** One choosable line inside an open card. */
function OptionRow({ selected, onPress, left, title, rating, meta, label }: {
    selected: boolean; onPress: () => void; left: React.ReactNode; title: string; rating?: React.ReactNode; meta?: string; label: string;
}) {
    const p = usePressScale(0.985);
    return (
        <Animated.View style={{ transform: [{ scale: p.scale }] }}>
            <Pressable
                onPress={onPress} onPressIn={p.pressIn} onPressOut={p.pressOut}
                style={[styles.row, selected && styles.rowOn]}
                accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label}
            >
                {left}
                <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                    {rating}
                    {!!meta && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
                </View>
                <Radio on={selected} />
            </Pressable>
        </Animated.View>
    );
}

/** A big option card; its list opens inside it when chosen. */
function ModeCard({ selected, onPress, icon, iconBg, title, subtitle, children }: {
    selected: boolean; onPress: () => void; icon: React.ReactNode; iconBg: string; title: string; subtitle: string; children?: React.ReactNode;
}) {
    const v = useRef(new Animated.Value(selected ? 1 : 0)).current;
    const p = usePressScale(0.985);
    useEffect(() => {
        Animated.timing(v, { toValue: selected ? 1 : 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    }, [selected, v]);
    const borderColor = v.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] });
    const backgroundColor = v.interpolate({ inputRange: [0, 1], outputRange: [colors.background, colors.primarySurface] });
    const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    // Two layers: the press scale runs on the native driver, the border and
    // tint on the JS driver, and a view must not mix the two. The outer one
    // also carries the shadow, which the inner one's clipping would cut off.
    return (
        <Animated.View style={[styles.cardShadow, selected && shadows.md, { transform: [{ scale: p.scale }] }]}>
        <Animated.View style={[styles.card, { borderColor, backgroundColor }]}>
            <Pressable onPress={onPress} onPressIn={p.pressIn} onPressOut={p.pressOut} style={styles.cardHead}
                accessibilityRole="radio" accessibilityState={{ selected, expanded: selected }} accessibilityLabel={`${title}. ${subtitle}`}>
                <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>{icon}</View>
                <View style={styles.cardText}>
                    <Text style={styles.cardTitle}>{title}</Text>
                    <Text style={styles.cardSubtitle}>{subtitle}</Text>
                </View>
                <Animated.View style={{ transform: [{ rotate }] }}>
                    <ChevronDown size={20} color={selected ? colors.primary : colors.textTertiary} />
                </Animated.View>
            </Pressable>
            {selected && <View style={styles.cardBody}>{children}</View>}
        </Animated.View>
        </Animated.View>
    );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <Appear index={0}>
            <View style={styles.empty}>{icon}<Text style={styles.emptyText}>{text}</Text></View>
        </Appear>
    );
}

export function ProviderChooser({ options, loading, hasAddress, value, onChange, mode, onModeChange }: {
    options?: ProviderOptions; loading: boolean; hasAddress: boolean;
    value: ProviderChoice; onChange: (c: ProviderChoice) => void;
    mode: Mode; onModeChange: (m: Mode) => void;
}) {
    const partners: PartnerOption[] = options?.partners ?? [];
    const experts: ExpertOption[] = options?.experts ?? [];

    const pickMode = (m: Mode) => {
        if (m === mode) return;
        LayoutAnimation.configureNext(GROW);
        onModeChange(m);
        // UniteFix: UniteFix chooses until a partner is picked. Nearby: the nearest expert, ready to change.
        if (m === 'unitefix') onChange({ type: 'unitefix' });
        else onChange(experts[0] ? { type: 'expert', id: experts[0].id, name: experts[0].name } : { type: 'unitefix' });
    };

    const loadingRow = (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Finding who serves your address…</Text></View>
    );

    return (
        <View style={styles.wrap}>
            <ModeCard
                selected={mode === 'unitefix'} onPress={() => pickMode('unitefix')}
                icon={<ShieldCheck size={22} color={colors.primary} />} iconBg={colors.primarySurface}
                title="Book via UniteFix" subtitle="Verified partner businesses, with their customer ratings"
            >
                <Appear index={0}>
                    <OptionRow
                        selected={value.type === 'unitefix'} onPress={() => onChange({ type: 'unitefix' })}
                        left={<View style={[styles.avatar, { backgroundColor: colors.primary }]}><Sparkles size={18} color={colors.textInverse} /></View>}
                        title="Let UniteFix choose" meta="We match you with the best available expert" label="Let UniteFix choose"
                    />
                </Appear>
                {!hasAddress ? null : loading ? loadingRow : partners.length > 0 ? (
                    <>
                        <Appear index={1}><Text style={styles.divider}>Or pick a partner near you</Text></Appear>
                        {partners.map((p, i) => (
                            <Appear key={p.id} index={i + 2}>
                                <OptionRow
                                    selected={value.type === 'partner' && value.id === p.id}
                                    onPress={() => onChange({ type: 'partner', id: p.id, name: p.name })}
                                    left={<Avatar id={p.id} name={p.name} />}
                                    title={p.name}
                                    rating={<Rating rating={p.rating} reviews={p.reviews} />}
                                    meta={`${p.jobsDone} ${p.jobsDone === 1 ? 'job' : 'jobs'} done · ${p.technicians} ${p.technicians === 1 ? 'technician' : 'technicians'}`}
                                    label={`${p.name}, ${p.rating != null && p.reviews ? `rated ${p.rating.toFixed(1)} from ${p.reviews} reviews` : 'new partner'}`}
                                />
                            </Appear>
                        ))}
                    </>
                ) : (
                    <Empty icon={<Users size={18} color={colors.textTertiary} />} text="No partner business serves this address yet. UniteFix will send its best available expert." />
                )}
            </ModeCard>

            <ModeCard
                selected={mode === 'nearby'} onPress={() => pickMode('nearby')}
                icon={<Navigation size={21} color={colors.accentDark} />} iconBg={colors.accentLight}
                title="Nearby service person" subtitle="Verified UniteFix experts close to your address"
            >
                {!hasAddress ? (
                    <Empty icon={<MapPin size={18} color={colors.textTertiary} />} text="Choose your service address first to see who is nearby." />
                ) : loading ? loadingRow : experts.length > 0 ? experts.map((e, i) => (
                    <Appear key={e.id} index={i}>
                        <OptionRow
                            selected={value.type === 'expert' && value.id === e.id}
                            onPress={() => onChange({ type: 'expert', id: e.id, name: e.name })}
                            left={<Avatar id={e.id} name={e.name} photoUrl={e.photoUrl} online={e.online} />}
                            title={e.name}
                            rating={<Rating rating={e.rating} reviews={e.reviews} />}
                            meta={`${e.distanceKm} km away · ${e.jobsDone} jobs${e.experienceYears ? ` · ${e.experienceYears} yrs` : ''}`}
                            label={`${e.name}, ${e.distanceKm} kilometres away, ${e.rating != null && e.reviews ? `rated ${e.rating.toFixed(1)}` : 'new'}`}
                        />
                    </Appear>
                )) : (
                    <Empty icon={<Briefcase size={18} color={colors.textTertiary} />} text={`No UniteFix expert is within ${options?.radiusKm ?? 15} km right now. Book via UniteFix and we will find one.`} />
                )}
            </ModeCard>

            <View style={styles.note}>
                <ShieldCheck size={14} color={colors.accentDark} />
                <Text style={styles.noteText}>Same UniteFix price and guarantee, whoever you choose.</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: spacing.md },
    cardShadow: { borderRadius: radii.xl, backgroundColor: colors.background },
    card: { borderWidth: 1.5, borderRadius: radii.xl, overflow: 'hidden' },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
    cardIcon: { width: 44, height: 44, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
    cardText: { flex: 1, minWidth: 0 },
    cardTitle: { ...typography.bodySemibold, color: colors.textPrimary },
    cardSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
    cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
    divider: { ...typography.label, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.xs, marginLeft: spacing.xs },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md,
        borderRadius: radii.lg, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.divider,
    },
    rowOn: { borderColor: colors.primaryLight, backgroundColor: colors.background, ...shadows.sm },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { ...typography.bodyMedium, color: colors.textPrimary },
    rowMeta: { ...typography.small, color: colors.textSecondary },
    avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    avatarText: { ...typography.bodySemibold },
    onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.background },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingValue: { ...typography.captionMedium, color: colors.textPrimary },
    ratingCount: { ...typography.small, color: colors.textTertiary },
    newPill: { alignSelf: 'flex-start', backgroundColor: colors.primarySurface, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 1 },
    newPillText: { ...typography.small, color: colors.primary, fontWeight: '700' },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: colors.primary },
    radioDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.xs },
    loadingText: { ...typography.caption, color: colors.textSecondary },
    empty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface },
    emptyText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
    note: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
    noteText: { ...typography.small, color: colors.textSecondary, flex: 1 },
});
