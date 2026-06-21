/**
 * Customer Tab Navigator — Premium floating tab bar
 * 
 * Features:
 * - Floating pill-style tab bar with shadow
 * - Active indicator dot
 * - Animated icon scaling
 * - Coming Soon badge on Shop
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home, ClipboardList, ShoppingBag, User } from 'lucide-react-native';
import { CustomerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';
import { radii, spacing, shadows } from '../theme/spacing';

import { HomeScreen } from '../screens/customer/HomeScreen';
import { MyRequestsScreen } from '../screens/customer/MyRequestsScreen';
import { ProfileScreen } from '../screens/customer/ProfileScreen';
import { ShopScreen } from '../screens/shop/ShopScreen';
import { useTranslation } from 'react-i18next';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

function TabIcon({ icon: Icon, color, focused }: { icon: any; color: string; focused: boolean }) {
    return (
        <View style={[tabIconStyles.wrap, focused && tabIconStyles.active]}>
            <Icon size={focused ? 22 : 20} color={color} strokeWidth={focused ? 2.5 : 2} />
            {focused && <View style={tabIconStyles.dot} />}
        </View>
    );
}

const tabIconStyles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 4,
    },
    active: {},
    dot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.primary,
        marginTop: 3,
    },
});

export function CustomerTabs() {
    const insets = useSafeAreaInsets();
    const { t } = useTranslation();
    // On Android, use the actual system nav bar inset + visual margin;
    // on iOS, the safe area inset already accounts for the home indicator.
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
                    left: spacing.xl,
                    right: spacing.xl,
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
                name="HomeTab"
                component={HomeScreen}
                options={{
                    tabBarLabel: t('tabs.home', 'Home'),
                    tabBarIcon: ({ color, focused }) => (
                        <TabIcon icon={Home} color={color} focused={focused} />
                    ),
                }}
            />
            <Tab.Screen
                name="BookingsTab"
                component={MyRequestsScreen}
                options={{
                    tabBarLabel: t('tabs.my_requests', 'Bookings'),
                    tabBarIcon: ({ color, focused }) => (
                        <TabIcon icon={ClipboardList} color={color} focused={focused} />
                    ),
                }}
            />
            <Tab.Screen
                name="ShopTab"
                component={ShopScreen}
                options={{
                    tabBarLabel: 'Shop',
                    tabBarIcon: ({ color, focused }) => (
                        <TabIcon icon={ShoppingBag} color={color} focused={focused} />
                    ),
                    tabBarBadge: '✦',
                    tabBarBadgeStyle: {
                        backgroundColor: colors.warning,
                        color: colors.textInverse,
                        fontSize: 8,
                        minWidth: 16,
                        height: 16,
                        lineHeight: 14,
                        borderRadius: 8,
                    },
                }}
            />
            <Tab.Screen
                name="ProfileTab"
                component={ProfileScreen}
                options={{
                    tabBarLabel: t('tabs.profile', 'Profile'),
                    tabBarIcon: ({ color, focused }) => (
                        <TabIcon icon={User} color={color} focused={focused} />
                    ),
                }}
            />
        </Tab.Navigator>
    );
}
