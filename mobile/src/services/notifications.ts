/**
 * Push Notification Service — Expo Notifications + FCM
 * Handles: permission, token registration, notification handlers, deep linking
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiClient } from '../api/client';

// Configure notification behavior (show even when app is foregrounded)
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

export class NotificationService {
    private static expoPushToken: string | null = null;

    /**
     * Register for push notifications and get the device token
     */
    static async registerForPushNotifications(): Promise<string | null> {
        if (!Device.isDevice) {
            console.log('[Notifications] Must use physical device for push notifications');
            return null;
        }

        // Check / request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.log('[Notifications] Permission not granted');
            return null;
        }

        // Android notification channel
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'Default',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#2196F3',
            });

            await Notifications.setNotificationChannelAsync('service-updates', {
                name: 'Service Updates',
                description: 'Updates about your service requests',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#4CAF50',
            });

            await Notifications.setNotificationChannelAsync('orders', {
                name: 'Order Updates',
                description: 'Updates about your product orders',
                importance: Notifications.AndroidImportance.DEFAULT,
            });
        }

        // Get Expo push token
        try {
            const tokenData = await Notifications.getExpoPushTokenAsync({
                projectId: undefined, // Will use project ID from app.json
            });
            this.expoPushToken = tokenData.data;
            return tokenData.data;
        } catch (error) {
            console.error('[Notifications] Failed to get push token:', error);
            return null;
        }
    }

    /**
     * Register the device token with the backend
     */
    static async registerTokenWithBackend(token: string): Promise<void> {
        try {
            await apiClient.post('/api/notifications/register-token', {
                token,
                platform: Platform.OS,
            });
            console.log('[Notifications] Token registered with backend');
        } catch (error) {
            console.error('[Notifications] Failed to register token:', error);
        }
    }

    /**
     * Unregister the device token (on logout)
     */
    static async unregisterToken(): Promise<void> {
        if (!this.expoPushToken) return;
        try {
            await apiClient.delete('/api/notifications/unregister-token', {
                data: { token: this.expoPushToken },
            });
            this.expoPushToken = null;
        } catch (error) {
            console.error('[Notifications] Failed to unregister token:', error);
        }
    }

    /**
     * Full registration flow — call after login
     */
    static async initialize(): Promise<void> {
        const token = await this.registerForPushNotifications();
        if (token) {
            await this.registerTokenWithBackend(token);
        }
    }

    /**
     * Parse notification data into a navigation route
     */
    static getNavigationRoute(notification: Notifications.Notification): {
        screen: string;
        params?: Record<string, any>;
    } | null {
        const data = notification.request.content.data;
        if (!data) return null;

        const type = data.type as string;
        const id = data.id as number;

        switch (type) {
            case 'service_update':
            case 'service_assigned':
            case 'service_completed':
                return { screen: 'RequestDetail', params: { id } };
            case 'assignment_new':
            case 'assignment_update':
                return { screen: 'AssignmentDetail', params: { id } };
            case 'order_update':
            case 'order_shipped':
            case 'order_delivered':
                return { screen: 'OrderDetail', params: { id } };
            case 'payment_received':
                return { screen: 'WalletTab' };
            default:
                return { screen: 'Notifications' };
        }
    }

    /**
     * Get the last notification response (for cold-start deep linking)
     */
    static async getLastNotificationResponse() {
        return Notifications.getLastNotificationResponseAsync();
    }

    /**
     * Set badge count
     */
    static async setBadgeCount(count: number): Promise<void> {
        await Notifications.setBadgeCountAsync(count);
    }
}

/**
 * Hook listeners — add to your root component
 */
export function addNotificationReceivedListener(
    handler: (notification: Notifications.Notification) => void
) {
    return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(
    handler: (response: Notifications.NotificationResponse) => void
) {
    return Notifications.addNotificationResponseReceivedListener(handler);
}
