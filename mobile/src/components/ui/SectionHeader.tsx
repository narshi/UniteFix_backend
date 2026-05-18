/**
 * SectionHeader — Consistent section title across screens
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';

interface SectionHeaderProps {
    title: string;
    subtitle?: string;
    actionLabel?: string;
    onAction?: () => void;
    style?: ViewStyle;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction, style }: SectionHeaderProps) {
    return (
        <View style={[styles.container, style]}>
            <View style={styles.left}>
                <Text style={styles.title}>{title}</Text>
                {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            {actionLabel && onAction && (
                <TouchableOpacity
                    style={styles.action}
                    onPress={onAction}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text style={styles.actionText}>{actionLabel}</Text>
                    <ChevronRight size={14} color={colors.primary} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: spacing.lg,
    },
    left: {
        flex: 1,
    },
    title: {
        ...typography.h3,
        color: colors.textPrimary,
    },
    subtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 2,
    },
    action: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    actionText: {
        ...typography.captionMedium,
        color: colors.primary,
    },
});
