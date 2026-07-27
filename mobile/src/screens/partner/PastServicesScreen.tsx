/**
 * Past Services Screen — Paginated completed/cancelled service history
 * 
 * Uses useInfiniteQuery for efficient loading of large history datasets.
 * Navigates to ServiceHistoryDetail for read-only detail view.
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
import { Calendar, ChevronRight, Star, Clock } from 'lucide-react-native';
import { useAssignmentHistory } from '../../hooks/usePartnerData';
import { Assignment } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { EmptyState } from '../../components/ui/EmptyState';
import { useScreenInsets } from '../../theme/layout';

function PastCard({ item, onPress }: { item: Assignment; onPress: () => void }) {
    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
    const isDone = item.status === 'completed';

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.cardLeft}>
                <View style={[styles.statusDot, { backgroundColor: isDone ? colors.success : colors.error }]} />
                <View style={{ flex: 1 }}>
                    <Text style={styles.serviceType}>{item.serviceType.replace(/_/g, ' ')}</Text>
                    <Text style={styles.customer}>
                        {item.customerName}{item.serviceId ? ` · ${item.serviceId}` : ''}
                    </Text>
                    <View style={styles.dateRow}>
                        <Calendar size={12} color={colors.textDisabled} />
                        <Text style={styles.dateText}>{date}</Text>
                    </View>
                </View>
            </View>
            <View style={styles.cardRight}>
                {item.totalCharge != null && item.totalCharge > 0 && (
                    <Text style={styles.charge}>₹{item.totalCharge}</Text>
                )}
                {item.rating != null && (
                    <View style={styles.ratingRow}>
                        <Star size={12} color="#FFD700" fill="#FFD700" />
                        <Text style={styles.ratingText}>{item.rating}</Text>
                    </View>
                )}
                <ChevronRight size={16} color={colors.textDisabled} />
            </View>
        </TouchableOpacity>
    );
}

export function PastServicesScreen() {
    const { headerTop, tabContent } = useScreenInsets();
    const {
        data: historyPages,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        refetch,
        isRefetching,
    } = useAssignmentHistory();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    // Flatten all pages into a single list
    const pastServices = historyPages?.pages?.flatMap((page: any) => page.data || []) || [];
    const totalCount = historyPages?.pages?.[0]?.pagination?.total || pastServices.length;

    const handleEndReached = () => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.headerTitle}>Past Services</Text>
                <Text style={styles.headerSub}>{totalCount} completed</Text>
            </View>

            <FlatList
                data={pastServices}
                renderItem={({ item }) => (
                    <PastCard
                        item={item}
                        onPress={() => navigation.navigate('ServiceHistoryDetail', { assignment: item })}
                    />
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={[styles.listContent, { paddingBottom: tabContent }]}
                showsVerticalScrollIndicator={false}
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.3}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews={true}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                ListFooterComponent={
                    isFetchingNextPage ? (
                        <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={colors.primary} />
                        </View>
                    ) : null
                }
                ListEmptyComponent={
                    <EmptyState
                        icon={<Clock size={36} color={colors.textDisabled} />}
                        title="No past services"
                        description="Completed and cancelled jobs will appear here."
                    />
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: { paddingBottom: spacing.lg, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
    listContent: { padding: spacing.xl },
    card: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
    },
    cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.md },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    serviceType: { ...typography.bodyMedium, color: colors.textPrimary, textTransform: 'capitalize' },
    customer: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
    dateText: { ...typography.small, color: colors.textDisabled },
    cardRight: { alignItems: 'flex-end', gap: spacing.xs },
    charge: { ...typography.bodyMedium, color: colors.success },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    ratingText: { ...typography.small, color: colors.textSecondary },
});
