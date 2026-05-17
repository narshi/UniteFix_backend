/**
 * UniteFix Design System — Typography Tokens
 * 
 * Uses Inter font family for premium feel.
 * Falls back to system font if Inter is not loaded.
 */

import { TextStyle, Platform } from 'react-native';

const fontFamily = Platform.select({
    ios: 'Inter',
    android: 'Inter',
    default: 'System',
});

export const typography: Record<string, TextStyle> = {
    // Display — Hero sections
    display: {
        fontSize: 32,
        fontWeight: '800',
        lineHeight: 40,
        letterSpacing: -0.5,
    },

    // Headings
    h1: {
        fontSize: 28,
        fontWeight: '700',
        lineHeight: 36,
        letterSpacing: -0.3,
    },

    h2: {
        fontSize: 22,
        fontWeight: '700',
        lineHeight: 30,
        letterSpacing: -0.2,
    },

    h3: {
        fontSize: 18,
        fontWeight: '600',
        lineHeight: 26,
    },

    h4: {
        fontSize: 16,
        fontWeight: '600',
        lineHeight: 24,
    },

    // Body
    body: {
        fontSize: 15,
        fontWeight: '400',
        lineHeight: 22,
    },

    bodyMedium: {
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 22,
    },

    bodySemibold: {
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 22,
    },

    // Small / Caption
    caption: {
        fontSize: 13,
        fontWeight: '400',
        lineHeight: 18,
    },

    captionMedium: {
        fontSize: 13,
        fontWeight: '500',
        lineHeight: 18,
    },

    small: {
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 16,
        letterSpacing: 0.3,
    },

    // Button
    button: {
        fontSize: 16,
        fontWeight: '600',
        lineHeight: 22,
        letterSpacing: 0.2,
    },

    buttonSmall: {
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 20,
    },

    // Mono (for prices, codes, OTP)
    mono: {
        fontSize: 16,
        fontWeight: '600',
        lineHeight: 22,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },

    monoLarge: {
        fontSize: 28,
        fontWeight: '700',
        lineHeight: 36,
        fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
};

/**
 * Backward-compatible size/weight scales
 * Used by auth screens — do not remove.
 */
export const fontSizes = {
    xs: 11,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 32,
} as const;

export const fontWeights = {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
};
