/**
 * Home showcase: categories, not individual services.
 *
 *   FeaturedBanners — a swipeable banner for every category the admin has
 *                     highlighted for this time of year (Tax & ITR in March,
 *                     Travel in December…), in the admin's sort order.
 *   CategoryGrid    — every category as a tile, in the admin's sort order,
 *                     with its one-line tagline.
 *
 * Both open the category's page. Colours are theme colours (the band accent).
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { ArrowRight, Sparkles } from 'lucide-react-native';
import type { ServiceCategory } from '../../api/customer.api';
import { getCategoryIcon } from '../../utils/serviceIcons';
import { bandColorOf } from '../../utils/serviceBands';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

const tint = (hex: string, a = '1A') => (/^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${a}` : colors.primarySurface);
const accentOf = (c: ServiceCategory) => bandColorOf({ band: c.bookingBand, bandColor: c.bandColor });

/** Lifts and fades in, a beat after the one before. */
function Rise({ index, children, style }: { index: number; children: React.ReactNode; style?: any }) {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(v, { toValue: 1, duration: 360, delay: 40 + index * 45, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [v, index]);
    return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>{children}</Animated.View>;
}

export function FeaturedBanners({ categories, onOpen, sidePadding }: { categories: ServiceCategory[]; onOpen: (c: ServiceCategory) => void; sidePadding: number }) {
    const { width } = useWindowDimensions();
    const cardWidth = width - sidePadding * 2;
    const featured = categories.filter(c => c.featuredNow);
    const scroller = useRef<ScrollView>(null);
    const [page, setPage] = useState(0);
    // Turn the page every 5 seconds while there is more than one.
    useEffect(() => {
        if (featured.length < 2) return;
        const t = setInterval(() => {
            setPage(p => {
                const next = (p + 1) % featured.length;
                scroller.current?.scrollTo({ x: next * (cardWidth + spacing.md), animated: true });
                return next;
            });
        }, 5000);
        return () => clearInterval(t);
    }, [featured.length, cardWidth]);
    if (!featured.length) return null;
    const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + spacing.md)));

    return (
        <View style={styles.featuredWrap}>
            <ScrollView
                ref={scroller} horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast"
                snapToInterval={cardWidth + spacing.md} snapToAlignment="start" onMomentumScrollEnd={onScroll}
                contentContainerStyle={{ gap: spacing.md }}
            >
                {featured.map((c, i) => {
                    const accent = accentOf(c);
                    const Icon = getCategoryIcon(c);
                    return (
                        <Rise key={c.id} index={i}>
                            <Pressable onPress={() => onOpen(c)} style={({ pressed }) => [styles.banner, { width: cardWidth, opacity: pressed ? 0.92 : 1 }]} accessibilityRole="button" accessibilityLabel={`${c.featureTitle ?? c.name}. ${c.featureSubtitle ?? ''}`}>
                                <View style={[styles.bannerGlow, { backgroundColor: tint(accent, '33') }]} />
                                <View style={styles.bannerBody}>
                                    <View style={styles.bannerKickerRow}>
                                        <Sparkles size={13} color={accent} />
                                        <Text style={[styles.bannerKicker, { color: accent }]} numberOfLines={1}>{c.featureTitle ?? 'In season'}</Text>
                                    </View>
                                    <Text style={styles.bannerTitle} numberOfLines={2}>{c.name}</Text>
                                    {!!(c.featureSubtitle || c.tagline) && <Text style={styles.bannerSub} numberOfLines={2}>{c.featureSubtitle ?? c.tagline}</Text>}
                                    <View style={[styles.bannerCta, { backgroundColor: accent }]}>
                                        <Text style={styles.bannerCtaText}>Explore</Text>
                                        <ArrowRight size={14} color={colors.textInverse} strokeWidth={2.5} />
                                    </View>
                                </View>
                                <View style={[styles.bannerIcon, { backgroundColor: tint(accent, '26') }]}>
                                    <Icon size={34} color={accent} strokeWidth={1.8} />
                                </View>
                            </Pressable>
                        </Rise>
                    );
                })}
            </ScrollView>
            {featured.length > 1 && (
                <View style={styles.dots}>
                    {featured.map((c, i) => <View key={c.id} style={[styles.dot, i === page && [styles.dotOn, { backgroundColor: accentOf(c) }]]} />)}
                </View>
            )}
        </View>
    );
}

export function CategoryGrid({ categories, onOpen }: { categories: ServiceCategory[]; onOpen: (c: ServiceCategory) => void }) {
    return (
        <View style={styles.grid}>
            {categories.map((c, i) => {
                const accent = accentOf(c);
                const Icon = getCategoryIcon(c);
                return (
                    <Rise key={c.id} index={i} style={styles.cell}>
                        <Pressable onPress={() => onOpen(c)} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]} accessibilityRole="button" accessibilityLabel={c.tagline ? `${c.name}: ${c.tagline}` : c.name}>
                            <View style={[styles.tileIcon, { backgroundColor: tint(accent) }]}>
                                <Icon size={26} color={accent} strokeWidth={2} />
                            </View>
                            <Text style={styles.tileName} numberOfLines={2}>{c.name}</Text>
                            {!!c.tagline && <Text style={styles.tileTag} numberOfLines={2}>{c.tagline}</Text>}
                            {c.featuredNow && <View style={[styles.tileDot, { backgroundColor: accent }]} />}
                        </Pressable>
                    </Rise>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    featuredWrap: { marginBottom: spacing.xl },
    banner: { minHeight: 150, borderRadius: radii['2xl'], backgroundColor: colors.backgroundDark, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', ...shadows.md },
    bannerGlow: { position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: 90 },
    bannerBody: { flex: 1, minWidth: 0, gap: spacing.xs },
    bannerKickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    bannerKicker: { ...typography.small, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 1 },
    bannerTitle: { ...typography.h3, color: colors.textInverse },
    bannerSub: { ...typography.caption, color: colors.textTertiary },
    bannerCta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: 6, marginTop: spacing.sm },
    bannerCtaText: { ...typography.buttonSmall, color: colors.textInverse },
    bannerIcon: { width: 68, height: 68, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.md },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
    dotOn: { width: 18 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
    cell: { width: '33.333%', padding: spacing.xs },
    tile: { backgroundColor: colors.surfaceElevated, borderRadius: radii.xl, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, alignItems: 'center', minHeight: 132, borderWidth: 1, borderColor: colors.divider, ...shadows.xs },
    tilePressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
    tileIcon: { width: 52, height: 52, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    tileName: { ...typography.captionMedium, color: colors.textPrimary, textAlign: 'center', fontWeight: '700' },
    tileTag: { ...typography.small, color: colors.textTertiary, textAlign: 'center', marginTop: 2 },
    tileDot: { position: 'absolute', top: spacing.sm, right: spacing.sm, width: 8, height: 8, borderRadius: 4 },
});
