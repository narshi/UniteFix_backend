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
    Platform,
    Animated,
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

import { ServiceCard } from '../../components/services/ServiceCard';
import { useHomeServices } from '../../hooks/useCustomerData';
import { ServiceItem } from '../../api/customer.api';

// Trust indicators data
const TRUST_ITEMS = [
    { icon: Shield, label: 'Verified Experts', color: colors.primary },
    { icon: Star, label: '4.8★ Rated', color: colors.warning },
    { icon: Clock, label: '60-min Response', color: colors.success },
    { icon: Headphones, label: '24/7 Support', color: colors.info },
];

export function HomeScreen() {
    const { user } = useAuthStore();
    const { data: profile, isLoading: isProfileLoading, refetch: refetchProfile } = useProfile();
    const { data: homeServices, isLoading: isServicesLoading, refetch: refetchServices } = useHomeServices();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const [isFetchingLocation, setIsFetchingLocation] = React.useState(false);
    const [isServiceable, setIsServiceable] = React.useState<boolean | null>(null);

    const isLoading = isProfileLoading || isServicesLoading;

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

    // Get time-based greeting
    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.backgroundDark} />

            {/* Hero Header */}
            <View style={styles.header}>
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
                            <Text style={styles.greeting}>{getGreeting()},</Text>
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
                        {isFetchingLocation ? 'Detecting...' : (profile?.homeAddress || 'Set your location')}
                    </Text>
                    <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isLoading}
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
                            <Text style={styles.trustLabel}>{item.label}</Text>
                        </View>
                    ))}
                </View>

                {/* Serviceability Check */}
                {isServiceable === false ? (
                    <View style={styles.unserviceableCard}>
                        <MapPin size={24} color={colors.warning} />
                        <View style={styles.unserviceableContent}>
                            <Text style={styles.unserviceableTitle}>Expanding to your area soon</Text>
                            <Text style={styles.unserviceableSubtitle}>
                                We'll notify you when services are available in your pincode.
                            </Text>
                        </View>
                    </View>
                ) : (
                    <>
                        {/* Services Section */}
                        <SectionHeader
                            title="Our Services"
                            subtitle="What do you need help with?"
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
                                                        import('react-native').then(({ Alert }) => {
                                                            Alert.alert(
                                                                "Coming Soon",
                                                                "This service is launching soon in your area.",
                                                                [{ text: "OK" }]
                                                            );
                                                        });
                                                    } else if (service.status === 'MAINTENANCE') {
                                                        import('react-native').then(({ Alert }) => {
                                                            Alert.alert(
                                                                "Under Maintenance",
                                                                "This service is temporarily under maintenance.",
                                                                [{ text: "OK" }]
                                                            );
                                                        });
                                                    } else {
                                                        navigation.navigate('ServiceRequest', { serviceType: service.name });
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
                            <Text style={styles.bookingsTitle}>My Service Requests</Text>
                            <Text style={styles.bookingsSubtitle}>View and track your bookings</Text>
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
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
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
        paddingBottom: 140, // Floating tab bar + safe area inset
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
        width: '48%',
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
