import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput, Animated, Image as RNImage } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LucideIcons from 'lucide-react-native';
const { AlertCircle, ArrowLeft, ArrowRight, Search, Users, ShieldCheck, Clock, Headphones, Inbox, X } = LucideIcons;
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomerTabParamList, HomeStackParamList } from '../../types/navigation.types';
import { useAllServices } from '../../hooks/useCustomerData';
import { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { colors, spacing, typography, radii, shadows } from '../../theme';
import { openService, bandOf, bandColorOf, BAND_META } from '../../utils/serviceBands';
import { useBackClose } from '../../hooks/useBackClose';
import { Image as Photo } from 'expo-image';
import { usePhotoResolver, Photo as PhotoSource } from '../../utils/servicePhotos';

const FADE_TO_NAVY = require('../../../assets/home/fade-to-navy.png');
/** The category card's height; the slim title strip takes over once it has scrolled past. */
const BANNER_H = 150;

/** A band colour as a soft tint (the same hue, mostly transparent) for icon boxes and pills. */
const tint = (hex: string, alpha = '1A') => (/^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${alpha}` : colors.primarySurface);

/** One line on how booking works in a category, for its banner. */
function bandLine(c: ServiceCategory): string | null {
    const band = bandOf({ band: c.bookingBand });
    if (band === 'inspect_quote') return `Inspect & quote: pay ${c.inspectionFee != null ? `₹${c.inspectionFee}` : 'an inspection fee'} to book; the expert quotes, you approve or decline.`;
    if (band === 'consultation') return 'Consultation: pick a day and time; the expert calls you.';
    if (band === 'referral') return 'Free quotes: tell us what you need; partners near you call back.';
    if (band === 'digital_recharge') return 'Recharge in a few taps.';
    return null;
}

type NavigationProp = NativeStackNavigationProp<HomeStackParamList & CustomerTabParamList>;

// Banner copy per category; anything unmapped gets the generic line.
const CATEGORY_TAGLINES: Record<string, string> = {
    'IT & Security': 'Installation & repair by certified service experts',
    'Appliances & Utilities': 'Keep your home running smoothly',
    'Repairs & Maintenance': 'Quick fixes by skilled professionals',
    'Professional & Property': 'Consultants & experts you can trust',
    'Transport & Logistics': 'Moving, machinery & vehicle care',
    'Events, Travel & Lifestyle': 'Plan, book & celebrate with ease',
    'Specialized Services': 'Niche experts for every need',
};
const DEFAULT_TAGLINE = 'On-demand professionals at your doorstep';

const TRUST_BADGES = [
    { icon: ShieldCheck, color: colors.success, title: 'Verified Experts', caption: 'Background verified professionals' },
    { icon: Clock, color: colors.warning, title: 'On-time Service', caption: 'Punctual visits you can rely on' },
    { icon: Headphones, color: colors.info, title: '24/7 Support', caption: "We're here to help you" },
] as const;


/** Design-spec service card: white card, rounded box icon, title, subtitle + arrow chip. */
const ServiceTile = ({ service, photo, onPress }: { service: ServiceItem; photo: PhotoSource; onPress: () => void }) => {
    const band = bandOf(service);
    const accent = bandColorOf(service);
    return (
        <TouchableOpacity
            style={[styles.serviceTile, service.status !== 'ACTIVE' && styles.serviceTileDisabled]}
            onPress={onPress}
            activeOpacity={0.75}
        >
            {/* The service's photo (utils/servicePhotos.ts): fixed height, width from the tile. */}
            <Photo source={photo} style={styles.serviceTilePhoto} contentFit="cover" transition={160} cachePolicy="memory-disk" recyclingKey={String(service.id)} accessible={false} />
            <Text style={styles.serviceTileTitle} numberOfLines={2}>{service.name}</Text>
            {band !== 'field_service' && (
                <View style={[styles.bandChip, { backgroundColor: tint(accent) }]}>
                    <View style={[styles.bandDot, { backgroundColor: accent }]} />
                    <Text style={[styles.bandChipText, { color: accent }]} numberOfLines={1}>
                        {band === 'inspect_quote' && service.inspectionFee != null ? `Inspect · ₹${service.inspectionFee}` : (service.bandLabel ?? BAND_META[band].label)}
                    </Text>
                </View>
            )}
            <View style={styles.serviceTileFooter}>
                <Text style={styles.serviceTileSubtitle} numberOfLines={2}>
                    {service.subtitle || 'Professional service'}
                </Text>
                <View style={[styles.serviceTileArrow, { backgroundColor: tint(accent) }]}>
                    <ArrowRight size={14} color={accent} strokeWidth={2.5} />
                </View>
            </View>
            {service.status === 'COMING_SOON' && (
                <View style={styles.badgeComingSoon}>
                    <Text style={styles.badgeText}>Soon</Text>
                </View>
            )}
        </TouchableOpacity>
    );
};

export const AllServicesScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    // The Home search bar opens this screen already searching (and may carry a word).
    const params = useRoute<RouteProp<HomeStackParamList, 'AllServices'>>().params;
    const openedToSearch = !!params?.search;
    const { data: categories, isLoading, error } = useAllServices();
    const photos = usePhotoResolver();
    // The services pane: as the category card scrolls away, a slim strip with
    // its name and count stays at the top (native-driven, so it is smooth).
    const paneY = React.useRef(new Animated.Value(0)).current;
    const pane = React.useRef<ScrollView>(null);
    const stripOpacity = paneY.interpolate({ inputRange: [BANNER_H - 70, BANNER_H - 20], outputRange: [0, 1], extrapolate: 'clamp' });
    const stripShift = paneY.interpolate({ inputRange: [BANNER_H - 70, BANNER_H - 20], outputRange: [-8, 0], extrapolate: 'clamp' });

    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState(params?.query ?? '');
    const [isSearchActive, setIsSearchActive] = useState(openedToSearch);
    // Back closes the search first, unless the screen was opened just to search.
    useBackClose(isSearchActive && !openedToSearch, React.useCallback(() => { setIsSearchActive(false); setSearchQuery(''); }, []));

    // Set first category as default when loaded
    useEffect(() => {
        if (categories && categories.length > 0 && selectedCategoryId === null) {
            setSelectedCategoryId(categories[0].id);
        }
    }, [categories]);

    // Reset the sub-tab, and the pane's scroll, whenever the category changes.
    useEffect(() => { setSelectedSubCategory(null); (pane.current as any)?.scrollTo?.({ y: 0, animated: false }); }, [selectedCategoryId]);

    // Sub-categories (horizontal tabs) for the selected category. Computed here —
    // above the loading/error early returns — so the hook count is stable across
    // renders (a hook after an early return crashes with "rendered more hooks").
    const subCategories = useMemo(() => {
        const cat = categories?.find(c => c.id === selectedCategoryId) || categories?.[0];
        const set = new Set<string>();
        (cat?.items || []).forEach((it: any) => { if (it.subCategory) set.add(it.subCategory); });
        return Array.from(set).sort();
    }, [categories, selectedCategoryId]);

    // Visit, inspection, consultation, recharge or free quotes — by the service's band.
    const handleServicePress = (service: ServiceItem) => openService(navigation, service);

    if (isLoading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
            </SafeAreaView>
        );
    }

    if (error || !categories) {
        return (
            <SafeAreaView style={styles.errorContainer}>
                <AlertCircle size={48} color={colors.error} />
                <Text style={styles.errorText}>Failed to load services</Text>
            </SafeAreaView>
        );
    }

    const selectedCategory = categories.find(c => c.id === selectedCategoryId) || categories[0];
    const categoryItems = selectedCategory?.items || [];

    const subFilteredItems = selectedSubCategory
        ? categoryItems.filter((it: any) => it.subCategory === selectedSubCategory)
        : categoryItems;

    // Search logic: filter across ALL categories if searching
    // A service matches on its own name or subtitle, or its category's name ("travel", "tax").
    const q = searchQuery.trim().toLowerCase();
    const searchResults = q === ''
        ? categoryItems
        : categories.flatMap(c => {
            const catHit = c.name.toLowerCase().includes(q);
            return (c.items || []).filter(s => catHit || s.name.toLowerCase().includes(q) || s.subtitle?.toLowerCase().includes(q));
        });

    const itemsToDisplay = isSearchActive && searchQuery.trim() !== '' ? searchResults : subFilteredItems;


    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                {isSearchActive ? (
                    <View style={styles.searchHeaderRow}>
                        <TouchableOpacity onPress={() => { if (openedToSearch) { navigation.goBack(); return; } setIsSearchActive(false); setSearchQuery(''); }} style={styles.backButton}>
                            <ArrowLeft size={22} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={styles.searchInputContainer}>
                            <Search size={18} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />
                            <TextInput
                                autoFocus
                                style={styles.searchInput}
                                placeholder="Search all services..."
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholderTextColor={colors.textDisabled}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <X size={18} color={colors.textSecondary} />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                ) : (
                    <>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <ArrowLeft size={22} color={colors.textPrimary} strokeWidth={2.4} />
                        </TouchableOpacity>
                        <View>
                            <Text style={styles.headerTitle}>All Services</Text>
                            <Text style={styles.headerSubtitle}>{categories.reduce((acc, cat) => acc + (cat.items?.length || 0), 0)} options</Text>
                        </View>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity style={styles.headerAction} onPress={() => setIsSearchActive(true)}>
                            <Search size={20} color={colors.textPrimary} strokeWidth={2.4} />
                        </TouchableOpacity>
                    </>
                )}
            </View>

            <View style={styles.mainContent}>
                {/* Left Sidebar - Categories */}
                <View style={styles.sidebar}>
                    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                        {categories.map((category) => {
                            const isSelected = category.id === selectedCategoryId;
                            return (
                                <TouchableOpacity
                                    key={category.id}
                                    style={styles.sidebarItem}
                                    onPress={() => setSelectedCategoryId(category.id)}
                                    activeOpacity={0.7}
                                >
                                    {isSelected && <View style={[styles.sidebarActiveBar, { backgroundColor: bandColorOf({ band: category.bookingBand, bandColor: category.bandColor }) }]} />}
                                    {bandOf({ band: category.bookingBand }) !== 'field_service' && (
                                        <View style={[styles.sidebarBandDot, { backgroundColor: bandColorOf({ band: category.bookingBand, bandColor: category.bandColor }) }]} />
                                    )}
                                    <View style={[
                                        styles.sidebarIconContainer,
                                        isSelected && styles.sidebarIconContainerSelected
                                    ]}>
                                        <Photo source={photos.category(category)} style={[styles.sidebarPhoto, !isSelected && styles.sidebarPhotoIdle]} contentFit="cover" transition={120} cachePolicy="memory-disk" accessible={false} />
                                    </View>
                                    <Text
                                        style={[
                                            styles.sidebarText,
                                            isSelected && styles.sidebarTextSelected
                                        ]}
                                        numberOfLines={2}
                                    >
                                        {category.name}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>

                {/* Right Content - Services Grid */}
                <View style={styles.rightContent}>
                    <Animated.ScrollView
                        ref={pane as any}
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.rightContentScroll}
                        keyboardShouldPersistTaps="handled"
                        scrollEventThrottle={16}
                        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: paneY } } }], { useNativeDriver: true })}
                    >
                        {/* Category banner */}
                        {selectedCategory && !isSearchActive && (
                            <View style={styles.categoryBanner} accessibilityRole="header" accessibilityLabel={`${selectedCategory.name}, ${itemsToDisplay.length} services`}>
                                <Photo source={photos.category(selectedCategory)} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} cachePolicy="memory-disk" accessible={false} />
                                <View style={[StyleSheet.absoluteFill, styles.categoryBannerScrim]} />
                                <RNImage source={FADE_TO_NAVY} style={styles.categoryBannerFade} resizeMode="stretch" accessible={false} />
                                <View style={styles.categoryBannerText}>
                                    <Text style={styles.categoryBannerTitle} numberOfLines={2} maxFontSizeMultiplier={1.2}>{selectedCategory.name}</Text>
                                    <Text style={styles.categoryBannerSubtitle} numberOfLines={2} maxFontSizeMultiplier={1.2}>
                                        {selectedCategory.tagline || CATEGORY_TAGLINES[selectedCategory.name] || DEFAULT_TAGLINE}
                                    </Text>
                                    <View style={styles.categoryBannerPill}>
                                        <Users size={13} color="#FFFFFF" strokeWidth={2.4} />
                                        <Text style={styles.categoryBannerPillText} numberOfLines={1} maxFontSizeMultiplier={1.2}>{itemsToDisplay.length} services available</Text>
                                    </View>
                                    {!!bandLine(selectedCategory) && (
                                        <Text style={styles.categoryBandLineOnPhoto} numberOfLines={2} maxFontSizeMultiplier={1.2}>
                                            {bandLine(selectedCategory)}
                                        </Text>
                                    )}
                                </View>
                            </View>
                        )}

                        {isSearchActive && searchQuery.trim() !== '' && (
                            <View style={styles.searchResultHeader}>
                                <Text style={styles.searchResultText}>Found {itemsToDisplay.length} results for "{searchQuery}"</Text>
                            </View>
                        )}

                        {/* Sub-category tabs (horizontal, scrollable) */}
                        {!isSearchActive && subCategories.length > 0 && (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.subTabRow}
                            >
                                {['All', ...subCategories].map((tab) => {
                                    const active = tab === 'All' ? !selectedSubCategory : selectedSubCategory === tab;
                                    return (
                                        <TouchableOpacity
                                            key={tab}
                                            style={[styles.subTab, active && styles.subTabActive]}
                                            onPress={() => setSelectedSubCategory(tab === 'All' ? null : tab)}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{tab}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )}

                        {!isSearchActive && (
                            <Text style={styles.servicesHeading}>Services ({itemsToDisplay.length})</Text>
                        )}

                        <View style={styles.servicesGrid}>
                            {itemsToDisplay.length > 0 ? itemsToDisplay.map((service) => (
                                <ServiceTile
                                    key={service.id}
                                    service={service}
                                    photo={photos.service(service, categories.find(c => c.id === service.categoryId))}
                                    onPress={() => handleServicePress(service)}
                                />
                            )) : (
                                <View style={styles.emptyState}>
                                    <Inbox size={40} color={colors.textDisabled} />
                                    <Text style={styles.emptyStateText}>No services available</Text>
                                </View>
                            )}
                        </View>
                        
                        {/* Trust footer (Moved here to align with right content and prevent sidebar overlap) */}
                        <View style={styles.trustBar}>
                            {TRUST_BADGES.map((badge, index) => {
                                const BadgeIcon = badge.icon;
                                return (
                                    <React.Fragment key={badge.title}>
                                        {index > 0 && <View style={styles.trustDivider} />}
                                        <View style={styles.trustItem}>
                                            <BadgeIcon size={20} color={badge.color} strokeWidth={2.2} />
                                            <View style={styles.trustTextWrap}>
                                                <Text style={styles.trustTitle} numberOfLines={1}>{badge.title}</Text>
                                                <Text style={styles.trustCaption} numberOfLines={2}>{badge.caption}</Text>
                                            </View>
                                        </View>
                                    </React.Fragment>
                                );
                            })}
                        </View>
                    </Animated.ScrollView>
                    {/* Collapsed: the category's name and count stay in view. */}
                    {selectedCategory && !isSearchActive && (
                        <Animated.View pointerEvents="none" style={[styles.collapsedStrip, { opacity: stripOpacity, transform: [{ translateY: stripShift }] }]}>
                            <Photo source={photos.category(selectedCategory)} style={styles.collapsedPhoto} contentFit="cover" accessible={false} />
                            <Text style={styles.collapsedTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>{selectedCategory.name}</Text>
                            <Text style={styles.collapsedCount} maxFontSizeMultiplier={1.2}>{itemsToDisplay.length}</Text>
                        </Animated.View>
                    )}
                </View>
            </View>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
        padding: spacing.xl,
    },
    errorText: {
        ...typography.h3,
        color: colors.textSecondary,
        marginTop: spacing.md,
        textAlign: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        backgroundColor: colors.surface,
        zIndex: 10,
    },
    backButton: {
        width: 46,
        height: 46,
        borderRadius: radii.xl,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.md,
        ...shadows.sm,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: colors.textPrimary,
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    headerAction: {
        width: 46,
        height: 46,
        borderRadius: radii.full,
        backgroundColor: colors.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadows.sm,
    },
    searchHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.full,
        paddingHorizontal: spacing.md,
        height: 44,
        borderWidth: 1,
        borderColor: colors.border,
    },
    searchInput: {
        flex: 1,
        ...typography.bodyMedium,
        color: colors.textPrimary,
        height: '100%',
    },
    searchResultHeader: {
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
        marginBottom: spacing.md,
    },
    searchResultText: {
        ...typography.bodyMedium,
        color: colors.textSecondary,
    },
    mainContent: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: colors.surface,
    },
    sidebar: {
        width: 80,
        backgroundColor: colors.surfaceElevated,
        borderTopRightRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'],
        paddingVertical: spacing.sm,
        ...shadows.xs,
        shadowOpacity: 0.04,
        marginRight: spacing.sm,
    },
    sidebarItem: {
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: 0,
        position: 'relative',
        width: '100%',
    },
    sidebarActiveBar: {
        position: 'absolute',
        left: 0,
        top: '50%',
        marginTop: -20,
        width: 3,
        height: 40,
        backgroundColor: colors.primary,
        borderTopRightRadius: radii.full,
        borderBottomRightRadius: radii.full,
    },
    sidebarIconContainer: {
        width: 50,
        height: 50,
        borderRadius: radii.xl,
        backgroundColor: 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
    },
    sidebarIconContainerSelected: {
        backgroundColor: colors.primarySurface,
    },
    sidebarText: {
        color: colors.textSecondary,
        textAlign: 'center',
        fontSize: 10.5,
        lineHeight: 13,
        fontWeight: '500',
        paddingHorizontal: 4,
    },
    sidebarTextSelected: {
        color: colors.primary,
        fontWeight: '700',
    },
    rightContent: {
        flex: 1,
    },
    rightContentScroll: {
        padding: spacing.base,
        paddingBottom: spacing.xl,
    },
    categoryBanner: {
        height: BANNER_H,
        borderRadius: radii['2xl'],
        marginBottom: spacing.lg,
        overflow: 'hidden',
        backgroundColor: colors.backgroundDark,
        justifyContent: 'flex-end',
    },
    categoryBannerScrim: { backgroundColor: 'rgba(9,38,74,0.25)' },
    categoryBannerFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '80%' },
    categoryBannerText: {
        padding: spacing.md,
    },
    categoryBannerTitle: {
        fontSize: 18,
        fontWeight: '800',
        lineHeight: 22,
        letterSpacing: -0.3,
        color: '#FFFFFF',
    },
    categoryBannerSubtitle: {
        fontSize: 12,
        lineHeight: 16,
        color: 'rgba(255,255,255,0.85)',
        marginTop: 2,
    },
    categoryBannerPill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 5,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        borderRadius: radii.full,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginTop: spacing.sm,
    },
    categoryBannerPillText: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    categoryBandLineOnPhoto: { fontSize: 11, fontWeight: '600', color: '#FFD8A8', marginTop: 4 },
    collapsedStrip: {
        position: 'absolute', top: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.base, paddingVertical: 8,
        backgroundColor: colors.surface,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        ...shadows.sm,
    },
    collapsedPhoto: { width: 26, height: 26, borderRadius: 13 },
    collapsedTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    collapsedCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, backgroundColor: colors.background, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
    servicesHeading: {
        ...typography.h3,
        fontSize: 15, // Adjusted to match mockup size
        fontWeight: '700',
        color: colors.textPrimary,
        marginBottom: spacing.md,
        letterSpacing: -0.2,
    },
    subTabRow: {
        gap: spacing.sm,
        paddingBottom: spacing.md,
    },
    subTab: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceElevated,
    },
    subTabActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    subTabText: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.textSecondary,
    },
    subTabTextActive: {
        color: colors.textInverse,
    },
    servicesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },
    serviceTile: {
        width: '47.5%', // Slightly reduced to prevent edge overlap on smaller phones
        minHeight: 165,
        backgroundColor: colors.surfaceElevated,
        borderRadius: 20,
        padding: 12,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: 'rgba(226, 232, 240, 0.6)', // Lighter border
        position: 'relative',
        ...shadows.sm,
        shadowOpacity: 0.05,
        elevation: 2,
    },
    serviceTileDisabled: {
        opacity: 0.75,
    },
    serviceTilePhoto: {
        height: 86,
        alignSelf: 'stretch',
        borderRadius: 14,
        backgroundColor: colors.primarySurface,
        marginBottom: 10,
    },
    sidebarPhoto: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.primary },
    sidebarPhotoIdle: { opacity: 0.75, borderColor: 'transparent' },
    serviceTileTitle: {
        fontSize: 13.5,
        fontWeight: '700',
        lineHeight: 18,
        letterSpacing: -0.1,
        color: colors.textPrimary,
        marginBottom: 4,
    },
    serviceTileFooter: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginTop: 'auto',
    },
    serviceTileSubtitle: {
        flex: 1,
        fontSize: 10.5,
        lineHeight: 14,
        color: colors.textSecondary,
        marginRight: 6,
    },
    serviceTileArrow: {
        width: 28,
        height: 28,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bandChip: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.xs,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        marginTop: spacing.xs,
        maxWidth: '100%',
    },
    bandDot: { width: 6, height: 6, borderRadius: radii.full },
    bandChipText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
    sidebarBandDot: {
        position: 'absolute',
        top: spacing.sm,
        right: spacing.sm,
        width: 8,
        height: 8,
        borderRadius: radii.full,
        borderWidth: 1.5,
        borderColor: colors.surfaceElevated,
    },
    categoryBandLine: {
        ...typography.caption,
        fontWeight: '600',
        marginTop: spacing.sm,
    },
    badgeComingSoon: {
        position: 'absolute',
        top: spacing.sm,
        right: spacing.sm,
        backgroundColor: colors.warningLight,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: radii.full,
        borderWidth: 1,
        borderColor: colors.warning,
    },
    badgeText: {
        ...typography.caption,
        fontSize: 9,
        color: colors.warningDark,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    emptyState: {
        flex: 1,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: spacing['2xl'],
    },
    emptyStateText: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.md,
    },
    trustBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii['2xl'],
        marginTop: spacing.xl,
        marginBottom: spacing.sm,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xs,
        ...shadows.md,
    },
    trustItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.xs,
    },
    trustTextWrap: {
        flexShrink: 1,
    },
    trustTitle: {
        fontSize: 11,
        fontWeight: '800',
        color: colors.textPrimary,
    },
    trustCaption: {
        fontSize: 9,
        lineHeight: 12,
        color: colors.textSecondary,
    },
    trustDivider: {
        width: 1,
        height: 34,
        backgroundColor: colors.divider,
    },
});
