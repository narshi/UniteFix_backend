/**
 * A category's page (Home → Plumbing, a seasonal highlight, All Services…).
 *
 *   Hero      — a photo for the category, back / search / filter, the
 *               category's icon, name and tagline, and the trust strip.
 *   Services  — "<Category> Services · N Services", then a card per service:
 *               its photo (the admin's banner image, else its icon), name,
 *               subtitle, typical duration and price. Tapping goes where the
 *               service's booking band says (utils/serviceBands.openService).
 *
 * Search and the filter sheet live in this screen's state, so they are still
 * as the customer left them when they come back from a booking screen. Android's
 * back button closes the search before it leaves the page.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, Modal, Animated,
    StatusBar, useWindowDimensions, Image as RNImage,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft, ArrowRight, Search, SlidersHorizontal, X, ShieldCheck, Zap, Tag, Clock, Sparkles, Check,
} from 'lucide-react-native';
import { useAllServices } from '../../hooks/useCustomerData';
import type { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { getCategoryIcon } from '../../utils/serviceIcons';
import { usePhotoResolver, PhotoResolver } from '../../utils/servicePhotos';
import { openService, bandOf, BAND_META } from '../../utils/serviceBands';
import { useBackClose } from '../../hooks/useBackClose';
import { brand } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

type Props = NativeStackScreenProps<any, 'CategoryDetail'>;
type Sort = 'recommended' | 'price_low' | 'price_high';

const SIDE = spacing.base;
/** hero-*.jpg are 1080 × 820; the photo part of the header is at most this tall for the width. */
const HERO_RATIO = 820 / 1080 * 0.78;
const FADE_TO_NAVY = require('../../../assets/home/fade-to-navy.png');

const HOW: Record<string, string> = {
    field_service: 'Book a visit: an expert comes to you.',
    inspect_quote: 'Book an inspection: the expert checks the job and sends you a quote to approve.',
    consultation: 'Book a consultation: pick a time and the expert calls you.',
    referral: 'Get free quotes: tell us what you need and partners near you call back.',
    digital_recharge: 'Recharge in a few taps.',
};

/** ₹ with Indian digit grouping (1,23,456), without relying on Intl. */
function rupees(n: number) {
    const s = String(Math.round(n));
    if (s.length <= 3) return `₹${s}`;
    const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return `₹${head},${s.slice(-3)}`;
}
/** What a service costs, as its card shows it. */
function priceOf(s: ServiceItem): { text: string; muted?: boolean } {
    if (s.status === 'COMING_SOON') return { text: 'Coming soon', muted: true };
    if (s.status === 'MAINTENANCE') return { text: 'Paused for now', muted: true };
    const band = bandOf(s);
    if (band === 'inspect_quote' && s.inspectionFee != null) return { text: `${rupees(s.inspectionFee)} visit` };
    if (band === 'referral') return { text: 'Free quotes', muted: true };
    if ((s.basePrice ?? 0) > 0) return { text: rupees(s.basePrice!) };
    return { text: BAND_META[band].cta, muted: true };
}

