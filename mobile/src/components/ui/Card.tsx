/**
 * Card — Premium elevated surface component
 * 
 * Features:
 * - Subtle border for definition
 * - Configurable elevation levels
 * - Pressable variant
 */

import React, { useRef } from 'react';
import { View, StyleSheet, ViewStyle, Pressable, Animated } from 'react-native';
import { colors } from '../../theme/colors';
import { radii, spacing, shadows } from '../../theme/spacing';

type CardVariant = 'default' | 'outlined' | 'elevated';

interface CardProps {
    children: React.ReactNode;
    style?: ViewStyle;
    padded?: boolean;
    variant?: CardVariant;
    onPress?: () => void;
}

export function Card({ children, style, padded = true, variant = 'default', onPress }: CardProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        if (onPress) {
            Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
        }
    };

    const handlePressOut = () => {
        if (onPress) {
            Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
        }
    };

    const cardContent = (
        <Animated.View
            style={[
                styles.card,
                variantStyles[variant],
                padded && styles.padded,
                onPress && { transform: [{ scale: scaleAnim }] },
                style,
            ]}
        >
            {children}
        </Animated.View>
    );

    if (onPress) {
        return (
            <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
                {cardContent}
            </Pressable>
        );
    }

    return cardContent;
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.xl,
    },
    padded: {
        padding: spacing.lg,
    },
});

const variantStyles: Record<CardVariant, ViewStyle> = {
    default: {
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.sm,
    },
    outlined: {
        borderWidth: 1.5,
        borderColor: colors.border,
    },
    elevated: {
        ...shadows.md,
    },
};
