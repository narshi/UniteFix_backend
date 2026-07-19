/**
 * Auth Stack — Truecaller OAuth Authentication Flow
 *
 * Flow: Splash → RoleSelection → TruecallerAuth → (auto-navigate via auth gate)
 *       For employees: → EmployeePending (if admin approval needed)
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../types/navigation.types';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { RoleSelectionScreen } from '../screens/auth/RoleSelectionScreen';
import { TruecallerAuthScreen } from '../screens/auth/TruecallerAuthScreen';
import { EmployeePendingScreen } from '../screens/auth/EmployeePendingScreen';
import { ExpertiseSelectionScreen } from '../screens/auth/ExpertiseSelectionScreen';
import { LegalScreen } from '../screens/LegalScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
    return (
        <Stack.Navigator
            screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
            }}
        >
            <Stack.Screen name="Splash" component={SplashScreen} />
            <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
            <Stack.Screen name="TruecallerAuth" component={TruecallerAuthScreen} />
            <Stack.Screen name="ExpertiseSelection" component={ExpertiseSelectionScreen} />
            <Stack.Screen name="EmployeePending" component={EmployeePendingScreen} />
            <Stack.Screen name="Legal" component={LegalScreen} />
        </Stack.Navigator>
    );
}
