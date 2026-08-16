/**
 * In-app update check, driven entirely by the store.
 *
 * WHY NO BACKEND
 * There is no `minVersionCode` in our database and no admin screen to set one.
 * The decision of "is this update optional or mandatory" is made in the Play
 * Console at publish time via the release's **update priority** (0–5), which
 * Play hands back as `serverUpdateType`. That keeps one source of truth — the
 * release itself — instead of a version number in our config that has to be
 * remembered and kept in step with every rollout.
 *
 *   priority 4–5  -> IMMEDIATE: Play takes over with its own full-screen,
 *                    unskippable update UI. We do not draw that screen; Play
 *                    does, which is why this cannot be dismissed by a stray
 *                    Alert or a JS reload the way an in-app modal could.
 *   priority 0–3  -> FLEXIBLE: downloads in the background, then we ask once
 *                    whether to restart.
 *
 * FAILS OPEN, ALWAYS
 * Every path is wrapped so that a Play Services error, a sideloaded build, an
 * emulator, or a network failure results in the app starting normally. An
 * update check must never be able to brick a working install — which is the
 * main risk of a backend-driven minimum-version gate.
 *
 * Sideloaded APKs report no update: Play only knows about builds it installed.
 * Until the app is live on Play this is a no-op, by design.
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as InAppUpdates from 'expo-in-app-updates';
import { PremiumAlertService } from '../components/ui/PremiumAlert';

/** Remembers the last version we nagged about, so a soft prompt shows once. */
const FLEXIBLE_PROMPT_KEY = 'uf_update_prompted_for';

/**
 * A flexible prompt re-appears after this long even for the same version, so a
 * user who dismissed it once is reminded, but not on every cold start.
 */
const FLEXIBLE_REPROMPT_MS = 24 * 60 * 60 * 1000;

async function readLastPrompt(): Promise<{ version: string; at: number } | null> {
    try {
        const raw = await SecureStore.getItemAsync(FLEXIBLE_PROMPT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

async function rememberPrompt(version: string): Promise<void> {
    try {
        await SecureStore.setItemAsync(
            FLEXIBLE_PROMPT_KEY,
            JSON.stringify({ version, at: Date.now() }),
        );
    } catch {
        // Throttling is a nicety; losing it just means one extra prompt.
    }
}

export function useAppUpdateCheck() {
    // Guards against the check running twice from a fast background/foreground
    // bounce, which would stack two Play dialogs.
    const checking = useRef(false);
    const immediateCancelled = useRef(false);

    useEffect(() => {
        const runCheck = async () => {
            if (checking.current) return;
            checking.current = true;

            try {
                const info = await InAppUpdates.checkForUpdate();

                if (!info?.updateAvailable) return;

                // Play may already be mid-download from a previous session.
                if (info.updateInProgress) return;

                const wantsImmediate =
                    Platform.OS === 'android' &&
                    info.serverUpdateType === 'IMMEDIATE' &&
                    info.immediateAllowed !== false;

                if (wantsImmediate) {
                    // Play renders the blocking UI itself.
                    await InAppUpdates.startUpdate(true);
                    return;
                }

                // ── Flexible / iOS ────────────────────────────────────
                const storeVersion = String(info.storeVersion ?? 'unknown');
                const last = await readLastPrompt();
                const alreadyNagged =
                    last?.version === storeVersion &&
                    Date.now() - last.at < FLEXIBLE_REPROMPT_MS;

                if (alreadyNagged) return;
                await rememberPrompt(storeVersion);

                PremiumAlertService.show(
                    'Update available',
                    Platform.OS === 'android'
                        ? 'A newer version of UniteFix is ready. It downloads in the background — you can keep using the app.'
                        : 'A newer version of UniteFix is available on the App Store.',
                    [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Update',
                            onPress: () => {
                                // On iOS this opens the App Store listing; on
                                // Android it starts a background download.
                                InAppUpdates.startUpdate(false).catch(() => {
                                    // Store unreachable — nothing useful to say,
                                    // and blocking on it would be worse.
                                });
                            },
                        },
                    ],
                    { cancelable: true },
                );
            } catch {
                // Sideloaded build, no Play Services, emulator, offline — all
                // land here, and all must let the app run.
            } finally {
                checking.current = false;
            }
        };

        // A flexible update finishes downloading while the user carries on, so
        // the restart has to be offered rather than forced.
        const onDownloaded = InAppUpdates.addUpdateListener('updateDownloaded', () => {
            PremiumAlertService.show(
                'Update ready',
                'Restart UniteFix to finish installing the update.',
                [
                    { text: 'Later', style: 'cancel' },
                    {
                        text: 'Restart',
                        onPress: () => {
                            // Completes the install and restarts the app.
                            InAppUpdates.startUpdate(false).catch(() => { });
                        },
                    },
                ],
                { cancelable: true },
            );
        });

        // If the user backs out of a mandatory update, Play returns them to the
        // app. Re-offering on the next foreground is the only lever we have —
        // the alternative is a custom lock screen Play would fight with.
        const onCancelled = InAppUpdates.addUpdateListener('updateCancelled', () => {
            immediateCancelled.current = true;
        });

        runCheck();

        // Re-check on foreground: a release can go live mid-session, and it
        // gives a cancelled mandatory update its next chance.
        const onAppStateChange = (state: AppStateStatus) => {
            if (state !== 'active') return;
            if (immediateCancelled.current) immediateCancelled.current = false;
            runCheck();
        };

        const sub = AppState.addEventListener('change', onAppStateChange);

        return () => {
            sub.remove();
            onDownloaded();
            onCancelled();
        };
    }, []);
}
