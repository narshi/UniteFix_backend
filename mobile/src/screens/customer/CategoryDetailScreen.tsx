/**
 * A category's page, opened from the Home showcase: what it is, how booking
 * works in it (visit, inspection, consultation, free quotes), and its
 * services to pick from. Tapping a service goes where its band says.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react-native';
import { useAllServices } from '../../hooks/useCustomerData';
import type { ServiceItem } from '../../api/customer.api';
import { getCategoryIcon, getServiceIcon } from '../../utils/serviceIcons';
import { openService, bandOf, bandColorOf, BAND_META } from '../../utils/serviceBands';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

type Props = NativeStackScreenProps<any, 'CategoryDetail'>;
const tint = (hex: string, a = '1A') => (/^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${a}` : colors.primarySurface);

const HOW: Record<string, string> = {
    field_service: 'Book a visit: an expert comes to you.',
    inspect_quote: 'Book an inspection: the expert checks the job and sends you a quote to approve.',
    consultation: 'Book a consultation: pick a time and the expert calls you.',
    referral: 'Get free quotes: tell us what you need and partners near you call back.',
    digital_recharge: 'Recharge in a few taps.',
};

export function CategoryDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.categoryId);
    const { data: categories, isLoading } = useAllServices();
    const cat = useMemo(() => categories?.find(c => c.id === id), [categories, id]);
    const items = useMemo(() => (cat?.items ?? []).filter((s: ServiceItem) => s.status !== 'DISABLED'), [cat]);

    if (isLoading || !cat) {
        return (
            <SafeAreaView style={styles.center}>
                {isLoading ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.missing}>This category is not available.</Text>}
            </SafeAreaView>
        );
    }
    const band = bandOf({ band: cat.bookingBand });
    const accent = bandColorOf({ band: cat.bookingBand, bandColor: cat.bandColor });
    const Icon = getCategoryIcon(cat);

    return (
        <SafeAreaView style={styles.safe} edges={['top']}>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                    <View style={[styles.heroGlow, { backgroundColor: tint(accent, '33') }]} />
                    <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
                        <ArrowLeft size={20} color={colors.textInverse} />
                    </Pressable>
                    <View style={[styles.heroIcon, { backgroundColor: tint(accent, '26') }]}><Icon size={30} color={accent} strokeWidth={1.8} /></View>
                    <Text style={styles.heroTitle}>{cat.name}</Text>
                    {!!cat.tagline && <Text style={styles.heroTag}>{cat.tagline}</Text>}
                    {cat.featuredNow && !!cat.featureTitle && (
                        <View style={[styles.season, { borderColor: accent }]}>
                            <Sparkles size={13} color={accent} />
                            <Text style={[styles.seasonText, { color: accent }]} numberOfLines={2}>{cat.featureTitle}{cat.featureSubtitle ? ` · ${cat.featureSubtitle}` : ''}</Text>
                        </View>
                    )}
                    <Text style={styles.how}>{HOW[band]}</Text>
                </View>

                <Text style={styles.sectionTitle}>{items.length} service{items.length === 1 ? '' : 's'}</Text>
                <View style={styles.list}>
                    {items.map((s: ServiceItem) => {
                        const sBand = bandOf(s);
                        const sAccent = bandColorOf(s);
                        const SIcon = getServiceIcon(s);
                        return (
                            <Pressable key={s.id} onPress={() => openService(navigation, s)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed, s.status !== 'ACTIVE' && styles.rowDim]} accessibilityRole="button" accessibilityLabel={`${s.name}. ${BAND_META[sBand].cta}`}>
                                <View style={[styles.rowIcon, { backgroundColor: tint(sAccent) }]}><SIcon size={22} color={sAccent} /></View>
                                <View style={styles.rowBody}>
                                    <Text style={styles.rowName} numberOfLines={2}>{s.name}</Text>
                                    <Text style={styles.rowMeta} numberOfLines={1}>
                                        {s.status === 'COMING_SOON' ? 'Coming soon' : sBand === 'inspect_quote' && s.inspectionFee != null ? `Inspection ₹${s.inspectionFee}` : (s.basePrice ?? 0) > 0 ? `₹${s.basePrice}` : (s.subtitle || BAND_META[sBand].cta)}
                                    </Text>
                                </View>
                                <View style={[styles.rowGo, { backgroundColor: tint(sAccent) }]}><ArrowRight size={15} color={sAccent} strokeWidth={2.5} /></View>
                            </Pressable>
                        );
                    })}
                    {!items.length && <Text style={styles.missing}>Services are coming to this category soon.</Text>}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    content: { paddingBottom: spacing['4xl'] },
    hero: { backgroundColor: colors.backgroundDark, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radii['2xl'], borderBottomRightRadius: radii['2xl'], overflow: 'hidden', gap: spacing.sm },
    heroGlow: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110 },
    back: { width: 36, height: 36, borderRadius: radii.full, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    heroIcon: { width: 60, height: 60, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
    heroTitle: { ...typography.h2, color: colors.textInverse },
    heroTag: { ...typography.body, color: colors.textTertiary },
    season: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', borderWidth: 1, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: 4 },
    seasonText: { ...typography.small, fontWeight: '700', flexShrink: 1 },
    how: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.xs },
    sectionTitle: { ...typography.label, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.xl },
    list: { paddingHorizontal: spacing.base, gap: spacing.sm },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.divider, ...shadows.xs },
    rowPressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
    rowDim: { opacity: 0.6 },
    rowIcon: { width: 44, height: 44, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { ...typography.bodySemibold, color: colors.textPrimary },
    rowMeta: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
    rowGo: { width: 30, height: 30, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
    missing: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
});
