/**
 * Business partner stack — wraps the trade tabs and adds the push screens.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BusinessPartnerTabs } from './BusinessPartnerTabs';
import { PartDetailScreen } from '../screens/b2b/PartDetailScreen';
import { CartScreen } from '../screens/b2b/CartScreen';
import { OrderDetailScreen } from '../screens/b2b/OrderDetailScreen';
import { LegalScreen } from '../screens/LegalScreen';
// Shared with the other roles — the same durable record, filtered by user.
import { NotificationsScreen } from '../screens/customer/NotificationsScreen';

const Stack = createNativeStackNavigator();

export function BusinessPartnerStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="BusinessPartnerTabs" component={BusinessPartnerTabs} />
            <Stack.Screen name="PartDetail" component={PartDetailScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
        </Stack.Navigator>
    );
}
