/**
 * Customer Tab Navigator — 5-tab bottom navigation
 * All tabs use real screen implementations.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home, ClipboardList, ShoppingBag, Package, User } from 'lucide-react-native';
import { CustomerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';

import { HomeScreen } from '../screens/customer/HomeScreen';
import { MyRequestsScreen } from '../screens/customer/MyRequestsScreen';
import { ProfileScreen } from '../screens/customer/ProfileScreen';
import { ShopScreen } from '../screens/shop/ShopScreen';
import { OrdersScreen } from '../screens/shop/OrdersScreen';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

export function CustomerTabs() {
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
                name="HomeTab"
                component={HomeScreen}
                options={{
                    tabBarLabel: 'Home',
                    tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="BookingsTab"
                component={MyRequestsScreen}
                options={{
                    tabBarLabel: 'Bookings',
                    tabBarIcon: ({ color, size }) => <ClipboardList size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="ShopTab"
                component={ShopScreen}
                options={{
                    tabBarLabel: 'Shop',
                    tabBarIcon: ({ color, size }) => <ShoppingBag size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="OrdersTab"
                component={OrdersScreen}
                options={{
                    tabBarLabel: 'Orders',
                    tabBarIcon: ({ color, size }) => <Package size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="ProfileTab"
                component={ProfileScreen}
                options={{
                    tabBarLabel: 'Profile',
                    tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
                }}
            />
        </Tab.Navigator>
    );
}
