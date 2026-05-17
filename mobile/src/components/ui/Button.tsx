/**
 * Button — Premium UI Component
 * 
 * Features:
 * - Gradient primary variant with glow shadow
 * - Smooth press animation (scale down)
 * - Loading spinner with proper colors
 * - Icon support (left or right)
 */

import React, { useRef } from 'react';
import {
    Pressable,
    Text,
    StyleSheet,
    ActivityIndicator,
    ViewStyle,
    TextStyle,
    Animated,
    View,
} from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { radii, spacing, shadows } from '../../theme/spacing';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
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
    iconRight?: React.ReactNode;
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
    iconRight,
    style,
}: ButtonProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const isDisabled = disabled || loading;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.97,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const isPrimary = variant === 'primary';
    const isSuccess = variant === 'success';

    return (
        <Animated.View
            style={[
                { transform: [{ scale: scaleAnim }] },
                fullWidth && styles.fullWidth,
                isPrimary && shadows.glow,
                isSuccess && shadows.successGlow,
            ]}
        >
            <Pressable
                onPress={onPress}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={isDisabled}
                style={[
                    styles.base,
                    sizeStyles[size],
                    variantStyles[variant],
                    isDisabled && styles.disabled,
                    style,
                ]}
            >
                {loading ? (
                    <ActivityIndicator
                        color={
                            variant === 'outline' || variant === 'ghost'
                                ? colors.primary
                                : colors.textInverse
                        }
                        size="small"
                    />
                ) : (
                    <View style={styles.content}>
                        {icon && <View style={styles.iconLeft}>{icon}</View>}
                        <Text
                            style={[
                                styles.text,
                                sizeTextStyles[size],
                                variantTextStyles[variant],
                            ]}
                        >
                            {title}
                        </Text>
                        {iconRight && <View style={styles.iconRight}>{iconRight}</View>}
                    </View>
                )}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radii.lg,
        overflow: 'hidden',
    },
    fullWidth: {
        width: '100%',
    },
    disabled: {
        opacity: 0.45,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        ...typography.button,
    },
    iconLeft: {
        marginRight: spacing.sm,
    },
    iconRight: {
        marginLeft: spacing.sm,
    },
});

const sizeStyles: Record<ButtonSize, ViewStyle> = {
    sm: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.base },
    md: { paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg },
    lg: { paddingVertical: spacing.base, paddingHorizontal: spacing.xl },
};

const sizeTextStyles: Record<ButtonSize, TextStyle> = {
    sm: { ...typography.buttonSmall },
    md: { ...typography.button, fontSize: 15 },
    lg: { ...typography.button },
};

const variantStyles: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
    ghost: { backgroundColor: 'transparent' },
    danger: { backgroundColor: colors.error },
    success: { backgroundColor: colors.success },
};

const variantTextStyles: Record<ButtonVariant, TextStyle> = {
    primary: { color: colors.textInverse },
    secondary: { color: colors.textPrimary },
    outline: { color: colors.primary },
    ghost: { color: colors.primary },
    danger: { color: colors.textInverse },
    success: { color: colors.textInverse },
};
