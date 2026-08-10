/**
 * Home Screen — Premium customer landing page
 *
 * Features:
 * - Dark hero header with avatar + greeting
 * - Location pill with change action
 * - Service category grid from API
 * - "My Bookings" quick access card
 * - Trust indicators section
 * - Floating tab bar padding
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
    Animated,
    Alert,
} from 'react-native';
import {
    Wrench,
    Bell,
    ChevronRight,
    MapPin,
    Star,
    Shield,
    Clock,
    Headphones,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useProfile } from '../../hooks/useCustomerData';
import { useAuthStore } from '../../stores/auth.store';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { Skeleton, CardSkeleton } from '../../components/Skeleton';
import * as Location from 'expo-location';
import { customerApi } from '../../api/customer.api';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { useTranslation } from 'react-i18next';

import { ServiceCard } from '../../components/services/ServiceCard';
import { useHomeServices } from '../../hooks/useCustomerData';
import { ServiceItem } from '../../api/customer.api';
import { useScreenInsets } from '../../theme/layout';

// Trust indicators data
const TRUST_ITEMS = [
    { icon: Shield, labelKey: 'home_extra.verified_experts', color: colors.primary },
    { icon: Star, labelKey: 'home_extra.rated', color: colors.warning },
    { icon: Clock, labelKey: 'home_extra.fast_response', color: colors.success },
    { icon: Headphones, labelKey: 'home_extra.support_247', color: colors.info },
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
    const { t } = useTranslation();

    const [isFetchingLocation, setIsFetchingLocation] = React.useState(false);
    const [isServiceable, setIsServiceable] = React.useState<boolean | null>(null);

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

    React.useEffect(() => {
        if (profile?.pinCode) {
            const cleanPin = profile.pinCode.replace(/\s+/g, '');
            customerApi.validatePincode(cleanPin).then(res => {
                const isAvail = res.data?.available || res.data?.serviceable;
                setIsServiceable(isAvail ?? true);
            }).catch(err => {
                console.error('Pincode validation error', err);
                setIsServiceable(true);
            });
        } else {
            setIsServiceable(null);
        }
    }, [profile?.pinCode]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.backgroundDark} />

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
                    >
                        <Bell size={20} color={colors.textInverse} strokeWidth={2} />
                    </TouchableOpacity>
                </View>

                {/* Location Pill */}
                <TouchableOpacity
                    style={styles.locationPill}
                    onPress={() => navigation.navigate('LocationSelection')}
                    activeOpacity={0.8}
                >
                    <MapPin size={14} color={colors.primary} strokeWidth={2.5} />
                    <Text style={styles.locationText} numberOfLines={1}>
                        {isFetchingLocation ? t('home_extra.detecting') : (profile?.homeAddress || t('home_extra.set_location'))}
                    </Text>
                    <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: tabContent }]}
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
                {/* Trust Indicators */}
                <View style={styles.trustRow}>
                    {TRUST_ITEMS.map((item, i) => (
                        <View key={i} style={styles.trustItem}>
                            <View style={[styles.trustIcon, { backgroundColor: item.color + '15' }]}>
                                <item.icon size={16} color={item.color} strokeWidth={2.2} />
                            </View>
                            <Text style={styles.trustLabel}>{t(item.labelKey)}</Text>
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
                        {/* Services Section */}
                        <SectionHeader
                            title={t('home.categories', 'Our Services')}
                            subtitle={t('home.what_do_you_need', 'What do you need help with?')}
                            actionLabel="View all"
                            onAction={() => navigation.navigate('AllServices')}
                        />

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

                {/* Quick Access — My Bookings */}
                <TouchableOpacity
                    style={styles.bookingsCard}
                    onPress={() => navigation.navigate('BookingsTab')}
                    activeOpacity={0.7}
                >
                    <View style={styles.bookingsLeft}>
                        <View style={styles.bookingsIconWrap}>
                            <Wrench size={18} color={colors.primary} />
                        </View>
                        <View>
                            <Text style={styles.bookingsTitle}>{t('home_extra.my_service_requests')}</Text>
                            <Text style={styles.bookingsSubtitle}>{t('home_extra.track_bookings')}</Text>
                        </View>
                    </View>
                    <ChevronRight size={18} color={colors.textDisabled} />
                </TouchableOpacity>
            </ScrollView>
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

    // Location Pill
    locationPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: 'rgba(255,255,255,0.08)',
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.base,
        borderRadius: radii.full,
        marginTop: spacing.lg,
    },
    locationText: {
        ...typography.small,
        color: 'rgba(255,255,255,0.7)',
        flex: 1,
    },

    // Scroll
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
    },

    // Trust Row
    trustRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: spacing['2xl'],
    },
    trustItem: {
        alignItems: 'center',
        flex: 1,
    },
    trustIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xs,
    },
    trustLabel: {
        ...typography.small,
        color: colors.textSecondary,
        textAlign: 'center',
    },

    // Services
    categoryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: spacing.xl,
    },
    serviceCardWrapper: {
        width: '47.5%', // Slightly reduced to prevent edge overlap
        marginBottom: spacing.md,
    },

    // Bookings Card
    bookingsCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.lg,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.sm,
    },
    bookingsLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    bookingsIconWrap: {
        width: 40,
        height: 40,
        borderRadius: radii.lg,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bookingsTitle: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    bookingsSubtitle: {
        ...typography.small,
        color: colors.textSecondary,
        marginTop: 1,
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
});
