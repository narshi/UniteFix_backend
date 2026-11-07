/**
 * Home Screen — the customer's landing page.
 *
 *   A  Header: logo, notifications, profile, greeting, headline, location
 *      (and the ಕನ್ನಡ / EN toggle), over a photo of a home.
 *   B  Search: opens All Services already searching.
 *   C  Trust strip: Verified Experts · Quick & Easy · Fair Pricing.
 *   D  Home Services: four cards staff schedule by season in admin → Home screen
 *      (server: shared/home-cards.ts), and View All. Built-in four (Plumbing,
 *      Electrical, AC Service, Painting) fill any gap, or stand in if the
 *      request fails.
 *   E  More for You: Travel & Tours, Recharge & Pay, Photo Shoots.
 *
 * Every card goes somewhere real. A Home Services card opens the matching
 * category (or service) in the catalogue the admin keeps, and falls back to a
 * search for it, so renaming or regrouping categories never leaves a dead card.
 * Kept from before: the profile gate, a partner's referral banner, the
 * newspapers card, the not-serviceable notice and the Customer care button.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, StatusBar, Alert, Linking, useWindowDimensions } from 'react-native';
import { MapPin, Phone, Droplets, Zap, Snowflake, PaintRoller, Plane, Smartphone, Camera, Router, PartyPopper, LayoutGrid, LucideIcon } from 'lucide-react-native';
import type { ImageSourcePropType } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useProfile, useUnreadNotificationCount, usePublicConfig, useAllServices, useHomeCards } from '../../hooks/useCustomerData';
import { usePhotoResolver, photoByKey, photoForName } from '../../utils/servicePhotos';
import { getCategoryIcon, getServiceIcon } from '../../utils/serviceIcons';
import { useAuthStore } from '../../stores/auth.store';
import { useLanguageStore } from '../../stores/languageStore';
import { colors, brand } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';
import { customerApi } from '../../api/customer.api';
import type { ServiceCategory, ServiceItem } from '../../api/customer.api';
import { useServiceability } from '../../hooks/useServiceability';
import { openService } from '../../utils/serviceBands';
import { PartnerRefBanner } from '../../components/customer/PartnerRefBanner';
import { ProfileCompletionGate, isProfileIncomplete } from '../../components/ProfileCompletionGate';
import { NewsHomeCard } from '../news/NewsHomeCard';
import { HomeHero } from '../../components/home/HomeHero';
import { SectionHeader, ServicePhotoCard, ServicePhotoCardSkeleton, MoreCard, cardWidth } from '../../components/home/HomeCards';

const PHOTOS = {
    plumbing: require('../../../assets/home/plumbing.jpg'),
    electrical: require('../../../assets/home/electrical.jpg'),
    ac: require('../../../assets/home/ac-service.jpg'),
    painting: require('../../../assets/home/painting.jpg'),
    travel: require('../../../assets/home/travel.jpg'),
    recharge: require('../../../assets/home/recharge.jpg'),
    photo: require('../../../assets/home/photo-shoots.jpg'),
    house: require('../../../assets/services/house.jpg'),
};

/** What each Home Services card looks for in the catalogue, and the word it searches for otherwise. */
const HOME_SERVICES = [
    { key: 'plumbing', label: 'Plumbing', Icon: Droplets, match: /plumb/i, query: 'plumb' },
    { key: 'electrical', label: 'Electrical', Icon: Zap, match: /electric/i, query: 'electric' },
    { key: 'ac', label: 'AC Service', Icon: Snowflake, match: /\bac\b|a\.c\.|air ?condition/i, query: 'AC' },
    { key: 'painting', label: 'Painting', Icon: PaintRoller, match: /paint/i, query: 'paint' },
] as const;

/** A card in the Home Services row, whichever set it came from. */
type RowCard = { key: string; label: string; photo: ImageSourcePropType; fallback?: ImageSourcePropType; Icon: LucideIcon; onPress: () => void };

const SIDE = spacing.base;
const GAP = 10;
/** On tablets and landscape the cards stop growing; the rows centre. */
const MAX_ROW = 560;
const live = (s: ServiceItem) => s.status !== 'DISABLED';

