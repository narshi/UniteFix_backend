/**
 * Input — Form input with label, icon, error state, and password toggle
 */

import React, { useState } from 'react';
import {
    View,
    TextInput,
    Text,
    TouchableOpacity,
    StyleSheet,
    TextInputProps,
    ViewStyle,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography, fontSizes, fontWeights } from '../../theme/typography';
import { radii, spacing } from '../../theme/spacing';

interface InputProps extends TextInputProps {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    isPassword?: boolean;
    containerStyle?: ViewStyle;
}

export function Input({
    label,
    error,
    icon,
    isPassword = false,
    containerStyle,
    ...textInputProps
}: InputProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    return (
        <View style={[styles.container, containerStyle]}>
            {label && <Text style={styles.label}>{label}</Text>}
            <View
                style={[
                    styles.inputContainer,
                    isFocused && styles.focused,
                    error ? styles.error : undefined,
                ]}
            >
                {icon && <View style={styles.iconLeft}>{icon}</View>}
                <TextInput
                    {...textInputProps}
                    style={[styles.input, icon ? styles.inputWithIcon : undefined, textInputProps.style]}
                    placeholderTextColor={colors.textDisabled}
                    secureTextEntry={isPassword && !showPassword}
                    onFocus={(e) => {
                        setIsFocused(true);
                        textInputProps.onFocus?.(e);
                    }}
                    onBlur={(e) => {
                        setIsFocused(false);
                        textInputProps.onBlur?.(e);
                    }}
                />
                {isPassword && (
                    <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.toggle}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        {showPassword ? (
                            <EyeOff size={20} color={colors.textSecondary} />
                        ) : (
                            <Eye size={20} color={colors.textSecondary} />
                        )}
                    </TouchableOpacity>
                )}
            </View>
            {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: spacing.base,
    },
    label: {
        fontSize: fontSizes.sm,
        fontWeight: fontWeights.medium,
        color: colors.textPrimary,
        marginBottom: spacing.xs,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radii.md,
        backgroundColor: colors.background,
        minHeight: 48,
    },
    focused: {
        borderColor: colors.borderFocused,
        borderWidth: 1.5,
    },
    error: {
        borderColor: colors.error,
    },
    iconLeft: {
        paddingLeft: spacing.md,
    },
    input: {
        flex: 1,
        fontSize: fontSizes.base,
        color: colors.textPrimary,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.md,
    },
    inputWithIcon: {
        paddingLeft: spacing.sm,
    },
    toggle: {
        paddingHorizontal: spacing.md,
    },
    errorText: {
        fontSize: fontSizes.xs,
        color: colors.error,
        marginTop: spacing.xs,
    },
});
