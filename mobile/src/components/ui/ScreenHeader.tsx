/**
 * ScreenHeader — Consistent premium header across all push screens
 *
 * Features:
 * - Pill-shaped back button
 * - Centered title
 * - Optional right action
 * - Safe area aware
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, radii, shadows } from '../../theme/spacing';
import { useScreenInsets } from '../../theme/layout';

interface ScreenHeaderProps {
    title: string;
    onBack: () => void;
    rightAction?: React.ReactNode;
    variant?: 'default' | 'transparent';
}

export function ScreenHeader({ title, onBack, rightAction, variant = 'default' }: ScreenHeaderProps) {
    const isTransparent = variant === 'transparent';
    const { headerTop } = useScreenInsets();

    return (
        <View
            style={[
                styles.container,
                { paddingTop: headerTop },
                isTransparent && styles.transparent,
            ]}
        >
            <TouchableOpacity
                onPress={onBack}
                style={styles.backBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <ArrowLeft size={20} color={colors.textPrimary} strokeWidth={2.2} />
            </TouchableOpacity>

            <Text style={styles.title} numberOfLines={1}>{title}</Text>

            <View style={styles.rightSlot}>
                {rightAction || <View style={styles.placeholder} />}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: spacing.base,
        paddingHorizontal: spacing.lg,
        backgroundColor: colors.background,
        borderBottomWidth: 1,
        borderBottomColor: colors.divider,
    },
    transparent: {
        backgroundColor: 'transparent',
        borderBottomWidth: 0,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: radii.lg,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        ...shadows.sm,
    },
    title: {
        ...typography.h4,
        color: colors.textPrimary,
        flex: 1,
        textAlign: 'center',
        marginHorizontal: spacing.sm,
    },
    rightSlot: {
        width: 40,
        alignItems: 'flex-end',
    },
    placeholder: {
        width: 40,
    },
});
