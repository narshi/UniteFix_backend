/**
 * Customer Stack Navigator — Wraps CustomerTabs and adds push screens
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CustomerTabs } from './CustomerTabs';
import { ServiceRequestScreen } from '../screens/customer/ServiceRequestScreen';
import { RequestDetailScreen } from '../screens/customer/RequestDetailScreen';
import { NotificationsScreen } from '../screens/customer/NotificationsScreen';
import { OtpDisplayScreen } from '../screens/customer/OtpDisplayScreen';
import { SupportTicketScreen } from '../screens/customer/SupportTicketScreen';
import { ProductDetailScreen } from '../screens/shop/ProductDetailScreen';
import { CartScreen } from '../screens/shop/CartScreen';
import { CheckoutScreen } from '../screens/shop/CheckoutScreen';
import { OrderConfirmationScreen } from '../screens/shop/OrderConfirmationScreen';
import { OrderDetailScreen } from '../screens/shop/OrderDetailScreen';
import { LocationSelectionScreen } from '../screens/customer/LocationSelectionScreen';
import { AllServicesScreen } from '../screens/customer/AllServicesScreen';
import { FinalPaymentScreen } from '../screens/customer/FinalPaymentScreen';

const Stack = createNativeStackNavigator();

export function CustomerStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="CustomerTabs" component={CustomerTabs} />
            <Stack.Screen name="ServiceRequest" component={ServiceRequestScreen} />
            <Stack.Screen name="RequestDetail" component={RequestDetailScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="OtpDisplay" component={OtpDisplayScreen} />
            <Stack.Screen name="SupportTicket" component={SupportTicketScreen} />
            <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
            <Stack.Screen name="Cart" component={CartScreen} />
            <Stack.Screen name="Checkout" component={CheckoutScreen} />
            <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />
            <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
            <Stack.Screen name="LocationSelection" component={LocationSelectionScreen} />
            <Stack.Screen name="AllServices" component={AllServicesScreen} />
            <Stack.Screen name="FinalPayment" component={FinalPaymentScreen} />
        </Stack.Navigator>
    );
}
