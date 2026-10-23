/**
 * Forced update.
 *
 * On start and whenever the app comes back to the foreground it asks the
 * server for the minimum version (set by UniteFix staff on Admin → Settings →
 * App updates). Below it — or when the server refuses a request with 426 —
 * this covers the whole app with "Update required" and nothing else works.
 * The back button does nothing; the only way on is the update.
 *
 * "Update now" first tries Google Play's own in-app update (it downloads and
 * installs without leaving the app), and falls back to opening the store page.
 *
 * Fails open on a network error: an unreachable version check must not lock a
 * working install. The server gate still refuses an outdated build's requests.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, Image, Linking, Modal, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import * as InAppUpdates from 'expo-in-app-updates';
import { apiClient, APP_VERSION_CODE } from '../api/client';
import { useUpdateStore } from '../stores/update.store';
import { Button } from './ui/Button';
import { colors, spacing, radii } from '../theme';

const PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.unitefix.app';

async function checkMinimum() {
    if (__DEV__ || !APP_VERSION_CODE) return;
    try {
        const { data } = await apiClient.get('/api/client/app-version', { params: { platform: Platform.OS, versionCode: APP_VERSION_CODE } });
        const info = data?.data ?? {};
        const min = Number(info.minVersionCode) || 0;
        const { setRequired, required } = useUpdateStore.getState();
        if (min > 0 && APP_VERSION_CODE < min) {
            setRequired({ message: String(info.message ?? 'Please update UniteFix to continue.'), updateUrl: info.updateUrl ?? null, minVersionCode: min });
        } else if (required) {
            // Staff lowered the minimum again: let the app run.
            setRequired(null);
        }
    } catch {
        // Offline or server down: fail open (the server gate still applies).
    }
}

export function ForceUpdateGate() {
    const required = useUpdateStore(s => s.required);
    const [opening, setOpening] = useState(false);

    useEffect(() => {
        checkMinimum();
        const sub = AppState.addEventListener('change', (state: AppStateStatus) => { if (state === 'active') checkMinimum(); });
        return () => sub.remove();
    }, []);

    // Android back must not dismiss it.
    useEffect(() => {
        if (!required) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
        return () => sub.remove();
    }, [required]);

    const update = useCallback(async () => {
        setOpening(true);
        try {
            if (Platform.OS === 'android') {
                try {
                    const info = await InAppUpdates.checkForUpdate();
                    if (info?.updateAvailable) {
                        await InAppUpdates.startUpdate(true);
                        return;
                    }
                } catch { /* not installed from Play, or Play unavailable: use the store link */ }
            }
            const url = required?.updateUrl || (Platform.OS === 'android' ? 'market://details?id=com.unitefix.app' : PLAY_WEB);
            try { await Linking.openURL(url); }
            catch { await Linking.openURL(PLAY_WEB).catch(() => {}); }
        } finally {
            setOpening(false);
        }
    }, [required]);

    if (!required) return null;
    return (
        <Modal visible animationType="fade" onRequestClose={() => { /* cannot be dismissed */ }} statusBarTranslucent>
            <View style={styles.screen}>
                <View style={styles.card}>
                    <Image source={require('../../assets/icon.png')} style={styles.logo} />
                    <Text style={styles.title}>Update required</Text>
                    <Text style={styles.message}>{required.message}</Text>
                    <Button title={opening ? 'Opening…' : 'Update now'} onPress={update} loading={opening} />
                    <Text style={styles.small}>
                        You have version {APP_VERSION_CODE}{required.minVersionCode ? `; version ${required.minVersionCode} or newer is needed` : ''}.
                    </Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    card: { width: '100%', maxWidth: 420, backgroundColor: colors.background, borderRadius: radii['2xl'], padding: spacing['2xl'], alignItems: 'center', gap: spacing.base },
    logo: { width: 72, height: 72, borderRadius: radii.xl },
    title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
    message: { fontSize: 15, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
    small: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
});
