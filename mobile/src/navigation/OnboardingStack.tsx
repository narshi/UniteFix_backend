/**
 * Onboarding Stack — mandatory setup for newly created accounts.
 *
 * Rendered by RootNavigator whenever an authenticated account still has
 * outstanding steps. Because the gate is data-driven rather than a one-shot
 * navigation sequence, killing the app mid-signup resumes here at the first
 * incomplete step instead of dropping the user into the product.
 *
 * Customers:   profile → location
 * Technicians: profile → trades → location
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../types/navigation.types';
import { useAuthStore } from '../stores/auth.store';

import { OnboardingProfileScreen } from '../screens/onboarding/OnboardingProfileScreen';
import { OnboardingLocationScreen } from '../screens/onboarding/OnboardingLocationScreen';
import { ExpertiseSelectionScreen } from '../screens/auth/ExpertiseSelectionScreen';
import { ExpertCodeOfConductScreen } from '../screens/onboarding/ExpertCodeOfConductScreen';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Resume at the first unmet requirement rather than always restarting at step 1,
 * so a user who already supplied their name is not asked for it again.
 *
 * Must mirror getPendingOnboardingSteps in server/lib/onboarding.ts — the server
 * decides when onboarding is finished, so if the two disagree on order a user
 * can be shown a step the server does not consider outstanding, or be released
 * into the app with one still missing.
 */
const STEP_SCREEN: Record<string, keyof OnboardingStackParamList> = {
    profile: 'OnboardingProfile',
    skills: 'ExpertiseSelection',
    location: 'OnboardingLocation',
};

function getInitialRoute(user: any): keyof OnboardingStackParamList {
    // Preferred: the server's own list, already in the right order. The client
    // cannot derive the trades step itself — AuthUser does not carry an expert's
    // services, so a field-derived check would send a finished expert back to
    // the trade picker every time this stack mounted.
    const pending: string[] = Array.isArray(user?.pendingOnboardingSteps)
        ? user.pendingOnboardingSteps
        : [];
    const firstPending = pending.find((step) => STEP_SCREEN[step]);
    if (firstPending) return STEP_SCREEN[firstPending];

    // Fallback for sessions stored before the server sent the list.
    const hasProfile = !!user?.username?.trim();
    const hasLocation = !!user?.homeAddress?.trim() && !!user?.pinCode?.trim();

    if (!hasProfile) return 'OnboardingProfile';
    if (!hasLocation) return 'OnboardingLocation';
    // Only technicians can still be incomplete at this point (trades pending).
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
            <Stack.Screen name="ExpertCodeOfConduct" component={ExpertCodeOfConductScreen} />
        </Stack.Navigator>
    );
}
