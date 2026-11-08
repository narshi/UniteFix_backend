/**
 * Customer Home, the navy header: logo, notifications and profile, the
 * greeting and headline, the location, the search bar and the trust strip.
 *
 * The house photo has its navy fade baked in (assets/home/header-home.jpg),
 * so no gradient library is needed. Everything here is wired by HomeScreen;
 * this component only draws.
 */

import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, useWindowDimensions, Animated } from 'react-native';
import { Bell, MapPin, ChevronDown, Search, ShieldCheck, Zap, Tag } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const HEADER_PHOTO = require('../../../assets/home/header-home.jpg');
const HANDSHAKE = require('../../../assets/home/handshake-white.png');
const FADE = require('../../../assets/home/header-fade.png');
/** header-home.jpg is 1080 × 900. */
const PHOTO_RATIO = 900 / 1080;
const SIDE = spacing.base;

type Props = {
    topInset: number;
    firstName: string | null; // null while the profile loads
    unreadCount: number;
    locationLabel: string;
    language: string;
    onLanguage: (lang: 'kn' | 'en') => void;
    onBell: () => void;
    onAvatar: () => void;
    onLocation: () => void;
    onSearch: () => void;
};

export function HomeHero(p: Props) {
    const { width } = useWindowDimensions();
    // Narrow phones (360dp) stack each trust item's icon over its label so nothing is cut off.
    const compact = width < 400;
    const { t } = useTranslation();
    const trust = [
        { Icon: ShieldCheck, label: t('home_extra.verified_experts', 'Verified Experts') },
        { Icon: Zap, label: t('home_extra.quick_easy', 'Quick & Easy') },
        { Icon: Tag, label: t('home_extra.fair_pricing', 'Fair Pricing') },
    ];

    return (
        <View>
            <View style={[styles.hero, { paddingTop: p.topInset }]}>
                <Image source={HEADER_PHOTO} style={[styles.photo, { width, height: width * PHOTO_RATIO }]} resizeMode="cover" accessible={false} />

                {/* Logo, bell, avatar */}
                <View style={styles.topRow}>
                    <View style={styles.brandRow} accessible accessibilityLabel="UniteFix">
                        <Image source={HANDSHAKE} style={styles.handshake} resizeMode="contain" />
                        <View style={styles.brandDivider} />
                        <View>
                            <Text maxFontSizeMultiplier={1.25} style={styles.wordmark}>Unite<Text maxFontSizeMultiplier={1.25} style={styles.wordmarkFix}>fix</Text><Text maxFontSizeMultiplier={1.25} style={styles.tm}>™</Text></Text>
                            <Text maxFontSizeMultiplier={1.25} style={styles.wordTag}>LOCAL SERVICES & MORE</Text>
                        </View>
                    </View>
                    <View style={styles.actions}>
                        <Pressable onPress={p.onBell} style={({ pressed }) => [styles.bell, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={p.unreadCount ? `Notifications, ${p.unreadCount} unread` : 'Notifications'} hitSlop={6}>
                            <Bell size={20} color={brand.white} strokeWidth={2} />
                            {p.unreadCount > 0 && (
                                <View style={styles.badge}><Text maxFontSizeMultiplier={1.25} style={styles.badgeText}>{p.unreadCount > 9 ? '9+' : p.unreadCount}</Text></View>
                            )}
                        </Pressable>
                        <Pressable onPress={p.onAvatar} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Your profile" hitSlop={6}>
                            <Text maxFontSizeMultiplier={1.25} style={styles.avatarText}>{(p.firstName ?? ' ').charAt(0).toUpperCase()}</Text>
                        </Pressable>
                    </View>
                </View>

                {/* Greeting and headline */}
                <Text maxFontSizeMultiplier={1.25} style={styles.hello} numberOfLines={1}>
                    {t('home.greeting', 'Hello')}, {p.firstName ?? '…'} 👋
                </Text>
                <Text maxFontSizeMultiplier={1.25} style={[styles.headline, { maxWidth: Math.min(width * 0.68, 300) }]}>
                    {t('home_hero.headline_1', 'Everyday Services for your')}{' '}
                    <Text maxFontSizeMultiplier={1.25} style={styles.headlineAccent}>{t('home_hero.headline_2', 'Home, Life & Travel.')}</Text>
                </Text>

                {/* Location, and the language toggle (kept from the old header) */}
                <View style={styles.locationRow}>
                    <Pressable onPress={p.onLocation} style={({ pressed }) => [styles.locationPill, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Location: ${p.locationLabel}. Change`}>
                        <MapPin size={16} color={brand.orange} strokeWidth={2.4} />
                        <Text maxFontSizeMultiplier={1.25} style={styles.locationText} numberOfLines={1}>{p.locationLabel}</Text>
                        <ChevronDown size={16} color={brand.onNavyMuted} strokeWidth={2.4} />
                    </Pressable>
                    <View style={styles.lang}>
                        {(['kn', 'en'] as const).map(l => (
                            <Pressable key={l} onPress={() => p.onLanguage(l)} style={[styles.langOpt, p.language === l && styles.langOptOn]} accessibilityRole="button" accessibilityState={{ selected: p.language === l }} accessibilityLabel={l === 'kn' ? 'Kannada' : 'English'}>
                                <Text maxFontSizeMultiplier={1.25} style={[styles.langText, p.language === l && styles.langTextOn]}>{l === 'kn' ? 'ಕನ್ನಡ' : 'EN'}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>

                {/* Search: opens All Services already searching. */}
                <Pressable onPress={p.onSearch} style={({ pressed }) => [styles.search, pressed && styles.searchPressed]} accessibilityRole="search" accessibilityLabel="Search services">
                    <Search size={20} color={brand.navy} strokeWidth={2.4} />
                    <Text maxFontSizeMultiplier={1.25} style={styles.searchText} numberOfLines={1}>{t('home_hero.search', 'Find a service, recharge or plan a trip...')}</Text>
                </Pressable>

                {/* Trust strip */}
                <View style={styles.trust}>
                    {trust.map(({ Icon, label }, i) => (
                        <React.Fragment key={label}>
                            {i > 0 && <View style={styles.trustDivider} />}
                            <View style={[styles.trustItem, compact && styles.trustItemCompact]}>
                                <Icon size={15} color={brand.orange} strokeWidth={2.2} />
                                <Text maxFontSizeMultiplier={1.25} style={[styles.trustText, compact && styles.trustTextCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
                            </View>
                        </React.Fragment>
                    ))}
                </View>
            </View>
            {/* Navy melting into the page. */}
            <Image source={FADE} style={styles.fade} resizeMode="stretch" accessible={false} />
        </View>
    );
}

const styles = StyleSheet.create({
    hero: { backgroundColor: brand.navy, paddingHorizontal: SIDE, paddingBottom: spacing.base, overflow: 'hidden' },
    photo: { position: 'absolute', top: 0, right: 0 },
    pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },

    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    handshake: { width: 42, height: 42 },
    brandDivider: { width: 1, height: 30, backgroundColor: brand.onNavyBorder, marginHorizontal: spacing.sm },
    wordmark: { fontSize: 22, fontWeight: '800', color: brand.white, letterSpacing: -0.3, lineHeight: 26 },
    wordmarkFix: { color: brand.orange },
    tm: { fontSize: 9, fontWeight: '700', color: brand.white },
    wordTag: { fontSize: 8.5, fontWeight: '700', color: brand.onNavyMuted, letterSpacing: 1.1, marginTop: 1 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    bell: { width: 40, height: 40, borderRadius: 20, backgroundColor: brand.navyDark, borderWidth: 1, borderColor: brand.onNavyBorder, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', top: 4, right: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: brand.orange, borderWidth: 1.5, borderColor: brand.navyDark, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: brand.white, fontSize: 9, fontWeight: '800' },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: brand.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
    avatarText: { color: brand.white, fontSize: 17, fontWeight: '800' },

    hello: { marginTop: spacing.lg, fontSize: 15, fontWeight: '600', color: brand.white },
    headline: { marginTop: spacing.xs, fontSize: 25, lineHeight: 31, fontWeight: '800', color: brand.white, letterSpacing: -0.4 },
    headlineAccent: { color: brand.orange },

    locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.base },
    locationPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, maxWidth: '68%', backgroundColor: 'rgba(6,26,53,0.72)', borderWidth: 1, borderColor: brand.onNavyBorder, borderRadius: radii.full, paddingVertical: 9, paddingHorizontal: spacing.md },
    locationText: { flexShrink: 1, fontSize: 13.5, fontWeight: '600', color: brand.white },
    lang: { flexDirection: 'row', backgroundColor: 'rgba(6,26,53,0.72)', borderWidth: 1, borderColor: brand.onNavyBorder, borderRadius: radii.full, padding: 3 },
    langOpt: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radii.full },
    langOptOn: { backgroundColor: brand.orange },
    langText: { fontSize: 12, fontWeight: '700', color: brand.onNavyMuted },
    langTextOn: { color: brand.white },

    search: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.base, height: 52, borderRadius: 26, backgroundColor: brand.white, paddingHorizontal: spacing.lg, shadowColor: brand.navyDark, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 },
    searchPressed: { opacity: 0.94 },
    searchText: { flex: 1, fontSize: 14.5, color: brand.textSecondary },

    trust: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, backgroundColor: brand.navyDark, borderWidth: 1, borderColor: brand.onNavyBorder, borderRadius: radii.xl, paddingVertical: 10, paddingHorizontal: spacing.xs },
    trustItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minWidth: 0 },
    trustItemCompact: { flexDirection: 'column', gap: 3 },
    trustText: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: brand.white },
    trustTextCompact: { fontSize: 11.5 },
    trustDivider: { width: 1, height: 18, backgroundColor: brand.onNavyBorder },

    fade: { width: '100%', height: 28 },
});

/**
 * The collapsed toolbar: when the big header has scrolled away, this stays at
 * the top of Home — the logo, search, notifications and profile — so the
 * essentials are always one tap away. HomeScreen fades it in on scroll.
 */
export function HomeCompactBar(p: {
    topInset: number; unreadCount: number; firstName: string | null; style?: any; interactive: boolean;
    onSearch: () => void; onBell: () => void; onAvatar: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Animated.View pointerEvents={p.interactive ? 'auto' : 'none'} style={[compact.bar, { paddingTop: p.topInset + 6 }, p.style]}>
            <Image source={HANDSHAKE} style={compact.logo} resizeMode="contain" accessibilityLabel="UniteFix" />
            <Pressable onPress={p.onSearch} style={({ pressed }) => [compact.search, pressed && { opacity: 0.9 }]} accessibilityRole="search" accessibilityLabel="Search services">
                <Search size={17} color={brand.navy} strokeWidth={2.4} />
                <Text maxFontSizeMultiplier={1.2} style={compact.searchText} numberOfLines={1}>{t('home_hero.search_short', 'Search services')}</Text>
            </Pressable>
            <Pressable onPress={p.onBell} style={({ pressed }) => [compact.round, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={p.unreadCount ? `Notifications, ${p.unreadCount} unread` : 'Notifications'}>
                <Bell size={18} color={brand.white} strokeWidth={2} />
                {p.unreadCount > 0 && <View style={compact.dot} />}
            </Pressable>
            <Pressable onPress={p.onAvatar} style={({ pressed }) => [compact.avatar, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel="Your profile">
                <Text maxFontSizeMultiplier={1.2} style={compact.avatarText}>{(p.firstName ?? ' ').charAt(0).toUpperCase()}</Text>
            </Pressable>
        </Animated.View>
    );
}

const compact = StyleSheet.create({
    bar: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: SIDE, paddingBottom: 10,
        backgroundColor: brand.navyDark,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 8,
    },
    logo: { width: 30, height: 30 },
    search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 38, borderRadius: 19, backgroundColor: brand.white, paddingHorizontal: spacing.md },
    searchText: { flex: 1, fontSize: 13.5, color: brand.textSecondary },
    round: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    dot: { position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: brand.orange, borderWidth: 1.5, borderColor: brand.navyDark },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: brand.orange, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: brand.white, fontSize: 15, fontWeight: '800' },
});