export function CategoryDetailScreen({ navigation, route }: Props) {
    const id = Number(route.params?.categoryId);
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const { data: categories, isLoading, isRefetching, refetch } = useAllServices();
    const cat = useMemo(() => categories?.find(c => c.id === id), [categories, id]);

    // Search and filters: this screen's own state, kept while a booking screen is on top.
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState('');
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sort, setSort] = useState<Sort>('recommended');
    const [sub, setSub] = useState<string | null>(null);

    const closeSearch = useCallback(() => { setSearching(false); setQuery(''); }, []);
    useBackClose(searching, closeSearch);

    const all = useMemo(() => (cat?.items ?? []).filter((s: ServiceItem) => s.status !== 'DISABLED'), [cat]);
    const subCategories = useMemo(() => Array.from(new Set(all.map(s => s.subCategory).filter(Boolean) as string[])).sort(), [all]);
    const items = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = all.filter(s => (!sub || s.subCategory === sub) && (!q || s.name.toLowerCase().includes(q) || (s.subtitle ?? '').toLowerCase().includes(q)));
        if (sort !== 'recommended') {
            // Unpriced and not-yet-bookable services (coming soon, paused) go last either way.
            const p = (s: ServiceItem) => (s.status !== 'ACTIVE' ? 0 : bandOf(s) === 'inspect_quote' && s.inspectionFee != null ? s.inspectionFee : s.basePrice ?? 0);
            list = [...list].sort((a, b) => {
                const pa = p(a), pb = p(b);
                if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
                return sort === 'price_low' ? pa - pb : pb - pa;
            });
        }
        return list;
    }, [all, query, sub, sort]);
    const filtered = sort !== 'recommended' || !!sub;

    const onOpen = useCallback((s: ServiceItem) => openService(navigation, s), [navigation]);
    const photoW = Math.round(Math.min(Math.max(width * 0.27, 92), 132));
    // Every service and the header get a photo (utils/servicePhotos.ts).
    const photos = usePhotoResolver();

    // Collapsing toolbar: once the photo header has scrolled away, a compact
    // bar (back, the category's name, search, filter) stays at the top.
    const list = React.useRef<FlatList<ServiceItem>>(null);
    const scrollY = React.useRef(new Animated.Value(0)).current;
    const [headerH, setHeaderH] = useState(380);
    const [collapsed, setCollapsed] = useState(false);
    const collapseAt = Math.max(140, headerH - 140);
    const barOpacity = scrollY.interpolate({ inputRange: [collapseAt - 50, collapseAt], outputRange: [0, 1], extrapolate: 'clamp' });
    const barShift = scrollY.interpolate({ inputRange: [collapseAt - 50, collapseAt], outputRange: [-12, 0], extrapolate: 'clamp' });
    const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: any) => { const c = e.nativeEvent.contentOffset.y > collapseAt - 25; setCollapsed(prev => (prev === c ? prev : c)); },
    }), [scrollY, collapseAt]);
    /** Search from the compact bar: back to the top, where the search box opens. */
    const searchFromBar = useCallback(() => { list.current?.scrollToOffset({ offset: 0, animated: true }); setSearching(true); }, []);

    if (!cat) {
        return (
            <View style={[styles.center, { paddingTop: insets.top }]}>
                <StatusBar barStyle="dark-content" />
                {isLoading ? <ActivityIndicator color={brand.orange} size="large" /> : (
                    <>
                        <Text style={styles.missing}>{t('category_page.missing', 'This category is not available right now.')}</Text>
                        <Pressable onPress={() => navigation.goBack()} style={styles.missingBtn} accessibilityRole="button">
                            <Text style={styles.missingBtnText}>{t('category_page.go_back', 'Go back')}</Text>
                        </Pressable>
                    </>
                )}
            </View>
        );
    }

    const header = (
        <CategoryHero
            cat={cat}
            width={width}
            hero={photos.hero(cat)}
            topInset={insets.top}
            searching={searching}
            query={query}
            filtered={filtered}
            onBack={() => navigation.goBack()}
            onSearch={() => setSearching(true)}
            onQuery={setQuery}
            onCloseSearch={closeSearch}
            onFilter={() => setSheetOpen(true)}
            count={items.length}
            total={all.length}
            onLayout={setHeaderH}
        />
    );

    return (
        <View style={styles.screen}>
            <StatusBar barStyle="light-content" backgroundColor={brand.navyDark} />
            <Animated.FlatList
                ref={list as any}
                onScroll={onScroll}
                scrollEventThrottle={16}
                data={items}
                keyExtractor={(s: ServiceItem) => String(s.id)}
                ListHeaderComponent={header}
                renderItem={({ item }: { item: ServiceItem }) => <ServiceRow s={item} cat={cat} photos={photos} photoW={photoW} onOpen={onOpen} />}
                ItemSeparatorComponent={Separator}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Text style={styles.emptyText}>
                            {all.length === 0
                                ? t('category_page.none', 'Services are coming to this category soon.')
                                : t('category_page.no_match', 'No services match your search or filters.')}
                        </Text>
                        {all.length > 0 && (
                            <Pressable onPress={() => { closeSearch(); setSub(null); setSort('recommended'); }} style={styles.missingBtn} accessibilityRole="button">
                                <Text style={styles.missingBtnText}>{t('category_page.clear', 'Clear search and filters')}</Text>
                            </Pressable>
                        )}
                    </View>
                }
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing['3xl'] }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                refreshing={isRefetching}
                onRefresh={refetch}
                initialNumToRender={8}
                windowSize={7}
                removeClippedSubviews
            />

            {/* The collapsed toolbar. */}
            <Animated.View pointerEvents={collapsed ? 'auto' : 'none'} style={[styles.compact, { paddingTop: insets.top + 6, opacity: barOpacity, transform: [{ translateY: barShift }] }]}>
                <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [styles.compactBtn, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
                    <ArrowLeft size={19} color={brand.white} strokeWidth={2.4} />
                </Pressable>
                <Text style={styles.compactTitle} numberOfLines={1} maxFontSizeMultiplier={1.2} accessibilityRole="header">{cat.name}</Text>
                <Pressable onPress={searchFromBar} style={({ pressed }) => [styles.compactBtn, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Search ${cat.name}`}>
                    <Search size={18} color={brand.white} strokeWidth={2.4} />
                </Pressable>
                <Pressable onPress={() => setSheetOpen(true)} style={({ pressed }) => [styles.compactBtn, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={filtered ? 'Sort and filter, active' : 'Sort and filter'}>
                    <SlidersHorizontal size={18} color={brand.white} strokeWidth={2.4} />
                    {filtered && <View style={styles.dot} />}
                </Pressable>
            </Animated.View>

            <FilterSheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                sort={sort}
                onSort={setSort}
                subCategories={subCategories}
                sub={sub}
                onSub={setSub}
                bottomInset={insets.bottom}
            />
        </View>
    );
}

const Separator = () => <View style={{ height: spacing.md }} />;

function CategoryHero(p: {
    cat: ServiceCategory; width: number; hero: ReturnType<PhotoResolver['hero']>; topInset: number; searching: boolean; query: string; filtered: boolean;
    onBack: () => void; onSearch: () => void; onQuery: (q: string) => void; onCloseSearch: () => void; onFilter: () => void;
    count: number; total: number; onLayout?: (height: number) => void;
}) {
    const { t } = useTranslation();
    const { cat } = p;
    const band = bandOf({ band: cat.bookingBand } as any);
    const Icon = getCategoryIcon(cat);
    // Up to 480dp each trust item stacks its icon over its label, so none is cut off.
    const compact = p.width < 480;
    const trust = [
        { Icon: ShieldCheck, label: t('home_extra.verified_experts', 'Verified Experts') },
        { Icon: Zap, label: t('category_page.quick_booking', 'Quick Booking') },
        { Icon: Tag, label: t('category_page.transparent_pricing', 'Transparent Pricing') },
    ];

    return (
        <View onLayout={e => p.onLayout?.(e.nativeEvent.layout.height)}>
            <View style={[styles.hero, { paddingTop: p.topInset + spacing.sm, minHeight: Math.min(p.width * HERO_RATIO, 420) }]}>
                {/* The photo fills the top part whatever its height (absolute edges give it a definite size),
                    and melts into the navy trust band below on any screen. */}
                <RNImage source={p.hero.source} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
                {/* An admin's own photo has no fade of its own: darken it so the white text reads. */}
                {!p.hero.faded && <View style={[StyleSheet.absoluteFill, styles.heroScrim]} />}
                <RNImage source={FADE_TO_NAVY} style={styles.heroFade} resizeMode="stretch" accessible={false} />

                {/* Back, search, filter */}
                <View style={styles.bar}>
                    <Pressable onPress={p.onBack} style={({ pressed }) => [styles.round, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
                        <ArrowLeft size={20} color={brand.white} strokeWidth={2.4} />
                    </Pressable>
                    <View style={styles.barRight}>
                        {!p.searching && (
                            <Pressable onPress={p.onSearch} style={({ pressed }) => [styles.round, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Search ${cat.name}`}>
                                <Search size={19} color={brand.white} strokeWidth={2.4} />
                            </Pressable>
                        )}
                        <Pressable onPress={p.onFilter} style={({ pressed }) => [styles.round, pressed && styles.pressed]} hitSlop={6} accessibilityRole="button" accessibilityLabel={p.filtered ? 'Sort and filter, active' : 'Sort and filter'}>
                            <SlidersHorizontal size={19} color={brand.white} strokeWidth={2.4} />
                            {p.filtered && <View style={styles.dot} />}
                        </Pressable>
                    </View>
                </View>

                {p.searching && (
                    <View style={styles.searchBox}>
                        <Search size={18} color={brand.navy} strokeWidth={2.4} />
                        <TextInput
                            autoFocus
                            value={p.query}
                            onChangeText={p.onQuery}
                            placeholder={t('category_page.search', { defaultValue: 'Search {{name}}…', name: cat.name })}
                            placeholderTextColor={brand.textSecondary}
                            style={styles.searchInput}
                            returnKeyType="search"
                            maxFontSizeMultiplier={1.3}
                            accessibilityLabel={`Search ${cat.name}`}
                        />
                        <Pressable onPress={p.onCloseSearch} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close search">
                            <X size={18} color={brand.textSecondary} strokeWidth={2.4} />
                        </Pressable>
                    </View>
                )}

                {/* Icon, name, tagline */}
                <View style={styles.iconTile}>
                    <Icon size={28} color={brand.white} strokeWidth={2} />
                </View>
                <Text style={[styles.title, { maxWidth: p.width * 0.8 }]} numberOfLines={2} maxFontSizeMultiplier={1.2} accessibilityRole="header">{cat.name}</Text>
                <Text style={[styles.tagline, { maxWidth: p.width * 0.68 }]} numberOfLines={3} maxFontSizeMultiplier={1.25}>{cat.tagline || HOW[band]}</Text>
                {cat.featuredNow && !!cat.featureTitle && (
                    <View style={styles.season}>
                        <Sparkles size={13} color={brand.orange} />
                        <Text style={styles.seasonText} numberOfLines={2} maxFontSizeMultiplier={1.2}>{cat.featureTitle}{cat.featureSubtitle ? ` · ${cat.featureSubtitle}` : ''}</Text>
                    </View>
                )}

            </View>

            {/* Trust strip, on its own navy band */}
            <View style={styles.trustBand}>
                <View style={styles.trust}>
                    {trust.map(({ Icon: TIcon, label }, i) => (
                        <React.Fragment key={label}>
                            {i > 0 && <View style={styles.trustDivider} />}
                            <View style={[styles.trustItem, compact && styles.trustItemCompact]}>
                                <TIcon size={16} color={brand.orange} strokeWidth={2.2} />
                                <Text style={[styles.trustText, compact && styles.trustTextCompact]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2}>{label}</Text>
                            </View>
                        </React.Fragment>
                    ))}
                </View>
            </View>

            <View style={styles.listHead}>
                <Text style={styles.listTitle} numberOfLines={2} maxFontSizeMultiplier={1.25}>{t('category_page.services_of', { defaultValue: '{{name}} Services', name: cat.name })}</Text>
                <Text style={styles.listCount} maxFontSizeMultiplier={1.25}>
                    {p.count === p.total
                        ? t('category_page.count', { defaultValue: '{{count}} Services', count: p.total })
                        : t('category_page.count_of', { defaultValue: '{{count}} of {{total}}', count: p.count, total: p.total })}
                </Text>
            </View>
        </View>
    );
}

