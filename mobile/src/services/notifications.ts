/**
 * Push Notification Service — expo-notifications on top of native FCM.
 *
 * TOKEN TYPE — the thing that breaks silently if you get it wrong:
 * We register the NATIVE FCM token via `getDevicePushTokenAsync()`, NOT the
 * Expo push token from `getExpoPushTokenAsync()`. The backend sends through
 * firebase-admin (`messaging().sendEachForMulticast`), which only accepts FCM
 * registration tokens — an `ExponentPushToken[...]` is silently rejected for
 * every device. Using the device token also removes the dependency on an EAS
 * project id, which this app does not have a real one for.
 *
 * REQUIREMENTS on Android:
 *   - google-services.json present at build time (android/app/google-services.json)
 *   - com.google.gms.google-services gradle plugin applied
 *   - POST_NOTIFICATIONS permission (contributed by the expo-notifications manifest)
 *   - a DEVELOPMENT BUILD or release APK. Expo Go cannot receive remote pushes.
 *
 * The Android channel IDs created below MUST match CHANNEL_BY_TYPE in
 * server/services/notification.service.ts. A push naming a channel the device
 * has never created is dropped by Android without any error.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiClient } from '../api/client';

// Show notifications even while the app is foregrounded.
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

/** Keep in sync with the server's CHANNEL_BY_TYPE map. */
const ANDROID_CHANNELS: Array<{
    id: string;
    name: string;
    description?: string;
    importance: Notifications.AndroidImportance;
}> = [
        {
            id: 'default',
            name: 'General',
            description: 'Account and app notifications',
            importance: Notifications.AndroidImportance.HIGH,
        },
        {
            id: 'service-updates',
            name: 'Service Updates',
            description: 'Updates about your service requests',
            importance: Notifications.AndroidImportance.HIGH,
        },
        {
            id: 'assignments',
            name: 'Job Assignments',
            description: 'New jobs assigned to you',
            importance: Notifications.AndroidImportance.MAX,
        },
        {
            id: 'payments',
            name: 'Payments & Earnings',
            description: 'Bills, payments, wallet and withdrawals',
            importance: Notifications.AndroidImportance.HIGH,
        },
        {
            id: 'orders',
            name: 'Order Updates',
            description: 'Updates about your product orders',
            importance: Notifications.AndroidImportance.DEFAULT,
        },
        {
            id: 'marketing',
            name: 'Offers & Announcements',
            description: 'Promotions and news from UniteFix',
            importance: Notifications.AndroidImportance.DEFAULT,
        },
    ];

export class NotificationService {
    private static devicePushToken: string | null = null;

    /**
     * Ask for permission, create channels, and return the native FCM/APNS token.
     * Returns null (never throws) when push is unavailable — no permission,
     * simulator, or Expo Go.
     */
    static async registerForPushNotifications(): Promise<string | null> {
        // Expo Go cannot receive remote notifications since SDK 53. Bail early so
        // the failure reads as a clear warning rather than a token error.
        try {
            const Constants = require('expo-constants').default;
            if (Constants.executionEnvironment === 'storeClient') {
                console.warn(
                    '[Notifications] Expo Go cannot receive push notifications. Use a development build.'
                );
                return null;
            }
        } catch {
            // expo-constants unavailable — carry on and let the token call decide.
        }

        if (!Device.isDevice) {
            if (__DEV__) console.log('[Notifications] Push requires a physical device');
            return null;
        }

        // Channels must exist BEFORE the first notification arrives, and creating
        // them is also what makes them visible in Android system settings.
        if (Platform.OS === 'android') {
            for (const channel of ANDROID_CHANNELS) {
                await Notifications.setNotificationChannelAsync(channel.id, {
                    name: channel.name,
                    description: channel.description,
                    importance: channel.importance,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#4F46E5',
                    sound: 'default',
                });
            }
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }

        if (finalStatus !== 'granted') {
            console.warn('[Notifications] Permission denied — no push will be delivered');
            return null;
        }

        try {
            // Native FCM token on Android, APNS token on iOS.
            const tokenData = await Notifications.getDevicePushTokenAsync();
            this.devicePushToken = tokenData.data as string;
            if (__DEV__) {
                console.log(
                    `[Notifications] Device push token (${tokenData.type}):`,
                    `${this.devicePushToken.slice(0, 24)}…`
                );
            }
            return this.devicePushToken;
        } catch (error: any) {
            // The usual cause is a build without google-services.json, or Firebase
            // Cloud Messaging API (V1) not enabled on the project.
            console.error(
                '[Notifications] Could not get a device push token. Check that google-services.json ' +
                'is bundled and Firebase Cloud Messaging is enabled.',
                error?.message ?? error
            );
            return null;
        }
    }

    /** Send the token to the backend so it can be targeted. */
    static async registerTokenWithBackend(token: string): Promise<void> {
        try {
            await apiClient.post('/api/notifications/register-token', {
                token,
                platform: Platform.OS,
            });
            if (__DEV__) console.log('[Notifications] Token registered with backend');
        } catch (error: any) {
            console.error(
                '[Notifications] Failed to register token:',
                error?.response?.data?.message ?? error?.message ?? error
            );
        }
    }

