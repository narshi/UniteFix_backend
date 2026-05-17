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

const Stack = createNativeStackNavigator();

export function PartnerStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="PartnerTabs" component={PartnerTabs} />
            <Stack.Screen name="AssignmentDetail" component={AssignmentDetailScreen} />
            <Stack.Screen name="StartService" component={StartServiceScreen} />
            <Stack.Screen name="InvoiceView" component={InvoiceViewScreen} />
            <Stack.Screen name="SubmitBill" component={SubmitBillScreen} />
        </Stack.Navigator>
    );
}
