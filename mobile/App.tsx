/**
 * UniteFix Mobile App — Entry Point
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Alert } from 'react-native';
import { PremiumAlertProvider, PremiumAlertService } from './src/components/ui/PremiumAlert';
import { useAppUpdateCheck } from './src/hooks/useAppUpdateCheck';
import './src/i18n';

// --- GLOBAL ALERT INTERCEPTOR ---
// Overrides the native generic OS alert across the entire application (zero-friction migration)
const originalAlert = Alert.alert;
Alert.alert = (title, message, buttons, options) => {
  PremiumAlertService.show(title, message, buttons, options);
};
// --------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

function AppShell() {
  // Store-driven update check. Mounted inside the tree (not at module scope) so
  // it can raise a PremiumAlert, and deliberately NOT gated on auth — an
  // outdated build needs updating whether or not anyone is signed in.
  useAppUpdateCheck();

  return (
    <>
      <StatusBar style="dark" />
      <RootNavigator />
      <PremiumAlertProvider />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
