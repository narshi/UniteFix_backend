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
import { MapPin, Calendar, ChevronRight, Inbox, WifiOff } from 'lucide-react-native';
import { useAssignments } from '../../hooks/usePartnerData';
import { Assignment } from '../../api/partner.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { EmptyState } from '../../components/ui/EmptyState';
import { useTranslation } from 'react-i18next';
import { useScreenInsets } from '../../theme/layout';

export function getStatusConfig(t: any) {
    return {
        pending: { bg: colors.warningLight, text: colors.warning, label: t('partner.status_pending') },
        assigned: { bg: colors.infoLight, text: colors.info, label: t('partner.status_new') },
        accepted: { bg: colors.primarySurface, text: colors.primary, label: t('partner.status_accepted') },
        reached: { bg: colors.primarySurface, text: colors.primary, label: 'Arrived' },
        in_progress: { bg: colors.primarySurface, text: colors.primary, label: t('partner.status_in_progress') },
        pending_payment: { bg: colors.warningLight, text: colors.warning, label: 'Awaiting Payment' },
        completed: { bg: colors.successLight, text: colors.success, label: t('partner.status_completed') },
        cancelled: { bg: colors.errorLight, text: colors.error, label: t('partner.status_cancelled') },
        denied: { bg: colors.errorLight, text: colors.error, label: t('partner.status_denied') },
    };
}

function AssignmentCard({ item, onPress, t }: { item: Assignment; onPress: () => void, t: any }) {
    const config = getStatusConfig(t)[item.status as keyof ReturnType<typeof getStatusConfig>] || getStatusConfig(t).pending;
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

            {(item as any).pricingSnapshot?.snapshotVersion === 2 && Number((item as any).pricingSnapshot?.technicianEarning) > 0 && (
                <Text style={styles.earnText}>You'll earn ₹{Number((item as any).pricingSnapshot.technicianEarning).toFixed(2)}</Text>
            )}

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
    const { headerTop, tabContent } = useScreenInsets();
    const { t } = useTranslation();
    const { data: assignments, isLoading, isError, refetch, isRefetching } = useAssignments();
    const navigation = useNavigation<NativeStackNavigationProp<any>>();

    // Show incoming (non-completed, non-denied) first
    const incoming = (assignments || []).filter(
        (a: Assignment) => !['completed', 'cancelled', 'denied'].includes(a.status)
    );

    // Header stays mounted while loading so the screen doesn't flash between
    // a bare spinner and the full layout.
    const renderBody = () => {
        if (isLoading) {
            return (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            );
        }

        // Without this branch a failed request fell through to the empty state,
        // telling partners they had no jobs when the request had actually failed.
        if (isError) {
            return (
                <View style={styles.center}>
                    <EmptyState
                        icon={<WifiOff size={36} color={colors.error} />}
                        title={t('common.something_went_wrong', 'Could not load assignments')}
                        description={t(
                            'common.check_connection',
                            'Check your internet connection and try again.',
                        )}
                        actionLabel={t('common.retry', 'Retry')}
                        onAction={() => refetch()}
                    />
                </View>
            );
        }

        return (
            <FlatList
                data={incoming}
                renderItem={({ item }) => (
                    <AssignmentCard
                        item={item}
                        onPress={() => navigation.navigate('AssignmentDetail', { assignment: item })}
                        t={t}
                    />
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={[styles.listContent, { paddingBottom: tabContent }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefetching} onRefresh={refetch} colors={[colors.primary]} />
                }
                ListEmptyComponent={
                    <EmptyState
                        icon={<Inbox size={36} color={colors.textDisabled} />}
                        title={t('partner.no_incoming')}
                        description={t('partner.no_incoming_desc')}
                    />
                }
            />
        );
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, { paddingTop: headerTop }]}>
                <Text style={styles.headerTitle}>{t('partner.incoming_services')}</Text>
                <Text style={styles.headerSub}>
                    {isError
                        ? t('common.unavailable', 'Unavailable')
                        : `${incoming.length} ${incoming.length === 1 ? t('partner.active_assignment') : t('partner.active_assignments')}`}
                </Text>
            </View>

            {renderBody()}
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
    earnText: { ...typography.bodyMedium, color: colors.success, marginBottom: spacing.md },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
    infoText: { ...typography.small, color: colors.textSecondary, flex: 1 },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
