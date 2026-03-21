/**
 * Skeleton Loading Component — Shimmer placeholder for loading states
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions, ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/spacing';

const { width } = Dimensions.get('window');

interface SkeletonProps {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: ViewStyle;
}

/**
 * Single shimmer block — animated pulse
 */
export function Skeleton({
    width: w = '100%',
    height = 16,
    borderRadius = radii.md,
    style,
}: SkeletonProps) {
    const opacity = useRef(new Animated.Value(0.3)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, []);

    return (
        <Animated.View
            style={[
                {
                    width: w as any,
                    height,
                    borderRadius,
                    backgroundColor: colors.border,
                    opacity,
                },
                style,
            ]}
        />
    );
}

/**
 * Preset: Card skeleton (image + text lines)
 */
export function CardSkeleton() {
    return (
        <View style={skStyles.card}>
            <Skeleton height={120} borderRadius={radii.lg} />
            <View style={skStyles.cardContent}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
                <Skeleton width="30%" height={14} style={{ marginTop: 8 }} />
            </View>
        </View>
    );
}

/**
 * Preset: List item skeleton (avatar + text)
 */
export function ListItemSkeleton() {
    return (
        <View style={skStyles.listItem}>
            <Skeleton width={44} height={44} borderRadius={22} />
            <View style={skStyles.listItemText}>
                <Skeleton width="60%" height={14} />
                <Skeleton width="80%" height={12} style={{ marginTop: 6 }} />
            </View>
        </View>
    );
}

/**
 * Preset: Product grid skeleton
 */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
    const cardWidth = (width - spacing.xl * 2 - spacing.md) / 2;
    return (
        <View style={skStyles.grid}>
            {Array.from({ length: count }).map((_, i) => (
                <View key={i} style={[skStyles.gridCard, { width: cardWidth }]}>
                    <Skeleton height={cardWidth * 0.85} borderRadius={radii.lg} />
                    <View style={{ padding: spacing.md }}>
                        <Skeleton width="80%" height={12} />
                        <Skeleton width="40%" height={14} style={{ marginTop: 8 }} />
                    </View>
                </View>
            ))}
        </View>
    );
}

/**
 * Preset: Form skeleton
 */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
    return (
        <View style={skStyles.form}>
            {Array.from({ length: fields }).map((_, i) => (
                <View key={i} style={skStyles.formField}>
                    <Skeleton width="30%" height={12} />
                    <Skeleton height={44} borderRadius={radii.md} style={{ marginTop: 6 }} />
                </View>
            ))}
            <Skeleton height={48} borderRadius={radii.lg} style={{ marginTop: spacing.lg }} />
        </View>
    );
}

const skStyles = StyleSheet.create({
    card: {
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        overflow: 'hidden',
        marginBottom: spacing.md,
    },
    cardContent: { padding: spacing.md },
    listItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        marginBottom: spacing.sm,
    },
    listItemText: { flex: 1 },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        padding: spacing.xl,
    },
    gridCard: {
        backgroundColor: colors.background,
        borderRadius: radii.lg,
        overflow: 'hidden',
        marginBottom: spacing.md,
    },
    form: { padding: spacing.xl },
    formField: { marginBottom: spacing.lg },
});
