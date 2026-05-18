/**
 * Incoming Services Screen — Partner sees assigned jobs
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
import { MapPin, Calendar, ChevronRight, Inbox } from 'lucide-react-native';
import { useAssignments } from '../../hooks/usePartnerData';
import { Assignment } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { EmptyState } from '../../components/ui/EmptyState';

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: colors.warningLight, text: colors.warning, label: 'Pending' },
    assigned: { bg: colors.infoLight, text: colors.info, label: 'New' },
    accepted: { bg: colors.primarySurface, text: colors.primary, label: 'Accepted' },
    in_progress: { bg: colors.primarySurface, text: colors.primary, label: 'In Progress' },
    completed: { bg: colors.successLight, text: colors.success, label: 'Completed' },
    cancelled: { bg: colors.errorLight, text: colors.error, label: 'Cancelled' },
    denied: { bg: colors.errorLight, text: colors.error, label: 'Denied' },
};

function AssignmentCard({ item, onPress }: { item: Assignment; onPress: () => void }) {
    const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const date = new Date(item.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
                <Text style={styles.serviceType}>{item.serviceType.replace(/_/g, ' ')}</Text>
                <View style={[styles.badge, { backgroundColor: config.bg }]}>
                    <Text style={[styles.badgeText, { color: config.text }]}>{config.label}</Text>
                </View>
            </View>

            <Text style={styles.description} numberOfLines={2}>{item.description}</Text>

            <View style={styles.infoRow}>
                <MapPin size={13} color={colors.textSecondary} />
                <Text style={styles.infoText} numberOfLines={1}>{item.address}</Text>
            </View>
            <View style={styles.cardFooter}>
                <View style={styles.infoRow}>
                    <Calendar size={13} color={colors.textSecondary} />
                    <Text style={styles.infoText}>{date}</Text>
                </View>
                <ChevronRight size={18} color={colors.textSecondary} />
            </View>
        </TouchableOpacity>
    );
}

export function IncomingServicesScreen() {
    const { data: assignments, isLoading, refetch, isRefetching } = useAssignments();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    // Show incoming (non-completed, non-denied) first
    const incoming = (assignments || []).filter(
        (a) => !['completed', 'cancelled', 'denied'].includes(a.status)
    );

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Incoming Services</Text>
                <Text style={styles.headerSub}>
                    {incoming.length} active assignment{incoming.length !== 1 ? 's' : ''}
                </Text>
            </View>

            <FlatList
                data={incoming}
                renderItem={({ item }) => (
                    <AssignmentCard
                        item={item}
                        onPress={() => navigation.navigate('AssignmentDetail', { assignment: item })}
                    />
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />
                }
                ListEmptyComponent={
                    <EmptyState
                        icon={<Inbox size={36} color={colors.textDisabled} />}
                        title="No incoming jobs"
                        description="New service assignments will appear here. Stay ready!"
                    />
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
    listContent: { padding: spacing.xl, paddingBottom: 100 },
    card: {
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.md,
        borderWidth: 1, borderColor: colors.border,
    },
    cardHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm,
    },
    serviceType: { ...typography.bodyMedium, color: colors.textPrimary, textTransform: 'capitalize' },
    badge: { paddingVertical: 3, paddingHorizontal: spacing.sm, borderRadius: radii.full },
    badgeText: { fontSize: 11, fontWeight: '600' },
    description: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.md },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
    infoText: { ...typography.small, color: colors.textSecondary, flex: 1 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
