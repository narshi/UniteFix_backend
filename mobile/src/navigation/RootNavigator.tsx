/**
 * Root Navigator — Auth gate → Role-based navigation
 * Includes: ErrorBoundary, deep linking, push notification initialization
 */

import React, { useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useAuthStore } from '../stores/auth.store';
import { AuthStack } from './AuthStack';
import { CustomerStack } from './CustomerStack';
import { PartnerStack } from './PartnerStack';
import { linkingConfig } from './linking';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
    NotificationService,
    addNotificationReceivedListener,
    addNotificationResponseListener,
} from '../services/notifications';
import { colors } from '../theme/colors';

const RootStack = createNativeStackNavigator();

function LoadingScreen() {
    return (
        <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
}

export function RootNavigator() {
    const { isAuthenticated, isLoading, hydrate, recordActivity, user } = useAuthStore();
    const navigationRef = useRef<NavigationContainerRef<any>>(null);

    useEffect(() => {
        hydrate();
    }, []);

    // Record activity every time the app mounts with a valid session
    useEffect(() => {
        if (isAuthenticated) {
            recordActivity();
        }
    }, [isAuthenticated]);

    // Initialize push notifications after auth
    useEffect(() => {
        if (isAuthenticated) {
            NotificationService.initialize();
        }
    }, [isAuthenticated]);

    // Listen for incoming notifications (foreground)
    useEffect(() => {
        const receivedSub = addNotificationReceivedListener((notification) => {
            console.log('[Notification] Received in foreground:', notification.request.content.title);
        });

        // Listen for notification taps
        const responseSub = addNotificationResponseListener((response) => {
            const route = NotificationService.getNavigationRoute(response.notification);
            if (route && navigationRef.current) {
                navigationRef.current.navigate(route.screen as any, route.params);
            }
        });

        return () => {
            receivedSub.remove();
            responseSub.remove();
        };
    }, []);

    if (isLoading) {
        return <LoadingScreen />;
    }

    return (
        <ErrorBoundary>
            <NavigationContainer ref={navigationRef} linking={linkingConfig}>
                <RootStack.Navigator screenOptions={{ headerShown: false }}>
                    {!isAuthenticated ? (
                        <RootStack.Screen name="Auth" component={AuthStack} />
                    ) : user?.role === 'serviceman' ? (
                        <RootStack.Screen name="EmployeeMain" component={PartnerStack} />
                    ) : (
                        <RootStack.Screen name="CustomerMain" component={CustomerStack} />
                    )}
                </RootStack.Navigator>
            </NavigationContainer>
        </ErrorBoundary>
    );
}

const styles = StyleSheet.create({
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.background,
    },
});
