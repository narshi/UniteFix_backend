/**
 * Partner Stack Navigator — Wraps PartnerTabs and adds push screens
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PartnerTabs } from './PartnerTabs';
import { AssignmentDetailScreen } from '../screens/partner/AssignmentDetailScreen';
import { StartServiceScreen } from '../screens/partner/StartServiceScreen';
import { InvoiceViewScreen } from '../screens/partner/InvoiceViewScreen';
import { SubmitBillScreen } from '../screens/partner/SubmitBillScreen';
import { ServiceHistoryDetailScreen } from '../screens/partner/ServiceHistoryDetailScreen';
import { ManageExpertiseScreen } from '../screens/partner/ManageExpertiseScreen';
import { LegalScreen } from '../screens/LegalScreen';
// Shared with the customer stack — an expert needs the same durable record of
// assignments, wallet credits and verification decisions.
import { NotificationsScreen } from '../screens/customer/NotificationsScreen';

const Stack = createNativeStackNavigator();

export function PartnerStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="PartnerTabs" component={PartnerTabs} />
            <Stack.Screen name="AssignmentDetail" component={AssignmentDetailScreen} />
            <Stack.Screen name="StartService" component={StartServiceScreen} />
            <Stack.Screen name="InvoiceView" component={InvoiceViewScreen} />
            <Stack.Screen name="SubmitBill" component={SubmitBillScreen} />
            <Stack.Screen name="ServiceHistoryDetail" component={ServiceHistoryDetailScreen} />
            <Stack.Screen name="ManageExpertise" component={ManageExpertiseScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
        </Stack.Navigator>
    );
}

