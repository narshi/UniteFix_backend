/**
 * OTPInput — Reusable 6-digit OTP input component
 *
 * Features:
 * - Auto-focus on mount
 * - Auto-advance between fields
 * - Paste support (distributes digits)
 * - Backspace moves to previous field
 * - Locked state (grays out)
 * - Accessibility labels
 */

import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    Animated,
} from 'react-native';
import { colors } from '../../theme/colors';
import { spacing, radii } from '../../theme/spacing';

const OTP_LENGTH = 6;

interface OTPInputProps {
    value: string[];
    onChange: (value: string, index: number) => void;
    onKeyPress: (key: string, index: number) => void;
    inputRefs: React.MutableRefObject<(TextInput | null)[]>;
    disabled?: boolean;
    error?: string | null;
    autoFocus?: boolean;
}

export function OTPInput({
    value,
    onChange,
    onKeyPress,
    inputRefs,
    disabled = false,
    error,
    autoFocus = true,
}: OTPInputProps) {
    const shakeAnim = useRef(new Animated.Value(0)).current;

    // Shake animation on error
    useEffect(() => {
        if (error) {
            Animated.sequence([
                Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
                Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
                Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
                Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
            ]).start();
        }
    }, [error, shakeAnim]);

    // Auto-focus first input on mount
    useEffect(() => {
        if (autoFocus) {
            const t = setTimeout(() => inputRefs.current[0]?.focus(), 100);
            return () => clearTimeout(t);
        }
    }, [autoFocus, inputRefs]);

    return (
        <View>
            <Animated.View
                style={[styles.container, { transform: [{ translateX: shakeAnim }] }]}
                accessibilityRole="none"
                accessibilityLabel="Enter your 6-digit OTP"
            >
                {value.map((digit, index) => {
                    const isFilled = digit.length > 0;
                    const isError = !!error;

                    return (
                        <TextInput
                            key={index}
                            ref={(ref) => { inputRefs.current[index] = ref; }}
                            style={[
                                styles.cell,
                                isFilled && styles.cellFilled,
                                isError && styles.cellError,
                                disabled && styles.cellDisabled,
                            ]}
                            value={digit}
                            onChangeText={(val) => onChange(val, index)}
                            onKeyPress={({ nativeEvent }) => onKeyPress(nativeEvent.key, index)}
                            keyboardType="number-pad"
                            maxLength={index === 0 ? OTP_LENGTH : 1}  // first field accepts full paste
                            selectTextOnFocus
                            editable={!disabled}
                            autoFocus={autoFocus && index === 0}
                            accessibilityLabel={`OTP digit ${index + 1} of ${OTP_LENGTH}`}
                            accessibilityHint={
                                index === 0
                                    ? 'Enter the verification code. You can paste all digits here.'
                                    : undefined
                            }
                            textContentType="oneTimeCode"   // iOS autofill
                            importantForAutofill="yes"
                            caretHidden
                        />
                    );
                })}
            </Animated.View>

            {error ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                    {error}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: spacing.sm,
    },
    cell: {
        width: 48,
        height: 58,
        borderRadius: radii.md,
        borderWidth: 2,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        textAlign: 'center',
        fontSize: 24,
        fontWeight: '700',
        color: colors.textPrimary,
        // Smooth border-color transition is not natively supported in RN
        // but the conditional style reapplication is instant
    },
    cellFilled: {
        borderColor: colors.primary,
        backgroundColor: colors.primarySurface,
    },
    cellError: {
        borderColor: colors.error,
        backgroundColor: colors.errorLight,
    },
    cellDisabled: {
        opacity: 0.4,
        backgroundColor: colors.surface,
    },
    errorText: {
        marginTop: spacing.sm,
        textAlign: 'center',
        fontSize: 13,
        color: colors.error,
        fontWeight: '500',
    },
});
