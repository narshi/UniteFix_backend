/**
 * Who does the job — the customer's choice while booking.
 *
 * One card, "Book via UniteFix": "Let UniteFix choose" (the default, and what
 * every booking did before) and the partner businesses that serve this
 * address, with their customers' rating. Customers choose among partners
 * only; which UniteFix expert goes is UniteFix's call. The price is
 * UniteFix's whoever is chosen, and says so.
 *
 * Motion is the platform's own (Animated + LayoutAnimation, no extra native
 * module): the selected card's border and tint ease in, its chevron turns, the
 * card grows to its list, and the rows fade up one after another. Colours are
 * the theme's tokens only.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, LayoutAnimation, Platform, UIManager, Image, ActivityIndicator, TextInput } from 'react-native';
import { ShieldCheck, ChevronDown, Star, Sparkles, Check, Users, Ticket } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import type { ProviderOptions, PartnerOption } from '../../api/customer.api';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type ProviderChoice =
    | { type: 'unitefix' }
    | { type: 'partner'; id: number; name: string; code?: string };

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
function OptionRow({ selected, onPress, left, title, rating, meta, label, tag }: {
    selected: boolean; onPress: () => void; left: React.ReactNode; title: string; rating?: React.ReactNode; meta?: string; label: string; tag?: string;
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
                    {!!tag && <View style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>}
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
function ModeCard({ selected, onPress, icon, iconBg, title, subtitle, children, fixed }: {
    selected: boolean; onPress: () => void; icon: React.ReactNode; iconBg: string; title: string; subtitle: string; children?: React.ReactNode;
    /** Always open: no toggle and no chevron. */
    fixed?: boolean;
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
            <Pressable onPress={onPress} onPressIn={fixed ? undefined : p.pressIn} onPressOut={fixed ? undefined : p.pressOut} disabled={fixed} style={styles.cardHead}
                accessibilityRole="radio" accessibilityState={{ selected, expanded: selected }} accessibilityLabel={`${title}. ${subtitle}`}>
                <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>{icon}</View>
                <View style={styles.cardText}>
                    <Text style={styles.cardTitle}>{title}</Text>
                    <Text style={styles.cardSubtitle}>{subtitle}</Text>
                </View>
                {!fixed && (
                    <Animated.View style={{ transform: [{ rotate }] }}>
                        <ChevronDown size={20} color={selected ? colors.primary : colors.textTertiary} />
                    </Animated.View>
                )}
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

export function ProviderChooser({ options, loading, hasAddress, value, onChange, partnerCode, onApplyCode }: {
    options?: ProviderOptions; loading: boolean; hasAddress: boolean;
    value: ProviderChoice; onChange: (c: ProviderChoice) => void;
    /** The partner code in force (from their link, or typed here). */
    partnerCode?: string | null; onApplyCode?: (code: string | null) => void;
}) {
    const partners: PartnerOption[] = options?.partners ?? [];
    const invited = options?.invited ?? null;
    const [codeOpen, setCodeOpen] = useState(false);
    const [codeText, setCodeText] = useState('');
    const applyCode = () => {
        const c = codeText.trim().toUpperCase();
        if (c.length < 3) return;
        LayoutAnimation.configureNext(GROW);
        onApplyCode?.(c);
        setCodeOpen(false);
    };

    const loadingRow = (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>Finding who serves your address…</Text></View>
    );

    return (
        <View style={styles.wrap}>
            <ModeCard
                fixed selected onPress={() => {}}
                icon={<ShieldCheck size={22} color={colors.primary} />} iconBg={colors.primarySurface}
                title="Book via UniteFix" subtitle="Verified partner businesses, with their customer ratings"
            >
                <Appear index={0}>
                    <OptionRow
                        selected={value.type === 'unitefix'} onPress={() => onChange({ type: 'unitefix' })}
                        left={<View style={[styles.avatar, { backgroundColor: colors.primary }]}><Sparkles size={18} color={colors.textInverse} /></View>}
                        title="Let UniteFix choose" meta="We send our best available expert" label="Let UniteFix choose"
                    />
                </Appear>
                {!hasAddress ? null : loading ? loadingRow : partners.length > 0 ? (
                    <>
                        <Appear index={1}><Text style={styles.divider}>Or pick a partner near you</Text></Appear>
                        {partners.map((p, i) => (
                            <Appear key={p.id} index={i + 2}>
                                <OptionRow
                                    selected={value.type === 'partner' && value.id === p.id}
                                    onPress={() => onChange(p.viaCode && invited ? { type: 'partner', id: p.id, name: p.name, code: invited.code } : { type: 'partner', id: p.id, name: p.name })}
                                    left={<Avatar id={p.id} name={p.name} />}
                                    tag={p.viaCode ? 'Your partner' : undefined}
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
                {hasAddress && !loading && invited && !invited.available && (
                    <Appear index={partners.length + 2}>
                        <View style={styles.codeProblem}><Text style={styles.codeProblemText}>Code {invited.code}: {invited.reason}</Text></View>
                    </Appear>
                )}
                {hasAddress && !loading && (codeOpen ? (
                    <Appear index={0}>
                        <View style={styles.codeRow}>
                            <TextInput
                                style={styles.codeInput} value={codeText} onChangeText={t => setCodeText(t.replace(/[^A-Za-z0-9-]/g, '').toUpperCase())}
                                placeholder="e.g. POORVI12" placeholderTextColor={colors.textDisabled} autoCapitalize="characters" autoCorrect={false}
                                maxLength={24} returnKeyType="done" onSubmitEditing={applyCode} autoFocus accessibilityLabel="Partner code"
                            />
                            <Pressable style={[styles.codeApply, codeText.trim().length < 3 && styles.codeApplyOff]} onPress={applyCode} disabled={codeText.trim().length < 3} accessibilityRole="button">
                                <Text style={styles.codeApplyText}>Apply</Text>
                            </Pressable>
                        </View>
                    </Appear>
                ) : (
                    <Pressable style={styles.codeLink} onPress={() => { LayoutAnimation.configureNext(GROW); setCodeText(partnerCode ?? ''); setCodeOpen(true); }} accessibilityRole="button">
                        <Ticket size={15} color={colors.primary} />
                        <Text style={styles.codeLinkText}>{partnerCode ? `Partner code ${partnerCode} · change` : 'Have a partner code?'}</Text>
                    </Pressable>
                ))}
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
    tag: { alignSelf: 'flex-start', backgroundColor: colors.accentLight, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: 1, marginBottom: 2 },
    tagText: { ...typography.small, color: colors.accentDark, fontWeight: '700' },
    codeLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignSelf: 'flex-start' },
    codeLinkText: { ...typography.captionMedium, color: colors.primary },
    codeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    codeInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.md, paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm, ...typography.bodyMedium, color: colors.textPrimary, backgroundColor: colors.background, letterSpacing: 1.5 },
    codeApply: { backgroundColor: colors.primary, borderRadius: radii.lg, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
    codeApplyOff: { opacity: 0.45 },
    codeApplyText: { ...typography.buttonSmall, color: colors.textInverse },
    codeProblem: { padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.warningLight },
    codeProblemText: { ...typography.caption, color: colors.warningDark },
    note: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
    noteText: { ...typography.small, color: colors.textSecondary, flex: 1 },
});
