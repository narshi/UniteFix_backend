/**
 * My Bookings — Premium booking history with status chips and sections
 * 
 * Features:
 * - Active vs Past section split
 * - Animated card entrance
 * - Premium status chips with icons
 * - Pull-to-refresh
 * - Empty state illustration
 */

import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    Animated,
    Platform,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
    ChevronRight,
    Calendar,
    ClipboardList,
    Clock,
    CheckCircle,
    User,
    Navigation,
    Wrench,
    XCircle,
    CreditCard,
    IndianRupee,
    AlertTriangle,
    Shield,
} from 'lucide-react-native';
import { useServiceRequests, useServiceHistory, usePublicConfig } from '../../hooks/useCustomerData';
import { ServiceRequest } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string; icon: any }> = {
    created: { bg: colors.warningLight, text: colors.warningDark, label: 'Created', icon: Clock },
    assigned: { bg: colors.infoLight, text: colors.info, label: 'Assigned', icon: User },
    accepted: { bg: colors.infoLight, text: colors.info, label: 'Accepted', icon: Shield },
    reached: { bg: colors.primarySurface, text: colors.primary, label: 'Arrived', icon: Navigation },
    in_progress: { bg: colors.primarySurface, text: colors.primary, label: 'In Progress', icon: Wrench },
    pending_payment: { bg: colors.warningLight, text: colors.warningDark, label: 'Pay Now', icon: IndianRupee },
    completed: { bg: colors.successLight, text: colors.successDark, label: 'Completed', icon: CheckCircle },
    cancelled: { bg: colors.errorLight, text: colors.errorDark, label: 'Cancelled', icon: XCircle },
    disputed: { bg: colors.errorLight, text: colors.errorDark, label: 'Disputed', icon: AlertTriangle },
};

function StatusChip({ status }: { status: string }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.created;
    const Icon = config.icon;
    return (
        <View style={[chipStyles.chip, { backgroundColor: config.bg }]}>
            <Icon size={12} color={config.text} />
            <Text style={[chipStyles.text, { color: config.text }]}>{config.label}</Text>
        </View>
    );
}

const chipStyles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 4,
        paddingHorizontal: spacing.sm + 2,
        borderRadius: radii.full,
    },
    text: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
});

function BookingCard({ item, onPress, index }: { item: ServiceRequest; onPress: () => void; index: number }) {
    const { data: publicConfig } = usePublicConfig();
    const defaultBookingFee = publicConfig?.bookingFee ?? 99;
    const slideAnim = useRef(new Animated.Value(30)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 400,
                delay: index * 80,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 400,
                delay: index * 80,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
    });

    const needsPayment = item.status === 'pending_payment';
    const isActive = !['completed', 'cancelled'].includes(item.status);

    return (
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            <TouchableOpacity
                style={[
                    cardStyles.card,
                    needsPayment && cardStyles.paymentCard,
                    isActive && cardStyles.activeCard,
                ]}
                onPress={onPress}
                activeOpacity={0.7}
            >
                <View style={cardStyles.header}>
                    <View style={cardStyles.serviceInfo}>
                        <Text style={cardStyles.serviceType}>
                            {item.serviceType.replace(/_/g, ' ')}
                        </Text>
                        {item.servicemanName && (
                            <Text style={cardStyles.techName}>
                                <User size={11} color={colors.textSecondary} /> {item.servicemanName}
                            </Text>
                        )}
                    </View>
                    <StatusChip status={item.status} />
                </View>

                <Text style={cardStyles.description} numberOfLines={1}>{item.description}</Text>

                <View style={cardStyles.footer}>
                    <View style={cardStyles.dateRow}>
                        <Calendar size={13} color={colors.textSecondary} />
                        <Text style={cardStyles.dateText}>{date}</Text>
                    </View>
                    {item.totalCharge ? (
                        <Text style={cardStyles.amount}>₹{item.totalCharge}</Text>
                    ) : (
                        <Text style={cardStyles.bookingFee}>₹{item.bookingFee ?? defaultBookingFee} paid</Text>
                    )}
                    <ChevronRight size={16} color={colors.textDisabled} />
                </View>

                {needsPayment && (
                    <View style={cardStyles.paymentBanner}>
                        <CreditCard size={14} color={colors.textInverse} />
                        <Text style={cardStyles.paymentBannerText}>Tap to complete payment</Text>
                    </View>
                )}
            </TouchableOpacity>
        </Animated.View>
    );
}

