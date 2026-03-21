/**
 * Partner Tab Navigator — 5-tab bottom navigation
 * Uses actual screen implementations
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Inbox, Clock, PlayCircle, Wallet, User } from 'lucide-react-native';
import { PartnerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';

import { IncomingServicesScreen } from '../screens/partner/IncomingServicesScreen';
import { PastServicesScreen } from '../screens/partner/PastServicesScreen';
import { WalletScreen } from '../screens/partner/WalletScreen';
import { PartnerProfileScreen } from '../screens/partner/PartnerProfileScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

const Tab = createBottomTabNavigator<PartnerTabParamList>();

export function PartnerTabs() {
    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: colors.primary,
                tabBarInactiveTintColor: colors.textSecondary,
                tabBarStyle: {
                    backgroundColor: colors.background,
                    borderTopColor: colors.divider,
                    paddingBottom: 4,
                    height: 56,
                },
                tabBarLabelStyle: {
                    fontSize: 11,
                    fontWeight: '500',
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
