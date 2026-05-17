/**
 * UniteFix Design System — Premium Color Palette
 * 
 * Deep indigo primary with vibrant accents.
 * Inspired by Stripe, Linear, and Razorpay mobile apps.
 */

export const colors = {
    // Primary — Deep Indigo
    primary: '#4F46E5',
    primaryDark: '#3730A3',
    primaryLight: '#C7D2FE',
    primarySurface: '#EEF2FF',

    // Accent — Vibrant Emerald (for success/CTA)
    accent: '#10B981',
    accentDark: '#059669',
    accentLight: '#D1FAE5',

    // Backgrounds
    background: '#FFFFFF',
    backgroundDark: '#0F172A',    // Dark mode / hero headers
    surface: '#F8FAFC',
    surfaceElevated: '#FFFFFF',
    surfaceDark: '#1E293B',

    // Text
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    textDisabled: '#CBD5E1',
    textInverse: '#FFFFFF',
    textAccent: '#4F46E5',

    // Status
    success: '#10B981',
    successLight: '#D1FAE5',
    successDark: '#059669',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    warningDark: '#D97706',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    errorDark: '#DC2626',
    info: '#3B82F6',
    infoLight: '#DBEAFE',

    // Borders & Dividers
    border: '#E2E8F0',
    borderFocused: '#4F46E5',
    divider: '#F1F5F9',

    // Overlay
    overlay: 'rgba(15, 23, 42, 0.6)',
    scrim: 'rgba(15, 23, 42, 0.4)',

    // Glass effect
    glass: 'rgba(255, 255, 255, 0.8)',
    glassBorder: 'rgba(255, 255, 255, 0.18)',

    // Brand
    truecaller: '#0095FF',
    razorpay: '#072654',
    whatsapp: '#25D366',

    // Gradients (as arrays for LinearGradient)
    gradientPrimary: ['#4F46E5', '#7C3AED'] as readonly string[],
    gradientHero: ['#0F172A', '#1E293B'] as readonly string[],
    gradientSuccess: ['#10B981', '#059669'] as readonly string[],
    gradientDanger: ['#EF4444', '#DC2626'] as readonly string[],
} as const;

export type ColorToken = keyof typeof colors;
