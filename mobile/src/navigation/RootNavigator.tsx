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
import { OnboardingStack } from './OnboardingStack';
import { EmployeePendingScreen } from '../screens/partner/EmployeePendingScreen';
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

/**
 * Determines which screen/stack to show based on auth + verification state.
 * This is the single source of truth for navigation branching.
 */
function getNavigationBranch(
    user: any,
): 'auth' | 'onboarding' | 'customer' | 'employee_verified' | 'employee_pending' {
    if (!user) return 'auth';

    // Mandatory setup outranks every other branch: a signup that has not supplied
    // profile details, a location (and skills, for technicians) cannot use the
    // app. Derived from stored data, so an interrupted signup resumes here.
    if (user.onboardingCompleted === false) return 'onboarding';

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

    // Register this device for push once the user is authenticated. Re-running on
    // every login matters: the token is stored against a user id, so a device
    // shared between a customer and an expert must re-register per session.
    useEffect(() => {
        if (isAuthenticated) {
            NotificationService.initialize();
        }
    }, [isAuthenticated]);

    /**
     * Open the screen a notification points at.
     *
     * `navigate(screenName)` from the root only searches the CURRENT navigator —
     * it cannot descend into a child stack, so navigating straight to
     * 'RequestDetail' silently did nothing. The route carries the owning stack so
     * we can address the nested screen explicitly.
     */
    const openNotification = (notification: any) => {
        const route = NotificationService.getNavigationRoute(notification);
        if (!route || !navigationRef.current) return;

        // The target stack only exists when the signed-in user's role matches it.
        // Ignoring a mismatch beats crashing on an unknown route name.
        const activeStack = getNavigationBranch(useAuthStore.getState().user);
        const stackIsMounted =
            (route.stack === 'CustomerMain' && activeStack === 'customer') ||
            (route.stack === 'EmployeeMain' && activeStack === 'employee_verified');

        if (!stackIsMounted) {
            if (__DEV__) {
                console.log(
                    `[Notification] Ignoring deep link to ${route.stack} — current branch is ${activeStack}`
                );
            }
            return;
        }

        // Cast: NavigationContainerRef<any> narrows navigate()'s params to
        // `never`, which cannot express a nested { screen, params } target.
        (navigationRef.current as any).navigate(route.stack, {
            screen: route.screen,
            params: route.params,
        });
    };

    // Foreground arrivals + taps (background and quit-state).
    useEffect(() => {
        const receivedSub = addNotificationReceivedListener((notification) => {
            if (__DEV__) {
                console.log('[Notification] Received in foreground:', notification.request.content.title);
            }
        });

        const responseSub = addNotificationResponseListener((response) => {
            openNotification(response.notification);
        });

        return () => {
            receivedSub.remove();
            responseSub.remove();
        };
    }, []);

    /**
     * Cold start: the app was launched by tapping a notification. The response
     * listener above does not fire for that case, so replay the last response
     * once navigation is ready and the correct stack has mounted.
     */
    useEffect(() => {
        if (!isAuthenticated) return;

        let cancelled = false;
        NotificationService.getLastNotificationResponse().then((response) => {
            if (cancelled || !response) return;
            // Defer a tick so the navigator has finished mounting the branch.
            setTimeout(() => openNotification(response.notification), 400);
        });

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, user?.role]);

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
                    {branch === 'onboarding' && (
                        <RootStack.Screen name="Onboarding" component={OnboardingStack} />
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
                {/* Alerts are rendered by <PremiumAlertProvider /> in App.tsx,
                    which also intercepts every Alert.alert call app-wide. */}
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
