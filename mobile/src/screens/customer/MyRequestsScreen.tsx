/**
 * My Service Requests — List of user's service bookings with status badges
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight, Calendar, AlertCircle } from 'lucide-react-native';
import { useServiceRequests } from '../../hooks/useCustomerData';
import { ServiceRequest } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ListItemSkeleton } from '../../components/Skeleton';

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: colors.warningLight, text: colors.warning, label: 'Pending' },
    assigned: { bg: colors.infoLight, text: colors.info, label: 'Assigned' },
    in_progress: { bg: colors.primarySurface, text: colors.primary, label: 'In Progress' },
    completed: { bg: colors.successLight, text: colors.success, label: 'Completed' },
    cancelled: { bg: colors.errorLight, text: colors.error, label: 'Cancelled' },
};

function StatusBadge({ status }: { status: string }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    return (
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
            <Text style={[styles.badgeText, { color: config.text }]}>{config.label}</Text>
        </View>
    );
}

function RequestCard({ item, onPress }: { item: ServiceRequest; onPress: () => void }) {
    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
                <Text style={styles.serviceType}>{item.serviceType.replace(/_/g, ' ')}</Text>
                <StatusBadge status={item.status} />
            </View>
            <Text style={styles.description} numberOfLines={2}>{item.description}</Text>
            <View style={styles.cardFooter}>
                <View style={styles.dateRow}>
                    <Calendar size={14} color={colors.textSecondary} />
                    <Text style={styles.dateText}>{date}</Text>
                </View>
                <ChevronRight size={18} color={colors.textSecondary} />
            </View>
        </TouchableOpacity>
    );
}

export function MyRequestsScreen() {
    const { data: requests, isLoading, refetch, isRefetching } = useServiceRequests();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const handlePress = (item: ServiceRequest) => {
        navigation.navigate('RequestDetail', { request: item });
    };


    if (isLoading) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>My Bookings</Text>
                    <ListItemSkeleton />
                </View>
                <View style={{ padding: spacing.xl }}>
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                    <ListItemSkeleton />
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
                    {requests?.length || 0} request{(requests?.length || 0) !== 1 ? 's' : ''}
                </Text>
            </View>

            <FlatList
                data={requests || []}
                renderItem={({ item }) => <RequestCard item={item} onPress={() => handlePress(item)} />}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        colors={[colors.primary]}
                    />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <AlertCircle size={48} color={colors.textDisabled} />
                        <Text style={styles.emptyTitle}>No bookings yet</Text>
                        <Text style={styles.emptySubtitle}>
                            Book your first service from the Home screen
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
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.surface,
    },
    header: {
        paddingTop: 54,
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
    listContent: {
        padding: spacing.xl,
        paddingBottom: spacing['3xl'],
    },
    card: {
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        padding: spacing.lg,
        marginBottom: spacing.md,
        ...shadows.sm,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.sm,
    },
    serviceType: {
        ...typography.bodyMedium,
        color: colors.textPrimary,
        textTransform: 'capitalize',
    },
    badge: {
        paddingVertical: 3,
        paddingHorizontal: spacing.sm,
        borderRadius: radii.full,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
    },
    description: {
        ...typography.caption,
        color: colors.textSecondary,
        marginBottom: spacing.md,
    },
    cardFooter: {
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
    emptyContainer: {
        alignItems: 'center',
        paddingTop: spacing['4xl'],
    },
    emptyTitle: {
        ...typography.h4,
        color: colors.textSecondary,
        marginTop: spacing.lg,
    },
    emptySubtitle: {
        ...typography.caption,
        color: colors.textDisabled,
        marginTop: spacing.sm,
        textAlign: 'center',
    },
});