const cardStyles = StyleSheet.create({
    card: {
        backgroundColor: colors.background,
        borderRadius: radii.xl,
        padding: spacing.lg,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.sm,
    },
    activeCard: {
        borderColor: colors.primaryLight,
        borderWidth: 1,
    },
    paymentCard: {
        borderColor: colors.warning,
        borderWidth: 1.5,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: spacing.sm,
    },
    serviceInfo: { flex: 1, marginRight: spacing.sm },
    serviceType: {
        ...typography.bodySemibold,
        color: colors.textPrimary,
        textTransform: 'capitalize',
    },
    techName: {
        ...typography.small,
        color: colors.textSecondary,
        marginTop: 2,
    },
    description: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.md,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
    },
    dateText: {
        ...typography.small,
        color: colors.textSecondary,
    },
    amount: {
        ...typography.mono,
        color: colors.primary,
        fontSize: 14,
    },
    bookingFee: {
        ...typography.small,
        color: colors.textDisabled,
    },
    paymentBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.primary,
        paddingVertical: spacing.sm,
        borderRadius: radii.md,
        marginTop: spacing.md,
    },
    paymentBannerText: {
        ...typography.buttonSmall,
        color: colors.textInverse,
    },
});

export function MyRequestsScreen() {
    const { data: requests, isLoading, refetch, isRefetching } = useServiceRequests();
    const {
        data: historyPages,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: historyLoading,
        refetch: refetchHistory,
        isRefetching: isHistoryRefetching,
    } = useServiceHistory();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const handlePress = (item: ServiceRequest) => {
        navigation.navigate('RequestDetail', { request: item });
    };

    // Active bookings from the regular query
    const activeRequests = (requests || []).filter(
        (r: ServiceRequest) => !['completed', 'cancelled', 'disputed'].includes(r.status)
    );

    // Past bookings from infinite query (flattened pages)
    const pastRequests = historyPages?.pages?.flatMap((page: any) => page.data || []) || [];
    const totalPast = historyPages?.pages?.[0]?.pagination?.total || pastRequests.length;

    const allData = [
        ...(activeRequests.length > 0 ? [{ type: 'header', title: `Active (${activeRequests.length})` }] : []),
        ...activeRequests.map((r: ServiceRequest) => ({ type: 'item', data: r })),
        ...(pastRequests.length > 0 ? [{ type: 'header', title: `Past (${totalPast})` }] : []),
        ...pastRequests.map((r: any) => ({ type: 'item', data: r })),
    ];

    const handleRefresh = () => {
        refetch();
        refetchHistory();
    };

    const handleEndReached = () => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    if (isLoading && historyLoading) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>My Bookings</Text>
                </View>
                <View style={{ padding: spacing.xl }}>
                    {[1, 2, 3].map(i => (
                        <View key={i} style={[cardStyles.card, { opacity: 0.3 }]}>
                            <View style={{ height: 16, width: '60%', backgroundColor: colors.border, borderRadius: 4, marginBottom: 8 }} />
                            <View style={{ height: 12, width: '80%', backgroundColor: colors.border, borderRadius: 4, marginBottom: 12 }} />
                            <View style={{ height: 12, width: '40%', backgroundColor: colors.border, borderRadius: 4 }} />
                        </View>
                    ))}
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>My Bookings</Text>
                <Text style={styles.headerSub}>
                    {activeRequests.length} active · {totalPast} past
                </Text>
            </View>

            <FlatList
                data={allData}
                renderItem={({ item, index }: any) => {
                    if (item.type === 'header') {
                        return (
                            <Text style={styles.sectionHeader}>{item.title}</Text>
                        );
                    }
                    return (
                        <BookingCard
                            item={item.data}
                            onPress={() => handlePress(item.data)}
                            index={index}
                        />
                    );
                }}
                keyExtractor={(item: any, index) => item.type === 'header' ? `header-${index}` : `item-${item.data.id}`}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.3}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching || isHistoryRefetching}
                        onRefresh={handleRefresh}
                        colors={[colors.primary]}
                        tintColor={colors.primary}
                    />
                }
                ListFooterComponent={
                    isFetchingNextPage ? (
                        <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : null
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <View style={styles.emptyIconWrap}>
                            <ClipboardList size={40} color={colors.textDisabled} />
                        </View>
                        <Text style={styles.emptyTitle}>No bookings yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Book your first service from the Home screen and track it here
                        </Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.surface,
    },
    header: {
        paddingTop: Platform.OS === 'ios' ? 56 : 44,
        paddingBottom: spacing.lg,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    headerTitle: {
        ...typography.h2,
        color: colors.textPrimary,
    },
    headerSub: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: spacing.xs,
    },
    sectionHeader: {
        ...typography.captionMedium,
        color: colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: spacing.xl,
        marginBottom: spacing.md,
    },
    listContent: {
        padding: spacing.xl,
        paddingBottom: 140, // Floating tab bar + safe area inset
    },
    emptyContainer: {
        alignItems: 'center',
        paddingTop: spacing['5xl'],
    },
    emptyIconWrap: {
        width: 80,
        height: 80,
        borderRadius: radii['2xl'],
        backgroundColor: colors.primarySurface,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    emptyTitle: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    emptySubtitle: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.sm,
        textAlign: 'center',
        paddingHorizontal: spacing['2xl'],
    },
});
