/**
 * Notifications Screen — List of user notifications
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowLeft, Bell, BellOff, Package, Wrench, CreditCard, Info } from 'lucide-react-native';
import { useNotifications } from '../../hooks/useCustomerData';
import { Notification } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { EmptyState } from '../../components/ui/EmptyState';

type Props = NativeStackScreenProps<any, 'Notifications'>;

function getNotificationIcon(type: string) {
    switch (type) {
        case 'service': return Wrench;
        case 'order': return Package;
        case 'payment': return CreditCard;
        default: return Info;
    }
}

function NotificationItem({ item }: { item: Notification }) {
    const Icon = getNotificationIcon(item.type);
    const timeAgo = getTimeAgo(item.createdAt);

    return (
        <View style={[styles.notifItem, !item.isRead && styles.notifUnread]}>
            <View style={[styles.notifIcon, !item.isRead && styles.notifIconUnread]}>
                <Icon size={18} color={!item.isRead ? colors.primary : colors.textSecondary} />
            </View>
            <View style={styles.notifContent}>
                <Text style={[styles.notifTitle, !item.isRead && styles.notifTitleUnread]}>
                    {item.title}
                </Text>
                <Text style={styles.notifMessage} numberOfLines={2}>
                    {item.message}
                </Text>
                <Text style={styles.notifTime}>{timeAgo}</Text>
            </View>
            {!item.isRead && <View style={styles.unreadDot} />}
        </View>
    );
}

function getTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function NotificationsScreen({ navigation }: Props) {
    const { data: notifications, isLoading, refetch, isRefetching } = useNotifications();

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ScreenHeader title="Notifications" onBack={() => navigation.goBack()} />

            <FlatList
                data={notifications || []}
                renderItem={({ item }) => <NotificationItem item={item} />}
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
                    <EmptyState
                        icon={<BellOff size={36} color={colors.textDisabled} />}
                        title="No notifications yet"
                        description="We'll notify you about service updates, offers, and important alerts."
                    />
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
    listContent: { padding: spacing.xl, paddingBottom: spacing['3xl'] },
    notifItem: {
        flexDirection: 'row', alignItems: 'flex-start',
        backgroundColor: colors.background, borderRadius: radii.xl,
        padding: spacing.lg, marginBottom: spacing.sm,
        borderWidth: 1, borderColor: colors.border,
    },
    notifUnread: {
        backgroundColor: colors.primarySurface,
        borderColor: colors.primary + '20',
    },
    notifIcon: {
        width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
        justifyContent: 'center', alignItems: 'center', marginRight: spacing.md,
    },
    notifIconUnread: { backgroundColor: colors.primarySurface },
    notifContent: { flex: 1 },
    notifTitle: { ...typography.bodyMedium, color: colors.textPrimary, marginBottom: 2 },
    notifTitleUnread: { fontWeight: '700' },
    notifMessage: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    notifTime: { ...typography.small, color: colors.textDisabled },
    unreadDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: colors.primary, marginTop: spacing.sm,
    },
});

