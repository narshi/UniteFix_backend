/**
 * Home Screen — Welcome banner + Service category grid
 * Customer's main landing screen after login
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
} from 'react-native';
import {
    Wrench,
    Zap,
    Droplets,
    PaintBucket,
    Thermometer,
    Shield,
    Hammer,
    Cpu,
    Bell,
    ChevronRight,
    MapPin,
    Search,
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

import { ServiceCard } from '../../components/services/ServiceCard';
import { useHomeServices } from '../../hooks/useCustomerData';
import { ServiceItem } from '../../api/customer.api';

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
                setIsServiceable(true); // Default to true on error so we don't block by mistake
            });
        } else {
            setIsServiceable(null);
        }
    }, [profile?.pinCode]);


    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.backgroundDark} />

            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerContent}>
                    <View style={styles.headerLeft}>
                        {isLoading ? (
                            <Skeleton width={44} height={44} borderRadius={22} />
                        ) : (
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>
                                    {firstName.charAt(0).toUpperCase()}
                                </Text>
                            </View>
                        )}
                        <View>
                            <Text style={styles.greeting}>Hello,</Text>
                            {isLoading ? (
                                <Skeleton width={100} height={20} style={{ marginTop: 4 }} />
                            ) : (
                                <Text style={styles.userName}>{firstName} 👋</Text>
                            )}
                        </View>
                    </View>
                    <TouchableOpacity
                        style={styles.bellButton}
                        onPress={() => navigation.navigate('Notifications')}
                    >
                        <Bell size={22} color={colors.textInverse} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Location Banner */}
            <View style={styles.locationBanner}>
                <View style={styles.locationInfo}>
                    <MapPin size={20} color={colors.primary} />
                    <View style={styles.locationTextContainer}>
                        <Text style={styles.locationLabel}>Your Location</Text>
                        {isFetchingLocation ? (
                            <Text style={styles.locationValue}>Fetching location...</Text>
                        ) : (
                            <Text style={styles.locationValue} numberOfLines={2}>
                                {profile?.homeAddress || 'Location not set'}
                            </Text>
                        )}
                    </View>
                </View>
                <TouchableOpacity 
                    style={styles.changeButton}
                    onPress={() => navigation.navigate('LocationSelection')}
                >
                    <Text style={styles.changeButtonText}>Change</Text>
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
                    />
                }
            >
                {/* Welcome card */}
                <View style={styles.welcomeCard}>
                    <View style={styles.welcomeLeft}>
                        <Text style={styles.welcomeTitle}>Need a repair?</Text>
                        <Text style={styles.welcomeSubtitle}>
                            Choose a category below to book a service at your doorstep.
                        </Text>
                    </View>
                    <View style={styles.welcomeIcon}>
                        <Wrench size={40} color={colors.primary} />
                    </View>
                </View>

                {/* Serviceability Check */}
                {isServiceable === false ? (
                    <View style={styles.unserviceableContainer}>
                        <Text style={styles.unserviceableTitle}>We are coming to your area shortly</Text>
                        <Text style={styles.unserviceableSubtitle}>
                            Currently, we do not operate in your area. We will notify you once we expand our services here.
                        </Text>
                    </View>
                ) : (
                    <>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Our Services</Text>
                            <Text style={styles.sectionSubtitle}>What do you need help with?</Text>
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
                                    {homeServices?.map((service: ServiceItem) => (
                                        <View key={service.id} style={styles.serviceCardWrapper}>
                                            <ServiceCard
                                                service={service}
                                                onPress={() => {
                                                    if (service.status === 'COMING_SOON') {
                                                        import('react-native').then(({ Alert }) => {
                                                            Alert.alert(
                                                                "Coming Soon",
                                                                "🚀 This service is launching soon in your area.",
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

                {/* Recent requests teaser */}
                <TouchableOpacity
                    style={styles.recentCard}
                    onPress={() => navigation.navigate('BookingsTab')}
                    activeOpacity={0.8}
                >
                    <View>
                        <Text style={styles.recentTitle}>My Service Requests</Text>
                        <Text style={styles.recentSubtitle}>View and track your bookings</Text>
                    </View>
                    <ChevronRight size={20} color={colors.textSecondary} />
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
    header: {
        backgroundColor: colors.backgroundDark,
        paddingTop: 50,
        paddingBottom: spacing.xl,
        paddingHorizontal: spacing.xl,
        borderBottomLeftRadius: radii['2xl'],
        borderBottomRightRadius: radii['2xl'],
    },
    headerContent: {
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
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.25)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.textInverse,
    },
    greeting: {
        ...typography.caption,
        color: 'rgba(255,255,255,0.8)',
    },
    userName: {
        ...typography.h4,
        color: colors.textInverse,
    },
    bellButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    locationBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface,
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        ...shadows.sm,
    },
    locationInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: spacing.md,
    },
    locationTextContainer: {
        marginLeft: spacing.md,
        flex: 1,
    },
    locationLabel: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    locationValue: {
        ...typography.body,
        color: colors.textPrimary,
        fontWeight: '600',
    },
    changeButton: {
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: radii.full,
        backgroundColor: colors.primarySurface,
    },
    changeButtonText: {
        ...typography.small,
        color: colors.primary,
        fontWeight: '600',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
        paddingBottom: 100, // Extra space for floating tab bar
    },
    welcomeCard: {
        flexDirection: 'row',
        backgroundColor: colors.primarySurface,
        borderRadius: radii.xl,
        padding: spacing.xl,
        marginBottom: spacing.xl,
        alignItems: 'center',
    },
    welcomeLeft: {
        flex: 1,
        marginRight: spacing.md,
    },
    welcomeTitle: {
        ...typography.h4,
        color: colors.primaryDark,
        marginBottom: spacing.xs,
    },
    welcomeSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
    },
    welcomeIcon: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sectionHeader: {
        marginBottom: spacing.lg,
    },
    sectionTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    sectionSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    categoryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginTop: spacing.md,
        marginBottom: spacing.xl,
    },
    serviceCardWrapper: {
        width: '48%',
        marginBottom: spacing.md,
    },
    recentCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.lg,
        ...shadows.sm,
    },
    recentTitle: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
    },
    recentSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    unserviceableContainer: {
        backgroundColor: colors.error + '10',
        padding: spacing.xl,
        borderRadius: radii.lg,
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    unserviceableTitle: {
        ...typography.h4,
        color: colors.error,
        marginBottom: spacing.sm,
        textAlign: 'center',
    },
    unserviceableSubtitle: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
    },
});
