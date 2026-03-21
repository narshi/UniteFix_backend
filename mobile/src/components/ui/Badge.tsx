/**
 * Badge — Status indicator chip
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii, spacing } from '../../theme/spacing';
import { fontSizes, fontWeights } from '../../theme/typography';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

interface BadgeProps {
    label: string;
    variant?: BadgeVariant;
    style?: ViewStyle;
}

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
    success: { bg: colors.successLight, text: colors.success },
    warning: { bg: colors.warningLight, text: colors.warning },
    error: { bg: colors.errorLight, text: colors.error },
    info: { bg: colors.infoLight, text: colors.info },
    default: { bg: colors.surface, text: colors.textSecondary },
};

export function Badge({ label, variant = 'default', style }: BadgeProps) {
    const colorSet = variantColors[variant];

    return (
        <View style={[styles.badge, { backgroundColor: colorSet.bg }, style]}>
            <Text style={[styles.text, { color: colorSet.text }]}>{label}</Text>
        </View>
    );
}

// Map service status to badge variant
export function getStatusBadgeVariant(status: string): BadgeVariant {
    switch (status) {
        case 'created': return 'info';
        case 'assigned': return 'warning';
        case 'accepted': return 'success';
        case 'in_progress': return 'warning';
        case 'completed': return 'success';
        case 'cancelled': return 'error';
        case 'disputed': return 'error';
        default: return 'default';
    }
}

export function getStatusLabel(status: string): string {
    switch (status) {
        case 'created': return 'Request Placed';
        case 'assigned': return 'Partner Assigned';
        case 'accepted': return 'Partner Accepted';
        case 'in_progress': return 'In Progress';
        case 'completed': return 'Completed';
        case 'cancelled': return 'Cancelled';
        case 'disputed': return 'Disputed';
        default: return status;
    }
}

const styles = StyleSheet.create({
    badge: {
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.sm,
        alignSelf: 'flex-start',
    },
    text: {
        fontSize: fontSizes.xs,
        fontWeight: fontWeights.semibold,
    },
});
