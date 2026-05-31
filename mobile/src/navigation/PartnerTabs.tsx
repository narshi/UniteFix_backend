/**
 * Partner Tab Navigator — 5-tab bottom navigation
 * Uses actual screen implementations
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, Clock, PlayCircle, Wallet, User } from 'lucide-react-native';
import { PartnerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';

import { IncomingServicesScreen } from '../screens/partner/IncomingServicesScreen';
import { PastServicesScreen } from '../screens/partner/PastServicesScreen';
import { WalletScreen } from '../screens/partner/WalletScreen';
import { PartnerProfileScreen } from '../screens/partner/PartnerProfileScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

import { Platform } from 'react-native';
import { radii, spacing, shadows } from '../theme/spacing';

const Tab = createBottomTabNavigator<PartnerTabParamList>();

export function PartnerTabs() {
    const insets = useSafeAreaInsets();
    const tabBarBottom = Platform.OS === 'ios' ? Math.max(insets.bottom, 12) : insets.bottom + 12;

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
                    left: spacing.base,
                    right: spacing.base,
                    backgroundColor: colors.background,
                    borderRadius: radii['2xl'],
                    height: 64,
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
                    tabBarLabel: 'Incoming',
                    tabBarIcon: ({ color, size }) => <Inbox size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="HistoryTab"
                component={PastServicesScreen}
                options={{
                    tabBarLabel: 'History',
                    tabBarIcon: ({ color, size }) => <Clock size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="StartTab"
                component={PlaceholderScreen}
                options={{
                    tabBarLabel: 'Start',
                    tabBarIcon: ({ color, size }) => <PlayCircle size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="WalletTab"
                component={WalletScreen}
                options={{
                    tabBarLabel: 'Payments',
                    tabBarIcon: ({ color, size }) => <Wallet size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="ProfileTab"
                component={PartnerProfileScreen}
                options={{
                    tabBarLabel: 'Profile',
                    tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
                }}
            />
        </Tab.Navigator>
    );
}
