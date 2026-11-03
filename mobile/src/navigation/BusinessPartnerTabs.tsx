/**
 * Business partner tabs — the trade side of the app.
 *
 * A shop owner opens this to order parts, see where an order is, and check
 * what is owed either way. A partner with Field service also gets Jobs (assign
 * UniteFix's bookings, or take them himself) and Team (technicians and the
 * commission on their jobs), first, because that is the daily work. The bar
 * is styled identically to the customer and technician bars so a device
 * shared across roles feels like one product.
 */

import React from 'react';
import { Platform, View, ActivityIndicator } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Store, PackageSearch, Building2, Briefcase, Users } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { partnerHubApi } from '../api/partnerHub.api';
import { BusinessPartnerTabParamList } from '../types/navigation.types';
import { colors } from '../theme/colors';
import { radii, spacing, shadows } from '../theme/spacing';
import { TAB_BAR_HEIGHT, TAB_BAR_GAP } from '../theme/layout';

import { CatalogueScreen } from '../screens/b2b/CatalogueScreen';
import { OrdersScreen } from '../screens/b2b/OrdersScreen';
import { AccountScreen } from '../screens/b2b/AccountScreen';
import { PartnerJobsScreen } from '../screens/b2b/PartnerJobsScreen';
import { PartnerTeamScreen } from '../screens/b2b/PartnerTeamScreen';

const Tab = createBottomTabNavigator<BusinessPartnerTabParamList>();

export function BusinessPartnerTabs() {
    const insets = useSafeAreaInsets();
    const tabBarBottom = Platform.OS === 'ios' ? Math.max(insets.bottom, TAB_BAR_GAP) : insets.bottom + TAB_BAR_GAP;
    // Field service is a module of the business; the Hub says which are on.
    const hub = useQuery({ queryKey: ['hub-me'], queryFn: async () => (await partnerHubApi.me()).data.data, staleTime: 5 * 60_000, retry: 1 });
    const field = !!hub.data?.modules?.includes('field');
    // Wait for that answer so Jobs opens first when it exists (a failed check falls back to the trade tabs).
    if (hub.isLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}><ActivityIndicator color={colors.primary} /></View>;

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
            {field && (
                <Tab.Screen
                    name="JobsTab"
                    component={PartnerJobsScreen}
                    options={{ tabBarLabel: 'Jobs', tabBarIcon: ({ color, size }) => <Briefcase size={size} color={color} /> }}
                />
            )}
            {field && (
                <Tab.Screen
                    name="TeamTab"
                    component={PartnerTeamScreen}
                    options={{ tabBarLabel: 'Team', tabBarIcon: ({ color, size }) => <Users size={size} color={color} /> }}
                />
            )}
            <Tab.Screen
                name="CatalogueTab"
                component={CatalogueScreen}
                options={{ tabBarLabel: field ? 'Parts' : 'Catalogue', tabBarIcon: ({ color, size }) => <Store size={size} color={color} /> }}
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
