/**
 * Button — Primary UI component
 * Supports: primary, secondary, outline, ghost, social variants
 */

import React from 'react';
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
} from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { radii, spacing } from '../../theme/spacing';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    loading?: boolean;
    disabled?: boolean;
    icon?: React.ReactNode;
    style?: ViewStyle;
}

export function Button({
    title,
    onPress,
    variant = 'primary',
    size = 'lg',
    fullWidth = true,
    loading = false,
    disabled = false,
    icon,
    style,
}: ButtonProps) {
    const isDisabled = disabled || loading;

    return (
        <TouchableOpacity
            onPress={onPress}
            disabled={isDisabled}
            activeOpacity={0.8}
            style={[
                styles.base,
                sizeStyles[size],
                variantStyles[variant],
                fullWidth && styles.fullWidth,
                isDisabled && styles.disabled,
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator
                    color={variant === 'outline' || variant === 'ghost' ? colors.primary : colors.textInverse}
                    size="small"
                />
            ) : (
                <>
                    {icon && <>{icon}</>}
                    <Text
                        style={[
                            styles.text,
                            sizeTextStyles[size],
                            variantTextStyles[variant],
                            icon ? { marginLeft: spacing.sm } : undefined,
                        ]}
                    >
                        {title}
                    </Text>
                </>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.md,
    },
    fullWidth: {
        width: '100%',
    },
    disabled: {
        opacity: 0.5,
    },
    text: {
        fontWeight: typography.button.fontWeight,
    },
});

const sizeStyles: Record<ButtonSize, ViewStyle> = {
    sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base },
    md: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
    lg: { paddingVertical: 14, paddingHorizontal: spacing.xl },
};

const sizeTextStyles: Record<ButtonSize, TextStyle> = {
    sm: { fontSize: 13 },
    md: { fontSize: 15 },
    lg: { fontSize: 17 },
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface },
    outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.error },
};

const variantTextStyles: Record<ButtonVariant, TextStyle> = {
    primary: { color: colors.textInverse },
    secondary: { color: colors.textPrimary },
    outline: { color: colors.primary },
    ghost: { color: colors.primary },
    danger: { color: colors.textInverse },
};