export function HomeScreen() {
    const { headerTop, tabContent, fabBottom } = useScreenInsets();
    const { user } = useAuthStore();
    const { data: profile, isLoading: isProfileLoading, isRefetching: isProfileRefetching, refetch: refetchProfile } = useProfile();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { data: categories, isRefetching: isCategoriesRefetching, refetch: refetchCategories } = useAllServices();
    // The Home Services row staff scheduled for today (admin → Home screen).
    const { data: homeCards, isLoading: homeCardsLoading, isRefetching: isHomeCardsRefetching, refetch: refetchHomeCards } = useHomeCards();
    const photos = usePhotoResolver();
    const { data: unreadCount = 0 } = useUnreadNotificationCount();
    const { data: publicConfig } = usePublicConfig();
    const { t } = useTranslation();
    const { language, setLanguage } = useLanguageStore();
    const { width: screenWidth } = useWindowDimensions();
    const rowWidth = Math.min(screenWidth - SIDE * 2, MAX_ROW);
    const serviceW = cardWidth(rowWidth, 4, GAP);
    const moreW = cardWidth(rowWidth, 3, GAP);

    const [isFetchingLocation, setIsFetchingLocation] = React.useState(false);

    // Shared with the expert app so the two cannot drift apart.
    const { isServiceable } = useServiceability(profile?.pinCode);

    // Accounts created before location became mandatory, and anyone who denied
    // the permission, have no address at all. Nothing can be booked in that
    // state, so the prompt blocks the screen rather than sitting under it.
    const profileGaps = isProfileIncomplete(profile);

    const isRefreshing = isProfileRefetching || isCategoriesRefetching || isHomeCardsRefetching;
    const onRefresh = React.useCallback(() => {
        refetchProfile();
        refetchCategories();
        refetchHomeCards();
    }, [refetchProfile, refetchCategories, refetchHomeCards]);

    const displayName = profile?.username || user?.username || 'User';
    const firstName = isProfileLoading && !profile ? null : displayName.split(' ')[0];

    // A short location label: "City, State" from the full address.
    const locationLabel = React.useMemo(() => {
        if (isFetchingLocation) return t('home_extra.detecting', 'Detecting...');
        if (!profile?.homeAddress) return t('home_extra.set_location', 'Set your location');
        const parts = profile.homeAddress.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
        return profile.homeAddress;
    }, [profile?.homeAddress, isFetchingLocation, t]);

    const supportNumber = publicConfig?.whatsappNumber || '919448850679';
    const openDialer = React.useCallback(() => {
        Linking.openURL(`tel:+${supportNumber}`).catch(() => {
            Alert.alert('Error', 'Unable to open the phone dialer.');
        });
    }, [supportNumber]);

    React.useEffect(() => {
        const autoFetchLocation = async () => {
            if (profile && !profile.homeAddress && !isFetchingLocation) {
                try {
                    setIsFetchingLocation(true);
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status === 'granted') {
                        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                        const [geo] = await Location.reverseGeocodeAsync(loc.coords);
                        if (geo) {
                            const address = [geo.name, geo.street, geo.district, geo.city, geo.region].filter(Boolean).join(', ');
                            const pin = geo.postalCode || '';
                            if (address && pin) {
                                await customerApi.updateProfile({ homeAddress: address, pinCode: pin });
                                refetchProfile();
                            }
                        }
                    }
                } catch (e) {
                    console.error('Auto location fetch error', e);
                } finally {
                    setIsFetchingLocation(false);
                }
            }
        };
        autoFetchLocation();
    }, [profile?.homeAddress]);

    // ── Where the cards go ────────────────────────────────────────────────
    const findCategory = React.useCallback((re: RegExp): ServiceCategory | undefined =>
        categories?.find(c => re.test(c.name) && (c.items ?? []).some(live)), [categories]);
    const findService = React.useCallback((re: RegExp): ServiceItem | undefined =>
        categories?.flatMap(c => c.items ?? []).find(s => live(s) && re.test(s.name)), [categories]);
    const search = React.useCallback((query?: string) => navigation.navigate('AllServices', { search: true, query }), [navigation]);

    /** The category if the admin has one by that name, else a service by that name, else a search for it. */
    const openByName = React.useCallback((re: RegExp, query: string) => {
        const cat = findCategory(re);
        if (cat) return navigation.navigate('CategoryDetail', { categoryId: cat.id });
        const svc = findService(re);
        if (svc) return openService(navigation, svc);
        search(query);
    }, [findCategory, findService, navigation, search]);

    /**
     * The Home Services row: today's scheduled cards first, then the built-in
     * four for any gap (one already on the row by name is skipped), four in all.
     */
    const row = React.useMemo((): RowCard[] => {
        const cats = new Map((categories ?? []).map(c => [c.id, c]));
        const svcs = new Map((categories ?? []).flatMap(c => (c.items ?? []).map(x => [x.id, x] as const)));
        const out: RowCard[] = [];
        for (const c of homeCards?.cards ?? []) {
            let auto: ImageSourcePropType, Icon: LucideIcon, onPress: () => void;
            if (c.target === 'category' && c.id != null) {
                const cat = cats.get(c.id);
                auto = cat ? photos.category(cat) : (photoForName(c.name) ?? PHOTOS.house);
                Icon = getCategoryIcon(cat ?? { name: c.name });
                const id = c.id;
                onPress = () => navigation.navigate('CategoryDetail', { categoryId: id });
            } else if (c.target === 'service' && c.id != null) {
                const svc = svcs.get(c.id);
                auto = svc ? photos.service(svc, cats.get(svc.categoryId)) : (photoForName(c.name) ?? PHOTOS.house);
                Icon = getServiceIcon(svc ?? { name: c.name });
                onPress = () => (svc ? openService(navigation, svc) : search(c.name));
            } else if (c.screen === 'recharge') {
                auto = PHOTOS.recharge; Icon = Router; onPress = () => navigation.navigate('FTTHOperatorSelect');
            } else if (c.screen === 'celebrate') {
                auto = PHOTOS.photo; Icon = PartyPopper; onPress = () => navigation.navigate('CelebrateTab');
            } else {
                auto = PHOTOS.house; Icon = LayoutGrid; onPress = () => navigation.navigate('AllServices');
            }
            const photo = c.photo?.kind === 'library' ? (photoByKey(c.photo.key) ?? auto)
                : c.photo?.kind === 'link' && /^https:\/\//.test(c.photo.url) ? { uri: c.photo.url }
                : auto;
            out.push({ key: c.key, label: c.label, photo, fallback: auto, Icon, onPress });
        }
        const onRow = (re: RegExp) => (homeCards?.cards ?? []).some(c => re.test(c.name) || re.test(c.label));
        for (const b of HOME_SERVICES) {
            if (out.length >= 4) break;
            if (onRow(b.match)) continue;
            out.push({ key: `builtin:${b.key}`, label: t(`home_cards.${b.key}`, b.label), photo: PHOTOS[b.key], Icon: b.Icon, onPress: () => openByName(b.match, b.query) });
        }
        return out.slice(0, 4);
    }, [homeCards, categories, photos, navigation, search, openByName, t]);
    const rowHeading = homeCards?.heading && homeCards.heading !== 'Home Services' ? homeCards.heading : t('home_cards.home_services', 'Home Services');

    // Travel & Tours is a feature on its way, not a category yet.
    const openTravel = () => Alert.alert(
        t('home_cards.travel_soon_title', 'Travel & Tours — coming soon'),
        t('home_cards.travel_soon_body', 'Soon you can plan, book and explore trips with UniteFix. We will let you know when it is ready.'),
    );
    // Photography lives with the event partners (Celebrate) unless the admin gives it its own category.
    const openPhotoShoots = () => {
        const cat = findCategory(/photo/i);
        if (cat) navigation.navigate('CategoryDetail', { categoryId: cat.id });
        else navigation.navigate('CelebrateTab');
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={brand.navyDark} />

            {/* Waits for the profile to load, so it cannot flash on a slow request. */}
            <ProfileCompletionGate
                visible={!isProfileLoading && !!profile && profileGaps.incomplete}
                missingAddress={profileGaps.missingAddress}
                missingPinCode={profileGaps.missingPinCode}
            />

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={{ paddingBottom: tabContent + 48 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} colors={[brand.orange]} tintColor={brand.white} progressViewOffset={headerTop} />}
            >
                {/* A · B · C */}
                <HomeHero
                    topInset={headerTop}
                    firstName={firstName}
                    unreadCount={unreadCount}
                    locationLabel={locationLabel}
                    language={language}
                    onLanguage={setLanguage}
                    onBell={() => navigation.navigate('Notifications')}
                    onAvatar={() => navigation.navigate('ProfileTab')}
                    onLocation={() => navigation.navigate('LocationSelection')}
                    onSearch={() => search()}
                />

                <View style={[styles.body, { width: rowWidth }]}>
                    {/* Came through a partner's link: who they are booking with. */}
                    <PartnerRefBanner />

                    {isServiceable === false ? (
                        <View style={styles.unserviceableCard}>
                            <MapPin size={24} color={colors.warning} />
                            <View style={styles.unserviceableContent}>
                                <Text style={styles.unserviceableTitle}>{t('home_extra.unserviceable_title')}</Text>
                                <Text style={styles.unserviceableSubtitle}>{t('home_extra.unserviceable_subtitle')}</Text>
                            </View>
                        </View>
                    ) : (
                        <>
                            {/* D · Home Services */}
                            <SectionHeader
                                title={rowHeading}
                                action={t('home_cards.view_all', 'View All')}
                                onAction={() => navigation.navigate('AllServices')}
                            />
                            <View style={[styles.row, { width: rowWidth }]}>
                                {homeCardsLoading && !homeCards
                                    ? [0, 1, 2, 3].map(i => <ServicePhotoCardSkeleton key={i} width={serviceW} />)
                                    : row.map((c, i) => (
                                        <ServicePhotoCard
                                            key={c.key}
                                            index={i}
                                            width={serviceW}
                                            label={c.label}
                                            photo={c.photo}
                                            fallback={c.fallback}
                                            Icon={c.Icon}
                                            onPress={c.onPress}
                                        />
                                    ))}
                            </View>

                            {/* E · More for You */}
                            <View style={styles.sectionGap} />
                            <SectionHeader title={t('home_cards.more_for_you', 'More for You')} />
                            <View style={[styles.row, { width: rowWidth }]}>
                                <MoreCard index={4} width={moreW} soon={t('home_cards.coming_soon', 'Coming soon')} title={t('home_cards.travel', 'Travel & Tours')} line={t('home_cards.travel_line', 'Plan · Book · Explore')} photo={PHOTOS.travel} Icon={Plane} onPress={openTravel} />
                                {/* Broadband is the recharge UniteFix runs today. */}
                                <MoreCard index={5} width={moreW} title={t('home_cards.recharge', 'Recharge & Pay')} line={t('home_cards.recharge_line', 'Broadband · Fibre')} photo={PHOTOS.recharge} Icon={Smartphone} onPress={() => navigation.navigate('FTTHOperatorSelect')} />
                                <MoreCard index={6} width={moreW} title={t('home_cards.photo', 'Photo Shoots')} line={t('home_cards.photo_line', 'Events · Portraits · More')} photo={PHOTOS.photo} Icon={Camera} onPress={openPhotoShoots} />
                            </View>
                        </>
                    )}

                    {/* Newspapers — today's editions of the papers this customer follows. */}
                    <View style={styles.sectionGap} />
                    <NewsHomeCard navigation={navigation} />
                </View>
            </ScrollView>

            {/* Customer Care FAB, placed from the real safe-area inset so the
                floating tab bar never covers it. */}
            <TouchableOpacity style={[styles.fab, { bottom: fabBottom }]} onPress={openDialer} activeOpacity={0.85} accessibilityLabel="Customer care">
                <Phone size={18} color="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.fabText}>Customer care</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: brand.background },
    scrollView: { flex: 1 },
    body: { alignSelf: 'center', paddingTop: spacing.sm },
    row: { flexDirection: 'row', gap: GAP, alignSelf: 'center' },
    sectionGap: { height: spacing.xl },

    unserviceableCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.warningLight, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md },
    unserviceableContent: { flex: 1 },
    unserviceableTitle: { ...typography.bodyMedium, color: colors.warningDark, marginBottom: 2 },
    unserviceableSubtitle: { ...typography.caption, color: colors.textSecondary, lineHeight: 20 },

    // Customer Care FAB — 3D raised effect. `bottom` comes from useScreenInsets().fabBottom.
    fab: {
        position: 'absolute', right: 20, flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#10B981', paddingVertical: 12, paddingHorizontal: 18, borderRadius: radii.full,
        borderBottomWidth: 4, borderBottomColor: '#059669',
        shadowColor: '#065F46', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 12,
    },
    fabText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 },
});
