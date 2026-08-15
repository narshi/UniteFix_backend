/**
 * Notifications Screen — in-app notification feed.
 *
 * Shared by both roles: the customer stack and the partner stack both register
 * it, because a service expert needs the same durable record of assignments,
 * wallet credits and verification decisions that a customer gets for bookings.
 *
 * The feed is the fallback for every push that never arrived — the device had no
 * token yet, notifications were muted, or the app was reinstalled. So it reads
 * from the database, not from the notification tray.
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
import {
    BellOff,
    Package,
    Wrench,
    CreditCard,
    Info,
    Briefcase,
    ShieldCheck,
    Megaphone,
} from 'lucide-react-native';
import {
    useNotifications,
    useMarkNotificationRead,
    useMarkAllNotificationsRead,
} from '../../hooks/useCustomerData';
import { Notification } from '../../api/customer.api';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { EmptyState } from '../../components/ui/EmptyState';

type Props = NativeStackScreenProps<any, 'Notifications'>;

/**
 * Icon per notification type. Prefix-matched so a new backend type lands in a
 * sensible bucket instead of falling through to the generic info icon.
 */
function getNotificationIcon(type: string) {
    if (type.startsWith('assignment')) return Briefcase;
    if (type.startsWith('service')) return Wrench;
    if (type.startsWith('payment') || type.startsWith('wallet') || type.startsWith('withdrawal')) {
        return CreditCard;
    }
    if (type.startsWith('verification') || type.startsWith('account')) return ShieldCheck;
    if (type.startsWith('order')) return Package;
    if (type === 'marketing') return Megaphone;
    return Info;
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

function NotificationItem({
    item,
    onPress,
}: {
    item: Notification;
    onPress: (item: Notification) => void;
}) {
    const Icon = getNotificationIcon(item.type ?? '');
    const timeAgo = getTimeAgo(item.createdAt);
    // The column is `body`; `message` only exists on legacy server responses.
    const message = item.body ?? item.message ?? '';

    return (
        <TouchableOpacity
            style={[styles.notifItem, !item.isRead && styles.notifUnread]}
            onPress={() => onPress(item)}
            activeOpacity={0.7}
        >
            <View style={[styles.notifIcon, !item.isRead && styles.notifIconUnread]}>
                <Icon size={18} color={!item.isRead ? colors.primary : colors.textSecondary} />
            </View>
            <View style={styles.notifContent}>
                <Text style={[styles.notifTitle, !item.isRead && styles.notifTitleUnread]}>
                    {item.title}
                </Text>
                <Text style={styles.notifMessage}>{message}</Text>
                <Text style={styles.notifTime}>{timeAgo}</Text>
            </View>
            {!item.isRead && <View style={styles.unreadDot} />}
        </TouchableOpacity>
    );
}

export function NotificationsScreen({ navigation }: Props) {
    const { data: notifications, isLoading, refetch, isRefetching } = useNotifications();
    const markRead = useMarkNotificationRead();
    const markAllRead = useMarkAllNotificationsRead();

    const unreadCount = (notifications ?? []).filter((n: Notification) => !n.isRead).length;

    const handlePress = (item: Notification) => {
        if (!item.isRead) markRead.mutate(item.id);

        // Notifications store their deep-link target in `data`. FCM stringifies
        // every value, so serviceId can arrive as "42".
        const data = item.data ?? {};
        const serviceId = data.serviceId != null ? Number(data.serviceId) : undefined;
        if (!serviceId) return;

        const type = String(item.type ?? '');
        if (type.startsWith('assignment')) {
            navigation.navigate('AssignmentDetail', { id: serviceId });
        } else if (type === 'service_bill_ready') {
            navigation.navigate('FinalPayment', { serviceId });
        } else if (type === 'service_reached') {
            navigation.navigate('OtpDisplay', { serviceId });
        } else if (type.startsWith('service')) {
            navigation.navigate('RequestDetail', { id: serviceId });
        }
    };

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

            {unreadCount > 0 && (
                <TouchableOpacity
                    style={styles.markAllBar}
                    onPress={() => markAllRead.mutate()}
                    disabled={markAllRead.isPending}
                >
                    <Text style={styles.markAllText}>
                        {unreadCount} unread · Mark all as read
                    </Text>
                </TouchableOpacity>
            )}

            <FlatList
                data={notifications || []}
                renderItem={({ item }) => <NotificationItem item={item} onPress={handlePress} />}
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
    markAllBar: {
        paddingHorizontal: spacing.xl,
        paddingVertical: spacing.sm,
        backgroundColor: colors.primarySurface,
    },
    markAllText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
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
