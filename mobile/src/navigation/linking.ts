/**
 * Deep Linking Configuration — Maps URLs to screens.
 *
 * IMPORTANT: the top-level keys below must be the screen names RootNavigator
 * actually renders — 'Auth', 'Onboarding', 'CustomerMain', 'EmployeeMain'. They
 * previously read 'AuthStack' / 'CustomerStack' / 'PartnerStack', which match no
 * registered route, so every deep link and every notification `url` resolved to
 * nothing.
 *
 * Notification TAPS without a `url` are handled by RootNavigator; this file only
 * handles OS deep links and notifications that carry an explicit `url` (admin
 * marketing campaigns). See NotificationService.getNavigationRoute.
 */

import { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

const prefix = Linking.createURL('/');

export const linkingConfig: LinkingOptions<any> = {
    prefixes: [prefix, 'unitefix://'],
    config: {
        screens: {
            Auth: {
                screens: {
                    Login: 'login',
                    Signup: 'signup',
                    ForgotPassword: 'forgot-password',
                    OTPVerification: 'otp-verify',
                    ResetPassword: 'reset-password/:token',
                },
            },
            CustomerMain: {
                screens: {
                    CustomerTabs: {
                        screens: {
                            HomeTab: 'home',
                            BookingsTab: 'bookings',
                            ShopTab: 'shop',
                            OrdersTab: 'orders',
                            ProfileTab: 'profile',
                        },
                    },
                    ServiceRequest: 'service/new',
                    RequestDetail: 'service/:id',
                    OtpDisplay: 'service/:serviceId/otp',
                    FinalPayment: 'service/:serviceId/pay',
                    Notifications: 'notifications',
                    ProductDetail: 'product/:id',
                    Cart: 'cart',
                    Checkout: 'checkout',
                    OrderDetail: 'order/:id',
                    SupportTicket: 'support',
                },
            },
            EmployeeMain: {
                screens: {
                    PartnerTabs: {
                        screens: {
                            IncomingTab: 'partner/incoming',
                            HistoryTab: 'partner/history',
                            StartTab: 'partner/start',
                            WalletTab: 'partner/wallet',
                            ProfileTab: 'partner/profile',
                        },
                    },
                    AssignmentDetail: 'partner/assignment/:id',
                    StartService: 'partner/service/:serviceId/start',
                    InvoiceView: 'partner/invoice/:serviceId',
                    Notifications: 'partner/notifications',
                },
            },
        },
    },

    async getInitialURL() {
        // Check if the app was opened via a deep link
        const url = await Linking.getInitialURL();
        if (url != null) return url;

        // Check if a push notification launched the app
        const response = await Notifications.getLastNotificationResponseAsync();
        if (response?.notification.request.content.data?.url) {
            return response.notification.request.content.data.url as string;
        }

        return null;
    },

    subscribe(listener: (url: string) => void) {
        // Listen for deep links
        const linkingSubscription = Linking.addEventListener('url', ({ url }) => listener(url));

        // Listen for push notification taps
        const notificationSubscription = Notifications.addNotificationResponseReceivedListener(
            (response) => {
                const url = response.notification.request.content.data?.url;
                if (url && typeof url === 'string') {
                    listener(url);
                }
            }
        );

        return () => {
            linkingSubscription.remove();
            notificationSubscription.remove();
        };
    },
};
