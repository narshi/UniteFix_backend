/**
 * Business partner tabs — the trade side of the app.
 *
 * Three tabs, because a shop owner opens this to do three things: order
 * parts, see where an order is, and check what is owed either way. The bar
 * is styled identically to the customer and technician bars so a device
 * shared across roles feels like one product.
 */

import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Store, PackageSearch, Building2 } from 'lucide-react-native';
import { BusinessPartnerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';
import { radii, spacing, shadows } from '../theme/spacing';
import { TAB_BAR_HEIGHT, TAB_BAR_GAP } from '../theme/layout';

import { CatalogueScreen } from '../screens/b2b/CatalogueScreen';
import { OrdersScreen } from '../screens/b2b/OrdersScreen';
import { AccountScreen } from '../screens/b2b/AccountScreen';

const Tab = createBottomTabNavigator<BusinessPartnerTabParamList>();

export function BusinessPartnerTabs() {
    const insets = useSafeAreaInsets();
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
                tabBarItemStyle: { paddingTop: 6 },
            }}
        >
            <Tab.Screen
                name="CatalogueTab"
                component={CatalogueScreen}
                options={{ tabBarLabel: 'Catalogue', tabBarIcon: ({ color, size }) => <Store size={size} color={color} /> }}
            />
            <Tab.Screen
                name="OrdersTab"
                component={OrdersScreen}
                options={{ tabBarLabel: 'Orders', tabBarIcon: ({ color, size }) => <PackageSearch size={size} color={color} /> }}
            />
            <Tab.Screen
                name="AccountTab"
                component={AccountScreen}
                options={{ tabBarLabel: 'Account', tabBarIcon: ({ color, size }) => <Building2 size={size} color={color} /> }}
            />
        </Tab.Navigator>
    );
}
