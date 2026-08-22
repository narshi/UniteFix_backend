/**
 * UniteFix Design System — Layout constants & safe-area helpers
 *
 * WHY THIS EXISTS:
 * `app.json` sets `edgeToEdgeEnabled: true` on Android, so the app draws behind
 * the status bar and the system navigation bar. Hardcoded paddings (the old
 * `paddingTop: Platform.OS === 'ios' ? 56 : 44` pattern) clip content on
 * punch-hole/notched devices and let bottom CTAs sit underneath the nav bar.
 *
 * Every screen must derive its top/bottom padding from the real insets.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from './spacing';

/** Height of the floating pill tab bar rendered by Customer/Partner tab navigators. */
export const TAB_BAR_HEIGHT = 64;

/** Visual gap between the floating tab bar and the bottom safe-area edge. */
export const TAB_BAR_GAP = 12;

/** Floor for the top inset when the platform reports 0 (e.g. old Android). */
const MIN_TOP_INSET = 16;

/**
 * Breathing room between the status bar and the first row of header content.
 * The old hardcoded values (ios 56 / android 44/50/54) bundled the status-bar
 * height together with this padding, so using a bare inset would have made
 * every header noticeably tighter than the original design.
 */
const HEADER_CONTENT_GAP = spacing.md;

/** Minimum bottom padding so CTAs never sit flush against the screen edge. */
const MIN_BOTTOM_PAD = spacing.base;

/**
 * Safe-area aware spacing for a screen.
 *
 * - `headerTop`   → ready-to-use paddingTop for a screen's own header row
 *                   (status-bar inset + content gap; do not add more on top).
 * - `bottomInset` → raw bottom inset (nav bar / home indicator).
 * - `bottomBar`   → paddingBottom for a fixed bottom action bar.
 * - `tabContent`  → paddingBottom for scroll content inside a TAB screen,
 *                   clearing the floating tab bar.
 * - `fabBottom`   → `bottom` for a floating button on a TAB screen, so it sits
 *                   just above the tab bar on every device. A hardcoded value
 *                   here is the classic bug: it looks right on the phone it was
 *                   written on and slides behind the tab bar on any device with
 *                   a taller gesture-navigation inset.
 * - `scrollBottom`→ paddingBottom for scroll content on a pushed (non-tab) screen.
 */
export function useScreenInsets() {
    const insets = useSafeAreaInsets();

    return {
        insets,
        headerTop: Math.max(insets.top, MIN_TOP_INSET) + HEADER_CONTENT_GAP,
        bottomInset: insets.bottom,
        bottomBar: Math.max(insets.bottom, MIN_BOTTOM_PAD),
        tabContent: insets.bottom + TAB_BAR_HEIGHT + TAB_BAR_GAP + spacing.xl,
        fabBottom: insets.bottom + TAB_BAR_HEIGHT + TAB_BAR_GAP + spacing.sm,
        scrollBottom: Math.max(insets.bottom, MIN_BOTTOM_PAD) + spacing.xl,
    };
}

export type ScreenInsets = ReturnType<typeof useScreenInsets>;
