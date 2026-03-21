/**
 * Card — Elevated surface component
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii, spacing, shadows } from '../../theme/spacing';

interface CardProps {
    children: React.ReactNode;
    style?: ViewStyle;
    padded?: boolean;
}

export function Card({ children, style, padded = true }: CardProps) {
    return (
        <View style={[styles.card, padded && styles.padded, style]}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.lg,
        ...shadows.md,
    },
    padded: {
        padding: spacing.base,
    },
});
