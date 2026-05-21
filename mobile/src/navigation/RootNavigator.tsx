/**
 * PHASE 3: Root Navigator — Auth gate → Verification gate → Role-based navigation
 *
 * 3-branch routing:
 * 1. NOT authenticated → AuthStack (login/signup)
 * 2. Authenticated + role='serviceman' + NOT verified → EmployeePendingScreen
 * 3. Authenticated + role='serviceman' + verified → PartnerStack (full employee app)
 * 4. Authenticated + role='user' → CustomerStack (customer app)
 *
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
import { EmployeePendingScreen } from '../screens/partner/EmployeePendingScreen';
import { linkingConfig } from './linking';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
    NotificationService,
    addNotificationReceivedListener,
    addNotificationResponseListener,
} from '../services/notifications';
import { colors } from '../theme/colors';
import { GlobalAlertProvider } from '../components/ui/GlobalAlert';

const RootStack = createNativeStackNavigator();

function LoadingScreen() {
    return (
        <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary} />
        </View>
    );
}

/**
 * Determines which screen/stack to show based on auth + verification state.
 * This is the single source of truth for navigation branching.
 */
function getNavigationBranch(user: any): 'auth' | 'customer' | 'employee_verified' | 'employee_pending' {
    if (!user) return 'auth';

    if (user.role === 'serviceman') {
        // PHASE 3: Verification gate — only 'verified' employees get full access
        if (user.documentVerificationStatus === 'verified') {
            return 'employee_verified';
        }
        return 'employee_pending';
    }

    return 'customer';
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
            if (__DEV__) console.log('[Notification] Received in foreground:', notification.request.content.title);
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

    const branch = isAuthenticated ? getNavigationBranch(user) : 'auth';

    return (
        <ErrorBoundary>
            <NavigationContainer ref={navigationRef} linking={linkingConfig}>
                <RootStack.Navigator screenOptions={{ headerShown: false }}>
                    {branch === 'auth' && (
                        <RootStack.Screen name="Auth" component={AuthStack} />
                    )}
                    {branch === 'employee_verified' && (
                        <RootStack.Screen name="EmployeeMain" component={PartnerStack} />
                    )}
                    {branch === 'employee_pending' && (
                        <RootStack.Screen name="EmployeePending" component={EmployeePendingScreen} />
                    )}
                    {branch === 'customer' && (
                        <RootStack.Screen name="CustomerMain" component={CustomerStack} />
                    )}
                </RootStack.Navigator>
                {/* Premium Global Alert Component */}
                <GlobalAlertProvider />
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
