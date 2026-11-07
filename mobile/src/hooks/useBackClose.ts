/**
 * Android's back button closes something open inside a screen (a search box,
 * a picked item, a sub-step) before it leaves the screen, the same way the
 * screen's own back arrow does. Only while the screen is focused, so a screen
 * left underneath in the stack never swallows a back press meant for the top.
 */

import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function useBackClose(active: boolean, close: () => void) {
    useFocusEffect(
        useCallback(() => {
            if (!active) return undefined;
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                close();
                return true; // handled: stay on this screen
            });
            return () => sub.remove();
        }, [active, close]),
    );
}
