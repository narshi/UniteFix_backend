/**
 * Home Screen — Premium customer landing page (Redesigned)
 *
 * Features:
 * - Dark hero header with avatar + greeting
 * - Location pill with city/state display
 * - Language toggle (ಕನ್ನಡ / EN)
 * - Trust indicators (Verified Experts, Best Rated, Prompt Service)
 * - Service category grid with pricing
 * - "Book a Service" CTA button
 * - Customer Care FAB (opens dialer)
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    Alert,
    Linking,
} from 'react-native';
import {
    Bell,
    ChevronRight,
    MapPin,
    Star,
    Shield,
    Clock,
    Phone,
    CalendarPlus,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useProfile, useUnreadNotificationCount, usePublicConfig } from '../../hooks/useCustomerData';
import { useAuthStore } from '../../stores/auth.store';
import { useLanguageStore } from '../../stores/languageStore';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Skeleton, CardSkeleton } from '../../components/Skeleton';
import * as Location from 'expo-location';
import { customerApi } from '../../api/customer.api';
import { useTranslation } from 'react-i18next';

import { ServiceCard } from '../../components/services/ServiceCard';
import { useHomeServices } from '../../hooks/useCustomerData';
import { ServiceItem } from '../../api/customer.api';
import { useScreenInsets } from '../../theme/layout';
import { useServiceability } from '../../hooks/useServiceability';
import { ProfileCompletionGate, isProfileIncomplete } from '../../components/ProfileCompletionGate';

// Trust indicators — non-committing labels as requested
const TRUST_ITEMS = [
    { icon: Shield, labelKey: 'home_extra.verified_experts', fallback: 'Verified Experts' },
    { icon: Star, labelKey: 'home_extra.best_rated', fallback: 'Best Rated' },
    { icon: Clock, labelKey: 'home_extra.prompt_service', fallback: 'Prompt Service' },
];

export function HomeScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const { user } = useAuthStore();
    const {
        data: profile,
        isLoading: isProfileLoading,
        isRefetching: isProfileRefetching,
        refetch: refetchProfile,
    } = useProfile();
    const {
        data: homeServices,
        isLoading: isServicesLoading,
        isRefetching: isServicesRefetching,
        refetch: refetchServices,
    } = useHomeServices();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const { data: unreadCount = 0 } = useUnreadNotificationCount();
    const { data: publicConfig } = usePublicConfig();
    const { t } = useTranslation();
    const { language, setLanguage } = useLanguageStore();

    const [isFetchingLocation, setIsFetchingLocation] = React.useState(false);

    // Shared with the expert app so the two cannot drift apart.
    const { isServiceable } = useServiceability(profile?.pinCode);

    // Accounts created before location became mandatory, and anyone who denied
    // the permission, have no address at all. Nothing can be booked in that
    // state, so the prompt blocks the screen rather than sitting under it.
    const profileGaps = isProfileIncomplete(profile);

    // `isLoading` drives skeletons on first paint; `isRefetching` drives the
    // pull-to-refresh spinner. Binding the spinner to isLoading made it appear
    // on initial mount alongside the skeletons.
    const isLoading = isProfileLoading || isServicesLoading;
    const isRefreshing = isProfileRefetching || isServicesRefetching;

    const onRefresh = React.useCallback(() => {
        refetchProfile();
        refetchServices();
    }, [refetchProfile, refetchServices]);

    const displayName = profile?.username || user?.username || 'User';
    const firstName = displayName.split(' ')[0];

    // Build a short location label: "City, State" from the full address
    const locationLabel = React.useMemo(() => {
        if (isFetchingLocation) return t('home_extra.detecting', 'Detecting...');
        if (!profile?.homeAddress) return t('home_extra.set_location', 'Set your location');
        // Try to extract last 2 meaningful parts (city, state) from comma-separated address
        const parts = profile.homeAddress.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (parts.length >= 2) return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
        return profile.homeAddress;
    }, [profile?.homeAddress, isFetchingLocation, t]);

    const supportNumber = publicConfig?.whatsappNumber || '919448850679';

    const openDialer = React.useCallback(() => {
        const phoneUrl = `tel:+${supportNumber}`;
        Linking.openURL(phoneUrl).catch(() => {
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

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.backgroundDark} />

            {/* Waits for the profile to load, so it cannot flash on a slow request. */}
            <ProfileCompletionGate
                visible={!isProfileLoading && !!profile && profileGaps.incomplete}
                missingAddress={profileGaps.missingAddress}
                missingPinCode={profileGaps.missingPinCode}
            />

            {/* Hero Header */}
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <View style={styles.headerTop}>
                    <View style={styles.headerLeft}>
                        {isLoading ? (
                            <Skeleton width={48} height={48} borderRadius={24} />
                        ) : (
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>
                                    {firstName.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                        )}
                        <View>
                            <Text style={styles.greeting}>{t('home.greeting', 'Hello')},</Text>
                            {isLoading ? (
                                <Skeleton width={100} height={20} style={{ marginTop: 4 }} />
                            ) : (
                                <Text style={styles.userName}>{firstName}</Text>
                            )}
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.bellButton}
                        onPress={() => navigation.navigate('Notifications')}
                        activeOpacity={0.7}
                        accessibilityLabel="Notifications"
                    >
                        <Bell size={20} color={colors.textInverse} strokeWidth={2} />
                        {unreadCount > 0 && (
                            <View style={styles.bellBadge}>
                                <Text style={styles.bellBadgeText}>
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>

                {/* Location Pill + Language Toggle Row */}
                <View style={styles.headerBottomRow}>
                    <TouchableOpacity
                        style={styles.locationPill}
                        onPress={() => navigation.navigate('LocationSelection')}
                        activeOpacity={0.8}
                    >
                        <MapPin size={14} color={colors.accent} strokeWidth={2.5} />
                        <Text style={styles.locationText} numberOfLines={1}>
                            {locationLabel}
                        </Text>
                        <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                    </TouchableOpacity>

                    {/* Language Toggle */}
                    <View style={styles.langToggle}>
                        <TouchableOpacity
                            style={[
                                styles.langOption,
                                language === 'kn' && styles.langOptionActive,
                            ]}
                            onPress={() => setLanguage('kn')}
                            activeOpacity={0.7}
                        >
                            <Text style={[
                                styles.langText,
                                language === 'kn' && styles.langTextActive,
                            ]}>ಕನ್ನಡ</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.langOption,
                                language === 'en' && styles.langOptionActive,
                            ]}
                            onPress={() => setLanguage('en')}
                            activeOpacity={0.7}
                        >
                            <Text style={[
                                styles.langText,
                                language === 'en' && styles.langTextActive,
                            ]}>EN</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContent + 80 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={onRefresh}
                        colors={[colors.primary]}
                        tintColor={colors.primary}
                    />
                }
            >
                {/* Trust Indicators — inline row */}
                <View style={styles.trustRow}>
                    {TRUST_ITEMS.map((item, i) => (
                        <View key={i} style={styles.trustItem}>
                            <item.icon size={16} color={colors.textSecondary} strokeWidth={2} />
                            <Text style={styles.trustLabel}>
                                {t(item.labelKey, item.fallback)}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Serviceability Check */}
                {isServiceable === false ? (
                    <View style={styles.unserviceableCard}>
                        <MapPin size={24} color={colors.warning} />
                        <View style={styles.unserviceableContent}>
                            <Text style={styles.unserviceableTitle}>{t('home_extra.unserviceable_title')}</Text>
                            <Text style={styles.unserviceableSubtitle}>
                                {t('home_extra.unserviceable_subtitle')}
                            </Text>
                        </View>
                    </View>
                ) : (
                    <>
                        {/* Categories Header with Book a Service button */}
                        <View style={styles.categoriesHeader}>
                            <View>
                                <Text style={styles.categoriesTitle}>
                                    {t('home.categories', 'Categories')}
                                </Text>
                                <Text style={styles.categoriesSubtitle}>
                                    {t('home.what_do_you_need', 'What do you need help with?')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.bookServiceBtn}
                                onPress={() => navigation.navigate('AllServices')}
                                activeOpacity={0.8}
                            >
                                <CalendarPlus size={14} color={colors.textInverse} strokeWidth={2.5} />
                                <Text style={styles.bookServiceBtnText}>
                                    {t('home.book_service', 'Book a Service')}
                                </Text>
                                <ChevronRight size={14} color={colors.textInverse} />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.categoryGrid}>
                            {isServicesLoading ? (
                                Array.from({ length: 4 }).map((_, idx) => (
                                    <View key={idx} style={styles.serviceCardWrapper}>
                                        <CardSkeleton />
                                    </View>
                                ))
                            ) : (
                                <>
                                    {homeServices?.slice(0, 5).map((service: ServiceItem) => (
                                        <View key={service.id} style={styles.serviceCardWrapper}>
                                            <ServiceCard
                                                service={service}
                                                onPress={() => {
                                                    if (service.status === 'COMING_SOON') {
                                                        Alert.alert(
                                                            'Coming Soon',
                                                            'This service is launching soon in your area.',
                                                        );
                                                    } else if (service.status === 'MAINTENANCE') {
                                                        Alert.alert(
                                                            'Under Maintenance',
                                                            'This service is temporarily under maintenance.',
                                                        );
                                                    } else {
                                                        navigation.navigate('ServiceRequest', {
                                                            serviceType: service.name,
                                                            serviceName: service.name,
                                                            serviceId: service.id,
                                                            basePrice: service.basePrice ?? 0,
                                                        });
                                                    }
                                                }}
                                            />
                                        </View>
                                    ))}
                                    <View style={styles.serviceCardWrapper}>
                                        <ServiceCard
                                            isMoreCard
                                            onPress={() => navigation.navigate('AllServices')}
                                        />
                                    </View>
                                </>
                            )}
                        </View>
                    </>
                )}
            </ScrollView>

            {/* Customer Care FAB */}
            <TouchableOpacity
                style={styles.fab}
                onPress={openDialer}
                activeOpacity={0.85}
                accessibilityLabel="Customer care"
            >
                <Phone size={18} color="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.fabText}>Customer care</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },

    // Hero Header
    header: {
        backgroundColor: colors.backgroundDark,
        paddingBottom: spacing.xl,
        paddingHorizontal: spacing.xl,
        borderBottomLeftRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'],
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.2)',
    },
    avatarText: {
        fontSize: 20,
        fontWeight: '700',
        color: colors.textInverse,
    },
    greeting: {
        ...typography.caption,
        color: 'rgba(255,255,255,0.6)',
    },
    userName: {
        ...typography.h4,
        color: colors.textInverse,
    },
    bellButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    bellBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 3,
        backgroundColor: colors.error,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

    // Header bottom row: location + language
    headerBottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        marginTop: spacing.lg,
    },
    locationPill: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: 'rgba(255,255,255,0.08)',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        borderRadius: radii.full,
    },
    locationText: {
        ...typography.small,
        color: 'rgba(255,255,255,0.7)',
        flex: 1,
    },

    // Language Toggle
    langToggle: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: radii.full,
        padding: 3,
    },
    langOption: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: radii.full,
    },
    langOptionActive: {
        backgroundColor: colors.primary,
    },
    langText: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.5)',
    },
    langTextActive: {
        color: colors.textInverse,
    },

    // Scroll
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
    },

    // Trust Row — inline, no circle backgrounds
    trustRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing['2xl'],
        paddingVertical: spacing.md,
    },
    trustItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    trustLabel: {
        ...typography.small,
        color: colors.textSecondary,
    },

    // Categories Section Header
    categoriesHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.lg,
    },
    categoriesTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    categoriesSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    bookServiceBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.backgroundDark,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: radii.lg,
    },
    bookServiceBtnText: {
        ...typography.buttonSmall,
        fontSize: 12,
        color: colors.textInverse,
    },

    // Services Grid
    categoryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: spacing.xl,
    },
    serviceCardWrapper: {
        width: '47.5%',
        marginBottom: spacing.md,
    },

    // Unserviceable
    unserviceableCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: colors.warningLight,
        borderRadius: radii.xl,
        padding: spacing.lg,
        gap: spacing.md,
        marginBottom: spacing.xl,
    },
    unserviceableContent: {
        flex: 1,
    },
    unserviceableTitle: {
        ...typography.bodyMedium,
        color: colors.warningDark,
        marginBottom: 2,
    },
    unserviceableSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        lineHeight: 20,
    },

    // Customer Care FAB
    fab: {
        position: 'absolute',
        bottom: 90,
        right: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.accent,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: radii.full,
        ...shadows.lg,
        shadowColor: colors.accentDark,
    },
    fabText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#FFFFFF',
    },
});
