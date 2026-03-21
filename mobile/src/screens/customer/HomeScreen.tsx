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
import { PincodeChecker } from '../../components/PincodeChecker';
import { Skeleton, CardSkeleton } from '../../components/Skeleton';

const SERVICE_CATEGORIES = [
    { id: 'plumbing', name: 'Plumbing', icon: Droplets, color: '#2196F3' },
    { id: 'electrical', name: 'Electrical', icon: Zap, color: '#FF9800' },
    { id: 'painting', name: 'Painting', icon: PaintBucket, color: '#9C27B0' },
    { id: 'ac_repair', name: 'AC Repair', icon: Thermometer, color: '#00BCD4' },
    { id: 'carpentry', name: 'Carpentry', icon: Hammer, color: '#795548' },
    { id: 'appliance', name: 'Appliance', icon: Cpu, color: '#607D8B' },
    { id: 'security', name: 'Security', icon: Shield, color: '#4CAF50' },
    { id: 'general', name: 'General', icon: Wrench, color: '#F44336' },
];

export function HomeScreen() {
    const { user } = useAuthStore();
    const { data: profile, isLoading, refetch } = useProfile();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const displayName = profile?.username || user?.username || 'User';
    const firstName = displayName.split(' ')[0];

    const handleCategoryPress = (category: typeof SERVICE_CATEGORIES[0]) => {
        navigation.navigate('ServiceRequest', { serviceType: category.id, serviceName: category.name });
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

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

                {/* Location pill */}
                {profile?.pinCode && (
                    <View style={styles.locationPill}>
                        <MapPin size={14} color={colors.primary} />
                        <Text style={styles.locationText}>
                            {profile.address || `Pin: ${profile.pinCode}`}
                        </Text>
                    </View>
                )}
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isLoading}
                        onRefresh={refetch}
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

                {/* Pincode Check */}
                <PincodeChecker
                    initialPincode={profile?.pinCode}
                    onVerified={(pc) => console.log('Pincode verified:', pc)}
                />

                {/* Category grid */}
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Our Services</Text>
                    <Text style={styles.sectionSubtitle}>What do you need help with?</Text>
                </View>

                <View style={styles.categoryGrid}>
                    {SERVICE_CATEGORIES.map((category) => {
                        const Icon = category.icon;
                        return (
                            <TouchableOpacity
                                key={category.id}
                                style={styles.categoryCard}
                                onPress={() => handleCategoryPress(category)}
                                activeOpacity={0.7}
                            >
                                <View style={[styles.categoryIconWrap, { backgroundColor: category.color + '15' }]}>
                                    <Icon size={28} color={category.color} />
                                </View>
                                <Text style={styles.categoryName}>{category.name}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

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
        backgroundColor: colors.primary,
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
    locationPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        backgroundColor: 'rgba(255,255,255,0.9)',
        paddingVertical: spacing.xs + 2,
        paddingHorizontal: spacing.md,
        borderRadius: radii.full,
        alignSelf: 'flex-start',
        marginTop: spacing.md,
    },
    locationText: {
        ...typography.small,
        color: colors.textPrimary,
        fontWeight: '500',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.xl,
        paddingBottom: spacing['3xl'],
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
        backgroundColor: 'rgba(33, 150, 243, 0.1)',
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
        gap: spacing.md,
        marginBottom: spacing.xl,
    },
    categoryCard: {
        width: '22%',
        flexBasis: '22%',
        flexGrow: 1,
        alignItems: 'center',
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.md,
        ...shadows.sm,
    },
    categoryIconWrap: {
        width: 52,
        height: 52,
        borderRadius: radii.lg,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    categoryName: {
        ...typography.small,
        fontWeight: '500',
        color: colors.textPrimary,
        textAlign: 'center',
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
});
