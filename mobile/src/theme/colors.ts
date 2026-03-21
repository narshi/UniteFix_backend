/**
 * UniteFix Design System — Color Tokens
 * Extracted from Figma designs
 */

export const colors = {
    // Primary
    primary: '#2196F3',
    primaryDark: '#1976D2',
    primaryLight: '#BBDEFB',
    primarySurface: '#E3F2FD',

    // Backgrounds
    background: '#FFFFFF',
    surface: '#F5F5F5',
    surfaceElevated: '#FFFFFF',

    // Text
    textPrimary: '#212121',
    textSecondary: '#757575',
    textDisabled: '#BDBDBD',
    textInverse: '#FFFFFF',

    // Status
    success: '#4CAF50',
    successLight: '#E8F5E9',
    warning: '#FF9800',
    warningLight: '#FFF3E0',
    error: '#F44336',
    errorLight: '#FFEBEE',
    info: '#2196F3',
    infoLight: '#E3F2FD',

    // Borders
    border: '#E0E0E0',
    borderFocused: '#2196F3',
    divider: '#F0F0F0',

    // Overlay
    overlay: 'rgba(0, 0, 0, 0.5)',
    scrim: 'rgba(0, 0, 0, 0.32)',

    // Social
    facebook: '#1877F2',
    google: '#DB4437',
} as const;

export type ColorToken = keyof typeof colors;
