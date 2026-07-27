/**
 * Onboarding Stack — mandatory setup for newly created accounts.
 *
 * Rendered by RootNavigator whenever an authenticated account still has
 * outstanding steps. Because the gate is data-driven rather than a one-shot
 * navigation sequence, killing the app mid-signup resumes here at the first
 * incomplete step instead of dropping the user into the product.
 *
 * Customers: profile → location
 * Technicians: profile → location → skills
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../types/navigation.types';
import { useAuthStore } from '../stores/auth.store';

import { OnboardingProfileScreen } from '../screens/onboarding/OnboardingProfileScreen';
import { OnboardingLocationScreen } from '../screens/onboarding/OnboardingLocationScreen';
import { ExpertiseSelectionScreen } from '../screens/auth/ExpertiseSelectionScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Resume at the first unmet requirement rather than always restarting at step 1,
 * so a user who already supplied their name is not asked for it again.
 */
function getInitialRoute(user: any): keyof OnboardingStackParamList {
    const hasProfile = !!user?.username?.trim();
    const hasLocation = !!user?.homeAddress?.trim() && !!user?.pinCode?.trim();

    if (!hasProfile) return 'OnboardingProfile';
    if (!hasLocation) return 'OnboardingLocation';
    // Only technicians can still be incomplete at this point (skills pending).
    return 'ExpertiseSelection';
}

export function OnboardingStack() {
    const user = useAuthStore((s) => s.user);

    return (
        <Stack.Navigator
            initialRouteName={getInitialRoute(user)}
            screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                // Onboarding is mandatory — no swipe-back out of a required step.
                gestureEnabled: false,
            }}
        >
            <Stack.Screen name="OnboardingProfile" component={OnboardingProfileScreen} />
            <Stack.Screen name="OnboardingLocation" component={OnboardingLocationScreen} />
            <Stack.Screen name="ExpertiseSelection" component={ExpertiseSelectionScreen} />
        </Stack.Navigator>
    );
}
