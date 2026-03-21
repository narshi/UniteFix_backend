/**
 * UniteFix Design System — Typography
 */

import { TextStyle } from 'react-native';

export const fontSizes = {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 28,
    '3xl': 34,
} as const;

export const fontWeights = {
    regular: '400' as TextStyle['fontWeight'],
    medium: '500' as TextStyle['fontWeight'],
    semibold: '600' as TextStyle['fontWeight'],
    bold: '700' as TextStyle['fontWeight'],
};

export const lineHeights = {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
};

export const typography = {
    h1: { fontSize: fontSizes['3xl'], fontWeight: fontWeights.bold, lineHeight: fontSizes['3xl'] * lineHeights.tight },
    h2: { fontSize: fontSizes['2xl'], fontWeight: fontWeights.bold, lineHeight: fontSizes['2xl'] * lineHeights.tight },
    h3: { fontSize: fontSizes.xl, fontWeight: fontWeights.semibold, lineHeight: fontSizes.xl * lineHeights.tight },
    h4: { fontSize: fontSizes.lg, fontWeight: fontWeights.semibold, lineHeight: fontSizes.lg * lineHeights.normal },
    body: { fontSize: fontSizes.base, fontWeight: fontWeights.regular, lineHeight: fontSizes.base * lineHeights.relaxed },
    bodyMedium: { fontSize: fontSizes.base, fontWeight: fontWeights.medium, lineHeight: fontSizes.base * lineHeights.relaxed },
    caption: { fontSize: fontSizes.sm, fontWeight: fontWeights.regular, lineHeight: fontSizes.sm * lineHeights.normal },
    small: { fontSize: fontSizes.xs, fontWeight: fontWeights.regular, lineHeight: fontSizes.xs * lineHeights.normal },
    button: { fontSize: fontSizes.md, fontWeight: fontWeights.semibold, lineHeight: fontSizes.md * lineHeights.tight },
    label: { fontSize: fontSizes.sm, fontWeight: fontWeights.medium, lineHeight: fontSizes.sm * lineHeights.tight },
} as const;