    /**
     * Drop the token on logout so the next user of this device does not receive
     * the previous user's notifications.
     */
    static async unregisterToken(): Promise<void> {
        if (!this.devicePushToken) return;
        try {
            await apiClient.delete('/api/notifications/unregister-token', {
                data: { token: this.devicePushToken },
            });
        } catch (error) {
            // Best effort — the server prunes dead tokens on send anyway.
            if (__DEV__) console.warn('[Notifications] Failed to unregister token:', error);
        } finally {
            this.devicePushToken = null;
        }
    }

    /** Full registration flow — call once the user is authenticated. */
    static async initialize(): Promise<void> {
        const token = await this.registerForPushNotifications();
        if (token) {
            await this.registerTokenWithBackend(token);
        }
    }

    /**
     * Map a notification's `data.type` to a screen.
     *
     * `stack` says which navigator the screen lives in, because the root
     * navigator cannot reach a nested screen by bare name — the caller has to
     * navigate to the stack first and pass the screen through.
     */
    static getNavigationRoute(notification: Notifications.Notification): {
        stack: 'CustomerMain' | 'EmployeeMain';
        screen: string;
        params?: Record<string, any>;
        /**
         * True when the type was not recognised and this is only the catch-all
         * destination, not somewhere the notification actually points. A cold
         * start must not follow these — see RootNavigator.
         */
        generic?: boolean;
    } | null {
        const data = notification.request.content.data as Record<string, any> | undefined;
        if (!data) return null;

        // A notification carrying an explicit `url` (marketing campaigns with a
        // deep link) is handled by the linking config in navigation/linking.ts.
        // Returning null here keeps exactly one handler per tap.
        if (typeof data.url === 'string' && data.url) return null;

        const type = String(data.type ?? '');
        // FCM stringifies every data value, so `serviceId` arrives as "42".
        const serviceId = data.serviceId != null ? Number(data.serviceId) : undefined;
        const isExpert = data.role === 'expert';

        switch (type) {
            // ── Customer: booking lifecycle ────────────────────────────
            case 'service_created':
            case 'service_assigned':
            case 'service_accepted':
            case 'service_started':
            case 'service_cancelled':
            case 'service_disputed':
                return { stack: 'CustomerMain', screen: 'RequestDetail', params: { id: serviceId } };

            case 'service_reached':
                // The customer has to read the handshake OTP out loud — send them
                // straight to the screen that shows it.
                return { stack: 'CustomerMain', screen: 'OtpDisplay', params: { serviceId } };

            case 'service_bill_ready':
                return { stack: 'CustomerMain', screen: 'FinalPayment', params: { serviceId } };

            case 'service_completed':
                return { stack: 'CustomerMain', screen: 'RequestDetail', params: { id: serviceId } };

            // ── Service expert: assignments ────────────────────────────
            case 'assignment_new':
            case 'assignment_reassigned':
            case 'assignment_reminder':
                return { stack: 'EmployeeMain', screen: 'AssignmentDetail', params: { id: serviceId } };

            case 'assignment_cancelled':
                return { stack: 'EmployeeMain', screen: 'PartnerTabs', params: { screen: 'IncomingTab' } };

            // ── Money ─────────────────────────────────────────────────
            case 'wallet_credited':
            case 'wallet_released':
            case 'withdrawal_approved':
            case 'withdrawal_rejected':
                return { stack: 'EmployeeMain', screen: 'PartnerTabs', params: { screen: 'WalletTab' } };

            case 'payment_received':
            case 'payment_failed':
                return isExpert
                    ? { stack: 'EmployeeMain', screen: 'PartnerTabs', params: { screen: 'WalletTab' } }
                    : { stack: 'CustomerMain', screen: 'RequestDetail', params: { id: serviceId } };

            // ── Account / everything else ─────────────────────────────
            case 'verification_approved':
            case 'verification_rejected':
                return { stack: 'EmployeeMain', screen: 'PartnerTabs', params: { screen: 'ProfileTab' } };

            case 'order_update':
                return { stack: 'CustomerMain', screen: 'OrderDetail', params: { id: serviceId } };

            default:
                // Marketing and system notifications have nowhere specific to go.
                // Flagged generic so a cold-start replay ignores it: following
                // this on every launch is what dumped customers on the
                // notifications screen instead of home.
                return isExpert
                    ? { stack: 'EmployeeMain', screen: 'PartnerTabs', params: { screen: 'ProfileTab' }, generic: true }
                    : { stack: 'CustomerMain', screen: 'Notifications', generic: true };
        }
    }

    /** Last notification response — used for cold-start deep linking. */
    static async getLastNotificationResponse() {
        return Notifications.getLastNotificationResponseAsync();
    }

    static async setBadgeCount(count: number): Promise<void> {
        try {
            await Notifications.setBadgeCountAsync(count);
        } catch {
            // Badge counts are unsupported on some Android launchers.
        }
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
