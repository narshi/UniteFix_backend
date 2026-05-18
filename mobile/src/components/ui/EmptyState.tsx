/**
 * EmptyState — Premium empty state with SVG illustration
 *
 * Features:
 * - SVG illustration slot
 * - Title + description
 * - Optional CTA button
 * - Fade-in entrance animation
 */

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Image, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii } from '../../theme/spacing';
import { Button } from './Button';

interface EmptyStateProps {
    /** Lucide icon component */
    icon?: React.ReactNode;
    /** Image source for SVG/PNG illustration */
    image?: any;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    style?: ViewStyle;
}

export function EmptyState({
    icon,
    image,
    title,
    description,
    actionLabel,
    onAction,
    style,
}: EmptyStateProps) {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 500, delay: 200, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 500, delay: 200, useNativeDriver: true }),
        ]).start();
    }, []);

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
                style,
            ]}
        >
            {image ? (
                <Image source={image} style={styles.image} resizeMode="contain" />
            ) : icon ? (
                <View style={styles.iconCircle}>{icon}</View>
            ) : null}

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.description}>{description}</Text>

            {actionLabel && onAction && (
                <Button
                    title={actionLabel}
                    onPress={onAction}
                    size="sm"
                    style={styles.button}
                />
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingHorizontal: spacing['2xl'],
        paddingVertical: spacing['3xl'],
    },
    image: {
        width: 160,
        height: 160,
        marginBottom: spacing.xl,
        opacity: 0.85,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: spacing.xl,
    },
    title: {
        ...typography.h3,
        color: colors.textPrimary,
        textAlign: 'center',
        marginBottom: spacing.sm,
    },
    description: {
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        maxWidth: 280,
    },
    button: {
        marginTop: spacing.xl,
        minWidth: 180,
    },
});
