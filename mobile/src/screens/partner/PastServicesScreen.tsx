/**
 * Past Services Screen — Completed/cancelled service history
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
import { useAssignments } from '../../hooks/usePartnerData';
import { Assignment } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';

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
                    <Text style={styles.customer}>{item.customerName}</Text>
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
    const { data: assignments, isLoading, refetch, isRefetching } = useAssignments();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    const pastServices = (assignments || []).filter(
        (a) => ['completed', 'cancelled', 'denied'].includes(a.status)
    );

    if (isLoading) {
        return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Past Services</Text>
                <Text style={styles.headerSub}>{pastServices.length} completed</Text>
            </View>

            <FlatList
                data={pastServices}
                renderItem={({ item }) => (
                    <PastCard item={item} onPress={() => navigation.navigate('AssignmentDetail', { assignment: item })} />
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Clock size={48} color={colors.textDisabled} />
                        <Text style={styles.emptyTitle}>No past services</Text>
                        <Text style={styles.emptySubtitle}>Completed jobs will appear here</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    header: {
        paddingTop: 54, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl,
        backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    headerTitle: { ...typography.h2, color: colors.textPrimary },
    headerSub: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
    listContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    card: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: colors.background, borderRadius: radii.lg,
        padding: spacing.lg, marginBottom: spacing.sm, ...shadows.sm,
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
    emptyContainer: { alignItems: 'center', paddingTop: spacing['4xl'] },
    emptyTitle: { ...typography.h4, color: colors.textSecondary, marginTop: spacing.lg },
    emptySubtitle: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm },
});
