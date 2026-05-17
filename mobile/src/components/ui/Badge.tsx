/**
 * Badge — Premium status indicator chip
 * 
 * Features:
 * - Pill shape with icon support
 * - Mapped to full booking state machine
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../../theme/colors';
import { radii, spacing } from '../../theme/spacing';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default' | 'primary';

interface BadgeProps {
    label: string;
    variant?: BadgeVariant;
    style?: ViewStyle;
    icon?: React.ReactNode;
}

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
    success: { bg: colors.successLight, text: colors.successDark },
    warning: { bg: colors.warningLight, text: colors.warningDark },
    error: { bg: colors.errorLight, text: colors.errorDark },
    info: { bg: colors.infoLight, text: colors.info },
    primary: { bg: colors.primarySurface, text: colors.primary },
    default: { bg: colors.surface, text: colors.textSecondary },
};

export function Badge({ label, variant = 'default', style, icon }: BadgeProps) {
    const colorSet = variantColors[variant];

    return (
        <View style={[styles.badge, { backgroundColor: colorSet.bg }, style]}>
            {icon && <View style={styles.icon}>{icon}</View>}
            <Text style={[styles.text, { color: colorSet.text }]}>{label}</Text>
        </View>
    );
}

// Map service status to badge variant
export function getStatusBadgeVariant(status: string): BadgeVariant {
    switch (status) {
        case 'created': return 'info';
        case 'assigned': return 'primary';
        case 'accepted': return 'primary';
        case 'reached': return 'primary';
        case 'in_progress': return 'warning';
        case 'pending_payment': return 'warning';
        case 'completed': return 'success';
        case 'cancelled': return 'error';
        case 'disputed': return 'error';
        default: return 'default';
    }
}

export function getStatusLabel(status: string): string {
    switch (status) {
        case 'created': return 'Booked';
        case 'assigned': return 'Assigned';
        case 'accepted': return 'Accepted';
        case 'reached': return 'Arrived';
        case 'in_progress': return 'In Progress';
        case 'pending_payment': return 'Pay Now';
        case 'completed': return 'Completed';
        case 'cancelled': return 'Cancelled';
        case 'disputed': return 'Disputed';
        default: return status;
    }
}

const styles = StyleSheet.create({
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: spacing.xs + 1,
        borderRadius: radii.full,
        alignSelf: 'flex-start',
    },
    icon: {
        marginRight: 4,
    },
    text: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
});
