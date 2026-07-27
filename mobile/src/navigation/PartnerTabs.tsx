/**
 * Partner Tab Navigator — 5-tab bottom navigation
 * Uses actual screen implementations
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, Clock, Wallet, User } from 'lucide-react-native';
import { PartnerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';

import { IncomingServicesScreen } from '../screens/partner/IncomingServicesScreen';
import { PastServicesScreen } from '../screens/partner/PastServicesScreen';
import { WalletScreen } from '../screens/partner/WalletScreen';
import { PartnerProfileScreen } from '../screens/partner/PartnerProfileScreen';

import { Platform } from 'react-native';
import { radii, spacing, shadows } from '../theme/spacing';
import { TAB_BAR_HEIGHT, TAB_BAR_GAP } from '../theme/layout';
import { useTranslation } from 'react-i18next';

const Tab = createBottomTabNavigator<PartnerTabParamList>();

export function PartnerTabs() {
    const insets = useSafeAreaInsets();
    const { t } = useTranslation();
    const tabBarBottom = Platform.OS === 'ios' ? Math.max(insets.bottom, TAB_BAR_GAP) : insets.bottom + TAB_BAR_GAP;

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarHideOnKeyboard: true,
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textDisabled,
                tabBarStyle: {
                    position: 'absolute',
                    bottom: tabBarBottom,
                    left: spacing.xl,
                    right: spacing.xl,
                    backgroundColor: colors.background,
                    borderRadius: radii['2xl'],
                    height: TAB_BAR_HEIGHT,
                    paddingBottom: 0,
                    borderTopWidth: 0,
                    ...shadows.lg,
                    borderWidth: 1,
                    borderColor: colors.divider,
                },
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '600',
                    letterSpacing: 0.3,
                    marginBottom: Platform.OS === 'ios' ? 0 : 8,
                },
                tabBarItemStyle: {
                    paddingTop: 6,
                },
            }}
        >
            <Tab.Screen
                name="IncomingTab"
                component={IncomingServicesScreen}
                options={{
                    tabBarLabel: t('tabs.incoming', 'Incoming'),
                    tabBarIcon: ({ color, size }) => <Inbox size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="HistoryTab"
                component={PastServicesScreen}
                options={{
                    tabBarLabel: t('tabs.history', 'History'),
                    tabBarIcon: ({ color, size }) => <Clock size={size} color={color} />,
                }}
            />
            {/* The "Start" tab rendered a 🚧 placeholder in production. Starting a
                job is done from AssignmentDetail → StartService, so the dead tab
                was removed rather than shipping a construction screen. */}
            <Tab.Screen
                name="WalletTab"
                component={WalletScreen}
                options={{
                    tabBarLabel: t('tabs.wallet', 'Wallet'),
                    tabBarIcon: ({ color, size }) => <Wallet size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="ProfileTab"
                component={PartnerProfileScreen}
                options={{
                    tabBarLabel: t('tabs.profile', 'Profile'),
                    tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
                }}
            />
        </Tab.Navigator>
    );
}