const ServiceRow = React.memo(function ServiceRow({ s, cat, photos, photoW, onOpen }: { s: ServiceItem; cat: ServiceCategory; photos: PhotoResolver; photoW: number; onOpen: (s: ServiceItem) => void }) {
    // If the admin's photo link fails to load, fall back to the bundled photo for this service.
    const [linkFailed, setLinkFailed] = useState(false);
    const source = photos.service(s, cat, linkFailed);
    const price = priceOf(s);
    const photoH = Math.round(photoW * 0.82);
    const off = s.status !== 'ACTIVE';
    return (
        <Pressable
            onPress={() => onOpen(s)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${s.name}. ${price.text}${s.durationLabel ? `. ${s.durationLabel}` : ''}`}
        >
            <View style={[styles.photo, { width: photoW, height: photoH }, off && styles.off]}>
                <Image source={source} style={{ width: photoW, height: photoH }} contentFit="cover" transition={160} cachePolicy="memory-disk" recyclingKey={String(s.id)} onError={() => setLinkFailed(true)} accessible={false} />
            </View>
            <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={2} maxFontSizeMultiplier={1.25}>{s.name}</Text>
                {!!s.subtitle && <Text style={styles.rowSub} numberOfLines={2} maxFontSizeMultiplier={1.25}>{s.subtitle}</Text>}
                <View style={styles.meta}>
                    {!!s.durationLabel && (
                        <View style={styles.duration}>
                            <Clock size={14} color={brand.textSecondary} strokeWidth={2.2} />
                            <Text style={styles.durationText} numberOfLines={1} maxFontSizeMultiplier={1.2}>{s.durationLabel}</Text>
                        </View>
                    )}
                    <Text style={[styles.price, price.muted && styles.priceMuted]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{price.text}</Text>
                </View>
            </View>
            <View style={styles.go}><ArrowRight size={17} color={brand.orange} strokeWidth={2.6} /></View>
        </Pressable>
    );
});

function FilterSheet(p: {
    open: boolean; onClose: () => void; sort: Sort; onSort: (s: Sort) => void;
    subCategories: string[]; sub: string | null; onSub: (s: string | null) => void; bottomInset: number;
}) {
    const { t } = useTranslation();
    const sorts: { key: Sort; label: string }[] = [
        { key: 'recommended', label: t('category_page.sort_recommended', 'Recommended') },
        { key: 'price_low', label: t('category_page.sort_low', 'Price: low to high') },
        { key: 'price_high', label: t('category_page.sort_high', 'Price: high to low') },
    ];
    return (
        // Android's back button closes the sheet (onRequestClose), not the page.
        <Modal visible={p.open} transparent animationType="slide" onRequestClose={p.onClose} statusBarTranslucent>
            <Pressable style={styles.scrim} onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Close" />
            <View style={[styles.sheet, { paddingBottom: p.bottomInset + spacing.lg }]}>
                <View style={styles.grabber} />
                <Text style={styles.sheetTitle}>{t('category_page.sort_by', 'Sort by')}</Text>
                {sorts.map(o => (
                    <Pressable key={o.key} onPress={() => p.onSort(o.key)} style={styles.option} accessibilityRole="radio" accessibilityState={{ checked: p.sort === o.key }}>
                        <Text style={[styles.optionText, p.sort === o.key && styles.optionOn]}>{o.label}</Text>
                        {p.sort === o.key && <Check size={18} color={brand.orange} strokeWidth={2.6} />}
                    </Pressable>
                ))}
                {p.subCategories.length > 0 && (
                    <>
                        <Text style={[styles.sheetTitle, { marginTop: spacing.lg }]}>{t('category_page.type', 'Type')}</Text>
                        <View style={styles.chips}>
                            {[null, ...p.subCategories].map(c => (
                                <Pressable key={c ?? '__all'} onPress={() => p.onSub(c)} style={[styles.chip, p.sub === c && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: p.sub === c }}>
                                    <Text style={[styles.chipText, p.sub === c && styles.chipTextOn]}>{c ?? t('category_page.all', 'All')}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </>
                )}
                <Pressable onPress={p.onClose} style={styles.done} accessibilityRole="button">
                    <Text style={styles.doneText}>{t('category_page.show', 'Show services')}</Text>
                </Pressable>
            </View>
        </Modal>
    );
}

const shadow = { shadowColor: brand.text, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 };

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: brand.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: brand.background, padding: spacing.xl, gap: spacing.md },
    missing: { fontSize: 15, color: brand.textSecondary, textAlign: 'center' },
    missingBtn: { backgroundColor: brand.navy, borderRadius: radii.full, paddingHorizontal: spacing.lg, paddingVertical: 10, marginTop: spacing.sm },
    missingBtnText: { color: brand.white, fontWeight: '700', fontSize: 14 },
    pressed: { opacity: 0.75, transform: [{ scale: 0.95 }] },

    compact: {
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: SIDE, paddingBottom: 10, backgroundColor: brand.navyDark,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 8,
    },
    compactBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
    compactTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: brand.white, letterSpacing: -0.2 },
    hero: { backgroundColor: brand.navy, paddingHorizontal: SIDE, paddingBottom: spacing.xl, overflow: 'hidden' },
    heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },
    trustBand: { backgroundColor: brand.navy, paddingHorizontal: SIDE, paddingBottom: spacing.lg },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    barRight: { flexDirection: 'row', gap: spacing.sm },
    round: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(6,26,53,0.55)', borderWidth: 1, borderColor: brand.onNavyBorder, alignItems: 'center', justifyContent: 'center' },
    dot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: brand.orange, borderWidth: 1.5, borderColor: brand.navyDark },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, height: 48, borderRadius: 24, backgroundColor: brand.white, paddingHorizontal: spacing.base },
    searchInput: { flex: 1, fontSize: 15, color: brand.text, paddingVertical: 0 },

    iconTile: { width: 58, height: 58, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', backgroundColor: brand.orange, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl },
    title: { marginTop: spacing.md, fontSize: 30, lineHeight: 36, fontWeight: '800', color: brand.white, letterSpacing: -0.5 },
    tagline: { marginTop: spacing.xs, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.86)' },
    season: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.md, borderWidth: 1, borderColor: brand.orange, borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: 'rgba(6,26,53,0.55)' },
    seasonText: { fontSize: 12, fontWeight: '700', color: brand.orange, flexShrink: 1 },

    trust: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: brand.onNavyBorder },
    trustItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 0 },
    trustItemCompact: { flexDirection: 'column', gap: 4 },
    trustText: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: brand.white },
    trustTextCompact: { fontSize: 11.5 },
    trustDivider: { width: 1, height: 22, backgroundColor: brand.onNavyBorder },

    listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: SIDE + 4, paddingTop: spacing.xl, paddingBottom: spacing.md },
    listTitle: { flex: 1, fontSize: 21, fontWeight: '800', color: brand.text, letterSpacing: -0.3 },
    listCount: { fontSize: 13.5, fontWeight: '600', color: brand.textSecondary },

    row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SIDE, padding: 8, paddingRight: spacing.md, gap: spacing.md, backgroundColor: brand.white, borderRadius: 18, borderWidth: 1, borderColor: brand.cardBorder, ...shadow },
    rowPressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
    photo: { borderRadius: 13, overflow: 'hidden', backgroundColor: brand.background },
    heroScrim: { backgroundColor: 'rgba(9,38,74,0.55)' },
    off: { opacity: 0.55 },
    rowBody: { flex: 1, minWidth: 0, paddingVertical: 4 },
    rowName: { fontSize: 15.5, lineHeight: 20, fontWeight: '800', color: brand.text },
    rowSub: { marginTop: 3, fontSize: 12.5, lineHeight: 17, color: brand.textSecondary },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 4, marginTop: 8 },
    duration: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    durationText: { fontSize: 12.5, color: brand.textSecondary, fontWeight: '500' },
    price: { fontSize: 17, fontWeight: '800', color: brand.orange },
    priceMuted: { fontSize: 13, fontWeight: '700', color: brand.textSecondary },
    go: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,138,0,0.12)', alignItems: 'center', justifyContent: 'center' },

    empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
    emptyText: { fontSize: 14, color: brand.textSecondary, textAlign: 'center' },

    scrim: { flex: 1, backgroundColor: 'rgba(6,26,53,0.45)' },
    sheet: { backgroundColor: brand.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: brand.cardBorder, marginBottom: spacing.md },
    sheetTitle: { fontSize: 13, fontWeight: '800', color: brand.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.xs },
    option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    optionText: { fontSize: 15.5, color: brand.text },
    optionOn: { fontWeight: '800', color: brand.navy },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.full, borderWidth: 1, borderColor: brand.cardBorder, backgroundColor: brand.background },
    chipOn: { backgroundColor: brand.navy, borderColor: brand.navy },
    chipText: { fontSize: 13.5, color: brand.text, fontWeight: '600' },
    chipTextOn: { color: brand.white },
    done: { marginTop: spacing.xl, backgroundColor: brand.orange, borderRadius: radii.full, paddingVertical: 14, alignItems: 'center' },
    doneText: { color: brand.white, fontSize: 15.5, fontWeight: '800' },
});
